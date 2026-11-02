import { Image } from 'expo-image';
import * as Network from 'expo-network';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Compass, Library, Search as SearchIcon, SearchX } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';

import { Divider, EmptyState, IconBadge, ListGroup, ListRow, Segmented, SearchField, Text } from '@/components/ui';
import { readableDocTitle } from '@/features/assistant/rag-core';
import { catalog, matchesLanguages } from '@/features/catalog';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { ResourceRow } from '@/features/catalog/ResourceRow';
import { searchCatalog } from '@/features/catalog/search-core';
import { useItems, type InstalledItem } from '@/features/content/items';
import { HitRow } from '@/features/library/components/HitRow';
import { rememberSearch } from '@/features/library/recent-searches';
import { useDocSearch } from '@/features/library/useDocSearch';
import { useZimSearch, type SearchMode } from '@/features/library/useZimSearch';
import type { ZimSearchHit } from '@/features/library/zim';
import { useSettings } from '@/stores/settings';
import { layout, radius, space, useTheme } from '@/theme';

/** `pdf`: passages of the PDFs inside the archive (its document index), not its articles. */
type Section = { item: InstalledItem; data: ZimSearchHit[]; pdf?: boolean };

/**
 * The Library search, in three layers: what you can read now (inside your archives), what the bundled
 * catalog has that matches (works offline: it's for getting it next time there's a connection), and,
 * online, the same search in Kiwix's whole catalog.
 */
export default function GlobalSearchScreen() {
  const { t, i18n } = useTranslation('reader');
  const { colors } = useTheme();
  const archives = useItems('zim');
  const ids = useMemo(() => archives.map((a) => a.id), [archives]);
  // The Library's suggested searches open this screen with their query.
  const params = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const langs = useSettings((s) => s.contentLanguages);
  const net = Network.useNetworkState();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const catalogHits = useMemo(() => {
    const installed = new Set(archives.map((a) => a.catalogId ?? a.id));
    const candidates = Object.values(catalog.resources).filter((r) => matchesLanguages(r, langs) && !installed.has(r.id));
    return searchCatalog(candidates, query, i18n.language === 'es' ? 'es' : 'en');
  }, [archives, langs, query, i18n.language]);
  const [mode, setMode] = useState<SearchMode>('titles');
  const { results, loading: zimLoading } = useZimSearch(ids, query, mode, mode === 'fulltext' ? 8 : 6);
  // Full text also searches inside the archives' PDFs (what the assistant cites).
  const { hits: docHits, loading: docLoading } = useDocSearch(ids, query, mode === 'fulltext');
  const loading = zimLoading || docLoading;

  const sections: Section[] = useMemo(() => {
    const byId = new Map(archives.map((a) => [a.id, a]));
    const articles = results.flatMap((g): Section[] => {
      const item = byId.get(g.itemId);
      return item ? [{ item, data: g.hits }] : [];
    });
    const pdfs = new Map<string, Section>();
    for (const h of docHits) {
      const item = byId.get(h.itemId);
      if (!item) continue;
      const section = pdfs.get(h.itemId) ?? { item, data: [], pdf: true };
      pdfs.set(h.itemId, section);
      // A PDF's own title is often a file name: the readable one, and the page the passage is on.
      const title = readableDocTitle(h.title, item.title);
      section.data.push({ itemId: h.itemId, path: h.path, title: t('pdfPage', { title, page: h.page }), snippet: h.text, docTitle: title });
    }
    // Each archive's PDFs right after its articles.
    const order = new Map(ids.map((id, i) => [id, i]));
    return [...articles, ...pdfs.values()].sort((a, b) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0) || Number(!!a.pdf) - Number(!!b.pdf));
  }, [results, docHits, archives, ids, t]);

  const open = (hit: ZimSearchHit) => {
    rememberSearch(query);
    router.push({
      pathname: '/reader/[itemId]',
      params: hit.docTitle ? { itemId: hit.itemId, path: hit.path, title: hit.docTitle } : { itemId: hit.itemId, path: hit.path },
    });
  };

  const q = query.trim();
  const empty =
    loading && archives.length ? (
      <ActivityIndicator style={{ marginTop: space.xxxl }} color={colors.textSecondary} />
    ) : q ? (
      catalogHits.length ? (
        <Text variant="callout" color="textSecondary" style={styles.notInBooks}>
          {archives.length ? t('notInBooks') : t('noArchivesYet')}
        </Text>
      ) : (
        <EmptyState icon={SearchX} title={t('noResults')} body={t('noResultsBody')} />
      )
    ) : !archives.length ? (
      <EmptyState icon={Library} title={t('noArchives')} body={t('noArchivesBody')} />
    ) : (
      <EmptyState icon={SearchIcon} title={t('typeToSearch')} body={t('typeToSearchBody')} />
    );

  const footer = q ? (
    <View style={styles.footer}>
      {catalogHits.length ? (
        <>
          <Text variant="overline" color="text" style={styles.layer}>
            {t('canDownload')}
          </Text>
          <ListGroup>
            {catalogHits.map((r) => (
              <ResourceRow key={r.id} resource={r} />
            ))}
          </ListGroup>
        </>
      ) : null}
      {online ? (
        <ListGroup style={{ marginTop: space.lg }}>
          <ListRow
            testID="search-kiwix"
            title={t('searchKiwix', { query: q })}
            subtitle={t('searchKiwixBody')}
            leading={<IconBadge icon={Compass} hue="ai" size={36} />}
            chevron
            onPress={() => router.push({ pathname: '/library/explore', params: { q } })}
          />
        </ListGroup>
      ) : null}
    </View>
  ) : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title: t('globalSearch') }} />
      <View style={styles.header}>
        <SearchField autoFocus value={query} onChangeText={setQuery} onClear={() => setQuery('')} placeholder={t('globalPlaceholder')} />
        <Segmented<SearchMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'titles', label: t('titles') },
            { value: 'fulltext', label: t('fullText') },
          ]}
        />
      </View>
      <SectionList<ZimSearchHit, Section>
        sections={sections}
        keyExtractor={(h, i) => `${h.itemId}:${h.path}:${i}`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <ArchiveHeader item={section.item} label={section.pdf ? t('inPdfs') : undefined} />}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              index === 0 && styles.cardTop,
              index === section.data.length - 1 && styles.cardBottom,
            ]}>
            {index > 0 ? <Divider style={{ marginLeft: 46 }} /> : null}
            <HitRow hit={item} onPress={() => open(item)} />
          </View>
        )}
        ListHeaderComponent={
          sections.length && q ? (
            <Text variant="overline" color="text" style={styles.layer}>
              {t('inYourBooks')}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
      />
    </View>
  );
}

function ArchiveHeader({ item, label }: { item: InstalledItem; label?: string }) {
  const { colors } = useTheme();
  const illustration = typeof item.meta.illustration === 'string' ? item.meta.illustration : null;
  return (
    <View style={styles.sectionHeader}>
      {illustration ? (
        <Image source={{ uri: illustration }} style={[styles.illustration, { backgroundColor: colors.surfaceAlt }]} />
      ) : (
        <IconBadge icon={iconByName(undefined)} hue={categoryHue(item.category)} size={24} />
      )}
      <Text variant="overline" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
        {label ? `${item.title} · ${label}` : item.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: space.md, paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.sm },
  list: { ...layout.column, paddingHorizontal: space.gutter, paddingBottom: space.huge },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: space.xs },
  illustration: { width: 24, height: 24, borderRadius: 6 },
  layer: { marginTop: space.xl, marginBottom: space.xs, paddingHorizontal: space.xs },
  footer: { marginTop: space.md },
  notInBooks: { marginTop: space.lg, paddingHorizontal: space.xs },
  card: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  cardBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
