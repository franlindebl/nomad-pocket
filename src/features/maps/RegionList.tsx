// The regions of a country downloaded region by region (the USA), for the country sheet and
// the onboarding kit: tick the ones to download (the one the person is in comes ticked:
// useChosenRegions), all of them with the whole-country shortcut, and delete one that is on
// the phone (docs/COUNTRY_REGIONS_PLAN.md).
import { Check, CheckSquare, Square, Trash2 } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Badge, IconButton, ListGroup, ListRow, Text } from '@/components/ui';
import { useItems } from '@/features/content/items';
import { formatBytes } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { installedRegions, regionBytes, removeCountryRegion, useCountries, useRegionChoice, type CountryOffer } from './countries';
import { countryRegionName } from './country-maps';

export function RegionList({ offer, chosen }: { offer: CountryOffer; chosen: string[] | undefined }) {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const installed = useItems('map');
  const { countries } = useCountries();
  const country = countries.find((c) => c.regionId === offer.region.id);
  const onPhone = useMemo(
    () => new Set(installedRegions(offer)),
    // installedRegions reads the items: `installed` stands for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offer, installed],
  );
  const bytes = useMemo(
    () => regionBytes(offer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offer, installed],
  );
  const regions = offer.regions ?? [];
  const choosable = regions.filter((p) => !onPhone.has(p.id)).map((p) => p.id);
  const picked = new Set(chosen ?? []);
  const all = choosable.length > 0 && choosable.every((id) => picked.has(id));
  const choose = (ids: string[]) => useRegionChoice.getState().choose(offer.region.id, ids);
  const toggle = (id: string) => choose(picked.has(id) ? [...picked].filter((x) => x !== id) : [...picked, id]);
  const allBytes = choosable.reduce((sum, id) => sum + (bytes[id] ?? 0), 0);
  const tick = (on: boolean) => (on ? <CheckSquare size={22} color={colors.accent} /> : <Square size={22} color={colors.textTertiary} />);
  const remove = (id: string) => {
    if (!country) return;
    const name = countryRegionName(id);
    Alert.alert(t('regions.deleteTitle', { name: `${offer.title} · ${name}` }), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => void removeCountryRegion(country, id) },
    ]);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" color="textSecondary">
        {t('country.regionsTitle')}
      </Text>
      <Text variant="footnote" color="textSecondary">
        {t('country.regionsBody')}
      </Text>
      <ListGroup>
        {choosable.length > 1 ? (
          <ListRow
            testID="region-all"
            leading={tick(all)}
            title={t('country.allRegions', { name: offer.title })}
            subtitle={formatBytes(allBytes)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: all }}
            onPress={() => choose(all ? [] : choosable)}
          />
        ) : null}
        {regions.map((p) => {
          const here = onPhone.has(p.id);
          const states = t(`parts.${p.id}.states`, { defaultValue: '' });
          return (
            <ListRow
              key={p.id}
              testID={`region-${p.id}`}
              leading={here ? <Check size={22} color={colors.success} /> : tick(picked.has(p.id))}
              title={countryRegionName(p.id)}
              subtitle={[states, here ? null : formatBytes(bytes[p.id] ?? 0)].filter(Boolean).join(' · ')}
              subtitleLines={3}
              accessibilityRole={here ? undefined : 'checkbox'}
              accessibilityState={here ? undefined : { checked: picked.has(p.id) }}
              onPress={here ? undefined : () => toggle(p.id)}
              trailing={here ? <Badge label={t('country.onPhone')} tone="success" /> : undefined}
              trailingAction={
                here ? (
                  <IconButton
                    testID={`region-delete-${p.id}`}
                    icon={Trash2}
                    size={36}
                    variant="plain"
                    color={colors.danger}
                    accessibilityLabel={t('country.removeRegion', { name: countryRegionName(p.id) })}
                    onPress={() => remove(p.id)}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>
      <Text variant="caption" color="textTertiary">
        {t('country.crossRegions')}
      </Text>
    </View>
  );
}
