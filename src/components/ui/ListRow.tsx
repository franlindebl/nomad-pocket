import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';

import { space, useTheme } from '@/theme';

import { PressableScale } from './Pressable';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Interactive control at the end (e.g. a delete button). Rendered beside the row's
   *  button, not inside it, so VoiceOver (and UI tests) can reach both. */
  trailingAction?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  titleLines?: number;
  subtitleLines?: number;
  testID?: string;
  /** E.g. 'checkbox' + { checked } for a row that toggles. */
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  /** What activating the row does, when the title doesn't say it (e.g. a row that deletes). */
  accessibilityHint?: string;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  trailingAction,
  chevron,
  onPress,
  onLongPress,
  destructive,
  style,
  titleLines = 1,
  subtitleLines = 2,
  testID,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityHint,
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
  const action = trailingAction ? <View style={styles.trailing}>{trailingAction}</View> : null;
  if (!onPress && !onLongPress) {
    return (
      <View testID={testID} style={[styles.row, style]}>
        {content}
        {action}
      </View>
    );
  }
  const button = (
    <PressableScale
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      pressedScale={0.99}
      style={action ? [styles.row, styles.rowWithAction] : [styles.row, style]}>
      {content}
    </PressableScale>
  );
  if (!action) return button;
  return (
    <View style={[styles.actionRow, style]}>
      {button}
      {action}
    </View>
  );
}

/** Groups rows into an inset card with hairline separators. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View
      style={[styles.group, { backgroundColor: colors.surface, borderColor: scheme === 'light' ? colors.border : 'transparent' }, style]}>
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
  rowWithAction: { flex: 1, paddingRight: 0 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: space.lg },
  group: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
