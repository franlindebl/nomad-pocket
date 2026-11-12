#!/usr/bin/env node
// Builds data/emma.json.gz: MeteoAlarm's warning regions (EMMA_ID geocodes) simplified for matching a registration's
// 0.1° cell to the regions it touches (docs/ALERTS_PLAN.md, phase 2, "zones table"). The geocodes come from
// MeteoAlarm's redistribution hub (https://meteoalarm.org/en/live/page/redistribution-hub), a public GeoJSON on
// their GitLab; the server only uses them to match, it never hands them out. The output is generated, not committed
// (data/ is gitignored): `npm run build` makes it when it's missing, so a deploy always carries it.
//
//   node scripts/build-zones.mjs [--force]
//
// Bump GEOCODES when the hub publishes a new file (its change log is on the same page).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const GEOCODES = 'https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json?inline=false';
/** Douglas–Peucker tolerance in degrees (~200 m): plenty for an 11 km cell, and a tenth of the size. */
const TOLERANCE = 0.002;
/** Coordinates kept to 1e-3° (~100 m), stored as integers. */
const SCALE = 1000;

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const out = join(dataDir, 'emma.json.gz');
const cache = join(dataDir, 'cache', GEOCODES.split('/').pop().split('?')[0]);

if (existsSync(out) && !process.argv.includes('--force')) process.exit(0);
mkdirSync(dirname(cache), { recursive: true });

if (!existsSync(cache)) {
  const res = await fetch(GEOCODES, { headers: { 'User-Agent': 'NomadPocketAlerts/1.0 (+https://github.com/franlindebl/nomad-pocket)' } });
  if (!res.ok) throw new Error(`geocodes: HTTP ${res.status}`);
  writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
}

function perpendicular(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicular(points[i], points[s], points[e]);
      if (d > max) [max, at] = [d, i];
    }
    if (max > TOLERANCE && at !== -1) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const fc = JSON.parse(readFileSync(cache, 'utf8'));
const zones = {};
let before = 0;
let after = 0;
for (const f of fc.features) {
  const { code, country } = f.properties;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const rings = [];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  // Outer rings only: a cell inside a hole (an enclave) then gets both regions' warnings, like a cell on a border.
  for (const poly of polys) {
    const outer = poly[0];
    before += outer.length;
    let ring = simplify(outer).map(([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)]);
    ring = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
    if (ring.length < 4) continue;
    after += ring.length;
    for (const [x, y] of ring) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
    rings.push(ring.flat());
  }
  if (rings.length) zones[code] = { c: country.toLowerCase(), b: [w, s, e, n], r: rings };
}

const json = JSON.stringify({ source: GEOCODES, scale: SCALE, zones });
mkdirSync(dataDir, { recursive: true });
writeFileSync(out, gzipSync(json, { level: 9 }));
const countries = [...new Set(Object.values(zones).map((z) => z.c))].sort();
console.log(
  `emma.json.gz: ${Object.keys(zones).length} zones in ${countries.length} countries (${countries.join(' ')}), ` +
    `${before} → ${after} points, ${(json.length / 1e6).toFixed(1)} MB → ${(readFileSync(out).length / 1e6).toFixed(2)} MB gzipped`,
);
