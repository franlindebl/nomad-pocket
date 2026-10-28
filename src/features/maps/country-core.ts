// Country downloads, the pure part: the country maps catalog (maps-manifest.json, written by
// scripts/maps/maps-manifest.py) and which routing pack belongs to which country. A country
// download is its map plus, where one exists, its routing pack (docs/UX_SURVIVAL_PLAN.md).
import { cellOf, covers, engineReads, LEGACY_PACK_VALHALLA, type ManifestFile, type ManifestPack } from './routing-core.ts';
import { bboxHas, type LatLon } from './geo.ts';

export type CountryMap = {
  id: string;
  /** Release holding this map's files (maps not rebuilt this month stay in an older one). */
  release?: string;
  regionId: string;
  /** YYYYMMDD of the Protomaps planet build. */
  buildDate: string;
  /** 15, less for the very largest countries. */
  maxZoom: number;
  bbox: [number, number, number, number];
  /** Bytes of the whole archive (sum of its parts). */
  size: number;
  /** The .pmtiles archive, in order; append them to rebuild it (GitHub assets stop at 2 GiB). */
  parts: ManifestFile[];
  /** Emergency points (Overpass TSV columns); null where a routing pack brings them. */
  pois: ManifestFile | null;
  /** Street and locality names for search (parseStreetsTsv); null where a routing pack brings them. */
  streets: ManifestFile | null;
  /** Every named place, and every house number (places.ts indexPackPlaces / indexPackAddresses); same rule. */
  places?: ManifestFile | null;
  addresses?: ManifestFile | null;
  /** A region's map: the 1° cells of its outline (routing-core cellOf), to tell where the person is. */
  cells?: number[] | null;
};

export type MapsManifest = {
  version: 1;
  release: string;
  /** Where the files are, when not the GitHub release (local test servers). */
  baseUrl?: string;
  maps: CountryMap[];
};

const isFile = (f: unknown): f is ManifestFile =>
  !!f && typeof (f as ManifestFile).name === 'string' && /^[\w.-]+$/.test((f as ManifestFile).name) && Number.isFinite((f as ManifestFile).size);

// File names (`<regionId>.pmtiles`) and URLs are built from these: no paths, no other schemes.
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]+$/.test(v);
const isRelease = (v: unknown): v is string => typeof v === 'string' && /^[\w.-]+$/.test(v);
const isBaseUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);

/** Validates a downloaded catalog; maps that don't look right are dropped. */
export function parseMapsManifest(json: string): MapsManifest | null {
  let raw: Partial<MapsManifest>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw?.version !== 1 || !isRelease(raw.release) || !Array.isArray(raw.maps)) return null;
  if (raw.baseUrl != null && !isBaseUrl(raw.baseUrl)) return null;
  const maps = raw.maps.filter(
    (m) =>
      m &&
      isId(m.id) &&
      isId(m.regionId) &&
      (m.release == null || isRelease(m.release)) &&
      Number.isFinite(m.maxZoom) &&
      Number.isFinite(m.size) &&
      Array.isArray(m.bbox) &&
      m.bbox.length === 4 &&
      m.bbox.every(Number.isFinite) &&
      Array.isArray(m.parts) &&
      m.parts.length > 0 &&
      m.parts.every(isFile) &&
      (m.pois == null || isFile(m.pois)) &&
      (m.streets == null || isFile(m.streets)) &&
      (m.places == null || isFile(m.places)) &&
      (m.addresses == null || isFile(m.addresses)),
  );
  return {
    version: 1,
    release: raw.release,
    baseUrl: raw.baseUrl,
    maps: maps.map((m) => ({
      ...m,
      pois: m.pois ?? null,
      streets: m.streets ?? null,
      places: m.places ?? null,
      addresses: m.addresses ?? null,
      buildDate: String(m.buildDate ?? ''),
      cells: Array.isArray(m.cells) && m.cells.every(Number.isFinite) ? m.cells : null,
    })),
  };
}

export function mapAssetUrl(manifest: Pick<MapsManifest, 'release' | 'baseUrl'>, map: Pick<CountryMap, 'release'>, name: string, repo: string): string {
  const base = manifest.baseUrl?.replace(/\/$/, '') ?? `https://github.com/${repo}/releases/download/${map.release ?? manifest.release}`;
  return `${base}/${encodeURIComponent(name)}`;
}

/**
 * Countries routed by a pack built from an extract they share with a neighbour
 * (scripts/routing/packs.json `iso`). Not the UK: `ie` lists GB for Northern Ireland only.
 */
// Keep in step with SHARED in scripts/maps/build-country-map.sh.
const SHARED_PACKS: Record<string, string> = { ht: 'do' };

/**
 * The routing packs of a country: usually one; several for a country too big to build at
 * once (the USA: us-west, us-south…, each `regionId` "us"); a shared extract's; or none.
 */
export function routePacksFor<P extends Pick<ManifestPack, 'id' | 'regionId'>>(packs: P[], regionId: string): P[] {
  const own = packs.filter((p) => p.regionId === regionId);
  if (own.length) return own;
  const shared = packs.find((p) => p.id === SHARED_PACKS[regionId]);
  return shared ? [shared] : [];
}

// --- Countries in regions (docs/COUNTRY_REGIONS_PLAN.md) ------------------------

/**
 * What a country download is made of: the whole country (`id` = the country's), or each
 * region of a country split in regions, with its own map and, for the USA (us-west,
 * us-alaska…), its own pack(s). A region's map has `id` = the region and `regionId` = the
 * country. Canada and Russia are split for their maps only (ca-ontario, ru-south…): their
 * regions have no pack, the country's one comes with any of them (countryWidePacks).
 */
export type CountryPart<M = CountryMap, P = ManifestPack> = { id: string; map: M | null; packs: P[] };

/**
 * The parts of a country. Split only once the maps catalog has regional maps: until then (the
 * catalog of an earlier run) the country is one part, its whole map and every pack.
 */
export function countryParts<M extends Pick<CountryMap, 'id' | 'regionId'>, P extends Pick<ManifestPack, 'id' | 'regionId'>>(
  regionId: string,
  maps: M[],
  packs: P[],
): CountryPart<M, P>[] {
  const regional = maps.filter((m) => m.regionId === regionId && m.id !== regionId);
  if (!regional.length) {
    const map = maps.find((m) => m.id === regionId) ?? maps.find((m) => m.regionId === regionId) ?? null;
    return [{ id: regionId, map, packs: routePacksFor(packs, regionId) }];
  }
  const ids = [...new Set([...regional.map((m) => m.id), ...packs.filter((p) => p.regionId === regionId && p.id !== regionId).map((p) => p.id)])];
  return ids.sort().map((id) => ({ id, map: regional.find((m) => m.id === id) ?? null, packs: packs.filter((p) => p.id === id) }));
}

/**
 * The packs of a country split in regions that belong to none of them: the whole country's
 * (Canada, Russia: their routing pack fits whole), so routes from one region to another work.
 * They come with the first region and go with the last. None for the USA (a pack per region)
 * or a country in one part.
 */
export function countryWidePacks<P extends Pick<ManifestPack, 'id' | 'regionId'>>(regionId: string, parts: CountryPart<unknown, P>[], packs: P[]): P[] {
  if (parts.length === 1 && parts[0].id === regionId) return [];
  const ids = new Set(parts.map((p) => p.id));
  return routePacksFor(packs, regionId).filter((p) => !ids.has(p.id));
}

const inBox = bboxHas;

/**
 * The part a point is in: the one whose pack has roads there, else whose map's outline
 * touches its 1° cell (regions without a pack of their own: Canada, Russia), else whose map's
 * bbox covers it (a catalog without cells).
 */
export function partAt<M extends Pick<CountryMap, 'bbox' | 'cells'>, P extends Pick<ManifestPack, 'bbox' | 'cells'>>(
  parts: CountryPart<M, P>[],
  p: LatLon,
): CountryPart<M, P> | null {
  const cell = cellOf(p);
  return (
    parts.find((x) => x.packs.some((pack) => covers(pack, p))) ??
    parts.find((x) => !!x.map?.cells?.includes(cell)) ??
    parts.find((x) => !!x.map && !x.map.cells?.length && inBox(x.map.bbox, p)) ??
    null
  );
}

// --- One download per country (map, pack and side files under one group) ------

/** The download group of a country: its map, its pack (even another country's) and their side files. */
export const countryGroupId = (regionId: string) => `country-${regionId}`;

/** The country a download group belongs to (null: not a country's group). */
export function countryOfGroup(groupId: string | null | undefined): string | null {
  return (groupId && /^country-(.+)$/.exec(groupId)?.[1]) || null;
}

/** YYYYMMDD build dates: whether `latest` is a newer build than `installed`. */
export function isNewer(latest: string | null | undefined, installed: string | null | undefined): boolean {
  return !!latest && !!installed && latest > installed;
}

/**
 * Whether an installed pack should be replaced by the catalog's: a newer build, or one built by
 * a Valhalla this app's engine can't read (packs installed before the version was recorded
 * were all built by LEGACY_PACK_VALHALLA).
 */
export function packOutdated(installed: { buildDate?: string | null; valhalla?: string | null }, latest: Pick<ManifestPack, 'buildDate'>): boolean {
  return isNewer(latest.buildDate, installed.buildDate) || !engineReads(installed.valhalla ?? LEGACY_PACK_VALHALLA);
}

/** One file of an archive to download: already on disk, already queued, or still to fetch. */
export type PlannedFile = { size: number; onDisk: boolean; queued: boolean };
/** A country map or routing pack: its parts (appended into the archive) and its side files. */
export type PlannedArchive = { size: number; parts: PlannedFile[]; sides: PlannedFile[] };
/** `bytes`: what will be fetched; `needed`: the free space that takes. */
export type CountryNeed = { bytes: number; needed: number };

const toFetch = (f: PlannedFile) => (f.onDisk || f.queued ? 0 : f.size);

/**
 * What a country download takes, for the size it shows and the room it checks (both the same
 * figure, so the sheet never offers what the download then refuses). Files already on disk
 * cost nothing; queued ones are in `pending` (the remaining bytes of every download in the
 * queue, as the download manager counts them before queueing another). A multi-part archive
 * is appended into a temp copy while its parts still exist: its whole size again, for the
 * biggest one only (assemblies run one at a time: assembly.ts).
 */
export function countryNeed(archives: (PlannedArchive | null | undefined)[], pending = 0): CountryNeed {
  let bytes = 0;
  let copy = 0;
  for (const a of archives) {
    if (!a) continue;
    bytes += a.parts.reduce((sum, f) => sum + toFetch(f), 0) + a.sides.reduce((sum, f) => sum + toFetch(f), 0);
    if (a.parts.length > 1) copy = Math.max(copy, a.size);
  }
  return { bytes, needed: pending + bytes + copy };
}

type PendingRecord = { status: string; totalBytes: number; bytesWritten: number; external?: boolean };

/** Bytes still to come for downloads in the queue (the manager's own room check counts these). */
export function pendingBytes(records: PendingRecord[]): number {
  return records
    .filter((r) => !r.external && (r.status === 'queued' || r.status === 'running' || r.status === 'paused'))
    .reduce((sum, r) => sum + Math.max(0, r.totalBytes - r.bytesWritten), 0);
}
