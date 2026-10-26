// The app's SQLite files. nomad.db holds the user's data and the content registry
// (downloads, history, bookmarks, courses, saved places, chats). On iOS it lives under
// Library/Application Support, which is backed up but hidden from the Files app
// (UIFileSharingEnabled shows all of Documents). The map search index has its own file,
// Documents/content/index/search.db: up to ~1 GB per country, derived from downloads,
// and kept out of backups like the content it comes from. Both files move into place
// the first time db() runs (migrate-core.ts). Content files live on disk under
// src/lib/storage paths; these databases only reference them.
import { Directory, File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseSync, type SQLiteDatabase, type SQLiteOpenOptions } from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  ADOPT_INDEX_STATE,
  applyLadder,
  cleanRetiredIndex,
  dirOf,
  splitDatabase,
  SPLIT_VERSION,
  userDatabaseAfter,
  type Env,
  type Sql,
} from './migrate-core';
import { INDEX_MIGRATIONS, INDEX_OPEN, MIGRATIONS } from './schema';

const fileAt = (path: string) => new File(`file://${encodeURI(path)}`);

export function openAt(path: string, options?: SQLiteOpenOptions): SQLiteDatabase {
  return openDatabaseSync(path.slice(path.lastIndexOf('/') + 1), options, dirOf(path));
}

function sqlOf(d: SQLiteDatabase): Sql {
  return {
    exec: (sql) => d.execSync(sql),
    all: <T>(sql: string, ...params: (string | number | null)[]) => d.getAllSync<T>(sql, ...params),
    run: (sql, ...params) => void d.runSync(sql, ...params),
    close: () => d.closeSync(),
  };
}

/** File access for the moves in migrate-core.ts (plain paths). */
export const migrationEnv: Env = {
  // Its own connection, closed after: a file is renamed only once nothing holds it open.
  open: (path) => sqlOf(openAt(path, { useNewConnection: true })),
  exists: (path) => fileAt(path).exists,
  rename: (from, to) => fileAt(from).moveSync(fileAt(to)),
  remove: (path) => {
    const f = fileAt(path);
    if (f.exists) f.delete();
  },
  mkdirp: (dir) => new Directory(`file://${encodeURI(dir)}`).create({ intermediates: true, idempotent: true }),
};

type DbPaths = { legacyDir: string; userDir: string; legacy: string; user: string; index: string };
let pathsMemo: DbPaths | null = null;

/** Plain paths of the app's databases. */
export function dbPaths(): DbPaths {
  if (pathsMemo) return pathsMemo;
  // <Documents>/SQLite on iOS, <files>/SQLite on Android, where expo-sqlite opens by default.
  const legacyDir = defaultDatabaseDirectory.replace(/\/+$/, '');
  const documents = dirOf(legacyDir);
  // Android's files dir is private already: the databases stay where they are.
  const userDir =
    Platform.OS === 'ios' && documents.endsWith('/Documents') ? `${dirOf(documents)}/Library/Application Support/SQLite` : legacyDir;
  pathsMemo = { legacyDir, userDir, legacy: `${legacyDir}/nomad.db`, user: `${userDir}/nomad.db`, index: `${documents}/content/index/search.db` };
  return pathsMemo;
}

/** Documents/SQLite once nothing is left in it, so the Files app stops showing it. */
export function removeEmptyLegacyDir() {
  const { legacyDir, userDir } = dbPaths();
  if (legacyDir === userDir) return;
  try {
    const dir = new Directory(`file://${encodeURI(legacyDir)}`);
    if (dir.exists && dir.list().length === 0) dir.delete();
  } catch (e) {
    console.warn('[db] cannot remove the old database folder', e);
  }
}

let instance: SQLiteDatabase | null = null;
/** Where the index tables are: the index file, or nomad.db itself while the split has not happened. */
let indexPath = '';

export function db(): SQLiteDatabase {
  if (instance) return instance;
  const paths = dbPaths();
  try {
    splitDatabase(migrationEnv, paths, MIGRATIONS);
  } catch (e) {
    // Nothing is lost: the old file is used as before and the split is retried next launch.
    console.warn('[db] cannot move the map search index out of nomad.db yet', e);
  }
  const at = userDatabaseAfter(migrationEnv, paths);
  const database = openAt(at.path);
  database.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // v4 drops the index tables: never on a file that still holds the only copy of them.
  applyLadder(sqlOf(database), at.split ? MIGRATIONS : MIGRATIONS.slice(0, SPLIT_VERSION - 1));
  indexPath = at.split ? paths.index : at.path;
  instance = database;
  removeEmptyLegacyDir();
  return database;
}

let indexInstance: SQLiteDatabase | null = null;
let indexBackground: SQLiteDatabase | null = null;

/** The map search index (map_places, map_localities, house numbers, index_sources). */
export function indexDb(): SQLiteDatabase {
  if (indexInstance) return indexInstance;
  const main = db();
  if (indexPath !== dbPaths().index) {
    // The split failed this launch: the index is still in nomad.db, which gets the index
    // state table the index file has.
    main.withTransactionSync(() => main.execSync(ADOPT_INDEX_STATE));
    indexInstance = main;
    return main;
  }
  migrationEnv.mkdirp(dirOf(indexPath));
  const database = openAt(indexPath);
  database.execSync(INDEX_OPEN);
  const sql = sqlOf(database);
  // A retired nomad.db: drop the user tables it still has (their rows are in the new nomad.db).
  cleanRetiredIndex(sql);
  applyLadder(sql, INDEX_MIGRATIONS);
  indexInstance = database;
  return database;
}

/**
 * A second connection to the index, for the async queries and deletes (they run off the
 * JS thread). WAL lets the main connection's synchronous reads go on meanwhile.
 */
export function indexDbAsync(): SQLiteDatabase {
  if (indexBackground) return indexBackground;
  const index = indexDb();
  // Still inside nomad.db: a second writer there would make the user's own writes fail as busy.
  if (index === instance) return (indexBackground = index);
  indexBackground = openAt(indexPath, { useNewConnection: true });
  indexBackground.execSync('PRAGMA busy_timeout = 5000;');
  return indexBackground;
}

/** Bytes the search index takes on disk (0 while it is still inside nomad.db). */
export function searchIndexBytes(): number {
  const { index } = dbPaths();
  if (indexPath && indexPath !== index) return 0;
  let total = 0;
  for (const path of [index, `${index}-wal`]) {
    try {
      const f = fileAt(path);
      if (f.exists) total += Number(f.size ?? 0);
    } catch {
      // gone meanwhile
    }
  }
  return total;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
