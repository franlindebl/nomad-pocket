// PMTiles v3 tile ids: tiles are numbered along a Hilbert curve per zoom level,
// zoom levels stacked one after another (z0 = id 0, z1 = ids 1..4, ...).
// All math uses plain numbers (exact up to 2^53, i.e. zoom 26).

/** [west, south, east, north] in degrees (WGS84). */
export type BBox = [number, number, number, number];

/** Half-open interval of tile ids [start, end). */
export type TileRange = [number, number];

export const MAX_ZOOM = 26;

/** First tile id of zoom `z`: (4^z - 1) / 3. */
export function zoomBase(z: number): number {
  return (Math.pow(4, z) - 1) / 3;
}

/** Hilbert index of (x, y) inside a 2^z × 2^z grid (xy2d). */
function hilbertIndex(z: number, x: number, y: number): number {
  const n = Math.pow(2, z);
  let d = 0;
  let tx = x;
  let ty = y;
  // Bitwise ops are safe: coordinates stay below 2^26.
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = tx & s ? 1 : 0;
    const ry = ty & s ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = n - 1 - tx;
        ty = n - 1 - ty;
      }
      const t = tx;
      tx = ty;
      ty = t;
    }
  }
  return d;
}

export function zxyToTileId(z: number, x: number, y: number): number {
  if (z < 0 || z > MAX_ZOOM || !Number.isInteger(z)) throw new RangeError(`invalid zoom ${z}`);
  const n = Math.pow(2, z);
  if (x < 0 || y < 0 || x >= n || y >= n) throw new RangeError(`tile ${z}/${x}/${y} out of bounds`);
  return zoomBase(z) + hilbertIndex(z, x, y);
}

export function tileIdToZ(id: number): number {
  let z = 0;
  while (zoomBase(z + 1) <= id) z++;
  return z;
}

export function tileIdToZxy(id: number): [number, number, number] {
  if (id < 0 || !Number.isInteger(id)) throw new RangeError(`invalid tile id ${id}`);
  const z = tileIdToZ(id);
  if (z > MAX_ZOOM) throw new RangeError(`tile id ${id} beyond max zoom`);
  const n = Math.pow(2, z);
  // d2xy; t can exceed 2^32, so no bitwise ops on it.
  let t = id - zoomBase(z);
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s *= 2) {
    const rx = Math.floor(t / 2) % 2;
    const ry = (t % 2) ^ rx;
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x;
      x = y;
      y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [z, x, y];
}

// ---------------------------------------------------------------------------
// Geographic helpers (Web Mercator / slippy map tiles)

const MAX_LAT = 85.0511287798066;

export function lonToTileX(lon: number, z: number): number {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  return Math.min(n - 1, Math.max(0, x));
}

export function latToTileY(lat: number, z: number): number {
  const n = Math.pow(2, z);
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return Math.min(n - 1, Math.max(0, y));
}

/** Inclusive tile x/y bounds of a bbox at zoom z. */
export function bboxTileBounds(bbox: BBox, z: number): { x0: number; y0: number; x1: number; y1: number } {
  const [w, s, e, n] = bbox;
  return { x0: lonToTileX(w, z), x1: lonToTileX(e, z), y0: latToTileY(n, z), y1: latToTileY(s, z) };
}

export function countBBoxTiles(bbox: BBox, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const b = bboxTileBounds(bbox, z);
    total += (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  }
  return total;
}

/**
 * Sorted, merged tile-id ranges covering every tile that intersects `bbox`
 * between `minZoom` and `maxZoom` (inclusive).
 *
 * Uses the Hilbert property that all descendants at zoom Z of tile (z, d) occupy
 * the contiguous index range [d·4^(Z-z), (d+1)·4^(Z-z)), so a quadtree descent
 * yields O(perimeter) ranges instead of enumerating every tile.
 */
export function bboxTileRanges(bbox: BBox, minZoom: number, maxZoom: number): TileRange[] {
  const out: TileRange[] = [];
  for (let Z = minZoom; Z <= maxZoom; Z++) {
    const b = bboxTileBounds(bbox, Z);
    const base = zoomBase(Z);
    const zoomRanges: TileRange[] = [];
    const visit = (z: number, x: number, y: number) => {
      const span = Math.pow(2, Z - z);
      const tx0 = x * span;
      const ty0 = y * span;
      const tx1 = tx0 + span - 1;
      const ty1 = ty0 + span - 1;
      if (tx1 < b.x0 || tx0 > b.x1 || ty1 < b.y0 || ty0 > b.y1) return;
      if (tx0 >= b.x0 && tx1 <= b.x1 && ty0 >= b.y0 && ty1 <= b.y1) {
        const d = hilbertIndex(z, x, y);
        const size = span * span;
        zoomRanges.push([base + d * size, base + (d + 1) * size]);
        return;
      }
      visit(z + 1, 2 * x, 2 * y);
      visit(z + 1, 2 * x + 1, 2 * y);
      visit(z + 1, 2 * x, 2 * y + 1);
      visit(z + 1, 2 * x + 1, 2 * y + 1);
    };
    visit(0, 0, 0);
    zoomRanges.sort((a, c) => a[0] - c[0]);
    for (const r of zoomRanges) out.push(r);
  }
  return mergeRanges(out);
}

export function mergeRanges(sorted: TileRange[]): TileRange[] {
  const out: TileRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function rangesTileCount(ranges: TileRange[]): number {
  let n = 0;
  for (const [a, b] of ranges) n += b - a;
  return n;
}

/** Index of the first range whose end is > id (ranges sorted, disjoint). */
export function firstRangeAfter(ranges: TileRange[], id: number): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function intersects(ranges: TileRange[], start: number, end: number): boolean {
  const i = firstRangeAfter(ranges, start);
  return i < ranges.length && ranges[i][0] < end;
}
