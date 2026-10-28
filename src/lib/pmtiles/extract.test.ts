/// <reference types="node" />
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PMTiles, type RangeResponse, type Source } from 'pmtiles';

import { buildArchive } from './build.ts';
import { EmptyExtractError, coalesce, executeExtract, extract, planExtract } from './extract.ts';
import { parseHeader } from './format.ts';
import { AbortError, BytesSource, FetchSource, MemorySink, type Sink } from './io.ts';
import { bboxTileBounds, latToTileY, lonToTileX, zxyToTileId, type BBox } from './tileid.ts';

const enc = new TextEncoder();

/** Synthetic world z0..7: unique land tiles, shared "ocean" tiles (dedup + runs). */
function fixture(leafSize?: number) {
  const tiles: { tileId: number; data: Uint8Array }[] = [];
  const ocean = enc.encode('ocean'.repeat(20));
  for (let z = 0; z <= 7; z++) {
    const n = 1 << z;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < n; y++) {
        const isOcean = z >= 3 && (x * 7 + y * 3) % 4 === 0;
        tiles.push({ tileId: zxyToTileId(z, x, y), data: isOcean ? ocean : enc.encode(`tile ${z}/${x}/${y} `.repeat(1 + ((x + y) % 5))) });
      }
  }
  return buildArchive(tiles, { metadata: { name: 'fixture', vector_layers: [{ id: 'earth' }] }, leafSize });
}

/** Adapter so the official reader can read our in-memory output. */
class RefSource implements Source {
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  getKey() {
    return 'ref';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.data.slice(offset, offset + length).buffer };
  }
}

async function tileBytes(p: PMTiles, z: number, x: number, y: number) {
  const r = await p.getZxy(z, x, y);
  return r ? new Uint8Array(r.data) : undefined;
}

async function assertValidExtract(src: Uint8Array, out: Uint8Array, bbox: BBox, minZoom: number, maxZoom: number) {
  const reader = new PMTiles(new RefSource(out));
  const source = new PMTiles(new RefSource(src));
  const h = await reader.getHeader();
  assert.equal(h.specVersion, 3);
  assert.equal(h.minZoom, minZoom);
  assert.equal(h.maxZoom, maxZoom);
  assert.equal(h.clustered, true);
  assert.deepEqual(await reader.getMetadata(), await source.getMetadata());
  let inside = 0;
  for (let z = 0; z <= 7; z++) {
    const b = bboxTileBounds(bbox, z);
    const n = 1 << z;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < n; y++) {
        const got = await tileBytes(reader, z, x, y);
        const within = z >= minZoom && z <= maxZoom && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
        if (within) {
          inside++;
          assert.deepEqual(got, await tileBytes(source, z, x, y), `tile ${z}/${x}/${y}`);
        } else assert.equal(got, undefined, `tile ${z}/${x}/${y} should be absent`);
      }
  }
  assert.equal(h.numAddressedTiles, inside);
}

test('extracts a valid archive (root-only source)', async () => {
  const src = fixture();
  const bbox: BBox = [-20, 30, 15, 50];
  const sink = new MemorySink();
  const plan = await extract(new BytesSource(src), sink, { bbox, minZoom: 1, maxZoom: 6 });
  const out = sink.bytes();
  assert.equal(out.length, plan.archiveBytes);
  await assertValidExtract(src, out, bbox, 1, 6);
  assert.ok(plan.numTileContents < plan.numAddressedTiles, 'ocean tiles are deduplicated');
});

test('extracts through leaf directories, coalesces requests, writes leaves', async () => {
  const src = fixture(40);
  assert.ok(parseHeader(src).leafDirectoryLength > 0);
  const bbox: BBox = [100, -45, 160, -10];
  const source = new BytesSource(src);
  const sink = new MemorySink();
  const progress: number[] = [];
  const plan = await extract(source, sink, {
    bbox,
    minZoom: 0,
    maxZoom: 7,
    leafSize: 16,
    onProgress: (p) => p.phase === 'tiles' && progress.push(p.bytes / Math.max(1, p.totalBytes)),
  });
  const out = sink.bytes();
  assert.ok(parseHeader(out).leafDirectoryLength > 0, 'output uses leaf directories');
  await assertValidExtract(src, out, bbox, 0, 7);
  assert.equal(progress.at(-1), 1);
  assert.ok(plan.requests.length < plan.numTileContents, `${plan.requests.length} requests for ${plan.numTileContents} tiles`);
  assert.ok(plan.downloadBytes <= plan.header.tileDataLength * 1.06);
});

test('dry run estimates without downloading tile data', async () => {
  const src = fixture(40);
  const source = new BytesSource(src);
  const plan = await planExtract(source, { bbox: [-10, 35, 5, 45], maxZoom: 5 });
  const h = parseHeader(src);
  for (const [offset] of source.requests) assert.ok(offset < h.tileDataOffset, 'only header/directories read');
  assert.ok(plan.archiveBytes > plan.header.tileDataLength);
  assert.equal(plan.header.maxZoom, 5);
  // Executing the same plan later produces the archive.
  const sink = new MemorySink();
  await executeExtract(source, plan, sink);
  await assertValidExtract(src, sink.bytes(), [-10, 35, 5, 45], 0, 5);
});

test('abort and empty areas', async () => {
  const src = fixture(40);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(extract(new BytesSource(src), new MemorySink(), { bbox: [0, 0, 10, 10], signal: ctrl.signal }), AbortError);

  const ctrl2 = new AbortController();
  const plan = await planExtract(new BytesSource(src), { bbox: [-170, -80, 170, 80] });
  const slow: BytesSource = new BytesSource(src);
  const original = slow.getBytes.bind(slow);
  let calls = 0;
  slow.getBytes = async (o, l, s) => {
    if (++calls === 2) ctrl2.abort();
    return original(o, l, s);
  };
  await assert.rejects(
    executeExtract(slow, plan, new MemorySink(), { signal: ctrl2.signal, concurrency: 1, onProgress: () => {} }),
    AbortError,
  );

  await assert.rejects(planExtract(new BytesSource(src), { bbox: [10, 10, 5, 5] }), EmptyExtractError);
});

test('coalesce respects the overfetch budget and request cap', () => {
  const spans = [
    { offset: 0, length: 100 },
    { offset: 100, length: 100 },
    { offset: 210, length: 100 },
    { offset: 10_000, length: 100 },
  ];
  const groups = coalesce(spans, 0.05, 1e9);
  assert.deepEqual(
    groups.map((g) => [g.offset, g.length]),
    [
      [0, 310],
      [10_000, 100],
    ],
  );
  assert.equal(coalesce(spans, 0, 150).length, 4);
});

test('writes to a file sink (node:fs)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pmtiles-'));
  const path = join(dir, 'out.pmtiles');
  const fd = openSync(path, 'w');
  const sink: Sink = { write: (offset, data) => void writeSync(fd, data, 0, data.length, offset) };
  const src = fixture(40);
  await extract(new BytesSource(src), sink, { bbox: [-5, 35, 5, 45], maxZoom: 6, concurrency: 3 });
  closeSync(fd);
  await assertValidExtract(src, new Uint8Array(readFileSync(path)), [-5, 35, 5, 45], 0, 6);
  rmSync(dir, { recursive: true });
});

// Real fixture: a tiny extract of the Protomaps planet build 20261023 (rural Soria,
// z14-15, made with this extractor). Re-extracting must keep the gzip MVT tiles intact.
const REAL = new URL('./fixtures/soria-z14-15.pmtiles', import.meta.url);
test('re-extracts from a real Protomaps extract', async () => {
  const src = new Uint8Array(readFileSync(REAL));
  const sink = new MemorySink();
  const bbox: BBox = [-2.468, 41.762, -2.466, 41.764];
  await extract(new BytesSource(src), sink, { bbox, minZoom: 15, maxZoom: 15 });
  const reader = new PMTiles(new RefSource(sink.bytes()));
  const source = new PMTiles(new RefSource(src));
  const h = await reader.getHeader();
  assert.equal(h.tileType, 1);
  assert.equal(h.tileCompression, 2);
  assert.equal(h.minZoom, 15);
  const meta = (await reader.getMetadata()) as { vector_layers?: unknown[] };
  assert.ok(Array.isArray(meta.vector_layers));
  const b = bboxTileBounds(bbox, 15);
  let n = 0;
  for (let x = b.x0; x <= b.x1; x++)
    for (let y = b.y0; y <= b.y1; y++) {
      const t = await tileBytes(reader, 15, x, y);
      // The reader gunzips; an MVT starts with field 3 (layers), wire type 2.
      assert.ok(t && t.length > 100 && t[0] === 0x1a, 'decoded MVT tile');
      assert.deepEqual(t, await tileBytes(source, 15, x, y));
      n++;
    }
  assert.equal(h.numAddressedTiles, n);
  assert.equal(await reader.getZxy(14, b.x0 >> 1, b.y0 >> 1), undefined);
});

// Opt-in network test against the live planet: PMTILES_NETWORK=1 npm test
test('extracts from the live Protomaps planet', { skip: !process.env.PMTILES_NETWORK, timeout: 120_000 }, async () => {
  const builds = (await (await fetch('https://build-metadata.protomaps.dev/builds.json')).json()) as { key: string }[];
  const url = `https://build.protomaps.com/${builds[builds.length - 1].key}`;
  const sink = new MemorySink();
  const plan = await extract(new FetchSource(url), sink, { bbox: [-3.705, 40.414, -3.7, 40.418], minZoom: 13, maxZoom: 15 });
  const reader = new PMTiles(new RefSource(sink.bytes()));
  assert.equal((await reader.getHeader()).maxZoom, 15);
  assert.ok(plan.numAddressedTiles >= 3);
  assert.ok(await reader.getZxy(15, lonToTileX(-3.7025, 15), latToTileY(40.416, 15)));
});

test('resumes: skips finished requests and completes the archive', async () => {
  const src = fixture(40);
  const bbox: BBox = [-170, -80, 170, 80];
  const plan = await planExtract(new BytesSource(src), { bbox, maxRequestBytes: 400 });
  assert.ok(plan.requests.length > 6);

  // First run is "killed" after a few requests: the sink keeps what was written.
  const sink = new MemorySink();
  const finished = new Set<number>();
  const ctrl = new AbortController();
  await assert.rejects(
    executeExtract(new BytesSource(src), plan, sink, {
      signal: ctrl.signal,
      concurrency: 1,
      onRequestDone: (i) => {
        finished.add(i);
        if (finished.size === 4) ctrl.abort();
      },
    }),
    AbortError,
  );
  assert.equal(finished.size, 4);

  // Second run: only the rest is requested, progress starts where it was.
  const again = new BytesSource(src);
  const progress: number[] = [];
  await executeExtract(again, plan, sink, { done: finished, onProgress: (p) => progress.push(p.bytes) });
  const skipped = plan.requests.filter((_, i) => finished.has(i)).reduce((n, r) => n + r.length, 0);
  assert.equal(again.requests.length, plan.requests.length - 4);
  assert.equal(progress[0], skipped);
  assert.equal(progress.at(-1), plan.downloadBytes);
  await assertValidExtract(src, sink.bytes(), bbox, 0, 7);
});
