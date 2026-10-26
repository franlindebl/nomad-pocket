import { router } from 'expo-router';

import { Screen } from '@/components/ui';
import { useInstalledCountryIds } from '@/features/maps/countries';
import { CountryList } from '@/features/maps/CountryList';
import { space } from '@/theme';

// A plain scroll view (Screen) rather than a SectionList: inside a formSheet the
// virtualized list did not get a height. ~240 short rows render fine.
export default function CountryPicker() {
  const installed = useInstalledCountryIds();
  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <CountryList installed={installed} onPick={(regionId) => router.push({ pathname: '/maps/download', params: { regionId, from: 'pick' } })} />
    </Screen>
  );
}
