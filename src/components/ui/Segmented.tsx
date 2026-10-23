import { StyleSheet, Switch as RNSwitch, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, useTheme } from '@/theme';

import { PressableScale } from './Pressable';
import { Text } from './Text';

type Option<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceAlt }, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            haptic="selection"
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              selected && { backgroundColor: scheme === 'dark' ? colors.surfacePressed : colors.surface, shadowColor: colors.shadow },
              selected && styles.selectedShadow,
            ]}>
            <Text variant="footnote" weight="600" color={selected ? 'text' : 'textSecondary'} numberOfLines={1}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export function Switch({ value, onValueChange, accessibilityLabel }: { value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ true: colors.accent, false: colors.surfacePressed }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={colors.surfacePressed}
    />
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, borderRadius: radius.md, borderCurve: 'continuous' },
  segment: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderCurve: 'continuous' },
  selectedShadow: { shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
