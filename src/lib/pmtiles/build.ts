// Writes a complete PMTiles v3 archive from in-memory tiles (deduplicated,
// run-length encoded, clustered). Used for test fixtures; fine for small sets.
import {
  Compression,
  HEADER_SIZE,
  TileType,
  buildDirectories,
  compress,
  concatBytes,
  serializeHeader,
  type Entry,
  type Header,
} from './format.ts';
import { tileIdToZxy } from './tileid.ts';

export type BuildOptions = {
  tileType?: TileType;
  tileCompression?: Compression;
  metadata?: Record<string, unknown>;
  bounds?: [number, number, number, number];
  leafSize?: number;
};

function key(data: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619);
  return `${data.length}:${h >>> 0}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function buildArchive(tiles: { tileId: number; data: Uint8Array }[], opts: BuildOptions = {}): Uint8Array {
  const sorted = [...tiles].sort((a, b) => a.tileId - b.tileId);
  if (!sorted.length) throw new Error('no tiles');
  const contents = new Map<string, { offset: number; data: Uint8Array }[]>();
  const blobs: Uint8Array[] = [];
  let dataLength = 0;
  const entries: Entry[] = [];
  for (const t of sorted) {
    const k = key(t.data);
    const bucket = contents.get(k) ?? [];
    let found = bucket.find((c) => sameBytes(c.data, t.data));
    if (!found) {
      found = { offset: dataLength, data: t.data };
      bucket.push(found);
      contents.set(k, bucket);
      blobs.push(t.data);
      dataLength += t.data.length;
    }
    const last = entries[entries.length - 1];
    if (last && last.offset === found.offset && last.tileId + last.runLength === t.tileId) last.runLength++;
    else entries.push({ tileId: t.tileId, offset: found.offset, length: t.data.length, runLength: 1 });
  }

  const internal = Compression.Gzip;
  const dirs = buildDirectories(entries, internal, { leafSize: opts.leafSize });
  const metadata = compress(new TextEncoder().encode(JSON.stringify(opts.metadata ?? {})), internal);
  const zooms = sorted.map((t) => tileIdToZxy(t.tileId)[0]);
  const bounds = opts.bounds ?? [-180, -85.0511287, 180, 85.0511287];
  const header: Header = {
    specVersion: 3,
    rootDirectoryOffset: HEADER_SIZE,
    rootDirectoryLength: dirs.root.length,
    jsonMetadataOffset: HEADER_SIZE + dirs.root.length,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset: HEADER_SIZE + dirs.root.length + metadata.length,
    leafDirectoryLength: dirs.leaves.length,
    tileDataOffset: HEADER_SIZE + dirs.root.length + metadata.length + dirs.leaves.length,
    tileDataLength: dataLength,
    numAddressedTiles: sorted.length,
    numTileEntries: entries.length,
    numTileContents: blobs.length,
    clustered: true,
    internalCompression: internal,
    tileCompression: opts.tileCompression ?? Compression.None,
    tileType: opts.tileType ?? TileType.Mvt,
    minZoom: Math.min(...zooms),
    maxZoom: Math.max(...zooms),
    minLon: bounds[0],
    minLat: bounds[1],
    maxLon: bounds[2],
    maxLat: bounds[3],
    centerZoom: Math.min(...zooms),
    centerLon: (bounds[0] + bounds[2]) / 2,
    centerLat: (bounds[1] + bounds[3]) / 2,
  };
  return concatBytes([serializeHeader(header), dirs.root, metadata, dirs.leaves, ...blobs]);
}
