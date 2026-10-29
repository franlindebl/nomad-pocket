/// <reference types="node" />
// Dev/E2E stand-in for the Protomaps planet build: a synthetic PMTiles archive over one bbox,
// served with HTTP Range (and an optional delay per request so a run can be killed mid-way).
// The app reads it when built with EXPO_PUBLIC_PLANET_BUILD_URL=http://localhost:<port>/20260101.pmtiles
// (docs/E2E.md, "Map extraction resume"). Tiles are real vector tiles (a fixture's) padded with an
// unknown protobuf field so every tile is unique and the archive is big enough to need many requests.
//
//   node --experimental-strip-types scripts/dev-planet-server.ts [--port 8786] [--delay 800]
//        [--bbox 5.95,45.81,10.475,47.796] [--max-zoom 12] [--pad 60000] [--file /tmp/planet.pmtiles]
//   curl 'http://localhost:<port>/__outage?ms=60000'   # a network failure for a minute (?ms=0 ends it)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildArchive } from '../src/lib/pmtiles/build.ts';
import { parseHeader } from '../src/lib/pmtiles/format.ts';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { bboxTileBounds, zxyToTileId } from '../src/lib/pmtiles/tileid.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const port = Number(args.get('port') ?? 8786);
const delay = Number(args.get('delay') ?? 0);
const bbox = (args.get('bbox') ?? '5.95,45.81,10.475,47.796').split(',').map(Number) as [number, number, number, number];
const maxZoom = Number(args.get('max-zoom') ?? 12);
const pad = Number(args.get('pad') ?? 60000);
const file = args.get('file') ?? join(process.env.TMPDIR ?? '/tmp', `dev-planet-${maxZoom}-${pad}.pmtiles`);

const fixture = join(import.meta.dirname, '../e2e/fixtures/maps/ad.pmtiles');

class FileSource implements Source {
  data = readFileSync(fixture);
  getKey = () => fixture;
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.data.buffer.slice(this.data.byteOffset + offset, this.data.byteOffset + offset + length) as ArrayBuffer };
  }
}

async function baseTile(): Promise<Uint8Array> {
  const src = new FileSource();
  const h = parseHeader(new Uint8Array(src.data.subarray(0, 127)));
  const reader = new PMTiles(src);
  // Densest tile near the fixture's center at its top zoom.
  const z = h.maxZoom;
  const n = 1 << z;
  const cx = Math.floor(((h.centerLon + 180) / 360) * n);
  const cy = Math.floor(((1 - Math.log(Math.tan((h.centerLat * Math.PI) / 180) + 1 / Math.cos((h.centerLat * Math.PI) / 180)) / Math.PI) / 2) * n);
  let best = new Uint8Array(0);
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const t = await reader.getZxy(z, cx + dx, cy + dy);
      if (t && t.data.byteLength > best.length) best = new Uint8Array(t.data);
    }
  if (!best.length) throw new Error('no tile in the fixture');
  return best; // the reader already gunzipped it
}

async function make() {
  const base = await baseTile();
  const tiles: { tileId: number; data: Uint8Array }[] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const b = bboxTileBounds(bbox, z);
    for (let x = b.x0; x <= b.x1; x++)
      for (let y = b.y0; y <= b.y1; y++) {
        // Field 15, wire type 2 (length-delimited): ignored by protobuf readers.
        const n = pad + ((x * 31 + y * 17) % 997);
        const extra = new Uint8Array(n);
        extra[0] = x & 255;
        extra[1] = y & 255;
        extra[2] = z;
        const head = [0x7a];
        for (let v = n; ; v >>= 7) {
          head.push(v > 127 ? (v & 127) | 128 : v);
          if (v <= 127) break;
        }
        const data = new Uint8Array(base.length + head.length + n);
        data.set(base);
        data.set(head, base.length);
        data.set(extra, base.length + head.length);
        tiles.push({ tileId: zxyToTileId(z, x, y), data });
      }
  }
  const out = buildArchive(tiles, { metadata: { name: 'dev planet' }, bounds: [-180, -85.0511, 180, 85.0511] });
  writeFileSync(file, out);
  console.log(`built ${file}: ${tiles.length} tiles, ${(out.length / 1e6).toFixed(0)} MB`);
}

if (!existsSync(file)) await make();
const size = statSync(file).size;
const etag = `"dev-${size}"`;
let served = 0;

// GET /__outage?ms=N: answer 503 to every range request for N ms (0 ends it), a network failure
// for E2E (map-23 calls it from Maestro: the app's retries give up and the job fails).
let outageUntil = 0;
createServer((req, res) => {
  const outage = /^\/__outage\?ms=(\d+)$/.exec(req.url ?? '');
  if (outage) {
    outageUntil = Date.now() + Number(outage[1]);
    console.log(`outage for ${outage[1]} ms`);
    res.writeHead(204);
    return void res.end();
  }
  if (Date.now() < outageUntil) {
    res.writeHead(503);
    return void res.end();
  }
  const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
  if (!m) {
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    return void res.end();
  }
  const start = Number(m[1]);
  const end = Math.min(Number(m[2]), size - 1);
  const n = ++served;
  setTimeout(() => {
    console.log(`#${n} bytes=${start}-${end}`);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, ETag: etag, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start, end }).pipe(res);
  }, delay);
}).listen(port, '127.0.0.1', () => console.log(`planet stand-in on http://localhost:${port}/20260101.pmtiles (delay ${delay} ms)`));
