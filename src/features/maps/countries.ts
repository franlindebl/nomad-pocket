// Countries as one download (docs/UX_SURVIVAL_PLAN.md): the map at full detail, the routing
// pack where the catalog has one, and the emergency points and street names that come with
// them. The UI only deals with countries; this module maps them onto map items, routing
// packs and downloads. A country the maps catalog doesn't have yet is extracted on the
// phone instead (extraction.ts), at the highest zoom a phone can handle.
import { useEffect, useMemo, useState } from 'react';

import { getItem, removeItem, useItems } from '@/features/content/items';
import { recordGroup, summarize } from '@/features/downloads/groups';
import { cancelDownload, dismissDownload, NotEnoughStorageError, resumeDownloads, useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { HttpError } from '@/lib/pmtiles';
import { fileSize, hasRoomFor } from '@/lib/storage';

import { countryNeed, countryOfGroup, isNewer, packOutdated, pendingBytes, routePackFor, type CountryMap } from './country-core';
import {
  abortCountryMap,
  countryDownloadGroup,
  countryMapDownloadIds,
  countryMapPlan,
  countryMapProgress,
  discardCountryMapFiles,
  downloadCountryMap,
  refreshMapsCatalog,
  useMapsCatalog,
} from './country-maps';
import { bestZoom, estimateExtract, mapItemId, startMapDownload, WORLD_ID, type Estimate } from './extraction';
import { getRegion, regionName, type Region } from './regions';
import { routePackId, type RoutePackItem } from './routing';
import type { ManifestPack } from './routing-core';
import { abortPack, discardPackFiles, downloadPack, packPlan, refreshRoutingCatalog, useRoutingCatalog } from './routing-packs';
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

export type CountryPlan = {
  /** The prebuilt map to fetch: not installed yet, or (`update`) a newer build. */
  map: CountryMap | null;
  /** No prebuilt map and none installed: extracted on the phone. */
  extract: boolean;
  /** The routing pack to fetch: not installed yet, or (`update`) a newer build. */
  pack: ManifestPack | null;
  /** Bytes to download (an extraction's from its estimate, when given). */
  bytes: number;
  /** Free space that takes: assembly copies and what is already in the queue included. */
  needed: number;
};

/**
 * What a country download fetches and the room it needs: one figure for the size the sheet
 * shows and the check `downloadCountry` makes (country-core countryNeed). `update`: newer
 * builds replace what is installed (only what is outdated).
 */
export function planCountry(o: CountryOffer, estimate?: Estimate, opts: { update?: boolean } = {}): CountryPlan {
  const maps = useMapsCatalog.getState().manifest;
  const routing = useRoutingCatalog.getState().manifest;
  const installedMap = getItem(mapItemId(o.region.id)) as MapItem | null;
  const installedPack = o.pack ? (getItem(routePackId(o.pack.id)) as RoutePackItem | null) : null;
  const wantMap = !installedMap || (!!opts.update && !!o.map && isNewer(o.map.buildDate, installedMap.meta.buildDate));
  const map = wantMap && o.map && maps ? o.map : null;
  const extract = wantMap && !map;
  const pack = o.pack && routing && (!installedPack || (!!opts.update && packOutdated(installedPack.meta, o.pack))) ? o.pack : null;
  const need = countryNeed([map && countryMapPlan(map), pack && packPlan(pack)], pendingBytes(Object.values(useDownloads.getState().records)));
  const extracted = extract ? (estimate?.plan.archiveBytes ?? 0) : 0;
  return { map, extract, pack, bytes: need.bytes + extracted, needed: need.needed + extracted };
}

export type CountrySize =
  | { status: 'loading' }
  /** `bytes`: what downloads; `needed`: the free space it takes (CountryPlan). */
  | { status: 'ready'; bytes: number; needed: number; estimate?: Estimate }
  | { status: 'offline' }
  | { status: 'error'; message: string };

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

/**
 * What a country download will take (planCountry): from the catalogs (refreshed on mount),
 * or, for a map the catalog doesn't have, from a dry run of the on-device extraction. Plus
 * `retry` (catalogs and estimate again, after a failure).
 */
export function useCountrySize(o: CountryOffer | null): CountrySize & { retry: () => void } {
  const mapsStatus = useMapsCatalog((s) => s.status);
  const routingStatus = useRoutingCatalog((s) => s.status);
  const catalogs = useCatalogsState();
  const installed = useItems();
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
  const plan = useMemo(
    () => (o && !catalogsLoading && catalogs === 'ready' ? planCountry(o) : null),
    // planCountry reads the installed items (and the files they came from): `installed` stands for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o, catalogsLoading, catalogs, installed],
  );
  const key = o && plan?.extract ? `${o.region.id}|${o.fallbackZoom}|${attempt}` : null;
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
      .then((e) => done({ status: 'ready', bytes: e.plan.archiveBytes, needed: e.plan.archiveBytes, estimate: e }))
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
  if (!plan) return { status: 'loading', retry };
  if (!plan.extract) return { status: 'ready', bytes: plan.bytes, needed: plan.needed, retry };
  const est = estimate?.key === key ? estimate.size : null;
  if (!est) return { status: 'loading', retry };
  return est.status === 'ready' ? { ...est, bytes: est.bytes + plan.bytes, needed: est.needed + plan.needed, retry } : { ...est, retry };
}

/**
 * Starts what a country still needs (planCountry): its map, prebuilt or extracted, and its
 * routing pack; `update`: newer builds of what is installed. `estimate`: the on-device
 * extraction plan the confirm sheet already computed (no prebuilt map). Throws
 * NotEnoughStorageError before starting anything, and queues all of it or none.
 */
export function downloadCountry(o: CountryOffer, estimate?: Estimate, opts: { update?: boolean } = {}) {
  const plan = planCountry(o, estimate, opts);
  if (!hasRoomFor(plan.needed)) throw new NotEnoughStorageError(plan.needed);
  const maps = useMapsCatalog.getState().manifest;
  const routing = useRoutingCatalog.getState().manifest;
  // One row in Downloads, even when the pack is another country's (Haiti uses the Dominican Republic's).
  const group = countryDownloadGroup(o.region.id);
  const queued: string[] = [];
  try {
    if (plan.map && maps) queued.push(...downloadCountryMap(maps, plan.map, !!o.pack?.pois, group));
    if (plan.pack && routing) queued.push(...downloadPack(routing, plan.pack, group));
  } catch (e) {
    for (const id of queued) void cancelDownload(id);
    throw e;
  }
  if (plan.extract)
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
  /** The catalogs have a newer build of this country's map or routing pack. */
  update: boolean;
};

const regionOfRecord = (r: DownloadRecord): string | null => {
  // A country's files carry its group: Haiti's include the Dominican Republic's pack.
  const country = countryOfGroup(recordGroup(r)?.id);
  if (country) return country;
  if (r.kind === 'map') {
    if (typeof r.meta.regionId === 'string') return r.meta.regionId;
    const m = /^job-map-(.+)$/.exec(r.id); // on-device extraction
    return m && getRegion(m[1])?.type === 'country' ? m[1] : null;
  }
  if (r.kind === 'route' && r.meta.role !== 'streets') return (r.meta.pack as ManifestPack | undefined)?.regionId ?? null;
  return null;
};

/** A country's downloads in flight or left over (failed ones, finished files of an unfinished group). */
const countryRecords = (regionId: string) => Object.values(useDownloads.getState().records).filter((r) => regionOfRecord(r) === regionId);

/** Installed and downloading countries, plus the maps that aren't a country (older regions, areas). */
export function useCountries(): { countries: CountryState[]; otherMaps: MapItem[] } {
  const maps = useItems('map') as MapItem[];
  const packs = useItems('route') as RoutePackItem[];
  const records = useDownloads((s) => s.records);
  const catalogMaps = useMapsCatalog((s) => s.manifest?.maps);
  const catalogPacks = useRoutingCatalog((s) => s.manifest?.packs);

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
      c.update = isNewer(catalogMaps?.find((x) => x.regionId === c.regionId)?.buildDate, m.meta.buildDate);
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
      if (!c) continue;
      c.pack = p;
      // A newer build of its roads, points and addresses, or one this app's engine can't read.
      const latest = catalogPacks?.find((x) => x.id === p.catalogId);
      if (latest && packOutdated(p.meta, latest)) c.update = true;
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
  }, [maps, packs, records, catalogMaps, catalogPacks]);
}

/**
 * The country row's retry. Files that failed to download go again; files that arrived whole
 * but whose processing failed (an assembly with parts missing) are taken from disk; parts
 * nothing brings any more are queued again (downloadCountry plans from what is on disk).
 * Throws NotEnoughStorageError before changing anything.
 */
export function retryCountry(c: CountryState) {
  const o = countryOffer(c.regionId);
  if (!o) return;
  const plan = planCountry(o);
  if (!hasRoomFor(plan.needed)) throw new NotEnoughStorageError(plan.needed);
  const failed = countryRecords(c.regionId).filter((r) => r.status === 'failed' && !r.external);
  const whole = failed.filter((r) => r.totalBytes > 0 && fileSize(r.destUri) === r.totalBytes);
  resumeDownloads(failed.filter((r) => !whole.includes(r)));
  // Planned while the failed records still vouch for the parts on disk.
  downloadCountry(o);
  // Not one downloadCountry queued again under the same id (a newer build replaced the parts).
  for (const r of whole) if (useDownloads.getState().records[r.id]?.status === 'failed') dismissDownload(r.id);
}

/** Cancels what is still downloading and deletes the country's map and pack. */
export async function removeCountry(c: CountryState) {
  const records = countryRecords(c.regionId);
  const mapIds = new Set<string>();
  const packIds = new Set<string>();
  for (const r of records) {
    const map = r.meta.map as CountryMap | undefined;
    const pack = r.meta.pack as ManifestPack | undefined;
    if (map) mapIds.add(map.id);
    if (pack) packIds.add(pack.id);
  }
  // A part being assembled must not register the map or pack once the country is gone.
  mapIds.forEach(abortCountryMap);
  packIds.forEach(abortPack);
  for (const id of new Set([...countryMapDownloadIds(c.regionId), ...records.map((r) => r.id)])) await cancelDownload(id);
  // Read again: an assembly that finished meanwhile registered its item after `c` was read.
  const items = [mapItemId(c.regionId), c.pack?.id, ...[...packIds].map(routePackId)];
  for (const id of new Set(items)) if (id && getItem(id)) await removeItem(id);
  mapIds.forEach(discardCountryMapFiles);
  packIds.forEach(discardPackFiles);
}

/** Whether a country (its map) is installed. */
export function useInstalledCountryIds(): Set<string> {
  const maps = useItems('map') as MapItem[];
  return useMemo(() => new Set(maps.map((m) => m.meta.regionId).filter((id): id is string => !!id && getRegion(id)?.type === 'country')), [maps]);
}
