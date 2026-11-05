// The assistant's map answers, the app side: runs a MapIntent (map-intent-core.ts) against the map data
// on the device (place index, emergency points, routing packs, markers, the family plan) and returns the
// card shown in the chat. Nothing here is written by a model: names, distances, times and phones come
// from the data (docs/ASSISTANT_MAP_PLAN.md). Null means "not a map answer after all" (a weak intent whose
// place the index doesn't know): the message goes the normal way.
import { current, inPolygons, sourcesFor, visible } from '@/features/alerts/alerts-core';
import { alertKey, alertSubtitle, alertTitle, officialText } from '@/features/alerts/present';
import { useAlertsState } from '@/features/alerts/state';
import { alongRoute, CORRIDOR_M, corridorBox, lastWithin, routeEntersRings } from '@/features/maps/along-core';
import { currentCountries } from '@/features/maps/countries';
import {
  emergencyNumber,
  hasEmergencyPoints,
  nearestNamedPlace,
  nearestPlacesOfKinds,
  noteHere,
  numberFor,
  placesOfKindsIn,
  pointsFetchedAt,
  useHereCountry,
  type EmergencyPlace,
} from '@/features/maps/emergency';
import { bearingDegrees, distanceMeters, formatLatLon, type LatLon } from '@/features/maps/geo';
import { useGuidance } from '@/features/maps/guidance';
import { openState, type OpenState } from '@/features/maps/hours-core';
import { kindLabel } from '@/features/maps/labels';
import { useMarkers } from '@/features/maps/markers';
import { addressNear, hasSearchIndex, nearestLocalityPoint, searchPlaces, type SearchResult } from '@/features/maps/places';
import { NAME_SEP, nameKey } from '@/features/maps/places-core';
import { usePreparing, whenPrepared } from '@/features/maps/prepare';
import { REGIONS, regionName } from '@/features/maps/regions';
import { useRoutePreview } from '@/features/maps/route-preview';
import { computeRoute } from '@/features/maps/routing';
import type { Costing } from '@/features/maps/routing-core';
import { useMapUi } from '@/features/maps/store';
import { sunTimes, type SunTimes } from '@/features/maps/sun-core';
import { usePrepare } from '@/features/prepare/store';
import i18n from '@/i18n';
import { formatDistance, formatDuration } from '@/lib/format';
import * as Location from '@/lib/location';
import { useSettings } from '@/stores/settings';

import { placeCandidates, type MapIntent, type PlaceRef, type PreviousMap } from './map-intent-core';

/** A place in a card: a result, a route's end, a landmark. */
export type MapResult = {
  /** '' for an unnamed point (a fountain): the card shows its kind. */
  name: string;
  kind: string | null;
  lat: number;
  lon: number;
  osmId?: string | null;
  /** Town or neighbourhood around it. */
  context?: string | null;
  phone?: string | null;
  hours?: string | null;
  emergency?: 0 | 1 | null;
  /** Straight line from the card's anchor, metres. */
  distance?: number | null;
  /** By road, when a routing pack covers it. */
  travel?: Travel | null;
  /** From its opening hours at answer time (hours-core.ts); null when they aren't understood. */
  openNow?: OpenState;
};

export type Travel = { seconds: number; meters: number; costing: Costing };

/** Where a card's results are measured from. */
export type MapAnchor = { name: string; here: boolean; lat: number; lon: number };

export type HereFix = { lat: number; lon: number; accuracy: number | null; at: number };

export type MapCard =
  | {
      type: 'places';
      kinds: string[];
      anchor: MapAnchor;
      results: MapResult[];
      /** "Llévame al … más cercano": ordered by travel time, the first one is the answer. */
      go?: boolean;
      /** "Llama a …": the call button leads. */
      call?: boolean;
      costing?: Costing;
      onDuty?: boolean;
      open?: boolean;
      /** Last Overpass fetch of the points (ms); null: points from the map tiles only. */
      pointsAt: number | null;
    }
  | { type: 'route'; from: MapAnchor; to: MapResult; costing: Costing; travel: Travel | null; straight: number; askOnly: boolean }
  | { type: 'place'; place: MapResult; from: MapAnchor | null }
  /**
   * `stale`: the fix was over a minute old when answered (its age is shown). `lost`: "estoy perdido": the guide's
   * advice first (stay where you are, call), the nearest town as a fact (no "walk there"), today's light.
   */
  | {
      type: 'here';
      fix: HereFix;
      stale: boolean;
      locality: string | null;
      landmark: MapResult | null;
      number: string;
      forCall: boolean;
      lost?: { town: (MapResult & { bearing: number }) | null; sun: SunTimes };
    }
  | { type: 'save'; fix: HereFix; name: string }
  | { type: 'meeting'; go: boolean; from: MapAnchor | null; points: MeetingCardPoint[] }
  | { type: 'sun'; anchor: MapAnchor; sun: SunTimes; to?: MapResult; travel?: Travel | null; arrival?: number | null }
  | { type: 'alerts'; place: string | null; enabled: boolean; checkedAt: number | null; quakes: boolean; items: AlertItem[] }
  // Phase 3
  | { type: 'along'; kinds: string[]; to: string; from: MapAnchor; costing: Costing; routeM: number; results: AlongResult[]; range?: { km: number; lastId: string | null; beyond: boolean } }
  | {
      type: 'routeAlerts';
      to: string;
      from: MapAnchor;
      dest: LatLon;
      costing: Costing;
      enabled: boolean;
      crossing: (AlertItem & { atM: number; rings: number[][] })[];
      /** In force in the country with no drawn area (MeteoAlarm zones): can't be checked against a route. */
      undrawn: number;
    }
  | { type: 'evacuate'; enabled: boolean; alerts: (AlertItem & { instruction: string })[]; results: MapResult[]; costing: Costing }
  /** Under a library answer: the towns and cities it names that the maps have ("Ver Toledo en el mapa"). */
  | { type: 'chips'; places: MapResult[] }
  | {
      type: 'trip';
      region: { id: string; name: string };
      map: boolean;
      routing: boolean;
      downloading: boolean;
      number: string | null;
      embassies: MapResult[];
      home: string | null;
    }
  | { type: 'share'; fix: HereFix; contact: { name: string; phone: string } | null; wanted: string | null }
  | { type: 'emergency'; number: string; country: string | null }
  | { type: 'choose'; intent: MapIntent; slot: Slot; query: string; options: (MapAnchor & { context: string | null })[] }
  | { type: 'missing'; reason: MissingReason; query?: string; kinds?: string[]; names?: string[] };

export type MissingReason = 'noLocation' | 'noPlace' | 'noIndex' | 'noPoints' | 'noResults' | 'preparing' | 'noSaved' | 'noMeeting' | 'noRoute';

/** A point along a route: how far along it from the start, and off it. */
export type AlongResult = MapResult & { alongM: number; offM: number };

/** A meeting point of the family plan as the card shows it (lat/lon null: only the written place). */
export type MeetingCardPoint = { slot: 'primary' | 'secondary'; place: string; details: string; lat: number | null; lon: number | null; distance: number | null };

/** An official alert in force, as answered (the card links to its screen by `key`). */
export type AlertItem = { key: string; title: string; subtitle: string; level: string | null };

type Slot = 'near' | 'from' | 'to';

/** What a follow-up needs from the card a message carries ("¿y en Getafe?", "llévame a la segunda"). */
export function previousOf(card: MapCard | null | undefined): PreviousMap | null {
  if (!card) return null;
  if (card.type === 'places') return { kinds: card.kinds, count: card.results.length };
  if (card.type === 'route' || card.type === 'place' || (card.type === 'sun' && card.to)) return { count: 1 };
  if (card.type === 'chips') return { count: card.places.length };
  return null;
}

// ---------------------------------------------------------------------------
// Position

/** A fix this fresh is used as is; else a new one is asked for. */
const FIX_MAX_AGE = 2 * 60_000;
const FIX_TIMEOUT = 10_000;

/** The person's position, asking for permission when it can; null when denied or no fix comes. */
export async function currentFix(): Promise<HereFix | null> {
  const g = useGuidance.getState().position;
  if (g && Date.now() - g.at < 30_000) return { lat: g.lat, lon: g.lon, accuracy: g.accuracy, at: g.at };
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE });
    const pos =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT)),
      ]));
    if (!pos) return null;
    noteHere(pos.coords.latitude, pos.coords.longitude);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, at: pos.timestamp };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Places

type Resolved = { anchor: MapAnchor; result?: MapResult } | { choose: (MapAnchor & { context: string | null })[] } | { missing: MissingReason };

function hereFromViewport(): LatLon | null {
  return viewportCenter();
}

function viewportCenter(): LatLon | null {
  const c = useMapUi.getState().viewport?.center;
  return c ? { lon: c[0], lat: c[1] } : null;
}

const asResult = (p: EmergencyPlace): MapResult => ({
  name: p.name ?? '',
  kind: p.kind,
  lat: p.lat,
  lon: p.lon,
  osmId: p.osmId,
  phone: p.phone,
  hours: p.openingHours,
  openNow: openState(p.openingHours, new Date()),
  emergency: p.emergency,
  distance: p.distance,
});

/** A saved place by name: a map marker ("el coche", "casa") or the family plan's meeting point. */
function savedPlace(text: string): MapResult | null {
  const key = nameKey(text.replace(/^(?:mi|mis|my|nuestro|nuestra|our)\s+/, ''));
  if (!key) return null;
  const marker = useMarkers.getState().markers.find((m) => {
    const k = nameKey(m.name.replace(/^(?:mi|mis|my|nuestro|nuestra|our)\s+/i, ''));
    return k === key;
  });
  if (marker) return { name: marker.name, kind: 'marker', lat: marker.lat, lon: marker.lon, context: marker.note };
  if (/^(?:punto (?:de )?encuentro|meeting point)/.test(key)) {
    const m = usePrepare.getState().meeting;
    const point = m.primary?.lat != null ? m.primary : m.secondary?.lat != null ? m.secondary : null;
    if (point && point.lat != null && point.lon != null) return { name: point.place, kind: 'marker', lat: point.lat, lon: point.lon, context: point.details || null };
  }
  return null;
}

/** Index hits that are this name exactly (accents, case and "de/la" aside). */
function exactHits(hits: SearchResult[], text: string): SearchResult[] {
  const key = nameKey(text);
  // `names` holds the variants (native, es, en, others) separated by NAME_SEP.
  return hits.filter((h) => nameKey(h.name) === key || h.names.split(NAME_SEP).some((n) => n && nameKey(n) === key));
}

/** Two towns of one name this far apart are different places: ask which. */
const AMBIGUOUS_M = 20_000;

async function lookUp(text: string, near: LatLon | null, strong: boolean): Promise<Resolved> {
  const saved = savedPlace(text);
  if (saved) return { anchor: { name: saved.name, here: false, lat: saved.lat, lon: saved.lon }, result: saved };
  if (!hasSearchIndex()) return { missing: 'noIndex' };
  const tries = [text, text.replace(/^(?:el|la|los|las|the)\s+/, '')].filter((t, i, a) => t && a.indexOf(t) === i);
  for (const q of tries) {
    const hits = await searchPlaces(q, near ?? viewportCenter(), 12);
    if (!hits.length) continue;
    const exact = exactHits(hits, q);
    const towns = exact.filter((h) => h.layer === 'place');
    if (towns.length > 1) {
      // The most important ones only ("Villanueva" the town, not every hamlet of that name).
      const best = Math.min(...towns.map((h) => h.rank));
      const top = towns.filter((h) => h.rank <= best + 1);
      const apart = top.filter((h, i) => top.findIndex((o) => distanceMeters(o, h) < AMBIGUOUS_M) === i);
      if (apart.length > 1) {
        return {
          choose: await Promise.all(
            apart.slice(0, 4).map(async (h) => ({ name: h.name, here: false, lat: h.lat, lon: h.lon, context: (await addressNear(h, null)).locality })),
          ),
        };
      }
    }
    // Weak (a town a model wrote): a town whose name holds it as a whole word ("Villalba" → "Collado Villalba").
    const key = ` ${nameKey(q)} `;
    const loose = hits.find((h) => h.layer === 'place' && ` ${nameKey(h.name)} `.includes(key));
    const pick = towns[0] ?? exact[0] ?? (strong || /\d/.test(q) ? hits[0] : loose ?? null);
    if (!pick) continue;
    const result: MapResult = { name: pick.name, kind: pick.kind, lat: pick.lat, lon: pick.lon, context: pick.context };
    return { anchor: { name: pick.name, here: false, lat: pick.lat, lon: pick.lon }, result };
  }
  return { missing: 'noPlace' };
}

async function resolve(ref: PlaceRef, previous: MapCard | null, strong: boolean, here: () => Promise<HereFix | null>): Promise<Resolved> {
  if ('here' in ref) {
    const fix = await here();
    return fix ? { anchor: { name: i18n.t('assistant:map.here'), here: true, lat: fix.lat, lon: fix.lon } } : { missing: 'noLocation' };
  }
  if ('coords' in ref) {
    const name = ref.name ?? formatLatLon(ref.coords.lat, ref.coords.lon);
    return { anchor: { name, here: false, ...ref.coords }, result: { name, kind: null, ...ref.coords } };
  }
  if ('previous' in ref) {
    const list =
      previous?.type === 'places'
        ? previous.results
        : previous?.type === 'route'
          ? [previous.to]
          : previous?.type === 'place'
            ? [previous.place]
            : previous?.type === 'sun' && previous.to
              ? [previous.to]
              : previous?.type === 'chips'
                ? previous.places
                : [];
    const r = ref.previous < 0 ? list[list.length + ref.previous] : list[ref.previous];
    if (!r) return { missing: 'noPlace' };
    return { anchor: { name: r.name, here: false, lat: r.lat, lon: r.lon }, result: r };
  }
  const near = await hereIfGranted();
  return lookUp(ref.text, near, strong);
}

/** The position only when location is already allowed: a place lookup never asks for it. */
async function hereIfGranted(): Promise<LatLon | null> {
  const g = useGuidance.getState().position;
  if (g) return g;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
    return last ? { lat: last.coords.latitude, lon: last.coords.longitude } : null;
  } catch {
    return null;
  }
}

const refText = (ref: PlaceRef) => ('text' in ref ? ref.text : '');

// ---------------------------------------------------------------------------
// Routes

/** Under this, a trip without a stated mode is on foot. */
const WALKABLE_M = 1_500;
/** How long "take me to the nearest X" may spend routing its candidates. */
const ROUTE_BUDGET_MS = 6_000;

async function travel(from: LatLon, to: LatLon, costing: Costing): Promise<Travel | null> {
  try {
    const r = await computeRoute(from, to, costing);
    return { seconds: r.durationS, meters: r.distanceM, costing };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Running an intent

/**
 * Name filter for "la embajada de España": OSM names embassies in the host country's language ("Embajada de España",
 * "Embassy of Spain", "Ambassade d'Espagne"). The country's Spanish and English names (regions.json) plus a few
 * other languages for common ones. OSM's `country` tag on diplomatic points would be exact, but the country packs'
 * point files don't carry it (a pipeline change and every pack rebuilt: docs/ASSISTANT_MAP_PLAN.md).
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  espana: ['espana', 'spain', 'espagne', 'spanien', 'spagna', 'espanha'],
  mexico: ['mexico', 'mexique', 'mexiko', 'messico'],
  argentina: ['argentina', 'argentine', 'argentinien'],
  colombia: ['colombia', 'colombie', 'kolumbien'],
  chile: ['chile', 'chili'],
  peru: ['peru', 'perou'],
  francia: ['francia', 'france', 'frankreich'],
  alemania: ['alemania', 'germany', 'allemagne', 'deutschland'],
  italia: ['italia', 'italy', 'italie', 'italien'],
  portugal: ['portugal'],
  'reino unido': ['reino unido', 'united kingdom', 'british', 'royaume uni'],
  'estados unidos': ['estados unidos', 'united states', 'usa', 'etats unis', 'american'],
};

function nameFilter(name: string | undefined): ((p: EmergencyPlace) => boolean) | undefined {
  if (!name) return undefined;
  const key = nameKey(name);
  const region = REGIONS.find((r) => r.type === 'country' && (nameKey(r.name.es) === key || nameKey(r.name.en) === key));
  const aliases = [...new Set([name, ...(region ? [region.name.es, region.name.en] : []), ...(COUNTRY_ALIASES[name] ?? [])].map(nameKey))];
  return (p) => {
    const hay = nameKey(`${p.name ?? ''} ${p.operator ?? ''}`);
    return aliases.some((a) => hay.includes(a));
  };
}

async function withContext(results: MapResult[]): Promise<MapResult[]> {
  return Promise.all(results.map(async (r) => ({ ...r, context: r.context ?? (await addressNear(r, null)).locality })));
}

const preparing = () => Object.keys(usePreparing.getState().items).length > 0;
/** How long an answer waits for maps still being indexed or imported (right after a download or a launch). */
const PREPARE_WAIT_MS = 20_000;

/** Runs an intent. `previous`: the conversation's last map card (follow-ups). */
export async function runMapIntent(intent: MapIntent, previous: MapCard | null): Promise<MapCard | null> {
  // A map just downloaded (or a launch's catch-up) is indexed and its points imported in the background:
  // its places and points aren't there yet. Wait a little rather than say they don't exist.
  if (intent.kind !== 'callEmergency' && intent.kind !== 'shareLocation' && preparing()) {
    await Promise.race([whenPrepared(), new Promise((resolve) => setTimeout(resolve, PREPARE_WAIT_MS))]);
  }
  let fix: HereFix | null | undefined;
  const here = async () => (fix === undefined ? (fix = await currentFix()) : fix);
  const fail = (reason: MissingReason, extra: { query?: string; kinds?: string[] } = {}): MapCard | null => {
    // Still preparing after the wait: "not found" would be wrong, say why instead.
    const why: MissingReason = reason !== 'noLocation' && preparing() ? 'preparing' : reason;
    return intent.strong || why === 'noLocation' || why === 'preparing' ? { type: 'missing', reason: why, ...extra } : null;
  };
  const choose = (slot: Slot, ref: PlaceRef, options: (MapAnchor & { context: string | null })[]): MapCard => ({
    type: 'choose',
    intent,
    slot,
    query: refText(ref),
    options,
  });

  switch (intent.kind) {
    case 'lost':
    case 'whereAmI': {
      const f = await here();
      if (!f) return { type: 'missing', reason: 'noLocation' };
      if (intent.kind === 'lost') {
        const [{ locality }, landmark, town] = await Promise.all([addressNear(f, null), nearestNamedPlace(f, 400), nearestLocalityPoint(f)]);
        return {
          type: 'here',
          fix: f,
          stale: Date.now() - f.at > 60_000,
          locality,
          landmark: landmark ? asResult(landmark) : null,
          number: emergencyNumber().number,
          forCall: true,
          lost: {
            town: town ? { name: town.name, kind: 'locality', lat: town.lat, lon: town.lon, distance: distanceMeters(f, town), bearing: bearingDegrees(f, town) } : null,
            sun: sunTimes(f.lat, f.lon, new Date()),
          },
        };
      }
      const [{ locality }, landmark] = await Promise.all([addressNear(f, null), nearestNamedPlace(f, 400)]);
      return { type: 'here', fix: f, stale: Date.now() - f.at > 60_000, locality, landmark: landmark ? asResult(landmark) : null, number: emergencyNumber().number, forCall: intent.forCall };
    }
    case 'shareLocation': {
      const f = await here();
      if (!f) return { type: 'missing', reason: 'noLocation' };
      let contact: { name: string; phone: string } | null = null;
      if (intent.to) {
        const key = nameKey(intent.to);
        const c = usePrepare
          .getState()
          .contacts.find((x) => x.phone && (nameKey(x.name) === key || nameKey(x.relation) === key || nameKey(x.name).split(' ')[0] === key));
        if (c) contact = { name: c.name, phone: c.phone };
      }
      return { type: 'share', fix: f, contact, wanted: intent.to ?? null };
    }
    case 'callEmergency': {
      const e = emergencyNumber();
      return { type: 'emergency', number: e.number, country: e.country };
    }
    case 'saveHere': {
      const f = await here();
      if (!f) return { type: 'missing', reason: 'noLocation' };
      return { type: 'save', fix: f, name: intent.name.charAt(0).toUpperCase() + intent.name.slice(1) };
    }
    case 'saved': {
      for (const n of intent.names) {
        const saved = savedPlace(n);
        if (!saved) continue;
        const near = await hereIfGranted();
        const place = { ...saved, distance: near ? distanceMeters(near, saved) : null };
        return { type: 'place', place, from: near ? { name: i18n.t('assistant:map.here'), here: true, ...near } : null };
      }
      return { type: 'missing', reason: 'noSaved', names: useMarkers.getState().markers.map((m) => m.name).slice(0, 8) };
    }
    case 'meetingPoint': {
      const m = usePrepare.getState().meeting;
      const near = await hereIfGranted();
      const points = (['primary', 'secondary'] as const)
        .map((slot) => ({ slot, p: m[slot] }))
        .filter((x): x is { slot: 'primary' | 'secondary'; p: NonNullable<typeof x.p> } => !!x.p && !!(x.p.place || x.p.lat != null))
        .map(({ slot, p }) => ({
          slot,
          place: p.place,
          details: p.details,
          lat: p.lat,
          lon: p.lon,
          distance: near && p.lat != null && p.lon != null ? distanceMeters(near, { lat: p.lat, lon: p.lon }) : null,
        }));
      if (!points.length) return { type: 'missing', reason: 'noMeeting' };
      return { type: 'meeting', go: intent.go, from: near ? { name: i18n.t('assistant:map.here'), here: true, ...near } : null, points };
    }
    case 'sun': {
      const f = await here();
      // Without a position, the light where the map is (still right within a few minutes for a whole region).
      const at = f ?? hereFromViewport();
      if (!at) return { type: 'missing', reason: 'noLocation' };
      const anchor: MapAnchor = { name: f ? i18n.t('assistant:map.here') : i18n.t('assistant:map.mapCentre'), here: !!f, lat: at.lat, lon: at.lon };
      const sun = sunTimes(at.lat, at.lon, new Date());
      if (!intent.to) return { type: 'sun', anchor, sun };
      const to = await resolve(intent.to, previous, true, here);
      if ('choose' in to) return choose('to', intent.to, to.choose);
      if ('missing' in to) return fail(to.missing, { query: refText(intent.to) });
      const costing = intent.costing ?? 'pedestrian';
      const t = f ? await travel(f, to.anchor, costing) : null;
      const end = to.result ?? { name: to.anchor.name, kind: null, lat: to.anchor.lat, lon: to.anchor.lon };
      const [withCtx] = await withContext([{ ...end, distance: distanceMeters(at, to.anchor) }]);
      // Without a route, a straight line at walking pace is no promise: no arrival time then.
      return { type: 'sun', anchor, sun, to: withCtx, travel: t, arrival: t ? Date.now() + t.seconds * 1000 : null };
    }
    case 'alerts': {
      const st = useAlertsState.getState();
      let pos: LatLon | null = null;
      let placeName: string | null = null;
      if ('here' in intent.place) {
        const f = await hereIfGranted();
        pos = f ?? (st.position ? { lat: st.position.lat, lon: st.position.lon } : null);
      } else {
        const r = await resolve(intent.place, previous, true, here);
        if ('choose' in r) return choose('near', intent.place, r.choose);
        if ('missing' in r) return fail(r.missing, { query: refText(intent.place) });
        pos = r.anchor;
        placeName = r.anchor.name;
      }
      const country = useHereCountry.getState().id ?? useSettings.getState().country;
      const all = sourcesFor(country).flatMap((src) => st.cache.sources[src]?.alerts ?? []);
      const shown = visible(all, { pos, country }, Date.now()).alerts.filter((a) => !intent.quakes || a.kind === 'quake');
      return {
        type: 'alerts',
        place: placeName,
        enabled: st.enabled,
        checkedAt: st.cache.checkedAt,
        quakes: intent.quakes,
        items: shown.slice(0, 6).map((a) => ({ key: alertKey(a), title: alertTitle(a), subtitle: alertSubtitle(a, pos), level: a.level ?? null })),
      };
    }
    case 'whereIs': {
      const r = await resolve(intent.place, previous, intent.strong, here);
      if ('choose' in r) return choose('near', intent.place, r.choose);
      if ('missing' in r) return intent.strong ? fail(r.missing, { query: refText(intent.place) }) : null;
      const near = await hereIfGranted();
      const place = { ...r.result!, distance: near ? distanceMeters(near, r.result!) : null };
      return { type: 'place', place: (await withContext([place]))[0], from: near ? { name: i18n.t('assistant:map.here'), here: true, ...near } : null };
    }
    case 'nearby':
    case 'call': {
      const r = await resolve(intent.near, previous, intent.strong, here);
      if ('choose' in r) return choose('near', intent.near, r.choose);
      if ('missing' in r) return fail(r.missing, { query: refText(intent.near), kinds: intent.kinds });
      if (!hasPoints()) return fail('noPoints', { kinds: intent.kinds });
      const per = intent.kinds.length > 1 ? 3 : 5;
      const accept = intent.kind === 'nearby' ? nameFilter(intent.name) : undefined;
      // "Abierta ahora": more candidates, the open ones first, unknown hours next, the closed ones last.
      const wantOpen = intent.kind === 'nearby' && (intent.open || intent.onDuty);
      const groups = await Promise.all(intent.kinds.map((k) => nearestPlacesOfKinds([k], r.anchor, wantOpen ? per * 3 : per, accept)));
      const now = new Date();
      const rank = (o: OpenState | undefined) => (o === 'open' ? 0 : o === 'closed' ? 2 : 1);
      const results = groups
        .map((g) => {
          const rs = g.map(asResult).map((x) => ({ ...x, openNow: openState(x.hours, now) }));
          return wantOpen ? rs.sort((a, b) => rank(a.openNow) - rank(b.openNow)).slice(0, per) : rs;
        })
        .flat();
      if (!results.length) return fail('noResults', { query: r.anchor.name, kinds: intent.kinds });
      return {
        type: 'places',
        kinds: intent.kinds,
        anchor: r.anchor,
        results: await withContext(results),
        ...(intent.kind === 'call' ? { call: true } : {}),
        ...(intent.kind === 'nearby' && intent.onDuty ? { onDuty: true } : {}),
        ...(intent.kind === 'nearby' && intent.open ? { open: true } : {}),
        pointsAt: pointsFetchedAt(),
      };
    }
    case 'goNearest': {
      const r = await resolve(intent.from, previous, true, here);
      if ('choose' in r) return choose('from', intent.from, r.choose);
      if ('missing' in r) return fail(r.missing, { query: refText(intent.from), kinds: intent.kinds });
      if (!hasPoints()) return fail('noPoints', { kinds: intent.kinds });
      const candidates = (await nearestPlacesOfKinds(intent.kinds, r.anchor, 5)).map(asResult);
      if (!candidates.length) return fail('noResults', { query: r.anchor.name, kinds: intent.kinds });
      const costing: Costing = intent.costing ?? ((candidates[0].distance ?? 0) < WALKABLE_M ? 'pedestrian' : 'auto');
      // The closest in a straight line is often not the quickest (a motorway, a river): route each, in turn.
      const started = Date.now();
      for (const c of candidates) {
        if (Date.now() - started > ROUTE_BUDGET_MS) break;
        c.travel = await travel(r.anchor, c, costing);
      }
      candidates.sort((a, b) => {
        if (a.travel && b.travel) {
          // Hospitals with an emergency department lead among similar times.
          const er = (x: MapResult) => (x.kind === 'hospital' && x.emergency === 1 ? -120 : 0);
          return a.travel.seconds + er(a) - (b.travel.seconds + er(b));
        }
        if (a.travel || b.travel) return a.travel ? -1 : 1;
        return (a.distance ?? 0) - (b.distance ?? 0);
      });
      return { type: 'places', kinds: intent.kinds, anchor: r.anchor, results: await withContext(candidates), go: true, costing, pointsAt: pointsFetchedAt() };
    }
    case 'alongRoute': {
      const r = await routeFor(intent.to, previous, here);
      if (typeof r === 'string') return { type: 'missing', reason: r, query: intent.to ? refText(intent.to) : undefined, kinds: intent.kinds };
      if ('choose' in r) return choose('to', intent.to!, r.choose);
      const corridor = CORRIDOR_M[r.costing];
      const points = (await placesOfKindsIn(intent.kinds, corridorBox(r.shape, corridor))).map(asResult);
      const along = alongRoute(points, r.shape, corridor);
      // The ends' own few hundred metres aren't "on the way".
      const onWay = along.filter((p) => p.alongM > 200 && p.alongM < r.meters - 200);
      let results: AlongResult[];
      let range: { km: number; lastId: string | null; beyond: boolean } | undefined;
      if (intent.rangeKm) {
        const { last, beyond } = lastWithin(onWay, intent.rangeKm * 1000);
        range = { km: intent.rangeKm, lastId: last?.osmId ?? null, beyond };
        // The stops up to the range and the first two after it.
        const within = onWay.filter((p) => p.alongM <= intent.rangeKm! * 1000).slice(-3);
        results = [...within, ...onWay.filter((p) => p.alongM > intent.rangeKm! * 1000).slice(0, 2)];
      } else {
        // A long trip: spread over it rather than the first six in the first kilometres.
        const step = Math.max(1, Math.ceil(onWay.length / 6));
        results = onWay.filter((_, i) => i % step === 0).slice(0, 6);
      }
      return { type: 'along', kinds: intent.kinds, to: r.toName, from: r.from, costing: r.costing, routeM: r.meters, results: await withContext(results) as AlongResult[], ...(range ? { range } : {}) };
    }
    case 'routeAlerts': {
      const r = await routeFor(intent.to, previous, here);
      if (typeof r === 'string') return { type: 'missing', reason: r, query: intent.to ? refText(intent.to) : undefined };
      if ('choose' in r) return choose('to', intent.to!, r.choose);
      const { st, all } = liveAlerts();
      const crossing = all
        .filter((a) => a.polygons?.length)
        .map((a) => ({ a, atM: routeEntersRings(r.shape, a.polygons!) }))
        .filter((x): x is { a: (typeof all)[number]; atM: number } => x.atM !== null)
        .map(({ a, atM }) => ({ key: alertKey(a), title: alertTitle(a), subtitle: alertSubtitle(a, r.from), level: a.level ?? null, atM, rings: a.polygons! }));
      const undrawn = all.filter((a) => !a.polygons?.length && a.kind !== 'quake').length;
      return { type: 'routeAlerts', to: r.toName, from: r.from, dest: r.dest, costing: r.costing, enabled: st.enabled, crossing, undrawn };
    }
    case 'evacuate': {
      const f = await here();
      if (!f) return { type: 'missing', reason: 'noLocation' };
      const { st, all } = liveAlerts();
      const covering = all.filter((a) => a.polygons?.length && inPolygons(a.polygons, f));
      if (!covering.length) return { type: 'evacuate', enabled: st.enabled, alerts: [], results: [], costing: 'auto' };
      const rings = covering.flatMap((a) => a.polygons!);
      // The nearest shelters and assembly points outside every area that covers you, then the nearest towns' centres.
      const candidates = (await nearestPlacesOfKinds(['shelter', 'assembly_point'], f, 40)).map(asResult).filter((p) => !inPolygons(rings, p));
      const out = candidates.slice(0, 3);
      if (out.length < 3) {
        const town = await nearestLocalityPoint(f);
        if (town && !inPolygons(rings, town)) out.push({ name: town.name, kind: 'locality', lat: town.lat, lon: town.lon, distance: distanceMeters(f, town) });
      }
      const costing: Costing = (out[0]?.distance ?? 0) < 3000 ? 'pedestrian' : 'auto';
      return {
        type: 'evacuate',
        enabled: st.enabled,
        alerts: covering.slice(0, 3).map((a) => ({ key: alertKey(a), title: alertTitle(a), subtitle: alertSubtitle(a, f), level: a.level ?? null, instruction: officialText(a).instruction })),
        results: await withContext(out),
        costing,
      };
    }
    case 'trip': {
      const key = nameKey(intent.place);
      const region = REGIONS.find((r) => nameKey(r.name.es) === key || nameKey(r.name.en) === key);
      if (!region) return null;
      const countryId = region.parent ?? region.id;
      const state = currentCountries().countries.find((c) => c.regionId === countryId || c.regions.includes(region.id));
      const homeId = useSettings.getState().country;
      const home = homeId ? REGIONS.find((r) => r.id === homeId) : undefined;
      let embassies: MapResult[] = [];
      if (state?.map && home && home.id !== countryId) {
        const filter = nameFilter(nameKey(home.name.es));
        embassies = (await placesOfKindsIn(['embassy'], region.bbox as [number, number, number, number], 500)).filter((p) => !filter || filter(p)).slice(0, 3).map(asResult);
        embassies = await withContext(embassies);
      }
      return {
        type: 'trip',
        // The download screen takes the country (a country in regions picks its regions there).
        region: { id: countryId, name: regionName(region, i18n.language) },
        map: !!state?.map,
        routing: !!state?.packs.length,
        downloading: state?.progress != null,
        number: numberFor(countryId)?.number ?? null,
        embassies,
        home: home && home.id !== countryId ? regionName(home, i18n.language) : null,
      };
    }
    case 'aboutHere':
      // chats.ts asks the library instead (aboutHereQuestion); reaching here means it couldn't place you.
      return { type: 'missing', reason: 'noLocation' };
    case 'route': {
      const from = await resolve(intent.from, previous, intent.strong, here);
      if ('choose' in from) return choose('from', intent.from, from.choose);
      if ('missing' in from) return fail(from.missing, { query: refText(intent.from) });
      const to = await resolve(intent.to, previous, intent.strong, here);
      if ('choose' in to) return choose('to', intent.to, to.choose);
      if ('missing' in to) return fail(to.missing, { query: refText(intent.to) });
      const straight = distanceMeters(from.anchor, to.anchor);
      const costing: Costing = intent.costing ?? (straight < WALKABLE_M ? 'pedestrian' : 'auto');
      const end = to.result ?? { name: to.anchor.name, kind: null, lat: to.anchor.lat, lon: to.anchor.lon };
      const [t, [withCtx]] = await Promise.all([travel(from.anchor, to.anchor, costing), withContext([end])]);
      return { type: 'route', from: from.anchor, to: { ...withCtx, distance: straight }, costing, travel: t, straight, askOnly: intent.askOnly };
    }
  }
}

/** A route to look along: to `to` from here (computed), else the one on the map (guidance, or a preview). */
async function routeFor(
  to: PlaceRef | undefined,
  previous: MapCard | null,
  here: () => Promise<HereFix | null>,
  costing: Costing = 'auto',
): Promise<{ shape: [number, number][]; from: MapAnchor; dest: LatLon; toName: string; costing: Costing; meters: number } | MissingReason | { choose: (MapAnchor & { context: string | null })[] }> {
  if (to) {
    const f = await here();
    if (!f) return 'noLocation';
    const r = await resolve(to, previous, true, here);
    if ('choose' in r) return { choose: r.choose };
    if ('missing' in r) return r.missing;
    try {
      const route = await computeRoute(f, r.anchor, costing);
      return { shape: route.shape, from: { name: i18n.t('assistant:map.here'), here: true, lat: f.lat, lon: f.lon }, dest: r.anchor, toName: r.anchor.name, costing, meters: route.distanceM };
    } catch {
      return 'noRoute';
    }
  }
  const g = useGuidance.getState();
  if (g.route && g.target && g.position) {
    return { shape: g.route.shape, from: { name: i18n.t('assistant:map.here'), here: true, lat: g.position.lat, lon: g.position.lon }, dest: g.target, toName: g.target.name, costing: g.route.costing, meters: g.route.distanceM };
  }
  const p = useRoutePreview.getState().preview;
  if (p?.route) return { shape: p.route.shape, from: { ...p.from, here: false }, dest: p.to, toName: p.to.name, costing: p.costing, meters: p.route.distanceM };
  return 'noRoute';
}

/** Official alerts in force (any place), of the sources for the person's country. */
function liveAlerts() {
  const st = useAlertsState.getState();
  const country = useHereCountry.getState().id ?? useSettings.getState().country;
  return { st, country, all: current(sourcesFor(country).flatMap((src) => st.cache.sources[src]?.alerts ?? []), Date.now()) };
}

/** Emergency points from Overpass or from the maps' own tiles. */
function hasPoints(): boolean {
  try {
    return hasEmergencyPoints();
  } catch {
    return false;
  }
}

/** Re-runs an intent with one of its places replaced by the picked option of a "which one?" card. */
export function withChoice(card: Extract<MapCard, { type: 'choose' }>, index: number): MapIntent | null {
  const o = card.options[index];
  if (!o) return null;
  const ref: PlaceRef = { coords: { lat: o.lat, lon: o.lon }, name: o.name };
  const i = card.intent;
  if (card.slot === 'near' && (i.kind === 'nearby' || i.kind === 'call')) return { ...i, near: ref, strong: true };
  if (card.slot === 'near' && i.kind === 'whereIs') return { ...i, place: ref };
  if (card.slot === 'from' && (i.kind === 'goNearest' || i.kind === 'route')) return { ...i, from: ref, strong: true };
  if (card.slot === 'to' && i.kind === 'route') return { ...i, to: ref, strong: true };
  return null;
}

// ---------------------------------------------------------------------------
// Plain text (stored as the message's content: history, copy, the conversation list)

function kindsLabel(kinds: string[]): string {
  return kinds.map((k) => kindLabel(i18n.t, k)).join(', ');
}

function resultLine(r: MapResult, n: number): string {
  const name = r.name || kindLabel(i18n.t, r.kind);
  const parts = [r.context, r.travel ? `${formatDuration(r.travel.seconds)} · ${formatDistance(r.travel.meters)}` : r.distance != null ? formatDistance(r.distance) : null, r.phone];
  return `${n}. ${name}${parts.filter(Boolean).length ? ` — ${parts.filter(Boolean).join(' · ')}` : ''}`;
}

/** One sentence to read aloud for a dictated question (null: nothing worth saying, the card has buttons). */
export function mapCardSpeech(card: MapCard): string | null {
  const t = i18n.t;
  switch (card.type) {
    case 'places': {
      const r = card.results[0];
      if (!r) return null;
      const name = r.name || kindLabel(t, r.kind);
      return r.travel
        ? t('assistant:map.speak.nearestTime', { name, duration: formatDuration(r.travel.seconds) })
        : t('assistant:map.speak.nearest', { name, distance: formatDistance(r.distance ?? 0) });
    }
    case 'route':
      return card.travel
        ? t('assistant:map.speak.route', { to: card.to.name || kindLabel(t, card.to.kind), duration: formatDuration(card.travel.seconds), distance: formatDistance(card.travel.meters) })
        : null;
    case 'here':
      return card.lost ? t('assistant:map.lostAdvice', { number: card.number }) : card.locality ? t('assistant:map.speak.here', { place: card.locality }) : null;
    case 'sun':
      return card.sun.sunset ? t('assistant:map.sunset', { time: clock(card.sun.sunset) }) : null;
    default:
      return null;
  }
}

/** "18:07" in the device's time zone. */
export function clock(ts: number): string {
  return new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function mapCardText(card: MapCard): string {
  const t = i18n.t;
  switch (card.type) {
    case 'places': {
      const title = card.go
        ? t('assistant:map.goTitle', { kinds: kindsLabel(card.kinds) })
        : card.anchor.here
          ? t('assistant:map.nearHere', { kinds: kindsLabel(card.kinds) })
          : t('assistant:map.nearPlace', { kinds: kindsLabel(card.kinds), place: card.anchor.name });
      return [title, ...card.results.map((r, i) => resultLine(r, i + 1))].join('\n');
    }
    case 'route': {
      const head = t('assistant:map.routeTitle', { from: card.from.name, to: card.to.name || kindLabel(t, card.to.kind) });
      const body = card.travel
        ? t('assistant:map.routeTravel', { duration: formatDuration(card.travel.seconds), distance: formatDistance(card.travel.meters), mode: t(`assistant:map.mode.${card.costing}`) })
        : t('assistant:map.routeStraight', { distance: formatDistance(card.straight) });
      return `${head}\n${body}`;
    }
    case 'place':
      return [card.place.name, card.place.context, formatLatLon(card.place.lat, card.place.lon)].filter(Boolean).join('\n');
    case 'here':
      return [
        card.lost ? t('assistant:map.lostAdvice', { number: card.number }) : t('assistant:map.hereTitle'),
        card.locality,
        card.landmark ? t('assistant:map.landmark', { distance: formatDistance(card.landmark.distance ?? 0), name: card.landmark.name }) : null,
        formatLatLon(card.fix.lat, card.fix.lon),
      ]
        .filter(Boolean)
        .join('\n');
    case 'share':
      return card.contact ? t('assistant:map.shareTo', { name: card.contact.name }) : t('assistant:map.shareTitle');
    case 'emergency':
      return t('assistant:map.emergencyTitle', { number: card.number });
    case 'choose':
      return t('assistant:map.chooseTitle', { query: card.query });
    case 'save':
      return t('assistant:map.saveTitle', { name: card.name });
    case 'meeting':
      return [t('assistant:map.meetingTitle'), ...card.points.map((p) => [p.place, p.details].filter(Boolean).join(' — '))].join('\n');
    case 'sun': {
      const lines = [
        card.sun.sunset ? t('assistant:map.sunset', { time: clock(card.sun.sunset) }) : t('assistant:map.noSunset'),
        card.sun.dusk ? t('assistant:map.dusk', { time: clock(card.sun.dusk) }) : null,
        card.to && card.arrival ? t('assistant:map.arrival', { name: card.to.name, time: clock(card.arrival) }) : null,
      ];
      return lines.filter(Boolean).join('\n');
    }
    case 'alerts':
      return card.items.length ? [t('assistant:map.alertsTitle'), ...card.items.map((a) => `${a.title} — ${a.subtitle}`)].join('\n') : t('assistant:map.noAlerts');
    case 'along':
      return [
        t('assistant:map.alongTitle', { kinds: kindsLabel(card.kinds), to: card.to }),
        ...card.results.map((r, i) => `${i + 1}. ${r.name || kindLabel(t, r.kind)} — ${t('assistant:map.alongAt', { distance: formatDistance(r.alongM) })}`),
      ].join('\n');
    case 'routeAlerts':
      return card.crossing.length
        ? [t('assistant:map.routeAlertsTitle', { to: card.to }), ...card.crossing.map((a) => `${a.title} — ${t('assistant:map.alongAt', { distance: formatDistance(a.atM) })}`)].join('\n')
        : t('assistant:map.routeAlertsNone', { to: card.to });
    case 'evacuate':
      return card.alerts.length
        ? [...card.alerts.map((a) => `${a.title}${a.instruction ? `: ${a.instruction}` : ''}`), ...card.results.map((r, i) => `${i + 1}. ${r.name || kindLabel(t, r.kind)}`)].join('\n')
        : t('assistant:map.evacuateNone');
    case 'trip':
      return [
        t('assistant:map.tripTitle', { name: card.region.name }),
        card.map ? t('assistant:map.tripMapYes') : t('assistant:map.tripMapNo'),
        card.number ? t('assistant:map.tripNumber', { number: card.number }) : null,
      ]
        .filter(Boolean)
        .join('\n');
    case 'chips':
      return card.places.map((p) => p.name).join(', ');
    case 'missing':
      return t(`assistant:map.missing.${card.reason}`, { query: card.query ?? '', kinds: card.kinds ? kindsLabel(card.kinds) : '', names: (card.names ?? []).join(', ') });
  }
}

/**
 * "¿Qué es este sitio?" as the library question about the town or neighbourhood you're in ("¿Qué es Navalcarnero?"),
 * or null when no position or no locality is known.
 */
export async function aboutHereQuestion(lang: 'es' | 'en'): Promise<string | null> {
  const f = await currentFix();
  if (!f) return null;
  const { locality } = await addressNear(f, null);
  if (!locality) return null;
  return lang === 'es' ? `¿Qué es ${locality}?` : `What is ${locality}?`;
}

/** Settlement kinds worth a chip (Protomaps `kind_detail`); not countries, states or single houses. */
const CHIP_KINDS = new Set(['city', 'town', 'village', 'locality', 'suburb', 'neighbourhood', 'quarter']);
const MAX_CHIPS = 3;

/**
 * The towns and cities a library answer (and its question) names that the installed maps have, for chips under it.
 * Exact names only, at most three: a wrong chip ("Granada" the fruit) costs more than a missing one.
 */
export async function placeChips(text: string): Promise<MapResult[]> {
  if (!hasSearchIndex()) return [];
  const near = await hereIfGranted();
  const out: MapResult[] = [];
  for (const name of placeCandidates(text)) {
    if (out.length >= MAX_CHIPS) break;
    try {
      const hits = await searchPlaces(name, near ?? viewportCenter(), 8);
      const hit = exactHits(hits, name).find((h) => h.layer === 'place' && CHIP_KINDS.has(h.kind));
      if (hit && !out.some((o) => distanceMeters(o, hit) < 2000)) out.push({ name: hit.name, kind: hit.kind, lat: hit.lat, lon: hit.lon, context: null });
    } catch (e) {
      console.warn('[assistant] place chips', e);
    }
  }
  return out;
}
