import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import { Navigation, Phone, RefreshCw, Share2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, Share, View } from 'react-native';

import { Button, Card, Chip, IconBadge, IconButton, ListGroup, ListRow, Row, Screen, SectionHeader, Text } from '@/components/ui';
import {
  emergencyNumber,
  emergencySyncInfo,
  hasEmergencyPoints,
  nearestEmergencyPlaces,
  syncEmergencyPoints,
  tilePointCounts,
  usePoiSync,
  type EmergencyPlace,
} from '@/features/maps/emergency';
import { EMERGENCY_CATEGORIES, policeForce, type EmergencyCategory } from '@/features/maps/emergency-core';
import { formatLatLon, formatUtm, toUtm, type LatLon } from '@/features/maps/geo';
import { useGuidance } from '@/features/maps/guidance';
import { usePlaceIndex } from '@/features/maps/places';
import { CATEGORY_COLORS, CATEGORY_ICONS, distanceWithDirection, kindIcon, kindLabel } from '@/features/maps/labels';
import { showPlace, useMapUi } from '@/features/maps/store';
import { useMapItems } from '@/features/maps/useMapSources';
import { formatRelativeDate } from '@/lib/format';
import { space, useTheme } from '@/theme';

type Here = LatLon & { accuracy: number | null; fromMap: boolean };

export default function EmergencySheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const { regions } = useMapItems();
  const syncStates = usePoiSync((s) => s.states);
  // Either changes when points are stored: an Overpass fetch or a map's tiles being indexed.
  const syncVersion = usePoiSync((s) => s.version) + usePlaceIndex((s) => s.version) * 1000;
  const [category, setCategory] = useState<EmergencyCategory>('health');
  const [here, setHere] = useState<Here | null>(null);
  const [locating, setLocating] = useState(true);
  const number = emergencyNumber();

  useEffect(() => {
    let alive = true;
    const fromMap = () => {
      const c = useMapUi.getState().viewport?.center;
      return c ? { lon: c[0], lat: c[1], accuracy: null, fromMap: true } : null;
    };
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) throw new Error('denied');
        const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
        if (last && alive)
          setHere({ lat: last.coords.latitude, lon: last.coords.longitude, accuracy: last.coords.accuracy, fromMap: false });
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (alive) setHere({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, fromMap: false });
      } catch {
        if (alive) setHere((h) => h ?? fromMap());
      } finally {
        if (alive) setLocating(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const info = useMemo(
    () => emergencySyncInfo(),
    // syncVersion: re-read after a fetch finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncVersion, regions],
  );
  const fromTiles = useMemo(
    () => tilePointCounts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncVersion, regions],
  );
  // Points from Overpass or, as a fallback, from the maps' own tiles.
  const hasData = useMemo(
    () => hasEmergencyPoints(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncVersion, regions],
  );
  const places = useMemo(
    () => (here && hasData ? nearestEmergencyPlaces(category, here, 40) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [here?.lat, here?.lon, category, hasData, syncVersion],
  );

  const fetchRegion = async (id: string) => {
    const item = regions.find((r) => r.id === id);
    if (!item) return;
    const net = await Network.getNetworkStateAsync().catch(() => null);
    if (net && net.isInternetReachable === false) {
      Alert.alert(t('emergency.offline'));
      return;
    }
    syncEmergencyPoints(item);
  };

  const share = () => {
    if (!here || here.fromMap) return;
    const utm = toUtm(here.lat, here.lon);
    const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(Date.now());
    Share.share({
      message: t('emergency.shareMessage', {
        coords: formatLatLon(here.lat, here.lon),
        utm: utm ? formatUtm(utm) : '—',
        accuracy: Math.round(here.accuracy ?? 0),
        time,
        url: `https://www.openstreetmap.org/?mlat=${here.lat.toFixed(5)}&mlon=${here.lon.toFixed(5)}#map=17/${here.lat.toFixed(5)}/${here.lon.toFixed(5)}`,
      }),
    }).catch(() => {});
  };

  const open = (p: EmergencyPlace) => {
    showPlace({ name: p.name ?? kindLabel(t, p.kind), lat: p.lat, lon: p.lon, kind: p.kind, layer: 'poi', osmId: p.osmId });
    router.back();
  };

  const guide = async (p: EmergencyPlace) => {
    const ok = await useGuidance.getState().start({ name: p.name ?? kindLabel(t, p.kind), lat: p.lat, lon: p.lon });
    if (ok) {
      useMapUi.getState().select(null);
      router.back();
    }
  };

  const subtitle = (p: EmergencyPlace) => {
    const force = p.kind === 'police' ? policeForce(p.operator ?? p.name) : null;
    const parts = [
      force ? t(`police.${force}`) : kindLabel(t, p.kind),
      p.emergency === 1 ? t('place.emergencyYes') : null,
      !force && p.operator && p.operator !== p.name ? p.operator : null,
    ].filter(Boolean);
    const distance = here && p.distance !== null ? distanceWithDirection(t, i18n.language, here, p, p.distance) : null;
    return distance ? `${parts.join(' · ')}\n${distance}` : parts.join(' · ');
  };

  const utm = here ? toUtm(here.lat, here.lon) : null;

  // Maps whose points neither came with them nor were fetched yet: fetched on their own
  // after the download; a failure shows a retry in the list below.
  const pending = regions.filter((r) => !info[r.id] && !r.meta.bundledPoints);
  const syncing = pending.some((r) => syncStates[r.id]?.status === 'running');
  // Opening the sheet online retries them (a first fetch that failed, a map seeded offline).
  useEffect(() => {
    if (!pending.length) return;
    Network.getNetworkStateAsync()
      .then((net) => {
        if (net.isInternetReachable === false) return;
        for (const r of pending) if (!usePoiSync.getState().states[r.id]) syncEmergencyPoints(r);
      })
      .catch(() => {});
    // Once per opening, for the maps pending then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen contentStyle={{ paddingTop: space.lg, gap: space.md }}>
      <Row gap={space.sm}>
        <Button
          testID="emergency-call"
          title={t('emergency.call', { number })}
          icon={Phone}
          variant="danger"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => Linking.openURL(`tel:${number}`)}
        />
        <IconButton
          testID="emergency-share"
          icon={Share2}
          size={54}
          accessibilityLabel={t('emergency.share')}
          disabled={!here || here.fromMap}
          onPress={share}
        />
      </Row>

      <Card style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          {t('emergency.myPosition')}
        </Text>
        {here && !here.fromMap ? (
          <>
            <Text variant="headline" tabular selectable testID="emergency-position">
              {formatLatLon(here.lat, here.lon)}
            </Text>
            <Text variant="footnote" color="textSecondary" tabular selectable>
              {utm ? `UTM ${formatUtm(utm)}` : ''}
              {here.accuracy ? `${utm ? '  ·  ' : ''}± ${Math.round(here.accuracy)} m` : ''}
            </Text>
          </>
        ) : (
          <Text variant="callout" color="textSecondary">
            {locating ? t('emergency.locating') : t('emergency.fromMapCenter')}
          </Text>
        )}
      </Card>

      {hasData ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
            style={{ marginHorizontal: -space.gutter }}>
            <View style={{ width: space.gutter - space.sm }} />
            {EMERGENCY_CATEGORIES.map((c) => (
              <Chip
                key={c}
                testID={`emergency-cat-${c}`}
                label={t(`emergency.category.${c}`)}
                icon={CATEGORY_ICONS[c]}
                selected={c === category}
                onPress={() => setCategory(c)}
              />
            ))}
            <View style={{ width: space.gutter - space.sm }} />
          </ScrollView>
          {here?.fromMap ? (
            <Text variant="footnote" color="textSecondary">
              {t('emergency.fromMapCenter')}
            </Text>
          ) : null}
          {places.length ? (
            <ListGroup>
              {places.map((p) => (
                <ListRow
                  key={p.osmId}
                  testID="emergency-place"
                  leading={<IconBadge icon={kindIcon(p.kind, 'poi')} color={CATEGORY_COLORS[p.category]} />}
                  title={p.name ?? kindLabel(t, p.kind)}
                  subtitle={subtitle(p)}
                  onPress={() => open(p)}
                  trailingAction={
                    <IconButton
                      testID="emergency-guide"
                      icon={Navigation}
                      size={36}
                      color={colors.accent}
                      accessibilityLabel={t('place.takeMeThere')}
                      onPress={() => guide(p)}
                    />
                  }
                />
              ))}
            </ListGroup>
          ) : (
            <Text variant="callout" color="textSecondary" align="center" style={{ marginVertical: space.xl }}>
              {here ? t('emergency.empty') : t('emergency.locating')}
            </Text>
          )}
        </>
      ) : (
        <Card style={{ gap: space.md }}>
          <Text variant="title3">{regions.length ? t('emergency.preparingTitle') : t('emergency.noDataTitle')}</Text>
          <Text variant="callout" color="textSecondary">
            {regions.length ? (syncing ? t('emergency.preparingBody') : t('emergency.noDataBody')) : t('emergency.noRegions')}
          </Text>
          {!regions.length ? <Button title={t('emergency.pickRegion')} variant="secondary" onPress={() => router.push('/maps/pick')} /> : null}
        </Card>
      )}

      {regions.length ? (
        <>
          <SectionHeader title={t('emergency.regions')} />
          <ListGroup>
            {regions.map((r) => {
              const state = syncStates[r.id];
              const done = info[r.id];
              const status =
                state?.status === 'running'
                  ? t('emergency.fetching', { name: r.title, done: state.done, total: state.total })
                  : state?.status === 'failed'
                    ? t('emergency.failed', { name: r.title, error: state.error })
                    : done
                      ? t('emergency.regionInfo', { count: done.count, date: formatRelativeDate(done.at) })
                      : r.meta.bundledPoints
                        ? t('emergency.bundled')
                      : fromTiles[r.id]
                        ? t('emergency.regionFromTiles', { count: fromTiles[r.id] })
                        : t('emergency.noDataTitle');
              return (
                <ListRow
                  key={r.id}
                  testID="emergency-region"
                  title={r.title}
                  subtitle={status}
                  trailingAction={
                    state?.status === 'running' || (r.meta.bundledPoints && !done) ? undefined : (
                      <IconButton
                        testID="emergency-fetch"
                        icon={RefreshCw}
                        size={36}
                        variant="plain"
                        accessibilityLabel={done ? t('emergency.refresh') : t('emergency.fetch', { name: r.title })}
                        onPress={() => fetchRegion(r.id)}
                      />
                    )
                  }
                />
              );
            })}
          </ListGroup>
        </>
      ) : null}

      <Text variant="caption" color="textTertiary" style={{ marginTop: space.md }}>
        {t('emergency.source', { number })}
      </Text>
    </Screen>
  );
}
