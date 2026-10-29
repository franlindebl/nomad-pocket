import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { countryAt, decodePolyline, prepareShapes, type CountryShapes } from './country-at-core.ts';

const shapes = prepareShapes(JSON.parse(readFileSync(new URL('./country-shapes.json', import.meta.url), 'utf8')) as CountryShapes);

test('decodePolyline reads Google polylines as [lon, lat] pairs', () => {
  // The format's documented example, at 1e-5°.
  assert.deepEqual([...decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 1e5)], [-120.2, 38.5, -120.95, 40.7, -126.453, 43.252]);
});

test('countryAt finds the country of cities, enclaves and borders', () => {
  const at = (lat: number, lon: number) => countryAt(shapes, lat, lon);
  assert.equal(at(40.4168, -3.7038), 'es', 'Madrid');
  assert.equal(at(48.8566, 2.3522), 'fr', 'Paris');
  assert.equal(at(35.8894, -5.3213), 'es', 'Ceuta, on the African coast');
  assert.equal(at(35.2923, -2.9381), 'es', 'Melilla');
  assert.equal(at(35.7595, -5.834), 'ma', 'Tangier');
  assert.equal(at(42.5078, 1.5211), 'ad', 'Andorra la Vella');
  assert.equal(at(-29.31, 27.48), 'ls', 'Maseru, inside South Africa');
  assert.equal(at(-26.2041, 28.0473), 'za', 'Johannesburg');
  assert.equal(at(32.5149, -117.0382), 'mx', 'Tijuana');
  assert.equal(at(32.7157, -117.1611), 'us', 'San Diego');
  assert.equal(at(35.6762, 139.6503), 'jp', 'Tokyo');
  assert.equal(at(-33.8688, 151.2093), 'au', 'Sydney');
});

test('countryAt takes the closest coast for a position just off it, and nothing at open sea', () => {
  assert.equal(countryAt(shapes, 41.37, 2.21), 'es', 'a boat off Barcelona');
  assert.equal(countryAt(shapes, 30, -40), null, 'the middle of the Atlantic');
});
