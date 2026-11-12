import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { emmaZonesOf, nwsZoneKey, nwsZonesOf, type EmmaTable } from './zones.ts';

// Two squares side by side in "DE" (x 7.0–7.5 and 7.5–8.0, y 53.0–53.5) and one in "NL", scaled by 1000.
const sq = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n, w, s];
const table: EmmaTable = {
  scale: 1000,
  zones: {
    DE001: { c: 'de', b: [7000, 53000, 7500, 53500], r: [sq(7000, 53000, 7500, 53500)] },
    DE002: { c: 'de', b: [7500, 53000, 8000, 53500], r: [sq(7500, 53000, 8000, 53500)] },
    NL001: { c: 'nl', b: [6000, 53000, 7000, 53500], r: [sq(6000, 53000, 7000, 53500)] },
  },
};

test('EMMA: a cell inside one region gets it; a cell on a border gets both; other countries never', () => {
  assert.deepEqual(emmaZonesOf({ lat: 53.2, lon: 7.1 }, 'de', table), ['DE001']);
  assert.deepEqual(emmaZonesOf({ lat: 53.2, lon: 7.45 }, 'de', table), ['DE001', 'DE002']);
  assert.deepEqual(emmaZonesOf({ lat: 53.2, lon: 6.95 }, 'de', table), ['DE001'], 'the Dutch square is not offered to a German phone');
  assert.deepEqual(emmaZonesOf({ lat: 40, lon: -3.7 }, 'de', table), []);
});

test('NWS zone keys and the /points lookup of the five points', async () => {
  assert.equal(nwsZoneKey('https://api.weather.gov/zones/forecast/TXZ213'), 'forecast/TXZ213');
  assert.equal(nwsZoneKey('nonsense'), null);
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    if (url.includes('29.7000,-95.4000')) return new Response('not found', { status: 404 });
    return Response.json({
      properties: {
        forecastZone: 'https://api.weather.gov/zones/forecast/TXZ213',
        county: 'https://api.weather.gov/zones/county/TXC201',
        fireWeatherZone: 'https://api.weather.gov/zones/fire/TXZ213',
      },
    });
  }) as typeof fetch;
  const zones = await nwsZonesOf({ lat: 29.7, lon: -95.4 }, fake);
  assert.equal(asked.length, 5);
  assert.deepEqual(zones, ['county/TXC201', 'fire/TXZ213', 'forecast/TXZ213']);
});

// The real table, when it has been built (`npm run build` makes it; not in the repo).
const built = new URL('../data/emma.json.gz', import.meta.url);
test('EMMA, real table: Berlin, Paris and Lisbon each fall in a region of their country', { skip: !existsSync(built) }, () => {
  const real = JSON.parse(gunzipSync(readFileSync(built)).toString('utf8')) as EmmaTable;
  for (const [cell, country] of [
    [{ lat: 52.5, lon: 13.4 }, 'de'],
    [{ lat: 48.8, lon: 2.3 }, 'fr'],
    [{ lat: 38.7, lon: -9.2 }, 'pt'],
  ] as const) {
    const zones = emmaZonesOf(cell, country, real);
    assert.ok(zones.length >= 1, `${country}: ${zones}`);
    assert.ok(zones.every((z) => z.startsWith(country.toUpperCase())), `${country}: ${zones}`);
  }
});
