import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canStartFile, connectionsFor, decide, HOLD_MS, initialBudget, MIN_FILES } from './budget-core.ts';

const MB = 1e6;

test('the budget climbs while more connections bring more speed', () => {
  let b = initialBudget('wifi');
  assert.equal(b.conns, 8);
  // Mirrors at ~4 MB/s per connection, a 37 MB/s line: each step pays until the line is full.
  const speed = (conns: number) => Math.min(37 * MB, conns * 4 * MB);
  let now = 0;
  for (let i = 0; i < 9; i++) {
    now += 10_000;
    b = decide(b, { now, bps: speed(b.conns), saturated: true });
  }
  // 8 → 10 paid (32 → 37 MB/s); 12 brought nothing and was given back.
  assert.equal(b.conns, 10);
});

test('a trial that brings nothing is given back, and the budget waits before trying again', () => {
  let b = initialBudget('wifi');
  b = decide(b, { now: 10_000, bps: 30 * MB, saturated: true });
  assert.equal(b.conns, 10);
  assert.ok(b.trial);
  b = decide(b, { now: 20_000, bps: 30.5 * MB, saturated: true });
  assert.equal(b.conns, 8);
  assert.equal(b.trial, null);
  assert.equal(decide(b, { now: 30_000, bps: 30 * MB, saturated: true }).conns, 8, 'held');
  assert.equal(decide(b, { now: 20_000 + HOLD_MS, bps: 30 * MB, saturated: true }).conns, 10, 'tries again later');
});

test('a window where downloads started or finished decides nothing, and a trial waits for the next', () => {
  let b = initialBudget('wifi');
  b = decide(b, { now: 10_000, bps: 30 * MB, saturated: true });
  assert.equal(b.conns, 10);
  // A file finished: hashing and the next one's probe dip the speed. Not the trial's fault.
  b = decide(b, { now: 20_000, bps: 12 * MB, saturated: true, stable: false });
  assert.equal(b.conns, 10);
  assert.ok(b.trial);
  b = decide(b, { now: 30_000, bps: 36 * MB, saturated: true });
  assert.equal(b.conns, 10);
  assert.equal(b.trial, null, 'kept');
  // Nor does an unstable window start a trial from a dipped speed.
  assert.equal(decide(b, { now: 40_000, bps: 12 * MB, saturated: true, stable: false }).conns, 10);
});

test('no trial while the downloads leave connections unused, or with nothing moving', () => {
  const b = initialBudget('wifi');
  assert.equal(decide(b, { now: 10_000, bps: 20 * MB, saturated: false }).conns, 8);
  assert.equal(decide(b, { now: 10_000, bps: 0, saturated: true }).conns, 8);
});

test('bounds: 16 on Wi-Fi, 6 on mobile data, never below the minimum', () => {
  let b = initialBudget('wifi');
  for (let i = 1; i < 40; i++) b = decide({ ...b, trial: null }, { now: i * 10_000, bps: i * MB, saturated: true });
  assert.equal(b.conns, 16);
  let c = initialBudget('cellular');
  assert.equal(c.conns, 4);
  for (let i = 1; i < 10; i++) c = decide({ ...c, trial: null }, { now: i * 10_000, bps: i * MB, saturated: true });
  assert.equal(c.conns, 6);
  const low = decide({ ...initialBudget('cellular'), conns: 2, trial: { before: 10 * MB } }, { now: 1, bps: 1 * MB, saturated: true });
  assert.equal(low.conns, 2);
});

test('connectionsFor: a download takes what the others leave, its fair part when they want more', () => {
  // Alone: the whole budget.
  assert.equal(connectionsFor({ budget: 12, othersInFlight: 0, segmented: 1, singles: 0, othersHungry: false }), 12);
  // A GitHub part capped at 4 leaves 8 to a Kiwix archive.
  assert.equal(connectionsFor({ budget: 12, othersInFlight: 4, segmented: 2, singles: 0, othersHungry: false }), 8);
  // Both want more: half each, even if the first one holds more right now.
  assert.equal(connectionsFor({ budget: 12, othersInFlight: 10, segmented: 2, singles: 0, othersHungry: true }), 2);
  assert.equal(connectionsFor({ budget: 12, othersInFlight: 2, segmented: 2, singles: 0, othersHungry: true }), 6);
  // Small files on one connection each come off the top; never below one.
  assert.equal(connectionsFor({ budget: 8, othersInFlight: 2, segmented: 1, singles: 2, othersHungry: false }), 6);
  assert.equal(connectionsFor({ budget: 8, othersInFlight: 9, segmented: 2, singles: 0, othersHungry: true }), 1);
});

test('canStartFile: two files always; more only while connections sit unused', () => {
  assert.equal(canStartFile({ network: 'wifi', running: MIN_FILES - 1, planning: 1, spare: 0 }), true);
  assert.equal(canStartFile({ network: 'wifi', running: 2, planning: 0, spare: 0 }), false);
  assert.equal(canStartFile({ network: 'wifi', running: 2, planning: 0, spare: 4 }), true);
  assert.equal(canStartFile({ network: 'wifi', running: 2, planning: 1, spare: 4 }), false, 'one still probing its mirrors');
  assert.equal(canStartFile({ network: 'wifi', running: 6, planning: 0, spare: 10 }), false);
  assert.equal(canStartFile({ network: 'cellular', running: 2, planning: 0, spare: 4 }), false);
});
