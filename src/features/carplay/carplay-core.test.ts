import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cumulativeDistances, parseRoute, routeProgress } from '../maps/routing-core.ts';
import { carDistance, carGuidance, mainRoad, type GuidanceInput } from './carplay-core.ts';

const route = parseRoute(readFileSync(new URL('../maps/fixtures/route-madrid-auto.json', import.meta.url), 'utf8'), 'auto');
const cumulative = cumulativeDistances(route.shape);
const start = { lat: route.shape[0][1], lon: route.shape[0][0], accuracy: 5 };
const end = route.shape[route.shape.length - 1];
const target = { name: 'Plaza de Castilla', lat: end[1], lon: end[0] };
const text = { lineTo: (s: number) => `line ${s}`, toll: 'Peajes', ferry: 'Ferri', via: (r: string) => `Por ${r}` };

const input = (over: Partial<GuidanceInput> = {}): GuidanceInput => ({
  target,
  position: start,
  navigating: true,
  routing: 'ready',
  costing: 'auto',
  route,
  progress: routeProgress(route, cumulative, start),
  routeId: 1,
  ...over,
});

test('no target: nothing to show', () => {
  const g = carGuidance(input({ target: null }), 'metric', text);
  assert.equal(g.target, null);
  assert.equal(g.step, null);
  assert.equal(g.summary, null);
});

test('on the route: the next maneuver, the one after, and what is left', () => {
  const g = carGuidance(input(), 'metric', text);
  assert.equal(g.arrived, false);
  assert.equal(g.step?.index, 1);
  assert.equal(g.step?.icon, 'left');
  assert.equal(g.step?.instruction, 'Gire a la izquierda hacia Plaza del Carmen.');
  assert.equal(g.step?.street, 'Plaza del Carmen');
  assert.equal(g.step?.estimate.distance.unit, 'm');
  // Plaza del Carmen is 65 m long: the right turn after it shows too.
  assert.equal(g.nextStep?.index, 2);
  assert.equal(g.nextStep?.icon, 'right');
  assert.equal(g.summary?.distance.unit, 'km');
  assert.equal(g.summary?.seconds, Math.round(route.durationS));
  assert.ok(g.remaining && g.remaining.seconds > 0);
  assert.equal(g.note, [`Por ${mainRoad(route)}`, route.hasToll ? 'Peajes' : null].filter(Boolean).join(' · '));
});

test('the maneuver after the next only when it comes close behind', () => {
  const far = route.maneuvers.findIndex((m, i) => i > 0 && m.distanceM > 200 && route.maneuvers[i + 1]);
  assert.ok(far > 0);
  const at = route.shape[route.maneuvers[far].begin];
  const near = { lat: at[1], lon: at[0], accuracy: 5 };
  // Just before that maneuver: it is the next one, and the one after is too far to show.
  const progress = { ...routeProgress(route, cumulative, near), next: far, toNextM: 30 };
  assert.equal(carGuidance(input({ position: near, progress }), 'metric', text).nextStep, null);
});

test('at the destination: arrived', () => {
  const here = { lat: target.lat, lon: target.lon, accuracy: 5 };
  const g = carGuidance(input({ position: here, progress: routeProgress(route, cumulative, here) }), 'metric', text);
  assert.equal(g.arrived, true);
});

test('no route: a straight-line step that changes with the compass sector', () => {
  const g = carGuidance(input({ routing: 'none', route: null, progress: null }), 'metric', text);
  assert.equal(g.step?.icon, 'straight-line');
  assert.match(g.step?.instruction ?? '', /^line [0-7]$/);
  assert.ok(g.step!.index < -99);
  assert.ok(g.summary && g.remaining);
  // By car, at a car's speed (the phone's note assumes walking).
  assert.ok(Math.abs(g.remaining!.seconds - g.remaining!.distance.value * 1000 / 13.9) < 120);
  // The arrow turns with the way the car goes: the target ahead-left when driving east.
  const east = carGuidance(input({ routing: 'none', route: null, progress: null, position: { ...start, travel: 90 } }), 'metric', text);
  const north = carGuidance(input({ routing: 'none', route: null, progress: null, position: { ...start, travel: 0 } }), 'metric', text);
  assert.equal(((north.step!.rotation! - east.step!.rotation!) + 360) % 360, 90);
  // Computing: no step yet.
  assert.equal(carGuidance(input({ routing: 'loading', route: null, progress: null }), 'metric', text).step, null);
});

test('the main road is the street the route spends the longest on', () => {
  const m = (streets: string[], distanceM: number) => ({ streets, distanceM });
  assert.equal(mainRoad({ maneuvers: [m(['Calle A'], 100), m([], 5000), m(['CG-1', 'Av. Meritxell'], 3000), m(['Calle B'], 200)] as never }), 'CG-1');
  assert.equal(mainRoad({ maneuvers: [m([], 100)] as never }), null);
});

test('distances in the region units', () => {
  assert.deepEqual(carDistance(1234, 'metric'), { value: 1.2, unit: 'km' });
  assert.deepEqual(carDistance(234, 'metric'), { value: 230, unit: 'm' });
  assert.deepEqual(carDistance(3000, 'us'), { value: 1.9, unit: 'mi' });
});
