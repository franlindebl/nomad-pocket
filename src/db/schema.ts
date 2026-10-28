// Schemas of the app's two SQLite files: nomad.db (the user's data and the content
// registry, backed up) and the index file (Documents/content/index/search.db: the map
// search index and the emergency points, derived from downloaded content or fetched again,
// so out of backups). Append a step to change one; never edit one.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { INDEX_STATE_TABLE } from './migrate-core.ts';

export const MIGRATIONS: string[] = [
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
  // v2: offline map search and emergency points
  `
  -- Search index built from installed maps' tiles (and the emergency points).
  -- 'rank' is reserved by FTS5, hence 'importance' (lower = more important).
  CREATE VIRTUAL TABLE IF NOT EXISTS map_places USING fts5(
    names,
    name UNINDEXED,
    layer UNINDEXED,               -- place | poi | road
    kind UNINDEXED,
    lat UNINDEXED,
    lon UNINDEXED,
    importance UNINDEXED,
    source UNINDEXED,              -- map item id, or 'pois:<map item id>'
    tokenize = 'unicode61 remove_diacritics 2'
  );

  -- Towns and neighbourhoods of the index, for "Calle Mayor · Soria" context lines.
  CREATE TABLE IF NOT EXISTS map_localities (
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS map_localities_lat ON map_localities(lat);
  CREATE INDEX IF NOT EXISTS map_localities_source ON map_localities(source);

  -- OpenStreetMap emergency points fetched (Overpass) for each map region.
  CREATE TABLE IF NOT EXISTS map_pois (
    source TEXT NOT NULL,          -- map item id
    osm_id TEXT NOT NULL,          -- n123 | w456 | r789
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT,
    operator TEXT,
    phone TEXT,
    opening_hours TEXT,
    emergency INTEGER,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    PRIMARY KEY (source, osm_id)
  );
  CREATE INDEX IF NOT EXISTS map_pois_category ON map_pois(category);
  CREATE INDEX IF NOT EXISTS map_pois_lat ON map_pois(lat);

  -- Per map item: search index and emergency point state.
  CREATE TABLE IF NOT EXISTS map_sources (
    item_id TEXT PRIMARY KEY NOT NULL,
    index_version INTEGER,         -- NULL until indexed
    index_zoom INTEGER,
    indexed_at INTEGER,
    pois_at INTEGER,               -- last successful emergency point fetch
    pois_count INTEGER
  );
  `,
  // v3: house numbers for map search (a country pack's addresses file)
  `
  -- One row per street name and source; key = nameKey ("Calle de Alcalá" → "calle alcala").
  CREATE TABLE IF NOT EXISTS map_address_streets (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,          -- routing pack or map item id
    key TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS map_address_streets_key ON map_address_streets(key);
  CREATE INDEX IF NOT EXISTS map_address_streets_source ON map_address_streets(source);

  -- One row per door, millions for a country: no rowid, coordinates in 1e-5 degrees (~1 m).
  CREATE TABLE IF NOT EXISTS map_addresses (
    street INTEGER NOT NULL,       -- map_address_streets.id
    lat INTEGER NOT NULL,
    lon INTEGER NOT NULL,
    number TEXT NOT NULL,          -- houseNumberKey: "12B"
    PRIMARY KEY (street, lat, lon, number)
  ) WITHOUT ROWID;
  `,
  // v4: the map search index and the emergency points moved to the index file
  // (INDEX_MIGRATIONS, migrate-core.ts). Only ever run on the split database: db() never
  // runs it on a pre-split file.
  `
  DROP TABLE IF EXISTS map_places;
  DROP TABLE IF EXISTS map_localities;
  DROP TABLE IF EXISTS map_addresses;
  DROP TABLE IF EXISTS map_address_streets;
  DROP TABLE IF EXISTS map_pois;
  DROP TABLE IF EXISTS map_sources;
  `,
];

/**
 * Run on every open of the index file, before its ladder. auto_vacuum only takes on a file
 * without tables: a fresh one gives a removed map's space back (places.ts runs
 * incremental_vacuum); a retired nomad.db keeps its free pages for the next import.
 */
export const INDEX_OPEN = 'PRAGMA auto_vacuum = INCREMENTAL; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;';

/** The index file. Every step creates only what is missing: a retired nomad.db has it all. */
export const INDEX_MIGRATIONS: string[] = [
  // v1: what nomad.db v2-v3 held, with map_sources split into index_sources (the index
  // state) and map_sources (the emergency point state).
  `
  -- Search index built from installed maps' tiles, country files and emergency points.
  -- 'rank' is reserved by FTS5, hence 'importance' (lower = more important).
  CREATE VIRTUAL TABLE IF NOT EXISTS map_places USING fts5(
    names,
    name UNINDEXED,
    layer UNINDEXED,               -- place | poi | road
    kind UNINDEXED,
    lat UNINDEXED,
    lon UNINDEXED,
    importance UNINDEXED,
    source UNINDEXED,              -- map item id, or 'pois:'/'places:'/'streets:'/'near:' + item id
    tokenize = 'unicode61 remove_diacritics 2'
  );

  -- Towns and neighbourhoods of the index, for "Calle Mayor · Soria" context lines.
  CREATE TABLE IF NOT EXISTS map_localities (
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS map_localities_lat ON map_localities(lat);
  CREATE INDEX IF NOT EXISTS map_localities_source ON map_localities(source);

  -- House numbers: one row per street name and source; key = nameKey ("Calle de Alcalá" → "calle alcala").
  CREATE TABLE IF NOT EXISTS map_address_streets (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,          -- routing pack or map item id
    key TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS map_address_streets_key ON map_address_streets(key);
  CREATE INDEX IF NOT EXISTS map_address_streets_source ON map_address_streets(source);

  -- One row per door, millions for a country: no rowid, coordinates in 1e-5 degrees (~1 m).
  CREATE TABLE IF NOT EXISTS map_addresses (
    street INTEGER NOT NULL,       -- map_address_streets.id
    lat INTEGER NOT NULL,
    lon INTEGER NOT NULL,
    number TEXT NOT NULL,          -- houseNumberKey: "12B"
    PRIMARY KEY (street, lat, lon, number)
  ) WITHOUT ROWID;
  ${INDEX_STATE_TABLE}

  -- OpenStreetMap emergency points of each map region (Overpass, a country file, or the
  -- map's own tiles), for the Emergencias list and the map layer.
  CREATE TABLE IF NOT EXISTS map_pois (
    source TEXT NOT NULL,          -- map item or routing pack id
    osm_id TEXT NOT NULL,          -- n123 | w456 | r789, or 't<lat>,<lon>' from the tiles
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT,
    operator TEXT,
    phone TEXT,
    opening_hours TEXT,
    emergency INTEGER,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    PRIMARY KEY (source, osm_id)
  );
  CREATE INDEX IF NOT EXISTS map_pois_category ON map_pois(category);
  CREATE INDEX IF NOT EXISTS map_pois_lat ON map_pois(lat);

  -- Per map item or pack: emergency point state. A retired nomad.db's table also has the
  -- old index columns, always NULL (see ADOPT_INDEX_STATE).
  CREATE TABLE IF NOT EXISTS map_sources (
    item_id TEXT PRIMARY KEY NOT NULL,
    pois_at INTEGER,               -- last successful emergency point import
    pois_count INTEGER
  );
  `,
  // v2: the library's document index, the text of the PDFs inside installed archives
  // (features/library/documents.ts), for the assistant.
  `
  -- One row per passage (~650 chars, never across pages). The porter stemmer suits the
  -- collections, which are English ("boiling" finds "boil").
  CREATE VIRTUAL TABLE IF NOT EXISTS doc_passages USING fts5(
    text,
    title,
    item_id UNINDEXED,
    path UNINDEXED,
    page UNINDEXED,                -- 1-based
    tokenize = 'porter unicode61 remove_diacritics 2'
  );

  -- Per archive: which file the index was built from, and whether every document is in.
  CREATE TABLE IF NOT EXISTS doc_archives (
    item_id TEXT PRIMARY KEY NOT NULL,
    uuid TEXT NOT NULL,
    version INTEGER NOT NULL,      -- DOC_INDEX_VERSION it was built with
    documents INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER                -- NULL while documents are still being read
  );

  -- Per document, written in the same transaction as its passages.
  CREATE TABLE IF NOT EXISTS doc_files (
    item_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    pages INTEGER NOT NULL,        -- pages read
    text_pages INTEGER NOT NULL,   -- pages with a text layer (0: a scan)
    passages INTEGER NOT NULL,
    status TEXT NOT NULL,          -- done | locked | failed
    PRIMARY KEY (item_id, path)
  );
  `,
];
