import type { NativeStackNavigationOptions } from 'expo-router';

import { fontFamily, useTheme } from '@/theme';

/** Screen options shared by every stack (tab stacks and root). */
export function useStackOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerTitleStyle: { fontFamily, fontWeight: '600', color: colors.text },
    headerLargeTitleStyle: { color: colors.text },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerTintColor: colors.text,
    headerStyle: { backgroundColor: colors.bg },
    contentStyle: { backgroundColor: colors.bg },
  };
}

let navigatorReady: () => boolean = () => false;

/** The root layout hands over its navigation container's readiness check. */
export function setNavigatorReadyCheck(check: () => boolean) {
  navigatorReady = check;
}

/**
 * Runs `go` once the root navigator can take a push: one made before is dropped (the
 * first-launch wizard sometimes never showed). Gives up waiting after ~5 s and runs anyway.
 */
export function whenNavigatorReady(go: () => void) {
  let tries = 0;
  const attempt = () => {
    if (navigatorReady() || tries++ > 100) go();
    else setTimeout(attempt, 50);
  };
  attempt();
}

/**
 * Options for the root screen of a tab. The native large title renders blank
 * inside native tabs on iOS 26, so tab roots draw their own title with
 * `<Screen title=…>` and hide the native header; `title` still names the screen.
 */
export function largeTitle(title: string): NativeStackNavigationOptions {
  return { title, headerShown: false };
}
