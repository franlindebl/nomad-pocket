// Speed while navigating by car or bike, bottom left over the map like Google Maps': the GPS speed,
// red when over the limit, and by car the posted limit of the stretch the user is on as a round sign
// above it (from the route's limits, routing-core's speedLimitAt). No sign where OpenStreetMap
// doesn't give one; no speed on foot (it wanders at walking pace and says little). Going over the
// limit blinks it a few seconds as the beep plays (voice.ts).
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { measurementSystem } from '@/lib/format';
import { scaleSpeed, scaleSpeedLimit } from '@/lib/units';
import { radius, space, useTheme } from '@/theme';

import { useGuidance } from './guidance';
import { speedLimitAt } from './routing-core';
import { useSpeedWarning } from './voice';

const SIGN = 52;
/** A blink: dim and back, this many times (about 3 s). */
const BLINK_MS = 350;
const BLINKS = 4;

export function SpeedBadge({ bottom }: { bottom: number }) {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const costing = useGuidance((s) => s.costing);
  const speed = useGuidance((s) => s.position?.speed ?? null);
  const limitKmh = useGuidance((s) => (s.route && s.progress ? speedLimitAt(s.route.limits, s.progress.segment) : null));
  const warnedAt = useSpeedWarning((s) => s.at);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!warnedAt) return;
    opacity.value = withRepeat(withSequence(withTiming(0.2, { duration: BLINK_MS }), withTiming(1, { duration: BLINK_MS })), BLINKS);
  }, [warnedAt, opacity]);
  const blinking = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // iOS reports -1 without a speed (a stale or rough fix).
  if (costing === 'pedestrian' || speed === null || speed < 0) return null;
  const system = measurementSystem();
  const now = scaleSpeed(speed, system);
  const limit = costing === 'auto' && limitKmh !== null ? scaleSpeedLimit(limitKmh, system) : null;
  const over = limit !== null && now.value > limit;
  const label = [t('speed.now', { value: now.value, unit: now.unit }), limit !== null ? t('speed.limit', { value: limit, unit: now.unit }) : null]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none" accessible accessibilityLabel={label} testID="nav-speed">
      {limit !== null ? (
        <View testID="nav-speed-limit" style={[styles.sign, { backgroundColor: colors.signFace, borderColor: colors.signRing }]}>
          <Text variant="title3" weight="800" tabular color="signText">
            {limit}
          </Text>
        </View>
      ) : null}
      <Animated.View
        style={[
          styles.speed,
          { backgroundColor: over ? colors.dangerSoft : colors.surface, borderColor: over ? colors.danger : colors.border, shadowColor: colors.shadow },
          blinking,
        ]}>
        <Text variant="title2" tabular color={over ? 'danger' : 'text'}>
          {now.value}
        </Text>
        <Text variant="caption" color={over ? 'danger' : 'textSecondary'}>
          {now.unit}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, alignItems: 'center', gap: space.sm },
  sign: { width: SIGN, height: SIGN, borderRadius: SIGN / 2, borderWidth: 6, alignItems: 'center', justifyContent: 'center' },
  speed: {
    minWidth: 64,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
