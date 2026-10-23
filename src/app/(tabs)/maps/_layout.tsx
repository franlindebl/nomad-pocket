import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export default function Layout() {
  const { t } = useTranslation('maps');
  const sheet = { presentation: 'formSheet', sheetGrabberVisible: true, headerShown: true } as const;
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: t('title'), headerShown: false }} />
      <Stack.Screen name="regions" options={{ ...sheet, title: t('regions.title'), sheetAllowedDetents: [0.6, 1] }} />
      <Stack.Screen name="pick" options={{ ...sheet, title: t('picker.title'), sheetAllowedDetents: [1] }} />
      {/* Content-sized sheets draw their own title: a native header overlaps non-scroll-view content. */}
      <Stack.Screen name="download" options={{ ...sheet, headerShown: false, sheetAllowedDetents: 'fitToContents' }} />
      <Stack.Screen name="markers" options={{ ...sheet, title: t('markers.title'), sheetAllowedDetents: [0.5, 1] }} />
      <Stack.Screen name="marker" options={{ ...sheet, headerShown: false, sheetAllowedDetents: 'fitToContents' }} />
    </Stack>
  );
}
