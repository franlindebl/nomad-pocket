import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation('prepare');
  // Scrollable sheets (forms with the keyboard up); each sets its own title.
  const sheet = { presentation: 'formSheet' as const, sheetGrabberVisible: true, headerShown: true, sheetAllowedDetents: [1] };
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="prepare/index" options={{ title: t('title') }} />
      <Stack.Screen name="prepare/plan" options={{ title: t('plan.title') }} />
      <Stack.Screen name="prepare/kit" options={{ title: t('kit.title') }} />
      <Stack.Screen name="prepare/entry" options={sheet} />
      <Stack.Screen name="prepare/meeting" options={sheet} />
      <Stack.Screen name="prepare/item" options={sheet} />
    </Stack>
  );
}
