// Offline road routing: routing packs (Valhalla tile extracts, content/routing/*.tar)
// registered as 'route' items, and routes computed on the device by modules/nomad-route.
import { File, FileMode } from 'expo-file-system';

import i18n from '@/i18n';
import { listItems, upsertItem, type InstalledItem } from '@/features/content/items';
import { contentFile, toNativePath } from '@/lib/storage';
import { isNomadRouteAvailable, NomadRoute } from '../../../modules/nomad-route';

import type { LatLon } from './geo';
import { getRegion, regionName } from './regions';
import {
  parseRoute,
  parseTarHeader,
  packsFor as packsForCoverage,
  routeRequest,
  routingErrorKind,
  tarEntrySpan,
  tileCoverage,
  valhallaConfig,
  type Costing,
  type Route,
  type RoutingErrorKind,
} from './routing-core';
import defaults from './valhalla-defaults.json';

export type RoutePackMeta = {
  bbox: [number, number, number, number];
  /** 1° cells with roads (routing-core Coverage); null for packs registered before them. */
  cells?: number[] | null;
  /** YYYYMMDD of the OSM data. */
  buildDate: string;
  regionId: string | null;
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

export function computeRoute(from: LatLon, to: LatLon, costing: Costing, heading?: number | null): Promise<Route> {
  if (!isNomadRouteAvailable()) return Promise.reject(new RoutingError('unavailable', 'nomad-route is not in this build'));
  const packs = packsFor(from, to);
  if (!packs.length) return Promise.reject(new RoutingError('noPack', 'no routing pack covers both points'));
  return serialized(async () => {
    let failure: RoutingError | null = null;
    // A region pack may lack the roads a trip needs at its edge: then try the bigger pack.
    for (const pack of packs) {
      try {
        await NomadRoute.open(valhallaConfig(defaults, toNativePath(resolvePackFile(pack))));
        const started = Date.now();
        const json = await NomadRoute.route(routeRequest({ from, to, costing, language: i18n.language, heading }));
        if (__DEV__) console.log('[maps] route', pack.id, costing, `${Date.now() - started} ms`);
        return parseRoute(json, costing);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failure = new RoutingError(routingErrorKind(message), message);
        if (failure.kind !== 'noRoad' && failure.kind !== 'noPath') break;
      }
    }
    throw failure!;
  });
}

/** Releases the open pack (before deleting its file). */
export function closeRouter(): Promise<void> {
  if (!isNomadRouteAvailable()) return Promise.resolve();
  return serialized(() => NomadRoute.close());
}
