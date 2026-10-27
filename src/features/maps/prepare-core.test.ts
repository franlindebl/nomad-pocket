/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { beginTask, endTask, preparedFraction, updateTask, type Preparing } from './prepare-core.ts';

test('progress is weighted by size and an item stays until all its tasks are done', () => {
  let s: Preparing = {};
  s = beginTask(s, 'map-es', 'tiles', 100);
  s = beginTask(s, 'route-es', 'side:places', 300);
  assert.equal(preparedFraction(s, ['map-es', 'route-es']), 0);
  s = endTask(s, 'map-es', 'tiles');
  assert.equal(s['map-es'], undefined);
  assert.equal(preparedFraction(s, ['map-es', 'route-es']), 0);
  s = beginTask(s, 'route-es', 'side:streets', 100);
  s = updateTask(s, 'route-es', 'side:places', 0.5);
  assert.equal(preparedFraction(s, ['route-es']), 150 / 400);
  s = endTask(s, 'route-es', 'side:places');
  assert.equal(preparedFraction(s, ['route-es']), 300 / 400);
  s = endTask(s, 'route-es', 'side:streets');
  assert.deepEqual(s, {});
  assert.equal(preparedFraction(s, ['route-es']), null);
});

test('small moves and unknown tasks leave the state as it was', () => {
  const s = beginTask({}, 'a', 'k', 10);
  const moved = updateTask(s, 'a', 'k', 0.005);
  assert.equal(moved, s);
  assert.equal(updateTask(s, 'b', 'k', 0.5), s);
  assert.equal(endTask(s, 'a', 'other'), s);
  assert.notEqual(updateTask(s, 'a', 'k', 0.02), s);
});
