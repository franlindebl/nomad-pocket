import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseRoute } from './routing-core.ts';
import { earlyDistance, isNewWay, keysOf, lowerFirst, nextCue, nowDistance, spokenDistance, START_KEY, type Cue, type VoiceManeuver } from './voice-core.ts';

const madrid = parseRoute(readFileSync(new URL('./fixtures/route-madrid-auto.json', import.meta.url), 'utf8'), 'auto');

const m = (type: number, verbal: string, alert: string | null = null, multiCue = false): VoiceManeuver => ({ type, verbal, alert, multiCue });
const route = [m(1, 'Conduzca hacia el norte.'), m(10, 'Gire a la derecha hacia Gran Vía.', 'Gire a la derecha hacia Gran Vía.'), m(4, 'Ha llegado a su destino.', 'Llegará a su destino.')];

function cue(next: number, toNextM: number, spoken: Iterable<string> = [START_KEY], speedMps: number | null = 10, maneuvers = route): Cue | null {
  return nextCue({ maneuvers, next, toNextM, offRouteM: 0, costing: 'auto', speedMps, spoken: new Set(spoken) });
}

test('the parsed route keeps the transition alerts and multi-cue flags', () => {
  assert.equal(madrid.maneuvers[0].alert, null);
  assert.equal(madrid.maneuvers[1].alert, 'Gire a la izquierda hacia Plaza del Carmen.');
  assert.equal(madrid.maneuvers[1].multiCue, true);
});

test('the start instruction comes first, once', () => {
  assert.deepEqual(cue(1, 800, []), { key: START_KEY, kind: 'start', index: 0, text: 'Conduzca hacia el norte.' });
  assert.equal(cue(1, 800), null);
  // Navigation started further along: no start instruction.
  assert.equal(cue(2, 3000, [])?.kind, undefined);
});

test('early announcement inside its distance, then the prompt near the maneuver', () => {
  assert.equal(cue(1, 600), null);
  const early = cue(1, 380);
  assert.equal(early?.kind, 'early');
  assert.equal(early?.text, 'Gire a la derecha hacia Gran Vía.');
  assert.equal(early?.distanceM, 380);
  assert.equal(cue(1, 300, [START_KEY, early!.key]), null);
  const now = cue(1, 50, [START_KEY, early!.key]);
  assert.equal(now?.kind, 'now');
  assert.deepEqual(keysOf(now!), ['1:now', '1:early']);
  assert.equal(cue(1, 20, [START_KEY, ...keysOf(now!)]), null);
});

test('arriving: the alert early, the arrival sentence at the end', () => {
  assert.equal(cue(2, 300)?.text, 'Llegará a su destino.');
  assert.equal(cue(2, 30)?.text, 'Ha llegado a su destino.');
});

test('a maneuver already announced by the previous prompt gets no early announcement', () => {
  const close = [m(1, 'Salga.'), m(15, 'Gire a la izquierda. Después gire a la derecha.', null, true), m(10, 'Gire a la derecha.', 'Gire a la derecha.')];
  assert.equal(cue(2, 150, [START_KEY], 10, close), null);
  assert.equal(cue(2, 40, [START_KEY], 10, close)?.kind, 'now');
});

test('no early announcement right before the prompt, nothing while off the route', () => {
  // 25 m/s: the prompt at 150 m, so nothing between it and 300 m.
  assert.equal(cue(1, 250, [START_KEY], 25), null);
  assert.equal(nextCue({ maneuvers: route, next: 1, toNextM: 30, offRouteM: 80, costing: 'auto', speedMps: 10, spoken: new Set([START_KEY]) }), null);
});

test('distances grow with speed and shrink on foot', () => {
  assert.equal(earlyDistance('auto', null), 400);
  assert.equal(earlyDistance('auto', 20), 1000);
  assert.equal(earlyDistance('auto', 30), 2000);
  assert.equal(earlyDistance('pedestrian', 30), 100);
  assert.equal(nowDistance('auto', 0), 40);
  assert.equal(nowDistance('auto', 30), 180);
  assert.equal(nowDistance('auto', 60), 250);
  assert.equal(nowDistance('bicycle', 5), 30);
});

test('spoken distances are round numbers in the region units', () => {
  assert.deepEqual(spokenDistance(380, 'metric'), { value: 400, unit: 'm' });
  assert.deepEqual(spokenDistance(170, 'metric'), { value: 150, unit: 'm' });
  assert.deepEqual(spokenDistance(10, 'metric'), { value: 50, unit: 'm' });
  assert.deepEqual(spokenDistance(970, 'metric'), { value: 1, unit: 'km' });
  assert.deepEqual(spokenDistance(1430, 'metric'), { value: 1.5, unit: 'km' });
  assert.deepEqual(spokenDistance(12_400, 'metric'), { value: 12, unit: 'km' });
  assert.deepEqual(spokenDistance(500, 'us'), { value: 0.3, unit: 'mi' });
  assert.deepEqual(spokenDistance(250, 'us'), { value: 800, unit: 'ft' });
  assert.deepEqual(spokenDistance(250, 'uk'), { value: 250, unit: 'yd' });
});

test('lowerFirst', () => {
  assert.equal(lowerFirst('Gire a la derecha.'), 'gire a la derecha.');
  assert.equal(lowerFirst(''), '');
});

test('isNewWay: the same road found again is not a new way; a turn onto another one is', () => {
  // A street running north, ~1.1 km.
  const street: [number, number][] = [
    [-3.7, 40.4],
    [-3.7, 40.41],
  ];
  // Rerouted from a GPS jump 15 m off it: back onto the same street.
  const same: [number, number][] = [
    [-3.70018, 40.4045],
    [-3.7, 40.4046],
    [-3.7, 40.41],
  ];
  assert.equal(isNewWay(street, same), false);
  // Rerouted down a side street going east.
  const other: [number, number][] = [
    [-3.7, 40.4045],
    [-3.698, 40.4045],
    [-3.698, 40.41],
  ];
  assert.equal(isNewWay(street, other), true);
  // Different only beyond the first 400 m: not said now.
  const later: [number, number][] = [
    [-3.7, 40.4],
    [-3.7, 40.406],
    [-3.69, 40.406],
  ];
  assert.equal(isNewWay(street, later), false);
});

test('isNewWay: one long straight segment is checked along its length', () => {
  const street: [number, number][] = [
    [-3.7, 40.4],
    [-3.7, 40.41],
  ];
  // Starts on the street, then one segment heading away north-east.
  assert.equal(
    isNewWay(street, [
      [-3.7, 40.4],
      [-3.69, 40.41],
    ]),
    true,
  );
});
