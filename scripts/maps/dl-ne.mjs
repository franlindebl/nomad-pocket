import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
// Natural Earth v5.1.2, the commit build-country-map.sh pins: region ids must match there.
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/';
for (const f of ['ne_50m_admin_0_countries.geojson', 'ne_10m_admin_1_states_provinces.geojson']) {
  const r = await fetch(base + f);
  console.log(f, r.status);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  writeFileSync(join(out, f), Buffer.from(await r.arrayBuffer()));
}
