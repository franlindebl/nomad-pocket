// Region extraction from a remote PMTiles v3 archive, like `pmtiles extract`:
//
// 1. plan: read header + root directory, walk only the leaf directories whose
//    tile-id span intersects the bbox, collect matching entries, deduplicate
//    tile contents, lay out the output archive and coalesce the source byte
//    ranges into few large requests (accepting a little overfetch). The plan is
//    also the dry-run size estimate.
// 2. execute: write header/directories/metadata, then download the requests with
//    bounded concurrency and copy each tile to its final position.
import {
  Compression,
  HEADER_SIZE,
  buildDirectories,
  compress,
  concatBytes,
  decompress,
  deserializeDirectory,
  FormatError,
  MAX_LEAF_DEPTH,
  parseHeader,
  serializeHeader,
  type Entry,
  type Header,
} from './format.ts';
import { AbortError, throwIfAborted, type RangeSource, type Sink } from './io.ts';
import { bboxTileRanges, firstRangeAfter, intersects, type BBox } from './tileid.ts';

export type ExtractProgress = {
  phase: 'directories' | 'tiles';
  /** Bytes fetched so far in this phase. */
  bytes: number;
  /** Expected total for this phase (0 while unknown). */
  totalBytes: number;
};

export type PlanOptions = {
  bbox: BBox;
  minZoom?: number;
  maxZoom?: number;
  /** Fraction of extra bytes accepted to merge nearby ranges (default 0.05). */
  overfetch?: number;
  /** Upper bound of a single HTTP request (default 4 MiB). */
  maxRequestBytes?: number;
  /** Parallel requests (default 4). */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: ExtractProgress) => void;
  /** Leaf size override for the output directories (tests). */
  leafSize?: number;
};

export type TileRequest = {
  /** Absolute offset in the source archive. */
  offset: number;
  length: number;
  /** Flattened triples: [offset within response, offset within output tile data, length]. */
  copies: number[];
};

export type ExtractPlan = {
  sourceKey: string;
  sourceHeader: Header;
  header: Header;
  metadata: Record<string, unknown>;
  /** Header + root directory + metadata + leaf directories, written at offset 0. */
  prefix: Uint8Array;
  requests: TileRequest[];
  /** Size of the output archive. */
  archiveBytes: number;
  /** Tile bytes that will be downloaded, overfetch included. */
  downloadBytes: number;
  /** Directory bytes already fetched while planning. */
  directoryBytes: number;
  numAddressedTiles: number;
  numTileContents: number;
};

export class EmptyExtractError extends Error {
  constructor() {
    super('No tiles in the requested area');
  }
}

const DEFAULTS = { overfetch: 0.05, maxRequestBytes: 4 * 1024 * 1024, concurrency: 4 };

export type ArchiveInfo = {
  header: Header;
  metadata: Record<string, unknown>;
  rootEntries: Entry[];
  metadataRaw: Uint8Array;
  bytesRead: number;
};

/** Reads header, metadata and root directory (one or two requests). */
export async function readArchiveInfo(source: RangeSource, signal?: AbortSignal): Promise<ArchiveInfo> {
  const first = await source.getBytes(0, 16384, signal);
  const header = parseHeader(first);
  let bytesRead = first.length;
  const rootEnd = header.rootDirectoryOffset + header.rootDirectoryLength;
  let rootBytes: Uint8Array;
  if (rootEnd <= first.length) rootBytes = first.subarray(header.rootDirectoryOffset, rootEnd);
  else {
    rootBytes = await source.getBytes(header.rootDirectoryOffset, header.rootDirectoryLength, signal);
    bytesRead += rootBytes.length;
  }
  const metaEnd = header.jsonMetadataOffset + header.jsonMetadataLength;
  let metadataRaw: Uint8Array;
  if (metaEnd <= first.length) metadataRaw = first.slice(header.jsonMetadataOffset, metaEnd);
  else {
    metadataRaw = await source.getBytes(header.jsonMetadataOffset, header.jsonMetadataLength, signal);
    bytesRead += metadataRaw.length;
  }
  let metadata: Record<string, unknown> = {};
  try {
    const text = new TextDecoder().decode(decompress(metadataRaw, header.internalCompression));
    metadata = text ? JSON.parse(text) : {};
  } catch {
    metadata = {};
  }
  const rootEntries = deserializeDirectory(decompress(rootBytes, header.internalCompression));
  return { header, metadata, rootEntries, metadataRaw, bytesRead };
}

type Span = { offset: number; length: number };

/**
 * Groups sorted spans into requests. Gaps are merged smallest-first while the
 * wasted bytes stay within `overfetch` × total; requests never exceed `maxBytes`
 * unless a single span is larger.
 */
export function coalesce<T extends Span>(
  spans: T[],
  overfetch: number,
  maxBytes: number,
): { offset: number; length: number; items: T[] }[] {
  const n = spans.length;
  if (!n) return [];
  let total = 0;
  for (const s of spans) total += s.length;
  const gaps = new Float64Array(Math.max(0, n - 1));
  for (let i = 0; i < n - 1; i++) gaps[i] = Math.max(0, spans[i + 1].offset - (spans[i].offset + spans[i].length));
  const order = Array.from({ length: n - 1 }, (_, i) => i).sort((a, b) => gaps[a] - gaps[b]);
  const merge = new Uint8Array(Math.max(0, n - 1));
  const budget = total * overfetch;
  let used = 0;
  for (const i of order) {
    const g = gaps[i];
    if (g > 0 && used + g > budget) break;
    merge[i] = 1;
    used += g;
  }
  const out: { offset: number; length: number; items: T[] }[] = [];
  let cur = { offset: spans[0].offset, length: spans[0].length, items: [spans[0]] };
  for (let i = 1; i < n; i++) {
    const s = spans[i];
    const end = Math.max(cur.offset + cur.length, s.offset + s.length);
    if (merge[i - 1] && end - cur.offset <= maxBytes) {
      cur.length = end - cur.offset;
      cur.items.push(s);
    } else {
      out.push(cur);
      cur = { offset: s.offset, length: s.length, items: [s] };
    }
  }
  out.push(cur);
  return out;
}

/** Runs `fn` over items with at most `limit` in flight; stops on the first error. */
async function pool<T>(items: T[], limit: number, signal: AbortSignal | undefined, fn: (item: T) => Promise<void>) {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null) {
      throwIfAborted(signal);
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch (e) {
        if (failed === null) failed = e;
        throw e;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  const results = await Promise.allSettled(workers);
  if (failed !== null) throw failed;
  for (const r of results) if (r.status === 'rejected') throw r.reason;
}

function clampZoom(z: number | undefined, lo: number, hi: number, fallback: number) {
  return Math.max(lo, Math.min(hi, z ?? fallback));
}

export async function planExtract(source: RangeSource, opts: PlanOptions): Promise<ExtractPlan> {
  const { signal, onProgress } = opts;
  const overfetch = opts.overfetch ?? DEFAULTS.overfetch;
  const maxRequestBytes = opts.maxRequestBytes ?? DEFAULTS.maxRequestBytes;
  const concurrency = opts.concurrency ?? DEFAULTS.concurrency;

  const info = await readArchiveInfo(source, signal);
  const src = info.header;
  const minZoom = clampZoom(opts.minZoom, src.minZoom, src.maxZoom, src.minZoom);
  const maxZoom = clampZoom(opts.maxZoom, minZoom, src.maxZoom, src.maxZoom);
  const [w, s, e, n] = opts.bbox;
  const bbox: BBox = [Math.max(w, src.minLon), Math.max(s, src.minLat), Math.min(e, src.maxLon), Math.min(n, src.maxLat)];
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new EmptyExtractError();
  const ranges = bboxTileRanges(bbox, minZoom, maxZoom);

  // --- Walk directories -----------------------------------------------------
  // Matching tile entries, with offsets relative to the source tile data section.
  const pieces: Entry[] = [];
  let dirBytes = info.bytesRead;
  let dirTotal = info.bytesRead;
  type LeafRef = Span & { end: number };

  const scan = (entries: Entry[], endBound: number, leafRefs: LeafRef[]) => {
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      if (en.runLength > 0) {
        const a = en.tileId;
        const b = en.tileId + en.runLength;
        for (let r = firstRangeAfter(ranges, a); r < ranges.length && ranges[r][0] < b; r++) {
          const start = Math.max(a, ranges[r][0]);
          const end = Math.min(b, ranges[r][1]);
          pieces.push({ tileId: start, runLength: end - start, offset: en.offset, length: en.length });
        }
      } else {
        const end = i + 1 < entries.length ? entries[i + 1].tileId : endBound;
        if (intersects(ranges, en.tileId, end)) {
          leafRefs.push({ offset: src.leafDirectoryOffset + en.offset, length: en.length, end });
        }
      }
    }
  };

  let leafRefs: LeafRef[] = [];
  scan(info.rootEntries, Infinity, leafRefs);
  // A corrupt archive can point a leaf back at itself or nest leaves without end.
  const seenLeaves = new Set<number>();
  for (let depth = 1; leafRefs.length; depth++) {
    leafRefs = leafRefs.filter((ref) => !seenLeaves.has(ref.offset) && seenLeaves.add(ref.offset));
    if (!leafRefs.length) break;
    if (depth > MAX_LEAF_DEPTH) throw new FormatError('leaf directories nest too deep');
    leafRefs.sort((a, b) => a.offset - b.offset);
    const groups = coalesce(leafRefs, 0.1, maxRequestBytes);
    dirTotal += groups.reduce((sum, g) => sum + g.length, 0);
    onProgress?.({ phase: 'directories', bytes: dirBytes, totalBytes: dirTotal });
    const nextRefs: LeafRef[] = [];
    // Groups finish out of order; keep each group's entries and scan them in order.
    const fetched: Entry[][][] = new Array(groups.length);
    await pool(
      groups.map((g, i) => ({ g, i })),
      concurrency,
      signal,
      async ({ g, i }) => {
        const data = await source.getBytes(g.offset, g.length, signal);
        fetched[i] = g.items.map((ref) =>
          deserializeDirectory(
            decompress(data.subarray(ref.offset - g.offset, ref.offset - g.offset + ref.length), src.internalCompression),
          ),
        );
        dirBytes += g.length;
        onProgress?.({ phase: 'directories', bytes: dirBytes, totalBytes: dirTotal });
      },
    );
    groups.forEach((g, gi) => g.items.forEach((ref, ri) => scan(fetched[gi][ri], ref.end, nextRefs)));
    leafRefs = nextRefs;
  }
  throwIfAborted(signal);
  if (!pieces.length) throw new EmptyExtractError();

  // --- Deduplicate contents and lay out tile data ----------------------------
  pieces.sort((a, b) => a.tileId - b.tileId);
  const blobs: Span[] = [];
  {
    const byOffset = pieces.map((p) => ({ offset: p.offset, length: p.length })).sort((a, b) => a.offset - b.offset);
    for (const b of byOffset) {
      const last = blobs[blobs.length - 1];
      if (!last || last.offset !== b.offset) blobs.push(b);
    }
  }
  const dstOf = new Map<number, number>();
  let tileDataLength = 0;
  for (const b of blobs) {
    dstOf.set(b.offset, tileDataLength);
    tileDataLength += b.length;
  }

  const entries: Entry[] = [];
  let numAddressedTiles = 0;
  for (const p of pieces) {
    const offset = dstOf.get(p.offset)!;
    numAddressedTiles += p.runLength;
    const last = entries[entries.length - 1];
    if (last && last.offset === offset && last.tileId + last.runLength === p.tileId) last.runLength += p.runLength;
    else entries.push({ tileId: p.tileId, runLength: p.runLength, offset, length: p.length });
  }

  // --- Requests ---------------------------------------------------------------
  const requests: TileRequest[] = coalesce(
    blobs.map((b) => ({ offset: src.tileDataOffset + b.offset, length: b.length, dst: dstOf.get(b.offset)! })),
    overfetch,
    maxRequestBytes,
  ).map((g) => {
    const copies: number[] = [];
    for (const it of g.items) {
      const rel = it.offset - g.offset;
      const k = copies.length;
      // Merge with the previous copy when contiguous in both source and output.
      if (k && copies[k - 3] + copies[k - 1] === rel && copies[k - 2] + copies[k - 1] === it.dst) copies[k - 1] += it.length;
      else copies.push(rel, it.dst, it.length);
    }
    return { offset: g.offset, length: g.length, copies };
  });

  // --- Output layout: header | root | metadata | leaves | tile data -----------
  const internal = Compression.Gzip;
  const dirs = buildDirectories(entries, internal, { leafSize: opts.leafSize });
  const metadataBytes =
    src.internalCompression === internal ? info.metadataRaw : compress(new TextEncoder().encode(JSON.stringify(info.metadata)), internal);
  const rootOffset = HEADER_SIZE;
  const metadataOffset = rootOffset + dirs.root.length;
  const leafOffset = metadataOffset + metadataBytes.length;
  const tileDataOffset = leafOffset + dirs.leaves.length;
  const width = bbox[2] - bbox[0];
  const centerZoom = clampZoom(Math.round(Math.log2(360 / Math.max(width, 1e-6))), minZoom, maxZoom, minZoom);

  const header: Header = {
    specVersion: 3,
    rootDirectoryOffset: rootOffset,
    rootDirectoryLength: dirs.root.length,
    jsonMetadataOffset: metadataOffset,
    jsonMetadataLength: metadataBytes.length,
    leafDirectoryOffset: leafOffset,
    leafDirectoryLength: dirs.leaves.length,
    tileDataOffset,
    tileDataLength,
    numAddressedTiles,
    numTileEntries: entries.length,
    numTileContents: blobs.length,
    clustered: src.clustered,
    internalCompression: internal,
    tileCompression: src.tileCompression,
    tileType: src.tileType,
    minZoom,
    maxZoom,
    minLon: bbox[0],
    minLat: bbox[1],
    maxLon: bbox[2],
    maxLat: bbox[3],
    centerZoom,
    centerLon: (bbox[0] + bbox[2]) / 2,
    centerLat: (bbox[1] + bbox[3]) / 2,
  };
  const prefix = concatBytes([serializeHeader(header), dirs.root, metadataBytes, dirs.leaves]);

  return {
    sourceKey: source.key,
    sourceHeader: src,
    header,
    metadata: info.metadata,
    prefix,
    requests,
    archiveBytes: tileDataOffset + tileDataLength,
    downloadBytes: requests.reduce((sum, r) => sum + r.length, 0),
    directoryBytes: dirBytes,
    numAddressedTiles,
    numTileContents: blobs.length,
  };
}

export type ExecuteOptions = {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: ExtractProgress) => void;
};

/** Downloads the planned tiles into `sink`. The sink must start empty. */
export async function executeExtract(source: RangeSource, plan: ExtractPlan, sink: Sink, opts: ExecuteOptions = {}): Promise<void> {
  const { signal, onProgress } = opts;
  // Our own controller so in-flight requests stop when one of them fails.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort);
  try {
    throwIfAborted(signal);
    await sink.write(0, plan.prefix);
    const base = plan.header.tileDataOffset;
    let done = 0;
    onProgress?.({ phase: 'tiles', bytes: 0, totalBytes: plan.downloadBytes });
    await pool(plan.requests, opts.concurrency ?? DEFAULTS.concurrency, ctrl.signal, async (req) => {
      try {
        const data = await source.getBytes(req.offset, req.length, ctrl.signal);
        const c = req.copies;
        for (let k = 0; k < c.length; k += 3) await sink.write(base + c[k + 1], data.subarray(c[k], c[k] + c[k + 2]));
      } catch (e) {
        ctrl.abort();
        throw e;
      }
      done += req.length;
      onProgress?.({ phase: 'tiles', bytes: done, totalBytes: plan.downloadBytes });
    }).catch((e) => {
      if (signal?.aborted) throw new AbortError();
      throw e;
    });
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** plan + execute in one call. */
export async function extract(source: RangeSource, sink: Sink, opts: PlanOptions): Promise<ExtractPlan> {
  const plan = await planExtract(source, opts);
  await executeExtract(source, plan, sink, opts);
  return plan;
}
