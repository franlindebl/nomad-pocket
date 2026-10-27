// The emergency points' look outside the map: one dot as the map draws it (the
// legend in the Puntos sheet) and a cluster of three for that sheet's map button,
// so the button looks like the dots it explains.
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { CATEGORY_COLORS } from './labels';

export function PointDot({ color, size = 14 }: { color: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2, borderColor: colors.surface }}
    />
  );
}

/** Three category dots; greyed out while the points are hidden. */
export function PointsGlyph({ off }: { off?: boolean }) {
  const { colors } = useTheme();
  const dot = (color: string) => <PointDot color={off ? colors.textTertiary : color} size={11} />;
  return (
    <View style={styles.glyph}>
      {dot(CATEGORY_COLORS.health)}
      <View style={styles.row}>
        {dot(CATEGORY_COLORS.water)}
        {dot(CATEGORY_COLORS.supplies)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { alignItems: 'center' },
  row: { flexDirection: 'row', gap: 1, marginTop: -1 },
});
