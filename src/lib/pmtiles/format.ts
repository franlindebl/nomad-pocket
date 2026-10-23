// PMTiles v3 binary format: 127-byte header, varint-encoded directories and
// compression helpers. Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import { gunzipSync, gzipSync } from 'fflate';

export const HEADER_SIZE = 127;
/** Header + root directory must fit in the first 16 KiB of an archive. */
export const ROOT_SIZE_LIMIT = 16384;

// Plain const objects (not enums) so the module runs under node --experimental-strip-types.
export const Compression = { Unknown: 0, None: 1, Gzip: 2, Brotli: 3, Zstd: 4 } as const;
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Compression = (typeof Compression)[keyof typeof Compression];

export const TileType = { Unknown: 0, Mvt: 1, Png: 2, Jpeg: 3, Webp: 4, Avif: 5 } as const;
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TileType = (typeof TileType)[keyof typeof TileType];

export type Header = {
  specVersion: number;
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  jsonMetadataOffset: number;
  jsonMetadataLength: number;
  leafDirectoryOffset: number;
  leafDirectoryLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  numAddressedTiles: number;
  numTileEntries: number;
  numTileContents: number;
  clustered: boolean;
  internalCompression: Compression;
  tileCompression: Compression;
  tileType: TileType;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
};

/** One directory entry. runLength 0 means "points to a leaf directory". */
export type Entry = {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
};

export class FormatError extends Error {}

// ---------------------------------------------------------------------------
// Header

const U32 = 0x100000000;

function getUint64(view: DataView, pos: number): number {
  const lo = view.getUint32(pos, true);
  const hi = view.getUint32(pos + 4, true);
  return hi * U32 + lo;
}

function setUint64(view: DataView, pos: number, value: number) {
  view.setUint32(pos, value % U32, true);
  view.setUint32(pos + 4, Math.floor(value / U32), true);
}

export function parseHeader(bytes: Uint8Array): Header {
  if (bytes.length < HEADER_SIZE) throw new FormatError('header too short');
  const magic = String.fromCharCode(...bytes.subarray(0, 7));
  if (magic !== 'PMTiles') throw new FormatError('not a PMTiles archive');
  const v = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  const specVersion = bytes[7];
  if (specVersion !== 3) throw new FormatError(`unsupported PMTiles version ${specVersion}`);
  return {
    specVersion,
    rootDirectoryOffset: getUint64(v, 8),
    rootDirectoryLength: getUint64(v, 16),
    jsonMetadataOffset: getUint64(v, 24),
    jsonMetadataLength: getUint64(v, 32),
    leafDirectoryOffset: getUint64(v, 40),
    leafDirectoryLength: getUint64(v, 48),
    tileDataOffset: getUint64(v, 56),
    tileDataLength: getUint64(v, 64),
    numAddressedTiles: getUint64(v, 72),
    numTileEntries: getUint64(v, 80),
    numTileContents: getUint64(v, 88),
    clustered: v.getUint8(96) === 1,
    internalCompression: v.getUint8(97) as Compression,
    tileCompression: v.getUint8(98) as Compression,
    tileType: v.getUint8(99) as TileType,
    minZoom: v.getUint8(100),
    maxZoom: v.getUint8(101),
    minLon: v.getInt32(102, true) / 1e7,
    minLat: v.getInt32(106, true) / 1e7,
    maxLon: v.getInt32(110, true) / 1e7,
    maxLat: v.getInt32(114, true) / 1e7,
    centerZoom: v.getUint8(118),
    centerLon: v.getInt32(119, true) / 1e7,
    centerLat: v.getInt32(123, true) / 1e7,
  };
}

export function serializeHeader(h: Header): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE);
  const v = new DataView(bytes.buffer);
  'PMTiles'.split('').forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  bytes[7] = 3;
  setUint64(v, 8, h.rootDirectoryOffset);
  setUint64(v, 16, h.rootDirectoryLength);
  setUint64(v, 24, h.jsonMetadataOffset);
  setUint64(v, 32, h.jsonMetadataLength);
  setUint64(v, 40, h.leafDirectoryOffset);
  setUint64(v, 48, h.leafDirectoryLength);
  setUint64(v, 56, h.tileDataOffset);
  setUint64(v, 64, h.tileDataLength);
  setUint64(v, 72, h.numAddressedTiles);
  setUint64(v, 80, h.numTileEntries);
  setUint64(v, 88, h.numTileContents);
  v.setUint8(96, h.clustered ? 1 : 0);
  v.setUint8(97, h.internalCompression);
  v.setUint8(98, h.tileCompression);
  v.setUint8(99, h.tileType);
  v.setUint8(100, h.minZoom);
  v.setUint8(101, h.maxZoom);
  v.setInt32(102, Math.round(h.minLon * 1e7), true);
  v.setInt32(106, Math.round(h.minLat * 1e7), true);
  v.setInt32(110, Math.round(h.maxLon * 1e7), true);
  v.setInt32(114, Math.round(h.maxLat * 1e7), true);
  v.setUint8(118, h.centerZoom);
  v.setInt32(119, Math.round(h.centerLon * 1e7), true);
  v.setInt32(123, Math.round(h.centerLat * 1e7), true);
  return bytes;
}

// ---------------------------------------------------------------------------
// Varints (unsigned LEB128, values up to 2^53)

export class ByteWriter {
  private buf: Uint8Array;
  length = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(extra: number) {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  varint(value: number) {
    if (value < 0 || !Number.isSafeInteger(value)) throw new FormatError(`varint out of range: ${value}`);
    this.ensure(10);
    let v = value;
    while (v >= 0x80) {
      this.buf[this.length++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.length++] = v;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  pos = 0;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  varint(): number {
    let result = 0;
    let mult = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) throw new FormatError('truncated varint');
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mult;
      if (b < 0x80) return result;
      mult *= 0x80;
    }
    throw new FormatError('varint too long');
  }
}

// ---------------------------------------------------------------------------
// Directories

export function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const w = new ByteWriter(Math.max(64, entries.length * 6));
  w.varint(entries.length);
  let lastId = 0;
  for (const e of entries) {
    if (e.tileId < lastId) throw new FormatError('directory entries must be sorted by tileId');
    w.varint(e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) w.varint(e.runLength);
  for (const e of entries) w.varint(e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = entries[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) w.varint(0);
    else w.varint(e.offset + 1);
  }
  return w.bytes();
}

export function deserializeDirectory(bytes: Uint8Array): Entry[] {
  const r = new ByteReader(bytes);
  const n = r.varint();
  const entries: Entry[] = new Array(n);
  let lastId = 0;
  for (let i = 0; i < n; i++) {
    lastId += r.varint();
    entries[i] = { tileId: lastId, offset: 0, length: 0, runLength: 0 };
  }
  for (let i = 0; i < n; i++) entries[i].runLength = r.varint();
  for (let i = 0; i < n; i++) entries[i].length = r.varint();
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    if (v === 0 && i > 0) entries[i].offset = entries[i - 1].offset + entries[i - 1].length;
    else entries[i].offset = v - 1;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Compression (internal directories/metadata). Tile payloads are copied as-is.

export function decompress(bytes: Uint8Array, c: Compression): Uint8Array {
  if (c === Compression.None || c === Compression.Unknown) return bytes;
  if (c === Compression.Gzip) return gunzipSync(bytes);
  throw new FormatError(`unsupported compression ${c}`);
}

export function compress(bytes: Uint8Array, c: Compression): Uint8Array {
  if (c === Compression.None || c === Compression.Unknown) return bytes;
  if (c === Compression.Gzip) return gzipSync(bytes, { level: 6 });
  throw new FormatError(`unsupported compression ${c}`);
}

/**
 * Builds the root directory (and leaf directories if needed) so that the header
 * plus root directory fit in the first 16 KiB, like go-pmtiles' optimizeDirectories.
 * `leafSize` forces leaf directories of that many entries (tests).
 */
export function buildDirectories(
  entries: readonly Entry[],
  c: Compression,
  opts: { leafSize?: number } = {},
): { root: Uint8Array; leaves: Uint8Array; numLeaves: number } {
  const rootLimit = ROOT_SIZE_LIMIT - HEADER_SIZE;
  if (!opts.leafSize && entries.length < 16384) {
    const root = compress(serializeDirectory(entries), c);
    if (root.length <= rootLimit) return { root, leaves: new Uint8Array(0), numLeaves: 0 };
  }
  let leafSize = opts.leafSize ?? Math.max(4096, Math.ceil(entries.length / 3500));
  for (;;) {
    const rootEntries: Entry[] = [];
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = compress(serializeDirectory(entries.slice(i, i + leafSize)), c);
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      chunks.push(leaf);
      offset += leaf.length;
    }
    const root = compress(serializeDirectory(rootEntries), c);
    if (root.length <= rootLimit) return { root, leaves: concatBytes(chunks), numLeaves: chunks.length };
    leafSize = Math.ceil(leafSize * 1.2);
  }
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
