import { router } from 'expo-router';
import { Globe, Map as MapIcon, Plus, RefreshCw, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Badge, IconBadge, IconButton, ListGroup, ListRow, ProgressBar, Screen, SectionHeader, Text } from '@/components/ui';
import { removeItem } from '@/features/content/items';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { countryOffer, downloadCountry, planCountry, removeCountry, retryCountry, useCountries, type CountryState } from '@/features/maps/countries';
import { countryRegionName } from '@/features/maps/country-maps';
import { useMapUi } from '@/features/maps/store';
import { useMapItems } from '@/features/maps/useMapSources';
import { formatBytes } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { space, useTheme } from '@/theme';

function dataDate(d: string | null | undefined, lang: string) {
  if (!d || d.length !== 8) return '';
  return new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))).toLocaleDateString(lang, { month: 'short', year: 'numeric' });
}

/** The maps on the phone: one row per country, the bundled world, and older maps that aren't a country. */
export default function MapsSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const { world } = useMapItems();
  const { countries, otherMaps } = useCountries();

  const confirmDelete = (title: string, size: number, onDelete: () => void) =>
    Alert.alert(t('regions.deleteTitle', { name: title }), t('regions.deleteBody', { size: formatBytes(size) }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: onDelete },
    ]);

  const show = (bbox: [number, number, number, number] | undefined) => {
    if (bbox) useMapUi.getState().focus({ bounds: bbox });
    router.back();
  };

  const retry = (c: CountryState) => {
    const offer = countryOffer(c.regionId);
    if (!offer) return;
    // A prebuilt map resumes from the parts on disk; an on-device extraction needs its estimate again.
    if (!offer.regions && !offer.map && !c.map) {
      router.push({ pathname: '/maps/download', params: { regionId: c.regionId } });
      return;
    }
    try {
      retryCountry(c);
    } catch (e) {
      if (e instanceof NotEnoughStorageError)
        Alert.alert(c.title, t('common:storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
    }
  };

  // A newer monthly build (map, routing pack or both): update it (or delete the country) from one dialog.
  const manage = (c: CountryState) => {
    const offer = countryOffer(c.regionId);
    const plan = offer ? planCountry(offer, undefined, { update: true }) : null;
    Alert.alert(c.title, t('regions.updateBody', { size: formatBytes(plan?.bytes ?? 0) }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => confirmDelete(c.title, c.sizeBytes, () => void removeCountry(c)) },
      {
        text: t('regions.update'),
        onPress: () => {
          if (!offer) return;
          try {
            downloadCountry(offer, undefined, { update: true });
          } catch (e) {
            if (e instanceof NotEnoughStorageError)
              Alert.alert(c.title, t('common:storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
          }
        },
      },
    ]);
  };

  const subtitle = (c: CountryState) => {
    if (c.progress !== null) return t('regions.downloadingPct', { pct: Math.round(c.progress * 100) });
    if (c.failed) return t('regions.failed');
    if (c.update) return t('regions.updateAvailable');
    // A country in regions: which ones ("Sur, Noreste").
    const what = c.regions.length
      ? c.regions.map(countryRegionName).join(', ')
      : !c.map
        ? t('regions.routingOnly')
        : c.packs.length
          ? t('regions.withRouting')
          : t('regions.mapOnly');
    return [what, formatBytes(c.sizeBytes), dataDate(c.buildDate, i18n.language)].filter(Boolean).join(' · ');
  };

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs, marginBottom: space.md }}>
        {t('regions.intro')}
      </Text>
      <ListGroup>
        {countries.map((c) => (
          <ListRow
            key={c.regionId}
            testID="country-row"
            leading={<IconBadge icon={MapIcon} hue="maps" />}
            title={c.title}
            subtitle={subtitle(c)}
            onPress={
              // A country in regions opens its regions (add or delete one); any other shows its map.
              c.regions.length
                ? () => router.push({ pathname: '/maps/download', params: { regionId: c.regionId } })
                : c.map
                  ? () => show(c.map?.meta.bbox)
                  : undefined
            }
            chevron={c.regions.length > 0 && c.progress === null}
            trailing={c.progress !== null ? <ProgressBar value={c.progress} style={{ width: 56 }} /> : undefined}
            trailingAction={
              c.failed ? (
                <IconButton testID="country-retry" icon={RefreshCw} size={36} variant="plain" accessibilityLabel={t('regions.retry')} onPress={() => retry(c)} />
              ) : c.update && c.progress === null ? (
                <IconButton testID="country-update" icon={RefreshCw} size={36} variant="plain" color={colors.accent} accessibilityLabel={t('regions.update')} onPress={() => manage(c)} />
              ) : (
                <IconButton
                  testID="region-delete"
                  icon={Trash2}
                  size={36}
                  variant="plain"
                  color={colors.danger}
                  accessibilityLabel={c.progress !== null ? t('common:actions.cancel') : t('common:actions.delete')}
                  onPress={() => confirmDelete(c.title, c.sizeBytes, () => void removeCountry(c))}
                />
              )
            }
          />
        ))}
        <ListRow
          testID="add-country"
          leading={<IconBadge icon={Plus} hue="maps" />}
          title={countries.length ? t('regions.addCountry') : t('regions.addFirstCountry')}
          subtitle={t('regions.addCountryBody')}
          chevron
          onPress={() => router.push('/maps/pick')}
        />
      </ListGroup>

      <ListGroup style={{ marginTop: space.lg }}>
        <ListRow
          leading={<IconBadge icon={Globe} hue="maps" />}
          title={t('regions.world')}
          subtitle={t('regions.worldBody')}
          trailing={world ? <Badge label={t('regions.included')} tone="success" /> : undefined}
          onPress={() => show(world?.meta.bbox)}
        />
      </ListGroup>

      {otherMaps.length ? (
        <>
          <SectionHeader title={t('regions.other')} />
          <ListGroup>
            {otherMaps.map((item) => (
              <ListRow
                key={item.id}
                leading={<IconBadge icon={MapIcon} hue="neutral" />}
                title={item.title}
                subtitle={[formatBytes(item.sizeBytes), dataDate(item.meta.buildDate, i18n.language)].filter(Boolean).join(' · ')}
                onPress={() => show(item.meta.bbox)}
                trailingAction={
                  <IconButton
                    testID="region-delete"
                    icon={Trash2}
                    size={36}
                    variant="plain"
                    color={colors.danger}
                    accessibilityLabel={t('common:actions.delete')}
                    onPress={() => confirmDelete(item.title, item.sizeBytes, () => void removeItem(item.id))}
                  />
                }
              />
            ))}
          </ListGroup>
        </>
      ) : null}
    </Screen>
  );
}
