import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { Clock, Compass, FileDown } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, ScrollView, StyleSheet } from 'react-native';

import { showToast } from '@/components/Toast';
import { Card, Chip, IconBadge, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { catalog } from '@/features/catalog';
import { useItems } from '@/features/content/items';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { catalogHasLanguages, collectionOfItem, openCollection, useCollections } from '@/features/library/collections';
import { CollectionRow } from '@/features/library/components/CollectionRow';
import { SearchHero } from '@/features/library/components/SearchHero';
import { indexDocuments } from '@/features/library/documents';
import { recentHistory, type HistoryEntry } from '@/features/library/history';
import { suggestedSearches } from '@/features/library/recent-searches';
import { AlreadyInstalledError, registerZimFile } from '@/features/library/register';
import { useUpdates } from '@/features/updates/updates';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { contentDir, deleteFile, freeBytes, hasRoomFor, partialDir } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

/**
 * Bring a picked file into content/zim and register it. Existing archives are never
 * overwritten, the same archive twice is refused (AlreadyInstalledError), and a failed
 * import leaves nothing behind.
 *
 * iOS always hands over its own copy of the pick (tmp/<bundle>-Inbox, even for a file that
 * is already in the app's folder): move it, never copy it again, and never leave it behind.
 * Android hands over a content:// URI, which has to be copied.
 */
async function importZimFile(asset: DocumentPicker.DocumentPickerAsset) {
  const ownCopy = Platform.OS === 'ios';
  try {
    const dir = contentDir('zim');
    const size = Number(asset.size ?? 0);
    // Moving iOS's copy takes no space; it was taken before the picker returned.
    if (!ownCopy && size && !hasRoomFor(size)) throw new NotEnoughStorageError(size);

    const base = asset.name.replace(/\.zim$/i, '').replace(/[^\w.-]+/g, '_') || 'import';
    let dest = new File(dir, `${base}.zim`);
    for (let n = 1; dest.exists; n++) dest = new File(dir, `${base}-${n}.zim`);

    const tmp = new File(partialDir(), `import-${Date.now()}.zim.part`);
    try {
      if (ownCopy) await new File(asset.uri).move(tmp);
      else await new File(asset.uri).copy(tmp);
      await tmp.move(dest);
      const item = await registerZimFile(dest.uri, undefined, { rejectDuplicate: true });
      indexDocuments(item.id);
      return item;
    } catch (e) {
      deleteFile(tmp.uri);
      deleteFile(dest.uri);
      throw e;
    }
  } finally {
    if (ownCopy) deleteFile(asset.uri);
  }
}

/**
 * The Library: search first (it's the tab's main action), then the collections by topic, each saying how
 * much of it is on the phone. An archive lives in one collection only; its screen lists what you have,
 * then what's missing (owner's decision, 2026-11-02: proposal A of the library rethink).
 */
export default function LibraryScreen() {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const langs = useSettings((s) => s.contentLanguages);
  const books = useItems('zim');
  const collections = useCollections();
  const zimUpdates = useUpdates().filter((u) => u.kind === 'zim' && !u.inFlight);
  const [importing, setImporting] = useState(false);
  // Reading history and recent searches change in other screens: read them again when the tab shows.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  useFocusEffect(
    useCallback(() => {
      setHistory(recentHistory(5));
      setStarters(suggestedSearches());
    }, []),
  );
  const last = history.find((h) => books.some((b) => b.id === h.itemId));
  const lastItem = last ? books.find((b) => b.id === last.itemId) : undefined;
  const suggestions = books.length ? starters : [];

  const importZim = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
    if (res.canceled || !res.assets?.[0]) return;
    setImporting(true);
    try {
      const item = await importZimFile(res.assets[0]);
      showToast(t('imported', { title: item.title, collection: collections.find((c) => c.key === collectionOfItem(item))?.title ?? t('other') }));
    } catch (e) {
      if (e instanceof AlreadyInstalledError) {
        showToast(t('importDuplicate', { title: e.item.title }));
        return;
      }
      Alert.alert(t('importFailed'), e instanceof NotEnoughStorageError ? tc('storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }) : String((e as Error)?.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen title={tc('tabs.library')}>
      <SearchHero books={books.length} onPress={() => router.push('/search')} />
      {suggestions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chips}>
          {suggestions.map((q) => (
            <Chip key={q} label={q} onPress={() => router.push({ pathname: '/search', params: { q } })} />
          ))}
        </ScrollView>
      ) : null}

      {last && lastItem ? (
        <>
          <SectionHeader title={t('continueReading')} />
          <ListGroup>
            <ListRow
              testID="continue-reading"
              title={last.title}
              subtitle={`${lastItem.title} · ${formatRelativeDate(last.visitedAt)}`}
              leading={<IconBadge icon={Clock} hue="survival" size={36} />}
              chevron
              onPress={() => router.push({ pathname: '/reader/[itemId]', params: { itemId: last.itemId, path: last.path } })}
            />
          </ListGroup>
        </>
      ) : null}

      {!books.length ? (
        <Card style={{ gap: space.xs, marginTop: space.lg }}>
          <Text variant="headline">{t('onDeviceEmpty')}</Text>
          <Text variant="footnote" color="textSecondary">
            {t('onDeviceEmptyBody')}
          </Text>
        </Card>
      ) : null}

      <SectionHeader
        title={t('categories')}
        action={zimUpdates.length ? tc('updates:downloadsRow', { count: zimUpdates.length }) : undefined}
        onAction={() => router.push('/updates')}
      />
      <ListGroup>
        {collections.map((c) => (
          <CollectionRow key={c.key} collection={c} onPress={() => openCollection(c.key)} />
        ))}
      </ListGroup>

      <SectionHeader title={t('outsideCatalog')} />
      <ListGroup>
        <ListRow
          title={t('explore')}
          subtitle={t('exploreBody')}
          leading={<IconBadge icon={Compass} hue="ai" size={36} />}
          chevron
          onPress={() => router.push('/library/explore')}
        />
        <ListRow
          title={importing ? t('importing') : t('import')}
          subtitle={t('importBody')}
          leading={<IconBadge icon={FileDown} hue="neutral" size={36} />}
          chevron
          onPress={importing ? undefined : importZim}
        />
      </ListGroup>
      {catalog.categories.length && !catalogHasLanguages(langs) ? (
        <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }}>
          {t('noResultsLang')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -space.gutter, marginTop: space.md },
  chips: { paddingHorizontal: space.gutter, gap: space.sm },
});
