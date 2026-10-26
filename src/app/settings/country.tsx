import { router } from 'expo-router';

import { Screen } from '@/components/ui';
import { CountryList } from '@/features/maps/CountryList';
import { useSettings } from '@/stores/settings';
import { space } from '@/theme';

/** The user's country: what Home offers to download and the emergency number it shows. */
export default function CountrySetting() {
  const country = useSettings((s) => s.country);
  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <CountryList
        selected={country}
        onPick={(id) => {
          useSettings.getState().setCountry(id);
          router.back();
        }}
      />
    </Screen>
  );
}
