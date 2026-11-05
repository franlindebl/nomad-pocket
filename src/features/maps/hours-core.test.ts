import assert from 'node:assert/strict';
import test from 'node:test';

import { openState, parseHours } from './hours-core.ts';

// Local times: 2026-11-04 is a Wednesday, 2026-11-07 a Saturday, 2026-11-08 a Sunday.
const at = (iso: string) => new Date(iso);

test('common opening_hours forms', () => {
  assert.equal(openState('24/7', at('2026-11-08T03:00')), 'open');
  assert.equal(openState('Mo-Fr 09:00-14:00,17:00-20:00', at('2026-11-04T10:00')), 'open');
  assert.equal(openState('Mo-Fr 09:00-14:00,17:00-20:00', at('2026-11-04T15:00')), 'closed');
  assert.equal(openState('Mo-Fr 09:00-14:00,17:00-20:00', at('2026-11-07T10:00')), 'closed');
  assert.equal(openState('Mo-Sa 09:30-21:30; Su off', at('2026-11-08T12:00')), 'closed');
  assert.equal(openState('Mo-Sa 09:30-21:30; Su off', at('2026-11-07T21:29')), 'open');
  assert.equal(openState('Mo-Sa 09:30-21:30; Su off', at('2026-11-07T21:30')), 'closed');
  assert.equal(openState('Mo-Su 07:00-19:00', at('2026-11-08T07:00')), 'open');
  assert.equal(openState('09:00-21:00', at('2026-11-08T20:59')), 'open');
});

test('later rules override earlier ones; overnight spans run into the next day', () => {
  assert.equal(openState('Mo-Su 08:00-22:00; We 10:00-14:00', at('2026-11-04T09:00')), 'closed');
  assert.equal(openState('Mo-Su 08:00-22:00; We 10:00-14:00', at('2026-11-04T11:00')), 'open');
  assert.equal(openState('Fr-Sa 22:00-04:00', at('2026-11-08T02:00')), 'open');
  assert.equal(openState('Fr-Sa 22:00-04:00', at('2026-11-08T05:00')), 'closed');
  assert.equal(openState('Mo-Fr 09:00-24:00', at('2026-11-04T23:59')), 'open');
});

test('holidays are left aside; unknown forms are unknown, never open', () => {
  assert.equal(openState('Mo-Fr 09:00-20:00; PH off', at('2026-11-04T10:00')), 'open');
  assert.equal(openState('Mo-Fr,PH 09:00-20:00', at('2026-11-04T10:00')), 'open');
  assert.equal(openState('Jan-Mar Mo-Fr 09:00-14:00', at('2026-11-04T10:00')), null);
  assert.equal(openState('sunrise-sunset', at('2026-11-04T10:00')), null);
  assert.equal(openState('Mo-Fr 09:00+', at('2026-11-04T10:00')), null);
  assert.equal(openState('by appointment', at('2026-11-04T10:00')), null);
  assert.equal(openState('', at('2026-11-04T10:00')), null);
  assert.equal(openState(null, at('2026-11-04T10:00')), null);
  assert.equal(parseHours('Mo-Fr 25:00-26:00'), null);
});
