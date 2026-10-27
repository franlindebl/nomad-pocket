import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canStartFile, connectionsFor, decide, HOLD_MS, hostHasRoom, initialBudget, yieldsToCdn } from './budget-core.ts';

test('hostHasRoom: two files at a time from one host; Kiwix archives spread over mirrors', () => {
  // Spain's map, pack and search files all come from github.com.
  assert.equal(hostHasRoom({ sameHost: 1, multiMirror: false }), true);
  assert.equal(hostHasRoom({ sameHost: 2, multiMirror: false }), false);
  assert.equal(hostHasRoom({ sameHost: 5, multiMirror: true }), true);
});

const MB = 1e6;

test('the budget climbs while more connections bring more speed', () => {
  let b = initialBudget('wifi');
  assert.equal(b.conns, 16);
  // Kiwix mirrors at ~3 MB/s per connection, a 66 MB/s line (the owner's iPhone): it climbs to the top.
  const speed = (conns: number) => Math.min(66 * MB, conns * 3 * MB);
  let now = 0;
  for (let i = 0; i < 12; i++) {
    now += 10_000;
    b = decide(b, { now, bps: speed(b.conns), saturated: true });
  }
  assert.equal(b.conns, 32);
});

test('past 14 connections a trial is kept although it adds less than 15 % (it used to be impossible)', () => {
  let b = { ...initialBudget('wifi'), conns: 14 };
  b = decide(b, { now: 10_000, bps: 28 * MB, saturated: true });
  assert.equal(b.conns, 18);
  b = decide(b, { now: 20_000, bps: 29 * MB, saturated: true });
  assert.equal(b.conns, 18);
  assert.equal(b.trial, null, 'kept');
});

test('a trial that makes things slower is given back, and the budget waits before trying again', () => {
  let b = initialBudget('wifi');
  b = decide(b, { now: 10_000, bps: 30 * MB, saturated: true });
  assert.equal(b.conns, 20);
  assert.ok(b.trial);
  b = decide(b, { now: 20_000, bps: 24 * MB, saturated: true });
  assert.equal(b.conns, 16);
  assert.equal(b.trial, null);
  assert.equal(decide(b, { now: 30_000, bps: 30 * MB, saturated: true }).conns, 16, 'held');
  assert.equal(decide(b, { now: 20_000 + HOLD_MS, bps: 30 * MB, saturated: true }).conns, 20, 'tries again later');
});

test('a window where downloads started or finished decides nothing, and a trial waits for the next', () => {
  let b = initialBudget('wifi');
  b = decide(b, { now: 10_000, bps: 30 * MB, saturated: true });
  assert.equal(b.conns, 20);
  // A file finished: hashing and the next one's probe dip the speed. Not the trial's fault.
  b = decide(b, { now: 20_000, bps: 12 * MB, saturated: true, stable: false });
  assert.equal(b.conns, 20);
  assert.ok(b.trial);
  b = decide(b, { now: 30_000, bps: 36 * MB, saturated: true });
  assert.equal(b.conns, 20);
  assert.equal(b.trial, null, 'kept');
  // Nor does an unstable window start a trial from a dipped speed.
  assert.equal(decide(b, { now: 40_000, bps: 12 * MB, saturated: true, stable: false }).conns, 20);
});

test('no trial while the downloads leave connections unused, or with nothing moving', () => {
  const b = initialBudget('wifi');
  assert.equal(decide(b, { now: 10_000, bps: 20 * MB, saturated: false }).conns, 16);
  assert.equal(decide(b, { now: 10_000, bps: 0, saturated: true }).conns, 16);
});

test('bounds: 32 on Wi-Fi, 6 on mobile data, never below the minimum', () => {
  let b = initialBudget('wifi');
  for (let i = 1; i < 40; i++) b = decide({ ...b, trial: null }, { now: i * 10_000, bps: i * MB, saturated: true });
  assert.equal(b.conns, 32);
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

test('canStartFile: up to 6 files on Wi-Fi (2 on mobile data), at most 2 choosing their sources', () => {
  // Seen on a phone: a country map (GitHub) and one archive filled the 8 connections, so with
  // "start only on spare connections" a kit of small archives waited 2 at a time.
  assert.equal(canStartFile({ network: 'wifi', running: 2, planning: 0 }), true);
  assert.equal(canStartFile({ network: 'wifi', running: 5, planning: 1 }), true);
  assert.equal(canStartFile({ network: 'wifi', running: 3, planning: 2 }), false, 'two still probing their mirrors');
  assert.equal(canStartFile({ network: 'wifi', running: 6, planning: 0 }), false);
  assert.equal(canStartFile({ network: 'cellular', running: 1, planning: 0 }), true);
  assert.equal(canStartFile({ network: 'cellular', running: 2, planning: 0 }), false);
});

test('yieldsToCdn: a big Kiwix archive waits for the GitHub / Hugging Face files; small ones and CDN files never do', () => {
  assert.equal(yieldsToCdn({ kiwix: true, bytes: 13.3e9, cdnBytesLeft: 4.6e9 }), true, 'Wikipedia waits for the map');
  assert.equal(yieldsToCdn({ kiwix: true, bytes: 13.3e9, cdnBytesLeft: 0 }), false);
  assert.equal(yieldsToCdn({ kiwix: true, bytes: 13.3e9, cdnBytesLeft: 240e6 }), false, 'only the search files are left');
  assert.equal(yieldsToCdn({ kiwix: true, bytes: 171e6, cdnBytesLeft: 4.6e9 }), false, 'a survival guide runs alongside');
  assert.equal(yieldsToCdn({ kiwix: false, bytes: 2e9, cdnBytesLeft: 4.6e9 }), false);
});
