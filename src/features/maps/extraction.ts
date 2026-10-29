// On-device map extraction: a bbox from the Protomaps daily planet build into a local
// .pmtiles file (src/lib/pmtiles), shown in the downloads sheet as an external job, then
// registered as an installed item of kind 'map'. Country maps normally come prebuilt from
// CI (country-maps.ts); this is the fallback for a country the catalog doesn't have yet.
// A job survives the app being killed: its inputs, the pinned build and the finished tile
// requests are saved (extraction-core.ts) and resumeMapDownloads() continues from them.
import { fetch as expoFetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import Storage from '@/db/kv';
import { upsertItem } from '@/features/content/items';
import { NotEnoughStorageError, startExternalJob, useDownloads } from '@/features/downloads/manager';
import {
  countBBoxTiles,
  executeExtract,
  FetchSource,
  HttpError,
  planExtract,
  type BBox,
  type ExtractPlan,
  type FetchSourceOptions,
} from '@/lib/pmtiles';
import { contentFile, deleteFile, hasRoomFor, partialDir } from '@/lib/storage';

import { doneBytes, encodeDone, fingerprintOf, parseSaved, sameJob, usableDone, type SavedExtraction } from './extraction-core';

const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = 'https://build.protomaps.com/';
/** Dev/E2E only: a planet-like .pmtiles served with HTTP Range (docs/E2E.md) replaces the Protomaps build. */
const BUILD_OVERRIDE = process.env.EXPO_PUBLIC_PLANET_BUILD_URL;

/** Low-zoom world layer kept under regional extracts (~15 MB). */
export const WORLD_ID = 'world';
export const WORLD_MAX_ZOOM = 5;
export const WORLD_BBOX: BBox = [-180, -85.0511, 180, 85.0511];

/** Above this many tiles the plan gets too heavy for a phone (memory, time). */
const MAX_TILES = 2_500_000;

/** Full detail (z15) unless the area is too big to extract on a phone. */
export function bestZoom(bbox: BBox): number {
  return [15, 14, 13, 12, 11, 10].find((z) => countBBoxTiles(bbox, 0, z) <= MAX_TILES) ?? 10;
}

export type MapItemMeta = {
  role: 'world' | 'region';
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  /** Planet build, YYYYMMDD. */
  buildDate: string;
  regionId?: string | null;
  /** Emergency points came with the download (country map or routing pack): no Overpass. */
  bundledPoints?: boolean;
  /**
   * Every named place and street of its country comes in search files (country map or routing
   * pack): its tiles are indexed at a low zoom, and never in detail around the user (places.ts).
   */
  bundledSearch?: boolean;
};

export type Build = { url: string; date: string };

let cachedBuild: { build: Build; at: number } | null = null;

/** Latest daily planet build (cached for 6 h). */
export async function latestBuild(signal?: AbortSignal): Promise<Build> {
  if (BUILD_OVERRIDE) return { url: BUILD_OVERRIDE, date: /(\d{8})\.pmtiles$/.exec(BUILD_OVERRIDE)?.[1] ?? '20000101' };
  if (cachedBuild && Date.now() - cachedBuild.at < 6 * 3600_000) return cachedBuild.build;
  const res = await expoFetch(BUILDS_URL, { signal });
  if (!res.ok) throw new Error(`builds.json HTTP ${res.status}`);
  const list = (await res.json()) as { key: string }[];
  const keys = list
    .map((b) => b.key)
    .filter((k) => /^\d{8}\.pmtiles$/.test(k))
    .sort();
  const key = keys[keys.length - 1];
  if (!key) throw new Error('no planet builds listed');
  const build = { url: BUILD_BASE + key, date: key.slice(0, 8) };
  cachedBuild = { build, at: Date.now() };
  return build;
}

function source(url: string) {
  // expo/fetch hands back native ArrayBuffers (no base64 bridge), which matters
  // for multi-megabyte range responses.
  return new FetchSource(url, { fetch: expoFetch as unknown as FetchSourceOptions['fetch'] });
}

export type Estimate = { plan: ExtractPlan; build: Build };

const estimates = new Map<string, Estimate>();
const estimateKey = (bbox: BBox, minZoom: number, maxZoom: number) => `${bbox.map((v) => v.toFixed(4)).join(',')}|${minZoom}|${maxZoom}`;

/**
 * Dry run: reads only the archive directories and returns the exact archive size
 * and download size. The plan is kept so confirming does not redo the work.
 */
export async function estimateExtract(bbox: BBox, minZoom: number, maxZoom: number, signal?: AbortSignal): Promise<Estimate> {
  return planAt(await latestBuild(signal), bbox, minZoom, maxZoom, signal);
}

/** The plan for a given build (a resumed job keeps the build it started with). */
async function planAt(build: Build, bbox: BBox, minZoom: number, maxZoom: number, signal?: AbortSignal): Promise<Estimate> {
  const key = `${build.url}|${estimateKey(bbox, minZoom, maxZoom)}`;
  const hit = estimates.get(key);
  if (hit) return hit;
  const plan = await planExtract(source(build.url), { bbox, minZoom, maxZoom, signal, concurrency: 6 });
  const est = { plan, build };
  estimates.set(key, est);
  if (estimates.size > 12) estimates.delete(estimates.keys().next().value!);
  return est;
}

export function forgetEstimates() {
  estimates.clear();
}

export function mapItemId(key: string) {
  return `map-${key}`;
}

export type StartMapDownload = {
  /** Stable key: region id, 'world', or 'area-…'. */
  key: string;
  title: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  regionId?: string | null;
  bundledPoints?: boolean;
  estimate?: Estimate;
  /** Resuming: the planet build the job started with. */
  build?: Build;
};

// --- Saved jobs (survive a kill) ------------------------------------------------------
const SAVED_KEY = 'maps.extractions';
/** Progress is saved at most this often; a kill loses at most this much work. */
const SAVE_EVERY_MS = 1500;

const loadSaved = (): SavedExtraction[] => {
  try {
    return parseSaved(Storage.getItemSync(SAVED_KEY));
  } catch {
    return [];
  }
};
const writeSaved = (list: SavedExtraction[]) => {
  try {
    Storage.setItemSync(SAVED_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[maps] cannot save extraction progress', e);
  }
};
const saveJob = (job: SavedExtraction) => writeSaved([...loadSaved().filter((j) => j.key !== job.key), job]);
const forgetJob = (key: string) => writeSaved(loadSaved().filter((j) => j.key !== key));

const partFile = (key: string) => new File(partialDir(), `${mapItemId(key)}.pmtiles.part`);

/** Startup: drop leftover .part files nobody can resume, and continue the saved jobs (in the background). */
export function resumeMapDownloads() {
  const saved = loadSaved();
  const keep = new Set(saved.map((j) => `${mapItemId(j.key)}.pmtiles.part`));
  for (const entry of partialDir().list()) {
    if (entry.name.startsWith('map-') && entry.name.endsWith('.pmtiles.part') && !keep.has(entry.name)) {
      try {
        entry.delete();
      } catch {
        // in use or gone
      }
    }
  }
  for (const job of saved) {
    // Killed after the file was moved into place: nothing left to do.
    if (!partFile(job.key).exists && contentFile('map', `${job.key}.pmtiles`).exists) {
      forgetJob(job.key);
      continue;
    }
    try {
      startMapDownload({
        key: job.key,
        title: job.title,
        bbox: job.bbox,
        minZoom: job.minZoom,
        maxZoom: job.maxZoom,
        regionId: job.regionId,
        bundledPoints: job.bundledPoints,
        build: job.build,
      });
    } catch (e) {
      console.warn('[maps] cannot resume extraction', job.key, e);
    }
  }
}

const running = new Set<string>();

type InstalledListener = (itemId: string) => void;
const installedListeners: InstalledListener[] = [];

/** Called after a region or the world basemap finishes downloading (register.ts indexes it). */
export function onMapInstalled(fn: InstalledListener) {
  installedListeners.push(fn);
}

/** Tells the listeners (search index, emergency points) about a newly installed map. */
export function notifyMapInstalled(itemId: string) {
  for (const fn of installedListeners) {
    try {
      fn(itemId);
    } catch (e) {
      console.warn('[maps] installed listener failed', e);
    }
  }
}

export function startMapDownload(input: StartMapDownload) {
  const jobId = `job-${mapItemId(input.key)}`;
  if (running.has(input.key)) return;
  if (input.estimate && !hasRoomFor(input.estimate.plan.archiveBytes)) throw new NotEnoughStorageError(input.estimate.plan.archiveBytes);
  running.add(input.key);
  const ctrl = new AbortController();
  const job = startExternalJob({
    id: jobId,
    kind: 'map',
    title: input.title,
    totalBytes: input.estimate?.plan.downloadBytes ?? 0,
    cancel: () => ctrl.abort(),
  });
  const part = partFile(input.key);

  (async () => {
    let handle: ReturnType<File['open']> | null = null;
    // Trailing save for requests that finish inside a SAVE_EVERY_MS window (else a kill right
    // after a burst of completions loses them all).
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const stopSaving = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
    };
    activateKeepAwakeAsync(jobId).catch(() => {});
    try {
      let saved = loadSaved().find((j) => sameJob(j, input)) ?? null;
      let est = input.estimate;
      if (!est && input.build) {
        // Resuming: the same build, unless the server no longer has it (then start over on the latest).
        try {
          est = await planAt(input.build, input.bbox, input.minZoom, input.maxZoom, ctrl.signal);
        } catch (e) {
          if (!(e instanceof HttpError) || ctrl.signal.aborted) throw e;
          saved = null;
        }
      }
      const { plan, build } = est ?? (await estimateExtract(input.bbox, input.minZoom, input.maxZoom, ctrl.signal));
      const partSize = part.exists ? Number(part.size ?? 0) : null;
      const done = usableDone(saved, build.url, plan, partSize);
      if (!hasRoomFor(plan.archiveBytes - (done.size ? (partSize ?? 0) : 0))) throw new NotEnoughStorageError(plan.archiveBytes);
      job.update({ totalBytes: plan.downloadBytes, bytesWritten: doneBytes(plan, done) });

      const record: SavedExtraction = {
        v: 1,
        key: input.key,
        title: input.title,
        bbox: input.bbox,
        minZoom: input.minZoom,
        maxZoom: input.maxZoom,
        regionId: input.regionId ?? null,
        bundledPoints: !!input.bundledPoints,
        build,
        fingerprint: fingerprintOf(plan),
        done: '',
      };
      const persist = () => saveJob({ ...record, done: encodeDone(done) });
      if (!done.size) {
        if (part.exists) part.delete();
        part.create();
      }
      persist();
      handle = part.open(FileMode.ReadWrite);
      const h = handle;
      let savedAt = Date.now();
      await executeExtract(
        source(build.url),
        plan,
        {
          write: (offset, data) => {
            h.offset = offset;
            h.writeBytesSync(data);
          },
        },
        {
          signal: ctrl.signal,
          concurrency: 4,
          done: done.size ? new Set(done) : undefined,
          onRequestDone: (i) => {
            done.add(i);
            const wait = SAVE_EVERY_MS - (Date.now() - savedAt);
            if (wait <= 0) {
              stopSaving();
              savedAt = Date.now();
              persist();
            } else if (!saveTimer) {
              saveTimer = setTimeout(() => {
                saveTimer = null;
                savedAt = Date.now();
                persist();
              }, wait);
            }
          },
          onProgress: (p) => job.update({ bytesWritten: p.bytes, totalBytes: p.totalBytes }),
        },
      );
      stopSaving();
      handle.close();
      handle = null;
      persist();

      job.update({ status: 'processing' });
      const dest = contentFile('map', `${input.key}.pmtiles`);
      if (dest.exists) dest.delete();
      part.moveSync(dest);
      const meta: MapItemMeta = {
        role: input.key === WORLD_ID ? 'world' : 'region',
        bbox: [plan.header.minLon, plan.header.minLat, plan.header.maxLon, plan.header.maxLat],
        minZoom: plan.header.minZoom,
        maxZoom: plan.header.maxZoom,
        buildDate: build.date,
        regionId: input.regionId ?? null,
        bundledPoints: input.bundledPoints,
      };
      upsertItem({
        id: mapItemId(input.key),
        kind: 'map',
        title: input.title,
        description: null,
        language: null,
        category: 'maps',
        isCourse: false,
        fileUri: dest.uri,
        // expo-file-system 58 reports int64 values as BigInt.
        sizeBytes: Number(dest.size ?? plan.archiveBytes),
        version: build.date,
        sourceUrl: build.url,
        catalogId: input.regionId ?? null,
        meta,
      });
      forgetJob(input.key);
      job.finish();
      notifyMapInstalled(mapItemId(input.key));
    } catch (e) {
      try {
        handle?.close();
      } catch {
        // already closed
      }
      // A network failure (offline at launch, connection lost, a server error) keeps the saved
      // progress: the next launch continues it. Cancelled, no room, or the build gone (4xx): nothing
      // to resume. (A kill never gets here and keeps both.)
      const transient =
        !ctrl.signal.aborted && !(e instanceof NotEnoughStorageError) && !(e instanceof HttpError && e.status >= 400 && e.status < 500);
      const discard = () => {
        deleteFile(part.uri);
        forgetJob(input.key);
      };
      const kept = transient && loadSaved().some((j) => j.key === input.key && j.done);
      if (!kept) discard();
      if (ctrl.signal.aborted) useDownloads.getState().remove(jobId);
      else
        job.fail(e instanceof NotEnoughStorageError ? 'NOT_ENOUGH_STORAGE' : String((e as Error)?.message ?? e), {
          // Retry continues from the kept progress, on the build it started with.
          retry: () => {
            try {
              startMapDownload({ ...input, build: loadSaved().find((j) => j.key === input.key)?.build ?? input.build });
            } catch (err) {
              // Still no room: the row keeps its error and its Retry.
              console.warn('[maps] cannot retry extraction', input.key, err);
            }
          },
          // Dismissed instead: nothing should continue it on the next launch.
          discard: kept ? discard : undefined,
        });
    } finally {
      stopSaving();
      running.delete(input.key);
      deactivateKeepAwake(jobId);
    }
  })();
}
