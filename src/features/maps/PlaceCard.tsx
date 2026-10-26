// Bottom card for the selected place (search result, emergency point or a tapped
// dot on the map): what it is, how far, and the actions — take me there, save, and
// one call button per number OpenStreetMap lists. The buttons show the number, so it
// can be dialled from another phone when this device can't call.
import * as Location from 'expo-location';
import { Check, MapPin, Navigation, Phone, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, IconBadge, IconButton, Row, Text } from '@/components/ui';
import { space } from '@/theme';

import { callNumber } from './call';
import { findEmergencyPlace, getEmergencyPlace } from './emergency';
import { policeForce } from './emergency-core';
import { distanceMeters, formatLatLon, formatUtm, toUtm, type LatLon } from './geo';
import { useGuidance } from './guidance';
import { distanceWithDirection, isEmergencyKind, kindColor, kindIcon, kindLabel } from './labels';
import { addMarker } from './markers';
import { parsePhones } from './phone';
import { useMapUi, type SelectedPlace } from './store';

export function PlaceCard({ place, bottom }: { place: SelectedPlace; bottom: number }) {
  const { t, i18n } = useTranslation('maps');
  const [here, setHere] = useState<LatLon | null>(null);
  const [saved, setSaved] = useState(false);
  const poi = useMemo(
    () =>
      place.osmId
        ? getEmergencyPlace(place.osmId, null)
        : isEmergencyKind(place.kind)
          ? findEmergencyPlace(place.name, place.lat, place.lon)
          : null,
    [place],
  );
  const phones = useMemo(() => parsePhones(poi?.phone), [poi]);

  // The parent keys this card by place, so `saved` starts fresh for each one.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((p) => (p.granted ? Location.getLastKnownPositionAsync() : null))
      .then((pos) => setHere(pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null))
      .catch(() => {});
  }, [place]);

  const kind = poi?.kind ?? place.kind;
  const force = kind === 'police' ? policeForce(poi?.operator ?? place.name) : null;
  const subtitle = [
    force ? t(`police.${force}`) : kindLabel(t, kind),
    force ? null : poi?.operator && poi.operator !== place.name ? poi.operator : null,
    place.context,
    here ? distanceWithDirection(t, i18n.language, here, place, distanceMeters(here, place)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const utm = toUtm(place.lat, place.lon);

  const guide = async () => {
    const ok = await useGuidance.getState().start({ name: place.name, lat: place.lat, lon: place.lon });
    if (!ok) {
      Alert.alert(t('guidance.deniedTitle'), t('guidance.deniedBody'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('location.openSettings'), onPress: () => Linking.openSettings() },
      ]);
    }
  };

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <Card style={{ gap: space.md }} testID="place-card">
        <Row gap={space.md} align="flex-start">
          <IconBadge icon={kindIcon(kind, place.layer ?? undefined)} color={kindColor(kind)} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={2}>
              {place.name}
            </Text>
            <Text variant="footnote" color="textSecondary" numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
          <IconButton
            testID="place-close"
            icon={X}
            size={32}
            accessibilityLabel={t('place.close')}
            onPress={() => useMapUi.getState().select(null)}
          />
        </Row>
        {poi && (poi.emergency !== null || poi.openingHours) ? (
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {poi.emergency === 1 ? <Badge label={t('place.emergencyYes')} tone="danger" /> : null}
            {poi.emergency === 0 ? <Badge label={t('place.emergencyNo')} /> : null}
            {poi.openingHours ? <Badge label={t('place.hours', { hours: poi.openingHours })} /> : null}
          </Row>
        ) : null}
        {phones.length ? (
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {phones.map((p) => (
              <Button
                key={p.dial}
                testID="place-call"
                title={p.label}
                icon={Phone}
                variant="secondary"
                size="sm"
                accessibilityLabel={t('place.callNumber', { number: p.label })}
                onPress={() => callNumber(p)}
              />
            ))}
          </Row>
        ) : null}
        <Text variant="caption" color="textTertiary" tabular selectable>
          {formatLatLon(place.lat, place.lon)}
          {utm ? `  ·  UTM ${formatUtm(utm)}` : ''}
        </Text>
        <Row gap={space.sm}>
          <Button testID="place-guide" title={t('place.takeMeThere')} icon={Navigation} onPress={guide} style={{ flex: 1 }} />
          <Button
            testID="place-save"
            title={saved ? t('place.saved') : t('place.save')}
            icon={saved ? Check : MapPin}
            variant="secondary"
            disabled={saved}
            onPress={() => {
              addMarker({ name: place.name, lat: place.lat, lon: place.lon });
              setSaved(true);
            }}
          />
        </Row>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
});
