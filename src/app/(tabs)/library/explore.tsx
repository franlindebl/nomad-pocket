import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowDown, Check, CloudOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { Chip, EmptyState, PressableScale, ProgressRing, Row, SearchField, Text } from '@/components/ui';
import { getResource } from '@/features/catalog';
import { showDownloadError, LanguageTag } from '@/features/catalog/DownloadButton';
import { searchKiwix, shortLanguage, type KiwixEntry } from '@/features/catalog/opds';
import { useContent } from '@/features/content/items';
import { enqueueDownload, useDownload } from '@/features/downloads/manager';
import { looksMedical } from '@/features/library/medical';
import { formatBytes } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { layout, radius, space, useTheme } from '@/theme';

const LANG_CODES: Record<string, string> = { es: 'spa', en: 'eng' };

/** Kiwix search matches whole words only; make the last word a prefix match. */
function toKiwixQuery(q: string): string | undefined {
  const trimmed = q.trim();
  if (!trimmed) return undefined;
  return /[*"]$/.test(trimmed) ? trimmed : `${trimmed}*`;
}

export default function ExploreScreen() {
  const { t } = useTranslation('library');
  const contentLangs = useSettings((s) => s.contentLanguages);
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<string>(contentLangs[0] ?? 'es');
  const [entries, setEntries] = useState<KiwixEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      searchKiwix({ q: toKiwixQuery(query), lang: LANG_CODES[lang], count: 40 }, ctrl.signal)
        .then((res) => {
          setEntries(res.entries);
          setOffline(false);
        })
        .catch((e) => {
          if ((e as Error)?.name !== 'AbortError') setOffline(true);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query, lang]);

  return (
    <FlatList
      data={offline ? [] : entries}
      keyExtractor={(e) => e.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.md }}>
          <SearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('explorePlaceholder')} />
          <Row>
            {(['es', 'en'] as const).map((l) => (
              <Chip key={l} label={l.toUpperCase()} selected={lang === l} onPress={() => setLang(l)} />
            ))}
            {loading ? <ActivityIndicator style={{ marginLeft: space.sm }} /> : null}
          </Row>
        </View>
      }
      ListEmptyComponent={
        loading ? undefined : offline ? (
          <EmptyState icon={CloudOff} title={t('exploreOffline')} />
        ) : (
          <EmptyState icon={CloudOff} title={t('exploreEmpty')} />
        )
      }
      renderItem={({ item }) => <EntryRow entry={item} />}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
    />
  );
}

function EntryRow({ entry }: { entry: KiwixEntry }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const installed = useContent((s) => s.items.find((i) => i.catalogId === entry.name || i.id === entry.name));
  const download = useDownload(entry.name);
  const active = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);

  const start = () => {
    // A bundled catalog entry keeps its own category, course flag and medical flag (registerZimFile
    // reads them from the catalog); Kiwix's would override them. Only archives outside it carry Kiwix's.
    const known = !!getResource(entry.name);
    const medical = looksMedical({ names: [entry.name], category: entry.category, tags: entry.tags });
    try {
      enqueueDownload({
        id: entry.name,
        kind: 'zim',
        title: entry.title,
        url: entry.url,
        filename: decodeURIComponent(entry.url.split('/').pop() ?? `${entry.name}.zim`),
        expectedBytes: entry.sizeBytes,
        meta: {
          catalogId: entry.name,
          title: entry.title,
          description: entry.description,
          language: shortLanguage(entry.language),
          ...(known ? null : { category: entry.category, medical: medical || undefined }),
          version: entry.version,
          sourceUrl: entry.url,
        },
      });
    } catch (e) {
      showDownloadError(e, t);
    }
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {entry.illustrationUrl ? (
        <Image source={{ uri: entry.illustrationUrl }} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} />
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={6}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.title}
          </Text>
          <LanguageTag language={shortLanguage(entry.language)} />
        </Row>
        <Text variant="footnote" color="textSecondary" numberOfLines={2}>
          {entry.description}
        </Text>
        <Text variant="caption" color="textTertiary" tabular>
          {formatBytes(entry.sizeBytes)} · {entry.version}
        </Text>
      </View>
      {installed ? (
        <PressableScale
          onPress={() => router.push({ pathname: '/reader/[itemId]', params: { itemId: installed.id } })}
          accessibilityRole="button"
          accessibilityLabel={t('actions.open')}>
          <Check size={22} color={colors.success} />
        </PressableScale>
      ) : active && download ? (
        <ProgressRing value={download.totalBytes ? download.bytesWritten / download.totalBytes : 0} size={32} stroke={3} />
      ) : (
        <PressableScale onPress={start} haptic="light" style={[styles.dl, { backgroundColor: colors.ink }]} accessibilityLabel={t('actions.download')}>
          <ArrowDown size={16} color={colors.onInk} strokeWidth={2.5} />
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { ...layout.column, paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: 120 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.md },
  dl: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
