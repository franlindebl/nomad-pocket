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
  packToFetch,
  parseManifest,
  parseTarHeader,
  parseRoute,
  pickPack,
  pointAlong,
  remainingSeconds,
  routeProgress,
  routeRequest,
  routingErrorKind,
  tarEntrySpan,
  tileBBox,
  tileCoverage,
  covers,
  cellOf,
  engineReads,
  ENGINE_VALHALLA,
  fileIntegrity,
  valhallaConfig,
  type ManifestPack,
} from './routing-core.ts';
import { bearingDegrees } from './geo.ts';

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
  assert.deepEqual(req.locations[0].search_filter, { exclude_tunnel: true }, 'on foot, paths are fine ends; tunnels are not');
  assert.deepEqual(req.locations[1].search_filter, { exclude_tunnel: true });
  assert.equal(req.costing_options.pedestrian.max_hiking_difficulty, 2, 'mountain trails (T2), not just T1');
  const reroute = JSON.parse(
    routeRequest({ from: { lat: 40.4, lon: -3.7 }, to: { lat: 40.5, lon: -3.6 }, costing: 'bicycle', language: 'es', rerouting: true }),
  );
  assert.equal(reroute.locations[0].search_filter, undefined, 'rerouting: the user may be in the tunnel');
  assert.deepEqual(reroute.locations[1].search_filter, { exclude_tunnel: true });
  assert.equal(reroute.costing_options, undefined);
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
  // By car, never start in a garage: both ends snap to a street.
  assert.deepEqual(en.locations[0].search_filter, { min_road_class: 'residential', exclude_tunnel: true });
  assert.deepEqual(en.locations[1].search_filter, { min_road_class: 'residential', exclude_tunnel: true });
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
  assert.equal(end.roadBearing, null, 'nothing ahead at the end');

  // The road right here: from the start to 20 m along (by car; nothing behind the start).
  const here = { lat: r.shape[0][1], lon: r.shape[0][0] };
  near(start.roadBearing ?? -1, bearingDegrees(here, pointAlong(r.shape, cum, 20)!), 0.5);
  near(start.alongM, 0, 0.5);
  near(mid.alongM, cum[turn.begin + 2], 1);
  near(mid.snapped!.lat, at.lat, 1e-6);
});

test('roadBearing turns at the corner, not before it', () => {
  // East 200 m, then north 200 m (about 0.0018° each way at the equator).
  const shape: [number, number][] = [
    [0, 0],
    [0.0018, 0],
    [0.0018, 0.0018],
  ];
  const cum = cumulativeDistances(shape);
  const route = { ...parseRoute(MADRID, 'pedestrian'), shape, maneuvers: [], costing: 'pedestrian' as const };
  const at = (m: number) => routeProgress(route, cum, pointAlong(shape, cum, m)!).roadBearing ?? -1;
  near(at(150), 90, 0.5, '50 m before the corner: still east');
  near(at(cum[1] - 10), 90, 0.5, '10 m before: still east (a walker looks 8 m ahead)');
  near(at(cum[1]), 26.6, 1.5, 'at the corner: turning (4 m behind, 8 m ahead)');
  near(at(cum[1] + 10), 0, 0.5, 'past it: north');
});

test('pointAlong interpolates and clamps', () => {
  const shape: [number, number][] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
  ];
  const cum = cumulativeDistances(shape);
  const half = pointAlong(shape, cum, cum[1] / 2)!;
  near(half.lon, 0.0005, 1e-9);
  near(half.lat, 0, 1e-9);
  const corner = pointAlong(shape, cum, cum[1] + (cum[2] - cum[1]) / 2)!;
  near(corner.lon, 0.001, 1e-9);
  near(corner.lat, 0.0005, 1e-9);
  assert.deepEqual(pointAlong(shape, cum, 1e9), { lat: 0.001, lon: 0.001 });
  assert.deepEqual(pointAlong(shape, cum, -5), { lat: 0, lon: 0 });
  assert.equal(pointAlong([], [], 0), null);
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

test('parseManifest keeps paths and other schemes out of URLs', () => {
  const raw = JSON.parse(MANIFEST);
  assert.equal(parseManifest(JSON.stringify({ ...raw, release: '../x' })), null);
  assert.equal(parseManifest(JSON.stringify({ ...raw, baseUrl: 'javascript:alert(1)' })), null);
  const m = parseManifest(JSON.stringify({ ...raw, packs: [{ ...raw.packs[0], release: 'a/b' }, { ...raw.packs[1], regionId: 7 }, raw.packs[0]] }))!;
  assert.deepEqual(
    m.packs.map((p) => p.id),
    ['ad'],
  );
});

test('fileIntegrity promises the size, and the hash only when it is one', () => {
  const sha = 'a'.repeat(64);
  assert.deepEqual(fileIntegrity({ name: 'ad.tar', size: 10, sha256: sha }), { size: 10, sha256: sha });
  assert.deepEqual(fileIntegrity({ name: 'ad.tar', size: 10, sha256: 'x' }), { size: 10 });
});

test('packs built by another Valhalla are not offered', () => {
  assert.equal(ENGINE_VALHALLA, '3.9.1');
  assert.ok(engineReads('3.9.1'));
  assert.ok(engineReads('3.9.4'), 'a patch release reads the same tiles');
  assert.ok(engineReads(''), 'manifests before the field');
  assert.ok(!engineReads('3.10.0'));
  assert.ok(!engineReads('4.0.0'));
  const raw = JSON.parse(MANIFEST);
  assert.equal(parseManifest(JSON.stringify({ ...raw, valhalla: '3.10.0' }))!.packs.length, 0);
  assert.equal(parseManifest(JSON.stringify({ ...raw, valhalla: '3.10.0' }))!.valhalla, '3.10.0');
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

test('packToFetch: the destination, then the origin, then a country on the way', () => {
  const pack = (id: string, bbox: [number, number, number, number], size = 1) =>
    ({ id, regionId: id, bbox, size, parts: [], pois: null }) as unknown as ManifestPack;
  const packs = [pack('pt', [-9.6, 36.9, -6.1, 42.2]), pack('es', [-9.4, 35.9, 3.4, 43.8], 2), pack('fr', [-5.2, 42.3, 8.3, 51.1], 3)];
  const lisbon = { lat: 38.72, lon: -9.14 };
  const paris = { lat: 48.86, lon: 2.35 };
  const has = (...ids: string[]) => (id: string) => ids.includes(id);
  assert.equal(packToFetch(packs, has(), lisbon, paris)?.id, 'fr');
  assert.equal(packToFetch(packs, has('fr'), lisbon, paris)?.id, 'pt');
  // Lisbon is covered by Spain's bbox too, but Portugal is the smaller pack there.
  assert.equal(packToFetch(packs, has('fr', 'pt'), lisbon, paris)?.id, 'es');
  assert.equal(packToFetch(packs, has('fr', 'pt', 'es'), lisbon, paris), null);
  // The origin's country installed: the destination's, not the origin's again.
  assert.equal(packToFetch(packs, has('pt'), lisbon, { lat: 40.42, lon: -3.7 })?.id, 'es');
  // Open sea (no pack covers it) is no reason to offer anything.
  assert.equal(packToFetch(packs, has('fr'), { lat: 46, lon: -7 }, paris), null);
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

test('covers: a pack across the antimeridian (Fiji) with its bbox and with cells', () => {
  const bbox: [number, number, number, number] = [176.8, -20.7, -178.2, -12.4];
  const suva = { lat: -18.14, lon: 178.44 };
  const taveuni = { lat: -16.8, lon: -179.9 };
  const samoa = { lat: -13.8, lon: -172.1 };
  assert.ok(covers({ bbox }, suva));
  assert.ok(covers({ bbox }, taveuni));
  assert.ok(!covers({ bbox }, samoa));
  const cells = [suva, taveuni].map(cellOf);
  assert.ok(covers({ bbox, cells }, suva));
  assert.ok(covers({ bbox, cells }, taveuni));
  assert.ok(!covers({ bbox, cells }, { lat: -14, lon: 178.44 }));
  // Longitude 180 is the first column again, not the next row's.
  assert.equal(cellOf({ lat: -17, lon: 180 }), cellOf({ lat: -17, lon: -180 }));
});
