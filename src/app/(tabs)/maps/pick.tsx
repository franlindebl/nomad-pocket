import { router } from 'expo-router';
import { Keyboard } from 'react-native';

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
      <CountryList
        installed={installed}
        onPick={(regionId) => {
          // The search field's keyboard otherwise came back over "Tus mapas" later, after an alert closed (Android;
          // some iOS simulators), long after the picker was gone.
          Keyboard.dismiss();
          router.push({ pathname: '/maps/download', params: { regionId, from: 'pick' } });
        }}
      />
    </Screen>
  );
}
