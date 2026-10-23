import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { largeTitle, useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={largeTitle(t('tabs.library'))} />
    </Stack>
  );
}
