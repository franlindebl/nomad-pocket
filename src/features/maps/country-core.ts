// Country downloads, the pure part: the country maps catalog (maps-manifest.json, written by
// scripts/maps/maps-manifest.py) and which routing pack belongs to which country. A country
// download is its map plus, where one exists, its routing pack (docs/UX_SURVIVAL_PLAN.md).
import type { ManifestFile, ManifestPack } from './routing-core.ts';

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

/** The routing pack of a country, if the catalog has one. */
export function routePackFor<P extends Pick<ManifestPack, 'id' | 'regionId'>>(packs: P[], regionId: string): P | null {
  return packs.find((p) => p.regionId === regionId) ?? packs.find((p) => p.id === SHARED_PACKS[regionId]) ?? null;
}
