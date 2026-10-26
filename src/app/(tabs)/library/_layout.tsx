import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { largeTitle, useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('library');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={largeTitle(t('tabs.library'))} />
      <Stack.Screen name="category/[slug]" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="wikipedia" options={{ title: tl('wikipedia') }} />
      <Stack.Screen name="explore" options={{ title: tl('explore') }} />
      <Stack.Screen name="courses" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="course/[id]" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen
        name="resource/[id]"
        options={{ title: '', presentation: 'formSheet', sheetAllowedDetents: [0.55, 0.9], sheetGrabberVisible: true, headerShown: false }}
      />
    </Stack>
  );
}
