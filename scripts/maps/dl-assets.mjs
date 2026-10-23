// Download Protomaps basemaps-assets glyph ranges + v4 sprites.
// usage: node dl-assets.mjs <outDir> <range...>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, ...ranges] = process.argv.slice(2);
const BASE = 'https://protomaps.github.io/basemaps-assets';
const fonts = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];

async function get(url, dest) {
  const r = await fetch(url);
  if (!r.ok) {
    console.log('miss', url, r.status);
    return;
  }
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

const jobs = [];
for (const f of fonts) {
  mkdirSync(join(out, 'fonts', f), { recursive: true });
  for (const r of ranges) jobs.push(get(`${BASE}/fonts/${encodeURIComponent(f)}/${r}.pbf`, join(out, 'fonts', f, `${r}.pbf`)));
}
mkdirSync(join(out, 'sprites'), { recursive: true });
for (const fl of ['light', 'dark'])
  for (const s of ['', '@2x'])
    for (const e of ['json', 'png']) jobs.push(get(`${BASE}/sprites/v4/${fl}${s}.${e}`, join(out, 'sprites', `${fl}${s}.${e}`)));
await Promise.all(jobs);
