import type { NativeStackNavigationOptions } from 'expo-router';
import { Platform } from 'react-native';

import { fontFamily, useTheme } from '@/theme';

/** Screen options shared by every stack (tab stacks and root). */
export function useStackOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerTitleStyle: { fontFamily, fontWeight: '600', color: colors.text },
    headerLargeTitleStyle: { fontFamily, fontWeight: '800', color: colors.text },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerTintColor: colors.text,
    headerStyle: { backgroundColor: colors.bg },
    contentStyle: { backgroundColor: colors.bg },
  };
}

/** Options for the root screen of a tab: large collapsing title on iOS. */
export function largeTitle(title: string): NativeStackNavigationOptions {
  return {
    title,
    headerLargeTitle: true,
    headerTransparent: Platform.OS === 'ios',
    headerBlurEffect: Platform.OS === 'ios' ? 'systemMaterial' : undefined,
  };
}
