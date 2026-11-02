import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { motion, useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

type BarProps = {
  /** 0..1 */
  value: number;
  height?: number;
  color?: string;
  trackColor?: string;
  /** Draw the bar as this many slanted segments (a count out of a few, e.g. the kit's 6 pieces). */
  segments?: number;
  style?: StyleProp<ViewStyle>;
};

/** Flat square bar (signal-yellow fill), or slanted segments for a small count. */
export function ProgressBar({ value, height, color, trackColor, segments, style }: BarProps) {
  const { colors } = useTheme();
  const progress = useSharedValue(clamp(value));
  useEffect(() => {
    progress.value = withTiming(clamp(value), { duration: motion.state });
  }, [value, progress]);
  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const a11y = { accessibilityRole: 'progressbar' as const, accessibilityValue: { min: 0, max: 100, now: Math.round(clamp(value) * 100) } };
  if (segments && segments > 0) {
    const on = Math.round(clamp(value) * segments);
    const h = height ?? 9;
    return (
      <View {...a11y} style={[styles.segments, { height: h, paddingHorizontal: h / 2 }, style]}>
        {Array.from({ length: segments }, (_, i) => (
          <View
            key={i}
            style={[styles.segment, { backgroundColor: i < on ? (color ?? colors.accent) : (trackColor ?? colors.surfacePressed) }]}
          />
        ))}
      </View>
    );
  }
  const h = height ?? 6;
  return (
    <View {...a11y} style={[{ height: h, backgroundColor: trackColor ?? colors.surfacePressed }, styles.track, style]}>
      <Animated.View style={[{ height: h, backgroundColor: color ?? colors.accent }, fill]} />
    </View>
  );
}

type RingProps = {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

export function ProgressRing({ value, size = 44, stroke = 4, color, trackColor, children }: RingProps) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(clamp(value));
  useEffect(() => {
    progress.value = withTiming(clamp(value), { duration: motion.state });
  }, [value, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor ?? colors.surfacePressed} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? colors.accent}
          strokeWidth={stroke}
          strokeLinecap="butt"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
  segments: { flexDirection: 'row', gap: 5, width: '100%' },
  segment: { flex: 1, transform: [{ skewX: '-28deg' }] },
});
