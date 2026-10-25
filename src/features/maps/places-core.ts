// Offline place search, the pure part: which features of an installed map's
// tiles go into the search index (places, named POIs, named streets), the street
// names a routing pack brings, the FTS5 query for what the user typed, and
// ranking/deduplicating the hits.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { tilePointToLonLat, type MvtLayer } from '../../lib/mvt/decode.ts';

import { distanceMeters, type LatLon } from './geo.ts';

export const INDEX_LAYERS = ['places', 'pois', 'roads'] as const;

export type PlaceLayer = 'place' | 'poi' | 'road';

export type PlaceRow = {
  layer: PlaceLayer;
  /** Protomaps kind: locality/neighbourhood/…, a POI kind, or 'street'/'path'. */
  kind: string;
  /** Display name (local name). */
  name: string;
  /** Every name variant, space separated: what the full-text index matches. */
  names: string;
  lat: number;
  lon: number;
  /** Lower is more important (Protomaps min_zoom). */
  rank: number;
};

/** Name variants indexed besides the local name (the app languages + English). */
const NAME_KEYS = ['name', 'name:es', 'name:en', 'name2', 'name3'];

// POI kinds that are never useful search results even when named.
const SKIP_POI_KINDS = new Set([
  'tree',
  'street_lamp',
  'bench',
  'waste_basket',
  'crossing',
  'traffic_signals',
  'give_way',
  'stop',
  'vending_machine',
  'post_box',
]);

function namesOf(props: Record<string, unknown>): { name: string; names: string } | null {
  const name = typeof props.name === 'string' ? props.name.trim() : '';
  if (!name) return null;
  const all = new Set<string>();
  for (const k of NAME_KEYS) {
    const v = props[k];
    if (typeof v === 'string' && v.trim()) all.add(v.trim());
  }
  return { name, names: [...all].join(' ') };
}

/**
 * Index rows of one decoded tile. Points are kept only inside the tile proper
 * (tiles repeat nearby features in their buffer); streets once per name and tile.
 * `keepUnnamed` lets unnamed POIs of some kinds through (name ''), e.g. drinking
 * water for the emergency list; they are not searchable.
 */
export function tileRows(
  layers: Record<string, MvtLayer>,
  z: number,
  x: number,
  y: number,
  keepUnnamed?: (kind: string) => boolean,
): PlaceRow[] {
  const rows: PlaceRow[] = [];
  const point = (l: MvtLayer, fx: number, fy: number) => {
    const [lon, lat] = tilePointToLonLat(z, x, y, fx, fy, l.extent);
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  };
  const inside = (l: MvtLayer, fx: number, fy: number) => fx >= 0 && fy >= 0 && fx < l.extent && fy < l.extent;

  const places = layers.places;
  if (places) {
    for (const f of places.features) {
      const n = namesOf(f.properties);
      if (!n || !inside(places, f.x, f.y)) continue;
      const kind = String(f.properties.kind_detail || f.properties.kind || 'place');
      rows.push({ layer: 'place', kind, ...n, ...point(places, f.x, f.y), rank: Number(f.properties.min_zoom ?? 15) });
    }
  }

  const pois = layers.pois;
  if (pois) {
    for (const f of pois.features) {
      const kind = String(f.properties.kind ?? '');
      const n = namesOf(f.properties) ?? (kind && keepUnnamed?.(kind) ? { name: '', names: '' } : null);
      if (!n || !kind || SKIP_POI_KINDS.has(kind) || !inside(pois, f.x, f.y)) continue;
      rows.push({ layer: 'poi', kind, ...n, ...point(pois, f.x, f.y), rank: Number(f.properties.min_zoom ?? 16) });
    }
  }

  const roads = layers.roads;
  if (roads) {
    const seen = new Map<string, PlaceRow>();
    for (const f of roads.features) {
      const n = namesOf(f.properties);
      const kind = String(f.properties.kind ?? '');
      if (!n || kind === 'rail' || kind === 'ferry' || kind === 'aerialway' || !inside(roads, f.x, f.y)) continue;
      const rank = Number(f.properties.min_zoom ?? 14);
      const prev = seen.get(n.name);
      if (prev && prev.rank <= rank) continue;
      seen.set(n.name, { layer: 'road', kind: kind === 'path' ? 'path' : 'street', ...n, ...point(roads, f.x, f.y), rank });
    }
    rows.push(...seen.values());
  }
  return rows;
}

/** Protomaps-like min_zoom of a routing pack's place kinds (lower ranks first). */
const PLACE_RANK: Record<string, number> = { city: 4, town: 7, village: 10, suburb: 11, borough: 11, isolated_dwelling: 14 };

/**
 * Rows of a routing pack's street index (scripts/routing/streets.py: kind, name, lat,
 * lon per line). Map tiles only hold the main roads of a big area at the zoom the phone
 * can index; the pack has every named street.
 */
export function parseStreetsTsv(text: string): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const line of text.split('\n')) {
    const [kind, name, lat, lon] = line.split('\t');
    const y = Number(lat);
    const x = Number(lon);
    if (!kind || !name || !lat || !lon || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    const road = kind === 'street' || kind === 'path';
    rows.push({
      layer: road ? 'road' : 'place',
      kind,
      name,
      names: name,
      lat: y,
      lon: x,
      rank: road ? (kind === 'path' ? 15 : 14) : (PLACE_RANK[kind] ?? 12),
    });
  }
  return rows;
}

/** Protomaps-like min_zoom of a pack's POI kinds: what people look up from afar ranks first. */
const POI_RANK: Record<string, number> = {
  aerodrome: 10,
  hospital: 12,
  station: 12,
  university: 13,
  stadium: 13,
  museum: 13,
  peak: 13,
  castle: 13,
  cathedral: 13,
  townhall: 13,
  college: 14,
  school: 14,
  mall: 14,
  attraction: 14,
  park: 14,
  beach: 14,
};

/**
 * Rows of a pack's places file (scripts/routing/places.py: kind, name, other names, lat,
 * lon per line): every named POI of the country, whatever the map's zoom.
 */
export function parsePlacesTsv(text: string): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const line of text.split('\n')) {
    const [kind, name, other, lat, lon] = line.split('\t');
    const y = Number(lat);
    const x = Number(lon);
    if (!kind || !name || !lat || !lon || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    rows.push({ layer: 'poi', kind, name, names: other ? `${name} ${other}` : name, lat: y, lon: x, rank: POI_RANK[kind] ?? 16 });
  }
  return rows;
}

export type AddressRow = { street: string; number: string; lat: number; lon: number };

/** House numbers compare without spaces and case: "12 b" is "12B". */
export const houseNumberKey = (n: string) => n.replace(/\s+/g, '').toUpperCase();

/** Rows of a pack's addresses file (places.py: street, house number, lat, lon per line). */
export function parseAddressesTsv(text: string): AddressRow[] {
  const rows: AddressRow[] = [];
  for (const line of text.split('\n')) {
    const [street, number, lat, lon] = line.split('\t');
    const y = Number(lat);
    const x = Number(lon);
    if (!street || !number || !lat || !lon || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    rows.push({ street, number: houseNumberKey(number), lat: y, lon: x });
  }
  return rows;
}

const NEAREST_NUMBERS = 10;

const numericPart = (n: string) => {
  const m = /^\d+/.exec(n);
  return m ? Number(m[0]) : null;
};

/**
 * Where a house number is on a street, from the doors of that street name near `near` (a
 * street hit): the door itself, else between the nearest lower and higher numbers on the
 * same side (same parity), else the nearest number on that side up to NEAREST_NUMBERS away
 * (OSM often has only some doors), else null. `exact` false when not the door itself.
 */
export function locateHouseNumber(
  doors: AddressRow[],
  number: string,
  near: LatLon,
  maxMeters = 3000,
): { lat: number; lon: number; exact: boolean } | null {
  const want = houseNumberKey(number);
  const close = doors.filter((d) => distanceMeters(near, d) <= maxMeters);
  const exact = close.filter((d) => d.number === want).sort((a, b) => distanceMeters(near, a) - distanceMeters(near, b))[0];
  if (exact) return { lat: exact.lat, lon: exact.lon, exact: true };
  const n = numericPart(want);
  if (n === null) return null;
  let below: AddressRow | null = null;
  let above: AddressRow | null = null;
  for (const d of close) {
    const m = numericPart(d.number);
    if (m === null || m % 2 !== n % 2) continue;
    if (m < n && (!below || m > numericPart(below.number)!)) below = d;
    if (m > n && (!above || m < numericPart(above.number)!)) above = d;
  }
  // Too far apart to be one stretch of the street (two streets of the same name).
  if (!below || !above || distanceMeters(below, above) > 1000) {
    // Only one side known (or a gap): the nearest number on the same side, if close.
    const gap = (d: AddressRow | null) => (d ? Math.abs(numericPart(d.number)! - n) : Infinity);
    const best = gap(below) <= gap(above) ? below : above;
    return best && gap(best) <= NEAREST_NUMBERS ? { lat: best.lat, lon: best.lon, exact: false } : null;
  }
  const lo = numericPart(below.number)!;
  const t = (n - lo) / (numericPart(above.number)! - lo);
  return { lat: below.lat + (above.lat - below.lat) * t, lon: below.lon + (above.lon - below.lon) * t, exact: false };
}

/**
 * Zoom level to read for the index: the archive's max zoom (capped at 15, where
 * Protomaps keeps every POI) unless that means too many tiles to decode on the
 * phone in reasonable time, then one level less, and so on.
 */
export function pickIndexZoom(maxZoom: number, minZoom: number, tilesAt: (z: number) => number, budget = 40_000): number {
  for (let z = Math.min(15, maxZoom); z > minZoom; z--) {
    if (tilesAt(z) <= budget) return z;
  }
  return minZoom;
}

// ---------------------------------------------------------------------------
// Querying

/** Lowercase, without accents: how names are compared. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Street-type and title abbreviations of addresses ("Avda.", "Pº", "C/", "Dr."),
 * Spanish (with the Catalan word where it differs: "Avinguda"), then English. Only those that aren't already a prefix of the word
 * (every query word is matched as a prefix: "av" finds "avenida" by itself).
 */
const ABBREVIATIONS: Record<string, string[]> = {
  avda: ['avenida', 'avinguda'],
  avd: ['avenida', 'avinguda'],
  cl: ['calle', 'carrer'],
  pº: ['paseo', 'passeig'],
  pso: ['paseo'],
  pg: ['passeig'],
  pza: ['plaza', 'placa'],
  plza: ['plaza'],
  ctra: ['carretera'],
  crta: ['carretera'],
  gta: ['glorieta'],
  glta: ['glorieta'],
  cno: ['camino'],
  rda: ['ronda'],
  trva: ['travesia'],
  pje: ['pasaje'],
  psje: ['pasaje'],
  cjon: ['callejon'],
  bº: ['barrio'],
  sta: ['santa'],
  sto: ['santo'],
  ntra: ['nuestra'],
  ntro: ['nuestro'],
  sra: ['senora'],
  dr: ['doctor', 'drive'],
  dra: ['doctora'],
  rd: ['road'],
  blvd: ['boulevard'],
  hwy: ['highway'],
  ln: ['lane'],
};

/**
 * FTS5 MATCH expression: every word as a prefix, all required; an abbreviation also
 * matches its full word. Null when nothing searchable.
 */
export function ftsQuery(text: string): string | null {
  const words = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words
    .map((w) => {
      const term = `"${w.replace(/"/g, '')}"*`;
      const full = ABBREVIATIONS[normalizeName(w)];
      return full ? `(${[term, ...full.map((f) => `"${f}"*`)].join(' OR ')})` : term;
    })
    .join(' AND ');
}

/**
 * A street address typed as "Calle Alcalá 50", "Alcalá, 50", "C/ Alcalá nº 50 bis" or
 * "50 Alcalá": the street part (searched among street names) and the house number.
 * Null without a number, or when what is left has no letters to search.
 */
export function parseAddress(text: string): { street: string; number: string } | null {
  const t = text.trim().replace(/\s+/g, ' ');
  const num = String.raw`(\d{1,5}(?: ?[a-zA-Z](?![\p{L}]))?)(?: bis)?`;
  const after = new RegExp(String.raw`^(.*?\p{L}.*?)[ ,]+(?:(?:n[º°o]|num|número|numero)\.? ?)?${num}$`, 'iu').exec(t);
  const before = after ? null : new RegExp(String.raw`^${num},? (.*\p{L}.*)$`, 'iu').exec(t);
  const street = (after ? after[1] : before?.[2])?.replace(/[ ,]+$/, '');
  const number = after ? after[2] : before?.[1];
  if (!street || !number || (street.match(/\p{L}/gu) ?? []).length < 2) return null;
  return { street, number: number.replace(/ /g, '').toUpperCase() };
}

export type Hit = PlaceRow & { id: number };

const LAYER_WEIGHT: Record<PlaceLayer, number> = { place: 0, poi: 1, road: 1.5 };

/** Words left out when comparing a name with the query: "Calle Alcalá" is "Calle de Alcalá". */
const LINK_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'd', 'l', 'of', 'the']);

/** A name as compared: no accents, case or link words ("Calle de Alcalá" → "calle alcala"). */
export const nameKey = (s: string) =>
  normalizeName(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !LINK_WORDS.has(w))
    .join(' ');

/**
 * Orders hits: exact name, then name starting with the query, then word matches
 * ("de", "la"… left out); within each, more important features and nearer ones first. Streets of the same
 * name less than 1.5 km apart are one street (one row per tile in the index).
 */
export function rankHits(hits: Hit[], query: string, near: LatLon | null, limit = 40): Hit[] {
  const q = nameKey(query);
  const scored = hits.map((h) => {
    const n = nameKey(h.name);
    const text = n === q ? 0 : n.startsWith(q) ? 1 : 2;
    const km = near ? distanceMeters(near, h) / 1000 : 0;
    // Distance matters on a log scale: 1 km vs 10 km is one step, 10 vs 100 another.
    const score = text * 10 + LAYER_WEIGHT[h.layer] * 2 + h.rank * 0.3 + Math.log10(1 + km) * 2.5;
    return { h, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const out: Hit[] = [];
  for (const { h } of scored) {
    const radius = h.layer === 'road' ? 1500 : 150;
    if (out.some((o) => o.name === h.name && o.layer === h.layer && distanceMeters(o, h) < radius)) continue;
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** Nearest locality to a point among candidates, for a "Calle Mayor · Soria" context line. */
export function nearestLocality<T extends LatLon & { name: string }>(p: LatLon, candidates: T[], maxMeters = 15_000): T | null {
  let best: T | null = null;
  let bestD = maxMeters;
  for (const c of candidates) {
    const d = distanceMeters(p, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
