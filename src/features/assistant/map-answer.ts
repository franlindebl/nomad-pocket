// The assistant's map answers, the app side: runs a MapIntent (map-intent-core.ts) against the map data
// on the device (place index, emergency points, routing packs, markers, the family plan) and returns the
// card shown in the chat. Nothing here is written by a model: names, distances, times and phones come
// from the data (docs/ASSISTANT_MAP_PLAN.md). Null means "not a map answer after all" (a weak intent whose
// place the index doesn't know): the message goes the normal way.
import i18n from '@/i18n';
import { emergencyNumber, hasEmergencyPoints, nearestNamedPlace, nearestPlacesOfKinds, noteHere, pointsFetchedAt, type EmergencyPlace } from '@/features/maps/emergency';
import { distanceMeters, formatLatLon, type LatLon } from '@/features/maps/geo';
import { useGuidance } from '@/features/maps/guidance';
import { kindLabel } from '@/features/maps/labels';
import { useMarkers } from '@/features/maps/markers';
import { addressNear, hasSearchIndex, searchPlaces, type SearchResult } from '@/features/maps/places';
import { NAME_SEP, nameKey } from '@/features/maps/places-core';
import { computeRoute } from '@/features/maps/routing';
import type { Costing } from '@/features/maps/routing-core';
import { usePreparing, whenPrepared } from '@/features/maps/prepare';
import { useMapUi } from '@/features/maps/store';
import { usePrepare } from '@/features/prepare/store';
import { formatDistance, formatDuration } from '@/lib/format';
import * as Location from '@/lib/location';

import type { MapIntent, PlaceRef, PreviousMap } from './map-intent-core';

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
  /** `stale`: the fix was over a minute old when answered (its age is shown). */
  | { type: 'here'; fix: HereFix; stale: boolean; locality: string | null; landmark: MapResult | null; number: string; forCall: boolean }
  | { type: 'share'; fix: HereFix; contact: { name: string; phone: string } | null; wanted: string | null }
  | { type: 'emergency'; number: string; country: string | null }
  | { type: 'choose'; intent: MapIntent; slot: Slot; query: string; options: (MapAnchor & { context: string | null })[] }
  | { type: 'missing'; reason: MissingReason; query?: string; kinds?: string[] };

export type MissingReason = 'noLocation' | 'noPlace' | 'noIndex' | 'noPoints' | 'noResults' | 'preparing';

type Slot = 'near' | 'from' | 'to';

/** What a follow-up needs from the card a message carries ("¿y en Getafe?", "llévame a la segunda"). */
export function previousOf(card: MapCard | null | undefined): PreviousMap | null {
  if (!card) return null;
  if (card.type === 'places') return { kinds: card.kinds, count: card.results.length };
  if (card.type === 'route' || card.type === 'place') return { count: 1 };
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
    const pick = towns[0] ?? exact[0] ?? (strong || /\d/.test(q) ? hits[0] : null);
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
    const list = previous?.type === 'places' ? previous.results : previous?.type === 'route' ? [previous.to] : previous?.type === 'place' ? [previous.place] : [];
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

/** Name filter for "la embajada de España": the country in the person's words, plus its English name for OSM names. */
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
  const aliases = (COUNTRY_ALIASES[name] ?? [name]).map(nameKey);
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
    case 'whereAmI': {
      const f = await here();
      if (!f) return { type: 'missing', reason: 'noLocation' };
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
    case 'whereIs': {
      const r = await resolve(intent.place, previous, false, here);
      if ('choose' in r) return choose('near', intent.place, r.choose);
      if ('missing' in r) return null;
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
      const groups = await Promise.all(intent.kinds.map((k) => nearestPlacesOfKinds([k], r.anchor, per, accept)));
      const results = groups.flat().map(asResult);
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
        t('assistant:map.hereTitle'),
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
    case 'missing':
      return t(`assistant:map.missing.${card.reason}`, { query: card.query ?? '', kinds: card.kinds ? kindsLabel(card.kinds) : '' });
  }
}
