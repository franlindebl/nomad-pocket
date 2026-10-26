// Offline place search over installed maps. Each map item's tiles are decoded
// once into a SQLite FTS5 index (map_places, in the index file: indexDb) in the
// background, one map at a time, in small batches so the JS thread stays responsive.
// Country files (places, streets, house numbers) and emergency points (emergency.ts)
// go into the same index; the points themselves (map_pois) live in the same file. Writes
// to it take turns (exclusive); searches and the big deletes of a removed map run off the
// JS thread on a second connection.
import { File, FileMode } from 'expo-file-system';
import { create } from 'zustand';

import { indexDb, indexDbAsync } from '@/db';
import Storage from '@/db/kv';
import { getItem, listItems } from '@/features/content/items';
import { decodeTile } from '@/lib/mvt/decode';
import { countBBoxTiles, listZoomTiles, readTile, type Header, type RangeSource, type TileEntry } from '@/lib/pmtiles';

import { kindCategory, tileEmergencyKind } from './emergency-core';
import { bboxAround, distanceMeters, type LatLon } from './geo';
import {
  ftsQuery,
  INDEX_LAYERS,
  indexText,
  matchCap,
  nearestLocality,
  houseNumberKey,
  locateHouseNumber,
  nameKey,
  parseAddress,
  parseAddressesTsv,
  parseJapaneseAddress,
  parsePlacesTsv,
  parseStreetsTsv,
  pickIndexZoom,
  rankHits,
  tileRows,
  type AddressRow,
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

let writes: Promise<unknown> = Promise.resolve();

/**
 * Runs `job` after every write to the index file queued before it (emergency points
 * included). One writer at a time: a long import and the deletes of a removed map, on two
 * connections, would otherwise wait on each other's locks, the synchronous side blocking
 * the JS thread. Never await one job from inside another.
 */
export function exclusive<T>(job: () => Promise<T> | T): Promise<T> {
  const run = writes.then(job);
  writes = run.catch((e) => console.warn('[maps] index write failed', e));
  return run;
}

/** Index state rows (index_sources): a map's tile index, or a country file's import. */
function markIndexed(itemId: string, zoom: number | null = null) {
  indexDb().runSync(
    'INSERT OR REPLACE INTO index_sources (item_id, index_version, index_zoom, indexed_at) VALUES (?, ?, ?, ?)',
    itemId,
    INDEX_VERSION,
    zoom,
    Date.now(),
  );
}

const isIndexed = (itemId: string) =>
  !!indexDb().getFirstSync('SELECT 1 FROM index_sources WHERE item_id = ? AND index_version IS NOT NULL', itemId);

function insertRows(source: string, rows: PlaceRow[]) {
  if (!rows.length) return;
  const d = indexDb();
  const place = d.prepareSync(
    'INSERT INTO map_places (names, name, layer, kind, lat, lon, importance, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const locality = d.prepareSync('INSERT INTO map_localities (source, name, lat, lon) VALUES (?, ?, ?, ?)');
  try {
    d.withTransactionSync(() => {
      for (const r of rows) {
        // Unnamed emergency points (drinking water…) only feed the emergency list.
        if (!r.name) continue;
        place.executeSync(indexText(r.names), r.name, r.layer, r.kind, r.lat, r.lon, r.rank, source);
        if (r.layer === 'place' && LOCALITY_KINDS.has(r.kind)) locality.executeSync(source, r.name, r.lat, r.lon);
      }
    });
  } finally {
    place.finalizeSync();
    locality.finalizeSync();
  }
}

export function deletePlaceRows(source: string) {
  indexDb().runSync('DELETE FROM map_places WHERE source = ?', source);
  indexDb().runSync('DELETE FROM map_localities WHERE source = ?', source);
}

/** Adds emergency points to the search index under 'pois:<item id>' (replacing earlier ones), in turn with other writes. */
export function indexEmergencyPoints(itemId: string, rows: PlaceRow[]) {
  void exclusive(() => {
    deletePlaceRows(`pois:${itemId}`);
    insertRows(`pois:${itemId}`, rows);
    bumpVersion();
  });
}

/** Whether a routing pack's street names are in the index. */
export function hasPackStreets(itemId: string): boolean {
  return isIndexed(itemId);
}

/**
 * A routing pack's street and locality names (hundreds of thousands for a country):
 * inserted in batches with a yield in between, so the UI stays responsive. Counted as
 * a search index (hasSearchIndex) even without a map installed.
 */
export function indexPackStreets(itemId: string, file: File): Promise<void> {
  return exclusive(async () => {
    if (!(await insertStreetsFile(itemId, itemId, file))) return;
    markIndexed(itemId);
    bumpVersion();
  });
}

// --- Every named place of a country (pack side files) ---------------------------

const placesSource = (itemId: string) => `places:${itemId}`;
const LINE_BLOCK = 4 * 1024 * 1024;

/**
 * Calls `onBlock` with the text of a big TSV file a few MB of whole lines at a time: a
 * country's places file (~100 MB) read in one string would be several hundred MB in Hermes.
 */
async function forEachLineBlock(file: File, onBlock: (text: string) => Promise<boolean>) {
  const handle = file.open(FileMode.ReadOnly);
  const decoder = new TextDecoder('utf-8');
  let carry = new Uint8Array(0);
  try {
    for (;;) {
      const chunk = await handle.readBytes(LINE_BLOCK);
      let data = chunk;
      if (carry.length) {
        data = new Uint8Array(carry.length + chunk.length);
        data.set(carry);
        data.set(chunk, carry.length);
      }
      if (!chunk.length) {
        if (data.length) await onBlock(decoder.decode(data));
        return;
      }
      const cut = data.lastIndexOf(10);
      if (cut < 0) {
        carry = data;
        continue;
      }
      if (!(await onBlock(decoder.decode(data.subarray(0, cut))))) return;
      carry = data.slice(cut + 1);
    }
  } finally {
    handle.close();
  }
}

/** Whether a country's places file was imported for this item. */
export function hasPackPlaces(itemId: string): boolean {
  return isIndexed(placesSource(itemId));
}

/**
 * Imports a country's places file (scripts/routing/places.py) for `itemId`, the routing
 * pack or map item it came with: every named POI, so a school is found from the other end
 * of the country whatever the map's zoom. Batches with a yield in between; replaces an
 * earlier import; stops (leaving nothing) when the item is removed meanwhile.
 */
export function indexPackPlaces(itemId: string, file: File): Promise<void> {
  return exclusive(async () => {
    const source = placesSource(itemId);
    deletePlaceRows(source);
    indexDb().runSync('DELETE FROM index_sources WHERE item_id = ?', source);
    await forEachLineBlock(file, async (text) => {
      const rows = parsePlacesTsv(text);
      for (let i = 0; i < rows.length && getItem(itemId); i += 5000) {
        insertRows(source, rows.slice(i, i + 5000));
        await yieldToUi();
      }
      return !!getItem(itemId);
    });
    if (!getItem(itemId)) {
      deletePlaceRows(source); // removed meanwhile
      return;
    }
    // Its own index_sources row: counts as a search index, and never as the item's tile index.
    markIndexed(source);
    bumpVersion();
  });
}

// --- House numbers (pack side file) ------------------------------------------

const addressesSource = (itemId: string) => `addresses:${itemId}`;
/** Coordinates are stored in 1e-5 degrees. */
const E5 = 1e5;

function deleteAddresses(itemId: string) {
  indexDb().runSync('DELETE FROM map_addresses WHERE street IN (SELECT id FROM map_address_streets WHERE source = ?)', itemId);
  indexDb().runSync('DELETE FROM map_address_streets WHERE source = ?', itemId);
}

/** Whether a country's addresses file was imported for this item. */
export function hasPackAddresses(itemId: string): boolean {
  return isIndexed(addressesSource(itemId));
}

/**
 * Imports a country's house numbers (scripts/routing/places.py) for `itemId`, the routing
 * pack or map item they came with, replacing an earlier import. Millions of rows for a
 * big country: read in blocks, inserted in transactions of 5000 with a yield in between;
 * stops (leaving nothing) when the item is removed meanwhile.
 */
export function indexPackAddresses(itemId: string, file: File): Promise<void> {
  return exclusive(() => importAddresses(itemId, file));
}

async function importAddresses(itemId: string, file: File) {
  const d = indexDb();
  deleteAddresses(itemId);
  d.runSync('DELETE FROM index_sources WHERE item_id = ?', addressesSource(itemId));
  const streets = new Map<string, number>();
  const street = d.prepareSync('INSERT INTO map_address_streets (source, key) VALUES (?, ?)');
  // A door mapped twice (building + entrance node at the same spot) is kept once.
  const door = d.prepareSync('INSERT OR IGNORE INTO map_addresses (street, lat, lon, number) VALUES (?, ?, ?, ?)');
  try {
    await forEachLineBlock(file, async (text) => {
      const rows = parseAddressesTsv(text);
      for (let i = 0; i < rows.length && getItem(itemId); i += 5000) {
        d.withTransactionSync(() => {
          for (const r of rows.slice(i, i + 5000)) {
            const key = nameKey(r.street);
            if (!key) continue;
            let id = streets.get(key);
            if (id === undefined) {
              id = street.executeSync(itemId, key).lastInsertRowId;
              streets.set(key, id);
            }
            door.executeSync(id, Math.round(r.lat * E5), Math.round(r.lon * E5), r.number);
          }
        });
        await yieldToUi();
      }
      return !!getItem(itemId);
    });
  } finally {
    street.finalizeSync();
    door.finalizeSync();
  }
  if (!getItem(itemId)) {
    deleteAddresses(itemId); // removed meanwhile
    return;
  }
  markIndexed(addressesSource(itemId));
  bumpVersion();
}

/** The doors of streets named like `streetName` within `meters` of `near`. */
async function doorsNear(streetName: string, near: LatLon, meters: number): Promise<AddressRow[]> {
  const [w, s, e, n] = bboxAround(near, meters);
  const rows = await indexDbAsync().getAllAsync<{ number: string; lat: number; lon: number }>(
    `SELECT a.number, a.lat, a.lon FROM map_address_streets st JOIN map_addresses a ON a.street = st.id
     WHERE st.key = ? AND a.lat BETWEEN ? AND ? AND a.lon BETWEEN ? AND ? LIMIT 5000`,
    nameKey(streetName),
    Math.floor(s * E5),
    Math.ceil(n * E5),
    Math.floor(w * E5),
    Math.ceil(e * E5),
  );
  return rows.map((r) => ({ street: streetName, number: r.number, lat: r.lat / E5, lon: r.lon / E5 }));
}

/**
 * A country map's street and locality names (country-maps.ts, where no routing pack brings
 * them), under 'streets:<item id>' so the map's own tile index keeps its rows.
 */
export function indexMapStreets(itemId: string, file: File): Promise<void> {
  return exclusive(async () => {
    await insertStreetsFile(`streets:${itemId}`, itemId, file);
    bumpVersion();
  });
}

/**
 * A streets file (France: 150 MB) into the index under `source`, read in blocks like the
 * places. False, leaving nothing, when the item is removed meanwhile.
 */
async function insertStreetsFile(source: string, itemId: string, file: File): Promise<boolean> {
  deletePlaceRows(source);
  await forEachLineBlock(file, async (text) => {
    const rows = parseStreetsTsv(text);
    for (let i = 0; i < rows.length && getItem(itemId); i += 5000) {
      insertRows(source, rows.slice(i, i + 5000));
      await yieldToUi();
    }
    return !!getItem(itemId);
  });
  if (getItem(itemId)) return true;
  deletePlaceRows(source); // removed meanwhile
  return false;
}

/**
 * Emergency points found in the map's own tiles, stored as an offline fallback
 * (ids 't…') until Overpass points replace them (emergency.ts deletes the source's
 * rows before inserting). Skipped once a region has Overpass points, and for maps whose
 * points came with the download (country map or routing pack): they would show twice.
 */
function storeTileEmergencyPoints(itemId: string, rows: PlaceRow[]) {
  const d = indexDb();
  if ((getItem(itemId)?.meta as { bundledPoints?: boolean } | undefined)?.bundledPoints) return;
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
    markIndexed(item.id, z);
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
    .then(() => (cancelled.has(item.id) ? undefined : exclusive(() => (cancelled.has(item.id) ? undefined : indexItem(item)))))
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
  // Removals whose index rows were not dropped yet when the app stopped.
  for (const id of pendingDrops()) {
    if (getItem(id)) setPendingDrop(id, false);
    else dropIndexRows(id);
  }
  const rows = indexDb().getAllSync<{ item_id: string; index_version: number | null }>('SELECT item_id, index_version FROM index_sources');
  const done = new Map(rows.map((r) => [r.item_id, r.index_version]));
  for (const item of listItems('map') as MapItem[]) {
    if (done.get(item.id) !== INDEX_VERSION) scheduleIndex(item);
  }
}

/** A map item's file changed (re-downloaded): rebuild its index. */
export function invalidateIndex(item: MapItem) {
  void exclusive(() => {
    indexDb().runSync('UPDATE index_sources SET index_version = NULL WHERE item_id = ?', item.id);
    forgetDetail(item.id);
  });
  scheduleIndex(item);
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Map or pack removed: stop its job and drop everything derived from it. The index rows
 * (millions for a country) go off the JS thread, in one transaction; one the app could
 * not finish is done at the next launch. A fresh index file then gives the space back.
 */
export function forgetMapSource(itemId: string) {
  cancelled.add(itemId);
  again.delete(itemId);
  forgetDetailState(itemId);
  dropIndexRows(itemId);
}

const DROPS_KEY = 'maps.pendingIndexDrops';

function pendingDrops(): string[] {
  try {
    return JSON.parse(Storage.getItemSync(DROPS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function setPendingDrop(itemId: string, pending: boolean) {
  const ids = new Set(pendingDrops());
  if (pending) ids.add(itemId);
  else ids.delete(itemId);
  Storage.setItemSync(DROPS_KEY, JSON.stringify([...ids]));
}

/**
 * Drops a removed item's index rows and emergency points, after the writes queued before
 * (remembered until done, across launches).
 */
function dropIndexRows(itemId: string) {
  setPendingDrop(itemId, true);
  const sources = [itemId, `pois:${itemId}`, placesSource(itemId), `streets:${itemId}`, detailSource(itemId)].map(sqlText).join(', ');
  const id = sqlText(itemId);
  const states = [itemId, placesSource(itemId), addressesSource(itemId)].map(sqlText).join(', ');
  void exclusive(async () => {
    const d = indexDbAsync();
    // FTS5 filters on an unindexed column by reading the whole table: one pass for all sources.
    await d.withTransactionAsync(() =>
      d.execAsync(`
        DELETE FROM map_places WHERE source IN (${sources});
        DELETE FROM map_localities WHERE source IN (${sources});
        DELETE FROM map_addresses WHERE street IN (SELECT id FROM map_address_streets WHERE source = ${id});
        DELETE FROM map_address_streets WHERE source = ${id};
        DELETE FROM index_sources WHERE item_id IN (${states});
        DELETE FROM map_pois WHERE source = ${id};
        DELETE FROM map_sources WHERE item_id = ${id};`),
    );
    setPendingDrop(itemId, false);
    await d.execAsync('PRAGMA incremental_vacuum;');
    bumpVersion();
  });
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
  forgetDetailState(itemId);
}

function forgetDetailState(itemId: string) {
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
      return next ? exclusive(() => refreshDetail(next)) : undefined;
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
 * ("Calle Alcalá 50") also brings the streets matching its street part, and the door
 * on them when a country's house numbers are installed. Runs off the JS thread; stops
 * early (with no results) once `current` says a newer search replaced this one.
 */
export async function searchPlaces(text: string, near: LatLon | null, limit = 40, current = () => true): Promise<SearchResult[]> {
  let hits = await matchPlaces(text, near, limit);
  const address = parseAddress(text);
  if (address && current()) {
    const streets = await matchPlaces(address.street, near, limit, 'road');
    const seen = new Set(hits.map((h) => h.id));
    // The door on the best streets of that name (from a pack's house numbers), first.
    hits = [...(await doorHits(streets.slice(0, 8), address.number)), ...hits, ...streets.filter((h) => !seen.has(h.id))];
  }
  const japanese = parseJapaneseAddress(text);
  if (japanese.length && current()) hits = [...(await japaneseDoorHits(japanese, near)), ...hits];
  if (!current()) return [];
  return Promise.all(hits.slice(0, limit).map(async (h) => ({ ...h, context: h.layer === 'place' ? null : await localityNear(h) })));
}

/** "Calle de Alcalá, 52" on each street hit that has doors (exact or approximate). */
async function doorHits(streets: Hit[], number: string): Promise<Hit[]> {
  const out: Hit[] = [];
  for (const st of streets) {
    const at = locateHouseNumber(await doorsNear(st.name, st, DOOR_SEARCH), number, st, DOOR_SEARCH);
    if (!at) continue;
    const name = `${st.name}, ${houseNumberKey(number)}`;
    // Two index rows of the same street (one per tile) find the same door.
    if (out.some((o) => o.name === name && distanceMeters(o, at) < 300)) continue;
    out.push({ ...st, id: -1 - out.length, name, kind: at.exact ? 'address' : 'address_approx', lat: at.lat, lon: at.lon });
  }
  return out;
}

/**
 * Japanese addresses ("台東2丁目5-1") have no streets to find first: their doors are
 * looked up by chōme and number directly, the nearest few. Without that door anywhere,
 * the block ("5", or any "5-…") as an approximate one.
 */
async function japaneseDoorHits(addresses: { street: string; number: string }[], near: LatLon | null): Promise<Hit[]> {
  const readings = await Promise.all(
    addresses.map(async ({ street, number }) => {
      const block = number.split('-')[0];
      const rows = await indexDbAsync().getAllAsync<{ number: string; lat: number; lon: number }>(
        `SELECT a.number, a.lat, a.lon FROM map_address_streets st JOIN map_addresses a ON a.street = st.id
         WHERE st.key = ? AND (a.number = ? OR a.number = ? OR a.number LIKE ?) LIMIT 500`,
        nameKey(street),
        number,
        block,
        `${block}-%`,
      );
      return rows.map((r) => ({ name: `${street}${number}`, exact: r.number === number, lat: r.lat / E5, lon: r.lon / E5 }));
    }),
  );
  const found = readings.flat();
  // Several readings of an ambiguous address: the one that names a door wins.
  const doors = found.some((d) => d.exact) ? found.filter((d) => d.exact) : found;
  if (near) doors.sort((a, b) => distanceMeters(near, a) - distanceMeters(near, b));
  const out: Hit[] = [];
  for (const d of doors) {
    // One hit per place: the doors of one block, or the same address in another town.
    if (out.some((o) => distanceMeters(o, d) < 300)) continue;
    const kind = d.exact ? 'address' : 'address_approx';
    out.push({ id: -100 - out.length, layer: 'poi', kind, name: d.name, names: '', rank: 0, lat: d.lat, lon: d.lon });
    if (out.length >= 5) break;
  }
  return out;
}

async function matchPlaces(text: string, near: LatLon | null, limit: number, layer?: PlaceLayer): Promise<Hit[]> {
  const match = ftsQuery(text);
  if (!match) return [];
  let rows: HitRow[];
  const columns =
    'rowid AS id, name, layer, kind, CAST(lat AS REAL) AS lat, CAST(lon AS REAL) AS lon, CAST(importance AS INTEGER) AS importance';
  const onLayer = layer ? 'AND layer = ?' : '';
  const layerArg = layer ? [layer] : [];
  // Ordering reads every match: "ca" matches 400k rows of a country. The first `cap` are
  // ranked instead (0.3 s → 0.06 s on a 1M-row index on a Mac), all of them for a precise query.
  const cap = matchCap(text);
  const d = indexDbAsync();
  try {
    rows = await d.getAllAsync<HitRow>(
      `SELECT * FROM (SELECT ${columns} FROM map_places WHERE map_places MATCH ? ${onLayer} LIMIT ${cap})
       ORDER BY importance LIMIT 600`,
      match,
      ...layerArg,
    );
    // A common street name ("Calle Mayor") matches thousands of rows across a country:
    // the ones around the user too, else the nearest may not be among the first 600.
    if (near) {
      const [w, s, e, n] = bboxAround(near, 30_000);
      const seen = new Set(rows.map((r) => r.id));
      const around = await d.getAllAsync<HitRow>(
        `SELECT * FROM (SELECT ${columns} FROM map_places WHERE map_places MATCH ? ${onLayer} LIMIT ${cap * 4})
         WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 600`,
        match,
        ...layerArg,
        s,
        n,
        w,
        e,
      );
      for (const r of around) if (!seen.has(r.id)) rows.push(r);
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

async function localityNear(p: LatLon): Promise<string | null> {
  const [w, s, e, n] = bboxAround(p, 15_000);
  const candidates = await indexDbAsync().getAllAsync<{ name: string; lat: number; lon: number }>(
    'SELECT name, lat, lon FROM map_localities WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 400',
    s,
    n,
    w,
    e,
  );
  return nearestLocality(p, candidates)?.name ?? null;
}

/** How far from a street hit its doors are looked up (a street row stands for ~1.5 km of it). */
const DOOR_SEARCH = 3000;

/** Whether any installed map has a finished search index (else the sheet explains why results are empty). */
export function hasSearchIndex(): boolean {
  return !!indexDb().getFirstSync('SELECT 1 FROM index_sources WHERE index_version IS NOT NULL LIMIT 1');
}
