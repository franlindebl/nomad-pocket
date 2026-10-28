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

/**
 * Separates the name variants of a tile row's `names`: native, name:es, name:en, then the rest
 * (a control character: the full-text tokenizer treats it as a space, so it is searchable as before).
 * Rows from a routing pack's files use the same layout when the file has the name:es / name:en columns
 * (packNames); older files keep plain space-separated names (their order is not known).
 */
export const NAME_SEP = '\u001f';

/**
 * `names` of a row from a routing pack's side file: the NAME_SEP slots (native, es, en, rest) when the
 * line carries a name:es or name:en column (appended by places.py and streets.py from 2026-10-29), else
 * the old plain text (`rest` is places.tsv's other-names column, which still holds es and en in it, so
 * they are taken out of it). import-core.ts does the same in SQL: keep them in step.
 */
export function packNames(name: string, es = '', en = '', other = ''): string {
  const nes = es === name ? '' : es;
  const nen = en === name ? '' : en;
  if (!nes && !nen) return other ? `${name} ${other}` : name;
  let rest = other;
  for (const v of [nes, nen]) if (v) rest = rest.replaceAll(v, '');
  return [name, nes, nen, rest.trim()].join(NAME_SEP).replace(new RegExp(`${NAME_SEP}+$`), '');
}

/** The same row's `names` with ", <number>" after every slot: a door found on a street, in each language. */
export function namesWithNumber(names: string, number: string): string {
  return names.includes(NAME_SEP)
    ? names
        .split(NAME_SEP)
        .map((v, i) => (v && i < 3 ? `${v}, ${number}` : v))
        .join(NAME_SEP)
    : names;
}

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
  const str = (k: string) => (typeof props[k] === 'string' ? (props[k] as string).trim() : '');
  const name = str('name');
  if (!name) return null;
  const other = (k: string) => (str(k) === name ? '' : str(k));
  const rest = [...new Set([other('name2'), other('name3')].filter(Boolean))].join(' ');
  const names = [name, other('name:es'), other('name:en'), rest].join(NAME_SEP).replace(new RegExp(`${NAME_SEP}+$`), '');
  return { name, names };
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

/** Place kinds that name a town or neighbourhood: the "· Soria" context of a result (map_localities). Keep in step with scripts/routing/streets.py. */
export const LOCALITY_KINDS = new Set([
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

/** Protomaps-like min_zoom of a routing pack's place kinds (lower ranks first). */
export const PLACE_RANK: Record<string, number> = { city: 4, town: 7, village: 10, suburb: 11, borough: 11, isolated_dwelling: 14 };

/**
 * Rows of a routing pack's street index (scripts/routing/streets.py: kind, name, lat,
 * lon, then name:es and name:en when the file has them, per line). Map tiles only hold the main roads of a big area at the zoom the phone
 * can index; the pack has every named street.
 */
export function parseStreetsTsv(text: string): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const line of text.split('\n')) {
    const [kind, name, lat, lon, es, en] = line.split('\t');
    const y = Number(lat);
    const x = Number(lon);
    if (!kind || !name || !lat || !lon || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    const road = kind === 'street' || kind === 'path';
    rows.push({
      layer: road ? 'road' : 'place',
      kind,
      name,
      names: packNames(name, es, en),
      lat: y,
      lon: x,
      rank: road ? (kind === 'path' ? 15 : 14) : (PLACE_RANK[kind] ?? 12),
    });
  }
  return rows;
}

/** Protomaps-like min_zoom of a pack's POI kinds: what people look up from afar ranks first. */
export const POI_RANK: Record<string, number> = {
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
 * lon, then name:es and name:en when the file has them, per line): every named POI of the country, whatever the map's zoom.
 */
export function parsePlacesTsv(text: string): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const line of text.split('\n')) {
    const [kind, name, other, lat, lon, es, en] = line.split('\t');
    const y = Number(lat);
    const x = Number(lon);
    if (!kind || !name || !lat || !lon || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    rows.push({ layer: 'poi', kind, name, names: packNames(name, es, en, other), lat: y, lon: x, rank: POI_RANK[kind] ?? 16 });
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
 * matches its full word, and Chinese or Japanese also matches inside a word (cjkTerm).
 * Null when nothing searchable.
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
      const cjk = cjkTerm(w);
      if (cjk) return cjk === term ? term : `(${term} OR ${cjk})`;
      const full = ABBREVIATIONS[normalizeName(w)];
      // "mcdonalds" also finds McDonald's, which the index holds as the words "mcdonald" and "s".
      const possessive = /^\p{L}{3,}s$/u.test(w) ? [`"${w.slice(0, -1)} s"`] : [];
      const alts = [...(full ?? []).map((f) => `"${f}"*`), ...possessive];
      return alts.length ? `(${[term, ...alts].join(' OR ')})` : term;
    })
    .join(' AND ');
}

// --- Chinese and Japanese ---------------------------------------------------
// They don't separate words, and unicode61 keeps a run of Han or kana as one token
// ("東京タワー"): only a search from its first character matched. Each run also goes into
// the index as its overlapping character pairs ("東京 京タ タワ ワー"), and a run typed in
// the query matches as the phrase of its pairs: any part of two or more characters. A
// trigram tokenizer would need three, and "机场" or "都庁" are two.

// Han (with 々〆〇), hiragana, katakana without the ・ separator, half-width katakana.
const CJK_RANGES: [number, number][] = [
  [0x3005, 0x3007],
  [0x3040, 0x309f],
  [0x30a0, 0x30fa],
  [0x30fc, 0x30ff],
  [0x31f0, 0x31ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xff66, 0xff9f],
  [0x20000, 0x3134f],
];
const CJK_CHAR = `[${CJK_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('')}]`;
/**
 * An SQLite GLOB of text that may hold them: one range from the first to the last (ten ranges
 * cost SQLite twice as much per row). import-core.ts sends those rows through indexText, which
 * leaves text without CJK (Hangul, symbols in between) as it is.
 */
export const CJK_GLOB = `*[${String.fromCodePoint(CJK_RANGES[0][0])}-${String.fromCodePoint(CJK_RANGES[CJK_RANGES.length - 1][1])}]*`;
const CJK_RUNS = new RegExp(`${CJK_CHAR}+`, 'gu');

const pairsOf = (run: string) => {
  const chars = [...run];
  return chars.slice(1).map((c, i) => chars[i] + c);
};

/** The full-text column for a row's `names`: the names, plus the character pairs of their CJK runs. */
export function indexText(names: string): string {
  const runs = new Set(names.match(CJK_RUNS) ?? []);
  const pairs = [...runs].flatMap(pairsOf);
  return pairs.length ? `${names} ${pairs.join(' ')}` : names;
}

/** A word's CJK runs as required phrases of pairs (a single character as a prefix); null without any. */
function cjkTerm(word: string): string | null {
  const runs = word.match(CJK_RUNS);
  if (!runs) return null;
  const parts = runs.map((r) => {
    const pairs = pairsOf(r);
    return pairs.length ? `"${pairs.join(' ')}"` : `"${r}"*`;
  });
  return parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0];
}

/**
 * How many full-text matches one search reads at most. Ordering by importance reads every
 * match, and two letters match ~40% of a country (400k rows): the first ones are enough
 * to rank, and an exact query matches fewer.
 */
export function matchCap(text: string): number {
  return [...text.replace(/[^\p{L}\p{N}]/gu, '')].length < 3 ? 20_000 : 50_000;
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

const KANJI_DIGITS = '〇一二三四五六七八九';

/** '十二' → 12 (chōme numbers: up to 99). */
const kanjiNumber = (k: string) => {
  const [tens, units] = k.includes('十') ? k.split('十') : ['', k];
  return (k.includes('十') ? (tens ? KANJI_DIGITS.indexOf(tens) : 1) * 10 : 0) + (units ? KANJI_DIGITS.indexOf(units) : 0);
};

/**
 * A Japanese address: blocks inside a chōme, no streets. "台東2丁目5-1", "台東2-5-1",
 * "台東二丁目5番1号", also after the prefecture and city ("東京都台東区台東2-5-1"), as the
 * street + number pairs places.py writes ("台東2丁目" + "5-1"). Several when it is
 * ambiguous ("台東2-5": chōme 2 block 5, or block 2 number 5); empty when not one.
 */
export function parseJapaneseAddress(text: string): { street: string; number: string }[] {
  const t = text
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(?<=\d)[‐‑‒–—―−ー](?=\d)/g, '-')
    .replace(/([〇一二三四五六七八九十]{1,3})丁目/g, (_, k: string) => `${kanjiNumber(k)}丁目`);
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)) return [];
  const out: { street: string; number: string }[] = [];
  const block = (b: string, n?: string) => (n ? `${b}-${n}` : b);
  // Block and number: "5-1", "5番1号", "5番地1", "5番", "5".
  const tail = String.raw`(\d{1,5})(?:(?:番地?|-)(\d{1,5})号?|番地?)?$`;
  const withChome = new RegExp(String.raw`^(.*[^\d-])(\d{1,2})丁目` + tail, 'u').exec(t);
  if (withChome) out.push({ street: `${withChome[1]}${withChome[2]}丁目`, number: block(withChome[3], withChome[4]) });
  const dashed = withChome ? null : /^(.*[^\d-])(\d{1,2})-(\d{1,5})(?:-(\d{1,5}))?$/u.exec(t);
  if (dashed) out.push({ street: `${dashed[1]}${dashed[2]}丁目`, number: block(dashed[3], dashed[4]) });
  // Some doors carry the whole "4-5-5" as their number.
  if (dashed?.[4]) out.push({ street: dashed[1], number: `${dashed[2]}-${dashed[3]}-${dashed[4]}` });
  // No chōme (rural 大字 + 番地): "岩村田1234-5".
  const plain = withChome || dashed?.[4] ? null : new RegExp(String.raw`^(.*[^\d-])` + tail, 'u').exec(t);
  if (plain) out.push({ street: plain[1], number: block(plain[2], plain[3]) });
  // Without the prefecture, city or ward in front: they aren't part of the street.
  return out.flatMap((a) => {
    const all = [a];
    for (let s = a.street, m; (m = /^.+?[都道府県市区郡]/u.exec(s)) && m[0].length < s.length; ) {
      s = s.slice(m[0].length);
      all.push({ street: s, number: a.number });
    }
    return all;
  });
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
 * A name as ranked: nameKey without apostrophes, so "mcdonalds" is "McDonald's" and
 * "queens medical" "Queen's Medical" (nameKey itself keys stored street names: don't change it).
 */
export const rankKey = (s: string) => nameKey(s.replace(/['\u2019\u02bc`]/g, ''));

/** The name variants of a hit: split slots of a tile row, else its name (a pack row's words stay one string). */
function variantsOf(h: Pick<PlaceRow, 'name' | 'names'>): string[] {
  const v = h.names.includes(NAME_SEP) ? h.names.split(NAME_SEP) : [h.names];
  return [h.name, ...v].filter(Boolean);
}

/** 0 exact, 1 starts with, 2 a word match; 0.5 a city found by a whole run of words of an alternative name. */
function textRank(h: Pick<PlaceRow, 'name' | 'names' | 'layer'>, q: string): number {
  let best = 2;
  for (const v of variantsOf(h)) {
    const n = rankKey(v);
    if (n === q) return 0;
    if (n.startsWith(q)) best = Math.min(best, 1);
    // A pack row's alternative names are one string ("Tiflis Tbilisi"): a city found by any of them is the city.
    else if (h.layer === 'place' && ` ${n} `.includes(` ${q} `)) best = Math.min(best, 0.5);
  }
  return best;
}

/** The name in the app language and the native one (null when they are the same or there is no other). */
export function localizedName(h: Pick<PlaceRow, 'name' | 'names'>, lang: string): { name: string; native: string | null } {
  if (!h.names.includes(NAME_SEP)) return { name: h.name, native: null };
  const [, es = '', en = ''] = h.names.split(NAME_SEP);
  // Spanish falls back to the English name only when the native one isn't in Latin letters (Tiflis; not "Seville" for Sevilla).
  const pick = lang.startsWith('es') ? es || (/\p{Script=Latin}/u.test(h.name) ? '' : en) : en;
  if (!pick || normalizeName(pick) === normalizeName(h.name)) return { name: h.name, native: null };
  return { name: pick, native: h.name };
}

/** Same place under two spellings: same name without accents or apostrophes, layer and a short distance apart. */
export function sameHit(a: Hit, b: Hit): boolean {
  return !!a.name && !!b.name && rankKey(a.name) === rankKey(b.name) && near(a, b);
}

const near = (a: Hit, b: Hit) =>
  a.layer === b.layer && distanceMeters(a, b) < (a.layer === 'road' ? 1500 : a.kind.startsWith('address') ? 300 : 150);

/**
 * Drops hits that repeat an earlier one (sameHit), keeping at most `limit`. Keys are computed once and
 * compared by bucket: a common word ("farmacia") ranks thousands of rows, so pairwise rankKey calls froze search.
 */
export function dedupeHits(hits: Hit[], limit = Infinity): Hit[] {
  const out: Hit[] = [];
  const byKey = new Map<string, Hit[]>();
  for (const h of hits) {
    if (out.length >= limit) break;
    if (h.name) {
      const key = rankKey(h.name);
      const same = byKey.get(key);
      if (same?.some((o) => near(o, h))) continue;
      if (same) same.push(h);
      else byKey.set(key, [h]);
    }
    out.push(h);
  }
  return out;
}

/**
 * Orders hits: exact name, then name starting with the query, then word matches
 * ("de", "la"… left out); within each, more important features and nearer ones first. Streets of the same
 * name less than 1.5 km apart are one street (one row per tile in the index).
 */
export function rankHits(hits: Hit[], query: string, near: LatLon | null, limit = 40): Hit[] {
  const q = rankKey(query);
  const scored = hits.map((h) => {
    const text = textRank(h, q);
    const km = near ? distanceMeters(near, h) / 1000 : 0;
    // Distance matters on a log scale: 1 km vs 10 km is one step, 10 vs 100 another.
    const score = text * 10 + LAYER_WEIGHT[h.layer] * 2 + h.rank * 0.3 + Math.log10(1 + km) * 2.5;
    return { h, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return dedupeHits(
    scored.map((x) => x.h),
    limit,
  );
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


// ---------------------------------------------------------------------------
// Category words ("hospital", "farmacia", "agua potable"): the nearest places of a kind

/** Words (no accents) that name an emergency kind, Spanish and English, singular and plural. */
const CATEGORY_WORDS: Record<string, string[]> = {
  hospital: ['hospital', 'hospitales', 'urgencias', 'emergency room', 'emergency rooms', 'er'],
  clinic: ['clinica', 'clinicas', 'centro de salud', 'centros de salud', 'centro medico', 'medico', 'medicos', 'doctor', 'doctors', 'clinic', 'clinics', 'health center', 'health centre'],
  pharmacy: ['farmacia', 'farmacias', 'pharmacy', 'pharmacies', 'drugstore', 'chemist'],
  police: ['policia', 'comisaria', 'comisarias', 'police', 'police station', 'police stations'],
  fire_station: ['bomberos', 'parque de bomberos', 'fire station', 'fire stations', 'fire department'],
  drinking_water: ['agua', 'agua potable', 'fuente', 'fuentes', 'fuente de agua', 'drinking water', 'water', 'water fountain', 'fountain', 'potable water'],
  spring: ['manantial', 'manantiales', 'spring', 'springs'],
  fuel: ['gasolinera', 'gasolineras', 'gasolina', 'estacion de servicio', 'gas station', 'gas stations', 'petrol station', 'fuel'],
  supermarket: ['supermercado', 'supermercados', 'supermarket', 'supermarkets', 'grocery', 'groceries'],
  hardware: ['ferreteria', 'ferreterias', 'bricolaje', 'hardware store', 'hardware'],
  shelter: ['refugio', 'refugios', 'shelter', 'shelters'],
  embassy: ['embajada', 'embajadas', 'consulado', 'consulados', 'embassy', 'embassies', 'consulate', 'consulates'],
  townhall: ['ayuntamiento', 'ayuntamientos', 'town hall', 'city hall'],
  defibrillator: ['desfibrilador', 'desfibriladores', 'defibrillator', 'defibrillators', 'aed'],
  ambulance_station: ['ambulancia', 'ambulancias', 'ambulance', 'ambulances'],
  assembly_point: ['punto de encuentro', 'puntos de encuentro', 'assembly point', 'assembly points'],
};

const CATEGORY_INDEX = new Map<string, string[]>();
for (const [kind, words] of Object.entries(CATEGORY_WORDS)) {
  for (const w of words) CATEGORY_INDEX.set(w, [...(CATEGORY_INDEX.get(w) ?? []), kind]);
}

/** Lead-ins that don't change what is asked: "farmacia cerca", "nearest hospital". */
const CATEGORY_NOISE = /^(?:(?:el|la|los|las|the|a|un|una)\s+)?(?:(?:mas\s+)?cercan[oa]s?|nearest|closest|nearby|near me)\s+|\s+(?:(?:mas\s+)?cercan[oa]s?|cerca|nearby|near me|near)$/g;

/**
 * The emergency kinds a query names when the whole query is a category word ("hospitales",
 * "pharmacy", "agua potable", "farmacia cerca"); null for anything else (a name, an address).
 */
export function categoryKinds(text: string): string[] | null {
  let q = normalizeName(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (let i = 0; i < 2; i++) q = q.replace(CATEGORY_NOISE, '').trim();
  return CATEGORY_INDEX.get(q) ?? null;
}
