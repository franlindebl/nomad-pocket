import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation('settings');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: t('title') }} />
      <Stack.Screen name="country" options={{ title: t('country') }} />
    </Stack>
  );
}
