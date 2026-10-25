import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui';
import { useTheme } from '@/theme';

const SIZE = 46;

/** Floating round map control: surface fill + the soft floating shadow. */
export function MapFab({
  icon: Icon,
  onPress,
  accessibilityLabel,
  active,
  children,
  style,
  testID,
}: {
  icon?: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      haptic="selection"
      pressedScale={0.92}
      style={[styles.fab, { backgroundColor: colors.surface, shadowColor: colors.shadow, borderColor: colors.border }, style]}>
      {children ?? (Icon ? <Icon size={21} color={active ? colors.accent : colors.text} strokeWidth={2} /> : null)}
    </PressableScale>
  );
}

/** Vertical group of controls sharing one pill background. */
export function MapFabGroup({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.group, { backgroundColor: colors.surface, shadowColor: colors.shadow, borderColor: colors.border }]}>{children}</View>;
}

const styles = StyleSheet.create({
  fab: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  group: {
    borderRadius: SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
