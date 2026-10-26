import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupDownloads, recordGroup, type GroupableRecord } from './groups.ts';

const es = { id: 'country-es', title: 'Mapa de España' };
const rec = (id: string, over: Partial<GroupableRecord> = {}): GroupableRecord => ({
  id,
  title: 'España',
  status: 'queued',
  bytesWritten: 0,
  totalBytes: 100,
  error: null,
  meta: {},
  createdAt: 0,
  ...over,
});

test('a country is one row with the bytes of all its files', () => {
  const rows = groupDownloads([
    rec('wiki', { title: 'Wikipedia', createdAt: 5 }),
    rec('map-p0', { meta: { group: es }, status: 'running', bytesWritten: 60, speed: 10, createdAt: 1 }),
    rec('route-p0', { meta: { group: es }, status: 'running', bytesWritten: 20, speed: 5, createdAt: 2 }),
    rec('pois', { meta: { group: es }, status: 'done', bytesWritten: 100, createdAt: 3 }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['country-es', 'wiki'],
  );
  const [country] = rows;
  assert.equal(country.title, 'Mapa de España');
  assert.equal(country.status, 'running');
  assert.equal(country.bytesWritten, 180);
  assert.equal(country.totalBytes, 300);
  assert.equal(country.speed, 15);
  assert.equal(country.records.length, 3);
});

test('a failed file shows on the group while the others go on', () => {
  const [row] = groupDownloads([
    rec('a', { meta: { group: es }, status: 'running' }),
    rec('b', { meta: { group: es }, status: 'failed', error: 'HTTP 503' }),
  ]);
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'HTTP 503');
});

test('a group is paused only when nothing in it runs or waits', () => {
  const paused = groupDownloads([rec('a', { meta: { group: es }, status: 'paused' }), rec('b', { meta: { group: es }, status: 'done' })]);
  assert.equal(paused[0].status, 'paused');
  const queued = groupDownloads([rec('a', { meta: { group: es }, status: 'paused' }), rec('b', { meta: { group: es }, status: 'queued' })]);
  assert.equal(queued[0].status, 'queued');
});

test('records without a group (or a malformed one) stay as they are', () => {
  assert.equal(recordGroup({ meta: { group: { id: 'x' } } }), null);
  const rows = groupDownloads([rec('a'), rec('b', { meta: { group: 'country-es' } })]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.title]),
    [
      ['a', 'España'],
      ['b', 'España'],
    ],
  );
});
