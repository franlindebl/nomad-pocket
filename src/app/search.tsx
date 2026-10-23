import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { Library, Search as SearchIcon, SearchX } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';

import { Divider, EmptyState, IconBadge, Segmented, SearchField, Text } from '@/components/ui';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { useItems, type InstalledItem } from '@/features/content/items';
import { HitRow } from '@/features/library/components/HitRow';
import { useZimSearch, type SearchMode } from '@/features/library/useZimSearch';
import type { ZimSearchHit } from '@/features/library/zim';
import { radius, space, useTheme } from '@/theme';

type Section = { item: InstalledItem; data: ZimSearchHit[] };

export default function GlobalSearchScreen() {
  const { t } = useTranslation('reader');
  const { colors, scheme } = useTheme();
  const archives = useItems('zim');
  const ids = useMemo(() => archives.map((a) => a.id), [archives]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('titles');
  const { results, loading } = useZimSearch(ids, query, mode, mode === 'fulltext' ? 8 : 6);

  const sections: Section[] = useMemo(() => {
    const byId = new Map(archives.map((a) => [a.id, a]));
    return results.flatMap((g) => {
      const item = byId.get(g.itemId);
      return item ? [{ item, data: g.hits }] : [];
    });
  }, [results, archives]);

  const open = (hit: ZimSearchHit) => router.push({ pathname: '/reader/[itemId]', params: { itemId: hit.itemId, path: hit.path } });

  const empty = !archives.length ? (
    <EmptyState icon={Library} title={t('noArchives')} body={t('noArchivesBody')} />
  ) : loading ? (
    <ActivityIndicator style={{ marginTop: space.xxxl }} color={colors.textSecondary} />
  ) : query.trim() ? (
    <EmptyState icon={SearchX} title={t('noResults')} body={t('noResultsBody')} />
  ) : (
    <EmptyState icon={SearchIcon} title={t('typeToSearch')} body={t('typeToSearchBody')} />
  );

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
        keyExtractor={(h) => `${h.itemId}:${h.path}`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <ArchiveHeader item={section.item} />}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: scheme === 'light' ? colors.border : 'transparent' },
              index === 0 && styles.cardTop,
              index === section.data.length - 1 && styles.cardBottom,
            ]}>
            {index > 0 ? <Divider style={{ marginLeft: 46 }} /> : null}
            <HitRow hit={item} onPress={() => open(item)} />
          </View>
        )}
        ListEmptyComponent={empty}
      />
    </View>
  );
}

function ArchiveHeader({ item }: { item: InstalledItem }) {
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
        {item.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: space.md, paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.sm },
  list: { paddingHorizontal: space.gutter, paddingBottom: space.huge },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: space.xs },
  illustration: { width: 24, height: 24, borderRadius: 6 },
  card: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  cardBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
