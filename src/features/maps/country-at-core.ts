// Which country a position is in, offline, from the bundled outlines (country-shapes.json, built by
// scripts/maps/make-country-shapes.mjs): Google polylines decoded once, a bounding box per ring,
// then an even-odd test. The outlines are simplified to ~2 km, so a position on a beach or a boat
// near the coast can fall just outside: then the closest country within NEAR_KM counts.
// Pure (no app imports) so node --test can load it.

export type CountryShapes = { precision: number; countries: [id: string, rings: string[]][] };

type Ring = { pts: Float64Array; w: number; s: number; e: number; n: number };
type Country = { id: string; rings: Ring[]; w: number; s: number; e: number; n: number };

const NEAR_KM = 25;
const KM_PER_DEG = 111.32;

/** Google's polyline format, [lon, lat] pairs flattened, in degrees. */
export function decodePolyline(s: string, precision: number): Float64Array {
  const out: number[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push(lon / precision, lat / precision);
  }
  return Float64Array.from(out);
}

function ringOf(pts: Float64Array): Ring {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    w = Math.min(w, pts[i]);
    e = Math.max(e, pts[i]);
    s = Math.min(s, pts[i + 1]);
    n = Math.max(n, pts[i + 1]);
  }
  return { pts, w, s, e, n };
}

export function prepareShapes(data: CountryShapes): Country[] {
  return data.countries.map(([id, encoded]) => {
    const rings = encoded.map((r) => ringOf(decodePolyline(r, data.precision)));
    return {
      id,
      rings,
      w: Math.min(...rings.map((r) => r.w)),
      s: Math.min(...rings.map((r) => r.s)),
      e: Math.max(...rings.map((r) => r.e)),
      n: Math.max(...rings.map((r) => r.n)),
    };
  });
}

function crossings(r: Ring, lon: number, lat: number): number {
  if (lon < r.w || lon > r.e || lat < r.s || lat > r.n) return 0;
  const p = r.pts;
  let c = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1];
    const yj = p[j + 1];
    if (yi > lat !== yj > lat && lon < ((p[j] - p[i]) * (lat - yi)) / (yj - yi) + p[i]) c++;
  }
  return c;
}

/** Distance in km from a point to a ring's edges (equirectangular around the point: fine within tens of km). */
function ringKm(r: Ring, lon: number, lat: number, k: number): number {
  const p = r.pts;
  let best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = (p[j] - lon) * k;
    const ay = p[j + 1] - lat;
    const bx = (p[i] - lon) * k;
    const by = p[i + 1] - lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best * KM_PER_DEG;
}

/**
 * The id of the country at a position, the closest one within NEAR_KM off its coast, or null. Where
 * outlines overlap (an enclave the coarse outline of its neighbour swallows: Ceuta in Morocco's) the
 * smallest ring around the position wins.
 */
export function countryAt(countries: Country[], lat: number, lon: number): string | null {
  let inside: { id: string; area: number } | null = null;
  for (const c of countries) {
    if (lon < c.w || lon > c.e || lat < c.s || lat > c.n) continue;
    let n = 0;
    let area = Infinity;
    for (const r of c.rings) {
      const k = crossings(r, lon, lat);
      n += k;
      if (k % 2 === 1) area = Math.min(area, (r.e - r.w) * (r.n - r.s));
    }
    if (n % 2 === 1 && (!inside || area < inside.area)) inside = { id: c.id, area };
  }
  if (inside) return inside.id;
  const margin = NEAR_KM / KM_PER_DEG;
  const k = Math.cos((lat * Math.PI) / 180);
  const lonMargin = margin / Math.max(k, 0.01);
  let best: { id: string; km: number } | null = null;
  for (const c of countries) {
    if (lon < c.w - lonMargin || lon > c.e + lonMargin || lat < c.s - margin || lat > c.n + margin) continue;
    for (const r of c.rings) {
      if (lon < r.w - lonMargin || lon > r.e + lonMargin || lat < r.s - margin || lat > r.n + margin) continue;
      const km = ringKm(r, lon, lat, k);
      if (km <= NEAR_KM && (!best || km < best.km)) best = { id: c.id, km };
    }
  }
  return best?.id ?? null;
}
