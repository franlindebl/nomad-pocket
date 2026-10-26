/// <reference types="node" />
// Drives the file moves against real SQLite files (node:sqlite), including kills between steps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  ADOPT_INDEX_STATE,
  applyLadder,
  cleanRetiredIndex,
  copyUserTables,
  planSplit,
  readSplitState,
  readyPath,
  relocateKv,
  retireLegacy,
  splitDatabase,
  SPLIT_VERSION,
  userDatabaseAfter,
  type Env,
  type Sql,
  type SplitPaths,
} from './migrate-core.ts';
import { INDEX_MIGRATIONS, INDEX_OPEN, MIGRATIONS } from './schema.ts';

function wrap(d: DatabaseSync): Sql {
  return {
    exec: (sql) => d.exec(sql),
    all: <T>(sql: string, ...p: (string | number | null)[]) => d.prepare(sql).all(...p) as T[],
    run: (sql, ...p) => void d.prepare(sql).run(...p),
    close: () => d.close(),
  };
}

const env: Env = {
  open: (p) => wrap(new DatabaseSync(p)),
  exists: (p) => fs.existsSync(p),
  rename: (a, b) => {
    if (fs.existsSync(b)) throw new Error(`exists: ${b}`);
    fs.renameSync(a, b);
  },
  remove: (p) => fs.rmSync(p, { force: true }),
  mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
};

function sandbox(sameFile = false): SplitPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-split-'));
  const legacy = path.join(root, 'Documents/SQLite/nomad.db');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  return {
    legacy,
    user: sameFile ? legacy : path.join(root, 'Library/Application Support/SQLite/nomad.db'),
    index: path.join(root, 'Documents/content/index/search.db'),
  };
}

const SECRET = 'Grandma takes 5 mg warfarin';

/** A nomad.db as 1.1.0 left it: v3, WAL, user rows and a map search index. */
function makeLegacy(p: string, version = 3) {
  const d = new DatabaseSync(p);
  d.exec('PRAGMA journal_mode = WAL');
  const s = wrap(d);
  applyLadder(s, MIGRATIONS.slice(0, version));
  d.exec(`
    INSERT INTO items (id, kind, title, file_path, installed_at) VALUES ('map-es', 'map', 'Spain', 'file:///x/es.pmtiles', 1);
    INSERT INTO bookmarks (item_id, path, title, created_at) VALUES ('wiki', 'A/Water', 'Water', 2);
    INSERT INTO history (item_id, path, title, visited_at) VALUES ('wiki', 'A/Fire', 'Fire', 3);
    INSERT INTO map_markers (name, lat, lon, created_at) VALUES ('Home', 40.4, -3.7, 4);
    INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES ('c1', 'Meds', 5, 5);
    INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m1', 'c1', 'user', '${SECRET}', 6);
  `);
  if (version >= 2) {
    d.exec(`
      INSERT INTO map_places (names, name, layer, kind, lat, lon, importance, source) VALUES ('Soria', 'Soria', 'place', 'city', 41.76, -2.46, 4, 'map-es');
      INSERT INTO map_localities (source, name, lat, lon) VALUES ('map-es', 'Soria', 41.76, -2.46);
      INSERT INTO map_pois (source, osm_id, kind, category, lat, lon) VALUES ('map-es', 'n1', 'hospital', 'health', 41.7, -2.4);
      INSERT INTO map_sources (item_id, index_version, index_zoom, indexed_at, pois_at, pois_count) VALUES ('map-es', 1, 12, 7, 8, 1);
      INSERT INTO map_sources (item_id, index_version, indexed_at) VALUES ('places:map-es', 1, 9);
    `);
  }
  if (version >= 3) {
    d.exec(`
      INSERT INTO map_address_streets (id, source, key) VALUES (1, 'map-es', 'calle mayor');
      INSERT INTO map_addresses (street, lat, lon, number) VALUES (1, 4176000, -246000, '12B');
    `);
  }
  return d;
}

/** node:sqlite rows have no prototype; deepEqual wants plain objects. */
const plain = (rs: unknown[]) => rs.map((r) => ({ ...(r as object) }));

const rows = (p: string, sql: string) => {
  const d = new DatabaseSync(p);
  try {
    return plain(d.prepare(sql).all());
  } finally {
    d.close();
  }
};

function assertSplit(p: SplitPaths) {
  assert.ok(!fs.existsSync(p.legacy) || p.legacy === p.user, 'old file retired');
  assert.ok(!fs.existsSync(readyPath(p)));
  const user = new DatabaseSync(p.user);
  try {
    assert.equal((user.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, MIGRATIONS.length);
    assert.equal((user.prepare('SELECT content FROM chat_messages').get() as { content: string }).content, SECRET);
    assert.equal(user.prepare('SELECT * FROM bookmarks').all().length, 1);
    assert.equal(user.prepare('SELECT * FROM history').all().length, 1);
    assert.equal(user.prepare('SELECT * FROM map_markers').all().length, 1);
    assert.equal(user.prepare('SELECT * FROM items').all().length, 1);
    assert.equal(user.prepare('SELECT * FROM map_pois').all().length, 1);
    // Only the emergency state stays; the index state went with the index.
    assert.deepEqual(plain(user.prepare('SELECT item_id, index_version, pois_at FROM map_sources').all()), [
      { item_id: 'map-es', index_version: null, pois_at: 8 },
    ]);
    const tables = user.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name);
    assert.ok(!tables.some((t) => t.startsWith('map_places') || t === 'map_addresses' || t === 'map_localities'), tables.join());
    // AUTOINCREMENT keeps counting after the copied ids.
    user.exec("INSERT INTO map_markers (name, lat, lon, created_at) VALUES ('Car', 1, 1, 9)");
    assert.equal((user.prepare("SELECT id FROM map_markers WHERE name = 'Car'").get() as { id: number }).id, 2);
  } finally {
    user.close();
  }
}

function openIndex(p: SplitPaths) {
  const d = new DatabaseSync(p.index);
  const s = wrap(d);
  d.exec(INDEX_OPEN);
  const cleaned = cleanRetiredIndex(s);
  applyLadder(s, INDEX_MIGRATIONS);
  return { d, cleaned };
}

for (const sameFile of [false, true]) {
  const where = sameFile ? 'in place (Android)' : 'to Application Support (iOS)';

  test(`split ${where}: user data copied, old file becomes the index`, () => {
    const p = sandbox(sameFile);
    makeLegacy(p.legacy).close();
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['copy', 'retire', 'promote']);
    assertSplit(p);
    assert.deepEqual(userDatabaseAfter(env, p), { path: p.user, split: true });

    const { d, cleaned } = openIndex(p);
    assert.ok(cleaned);
    assert.equal(d.prepare("SELECT name FROM map_places WHERE map_places MATCH 'sor*'").all().length, 1);
    assert.equal(d.prepare('SELECT * FROM map_addresses').all().length, 1);
    assert.deepEqual(plain(d.prepare('SELECT item_id, index_version, index_zoom FROM index_sources ORDER BY item_id').all()), [
      { item_id: 'map-es', index_version: 1, index_zoom: 12 },
      { item_id: 'places:map-es', index_version: 1, index_zoom: null },
    ]);
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name);
    assert.ok(!tables.includes('chat_messages') && !tables.includes('items') && !tables.includes('map_sources'), tables.join());
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    d.close();
    // The chats are gone from the index file, free pages included (secure_delete).
    assert.ok(!fs.readFileSync(p.index).includes(Buffer.from(SECRET)), 'no user data left in the index file');

    // Opening again changes nothing; a second split does nothing.
    assert.equal(openIndex(p).cleaned, false);
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), []);
  });

  test(`split ${where}: resumes after a kill between steps`, () => {
    // Killed after the copy.
    let p = sandbox(sameFile);
    makeLegacy(p.legacy).close();
    copyUserTables(env, p, MIGRATIONS);
    assert.deepEqual(planSplit(readSplitState(env, p)), ['retire', 'promote']);
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['retire', 'promote']);
    assertSplit(p);

    // Killed after retiring the old file (on Android the user database is then missing).
    p = sandbox(sameFile);
    makeLegacy(p.legacy).close();
    copyUserTables(env, p, MIGRATIONS);
    retireLegacy(env, p);
    assert.deepEqual(userDatabaseAfter(env, p), { path: readyPath(p), split: true });
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['promote']);
    assertSplit(p);

    // Killed during the copy: a partial file is thrown away and the copy starts over.
    p = sandbox(sameFile);
    makeLegacy(p.legacy).close();
    fs.mkdirSync(path.dirname(p.user), { recursive: true });
    fs.writeFileSync(`${p.user}.copy`, 'half a database');
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['copy', 'retire', 'promote']);
    assertSplit(p);
    assert.ok(!fs.existsSync(`${p.user}.copy`));
  });

  test(`split ${where}: a failed step leaves the old database in use, retried next time`, () => {
    const p = sandbox(sameFile);
    makeLegacy(p.legacy).close();
    const failing: Env = {
      ...env,
      rename: () => {
        throw new Error('disk full');
      },
    };
    assert.throws(() => splitDatabase(failing, p, MIGRATIONS), /disk full/);
    assert.deepEqual(userDatabaseAfter(env, p), { path: p.legacy, split: false });
    assert.equal(rows(p.legacy, 'SELECT * FROM chat_messages').length, 1);
    assert.equal(rows(p.legacy, 'SELECT * FROM map_places').length, 1);
    assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['copy', 'retire', 'promote']);
    assertSplit(p);
  });
}

test('split: index state written while the split could not run is kept', () => {
  const p = sandbox();
  const d = makeLegacy(p.legacy);
  // A launch whose split failed: db/index.ts adds index_sources to the old file and uses it.
  d.exec(ADOPT_INDEX_STATE);
  assert.deepEqual(plain(d.prepare('SELECT item_id, index_version, pois_at FROM map_sources').all()), [
    { item_id: 'map-es', index_version: null, pois_at: 8 },
  ]);
  d.exec(ADOPT_INDEX_STATE); // every such launch
  assert.equal(d.prepare('SELECT * FROM index_sources').all().length, 2);
  // That session re-indexes the map and starts (without finishing) a country file import.
  d.exec("UPDATE index_sources SET index_zoom = 13 WHERE item_id = 'map-es'");
  d.exec("DELETE FROM index_sources WHERE item_id = 'places:map-es'");
  d.close();
  assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['copy', 'retire', 'promote']);
  const { d: index } = openIndex(p);
  assert.deepEqual(plain(index.prepare('SELECT item_id, index_zoom FROM index_sources').all()), [{ item_id: 'map-es', index_zoom: 13 }]);
  index.close();
});

test('split: reads rows still in the write-ahead log', () => {
  const p = sandbox();
  const writer = makeLegacy(p.legacy);
  // The writer stays open: its rows are in nomad.db-wal, not yet in nomad.db.
  writer.exec("INSERT INTO bookmarks (item_id, path, title, created_at) VALUES ('wiki', 'A/Shelter', 'Shelter', 10)");
  assert.ok(fs.existsSync(`${p.legacy}-wal`));
  copyUserTables(env, p, MIGRATIONS);
  writer.close();
  assert.equal(rows(readyPath(p), 'SELECT * FROM bookmarks').length, 2);
});

test('split: a database from before map search (v1) and a fresh install', () => {
  let p = sandbox();
  makeLegacy(p.legacy, 1).close();
  assert.deepEqual(splitDatabase(env, p, MIGRATIONS), ['copy', 'retire', 'promote']);
  assert.equal(rows(p.user, 'SELECT * FROM chat_messages').length, 1);
  assert.equal(rows(p.user, 'SELECT * FROM map_pois').length, 0);

  p = sandbox();
  assert.deepEqual(splitDatabase(env, p, MIGRATIONS), []);
  assert.deepEqual(userDatabaseAfter(env, p), { path: p.user, split: true });
  assert.ok(!fs.existsSync(p.legacy) && !fs.existsSync(p.index));
});

test('planSplit', () => {
  assert.deepEqual(planSplit({ legacy: false, user: false, ready: false }), []);
  assert.deepEqual(planSplit({ legacy: true, user: false, ready: false }), ['copy', 'retire', 'promote']);
  assert.deepEqual(planSplit({ legacy: true, user: false, ready: true }), ['retire', 'promote']);
  assert.deepEqual(planSplit({ legacy: false, user: false, ready: true }), ['promote']);
  // A split database is never overwritten, whatever else is there.
  assert.deepEqual(planSplit({ legacy: true, user: true, ready: true }), []);
  assert.equal(SPLIT_VERSION, MIGRATIONS.length);
});

test('a fresh index file vacuums incrementally', () => {
  const p = sandbox();
  fs.mkdirSync(path.dirname(p.index), { recursive: true });
  const { d, cleaned } = openIndex(p);
  assert.equal(cleaned, false);
  assert.equal((d.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum: number }).auto_vacuum, 2);
  d.close();
});

test('relocateKv copies every key, then removes the old file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-kv-'));
  const from = path.join(root, 'Documents/SQLite/ExpoSQLiteStorage');
  const to = path.join(root, 'Library/Application Support/SQLite/ExpoSQLiteStorage');
  assert.equal(relocateKv(env, from, to), 'none');

  fs.mkdirSync(path.dirname(from), { recursive: true });
  const old = new DatabaseSync(from);
  old.exec('CREATE TABLE storage (key TEXT PRIMARY KEY NOT NULL, value TEXT); PRAGMA user_version = 1;');
  const plan = JSON.stringify({ state: { people: [{ name: 'Ana', meds: 'insulin' }] }, version: 3 });
  old.prepare('INSERT INTO storage VALUES (?, ?)').run('prepare', plan);
  old.prepare('INSERT INTO storage VALUES (?, ?)').run('settings', '{"state":{"language":"es"}}');
  old.close();

  // Killed before the rename: the copy is redone.
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(`${to}.copy`, 'partial');
  assert.equal(relocateKv(env, from, to), 'moved');
  assert.ok(!fs.existsSync(from) && !fs.existsSync(`${to}.copy`));
  assert.deepEqual(rows(to, 'SELECT key, value FROM storage ORDER BY key'), [
    { key: 'prepare', value: plan },
    { key: 'settings', value: '{"state":{"language":"es"}}' },
  ]);
  assert.deepEqual(rows(to, 'PRAGMA user_version'), [{ user_version: 1 }]);

  // Killed after the rename: the old file is deleted, the new one kept.
  fs.writeFileSync(from, '');
  assert.equal(relocateKv(env, from, to), 'done');
  assert.ok(!fs.existsSync(from));
  assert.equal(rows(to, 'SELECT * FROM storage').length, 2);
});
