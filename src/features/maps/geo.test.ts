import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bboxAround,
  bboxesOverlap,
  bboxHas,
  lonDelta,
  lonRanges,
  lonSql,
  nearOrderSql,
  bearingDegrees,
  compassSector,
  distanceMeters,
  formatUtm,
  fromUtm,
  isFreshFix,
  knownOrientation,
  parseCoordinates,
  screenHeading,
  toUtm,
} from './geo.ts';

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

test('knownOrientation: an unknown one is portrait only on a portrait-shaped screen', () => {
  const tall = { width: 390, height: 844 };
  const wide = { width: 844, height: 390 };
  assert.equal(knownOrientation('landscapeLeft', tall), 'landscapeLeft');
  assert.equal(knownOrientation('unknown', tall), 'portraitUp');
  assert.equal(knownOrientation('unknown', wide), null);
});

test('isFreshFix', () => {
  assert.equal(isFreshFix(1_000, 5_000, 4_000), true);
  assert.equal(isFreshFix(1_000, 5_000, 7_000), false);
});

// --- Boxes across the antimeridian ---------------------------------------------

const FIJI: [number, number, number, number] = [176.8, -20.7, -178.2, -12.4];
const CHUKOTKA: [number, number, number, number] = [160.0, 62.0, -169.0, 71.6];
const ALEUTIANS: [number, number, number, number] = [172.4, 51.2, -129.9, 55.0];
const SPAIN: [number, number, number, number] = [-9.4, 35.9, 4.4, 43.8];

test('lonRanges: a normal box stays one range, a crossing one is cut at 180', () => {
  assert.deepEqual(lonRanges(-9.4, 4.4), [[-9.4, 4.4]]);
  assert.deepEqual(lonRanges(176.8, -178.2), [
    [176.8, 180],
    [-180, -178.2],
  ]);
  assert.deepEqual(lonRanges(-180, 180), [[-180, 180]]);
  assert.deepEqual(lonRanges(-200, 200), [[-180, 180]]);
});

test('lonRanges: unwrapped boxes (a camera panned past 180) are folded back', () => {
  assert.deepEqual(lonRanges(179, 181), [
    [179, 180],
    [-180, -179],
  ]);
  assert.deepEqual(lonRanges(-181, -179), [
    [179, 180],
    [-180, -179],
  ]);
  assert.deepEqual(lonRanges(181, 183), [[-179, -177]]);
});

test('bboxHas: Spain, Fiji, Chukotka and the Aleutians', () => {
  assert.ok(bboxHas(SPAIN, { lat: 40.4, lon: -3.7 }));
  assert.ok(!bboxHas(SPAIN, { lat: 40.4, lon: 178 }));
  // Suva (178.4 E) and Taveuni (179.9 W) are in; Samoa and Greenwich are not.
  assert.ok(bboxHas(FIJI, { lat: -18.14, lon: 178.44 }));
  assert.ok(bboxHas(FIJI, { lat: -16.8, lon: -179.9 }));
  assert.ok(!bboxHas(FIJI, { lat: -13.8, lon: -172.1 }));
  assert.ok(!bboxHas(FIJI, { lat: -18.14, lon: 0 }));
  assert.ok(!bboxHas(FIJI, { lat: 10, lon: 178.44 }));
  assert.ok(bboxHas(CHUKOTKA, { lat: 64.7, lon: 177.5 })); // Anadyr
  assert.ok(bboxHas(CHUKOTKA, { lat: 66.1, lon: -171 }));
  assert.ok(!bboxHas(CHUKOTKA, { lat: 64.7, lon: 100 }));
  assert.ok(bboxHas(ALEUTIANS, { lat: 52, lon: 175 })); // Attu
  assert.ok(bboxHas(ALEUTIANS, { lat: 53.9, lon: -166.5 })); // Unalaska
  assert.ok(!bboxHas(ALEUTIANS, { lat: 53.9, lon: -100 }));
  // 180 itself, and a longitude written unwrapped.
  assert.ok(bboxHas(FIJI, { lat: -17, lon: 180 }));
  assert.ok(bboxHas(FIJI, { lat: -17, lon: 181.5 }));
});

test('bboxesOverlap works across 180 degrees', () => {
  assert.ok(bboxesOverlap(FIJI, [177, -19, 178, -18])); // Viti Levu
  assert.ok(bboxesOverlap(FIJI, [-180, -19, -179, -18]));
  assert.ok(bboxesOverlap(FIJI, [179, -19, -179, -18])); // both crossing
  assert.ok(!bboxesOverlap(FIJI, [-10, -19, 10, -18]));
  assert.ok(!bboxesOverlap(FIJI, [177, 10, 178, 20]));
  assert.ok(bboxesOverlap(SPAIN, [-3, 40, -2, 41]));
  assert.ok(!bboxesOverlap(SPAIN, [177, 40, 178, 41]));
});

test('lonSql: one BETWEEN for a normal box, two joined by OR across 180', () => {
  assert.deepEqual(lonSql('lon', -9.4, 4.4), { sql: 'lon BETWEEN ? AND ?', params: [-9.4, 4.4] });
  assert.deepEqual(lonSql('lon', 176.8, -178.2), { sql: '(lon BETWEEN ? AND ? OR lon BETWEEN ? AND ?)', params: [176.8, 180, -180, -178.2] });
  // Scaled integer columns round outwards, per range.
  assert.deepEqual(lonSql('a.lon', 0.123456, 0.2, 1e5).params, [12345, 20000]);
});

test('bboxAround near Fiji gives a box lonSql can split', () => {
  const [w, , e] = bboxAround({ lat: -16.8, lon: 179.99 }, 30_000);
  assert.ok(e > 180);
  const ranges = lonRanges(w, e);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0][1], 180);
  assert.equal(ranges[1][0], -180);
  assert.ok(ranges[1][1] < -179.5);
});

test('nearOrderSql shifts longitudes only for a crossing box', () => {
  const plain = nearOrderSql({ lat: 1, lon: 2 }, 0.5, false);
  assert.ok(!plain.sql.includes('CASE'));
  assert.deepEqual(plain.params, [1, 1, 2, 2, 0.5]);
  const cross = nearOrderSql({ lat: -17, lon: -179.9 }, 0.9, true);
  assert.ok(cross.sql.includes('CASE'));
  assert.deepEqual(cross.params, [-17, -17, 180.1, 180.1, 0.9]);
});

test('lonDelta takes the short way round', () => {
  assert.ok(Math.abs(lonDelta(179, -179) - 2) < 1e-9);
  assert.ok(Math.abs(lonDelta(-179, 179) + 2) < 1e-9);
  assert.equal(lonDelta(10, 20), 10);
});
