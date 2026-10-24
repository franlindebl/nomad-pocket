import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, useTheme, type ColorToken } from '@/theme';

import { PressableScale } from './Pressable';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

const SIZES = {
  sm: { height: 34, px: space.md, icon: 16, text: 'footnote' as const },
  md: { height: 44, px: space.lg, icon: 18, text: 'headline' as const },
  lg: { height: 54, px: space.xl, icon: 20, text: 'headline' as const },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  disabled,
  fullWidth,
  style,
  accessibilityLabel,
  testID,
}: Props) {
  const { colors } = useTheme();
  const s = SIZES[size];
  const scheme: Record<ButtonVariant, { bg: string; fg: ColorToken }> = {
    primary: { bg: colors.ink, fg: 'onInk' },
    accent: { bg: colors.accent, fg: 'onAccent' },
    secondary: { bg: colors.surfaceAlt, fg: 'text' },
    ghost: { bg: 'transparent', fg: 'text' },
    danger: { bg: colors.dangerSoft, fg: 'danger' },
  };
  const { bg, fg } = scheme[variant];
  const fgColor = colors[fg];

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      haptic={variant === 'ghost' ? 'selection' : 'light'}
      style={[
        styles.base,
        { backgroundColor: bg, height: s.height, paddingHorizontal: s.px },
        fullWidth && styles.full,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fgColor} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={s.icon} color={fgColor} strokeWidth={2.2} /> : null}
          <Text variant={s.text} color={fg} numberOfLines={1}>
            {title}
          </Text>
          {IconRight ? <IconRight size={s.icon} color={fgColor} strokeWidth={2.2} /> : null}
        </View>
      )}
    </PressableScale>
  );
}

type IconButtonProps = {
  icon: LucideIcon;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  variant?: 'filled' | 'plain' | 'ink';
  color?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
};

export function IconButton({ icon: Icon, onPress, accessibilityLabel, size = 40, variant = 'filled', color, style, disabled, testID }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = variant === 'filled' ? colors.surfaceAlt : variant === 'ink' ? colors.ink : 'transparent';
  const fg = color ?? (variant === 'ink' ? colors.onInk : colors.text);
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      haptic="selection"
      pressedScale={0.92}
      hitSlop={6}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, styles.center, style]}>
      <Icon size={Math.round(size * 0.48)} color={fg} strokeWidth={2} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  center: { alignItems: 'center', justifyContent: 'center' },
});
