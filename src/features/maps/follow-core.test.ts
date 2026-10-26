import assert from 'node:assert/strict';
import { test } from 'node:test';

import { followBearing, followZoom, hasArrived, hasMoved, turnBetween } from './follow-core.ts';
import type { RouteProgress } from './routing-core.ts';

const onRoute: RouteProgress = { segment: 3, offRouteM: 5, remainingM: 900, next: 2, toNextM: 120, aheadBearing: 80 };

test('followBearing prefers the route, then the course, then the compass on foot', () => {
  const base = { costing: 'auto' as const, course: 200, heading: 10, progress: onRoute, accuracy: 8 };
  assert.equal(followBearing(base), 80);
  assert.equal(followBearing({ ...base, progress: { ...onRoute, offRouteM: 120 } }), 200, 'off the route: where the car goes');
  assert.equal(followBearing({ ...base, progress: null }), 200);
  assert.equal(followBearing({ ...base, progress: null, course: null }), null, 'a car: the compass means nothing');
  assert.equal(followBearing({ ...base, costing: 'pedestrian', progress: null, course: null }), 10);
  assert.equal(followBearing({ ...base, progress: { ...onRoute, aheadBearing: null } }), 200, 'at the end of the route');
});

test('followZoom zooms out with speed', () => {
  assert.equal(followZoom('auto', null), 17);
  assert.equal(followZoom('auto', 20), 16);
  assert.equal(followZoom('auto', 33), 15);
  assert.equal(followZoom('pedestrian', 33), 17.5);
});

test('turnBetween wraps around north', () => {
  assert.equal(turnBetween(350, 10), 20);
  assert.equal(turnBetween(10, 350), 20);
  assert.equal(turnBetween(0, 180), 180);
});

test('hasArrived: 20 m, widened by a poor fix up to 50 m', () => {
  assert.equal(hasArrived(15, 5), true);
  assert.equal(hasArrived(25, 5), false);
  assert.equal(hasArrived(25, null), false);
  assert.equal(hasArrived(40, 45), true, 'within the fix error');
  assert.equal(hasArrived(80, 3000), false, 'approximate location never arrives');
});

test('hasMoved: beyond jitter and the fix error', () => {
  assert.equal(hasMoved(10, 5), false);
  assert.equal(hasMoved(40, 5), true);
  assert.equal(hasMoved(40, 60), false, 'a poor fix wanders further');
  assert.equal(hasMoved(40, null), true);
});
