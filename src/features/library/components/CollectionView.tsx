// Native list for nautilus document collections (zimgit-*: medicine, water, knots…), shown by
// the reader instead of their desktop web page: search, title, author and description.
import { ChevronDown, ChevronRight, File, FileText, Film, Image as ImageIcon, Music, SearchX, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

import { EmptyState, IconBadge, PressableScale, SearchField, Text } from '@/components/ui';
import { layout, radius, space, useTheme, type Hue } from '@/theme';

import { fileKind, fileLabel, filterCollection, type CollectionDoc, type FileKind } from '../collection';

const KIND_ICONS: Record<FileKind, LucideIcon> = { pdf: FileText, video: Film, audio: Music, image: ImageIcon, other: File };

export function CollectionView({ docs, hue, onOpen }: { docs: CollectionDoc[]; hue: Hue; onOpen: (path: string, title: string) => void }) {
  const { t } = useTranslation('reader');
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterCollection(docs, query), [docs, query]);

  return (
    <FlatList
      data={shown}
      keyExtractor={(d) => d.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.md }}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder={t('collectionSearch', { count: docs.length })}
            returnKeyType="search"
          />
        </View>
      }
      ListEmptyComponent={<EmptyState icon={SearchX} title={t('noResults')} body={t('noResultsBody')} />}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
      renderItem={({ item }) => <DocRow doc={item} hue={hue} onOpen={onOpen} />}
    />
  );
}

function DocRow({ doc, hue, onOpen }: { doc: CollectionDoc; hue: Hue; onOpen: (path: string, title: string) => void }) {
  const { t } = useTranslation('reader');
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const multiple = doc.files.length > 1;
  const kind = fileKind(doc.files[0]);
  const Chevron = multiple && expanded ? ChevronDown : ChevronRight;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <PressableScale
        onPress={() => (multiple ? setExpanded(!expanded) : onOpen(doc.files[0], doc.title))}
        pressedScale={0.99}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={[
          doc.title,
          doc.author,
          multiple ? t('collectionFiles', { count: doc.files.length }) : kind === 'pdf' ? 'PDF' : '',
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityState={multiple ? { expanded } : undefined}>
        <IconBadge icon={KIND_ICONS[kind]} hue={hue} size={40} />
        <View style={styles.body}>
          <Text variant="headline" numberOfLines={2}>
            {doc.title}
          </Text>
          {doc.author ? (
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {doc.author}
            </Text>
          ) : null}
          {doc.description ? (
            <Text variant="footnote" color="textTertiary" numberOfLines={3}>
              {doc.description}
            </Text>
          ) : null}
          {multiple ? (
            <Text variant="caption" color="textTertiary">
              {t('collectionFiles', { count: doc.files.length })}
            </Text>
          ) : null}
        </View>
        <Chevron size={18} color={colors.textTertiary} />
      </PressableScale>
      {multiple && expanded
        ? doc.files.map((f) => {
            const Icon = KIND_ICONS[fileKind(f)];
            return (
              <PressableScale
                key={f}
                onPress={() => onOpen(f, doc.title)}
                pressedScale={0.99}
                style={[styles.file, { borderTopColor: colors.border }]}
                accessibilityRole="button">
                <Icon size={18} color={colors.textSecondary} />
                <Text variant="callout" numberOfLines={1} style={{ flex: 1 }}>
                  {fileLabel(f)}
                </Text>
              </PressableScale>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { ...layout.column, paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  body: { flex: 1, gap: 2 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginLeft: 40 + space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
