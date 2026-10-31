import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Route } from './routing-core.ts';
import {
  bestPath,
  chainEstimate,
  endGap,
  joinRoutes,
  matrixRequest,
  nearestSeams,
  packChains,
  parseCrossings,
  parseMatrix,
  pickRoute,
  robustMatrix,
  seamLocation,
  seamsBetween,
  type StitchPack,
} from './stitch-core.ts';

// Three packs side by side along a parallel: west | middle | east, each 2° wide with a 0.1° margin.
const crossing = (lon: number, cls = 'primary', dirs = 'both', out = 90) => `42\t${lon}\t${cls}\t${out}\t${dirs}\tN-1`;
const west: StitchPack = { id: 'w', bbox: [-4.1, 41, -1.9, 43], crossings: parseCrossings([crossing(-2), crossing(-2.001, 'motorway', 'out')].join('\n')) };
const middle: StitchPack = { id: 'm', bbox: [-2.1, 41, 0.1, 43], crossings: null };
const east: StitchPack = { id: 'e', bbox: [-0.1, 41, 2.1, 43], crossings: parseCrossings(crossing(0, 'secondary', 'both', 270)) };

test('parseCrossings reads rows and skips broken ones', () => {
  const rows = parseCrossings(['42.03\t-8.65\tmotorway\t326\tout\tA-55', 'x\t1\tprimary\t3\tboth', '1\t2\ttrack\t3\tboth', '1\t2\tprimary\t3\tsideways', ''].join('\n'));
  assert.deepEqual(rows, [{ lat: 42.03, lon: -8.65, cls: 'motorway', out: 326, dirs: 'out' }]);
});

test('seams: the costing picks the road classes, one-way roads only their way', () => {
  assert.deepEqual(
    seamsBetween(west, middle, 'auto').map((s) => [s.cls, s.heading]),
    [
      ['primary', 90],
      ['motorway', 90],
    ],
  );
  // No motorways on foot.
  assert.deepEqual(
    seamsBetween(west, middle, 'pedestrian').map((s) => s.cls),
    ['primary'],
  );
  // Back into the west pack: its one-way motorway goes the other way; the heading turns round.
  const back = seamsBetween(middle, west, 'auto');
  assert.deepEqual(
    back.map((s) => [s.cls, s.heading]),
    [['primary', 270]],
  );
});

test('seams: the other pack’s file when this one has none, and each road once', () => {
  assert.deepEqual(
    seamsBetween(middle, east, 'auto').map((s) => [s.lon, s.heading]),
    [[0, 90]],
  );
  // Both files list the same bridge: one seam.
  const twin: StitchPack = { ...middle, crossings: parseCrossings(`42.0001\t0.0001\tsecondary\t90\tboth\t`) };
  assert.equal(seamsBetween(twin, east, 'auto').length, 1);
  // Outside the other pack's coverage: no seam.
  assert.deepEqual(seamsBetween(west, east, 'auto'), []);
});

test('nearestSeams keeps the smallest straight-line detours', () => {
  const seams = [40, 42, 44].map((lat) => ({ lat, lon: 0, heading: 90, cls: 'primary' as const }));
  assert.deepEqual(
    nearestSeams(seams, { lat: 42, lon: -1 }, { lat: 42.5, lon: 1 }, 2).map((s) => s.lat),
    [42, 44],
  );
  assert.equal(nearestSeams(seams, { lat: 0, lon: 0 }, { lat: 0, lon: 1 }, 5).length, 3);
});

test('packChains: through a middle pack, shortest first, never a loop', () => {
  const from = { lat: 42, lon: -3 };
  const to = { lat: 42, lon: 1 };
  assert.deepEqual(
    packChains([west, middle, east], from, to, 'auto').map((c) => c.map((p) => p.id)),
    [['w', 'm', 'e']],
  );
  assert.deepEqual(packChains([west, middle, east], from, to, 'auto', 2), []);
  assert.deepEqual(
    packChains([west, middle], from, { lat: 42, lon: -1 }, 'auto').map((c) => c.map((p) => p.id)),
    [['w', 'm']],
  );
  assert.ok(Number.isFinite(chainEstimate([west, middle, east], from, to, 'auto')));
  assert.equal(chainEstimate([west, east], from, to, 'auto'), Infinity);
});

test('bestPath adds up every combination and keeps the cheapest', () => {
  // Origin → 2 seams, then 2 → 3 seams, then 3 → destination.
  const r = bestPath([
    [[10, 12]],
    [
      [50, null, 5],
      [1, 40, null],
    ],
    [[1], [2], [100]],
  ]);
  // 12 + 1 + 1 = 14 beats 10 + 5 + 100.
  assert.deepEqual(r, { picks: [1, 0], total: 14 });
  assert.deepEqual(bestPath([[[7, 3]], [[1], [9]]]), { picks: [0], total: 8 });
  assert.equal(bestPath([[[null]], [[1]]]), null);
});

const leg = (shape: [number, number][], maneuvers: [number, string, number][]): Route => {
  let at = 0;
  return {
    costing: 'auto',
    distanceM: maneuvers.reduce((s, m) => s + m[2], 0),
    durationS: maneuvers.reduce((s, m) => s + m[2] / 10, 0),
    shape,
    maneuvers: maneuvers.map(([type, instruction, distanceM], i) => {
      const end = i === maneuvers.length - 1 ? shape.length - 1 : at + 1;
      const m = { type, instruction, verbal: null, alert: null, multiCue: false, streets: [], distanceM, durationS: distanceM / 10, begin: at, end, exit: null };
      at = end;
      return m;
    }),
    bbox: [Math.min(...shape.map((p) => p[0])), Math.min(...shape.map((p) => p[1])), Math.max(...shape.map((p) => p[0])), Math.max(...shape.map((p) => p[1]))],
    hasToll: false,
    hasHighway: true,
    hasFerry: false,
  };
};

test('joinRoutes: one route, the seam folded into the manoeuvre before it', () => {
  const a = leg(
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [1, 'Head east', 100],
      [23, 'Keep right onto A-55', 200],
      [6, 'Your destination is on the left', 0],
    ],
  );
  const b = leg(
    [
      [2, 0],
      [3, 0],
      [3, 1],
    ],
    [
      [3, 'Drive southeast on E 01', 300],
      [10, 'Turn right', 50],
      [4, 'You have arrived', 0],
    ],
  );
  const r = joinRoutes([a, b]);
  assert.equal(r.shape.length, 5);
  assert.deepEqual(
    r.maneuvers.map((m) => [m.instruction, m.begin, m.end, m.distanceM]),
    [
      ['Head east', 0, 1, 100],
      ['Keep right onto A-55', 1, 3, 500],
      ['Turn right', 3, 4, 50],
      ['You have arrived', 4, 4, 0],
    ],
  );
  assert.equal(r.distanceM, 650);
  assert.equal(r.durationS, 65);
  assert.deepEqual(r.bbox, [0, 0, 3, 1]);
  assert.equal(r.hasHighway, true);
  assert.equal(joinRoutes([a]), a);
});

test('ferries: a port abroad is a seam for every costing, with no heading', () => {
  // A ferry from the west pack lands at a port inside the east pack (both hold the whole crossing).
  const port = '42.5\t0.5\tferry\t95\tboth\tHelsinki (FIN) – Tallinn (EST)';
  const rows = parseCrossings([port, crossing(-2)].join('\n'));
  assert.deepEqual(rows[0], { lat: 42.5, lon: 0.5, cls: 'ferry', out: 95, dirs: 'both' });
  // The catalog clips the departure pack's cells to its country: they stop short of the port.
  const wide: StitchPack = { id: 'w', bbox: [-4.1, 41, 0.2, 43], crossings: rows };
  for (const costing of ['auto', 'bicycle', 'pedestrian'] as const) {
    assert.deepEqual(
      seamsBetween(wide, east, costing).filter((s) => s.cls === 'ferry'),
      [{ lat: 42.5, lon: 0.5, heading: null, cls: 'ferry' }],
    );
  }
  // Two lines into the same port: one seam.
  const twice: StitchPack = { ...wide, crossings: parseCrossings([port, port.replace('\t95\t', '\t250\t')].join('\n')) };
  assert.equal(seamsBetween(twice, east, 'auto').filter((s) => s.cls === 'ferry').length, 1);
  assert.deepEqual(seamLocation({ lat: 42.5, lon: 0.5, heading: null, cls: 'ferry' }), { lat: 42.5, lon: 0.5, type: 'break' });
  // The way back uses the other pack's own ferries: this file's port abroad would start that leg on the boat.
  assert.deepEqual(
    seamsBetween(east, wide, 'auto').filter((s) => s.cls === 'ferry'),
    [],
  );
});

test('joinRoutes: off the boat, the next leg’s first instruction stays', () => {
  const a = leg(
    [
      [0, 0],
      [1, 0],
    ],
    [
      [28, 'Take the ferry to Helsinki', 80000],
      [4, 'You have arrived', 0],
    ],
  );
  const b = leg(
    [
      [1, 0],
      [1, 1],
    ],
    [
      [1, 'Head north on Mechelininkatu', 4000],
      [4, 'You have arrived', 0],
    ],
  );
  assert.deepEqual(
    joinRoutes([a, b], [{ cls: 'ferry' }]).maneuvers.map((m) => [m.instruction, m.begin, m.end]),
    [
      ['Take the ferry to Helsinki', 0, 1],
      ['Head north on Mechelininkatu', 1, 2],
      ['You have arrived', 2, 2],
    ],
  );
  // At a road seam it folds, as before.
  assert.equal(joinRoutes([a, b], [{ cls: 'primary' }]).maneuvers.length, 2);
});

test('pickRoute: the fastest of the answers that reach the trip’s ends', () => {
  const tallinn = { lat: 59.437, lon: 24.7536 };
  const helsinki = { lat: 60.1699, lon: 24.9384 };
  // Finland's pack has only the ferry in Tallinn: its answer starts on the boat, 1.3 km out.
  const onTheBoat = { shape: [[24.77, 59.4485], [24.9384, 60.1699]] as [number, number][] };
  const fromTheStreet = { shape: [[24.7537, 59.437], [24.9383, 60.1699]] as [number, number][] };
  assert.ok(endGap(onTheBoat, tallinn, helsinki) > 1000);
  assert.ok(endGap(fromTheStreet, tallinn, helsinki) < 10);
  assert.equal(endGap({ shape: [] }, tallinn, helsinki), Infinity);
  const answers = [
    { name: 'boat', gap: endGap(onTheBoat, tallinn, helsinki), s: 9008 },
    { name: 'street', gap: endGap(fromTheStreet, tallinn, helsinki), s: 12033 },
  ];
  assert.equal(pickRoute(answers, (a) => a.gap, (a) => a.s)?.name, 'street');
  // Ends about as close: the faster one.
  assert.equal(pickRoute([{ ...answers[1], s: 9000, name: 'b' }, answers[1]], (a) => a.gap, (a) => a.s)?.name, 'b');
  assert.equal(pickRoute([], (a: { gap: number }) => a.gap, () => 0), null);
});

test('robustMatrix isolates the location that breaks a request', async () => {
  const calls: string[] = [];
  const run = async (s: number[], t: number[]) => {
    calls.push(`${s}|${t}`);
    if (t.includes(3)) throw new Error('valhalla 171: No suitable edges near location');
    return s.map((a) => t.map((b) => a * 10 + b));
  };
  assert.deepEqual(await robustMatrix(run, [1], [1, 2, 3, 4]), [[11, 12, null, 14]]);
  assert.deepEqual(await robustMatrix(run, [1, 2], [3]), [[null], [null]]);
  assert.equal(calls[0], '1|1,2,3,4');
});

test('parseMatrix reads times, null where there is no way', () => {
  const json = JSON.stringify({ sources_to_targets: [[{ time: 12.5, distance: 1 }, { time: null }, {}]] });
  assert.deepEqual(parseMatrix(json), [[12.5, null, null]]);
  assert.deepEqual(JSON.parse(matrixRequest([seamLocation({ lat: 1, lon: 2, heading: 90, cls: 'primary' })], [{ lat: 3, lon: 4 }], 'auto')), {
    sources: [{ lat: 1, lon: 2, type: 'break', heading: 90, heading_tolerance: 45 }],
    targets: [{ lat: 3, lon: 4 }],
    costing: 'auto',
  });
});

test('joinRoutes: speed limits move with their leg', () => {
  const shapeA: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  const shapeB: [number, number][] = [
    [2, 0],
    [3, 0],
    [3, 1],
  ];
  const a = { ...leg(shapeA, [[1, 'Head east', 200]]), limits: [{ from: 0, to: 2, kmh: 90 }] };
  const b = { ...leg(shapeB, [[1, 'Head east', 200]]), limits: [{ from: 0, to: 2, kmh: 50 }] };
  assert.deepEqual(joinRoutes([a, b]).limits, [
    { from: 0, to: 2, kmh: 90 },
    { from: 2, to: 4, kmh: 50 },
  ]);
  assert.equal(joinRoutes([leg(shapeA, [[1, 'x', 1]]), leg(shapeB, [[1, 'x', 1]])]).limits, undefined);
});
