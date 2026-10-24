// Download Protomaps basemaps-assets glyph ranges + v4 sprites (the set make-zip.py packs).
// usage: node dl-assets.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out] = process.argv.slice(2);
const BASE = 'https://protomaps.github.io/basemaps-assets';

// Keep in sync with FONT_RANGES in make-zip.py.
const COMMON = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535', '1536-1791', '1792-2047', '7680-7935', '8192-8447', '8448-8703', '64256-64511', '64512-64767', '64768-65023', '65024-65279'];
const EXTRA = ['3584-3839', '4096-4351', '4608-4863', '4864-5119'];
const FONT_RANGES = {
  'Noto Sans Regular': [...COMMON, ...EXTRA],
  'Noto Sans Medium': [...COMMON, ...EXTRA],
  'Noto Sans Italic': COMMON,
  'Noto Sans Devanagari Regular v1': ['0-255', '2304-2559', '62720-62975', '62976-63231', '63232-63487', '63488-63743'],
};

async function get(url, dest) {
  const r = await fetch(url);
  if (!r.ok) {
    console.log('miss', url, r.status);
    return;
  }
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

const jobs = [];
for (const [f, ranges] of Object.entries(FONT_RANGES)) {
  mkdirSync(join(out, 'fonts', f), { recursive: true });
  for (const r of ranges) jobs.push(get(`${BASE}/fonts/${encodeURIComponent(f)}/${r}.pbf`, join(out, 'fonts', f, `${r}.pbf`)));
}
mkdirSync(join(out, 'sprites'), { recursive: true });
for (const fl of ['light', 'dark'])
  for (const s of ['', '@2x'])
    for (const e of ['json', 'png']) jobs.push(get(`${BASE}/sprites/v4/${fl}${s}.${e}`, join(out, 'sprites', `${fl}${s}.${e}`)));
await Promise.all(jobs);
