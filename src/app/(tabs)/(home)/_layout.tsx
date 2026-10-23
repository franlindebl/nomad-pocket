import { Stack } from 'expo-router';

import { useStackOptions } from '@/components/navigation';

export default function Layout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
