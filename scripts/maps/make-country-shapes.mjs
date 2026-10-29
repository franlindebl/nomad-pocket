// Builds src/features/maps/country-shapes.json, the country outlines the app uses to know which
// country a position is in, offline (its emergency number: emergency-numbers.json). From Natural
// Earth 1:50m admin-0 (public domain), with the ids of make-regions.mjs, simplified to ~2 km
// (Douglas-Peucker, 0.02°) and stored as Google polylines at 1e-3° (country-at-core.ts decodes them).
// A ring too small for that tolerance (a micro-state, an islet) keeps its quantized points.
// Places 1:50m leaves out where the emergency number differs from the country around them come
// from 1:10m (EXTRA).
// usage: node make-country-shapes.mjs <ne_50m_admin_0_countries.geojson> <ne_10m_admin_0_countries.geojson> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [src, src10, out] = process.argv.slice(2);
const a0 = JSON.parse(readFileSync(src, 'utf8'));
const a10 = JSON.parse(readFileSync(src10, 'utf8'));

// Spain's North African territories (Ceuta, Melilla, the plazas de soberanía): 112, not Morocco's numbers.
const EXTRA = [{ id: 'es', a3: 'ESP', bbox: [-6, 35, -2, 36.2] }];

const TOLERANCE = 0.02;
const PRECISION = 1000;

// The ids of make-regions.mjs (keep in step): ISO alpha-2, else the A3 code; dependencies after
// sovereign states so a code taken by both goes to the state.
const ordered = [...a0.features].sort(
  (a, b) => (a.properties.TYPE === 'Dependency' ? 1 : 0) - (b.properties.TYPE === 'Dependency' ? 1 : 0) || a.properties.LEVEL - b.properties.LEVEL,
);
const taken = new Set();
function idOf(p) {
  const iso = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  let id = (iso && iso !== '-99' ? iso : p.ADM0_A3).toLowerCase();
  if (taken.has(id)) id = p.ADM0_A3.toLowerCase();
  taken.add(id);
  return id;
}

function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst >= 0 && far > TOLERANCE) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const q = (v) => Math.round(v * PRECISION);

function quantize(points) {
  const outPts = [];
  for (const [x, y] of points) {
    const p = [q(x), q(y)];
    const last = outPts[outPts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) outPts.push(p);
  }
  return outPts;
}

/** Google's polyline encoding of integer [lon, lat] pairs (lat first, as the format has it). */
function encode(points) {
  let s = '';
  let plat = 0;
  let plon = 0;
  const num = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    s += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    num(lat - plat);
    num(lon - plon);
    plat = lat;
    plon = lon;
  }
  return s;
}

const countries = [];
let vertices = 0;
for (const f of ordered) {
  const id = idOf(f.properties);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      let pts = quantize(simplify(ring));
      if (pts.length < 4) pts = quantize(ring);
      if (pts.length < 4) continue;
      vertices += pts.length;
      rings.push(encode(pts));
    }
  }
  for (const x of EXTRA.filter((x) => x.id === id)) {
    for (const g of a10.features.filter((f) => f.properties.ADM0_A3 === x.a3).map((f) => f.geometry)) {
      for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
        const [w, s, e, n] = x.bbox;
        if (!poly[0].every(([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n)) continue;
        for (const ring of poly) {
          const pts = quantize(ring);
          if (pts.length < 4) continue;
          vertices += pts.length;
          rings.push(encode(pts));
        }
      }
    }
  }
  if (rings.length) countries.push([id, rings]);
}

const data = {
  source: 'Natural Earth 1:50m admin-0 countries (public domain), simplified to ~2 km.',
  precision: PRECISION,
  countries,
};
writeFileSync(out, JSON.stringify(data) + '\n');
console.log(`${countries.length} countries, ${vertices} vertices → ${out}`);
