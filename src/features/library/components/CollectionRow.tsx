// One collection in the Library's list: its name, what of it is on the phone (titles, or what it takes to
// start it) and a count with slanted segments, "4/18". The row says how much you have; the collection's
// own screen shows it, then what's missing.
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconBadge, PressableScale, ProgressBar, Text } from '@/components/ui';
import { monoFamily, space, useTheme } from '@/theme';

import type { Collection } from '../collections';

/** More segments than this don't fit the row: the bar is drawn whole instead. */
const MAX_SEGMENTS = 24;

export function CollectionRow({ collection, onPress }: { collection: Collection; onPress: () => void }) {
  const { t } = useTranslation('library');
  const { colors } = useTheme();
  const { key, title, icon, hue, members, have, total, emptyHint } = collection;
  const subtitle = members.length
    ? members.length > 3
      ? t('membersMore', { names: members.slice(0, 2).map((m) => m.title).join(', '), count: members.length - 2 })
      : members.map((m) => m.title).join(', ')
    : emptyHint;
  return (
    <PressableScale
      testID={`collection-${key}`}
      onPress={onPress}
      pressedScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${t('countLabel', { have, total })}`}
      style={styles.row}>
      <IconBadge icon={icon} hue={hue} size={40} />
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {total > 0 ? (
          <ProgressBar
            value={have / total}
            segments={total <= MAX_SEGMENTS ? total : undefined}
            gap={2}
            height={4}
            trackColor={colors.outline}
            style={styles.meter}
          />
        ) : null}
      </View>
      {total > 0 ? (
        <Text variant="footnote" tabular style={styles.count}>
          {have}
          <Text variant="footnote" color="faint" style={styles.count}>
            /
          </Text>
          {total}
        </Text>
      ) : null}
      <ChevronRight size={18} color={colors.textTertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 72 },
  body: { flex: 1, gap: 2 },
  meter: { marginTop: space.xs + 2, maxWidth: 200, paddingHorizontal: 0 },
  count: { fontFamily: monoFamily, fontWeight: '500' },
});
