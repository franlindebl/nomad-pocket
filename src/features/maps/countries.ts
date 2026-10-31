// Countries as one download (docs/UX_SURVIVAL_PLAN.md): the map at full detail, the routing
// pack where the catalog has one, and the emergency points and street names that come with
// them. The UI only deals with countries; this module maps them onto map items, routing
// packs and downloads. A country the maps catalog doesn't have yet is extracted on the
// phone instead (extraction.ts), at the highest zoom a phone can handle.
import * as Location from '@/lib/location';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { getItem, removeItem, useContent, useItems, type InstalledItem } from '@/features/content/items';
import { recordGroup, summarize } from '@/features/downloads/groups';
import { cancelDownload, dismissDownload, NotEnoughStorageError, resumeDownloads, useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { HttpError } from '@/lib/pmtiles';
import { fileSize, hasRoomFor } from '@/lib/storage';

import {
  countryNeed,
  countryOfGroup,
  countryParts,
  countryWidePacks,
  isNewer,
  packOutdated,
  partAt,
  pendingBytes,
  routePacksFor,
  type CountryMap,
  type CountryPart,
} from './country-core';
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
import { usePreparing } from './prepare';
import { preparedFraction } from './prepare-core';
import { engineReads, LEGACY_PACK_VALHALLA, type ManifestPack } from './routing-core';
import { abortPack, discardPackFiles, downloadPack, packPlan, refreshRoutingCatalog, useRoutingCatalog } from './routing-packs';
import type { MapItem } from './useMapSources';

const ACTIVE = new Set(['queued', 'running', 'paused', 'processing']);

export type CountryOffer = {
  region: Region;
  title: string;
  /** Prebuilt map from the catalog; null: extracted on the phone (size needs an estimate), or a country in regions. */
  map: CountryMap | null;
  /** Zoom of an on-device extraction. */
  fallbackZoom: number;
  /** Routing packs (several for the USA); none where none is published yet (guidance is then a straight line). */
  packs: ManifestPack[];
  /** A country downloaded region by region: its regions, each with its map and (the USA) its pack. */
  regions: CountryPart[] | null;
  /**
   * A country in regions for its map only (Canada, Russia): the whole country's pack, with its
   * points, streets, places and house numbers, which comes with the first region. Else empty.
   */
  common: ManifestPack[];
};

/** Whether a country's points come with its routing packs (no Overpass, no map side files). */
const packsBringPoints = (o: CountryOffer) => o.packs.some((p) => !!p.pois);

function offer(regionId: string, maps: CountryMap[], packs: ManifestPack[]): CountryOffer | null {
  const region = getRegion(regionId);
  if (!region || region.type !== 'country') return null;
  const parts = countryParts(regionId, maps, packs);
  const split = parts.length > 1 || parts[0].id !== regionId;
  const common = countryWidePacks(regionId, parts, packs);
  return {
    region,
    title: regionName(region, i18n.language),
    map: split ? null : parts[0].map,
    fallbackZoom: bestZoom(region.bbox),
    packs: split ? [...common, ...parts.flatMap((p) => p.packs)] : parts[0].packs,
    regions: split ? parts : null,
    common,
  };
}

/** The regions of a country in regions that are on the phone (their map is installed). */
export function installedRegions(o: CountryOffer): string[] {
  return (o.regions ?? []).filter((p) => !!getItem(mapItemId(p.id))).map((p) => p.id);
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
  /** The prebuilt maps to fetch (one per region of a country in regions): not installed yet, or (`update`) newer builds. */
  maps: CountryMap[];
  /** No prebuilt map and none installed: extracted on the phone. */
  extract: boolean;
  /** The routing packs to fetch (several for the USA): not installed yet, or (`update`) newer builds. */
  packs: ManifestPack[];
  /** Bytes to download (an extraction's from its estimate, when given). */
  bytes: number;
  /** Free space that takes: assembly copies and what is already in the queue included. */
  needed: number;
};

/** What of a pack still has to come: not installed, or (`update`) a newer build. */
const packWanted = (p: ManifestPack, update?: boolean) => {
  const installed = getItem(routePackId(p.id)) as RoutePackItem | null;
  return !installed || (!!update && packOutdated(installed.meta, p));
};

/**
 * What a country download fetches and the room it needs: one figure for the size the sheet
 * shows and the check `downloadCountry` makes (country-core countryNeed). `update`: newer
 * builds replace what is installed (only what is outdated). A country in regions: `regions`
 * are the ones to bring (default: those on the phone or on their way, so a retry or an
 * update covers what the person chose).
 */
export function planCountry(o: CountryOffer, estimate?: Estimate, opts: { update?: boolean; regions?: string[] } = {}): CountryPlan {
  const maps = useMapsCatalog.getState().manifest;
  const routing = useRoutingCatalog.getState().manifest;
  const pending = pendingBytes(Object.values(useDownloads.getState().records));
  if (o.regions) {
    const ids = new Set(opts.regions ?? [...installedRegions(o), ...regionsInFlight(o)]);
    const parts = o.regions.filter((p) => ids.has(p.id));
    const wanted = parts.flatMap((p) => {
      const installed = getItem(mapItemId(p.id)) as MapItem | null;
      return p.map && maps && (!installed || (!!opts.update && isNewer(p.map.buildDate, installed.meta.buildDate))) ? [p.map] : [];
    });
    // The whole country's pack (Canada, Russia) comes with any region.
    const packs = routing ? [...(parts.length ? o.common : []), ...parts.flatMap((p) => p.packs)].filter((p) => packWanted(p, opts.update)) : [];
    const need = countryNeed([...wanted.map(countryMapPlan), ...packs.map(packPlan)], pending);
    return { maps: wanted, extract: false, packs, bytes: need.bytes, needed: need.needed };
  }
  const installedMap = getItem(mapItemId(o.region.id)) as MapItem | null;
  const wantMap = !installedMap || (!!opts.update && !!o.map && isNewer(o.map.buildDate, installedMap.meta.buildDate));
  const map = wantMap && o.map && maps ? o.map : null;
  const extract = wantMap && !map;
  const packs = !routing ? [] : o.packs.filter((p) => packWanted(p, opts.update));
  const need = countryNeed([map && countryMapPlan(map), ...packs.map(packPlan)], pending);
  const extracted = extract ? (estimate?.plan.archiveBytes ?? 0) : 0;
  return { maps: map ? [map] : [], extract, packs, bytes: need.bytes + extracted, needed: need.needed + extracted };
}

/**
 * The regions picked for a country in regions, kept while the app runs: the country sheet and
 * the onboarding kit share them. Absent: not worked out yet (useChosenRegions).
 */
export const useRegionChoice = create<{
  chosen: Record<string, string[]>;
  choose: (country: string, regions: string[]) => void;
  /** Once they are downloading: the next pick starts again from where the person is. */
  forget: (country: string) => void;
}>()((set) => ({
  chosen: {},
  choose: (country, regions) => set((s) => ({ chosen: { ...s.chosen, [country]: regions } })),
  forget: (country) => set((s) => ({ chosen: Object.fromEntries(Object.entries(s.chosen).filter(([k]) => k !== country)) })),
}));

/**
 * The regions picked for `o` (a country in regions; undefined for any other, or while the first
 * pick is worked out): the first time, the region the person is in, from the last known
 * position; with `ask`, the location is asked for first if it never was (the only way to know
 * the region: docs/COUNTRY_REGIONS_PLAN.md). Regions already on the phone are never picked.
 */
export function useChosenRegions(o: CountryOffer | null, ask: boolean): string[] | undefined {
  const country = o?.regions ? o.region.id : null;
  const chosen = useRegionChoice((s) => (country ? s.chosen[country] : undefined));
  useEffect(() => {
    if (!o?.regions || !country || useRegionChoice.getState().chosen[country]) return;
    const pick = (ids: string[]) => {
      if (!useRegionChoice.getState().chosen[country]) useRegionChoice.getState().choose(country, ids);
    };
    let sub: { remove: () => void } | undefined;
    let gone = false;
    const resolve = (lat: number, lon: number) => {
      const here = partAt(o.regions!, { lat, lon });
      pick(here && !installedRegions(o).includes(here.id) ? [here.id] : []);
    };
    (async () => {
      let perm = await Location.getForegroundPermissionsAsync();
      if (ask && !perm.granted && perm.status === 'undetermined') perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return pick([]);
      // A recent fix only: an old one may be from another trip (another region).
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
      if (!pos) {
        try {
          pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, mayShowUserSettingsDialog: false });
        } catch {
          // Timed out: show no region now, but take the first fix that arrives while this screen is open
          // (a late fix indoors / on a cold GPS), one time, instead of leaving the region unticked for good.
          pick([]);
          const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Low }, (p) => {
            if (gone) return;
            sub?.remove();
            sub = undefined;
            // Only if the person has not ticked anything meanwhile.
            if (useRegionChoice.getState().chosen[country]?.length === 0) {
              const here = partAt(o.regions!, { lat: p.coords.latitude, lon: p.coords.longitude });
              if (here && !installedRegions(o).includes(here.id)) useRegionChoice.getState().choose(country, [here.id]);
            }
          });
          if (gone) s.remove();
          else sub = s;
          return;
        }
      }
      resolve(pos.coords.latitude, pos.coords.longitude);
    })().catch(() => pick([]));
    return () => {
      gone = true;
      sub?.remove();
    };
    // Once per country; `o` changes with every catalog refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);
  return chosen;
}

/** What the whole country's pack (Canada, Russia: CountryOffer.common) still has to download; 0 when there is none or it is in. */
export function commonBytes(o: CountryOffer): number {
  return useRoutingCatalog.getState().manifest ? countryNeed(o.common.filter((p) => packWanted(p)).map(packPlan)).bytes : 0;
}

/** What each region of a country in regions still has to download (0: on the phone), the whole country's pack aside (commonBytes). */
export function regionBytes(o: CountryOffer): Record<string, number> {
  const common = commonBytes(o);
  return Object.fromEntries((o.regions ?? []).map((p) => [p.id, Math.max(0, planCountry(o, undefined, { regions: [p.id] }).bytes - common)]));
}

/** Regions of a country whose downloads are queued, running or failed (a retry brings them). */
function regionsInFlight(o: CountryOffer): string[] {
  const ids = new Set<string>();
  for (const r of countryRecords(o.region.id)) {
    if (r.status === 'cancelled' || r.status === 'done') continue;
    const id = (r.meta.map as CountryMap | undefined)?.id ?? (r.meta.pack as ManifestPack | undefined)?.id;
    if (id && o.regions?.some((p) => p.id === id)) ids.add(id);
  }
  return [...ids];
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
export function useCountrySize(o: CountryOffer | null, regions?: string[]): CountrySize & { retry: () => void } {
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
  const regionsKey = regions?.join(' ');
  const plan = useMemo(
    () => (o && !catalogsLoading && catalogs === 'ready' ? planCountry(o, undefined, { regions }) : null),
    // planCountry reads the installed items (and the files they came from): `installed` stands for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o, catalogsLoading, catalogs, installed, regionsKey],
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
 * routing packs; `update`: newer builds of what is installed. `estimate`: the on-device
 * extraction plan the confirm sheet already computed (no prebuilt map). Throws
 * NotEnoughStorageError before starting anything, and queues all of it or none.
 */
export function downloadCountry(o: CountryOffer, estimate?: Estimate, opts: { update?: boolean; regions?: string[] } = {}) {
  const plan = planCountry(o, estimate, opts);
  if (!hasRoomFor(plan.needed)) throw new NotEnoughStorageError(plan.needed);
  const maps = useMapsCatalog.getState().manifest;
  const routing = useRoutingCatalog.getState().manifest;
  // One row in Downloads, even with several packs or another country's (Haiti uses the Dominican Republic's).
  const group = countryDownloadGroup(o.region.id);
  const queued: string[] = [];
  try {
    // A region's points come with its pack or the whole country's (Canada); a region without one (none yet) asks Overpass.
    const regionPoints = (id: string) => [...o.common, ...(o.regions?.find((p) => p.id === id)?.packs ?? [])].some((x) => !!x.pois);
    for (const map of maps ? plan.maps : []) queued.push(...downloadCountryMap(maps!, map, o.regions ? regionPoints(map.id) : packsBringPoints(o), group));
    if (routing) for (const pack of plan.packs) queued.push(...downloadPack(routing, pack, group));
    if (opts.regions) useRegionChoice.getState().forget(o.region.id);
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
      bundledPoints: packsBringPoints(o),
      estimate,
    });
}

export type CountryState = {
  regionId: string;
  title: string;
  /** The country's map (the first region's, for a country in regions). */
  map: MapItem | null;
  /** Every map of the country: one, or one per region on the phone. */
  maps: MapItem[];
  /** A country in regions: the ids of its regions on the phone (us-west…); else empty. */
  regions: string[];
  packs: RoutePackItem[];
  /** Bytes on disk (map + packs). */
  sizeBytes: number;
  /** 0–1 while something is downloading, else null. */
  progress: number | null;
  /**
   * 0–1 while its maps and packs are being prepared after the download (search index, side
   * file imports, emergency points: prepare.ts), else null. Ready to use only after it.
   */
  preparing: number | null;
  failed: boolean;
  /** YYYYMMDD of the map data. */
  buildDate: string | null;
  /** The catalogs have a newer build of this country's map or routing pack. */
  update: boolean;
  /** A routing pack this app's engine can't read (built by another Valhalla): routes need the update. */
  incompatible: boolean;
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

/** Whether a country's files are downloading or being processed (its update, say). */
export function countryInFlight(regionId: string): boolean {
  return countryRecords(regionId).some((r) => ACTIVE.has(r.status));
}

/** A country's installed maps and packs that the catalogs have a newer (or readable) build of. */
export function outdatedPieces(c: CountryState): InstalledItem[] {
  const catalogMaps = useMapsCatalog.getState().manifest?.maps;
  const catalogPacks = useRoutingCatalog.getState().manifest?.packs;
  const maps = c.maps.filter((m) => isNewer(catalogMaps?.find((x) => x.id === (m.catalogId ?? c.regionId))?.buildDate, m.meta.buildDate));
  const packs = c.packs.filter((p) => {
    const latest = catalogPacks?.find((x) => x.id === p.catalogId);
    return !!latest && packOutdated(p.meta, latest);
  });
  return [...maps, ...packs];
}

/** Installed and downloading countries, plus the maps that aren't a country (older regions, areas). */
export function useCountries(): { countries: CountryState[]; otherMaps: MapItem[] } {
  const maps = useItems('map') as MapItem[];
  const packs = useItems('route') as RoutePackItem[];
  const records = useDownloads((s) => s.records);
  const catalogMaps = useMapsCatalog((s) => s.manifest?.maps);
  const catalogPacks = useRoutingCatalog((s) => s.manifest?.packs);
  const preparing = usePreparing((s) => s.items);
  return useMemo(
    () => buildCountries(maps, packs, records, catalogMaps, catalogPacks, preparing),
    [maps, packs, records, catalogMaps, catalogPacks, preparing],
  );
}

/** useCountries outside React (the content updates run reads it from the stores). */
export function currentCountries(): { countries: CountryState[]; otherMaps: MapItem[] } {
  const items = useContent.getState().items;
  return buildCountries(
    items.filter((i) => i.kind === 'map') as MapItem[],
    items.filter((i) => i.kind === 'route') as RoutePackItem[],
    useDownloads.getState().records,
    useMapsCatalog.getState().manifest?.maps,
    useRoutingCatalog.getState().manifest?.packs,
    usePreparing.getState().items,
  );
}

function buildCountries(
  maps: MapItem[],
  packs: RoutePackItem[],
  records: Record<string, DownloadRecord>,
  catalogMaps: CountryMap[] | undefined,
  catalogPacks: ManifestPack[] | undefined,
  preparing: ReturnType<typeof usePreparing.getState>['items'],
): { countries: CountryState[]; otherMaps: MapItem[] } {
  const byCountry = new Map<string, CountryState>();
  const country = (regionId: string): CountryState | null => {
    const region = getRegion(regionId);
    if (!region || region.type !== 'country') return null;
    let c = byCountry.get(regionId);
    if (!c) {
      c = {
        regionId,
        title: regionName(region, i18n.language),
        map: null,
        maps: [],
        regions: [],
        packs: [],
        sizeBytes: 0,
        progress: null,
        preparing: null,
        failed: false,
        buildDate: null,
        update: false,
        incompatible: false,
      };
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
    c.maps.push(m);
    c.map ??= m;
    // A region's map is named after it (us-west); the country's after the country.
    const mapId = m.catalogId ?? c.regionId;
    if (mapId !== c.regionId) c.regions.push(mapId);
    if (!c.buildDate || (m.meta.buildDate && m.meta.buildDate < c.buildDate)) c.buildDate = m.meta.buildDate;
    if (isNewer(catalogMaps?.find((x) => x.id === mapId)?.buildDate, m.meta.buildDate)) c.update = true;
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
    const owner = [...byCountry.values()].find((c) => routePacksFor([{ id: p.catalogId ?? '', regionId: p.meta.regionId ?? '' }], c.regionId).length);
    const c = owner ?? (p.meta.regionId ? country(p.meta.regionId) : null);
    if (!c) continue;
    c.packs.push(p);
    // A newer build of its roads, points and addresses, or one this app's engine can't read.
    const latest = catalogPacks?.find((x) => x.id === p.catalogId);
    if (latest && packOutdated(p.meta, latest)) c.update = true;
    if (!engineReads(p.meta.valhalla ?? LEGACY_PACK_VALHALLA)) c.incompatible = true;
  }
  for (const c of byCountry.values()) {
    c.sizeBytes = c.maps.reduce((sum, m) => sum + m.sizeBytes, 0) + c.packs.reduce((sum, p) => sum + p.sizeBytes, 0);
    c.preparing = preparedFraction(preparing, [...c.maps, ...c.packs].map((i) => i.id));
    c.regions.sort();
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
}

/** Countries whose files are in and that are still being prepared (search, emergency points). */
export function usePreparingCountries(): CountryState[] {
  const { countries } = useCountries();
  return useMemo(() => countries.filter((c) => c.progress === null && c.preparing !== null), [countries]);
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

/** Cancels what is still downloading and deletes the country's map and packs. */
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
  for (const m of c.maps) if (m.catalogId) mapIds.add(m.catalogId);
  const items = [mapItemId(c.regionId), ...c.maps.map((m) => m.id), ...[...mapIds].map(mapItemId), ...c.packs.map((p) => p.id), ...[...packIds].map(routePackId)];
  for (const id of new Set(items)) if (id && getItem(id)) await removeItem(id);
  mapIds.forEach(discardCountryMapFiles);
  packIds.forEach(discardPackFiles);
}

/** One region of a country in regions: cancels what is coming and deletes its map and pack (the last one takes the country). */
export async function removeCountryRegion(c: CountryState, regionId: string) {
  const o = countryOffer(c.regionId);
  // The last region takes the whole country's pack too (Canada, Russia).
  if (o?.common.length && ![...installedRegions(o), ...regionsInFlight(o)].some((id) => id !== regionId)) return removeCountry(c);
  const part = o?.regions?.find((p) => p.id === regionId);
  const packIds = new Set([regionId, ...(part?.packs.map((p) => p.id) ?? [])]);
  const records = countryRecords(c.regionId).filter(
    (r) => (r.meta.map as CountryMap | undefined)?.id === regionId || packIds.has((r.meta.pack as ManifestPack | undefined)?.id ?? ''),
  );
  abortCountryMap(regionId);
  packIds.forEach(abortPack);
  for (const r of records) await cancelDownload(r.id);
  for (const id of [mapItemId(regionId), ...[...packIds].map(routePackId)]) if (getItem(id)) await removeItem(id);
  discardCountryMapFiles(regionId);
  packIds.forEach(discardPackFiles);
}

/** Whether a country (its map) is installed. */
export function useInstalledCountryIds(): Set<string> {
  const maps = useItems('map') as MapItem[];
  return useMemo(() => new Set(maps.map((m) => m.meta.regionId).filter((id): id is string => !!id && getRegion(id)?.type === 'country')), [maps]);
}
