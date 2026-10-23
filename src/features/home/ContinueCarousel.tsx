import { router, useFocusEffect } from 'expo-router';
import { BookOpen } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Card, IconBadge, SectionHeader, Text } from '@/components/ui';
import { getItem } from '@/features/content/items';
import { recentHistory, type HistoryEntry } from '@/features/library/history';
import { formatRelativeDate } from '@/lib/format';
import { space } from '@/theme';

/** "Continue" row on Home: the last pages read across all archives. */
export function ContinueCarousel() {
  const { t } = useTranslation('home');
  const [entries, setEntries] = useState<(HistoryEntry & { source: string })[]>([]);

  useFocusEffect(
    useCallback(() => {
      const seen = new Set<string>();
      const list = recentHistory(30)
        .filter((h) => {
          if (seen.has(h.itemId)) return false;
          seen.add(h.itemId);
          return true;
        })
        .slice(0, 6)
        .map((h) => ({ ...h, source: getItem(h.itemId)?.title ?? '' }))
        .filter((h) => h.source);
      setEntries(list);
    }, []),
  );

  if (!entries.length) return null;
  return (
    <>
      <SectionHeader title={t('continue')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroller}>
        {entries.map((e) => (
          <Card
            key={e.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/reader/[itemId]', params: { itemId: e.itemId, path: e.path } })}>
            <IconBadge icon={BookOpen} hue="reference" size={36} />
            <Text variant="headline" numberOfLines={2}>
              {e.title}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {e.source} · {formatRelativeDate(e.visitedAt)}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroller: { marginHorizontal: -space.gutter },
  row: { paddingHorizontal: space.gutter, gap: space.md },
  card: { width: 220, gap: space.sm },
});
