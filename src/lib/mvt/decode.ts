// Minimal Mapbox Vector Tile (MVT 2.1) decoder for the offline place index:
// reads only the layers asked for, skips the rest without parsing them, and
// reduces each feature to its properties plus one representative point.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export const GeomType = { Unknown: 0, Point: 1, LineString: 2, Polygon: 3 } as const;
export type GeomTypeId = (typeof GeomType)[keyof typeof GeomType];

export type Value = string | number | boolean;

export type MvtFeature = {
  id: number | null;
  type: GeomTypeId;
  properties: Record<string, Value>;
  /** Representative point in tile coordinates (0..extent; may fall in the buffer). */
  x: number;
  y: number;
};

export type MvtLayer = { name: string; extent: number; features: MvtFeature[] };

export class MvtError extends Error {}

class Reader {
  pos: number;
  readonly end: number;
  private readonly buf: Uint8Array;
  private readonly view: DataView;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  varint(): number {
    let result = 0;
    let mult = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new MvtError('truncated varint');
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mult;
      if (b < 0x80) return result;
      mult *= 0x80;
    }
    throw new MvtError('varint too long');
  }

  /** Length-delimited field: returns its [start, end) and moves past it. */
  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new MvtError('truncated field');
    return [start, this.pos];
  }

  string(): string {
    const [s, e] = this.bytes();
    return utf8(this.buf, s, e);
  }

  float(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  double(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  skip(wireType: number) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.pos += 4;
    else throw new MvtError(`unsupported wire type ${wireType}`);
  }

  sub(range: [number, number]): Reader {
    return new Reader(this.buf, range[0], range[1]);
  }
}

// TextDecoder exists in Hermes and node; decode by hand only as a fallback.
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

function utf8(buf: Uint8Array, start: number, end: number): string {
  if (decoder) return decoder.decode(buf.subarray(start, end));
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return decodeURIComponent(escape(s));
}

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(r: Reader): Value {
  let value: Value = '';
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1) value = r.string();
    else if (field === 2) value = r.float();
    else if (field === 3) value = r.double();
    else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) value = zigzag(r.varint());
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

/**
 * Representative point of a geometry: the first point, the middle vertex of the
 * first line, or the centre of the outer ring's bounds. Good enough to put a
 * search result on the map, which is all the index needs.
 */
function representativePoint(r: Reader, type: GeomTypeId): [number, number] {
  let x = 0;
  let y = 0;
  const points: number[] = [];
  let parts = 0;
  while (r.pos < r.end) {
    const cmd = r.varint();
    const id = cmd & 7;
    const count = cmd >> 3;
    if (id === 1 || id === 2) {
      if (id === 1) parts++;
      // Only the first part (first line / outer ring) is used.
      for (let i = 0; i < count; i++) {
        x += zigzag(r.varint());
        y += zigzag(r.varint());
        if (parts === 1) points.push(x, y);
      }
      if (type === GeomType.Point && points.length) break;
      if (parts > 1) break;
    } else if (id !== 7) {
      throw new MvtError(`bad geometry command ${id}`);
    }
  }
  if (!points.length) return [0, 0];
  if (type === GeomType.LineString) {
    const mid = Math.floor(points.length / 4) * 2;
    return [points[mid], points[mid + 1]];
  }
  if (type === GeomType.Polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }
  return [points[0], points[1]];
}

function readLayer(r: Reader, wanted: ReadonlySet<string> | null): MvtLayer | null {
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: Value[] = [];
  const featureRanges: [number, number][] = [];
  // Field order is not guaranteed (keys/values usually follow the features), so
  // collect feature ranges first and decode them once keys and values are known.
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1) {
      name = r.string();
      if (wanted && !wanted.has(name)) return null;
    } else if (field === 2) featureRanges.push(r.bytes());
    else if (field === 3) keys.push(r.string());
    else if (field === 4) values.push(readValue(r.sub(r.bytes())));
    else if (field === 5) extent = r.varint();
    else r.skip(wire);
  }
  if (wanted && !wanted.has(name)) return null;

  const features: MvtFeature[] = [];
  for (const range of featureRanges) {
    const f = r.sub(range);
    let id: number | null = null;
    let type: GeomTypeId = GeomType.Unknown;
    let tags: [number, number] | null = null;
    let geometry: [number, number] | null = null;
    while (f.pos < f.end) {
      const tag = f.varint();
      const field = Math.floor(tag / 8);
      const wire = tag & 7;
      if (field === 1) id = f.varint();
      else if (field === 2) tags = f.bytes();
      else if (field === 3) type = f.varint() as GeomTypeId;
      else if (field === 4) geometry = f.bytes();
      else f.skip(wire);
    }
    const properties: Record<string, Value> = {};
    if (tags) {
      const t = f.sub(tags);
      while (t.pos < t.end) {
        const k = keys[t.varint()];
        const v = values[t.varint()];
        if (k !== undefined && v !== undefined) properties[k] = v;
      }
    }
    const [x, y] = geometry ? representativePoint(f.sub(geometry), type) : [0, 0];
    features.push({ id, type, properties, x, y });
  }
  return { name, extent, features };
}

/** Decodes an uncompressed MVT tile. `layers` limits decoding to those layer names. */
export function decodeTile(bytes: Uint8Array, layers?: readonly string[]): Record<string, MvtLayer> {
  const wanted = layers ? new Set(layers) : null;
  const r = new Reader(bytes);
  const out: Record<string, MvtLayer> = {};
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const layer = readLayer(r.sub(r.bytes()), wanted);
      if (layer) out[layer.name] = layer;
    } else r.skip(wire);
  }
  return out;
}

/** Tile coordinates (z/x/y + position inside the tile) to longitude/latitude. */
export function tilePointToLonLat(z: number, x: number, y: number, px: number, py: number, extent: number): [number, number] {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * (y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return [lon, lat];
}
