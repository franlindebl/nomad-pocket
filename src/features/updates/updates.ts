// Content updates (docs/CONTENT_UPDATES_PLAN.md): newer editions of the installed archives
// (zim-check.ts) and newer builds of the installed countries (the maps and routing catalogs),
// as one list; "update all", which downloads each new version next to the old one and starts
// what doesn't fit yet as earlier updates finish and free their old copy; and the delete-first
// update for when there is no room for both.
import * as Network from 'expo-network';
import { useMemo } from 'react';
import { create } from 'zustand';

import { getItem, removeItem, useContent, type InstalledItem } from '@/features/content/items';
import { resolveLatest } from '@/features/catalog/opds';
import { enqueueDownload, NotEnoughStorageError, useDownloads } from '@/features/downloads/manager';
import { pendingBytes } from '@/features/maps/country-core';
import { useMapsCatalog, refreshMapsCatalog } from '@/features/maps/country-maps';
import {
  countryInFlight,
  countryOffer,
  currentCountries,
  downloadCountry,
  outdatedPieces,
  planCountry,
  type CountryState,
} from '@/features/maps/countries';
import { usePreparing } from '@/features/maps/prepare';
import { refreshRoutingCatalog, useRoutingCatalog } from '@/features/maps/routing-packs';
import { freeBytes, STORAGE_HEADROOM } from '@/lib/storage';
import { useSettings } from '@/stores/settings';

import { byPriority, fitsAfterFreeing, isNewerEdition, isUrgent, parseDataDate, runStep, type RunEntry } from './updates-core';
import { kiwixNameOf, useZimEditions, type ZimEdition } from './zim-check';

const ACTIVE = new Set(['queued', 'running', 'paused', 'processing']);

export type UpdateEntry = {
  /** "zim:<item id>" or "country:<region id>". */
  key: string;
  kind: 'zim' | 'country';
  title: string;
  isCourse: boolean;
  /** Data dates: YYYY-MM for archives, YYYYMMDD for countries (the oldest piece's). */
  installed: string | null;
  latest: string | null;
  /** Bytes to download. */
  bytes: number;
  /** Free space it needs with the old version kept (assembly copies included). */
  needed: number;
  /** What deleting the outdated version frees (a delete-first update). */
  freed: number;
  urgent: boolean;
  /** A routing pack this app can't read: routes don't work until it is updated. */
  broken: boolean;
  inFlight: boolean;
  /** 0–1 while downloading. */
  progress: number | null;
  failed: boolean;
  itemId?: string;
  regionId?: string;
};

/** The download id of an archive's update: what the catalog and Explore download it under. */
const zimDownloadId = (item: InstalledItem) => item.catalogId ?? item.id;

function zimEntry(item: InstalledItem, edition: ZimEdition | undefined, now: number): UpdateEntry | null {
  if (!edition || !kiwixNameOf(item) || !isNewerEdition(edition.version, item.version)) return null;
  const record = useDownloads.getState().records[zimDownloadId(item)];
  const inFlight = !!record && ACTIVE.has(record.status) && record.url === edition.url;
  return {
    key: `zim:${item.id}`,
    kind: 'zim',
    title: item.title,
    isCourse: item.isCourse,
    installed: item.version,
    latest: edition.version,
    bytes: edition.sizeBytes,
    needed: edition.sizeBytes,
    freed: item.sizeBytes,
    urgent: isUrgent({ installed: item.version }, now),
    broken: false,
    inFlight,
    progress: inFlight && record.totalBytes ? Math.min(1, record.bytesWritten / record.totalBytes) : inFlight ? 0 : null,
    failed: !!record && record.status === 'failed' && record.url === edition.url,
    itemId: item.id,
  };
}

function countryEntry(c: CountryState, now: number, pending: number): UpdateEntry | null {
  if (!c.update) return null;
  const offer = countryOffer(c.regionId);
  if (!offer) return null;
  const inFlight = countryInFlight(c.regionId);
  const plan = planCountry(offer, undefined, { update: true });
  // Nothing newer to fetch (only an on-device extraction, or already on its way).
  if (!plan.maps.length && !plan.packs.length && !inFlight) return null;
  const latest = [...plan.maps.map((m) => m.buildDate), ...plan.packs.map((p) => p.buildDate)].sort().pop() ?? null;
  return {
    key: `country:${c.regionId}`,
    kind: 'country',
    title: c.title,
    isCourse: false,
    installed: c.buildDate,
    latest,
    bytes: plan.bytes,
    // planCountry counts the whole download queue; the run counts it once for every update.
    needed: Math.max(0, plan.needed - pending),
    freed: outdatedPieces(c).reduce((sum, i) => sum + i.sizeBytes, 0),
    urgent: isUrgent({ installed: c.buildDate, broken: c.incompatible }, now),
    broken: c.incompatible,
    inFlight,
    progress: inFlight ? c.progress : null,
    failed: c.failed,
    regionId: c.regionId,
  };
}

/** Every update available now, in the order "update all" runs them. */
export function collectUpdates(): UpdateEntry[] {
  const now = Date.now();
  const editions = useZimEditions.getState().latest;
  const items = useContent.getState().items.filter((i) => i.kind === 'zim');
  const pending = pendingBytes(Object.values(useDownloads.getState().records));
  const zims = items.map((i) => zimEntry(i, editions[i.id], now));
  const countries = currentCountries().countries.map((c) => countryEntry(c, now, pending));
  return [...zims, ...countries].filter((e): e is UpdateEntry => !!e).sort(byPriority);
}

export function useUpdates(): UpdateEntry[] {
  const items = useContent((s) => s.items);
  const records = useDownloads((s) => s.records);
  const editions = useZimEditions((s) => s.latest);
  const maps = useMapsCatalog((s) => s.manifest);
  const packs = useRoutingCatalog((s) => s.manifest);
  const preparing = usePreparing((s) => s.items);
  // collectUpdates reads these stores: they stand for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => collectUpdates(), [items, records, editions, maps, packs, preparing]);
}

/** Free space downloads may still take: free space minus the headroom and what the queue has left to write. */
function available(): number {
  return freeBytes() - STORAGE_HEADROOM - pendingBytes(Object.values(useDownloads.getState().records));
}

/** Whether an update fits now with its old version kept. */
export function fitsNow(e: UpdateEntry): boolean {
  return e.needed <= available();
}

function startZim(item: InstalledItem, edition: ZimEdition) {
  enqueueDownload({
    id: zimDownloadId(item),
    kind: 'zim',
    title: item.title,
    url: edition.url,
    filename: decodeURIComponent(edition.url.split('/').pop() ?? `${edition.name}.zim`),
    expectedBytes: edition.sizeBytes,
    // What registerZimFile needs to register it under the same id (it replaces the old file once in).
    meta: {
      catalogId: zimDownloadId(item),
      title: item.title,
      description: item.description,
      language: item.language,
      category: item.category,
      isCourse: item.isCourse,
      subject: (item.meta.subject as string | null | undefined) ?? null,
      medical: item.meta.medical === true,
      version: edition.version,
      sourceUrl: edition.url,
    },
  });
}

/** Starts one update, the old version kept until the new one is in. Throws NotEnoughStorageError. */
export function startUpdate(e: UpdateEntry) {
  if (e.kind === 'zim') {
    const item = e.itemId ? getItem(e.itemId) : null;
    const edition = e.itemId ? useZimEditions.getState().latest[e.itemId] : undefined;
    if (item && edition) startZim(item, edition);
    return;
  }
  const offer = e.regionId ? countryOffer(e.regionId) : null;
  if (offer) downloadCountry(offer, undefined, { update: true });
}

// "Update all" -----------------------------------------------------------------------------

type Run = {
  /** Keys still in the run, in priority order. */
  queue: string[];
  /** Keys the run started. */
  started: string[];
  /** Keys that can't fit with their old version kept, even with nothing else downloading. */
  blocked: string[];
};

export const useUpdateRun = create<Run>(() => ({ queue: [], started: [], blocked: [] }));

let timer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;

function schedule() {
  if (timer || !useUpdateRun.getState().queue.length) return;
  timer = setTimeout(() => {
    timer = null;
    step();
  }, 1000);
}

function step() {
  const run = useUpdateRun.getState();
  if (!run.queue.length) return;
  const all = collectUpdates();
  const entries: Record<string, RunEntry> = Object.fromEntries(
    all.map((e) => [e.key, { key: e.key, outdated: true, inFlight: e.inFlight, failed: e.failed, needed: e.needed }]),
  );
  const started = new Set(run.started);
  const decided = runStep(run.queue, entries, started, available());
  const blocked = new Set(decided.blocked);
  for (const key of decided.start) {
    const entry = all.find((e) => e.key === key);
    if (!entry) continue;
    try {
      startUpdate(entry);
      started.add(key);
    } catch (e) {
      // The manager counts room a little differently: wait for what runs, or give up on it.
      if (e instanceof NotEnoughStorageError) {
        if (!all.some((x) => x.inFlight) && decided.start.length === 1) blocked.add(key);
      } else {
        console.warn('[updates] cannot start', key, e);
        decided.drop.push(key);
      }
    }
  }
  const gone = new Set([...decided.drop, ...blocked]);
  useUpdateRun.setState({
    queue: run.queue.filter((k) => !gone.has(k)),
    started: [...started].filter((k) => !gone.has(k)),
    blocked: [...new Set([...run.blocked, ...blocked])],
  });
}

/** Updates all of these (the sheet's "Actualizar todo"): what fits now, the rest as room frees up. */
export function updateAll(entries: UpdateEntry[]) {
  const keys = [...entries].filter((e) => !e.inFlight).sort(byPriority).map((e) => e.key);
  useUpdateRun.setState((s) => ({
    queue: [...s.queue, ...keys.filter((k) => !s.queue.includes(k))],
    blocked: s.blocked.filter((k) => !keys.includes(k)),
  }));
  if (!subscribed) {
    subscribed = true;
    useDownloads.subscribe(schedule);
    useContent.subscribe(schedule);
  }
  step();
}

/** Forget that an update didn't fit (it was started some other way, or the person freed space). */
export function clearBlocked(key: string) {
  useUpdateRun.setState((s) => ({ blocked: s.blocked.filter((k) => k !== key) }));
}

// Delete first ------------------------------------------------------------------------------

export type PreflightProblem = 'offline' | 'wifi' | 'unreachable' | 'space';

export class UpdatePreflightError extends Error {
  constructor(
    public problem: PreflightProblem,
    public needed = 0,
  ) {
    super(problem);
  }
}

async function reachable(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The update for when both versions don't fit: checks that it can work (a connection the
 * download may use, the new version reachable, room once the old one is gone) and only then
 * deletes the outdated version, keeping bookmarks, history and course progress, and downloads
 * the new one. Throws UpdatePreflightError, having deleted nothing.
 */
export async function deleteAndUpdate(e: UpdateEntry): Promise<void> {
  if (e.inFlight) return;
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (!net || net.isConnected === false || net.isInternetReachable === false) throw new UpdatePreflightError('offline');
  const wifi = net.type === Network.NetworkStateType.WIFI || net.type === Network.NetworkStateType.ETHERNET;
  // A download waiting for Wi-Fi would leave the person without either version.
  if (!wifi && useSettings.getState().wifiOnly) throw new UpdatePreflightError('wifi');
  const room = () => {
    const free = freeBytes() - pendingBytes(Object.values(useDownloads.getState().records));
    if (!fitsAfterFreeing(e.needed, e.freed, free, STORAGE_HEADROOM)) throw new UpdatePreflightError('space', e.needed);
  };
  room();

  if (e.kind === 'zim') {
    const item = e.itemId ? getItem(e.itemId) : null;
    const name = item ? kiwixNameOf(item) : null;
    if (!item || !name) return;
    const latest = await resolveLatest(name).catch(() => null);
    if (!latest?.url || !isNewerEdition(latest.version, item.version) || !(await reachable(latest.url))) throw new UpdatePreflightError('unreachable');
    const edition: ZimEdition = { name, version: latest.version, url: latest.url, sizeBytes: latest.sizeBytes };
    useZimEditions.setState((s) => ({ latest: { ...s.latest, [item.id]: edition } }));
    room();
    await removeItem(item.id, { keepUserData: true });
    startZim(item, edition);
    return;
  }

  await Promise.all([refreshMapsCatalog(), refreshRoutingCatalog()]);
  if (useMapsCatalog.getState().status === 'error' || useRoutingCatalog.getState().status === 'error') throw new UpdatePreflightError('unreachable');
  const c = currentCountries().countries.find((x) => x.regionId === e.regionId);
  const offer = e.regionId ? countryOffer(e.regionId) : null;
  if (!c || !offer || countryInFlight(c.regionId)) return;
  const pieces = outdatedPieces(c);
  if (!pieces.length) return;
  room();
  // Its regions now: once their maps are deleted the plan no longer sees them on the phone.
  const regions = c.regions.length ? [...c.regions] : undefined;
  for (const piece of pieces) await removeItem(piece.id, { keepUserData: true });
  downloadCountry(offer, undefined, { regions });
}

/** A data date as the person reads it: "oct 2026". */
export function dataDateLabel(d: string | null | undefined, lang: string): string {
  const t = parseDataDate(d);
  return t === null ? '' : new Date(t).toLocaleDateString(lang, { month: 'short', year: 'numeric' });
}
