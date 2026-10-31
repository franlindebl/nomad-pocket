import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byPriority, checkDue, fitsAfterFreeing, isNewerEdition, isUrgent, monthsOld, parseDataDate, runStep, type RunEntry } from './updates-core.ts';

const NOW = new Date(2026, 9, 31).getTime();
const DAY = 24 * 3600_000;

test('data dates: Kiwix months, map build dates, and junk', () => {
  assert.equal(parseDataDate('2026-10'), new Date(2026, 9, 1).getTime());
  assert.equal(parseDataDate('2026-10-05'), new Date(2026, 9, 5).getTime());
  assert.equal(parseDataDate('20261005'), new Date(2026, 9, 5).getTime());
  assert.equal(parseDataDate('2026-13'), null);
  assert.equal(parseDataDate('v5'), null);
  assert.equal(parseDataDate(null), null);
});

test('months old: unknown is never old', () => {
  assert.equal(monthsOld(null, NOW), 0);
  assert.ok(monthsOld('2026-07', NOW) > 3);
  assert.ok(monthsOld('2026-09', NOW) < 2);
  assert.ok(monthsOld('20240801', NOW) > 26);
});

test('newer edition compares dates of the same format', () => {
  assert.ok(isNewerEdition('2026-10', '2026-09'));
  assert.ok(!isNewerEdition('2026-09', '2026-09'));
  assert.ok(!isNewerEdition(null, '2026-09'));
  assert.ok(isNewerEdition('20261105', '20261005'));
  assert.ok(isNewerEdition('2026-10', null));
});

test('urgent: three months of age, or broken whatever the age', () => {
  assert.ok(!isUrgent({ installed: '2026-09' }, NOW));
  assert.ok(isUrgent({ installed: '2026-07' }, NOW));
  assert.ok(isUrgent({ installed: '20261005', broken: true }, NOW));
  assert.ok(!isUrgent({ installed: null }, NOW));
});

test('check due once a week, and when the clock went back', () => {
  assert.ok(checkDue(null, NOW));
  assert.ok(!checkDue(NOW - 2 * DAY, NOW));
  assert.ok(checkDue(NOW - 8 * DAY, NOW));
  assert.ok(checkDue(NOW + DAY, NOW));
});

test('priority: urgent first, then smallest', () => {
  const list = [
    { key: 'big', urgent: false, bytes: 5 },
    { key: 'urgentBig', urgent: true, bytes: 9 },
    { key: 'small', urgent: false, bytes: 1 },
    { key: 'urgentSmall', urgent: true, bytes: 2 },
  ];
  assert.deepEqual(
    [...list].sort(byPriority).map((x) => x.key),
    ['urgentSmall', 'urgentBig', 'small', 'big'],
  );
});

test('fits after freeing the old copy', () => {
  assert.ok(fitsAfterFreeing(3, 2, 1.5, 0.5));
  assert.ok(!fitsAfterFreeing(3, 1, 1.5, 0.5));
});

const entry = (key: string, needed: number, o: Partial<RunEntry> = {}): RunEntry => ({ key, outdated: true, inFlight: false, failed: false, needed, ...o });

test('run step: starts what fits, in order, and waits for the rest while something runs', () => {
  const entries = { a: entry('a', 3), b: entry('b', 5), c: entry('c', 1) };
  const step = runStep(['a', 'b', 'c'], entries, new Set(), 4);
  assert.deepEqual(step.start, ['a', 'c']);
  assert.deepEqual(step.blocked, []);
  assert.deepEqual(step.drop, []);
});

test('run step: what never fits with nothing running is blocked', () => {
  const entries = { a: entry('a', 3), b: entry('b', 9) };
  assert.deepEqual(runStep(['a', 'b'], entries, new Set(), 2), { start: [], drop: [], blocked: ['a', 'b'] });
});

test('run step: one in flight keeps the others waiting, not blocked', () => {
  const entries = { a: entry('a', 3, { inFlight: true }), b: entry('b', 9) };
  assert.deepEqual(runStep(['a', 'b'], entries, new Set(['a']), 1), { start: [], drop: [], blocked: [] });
});

test('run step: done, gone, and failed updates leave the run', () => {
  const entries = {
    done: entry('done', 1, { outdated: false }),
    failed: entry('failed', 1, { failed: true }),
    startedThenStopped: entry('startedThenStopped', 1),
    next: entry('next', 1),
  };
  const step = runStep(['done', 'gone', 'failed', 'startedThenStopped', 'next'], entries, new Set(['startedThenStopped']), 10);
  assert.deepEqual(step.drop, ['done', 'gone', 'failed', 'startedThenStopped']);
  assert.deepEqual(step.start, ['next']);
});
