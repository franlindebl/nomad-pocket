/// <reference types="node" />
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { INDEX_MIGRATIONS } from '../../db/schema.ts';

import { addressImport, importPlacesBlock, importStreetsBlock, insertRows, tsvJson, type AsyncSql, type Params } from './import-core.ts';
import { houseNumberKey, indexText, LOCALITY_KINDS, nameKey, parseAddressesTsv, parsePlacesTsv, parseStreetsTsv, type PlaceRow } from './places-core.ts';

function open(): { d: DatabaseSync; sql: AsyncSql } {
  const d = new DatabaseSync(':memory:');
  for (const m of INDEX_MIGRATIONS) d.exec(m);
  const sql: AsyncSql = {
    run: async (s, p = {}) => d.prepare(s).run(p),
    all: async <T>(s: string, p: Params = {}) => d.prepare(s).all(p) as T[],
  };
  return { d, sql };
}

type Place = [string, string, string, string, number, number, number, string];
const places = (d: DatabaseSync): Place[] =>
  (d.prepare('SELECT names, name, layer, kind, lat, lon, importance, source FROM map_places').all() as Record<string, never>[])
    .map((r) => [r.names, r.name, r.layer, r.kind, r.lat, r.lon, r.importance, r.source] as Place)
    .sort();
const localities = (d: DatabaseSync) =>
  (d.prepare('SELECT source, name, lat, lon FROM map_localities').all() as Record<string, never>[]).map((r) => [r.source, r.name, r.lat, r.lon]).sort();

/** What insertRows in places.ts wrote row by row before the import moved to SQL. */
const expected = (rows: PlaceRow[], source: string): Place[] =>
  rows
    .filter((r) => r.name)
    .map((r) => [indexText(r.names), r.name, r.layer, r.kind, r.lat, r.lon, r.rank, source] as Place)
    .sort();
const expectedTowns = (rows: PlaceRow[], source: string) =>
  rows
    .filter((r) => r.name && r.layer === 'place' && LOCALITY_KINDS.has(r.kind))
    .map((r) => [source, r.name, r.lat, r.lon])
    .sort();

const PLACES_TSV = [
  'school\tColegio "San José"\tCEIP San Jose\t40.416782\t-3.703507',
  'peak\tPico\\Norte\t\t42.5\t1.5',
  'hospital\tHospital del Mar\tHospital de Mar Barcelona\t41.3851\t2.1734',
  'cafe\t東京タワー\tTokyo Tower\t35.6586\t139.7454',
  'shop\tTienda\x01rara\t\t40.1\t-3.1\r',
  // name:es and name:en columns (2026-10-29 on): slots, the other-names column minus both; old lines have none.
  'tourism\tשער יפו\tPuerta de Jaffa Jaffa Gate Bab al-Khalil\t31.7767\t35.2277\tPuerta de Jaffa\tJaffa Gate',
  'museum\tMuseo\t\t40.4\t-3.7\t\tMuseum',
  'museum\tMuseo Same\tMuseo Same\t40.5\t-3.7\tMuseo Same\tMuseo Same',
  'bench\t\t\t40\t-3',
  'school\tSin coordenadas\t\t\t',
  'broken line',
  '',
].join('\n');

test('tsvJson keeps quotes, backslashes and empty columns', () => {
  const rows = JSON.parse(tsvJson('a\t"b"\t\\c\t\nd'));
  assert.deepEqual(rows, [['a', '"b"', '\\c', ''], ['d']]);
});

test('places: the same rows as parsePlacesTsv, CJK pairs included', async () => {
  const { d, sql } = open();
  await importPlacesBlock(sql, 'places:x', PLACES_TSV);
  assert.deepEqual(places(d), expected(parsePlacesTsv(PLACES_TSV), 'places:x'));
  assert.ok(places(d).some((r) => r[0].includes('京タ')));
});

const STREETS_TSV = [
  'town\tDurango\t43.170707\t-2.633490',
  'city\tMadrid\t40.416782\t-3.703507',
  'street\tCalle de Alcalá\t40.42\t-3.69',
  'path\tCamí de Ronda\t41.9\t3.2',
  'borough\tSalamanca\t40.43\t-3.68',
  'village\t台東\t35.71\t139.78',
  'street\t銀座通り\t35.67\t139.76',
  'street\tרחוב יפו\t31.78\t35.22\tCalle Jaffa\tJaffa Road',
  'street\t銀座\t35.6\t139.7\t\tGinza Street',
  'street\tCalle Mayor\t40.4\t-3.7\tCalle Mayor\t',
  'street\t\t40\t-3',
  '',
].join('\n');

test('streets: the same rows and towns as parseStreetsTsv', async () => {
  const { d, sql } = open();
  await importStreetsBlock(sql, 'route-x', STREETS_TSV);
  const rows = parseStreetsTsv(STREETS_TSV);
  assert.deepEqual(places(d), expected(rows, 'route-x'));
  assert.deepEqual(localities(d), expectedTowns(rows, 'route-x'));
});

test('insertRows: unnamed rows skipped, towns optional', async () => {
  const { d, sql } = open();
  const rows: PlaceRow[] = [
    { layer: 'place', kind: 'town', name: 'Soria', names: 'Soria', lat: 41.76, lon: -2.46, rank: 7 },
    { layer: 'poi', kind: 'drinking_water', name: '', names: '', lat: 41.7, lon: -2.4, rank: 16 },
  ];
  await insertRows(sql, 'a', rows);
  await insertRows(sql, 'b', rows, false);
  assert.deepEqual(places(d), [...expected(rows, 'a'), ...expected(rows, 'b')].sort());
  assert.deepEqual(localities(d), expectedTowns(rows, 'a'));
});

const ADDRESSES_TSV = [
  'Calle de Alcalá\t50\t40.4214\t-3.6935',
  'Calle Alcalá\t52 b\t40.42141\t-3.69351',
  'Calle de Alcalá\t50\t40.4214\t-3.6935',
  'Calle Mayor\t1\t-40.000005\t-3.000005',
  '台東2丁目\t5-1\t35.71\t139.78',
  '-\t3\t40\t-3',
  'Calle Vacía\t\t40\t-3',
  '',
].join('\n');

test('addresses: the same streets and doors as the row-by-row import, across blocks', async () => {
  const { d, sql } = open();
  const job = addressImport(sql, 'route-x');
  const [first, ...rest] = ADDRESSES_TSV.split('\n');
  await job.block(first);
  await job.block(rest.join('\n'));
  await job.finish();
  // The import it replaces (places.ts importAddresses).
  const keys = new Map<string, number>();
  const doors = new Set<string>();
  for (const r of parseAddressesTsv(ADDRESSES_TSV)) {
    const key = nameKey(r.street);
    if (!key) continue;
    if (!keys.has(key)) keys.set(key, keys.size);
    doors.add([key, Math.round(r.lat * 1e5), Math.round(r.lon * 1e5), r.number].join('|'));
  }
  const streets = d.prepare('SELECT key FROM map_address_streets WHERE source = ?').all('route-x') as { key: string }[];
  assert.deepEqual(streets.map((s) => s.key).sort(), [...keys.keys()].sort());
  const got = d
    .prepare('SELECT st.key, a.lat, a.lon, a.number FROM map_addresses a JOIN map_address_streets st ON st.id = a.street')
    .all() as { key: string; lat: number; lon: number; number: string }[];
  assert.deepEqual(got.map((r) => [r.key, r.lat, r.lon, r.number].join('|')).sort(), [...doors].sort());
  assert.ok(got.some((r) => r.number === houseNumberKey('52 b')));
});
