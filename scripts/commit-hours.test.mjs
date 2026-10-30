// Tests for the commit rules (dates in the Mon–Fri 22:00–02:00 window, no session links), in Madrid time.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowedAt, fixedDates, gitDate, hasSessionLink, intoWindow, stripSessionLinks } from './commit-hours.mjs';

process.env.TZ = 'Europe/Madrid';
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;
const hm = (epoch) => new Date(epoch * 1000).toTimeString().slice(0, 5);

test('the window: weekday nights and the whole weekend', () => {
  assert.equal(allowedAt(local(2026, 11, 2, 23), '+0100'), true); // Monday 23:00
  assert.equal(allowedAt(local(2026, 11, 3, 1, 59), '+0100'), true); // Tuesday 01:59
  assert.equal(allowedAt(local(2026, 11, 3, 2), '+0100'), false); // Tuesday 02:00
  assert.equal(allowedAt(local(2026, 11, 3, 21, 59), '+0100'), false);
  assert.equal(allowedAt(local(2026, 10, 31, 12), '+0100'), true); // Saturday noon
  assert.equal(allowedAt(local(2026, 11, 1, 16), '+0100'), true); // Sunday
  // The offset in the commit decides the wall clock, not the machine's zone.
  assert.equal(allowedAt(local(2026, 11, 3, 23), '-0500'), false); // 17:00 in New York
});

test('a weekday day squeezes into the night that follows', () => {
  assert.equal(hm(intoWindow(local(2026, 11, 2, 2))), '22:00');
  assert.equal(hm(intoWindow(local(2026, 11, 2, 10))), '23:20');
  assert.equal(hm(intoWindow(local(2026, 11, 2, 21, 59))), '01:19');
  assert.equal(new Date(intoWindow(local(2026, 11, 2, 21, 59)) * 1000).getDate(), 3);
  const fri = local(2026, 10, 30, 15);
  assert.equal(intoWindow(local(2026, 10, 31, 15)), local(2026, 10, 31, 15)); // Saturday stays
  assert.ok(intoWindow(fri) > fri);
});

test('fixedDates leaves compliant commits alone and keeps order after the parent', () => {
  const at = (e) => [e, gitDate(e).split(' ')[1]];
  assert.equal(fixedDates({ author: at(local(2026, 11, 2, 23)), committer: at(local(2026, 11, 2, 23)), parent: 0 }), null);
  const day = local(2026, 11, 2, 10);
  assert.deepEqual(fixedDates({ author: at(day), committer: at(day), parent: 0 }), { author: intoWindow(day), committer: intoWindow(day) });
  // An amend in the morning of a commit dated last night: the author date stays, the committer date moves.
  const night = local(2026, 11, 2, 23);
  const r = fixedDates({ author: at(night), committer: at(day), parent: night - 60 });
  assert.equal(r.author, night);
  assert.equal(r.committer, intoWindow(day));
  // A moved date never lands before the parent.
  const parent = intoWindow(local(2026, 11, 2, 21, 59));
  assert.equal(
    fixedDates({ author: at(local(2026, 11, 2, 21, 59)), committer: at(local(2026, 11, 2, 21, 59)), parent }).author,
    parent + 30,
  );
});

test('gitDate carries the zone offset of that day (DST)', () => {
  assert.match(gitDate(local(2026, 10, 24, 12)), / \+0200$/);
  assert.match(gitDate(local(2026, 10, 26, 12)), / \+0100$/);
});

test('session links are stripped from messages', () => {
  const msg = 'Maps: x\n\nWhy it changed.\n\nClaude-Session: https://claude.ai/code/session_01H5cXxgh5PripyJXButVTRh\n';
  assert.equal(hasSessionLink(msg), true);
  assert.equal(stripSessionLinks(msg), 'Maps: x\n\nWhy it changed.\n');
  assert.equal(hasSessionLink(stripSessionLinks(msg)), false);
  assert.equal(stripSessionLinks('Docs: y\n'), 'Docs: y\n');
});
