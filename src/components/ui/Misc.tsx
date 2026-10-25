import type { LucideIcon } from 'lucide-react-native';
import { Search, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { fontFamily, radius, space, typography, useTheme, type Hue } from '@/theme';

import { Button } from './Button';
import { IconBadge } from './IconBadge';
import { PressableScale } from './Pressable';
import { Text } from './Text';

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text variant="overline" color="textSecondary">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text variant="footnote" color="accent" weight="600">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      haptic="selection"
      style={[styles.chip, { backgroundColor: selected ? colors.ink : colors.surfaceAlt }]}>
      {Icon ? <Icon size={14} color={selected ? colors.onInk : colors.text} strokeWidth={2.2} /> : null}
      <Text variant="footnote" weight="600" color={selected ? 'onInk' : 'text'}>
        {label}
      </Text>
    </PressableScale>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function Badge({ label, tone = 'neutral', icon: Icon }: { label: string; tone?: BadgeTone; icon?: LucideIcon }) {
  const { colors } = useTheme();
  const map = {
    neutral: { bg: colors.surfaceAlt, fg: colors.textSecondary },
    accent: { bg: colors.accentSoft, fg: colors.accent },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      {Icon ? <Icon size={12} color={map.fg} strokeWidth={2.5} /> : null}
      <Text variant="caption" weight="600" tint={map.fg}>
        {label}
      </Text>
    </View>
  );
}

export function SearchField({ style, onClear, value, ...rest }: TextInputProps & { onClear?: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: colors.surfaceAlt }, style]}>
      <Search size={18} color={colors.textTertiary} />
      <TextInput
        {...rest}
        value={value}
        placeholderTextColor={colors.textTertiary}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="never"
        style={[styles.searchInput, { color: colors.text, fontFamily }]}
      />
      {value && onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel={t('actions.clear')}>
          <X size={16} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon,
  hue = 'neutral',
  title,
  body,
  action,
  onAction,
  style,
}: {
  icon: LucideIcon;
  hue?: Hue;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <IconBadge icon={icon} hue={hue} size={64} />
      <Text variant="title3" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }, style]} />;
}

export function Row({ children, gap = space.sm, style, align = 'center' }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xxl,
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
  },
  searchInput: { flex: 1, fontSize: typography.body.fontSize, paddingVertical: 0 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.huge, paddingHorizontal: space.xxl },
});
