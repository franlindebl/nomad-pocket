import { ListTree } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Divider, EmptyState, PressableScale, Text } from '@/components/ui';
import { space } from '@/theme';

import type { Heading } from '../html';
import { getHeadings } from '../zim';

import { Sheet } from './Sheet';

/** Table of contents of the page being read; tapping a section jumps to its anchor. */
export function ReaderTocSheet({
  visible,
  itemId,
  path,
  title,
  onClose,
  onOpen,
}: {
  visible: boolean;
  itemId: string;
  path: string | null;
  title: string;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation('reader');
  const { t: tc } = useTranslation();
  const [headings, setHeadings] = useState<Heading[] | null>(null);
  // A new page (or reopening) shows the spinner until its headings arrive.
  const pageKey = `${visible}\u0000${itemId}\u0000${path}`;
  const [shownKey, setShownKey] = useState(pageKey);
  if (pageKey !== shownKey) {
    setShownKey(pageKey);
    setHeadings(null);
  }

  useEffect(() => {
    if (!visible || !path) return;
    let alive = true;
    getHeadings(itemId, path.split('#')[0])
      .then((h) => alive && setHeadings(h))
      .catch(() => alive && setHeadings([]));
    return () => {
      alive = false;
    };
  }, [visible, itemId, path]);

  const base = (path ?? '').split('#')[0];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="title3">{t('toc')}</Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
          <Text variant="callout" weight="600">
            {tc('actions.done')}
          </Text>
        </Pressable>
      </View>
      {headings === null ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} />
      ) : (
        <FlatList
          data={headings}
          keyExtractor={(h) => h.id}
          ItemSeparatorComponent={() => <Divider style={{ marginLeft: space.gutter }} />}
          renderItem={({ item }) => (
            <PressableScale pressedScale={0.99} onPress={() => onOpen(`${base}#${item.id}`)} style={[styles.row, item.level === 3 && styles.sub]}>
              <Text variant={item.level === 2 ? 'headline' : 'callout'} color={item.level === 2 ? 'text' : 'textSecondary'} numberOfLines={2}>
                {item.title}
              </Text>
            </PressableScale>
          )}
          ListEmptyComponent={<EmptyState icon={ListTree} title={t('tocEmpty')} body={t('tocEmptyBody')} />}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.gutter, paddingTop: space.lg, paddingBottom: space.md },
  row: { paddingHorizontal: space.gutter, paddingVertical: 14 },
  sub: { paddingLeft: space.gutter + space.lg },
});
