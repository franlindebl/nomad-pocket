/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { beginTask, endTask, preparedFraction, updateTask, weighTask, type Preparing } from './prepare-core.ts';

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

test('an import queued before its file landed counts with the file once weighed', () => {
  // Spain: the pack is installed while places and addresses are still downloading (weight 1 each).
  let s: Preparing = {};
  s = beginTask(s, 'map', 'tiles', 35e6);
  s = beginTask(s, 'pack', 'side:streets', 78e6);
  s = beginTask(s, 'pack', 'side:places', 0);
  s = beginTask(s, 'pack', 'side:addresses', 0);
  s = endTask(s, 'map', 'tiles');
  s = endTask(s, 'pack', 'side:streets');
  // Unweighed, the two imports still to run were a rounding error: "99 %" for minutes.
  assert.equal(Math.floor(preparedFraction(s, ['map', 'pack'])! * 100), 99);
  s = weighTask(s, 'pack', 'side:places', 56e6);
  s = weighTask(s, 'pack', 'side:addresses', 100e6);
  // The map's index is done and gone: streets out of streets + places + addresses.
  assert.equal(Math.floor(preparedFraction(s, ['map', 'pack'])! * 100), 33);
  // Same weight or an unknown task: same object.
  assert.equal(weighTask(s, 'pack', 'side:places', 56e6), s);
  assert.equal(weighTask(s, 'pack', 'side:nope', 1), s);
});
