/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as ref from 'pmtiles';

import { bboxTileBounds, bboxTileRanges, countBBoxTiles, rangesTileCount, tileIdToZxy, zoomBase, zxyToTileId, type BBox } from './tileid.ts';

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('known tile ids from the PMTiles spec', () => {
  assert.equal(zxyToTileId(0, 0, 0), 0);
  assert.equal(zxyToTileId(1, 0, 0), 1);
  assert.equal(zxyToTileId(1, 0, 1), 2);
  assert.equal(zxyToTileId(1, 1, 1), 3);
  assert.equal(zxyToTileId(1, 1, 0), 4);
  assert.equal(zxyToTileId(2, 0, 0), 5);
  assert.equal(zxyToTileId(3, 0, 0), 21);
  assert.equal(zxyToTileId(20, 0, 0), 366503875925);
  assert.equal(zxyToTileId(21, 0, 0), 1466015503701);
  assert.equal(zxyToTileId(26, 0, 0), 1501199875790165);
  assert.deepEqual(tileIdToZxy(19078479), [12, 3423, 1763]);
});

test('matches the reference implementation and round-trips up to z26', () => {
  const r = rng(42);
  for (let i = 0; i < 5000; i++) {
    const z = Math.floor(r() * 27);
    const n = Math.pow(2, z);
    const x = Math.floor(r() * n);
    const y = Math.floor(r() * n);
    const id = zxyToTileId(z, x, y);
    assert.equal(id, ref.zxyToTileId(z, x, y), `${z}/${x}/${y}`);
    assert.deepEqual(tileIdToZxy(id), [z, x, y]);
  }
  // Exhaustive at low zooms: ids are a bijection onto [base(z), base(z+1)).
  for (let z = 0; z <= 6; z++) {
    const seen = new Set<number>();
    const n = 1 << z;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < n; y++) {
        const id = zxyToTileId(z, x, y);
        assert.ok(id >= zoomBase(z) && id < zoomBase(z + 1));
        seen.add(id);
      }
    assert.equal(seen.size, n * n);
  }
});

test('rejects invalid input', () => {
  assert.throws(() => zxyToTileId(27, 0, 0));
  assert.throws(() => zxyToTileId(2, 4, 0));
  assert.throws(() => tileIdToZxy(-1));
});

test('descendants of a tile occupy one contiguous id range', () => {
  const r = rng(7);
  for (let i = 0; i < 200; i++) {
    const z = Math.floor(r() * 8);
    const n = 1 << z;
    const x = Math.floor(r() * n);
    const y = Math.floor(r() * n);
    const d = zxyToTileId(z, x, y) - zoomBase(z);
    for (let k = 1; k <= 3; k++) {
      const size = Math.pow(4, k);
      const lo = zoomBase(z + k) + d * size;
      const span = 1 << k;
      for (let cx = 0; cx < span; cx++)
        for (let cy = 0; cy < span; cy++) {
          const id = zxyToTileId(z + k, x * span + cx, y * span + cy);
          assert.ok(id >= lo && id < lo + size);
        }
    }
  }
});

test('bboxTileRanges covers exactly the tiles of the bbox', () => {
  const r = rng(99);
  const boxes: BBox[] = [
    [-3.75, 40.38, -3.65, 40.46], // central Madrid
    [-180, -85, 180, 85],
    [170, -50, 179.9, -30],
    [-0.01, -0.01, 0.01, 0.01],
  ];
  for (let i = 0; i < 20; i++) {
    const w = r() * 340 - 170;
    const s = r() * 150 - 75;
    boxes.push([w, s, w + r() * 20, s + r() * 10]);
  }
  for (const bbox of boxes) {
    const ranges = bboxTileRanges(bbox, 0, 8);
    for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1], 'sorted and merged');
    const expected = new Set<number>();
    for (let z = 0; z <= 8; z++) {
      const b = bboxTileBounds(bbox, z);
      for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) expected.add(zxyToTileId(z, x, y));
    }
    assert.equal(rangesTileCount(ranges), expected.size);
    assert.equal(countBBoxTiles(bbox, 0, 8), expected.size);
    for (const [a, b] of ranges) for (let id = a; id < b; id++) assert.ok(expected.has(id));
  }
});

test('range count stays small for a large area at high zoom', () => {
  const spain: BBox = [-9.4, 35.9, 3.4, 43.8];
  const ranges = bboxTileRanges(spain, 0, 15);
  assert.ok(rangesTileCount(ranges) > 500_000);
  assert.ok(ranges.length < 20_000, `${ranges.length} ranges`);
});
