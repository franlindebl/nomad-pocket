import '@/i18n';

import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ToastHost } from '@/components/Toast';
import { bootstrap } from '@/features/bootstrap';
import { useSettings } from '@/stores/settings';
import { fontFamily, palette, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    bootstrap().finally(() => {
      SplashScreen.hideAsync();
      if (!useSettings.getState().onboarded) router.push('/onboarding');
    });
  }, []);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border, primary: colors.accent },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette[scheme].bg }}>
      <ThemeProvider value={navTheme}>
        <Stack
          screenOptions={{
            headerTitleStyle: { fontFamily, fontWeight: '600' },
            headerLargeTitleStyle: { fontFamily, fontWeight: '800' },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.bg },
            contentStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="downloads"
            options={{ title: t('downloads.title'), presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }}
          />
          <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
        </Stack>
        <ToastHost />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
