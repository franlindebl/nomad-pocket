// The zones a registration's 0.1° cell lies in, for the sources that name zones instead of drawing areas
// (docs/ALERTS_PLAN.md, phase 2, "zones table"). Worked out once when a phone registers or moves, and kept on its row:
// - MeteoAlarm: the EMMA_ID regions holding the cell's centre or a corner (data/emma.json.gz, scripts/build-zones.mjs).
// - NWS: the forecast zone, county and fire weather zone of the same five points, from api.weather.gov's /points.
// A cell on a border gets both sides' zones, like drawn areas (better one warning too many than a missed one).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { inRing, type LatLon } from './core.ts';
import { CELL } from './match.ts';

/** The cell's centre and corners. */
export function cellPoints(cell: LatLon): LatLon[] {
  const { lat, lon } = cell;
  const d = CELL;
  return [{ lat: lat + d / 2, lon: lon + d / 2 }, cell, { lat: lat + d, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }];
}

export type EmmaZone = { c: string; b: [number, number, number, number]; r: number[][] };
export type EmmaTable = { scale: number; zones: Record<string, EmmaZone> };

let table: EmmaTable | null = null;

/** The bundled table (next to lib/index.js once deployed; tests pass their own). */
export function emmaTable(): EmmaTable {
  table ??= JSON.parse(gunzipSync(readFileSync(join(__dirname, '..', 'data', 'emma.json.gz'))).toString('utf8')) as EmmaTable;
  return table;
}

/** EMMA_IDs of `country` whose region holds a point of the cell. */
export function emmaZonesOf(cell: LatLon, country: string, t: EmmaTable = emmaTable()): string[] {
  const pts = cellPoints(cell).map((p) => ({ x: Math.round(p.lon * t.scale), y: Math.round(p.lat * t.scale) }));
  const out: string[] = [];
  for (const [code, z] of Object.entries(t.zones)) {
    if (z.c !== country) continue;
    const [w, s, e, n] = z.b;
    const hit = pts.some(({ x, y }) => x >= w && x <= e && y >= s && y <= n && z.r.some((ring) => inRing(ring, y, x)));
    if (hit) out.push(code);
  }
  return out;
}

/** The countries the table has regions for. */
export const emmaCountries = (t: EmmaTable = emmaTable()): Set<string> => new Set(Object.values(t.zones).map((z) => z.c));

const UA = 'NomadPocketAlerts/1.0 (+https://github.com/franlindebl/nomad-pocket)';

/** "https://api.weather.gov/zones/forecast/TXZ213" → "forecast/TXZ213", the form parseNws gives alerts' zones. */
export const nwsZoneKey = (url: unknown): string | null => {
  const m = typeof url === 'string' ? /\/zones\/(\w+)\/(\w+)$/.exec(url) : null;
  return m ? `${m[1]}/${m[2]}` : null;
};

/** NWS zones of the cell (empty when api.weather.gov doesn't know the points: offshore, outside the US). */
export async function nwsZonesOf(cell: LatLon, fetcher: typeof fetch = fetch): Promise<string[]> {
  const found = await Promise.all(
    cellPoints(cell).map(async ({ lat, lon }) => {
      const res = await fetcher(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!res?.ok) return [];
      const p = ((await res.json().catch(() => ({}))) as { properties?: Record<string, unknown> }).properties ?? {};
      return [p.forecastZone, p.county, p.fireWeatherZone].map(nwsZoneKey).filter((z): z is string => !!z);
    }),
  );
  return [...new Set(found.flat())].sort();
}
