/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { decodeTile } from '../../lib/mvt/decode.ts';
import { BytesSource } from '../../lib/pmtiles/io.ts';
import { listZoomTiles, readTile } from '../../lib/pmtiles/reader.ts';

import {
  categoryKinds,
  dedupeHits,
  ftsQuery,
  INDEX_LAYERS,
  indexText,
  localizedName,
  NAME_SEP,
  matchCap,
  nearestLocality,
  normalizeName,
  locateHouseNumber,
  parseAddress,
  parseJapaneseAddress,
  parseAddressesTsv,
  parsePlacesTsv,
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
  assert.equal(ftsQuery('Avda. Meritxell'), '("Avda"* OR "avenida"* OR "avinguda"*) AND "Meritxell"*');
  assert.equal(ftsQuery('Pº Castellana'), '("Pº"* OR "paseo"* OR "passeig"*) AND "Castellana"*');
  assert.equal(ftsQuery('C/ Dr. Fleming'), '"C"* AND ("Dr"* OR "doctor"* OR "drive"*) AND "Fleming"*');
  assert.equal(ftsQuery('Ntra Sra de Atocha'), '("Ntra"* OR "nuestra"*) AND ("Sra"* OR "senora"*) AND "de"* AND "Atocha"*');
});

test('Chinese and Japanese names match from any character pair', () => {
  assert.equal(indexText('Soria'), 'Soria');
  assert.equal(indexText('東京タワー Tokyo Tower'), '東京タワー Tokyo Tower 東京 京タ タワ ワー');
  assert.equal(ftsQuery('タワー'), '("タワー"* OR "タワ ワー")');
  assert.equal(ftsQuery('東'), '"東"*');
  assert.equal(ftsQuery('JR東京'), '("JR東京"* OR "東京")');

  // Against SQLite's own FTS5, with the app's tokenizer.
  const d = new DatabaseSync(':memory:');
  d.exec("CREATE VIRTUAL TABLE t USING fts5(names, tokenize = 'unicode61 remove_diacritics 2')");
  const add = d.prepare('INSERT INTO t (names) VALUES (?)');
  for (const n of ['東京タワー', '北京首都国际机场', '東京都庁', 'Calle Mayor', '東京・大阪']) add.run(indexText(n));
  const find = (q: string) =>
    d
      .prepare('SELECT names FROM t WHERE t MATCH ?')
      .all(ftsQuery(q)!)
      .map((r) => String((r as { names: string }).names).split(' ')[0]);
  assert.deepEqual(find('タワー'), ['東京タワー']);
  assert.deepEqual(find('机场'), ['北京首都国际机场']);
  assert.deepEqual(find('都庁'), ['東京都庁']);
  assert.deepEqual(find('東京 タワー'), ['東京タワー']);
  assert.deepEqual(find('東京'), ['東京タワー', '東京都庁', '東京・大阪']);
  assert.deepEqual(find('大阪'), ['東京・大阪']);
  // One character matches where a pair starts: not at the end of a run ("東京・大阪").
  assert.deepEqual(find('京'), ['東京タワー', '北京首都国际机场', '東京都庁']);
  // Pairs must follow each other: "東庁" is not in "東京都庁".
  assert.deepEqual(find('東庁'), []);
  assert.deepEqual(find('mayor'), ['Calle']);
  d.close();
});

test('matchCap reads fewer matches for very short queries', () => {
  assert.equal(matchCap('ca'), 20_000);
  assert.equal(matchCap(' c a '), 20_000);
  assert.equal(matchCap('cal'), 50_000);
  assert.equal(matchCap('机场'), 20_000);
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

test('parseJapaneseAddress reads chōme, block and number the way places.py writes them', () => {
  const jp = (street: string, number: string) => ({ street, number });
  assert.deepEqual(parseJapaneseAddress('台東2丁目5-1'), [jp('台東2丁目', '5-1')]);
  assert.deepEqual(parseJapaneseAddress('台東2-5-1'), [jp('台東2丁目', '5-1'), jp('台東', '2-5-1')]);
  assert.deepEqual(parseJapaneseAddress('台東二丁目5番1号'), [jp('台東2丁目', '5-1')]);
  assert.deepEqual(parseJapaneseAddress('丸の内十二丁目9番地1'), [jp('丸の内12丁目', '9-1')]);
  assert.deepEqual(parseJapaneseAddress('東京都台東区台東２－５－１'), [
    jp('東京都台東区台東2丁目', '5-1'),
    jp('台東区台東2丁目', '5-1'),
    jp('台東2丁目', '5-1'),
    jp('東京都台東区台東', '2-5-1'),
    jp('台東区台東', '2-5-1'),
    jp('台東', '2-5-1'),
  ]);
  // Two numbers: chōme + block, or a rural block + number.
  assert.deepEqual(parseJapaneseAddress('台東2-5'), [jp('台東2丁目', '5'), jp('台東', '2-5')]);
  assert.deepEqual(parseJapaneseAddress('岩村田1234-5'), [jp('岩村田', '1234-5')]);
  assert.deepEqual(parseJapaneseAddress('台東'), []);
  assert.deepEqual(parseJapaneseAddress('Calle Alcalá 50'), []);
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

test('parsePlacesTsv: every named POI, other names searchable', () => {
  const rows = parsePlacesTsv(
    'school\tInstituto San Isidro Madrid\tSan Isidro\t40.412500\t-3.706900\nhospital\tHospital Clínico San Carlos\t\t40.441\t-3.719\nbad line\n',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    layer: 'poi',
    kind: 'school',
    name: 'Instituto San Isidro Madrid',
    names: 'Instituto San Isidro Madrid San Isidro',
    lat: 40.4125,
    lon: -3.7069,
    rank: 14,
  });
  assert.equal(rows[1].names, 'Hospital Clínico San Carlos');
  assert.ok(rows[1].rank < rows[0].rank);
});

test('parseAddressesTsv normalizes house numbers', () => {
  assert.deepEqual(parseAddressesTsv('Calle de Alcalá\t12 b\t40.42\t-3.69\n\tx\t1\t2\n'), [
    { street: 'Calle de Alcalá', number: '12B', lat: 40.42, lon: -3.69 },
  ]);
});

test('locateHouseNumber: the door, else between neighbours on the same side', () => {
  const at = (number: string, lat: number) => ({ street: 'Calle de Alcalá', number, lat, lon: -3.69 });
  const doors = [at('46', 40.42), at('48', 40.421), at('52', 40.423), at('51', 40.4225), at('50', 40.5)];
  const near = { lat: 40.4215, lon: -3.69 };
  // An exact door far away (another stretch beyond maxMeters) doesn't count: interpolated.
  const fifty = locateHouseNumber(doors, '50', near);
  assert.ok(fifty && !fifty.exact);
  assert.ok(Math.abs(fifty.lat - 40.422) < 1e-9);
  assert.deepEqual(locateHouseNumber(doors, '48', near), { lat: 40.421, lon: -3.69, exact: true });
  // Only a lower neighbour: the nearest number on the same side, when close.
  assert.deepEqual(locateHouseNumber(doors, '56', near), { lat: 40.423, lon: -3.69, exact: false });
  assert.equal(locateHouseNumber(doors, '80', near), null);
  assert.equal(locateHouseNumber(doors, 's/n', near), null);
});

test('a name typed without its apostrophe matches (query side)', () => {
  const d = new DatabaseSync(':memory:');
  d.exec("CREATE VIRTUAL TABLE t USING fts5(names, tokenize = 'unicode61 remove_diacritics 2')");
  const add = d.prepare('INSERT INTO t (names) VALUES (?)');
  for (const n of ["McDonald's", "The Queen's Medical Center", 'Queen Street', 'Calle Mayor']) add.run(n);
  const find = (q: string) => d.prepare('SELECT names FROM t WHERE t MATCH ?').all(ftsQuery(q)!).map((r) => String((r as { names: string }).names));
  assert.deepEqual(find('mcdonalds'), ["McDonald's"]);
  assert.deepEqual(find("mcdonald's"), ["McDonald's"]);
  assert.deepEqual(find('queens medical'), ["The Queen's Medical Center"]);
  assert.deepEqual(find('mayor'), ['Calle Mayor']);
});

test('rankHits ranks a name without apostrophe as exact, and a city by its alternative names first', () => {
  const base = { rank: 12, lat: 21.3, lon: -157.8 };
  const hits: Hit[] = [
    { id: 1, layer: 'poi', kind: 'restaurant', name: "McDonald's Waikiki", names: "McDonald's Waikiki", ...base },
    { id: 2, layer: 'poi', kind: 'restaurant', name: "McDonald's", names: "McDonald's", ...base },
  ];
  assert.equal(rankHits(hits, 'mcdonalds', null)[0].id, 2);
  const city: Hit[] = [
    { id: 1, layer: 'poi', kind: 'hotel', name: 'Tbilisi Marriott', names: 'Tbilisi Marriott', ...base, rank: 16 },
    { id: 2, layer: 'place', kind: 'city', name: 'თბილისი', names: 'თბილისი Tiflis Tbilisi', ...base, rank: 4 },
    { id: 3, layer: 'place', kind: 'city', name: 'תל אביב–יפו', names: `תל אביב–יפו${NAME_SEP}Tel Aviv${NAME_SEP}Tel Aviv`, ...base, rank: 4 },
  ];
  assert.equal(rankHits(city, 'Tbilisi', null)[0].id, 2);
  assert.equal(rankHits(city, 'tel aviv', null)[0].id, 3);
});

test('localizedName: the app language, native as the other', () => {
  const tbilisi = { name: 'თბილისი', names: `თბილისი${NAME_SEP}Tiflis${NAME_SEP}Tbilisi` };
  assert.deepEqual(localizedName(tbilisi, 'es'), { name: 'Tiflis', native: 'თბილისი' });
  assert.deepEqual(localizedName(tbilisi, 'en'), { name: 'Tbilisi', native: 'თბილისი' });
  // No Spanish name: English only for a native name that is not Latin.
  const gate = { name: 'שער יפו', names: `שער יפו${NAME_SEP}${NAME_SEP}Jaffa Gate` };
  assert.equal(localizedName(gate, 'es').name, 'Jaffa Gate');
  const sevilla = { name: 'Sevilla', names: `Sevilla${NAME_SEP}${NAME_SEP}Seville` };
  assert.deepEqual(localizedName(sevilla, 'es'), { name: 'Sevilla', native: null });
  assert.equal(localizedName(sevilla, 'en').name, 'Seville');
  // Pack rows have no slots.
  assert.deepEqual(localizedName({ name: 'Foo', names: 'Foo Bar' }, 'en'), { name: 'Foo', native: null });
});

test('dedupeHits: diacritic variants of a door at the same spot are one', () => {
  const base = { names: '', rank: 0, layer: 'poi' as const, kind: 'address', lat: 21.28, lon: -157.83 };
  const hits: Hit[] = [
    { id: -1, name: 'Kalākaua Avenue, 2005', ...base },
    { id: -2, name: 'Kalakaua Avenue, 2005', ...base },
    { id: -3, name: 'Kalakaua Avenue, 2007', ...base, lat: 21.2801 },
  ];
  assert.deepEqual(
    dedupeHits(hits).map((h) => h.id),
    [-1, -3],
  );
  // Unnamed points are never merged by name.
  const water = { ...base, kind: 'drinking_water', name: '' };
  assert.equal(dedupeHits([{ id: 1, ...water }, { id: 2, ...water }]).length, 2);
});

test('categoryKinds: whole-query category words, es and en', () => {
  assert.deepEqual(categoryKinds('Hospitales'), ['hospital']);
  assert.deepEqual(categoryKinds('farmacia'), ['pharmacy']);
  assert.deepEqual(categoryKinds('pharmacy'), ['pharmacy']);
  assert.deepEqual(categoryKinds('Policía'), ['police']);
  assert.deepEqual(categoryKinds('agua potable'), ['drinking_water']);
  assert.deepEqual(categoryKinds('drinking water'), ['drinking_water']);
  assert.deepEqual(categoryKinds('gasolinera'), ['fuel']);
  assert.deepEqual(categoryKinds('nearest hospital'), ['hospital']);
  assert.deepEqual(categoryKinds('farmacia cerca'), ['pharmacy']);
  assert.equal(categoryKinds('farmacia sol'), null);
  assert.equal(categoryKinds('Hospital Clínico San Carlos'), null);
});

test('tileRows keeps name variants in slots', () => {
  const layers = {
    places: {
      extent: 4096,
      features: [{ x: 10, y: 10, type: 1, geometry: [], properties: { name: 'თბილისი', 'name:es': 'Tiflis', 'name:en': 'Tbilisi', kind: 'city' } }],
    },
  };
  const rows = tileRows(layers as never, 0, 0, 0);
  assert.equal(rows[0].names, `თბილისი${NAME_SEP}Tiflis${NAME_SEP}Tbilisi`);
});
