import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  type CameraRef,
  type InitialViewState,
  type MapRef,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from '@/lib/location';
import { router, useNavigation } from 'expo-router';
import { Layers, LocateFixed, MapPin, Navigation, Navigation2, Route, Search } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, PressableScale, ProgressBar, Text } from '@/components/ui';
import { recordGroup } from '@/features/downloads/groups';
import { resumeDownloads, useDownloads } from '@/features/downloads/manager';
import { ensureMapAssets, type MapAssets } from '@/features/maps/assets';
import { emergencyPlacesIn, usePoiSync } from '@/features/maps/emergency';
import { EMERGENCY_CATEGORIES } from '@/features/maps/emergency-core';
import { deviceCountry } from '@/features/maps/CountryList';
import { useCountries } from '@/features/maps/countries';
import { countryDownloadGroup } from '@/features/maps/country-maps';
import { FollowArrow, FollowBeam, useFollowCamera } from '@/features/maps/FollowCamera';
import { GuidancePanel } from '@/features/maps/GuidancePanel';
import { HeadingBeam } from '@/features/maps/HeadingBeam';
import { fitBox } from '@/features/maps/geo';
import { useGuidance } from '@/features/maps/guidance';
import { CATEGORY_COLORS } from '@/features/maps/labels';
import { CREDIT_MS, MapCredit } from '@/features/maps/MapCredit';
import { MapFab } from '@/features/maps/MapFab';
import { markersGeoJSON, useMarkers } from '@/features/maps/markers';
import { PlaceCard } from '@/features/maps/PlaceCard';
import { PointsGlyph } from '@/features/maps/PointDot';
import { getRegion, regionName, type Region } from '@/features/maps/regions';
import { showPlace, useMapUi } from '@/features/maps/store';
import { buildMapStyle } from '@/features/maps/style';
import { nearestStreet, tappedPlace, type TapFeature } from '@/features/maps/tap-core';
import { useMapItems } from '@/features/maps/useMapSources';
import { useSettings } from '@/stores/settings';
import { hues, radius, space, useTheme } from '@/theme';

/** Emergency points are drawn from this zoom on (fewer would be a cloud of dots). */
const POI_MIN_ZOOM = 11;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Half the side (pt) of the box a tap looks for a map point in: a POI icon is about this size. */
const TAP_SLOP = 16;
/** Half the side (pt) of the box searched for the tapped place's street: tap-core keeps one within 60 m. */
const STREET_SLOP = 120;

/** The basemap's style layers a tap reads, by kind (style.ts names them "<source>:<protomaps layer>"). */
function tapLayers(style: { layers: { id: string }[] }) {
  const ids = (test: (layer: string) => boolean) => style.layers.map((l) => l.id).filter((id) => test(id.slice(id.indexOf(':') + 1)));
  return {
    poi: ids((l) => l === 'pois'),
    place: ids((l) => l === 'places_locality' || l === 'places_subplace'),
    road: ids(
      (l) => l.startsWith('roads_') && !l.includes('label') && !l.includes('casing') && l !== 'roads_shields' && l !== 'roads_oneway',
    ),
  };
}

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
  const { all, regions } = useMapItems();
  const chosen = useSettings((st) => st.country);
  const home = useMemo(() => {
    const id = chosen ?? deviceCountry();
    return id ? getRegion(id) : undefined;
  }, [chosen]);
  const markers = useMarkers((s) => s.markers);
  const pointsShown = useSettings((st) => st.mapPoints);
  const hiddenCategories = useSettings((st) => st.hiddenPointCategories);
  const request = useMapUi((s) => s.request);
  const selected = useMapUi((s) => s.selected);
  const viewport = useMapUi((s) => s.viewport);
  const setViewport = useMapUi((s) => s.setViewport);
  const poiVersion = usePoiSync((s) => s.version);
  const target = useGuidance((s) => s.target);
  const position = useGuidance((s) => s.position);
  const route = useGuidance((s) => s.route);
  const progress = useGuidance((s) => s.progress);
  const navigating = useGuidance((s) => s.navigating);
  const northUp = useSettings((st) => st.navNorthUp);
  const setNorthUp = useSettings((st) => st.setNavNorthUp);
  /** The direction of travel the follow camera uses: the arrow turns by it when the map stays north up. */
  const [travel, setTravel] = useState<number | null>(null);
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [assets, setAssets] = useState<MapAssets | null>(null);
  const [bearing, setBearing] = useState(0);
  const [showUser, setShowUser] = useState(false);
  // The Maps tab in front (a sheet over the map keeps it): the compass beam listens only then.
  const navigation = useNavigation();
  // Native tabs may mount this screen behind another tab: no focus event comes until it is shown.
  const [tabFocused, setTabFocused] = useState(() => (navigation.getParent() ?? navigation).isFocused());
  useEffect(() => {
    const tab = navigation.getParent() ?? navigation;
    const unsubscribe = [tab.addListener('focus', () => setTabFocused(true)), tab.addListener('blur', () => setTabFocused(false))];
    return () => unsubscribe.forEach((u) => u());
  }, [navigation]);
  // Guidance keeps the screen awake and the compass on only while the map is in front.
  useEffect(() => {
    useGuidance.getState().setMapFocused(tabFocused);
  }, [tabFocused]);
  // The OpenStreetMap credit, until a few seconds pass or the first gesture (MapCredit).
  const [credit, setCredit] = useState(true);
  const [locating, setLocating] = useState(false);
  // Where the user was when the map first came to the front, and whether they have panned
  // or pinched since (then they are looking somewhere on purpose).
  const openedRef = useRef(false);
  const [openFix, setOpenFix] = useState<{ lat: number; lon: number } | null>(null);
  const [moved, setMoved] = useState(false);
  // Navigation view ("Iniciar"): the camera follows the user, the way ahead up
  // (FollowCamera), until the user pans the map. Per trip: it holds the target.
  const [touchedFor, setTouchedFor] = useState<typeof target>(null);
  const following = navigating && !!target && touchedFor !== target;
  const followingRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panelHeight, setPanelHeight] = useState(0);
  const [bannerHeight, setBannerHeight] = useState(0);

  useEffect(() => {
    ensureMapAssets()
      .then(setAssets)
      .catch((e) => console.warn('[maps] assets', e));
    Location.getForegroundPermissionsAsync()
      .then((p) => setShowUser(p.granted))
      .catch(() => {});
  }, []);

  const style = useMemo(
    () =>
      assets ? buildMapStyle({ scheme, lang: i18n.language, assets, sources: all.map((i) => ({ id: i.id, fileUri: i.fileUri })) }) : null,
    [assets, scheme, i18n.language, all],
  );
  const tapIds = useMemo(() => (style ? tapLayers(style) : null), [style]);

  /** The street drawn next to a point on screen (for the card's address), null when none is near. */
  const streetAt = async (point: readonly [number, number], p: { lat: number; lon: number }) => {
    const map = mapRef.current;
    if (!map || !tapIds?.road.length) return null;
    const [x, y] = point;
    const roads = await map.queryRenderedFeatures(
      [
        [x - STREET_SLOP, y - STREET_SLOP],
        [x + STREET_SLOP, y + STREET_SLOP],
      ],
      { layers: tapIds.road },
    );
    return nearestStreet(roads as TapFeature[], p, i18n.language);
  };

  /** A tap on the base map: the restaurant, stop or town under the finger gets the place card; nothing there closes it. */
  const tapMap = async ({ point, lngLat }: PressEvent) => {
    const map = mapRef.current;
    if (!map || !tapIds) return;
    const [x, y] = point;
    const box: [[number, number], [number, number]] = [
      [x - TAP_SLOP, y - TAP_SLOP],
      [x + TAP_SLOP, y + TAP_SLOP],
    ];
    const [poi, place] = await Promise.all([
      tapIds.poi.length ? map.queryRenderedFeatures(box, { layers: tapIds.poi }) : [],
      tapIds.place.length ? map.queryRenderedFeatures(box, { layers: tapIds.place }) : [],
    ]);
    const hit = tappedPlace({ poi: poi as TapFeature[], place: place as TapFeature[] }, { lat: lngLat[1], lon: lngLat[0] }, i18n.language);
    if (!hit) {
      useMapUi.getState().select(null);
      return;
    }
    const street = hit.layer === 'poi' ? await streetAt(point, hit) : undefined;
    useMapUi.getState().select({
      name: hit.name || t(`kind.${hit.kind}`, { defaultValue: t('kind.place') }),
      nativeName: hit.nativeName,
      lat: hit.lat,
      lon: hit.lon,
      kind: hit.kind,
      layer: hit.layer,
      street,
    });
  };

  // Counted while the map is on screen: the tab may be mounted behind Home at launch.
  useEffect(() => {
    if (!style || !credit || !tabFocused) return;
    const timer = setTimeout(() => setCredit(false), CREDIT_MS);
    return () => clearTimeout(timer);
  }, [style, credit, tabFocused]);

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
  // Opened on the world because the first region registered after the first render (a seeded or
  // loose map): frame it once, unless something else already moved the camera. Only once the native
  // map has loaded: a fitBounds before that is dropped.
  const framedFirst = useRef(!('center' in initialView) || !!useMapUi.getState().viewport);
  const [mapLoaded, setMapLoaded] = useState(false);
  useEffect(() => {
    const bbox = regions[0]?.meta.bbox;
    if (framedFirst.current || !bbox || !mapLoaded || !cameraRef.current) return;
    framedFirst.current = true;
    if (moved || request || target || openFix) return;
    cameraRef.current.fitBounds(bbox, { duration: 0 });
    // Only when the first region appears (or the map loads, if the region came first).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, mapLoaded]);

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
    if (!pointsShown || !viewport || viewport.zoom < POI_MIN_ZOOM) return EMPTY;
    try {
      const places = emergencyPlacesIn(viewport.bounds, hiddenCategories, viewport.zoom);
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
  }, [viewport, poiVersion, pointsShown, hiddenCategories]);

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

  // Navigating, the route is consumed like Google Maps': it starts where the user is on
  // it, what is behind is gone (a sliced line, not line-gradient: MapLibre measures its
  // progress in projected units and samples the gradient into a texture, too coarse to
  // cut a long route at the arrow).
  const cut = navigating && route && progress?.snapped ? progress : null;
  const routeData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!route) return EMPTY;
    const coordinates = cut?.snapped ? [[cut.snapped.lon, cut.snapped.lat], ...route.shape.slice(cut.segment + 1)] : route.shape;
    if (coordinates.length < 2) return EMPTY;
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] };
  }, [route, cut]);

  const top = insets.top + space.sm;
  // Every bottom card sits low, like the banner sits high (owner's call); the map's (i) credit button,
  // which it would cut in half, hides while one is up.
  const cardBottom = insets.bottom + space.sm;
  const bottomCard = !!target || !!selected || (!!style && !regions.length);
  // Following: the user three quarters down the map between the search bar and the
  // panel, so most of the screen shows the road ahead. The camera's padding centres
  // the user there; the arrow is drawn at the same point.
  const freeTop = navigating ? top + bannerHeight + space.md : top + 46 + space.md;
  const freeBottom = cardBottom + panelHeight + space.md;
  const userY = freeTop + Math.max(0, size.height - freeTop - freeBottom) * 0.75;
  const shift = 2 * userY - size.height;
  // Framing the trip: the free map between the top bar / banner and the panel (and the
  // "Recentrar" pill, there whenever navigating without following).
  const tripPadding = { top: freeTop + space.lg, bottom: freeBottom + space.lg + (navigating ? 44 + space.md : 0), left: 48, right: 48 + 46 };

  // Frame the whole route when the first one arrives and when the mode changes;
  // a reroute keeps the user's framing.
  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!route || !target) return;
    const key = `${target.lat},${target.lon},${route.costing}`;
    if (framedKey.current === key) return;
    framedKey.current = key;
    if (!followingRef.current) cameraRef.current?.fitBounds(route.bbox, { padding: tripPadding, duration: 900 });
    // Only when a route arrives, not when the padding changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const box = fitBox([
      [position.lon, position.lat],
      [target.lon, target.lat],
    ]);
    if (box) cameraRef.current?.fitBounds(box, { padding: tripPadding, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, position]);

  useEffect(() => {
    // Guidance ended while following: flat map again.
    if (!target && followingRef.current) cameraRef.current?.setStop({ pitch: 0, duration: 400, easing: 'ease' });
    followingRef.current = following;
  }, [following, target]);

  /** The whole trip, flat and north up. */
  async function overview() {
    setTouchedFor(target);
    const box =
      route?.bbox ??
      (target && position
        ? fitBox([
            [position.lon, position.lat],
            [target.lon, target.lat],
          ])
        : null);
    if (!box) return;
    // fitBounds fits at the current pitch and bearing and only then applies new ones
    // (MapLibre iOS): flatten and turn north first, or a tilted route doesn't fit.
    await cameraRef.current?.setStop({ pitch: 0, bearing: 0, duration: 0 }).catch(() => {});
    cameraRef.current?.fitBounds([...box], { padding: tripPadding, duration: 700 });
  }

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

  // The first time the map is in front in a session: ask for the location here, in context
  // (not in the setup wizard), and start where the user is, not where the map was left.
  // Search ranks and measures from the map's centre, so that starts from them too.
  useEffect(() => {
    if (!tabFocused || !style || openedRef.current) return;
    openedRef.current = true;
    (async () => {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && perm.status === 'undetermined') perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      setShowUser(true);
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }));
      setOpenFix({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    })().catch((e) => console.warn('[maps] cannot show the user on open', e));
  }, [tabFocused, style]);
  useEffect(() => {
    // Set once per mount.
    if (!openFix) return;
    // While the fix came, the user moved the map, opened a place or started a trip.
    if (moved || request || target) return;
    const zoom = Math.max(useMapUi.getState().viewport?.zoom ?? 0, 13);
    cameraRef.current?.flyTo({ center: [openFix.lon, openFix.lat], zoom, duration: 1200 });
    // Only when the fix arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFix]);

  // Until the camera has reached the user, the map's own dot shows where they are (the arrow sits at
  // the screen's following point, where they will be once it arrives).
  const arrived = useFollowCamera(cameraRef, following && tabFocused && size.height > 0, Math.max(0, shift), Math.max(0, -shift), northUp, setTravel);

  return (
    <View
      style={[styles.root, { backgroundColor: colors.bg }]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {style ? (
        <Map
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={style}
          logo={false}
          compass={false}
          attribution={!bottomCard}
          attributionPosition={{ bottom: space.sm, left: space.sm }}
          tintColor={colors.location}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          onRegionWillChange={safe((e) => {
            if (!e.nativeEvent.userInteraction) return;
            setMoved(true);
            setCredit(false);
            // A pan or a pinch: the user wants to look around, stop following.
            if (navigating) setTouchedFor(target);
          })}
          onRegionIsChanging={safe((e) => setBearing(Number(e.nativeEvent.bearing)))}
          onRegionDidChange={safe((e) => {
            const { center, zoom, bounds, bearing: b } = e.nativeEvent;
            setBearing(Number(b));
            setViewport({ center, zoom: Number(zoom), bounds });
          })}
          onPress={(e) => {
            // A press on the emergency or saved-place dots bubbles up here too: their sources handled it.
            // (Not through safe(): the compiler can't tell it doesn't run its argument during render. An
            // async function can't throw at the caller anyway.)
            if ('features' in e.nativeEvent || target) return;
            tapMap(e.nativeEvent).catch((err) => console.warn('[maps] tap', err));
          }}
          onLongPress={safe((e) => {
            const [lon, lat] = e.nativeEvent.lngLat;
            router.push({ pathname: '/maps/marker', params: { lat: String(lat), lon: String(lon) } });
          })}>
          <Camera ref={cameraRef} initialViewState={initialView} maxZoom={19} />
          {/* Following: the arrow (FollowArrow) stands for the user, once the camera is on them. */}
          {showUser && !arrived ? <NativeUserLocation /> : null}
          {showUser && tabFocused && !arrived ? <HeadingBeam /> : null}
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
            onPress={(e) => {
              // safe() inline: the compiler won't let a ref-reading function through it (see the map's onPress).
              try {
                const f = e.nativeEvent.features[0];
                const props = f?.properties as { osmId?: string; name?: string; kind?: string } | undefined;
                if (!f || f.geometry.type !== 'Point' || !props?.osmId) return;
                const [lon, lat] = f.geometry.coordinates;
                const show = (street: { name: string; native: string } | null) =>
                  showPlace(
                    {
                      name: props.name || t(`kind.${props.kind}`, { defaultValue: t('kind.place') }),
                      lat,
                      lon,
                      kind: props.kind,
                      layer: 'poi',
                      osmId: props.osmId,
                      street,
                    },
                    0,
                  );
                streetAt(e.nativeEvent.point, { lat, lon })
                  .catch((err) => {
                    console.warn('[maps] street', err);
                    return null;
                  })
                  .then(show)
                  .catch((err) => console.warn('[maps] emergency tap', err));
              } catch (err) {
                console.warn('[maps] event handler failed', err);
              }
            }}>
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

      {style && arrived ? <FollowBeam x={size.width / 2} y={userY} mapBearing={bearing} /> : null}
      {style && arrived ? <FollowArrow x={size.width / 2} y={userY} rotation={northUp ? (travel ?? 0) : 0} /> : null}

      {style && credit ? <MapCredit top={freeTop} /> : null}

      {style && !navigating ? (
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

      {/* Navigating: under the maneuver banner, only what matters on the road. */}
      <View style={[styles.controls, { top: navigating ? freeTop : top }]} pointerEvents="box-none">
        {/* "SOS" in red reads as the emergency button at a glance; a siren icon on the map's grey didn't. */}
        <MapFab
          testID="map-emergency"
          accessibilityLabel={t('controls.emergency')}
          onPress={() => router.push('/maps/emergency')}
          style={{ backgroundColor: colors.danger, borderColor: colors.danger }}>
          <Text variant="footnote" weight="800" color="onAccent" style={styles.sos}>
            SOS
          </Text>
        </MapFab>
        {!navigating ? (
          <>
            <MapFab icon={Layers} accessibilityLabel={t('controls.regions')} onPress={() => router.push('/maps/regions')} />
            <MapFab testID="map-points" accessibilityLabel={t('controls.points')} onPress={() => router.push('/maps/points')}>
              <PointsGlyph off={!pointsShown || hiddenCategories.length >= EMERGENCY_CATEGORIES.length} />
            </MapFab>
            <MapFab icon={MapPin} accessibilityLabel={t('controls.markers')} onPress={() => router.push('/maps/markers')} />
          </>
        ) : null}
        {Math.abs(bearing) > 1 && !following ? (
          <MapFab
            accessibilityLabel={t('controls.north')}
            onPress={() => cameraRef.current?.setStop({ bearing: 0, duration: 400, easing: 'ease' })}>
            <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
              <Navigation2 size={21} color={hues.medicine} fill={hues.medicine} strokeWidth={1.5} />
            </View>
          </MapFab>
        ) : null}
        {following ? (
          // Where north is while the map turns with the user; pressed, the map stays north up.
          <MapFab
            testID="map-north-up"
            accessibilityLabel={t('controls.northUp')}
            selected={northUp}
            onPress={() => setNorthUp(!northUp)}
            style={northUp ? { borderColor: colors.accent, borderWidth: 2 } : undefined}>
            <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
              <Navigation2 size={21} color={hues.medicine} fill={hues.medicine} strokeWidth={1.5} />
            </View>
          </MapFab>
        ) : null}
        {following ? (
          <MapFab testID="map-overview" icon={Route} accessibilityLabel={t('controls.overview')} onPress={overview} />
        ) : (
          <MapFab accessibilityLabel={t('controls.locate')} onPress={locate} active={showUser}>
            {locating ? <ActivityIndicator color={colors.accent} /> : <LocateFixed size={21} color={showUser ? colors.accent : colors.text} />}
          </MapFab>
        )}
      </View>

      {navigating && !following ? (
        <PressableScale
          testID="map-recenter"
          accessibilityRole="button"
          accessibilityLabel={t('controls.recenter')}
          onPress={() => setTouchedFor(null)}
          haptic="selection"
          style={[
            styles.recenter,
            { bottom: freeBottom, backgroundColor: colors.surface, shadowColor: colors.shadow, borderColor: colors.border },
          ]}>
          <Navigation size={18} color={colors.location} fill={colors.location} />
          <Text variant="callout">{t('controls.recenter')}</Text>
        </PressableScale>
      ) : null}

      {target ? (
        <GuidancePanel bottom={cardBottom} top={top} mapBearing={bearing} onHeight={setPanelHeight} onBannerHeight={setBannerHeight} />
      ) : selected ? (
        <PlaceCard key={`${selected.lat},${selected.lon}`} place={selected} bottom={cardBottom} />
      ) : null}

      {style && !regions.length && !target && !selected ? (
        <View style={[styles.bottom, { bottom: cardBottom }]} pointerEvents="box-none">
          <EmptyCard home={home} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * No country map yet: offers the person's country, or shows the one on its way (the
 * onboarding's kit) instead of offering it again. Its own component: download progress
 * re-renders this card, not the map.
 */
function EmptyCard({ home }: { home: Region | undefined }) {
  const { t, i18n } = useTranslation('maps');
  const { countries } = useCountries();
  const incoming = countries.find((c) => !c.map && (c.progress !== null || c.failed));
  const retry = () => {
    if (!incoming) return;
    const group = countryDownloadGroup(incoming.regionId).id;
    const records = Object.values(useDownloads.getState().records).filter((r) => recordGroup(r)?.id === group);
    if (records.length) resumeDownloads(records);
    else router.push({ pathname: '/maps/download', params: { regionId: incoming.regionId } });
  };
  return incoming ? (
    <Card style={{ gap: space.md }} testID="maps-incoming">
      <Text variant="title3">{t(incoming.failed ? 'empty.stoppedTitle' : 'empty.downloadingTitle', { name: incoming.title })}</Text>
      <Text variant="callout" color="textSecondary">
        {t(incoming.failed ? 'empty.stoppedBody' : 'empty.downloadingBody')}
      </Text>
      {incoming.progress !== null ? (
        <View style={{ gap: space.xs }}>
          <ProgressBar value={incoming.progress} />
          <Text variant="caption" color="textSecondary" tabular>
            {t('empty.percent', { pct: Math.floor(incoming.progress * 100) })}
          </Text>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {incoming.failed ? <Button title={t('regions.retry')} onPress={retry} /> : null}
        <Button title={t('empty.seeDownloads')} variant="secondary" onPress={() => router.push('/downloads')} />
      </View>
    </Card>
  ) : (
    <Card style={{ gap: space.md }} testID="maps-empty">
      <Text variant="title3">{t('empty.title')}</Text>
      <Text variant="callout" color="textSecondary">
        {t('empty.body')}
      </Text>
      <View style={{ gap: space.sm }}>
        {home ? (
          <Button
            title={t('empty.country', { name: regionName(home, i18n.language) })}
            onPress={() => router.push({ pathname: '/maps/download', params: { regionId: home.id } })}
          />
        ) : null}
        <Button title={t('empty.pickCountry')} variant={home ? 'secondary' : 'primary'} onPress={() => router.navigate('/maps/pick')} />
      </View>
    </Card>
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
  sos: { letterSpacing: 0.5 },
  recenter: {
    position: 'absolute',
    left: space.lg,
    height: 44,
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
});
