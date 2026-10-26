// Downloadable routing packs: the catalog (routing-manifest.json, published with the
// packs on GitHub Releases by .github/workflows/country-packages.yml), downloads through
// the download manager (one per tar part plus the pack's emergency points and its search
// side files: street names, named places, house numbers), and assembling the parts into
// content/routing/<id>.tar.
//
// Crash safety: parts are appended into <id>.tar.tmp, checked against the manifest size
// and renamed; only then is the item registered and are the parts deleted. A launch
// after a kill re-finalizes the last part (the manager keeps it 'processing') and finds
// every part still there; stray parts and temp files with no active download are swept.
import { File, FileMode } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { getItem, upsertItem } from '@/features/content/items';
import { enqueueDownload, NotEnoughStorageError, useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { contentDir, contentFile, deleteFile, hasRoomFor } from '@/lib/storage';

import { parseOverpassTsv } from './emergency-core';
import { storeEmergencyPoints } from './emergency';
import { useGuidance } from './guidance';
import { hasPackAddresses, hasPackPlaces, hasPackStreets, indexPackAddresses, indexPackPlaces, indexPackStreets } from './places';
import { getRegion, regionName } from './regions';
import { routePackId, type RoutePackMeta } from './routing';
import { countryDownloadGroup } from './country-maps';
import { assetUrl, parseManifest, type ManifestPack, type RoutingManifest } from './routing-core';

const REPO = 'franlindebl/nomad-pocket';
/** A fixed release whose manifest points at the current monthly release. */
const MANIFEST_URL =
  process.env.EXPO_PUBLIC_ROUTING_MANIFEST_URL ?? `https://github.com/${REPO}/releases/download/routing-index/routing-manifest.json`;
const CACHE_KEY = 'maps.routingManifest';
const COPY_CHUNK = 8 * 1024 * 1024;
const ACTIVE = new Set(['queued', 'running', 'paused', 'processing']);

type CatalogState = { manifest: RoutingManifest | null; status: 'idle' | 'loading' | 'error' };

export const useRoutingCatalog = create<CatalogState>(() => {
  let manifest: RoutingManifest | null = null;
  try {
    const cached = Storage.getItemSync(CACHE_KEY);
    manifest = cached ? parseManifest(cached) : null;
  } catch {
    // no cache yet
  }
  return { manifest, status: 'idle' };
});

/** Fetches the catalog (keeps the cached one when offline). */
export async function refreshRoutingCatalog(): Promise<void> {
  if (useRoutingCatalog.getState().status === 'loading') return;
  useRoutingCatalog.setState({ status: 'loading' });
  try {
    const res = await fetch(MANIFEST_URL, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const manifest = parseManifest(text);
    if (!manifest) throw new Error('bad manifest');
    Storage.setItemSync(CACHE_KEY, text);
    useRoutingCatalog.setState({ manifest, status: 'idle' });
    fetchMissingSideFiles(manifest);
  } catch (e) {
    console.warn('[maps] routing catalog', e);
    useRoutingCatalog.setState({ status: 'error' });
  }
}

export function packTitle(pack: Pick<ManifestPack, 'id' | 'regionId'>): string {
  const region = getRegion(pack.regionId);
  return region ? regionName(region, i18n.language) : pack.id;
}

const partId = (pack: string, i: number) => `route-${pack}-p${i}`;
const poisId = (pack: string) => `route-${pack}-pois`;
const partName = (pack: string, i: number) => `${pack}.tar.part${String(i).padStart(2, '0')}`;
const poisFile = (pack: string) => contentFile('route', `${pack}.pois.tsv`);

/** Search side files: imported into the index, then deleted; fetched alone for installed packs that lack them. */
const SIDE_FILES = ['streets', 'places', 'addresses'] as const;
type SideFile = (typeof SIDE_FILES)[number];
const isSideFile = (role: unknown): role is SideFile => SIDE_FILES.includes(role as SideFile);
const sideId = (pack: string, side: SideFile) => `route-${pack}-${side}`;
const sideFile = (pack: string, side: SideFile) => contentFile('route', `${pack}.${side}.tsv`);
const sideImported: Record<SideFile, (itemId: string) => boolean> = {
  streets: hasPackStreets,
  places: hasPackPlaces,
  addresses: hasPackAddresses,
};

const sizeOf = (f: File) => (f.exists ? Number(f.size ?? 0) : -1);
const partOnDisk = (pack: ManifestPack, i: number) => sizeOf(contentFile('route', partName(pack.id, i))) === pack.parts[i].size;

/**
 * Queues the files of a pack that are not on disk yet (a retry after a failure only
 * fetches what is missing). Throws NotEnoughStorageError before queueing anything.
 */
export function downloadPack(manifest: RoutingManifest, pack: ManifestPack, group = countryDownloadGroup(pack.regionId)) {
  const missing = pack.parts.map((_, i) => i).filter((i) => !partOnDisk(pack, i));
  const wantPois = !!pack.pois && sizeOf(poisFile(pack.id)) !== pack.pois.size;
  const sides = SIDE_FILES.filter((side) => !!pack[side] && sizeOf(sideFile(pack.id, side)) !== pack[side]!.size);
  // Room for the parts still to come, and for the assembled tar while the parts exist.
  const needed =
    missing.reduce((sum, i) => sum + pack.parts[i].size, 0) +
    (pack.parts.length > 1 ? pack.size : 0) +
    (wantPois ? pack.pois!.size : 0) +
    sides.reduce((sum, side) => sum + pack[side]!.size, 0);
  if (!hasRoomFor(needed)) throw new NotEnoughStorageError(needed);
  const title = packTitle(pack);
  for (const i of missing) {
    enqueueDownload({
      id: partId(pack.id, i),
      kind: 'route',
      title: pack.parts.length > 1 ? `${title} (${i + 1}/${pack.parts.length})` : title,
      url: assetUrl(manifest, pack, pack.parts[i].name, REPO),
      filename: partName(pack.id, i),
      expectedBytes: pack.parts[i].size,
      meta: { pack, role: 'part', index: i },
      group,
    });
  }
  if (wantPois) {
    enqueueDownload({
      id: poisId(pack.id),
      kind: 'route',
      title,
      url: assetUrl(manifest, pack, pack.pois!.name, REPO),
      filename: `${pack.id}.pois.tsv`,
      expectedBytes: pack.pois!.size,
      meta: { pack, role: 'pois' },
      group,
    });
  }
  for (const side of sides) queueSideFile(manifest, pack, side, group);
  // Everything was already on disk (a retry after the assembly itself failed).
  if (!missing.length) assemblePack(pack).catch((e) => console.warn('[maps] routing pack', pack.id, e));
}

function queueSideFile(manifest: RoutingManifest, pack: ManifestPack, side: SideFile, group = countryDownloadGroup(pack.regionId)) {
  const file = pack[side]!;
  enqueueDownload({
    id: sideId(pack.id, side),
    kind: 'route',
    title: packTitle(pack),
    url: assetUrl(manifest, pack, file.name, REPO),
    filename: `${pack.id}.${side}.tsv`,
    expectedBytes: file.size,
    meta: { pack, role: side },
    group,
  });
}

/**
 * Packs installed before the catalog had a search side file (or whose import was cut
 * short) fetch just that file, not the pack again.
 */
export function fetchMissingSideFiles(manifest: RoutingManifest) {
  const records = useDownloads.getState().records;
  for (const pack of manifest.packs) {
    if (!isPackInstalled(pack.id)) continue;
    for (const side of SIDE_FILES) {
      if (!pack[side] || sideImported[side](routePackId(pack.id))) continue;
      const rec = records[sideId(pack.id, side)];
      if (rec && ACTIVE.has(rec.status)) continue;
      try {
        queueSideFile(manifest, pack, side);
      } catch (e) {
        console.warn('[maps] search file', pack.id, side, e); // no room: next catalog refresh
      }
    }
  }
}

export function isPackInstalled(packId: string): boolean {
  return !!getItem(routePackId(packId));
}

async function importSideFile(pack: ManifestPack, side: SideFile) {
  const file = sideFile(pack.id, side);
  const id = routePackId(pack.id);
  if (!file.exists || !getItem(id)) return;
  try {
    // Streets, places and addresses are 100+ MB for a big country: read in blocks by places.ts.
    if (side === 'streets') await indexPackStreets(id, file);
    else if (side === 'places') await indexPackPlaces(id, file);
    else await indexPackAddresses(id, file);
  } finally {
    deleteFile(file.uri);
  }
}

async function importPois(pack: ManifestPack) {
  const file = poisFile(pack.id);
  if (!file.exists || !getItem(routePackId(pack.id))) return;
  try {
    await storeEmergencyPoints(routePackId(pack.id), parseOverpassTsv(await file.text()));
  } finally {
    deleteFile(file.uri);
  }
}

const assembling = new Set<string>();

/** Builds <id>.tar from its parts and registers the pack, if every part is on disk. */
async function assemblePack(pack: ManifestPack) {
  if (assembling.has(pack.id) || !pack.parts.every((_, i) => partOnDisk(pack, i))) return;
  assembling.add(pack.id);
  const parts = pack.parts.map((_, i) => contentFile('route', partName(pack.id, i)));
  const tmp = contentFile('route', `${pack.id}.tar.tmp`);
  const dest = contentFile('route', `${pack.id}.tar`);
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
    if (sizeOf(tmp) !== pack.size) throw new Error(`assembled ${sizeOf(tmp)} bytes, expected ${pack.size}`);
    if (dest.exists) dest.delete();
    await tmp.move(dest);
    const meta: RoutePackMeta = {
      bbox: pack.bbox,
      cells: pack.cells ?? null,
      buildDate: pack.buildDate,
      regionId: getRegion(pack.regionId)?.id ?? null,
    };
    upsertItem({
      id: routePackId(pack.id),
      kind: 'route',
      title: packTitle(pack),
      description: null,
      language: null,
      category: 'maps',
      isCourse: false,
      fileUri: dest.uri,
      sizeBytes: pack.size,
      version: pack.buildDate,
      sourceUrl: null,
      catalogId: pack.id,
      meta,
    });
    for (const part of parts) deleteFile(part.uri);
    await importPois(pack);
    useGuidance.getState().retryRoute();
    for (const side of SIDE_FILES) await importSideFile(pack, side);
  } catch (e) {
    deleteFile(tmp.uri);
    throw e;
  } finally {
    assembling.delete(pack.id);
  }
}

/** Completion handler for 'route' downloads (registered in register.ts). */
export async function onRouteFileDownloaded(file: File, record: DownloadRecord) {
  const pack = record.meta.pack as ManifestPack | undefined;
  if (!pack) return;
  const role = record.meta.role;
  const expected = role === 'pois' ? pack.pois?.size : isSideFile(role) ? pack[role]?.size : pack.parts[record.meta.index as number]?.size;
  // A truncated or replaced file: fail the download (the sheet offers a retry).
  if (expected !== undefined && sizeOf(file) !== expected) {
    deleteFile(file.uri);
    throw new Error(`${file.name}: ${sizeOf(file)} bytes, expected ${expected}`);
  }
  if (role === 'pois') await importPois(pack);
  else if (isSideFile(role)) await importSideFile(pack, role);
  else await assemblePack(pack);
}

/**
 * Startup sweep (after the download manager restored its queue): temp files from an
 * interrupted assembly, and parts or point files no active download belongs to.
 */
export function sweepRoutingFiles() {
  const active = new Set(
    Object.values(useDownloads.getState().records)
      .filter((r) => r.kind === 'route' && ACTIVE.has(r.status))
      .map((r) => (r.meta.pack as ManifestPack | undefined)?.id),
  );
  for (const entry of contentDir('route').list()) {
    if (!(entry instanceof File)) continue;
    const m = /^(.+?)\.(tar\.tmp|tar\.part\d+|pois\.tsv|streets\.tsv|places\.tsv|addresses\.tsv)$/.exec(entry.name);
    if (!m) continue;
    if (m[2] === 'tar.tmp' ? !assembling.has(m[1]) : !active.has(m[1])) deleteFile(entry.uri);
  }
}
