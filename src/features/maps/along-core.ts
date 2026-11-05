// What lies along a route, the pure part (docs/ASSISTANT_MAP_PLAN.md, phase 3): the points within a corridor of
// the line with how far along it they are ("gasolineras de camino a Valencia", "¿me da la gasolina?"), and whether
// a route enters an official alert's drawn area ("¿el aviso rojo afecta a mi ruta?").
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import type { LatLon } from './geo.ts';
import { cumulativeDistances } from './routing-core.ts';

export type Along<T> = T & { alongM: number; offM: number };

/** Corridor (m) either side of a route: a short detour by car, a few streets on foot. */
export const CORRIDOR_M = { auto: 2000, bicycle: 600, pedestrian: 300 } as const;

/**
 * The points within `corridorM` of the [lon, lat] line, each with its distance along the route to the nearest
 * point of it and how far off it is, in route order. Points near the start's first metres count too.
 */
export function alongRoute<T extends LatLon>(points: T[], shape: [number, number][], corridorM: number): Along<T>[] {
  if (shape.length < 2) return [];
  const cum = cumulativeDistances(shape);
  const out: Along<T>[] = [];
  for (const p of points) {
    const k = Math.cos((p.lat * Math.PI) / 180);
    let best = Infinity;
    let along = 0;
    for (let i = 1; i < shape.length; i++) {
      const [ax, ay] = [(shape[i - 1][0] - p.lon) * k, shape[i - 1][1] - p.lat];
      const [dx, dy] = [(shape[i][0] - p.lon) * k - ax, shape[i][1] - p.lat - ay];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const off = Math.hypot(ax + t * dx, ay + t * dy) * 111_195;
      if (off < best) {
        best = off;
        along = cum[i - 1] + t * (cum[i] - cum[i - 1]);
      }
    }
    if (best <= corridorM) out.push({ ...p, alongM: along, offM: best });
  }
  return out.sort((a, b) => a.alongM - b.alongM);
}

/** The bbox of a [lon, lat] line grown by `marginM`: what to query the points in. */
export function corridorBox(shape: [number, number][], marginM: number): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of shape) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  const dLat = marginM / 111_195;
  const dLon = marginM / (111_195 * Math.max(0.1, Math.cos((((s + n) / 2) * Math.PI) / 180)));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** A flat [lon, lat…] ring contains a point (alerts-core's rings). */
function inFlatRing(ring: readonly number[], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const yi = ring[i + 1];
    const yj = ring[j + 1];
    if (yi > lat !== yj > lat && lon < ((ring[j] - ring[i]) * (lat - yi)) / (yj - yi) + ring[i]) inside = !inside;
  }
  return inside;
}

/**
 * Where a route first enters any of the rings (metres from its start), or null when it stays out. Checked at the
 * shape's points and every ~200 m between them: a long straight segment may cut a small area's corner.
 */
export function routeEntersRings(shape: [number, number][], rings: readonly (readonly number[])[]): number | null {
  if (!rings.length || !shape.length) return null;
  const cum = cumulativeDistances(shape);
  const inside = (lon: number, lat: number) => rings.some((r) => inFlatRing(r, lat, lon));
  if (inside(shape[0][0], shape[0][1])) return 0;
  for (let i = 1; i < shape.length; i++) {
    const [a, b] = [shape[i - 1], shape[i]];
    const steps = Math.max(1, Math.ceil((cum[i] - cum[i - 1]) / 200));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (inside(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return cum[i - 1] + t * (cum[i] - cum[i - 1]);
    }
  }
  return null;
}

/**
 * With a range ("me quedan 80 km de autonomía"): the last point within it (the stop to make) and whether any point
 * lies beyond it at all. Points must be in route order (alongRoute's output).
 */
export function lastWithin<T extends { alongM: number }>(points: T[], rangeM: number): { last: T | null; beyond: boolean } {
  let last: T | null = null;
  for (const p of points) if (p.alongM <= rangeM) last = p;
  return { last, beyond: points.some((p) => p.alongM > rangeM) };
}

/** The ring as [lon, lat] pairs, closed, for Valhalla's exclude_polygons. */
export function ringPairs(ring: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) out.push([ring[i], ring[i + 1]]);
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out;
}
