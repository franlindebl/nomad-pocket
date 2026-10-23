import { useLocalSearchParams } from 'expo-router';
import { BookOpen } from 'lucide-react-native';

import { EmptyState, Screen } from '@/components/ui';

export default function ReaderScreen() {
  const { itemId, path } = useLocalSearchParams<{ itemId: string; path?: string }>();
  return (
    <Screen>
      <EmptyState icon={BookOpen} title={itemId} body={path} />
    </Screen>
  );
}
