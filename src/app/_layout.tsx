import '@/i18n';

import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useNavigationContainerRef, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AlertTriangle } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setNavigatorReadyCheck, whenNavigatorReady } from '@/components/navigation';
import { ToastHost } from '@/components/Toast';
import { EmptyState } from '@/components/ui';
import { bootstrap } from '@/features/bootstrap';
import { useSettings } from '@/stores/settings';
import { fontFamily, palette, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

/** A render error anywhere (a malformed deep link, a bug) shows this instead of closing the app. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
      <EmptyState
        icon={AlertTriangle}
        hue="medicine"
        title={t('errors.generic')}
        body={t('errors.screenFailed')}
        action={t('actions.retry')}
        onAction={() => void retry()}
      />
    </View>
  );
}

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    setNavigatorReadyCheck(() => navigation.isReady());
    bootstrap().finally(() => {
      SplashScreen.hideAsync();
      // Settings hydrate asynchronously from SQLite: wait before deciding.
      const decide = () => {
        if (!useSettings.getState().onboarded) whenNavigatorReady(() => router.push('/onboarding'));
      };
      if (useSettings.persist.hasHydrated()) decide();
      else useSettings.persist.onFinishHydration(decide);
    });
  }, [navigation]);

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
          <Stack.Screen name="reader/[itemId]" options={{ title: '' }} />
          <Stack.Screen name="search" options={{ title: t('reader:globalSearch') }} />
        </Stack>
        <ToastHost />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
