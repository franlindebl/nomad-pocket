import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { largeTitle, useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation();
  const { t: ta } = useTranslation('assistant');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: t('tabs.assistant') }} />
      <Stack.Screen name="models" options={largeTitle(ta('models.title'))} />
      <Stack.Screen
        name="conversations"
        options={{
          title: ta('conversations.title'),
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  );
}
