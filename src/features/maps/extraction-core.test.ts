import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeDone,
  doneBytes,
  encodeDone,
  fingerprintOf,
  parseSaved,
  requiredPartSize,
  sameJob,
  usableDone,
  type SavedExtraction,
} from './extraction-core.ts';

const plan = {
  archiveBytes: 1000,
  downloadBytes: 300,
  header: { tileDataOffset: 100 },
  prefix: { length: 100 },
  requests: [
    { length: 100, copies: [0, 0, 100] },
    { length: 100, copies: [0, 100, 60, 70, 160, 30] },
    { length: 100, copies: [0, 200, 100] },
  ],
};

const saved = (over: Partial<SavedExtraction> = {}): SavedExtraction => ({
  v: 1,
  key: 'sm',
  title: 'San Marino',
  bbox: [12.4, 43.8, 12.5, 43.99],
  minZoom: 0,
  maxZoom: 15,
  regionId: 'sm',
  bundledPoints: false,
  build: { url: 'https://b/1.pmtiles', date: '20261028' },
  fingerprint: fingerprintOf(plan),
  done: '0-1',
  ...over,
});

test('done sets round-trip as runs', () => {
  assert.equal(encodeDone(new Set([5, 0, 1, 2, 9, 10])), '0-2,5,9-10');
  assert.equal(encodeDone(new Set()), '');
  assert.deepEqual(
    [...decodeDone('0-2,5,9-10', 100)].sort((a, b) => a - b),
    [0, 1, 2, 5, 9, 10],
  );
});

test('decodeDone drops garbage and out-of-range indices', () => {
  assert.deepEqual([...decodeDone('x,3-,2-4,,7', 4)], [2, 3]);
  assert.equal(decodeDone('0-999999999', 3).size, 3);
});

test('doneBytes and requiredPartSize follow the finished requests', () => {
  assert.equal(doneBytes(plan, new Set([0, 2])), 200);
  assert.equal(requiredPartSize(plan, new Set()), 100);
  assert.equal(requiredPartSize(plan, new Set([0])), 200);
  assert.equal(requiredPartSize(plan, new Set([1])), 100 + 160 + 30);
  assert.equal(requiredPartSize(plan, new Set([0, 1, 2])), 400);
});

test('usableDone trusts progress only for the same build, plan and a complete part file', () => {
  assert.deepEqual([...usableDone(saved(), 'https://b/1.pmtiles', plan, 1000)], [0, 1]);
  assert.equal(usableDone(null, 'https://b/1.pmtiles', plan, 1000).size, 0);
  assert.equal(usableDone(saved(), 'https://b/2.pmtiles', plan, 1000).size, 0, 'another build');
  assert.equal(usableDone(saved(), 'https://b/1.pmtiles', plan, null).size, 0, 'no part file');
  assert.equal(usableDone(saved(), 'https://b/1.pmtiles', plan, 250).size, 0, 'truncated part file');
  assert.equal(
    usableDone(saved({ fingerprint: { ...fingerprintOf(plan), requests: 4 } }), 'https://b/1.pmtiles', plan, 1000).size,
    0,
    'another plan',
  );
  assert.equal(usableDone(saved({ fingerprint: null }), 'https://b/1.pmtiles', plan, 1000).size, 0);
});

test('sameJob compares inputs only', () => {
  assert.ok(sameJob(saved(), { key: 'sm', bbox: [12.4, 43.8, 12.5, 43.99], minZoom: 0, maxZoom: 15 }));
  assert.ok(!sameJob(saved(), { key: 'sm', bbox: [12.4, 43.8, 12.5, 44], minZoom: 0, maxZoom: 15 }));
  assert.ok(!sameJob(saved(), { key: 'sm', bbox: [12.4, 43.8, 12.5, 43.99], minZoom: 0, maxZoom: 14 }));
});

test('parseSaved tolerates corrupt storage', () => {
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved('{'), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
  assert.equal(parseSaved(JSON.stringify([saved(), { v: 2 }, null])).length, 1);
});
