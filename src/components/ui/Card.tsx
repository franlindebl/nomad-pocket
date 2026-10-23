import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, useTheme } from '@/theme';

import { PressableScale } from './Pressable';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Background override (e.g. a tinted hero card). */
  background?: string;
  accessibilityLabel?: string;
};

export function Card({ children, onPress, onLongPress, style, padded = true, background, accessibilityLabel }: Props) {
  const { colors, scheme } = useTheme();
  const base = [
    styles.card,
    {
      backgroundColor: background ?? colors.surface,
      borderColor: scheme === 'light' ? colors.border : 'transparent',
    },
    padded && styles.padded,
    style,
  ];
  if (!onPress && !onLongPress) return <View style={base}>{children}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={base}>
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  padded: { padding: space.lg },
});
