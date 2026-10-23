import { SearchX, TextSearch } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Divider, EmptyState, PressableScale, SearchField, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { useZimSearch, type SearchMode } from '../useZimSearch';
import { getOpenInfo } from '../zim';

import { HitRow } from './HitRow';
import { Sheet } from './Sheet';

/** Search inside one archive: title suggestions as you type, optional full text. */
export function ArchiveSearchSheet({
  visible,
  itemId,
  title,
  onClose,
  onOpen,
}: {
  visible: boolean;
  itemId: string;
  title: string;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation('reader');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('titles');
  const { results, loading } = useZimSearch(visible ? [itemId] : [], query, mode, 30);
  const hits = results[0]?.hits ?? [];
  const hasFullText = getOpenInfo(itemId)?.hasFulltextIndex ?? false;

  const close = () => {
    setMode('titles');
    onClose();
  };

  const onChange = (q: string) => {
    setQuery(q);
    if (mode === 'fulltext' && !q.trim()) setMode('titles');
  };

  return (
    <Sheet visible={visible} onClose={close}>
      <View style={styles.header}>
        <SearchField
          style={{ flex: 1 }}
          autoFocus
          value={query}
          onChangeText={onChange}
          onClear={() => onChange('')}
          placeholder={t('searchArchivePlaceholder', { title })}
          onSubmitEditing={() => hasFullText && query.trim() && setMode('fulltext')}
        />
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
          <Text variant="callout" weight="600">
            {tc('actions.cancel')}
          </Text>
        </Pressable>
      </View>
      {query.trim() && hasFullText && mode === 'titles' ? (
        <>
          <PressableScale onPress={() => setMode('fulltext')} style={styles.fullTextRow} pressedScale={0.99} accessibilityRole="button">
            <TextSearch size={18} color={colors.accent} />
            <Text variant="callout" color="accent" weight="600" numberOfLines={1} style={{ flex: 1 }}>
              {t('searchFullText', { query: query.trim() })}
            </Text>
          </PressableScale>
          <Divider style={{ marginLeft: space.lg }} />
        </>
      ) : null}
      {mode === 'fulltext' ? (
        <View style={styles.modeRow}>
          <Text variant="overline" color="textSecondary">
            {t('fullText')}
          </Text>
          <Pressable onPress={() => setMode('titles')} hitSlop={10}>
            <Text variant="footnote" color="accent" weight="600">
              {t('titles')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={hits}
        keyExtractor={(h) => h.path}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={() => <Divider style={{ marginLeft: 46 }} />}
        renderItem={({ item }) => (
          <HitRow
            hit={item}
            onPress={() => {
              onOpen(item.path);
              setQuery('');
              setMode('titles');
            }}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.textSecondary} />
          ) : query.trim() ? (
            <EmptyState icon={SearchX} title={t('noResults')} body={t('noResultsBody')} />
          ) : undefined
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  fullTextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 48 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.sm },
});
