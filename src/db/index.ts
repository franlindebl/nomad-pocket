// Single SQLite database for all local app state (content registry, downloads,
// reading history, courses, maps, chats). Content files themselves live on disk
// under src/lib/storage paths; this database only references them.
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,            -- 'zim' | 'map' | 'model'
    title TEXT NOT NULL,
    description TEXT,
    language TEXT,
    category TEXT,                 -- catalog category slug (medicine, survival, ...)
    is_course INTEGER NOT NULL DEFAULT 0,
    file_path TEXT NOT NULL,       -- absolute file URI
    size_bytes INTEGER NOT NULL DEFAULT 0,
    version TEXT,
    source_url TEXT,
    catalog_id TEXT,               -- id in the bundled catalog, if any
    meta TEXT,                     -- JSON, kind-specific
    installed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_kind ON items(kind);

  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,            -- 'zim' | 'map' | 'model'
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    dest_uri TEXT NOT NULL,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    bytes_written INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,          -- queued | running | paused | processing | failed | done | cancelled
    error TEXT,
    pause_state TEXT,              -- JSON DownloadPauseState
    meta TEXT,                     -- JSON: item fields to register on completion
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(item_id, path)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    visited_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS history_visited ON history(visited_at DESC);

  CREATE TABLE IF NOT EXISTS courses (
    item_id TEXT PRIMARY KEY NOT NULL,
    syllabus TEXT,                 -- JSON [{path,title,section?}]
    enrolled_at INTEGER NOT NULL,
    last_path TEXT,
    last_title TEXT,
    last_opened_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS course_progress (
    item_id TEXT NOT NULL,
    path TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY(item_id, path)
  );

  CREATE TABLE IF NOT EXISTS map_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    color TEXT,
    note TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    model_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,            -- user | assistant | system
    content TEXT NOT NULL,
    sources TEXT,                  -- JSON [{itemId,path,title}]
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages(session_id, created_at);
  `,
];

let instance: SQLiteDatabase | null = null;

export function db(): SQLiteDatabase {
  if (instance) return instance;
  const database = openDatabaseSync('nomad.db');
  database.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    database.execSync(MIGRATIONS[v]);
    database.execSync(`PRAGMA user_version = ${v + 1}`);
  }
  instance = database;
  return database;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
