import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SPEED_WATCH, watchSpeed, type SpeedWatch } from './speed-core.ts';

/** Feeds [ms, speed, limit] fixes; returns when each one warned. */
function run(fixes: [number, number, number | null][]): number[] {
  let w: SpeedWatch = SPEED_WATCH;
  const warned: number[] = [];
  for (const [t, speed, limit] of fixes) {
    const r = watchSpeed(w, speed, limit, t);
    w = r.watch;
    if (r.warn) warned.push(t);
  }
  return warned;
}

test('watchSpeed: warns once after 2 s over the limit, not at every fix', () => {
  assert.deepEqual(
    run([
      [0, 48, 50],
      [1000, 53, 50],
      [2000, 54, 50],
      [3000, 55, 50],
      [4000, 56, 50],
      [5000, 57, 50],
    ]),
    [3000],
  );
});

test('watchSpeed: a fix or two over is noise', () => {
  assert.deepEqual(
    run([
      [0, 51, 50],
      [1000, 51, 50],
      [2000, 49, 50],
      [3000, 51, 50],
      [4000, 50, 50],
    ]),
    [],
  );
});

test('watchSpeed: warns again only after 5 s back under, or when a lower limit starts', () => {
  const hovering: [number, number, number][] = [];
  for (let t = 0; t <= 20_000; t += 1000) hovering.push([t, t % 4000 < 3000 ? 55 : 48, 50]);
  assert.deepEqual(run(hovering), [2000]);
  assert.deepEqual(
    run([
      [0, 60, 50],
      [2000, 60, 50],
      [3000, 45, 50],
      [9000, 45, 50],
      [10_000, 60, 50],
      [12_000, 60, 50],
    ]),
    [2000, 12_000],
  );
  // Over 90, then a 50 stretch at 80: warns again as it starts (over for more than 2 s already).
  assert.deepEqual(
    run([
      [0, 95, 90],
      [2000, 95, 90],
      [3000, 80, 50],
      [4000, 80, 50],
    ]),
    [2000, 3000],
  );
});

test('watchSpeed: no limit, never over', () => {
  assert.deepEqual(watchSpeed(SPEED_WATCH, 200, null, 0).over, false);
  assert.deepEqual(run([[0, 200, null], [5000, 200, null]]), []);
});
