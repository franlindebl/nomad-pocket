// Region downloads: extract a bbox from the Protomaps daily planet build into a
// local .pmtiles file (src/lib/pmtiles), shown in the downloads sheet as an
// external job, then registered as an installed item of kind 'map'.
import { fetch as expoFetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { upsertItem } from '@/features/content/items';
import { NotEnoughStorageError, startExternalJob, useDownloads } from '@/features/downloads/manager';
import { executeExtract, FetchSource, planExtract, type BBox, type ExtractPlan, type FetchSourceOptions } from '@/lib/pmtiles';
import { contentFile, deleteFile, hasRoomFor, partialDir } from '@/lib/storage';

const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = 'https://build.protomaps.com/';

/** Low-zoom world layer kept under regional extracts (~15 MB). */
export const WORLD_ID = 'world';
export const WORLD_MAX_ZOOM = 5;
export const WORLD_BBOX: BBox = [-180, -85.0511, 180, 85.0511];

/** Max-zoom choices offered for regions: detail vs. size. */
export const ZOOM_CHOICES = [12, 14, 15] as const;
export type ZoomChoice = (typeof ZOOM_CHOICES)[number];

export type MapItemMeta = {
  role: 'world' | 'region';
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  /** Planet build, YYYYMMDD. */
  buildDate: string;
  regionId?: string | null;
};

export type Build = { url: string; date: string };

let cachedBuild: { build: Build; at: number } | null = null;

/** Latest daily planet build (cached for 6 h). */
export async function latestBuild(signal?: AbortSignal): Promise<Build> {
  if (cachedBuild && Date.now() - cachedBuild.at < 6 * 3600_000) return cachedBuild.build;
  const res = await expoFetch(BUILDS_URL, { signal });
  if (!res.ok) throw new Error(`builds.json HTTP ${res.status}`);
  const list = (await res.json()) as { key: string }[];
  const keys = list.map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort();
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
  const build = await latestBuild(signal);
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
  estimate?: Estimate;
};

const running = new Set<string>();

export function isMapJobRunning(key: string) {
  return running.has(key);
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
  const part = new File(partialDir(), `${mapItemId(input.key)}.pmtiles.part`);

  (async () => {
    let handle: ReturnType<File['open']> | null = null;
    activateKeepAwakeAsync(jobId).catch(() => {});
    try {
      const { plan, build } = input.estimate ?? (await estimateExtract(input.bbox, input.minZoom, input.maxZoom, ctrl.signal));
      if (!hasRoomFor(plan.archiveBytes)) throw new NotEnoughStorageError(plan.archiveBytes);
      job.update({ totalBytes: plan.downloadBytes, bytesWritten: 0 });

      if (part.exists) part.delete();
      part.create();
      handle = part.open(FileMode.ReadWrite);
      const h = handle;
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
          onProgress: (p) => job.update({ bytesWritten: p.bytes, totalBytes: p.totalBytes }),
        },
      );
      handle.close();
      handle = null;

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
      job.finish();
    } catch (e) {
      try {
        handle?.close();
      } catch {
        // already closed
      }
      deleteFile(part.uri);
      if (ctrl.signal.aborted) useDownloads.getState().remove(jobId);
      else job.fail(e instanceof NotEnoughStorageError ? 'NOT_ENOUGH_STORAGE' : String((e as Error)?.message ?? e));
    } finally {
      running.delete(input.key);
      deactivateKeepAwake(jobId);
    }
  })();
}
