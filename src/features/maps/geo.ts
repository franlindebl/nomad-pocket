// Coordinate math for search, emergency lists and straight-line guidance:
// distances and bearings, UTM (what rescue services and Protección Civil read
// out), and parsing whatever coordinates a user pastes into the search box.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export type LatLon = { lat: number; lon: number };

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres from `p` to the segment a–b ([lon, lat] ends), on a local flat projection (fine over a street's length). */
export function metersToSegment(p: LatLon, a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.cos(rad(p.lat));
  const ax = (a[0] - p.lon) * k;
  const ay = a[1] - p.lat;
  const dx = (b[0] - p.lon) * k - ax;
  const dy = b[1] - p.lat - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * ((Math.PI * R) / 180);
}

/** Metres from `p` to the nearest point of a [lon, lat] line. */
export function metersToLine(p: LatLon, line: readonly (readonly [number, number])[]): number {
  if (line.length === 1) return distanceMeters(p, { lon: line[0][0], lat: line[0][1] });
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, metersToSegment(p, line[i - 1], line[i]));
  return best;
}

/** Initial bearing from a to b, degrees clockwise from true north (0..360). */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** 8-point compass sector of a bearing: 0 = N, 1 = NE … 7 = NW. */
export function compassSector(bearing: number): number {
  return Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
}

/** How the interface is turned (expo-screen-orientation's names); landscapeLeft: home side on the left. */
export type InterfaceOrientation = 'portraitUp' | 'portraitDown' | 'landscapeLeft' | 'landscapeRight' | 'unknown';

/** Where the top of the screen points, from where the device's portrait top points. */
const SCREEN_TURN: Record<InterfaceOrientation, number> = {
  portraitUp: 0,
  unknown: 0,
  // Turned clockwise: the device's top points right of the screen's top.
  landscapeLeft: 270,
  // Turned counter-clockwise: the device's top points left of it.
  landscapeRight: 90,
  portraitDown: 180,
};

/**
 * The compass heading of the screen's top. Both platforms' compasses measure along the
 * device's portrait top, so with the interface in landscape or upside down an arrow
 * drawn from it would be 90° or 180° off.
 */
export function screenHeading(deviceHeading: number, orientation: InterfaceOrientation): number {
  return (((deviceHeading + SCREEN_TURN[orientation]) % 360) + 360) % 360;
}

/**
 * The orientation to turn the compass by, or null when it can't be told. An unknown one
 * on a portrait-shaped screen is portrait; on a landscape one it could be either side,
 * and a guess would point 180° wrong half the time: better no compass than a wrong one.
 */
export function knownOrientation(orientation: InterfaceOrientation, screen: { width: number; height: number }): InterfaceOrientation | null {
  if (orientation !== 'unknown') return orientation;
  return screen.width > screen.height ? null : 'portraitUp';
}

/** A last-known position may be hours old, in another town: only a fix this recent counts. */
export function isFreshFix(timestamp: number, maxAgeMs: number, now = Date.now()): boolean {
  return now - timestamp <= maxAgeMs;
}

/** Square-ish box around a point, for SQL prefilters. */
export function bboxAround(p: LatLon, radiusMeters: number): [number, number, number, number] {
  const dLat = deg(radiusMeters / R);
  const dLon = dLat / Math.max(0.01, Math.cos(rad(p.lat)));
  return [p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat];
}

// --- Longitude ranges across the antimeridian --------------------------------
// A box is [west, south, east, north]. One that crosses 180° (Fiji, Chukotka, the Aleutians) has
// west > east, or a longitude beyond ±180 (a box around a point near it, a map camera that
// unwrapped the world): SQL `lon BETWEEN w AND e` and `lon >= w && lon <= e` match nothing there.

export type LonRange = [number, number];

/** Wraps a longitude into [-180, 180). */
export const wrapLon = (lon: number) => (lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180);

/** Signed longitude difference b - a, the short way round (-180..180). */
export const lonDelta = (a: number, b: number) => wrapLon(b - a);

/** The west..east span as one range, or two when it crosses 180° (each inside [-180, 180]). */
export function lonRanges(west: number, east: number): LonRange[] {
  if (west <= east) {
    if (east - west >= 360) return [[-180, 180]];
    if (west >= -180 && east <= 180) return [[west, east]];
    // Unwrapped (a camera panned past 180°): move the west end into range, keep the width.
    const w = wrapLon(west);
    const e = w + (east - west);
    return e <= 180
      ? [[w, e]]
      : [
          [w, 180],
          [-180, e - 360],
        ];
  }
  // west > east: crosses the antimeridian.
  return [
    [wrapLon(west), 180],
    [-180, wrapLon(east)],
  ];
}

/** Whether `lon` lies in the span west..east (crossing 180° allowed). */
export function lonInSpan(west: number, east: number, lon: number): boolean {
  const l = lon < -180 || lon > 180 ? wrapLon(lon) : lon;
  return lonRanges(west, east).some(([a, b]) => l >= a && l <= b);
}

/** Whether a [w, s, e, n] box holds the point; the box may cross the antimeridian. */
export function bboxHas(b: readonly number[], p: LatLon): boolean {
  return p.lat >= b[1] && p.lat <= b[3] && lonInSpan(b[0], b[2], p.lon);
}

/** Whether two longitude spans share any longitude (either may cross 180°). */
export function lonSpansOverlap(w1: number, e1: number, w2: number, e2: number): boolean {
  return lonRanges(w1, e1).some(([a, b]) => lonRanges(w2, e2).some(([c, d]) => a < d && b > c));
}

/** Whether two [w, s, e, n] boxes overlap (strictly, touching edges don't count); either may cross 180°. */
export function bboxesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return a[1] < b[3] && a[3] > b[1] && lonSpansOverlap(a[0], a[2], b[0], b[2]);
}

/**
 * The smallest [w, s, e, n] box around [lon, lat] points, for a map camera. One that crosses 180° (a
 * route on Taveuni, Fiji) keeps west < east by running east past 180: MapLibre fits such unwrapped
 * bounds on iOS and Android, while a plain min/max would frame the whole world.
 */
export function fitBox(points: Iterable<readonly [number, number]>): [number, number, number, number] | null {
  let [s, n] = [Infinity, -Infinity];
  let [w1, e1, w2, e2] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [rawLon, lat] of points) {
    const lon = wrapLon(rawLon);
    // The same longitudes on 0..360, where a span across 180° is contiguous.
    const shifted = lon < 0 ? lon + 360 : lon;
    [w1, e1, w2, e2] = [Math.min(w1, lon), Math.max(e1, lon), Math.min(w2, shifted), Math.max(e2, shifted)];
    [s, n] = [Math.min(s, lat), Math.max(n, lat)];
  }
  if (s > n) return null;
  if (e1 - w1 <= e2 - w2) return [w1, s, e1, n];
  return w2 >= 180 ? [w2 - 360, s, e2 - 360, n] : [w2, s, e2, n];
}

/** A box's longitude condition for SQL: `col BETWEEN ? AND ?`, or two of them joined by OR when it crosses 180°. */
export function lonSql(column: string, west: number, east: number, scale = 1): { sql: string; params: number[] } {
  const ranges = lonRanges(west, east);
  const one = `${column} BETWEEN ? AND ?`;
  const params = ranges.flatMap(([a, b]) => scale === 1 ? [a, b] : [Math.floor(a * scale), Math.ceil(b * scale)]);
  return { sql: ranges.length > 1 ? `(${one} OR ${one})` : one, params };
}

/**
 * ORDER BY expression (squared distance in degrees, longitude shrunk by `lonScale`) from `near`
 * that stays right across 180°: where the box crosses it, longitudes are shifted to 0..360 first.
 */
export function nearOrderSql(near: LatLon, lonScale: number, crossing: boolean, lat = 'lat', lon = 'lon'): { sql: string; params: number[] } {
  if (!crossing) {
    return { sql: `(${lat} - ?) * (${lat} - ?) + (${lon} - ?) * (${lon} - ?) * ?`, params: [near.lat, near.lat, near.lon, near.lon, lonScale] };
  }
  const x = `(CASE WHEN ${lon} < 0 THEN ${lon} + 360 ELSE ${lon} END)`;
  const nl = near.lon < 0 ? near.lon + 360 : near.lon;
  return { sql: `(${lat} - ?) * (${lat} - ?) + (${x} - ?) * (${x} - ?) * ?`, params: [near.lat, near.lat, nl, nl, lonScale] };
}

// ---------------------------------------------------------------------------
// UTM (WGS84), with the latitude band letter (e.g. "30T 440291 4474254").

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

export type Utm = { zone: number; band: string; easting: number; northing: number };

function utmZone(lat: number, lon: number): number {
  // Norway and Svalbard exceptions.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return Math.min(60, Math.floor((lon + 180) / 6) + 1);
}

function meridionalArc(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

/** UTM coordinates, or null outside 80°S..84°N (polar areas use UPS). */
export function toUtm(lat: number, lon: number): Utm | null {
  if (!(lat >= -80 && lat < 84)) return null;
  const zone = utmZone(lat, lon);
  const lon0 = rad((zone - 1) * 6 - 180 + 3);
  const phi = rad(lat);
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (rad(lon) - lon0);
  const m = meridionalArc(phi);
  const easting = K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  let northing =
    K0 *
    (m +
      n *
        Math.tan(phi) *
        ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  if (lat < 0) northing += 10000000;
  const band = BANDS[Math.min(BANDS.length - 1, Math.floor((lat + 80) / 8))];
  return { zone, band, easting, northing };
}

export function fromUtm(u: Utm): LatLon {
  const south = BANDS.indexOf(u.band.toUpperCase()) < BANDS.indexOf('N');
  const x = u.easting - 500000;
  const y = south ? u.northing - 10000000 : u.northing;
  const lon0 = rad((u.zone - 1) * 6 - 180 + 3);
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = EP2 * Math.cos(phi1) ** 2;
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * K0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    lon0 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
      Math.cos(phi1);
  return { lat: deg(lat), lon: deg(lon) };
}

export function formatUtm(u: Utm): string {
  return `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
}

export function formatLatLon(lat: number, lon: number, digits = 5): string {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

// ---------------------------------------------------------------------------
// Parsing

const valid = (p: LatLon) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Sign from a hemisphere letter; O (oeste) is Spanish for W. */
function hemisphereSign(letter: string | undefined): number {
  return letter && /[SWO]/i.test(letter) ? -1 : 1;
}

function parseUtm(text: string): LatLon | null {
  const m = /^(\d{1,2})\s*([C-HJ-NP-X])\s+(\d{3,7}(?:[.,]\d+)?)\s*m?\s*[EX]?\s*[,;\s]\s*(\d{4,8}(?:[.,]\d+)?)\s*m?\s*[NY]?$/i.exec(text);
  if (!m) return null;
  const zone = Number(m[1]);
  if (zone < 1 || zone > 60) return null;
  const p = fromUtm({ zone, band: m[2].toUpperCase(), easting: Number(m[3].replace(',', '.')), northing: Number(m[4].replace(',', '.')) });
  return valid(p) ? p : null;
}

const DMS_PART = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*[°º˚d]?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’m]?\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|”|''|s)?\s*)?`;
const DMS = new RegExp(String.raw`^([NS])?\s*${DMS_PART}([NS])?\s*[,;\s]?\s*([EWO])?\s*${DMS_PART}([EWO])?$`, 'i');

function parseDms(text: string): LatLon | null {
  const m = DMS.exec(text);
  if (!m) return null;
  const [, h1, d1, m1, s1, h2, h3, d2, m2, s2, h4] = m;
  // Without minutes or seconds and without hemisphere letters this is plain decimal.
  if (!m1 && !m2 && !h1 && !h2 && !h3 && !h4) return null;
  const num = (v: string | undefined) => (v ? Number(v.replace(',', '.')) : 0);
  if (num(m1) >= 60 || num(s1) >= 60 || num(m2) >= 60 || num(s2) >= 60) return null;
  const lat = (num(d1) + num(m1) / 60 + num(s1) / 3600) * hemisphereSign(h1 ?? h2);
  const lon = (num(d2) + num(m2) / 60 + num(s2) / 3600) * hemisphereSign(h3 ?? h4);
  const p = { lat, lon };
  return valid(p) ? p : null;
}

function parseDecimal(text: string): LatLon | null {
  // "40.41, -3.70" · "40.41 -3.70" · "40,41; -3,70" (comma decimals need ; or space)
  let m = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(text);
  if (!m) m = /^(-?\d{1,2}(?:,\d+)?)\s*(?:;|\s)\s*(-?\d{1,3}(?:,\d+)?)$/.exec(text);
  if (!m) return null;
  const p = { lat: Number(m[1].replace(',', '.')), lon: Number(m[2].replace(',', '.')) };
  return valid(p) ? p : null;
}

/** Coordinates typed or pasted in any common format: decimal, DMS or UTM. */
export function parseCoordinates(input: string): LatLon | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text || !/\d/.test(text)) return null;
  return parseUtm(text) ?? parseDecimal(text) ?? parseDms(text);
}
