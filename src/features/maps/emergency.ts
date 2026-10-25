// Emergency points (hospitals, police, water, shelters…) for each installed map
// region: fetched once from OpenStreetMap through public Overpass servers while
// online (only the region's bbox is sent), stored in map_pois and added to the
// search index. Everything after that works offline.
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import { db } from '@/db';
import { getItem } from '@/features/content/items';

import {
  EMERGENCY_KINDS,
  kindCategory,
  overpassQuery,
  parseOverpassTsv,
  splitBBox,
  type EmergencyCategory,
  type EmergencyKind,
  type EmergencyPoi,
} from './emergency-core';
import type { LatLon } from './geo';
import { distanceMeters } from './geo';
import { indexEmergencyPoints } from './places';
import type { MapItem } from './useMapSources';

// Tried in order; the main instance is often busy.
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// 112 works on any GSM phone and is the number across Europe; most of the Americas use 911.
const NINE_ONE_ONE = new Set(['US', 'CA', 'MX', 'AR', 'CR', 'PA', 'PY', 'UY', 'SV', 'GT', 'HN', 'DO', 'EC', 'VE', 'PR', 'PH']);

/** Emergency number for the device's region. */
export function emergencyNumber(): string {
  const region = getLocales()[0]?.regionCode ?? '';
  return NINE_ONE_ONE.has(region.toUpperCase()) ? '911' : '112';
}

const USER_AGENT = 'NomadPocket/1.0 (+https://github.com/franlindebl/nomad-pocket)';
const CELL_DEGREES = 3;

export type SyncState = { status: 'running'; done: number; total: number } | { status: 'failed'; error: string };

/** Running or failed fetches per map item id. Absent = idle. */
export const usePoiSync = create<{ states: Record<string, SyncState>; version: number }>(() => ({ states: {}, version: 0 }));

function setState(id: string, state: SyncState | null) {
  usePoiSync.setState((s) => {
    const states = { ...s.states };
    if (state) states[id] = state;
    else delete states[id];
    return { states, version: state ? s.version : s.version + 1 };
  });
}

class AbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

/** Waits, but rejects as soon as `signal` aborts (a removed map must not keep fetching). */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal.addEventListener('abort', onAbort);
  });

async function fetchCell(bbox: [number, number, number, number], signal: AbortSignal): Promise<EmergencyPoi[]> {
  // Overpass schedules by the declared timeout: small cells ask for less, so a busy
  // server still takes them. A 3° cell over central Spain takes ~60 s.
  const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  const queryTimeout = area <= 1 ? 60 : 180;
  const body = `data=${encodeURIComponent(overpassQuery(bbox, queryTimeout))}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < SERVERS.length * 2; attempt++) {
    if (signal.aborted) throw new AbortedError();
    const url = SERVERS[attempt % SERVERS.length];
    // A server that queues the request can hold the connection open for minutes:
    // give up on it after the query's own timeout and try the next one.
    const attemptCtrl = new AbortController();
    const abort = () => attemptCtrl.abort();
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, (queryTimeout + 30) * 1000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
        signal: attemptCtrl.signal,
      });
      const text = await res.text();
      // Overpass reports timeouts and quota errors inside a 200 HTML/XML body.
      if (res.ok && !/^\s*</.test(text)) return parseOverpassTsv(text);
      lastError = new Error(`Overpass HTTP ${res.status}`);
    } catch (e) {
      if (signal.aborted) throw e;
      lastError = attemptCtrl.signal.aborted ? new Error(`Overpass timeout (${url.split('/')[2]})`) : e;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
    await sleep(attempt < SERVERS.length ? 1000 : 5000, signal);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const controllers = new Map<string, AbortController>();
/** Asked again while running (region re-downloaded or removed and added back): run once more after. */
const again = new Set<string>();

/** Fetches (or refreshes) the emergency points of a map region. Needs a connection. */
export async function syncEmergencyPoints(item: MapItem): Promise<void> {
  if (item.meta.role === 'world') return;
  if (controllers.has(item.id)) {
    again.add(item.id);
    return;
  }
  const ctrl = new AbortController();
  controllers.set(item.id, ctrl);
  const cells = splitBBox(item.meta.bbox, CELL_DEGREES);
  setState(item.id, { status: 'running', done: 0, total: cells.length });
  try {
    const byId = new Map<string, EmergencyPoi>();
    for (let i = 0; i < cells.length; i++) {
      for (const p of await fetchCell(cells[i], ctrl.signal)) byId.set(p.osmId, p);
      setState(item.id, { status: 'running', done: i + 1, total: cells.length });
    }
    // Removed while the last cell was in flight: store nothing for it.
    if (ctrl.signal.aborted) throw new AbortedError();
    const pois = [...byId.values()];
    const d = db();
    const insert = d.prepareSync(
      'INSERT OR REPLACE INTO map_pois (source, osm_id, kind, category, name, operator, phone, opening_hours, emergency, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      d.withTransactionSync(() => {
        d.runSync('DELETE FROM map_pois WHERE source = ?', item.id);
        for (const p of pois) {
          insert.executeSync(
            item.id,
            p.osmId,
            p.kind,
            kindCategory(p.kind),
            p.name,
            p.operator,
            p.phone,
            p.openingHours,
            p.emergency,
            p.lat,
            p.lon,
          );
        }
      });
    } finally {
      insert.finalizeSync();
    }
    indexEmergencyPoints(
      item.id,
      pois
        .filter((p) => p.name)
        .map((p) => ({ layer: 'poi', kind: p.kind, name: p.name!, names: p.name!, lat: p.lat, lon: p.lon, rank: 13 })),
    );
    d.runSync(
      `INSERT INTO map_sources (item_id, pois_at, pois_count) VALUES (?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET pois_at = excluded.pois_at, pois_count = excluded.pois_count`,
      item.id,
      Date.now(),
      pois.length,
    );
    setState(item.id, null);
  } catch (e) {
    if (ctrl.signal.aborted) setState(item.id, null);
    else setState(item.id, { status: 'failed', error: String((e as Error)?.message ?? e) });
  } finally {
    controllers.delete(item.id);
    if (again.delete(item.id)) {
      const fresh = getItem(item.id) as MapItem | null;
      if (fresh) syncEmergencyPoints(fresh).catch(() => {});
    }
  }
}

export function cancelEmergencySync(itemId: string) {
  again.delete(itemId);
  controllers.get(itemId)?.abort();
}

/** When each region's points were fetched (absent = never). */
export function emergencySyncInfo(): Record<string, { at: number; count: number }> {
  const rows = db().getAllSync<{ item_id: string; pois_at: number; pois_count: number }>(
    'SELECT item_id, pois_at, pois_count FROM map_sources WHERE pois_at IS NOT NULL',
  );
  return Object.fromEntries(rows.map((r) => [r.item_id, { at: r.pois_at, count: r.pois_count }]));
}

/** Emergency points taken from each map's own tiles (offline fallback, ids 't…'). */
export function tilePointCounts(): Record<string, number> {
  const rows = db().getAllSync<{ source: string; n: number }>("SELECT source, COUNT(*) AS n FROM map_pois WHERE osm_id LIKE 't%' GROUP BY source");
  return Object.fromEntries(rows.map((r) => [r.source, r.n]));
}

// --- Queries ----------------------------------------------------------------

export type EmergencyPlace = Omit<EmergencyPoi, 'kind'> & { kind: EmergencyKind; category: EmergencyCategory; distance: number | null };

type PoiRow = {
  osm_id: string;
  kind: EmergencyKind;
  category: EmergencyCategory;
  name: string | null;
  operator: string | null;
  phone: string | null;
  opening_hours: string | null;
  emergency: 0 | 1 | null;
  lat: number;
  lon: number;
};

const fromRow = (r: PoiRow, from: LatLon | null): EmergencyPlace => ({
  osmId: r.osm_id,
  kind: r.kind in EMERGENCY_KINDS ? r.kind : 'clinic',
  category: r.category,
  name: r.name,
  operator: r.operator,
  phone: r.phone,
  openingHours: r.opening_hours,
  emergency: r.emergency,
  lat: r.lat,
  lon: r.lon,
  distance: from ? distanceMeters(from, r) : null,
});

/**
 * Nearest points of a category. Overlapping regions store the same OSM element
 * twice: GROUP BY keeps one. Hospitals with an emergency department come first
 * among equals only through distance; the UI badges them.
 */
export function nearestEmergencyPlaces(category: EmergencyCategory, from: LatLon, limit = 60): EmergencyPlace[] {
  const k = Math.cos((from.lat * Math.PI) / 180);
  const rows = db().getAllSync<PoiRow>(
    `SELECT osm_id, kind, category, name, operator, phone, opening_hours, emergency, lat, lon FROM map_pois
     WHERE category = ? GROUP BY osm_id
     ORDER BY (lat - ?) * (lat - ?) + ((lon - ?) * ?) * ((lon - ?) * ?) LIMIT ?`,
    category,
    from.lat,
    from.lat,
    from.lon,
    k,
    from.lon,
    k,
    limit,
  );
  return rows.map((r) => fromRow(r, from));
}

/** Points inside a bbox, for the map layer. */
export function emergencyPlacesIn(bbox: [number, number, number, number], limit = 600): EmergencyPlace[] {
  const [w, s, e, n] = bbox;
  const rows = db().getAllSync<PoiRow>(
    `SELECT osm_id, kind, category, name, operator, phone, opening_hours, emergency, lat, lon FROM map_pois
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? GROUP BY osm_id
     ORDER BY CASE kind WHEN 'hospital' THEN 0 WHEN 'police' THEN 1 WHEN 'fire_station' THEN 1 WHEN 'ambulance_station' THEN 1 ELSE 2 END,
       CASE category WHEN 'health' THEN 0 WHEN 'security' THEN 1 WHEN 'water' THEN 2 WHEN 'official' THEN 3 ELSE 4 END
     LIMIT ?`,
    s,
    n,
    w,
    e,
    limit,
  );
  return rows.map((r) => fromRow(r, null));
}

export function getEmergencyPlace(osmId: string, from: LatLon | null): EmergencyPlace | null {
  const row = db().getFirstSync<PoiRow>(
    'SELECT osm_id, kind, category, name, operator, phone, opening_hours, emergency, lat, lon FROM map_pois WHERE osm_id = ? LIMIT 1',
    osmId,
  );
  return row ? fromRow(row, from) : null;
}

/** The stored point behind a search hit (search rows don't keep the OSM id). */
export function findEmergencyPlace(name: string, lat: number, lon: number): EmergencyPlace | null {
  const row = db().getFirstSync<PoiRow>(
    `SELECT osm_id, kind, category, name, operator, phone, opening_hours, emergency, lat, lon FROM map_pois
     WHERE name = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 1`,
    name,
    lat - 0.0005,
    lat + 0.0005,
    lon - 0.0005,
    lon + 0.0005,
  );
  return row ? fromRow(row, null) : null;
}

export function hasEmergencyPoints(): boolean {
  return !!db().getFirstSync('SELECT 1 FROM map_pois LIMIT 1');
}
