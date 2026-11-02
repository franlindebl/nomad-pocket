import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { space, useTheme } from '@/theme';

import { PressableScale } from './Pressable';
import { CornerTicks } from './Shapes';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Background override (e.g. a tinted hero card). A filled card draws no outline or corner marks. */
  background?: string;
  /** Corner marks over the outline (on by default). */
  ticks?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** Square panel: surface, 1 px outline and the corner marks. */
export function Card({ children, onPress, onLongPress, style, padded = true, background, ticks = true, accessibilityLabel, testID }: Props) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: background ?? colors.surface, borderColor: background ?? colors.border },
    padded && styles.padded,
    style,
  ];
  const marks = ticks && !background ? <CornerTicks /> : null;
  if (!onPress && !onLongPress) {
    return (
      <View testID={testID} style={base}>
        {children}
        {marks}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={base}>
      {children}
      {marks}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  padded: { padding: space.lg },
});
