// Country maps built in CI (.github/workflows/country-packages.yml): the catalog
// (maps-manifest.json on the fixed release `maps-index`), downloads through the download
// manager (one per archive part, plus the country's emergency points, street names, named
// places and house numbers where no routing pack brings them) and assembling the parts into
// content/maps/<id>.pmtiles.
//
// Crash safety, as in routing-packs.ts: parts are appended into <id>.pmtiles.tmp, checked
// against the manifest size and renamed; only then is the item registered and are the parts
// deleted, and the last part's download is done. The side files are imported after that, on
// their own (side-files.ts: replayed after a kill). Parts and side files stay on disk while
// any download of their map is left, failed ones included (a retry fetches only what is
// missing); the startup sweep deletes the rest.
import { File, FileMode } from 'expo-file-system';
import { create } from 'zustand';

import Storage from '@/db/kv';
import { getItem, upsertItem } from '@/features/content/items';
import { recordGroup } from '@/features/downloads/groups';
import {
  cancelDownload,
  enqueueDownload,
  useDownloads,
  type DownloadGroup,
  type DownloadRecord,
  type EnqueueInput,
} from '@/features/downloads/manager';
import i18n from '@/i18n';
import { contentDir, contentFile, deleteFile } from '@/lib/storage';

import { oneAssemblyAtATime } from './assembly';
import { countryGroupId, mapAssetUrl, parseMapsManifest, type CountryMap, type MapsManifest, type PlannedArchive } from './country-core';
import { storeEmergencyPointsFile } from './emergency';
import { mapItemId, notifyMapInstalled, type MapItemMeta } from './extraction';
import { indexMapStreets, indexPackAddresses, indexPackPlaces } from './places';
import { getRegion, regionName } from './regions';
import { fileIntegrity } from './routing-core';
import { expectedSideFiles, expectSideFiles, forgetSideFile, importSideFile, isImporting } from './side-files';

const REPO = 'franlindebl/nomad-pocket';
const MANIFEST_URL = process.env.EXPO_PUBLIC_MAPS_MANIFEST_URL ?? `https://github.com/${REPO}/releases/download/maps-index/maps-manifest.json`;
const CACHE_KEY = 'maps.countryManifest';
const COPY_CHUNK = 8 * 1024 * 1024;
const ACTIVE = new Set(['queued', 'running', 'paused', 'processing']);

type CatalogState = { manifest: MapsManifest | null; status: 'idle' | 'loading' | 'error' };

export const useMapsCatalog = create<CatalogState>(() => {
  let manifest: MapsManifest | null = null;
  try {
    const cached = Storage.getItemSync(CACHE_KEY);
    manifest = cached ? parseMapsManifest(cached) : null;
  } catch {
    // no cache yet
  }
  return { manifest, status: 'idle' };
});

/** Fetches the catalog (keeps the cached one when offline). */
export async function refreshMapsCatalog(): Promise<void> {
  if (useMapsCatalog.getState().status === 'loading') return;
  useMapsCatalog.setState({ status: 'loading' });
  try {
    const res = await fetch(MANIFEST_URL, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const manifest = parseMapsManifest(text);
    if (!manifest) throw new Error('bad manifest');
    Storage.setItemSync(CACHE_KEY, text);
    useMapsCatalog.setState({ manifest, status: 'idle' });
    fetchMissingMapSideFiles(manifest);
  } catch (e) {
    console.warn('[maps] country catalog', e);
    useMapsCatalog.setState({ status: 'error' });
  }
}

const title = (map: CountryMap) => {
  const region = getRegion(map.regionId);
  return region ? regionName(region, i18n.language) : map.id;
};

/** A country's map, routing pack and search files are one row in Downloads ("Mapa de España"). */
export function countryDownloadGroup(regionId: string): DownloadGroup {
  const region = getRegion(regionId);
  return {
    id: countryGroupId(regionId),
    title: i18n.t('maps:download.group', { name: region ? regionName(region, i18n.language) : regionId }),
  };
}

/**
 * Queues files that make one thing: all of them or none. The download manager checks the room
 * for each file against the queue so far, so a later file can be refused after the first ones
 * went in: those are cancelled again. Returns the ids it queued (not ones already in the queue).
 */
export function enqueueAll(inputs: EnqueueInput[]): string[] {
  const queued: string[] = [];
  try {
    for (const input of inputs) {
      const existing = useDownloads.getState().records[input.id];
      if (existing && ACTIVE.has(existing.status)) continue;
      enqueueDownload(input);
      queued.push(input.id);
    }
  } catch (e) {
    for (const id of queued) void cancelDownload(id);
    throw e;
  }
  return queued;
}

/** Files that come with a map (where no routing pack brings them), imported once it is installed. */
const SIDE_FILES = ['pois', 'streets', 'places', 'addresses'] as const;
type SideFile = (typeof SIDE_FILES)[number];
const isSideFile = (role: unknown): role is SideFile => SIDE_FILES.includes(role as SideFile);
type MapMeta = { map: CountryMap; bundledPoints: boolean; regionId: string };

const FILE_RE = /^(.+?)\.(pmtiles\.tmp|pmtiles\.part\d+|pois\.tsv|streets\.tsv|places\.tsv|addresses\.tsv)$/;
const SIDE_RE = /^(.+?)\.(pois|streets|places|addresses)\.tsv$/;

const partId = (map: string, i: number) => `country-${map}-p${i}`;
const sideId = (map: string, role: SideFile) => `country-${map}-${role}`;
const partName = (map: string, i: number) => `${map}.pmtiles.part${String(i).padStart(2, '0')}`;
const sideName = (map: string, role: SideFile) => `${map}.${role}.tsv`;
const sideFile = (map: string, role: SideFile) => contentFile('map', sideName(map, role));

const sizeOf = (f: File) => (f.exists ? Number(f.size ?? 0) : -1);
const partOnDisk = (map: CountryMap, i: number) => sizeOf(contentFile('map', partName(map.id, i))) === map.parts[i].size;
const sideOnDisk = (map: CountryMap, role: SideFile) => sizeOf(sideFile(map.id, role)) === map[role]?.size;

/** Downloads of a map's files, whatever their build. */
const recordsOf = (mapId: string) =>
  Object.values(useDownloads.getState().records).filter((r) => r.kind === 'map' && r.status !== 'cancelled' && (r.meta.map as CountryMap | undefined)?.id === mapId);

/**
 * Parts on disk count only while the map's downloads (all of the same build) vouch for them:
 * the first parts of every build are the same size, so a part from before a monthly rebuild
 * would pass the size checks and corrupt the archive.
 */
function partsTrusted(map: CountryMap): boolean {
  const mine = recordsOf(map.id);
  return mine.length > 0 && mine.every((r) => (r.meta.map as CountryMap).buildDate === map.buildDate);
}

/** The map's item, from the `<map id>` its files are named after (the region's, as a rule). */
function itemOfMap(mapId: string): string {
  return mapItemId(useMapsCatalog.getState().manifest?.maps.find((m) => m.id === mapId)?.regionId ?? mapId);
}

/** What a country map still needs from the network (countries.ts sizes and checks the whole country). */
export function countryMapPlan(map: CountryMap): PlannedArchive {
  const records = useDownloads.getState().records;
  const trusted = partsTrusted(map);
  const queued = (id: string) => {
    const r = records[id];
    return !!r && ACTIVE.has(r.status) && (r.meta.map as CountryMap | undefined)?.buildDate === map.buildDate;
  };
  return {
    size: map.size,
    parts: map.parts.map((p, i) => ({ size: p.size, onDisk: trusted && partOnDisk(map, i), queued: queued(partId(map.id, i)) })),
    sides: SIDE_FILES.filter((role) => !!map[role]).map((role) => ({ size: map[role]!.size, onDisk: sideOnDisk(map, role), queued: queued(sideId(map.id, role)) })),
  };
}

const partInput = (manifest: MapsManifest, map: CountryMap, i: number, meta: MapMeta, group: DownloadGroup): EnqueueInput => ({
  id: partId(map.id, i),
  kind: 'map',
  title: map.parts.length > 1 ? `${title(map)} (${i + 1}/${map.parts.length})` : title(map),
  url: mapAssetUrl(manifest, map, map.parts[i].name, REPO),
  filename: partName(map.id, i),
  expectedBytes: map.parts[i].size,
  integrity: fileIntegrity(map.parts[i]),
  meta: { ...meta, role: 'part', index: i },
  group,
  // A group cancel may stop the assembly: it checks that this record still exists.
  abortable: true,
});

const sideInput = (manifest: MapsManifest, map: CountryMap, role: SideFile, meta: MapMeta, group: DownloadGroup): EnqueueInput => ({
  id: sideId(map.id, role),
  kind: 'map',
  title: title(map),
  url: mapAssetUrl(manifest, map, map[role]!.name, REPO),
  filename: sideName(map.id, role),
  expectedBytes: map[role]!.size,
  integrity: fileIntegrity(map[role]!),
  meta: { ...meta, role },
  group,
});

/** Parts no download of this build vouches for (the catalog moved on before a retry): dropped with their downloads. */
function dropUntrustedParts(map: CountryMap) {
  if (partsTrusted(map)) return;
  for (const r of recordsOf(map.id)) void cancelDownload(r.id);
  for (const entry of contentDir('map').list()) {
    if (entry instanceof File && entry.name.startsWith(`${map.id}.pmtiles.part`)) deleteFile(entry.uri);
  }
}

/**
 * Queues the files of a country map that are not on disk yet (a retry fetches only what is
 * missing) and returns the ids it queued; with every part on disk, assembles it. The caller
 * checks the room first (countries.ts planCountry). `bundledPoints`: the country's points come
 * with it (its own file or a routing pack), so no Overpass after.
 */
export function downloadCountryMap(manifest: MapsManifest, map: CountryMap, bundledPoints: boolean, group = countryDownloadGroup(map.regionId)): string[] {
  dropUntrustedParts(map);
  const meta: MapMeta = { map, bundledPoints: bundledPoints || !!map.pois, regionId: map.regionId };
  const missing = map.parts.map((_, i) => i).filter((i) => !partOnDisk(map, i));
  const sides = SIDE_FILES.filter((role) => !!map[role]);
  const queued = enqueueAll([
    ...missing.map((i) => partInput(manifest, map, i, meta, group)),
    ...sides.filter((role) => !sideOnDisk(map, role)).map((role) => sideInput(manifest, map, role, meta, group)),
  ]);
  expectSideFiles(
    'map',
    mapItemId(map.regionId),
    sides.map((role) => sideName(map.id, role)),
  );
  // Every part was already on disk (a retry after the assembly itself failed).
  if (!missing.length) assembleMap(map, meta.bundledPoints).catch((e) => console.warn('[maps] country map', map.id, e));
  return queued;
}

/** Progress of a country map being downloaded, or null when none is running. */
export function countryMapProgress(records: Record<string, DownloadRecord>, map: CountryMap): { progress: number | null; failed: boolean } {
  const mine = Object.values(records).filter((r) => r.kind === 'map' && (r.meta.map as CountryMap | undefined)?.id === map.id && r.meta.role === 'part');
  const active = mine.filter((r) => ACTIVE.has(r.status));
  const failed = !active.length && mine.some((r) => r.status === 'failed');
  if (!active.length) return { progress: null, failed };
  let done = 0;
  map.parts.forEach((part, i) => {
    const rec = mine.find((r) => r.id === partId(map.id, i));
    done += partOnDisk(map, i) ? part.size : rec && ACTIVE.has(rec.status) ? rec.bytesWritten : 0;
  });
  return { progress: Math.min(1, done / Math.max(1, map.size)), failed: false };
}

// Big files (France: 150 MB of streets, Germany: 780 MB of doors) are read in blocks.
const IMPORT: Record<SideFile, (itemId: string, file: File) => Promise<void>> = {
  pois: storeEmergencyPointsFile,
  streets: indexMapStreets,
  places: indexPackPlaces,
  addresses: indexPackAddresses,
};

/** Imports a side file into the installed map (queued; nothing until the map is installed). `landed`: a download just put it there. */
function importMapSide(mapId: string, role: SideFile, item = itemOfMap(mapId), landed = false) {
  void importSideFile('map', sideName(mapId, role), item, (file) => IMPORT[role](item, file), landed);
}

function importMapSides(map: CountryMap) {
  for (const role of SIDE_FILES) if (map[role]) importMapSide(map.id, role, mapItemId(map.regionId));
}

const assembling = new Set<string>();
/** Assemblies to stop: their country is being removed. */
const aborted = new Set<string>();

class AssemblyAborted extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

/** Stops an assembly in progress (its country is being removed): it registers nothing and deletes its files. */
export function abortCountryMap(mapId: string) {
  if (assembling.has(mapId)) aborted.add(mapId);
}

/**
 * Parts nothing will bring any more (deleted, or their download is gone) are queued again
 * with the part that just finished, from the same build; failing that, the part's download
 * fails, so the country never reads as downloaded without its map.
 */
function requeueLostParts(map: CountryMap, lost: number[], from: DownloadRecord) {
  const manifest = useMapsCatalog.getState().manifest;
  if (!manifest || manifest.maps.find((m) => m.id === map.id)?.buildDate !== map.buildDate) {
    throw new Error(`${map.id}: part ${lost.map((i) => i + 1).join(', ')} of ${map.parts.length} is missing`);
  }
  const meta: MapMeta = { map, bundledPoints: !!from.meta.bundledPoints, regionId: map.regionId };
  enqueueAll(lost.map((i) => partInput(manifest, map, i, meta, recordGroup(from) ?? countryDownloadGroup(map.regionId))));
}

/** Builds <id>.pmtiles from its parts and registers the map, once every part is on disk. `from`: the part that just finished. */
async function assembleMap(map: CountryMap, bundledPoints: boolean, from?: DownloadRecord) {
  if (assembling.has(map.id)) return;
  const missing = map.parts.map((_, i) => i).filter((i) => !partOnDisk(map, i));
  if (missing.length) {
    // This build is in already (a part fetched again after a kill right at the end): nothing to build.
    if (getItem(mapItemId(map.regionId))?.version === map.buildDate) {
      map.parts.forEach((_, i) => deleteFile(contentFile('map', partName(map.id, i)).uri));
      return;
    }
    // Cancelled meanwhile: nothing to bring back.
    if (!from || !useDownloads.getState().records[from.id]) return;
    const records = useDownloads.getState().records;
    // Parts still downloading (or failed, waiting for a retry) bring the rest.
    const lost = missing.filter((i) => {
      const r = records[partId(map.id, i)];
      return !r || !(ACTIVE.has(r.status) || r.status === 'failed');
    });
    if (lost.length) requeueLostParts(map, lost, from);
    return;
  }
  assembling.add(map.id);
  const itemId = mapItemId(map.regionId);
  const parts = map.parts.map((_, i) => contentFile('map', partName(map.id, i)));
  const tmp = contentFile('map', `${map.id}.pmtiles.tmp`);
  // The same file name as an on-device extraction of the region: one item per country.
  const dest = contentFile('map', `${map.regionId}.pmtiles`);
  // The country is being removed, or the part's download was cancelled while it was processing.
  const check = () => {
    if (aborted.has(map.id) || (from && !useDownloads.getState().records[from.id])) throw new AssemblyAborted();
  };
  try {
    if (tmp.exists) tmp.delete();
    if (parts.length === 1) {
      await parts[0].move(tmp);
    } else {
      // Waits for another country's assembly: room for one copy at a time (assembly.ts).
      await oneAssemblyAtATime(async () => {
        tmp.create();
        const out = tmp.open(FileMode.Append);
        try {
          for (const part of parts) {
            const input = part.open(FileMode.ReadOnly);
            try {
              for (;;) {
                check();
                const chunk = await input.readBytes(COPY_CHUNK);
                if (!chunk.length) break;
                await out.writeBytes(chunk);
              }
            } finally {
              input.close();
            }
          }
        } finally {
          out.close();
        }
      });
    }
    if (sizeOf(tmp) !== map.size) throw new Error(`assembled ${sizeOf(tmp)} bytes, expected ${map.size}`);
    check();
    if (dest.exists) dest.delete();
    await tmp.move(dest);
    try {
      check();
    } catch (e) {
      // An update's item still points here, and its removal deletes the file; else nothing does.
      if (!getItem(itemId)) deleteFile(dest.uri);
      throw e;
    }
    const meta: MapItemMeta = {
      role: 'region',
      bbox: map.bbox,
      minZoom: 0,
      maxZoom: map.maxZoom,
      buildDate: map.buildDate,
      regionId: map.regionId,
      bundledPoints,
    };
    upsertItem({
      id: itemId,
      kind: 'map',
      title: title(map),
      description: null,
      language: null,
      category: 'maps',
      isCourse: false,
      fileUri: dest.uri,
      sizeBytes: map.size,
      version: map.buildDate,
      sourceUrl: null,
      catalogId: map.regionId,
      meta,
    });
    for (const part of parts) deleteFile(part.uri);
    notifyMapInstalled(itemId);
  } catch (e) {
    deleteFile(tmp.uri);
    if (e instanceof AssemblyAborted) for (const part of parts) deleteFile(part.uri);
    throw e;
  } finally {
    assembling.delete(map.id);
    aborted.delete(map.id);
  }
  // The download ends here; the imports (minutes for a big country) go on by themselves.
  importMapSides(map);
}

/** Completion handler for 'map' downloads (registered in register.ts). */
export async function onMapFileDownloaded(file: File, record: DownloadRecord) {
  const map = record.meta.map as CountryMap | undefined;
  if (!map) return;
  const role = record.meta.role;
  const expected = role === 'part' ? map.parts[record.meta.index as number]?.size : map[role as SideFile]?.size;
  // A truncated or replaced file: fail the download (the sheet offers a retry).
  if (expected !== undefined && sizeOf(file) !== expected) {
    deleteFile(file.uri);
    throw new Error(`${file.name}: ${sizeOf(file)} bytes, expected ${expected}`);
  }
  if (role === 'part') await assembleMap(map, !!record.meta.bundledPoints, record);
  // Imported once the map is installed (now, or after its assembly).
  else if (isSideFile(role)) importMapSide(map.id, role, mapItemId(map.regionId), true);
}

/**
 * Startup sweep: temp files from an interrupted assembly, and parts or side files no download
 * of their map is left for (failed ones count: a retry needs the rest). A side file of an
 * installed map is an import still to run (resumeMapImports).
 */
export function sweepCountryMapFiles() {
  const busy = new Set<string>();
  for (const r of Object.values(useDownloads.getState().records)) {
    const id = (r.meta.map as CountryMap | undefined)?.id;
    if (r.kind === 'map' && r.status !== 'cancelled' && id) busy.add(id);
  }
  for (const entry of contentDir('map').list()) {
    if (!(entry instanceof File)) continue;
    const m = FILE_RE.exec(entry.name);
    if (!m) continue;
    const [, id, what] = m;
    const side = what.endsWith('.tsv');
    if (what === 'pmtiles.tmp' ? assembling.has(id) : busy.has(id) || (side && getItem(itemOfMap(id)))) continue;
    deleteFile(entry.uri);
    if (side) forgetSideFile('map', entry.name);
  }
  // Expected by a map that is neither installed nor downloading: its download is gone.
  for (const { name, item } of expectedSideFiles('map')) {
    if (!getItem(item) && !busy.has(SIDE_RE.exec(name)?.[1] ?? '')) forgetSideFile('map', name);
  }
}

/** Startup: side files whose import didn't finish (the app was killed) go in again. */
export function resumeMapImports() {
  const records = useDownloads.getState().records;
  for (const entry of contentDir('map').list()) {
    const m = entry instanceof File ? SIDE_RE.exec(entry.name) : null;
    if (!m) continue;
    const role = m[2] as SideFile;
    // One still downloading imports when it lands (the manager finishes a 'processing' one).
    const rec = records[sideId(m[1], role)];
    if (rec && ACTIVE.has(rec.status)) continue;
    importMapSide(m[1], role);
  }
}

/**
 * Side files an installed map expects but no longer has (an import cut short before its file
 * was kept, a download dismissed): fetched again, alone, after each catalog refresh.
 */
export function fetchMissingMapSideFiles(manifest: MapsManifest) {
  const records = useDownloads.getState().records;
  for (const { name, item, gaveUp } of expectedSideFiles('map')) {
    const installed = getItem(item);
    if (!installed || gaveUp) continue;
    const m = SIDE_RE.exec(name);
    const map = m ? manifest.maps.find((x) => x.id === m[1]) : undefined;
    const role = m?.[2] as SideFile | undefined;
    // The catalog no longer has it (a routing pack brings it now): nothing to wait for.
    if (!map || !role || !map[role]) {
      forgetSideFile('map', name);
      continue;
    }
    if (sideFile(map.id, role).exists || isImporting('map', name)) continue;
    const rec = records[sideId(map.id, role)];
    if (rec && ACTIVE.has(rec.status)) continue;
    const meta: MapMeta = { map, bundledPoints: !!(installed.meta as MapItemMeta).bundledPoints, regionId: map.regionId };
    try {
      enqueueDownload({ ...sideInput(manifest, map, role, meta, countryDownloadGroup(map.regionId)), quiet: true });
    } catch (e) {
      console.warn('[maps] side file', name, e); // no room: next catalog refresh
    }
  }
}

/** A removed country: its parts and side files go now, not at the next launch. */
export function discardCountryMapFiles(mapId: string) {
  for (const entry of contentDir('map').list()) {
    const m = entry instanceof File ? FILE_RE.exec(entry.name) : null;
    if (!m || m[1] !== mapId || (m[2] === 'pmtiles.tmp' && assembling.has(mapId))) continue;
    deleteFile(entry.uri);
    if (m[2].endsWith('.tsv')) forgetSideFile('map', entry.name);
  }
}

/** Ids of the downloads of a country map (to cancel them when the country is removed). */
export function countryMapDownloadIds(regionId: string): string[] {
  return Object.values(useDownloads.getState().records)
    .filter((r) => r.kind === 'map' && r.meta.regionId === regionId && !r.external)
    .map((r) => r.id);
}
