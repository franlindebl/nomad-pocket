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

/**
 * Options for the root screen of a tab. The native large title renders blank
 * inside native tabs on iOS 26, so tab roots draw their own title with
 * `<Screen title=…>` and hide the native header; `title` still names the screen.
 */
export function largeTitle(title: string): NativeStackNavigationOptions {
  return { title, headerShown: false };
}
