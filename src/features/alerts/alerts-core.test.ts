import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  byUrgency,
  covers,
  current,
  decide,
  distanceKm,
  hazardOfAemet,
  hazardOfEvent,
  hazardOfMeteoalarm,
  inPolygons,
  iso2Of,
  levelOfCap,
  levelOfGdacs,
  levelOfSeverity,
  mergeQuakes,
  quakeLevel,
  quakeMatters,
  snap,
  sourcesFor,
  textFor,
  visible,
  timeSensitive,
  type Alert,
  type Notified,
} from './alerts-core.ts';

const H = 3600_000;
const NOW = Date.parse('2026-11-05T12:00:00Z');

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'A1',
  source: 'aemet',
  kind: 'weather',
  hazard: 'rain',
  level: 'orange',
  msgType: 'alert',
  references: [],
  topic: 'aemet:733005:PR.P1',
  sent: NOW - 2 * H,
  onset: NOW + H,
  expires: NOW + 10 * H,
  area: 'Campo de Cartagena y Mazarrón',
  texts: { es: { event: 'Aviso', headline: 'Titular', description: 'Desc', instruction: '' } },
  original: 'es',
  ...over,
});

const quake = (id: string, source: 'usgs' | 'emsc', mag: number, lat: number, lon: number, sent = NOW - H): Alert =>
  alert({
    id,
    source,
    kind: 'quake',
    hazard: 'quake',
    level: quakeLevel(mag),
    topic: '',
    sent,
    onset: sent,
    expires: null,
    point: { lat, lon },
    mag,
  });

test('levels: AEMET nivel, MeteoAlarm awareness_level, CAP severity, GDACS', () => {
  assert.equal(levelOfCap({ 'AEMET-Meteoalerta nivel': 'naranja' }, 'Minor'), 'orange', 'nivel wins over severity');
  assert.equal(levelOfCap({ 'AEMET-Meteoalerta nivel': 'rojo' }, ''), 'red');
  assert.equal(levelOfCap({ 'AEMET-Meteoalerta nivel': 'amarillo' }, ''), 'yellow');
  assert.equal(levelOfCap({ 'AEMET-Meteoalerta nivel': 'verde' }, 'Minor'), null);
  assert.equal(levelOfCap({ awareness_level: '2; yellow; Moderate' }, 'Moderate'), 'yellow');
  assert.equal(levelOfCap({ awareness_level: '3; orange; Severe' }, ''), 'orange');
  assert.equal(levelOfCap({ awareness_level: '4; red; Extreme' }, ''), 'red');
  assert.equal(levelOfCap({ awareness_level: '1; green; Minor' }, 'Minor'), null);
  assert.equal(levelOfCap({}, 'Extreme'), 'red');
  assert.equal(levelOfSeverity('Severe'), 'orange');
  assert.equal(levelOfSeverity('Minor'), 'yellow');
  assert.equal(levelOfSeverity('Unknown'), null);
  assert.equal(levelOfGdacs('Red'), 'red');
  assert.equal(levelOfGdacs('Orange'), 'orange');
  assert.equal(levelOfGdacs('Green'), null);
});

test('hazards from AEMET, MeteoAlarm and English event names', () => {
  assert.equal(hazardOfAemet('PR;Lluvias'), 'rain');
  assert.equal(hazardOfAemet('AT;Temperaturas máximas'), 'heat');
  assert.equal(hazardOfAemet('RI;Rissagas'), 'coastal');
  assert.equal(hazardOfAemet('XX;Nuevo'), 'other');
  assert.equal(hazardOfMeteoalarm('10; Rain'), 'rain');
  assert.equal(hazardOfMeteoalarm('3; Thunderstorm'), 'storm');
  assert.equal(hazardOfMeteoalarm('8; forest-fire'), 'fire');
  assert.equal(hazardOfEvent('Tornado Warning'), 'tornado');
  assert.equal(hazardOfEvent('Tsunami Advisory'), 'tsunami');
  assert.equal(hazardOfEvent('Hurricane Warning'), 'cyclone');
  assert.equal(hazardOfEvent('Flash Flood Warning'), 'flood');
  assert.equal(hazardOfEvent('Excessive Heat Warning'), 'heat');
  assert.equal(hazardOfEvent('Winter Storm Warning'), 'snow');
  assert.equal(hazardOfEvent('Severe Thunderstorm Warning'), 'storm');
  assert.equal(hazardOfEvent('High Wind Warning'), 'wind');
  assert.equal(hazardOfEvent('Moderate rain warning'), 'rain');
  assert.equal(hazardOfEvent('Child Abduction Emergency'), 'other');
  // MeteoAlarm's English event names (DWD's feed, 2026-11-12): "surfaces" isn't surf, gusts are wind.
  assert.equal(hazardOfEvent('icy surfaces'), 'snow');
  assert.equal(hazardOfEvent('gale-force gusts'), 'wind');
  assert.equal(hazardOfEvent('wind gusts'), 'wind');
  assert.equal(hazardOfEvent('heavy thunderstorms with gale- or storm-force gusts'), 'storm');
  assert.equal(hazardOfEvent('Gale Warning'), 'coastal');
  assert.equal(hazardOfEvent('High Surf Advisory'), 'coastal');
});

test('geometry: point in rings, distance, snapping', () => {
  const square = [0, 0, 2, 0, 2, 2, 0, 2, 0, 0];
  assert.ok(inPolygons([square], { lat: 1, lon: 1 }));
  assert.ok(!inPolygons([square], { lat: 3, lon: 1 }));
  assert.ok(inPolygons([[10, 10, 11, 10, 11, 11, 10, 10], square], { lat: 0.5, lon: 1.5 }), 'any ring');
  assert.ok(Math.abs(distanceKm({ lat: 40.4168, lon: -3.7038 }, { lat: 41.3874, lon: 2.1686 }) - 505) < 3, 'Madrid–Barcelona');
  assert.deepEqual(snap({ lat: 30.3812, lon: -93.1388 }, 0.05), { lat: 30.4, lon: -93.15 });
  assert.deepEqual(snap({ lat: 37.62574, lon: -0.99664 }, 0.001), { lat: 37.626, lon: -0.997 });
  assert.deepEqual(snap({ lat: -0.0001, lon: 0.0004 }, 0.05), { lat: 0, lon: 0 });
});

test('quake rule: M ≥ 4.5 within 100 km, or M ≥ 6 within 500 km', () => {
  const here = { lat: 37.18, lon: -3.6 }; // Granada
  const at = (mag: number, km: number) => quakeMatters({ mag, point: { lat: here.lat + km / 111.2, lon: here.lon } }, here);
  assert.ok(at(4.5, 90));
  assert.ok(!at(4.4, 50));
  assert.ok(!at(5.9, 150));
  assert.ok(at(6, 450));
  assert.ok(!at(7.5, 550));
  assert.ok(!quakeMatters({ point: here }, here), 'no magnitude');
  assert.equal(quakeLevel(6), 'red');
  assert.equal(quakeLevel(4.5), 'orange');
});

test('mergeQuakes: same event within 60 s and 100 km → one, the higher magnitude, the other id kept as reference', () => {
  const emsc = quake('E1', 'emsc', 5.1, 36.0, -3.0, NOW - H);
  const usgs = quake('U1', 'usgs', 5.3, 36.2, -3.1, NOW - H + 20_000);
  const later = quake('U2', 'usgs', 5.0, 36.0, -3.0, NOW - H + 5 * 60_000);
  const far = quake('E2', 'emsc', 5.0, 39.0, -3.0, NOW - H);
  const merged = mergeQuakes([emsc, usgs, later, far]);
  assert.deepEqual(
    merged.map((q) => [q.id, q.mag, q.references]),
    [
      ['U1', 5.3, ['E1']],
      ['U2', 5, []],
      ['E2', 5, []],
    ],
  );
});

test('current: expired, cancelled and superseded alerts are dropped', () => {
  const old = alert({ id: 'A0' });
  const update = alert({ id: 'A1', msgType: 'update', references: ['A0'] });
  const expired = alert({ id: 'B1', topic: 'x', expires: NOW - 1 });
  const cancelled = alert({ id: 'C1', topic: 'y' });
  const cancel = alert({ id: 'C2', topic: 'y', msgType: 'cancel', references: ['C1'] });
  const otherSource = alert({ id: 'A0', source: 'meteoalarm' });
  const open = alert({ id: 'D1', expires: null });
  assert.deepEqual(
    current([old, update, expired, cancelled, cancel, otherSource, open], NOW).map((a) => `${a.source}:${a.id}`),
    ['aemet:A1', 'meteoalarm:A0', 'aemet:D1'],
  );
  const q = quake('U1', 'usgs', 5, 36, -3);
  assert.equal(
    current([q, { ...quake('E1', 'emsc', 5, 36, -3), references: ['U1'] }], NOW).length,
    2,
    'quake references are siblings, not updates',
  );
});

test('covers: polygons need the position, GDACS goes by country, MeteoAlarm by zone, NWS always, quakes by the rule', () => {
  const ring = [-1.1, 37.5, -0.8, 37.5, -0.8, 37.8, -1.1, 37.8, -1.1, 37.5];
  const inside = { lat: 37.62, lon: -0.99 };
  assert.ok(covers(alert({ polygons: [ring] }), { pos: inside, country: 'es' }));
  assert.ok(!covers(alert({ polygons: [ring] }), { pos: { lat: 40, lon: -3 }, country: 'es' }));
  assert.ok(!covers(alert({ polygons: [ring] }), { pos: null, country: 'es' }));
  assert.ok(covers(alert({ source: 'gdacs', kind: 'disaster', countries: ['bd'] }), { pos: null, country: 'bd' }));
  assert.ok(!covers(alert({ source: 'gdacs', kind: 'disaster', countries: ['bd'] }), { pos: null, country: null }));
  assert.ok(covers(alert({ source: 'meteoalarm', codes: ['ES084'] }), { pos: null, country: 'es', codes: ['ES084'] }));
  assert.ok(!covers(alert({ source: 'meteoalarm', codes: ['ES084'] }), { pos: null, country: 'es' }));
  assert.ok(covers(alert({ source: 'nws' }), { pos: null, country: 'us' }));
  assert.ok(covers(quake('U1', 'usgs', 4.8, 37.7, -1.0), { pos: inside, country: 'es' }));
  assert.ok(!covers(quake('U1', 'usgs', 4.8, 37.7, -1.0), { pos: null, country: 'es' }));
  assert.ok(!covers(alert({ polygons: [], codes: [] }), { pos: inside, country: 'es' }), 'nothing to match on');
});

test('decide: a new orange notifies once; a repeat, an update or a re-issue of the same warning do not', () => {
  const first = decide([alert()], {}, { now: NOW });
  assert.deepEqual(
    first.notify.map((a) => a.id),
    ['A1'],
  );
  assert.deepEqual(first.notified, { A1: { level: 'orange', topic: 'aemet:733005:PR.P1', until: NOW + 10 * H } });

  assert.equal(decide([alert()], first.notified, { now: NOW + H }).notify.length, 0, 'next check');
  const update = alert({ id: 'A2', msgType: 'update', references: ['A1'] });
  const afterUpdate = decide([update], first.notified, { now: NOW + H });
  assert.equal(afterUpdate.notify.length, 0, 'update at the same level');
  assert.equal(afterUpdate.notified.A2.level, 'orange');
  const reissue = alert({ id: 'A3', references: ['A-missed'] });
  assert.equal(decide([reissue], first.notified, { now: NOW + H }).notify.length, 0, 'same topic while the first is in force');
});

test('decide: a raise notifies again; a lower or yellow one does not; tomorrow’s separate warning does', () => {
  const { notified } = decide([alert()], {}, { now: NOW });
  const red = alert({ id: 'A2', level: 'red', references: ['A1'] });
  const raised = decide([red], notified, { now: NOW + H });
  assert.deepEqual(
    raised.notify.map((a) => a.id),
    ['A2'],
  );
  const lowered = alert({ id: 'A3', level: 'orange', references: ['A2'] });
  const afterLower = decide([lowered], raised.notified, { now: NOW + 2 * H });
  assert.equal(afterLower.notify.length, 0);
  assert.equal(afterLower.notified.A3.level, 'red', 'the record keeps the highest level notified');
  assert.equal(decide([alert({ id: 'Y', topic: 'other', level: 'yellow' })], {}, { now: NOW }).notify.length, 0);
  assert.equal(decide([alert({ id: 'Y', topic: 'other', level: 'yellow' })], {}, { now: NOW, minLevel: 'yellow' }).notify.length, 1);
  assert.equal(decide([alert({ id: 'O', topic: 'other' })], {}, { now: NOW, minLevel: 'red' }).notify.length, 0);
  const tomorrow = alert({ id: 'T1', onset: NOW + 24 * H, expires: NOW + 30 * H });
  assert.equal(decide([tomorrow], notified, { now: NOW + H }).notify.length, 1, 'starts after the first one ended');
});

test('decide: quakes notify once under either source id, and not when the check comes too late', () => {
  const emsc = quake('E1', 'emsc', 5.0, 37.3, -3.6);
  const first = decide([emsc], {}, { now: NOW });
  assert.equal(first.notify.length, 1);
  const [merged] = mergeQuakes([emsc, quake('U1', 'usgs', 5.2, 37.3, -3.6, emsc.sent! + 10_000)]);
  assert.equal(merged.id, 'U1');
  assert.equal(decide([merged], first.notified, { now: NOW + 600_000 }).notify.length, 0, 'USGS id, already notified as EMSC');
  const old = quake('U9', 'usgs', 6.5, 37.3, -3.6, NOW - 7 * H);
  const late = decide([old], {}, { now: NOW });
  assert.equal(late.notify.length, 0, 'older than 6 h: listed, not rung');
  assert.ok(late.notified.U9, 'still recorded');
  assert.equal(decide([old], {}, { now: NOW, quakeMaxAgeMs: 8 * H }).notify.length, 1);
});

test('decide: records are pruned two days after their end; notifications come most serious first', () => {
  const stale: Notified = {
    OLD: { level: 'red', topic: 't', until: NOW - 3 * 24 * H },
    KEEP: { level: 'red', topic: 'k', until: NOW - 24 * H },
  };
  const out = decide([alert({ id: 'O', topic: 'o' }), alert({ id: 'R', topic: 'r', level: 'red', onset: NOW + 5 * H })], stale, {
    now: NOW,
  });
  assert.deepEqual(Object.keys(out.notified).sort(), ['KEEP', 'O', 'R']);
  assert.deepEqual(
    out.notify.map((a) => a.id),
    ['R', 'O'],
  );
  const sooner = alert({ id: 'S', onset: NOW });
  assert.ok(byUrgency(sooner, alert({ id: 'L', onset: NOW + H })) < 0);
});

test("visible: covering alerts with quakes merged; without a position, the country's orange and red only", () => {
  const ring = [-1.1, 37.5, -0.8, 37.5, -0.8, 37.8, -1.1, 37.8, -1.1, 37.5];
  const here = { lat: 37.62, lon: -0.99 };
  const all = [
    alert({ id: 'Y', level: 'yellow', topic: 'y', polygons: [ring] }),
    alert({ id: 'O', topic: 'o', polygons: [ring] }),
    alert({ id: 'FAR', topic: 'f', level: 'red', polygons: [[10, 10, 11, 10, 11, 11, 10, 10]] }),
    alert({ id: 'OLD', topic: 'old', polygons: [ring], expires: NOW - 1 }),
    quake('E1', 'emsc', 5.0, 37.7, -1.0),
    quake('U1', 'usgs', 5.1, 37.7, -1.0, NOW - H + 5000),
    alert({ id: 'G', source: 'gdacs', kind: 'disaster', hazard: 'flood', topic: 'g', countries: ['es'] }),
  ];
  const near = visible(all, { pos: here, country: 'es' }, NOW);
  assert.equal(near.nearby, true);
  assert.deepEqual(
    near.alerts.map((a) => a.id),
    ['U1', 'O', 'G', 'Y'],
  );
  const country = visible(all, { pos: null, country: 'es' }, NOW);
  assert.equal(country.nearby, false);
  assert.deepEqual(
    country.alerts.map((a) => a.id),
    ['FAR', 'O', 'G'],
  );
});

test('timeSensitive: red and tsunamis', () => {
  assert.ok(timeSensitive(alert({ level: 'red' })));
  assert.ok(timeSensitive(alert({ kind: 'tsunami', level: 'orange' })));
  assert.ok(!timeSensitive(alert()));
});

test('sourcesFor: AEMET in Spain, NWS in the US, GDACS elsewhere; quakes everywhere', () => {
  assert.deepEqual(sourcesFor('es'), ['aemet', 'usgs', 'emsc']);
  assert.deepEqual(sourcesFor('us'), ['nws', 'usgs', 'emsc']);
  assert.deepEqual(sourcesFor('fr'), ['gdacs', 'usgs', 'emsc']);
  assert.deepEqual(sourcesFor(null), ['gdacs', 'usgs', 'emsc']);
});

test('textFor: the app language, else English, else the original', () => {
  const es = { event: 'e', headline: 'es', description: '', instruction: '' };
  const en = { ...es, headline: 'en' };
  const de = { ...es, headline: 'de' };
  assert.equal(textFor(alert({ texts: { es, en } }), 'es').headline, 'es');
  assert.equal(textFor(alert({ texts: { es, en } }), 'fr').headline, 'en');
  assert.equal(textFor(alert({ texts: { de }, original: 'de' }), 'es').headline, 'de');
  assert.equal(textFor(alert({ texts: {} }), 'es').headline, '');
});

test('iso2Of', () => {
  assert.equal(iso2Of('ESP'), 'es');
  assert.equal(iso2Of('usa'), 'us');
  assert.equal(iso2Of('BGD'), 'bd');
  assert.equal(iso2Of('GBR'), 'gb');
  assert.equal(iso2Of('XKX'), 'xk');
  assert.equal(iso2Of(''), null);
  assert.equal(iso2Of('ZZZ'), null);
});
