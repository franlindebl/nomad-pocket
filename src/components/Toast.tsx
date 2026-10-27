import * as Haptics from 'expo-haptics';
import { CheckCircle2 } from 'lucide-react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import Animated, { FadeOutUp, withSpring, type EntryAnimationsValues } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Text } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

type Toast = { id: number; message: string };

const useToasts = create<{ current: Toast | null; show: (m: string) => void; hide: () => void }>((set) => ({
  current: null,
  show: (message) => set({ current: { id: Date.now(), message } }),
  hide: () => set({ current: null }),
}));

export function showToast(message: string, haptic = true) {
  if (haptic) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  useToasts.getState().show(message);
  // The pill's live region only speaks on Android: VoiceOver needs an explicit announcement.
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

// Slides down from just above the screen and bounces, fully opaque the whole time:
// FadeInUp.springify() springs the opacity too, so the pill flickered translucent as it bounced.
function enterFromTop(values: EntryAnimationsValues) {
  'worklet';
  return {
    initialValues: { transform: [{ translateY: -(values.targetOriginY + values.targetHeight) }] },
    animations: { transform: [{ translateY: withSpring(0, { damping: 18 }) }] },
  };
}

/** Floating confirmation pill at the top of the screen. Mount once at the root. */
export function ToastHost() {
  const toast = useToasts((s) => s.current);
  const hide = useToasts((s) => s.hide);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hide, 3200);
    return () => clearTimeout(timer);
  }, [toast, hide]);

  if (!toast) return null;
  return (
    <Animated.View
      key={toast.id}
      entering={enterFromTop}
      exiting={FadeOutUp.duration(200)}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { top: insets.top + space.sm, backgroundColor: colors.ink, shadowColor: colors.shadow }]}>
      <CheckCircle2 size={18} color={colors.accent} />
      <Text variant="footnote" weight="600" color="onInk" numberOfLines={2} style={{ flexShrink: 1 }}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 420,
    marginHorizontal: space.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
});
