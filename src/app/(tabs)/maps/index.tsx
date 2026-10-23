import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type CameraRef, type InitialViewState } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Layers, LocateFixed, MapPin, Navigation2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { ensureMapAssets, type MapAssets } from '@/features/maps/assets';
import { WORLD_ID } from '@/features/maps/extraction';
import { MapFab } from '@/features/maps/MapFab';
import { markersGeoJSON, useMarkers } from '@/features/maps/markers';
import { useMapUi } from '@/features/maps/store';
import { buildMapStyle } from '@/features/maps/style';
import { useMapItems } from '@/features/maps/useMapSources';
import { hues, space, useTheme } from '@/theme';

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
  const setViewport = useMapUi((s) => s.setViewport);
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
        </Map>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text variant="footnote" color="textSecondary">
            {t('loadingAssets')}
          </Text>
        </View>
      )}

      <View style={[styles.controls, { top }]} pointerEvents="box-none">
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

      {style && !all.length ? (
        <View style={[styles.bottom, { bottom: insets.bottom + 72 }]} pointerEvents="box-none">
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
  bottom: { position: 'absolute', left: space.lg, right: space.lg },
});
