// Offline place search over installed maps. Each map item's tiles are decoded
// once into a SQLite FTS5 index (map_places) in the background, one map at a
// time, in small batches so the JS thread stays responsive. Emergency points
// fetched from Overpass (emergency.ts) are added to the same index.
import { File, FileMode } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { db } from '@/db';
import { getItem, listItems } from '@/features/content/items';
import { decodeTile } from '@/lib/mvt/decode';
import { countBBoxTiles, listZoomTiles, readTile, type Header, type RangeSource, type TileEntry } from '@/lib/pmtiles';

import { kindCategory, tileEmergencyKind } from './emergency-core';
import { bboxAround, distanceMeters, type LatLon } from './geo';
import {
  ftsQuery,
  INDEX_LAYERS,
  nearestLocality,
  parseAddress,
  pickIndexZoom,
  rankHits,
  tileRows,
  type Hit,
  type PlaceLayer,
  type PlaceRow,
} from './places-core';
import { useMapUi } from './store';
import { resolveMapFile, type MapItem } from './useMapSources';

/** Bump to rebuild every index after changing what tileRows extracts. */
export const INDEX_VERSION = 1;

const BATCH_TILES = 24;
const LOCALITY_KINDS = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'locality',
  'suburb',
  'neighbourhood',
  'quarter',
  'macrohood',
  'isolated_dwelling',
]);

/** Indexing progress per map item id (0..1), and a counter bumped whenever an index changes (the search sheet re-queries). */
export const usePlaceIndex = create<{ progress: Record<string, number>; version: number }>(() => ({ progress: {}, version: 0 }));

const bumpVersion = () => usePlaceIndex.setState((s) => ({ version: s.version + 1 }));

function setProgress(id: string, value: number | null) {
  usePlaceIndex.setState((s) => {
    const progress = { ...s.progress };
    if (value === null) delete progress[id];
    else progress[id] = value;
    return { progress };
  });
}

/** Synchronous positional reads from a local archive. */
class LocalFileSource implements RangeSource {
  readonly key: string;
  private readonly handle: ReturnType<File['open']>;

  constructor(file: File) {
    this.key = file.uri;
    this.handle = file.open(FileMode.ReadOnly);
  }

  async getBytes(offset: number, length: number): Promise<Uint8Array> {
    this.handle.offset = offset;
    return this.handle.readBytesSync(length);
  }

  close() {
    try {
      this.handle.close();
    } catch {
      // already closed
    }
  }
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function insertRows(source: string, rows: PlaceRow[]) {
  if (!rows.length) return;
  const d = db();
  const place = d.prepareSync(
    'INSERT INTO map_places (names, name, layer, kind, lat, lon, importance, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const locality = d.prepareSync('INSERT INTO map_localities (source, name, lat, lon) VALUES (?, ?, ?, ?)');
  try {
    d.withTransactionSync(() => {
      for (const r of rows) {
        // Unnamed emergency points (drinking water…) only feed the emergency list.
        if (!r.name) continue;
        place.executeSync(r.names, r.name, r.layer, r.kind, r.lat, r.lon, r.rank, source);
        if (r.layer === 'place' && LOCALITY_KINDS.has(r.kind)) locality.executeSync(source, r.name, r.lat, r.lon);
      }
    });
  } finally {
    place.finalizeSync();
    locality.finalizeSync();
  }
}

export function deletePlaceRows(source: string) {
  db().runSync('DELETE FROM map_places WHERE source = ?', source);
  db().runSync('DELETE FROM map_localities WHERE source = ?', source);
}

/** Adds emergency points to the search index under 'pois:<item id>' (replacing earlier ones). */
export function indexEmergencyPoints(itemId: string, rows: PlaceRow[]) {
  deletePlaceRows(`pois:${itemId}`);
  insertRows(`pois:${itemId}`, rows);
  bumpVersion();
}

/** Whether a routing pack's street names are in the index. */
export function hasPackStreets(itemId: string): boolean {
  return !!db().getFirstSync('SELECT 1 FROM map_sources WHERE item_id = ? AND index_version IS NOT NULL', itemId);
}

/**
 * A routing pack's street and locality names (hundreds of thousands for a country):
 * inserted in batches with a yield in between, so the UI stays responsive. Counted as
 * a search index (hasSearchIndex) even without a map installed.
 */
export async function indexPackStreets(itemId: string, rows: PlaceRow[]) {
  deletePlaceRows(itemId);
  for (let i = 0; i < rows.length && getItem(itemId); i += 5000) {
    insertRows(itemId, rows.slice(i, i + 5000));
    await yieldToUi();
  }
  if (!getItem(itemId)) {
    deletePlaceRows(itemId); // removed meanwhile
    return;
  }
  db().runSync(
    `INSERT INTO map_sources (item_id, index_version, indexed_at) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET index_version = excluded.index_version, indexed_at = excluded.indexed_at`,
    itemId,
    INDEX_VERSION,
    Date.now(),
  );
  bumpVersion();
}

/**
 * Emergency points found in the map's own tiles, stored as an offline fallback
 * (ids 't…') until Overpass points replace them (emergency.ts deletes the source's
 * rows before inserting). Skipped once a region has Overpass points.
 */
function storeTileEmergencyPoints(itemId: string, rows: PlaceRow[]) {
  const d = db();
  if (d.getFirstSync('SELECT 1 FROM map_sources WHERE item_id = ? AND pois_at IS NOT NULL', itemId)) return;
  const insert = d.prepareSync(
    'INSERT OR REPLACE INTO map_pois (source, osm_id, kind, category, name, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  try {
    d.withTransactionSync(() => {
      d.runSync("DELETE FROM map_pois WHERE source = ? AND osm_id LIKE 't%'", itemId);
      for (const r of rows) {
        const kind = r.layer === 'poi' ? tileEmergencyKind(r.kind) : null;
        if (kind) insert.executeSync(itemId, `t${r.lat},${r.lon}`, kind, kindCategory(kind), r.name || null, r.lat, r.lon);
      }
    });
  } finally {
    insert.finalizeSync();
  }
}

const keepUnnamedEmergency = (kind: string) => tileEmergencyKind(kind) !== null;

// --- Background indexing queue ----------------------------------------------

const cancelled = new Set<string>();
let queue: Promise<void> = Promise.resolve();
const queued = new Set<string>();

/** Zoom the whole map is indexed at (big maps: a low one, see pickIndexZoom). */
function indexZoomOf(meta: MapItem['meta']): number {
  return meta.role === 'world'
    ? Math.min(meta.maxZoom, 5)
    : pickIndexZoom(meta.maxZoom, meta.minZoom, (zz) => countBBoxTiles(meta.bbox, zz, zz));
}

/**
 * Decodes `tiles` into the index under `source`, replacing its rows, in batches with a
 * yield in between (progress shows under the map's id). False when the map was removed
 * meanwhile (nothing is left behind).
 */
async function indexTiles(
  item: MapItem,
  file: LocalFileSource,
  header: Header,
  tiles: TileEntry[],
  source: string,
  onRows?: (rows: PlaceRow[]) => void,
) {
  deletePlaceRows(source);
  setProgress(item.id, 0);
  for (let i = 0; i < tiles.length; i += BATCH_TILES) {
    if (cancelled.has(item.id)) break;
    const rows: PlaceRow[] = [];
    for (const t of tiles.slice(i, i + BATCH_TILES)) {
      try {
        rows.push(...tileRows(decodeTile(await readTile(file, header, t), INDEX_LAYERS), t.z, t.x, t.y, keepUnnamedEmergency));
      } catch (e) {
        console.warn('[maps] cannot index tile', t.z, t.x, t.y, e);
      }
    }
    insertRows(source, rows);
    onRows?.(rows);
    setProgress(item.id, Math.min(1, (i + BATCH_TILES) / Math.max(1, tiles.length)));
    await yieldToUi();
  }
  // Removed during a batch or the last batch's yield: don't record anything for it.
  if (!cancelled.has(item.id)) return true;
  deletePlaceRows(source);
  return false;
}

async function indexItem(item: MapItem) {
  const file = new File(resolveMapFile(item));
  if (!file.exists) return;
  const source = new LocalFileSource(file);
  try {
    const z = indexZoomOf(item.meta);
    const { header, tiles } = await listZoomTiles(source, z);
    const emergencyRows: PlaceRow[] = [];
    const done = await indexTiles(item, source, header, tiles, item.id, (rows) => {
      for (const r of rows) if (r.layer === 'poi' && tileEmergencyKind(r.kind)) emergencyRows.push(r);
    });
    if (!done) return;
    db().runSync(
      `INSERT INTO map_sources (item_id, index_version, index_zoom, indexed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET index_version = excluded.index_version, index_zoom = excluded.index_zoom, indexed_at = excluded.indexed_at`,
      item.id,
      INDEX_VERSION,
      z,
      Date.now(),
    );
    storeTileEmergencyPoints(item.id, emergencyRows);
  } finally {
    source.close();
    setProgress(item.id, null);
    bumpVersion();
  }
}

/** Asked again while queued or running (file replaced, or removed and downloaded again). */
const again = new Set<string>();

/** Queues (re)indexing of a map item. Safe to call repeatedly. */
export function scheduleIndex(item: MapItem) {
  cancelled.delete(item.id);
  if (queued.has(item.id)) {
    again.add(item.id);
    return;
  }
  queued.add(item.id);
  queue = queue
    .then(() => (cancelled.has(item.id) ? undefined : indexItem(item)))
    .catch((e) => console.warn('[maps] indexing failed', item.id, e))
    .finally(() => {
      queued.delete(item.id);
      // Index the current file once more, read fresh from the registry.
      if (again.delete(item.id)) {
        const fresh = getItem(item.id) as MapItem | null;
        if (fresh) scheduleIndex(fresh);
      }
    });
}

/** Indexes every installed map whose index is missing or outdated. */
export function indexStaleMaps() {
  const rows = db().getAllSync<{ item_id: string; index_version: number | null }>('SELECT item_id, index_version FROM map_sources');
  const done = new Map(rows.map((r) => [r.item_id, r.index_version]));
  for (const item of listItems('map') as MapItem[]) {
    if (done.get(item.id) !== INDEX_VERSION) scheduleIndex(item);
  }
}

/** A map item's file changed (re-downloaded): rebuild its index. */
export function invalidateIndex(item: MapItem) {
  db().runSync('UPDATE map_sources SET index_version = NULL WHERE item_id = ?', item.id);
  forgetDetail(item.id);
  scheduleIndex(item);
}

/** Map removed: stop its job and drop everything derived from it. */
export function forgetMapSource(itemId: string) {
  cancelled.add(itemId);
  again.delete(itemId);
  deletePlaceRows(itemId);
  deletePlaceRows(`pois:${itemId}`);
  forgetDetail(itemId);
  db().runSync('DELETE FROM map_pois WHERE source = ?', itemId);
  db().runSync('DELETE FROM map_sources WHERE item_id = ?', itemId);
}

// --- Detail around the user ---------------------------------------------------
// A big map is indexed at a low zoom (Spain at z12), where Protomaps keeps only the
// important POIs: no schools, shops or most streets. Around where the user is (at
// startup) or looks (opening search), the map's own max zoom (at most 15) is indexed
// too, under 'near:<item id>': a 50 km square is ~700 tiles at z14, ~2900 at z15.
// Duplicates of the whole-map rows are merged by rankHits.

const DETAIL_RADIUS = 25_000;
/** This far from the last detail centre, the new surroundings are indexed instead. */
const DETAIL_MOVE = 10_000;
const DETAIL_KEY = 'maps.detailIndex';
/** Lowest map zoom whose centre is taken as where the user looks. */
const DETAIL_VIEW_ZOOM = 9;

/** Centre of the indexed detail and the zoom done for each map item. */
type DetailState = { version: number; lat: number; lon: number; zooms: Record<string, number> };

const detailSource = (itemId: string) => `near:${itemId}`;
let detailWanted: LatLon | null = null;

function readDetail(): DetailState | null {
  try {
    const raw = Storage.getItemSync(DETAIL_KEY);
    return raw ? (JSON.parse(raw) as DetailState) : null;
  } catch {
    return null;
  }
}

function forgetDetail(itemId: string) {
  deletePlaceRows(detailSource(itemId));
  const state = readDetail();
  if (state?.zooms[itemId] === undefined) return;
  delete state.zooms[itemId];
  Storage.setItemSync(DETAIL_KEY, JSON.stringify(state));
}

/** Indexes the map detail around `p` unless it is already there. Cheap to call often. */
export function indexDetailAround(p: LatLon) {
  const pending = detailWanted !== null;
  detailWanted = p;
  if (pending) return;
  queue = queue
    .then(() => {
      const next = detailWanted;
      detailWanted = null;
      return next ? refreshDetail(next) : undefined;
    })
    .catch((e) => console.warn('[maps] detail indexing failed', e));
}

/** Same around what the map shows, when zoomed in on a place rather than a country or the world. */
export function indexDetailAroundView() {
  const v = useMapUi.getState().viewport;
  if (v && v.zoom >= DETAIL_VIEW_ZOOM) indexDetailAround({ lon: v.center[0], lat: v.center[1] });
}

async function refreshDetail(p: LatLon) {
  const state = readDetail();
  const fresh = state?.version === INDEX_VERSION && distanceMeters(state, p) < DETAIL_MOVE;
  const centre = fresh ? state : p;
  const box = bboxAround(centre, DETAIL_RADIUS);
  const [w, s, e, n] = box;
  const around = (listItems('map') as MapItem[]).filter((i) => {
    const [iw, is, ie, inn] = i.meta.bbox;
    return i.meta.role === 'region' && iw < e && ie > w && is < n && inn > s;
  });
  const zooms: Record<string, number> = {};
  for (const id of Object.keys(state?.zooms ?? {})) {
    if (!around.some((i) => i.id === id)) deletePlaceRows(detailSource(id));
  }
  for (const item of around) {
    const z = Math.min(15, item.meta.maxZoom);
    if (z <= indexZoomOf(item.meta)) continue;
    if (fresh && state.zooms[item.id] === z) {
      zooms[item.id] = z;
      continue;
    }
    const file = new File(resolveMapFile(item));
    if (!file.exists) continue;
    const source = new LocalFileSource(file);
    try {
      const { header, tiles } = await listZoomTiles(source, z, { bbox: box });
      if (await indexTiles(item, source, header, tiles, detailSource(item.id))) zooms[item.id] = z;
    } finally {
      source.close();
      setProgress(item.id, null);
      bumpVersion();
    }
  }
  Storage.setItemSync(
    DETAIL_KEY,
    JSON.stringify({ version: INDEX_VERSION, lat: centre.lat, lon: centre.lon, zooms } satisfies DetailState),
  );
}

// --- Search -----------------------------------------------------------------

export type SearchResult = Hit & { context: string | null };

type HitRow = { id: number; name: string; layer: PlaceLayer; kind: string; lat: number; lon: number; importance: number };

/**
 * Places, POIs and streets matching what the user typed, best first. An address
 * ("Calle Alcalá 50") also brings the streets matching its street part: no house
 * numbers are indexed, so it leads to the street.
 */
export function searchPlaces(text: string, near: LatLon | null, limit = 40): SearchResult[] {
  const hits = matchPlaces(text, near, limit);
  const address = parseAddress(text);
  if (address) {
    const seen = new Set(hits.map((h) => h.id));
    for (const h of matchPlaces(address.street, near, limit, 'road')) if (!seen.has(h.id)) hits.push(h);
  }
  return hits.slice(0, limit).map((h) => ({ ...h, context: h.layer === 'place' ? null : localityNear(h) }));
}

function matchPlaces(text: string, near: LatLon | null, limit: number, layer?: PlaceLayer): Hit[] {
  const match = ftsQuery(text);
  if (!match) return [];
  let rows: HitRow[];
  const columns =
    'rowid AS id, name, layer, kind, CAST(lat AS REAL) AS lat, CAST(lon AS REAL) AS lon, CAST(importance AS INTEGER) AS importance';
  const onLayer = layer ? 'AND layer = ?' : '';
  const layerArg = layer ? [layer] : [];
  try {
    rows = db().getAllSync<HitRow>(
      `SELECT ${columns} FROM map_places WHERE map_places MATCH ? ${onLayer} ORDER BY CAST(importance AS INTEGER) LIMIT 600`,
      match,
      ...layerArg,
    );
    // A common street name ("Calle Mayor") matches thousands of rows across a country:
    // the ones around the user too, else the nearest may not be among the first 600.
    if (near) {
      const [w, s, e, n] = bboxAround(near, 30_000);
      const seen = new Set(rows.map((r) => r.id));
      for (const r of db().getAllSync<HitRow>(
        `SELECT ${columns} FROM map_places WHERE map_places MATCH ? ${onLayer}
         AND CAST(lat AS REAL) BETWEEN ? AND ? AND CAST(lon AS REAL) BETWEEN ? AND ? LIMIT 600`,
        match,
        ...layerArg,
        s,
        n,
        w,
        e,
      )) {
        if (!seen.has(r.id)) rows.push(r);
      }
    }
  } catch (e) {
    console.warn('[maps] search failed', e);
    return [];
  }
  return rankHits(
    rows.map((r) => ({ id: r.id, name: r.name, names: '', layer: r.layer, kind: r.kind, lat: r.lat, lon: r.lon, rank: r.importance })),
    text,
    near,
    limit,
  );
}

function localityNear(p: LatLon): string | null {
  const [w, s, e, n] = bboxAround(p, 15_000);
  const candidates = db().getAllSync<{ name: string; lat: number; lon: number }>(
    'SELECT name, lat, lon FROM map_localities WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 400',
    s,
    n,
    w,
    e,
  );
  return nearestLocality(p, candidates)?.name ?? null;
}

/** Whether any installed map has a finished search index (else the sheet explains why results are empty). */
export function hasSearchIndex(): boolean {
  return !!db().getFirstSync('SELECT 1 FROM map_sources WHERE index_version IS NOT NULL LIMIT 1');
}
