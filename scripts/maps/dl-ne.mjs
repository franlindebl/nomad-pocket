import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
for (const f of ['ne_50m_admin_0_countries.geojson', 'ne_10m_admin_1_states_provinces.geojson']) {
  const r = await fetch(base + f);
  console.log(f, r.status);
  writeFileSync(join(out, f), Buffer.from(await r.arrayBuffer()));
}
