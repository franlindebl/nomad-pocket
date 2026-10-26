import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bearingDegrees, compassSector, distanceMeters, formatUtm, fromUtm, isFreshFix, parseCoordinates, screenHeading, toUtm } from './geo.ts';

const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b}`);

test('distance and bearing', () => {
  const sol = { lat: 40.416775, lon: -3.70379 };
  const paz = { lat: 40.4815, lon: -3.687 };
  near(distanceMeters(sol, paz), 7337, 30, 'Sol → La Paz');
  near(bearingDegrees(sol, paz), 11, 2, 'bearing');
  assert.equal(compassSector(bearingDegrees(sol, paz)), 0);
  assert.equal(compassSector(bearingDegrees(paz, sol)), 4);
  assert.equal(compassSector(359), 0);
  assert.equal(compassSector(100), 2);
});

test('UTM: reference points and round trip', () => {
  const origin = toUtm(0, 0)!;
  assert.equal(origin.zone, 31);
  assert.equal(origin.band, 'N');
  near(origin.easting, 166021.44, 0.5);
  near(origin.northing, 0, 0.5);

  const sol = toUtm(40.416775, -3.70379)!;
  assert.equal(formatUtm(sol).slice(0, 4), '30T ');
  near(sol.easting, 440290, 10);
  near(sol.northing, 4474258, 10);

  for (const [lat, lon] of [
    [40.416775, -3.70379],
    [-33.8688, 151.2093],
    [64.1466, -21.9426],
    [-54.8019, -68.303],
    [28.1235, -15.4363],
  ]) {
    const back = fromUtm(toUtm(lat, lon)!);
    near(back.lat, lat, 1e-6, 'lat');
    near(back.lon, lon, 1e-6, 'lon');
  }
  assert.equal(toUtm(85, 0), null);
  assert.equal(toUtm(60, 5)!.zone, 32);
});

test('parseCoordinates: decimal', () => {
  assert.deepEqual(parseCoordinates('40.4168, -3.7038'), { lat: 40.4168, lon: -3.7038 });
  assert.deepEqual(parseCoordinates('  40.4168   -3.7038 '), { lat: 40.4168, lon: -3.7038 });
  assert.deepEqual(parseCoordinates('40,4168; -3,7038'), { lat: 40.4168, lon: -3.7038 });
  assert.deepEqual(parseCoordinates('40,4168 -3,7038'), { lat: 40.4168, lon: -3.7038 });
  assert.equal(parseCoordinates('140.1, 20'), null);
  assert.equal(parseCoordinates('Calle Mayor 12'), null);
  assert.equal(parseCoordinates('12'), null);
});

test('parseCoordinates: degrees, minutes, seconds', () => {
  const p = parseCoordinates(`40°25'00.4"N 3°42'13.6"W`)!;
  near(p.lat, 40.416778, 1e-5);
  near(p.lon, -3.703778, 1e-5);
  const q = parseCoordinates(`N 40° 25.006' O 3° 42.227'`)!;
  near(q.lat, 40.41677, 1e-4);
  near(q.lon, -3.70378, 1e-4);
  const s = parseCoordinates(`33°52'S, 151°12'E`)!;
  near(s.lat, -33.8667, 1e-3);
  near(s.lon, 151.2, 1e-3);
  assert.equal(parseCoordinates(`40°75'N 3°W`), null);
});

test('parseCoordinates: UTM', () => {
  const p = parseCoordinates('30T 440290 4474258')!;
  near(p.lat, 40.416775, 2e-4);
  near(p.lon, -3.70379, 2e-4);
  const q = parseCoordinates('30 T 440290E 4474258N')!;
  near(q.lat, 40.416775, 2e-4);
  const south = parseCoordinates('56H 334369 6250948')!;
  near(south.lat, -33.8688, 1e-3);
  near(south.lon, 151.2093, 1e-3);
});

test('screenHeading turns the compass to the screen top', () => {
  // Facing north with the screen's top pointing north.
  assert.equal(screenHeading(0, 'portraitUp'), 0);
  assert.equal(screenHeading(90, 'landscapeLeft'), 0, 'device top points east');
  assert.equal(screenHeading(270, 'landscapeRight'), 0, 'device top points west');
  assert.equal(screenHeading(180, 'portraitDown'), 0);
  assert.equal(screenHeading(45, 'unknown'), 45);
  assert.equal(screenHeading(10, 'landscapeLeft'), 280);
  assert.equal(screenHeading(300, 'landscapeRight'), 30);
});

test('isFreshFix', () => {
  assert.equal(isFreshFix(1_000, 5_000, 4_000), true);
  assert.equal(isFreshFix(1_000, 5_000, 7_000), false);
});
