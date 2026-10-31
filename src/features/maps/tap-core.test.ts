import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nearestStreet, tappedPlace, type TapFeature } from './tap-core.ts';

const point = (lon: number, lat: number, properties: Record<string, unknown>): TapFeature => ({
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});
const line = (coords: [number, number][], properties: Record<string, unknown>): TapFeature => ({
  geometry: { type: 'LineString', coordinates: coords },
  properties,
});

// Puerta del Sol, Madrid; 0.0001° of latitude is ~11 m.
const at = { lat: 40.4169, lon: -3.7035 };

test('tappedPlace picks the nearest point, POI or town label', () => {
  const found = {
    poi: [
      point(-3.7035, 40.4172, { name: 'Café Lejos', kind: 'cafe' }),
      point(-3.7035, 40.417, { name: 'La Mallorquina', kind: 'bakery' }),
    ],
    place: [point(-3.7035, 40.418, { name: 'Sol', kind: 'neighbourhood' })],
  };
  assert.deepEqual(tappedPlace(found, at, 'es'), {
    name: 'La Mallorquina',
    nativeName: null,
    kind: 'bakery',
    layer: 'poi',
    lat: 40.417,
    lon: -3.7035,
  });
  const town = tappedPlace(
    { poi: [], place: [point(-3.7035, 40.418, { name: 'Sol', kind: 'locality', kind_detail: 'neighbourhood' })] },
    at,
    'es',
  );
  assert.equal(town?.layer, 'place');
  assert.equal(town?.kind, 'neighbourhood');
});

test('tappedPlace keeps an unnamed POI (its kind names it) but not an unnamed town or a kindless point', () => {
  const p = tappedPlace({ poi: [point(-3.7035, 40.417, { kind: 'restaurant', kind_detail: 'chinese' })], place: [] }, at, 'es');
  assert.equal(p?.name, '');
  assert.equal(p?.kind, 'restaurant');
  assert.equal(
    tappedPlace({ poi: [point(-3.7035, 40.417, { name: 'X' })], place: [point(-3.7035, 40.417, { kind: 'locality' })] }, at, 'es'),
    null,
  );
});

test('tappedPlace names it in the app language and keeps the native name', () => {
  const p = tappedPlace(
    { poi: [point(-3.7035, 40.417, { name: 'Λευκός Πύργος', 'name:en': 'White Tower', kind: 'attraction' })], place: [] },
    at,
    'en',
  );
  assert.equal(p?.name, 'White Tower');
  assert.equal(p?.nativeName, 'Λευκός Πύργος');
});

test('tappedPlace skips lines and polygons', () => {
  assert.equal(
    tappedPlace(
      {
        poi: [
          line(
            [
              [-3.7, 40.4],
              [-3.71, 40.41],
            ],
            { name: 'X', kind: 'park' },
          ),
        ],
        place: [],
      },
      at,
      'es',
    ),
    null,
  );
});

test('nearestStreet: the nearest named road within reach, measured to the segment', () => {
  const roads = [
    // Runs east-west ~22 m north of the point.
    line(
      [
        [-3.71, 40.4171],
        [-3.69, 40.4171],
      ],
      { name: 'Calle Mayor', kind: 'minor_road' },
    ),
    // ~44 m south.
    line(
      [
        [-3.71, 40.4165],
        [-3.69, 40.4165],
      ],
      { name: 'Calle del Arenal', kind: 'minor_road' },
    ),
    // Nearer, but a railway and an unnamed road don't count.
    line(
      [
        [-3.71, 40.4169],
        [-3.69, 40.4169],
      ],
      { name: 'Línea 1', kind: 'rail' },
    ),
    line(
      [
        [-3.71, 40.41691],
        [-3.69, 40.41691],
      ],
      { kind: 'path' },
    ),
  ];
  assert.deepEqual(nearestStreet(roads, at, 'es'), { name: 'Calle Mayor', native: 'Calle Mayor' });
});

test('nearestStreet: none beyond reach; multi-lines and a street name in the app language', () => {
  assert.equal(
    nearestStreet(
      [
        line(
          [
            [-3.71, 40.42],
            [-3.69, 40.42],
          ],
          { name: 'Far', kind: 'major_road' },
        ),
      ],
      at,
      'es',
    ),
    null,
  );
  const multi: TapFeature = {
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [
          [-3.71, 40.43],
          [-3.69, 40.43],
        ],
        [
          [-3.7036, 40.4],
          [-3.7036, 40.43],
        ],
      ],
    },
    properties: { name: 'Carrer Major', 'name:es': 'Calle Mayor', kind: 'minor_road' },
  };
  assert.deepEqual(nearestStreet([multi], at, 'es'), { name: 'Calle Mayor', native: 'Carrer Major' });
});
