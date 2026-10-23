import * as Haptics from 'expo-haptics';
import { Pressable as RNPressable, type PressableProps as RNPressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

export type HapticKind = 'selection' | 'light' | 'medium' | 'none';

export type PressableScaleProps = Omit<RNPressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Scale applied while pressed. */
  pressedScale?: number;
  haptic?: HapticKind;
};

export function triggerHaptic(kind: HapticKind) {
  if (kind === 'none') return;
  if (kind === 'selection') Haptics.selectionAsync().catch(() => {});
  else Haptics.impactAsync(kind === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Pressable with the standard press feedback: scale 0.98 + slight fade. */
export function PressableScale({ style, pressedScale = 0.98, haptic = 'none', onPressIn, onPressOut, onPress, disabled, ...rest }: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * 0.1,
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * (1 - pressedScale) }],
  }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: motion.press });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: motion.state });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        triggerHaptic(haptic);
        onPress?.(e);
      }}
      style={[style, animatedStyle, disabled && { opacity: 0.45 }]}
    />
  );
}
