// Countries as one download (docs/UX_SURVIVAL_PLAN.md): the map at full detail, the routing
// pack where the catalog has one, and the emergency points and street names that come with
// them. The UI only deals with countries; this module maps them onto map items, routing
// packs and downloads. A country the maps catalog doesn't have yet is extracted on the
// phone instead (extraction.ts), at the highest zoom a phone can handle.
import { useEffect, useMemo, useState } from 'react';

import { getItem, removeItem, useItems } from '@/features/content/items';
import { recordGroup, summarize } from '@/features/downloads/groups';
import { cancelDownload, NotEnoughStorageError, useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { HttpError } from '@/lib/pmtiles';
import { hasRoomFor } from '@/lib/storage';

import { routePackFor, type CountryMap } from './country-core';
import {
  countryDownloadGroup,
  countryMapDownloadIds,
  countryMapProgress,
  downloadCountryMap,
  refreshMapsCatalog,
  useMapsCatalog,
} from './country-maps';
import { bestZoom, estimateExtract, mapItemId, startMapDownload, WORLD_ID, type Estimate } from './extraction';
import { getRegion, regionName, type Region } from './regions';
import type { RoutePackItem } from './routing';
import type { ManifestPack } from './routing-core';
import { downloadPack, isPackInstalled, refreshRoutingCatalog, useRoutingCatalog } from './routing-packs';
import type { MapItem } from './useMapSources';

const ACTIVE = new Set(['queued', 'running', 'paused', 'processing']);

export type CountryOffer = {
  region: Region;
  title: string;
  /** Prebuilt map from the catalog; null: extracted on the phone (size needs an estimate). */
  map: CountryMap | null;
  /** Zoom of an on-device extraction. */
  fallbackZoom: number;
  /** Routing pack; null where none is published yet (guidance is then a straight line). */
  pack: ManifestPack | null;
};

function offer(regionId: string, maps: CountryMap[], packs: ManifestPack[]): CountryOffer | null {
  const region = getRegion(regionId);
  if (!region || region.type !== 'country') return null;
  return {
    region,
    title: regionName(region, i18n.language),
    map: maps.find((m) => m.regionId === regionId) ?? null,
    fallbackZoom: bestZoom(region.bbox),
    pack: routePackFor(packs, regionId),
  };
}

export function useCountryOffer(regionId: string | undefined): CountryOffer | null {
  const maps = useMapsCatalog((s) => s.manifest?.maps);
  const packs = useRoutingCatalog((s) => s.manifest?.packs);
  return useMemo(() => (regionId ? offer(regionId, maps ?? [], packs ?? []) : null), [regionId, maps, packs]);
}

export function countryOffer(regionId: string): CountryOffer | null {
  return offer(regionId, useMapsCatalog.getState().manifest?.maps ?? [], useRoutingCatalog.getState().manifest?.packs ?? []);
}

export type CountrySize =
  | { status: 'loading' }
  | { status: 'ready'; bytes: number; estimate?: Estimate }
  | { status: 'offline' }
  | { status: 'error'; message: string };

/**
 * What a country download will take: from the catalogs (refreshed on mount), or, for a
 * map the catalog doesn't have, from a dry run of the on-device extraction.
 */
/** Gives up on a size estimate after this long (a dead network can hang instead of failing). */
const ESTIMATE_TIMEOUT_MS = 45_000;

/**
 * Whether both catalogs are known: 'unknown' when one never loaded (first launch offline,
 * DNS down) and has no cached copy, so a country's pack can't be told from no pack.
 */
export function useCatalogsState(): 'loading' | 'ready' | 'unknown' {
  const maps = useMapsCatalog((s) => (s.manifest ? 'ready' : s.status));
  const routing = useRoutingCatalog((s) => (s.manifest ? 'ready' : s.status));
  if (maps === 'ready' && routing === 'ready') return 'ready';
  if (maps === 'error' || routing === 'error') return 'unknown';
  return 'loading';
}

export function retryCatalogs() {
  refreshMapsCatalog();
  refreshRoutingCatalog();
}

/** The size plus `retry` (catalogs and estimate again, after a failure). */
export function useCountrySize(o: CountryOffer | null): CountrySize & { retry: () => void } {
  const mapsStatus = useMapsCatalog((s) => s.status);
  const routingStatus = useRoutingCatalog((s) => s.status);
  const catalogs = useCatalogsState();
  const [estimate, setEstimate] = useState<{ key: string; size: CountrySize } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    retryCatalogs();
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    retryCatalogs();
  }, []);

  const catalogsLoading = mapsStatus === 'loading' || routingStatus === 'loading';
  const key = o && !o.map && !catalogsLoading && catalogs === 'ready' ? `${o.region.id}|${o.fallbackZoom}|${attempt}` : null;
  useEffect(() => {
    if (!o || !key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      done({ status: 'offline' });
      ctrl.abort();
    }, ESTIMATE_TIMEOUT_MS);
    const done = (size: CountrySize) => {
      if (ctrl.signal.aborted) return;
      clearTimeout(timer);
      setEstimate({ key, size });
    };
    estimateExtract(o.region.bbox, 0, o.fallbackZoom, ctrl.signal)
      .then((e) => done({ status: 'ready', bytes: e.plan.archiveBytes, estimate: e }))
      .catch((e) => {
        console.warn('[maps] country size', o.region.id, e);
        // A server's answer is worth showing; anything else (DNS, TLS, a dropped connection)
        // reads as "no connection" with a retry.
        if (e instanceof HttpError) done({ status: 'error', message: e.message });
        else done({ status: 'offline' });
      });
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // The key stands for the offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!o || catalogsLoading) return { status: 'loading', retry };
  // Without the catalogs nothing can be sized (nor downloaded, as for any download offline).
  if (catalogs === 'unknown') return { status: 'offline', retry };
  const pack = o.pack && !isPackInstalled(o.pack.id) ? o.pack.size : 0;
  if (o.map) return { status: 'ready', bytes: o.map.size + pack, retry };
  const est = estimate?.key === key ? estimate.size : null;
  if (!est) return { status: 'loading', retry };
  return est.status === 'ready' ? { ...est, bytes: est.bytes + pack, retry } : { ...est, retry };
}

/**
 * Starts what a country still needs: its map (unless installed; `update`: a newer one
 * replaces it) and its routing pack. `estimate`: the on-device extraction plan the confirm
 * sheet already computed (no prebuilt map). Throws NotEnoughStorageError before starting
 * anything.
 */
export function downloadCountry(o: CountryOffer, estimate?: Estimate, opts: { update?: boolean } = {}) {
  const mapsManifest = useMapsCatalog.getState().manifest;
  const routing = useRoutingCatalog.getState().manifest;
  const pack = o.pack && routing && !isPackInstalled(o.pack.id) ? o.pack : null;
  const wantMap = opts.update || !getItem(mapItemId(o.region.id));
  const mapBytes = !wantMap ? 0 : o.map ? o.map.size : (estimate?.plan.archiveBytes ?? 0);
  const needed = mapBytes + (pack?.size ?? 0);
  if (!hasRoomFor(needed)) throw new NotEnoughStorageError(needed);
  // One row in Downloads, even when the pack is another country's (Haiti uses the Dominican Republic's).
  const group = countryDownloadGroup(o.region.id);
  // An installed map stays (a retry only fetches what failed or is missing: the pack).
  if (wantMap && o.map && mapsManifest) downloadCountryMap(mapsManifest, o.map, !!o.pack?.pois, group);
  else if (wantMap)
    startMapDownload({
      key: o.region.id,
      title: o.title,
      bbox: o.region.bbox,
      minZoom: 0,
      maxZoom: o.fallbackZoom,
      regionId: o.region.id,
      bundledPoints: !!o.pack?.pois,
      estimate,
    });
  if (pack && routing) downloadPack(routing, pack, group);
}

export type CountryState = {
  regionId: string;
  title: string;
  map: MapItem | null;
  pack: RoutePackItem | null;
  /** Bytes on disk (map + pack). */
  sizeBytes: number;
  /** 0–1 while something is downloading, else null. */
  progress: number | null;
  failed: boolean;
  /** YYYYMMDD of the map data. */
  buildDate: string | null;
  /** The maps catalog has a newer build of this country's map. */
  update: boolean;
};

const regionOfRecord = (r: DownloadRecord): string | null => {
  if (r.kind === 'map') {
    if (typeof r.meta.regionId === 'string') return r.meta.regionId;
    const m = /^job-map-(.+)$/.exec(r.id); // on-device extraction
    return m && getRegion(m[1])?.type === 'country' ? m[1] : null;
  }
  if (r.kind === 'route' && r.meta.role !== 'streets') return (r.meta.pack as ManifestPack | undefined)?.regionId ?? null;
  return null;
};

/** Installed and downloading countries, plus the maps that aren't a country (older regions, areas). */
export function useCountries(): { countries: CountryState[]; otherMaps: MapItem[] } {
  const maps = useItems('map') as MapItem[];
  const packs = useItems('route') as RoutePackItem[];
  const records = useDownloads((s) => s.records);
  const catalogMaps = useMapsCatalog((s) => s.manifest?.maps);

  return useMemo(() => {
    const byCountry = new Map<string, CountryState>();
    const country = (regionId: string): CountryState | null => {
      const region = getRegion(regionId);
      if (!region || region.type !== 'country') return null;
      let c = byCountry.get(regionId);
      if (!c) {
        c = { regionId, title: regionName(region, i18n.language), map: null, pack: null, sizeBytes: 0, progress: null, failed: false, buildDate: null, update: false };
        byCountry.set(regionId, c);
      }
      return c;
    };
    const otherMaps: MapItem[] = [];
    for (const m of maps) {
      if (m.id === mapItemId(WORLD_ID)) continue;
      const c = m.meta.regionId ? country(m.meta.regionId) : null;
      if (!c) {
        otherMaps.push(m);
        continue;
      }
      c.map = m;
      c.buildDate = m.meta.buildDate;
      const latest = catalogMaps?.find((x) => x.regionId === c.regionId)?.buildDate;
      c.update = !!latest && !!m.meta.buildDate && latest > m.meta.buildDate;
    }
    // Downloads in flight, by country (finished files of a group stay until the last one).
    const active = Object.values(records).filter((r) => ACTIVE.has(r.status) || r.status === 'failed' || r.status === 'done');
    const recordsBy = new Map<string, DownloadRecord[]>();
    for (const r of active) {
      const id = regionOfRecord(r);
      if (!id || !country(id)) continue;
      recordsBy.set(id, [...(recordsBy.get(id) ?? []), r]);
    }
    // A pack goes with the country whose map uses it (Haiti uses the Dominican Republic's).
    for (const p of packs) {
      const owner = [...byCountry.values()].find((c) => routePackFor([{ id: p.catalogId ?? '', regionId: p.meta.regionId ?? '' }], c.regionId));
      const c = owner ?? (p.meta.regionId ? country(p.meta.regionId) : null);
      if (c) c.pack = p;
    }
    for (const c of byCountry.values()) {
      c.sizeBytes = (c.map?.sizeBytes ?? 0) + (c.pack?.sizeBytes ?? 0);
      const mine = recordsBy.get(c.regionId) ?? [];
      const running = mine.filter((r) => ACTIVE.has(r.status));
      c.failed = !running.length && mine.some((r) => r.status === 'failed');
      if (!running.length) continue;
      // Queued together as one group: its files' bytes, finished ones included.
      if (mine.every((r) => recordGroup(r)?.id === countryDownloadGroup(c.regionId).id)) {
        const { bytesWritten, totalBytes } = summarize(c.regionId, c.title, mine);
        c.progress = totalBytes ? Math.min(1, bytesWritten / totalBytes) : 0;
        continue;
      }
      // Combined progress: prebuilt map parts, an extraction job and pack parts, by bytes.
      let done = 0;
      let total = 0;
      const catalogMap = catalogMaps?.find((m) => m.regionId === c.regionId);
      if (catalogMap && !c.map && running.some((r) => r.kind === 'map' && r.meta.map)) {
        done += (countryMapProgress(records, catalogMap).progress ?? 0) * catalogMap.size;
        total += catalogMap.size;
      }
      for (const r of running) {
        if (r.kind === 'map' && r.meta.map) continue;
        if (r.meta.role === 'pois') continue;
        done += r.bytesWritten;
        total += r.totalBytes || 0;
      }
      c.progress = total ? Math.min(1, done / total) : 0;
    }
    const countries = [...byCountry.values()].sort((a, b) => a.title.localeCompare(b.title, i18n.language));
    return { countries, otherMaps };
  }, [maps, packs, records, catalogMaps]);
}

/** Cancels what is still downloading and deletes the country's map and pack. */
export async function removeCountry(c: CountryState) {
  const records = Object.values(useDownloads.getState().records).filter((r) => regionOfRecord(r) === c.regionId);
  for (const id of [...countryMapDownloadIds(c.regionId), ...records.map((r) => r.id)]) await cancelDownload(id);
  if (c.map) await removeItem(c.map.id);
  if (c.pack) await removeItem(c.pack.id);
}

/** Whether a country (its map) is installed. */
export function useInstalledCountryIds(): Set<string> {
  const maps = useItems('map') as MapItem[];
  return useMemo(() => new Set(maps.map((m) => m.meta.regionId).filter((id): id is string => !!id && getRegion(id)?.type === 'country')), [maps]);
}
