import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type CameraRef, type InitialViewState } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Layers, LocateFixed, MapPin, Navigation2, Search, Siren } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, PressableScale, Text } from '@/components/ui';
import { ensureMapAssets, type MapAssets } from '@/features/maps/assets';
import { emergencyPlacesIn, usePoiSync } from '@/features/maps/emergency';
import { WORLD_ID } from '@/features/maps/extraction';
import { GuidancePanel } from '@/features/maps/GuidancePanel';
import { useGuidance } from '@/features/maps/guidance';
import { CATEGORY_COLORS } from '@/features/maps/labels';
import { MapFab } from '@/features/maps/MapFab';
import { markersGeoJSON, useMarkers } from '@/features/maps/markers';
import { PlaceCard } from '@/features/maps/PlaceCard';
import { showPlace, useMapUi } from '@/features/maps/store';
import { buildMapStyle } from '@/features/maps/style';
import { useMapItems } from '@/features/maps/useMapSources';
import { hues, radius, space, useTheme } from '@/theme';

/** Emergency points are drawn from this zoom on (fewer would be a cloud of dots). */
const POI_MIN_ZOOM = 11;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Exceptions thrown inside native event callbacks crash Release builds: log instead. */
function safe<A extends unknown[]>(fn: (...args: A) => void) {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (e) {
      console.warn('[maps] event handler failed', e);
    }
  };
}

export default function MapScreen() {
  const { t, i18n } = useTranslation('maps');
  const { scheme, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { all, world, regions } = useMapItems();
  const markers = useMarkers((s) => s.markers);
  const request = useMapUi((s) => s.request);
  const selected = useMapUi((s) => s.selected);
  const viewport = useMapUi((s) => s.viewport);
  const setViewport = useMapUi((s) => s.setViewport);
  const poiVersion = usePoiSync((s) => s.version);
  const target = useGuidance((s) => s.target);
  const position = useGuidance((s) => s.position);
  const route = useGuidance((s) => s.route);
  const cameraRef = useRef<CameraRef>(null);
  const [assets, setAssets] = useState<MapAssets | null>(null);
  const [bearing, setBearing] = useState(0);
  const [showUser, setShowUser] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    ensureMapAssets()
      .then(setAssets)
      .catch((e) => console.warn('[maps] assets', e));
    Location.getForegroundPermissionsAsync()
      .then((p) => setShowUser(p.granted))
      .catch(() => {});
  }, []);

  const style = useMemo(
    () => (assets ? buildMapStyle({ scheme, lang: i18n.language, assets, sources: all.map((i) => ({ id: i.id, fileUri: i.fileUri })) }) : null),
    [assets, scheme, i18n.language, all],
  );

  // Where to open: last viewport, else the first region, else the whole world.
  const initialView = useMemo<InitialViewState>(() => {
    const v = useMapUi.getState().viewport;
    if (v) return { center: v.center, zoom: v.zoom };
    const first = regions[0];
    if (first?.meta.bbox) return { bounds: first.meta.bbox };
    return { center: [0, 25], zoom: 1.2 };
    // Only on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!request || !cameraRef.current) return;
    if ('bounds' in request) {
      cameraRef.current.fitBounds(request.bounds, { padding: { top: 80, bottom: 80, left: 40, right: 40 }, duration: 900 });
    } else {
      cameraRef.current.flyTo({ center: request.center, zoom: request.zoom ?? 15, duration: 1200 });
    }
  }, [request]);

  const markerData = useMemo(() => markersGeoJSON(markers), [markers]);

  // Emergency points in view, straight from SQLite (indexed bbox query, a few ms).
  const poiData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!viewport || viewport.zoom < POI_MIN_ZOOM) return EMPTY;
    try {
      const places = emergencyPlacesIn(viewport.bounds);
      return {
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { osmId: p.osmId, name: p.name ?? '', kind: p.kind, category: p.category },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        })),
      };
    } catch {
      return EMPTY;
    }
    // poiVersion: refetch after a region's points finish downloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, poiVersion]);

  const selectedData = useMemo<GeoJSON.FeatureCollection>(
    () =>
      selected
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] } }],
          }
        : EMPTY,
    [selected],
  );

  const guidanceData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!target) return EMPTY;
    const end: GeoJSON.Feature = {
      type: 'Feature',
      properties: { end: true },
      geometry: { type: 'Point', coordinates: [target.lon, target.lat] },
    };
    // Following roads: the route line (its own source) replaces the straight line.
    if (!position || route) return { type: 'FeatureCollection', features: [end] };
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [position.lon, position.lat],
              [target.lon, target.lat],
            ],
          },
        },
        end,
      ],
    };
  }, [target, position, route]);

  const routeData = useMemo<GeoJSON.FeatureCollection>(
    () =>
      route
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.shape } }] }
        : EMPTY,
    [route],
  );

  // Frame the whole route when the first one arrives and when the mode changes;
  // a reroute keeps the user's framing.
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!route || !target) return;
    const key = `${target.lat},${target.lon},${route.costing}`;
    if (framedKey.current === key) return;
    framedKey.current = key;
    cameraRef.current?.fitBounds(route.bbox, { padding: { top: 140, bottom: 360, left: 60, right: 60 }, duration: 900 });
  }, [route, target]);

  // Frame start and target once when guidance starts.
  const framedFor = useRef<typeof target>(null);
  useEffect(() => {
    if (!target) {
      framedFor.current = null;
      return;
    }
    if (!position || framedFor.current === target) return;
    framedFor.current = target;
    setShowUser(true);
    cameraRef.current?.fitBounds(
      [
        Math.min(position.lon, target.lon),
        Math.min(position.lat, target.lat),
        Math.max(position.lon, target.lon),
        Math.max(position.lat, target.lat),
      ],
      { padding: { top: 140, bottom: 320, left: 60, right: 60 }, duration: 900 },
    );
  }, [target, position]);

  async function locate() {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('location.deniedTitle'), t('location.deniedBody'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('location.openSettings'), onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    setShowUser(true);
    setLocating(true);
    try {
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const zoom = Math.max(useMapUi.getState().viewport?.zoom ?? 0, 14);
      cameraRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom, duration: 1200 });
    } catch {
      Alert.alert(t('location.unavailable'));
    } finally {
      setLocating(false);
    }
  }

  const top = insets.top + space.sm;
  const cardBottom = insets.bottom + 72;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {style ? (
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={style}
          logo={false}
          compass={false}
          attributionPosition={{ bottom: space.sm, left: space.sm }}
          tintColor={colors.textSecondary}
          onRegionIsChanging={safe((e) => setBearing(Number(e.nativeEvent.bearing)))}
          onRegionDidChange={safe((e) => {
            const { center, zoom, bounds, bearing: b } = e.nativeEvent;
            setBearing(Number(b));
            setViewport({ center, zoom: Number(zoom), bounds });
          })}
          onLongPress={safe((e) => {
            const [lon, lat] = e.nativeEvent.lngLat;
            router.push({ pathname: '/maps/marker', params: { lat: String(lat), lon: String(lon) } });
          })}>
          <Camera ref={cameraRef} initialViewState={initialView} maxZoom={19} />
          {showUser ? <NativeUserLocation /> : null}
          <GeoJSONSource
            id="markers"
            data={markerData}
            onPress={safe((e) => {
              const id = e.nativeEvent.features[0]?.properties?.id;
              if (id != null) router.push({ pathname: '/maps/marker', params: { id: String(id) } });
            })}>
            <Layer
              type="circle"
              id="markers-dot"
              paint={{
                'circle-radius': 8,
                'circle-color': colors.accent,
                'circle-stroke-color': colors.surface,
                'circle-stroke-width': 3,
              }}
            />
            <Layer
              type="symbol"
              id="markers-label"
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Medium'],
                'text-size': 13,
                'text-anchor': 'top',
                'text-offset': [0, 0.9],
                'text-optional': true,
              }}
              paint={{ 'text-color': colors.text, 'text-halo-color': colors.surface, 'text-halo-width': 1.6 }}
            />
          </GeoJSONSource>
          <GeoJSONSource
            id="emergency"
            data={poiData}
            onPress={safe((e) => {
              const f = e.nativeEvent.features[0];
              const props = f?.properties as { osmId?: string; name?: string; kind?: string } | undefined;
              if (!f || f.geometry.type !== 'Point' || !props?.osmId) return;
              const [lon, lat] = f.geometry.coordinates;
              showPlace(
                {
                  name: props.name || t(`kind.${props.kind}`, { defaultValue: t('kind.place') }),
                  lat,
                  lon,
                  kind: props.kind,
                  layer: 'poi',
                  osmId: props.osmId,
                },
                0,
              );
            })}>
            <Layer
              type="circle"
              id="emergency-dot"
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 7],
                'circle-color': [
                  'match',
                  ['get', 'category'],
                  'health',
                  CATEGORY_COLORS.health,
                  'security',
                  CATEGORY_COLORS.security,
                  'water',
                  CATEGORY_COLORS.water,
                  'supplies',
                  CATEGORY_COLORS.supplies,
                  CATEGORY_COLORS.official,
                ],
                'circle-stroke-color': colors.surface,
                'circle-stroke-width': 2,
              }}
            />
            <Layer
              type="symbol"
              id="emergency-label"
              minzoom={15}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-anchor': 'top',
                'text-offset': [0, 0.8],
                'text-optional': true,
              }}
              paint={{ 'text-color': colors.textSecondary, 'text-halo-color': colors.surface, 'text-halo-width': 1.4 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="route" data={routeData}>
            <Layer
              type="line"
              id="route-casing"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.surface, 'line-width': 9 }}
            />
            <Layer
              type="line"
              id="route-line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.accent, 'line-width': 5.5 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="guidance" data={guidanceData}>
            <Layer
              type="line"
              id="guidance-line"
              filter={['==', ['geometry-type'], 'LineString']}
              layout={{ 'line-cap': 'round' }}
              paint={{ 'line-color': colors.accent, 'line-width': 4, 'line-dasharray': [1, 1.6] }}
            />
            <Layer
              type="circle"
              id="guidance-end"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{ 'circle-radius': 9, 'circle-color': colors.accent, 'circle-stroke-color': colors.surface, 'circle-stroke-width': 3 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="selected" data={selectedData}>
            <Layer
              type="circle"
              id="selected-dot"
              // A ring, so the basemap label of the place stays readable inside it.
              paint={{ 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-color': colors.accent, 'circle-stroke-width': 3 }}
            />
          </GeoJSONSource>
        </Map>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text variant="footnote" color="textSecondary">
            {t('loadingAssets')}
          </Text>
        </View>
      )}

      {style ? (
        <PressableScale
          testID="map-search"
          accessibilityRole="search"
          accessibilityLabel={t('controls.search')}
          onPress={() => router.push('/maps/search')}
          haptic="selection"
          pressedScale={0.98}
          style={[styles.search, { top, backgroundColor: colors.surface, shadowColor: colors.shadow, borderColor: colors.border }]}>
          <Search size={18} color={colors.textTertiary} />
          <Text variant="callout" color="textTertiary" numberOfLines={1} style={{ flex: 1 }}>
            {t('search.placeholder')}
          </Text>
        </PressableScale>
      ) : null}

      <View style={[styles.controls, { top }]} pointerEvents="box-none">
        <MapFab testID="map-emergency" accessibilityLabel={t('controls.emergency')} onPress={() => router.push('/maps/emergency')}>
          <Siren size={21} color={colors.danger} strokeWidth={2} />
        </MapFab>
        <MapFab icon={Layers} accessibilityLabel={t('controls.regions')} onPress={() => router.push('/maps/regions')} />
        <MapFab icon={MapPin} accessibilityLabel={t('controls.markers')} onPress={() => router.push('/maps/markers')} />
        {Math.abs(bearing) > 1 ? (
          <MapFab
            accessibilityLabel={t('controls.north')}
            onPress={() => cameraRef.current?.setStop({ bearing: 0, duration: 400, easing: 'ease' })}>
            <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
              <Navigation2 size={21} color={hues.medicine} fill={hues.medicine} strokeWidth={1.5} />
            </View>
          </MapFab>
        ) : null}
        <MapFab accessibilityLabel={t('controls.locate')} onPress={locate} active={showUser}>
          {locating ? <ActivityIndicator color={colors.accent} /> : <LocateFixed size={21} color={showUser ? colors.accent : colors.text} />}
        </MapFab>
      </View>

      {target ? (
        <GuidancePanel bottom={cardBottom} mapBearing={bearing} />
      ) : selected ? (
        <PlaceCard key={`${selected.lat},${selected.lon}`} place={selected} bottom={cardBottom} />
      ) : null}

      {style && !all.length && !target && !selected ? (
        <View style={[styles.bottom, { bottom: cardBottom }]} pointerEvents="box-none">
          <Card style={{ gap: space.md }}>
            <Text variant="title3">{t('empty.title')}</Text>
            <Text variant="callout" color="textSecondary">
              {t('empty.body')}
            </Text>
            <View style={{ gap: space.sm }}>
              {!world ? (
                <Button title={t('empty.worldNoSize')} onPress={() => router.push({ pathname: '/maps/download', params: { key: WORLD_ID } })} />
              ) : null}
              <Button title={t('empty.pickRegion')} variant="secondary" onPress={() => router.push('/maps/pick')} />
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  controls: { position: 'absolute', right: space.lg, gap: space.md, alignItems: 'center' },
  // Leaves room for the control column on the right (46 pt FABs).
  search: {
    position: 'absolute',
    left: space.lg,
    right: space.lg + 46 + space.md,
    // iPad: a search box, not a banner across the map.
    maxWidth: 520,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  bottom: { position: 'absolute', left: space.lg, right: space.lg },
});
