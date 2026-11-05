import assert from 'node:assert/strict';
import test from 'node:test';

import { alongRoute, corridorBox, lastWithin, ringPairs, routeEntersRings } from './along-core.ts';

// A straight west→east road at 40°N, 1° of longitude (~85 km).
const road: [number, number][] = [
  [-4, 40],
  [-3.5, 40],
  [-3, 40],
];

test('points along a route, in route order, inside the corridor only', () => {
  const pts = [
    { id: 'far', lat: 40.1, lon: -3.5 }, // ~11 km off
    { id: 'end', lat: 40.005, lon: -3.1 }, // ~550 m off, ~77 km along
    { id: 'start', lat: 39.995, lon: -3.9 }, // ~550 m off, ~8.5 km along
  ];
  const got = alongRoute(pts, road, 2000);
  assert.deepEqual(
    got.map((p) => p.id),
    ['start', 'end'],
  );
  assert.ok(Math.abs(got[0].alongM - 8_530) < 300, String(got[0].alongM));
  assert.ok(Math.abs(got[0].offM - 556) < 30, String(got[0].offM));
  assert.equal(alongRoute(pts, road, 300).length, 0);
});

test('a route entering an alert area, and where', () => {
  // A square around lon -3.5.
  const square = [-3.6, 39.9, -3.4, 39.9, -3.4, 40.1, -3.6, 40.1, -3.6, 39.9];
  const at = routeEntersRings(road, [square]);
  assert.ok(at !== null && Math.abs(at - 34_100) < 400, String(at));
  assert.equal(routeEntersRings(road, [[-3.6, 40.2, -3.4, 40.2, -3.4, 40.3, -3.6, 40.3]]), null);
  // A small area between two shape points, cut by the long segment.
  const corner = [-3.75, 39.99, -3.74, 39.99, -3.74, 40.01, -3.75, 40.01];
  assert.ok(routeEntersRings(road, [corner]) !== null);
  assert.deepEqual(ringPairs([1, 2, 3, 4, 5, 6]), [
    [1, 2],
    [3, 4],
    [5, 6],
    [1, 2],
  ]);
});

test('the last stop within a range', () => {
  const pts = [{ alongM: 10_000 }, { alongM: 70_000 }, { alongM: 95_000 }];
  assert.deepEqual(lastWithin(pts, 80_000), { last: pts[1], beyond: true });
  assert.deepEqual(lastWithin(pts, 5_000), { last: null, beyond: true });
  const [w, s, e, n] = corridorBox(road, 2000);
  assert.ok(w < -4 && e > -3 && s < 40 && n > 40);
});
