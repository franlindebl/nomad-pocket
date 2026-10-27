// The countries of the Downloads sheet whose files are in and that are still being prepared
// (search index, imports, emergency points: prepare.ts), laid out like its download rows.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ListGroup, ProgressBar, Text } from '@/components/ui';
import { space } from '@/theme';

import type { CountryState } from './countries';

export function PreparingCountries({ countries, style }: { countries: CountryState[]; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  if (!countries.length) return null;
  return (
    <ListGroup style={style}>
      {countries.map((c) => (
        <View key={c.regionId} style={styles.row} testID="download-preparing">
          <Text variant="headline" numberOfLines={1}>
            {c.title}
          </Text>
          <ProgressBar value={c.preparing ?? 0} />
          <Text variant="caption" color="textSecondary" tabular>
            {t('downloads.preparing', { pct: Math.floor((c.preparing ?? 0) * 100) })}
          </Text>
        </View>
      ))}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, padding: space.lg },
});
