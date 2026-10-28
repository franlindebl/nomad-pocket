// Offline road routing: routing packs (Valhalla tile extracts, content/routing/*.tar)
// registered as 'route' items, and routes computed on the device by modules/nomad-route.
import { File, FileMode } from 'expo-file-system';

import i18n from '@/i18n';
import { listItems, upsertItem, type InstalledItem } from '@/features/content/items';
import { contentFile, toNativePath } from '@/lib/storage';
import { isNomadRouteAvailable, NomadRoute } from '../../../modules/nomad-route';

import { distanceMeters, type LatLon } from './geo';
import { getRegion, regionName } from './regions';
import {
  covers,
  cumulativeDistances,
  parseRoute,
  parseTarHeader,
  packsFor as packsForCoverage,
  routeProgress,
  routeRequest,
  routingErrorKind,
  tarEntrySpan,
  tileCoverage,
  valhallaConfig,
  type Costing,
  type Route,
  type RouteRequestInput,
  type RoutingErrorKind,
} from './routing-core';
import {
  bestPath,
  chainEstimate,
  joinRoutes,
  matrixRequest,
  nearestSeams,
  packChains,
  parseCrossings,
  parseMatrix,
  robustMatrix,
  seamLocation,
  seamsBetween,
  type Crossing,
  type Seam,
  type StitchPack,
} from './stitch-core';
import defaults from './valhalla-defaults.json';

export type RoutePackMeta = {
  bbox: [number, number, number, number];
  /** 1° cells with roads (routing-core Coverage); null for packs registered before them. */
  cells?: number[] | null;
  /** YYYYMMDD of the OSM data. */
  buildDate: string;
  regionId: string | null;
  /** Valhalla that built it (routing-core engineReads); absent: LEGACY_PACK_VALHALLA. */
  valhalla?: string;
};

export type RoutePackItem = InstalledItem & { meta: RoutePackMeta };

export const routePackId = (key: string) => `route-${key}`;

/** Current URI of a pack's file (iOS moves the container: resolve by name, as for maps). */
export function resolvePackFile(item: Pick<InstalledItem, 'fileUri'>): string {
  const name = decodeURIComponent(item.fileUri.split('/').pop() ?? '');
  return name ? contentFile('route', name).uri : item.fileUri;
}

export function listRoutePacks(): RoutePackItem[] {
  return (listItems('route') as RoutePackItem[]).filter((p) => Array.isArray(p.meta?.bbox));
}

/** Reads the tile names in a pack (tar headers only: a few hundred small reads). */
export function packCoverage(file: File): { bbox: [number, number, number, number]; cells: number[] } | null {
  const handle = file.open(FileMode.ReadOnly);
  const names: string[] = [];
  try {
    const size = Number(file.size ?? 0);
    let offset = 0;
    while (offset + 512 <= size) {
      handle.offset = offset;
      const entry = parseTarHeader(handle.readBytesSync(512));
      if (!entry) break;
      names.push(entry.name);
      offset += tarEntrySpan(entry.size);
    }
  } finally {
    handle.close();
  }
  return tileCoverage(names);
}

/**
 * Registers a pack file found in content/routing that no item points to (seeded by the
 * E2E suite or copied in by hand). "es-md.tar" becomes the Comunidad de Madrid pack.
 */
export function registerLoosePack(file: File, buildDate: string) {
  const coverage = packCoverage(file);
  if (!coverage) throw new Error('not a routing pack');
  const key = file.name.replace(/\.tar$/i, '');
  const region = getRegion(key);
  const meta: RoutePackMeta = { ...coverage, buildDate, regionId: region?.id ?? null };
  upsertItem({
    id: routePackId(key),
    kind: 'route',
    title: region ? regionName(region, i18n.language) : key,
    description: null,
    language: null,
    category: 'maps',
    isCourse: false,
    fileUri: file.uri,
    sizeBytes: Number(file.size ?? 0),
    version: buildDate,
    sourceUrl: null,
    catalogId: region?.id ?? null,
    meta,
  });
}

export class RoutingError extends Error {
  constructor(
    readonly kind: RoutingErrorKind | 'noPack' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/** Installed packs that can route between two points, smallest first. */
export function packsFor(from: LatLon, to: LatLon): RoutePackItem[] {
  if (!isNomadRouteAvailable()) return [];
  const packs = listRoutePacks();
  const fit = packsForCoverage(
    packs.map((p) => ({ id: p.id, bbox: p.meta.bbox, cells: p.meta.cells, sizeBytes: p.sizeBytes })),
    from,
    to,
  );
  return fit.map((f) => packs.find((p) => p.id === f.id)!).filter(Boolean);
}

export function packFor(from: LatLon, to: LatLon): RoutePackItem | null {
  return packsFor(from, to)[0] ?? null;
}

/** File of a pack's border crossings, next to its tar (routing-packs.ts downloads it). */
export function crossingsFile(item: Pick<InstalledItem, 'fileUri'>): File {
  const name = resolvePackFile(item).split('/').pop() ?? '';
  return contentFile('route', decodeURIComponent(name).replace(/\.tar$/i, '.crossings.tsv'));
}

/** Parsed crossings per pack, while its file is the same (a few KB; an update rewrites it). */
const crossingsCache = new Map<string, { stamp: string; crossings: Crossing[] | null }>();

function packCrossings(item: RoutePackItem): Crossing[] | null {
  const file = crossingsFile(item);
  const stamp = file.exists ? `${file.size}:${file.modificationTime}` : '';
  const hit = crossingsCache.get(item.id);
  if (hit?.stamp === stamp) return hit.crossings;
  let crossings: Crossing[] | null = null;
  try {
    if (stamp) crossings = parseCrossings(file.textSync());
  } catch (e) {
    console.warn('[maps] crossings', item.id, e);
  }
  crossingsCache.set(item.id, { stamp, crossings });
  return crossings;
}

type Stitchable = StitchPack & { item: RoutePackItem };

function stitchablePacks(): Stitchable[] {
  return listRoutePacks().map((item) => ({ id: item.id, bbox: item.meta.bbox, cells: item.meta.cells, crossings: packCrossings(item), item }));
}

/** Whether roads can take the trip: one pack covers both ends, or installed packs join them. */
export function canRoute(from: LatLon, to: LatLon, costing: Costing): boolean {
  if (!isNomadRouteAvailable()) return false;
  return !!packFor(from, to) || packChains(stitchablePacks(), from, to, costing).length > 0;
}

/**
 * The native module holds one open pack: open + route must not interleave with another
 * request or a close (a costing change, a reroute and a pack removal can overlap).
 */
let engine: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = engine.then(job, job);
  engine = run.catch(() => undefined);
  return run;
}

const failureOf = (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  return new RoutingError(routingErrorKind(message), message);
};

async function openPack(pack: RoutePackItem) {
  await NomadRoute.open(valhallaConfig(defaults, toNativePath(resolvePackFile(pack))));
}

async function routeIn(pack: RoutePackItem, input: Omit<RouteRequestInput, 'language'>): Promise<Route> {
  await openPack(pack);
  return parseRoute(await NomadRoute.route(routeRequest({ ...input, language: i18n.language })), input.costing);
}

/** Seams kept per border for a matrix: the ends' borders, and the (n×m) ones of a pack crossed on the way. */
const SEAMS_AT_ENDS = 16;
const SEAMS_IN_TRANSIT = 8;
/** Pack chains tried in full (by their straight-line estimate): the best of them wins. */
const CHAINS_TRIED = 2;
/** Further off a stitched route than this, a reroute chooses the crossings again. */
const REPLAN_OFF_M = 10_000;

/**
 * A stitched trip: the packs, the crossing chosen at each border and the route of each leg
 * (leg i runs in packs[i] up to seams[i]). Kept so a reroute only recomputes the leg the
 * person is on: the legs after the next border don't change.
 */
type Stitch = { to: LatLon; costing: Costing; packs: RoutePackItem[]; seams: Seam[]; legs: Route[]; route: Route; cumulative: number[] };
let lastStitch: Stitch | null = null;

function remember(to: LatLon, costing: Costing, packs: RoutePackItem[], seams: Seam[], legs: Route[]): Route {
  const route = joinRoutes(legs);
  lastStitch = { to, costing, packs, seams, legs, route, cumulative: cumulativeDistances(route.shape) };
  return route;
}

/** The best stitched route through one chain of packs: matrices border by border, then one route per leg. */
async function stitchChain(chain: Stitchable[], from: LatLon, to: LatLon, costing: Costing, heading: number | null | undefined, rerouting: boolean) {
  const borders = chain.slice(1).map((next, i) => {
    const all = seamsBetween(chain[i], next, costing);
    const ends = i === 0 || i === chain.length - 2;
    return nearestSeams(all, from, to, ends ? SEAMS_AT_ENDS : SEAMS_IN_TRANSIT);
  });
  const layers: (number | null)[][][] = [];
  for (const [i, pack] of chain.entries()) {
    const sources = i === 0 ? [{ lat: from.lat, lon: from.lon }] : borders[i - 1].map(seamLocation);
    const targets = i === chain.length - 1 ? [{ lat: to.lat, lon: to.lon }] : borders[i].map(seamLocation);
    await openPack(pack.item);
    layers.push(
      await robustMatrix(async (s, t) => parseMatrix(await NomadRoute.matrix(matrixRequest(s, t, costing))), sources, targets),
    );
  }
  const best = bestPath(layers);
  if (!best) return null;
  const seams = best.picks.map((k, i) => borders[i][k]);
  // Backwards: the last pack is the one open.
  const legs: Route[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const legFrom = i === 0 ? from : seams[i - 1];
    const legTo = i === chain.length - 1 ? to : seams[i];
    legs.unshift(
      await routeIn(chain[i].item, {
        from: legFrom,
        to: legTo,
        costing,
        heading: i === 0 ? heading : null,
        rerouting: i === 0 && rerouting,
        fromSeam: i > 0 ? seams[i - 1] : undefined,
        toSeam: i < chain.length - 1 ? seams[i] : undefined,
      }),
    );
  }
  return { total: best.total, seams, legs };
}

/** The best stitched route over the likeliest pack chains, or null when no chain joins the two points. */
async function stitchedRoute(from: LatLon, to: LatLon, costing: Costing, heading: number | null | undefined, rerouting: boolean) {
  const chains = packChains(stitchablePacks(), from, to, costing)
    .map((chain) => ({ chain, estimate: chainEstimate(chain, from, to, costing) }))
    .filter((c) => Number.isFinite(c.estimate))
    .sort((a, b) => a.chain.length - b.chain.length || a.estimate - b.estimate)
    .slice(0, CHAINS_TRIED);
  let best: { total: number; seams: Seam[]; legs: Route[]; packs: RoutePackItem[] } | null = null;
  for (const { chain } of chains) {
    const started = Date.now();
    const r = await stitchChain(chain, from, to, costing, heading, rerouting);
    // In Release too: how long a trip across packs takes to choose is worth seeing on a phone.
    console.log('[maps] stitched', chain.map((p) => p.id).join(' → '), costing, r ? `${Math.round(r.total)} s` : 'no way', `${Date.now() - started} ms`);
    if (r && (!best || r.total < best.total)) best = { ...r, packs: chain.map((c) => c.item) };
  }
  return best;
}

/**
 * A reroute on a stitched trip: from where the person is to the next crossing ahead, in the
 * pack they're in, and the legs after it as they were. Null when that doesn't apply (another
 * trip, far off the route, outside that pack): then the crossings are chosen again.
 */
async function rerouteStitch(from: LatLon, to: LatLon, costing: Costing, heading: number | null | undefined): Promise<Route | null> {
  const s = lastStitch;
  if (!s || s.costing !== costing || distanceMeters(s.to, to) > 1) return null;
  const at = routeProgress(s.route, s.cumulative, from);
  if (at.offRouteM > REPLAN_OFF_M) return null;
  // Seams still ahead: each one is the joined shape's vertex where a leg ends.
  let vertex = 0;
  const seamAlong = s.legs.slice(0, -1).map((leg) => s.cumulative[(vertex += leg.shape.length - 1)]);
  const next = seamAlong.findIndex((d) => d > at.alongM);
  const k = next === -1 ? s.seams.length : next;
  const pack = s.packs[k];
  if (!covers({ bbox: pack.meta.bbox, cells: pack.meta.cells }, from)) return null;
  if (k === s.seams.length) {
    lastStitch = null;
    return routeIn(pack, { from, to, costing, heading, rerouting: true });
  }
  const leg = await routeIn(pack, { from, to: s.seams[k], costing, heading, rerouting: true, toSeam: s.seams[k] });
  return remember(to, costing, s.packs.slice(k), s.seams.slice(k), [leg, ...s.legs.slice(k + 1)]);
}

export function computeRoute(from: LatLon, to: LatLon, costing: Costing, heading?: number | null, rerouting = false): Promise<Route> {
  if (!isNomadRouteAvailable()) return Promise.reject(new RoutingError('unavailable', 'nomad-route is not in this build'));
  const packs = packsFor(from, to);
  // An end inside another pack's margin (near a border) may route better across it than on the one pack covering both.
  const nearBorder = listRoutePacks().some((p) => !packs.includes(p) && [from, to].some((x) => covers({ bbox: p.meta.bbox, cells: p.meta.cells }, x)));
  if (!packs.length && !canRoute(from, to, costing)) return Promise.reject(new RoutingError('noPack', 'no routing pack covers both points'));
  return serialized(async () => {
    if (rerouting && lastStitch) {
      try {
        const started = Date.now();
        const r = await rerouteStitch(from, to, costing, heading);
        console.log('[maps] stitched reroute', r ? `${Date.now() - started} ms` : 'choosing the crossings again');
        if (r) return r;
      } catch (e) {
        if (__DEV__) console.log('[maps] stitched reroute failed, choosing again', e);
      }
    }
    lastStitch = null;
    let single: Route | null = null;
    let failure: RoutingError | null = null;
    // A region pack may lack the roads a trip needs at its edge: then try the bigger pack.
    for (const pack of packs) {
      try {
        const started = Date.now();
        single = await routeIn(pack, { from, to, costing, heading, rerouting });
        if (__DEV__) console.log('[maps] route', pack.id, costing, `${Date.now() - started} ms`);
        break;
      } catch (e) {
        failure = failureOf(e);
        if (failure.kind !== 'noRoad' && failure.kind !== 'noPath') break;
      }
    }
    // A reroute keeps the kind of trip it had: crossings are only weighed again when it was stitched.
    if (single && (!nearBorder || rerouting)) return single;
    try {
      const stitched = await stitchedRoute(from, to, costing, heading, rerouting);
      if (stitched && (!single || stitched.total < single.durationS)) return remember(to, costing, stitched.packs, stitched.seams, stitched.legs);
    } catch (e) {
      failure ??= failureOf(e);
    }
    if (single) return single;
    throw failure ?? new RoutingError('noPath', 'no way across the installed packs');
  });
}

/** Releases the open pack (before deleting its file). */
export function closeRouter(): Promise<void> {
  lastStitch = null;
  if (!isNomadRouteAvailable()) return Promise.resolve();
  return serialized(() => NomadRoute.close());
}
