import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { alertsOfAemetBundle, parseUsgs, xmlFilesOfTarGz, type Alert } from './core.ts';
import { coversCell, matching, plan, pushedSources, snapCell, type Registration } from './match.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../src/features/alerts/fixtures/${name}`, import.meta.url));

const aemet = alertsOfAemetBundle(xmlFilesOfTarGz(new Uint8Array(fixture('aemet-afae.tar.gz'))));
const usgs = parseUsgs(JSON.parse(fixture('usgs-4.5_day.geojson').toString()));

const reg = (over: Partial<Registration>): Registration => ({
  platform: 'ios',
  token: 'aa',
  env: 'sandbox',
  cell: { lat: 40.4, lon: -3.7 },
  country: 'es',
  lang: 'es',
  timeZone: 'Europe/Madrid',
  prefs: { minLevel: 'orange', quakes: true },
  notified: {},
  ...over,
});

/** A point well inside the first ring of an alert (its vertex average is enough for AEMET's convex-ish zones). */
function inside(a: Alert) {
  const ring = a.polygons![0];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < ring.length; i += 2) {
    lon += ring[i];
    lat += ring[i + 1];
  }
  const n = ring.length / 2;
  return { lat: lat / n, lon: lon / n };
}

test('cells snap to their south-west corner', () => {
  assert.deepEqual(snapCell({ lat: 40.4168, lon: -3.7038 }), { lat: 40.4, lon: -3.8 });
  assert.deepEqual(snapCell({ lat: 28.1, lon: -15.43 }), { lat: 28.1, lon: -15.5 });
});

test('Spain gets AEMET and quakes from the server; the US keeps NWS on the phone', () => {
  assert.deepEqual(pushedSources('es'), ['aemet', 'usgs', 'emsc']);
  assert.deepEqual(pushedSources('us'), ['usgs', 'emsc']);
  assert.deepEqual(pushedSources('fr'), ['gdacs', 'usgs', 'emsc']);
});

test('an orange AEMET warning reaches a cell inside it once, in Spanish, then not again', () => {
  const a = aemet.find((x) => x.level === 'orange' && x.polygons?.length && x.msgType !== 'cancel');
  assert.ok(a, 'fixture has an orange warning with an area');
  const now = (a.onset ?? a.sent ?? 0) + 60_000;
  const r = reg({ cell: snapCell(inside(a)) });
  assert.ok(coversCell(a, r));
  const first = plan(aemet, r, now);
  const push = first.pushes.find((p) => p.key === `aemet:${a.id}`) ?? first.pushes.find((p) => p.collapseId === 'alert:more');
  assert.ok(push, 'pushed');
  if (push.key) assert.match(push.title, /^Aviso naranja · /);
  const again = plan(aemet, { ...r, notified: first.notified }, now + 60_000);
  assert.equal(again.pushes.length, 0);
});

test('a seeded registration records what covers it without pushing', () => {
  const a = aemet.find((x) => x.level === 'orange' && x.polygons?.length && x.msgType !== 'cancel')!;
  const now = (a.onset ?? a.sent ?? 0) + 60_000;
  const r = reg({ cell: snapCell(inside(a)) });
  const seeded = plan(aemet, r, now, true);
  assert.equal(seeded.pushes.length, 0);
  assert.ok(seeded.notified[a.id]);
  assert.equal(plan(aemet, { ...r, notified: seeded.notified }, now).pushes.length, 0);
});

test('yellow stays quiet with the default threshold; a cell far away gets nothing', () => {
  const y = aemet.find((x) => x.level === 'yellow' && x.polygons?.length && x.msgType !== 'cancel');
  if (y) {
    const now = (y.onset ?? y.sent ?? 0) + 60_000;
    const r = reg({ cell: snapCell(inside(y)) });
    assert.ok(!plan([y], r, now).pushes.some((p) => p.key === `aemet:${y.id}`));
    assert.ok(plan([y], { ...r, prefs: { minLevel: 'yellow', quakes: true } }, now).pushes.some((p) => p.key === `aemet:${y.id}`));
  }
  const now = Math.max(...aemet.map((x) => x.sent ?? 0));
  assert.equal(matching(aemet, reg({ cell: { lat: 60, lon: 20 }, country: 'es' }), now).length, 0);
});

test('a quake near the cell is pushed with distance; quakes off or far away are not', () => {
  const q = usgs.find((x) => x.point && (x.mag ?? 0) >= 4.5);
  assert.ok(q, 'fixture has a quake');
  const now = (q.sent ?? 0) + 5 * 60_000;
  const near = reg({ cell: snapCell({ lat: q.point!.lat + 0.2, lon: q.point!.lon }), country: null, timeZone: 'UTC', lang: 'en' });
  const p = plan(usgs, near, now).pushes;
  assert.equal(p.length, 1);
  assert.match(p[0].title, /^Earthquake M /);
  assert.match(p[0].body, /km/);
  assert.equal(plan(usgs, { ...near, prefs: { minLevel: 'orange', quakes: false } }, now).pushes.length, 0);
  const far = { ...near, cell: snapCell({ lat: q.point!.lat > 0 ? q.point!.lat - 30 : q.point!.lat + 30, lon: q.point!.lon }) };
  assert.equal(plan(usgs, far, now).pushes.length, (q.mag ?? 0) >= 6 ? p.length : 0);
});
