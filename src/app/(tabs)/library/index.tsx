import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Compass, FileDown, Globe } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { Card, IconBadge, ListGroup, ListRow, PressableScale, Screen, SearchField, SectionHeader, Text } from '@/components/ui';
import { catalog, loc, matchesLanguages, sumMB, tierResources } from '@/features/catalog';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { removeItem, useItems, type InstalledItem } from '@/features/content/items';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { registerZimFile } from '@/features/library/register';
import { formatBytes, formatMB } from '@/lib/format';
import { contentDir, deleteFile, freeBytes, hasRoomFor, partialDir } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';


/**
 * Copy a picked file into content/zim and register it. Files already inside
 * content/zim (visible through the Files app) are registered in place; existing
 * archives are never overwritten, and a failed import leaves nothing behind.
 */
async function importZimFile(asset: DocumentPicker.DocumentPickerAsset) {
  const dir = contentDir('zim');
  const norm = (u: string) => decodeURIComponent(u.replace(/^file:\/\//, ''));
  if (norm(asset.uri).startsWith(norm(dir.uri))) {
    await registerZimFile(asset.uri);
    return;
  }
  const size = Number(asset.size ?? 0);
  if (size && !hasRoomFor(size)) throw new NotEnoughStorageError(size);

  const base = asset.name.replace(/\.zim$/i, '').replace(/[^\w.-]+/g, '_') || 'import';
  let dest = new File(dir, `${base}.zim`);
  for (let n = 1; dest.exists; n++) dest = new File(dir, `${base}-${n}.zim`);

  const tmp = new File(partialDir(), `import-${Date.now()}.zim.part`);
  try {
    await new File(asset.uri).copy(tmp);
    await tmp.move(dest);
    await registerZimFile(dest.uri);
  } catch (e) {
    deleteFile(tmp.uri);
    deleteFile(dest.uri);
    throw e;
  }
}

export default function LibraryScreen() {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const langs = useSettings((s) => s.contentLanguages);
  const archives = useItems('zim').filter((i) => !i.isCourse);
  const [importing, setImporting] = useState(false);

  const importZim = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
    if (res.canceled || !res.assets?.[0]) return;
    setImporting(true);
    try {
      await importZimFile(res.assets[0]);
    } catch (e) {
      Alert.alert(t('importFailed'), e instanceof NotEnoughStorageError ? tc('storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }) : String((e as Error)?.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = (item: InstalledItem) =>
    Alert.alert(item.title, tc('settings:deleteConfirm', { title: item.title, size: formatBytes(item.sizeBytes) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);

  return (
    <Screen title={tc('tabs.library')}>
      <PressableScale onPress={() => router.push('/search')} pressedScale={0.99} accessibilityRole="search">
        <View pointerEvents="none">
          <SearchField placeholder={t('searchPlaceholder')} editable={false} />
        </View>
      </PressableScale>

      <SectionHeader title={t('onDevice')} />
      {archives.length ? (
        <ListGroup>
          {archives.map((item) => (
            <ArchiveRow key={item.id} item={item} onLongPress={() => confirmDelete(item)} />
          ))}
        </ListGroup>
      ) : (
        <Card style={{ gap: space.xs }}>
          <Text variant="headline">{t('onDeviceEmpty')}</Text>
          <Text variant="footnote" color="textSecondary">
            {t('onDeviceEmptyBody')}
          </Text>
        </Card>
      )}

      <SectionHeader title={t('wikipedia')} />
      <Card onPress={() => router.push('/library/wikipedia')} style={styles.wikiCard}>
        <IconBadge icon={Globe} hue="reference" size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3">{t('wikipedia')}</Text>
          <Text variant="footnote" color="textSecondary">
            {t('wikipediaBody')}
          </Text>
        </View>
      </Card>

      <SectionHeader title={t('categories')} />
      <View style={styles.grid}>
        {catalog.categories.map((c) => {
          const all = tierResources(c, c.tiers[c.tiers.length - 1], langs);
          const essential = c.tiers[0] ? tierResources(c, c.tiers[0], langs) : [];
          return (
            <Card key={c.slug} style={styles.tile} onPress={() => router.push({ pathname: '/library/category/[slug]', params: { slug: c.slug } })}>
              <IconBadge icon={iconByName(c.icon)} hue={c.hue ?? categoryHue(c.slug)} size={44} />
              <View style={{ gap: 2 }}>
                <Text variant="headline" numberOfLines={1}>
                  {loc(c.name)}
                </Text>
                <Text variant="caption" color="textSecondary" tabular>
                  {t('resources', { count: all.length })} · {formatMB(sumMB(essential))}+
                </Text>
              </View>
            </Card>
          );
        })}
      </View>

      <SectionHeader title={tc('actions.seeAll')} />
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
      {catalog.categories.length && !Object.values(catalog.resources).some((r) => matchesLanguages(r, langs)) ? (
        <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }}>
          {t('noResultsLang')}
        </Text>
      ) : null}
    </Screen>
  );
}

function ArchiveRow({ item, onLongPress }: { item: InstalledItem; onLongPress: () => void }) {
  const { colors } = useTheme();
  const illustration = typeof item.meta.illustration === 'string' ? item.meta.illustration : null;
  const Icon = iconByName(undefined);
  return (
    <ListRow
      title={item.title}
      subtitle={[item.description, formatBytes(item.sizeBytes)].filter(Boolean).join(' · ')}
      leading={
        illustration ? (
          <Image source={{ uri: illustration }} style={[styles.illustration, { backgroundColor: colors.surfaceAlt }]} />
        ) : (
          <IconBadge icon={Icon} hue={categoryHue(item.category)} size={40} />
        )
      }
      chevron
      onPress={() => router.push({ pathname: '/reader/[itemId]', params: { itemId: item.id } })}
      onLongPress={onLongPress}
    />
  );
}

const styles = StyleSheet.create({
  wikiCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { flexBasis: '47%', flexGrow: 1, gap: space.lg, minHeight: 132, justifyContent: 'space-between' },
  illustration: { width: 40, height: 40, borderRadius: radius.md },
});

