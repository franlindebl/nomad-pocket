// Country maps built in CI (.github/workflows/country-packages.yml): the catalog
// (maps-manifest.json on the fixed release `maps-index`), downloads through the download
// manager (one per archive part, plus the country's emergency points, street names, named
// places and house numbers where no routing pack brings them) and assembling the parts into
// content/maps/<id>.pmtiles.
//
// Crash safety, as in routing-packs.ts: parts are appended into <id>.pmtiles.tmp, checked
// against the manifest size and renamed; only then is the item registered and are the parts
// deleted. Stray parts and temp files with no active download are swept at startup.
import { File, FileMode } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { getItem, upsertItem } from '@/features/content/items';
import { enqueueDownload, NotEnoughStorageError, useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { contentDir, contentFile, deleteFile, hasRoomFor } from '@/lib/storage';

import { mapAssetUrl, parseMapsManifest, type CountryMap, type MapsManifest } from './country-core';
import { parseOverpassTsv } from './emergency-core';
import { storeEmergencyPoints } from './emergency';
import { mapItemId, notifyMapInstalled, type MapItemMeta } from './extraction';
import { parseStreetsTsv } from './places-core';
import { indexMapStreets, indexPackAddresses, indexPackPlaces } from './places';
import { getRegion, regionName } from './regions';

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
  } catch (e) {
    console.warn('[maps] country catalog', e);
    useMapsCatalog.setState({ status: 'error' });
  }
}

export function countryMapFor(regionId: string): CountryMap | null {
  return useMapsCatalog.getState().manifest?.maps.find((m) => m.regionId === regionId) ?? null;
}

const title = (map: CountryMap) => {
  const region = getRegion(map.regionId);
  return region ? regionName(region, i18n.language) : map.id;
};

/** Files that come with a map (where no routing pack brings them), imported once it is installed. */
const SIDE_FILES = ['pois', 'streets', 'places', 'addresses'] as const;
type SideFile = (typeof SIDE_FILES)[number];

const partId = (map: string, i: number) => `country-${map}-p${i}`;
const sideId = (map: string, role: SideFile) => `country-${map}-${role}`;
const partName = (map: string, i: number) => `${map}.pmtiles.part${String(i).padStart(2, '0')}`;
const sideFile = (map: string, role: SideFile) => contentFile('map', `${map}.${role}.tsv`);

const sizeOf = (f: File) => (f.exists ? Number(f.size ?? 0) : -1);
const partOnDisk = (map: CountryMap, i: number) => sizeOf(contentFile('map', partName(map.id, i))) === map.parts[i].size;

/** Bytes still to download for a country map (what a retry would fetch). */
export function countryMapBytes(map: CountryMap): number {
  return map.parts.reduce((sum, p, i) => sum + (partOnDisk(map, i) ? 0 : p.size), 0) + SIDE_FILES.reduce((sum, role) => sum + (map[role]?.size ?? 0), 0);
}

/**
 * Queues the files of a country map that are not on disk yet. `bundledPoints`: the
 * country's points come with it (its own file or a routing pack), so no Overpass after.
 * Throws NotEnoughStorageError before queueing anything.
 */
export function downloadCountryMap(manifest: MapsManifest, map: CountryMap, bundledPoints: boolean) {
  const missing = map.parts.map((_, i) => i).filter((i) => !partOnDisk(map, i));
  // Room for the parts still to come, and for the assembled archive while the parts exist.
  const needed = countryMapBytes(map) + (map.parts.length > 1 ? map.size : 0);
  if (!hasRoomFor(needed)) throw new NotEnoughStorageError(needed);
  const name = title(map);
  const meta = { map, bundledPoints: bundledPoints || !!map.pois, regionId: map.regionId };
  for (const i of missing) {
    enqueueDownload({
      id: partId(map.id, i),
      kind: 'map',
      title: map.parts.length > 1 ? `${name} (${i + 1}/${map.parts.length})` : name,
      url: mapAssetUrl(manifest, map, map.parts[i].name, REPO),
      filename: partName(map.id, i),
      expectedBytes: map.parts[i].size,
      meta: { ...meta, role: 'part', index: i },
    });
  }
  for (const role of SIDE_FILES) {
    const file = map[role];
    if (!file) continue;
    enqueueDownload({
      id: sideId(map.id, role),
      kind: 'map',
      title: name,
      url: mapAssetUrl(manifest, map, file.name, REPO),
      filename: file.name,
      expectedBytes: file.size,
      meta: { ...meta, role },
    });
  }
  // Every part was already on disk (a retry after the assembly itself failed).
  if (!missing.length) assembleMap(map, meta.bundledPoints).catch((e) => console.warn('[maps] country map', map.id, e));
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

const IMPORT: Record<SideFile, (itemId: string, file: File) => Promise<void>> = {
  pois: async (id, file) => storeEmergencyPoints(id, parseOverpassTsv(await file.text())),
  streets: async (id, file) => indexMapStreets(id, parseStreetsTsv(await file.text())),
  // Big files (Spain: 50 MB of places, 97 MB of doors): read in blocks by places.ts.
  places: indexPackPlaces,
  addresses: indexPackAddresses,
};

/** Imports the side files on disk into the installed map (each once, then deleted). */
async function importSide(map: CountryMap) {
  const id = mapItemId(map.regionId);
  if (!getItem(id)) return;
  for (const role of SIDE_FILES) {
    const file = sideFile(map.id, role);
    if (!file.exists) continue;
    try {
      await IMPORT[role](id, file);
    } finally {
      deleteFile(file.uri);
    }
  }
}

const assembling = new Set<string>();

/** Builds <id>.pmtiles from its parts and registers the map, if every part is on disk. */
async function assembleMap(map: CountryMap, bundledPoints: boolean) {
  if (assembling.has(map.id) || !map.parts.every((_, i) => partOnDisk(map, i))) return;
  assembling.add(map.id);
  const parts = map.parts.map((_, i) => contentFile('map', partName(map.id, i)));
  const tmp = contentFile('map', `${map.id}.pmtiles.tmp`);
  // The same file name as an on-device extraction of the region: one item per country.
  const dest = contentFile('map', `${map.regionId}.pmtiles`);
  try {
    if (tmp.exists) tmp.delete();
    if (parts.length === 1) {
      await parts[0].move(tmp);
    } else {
      tmp.create();
      const out = tmp.open(FileMode.Append);
      try {
        for (const part of parts) {
          const input = part.open(FileMode.ReadOnly);
          try {
            for (;;) {
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
    }
    if (sizeOf(tmp) !== map.size) throw new Error(`assembled ${sizeOf(tmp)} bytes, expected ${map.size}`);
    if (dest.exists) dest.delete();
    await tmp.move(dest);
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
      id: mapItemId(map.regionId),
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
    notifyMapInstalled(mapItemId(map.regionId));
    await importSide(map);
  } catch (e) {
    deleteFile(tmp.uri);
    throw e;
  } finally {
    assembling.delete(map.id);
  }
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
  if (role === 'part') await assembleMap(map, !!record.meta.bundledPoints);
  else await importSide(map); // a side file after the map was installed
}

/** Startup sweep: temp files from an interrupted assembly, and files no active download belongs to. */
export function sweepCountryMapFiles() {
  const active = new Set(
    Object.values(useDownloads.getState().records)
      .filter((r) => r.kind === 'map' && ACTIVE.has(r.status))
      .map((r) => (r.meta.map as CountryMap | undefined)?.id),
  );
  for (const entry of contentDir('map').list()) {
    if (!(entry instanceof File)) continue;
    const m = /^(.+?)\.(pmtiles\.tmp|pmtiles\.part\d+|pois\.tsv|streets\.tsv|places\.tsv|addresses\.tsv)$/.exec(entry.name);
    if (!m) continue;
    if (m[2] === 'pmtiles.tmp' ? !assembling.has(m[1]) : !active.has(m[1])) deleteFile(entry.uri);
  }
}

/** Ids of the downloads of a country map (to cancel them when the country is removed). */
export function countryMapDownloadIds(regionId: string): string[] {
  return Object.values(useDownloads.getState().records)
    .filter((r) => r.kind === 'map' && r.meta.regionId === regionId && !r.external)
    .map((r) => r.id);
}
