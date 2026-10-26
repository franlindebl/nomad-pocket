import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileName, itemFileState, itemsToDrop, plausibleSize, restoresItself } from './reconcile-core.ts';

test('plausibleSize: empty or truncated files are not', () => {
  assert.equal(plausibleSize(1000, 1000), true);
  assert.equal(plausibleSize(1000, 2000), true);
  assert.equal(plausibleSize(1000, 999), false);
  assert.equal(plausibleSize(1000, 0), false);
  // Size unknown at install time: any non-empty file will do.
  assert.equal(plausibleSize(0, 5), true);
  assert.equal(plausibleSize(0, 0), false);
});

test('itemFileState: present at the stored path or by name', () => {
  const there = { exists: true, size: 100 };
  const gone = { exists: false, size: 0 };
  assert.equal(itemFileState(100, [there]), 'ok');
  // Stale absolute path (iOS moved the container), file found by name.
  assert.equal(itemFileState(100, [gone, there]), 'ok');
  assert.equal(itemFileState(100, [gone, gone]), 'missing');
  assert.equal(itemFileState(100, [{ exists: true, size: 10 }]), 'damaged');
  assert.equal(itemFileState(100, [{ exists: true, size: 10 }, there]), 'ok');
});

test('itemFileState: a failed probe is never "missing"', () => {
  assert.equal(itemFileState(100, [null]), 'unknown');
  assert.equal(itemFileState(100, [{ exists: false, size: 0 }, null]), 'unknown');
  assert.equal(itemFileState(100, [null, { exists: true, size: 100 }]), 'ok');
  assert.equal(itemFileState(100, []), 'unknown');
});

test('restoresItself: only the bundled world map', () => {
  assert.equal(restoresItself({ kind: 'map', fileUri: 'x/world.pmtiles', meta: { role: 'world' } }), true);
  assert.equal(restoresItself({ kind: 'map', fileUri: 'x/es.pmtiles', meta: { role: 'region' } }), false);
  assert.equal(restoresItself({ kind: 'zim', fileUri: 'x/a.zim', meta: { role: 'world' } }), false);
});

test('fileName decodes the last path segment', () => {
  assert.equal(fileName('file:///var/mobile/Containers/Data/A/Documents/content/zim/caf%C3%A9_2026-09.zim'), 'café_2026-09.zim');
  assert.equal(fileName('file:///x/content/maps/es.pmtiles'), 'es.pmtiles');
  assert.equal(fileName('bad%E0%A4%A'), 'bad%E0%A4%A');
});

test('itemsToDrop: after a restore every item but the world map goes', () => {
  const items = [
    { id: 'wikipedia_es_top_mini', kind: 'zim', fileUri: 'a.zim', meta: {} },
    { id: 'map-world', kind: 'map', fileUri: 'world.pmtiles', meta: { role: 'world' } },
    { id: 'map-es', kind: 'map', fileUri: 'es.pmtiles', meta: { role: 'region' } },
    { id: 'route-es', kind: 'route', fileUri: 'es.tar', meta: {} },
    { id: 'qwen', kind: 'model', fileUri: 'q.gguf', meta: {} },
    { id: 'kept', kind: 'zim', fileUri: 'k.zim', meta: {} },
    { id: 'damaged', kind: 'zim', fileUri: 'd.zim', meta: {} },
    { id: 'unknown', kind: 'zim', fileUri: 'u.zim', meta: {} },
  ];
  const states: Record<string, 'ok' | 'missing' | 'damaged' | 'unknown'> = { kept: 'ok', damaged: 'damaged', unknown: 'unknown' };
  assert.deepEqual(
    itemsToDrop(items, (i) => states[i.id] ?? 'missing'),
    ['wikipedia_es_top_mini', 'map-es', 'route-es', 'qwen'],
  );
});
