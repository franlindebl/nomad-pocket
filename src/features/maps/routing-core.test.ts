import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assetUrl,
  cumulativeDistances,
  decodePolyline,
  isOffRoute,
  maneuverIcon,
  packsCovering,
  parseManifest,
  parseTarHeader,
  parseRoute,
  pickPack,
  remainingSeconds,
  routeProgress,
  routeRequest,
  routingErrorKind,
  tarEntrySpan,
  tileBBox,
  tileCoverage,
  covers,
  cellOf,
  valhallaConfig,
} from './routing-core.ts';

const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b}`);

// Real answer of the mobile config (valhalla-defaults.json) on the Comunidad de Madrid
// tiles: Puerta del Sol → La Paz hospital by car, Spanish.
const MADRID = readFileSync(new URL('./fixtures/route-madrid-auto.json', import.meta.url), 'utf8');

test('decodePolyline (precision 5 reference and 6)', () => {
  // Google's documented example.
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
  assert.deepEqual(decodePolyline(''), []);
});

test('parseRoute reads distance, time, shape and Spanish maneuvers', () => {
  const r = parseRoute(MADRID, 'auto');
  near(r.distanceM, 8661, 1);
  near(r.durationS, 714, 1);
  assert.equal(r.maneuvers.length, 18);
  assert.equal(r.maneuvers[0].instruction, 'Conduzca hacia el noreste por Calle de Tetuán.');
  assert.equal(r.maneuvers[0].streets[0], 'Calle de Tetuán');
  assert.equal(r.maneuvers[3].instruction, 'Gire a la derecha hacia Gran Vía.');
  assert.equal(maneuverIcon(r.maneuvers[3].type), 'right');
  const last = r.maneuvers[r.maneuvers.length - 1];
  assert.equal(maneuverIcon(last.type), 'arrive');
  assert.equal(last.end, r.shape.length - 1);
  // Starts at Sol, ends near La Paz, bbox matches Valhalla's summary.
  near(r.shape[0][1], 40.4176, 0.001);
  near(r.shape[0][0], -3.7035, 0.001);
  near(r.bbox[3], 40.480135, 1e-5);
  near(r.bbox[0], -3.703795, 1e-5);
});

test('routeRequest', () => {
  const req = JSON.parse(
    routeRequest({ from: { lat: 40.4, lon: -3.7 }, to: { lat: 40.5, lon: -3.6 }, costing: 'pedestrian', language: 'es', heading: -10 }),
  );
  assert.equal(req.costing, 'pedestrian');
  assert.equal(req.language, 'es-ES');
  assert.equal(req.locations[0].heading, 350);
  assert.equal(req.locations[1].heading, undefined);
  assert.equal(req.exclude_polygons, undefined);
  const en = JSON.parse(
    routeRequest({
      from: { lat: 0, lon: 0 },
      to: { lat: 1, lon: 1 },
      costing: 'auto',
      language: 'en',
      avoid: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    }),
  );
  assert.equal(en.language, 'en-US');
  assert.equal(en.exclude_polygons.length, 1);
});

test('valhallaConfig fills the tile extract without touching the defaults', () => {
  const defaults = { mjolnir: { tile_extract: '/nonexistent', max_cache_size: 1 }, loki: { actions: ['route'] } };
  const c = JSON.parse(valhallaConfig(defaults, '/data/es.tar'));
  assert.equal(c.mjolnir.tile_extract, '/data/es.tar');
  assert.equal(c.mjolnir.max_cache_size, 1);
  assert.equal(defaults.mjolnir.tile_extract, '/nonexistent');
});

test('routingErrorKind', () => {
  assert.equal(routingErrorKind('valhalla 171: No suitable edges near location'), 'noRoad');
  assert.equal(routingErrorKind('valhalla 442: No path could be found for input'), 'noPath');
  assert.equal(routingErrorKind('valhalla 154: Path distance exceeds the max distance limit'), 'tooFar');
  assert.equal(routingErrorKind('valhalla -1: boom'), 'other');
  assert.equal(routingErrorKind('No routing pack is open'), 'other');
});

test('pickPack prefers the smallest pack covering both ends', () => {
  const spain = { id: 'es', bbox: [-9.4, 35.9, 4.4, 43.8] as [number, number, number, number], sizeBytes: 2e9 };
  const madrid = { id: 'es-md', bbox: [-4.6, 39.8, -3.0, 41.2] as [number, number, number, number], sizeBytes: 2e8 };
  const sol = { lat: 40.4168, lon: -3.7038 };
  assert.equal(pickPack([spain, madrid], sol, { lat: 40.48, lon: -3.68 })?.id, 'es-md');
  assert.equal(pickPack([spain, madrid], sol, { lat: 41.65, lon: -4.72 })?.id, 'es');
  assert.equal(pickPack([madrid], sol, { lat: 48.85, lon: 2.35 }), null);
});

test('routeProgress follows the route and spots leaving it', () => {
  const r = parseRoute(MADRID, 'auto');
  const cum = cumulativeDistances(r.shape);
  near(cum[cum.length - 1], r.distanceM, r.distanceM * 0.01, 'shape length ≈ route length');

  const start = routeProgress(r, cum, { lat: r.shape[0][1], lon: r.shape[0][0] });
  assert.equal(start.segment, 0);
  near(start.offRouteM, 0, 0.5);
  near(start.remainingM, cum[cum.length - 1], 1);
  assert.equal(start.next, 1);

  // On the Gran Vía turn's shape point: the next maneuver is the one after it.
  const turn = r.maneuvers[3];
  const at = { lat: r.shape[turn.begin + 2][1], lon: r.shape[turn.begin + 2][0] };
  const mid = routeProgress(r, cum, at, start.segment);
  assert.equal(mid.next, 4);
  near(mid.toNextM, cum[r.maneuvers[4].begin] - cum[turn.begin + 2], 1);
  assert.ok(mid.remainingM < start.remainingM);
  near(remainingSeconds(r, mid.remainingM), (r.durationS * mid.remainingM) / r.distanceM, 1e-9);

  // 300 m east of the start: off the route.
  const away = routeProgress(r, cum, { lat: r.shape[0][1], lon: r.shape[0][0] + 0.0035 });
  assert.ok(away.offRouteM > 100, `${away.offRouteM}`);
  assert.ok(isOffRoute(away.offRouteM, 10));
  assert.ok(!isOffRoute(30, 10));
  assert.ok(!isOffRoute(60, 70), 'a coarse fix is not proof of leaving the route');

  const end = routeProgress(r, cum, { lat: r.shape[r.shape.length - 1][1], lon: r.shape[r.shape.length - 1][0] }, mid.segment);
  near(end.remainingM, 0, 1);
  assert.equal(end.next, r.maneuvers.length - 1);
});

test('tileBBox from the Comunidad de Madrid pack tile names', () => {
  const names = (
    'index.bin 0/002/923.gph 0/002/924.gph 1/046/616.gph 1/046/975.gph 2/000/748/064.gph 2/000/748/067.gph 2/000/749/501.gph ' +
    '2/000/750/947.gph 2/000/752/382.gph 2/000/753/826.gph 2/000/755/264.gph 2/000/755/266.gph'
  ).split(' ');
  assert.deepEqual(tileBBox(names), [-4.75, 39.75, -3, 41.25]);
  // Only highways (level 0, 4°): coarse but still a box.
  assert.deepEqual(tileBBox(['0/002/923.gph']), [-8, 38, -4, 42]);
  assert.equal(tileBBox(['index.bin', 'readme.txt']), null);
});

test('parseTarHeader and tarEntrySpan', () => {
  const block = new Uint8Array(512);
  const put = (at: number, text: string) => [...text].forEach((c, i) => (block[at + i] = c.charCodeAt(0)));
  put(0, '2/000/748/064.gph');
  put(124, '00000001750\0');
  assert.deepEqual(parseTarHeader(block), { name: '2/000/748/064.gph', size: 1000 });
  put(345, 'valhalla');
  assert.equal(parseTarHeader(block)!.name, 'valhalla/2/000/748/064.gph');
  assert.equal(parseTarHeader(new Uint8Array(512)), null);
  assert.equal(tarEntrySpan(1000), 512 + 1024);
  assert.equal(tarEntrySpan(0), 512);
  assert.equal(tarEntrySpan(512), 1024);
});

// What scripts/routing/manifest.py wrote for the Andorra test build.
const MANIFEST = JSON.stringify({
  version: 1,
  release: 'routing-20261024',
  generated: '2026-10-25T07:36:30Z',
  valhalla: '3.9.1',
  packs: [
    {
      id: 'ad',
      country: 'ad',
      regionId: 'ad',
      buildDate: '20261024',
      bbox: [1.25, 42.25, 2.0, 42.75],
      size: 3164160,
      parts: [{ name: 'ad.tar', size: 3164160, sha256: 'f552' }],
      pois: { name: 'ad.pois.tsv', size: 29918, sha256: '1054' },
    },
    { id: 'es', country: 'es', regionId: 'es', buildDate: '20261024', bbox: [-18.25, 27.5, 4.5, 44], size: 2.2e9, parts: [
      { name: 'es.tar.part00', size: 1992294400, sha256: 'a' },
      { name: 'es.tar.part01', size: 207705600, sha256: 'b' },
    ], pois: null },
    { id: '../evil', bbox: [0, 0, 1, 1], parts: [{ name: 'x', size: 1 }] },
    { id: 'nobox', parts: [{ name: 'x', size: 1 }] },
  ],
});

test('parseManifest keeps well-formed packs only', () => {
  const m = parseManifest(MANIFEST)!;
  assert.deepEqual(
    m.packs.map((p) => p.id),
    ['ad', 'es'],
  );
  assert.equal(m.packs[1].parts.length, 2);
  assert.equal(parseManifest('{"version":2,"release":"x","packs":[]}'), null);
  assert.equal(parseManifest('not json'), null);
});

test('assetUrl and packsCovering', () => {
  const m = parseManifest(MANIFEST)!;
  assert.equal(assetUrl(m, m.packs[0], 'ad.tar', 'franlindebl/nomad-pocket'), 'https://github.com/franlindebl/nomad-pocket/releases/download/routing-20261024/ad.tar');
  assert.equal(
    assetUrl(m, { release: 'routing-20260905' }, 'pt.tar', 'franlindebl/nomad-pocket'),
    'https://github.com/franlindebl/nomad-pocket/releases/download/routing-20260905/pt.tar',
  );
  assert.equal(assetUrl({ ...m, baseUrl: 'http://localhost:8765/' }, m.packs[0], 'ad.tar', 'x/y'), 'http://localhost:8765/ad.tar');
  assert.deepEqual(
    // Spain's tiles reach over Andorra: the smaller pack first.
    packsCovering(m.packs, { lat: 42.5, lon: 1.52 }).map((p) => p.id),
    ['ad', 'es'],
  );
  assert.deepEqual(
    packsCovering(m.packs, { lat: 40.4, lon: -3.7 }).map((p) => p.id),
    ['es'],
  );
});

test('coverage cells: a pack covers where it has roads, not its whole bbox', () => {
  const madrid = tileCoverage(['2/000/748/064.gph', '2/000/748/067.gph', '2/000/749/501.gph', '2/000/755/266.gph'])!;
  const sol = { lat: 40.4168, lon: -3.7038 };
  assert.ok(madrid.cells.includes(cellOf(sol)) || covers(madrid, { lat: 39.8, lon: -3.9 }));
  // A pack shaped like Spain's tiles: wide bbox, cells only where the roads are.
  const spain = { bbox: [-18.25, 27.5, 4.5, 44] as [number, number, number, number], cells: [cellOf(sol)] };
  assert.ok(covers(spain, sol));
  assert.ok(!covers(spain, { lat: 38.72, lon: -9.14 }), 'Lisbon is in the bbox but not in the cells');
  assert.ok(covers({ bbox: spain.bbox }, { lat: 38.72, lon: -9.14 }), 'no cells: bbox only');
  // A 4° highway tile spans 16 cells.
  assert.equal(tileCoverage(['0/002/923.gph'])!.cells.length, 16);
  assert.equal(cellOf({ lat: -90, lon: -180 }), 0);
  assert.equal(cellOf({ lat: 0.5, lon: 0.5 }), 90 * 360 + 180);
});
