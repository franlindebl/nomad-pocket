// Road routing over Valhalla: the config and requests the native engine
// (modules/nomad-route) takes, reading its answers, choosing a routing pack, and
// following a route from GPS fixes. Pure TypeScript (no `@/` aliases) so node's test
// runner loads it.
import { bearingDegrees, distanceMeters, type LatLon } from './geo.ts';

export const COSTINGS = ['auto', 'pedestrian', 'bicycle'] as const;
export type Costing = (typeof COSTINGS)[number];

/** Default speeds for an ETA when a route is not available (straight-line guidance). */
export const STRAIGHT_LINE_SPEED: Record<Costing, number> = { auto: 13.9, pedestrian: 1.25, bicycle: 4.2 };

type Json = Record<string, unknown>;

/** The mobile config: defaults (valhalla-defaults.json) with this pack's tile extract. */
export function valhallaConfig(defaults: Json, tileExtract: string): string {
  const config = structuredClone(defaults) as Json & { mjolnir: Json };
  config.mjolnir = { ...config.mjolnir, tile_extract: tileExtract };
  return JSON.stringify(config);
}

export type RouteRequestInput = {
  from: LatLon;
  to: LatLon;
  costing: Costing;
  /** App language: 'es' or 'en'. */
  language: string;
  /** Compass heading at the start (degrees), so the route starts the way the user faces. */
  heading?: number | null;
  /** Closed polygons ([lon, lat] rings) to stay out of: a closed road, a flooded area. */
  avoid?: [number, number][][];
  /** A new route from where the user is now, mid-trip (they may really be in a tunnel). */
  rerouting?: boolean;
};

/**
 * Where the ends of a route snap (Valhalla's `search_filter`), checked on Madrid's graph:
 * - By car, to a street, never to a driveway or a parking aisle: someone at home inside a
 *   block is often nearest to the garage under the building (Valhalla marks those
 *   destination-only, which still lets a route start there), and the route then "left"
 *   through the garage. On foot and by bike paths share that road class: no such filter.
 * - Never into a tunnel: above one (Plaza de España, the M-30 at Madrid Río) the nearest
 *   edge is the tunnel right below. Except when rerouting: then the user may really be in it.
 */
function searchFilter(costing: Costing, allowTunnel: boolean): Json | undefined {
  const filter: Json = {};
  if (costing === 'auto') filter.min_road_class = 'residential';
  if (!allowTunnel) filter.exclude_tunnel = true;
  return Object.keys(filter).length ? filter : undefined;
}

/**
 * Valhalla's default allows only T1 trails on foot (sac_scale=hiking): mountain paths
 * (T2) were cut off, and a walk to a mountain hut ended at the nearest easy path (Andorra:
 * 6.4 km to the wrong place instead of 3.6 km on the trail). T2, not more: from T3 on
 * trails get exposed, not what a default should send anyone onto.
 */
const MAX_HIKING_DIFFICULTY = 2;

export function routeRequest(input: RouteRequestInput): string {
  const origin: Json = { lat: input.from.lat, lon: input.from.lon, type: 'break' };
  const target: Json = { lat: input.to.lat, lon: input.to.lon, type: 'break' };
  const fromFilter = searchFilter(input.costing, !!input.rerouting);
  const toFilter = searchFilter(input.costing, false);
  if (fromFilter) origin.search_filter = fromFilter;
  if (toFilter) target.search_filter = toFilter;
  if (input.heading != null && Number.isFinite(input.heading)) {
    origin.heading = Math.round(((input.heading % 360) + 360) % 360);
    origin.heading_tolerance = 60;
  }
  const req: Json = {
    locations: [origin, target],
    costing: input.costing,
    language: input.language === 'es' ? 'es-ES' : 'en-US',
    directions_options: { units: 'kilometers' },
  };
  if (input.costing === 'pedestrian') req.costing_options = { pedestrian: { max_hiking_difficulty: MAX_HIKING_DIFFICULTY } };
  if (input.avoid?.length) req.exclude_polygons = input.avoid;
  return JSON.stringify(req);
}

/** Decodes a Google-style encoded polyline (Valhalla uses precision 6) into [lon, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

export type Maneuver = {
  /** Valhalla maneuver type (1 start … 4 destination, 10 right, 15 left, 26 roundabout…). */
  type: number;
  instruction: string;
  /** Spoken before the maneuver ("Gire a la derecha hacia Gran Vía."). */
  verbal: string | null;
  streets: string[];
  distanceM: number;
  durationS: number;
  /** Index range into the route's shape. */
  begin: number;
  end: number;
  /** Roundabout exit number, when Valhalla gives one. */
  exit: number | null;
};

export type Route = {
  costing: Costing;
  distanceM: number;
  durationS: number;
  /** [lon, lat] along the whole route. */
  shape: [number, number][];
  maneuvers: Maneuver[];
  /** [west, south, east, north]. */
  bbox: [number, number, number, number];
  hasToll: boolean;
  hasHighway: boolean;
  hasFerry: boolean;
};

type ValhallaManeuver = {
  type: number;
  instruction: string;
  verbal_pre_transition_instruction?: string;
  street_names?: string[];
  length: number;
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
  roundabout_exit_count?: number;
};

type ValhallaTrip = {
  summary: { length: number; time: number; has_toll?: boolean; has_highway?: boolean; has_ferry?: boolean };
  units?: string;
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
};

/** Reads a Valhalla JSON route answer (one or more legs, kilometres). */
export function parseRoute(json: string, costing: Costing): Route {
  const trip = (JSON.parse(json) as { trip: ValhallaTrip }).trip;
  const perUnit = trip.units === 'miles' ? 1609.344 : 1000;
  const shape: [number, number][] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of trip.legs) {
    const offset = Math.max(0, shape.length - 1);
    const points = decodePolyline(leg.shape);
    // Legs share their joining point.
    shape.push(...(shape.length ? points.slice(1) : points));
    for (const m of leg.maneuvers) {
      maneuvers.push({
        type: m.type,
        instruction: m.instruction,
        verbal: m.verbal_pre_transition_instruction ?? null,
        streets: m.street_names ?? [],
        distanceM: m.length * perUnit,
        durationS: m.time,
        begin: m.begin_shape_index + offset,
        end: m.end_shape_index + offset,
        exit: m.roundabout_exit_count ?? null,
      });
    }
  }
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of shape) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return {
    costing,
    distanceM: trip.summary.length * perUnit,
    durationS: trip.summary.time,
    shape,
    maneuvers,
    bbox: [w, s, e, n],
    hasToll: !!trip.summary.has_toll,
    hasHighway: !!trip.summary.has_highway,
    hasFerry: !!trip.summary.has_ferry,
  };
}

export type RoutingErrorKind = 'noRoad' | 'noPath' | 'tooFar' | 'other';

/** The native module rejects with "valhalla <code>: <message>". */
export function routingErrorKind(message: string): RoutingErrorKind {
  const code = Number(/valhalla (-?\d+)/.exec(message)?.[1] ?? NaN);
  // https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#internal-error-codes-and-conditions
  if (code === 171) return 'noRoad';
  if (code === 170 || code === 442 || code === 443) return 'noPath';
  if (code === 154 || code === 155 || code === 156 || code === 157) return 'tooFar';
  return 'other';
}

/**
 * Where a pack has roads: the 1° cells (id = row * 360 + col from -90°, -180°) holding
 * any of its local-road tiles. A bbox over-claims: Spain's (Canaries to Catalonia) covers
 * all of Portugal. Packs without cells (older manifests) fall back to their bbox.
 */
export type Coverage = { bbox: [number, number, number, number]; cells?: number[] | null };

export const cellOf = (p: LatLon) => (Math.floor(p.lat) + 90) * 360 + (Math.floor(p.lon) + 180);

const inBBox = (b: [number, number, number, number], p: LatLon) => p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3];

const cellSets = new WeakMap<number[], Set<number>>();

export function covers(pack: Coverage, p: LatLon): boolean {
  if (!inBBox(pack.bbox, p)) return false;
  if (!pack.cells?.length) return true;
  let set = cellSets.get(pack.cells);
  if (!set) {
    set = new Set(pack.cells);
    cellSets.set(pack.cells, set);
  }
  return set.has(cellOf(p));
}

export type RoutingPack = Coverage & { id: string; sizeBytes: number };

/** Packs covering both ends, smallest first (smaller packs open and search faster). */
export function packsFor<P extends RoutingPack>(packs: P[], from: LatLon, to: LatLon): P[] {
  return packs.filter((p) => covers(p, from) && covers(p, to)).sort((a, b) => a.sizeBytes - b.sizeBytes);
}

/** The smallest pack covering both ends, or null. */
export function pickPack<P extends RoutingPack>(packs: P[], from: LatLon, to: LatLon): P | null {
  return packsFor(packs, from, to)[0] ?? null;
}

// --- Routing pack catalog (routing-manifest.json, scripts/routing/manifest.py) ----

export type ManifestFile = { name: string; size: number; sha256: string };

export type ManifestPack = {
  id: string;
  /** Release holding this pack's files (packs not rebuilt this month stay in an older one). */
  release?: string;
  country: string;
  regionId: string;
  /** YYYYMMDD of the OSM data. */
  buildDate: string;
  bbox: [number, number, number, number];
  /** 1° cells with local roads (see Coverage). */
  cells?: number[] | null;
  /** Bytes of the whole tar (sum of its parts). */
  size: number;
  /** The tar, in order; append them to rebuild it (GitHub assets stop at 2 GiB). */
  parts: ManifestFile[];
  /** Emergency points of the pack's area (Overpass TSV columns). */
  pois: ManifestFile | null;
  /** Street and locality names for search (parseStreetsTsv); packs before 2026-10-26 have none. */
  streets?: ManifestFile | null;
  /** Every named place of the country (parsePlacesTsv); packs before 2026-10-26 have none. */
  places?: ManifestFile | null;
  /** House numbers (parseAddressesTsv); packs before 2026-10-26 have none. */
  addresses?: ManifestFile | null;
};

export type RoutingManifest = {
  version: 1;
  /** Release tag holding the files. */
  release: string;
  /** Where the files are, when not the GitHub release (local test servers). */
  baseUrl?: string;
  valhalla: string;
  packs: ManifestPack[];
};

const isFile = (f: unknown): f is ManifestFile =>
  !!f &&
  typeof (f as ManifestFile).name === 'string' &&
  /^[\w.-]+$/.test((f as ManifestFile).name) &&
  Number.isFinite((f as ManifestFile).size);

// File names and URLs are built from these: no paths, no other schemes.
const isRelease = (v: unknown): v is string => typeof v === 'string' && /^[\w.-]+$/.test(v);
const isBaseUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);

/** Validates a downloaded manifest; packs that don't look right are dropped. */
export function parseManifest(json: string): RoutingManifest | null {
  let raw: Partial<RoutingManifest>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw?.version !== 1 || !isRelease(raw.release) || !Array.isArray(raw.packs)) return null;
  if (raw.baseUrl != null && !isBaseUrl(raw.baseUrl)) return null;
  const packs = raw.packs.filter(
    (p) =>
      p &&
      typeof p.id === 'string' &&
      /^[\w-]+$/.test(p.id) &&
      typeof p.regionId === 'string' &&
      (p.release == null || isRelease(p.release)) &&
      Array.isArray(p.bbox) &&
      p.bbox.length === 4 &&
      p.bbox.every(Number.isFinite) &&
      Array.isArray(p.parts) &&
      p.parts.length > 0 &&
      p.parts.every(isFile) &&
      (p.pois == null || isFile(p.pois)) &&
      (p.streets == null || isFile(p.streets)) &&
      (p.places == null || isFile(p.places)) &&
      (p.addresses == null || isFile(p.addresses)),
  );
  return {
    version: 1,
    release: raw.release,
    baseUrl: raw.baseUrl,
    valhalla: String(raw.valhalla ?? ''),
    packs: packs.map((p) => ({ ...p, cells: Array.isArray(p.cells) && p.cells.every(Number.isFinite) ? p.cells : null })),
  };
}

export function assetUrl(manifest: RoutingManifest, pack: Pick<ManifestPack, 'release'>, name: string, repo: string): string {
  const base = manifest.baseUrl?.replace(/\/$/, '') ?? `https://github.com/${repo}/releases/download/${pack.release ?? manifest.release}`;
  return `${base}/${encodeURIComponent(name)}`;
}

/** Packs covering a point, smallest first (a region before its country). */
export function packsCovering(packs: ManifestPack[], p: LatLon): ManifestPack[] {
  return packs.filter((pack) => covers(pack, p)).sort((a, b) => a.size - b.size);
}

// --- Routing pack files -------------------------------------------------------

/** One entry of a tar header block (512 bytes, ustar). Null at the end-of-archive block. */
export function parseTarHeader(block: Uint8Array): { name: string; size: number } | null {
  if (block.length < 512 || block.every((b) => b === 0)) return null;
  const text = (from: number, len: number) => {
    let end = from;
    while (end < from + len && block[end] !== 0) end++;
    return String.fromCharCode(...block.subarray(from, end));
  };
  const name = text(0, 100);
  const prefix = text(345, 155);
  const size = parseInt(text(124, 12).trim() || '0', 8);
  return { name: prefix ? `${prefix}/${name}` : name, size: Number.isFinite(size) ? size : 0 };
}

/** Bytes from one header to the next: the header plus the data padded to 512. */
export const tarEntrySpan = (size: number) => 512 + Math.ceil(size / 512) * 512;

/** Valhalla tile sizes per hierarchy level (degrees): 0 highways, 1 arterials, 2 local roads. */
const LEVEL_DEGREES: Record<number, number> = { 0: 4, 1: 1, 2: 0.25 };

/**
 * Area a pack covers, from its tile file names ("2/000/817/320.gph": level, then the tile
 * id split in groups of three digits). Uses the finest level present: local roads are
 * what a route starts and ends on.
 */
export function tileBBox(names: string[]): [number, number, number, number] | null {
  return tileCoverage(names)?.bbox ?? null;
}

/** bbox and 1° cells of a pack from its tile names (finest level present). */
export function tileCoverage(names: string[]): { bbox: [number, number, number, number]; cells: number[] } | null {
  const byLevel = new Map<number, number[]>();
  for (const name of names) {
    const m = /^(\d)\/([\d/]+)\.gph$/.exec(name.replace(/^\.\//, ''));
    if (!m) continue;
    const level = Number(m[1]);
    if (!(level in LEVEL_DEGREES)) continue;
    const ids = byLevel.get(level) ?? [];
    ids.push(Number(m[2].replace(/\//g, '')));
    byLevel.set(level, ids);
  }
  const level = [2, 1, 0].find((l) => byLevel.has(l));
  if (level === undefined) return null;
  const size = LEVEL_DEGREES[level];
  const cols = Math.round(360 / size);
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const cells = new Set<number>();
  for (const id of byLevel.get(level)!) {
    const row = Math.floor(id / cols);
    const col = id % cols;
    const lon = -180 + col * size;
    const lat = -90 + row * size;
    w = Math.min(w, lon);
    s = Math.min(s, lat);
    e = Math.max(e, lon + size);
    n = Math.max(n, lat + size);
    for (let y = Math.floor(lat); y < Math.max(lat + size, Math.floor(lat) + 1); y++)
      for (let x = Math.floor(lon); x < Math.max(lon + size, Math.floor(lon) + 1); x++) cells.add(cellOf({ lat: y, lon: x }));
  }
  return { bbox: [w, s, e, n], cells: [...cells].sort((a, b) => a - b) };
}

// --- Following a route --------------------------------------------------------

const OFF_ROUTE_M = 40;

/** Metres per degree of latitude; longitude scales by cos(lat). Plenty for snapping. */
const M_PER_DEG = 111_320;

function project(p: LatLon, a: [number, number], b: [number, number]) {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = a[0] * k * M_PER_DEG;
  const ay = a[1] * M_PER_DEG;
  const dx = b[0] * k * M_PER_DEG - ax;
  const dy = b[1] * M_PER_DEG - ay;
  const px = p.lon * k * M_PER_DEG - ax;
  const py = p.lat * M_PER_DEG - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
  const ex = px - t * dx;
  const ey = py - t * dy;
  return { t, offRoute: Math.sqrt(ex * ex + ey * ey) };
}

export type RouteProgress = {
  /** Shape segment the position snaps to (shape[segment] → shape[segment + 1]). */
  segment: number;
  /** Distance from the position to the route line, metres. */
  offRouteM: number;
  /** Along the route to the end, metres. */
  remainingM: number;
  /** Index into maneuvers of the next one to perform. */
  next: number;
  /** Along the route to that maneuver's start, metres. */
  toNextM: number;
  /** Which way the route goes from here (degrees from north, over the next ~30 m). */
  aheadBearing: number | null;
};

/** Cumulative distance along a shape (metres from its start to each vertex). */
export function cumulativeDistances(shape: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1];
    const b = shape[i];
    out.push(out[i - 1] + distanceMeters({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }));
  }
  return out;
}

/**
 * Snaps a position onto the route. Searches forward from the last known segment first
 * (a route can pass the same street twice), then the whole shape when that is far.
 */
export function routeProgress(route: Route, cumulative: number[], p: LatLon, fromSegment = 0): RouteProgress {
  const shape = route.shape;
  const scan = (start: number, end: number) => {
    let best = { segment: start, t: 0, offRoute: Infinity };
    for (let i = start; i < end; i++) {
      const r = project(p, shape[i], shape[i + 1]);
      if (r.offRoute < best.offRoute) best = { segment: i, t: r.t, offRoute: r.offRoute };
    }
    return best;
  };
  const last = Math.max(0, shape.length - 1);
  let best = scan(Math.min(fromSegment, Math.max(0, last - 1)), last);
  // Same threshold as isOffRoute: never reroute before looking at the whole route.
  if (best.offRoute > OFF_ROUTE_M && fromSegment > 0) {
    const all = scan(0, last);
    if (all.offRoute < best.offRoute) best = all;
  }
  if (!Number.isFinite(best.offRoute))
    best = { segment: 0, t: 0, offRoute: shape.length ? distanceMeters(p, { lat: shape[0][1], lon: shape[0][0] }) : 0 };
  const segLen = (cumulative[best.segment + 1] ?? cumulative[best.segment]) - cumulative[best.segment];
  const along = cumulative[best.segment] + best.t * segLen;
  const total = cumulative[cumulative.length - 1] ?? 0;
  const here = pointAlong(shape, cumulative, along);
  const ahead = pointAlong(shape, cumulative, Math.min(total, along + AHEAD_M));
  let next = route.maneuvers.findIndex((m) => cumulative[m.begin] > along + 1);
  if (next < 0) next = route.maneuvers.length - 1;
  return {
    segment: best.segment,
    offRouteM: best.offRoute,
    remainingM: Math.max(0, total - along),
    next,
    toNextM: Math.max(0, cumulative[route.maneuvers[next]?.begin ?? last] - along),
    aheadBearing: here && ahead && distanceMeters(here, ahead) > 2 ? bearingDegrees(here, ahead) : null,
  };
}

/** Looking this far along the route for its direction: past GPS noise, short of the next corner. */
const AHEAD_M = 30;

/** The point `d` metres along a shape. */
export function pointAlong(shape: [number, number][], cumulative: number[], d: number): LatLon | null {
  if (!shape.length) return null;
  let i = 0;
  while (i < shape.length - 2 && cumulative[i + 1] < d) i++;
  const a = shape[i];
  const b = shape[Math.min(i + 1, shape.length - 1)];
  const len = (cumulative[i + 1] ?? cumulative[i]) - cumulative[i];
  const t = len > 0 ? Math.min(1, Math.max(0, (d - cumulative[i]) / len)) : 0;
  return { lat: a[1] + (b[1] - a[1]) * t, lon: a[0] + (b[0] - a[0]) * t };
}

/** Remaining time, scaled from Valhalla's estimate by the distance still to go. */
export function remainingSeconds(route: Route, remainingM: number): number {
  return route.distanceM > 0 ? (route.durationS * remainingM) / route.distanceM : 0;
}

/** Off the route for real: beyond 40 m, or beyond the fix's own accuracy (up to 80 m). */
export function isOffRoute(offRouteM: number, accuracyM: number | null): boolean {
  return offRouteM > Math.max(OFF_ROUTE_M, Math.min(accuracyM ?? 0, 80));
}

export type ManeuverIcon =
  | 'start'
  | 'arrive'
  | 'straight'
  | 'slightRight'
  | 'right'
  | 'sharpRight'
  | 'slightLeft'
  | 'left'
  | 'sharpLeft'
  | 'uturn'
  | 'roundabout'
  | 'merge'
  | 'ferry';

export function maneuverIcon(type: number): ManeuverIcon {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return 'start';
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
    case 18:
    case 20:
    case 23:
      return 'slightRight';
    case 10:
      return 'right';
    case 11:
      return 'sharpRight';
    case 16:
    case 19:
    case 21:
    case 24:
      return 'slightLeft';
    case 15:
      return 'left';
    case 14:
      return 'sharpLeft';
    case 12:
    case 13:
      return 'uturn';
    case 26:
    case 27:
      return 'roundabout';
    case 25:
    case 37:
    case 38:
      return 'merge';
    case 28:
    case 29:
      return 'ferry';
    default:
      return 'straight';
  }
}
