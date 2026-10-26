import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapAssetUrl, parseMapsManifest, routePackFor } from './country-core.ts';

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

test('mapAssetUrl uses the map release, else the manifest one, else baseUrl', () => {
  const m = parseMapsManifest(JSON.stringify(manifest))!;
  assert.equal(mapAssetUrl(m, m.maps[0], 'ad.pmtiles', 'o/r'), 'https://github.com/o/r/releases/download/maps-20261025-1/ad.pmtiles');
  assert.equal(mapAssetUrl(m, m.maps[1], 'fr.pmtiles.part00', 'o/r'), 'https://github.com/o/r/releases/download/maps-20260925-3/fr.pmtiles.part00');
  assert.equal(mapAssetUrl({ ...m, baseUrl: 'http://localhost:8080/' }, m.maps[1], 'a b', 'o/r'), 'http://localhost:8080/a%20b');
});

test('routePackFor matches the region, then a shared extract', () => {
  const packs = [
    { id: 'es', regionId: 'es' },
    { id: 'do', regionId: 'do' },
    { id: 'ie', regionId: 'ie' },
  ];
  assert.equal(routePackFor(packs, 'es')?.id, 'es');
  assert.equal(routePackFor(packs, 'ht')?.id, 'do');
  assert.equal(routePackFor(packs, 'gb'), null);
  assert.equal(routePackFor(packs, 'fr'), null);
});
