import { router } from 'expo-router';
import { Wand2 } from 'lucide-react-native';

import { EmptyState, Screen } from '@/components/ui';

export default function OnboardingScreen() {
  return (
    <Screen>
      <EmptyState icon={Wand2} title="Onboarding" action="Close" onAction={() => router.back()} />
    </Screen>
  );
}
