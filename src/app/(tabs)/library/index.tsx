import { Construction } from 'lucide-react-native';

import { EmptyState, Screen } from '@/components/ui';

export default function Screen_() {
  return (
    <Screen>
      <EmptyState icon={Construction} title="library" body="Coming soon" />
    </Screen>
  );
}
