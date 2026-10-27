import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  followBearing,
  followCenter,
  followPitch,
  followZoom,
  hasArrived,
  hasMoved,
  isWeakFix,
  isWrongWay,
  movingBearing,
  offsetMeters,
  pushFix,
  smoothTurn,
  travelBearing,
  turnBetween,
  type TrackFix,
} from './follow-core.ts';
import { distanceMeters } from './geo.ts';
import { cumulativeDistances, type RouteProgress } from './routing-core.ts';

const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b}`);

const onRoute: RouteProgress = {
  segment: 3,
  offRouteM: 5,
  remainingM: 900,
  next: 2,
  toNextM: 120,
  alongM: 100,
  snapped: { lat: 0, lon: 0.0009 },
  roadBearing: 80,
};

/** A walk east at 1.4 m/s, a fix every 2 s (a fix about every 2.8 m), from the origin. */
function walkEast(fixes: number, accuracy: number | null = 5): TrackFix[] {
  let track: TrackFix[] = [];
  for (let i = 0; i < fixes; i++) track = pushFix(track, { ...offsetMeters({ lat: 40, lon: -3 }, 90, i * 2.8), at: i * 2000, accuracy });
  return track;
}

test('travelBearing: the last metres, once beyond jitter', () => {
  assert.equal(travelBearing(walkEast(3), 'pedestrian'), null, '5.6 m: not yet');
  near(travelBearing(walkEast(5), 'pedestrian') ?? -1, 90, 0.5);
  assert.equal(travelBearing(walkEast(5), 'auto'), null, 'a car needs 15 m');
  assert.equal(travelBearing(walkEast(5, 20), 'pedestrian'), null, 'a 20 m fix needs 20 m of track');
  assert.equal(travelBearing(walkEast(5, 80), 'pedestrian'), null, 'bad fixes say nothing');
  // Then north: after a few metres the bearing follows the turn.
  let track = walkEast(10);
  const corner = track[track.length - 1];
  for (let i = 1; i <= 4; i++) track = pushFix(track, { ...offsetMeters(corner, 0, i * 2.8), at: corner.at + i * 2000, accuracy: 5 });
  near(travelBearing(track, 'pedestrian') ?? -1, 0, 1);
});

test('pushFix forgets fixes older than 30 s', () => {
  const track = walkEast(25);
  assert.ok(track[track.length - 1].at - track[0].at <= 30_000);
  assert.equal(track.length, 16);
});

test('movingBearing: course in a car, the track on foot', () => {
  assert.equal(movingBearing('auto', 100, 90), 100);
  assert.equal(movingBearing('auto', null, 90), 90);
  assert.equal(movingBearing('pedestrian', 100, 90), 90);
  assert.equal(movingBearing('bicycle', 100, null), 100);
  assert.equal(movingBearing('pedestrian', null, null), null);
});

test('followBearing: the road, unless going against it; off it, the way the user moves', () => {
  const base = { moving: 85 as number | null, progress: onRoute as RouteProgress | null, accuracy: 8 };
  assert.equal(followBearing(base), 80, 'on the road: its direction');
  assert.equal(followBearing({ ...base, moving: null }), 80, 'stopped at a light: still the road');
  assert.equal(followBearing({ ...base, moving: 262 }), 262, 'walking back: where they go');
  assert.equal(followBearing({ ...base, progress: { ...onRoute, offRouteM: 120 } }), 85, 'off the route');
  assert.equal(followBearing({ ...base, progress: null }), 85);
  assert.equal(followBearing({ ...base, progress: null, moving: null }), null, 'standing off the route: keep the map');
  assert.equal(followBearing({ ...base, progress: { ...onRoute, roadBearing: null } }), 85, 'at the end of the route');
});

test('isWrongWay: against the road, on it', () => {
  assert.equal(isWrongWay(onRoute, 8, 262), true);
  assert.equal(isWrongWay(onRoute, 8, 150), false, '70° off is a bend, not the wrong way');
  assert.equal(isWrongWay(onRoute, 8, null), false);
  assert.equal(isWrongWay({ ...onRoute, offRouteM: 200 }, 8, 262), false, 'off the route is handled as such');
});

test('smoothTurn: holds small jitter, turns at a bounded rate, the short way round', () => {
  assert.equal(smoothTurn(80, 81, 1000, 'auto'), 80);
  assert.equal(smoothTurn(0, 90, 1000, 'auto'), 90);
  assert.equal(smoothTurn(0, 180, 1000, 'pedestrian'), 300, 'a U-turn at 60°/s, the short way (ties go left)');
  assert.equal(smoothTurn(350, 20, 1000, 'auto'), 20, 'through north');
  assert.equal(smoothTurn(10, 340, 250, 'pedestrian'), 355);
});

test('followCenter: on the route, ahead along it; standing, where the user is', () => {
  // East 100 m then north 100 m.
  const shape: [number, number][] = [
    [0, 0],
    [0.0009, 0],
    [0.0009, 0.0009],
  ];
  const cumulative = cumulativeDistances(shape);
  const progress: RouteProgress = { ...onRoute, offRouteM: 3, alongM: cumulative[1] - 5, snapped: { lat: 0, lon: 0.0009 - 0.000045 } };
  const position = { lat: 0.00002, lon: 0.0009 - 0.000045, accuracy: 5, speed: 10 };
  const c = followCenter({ position, route: { shape }, cumulative, progress, moving: 90, gapMs: 1000 });
  // 10 m on from 5 m before the corner: 5 m up the north leg.
  near(c.lon, 0.0009, 1e-7);
  near(distanceMeters(c, { lat: 0, lon: 0.0009 }), 5, 0.2);
  const still = followCenter({ position: { ...position, speed: 0.2 }, route: { shape }, cumulative, progress, moving: 90, gapMs: 1000 });
  assert.deepEqual(still, progress.snapped, 'standing: snapped onto the road');
  const off = followCenter({ position, route: { shape }, cumulative, progress: { ...progress, offRouteM: 300 }, moving: 0, gapMs: 1000 });
  near(distanceMeters(off, position), 10, 0.1, 'off the route: straight on');
  const fast = followCenter({ position: { ...position, speed: 90 }, route: null, cumulative: [], progress: null, moving: 0, gapMs: 2000 });
  near(distanceMeters(fast, position), 60, 0.2, 'never more than 60 m ahead');
});

test('followZoom zooms out with speed and in before a turn', () => {
  assert.equal(followZoom('auto', null), 17);
  assert.equal(followZoom('auto', 20), 16);
  assert.equal(followZoom('auto', 33), 15);
  assert.equal(followZoom('auto', 20, 120), 16.75);
  assert.equal(followZoom('auto', 33, 300), 15.75, 'ten seconds ahead on the motorway');
  assert.equal(followZoom('auto', 33, 400), 15);
  assert.equal(followZoom('pedestrian', 33), 17.5);
  assert.equal(followZoom('pedestrian', 1.4, 20), 18);
});

test('followPitch: flatter on foot', () => {
  assert.ok(followPitch('pedestrian') < followPitch('auto'));
});

test('isWeakFix: rough, or no fixes while moving', () => {
  assert.equal(isWeakFix(0, 5, 10, 5000), false);
  assert.equal(isWeakFix(0, 5, 10, 11_000), true, 'driving into a tunnel');
  assert.equal(isWeakFix(0, 5, 0, 60_000), false, 'standing at a light brings no fixes');
  assert.equal(isWeakFix(0, 5, null, 60_000), false);
  assert.equal(isWeakFix(0, 80, 0, 1000), true);
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
