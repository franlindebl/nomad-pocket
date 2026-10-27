import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countryGroupId,
  countryNeed,
  countryOfGroup,
  countryParts,
  isNewer,
  mapAssetUrl,
  packOutdated,
  parseMapsManifest,
  partAt,
  pendingBytes,
  routePacksFor,
  type PlannedArchive,
} from './country-core.ts';

const file = (name: string, size = 10) => ({ name, size, sha256: 'x' });

const manifest = {
  version: 1,
  release: 'maps-20261025-1',
  maps: [
    { id: 'ad', regionId: 'ad', buildDate: '20261025', maxZoom: 15, bbox: [1.39, 42.41, 1.76, 42.66], size: 10, parts: [file('ad.pmtiles')], pois: null, streets: null },
    {
      id: 'fr',
      regionId: 'fr',
      release: 'maps-20260925-3',
      buildDate: '20260925',
      maxZoom: 15,
      bbox: [-5.1, 41.3, 9.5, 51.1],
      size: 20,
      parts: [file('fr.pmtiles.part00'), file('fr.pmtiles.part01')],
      pois: file('fr.pois.tsv'),
      streets: file('fr.streets.tsv'),
      places: file('fr.places.tsv'),
      addresses: file('fr.addresses.tsv'),
    },
    // Dropped: no parts, a path in a file name, no bbox.
    { id: 'xx', regionId: 'xx', buildDate: '1', maxZoom: 15, bbox: [0, 0, 1, 1], size: 1, parts: [] },
    { id: 'yy', regionId: 'yy', buildDate: '1', maxZoom: 15, bbox: [0, 0, 1, 1], size: 1, parts: [file('../yy')] },
    { id: 'zz', regionId: 'zz', buildDate: '1', maxZoom: 15, size: 1, parts: [file('zz.pmtiles')] },
  ],
};

test('parseMapsManifest keeps valid maps only', () => {
  const m = parseMapsManifest(JSON.stringify(manifest));
  assert.ok(m);
  assert.deepEqual(
    m.maps.map((x) => x.id),
    ['ad', 'fr'],
  );
  assert.equal(m.maps[1].pois?.name, 'fr.pois.tsv');
  assert.equal(m.maps[1].addresses?.name, 'fr.addresses.tsv');
  assert.equal(m.maps[0].places, null);
});

test('parseMapsManifest rejects other versions and garbage', () => {
  assert.equal(parseMapsManifest('{'), null);
  assert.equal(parseMapsManifest(JSON.stringify({ ...manifest, version: 2 })), null);
  assert.equal(parseMapsManifest(JSON.stringify({ version: 1, release: 'r' })), null);
});

test('parseMapsManifest keeps paths and other schemes out of file names and URLs', () => {
  const ad = manifest.maps[0];
  const ids = (m: object) => parseMapsManifest(JSON.stringify(m))?.maps.map((x) => x.id);
  // regionId names the installed file (<regionId>.pmtiles); release goes into the URL.
  assert.deepEqual(ids({ ...manifest, maps: [{ ...ad, regionId: '../ad' }, { ...ad, id: 'fr', release: 'r/../x' }, ad] }), ['ad']);
  assert.equal(parseMapsManifest(JSON.stringify({ ...manifest, release: '../r' })), null);
  assert.equal(parseMapsManifest(JSON.stringify({ ...manifest, baseUrl: 'file:///etc' })), null);
  assert.equal(parseMapsManifest(JSON.stringify({ ...manifest, baseUrl: 'http://localhost:8765' }))?.baseUrl, 'http://localhost:8765');
});

test('mapAssetUrl uses the map release, else the manifest one, else baseUrl', () => {
  const m = parseMapsManifest(JSON.stringify(manifest))!;
  assert.equal(mapAssetUrl(m, m.maps[0], 'ad.pmtiles', 'o/r'), 'https://github.com/o/r/releases/download/maps-20261025-1/ad.pmtiles');
  assert.equal(mapAssetUrl(m, m.maps[1], 'fr.pmtiles.part00', 'o/r'), 'https://github.com/o/r/releases/download/maps-20260925-3/fr.pmtiles.part00');
  assert.equal(mapAssetUrl({ ...m, baseUrl: 'http://localhost:8080/' }, m.maps[1], 'a b', 'o/r'), 'http://localhost:8080/a%20b');
});

test('routePacksFor matches the region, then a shared extract', () => {
  const packs = [
    { id: 'es', regionId: 'es' },
    { id: 'do', regionId: 'do' },
    { id: 'ie', regionId: 'ie' },
    { id: 'us-west', regionId: 'us' },
    { id: 'us-south', regionId: 'us' },
  ];
  const ids = (regionId: string) => routePacksFor(packs, regionId).map((p) => p.id);
  assert.deepEqual(ids('es'), ['es']);
  assert.deepEqual(ids('ht'), ['do']);
  assert.deepEqual(ids('us'), ['us-west', 'us-south']);
  assert.deepEqual(ids('gb'), []);
  assert.deepEqual(ids('fr'), []);
});

test('a country group names its country, the pack it uses included', () => {
  assert.equal(countryGroupId('ht'), 'country-ht');
  assert.equal(countryOfGroup(countryGroupId('ht')), 'ht');
  assert.equal(countryOfGroup('model-x'), null);
  assert.equal(countryOfGroup(undefined), null);
});

const GB = 1e9;
const planned = (size: number, onDisk = false, queued = false) => ({ size, onDisk, queued });

test('countryNeed: a fresh two-part map and pack, side files included', () => {
  // Spain-like: map 2.3 GB and pack 2.27 GB in two parts each, 0.3 GB of side files.
  const map: PlannedArchive = { size: 2.3 * GB, parts: [planned(2 * GB), planned(0.3 * GB)], sides: [planned(0.1 * GB), planned(0.05 * GB)] };
  const pack: PlannedArchive = { size: 2.27 * GB, parts: [planned(2 * GB), planned(0.27 * GB)], sides: [planned(0.15 * GB)] };
  const need = countryNeed([map, pack]);
  assert.equal(Math.round(need.bytes / 1e6), 4870);
  // The biggest assembly copy on top of the download (assemblies run one at a time).
  assert.equal(Math.round(need.needed / 1e6), 4870 + 2300);
});

test('countryNeed: several packs (the USA) take the room of one copy, the biggest', () => {
  const map: PlannedArchive = { size: 8 * GB, parts: [planned(2 * GB), planned(2 * GB), planned(2 * GB), planned(2 * GB)], sides: [] };
  const packs = [7.8, 5.5, 4.9, 2.8].map((g): PlannedArchive => ({ size: g * GB, parts: [planned(g * GB - 1), planned(1)], sides: [planned(0.5 * GB)] }));
  const need = countryNeed([map, ...packs]);
  assert.equal(Math.round(need.bytes / 1e8), 310);
  assert.equal(Math.round(need.needed / 1e8), 310 + 80);
});

test('countryNeed: what is on disk or queued costs nothing; a single part needs no copy', () => {
  const retry: PlannedArchive = { size: 2.3 * GB, parts: [planned(2 * GB, true), planned(0.3 * GB, false, true)], sides: [planned(0.1 * GB, true)] };
  // The queued part is in `pending` (the manager counts the rest of the queue).
  assert.deepEqual(countryNeed([retry], 0.2 * GB), { bytes: 0, needed: 0.2 * GB + 2.3 * GB });
  const single: PlannedArchive = { size: 3e6, parts: [planned(3e6)], sides: [] };
  assert.deepEqual(countryNeed([single, null]), { bytes: 3e6, needed: 3e6 });
  // Nothing to fetch (the map is installed): only the queue.
  assert.deepEqual(countryNeed([null, undefined], 5), { bytes: 0, needed: 5 });
});

test('pendingBytes counts what the queue still has to fetch', () => {
  assert.equal(
    pendingBytes([
      { status: 'running', totalBytes: 100, bytesWritten: 40 },
      { status: 'queued', totalBytes: 50, bytesWritten: 0 },
      { status: 'paused', totalBytes: 30, bytesWritten: 10 },
      { status: 'failed', totalBytes: 999, bytesWritten: 0 },
      { status: 'processing', totalBytes: 999, bytesWritten: 999 },
      { status: 'running', totalBytes: 999, bytesWritten: 0, external: true },
    ]),
    60 + 50 + 20,
  );
});

test('isNewer and packOutdated compare build dates and the engine', () => {
  assert.ok(isNewer('20261105', '20261005'));
  assert.ok(!isNewer('20261005', '20261005'));
  assert.ok(!isNewer('', '20261005'));
  assert.ok(!isNewer('20261105', null));
  assert.ok(packOutdated({ buildDate: '20261005' }, { buildDate: '20261105' }));
  assert.ok(!packOutdated({ buildDate: '20261105', valhalla: '3.9.1' }, { buildDate: '20261105' }));
  // Built by a Valhalla this engine can't read: replace it even at the same date.
  assert.ok(packOutdated({ buildDate: '20261105', valhalla: '3.8.0' }, { buildDate: '20261105' }));
  // No version recorded: the packs of that time, all 3.9.1.
  assert.ok(!packOutdated({ buildDate: '20261105' }, { buildDate: '20261105' }));
});

test('countryParts: a country is one part until the catalog has maps of its regions', () => {
  const packs = [
    { id: 'us-west', regionId: 'us' },
    { id: 'us-south', regionId: 'us' },
    { id: 'es', regionId: 'es' },
  ];
  // The catalog of an earlier run: the whole USA map, its regional packs.
  const whole = countryParts('us', [{ id: 'us', regionId: 'us' }], packs);
  assert.deepEqual(
    whole.map((p) => [p.id, p.map?.id, p.packs.map((x) => x.id)]),
    [['us', 'us', ['us-west', 'us-south']]],
  );
  // Regional maps: one part per region, a region without its map yet still listed.
  const split = countryParts('us', [{ id: 'us-west', regionId: 'us' }, { id: 'us', regionId: 'us' }, { id: 'es', regionId: 'es' }], [...packs, { id: 'us-alaska', regionId: 'us' }]);
  assert.deepEqual(
    split.map((p) => [p.id, p.map?.id ?? null, p.packs.map((x) => x.id)]),
    [
      ['us-alaska', null, ['us-alaska']],
      ['us-south', null, ['us-south']],
      ['us-west', 'us-west', ['us-west']],
    ],
  );
  assert.deepEqual(
    countryParts('es', [{ id: 'es', regionId: 'es' }], packs).map((p) => p.id),
    ['es'],
  );
});

test('partAt: the region whose pack has roads there, else whose map covers it', () => {
  const west = { id: 'us-west', map: { bbox: [-125, 31, -102, 49] as const }, packs: [{ bbox: [-125, 31, -102, 49] as [number, number, number, number], cells: [] }] };
  const alaska = { id: 'us-alaska', map: { bbox: [-179, 51, -130, 71] as const }, packs: [] };
  const parts = [west, alaska] as unknown as Parameters<typeof partAt>[0];
  assert.equal(partAt(parts, { lat: 37.77, lon: -122.42 })?.id, 'us-west');
  assert.equal(partAt(parts, { lat: 61.2, lon: -149.9 })?.id, 'us-alaska');
  assert.equal(partAt(parts, { lat: 40.4, lon: -3.7 }), null);
});
