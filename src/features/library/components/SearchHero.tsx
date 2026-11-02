// The Library's main action: a big search block at the top of the tab (owner's decision, 2026-11-02: the
// search had looked like a list filter). It opens the search screen; the line under it says what it
// searches, so it doesn't read as a filter of the list below.
import { Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CornerTicks, PressableScale, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

export function SearchHero({ books, onPress }: { books: number; onPress: () => void }) {
  const { t } = useTranslation('library');
  const { colors } = useTheme();
  const scope = books ? t('searchScope', { count: books }) : t('searchScopeEmpty');
  return (
    <PressableScale
      testID="library-search"
      onPress={onPress}
      pressedScale={0.99}
      accessibilityRole="search"
      accessibilityLabel={`${t('searchTitle')}, ${scope}`}
      style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
      <Search size={24} color={colors.accent} strokeWidth={2.4} />
      <View style={styles.text}>
        <Text variant="headline" style={styles.title}>
          {t('searchTitle')}
        </Text>
        <Text variant="overline" color="textSecondary" numberOfLines={1}>
          {scope}
        </Text>
      </View>
      <CornerTicks color={colors.accent} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, paddingHorizontal: space.lg, paddingVertical: space.lg + 2 },
  text: { flex: 1, gap: space.xs },
  title: { fontSize: 18, lineHeight: 23 },
});
