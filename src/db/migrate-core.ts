// Moving the app's SQLite files, the pure part. Two one-time moves, both run before
// anything reads the files:
// - splitting nomad.db: up to 1.1.0 it held the user's data (chats, history, bookmarks,
//   saved places) and the map search index (up to ~1 GB for a country) together, in
//   Documents/SQLite. The user's tables are copied into a new nomad.db (on iOS under
//   Library/Application Support, out of the Files app), and the old file, which then
//   only adds index tables, becomes the search index under Documents/content (out of
//   backups): renaming it costs nothing, where copying the index would take minutes and
//   twice the space.
// - relocating the kv-store (settings, the emergency plan) on iOS, same reason.
// Every step is idempotent and resumable after a kill: copy to a temporary file, verify
// it, rename it into place (the commit point), and only then retire the old file.
// Platform access goes through `Env` so node's test runner drives this against real
// SQLite files (node:sqlite) and expo-sqlite runs it in the app.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export type SqlValue = string | number | null;

export interface Sql {
  exec(sql: string): void;
  all<T>(sql: string, ...params: SqlValue[]): T[];
  run(sql: string, ...params: SqlValue[]): void;
  close(): void;
}

export interface Env {
  /** Opens (creating if needed) the database file at a plain path, on its own connection. */
  open(path: string): Sql;
  exists(path: string): boolean;
  /** Atomic rename within one volume; the destination must not exist. */
  rename(from: string, to: string): void;
  /** Deletes a file; nothing when it is missing. */
  remove(path: string): void;
  mkdirp(dir: string): void;
}

/** SQLite keeps these next to a database; they belong to it. */
export const SIDECARS = ['-wal', '-journal', '-shm'] as const;

/** First user schema version without the search index tables (the split happened). */
export const SPLIT_VERSION = 4;

/** The user's tables of nomad.db up to SPLIT_VERSION - 1, all copied by the split. */
export const USER_TABLES = [
  'items',
  'downloads',
  'bookmarks',
  'history',
  'courses',
  'course_progress',
  'map_markers',
  'chat_sessions',
  'chat_messages',
  'map_pois',
  'map_sources',
] as const;

/**
 * map_sources held both the emergency point state (stays with the user's data) and the
 * search index state (moves to index_sources in the index file): only the first is copied.
 */
const COPY_SPEC: Record<string, { columns: string[]; where: string }> = {
  map_sources: { columns: ['item_id', 'pois_at', 'pois_count'], where: 'WHERE pois_at IS NOT NULL' },
};

export const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function userVersion(db: Sql): number {
  return db.all<{ user_version: number }>('PRAGMA user_version')[0]?.user_version ?? 0;
}

/** Runs the steps of a migration ladder the database has not run yet. */
export function applyLadder(db: Sql, ladder: string[]) {
  for (let v = userVersion(db); v < ladder.length; v++) {
    db.exec(ladder[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
}

function tableNames(db: Sql, schema = 'main'): string[] {
  return db.all<{ name: string }>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).map((r) => r.name);
}

function columnNames(db: Sql, table: string, schema = 'main'): string[] {
  return db.all<{ name: string }>(`PRAGMA ${schema}.table_info(${q(table)})`).map((r) => r.name);
}

function versionAt(env: Env, path: string): number {
  const db = env.open(path);
  try {
    return userVersion(db);
  } finally {
    db.close();
  }
}

function removeDb(env: Env, path: string) {
  // Sidecars first: a kill in between leaves a database without a stale journal.
  for (const s of SIDECARS) env.remove(path + s);
  env.remove(path);
}

/**
 * Moves a closed database with its journal. Sidecars go first, so a kill in between leaves
 * the journal where the main file is going and the next attempt pairs them again. An
 * existing destination is replaced only when `replace` (else it throws).
 */
export function moveDb(env: Env, from: string, to: string, replace = false) {
  env.mkdirp(dirOf(to));
  if (env.exists(to)) {
    if (!replace) throw new Error(`move: ${to} exists`);
    removeDb(env, to);
  }
  for (const s of ['-wal', '-journal']) if (env.exists(from + s)) env.rename(from + s, to + s);
  env.remove(from + '-shm');
  env.rename(from, to);
}

// --- Splitting nomad.db --------------------------------------------------------

export type SplitPaths = {
  /** Where nomad.db lived up to 1.1.0 (expo-sqlite's default directory). */
  legacy: string;
  /** Where the user's database lives now (the same path on Android). */
  user: string;
  /** The map search index file. */
  index: string;
};

export type SplitState = {
  /** A pre-split nomad.db (index tables inside) is at `legacy`. */
  legacy: boolean;
  /** A split user database is at `user`. */
  user: boolean;
  /** A verified copy of the user's tables waits at `<user>.ready`. */
  ready: boolean;
};

export type SplitStep = 'copy' | 'retire' | 'promote';

export const readyPath = (p: SplitPaths) => `${p.user}.ready`;
export const copyPath = (p: SplitPaths) => `${p.user}.copy`;

/**
 * What is left to do. `copy` writes the verified `.ready` file; `retire` turns the old
 * file into the search index; `promote` renames `.ready` to the user database. Retiring
 * comes before promoting because on Android both live at the same path.
 */
export function planSplit(s: SplitState): SplitStep[] {
  if (s.user) return [];
  if (s.legacy) return s.ready ? ['retire', 'promote'] : ['copy', 'retire', 'promote'];
  return s.ready ? ['promote'] : [];
}

export function readSplitState(env: Env, p: SplitPaths): SplitState {
  const ready = env.exists(readyPath(p));
  const at = (path: string) => (env.exists(path) ? versionAt(env, path) : 0);
  if (p.legacy === p.user) {
    const v = at(p.user);
    return { legacy: v >= 1 && v < SPLIT_VERSION, user: v >= SPLIT_VERSION, ready };
  }
  const v = at(p.legacy);
  // A file at `user` exists only once promoted (or created fresh): it is the user database.
  return { legacy: v >= 1 && v < SPLIT_VERSION, user: env.exists(p.user), ready };
}

/**
 * Copies the user's tables of the old database into a new file with the current schema,
 * checks every row arrived, and renames it to `<user>.ready`. Re-run from scratch when
 * killed (the partial copy is thrown away first).
 */
export function copyUserTables(env: Env, p: SplitPaths, userLadder: string[]) {
  const copy = copyPath(p);
  env.mkdirp(dirOf(copy));
  removeDb(env, copy);
  const db = env.open(copy);
  try {
    // A plain journal: the finished file is one file, safe to rename.
    db.exec('PRAGMA journal_mode = DELETE');
    applyLadder(db, userLadder);
    db.run('ATTACH DATABASE ? AS legacy', p.legacy);
    const old = new Set(tableNames(db, 'legacy'));
    const tables = tableNames(db).filter((t) => old.has(t));
    const plan = tables.map((t) => {
      const legacyColumns = new Set(columnNames(db, t, 'legacy'));
      const spec = COPY_SPEC[t];
      const columns = (spec?.columns ?? columnNames(db, t)).filter((c) => legacyColumns.has(c)).map(q);
      return { table: q(t), columns: columns.join(', '), where: spec?.where ?? '' };
    });
    db.exec('BEGIN');
    try {
      for (const { table, columns, where } of plan) {
        db.exec(`DELETE FROM main.${table}`);
        db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM legacy.${table} ${where}`);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    for (const { table, where } of plan) {
      const count = (schema: string, w: string) => db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${schema}.${table} ${w}`)[0].n;
      const want = count('legacy', where);
      const got = count('main', '');
      if (got !== want) throw new Error(`split: ${table} copied ${got} of ${want} rows`);
    }
    const check = db.all<{ quick_check: string }>('PRAGMA main.quick_check')[0]?.quick_check;
    if (check !== 'ok') throw new Error(`split: copy failed its check (${check})`);
    db.exec('DETACH DATABASE legacy');
  } finally {
    db.close();
  }
  env.rename(copy, readyPath(p));
}

/** The old file, its user tables now copied, becomes the search index (cleaned on its first open). */
export function retireLegacy(env: Env, p: SplitPaths) {
  // Fold the journal into the main file first, so a kill while moving loses nothing.
  const db = env.open(p.legacy);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  // An index file already there (never expected) is derived data: the old index wins.
  moveDb(env, p.legacy, p.index, true);
}

export function promoteReady(env: Env, p: SplitPaths) {
  moveDb(env, readyPath(p), p.user);
}

/** Runs what is left of the split. Throws (leaving a resumable state) when a step fails. */
export function splitDatabase(env: Env, p: SplitPaths, userLadder: string[]): SplitStep[] {
  const steps = planSplit(readSplitState(env, p));
  for (const step of steps) {
    if (step === 'copy') copyUserTables(env, p, userLadder);
    else if (step === 'retire') retireLegacy(env, p);
    else promoteReady(env, p);
  }
  removeDb(env, copyPath(p));
  return steps;
}

/**
 * Where the user's data is after a split attempt, failed or not: the split database, else
 * the old one (used as before for this session; the split is retried next launch).
 */
export function userDatabaseAfter(env: Env, p: SplitPaths): { path: string; split: boolean } {
  const s = readSplitState(env, p);
  if (s.user) return { path: p.user, split: true };
  if (s.legacy) return { path: p.legacy, split: false };
  // Retired but not promoted: the verified copy holds the data.
  if (s.ready) return { path: readyPath(p), split: true };
  return { path: p.user, split: true };
}

// --- The search index file ---------------------------------------------------

export const INDEX_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS index_sources (
    item_id TEXT PRIMARY KEY NOT NULL,   -- map item, pack, or 'places:'/'addresses:' + item id
    index_version INTEGER,
    index_zoom INTEGER,
    indexed_at INTEGER
  );`;

/** The index state a pre-split map_sources table holds, kept where an index row already exists. */
export const COPY_INDEX_STATE = `INSERT OR IGNORE INTO index_sources (item_id, index_version, index_zoom, indexed_at)
  SELECT item_id, index_version, index_zoom, indexed_at FROM map_sources WHERE index_version IS NOT NULL`;

/**
 * For a launch whose split failed, so the index stays inside the old nomad.db: its index
 * state moves into index_sources there, once (map_sources keeps only emergency state), as
 * the index file has it. The split later carries index_sources over with the file. Run it
 * in a transaction.
 */
export const ADOPT_INDEX_STATE = `
  ${INDEX_STATE_TABLE}
  ${COPY_INDEX_STATE};
  DELETE FROM map_sources WHERE pois_at IS NULL;
  UPDATE map_sources SET index_version = NULL, index_zoom = NULL, indexed_at = NULL;`;

/**
 * Turns a retired nomad.db into a plain index file: its index state into index_sources,
 * and the user tables (already copied to the new nomad.db) dropped, their pages zeroed.
 * One transaction: a kill leaves it as it was, done again on the next open. Only call it
 * on the index file, once the split database exists. Returns whether it did anything.
 */
export function cleanRetiredIndex(db: Sql): boolean {
  const tables = new Set(tableNames(db));
  const drop = USER_TABLES.filter((t) => tables.has(t));
  if (!drop.length) return false;
  db.exec('PRAGMA secure_delete = ON');
  db.exec('BEGIN');
  try {
    db.exec(INDEX_STATE_TABLE);
    if (tables.has('map_sources')) db.exec(COPY_INDEX_STATE);
    for (const t of drop) db.exec(`DROP TABLE ${q(t)}`);
    // AUTOINCREMENT counters of the dropped tables.
    if (db.all("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").length) db.exec('DELETE FROM sqlite_sequence');
    // The index ladder starts over; its steps only create what is missing.
    db.exec('PRAGMA user_version = 0');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA secure_delete = OFF');
  }
  return true;
}

// --- Relocating a small database (the kv-store) -------------------------------------

/**
 * Moves a key-value database (expo-sqlite/kv-store's `storage` table) from `from` to `to`:
 * copy to a temporary file, compare every key and value, rename into place, then delete
 * the old file. With `to` in place the move is done, whatever is left at `from`.
 */
export function relocateKv(env: Env, from: string, to: string): 'moved' | 'done' | 'none' {
  if (env.exists(to)) {
    if (env.exists(from)) removeDb(env, from);
    return 'done';
  }
  if (!env.exists(from)) return 'none';
  const tmp = `${to}.copy`;
  env.mkdirp(dirOf(to));
  removeDb(env, tmp);
  const db = env.open(tmp);
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec(KV_SCHEMA);
    db.run('ATTACH DATABASE ? AS old', from);
    if (tableNames(db, 'old').includes('storage')) {
      db.exec('INSERT INTO main.storage (key, value) SELECT key, value FROM old.storage');
      const [{ n: want }] = db.all<{ n: number }>('SELECT COUNT(*) AS n FROM old.storage');
      const [{ n: got }] = db.all<{ n: number }>('SELECT COUNT(*) AS n FROM main.storage');
      const [{ n: differ }] = db.all<{ n: number }>(
        'SELECT COUNT(*) AS n FROM old.storage o LEFT JOIN main.storage m ON m.key = o.key WHERE m.key IS NULL OR m.value IS NOT o.value',
      );
      if (got !== want || differ) throw new Error(`kv: copied ${got} of ${want} keys, ${differ} differ`);
    }
    db.exec('DETACH DATABASE old');
  } finally {
    db.close();
  }
  env.rename(tmp, to);
  removeDb(env, from);
  return 'moved';
}

/** expo-sqlite/kv-store's schema (version 1), so the file stays readable by it. */
export const KV_SCHEMA = `
  CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  PRAGMA user_version = 1;`;
