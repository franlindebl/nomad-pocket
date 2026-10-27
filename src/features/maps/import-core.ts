// Imports a country's search files (scripts/routing/places.py and streets.py: named places,
// streets, house numbers) into the index file with SQLite doing the work. Each block of TSV lines
// goes in as one JSON string (four string replacements in JS); json_each splits it into a temp
// table once, and the inserts read from there. Parsing them row by row in Hermes kept the JS thread busy for ~2 minutes
// on Spain's 5 million rows, and the app stuttered all along; now JS spends a few milliseconds
// per block and the rest runs on the index file's background connection. Rows with CJK names
// still pass through JS: their full-text column needs the character pairs of indexText.
// Pure (no `@/` aliases): import-core.test.ts runs it against node:sqlite.
import {
  CJK_GLOB,
  houseNumberKey,
  indexText,
  LOCALITY_KINDS,
  nameKey,
  PLACE_RANK,
  POI_RANK,
  type PlaceRow,
} from './places-core.ts';

/** Named parameters, with their `$`: what expo-sqlite and node:sqlite both bind. */
export type Params = Record<string, string | number | null>;

/** What the importers need of a database: expo-sqlite's async API, or node:sqlite in tests. */
export type AsyncSql = {
  run(sql: string, params?: Params): Promise<unknown>;
  all<T>(sql: string, params?: Params): Promise<T[]>;
};

/**
 * TSV lines as a JSON array of rows of strings. The scripts never write tabs or line breaks
 * inside a value; other control characters SQLite's JSON parser takes as they are (JSON5).
 */
export function tsvJson(text: string): string {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `[["${escaped.replaceAll('\t', '","').replaceAll('\n', '"],["')}"]]`;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const rankOf = (column: string, table: Record<string, number>, fallback: number) =>
  `CASE ${column} ${Object.entries(table)
    .map(([k, v]) => `WHEN ${quote(k)} THEN ${v}`)
    .join(' ')} ELSE ${fallback} END`;
const LOCALITIES = `(${[...LOCALITY_KINDS].map(quote).join(', ')})`;

// The rows the TSV parsers of places-core.ts keep. Coordinates aren't checked beyond being
// there: the files come from our own scripts.
const FILLED = (...columns: string[]) => columns.map((c) => `${c} <> ''`).join(' AND ');

// places.tsv: kind, name, other names, lat, lon (parsePlacesTsv).
const PLACES = `SELECT kind, name, CASE WHEN other <> '' THEN name || ' ' || other ELSE name END AS names, 'poi' AS layer,
  CAST(lat AS REAL) AS lat, CAST(lon AS REAL) AS lon, ${rankOf('kind', POI_RANK, 16)} AS rank
  FROM (SELECT value->>0 AS kind, value->>1 AS name, value->>2 AS other, value->>3 AS lat, value->>4 AS lon FROM json_each($json))
  WHERE ${FILLED('kind', 'name', 'lat', 'lon')}`;

// streets.tsv: kind, name, lat, lon (parseStreetsTsv): streets and paths, and the towns.
const STREETS = `SELECT kind, name, name AS names, CASE WHEN kind IN ('street', 'path') THEN 'road' ELSE 'place' END AS layer,
  CAST(lat AS REAL) AS lat, CAST(lon AS REAL) AS lon,
  CASE kind WHEN 'path' THEN 15 WHEN 'street' THEN 14 ELSE ${rankOf('kind', PLACE_RANK, 12)} END AS rank
  FROM (SELECT value->>0 AS kind, value->>1 AS name, value->>2 AS lat, value->>3 AS lon FROM json_each($json))
  WHERE ${FILLED('kind', 'name', 'lat', 'lon')}`;

// addresses.tsv: street, house number, lat, lon (parseAddressesTsv).
const DOORS = `SELECT street, number, CAST(lat AS REAL) AS lat, CAST(lon AS REAL) AS lon
  FROM (SELECT value->>0 AS street, value->>1 AS number, value->>2 AS lat, value->>3 AS lon FROM json_each($json))
  WHERE ${FILLED('street', 'number', 'lat', 'lon')}`;

const INSERT_PLACES = 'INSERT INTO map_places (names, name, layer, kind, lat, lon, importance, source)';

/**
 * Rows built in JS (map tiles, emergency points, CJK names) into the index under `source`,
 * as one statement each for the places and their towns. Unnamed ones are skipped.
 */
export async function insertRows(db: AsyncSql, source: string, rows: PlaceRow[], localities = true): Promise<void> {
  const named = rows.filter((r) => r.name);
  if (!named.length) return;
  const json = JSON.stringify(named.map((r) => [indexText(r.names), r.name, r.layer, r.kind, r.lat, r.lon, r.rank]));
  await db.run(
    `${INSERT_PLACES} SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, $source FROM json_each($json)`,
    { $json: json, $source: source },
  );
  const towns = localities ? named.filter((r) => r.layer === 'place' && LOCALITY_KINDS.has(r.kind)) : [];
  if (!towns.length) return;
  await db.run(
    'INSERT INTO map_localities (source, name, lat, lon) SELECT $source, value->>0, value->>1, value->>2 FROM json_each($json)',
    { $json: JSON.stringify(towns.map((r) => [r.name, r.lat, r.lon])), $source: source },
  );
}

/**
 * A block of a places or streets file into the index under `source`, with its towns: parsed
 * once into a temp table, inserted from there; rows that may have CJK names go through JS.
 */
async function importBlock(db: AsyncSql, rows: string, source: string, text: string): Promise<void> {
  await db.run(
    `CREATE TEMP TABLE IF NOT EXISTS import_rows (kind TEXT, name TEXT, names TEXT, layer TEXT, lat REAL, lon REAL, rank INTEGER, cjk INTEGER)`,
  );
  await db.run('DELETE FROM temp.import_rows');
  await db.run(
    `INSERT INTO temp.import_rows SELECT kind, name, names, layer, lat, lon, rank, names GLOB ${quote(CJK_GLOB)} FROM (${rows})`,
    { $json: tsvJson(text) },
  );
  await db.run(`${INSERT_PLACES} SELECT names, name, layer, kind, lat, lon, rank, $source FROM temp.import_rows WHERE NOT cjk`, { $source: source });
  await db.run(
    `INSERT INTO map_localities (source, name, lat, lon) SELECT $source, name, lat, lon FROM temp.import_rows WHERE layer = 'place' AND kind IN ${LOCALITIES}`,
    { $source: source },
  );
  const cjk = await db.all<PlaceRow>('SELECT kind, name, names, layer, lat, lon, rank FROM temp.import_rows WHERE cjk');
  await insertRows(db, source, cjk, false);
  await db.run('DELETE FROM temp.import_rows');
}

/** A block of places.tsv lines into the index under `source`. */
export function importPlacesBlock(db: AsyncSql, source: string, text: string): Promise<void> {
  return importBlock(db, PLACES, source, text);
}

/** A block of streets.tsv lines into the index under `source`, with its towns. */
export function importStreetsBlock(db: AsyncSql, source: string, text: string): Promise<void> {
  return importBlock(db, STREETS, source, text);
}

/**
 * House numbers (addresses.tsv: street, house number, lat, lon) for `source`, a block at a time.
 * Street names become keys (nameKey) and numbers houseNumberKey in JS, once per distinct value
 * (Spain: 120k streets for 2.3M doors); two temp tables map them for the inserts.
 */
export function addressImport(db: AsyncSql, source: string) {
  /** Street name → id in map_address_streets (null: no key, its doors are dropped). */
  const streets = new Map<string, number | null>();
  const ids = new Map<string, number>();
  const numbers = new Set<string>();
  const ready = (async () => {
    await db.run('CREATE TEMP TABLE IF NOT EXISTS import_doors (street TEXT, number TEXT, lat REAL, lon REAL)');
    await db.run('CREATE TEMP TABLE IF NOT EXISTS import_streets (street TEXT PRIMARY KEY, id INTEGER NOT NULL) WITHOUT ROWID');
    await db.run('CREATE TEMP TABLE IF NOT EXISTS import_numbers (number TEXT PRIMARY KEY, key TEXT NOT NULL) WITHOUT ROWID');
    for (const table of ['import_doors', 'import_streets', 'import_numbers']) await db.run(`DELETE FROM temp.${table}`);
  })();

  return {
    async block(text: string): Promise<void> {
      await ready;
      await db.run('DELETE FROM temp.import_doors');
      await db.run(`INSERT INTO temp.import_doors ${DOORS}`, { $json: tsvJson(text) });
      const found = await db.all<{ street: string }>('SELECT DISTINCT street FROM temp.import_doors');
      const fresh = found.map((r) => r.street).filter((s) => !streets.has(s));
      const keys = new Map(fresh.map((s) => [s, nameKey(s)]));
      const newKeys = [...new Set(keys.values())].filter((k) => k && !ids.has(k));
      if (newKeys.length) {
        const added = await db.all<{ id: number; key: string }>(
          'INSERT INTO map_address_streets (source, key) SELECT $source, value FROM json_each($json) RETURNING id, key',
          { $json: JSON.stringify(newKeys), $source: source },
        );
        for (const r of added) ids.set(r.key, r.id);
      }
      const mapped: [string, number][] = [];
      for (const [s, k] of keys) {
        const id = k ? (ids.get(k) ?? null) : null;
        streets.set(s, id);
        if (id !== null) mapped.push([s, id]);
      }
      if (mapped.length) {
        await db.run('INSERT INTO temp.import_streets (street, id) SELECT value->>0, value->>1 FROM json_each($json)', { $json: JSON.stringify(mapped) });
      }
      const doors = await db.all<{ number: string }>('SELECT DISTINCT number FROM temp.import_doors');
      const newNumbers = doors.map((r) => r.number).filter((n) => !numbers.has(n));
      if (newNumbers.length) {
        for (const n of newNumbers) numbers.add(n);
        await db.run('INSERT INTO temp.import_numbers (number, key) SELECT value->>0, value->>1 FROM json_each($json)', {
          $json: JSON.stringify(newNumbers.map((n) => [n, houseNumberKey(n)])),
        });
      }
      // Coordinates in 1e-5 degrees, rounded as Math.round does. A door mapped twice (building +
      // entrance node at the same spot) is kept once.
      await db.run(
        `INSERT OR IGNORE INTO map_addresses (street, lat, lon, number)
         SELECT s.id, CAST(floor(a.lat * 1e5 + 0.5) AS INTEGER), CAST(floor(a.lon * 1e5 + 0.5) AS INTEGER), n.key
         FROM temp.import_doors a JOIN temp.import_streets s ON s.street = a.street JOIN temp.import_numbers n ON n.number = a.number`,
      );
      await db.run('DELETE FROM temp.import_doors');
    },
    async finish(): Promise<void> {
      await ready;
      for (const table of ['import_doors', 'import_streets', 'import_numbers']) await db.run(`DROP TABLE IF EXISTS temp.${table}`);
    },
  };
}
