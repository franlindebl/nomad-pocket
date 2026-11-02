import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { chamfer, displayFamily, space, useTheme, type ColorToken } from '@/theme';

import { PressableScale } from './Pressable';
import { ChamferFill } from './Shapes';
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
  sm: { height: 34, px: space.md, icon: 16, font: 12, cut: chamfer.sm },
  md: { height: 44, px: space.lg, icon: 18, font: 14, cut: chamfer.md },
  lg: { height: 54, px: space.xl, icon: 20, font: 15, cut: chamfer.md },
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
  // Primary (and accent, its alias) is the signal-yellow block with a cut corner; the rest are square.
  const looks: Record<ButtonVariant, { bg: string; fg: ColorToken; cut?: boolean; border?: string }> = {
    primary: { bg: colors.accent, fg: 'onAccent', cut: true },
    accent: { bg: colors.accent, fg: 'onAccent', cut: true },
    secondary: { bg: colors.surfaceAlt, fg: 'text', border: colors.outline },
    ghost: { bg: 'transparent', fg: 'text' },
    danger: { bg: colors.dangerSoft, fg: 'danger' },
  };
  const { bg, fg, cut, border } = looks[variant];
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
        { backgroundColor: cut ? 'transparent' : bg, height: s.height, paddingHorizontal: s.px },
        border && { borderWidth: 1, borderColor: border },
        fullWidth && styles.full,
        style,
      ]}>
      {cut ? <ChamferFill color={bg} cut={s.cut} /> : null}
      {loading ? (
        <ActivityIndicator color={fgColor} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={s.icon} color={fgColor} strokeWidth={2.2} /> : null}
          <Text variant="headline" color={fg} numberOfLines={1} style={[styles.label, { fontSize: s.font, lineHeight: s.font + 4 }]}>
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
  const bg = variant === 'filled' ? colors.surface : variant === 'ink' ? colors.ink : 'transparent';
  const fg = color ?? (variant === 'ink' ? colors.onInk : colors.text);
  const outline = variant === 'filled' ? { borderWidth: 1, borderColor: colors.outline } : null;
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
      style={[{ width: size, height: size, backgroundColor: bg }, outline, styles.center, style]}>
      <Icon size={Math.round(size * 0.48)} color={fg} strokeWidth={2} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: displayFamily, fontWeight: '600', letterSpacing: 0.9, textTransform: 'uppercase' },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  center: { alignItems: 'center', justifyContent: 'center' },
});
