// The assistant's empty screen: four suggested questions (suggestions.ts) that change one at a time, fading out
// and in, so the screen shows what the assistant answers well. Still with Reduce Motion or VoiceOver on (text
// that changes under the reader is hard to follow), and while the tab isn't on screen.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale, Text } from '@/components/ui';
import { getGuideCard } from '@/features/guide/guide';
import { motion, radius, space, useTheme } from '@/theme';

import { availableSuggestions, rotate, shuffled, startRotation } from '../suggestions';

const SLOTS = 4;
/** A card changes every 4 s, so each one stays ~16 s: time to read it. */
const EVERY_MS = 4000;
/** Top left, bottom right, top right, bottom left. */
const SLOT_ORDER = [0, 3, 1, 2];

/** Remount it (a `key`) when `modelReady` changes: its pool is fixed for its life. */
export function Suggestions({ modelReady, onPick }: { modelReady: boolean; onPick: (question: string) => void }) {
  const { t } = useTranslation('assistant');
  const reduceMotion = useReducedMotion();
  const [screenReader, setScreenReader] = useState(false);
  // Shuffled once per mount: a new chat starts with other questions.
  const [pool] = useState(() => shuffled(availableSuggestions((id) => !!getGuideCard(id), modelReady)).map((s) => s.key));
  const [rotation, setRotation] = useState(() => startRotation(pool, SLOTS));

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader, () => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);

  const rotates = !reduceMotion && !screenReader && pool.length > SLOTS;
  useFocusEffect(
    useCallback(() => {
      if (!rotates) return;
      const timer = setInterval(() => setRotation((r) => rotate(r, pool, SLOT_ORDER)), EVERY_MS);
      return () => clearInterval(timer);
    }, [rotates, pool]),
  );

  if (!pool.length) return null;
  return (
    <View style={styles.grid}>
      {rotation.shown.map((key, slot) => (
        <Slot key={slot} slot={slot} text={t(`suggestions.${key}`)} onPick={onPick} />
      ))}
    </View>
  );
}

/** One card: when its question changes, the old one fades out, then the new one fades in rising a little. */
function Slot({ slot, text, onPick }: { slot: number; text: string; onPick: (question: string) => void }) {
  const { colors } = useTheme();
  const [label, setLabel] = useState(text);
  const shown = useSharedValue(1);

  useEffect(() => {
    if (text === label) return;
    shown.set(
      withTiming(0, { duration: motion.state, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(setLabel, text);
      }),
    );
  }, [text, label, shown]);

  useEffect(() => {
    shown.set(withTiming(1, { duration: motion.screen, easing: Easing.out(Easing.cubic) }));
  }, [label, shown]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: (1 - shown.get()) * 6 }] }));

  return (
    <PressableScale
      haptic="light"
      accessibilityRole="button"
      testID={`assistant-suggestion-${slot}`}
      onPress={() => onPick(label)}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Animated.View style={fade}>
        <Text variant="callout" numberOfLines={3}>
          {label}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    // Three lines of callout: a new question never changes the grid's height.
    minHeight: 88,
    padding: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
});
