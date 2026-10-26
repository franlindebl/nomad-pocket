// The app's key-value store: the zustand persisted stores (settings, the emergency plan
// and kit, the assistant's state) and small UI state. Same file and schema as
// expo-sqlite/kv-store, which always opens Documents/SQLite: on iOS the Files app shows
// that folder, so this store lives with nomad.db under Library/Application Support,
// moved there on first use (migrate-core.ts relocateKv). Android keeps it in place.
import type { SQLiteDatabase } from 'expo-sqlite';

import { dbPaths, migrationEnv, openAt, removeEmptyLegacyDir } from './index';
import { KV_SCHEMA, relocateKv } from './migrate-core';

const NAME = 'ExpoSQLiteStorage';
const GET = 'SELECT value FROM storage WHERE key = ?';
const SET = 'INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
const REMOVE = 'DELETE FROM storage WHERE key = ?';

let conn: SQLiteDatabase | null = null;

function store(): SQLiteDatabase {
  if (conn) return conn;
  const { legacyDir, userDir } = dbPaths();
  const from = `${legacyDir}/${NAME}`;
  let path = `${userDir}/${NAME}`;
  if (from !== path) {
    try {
      relocateKv(migrationEnv, from, path);
    } catch (e) {
      console.warn('[kv] cannot move the store yet', e);
    }
    // Not moved: the old file serves this session and the move is retried next launch.
    if (!migrationEnv.exists(path) && migrationEnv.exists(from)) path = from;
  }
  const database = openAt(path);
  database.execSync(KV_SCHEMA);
  conn = database;
  removeEmptyLegacyDir();
  return database;
}

/** Drop-in for the parts of expo-sqlite/kv-store the app uses (zustand's createJSONStorage too). */
const Storage = {
  getItemSync(key: string): string | null {
    return store().getFirstSync<{ value: string }>(GET, key)?.value ?? null;
  },
  setItemSync(key: string, value: string) {
    store().runSync(SET, key, value);
  },
  removeItemSync(key: string): boolean {
    return store().runSync(REMOVE, key).changes > 0;
  },
  async getItem(key: string): Promise<string | null> {
    return (await store().getFirstAsync<{ value: string }>(GET, key))?.value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await store().runAsync(SET, key, value);
  },
  async removeItem(key: string): Promise<void> {
    await store().runAsync(REMOVE, key);
  },
};

export default Storage;
