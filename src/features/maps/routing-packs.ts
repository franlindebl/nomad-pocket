// Downloadable routing packs: the catalog (routing-manifest.json, published with the
// packs on GitHub Releases by .github/workflows/country-packages.yml), downloads through
// the download manager (one per tar part plus the pack's emergency points and its search
// side files: street names, named places, house numbers), and assembling the parts into
// content/routing/<id>.tar.
//
// Crash safety: parts are appended into <id>.tar.tmp, checked against the manifest size
// and renamed; only then is the item registered and are the parts deleted, and the last
// part's download is done. A launch after a kill during the copy re-finalizes the last part
// (the manager keeps it 'processing') and finds every part still there. The points and side
// files are imported after that, on their own (side-files.ts: replayed after a kill). Parts
// and side files stay while any download of their pack is left, failed ones included; the
// startup sweep deletes the rest.
import { File } from 'expo-file-system';
import { create } from 'zustand';

import Storage from '@/db/kv';
import { getItem, listItems, upsertItem } from '@/features/content/items';
import { recordGroup } from '@/features/downloads/groups';
import { cancelDownload, enqueueDownload, useDownloads, type DownloadGroup, type DownloadRecord, type EnqueueInput } from '@/features/downloads/manager';
import i18n from '@/i18n';
import { contentDir, contentFile, deleteFile } from '@/lib/storage';
import { copyInto } from '../../../modules/nomad-files';

import { oneAssemblyAtATime } from './assembly';
import { routePacksFor, type PlannedArchive } from './country-core';
import { countryDownloadGroup, enqueueAll } from './country-maps';
import { emergencySyncInfo, storeEmergencyPointsFile } from './emergency';
import { useGuidance } from './guidance';
import { hasPackAddresses, hasPackPlaces, hasPackStreets, indexPackAddresses, indexPackPlaces, indexPackStreets } from './places';
import { getRegion, regionName } from './regions';
import { closeRouter, routePackId, type RoutePackMeta } from './routing';
import { assetUrl, ENGINE_VALHALLA, fileIntegrity, parseManifest, type ManifestPack, type RoutingManifest } from './routing-core';
import { expectedSideFiles, expectSideFiles, forgetSideFile, importSideFile, isImporting } from './side-files';

const REPO = 'franlindebl/nomad-pocket';
/** A fixed release whose manifest points at the current monthly release. */
const MANIFEST_URL =
  process.env.EXPO_PUBLIC_ROUTING_MANIFEST_URL ?? `https://github.com/${REPO}/releases/download/routing-index/routing-manifest.json`;
const CACHE_KEY = 'maps.routingManifest';
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

/** Points and search side files: imported into the index, then deleted; fetched alone for installed packs that lack them. */
const SIDE_FILES = ['pois', 'streets', 'places', 'addresses'] as const;
type SideFile = (typeof SIDE_FILES)[number];
const isSideFile = (role: unknown): role is SideFile => SIDE_FILES.includes(role as SideFile);

const FILE_RE = /^(.+?)\.(tar\.tmp|tar\.part\d+|pois\.tsv|streets\.tsv|places\.tsv|addresses\.tsv)$/;
const SIDE_RE = /^(.+?)\.(pois|streets|places|addresses)\.tsv$/;

const partId = (pack: string, i: number) => `route-${pack}-p${i}`;
const sideId = (pack: string, side: SideFile) => `route-${pack}-${side}`;
const partName = (pack: string, i: number) => `${pack}.tar.part${String(i).padStart(2, '0')}`;
const sideName = (pack: string, side: SideFile) => `${pack}.${side}.tsv`;
const sideFile = (pack: string, side: SideFile) => contentFile('route', sideName(pack, side));

const sizeOf = (f: File) => (f.exists ? Number(f.size ?? 0) : -1);
const partOnDisk = (pack: ManifestPack, i: number) => sizeOf(contentFile('route', partName(pack.id, i))) === pack.parts[i].size;
const sideOnDisk = (pack: ManifestPack, side: SideFile) => sizeOf(sideFile(pack.id, side)) === pack[side]?.size;

/** Downloads of a pack's files, whatever their build. */
const recordsOf = (packId: string) =>
  Object.values(useDownloads.getState().records).filter((r) => r.kind === 'route' && r.status !== 'cancelled' && (r.meta.pack as ManifestPack | undefined)?.id === packId);

/** Parts on disk count only while the pack's downloads (all of this build) vouch for them (see country-maps.ts). */
function partsTrusted(pack: ManifestPack): boolean {
  const mine = recordsOf(pack.id);
  return mine.length > 0 && mine.every((r) => (r.meta.pack as ManifestPack).buildDate === pack.buildDate);
}

/** What a pack still needs from the network (countries.ts sizes and checks the whole country). */
export function packPlan(pack: ManifestPack): PlannedArchive {
  const records = useDownloads.getState().records;
  const trusted = partsTrusted(pack);
  const queued = (id: string) => {
    const r = records[id];
    return !!r && ACTIVE.has(r.status) && (r.meta.pack as ManifestPack | undefined)?.buildDate === pack.buildDate;
  };
  return {
    size: pack.size,
    parts: pack.parts.map((p, i) => ({ size: p.size, onDisk: trusted && partOnDisk(pack, i), queued: queued(partId(pack.id, i)) })),
    sides: SIDE_FILES.filter((side) => !!pack[side]).map((side) => ({ size: pack[side]!.size, onDisk: sideOnDisk(pack, side), queued: queued(sideId(pack.id, side)) })),
  };
}

const partInput = (manifest: RoutingManifest, pack: ManifestPack, i: number, group: DownloadGroup): EnqueueInput => ({
  id: partId(pack.id, i),
  kind: 'route',
  title: pack.parts.length > 1 ? `${packTitle(pack)} (${i + 1}/${pack.parts.length})` : packTitle(pack),
  url: assetUrl(manifest, pack, pack.parts[i].name, REPO),
  filename: partName(pack.id, i),
  expectedBytes: pack.parts[i].size,
  integrity: fileIntegrity(pack.parts[i]),
  meta: { pack, valhalla: manifest.valhalla, role: 'part', index: i },
  group,
  // A group cancel may stop the assembly: it checks that this record still exists.
  abortable: true,
});

const sideInput = (manifest: RoutingManifest, pack: ManifestPack, side: SideFile, group: DownloadGroup): EnqueueInput => ({
  id: sideId(pack.id, side),
  kind: 'route',
  title: packTitle(pack),
  url: assetUrl(manifest, pack, pack[side]!.name, REPO),
  filename: sideName(pack.id, side),
  expectedBytes: pack[side]!.size,
  integrity: fileIntegrity(pack[side]!),
  meta: { pack, valhalla: manifest.valhalla, role: side },
  group,
});

/** Parts no download of this build vouches for (the catalog moved on before a retry): dropped with their downloads. */
function dropUntrustedParts(pack: ManifestPack) {
  if (partsTrusted(pack)) return;
  for (const r of recordsOf(pack.id)) void cancelDownload(r.id);
  for (const entry of contentDir('route').list()) {
    if (entry instanceof File && entry.name.startsWith(`${pack.id}.tar.part`)) deleteFile(entry.uri);
  }
}

/**
 * Queues the files of a pack that are not on disk yet (a retry after a failure only fetches
 * what is missing; an update fetches a newer build to replace the installed one) and returns
 * the ids it queued. The caller checks the room first (countries.ts planCountry).
 */
export function downloadPack(manifest: RoutingManifest, pack: ManifestPack, group = countryDownloadGroup(pack.regionId)): string[] {
  dropUntrustedParts(pack);
  const missing = pack.parts.map((_, i) => i).filter((i) => !partOnDisk(pack, i));
  const sides = SIDE_FILES.filter((side) => !!pack[side]);
  const queued = enqueueAll([
    ...missing.map((i) => partInput(manifest, pack, i, group)),
    ...sides.filter((side) => !sideOnDisk(pack, side)).map((side) => sideInput(manifest, pack, side, group)),
  ]);
  expectSideFiles(
    'route',
    routePackId(pack.id),
    sides.map((side) => sideName(pack.id, side)),
  );
  // Everything was already on disk (a retry after the assembly itself failed).
  if (!missing.length) assemblePack(pack, manifest.valhalla).catch((e) => console.warn('[maps] routing pack', pack.id, e));
  return queued;
}

/** The country whose download a pack's files belong to: the installed map it routes (Haiti for the Dominican Republic's), else its own. */
function packCountry(manifest: RoutingManifest, pack: ManifestPack): string {
  const maps = listItems('map').map((m) => (m.meta as { regionId?: string | null }).regionId);
  return maps.find((r): r is string => !!r && routePacksFor(manifest.packs, r).some((x) => x.id === pack.id)) ?? pack.regionId;
}

/**
 * Installed packs that lack a side file in the index (installed before the catalog had it,
 * or whose import was cut short and lost its file) fetch just that file, not the pack again.
 */
export function fetchMissingSideFiles(manifest: RoutingManifest) {
  const records = useDownloads.getState().records;
  const marks = expectedSideFiles('route');
  const expected = new Set(marks.filter((e) => !e.gaveUp).map((e) => e.name));
  const gaveUp = new Set(marks.filter((e) => e.gaveUp).map((e) => e.name));
  const points = emergencySyncInfo();
  // In the index already (packs from before a file existed lack it; an import cut short has no mark).
  const imported: Record<SideFile, (item: string) => boolean> = {
    pois: (id) => !!points[id],
    streets: hasPackStreets,
    places: hasPackPlaces,
    addresses: hasPackAddresses,
  };
  for (const pack of manifest.packs) {
    const item = routePackId(pack.id);
    if (!getItem(item)) continue;
    for (const side of SIDE_FILES) {
      const name = sideName(pack.id, side);
      if (!pack[side] || gaveUp.has(name) || (!expected.has(name) && imported[side](item))) continue;
      // On disk: an import still to run (resumePackImports), not a file to fetch.
      if (sideFile(pack.id, side).exists || isImporting('route', name)) continue;
      const rec = records[sideId(pack.id, side)];
      if (rec && ACTIVE.has(rec.status)) continue;
      try {
        enqueueDownload({ ...sideInput(manifest, pack, side, countryDownloadGroup(packCountry(manifest, pack))), quiet: true });
        expectSideFiles('route', item, [name]);
      } catch (e) {
        console.warn('[maps] search file', pack.id, side, e); // no room: next catalog refresh
      }
    }
  }
}

export function isPackInstalled(packId: string): boolean {
  return !!getItem(routePackId(packId));
}

/** Imports a points or search file into the installed pack (queued; nothing until the pack is installed). `landed`: a download just put it there. */
function importPackSide(packId: string, side: SideFile, landed = false) {
  const item = routePackId(packId);
  // Streets, places and addresses are 100+ MB for a big country: read in blocks.
  const run = { pois: storeEmergencyPointsFile, streets: indexPackStreets, places: indexPackPlaces, addresses: indexPackAddresses }[side];
  void importSideFile('route', sideName(packId, side), item, (file) => run(item, file), landed);
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
export function abortPack(packId: string) {
  if (assembling.has(packId)) aborted.add(packId);
}

/** Parts nothing will bring any more are queued again from the same build, else the part fails (see country-maps.ts). */
function requeueLostParts(pack: ManifestPack, lost: number[], from: DownloadRecord) {
  const manifest = useRoutingCatalog.getState().manifest;
  if (!manifest || manifest.packs.find((p) => p.id === pack.id)?.buildDate !== pack.buildDate) {
    throw new Error(`${pack.id}: part ${lost.map((i) => i + 1).join(', ')} of ${pack.parts.length} is missing`);
  }
  enqueueAll(lost.map((i) => partInput(manifest, pack, i, recordGroup(from) ?? countryDownloadGroup(pack.regionId))));
}

/**
 * Builds <id>.tar from its parts and registers the pack, once every part is on disk. An
 * update replaces the installed tar: the router has it mapped, so it is closed first.
 */
async function assemblePack(pack: ManifestPack, valhalla: string, from?: DownloadRecord) {
  if (assembling.has(pack.id)) return;
  const missing = pack.parts.map((_, i) => i).filter((i) => !partOnDisk(pack, i));
  if (missing.length) {
    // This build is in already (a part fetched again after a kill right at the end): nothing to build.
    if (getItem(routePackId(pack.id))?.version === pack.buildDate) {
      pack.parts.forEach((_, i) => deleteFile(contentFile('route', partName(pack.id, i)).uri));
      return;
    }
    // Cancelled meanwhile: nothing to bring back.
    if (!from || !useDownloads.getState().records[from.id]) return;
    const records = useDownloads.getState().records;
    // Parts still downloading (or failed, waiting for a retry) bring the rest.
    const lost = missing.filter((i) => {
      const r = records[partId(pack.id, i)];
      return !r || !(ACTIVE.has(r.status) || r.status === 'failed');
    });
    if (lost.length) requeueLostParts(pack, lost, from);
    return;
  }
  assembling.add(pack.id);
  const itemId = routePackId(pack.id);
  const parts = pack.parts.map((_, i) => contentFile('route', partName(pack.id, i)));
  const tmp = contentFile('route', `${pack.id}.tar.tmp`);
  const dest = contentFile('route', `${pack.id}.tar`);
  // The country is being removed, or the part's download was cancelled while it was processing.
  const check = () => {
    if (aborted.has(pack.id) || (from && !useDownloads.getState().records[from.id])) throw new AssemblyAborted();
  };
  try {
    if (tmp.exists) tmp.delete();
    if (parts.length === 1) {
      await parts[0].move(tmp);
    } else {
      // Waits for another country's assembly: room for one copy at a time (assembly.ts).
      await oneAssemblyAtATime(async () => {
        tmp.create();
        // Natively, one block in memory at a time (nomad-files): a part takes seconds, so the
        // country's removal is checked between parts.
        let offset = 0;
        for (const part of parts) {
          check();
          offset += await copyInto(part.uri, tmp.uri, offset);
        }
      });
    }
    if (sizeOf(tmp) !== pack.size) throw new Error(`assembled ${sizeOf(tmp)} bytes, expected ${pack.size}`);
    check();
    const replacing = dest.exists;
    if (replacing) dest.delete();
    await tmp.move(dest);
    // An update: Valhalla keeps the open pack by path and would go on routing on the deleted
    // file (its space not freed either). Closed after the move, so the next route opens the new one.
    if (replacing) await closeRouter().catch(() => {});
    try {
      check();
    } catch (e) {
      // An update's item still points here, and its removal deletes the file; else nothing does.
      if (!getItem(itemId)) deleteFile(dest.uri);
      throw e;
    }
    const meta: RoutePackMeta = {
      bbox: pack.bbox,
      cells: pack.cells ?? null,
      buildDate: pack.buildDate,
      regionId: getRegion(pack.regionId)?.id ?? null,
      valhalla: valhalla || ENGINE_VALHALLA,
    };
    upsertItem({
      id: itemId,
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
  } catch (e) {
    deleteFile(tmp.uri);
    if (e instanceof AssemblyAborted) for (const part of parts) deleteFile(part.uri);
    throw e;
  } finally {
    assembling.delete(pack.id);
    aborted.delete(pack.id);
  }
  useGuidance.getState().retryRoute();
  // The download ends here; the imports (minutes for a big country) go on by themselves.
  for (const side of SIDE_FILES) if (pack[side]) importPackSide(pack.id, side);
}

/** Completion handler for 'route' downloads (registered in register.ts). */
export async function onRouteFileDownloaded(file: File, record: DownloadRecord) {
  const pack = record.meta.pack as ManifestPack | undefined;
  if (!pack) return;
  const role = record.meta.role;
  const expected = isSideFile(role) ? pack[role]?.size : pack.parts[record.meta.index as number]?.size;
  // A truncated or replaced file: fail the download (the sheet offers a retry).
  if (expected !== undefined && sizeOf(file) !== expected) {
    deleteFile(file.uri);
    throw new Error(`${file.name}: ${sizeOf(file)} bytes, expected ${expected}`);
  }
  // Imported once the pack is installed (now, or after its assembly).
  if (isSideFile(role)) importPackSide(pack.id, role, true);
  else await assemblePack(pack, String(record.meta.valhalla ?? ''), record);
}

/**
 * Startup sweep (after the download manager restored its queue): temp files from an
 * interrupted assembly, and parts or side files no download of their pack is left for
 * (failed ones count: a retry needs the rest). A side file of an installed pack is an import
 * still to run (resumePackImports).
 */
export function sweepRoutingFiles() {
  const busy = new Set<string>();
  for (const r of Object.values(useDownloads.getState().records)) {
    const id = (r.meta.pack as ManifestPack | undefined)?.id;
    if (r.kind === 'route' && r.status !== 'cancelled' && id) busy.add(id);
  }
  for (const entry of contentDir('route').list()) {
    if (!(entry instanceof File)) continue;
    const m = FILE_RE.exec(entry.name);
    if (!m) continue;
    const [, id, what] = m;
    const side = what.endsWith('.tsv');
    if (what === 'tar.tmp' ? assembling.has(id) : busy.has(id) || (side && getItem(routePackId(id)))) continue;
    deleteFile(entry.uri);
    if (side) forgetSideFile('route', entry.name);
  }
  // Expected by a pack that is neither installed nor downloading: its download is gone.
  for (const { name, item } of expectedSideFiles('route')) {
    if (!getItem(item) && !busy.has(SIDE_RE.exec(name)?.[1] ?? '')) forgetSideFile('route', name);
  }
}

/** Startup: points and search files whose import didn't finish (the app was killed) go in again. */
export function resumePackImports() {
  const records = useDownloads.getState().records;
  for (const entry of contentDir('route').list()) {
    const m = entry instanceof File ? SIDE_RE.exec(entry.name) : null;
    if (!m) continue;
    const side = m[2] as SideFile;
    // One still downloading imports when it lands (the manager finishes a 'processing' one).
    const rec = records[sideId(m[1], side)];
    if (rec && ACTIVE.has(rec.status)) continue;
    importPackSide(m[1], side);
  }
}

/** A removed country: its pack's parts and side files go now, not at the next launch. */
export function discardPackFiles(packId: string) {
  for (const entry of contentDir('route').list()) {
    const m = entry instanceof File ? FILE_RE.exec(entry.name) : null;
    if (!m || m[1] !== packId || (m[2] === 'tar.tmp' && assembling.has(packId))) continue;
    deleteFile(entry.uri);
    if (m[2].endsWith('.tsv')) forgetSideFile('route', entry.name);
  }
}
