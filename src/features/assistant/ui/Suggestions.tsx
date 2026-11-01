// The assistant's empty screen: four suggested questions (suggestions.ts) that appear one after another each time
// the screen comes up, then change one at a time, fading out and in, so the screen shows what the assistant answers
// well. Still with Reduce Motion (no animation at all) or VoiceOver on (text that changes under the reader is hard
// to follow; they still appear), and while the tab isn't on screen.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale, Text } from '@/components/ui';
import { getGuideCard } from '@/features/guide/guide';
import { motion, radius, space, useTheme } from '@/theme';

import { availableSuggestions, rotate, shuffled, startRotation } from '../suggestions';

const SLOTS = 4;
/** The first change 2.5 s after the screen comes up, then one every 2.5 s: each card stays ~10 s. */
const EVERY_MS = 2500;
/** On arrival the cards fill in one after another, this far apart. */
const ENTRY_STAGGER_MS = 110;
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
  // Bumped each time the screen comes up: the cards fill in again.
  const [arrival, setArrival] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!reduceMotion) setArrival((n) => n + 1);
      if (!rotates) return;
      const timer = setInterval(() => setRotation((r) => rotate(r, pool, SLOT_ORDER)), EVERY_MS);
      return () => clearInterval(timer);
    }, [rotates, reduceMotion, pool]),
  );

  if (!pool.length) return null;
  return (
    <View style={styles.grid}>
      {rotation.shown.map((key, slot) => (
        <Slot key={slot} slot={slot} text={t(`suggestions.${key}`)} arrival={arrival} hidden={!reduceMotion} onPick={onPick} />
      ))}
    </View>
  );
}

type SlotProps = {
  slot: number;
  text: string;
  /** Changes when the screen comes up: the question fills in again, after the cards before it. */
  arrival: number;
  /** Starts empty, waiting for its arrival (not with Reduce Motion). */
  hidden: boolean;
  onPick: (question: string) => void;
};

/** One card: when its question changes, the old one fades out, then the new one fades in rising a little. */
function Slot({ slot, text, arrival, hidden, onPick }: SlotProps) {
  const { colors } = useTheme();
  const [label, setLabel] = useState(text);
  const [startsHidden] = useState(hidden);
  const shown = useSharedValue(startsHidden ? 0 : 1);

  useEffect(() => {
    if (!arrival) return;
    shown.set(
      withSequence(
        withTiming(0, { duration: 0 }),
        withDelay(slot * ENTRY_STAGGER_MS, withTiming(1, { duration: motion.screen, easing: Easing.out(Easing.cubic) })),
      ),
    );
  }, [arrival, slot, shown]);

  useEffect(() => {
    if (text === label) return;
    shown.set(
      withTiming(0, { duration: motion.state, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(setLabel, text);
      }),
    );
  }, [text, label, shown]);

  // A new question fades in; the first one waits for its arrival instead.
  const firstLabel = useRef(true);
  useEffect(() => {
    if (firstLabel.current) {
      firstLabel.current = false;
      return;
    }
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
