// Builds src/features/maps/regions.json from Natural Earth (public domain).
// usage: node make-regions.mjs <neDir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [dir, out] = process.argv.slice(2);
const a0 = JSON.parse(readFileSync(`${dir}/ne_50m_admin_0_countries.geojson`, 'utf8'));
const a1 = JSON.parse(readFileSync(`${dir}/ne_10m_admin_1_states_provinces.geojson`, 'utf8'));

const polys = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);
function polyInfo(p) {
  let w = 180, s = 90, e = -180, n = -90, area = 0;
  const ring = p[0];
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  // Equirectangular projection around the polygon's mid latitude, then shoelace.
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x * k * y2 - x2 * k * y;
  }
  return { bbox: [w, s, e, n], area: Math.abs(area / 2) };
}
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
function dist(b, c) {
  const dx = Math.max(0, b[0] - c[2], c[0] - b[2]);
  const dy = Math.max(0, b[1] - c[3], c[1] - b[3]);
  return Math.hypot(dx, dy);
}

/** Drop the minority side of the antimeridian if the union would span > 180°. */
function antimeridian(infos) {
  const all = infos.reduce((acc, i) => union(acc, i.bbox), infos[0].bbox);
  if (all[2] - all[0] <= 180) return infos;
  const east = infos.filter((i) => (i.bbox[0] + i.bbox[2]) / 2 >= 0);
  const west = infos.filter((i) => (i.bbox[0] + i.bbox[2]) / 2 < 0);
  const ea = east.reduce((s, i) => s + i.area, 0);
  const wa = west.reduce((s, i) => s + i.area, 0);
  return ea >= wa ? east : west;
}

/** Main landmass plus nearby/large polygons (skips far-flung overseas territories). */
function countryBBox(geoms, fixedThreshold) {
  let infos = antimeridian(geoms.flatMap((g) => polys(g).map(polyInfo)));
  infos.sort((a, b) => b.area - a.area);
  const main = infos[0];
  let bbox = main.bbox;
  const size = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const threshold = fixedThreshold ?? Math.max(2, Math.min(4, 0.25 * size));
  let changed = true;
  const used = new Set([0]);
  while (changed) {
    changed = false;
    infos.forEach((p, i) => {
      if (used.has(i)) return;
      if (p.area >= 0.25 * main.area || dist(bbox, p.bbox) <= threshold) {
        bbox = union(bbox, p.bbox);
        used.add(i);
        changed = true;
      }
    });
  }
  return bbox;
}

function allBBox(geoms) {
  const infos = antimeridian(geoms.flatMap((g) => polys(g).map(polyInfo)));
  return infos.reduce((acc, i) => union(acc, i.bbox), infos[0].bbox);
}

const PAD = 0.02;
const round = (b) => [
  Math.max(-180, Math.floor((b[0] - PAD) * 1000) / 1000),
  Math.max(-85, Math.floor((b[1] - PAD) * 1000) / 1000),
  Math.min(180, Math.ceil((b[2] + PAD) * 1000) / 1000),
  Math.min(85, Math.ceil((b[3] + PAD) * 1000) / 1000),
];

const CONTINENT = {
  Africa: 'africa', Asia: 'asia', Europe: 'europe', 'North America': 'north-america',
  'South America': 'south-america', Oceania: 'oceania', Antarctica: 'antarctica',
};
const UN = { Africa: 'africa', Asia: 'asia', Europe: 'europe', Americas: 'north-america', Oceania: 'oceania' };

const regions = [];
const taken = new Set();
const ordered = [...a0.features].sort((a, b) => (a.properties.TYPE === 'Dependency' ? 1 : 0) - (b.properties.TYPE === 'Dependency' ? 1 : 0) || a.properties.LEVEL - b.properties.LEVEL);
for (const f of ordered) {
  const p = f.properties;
  const iso = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  let id = (iso && iso !== '-99' ? iso : p.ADM0_A3).toLowerCase();
  if (taken.has(id)) id = p.ADM0_A3.toLowerCase();
  taken.add(id);
  const continent = CONTINENT[p.CONTINENT] ?? UN[p.REGION_UN] ?? 'oceania';
  regions.push({ id, type: 'country', continent, name: { es: p.NAME_ES || p.NAME, en: p.NAME_EN || p.NAME }, bbox: round(countryBBox([f.geometry])) });
}

const ES = {
  Andalucía: ['an', 'Andalucía', 'Andalusia'],
  Aragón: ['ar', 'Aragón', 'Aragon'],
  Asturias: ['as', 'Asturias', 'Asturias'],
  'Canary Is.': ['cn', 'Canarias', 'Canary Islands'],
  Cantabria: ['cb', 'Cantabria', 'Cantabria'],
  'Castilla y León': ['cl', 'Castilla y León', 'Castile and León'],
  'Castilla-La Mancha': ['cm', 'Castilla-La Mancha', 'Castilla–La Mancha'],
  Cataluña: ['ct', 'Cataluña', 'Catalonia'],
  Ceuta: ['ce', 'Ceuta', 'Ceuta'],
  Extremadura: ['ex', 'Extremadura', 'Extremadura'],
  Galicia: ['ga', 'Galicia', 'Galicia'],
  'Islas Baleares': ['ib', 'Islas Baleares', 'Balearic Islands'],
  'La Rioja': ['ri', 'La Rioja', 'La Rioja'],
  Madrid: ['md', 'Comunidad de Madrid', 'Community of Madrid'],
  Melilla: ['ml', 'Melilla', 'Melilla'],
  Murcia: ['mc', 'Región de Murcia', 'Region of Murcia'],
  'Foral de Navarra': ['nc', 'Navarra', 'Navarre'],
  'País Vasco': ['pv', 'País Vasco', 'Basque Country'],
  Valenciana: ['vc', 'Comunidad Valenciana', 'Valencian Community'],
};
const byRegion = new Map();
for (const f of a1.features.filter((f) => f.properties.adm0_a3 === 'ESP')) {
  const r = f.properties.region;
  if (!ES[r]) throw new Error('unknown region ' + r);
  byRegion.set(r, [...(byRegion.get(r) ?? []), f.geometry]);
}
for (const [r, geoms] of byRegion) {
  const [code, es, en] = ES[r];
  regions.push({ id: `es-${code}`, type: 'subdivision', parent: 'es', continent: 'europe', name: { es, en }, bbox: round(countryBBox(geoms, 1.5)) });
}
for (const f of a1.features.filter((f) => f.properties.adm0_a3 === 'USA')) {
  const p = f.properties;
  regions.push({
    id: p.iso_3166_2.toLowerCase(),
    type: 'subdivision',
    parent: 'us',
    continent: 'north-america',
    name: { es: p.name_es || p.name, en: p.name_en || p.name },
    bbox: round(countryBBox([f.geometry], 1.5)),
  });
}

const ids = new Set();
for (const r of regions) {
  if (ids.has(r.id)) throw new Error('dup ' + r.id);
  ids.add(r.id);
}
const data = {
  source: 'Natural Earth 1:50m admin-0 / 1:10m admin-1 (public domain). Bounding boxes skip far-flung overseas territories.',
  regions,
};
writeFileSync(out, JSON.stringify(data).replace(/\},\{"id"/g, '},\n{"id"').replace('"regions":[{', '"regions":[\n{') + '\n');
for (const id of ['es', 'fr', 'us', 'ru', 'pt', 'no', 'nl', 'nz', 'fj', 'ki', 'cl', 'us-ak', 'us-hi', 'es-cn', 'es-md', 'gb', 'dk']) {
  const r = regions.find((x) => x.id === id);
  console.log(id, r?.name.es, JSON.stringify(r?.bbox));
}
console.log(regions.length, 'regions');
