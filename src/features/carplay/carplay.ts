// CarPlay (iOS): the car's screen, modules/nomad-carplay, fed from the same guidance as the phone.
// The car shows the offline map (the style the Maps tab builds), the route and guidance's state
// (carplay-core); what the driver chooses in the car comes back here: a destination starts
// guidance by car as "take me there" does, "Ir" starts the trip, "Finalizar" ends it. The lists
// read the app's own data: saved places, the emergency points index and the offline search.
import { useContent } from '@/features/content/items';
import { ensureMapAssets } from '@/features/maps/assets';
import { parseMapIntent } from '@/features/assistant/map-intent-core';
import { alongRoute, CORRIDOR_M, corridorBox } from '@/features/maps/along-core';
import { nearestEmergencyPlaces, nearestPlacesOfKinds, placesOfKindsIn } from '@/features/maps/emergency';
import { EMERGENCY_CATEGORIES, EMERGENCY_KINDS, type EmergencyCategory } from '@/features/maps/emergency-core';
import { createFollower } from '@/features/maps/follow-core';
import { distanceMeters, type LatLon } from '@/features/maps/geo';
import { startGuidance, useGuidance } from '@/features/maps/guidance';
import { useMarkers } from '@/features/maps/markers';
import { searchPlaces } from '@/features/maps/places';
import type { Route } from '@/features/maps/routing-core';
import { buildMapStyle } from '@/features/maps/style';
import { mapFileVersion, sortMapItems, type MapItem } from '@/features/maps/useMapSources';
import i18n from '@/i18n';
import { formatDistance, measurementSystem } from '@/lib/format';
import { HEALTH_FEATURES } from '@/lib/health';
import * as Location from '@/lib/location';

import NomadCarPlay from '../../../modules/nomad-carplay';
import { carCamera, carGuidance, type CarCamera, type CarItem, type CarStrings } from './carplay-core';

/** Rows per list: CarPlay shows a dozen or so while driving. */
const LIST_LIMIT = 12;

let started = false;
let routeId = 0;
let lastRoute: Route | null = null;
let lastShape: Route['shape'] | null = null;
/** The car's navigation camera: the phone's (follow-core), with its own rhythm and bearing. */
const follower = createFollower();
let framed: unknown = null;

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

function strings(): CarStrings {
  const categories = EMERGENCY_CATEGORIES.filter((c) => c !== 'official' && (HEALTH_FEATURES || c !== 'health'));
  return {
    destinations: t('maps:carplay.destinations'),
    search: t('maps:carplay.search'),
    saved: t('maps:carplay.saved'),
    savedEmpty: t('maps:carplay.savedEmpty'),
    emergency: t('maps:carplay.emergency'),
    emergencyEmpty: t('maps:emergency.empty'),
    searchEmpty: t('maps:carplay.searchEmpty'),
    categories: categories.map((c) => [c, t(`maps:emergency.category.${c}`)]),
    go: t('maps:carplay.go'),
    cancel: t('common:actions.cancel'),
    done: t('common:actions.done'),
    end: t('maps:guidance.stop'),
    rerouting: t('maps:carplay.rerouting'),
    arrived: t('maps:guidance.arrived'),
    noLocation: t('maps:carplay.noLocation'),
    straightLine: t('maps:carplay.straightLine'),
  };
}

function pushStrings() {
  NomadCarPlay?.setStrings(JSON.stringify(strings())).catch((e) => console.warn('[carplay] strings', e));
}

async function pushStyles() {
  if (!NomadCarPlay) return;
  try {
    const assets = await ensureMapAssets();
    const { all } = sortMapItems(useContent.getState().items.filter((i) => i.kind === 'map') as MapItem[]);
    const sources = all.map((i) => ({ id: i.id, fileUri: i.fileUri, version: mapFileVersion(i) }));
    // The app is dark only (src/theme/tokens.ts), and so is the car: the same map as the phone, day or night.
    const dark = JSON.stringify(buildMapStyle({ scheme: 'dark', lang: i18n.language, assets, sources }));
    await NomadCarPlay.setStyles(dark, dark);
  } catch (e) {
    console.warn('[carplay] styles', e);
  }
}

/** Navigating, the camera's move for a new fix (null otherwise: the car keeps its glide going). */
function cameraFor(s: ReturnType<typeof useGuidance.getState>): CarCamera | null {
  if (!s.navigating) {
    if (framed) follower.reset();
    framed = null;
    return null;
  }
  if (!s.position || s.position === framed) return null;
  framed = s.position;
  const frame = follower.next(s, Date.now());
  return frame ? carCamera(frame) : null;
}

function pushGuidance() {
  if (!NomadCarPlay) return;
  const s = useGuidance.getState();
  const camera = cameraFor(s);
  if (s.route !== lastRoute) {
    lastRoute = s.route;
    if (s.route) routeId++;
  }
  const shape = s.route?.shape ?? null;
  if (shape !== lastShape) {
    lastShape = shape;
    NomadCarPlay.setRoute(shape ?? []).catch((e) => console.warn('[carplay] route', e));
  }
  const payload = carGuidance(
    {
      target: s.target,
      position: s.position,
      navigating: s.navigating,
      routing: s.routing,
      costing: s.costing,
      route: s.route,
      progress: s.progress,
      routeId,
    },
    measurementSystem(),
    {
      lineTo: (sector) => t('maps:carplay.lineTo', { dir: t(`maps:dir.${sector}`) }),
      toll: t('maps:route.toll'),
      ferry: t('maps:route.ferry'),
      via: (street) => t('maps:carplay.via', { street }),
    },
  );
  NomadCarPlay.update(JSON.stringify({ ...payload, camera })).catch((e) => console.warn('[carplay] update', e));
}

function pushAll() {
  pushStrings();
  void pushStyles();
  lastShape = null;
  // A car (re)connected mid-trip: its camera starts with one settling move.
  follower.reset();
  framed = null;
  pushGuidance();
}

/** Where the lists measure from: guidance's fix, else the car's, else the last one the phone had. */
async function here(car: Partial<LatLon>): Promise<LatLon | null> {
  const p = useGuidance.getState().position;
  if (p) return p;
  if (car.lat != null && car.lon != null) return { lat: car.lat, lon: car.lon };
  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  return last ? { lat: last.coords.latitude, lon: last.coords.longitude } : null;
}

const away = (from: LatLon | null, p: LatLon) => (from ? formatDistance(distanceMeters(from, p)) : null);

async function items(kind: string, category?: string, query?: string, car: Partial<LatLon> = {}): Promise<CarItem[]> {
  const from = await here(car);
  if (kind === 'saved') {
    const markers = useMarkers.getState().markers;
    const sorted = from ? [...markers].sort((a, b) => distanceMeters(from, a) - distanceMeters(from, b)) : markers;
    return sorted.slice(0, LIST_LIMIT).map((m) => ({ title: m.name, detail: away(from, m), lat: m.lat, lon: m.lon }));
  }
  if (kind === 'emergency' && category && from) {
    if (category === 'health' && !HEALTH_FEATURES) return [];
    const places = nearestEmergencyPlaces(category as EmergencyCategory, from, LIST_LIMIT);
    return places.map((p) => {
      const label = t(`maps:kind.${p.kind}`);
      const distance = p.distance === null ? null : formatDistance(p.distance);
      return { title: p.name ?? label, detail: [p.name ? label : null, distance].filter(Boolean).join(' · ') || null, lat: p.lat, lon: p.lon };
    });
  }
  if (kind === 'search' && query) {
    // A spoken request ("gasolinera más cercana", "busca una farmacia", "gasolineras en la ruta"): the assistant's
    // parser, so the car answers like the chat (docs/ASSISTANT_MAP_PLAN.md, #24). Anything else: the place search.
    const asked = await askedOfMap(query, from);
    if (asked) return asked;
    const results = await searchPlaces(query, from, LIST_LIMIT);
    return results.map((r) => ({ title: r.name, detail: [r.context, away(from, r)].filter(Boolean).join(' · ') || null, lat: r.lat, lon: r.lon }));
  }
  return [];
}

/** Places a spoken car search asks for, nearest first (or in route order along the trip); null: a plain search. */
async function askedOfMap(query: string, from: LatLon | null): Promise<CarItem[] | null> {
  const parsed = parseMapIntent(query);
  if (!parsed) return null;
  // The car lists keep their rule: without health features (Android) no health places (Emergencias cerca does the same).
  const intent =
    'kinds' in parsed && !HEALTH_FEATURES ? { ...parsed, kinds: parsed.kinds.filter((k) => !(k in EMERGENCY_KINDS) || EMERGENCY_KINDS[k as keyof typeof EMERGENCY_KINDS] !== 'health') } : parsed;
  if ('kinds' in intent && !intent.kinds.length) return [];
  const item = (p: { name: string | null; kind: string; lat: number; lon: number }, detail: string | null): CarItem => {
    const label = t(`maps:kind.${p.kind}`);
    return { title: p.name || label, detail: [p.name ? label : null, detail].filter(Boolean).join(' · ') || null, lat: p.lat, lon: p.lon };
  };
  if ((intent.kind === 'nearby' || intent.kind === 'goNearest') && from && ('here' in (intent.kind === 'nearby' ? intent.near : intent.from))) {
    const places = await nearestPlacesOfKinds(intent.kinds, from, LIST_LIMIT);
    return places.map((p) => item(p, p.distance === null ? null : formatDistance(p.distance)));
  }
  const route = useGuidance.getState().route;
  if (intent.kind === 'alongRoute' && !intent.to && route) {
    const corridor = CORRIDOR_M[route.costing];
    const along = alongRoute(await placesOfKindsIn(intent.kinds, corridorBox(route.shape, corridor)), route.shape, corridor);
    return along.slice(0, LIST_LIMIT).map((p) => item(p, t('maps:carplay.alongAt', { distance: formatDistance(p.alongM) })));
  }
  return null;
}

/** Started once by the feature init; nothing on Android or without the native module. */
export function startCarPlay() {
  const car = NomadCarPlay;
  if (!car || started) return;
  started = true;

  car.addListener('onConnect', () => {
    useGuidance.getState().keepInBackground(true);
    pushAll();
  });
  car.addListener('onDisconnect', () => useGuidance.getState().keepInBackground(false));
  car.addListener('onRequest', (e) => {
    items(e.kind, e.category, e.query, { lat: e.lat, lon: e.lon })
      .catch((err) => {
        console.warn('[carplay] list', err);
        return [];
      })
      .then((list) => car.answer(e.id, JSON.stringify(list)))
      .catch(() => {});
  });
  car.addListener('onPick', async (e) => {
    // The car is for driving: the trip goes by car, whatever the phone last used (switched with no
    // trip set, so the old target isn't routed again on the way).
    const g = useGuidance.getState();
    if (g.costing !== 'auto') {
      if (g.target) g.stop();
      g.setCosting('auto');
    }
    // Location off: the phone shows why (startGuidance), the car says where to look.
    if (!(await startGuidance({ name: e.name, lat: e.lat, lon: e.lon }))) {
      car.alert(t('maps:carplay.noPermission'), t('common:actions.close')).catch(() => {});
    }
  });
  car.addListener('onStart', () => useGuidance.getState().startNavigation());
  car.addListener('onEnd', () => useGuidance.getState().stop());

  // Not the compass (many times a second, and the car goes by the GPS course).
  useGuidance.subscribe((s, prev) => {
    if (!car.isConnected()) return;
    if (
      s.target !== prev.target ||
      s.position !== prev.position ||
      s.navigating !== prev.navigating ||
      s.routing !== prev.routing ||
      s.route !== prev.route ||
      s.progress !== prev.progress
    )
      pushGuidance();
  });
  // A map installed or removed, or the language changed: the car's style follows.
  useContent.subscribe((s, prev) => {
    if (s.items !== prev.items && car.isConnected()) void pushStyles();
  });
  i18n.on('languageChanged', () => {
    if (car.isConnected()) pushAll();
  });
  // The car may have connected before JS started (opened from CarPlay).
  if (car.isConnected()) {
    useGuidance.getState().keepInBackground(true);
    pushAll();
  }
}
