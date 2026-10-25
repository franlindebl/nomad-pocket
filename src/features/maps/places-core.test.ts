/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decodeTile } from '../../lib/mvt/decode.ts';
import { BytesSource } from '../../lib/pmtiles/io.ts';
import { listZoomTiles, readTile } from '../../lib/pmtiles/reader.ts';

import {
  ftsQuery,
  INDEX_LAYERS,
  nearestLocality,
  normalizeName,
  parseAddress,
  parseStreetsTsv,
  pickIndexZoom,
  rankHits,
  tileRows,
  type Hit,
  type PlaceRow,
} from './places-core.ts';

// Real Protomaps z14–15 extract of central Soria.
const soria = new BytesSource(new Uint8Array(readFileSync(new URL('../../lib/pmtiles/fixtures/soria-z14-15.pmtiles', import.meta.url))));

test('listZoomTiles with a bbox lists only the tiles over it', async () => {
  // The fixture holds two z15 tiles, one above the other (y 12192 and 12193).
  const all = (await listZoomTiles(soria, 15)).tiles;
  assert.equal(all.length, 2);
  const north = (await listZoomTiles(soria, 15, { bbox: [-2.47, 41.765, -2.465, 41.77] })).tiles;
  assert.deepEqual(
    north.map((t) => [t.z, t.y]),
    [[15, 12192]],
  );
  assert.deepEqual(
    (await listZoomTiles(soria, 15, { bbox: [-3, 41, -2, 42] })).tiles.map((t) => t.tileId),
    all.map((t) => t.tileId),
  );
});

async function rowsAt(z: number, keepUnnamed?: (kind: string) => boolean): Promise<PlaceRow[]> {
  const { header, tiles } = await listZoomTiles(soria, z);
  const rows: PlaceRow[] = [];
  for (const t of tiles) rows.push(...tileRows(decodeTile(await readTile(soria, header, t), INDEX_LAYERS), t.z, t.x, t.y, keepUnnamed));
  return rows;
}

test('tileRows indexes places, named POIs and streets from real tiles', async () => {
  const rows = await rowsAt(15);
  const sorias = rows.filter((r) => r.layer === 'place' && r.name === 'Soria');
  // Two z15 tiles, but the label point lives in only one of them (the other has it in its buffer).
  assert.equal(sorias.length, 1);
  assert.equal(sorias[0].kind, 'city');
  assert.ok(Math.abs(sorias[0].lat - 41.7634) < 0.001 && Math.abs(sorias[0].lon + 2.4642) < 0.001);

  const police = rows.find((r) => r.layer === 'poi' && r.kind === 'police');
  assert.equal(police?.name, 'Policía Municipal');
  assert.ok(!rows.some((r) => r.kind === 'tree' || r.kind === 'bench'));

  assert.ok(!rows.some((r) => !r.name));
  const withWater = (await rowsAt(15, (k) => k === 'drinking_water')).filter((r) => r.kind === 'drinking_water');
  assert.ok(withWater.some((r) => r.name === ''));

  const streets = rows.filter((r) => r.layer === 'road');
  assert.ok(streets.length > 20);
  // One row per street name and tile.
  const perTile = new Set(streets.map((s) => `${s.name}|${Math.floor(s.lon * 1e3)}`));
  assert.ok(perTile.size >= streets.length / 2);
});

test('pickIndexZoom stays within the tile budget', () => {
  const tilesAt = (z: number) => 4 ** (z - 10) * 1000;
  assert.equal(pickIndexZoom(15, 0, tilesAt, 40_000), 12);
  assert.equal(pickIndexZoom(12, 0, tilesAt, 40_000), 12);
  assert.equal(
    pickIndexZoom(15, 0, () => 10),
    15,
  );
  assert.equal(
    pickIndexZoom(5, 0, () => 10),
    5,
  );
  assert.equal(
    pickIndexZoom(15, 14, () => 1e9),
    14,
  );
});

test('ftsQuery turns words into required prefixes', () => {
  assert.equal(ftsQuery('  calle   mayor '), '"calle"* AND "mayor"*');
  assert.equal(ftsQuery('Hospital "La Paz"'), '"Hospital"* AND "La"* AND "Paz"*');
  assert.equal(ftsQuery('Ñandú-12'), '"Ñandú"* AND "12"*');
  assert.equal(ftsQuery(' -- '), null);
});

test('ftsQuery: an abbreviation also matches its full word', () => {
  assert.equal(ftsQuery('Avda. Meritxell'), '("Avda"* OR "avenida"*) AND "Meritxell"*');
  assert.equal(ftsQuery('Pº Castellana'), '("Pº"* OR "paseo"*) AND "Castellana"*');
  assert.equal(ftsQuery('C/ Dr. Fleming'), '"C"* AND ("Dr"* OR "doctor"* OR "drive"*) AND "Fleming"*');
  assert.equal(ftsQuery('Ntra Sra de Atocha'), '("Ntra"* OR "nuestra"*) AND ("Sra"* OR "senora"*) AND "de"* AND "Atocha"*');
});

test('parseAddress splits the street from the house number', () => {
  assert.deepEqual(parseAddress('Calle Alcalá 50'), { street: 'Calle Alcalá', number: '50' });
  assert.deepEqual(parseAddress('Alcalá, 50'), { street: 'Alcalá', number: '50' });
  assert.deepEqual(parseAddress('C/ Alcalá nº 50 bis'), { street: 'C/ Alcalá', number: '50' });
  assert.deepEqual(parseAddress('Avda. de América 12 b'), { street: 'Avda. de América', number: '12B' });
  assert.deepEqual(parseAddress('221B Baker Street'), { street: 'Baker Street', number: '221B' });
  assert.equal(parseAddress('Calle Alcalá'), null);
  assert.equal(parseAddress('M-30'), null);
  assert.equal(parseAddress('50'), null);
  assert.equal(parseAddress('Hotel 7 Islas'), null);
});

test('normalizeName drops accents and case', () => {
  assert.equal(normalizeName('  Policía Municipal '), 'policia municipal');
});

test('rankHits leaves out "de", "la"… when comparing names', () => {
  const base = { names: '', rank: 14, layer: 'road' as const, kind: 'street', lat: 40.42, lon: -3.69 };
  const hits: Hit[] = [
    { id: 1, name: 'Calle Alcalá de Guadaira', ...base },
    { id: 2, name: 'Calle de Alcalá', ...base, lat: 40.43 },
  ];
  assert.deepEqual(
    rankHits(hits, 'Calle Alcalá', null).map((h) => h.id),
    [2, 1],
  );
});

test('rankHits: exact before prefix, near before far, one row per street', () => {
  const base = { names: '', rank: 12 };
  const hits: Hit[] = [
    { id: 1, layer: 'road', kind: 'street', name: 'Calle Mayor', lat: 41.0, lon: -2.0, ...base },
    { id: 2, layer: 'road', kind: 'street', name: 'Calle Mayor', lat: 41.005, lon: -2.0, ...base },
    { id: 3, layer: 'road', kind: 'street', name: 'Calle Mayor', lat: 40.0, lon: -3.0, ...base },
    { id: 4, layer: 'poi', kind: 'bar', name: 'Bar Calle Mayor', lat: 41.0, lon: -2.0, ...base },
    { id: 5, layer: 'place', kind: 'locality', name: 'Mayorga', lat: 42.1, lon: -5.2, ...base, rank: 9 },
  ];
  const near = { lat: 41.0, lon: -2.0 };
  const ranked = rankHits(hits, 'calle mayor', near);
  assert.deepEqual(
    ranked.map((h) => h.id),
    [1, 3, 4, 5],
  );
  assert.equal(rankHits(hits, 'mayorga', near)[0].id, 5);
});

test('nearestLocality', () => {
  const towns = [
    { name: 'A', lat: 41, lon: -2 },
    { name: 'B', lat: 41.1, lon: -2 },
  ];
  assert.equal(nearestLocality({ lat: 41.08, lon: -2 }, towns)?.name, 'B');
  assert.equal(nearestLocality({ lat: 45, lon: -2 }, towns), null);
});

test('routing pack street names become road and place rows', () => {
  const rows = parseStreetsTsv(
    'street\tCalle Mayor\t40.415234\t-3.709345\npath\tCamí de la Rabassa\t42.48\t1.49\n' +
      'town\tAndorra la Vella\t42.506939\t1.521247\nhamlet\tAixàs\t42.4826\t1.4641\nbroken line\nstreet\t\t1\t2\n',
  );
  assert.deepEqual(
    rows.map((r) => [r.layer, r.kind, r.name, r.rank]),
    [
      ['road', 'street', 'Calle Mayor', 14],
      ['road', 'path', 'Camí de la Rabassa', 15],
      ['place', 'town', 'Andorra la Vella', 7],
      ['place', 'hamlet', 'Aixàs', 12],
    ],
  );
  assert.equal(rows[0].lat, 40.415234);
});
