import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { space, useTheme } from '@/theme';

import { PressableScale } from './Pressable';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  titleLines?: number;
  subtitleLines?: number;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  destructive,
  style,
  titleLines = 1,
  subtitleLines = 2,
}: Props) {
  const { colors } = useTheme();
  const content = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        <Text variant="headline" color={destructive ? 'danger' : 'text'} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <ChevronRight size={18} color={colors.textTertiary} /> : null}
    </>
  );
  if (!onPress && !onLongPress) return <View style={[styles.row, style]}>{content}</View>;
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} onLongPress={onLongPress} pressedScale={0.99} style={[styles.row, style]}>
      {content}
    </PressableScale>
  );
}

/** Groups rows into an inset card with hairline separators. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: colors.surface, borderColor: scheme === 'light' ? colors.border : 'transparent' },
        style,
      ]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  },
  leading: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end', justifyContent: 'center' },
  group: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
