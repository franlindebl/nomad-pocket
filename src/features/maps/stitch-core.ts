// Routes across routing packs (docs/ROUTING_ACROSS_PACKS.md): each pack is its own Valhalla
// graph, so a trip between two of them is routed in legs joined at a border crossing, and
// the legs are joined into one route nobody can tell apart from a route inside one pack.
// The crossings come with each pack (<pack>.crossings.tsv, scripts/routing/crossings.py);
// the best one is chosen by adding up the times of every combination (matrices), never
// the first found. Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { distanceMeters, fitBox, type LatLon } from './geo.ts';
import { covers, type Costing, type Coverage, type Route } from './routing-core.ts';

export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

/** Where a road crosses a pack's border. */
export type Crossing = LatLon & {
  cls: RoadClass;
  /** Bearing of travel leaving the pack (degrees). */
  out: number;
  /** Which way traffic may go: a one-way road crosses one way only. */
  dirs: 'both' | 'in' | 'out';
};

/** lat, lon, class, bearing out, both|in|out, ref (crossings.py); bad rows are skipped. */
export function parseCrossings(tsv: string): Crossing[] {
  const out: Crossing[] = [];
  for (const line of tsv.split('\n')) {
    const [lat, lon, cls, bearing, dirs] = line.split('\t');
    const c = { lat: Number(lat), lon: Number(lon), cls: cls as RoadClass, out: Number(bearing), dirs: dirs as Crossing['dirs'] };
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !Number.isFinite(c.out)) continue;
    if (!ROAD_CLASSES.includes(c.cls) || !['both', 'in', 'out'].includes(c.dirs)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Roads a seam may be on (owner, 2026-10-28: main roads, never a track). Bikes and people
 * on foot can't take motorways or most trunk roads, and do fine on smaller ones.
 */
const SEAM_CLASSES: Record<Costing, readonly RoadClass[]> = {
  auto: ['motorway', 'trunk', 'primary', 'secondary'],
  bicycle: ['primary', 'secondary', 'tertiary'],
  pedestrian: ['primary', 'secondary', 'tertiary'],
};

/** A point where one leg ends and the next starts, with the heading of travel there. */
export type Seam = LatLon & { heading: number; cls: RoadClass };

export type StitchPack = Coverage & { id: string; crossings: Crossing[] | null };

/** Two crossings this close with the same heading are one (both sides' files list each road). */
const SAME_SEAM_M = 60;

/**
 * Where a trip can go from pack `a` into pack `b` for a costing: crossings of `a`'s border
 * leaving it (or of `b`'s border entering it, when `a` has no file), inside both coverages.
 */
export function seamsBetween(a: StitchPack, b: StitchPack, costing: Costing): Seam[] {
  const allowed = SEAM_CLASSES[costing];
  const found: Seam[] = [];
  const add = (c: Crossing, heading: number) => {
    if (!allowed.includes(c.cls) || !covers(a, c) || !covers(b, c)) return;
    const h = ((Math.round(heading) % 360) + 360) % 360;
    if (found.some((s) => Math.abs(((s.heading - h + 540) % 360) - 180) < 45 && distanceMeters(s, c) < SAME_SEAM_M)) return;
    found.push({ lat: c.lat, lon: c.lon, heading: h, cls: c.cls });
  };
  for (const c of a.crossings ?? []) if (c.dirs !== 'in') add(c, c.out);
  for (const c of b.crossings ?? []) if (c.dirs !== 'out') add(c, c.out + 180);
  return found;
}

/**
 * The seams worth a matrix: the ones with the smallest straight-line detour between the
 * two points around them. The real choice is by time (bestPath); this only keeps matrices
 * small where a border has hundreds of crossings (a US state line).
 */
export function nearestSeams(seams: Seam[], from: LatLon, to: LatLon, keep: number): Seam[] {
  if (seams.length <= keep) return seams;
  const detour = (s: Seam) => distanceMeters(from, s) + distanceMeters(s, to);
  return seams
    .map((s) => ({ s, d: detour(s) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, keep)
    .map((x) => x.s);
}

/**
 * Chains of installed packs from one that covers `from` to one that covers `to`, each
 * joined to the next by at least one seam; shortest first, at most `maxPacks` long.
 */
export function packChains<P extends StitchPack>(packs: P[], from: LatLon, to: LatLon, costing: Costing, maxPacks = 4): P[][] {
  const ends = new Set(packs.filter((p) => covers(p, to)).map((p) => p.id));
  const linked = new Map<string, P[]>();
  for (const a of packs) linked.set(a.id, packs.filter((b) => b.id !== a.id && seamsBetween(a, b, costing).length > 0));
  const chains: P[][] = [];
  let frontier = packs.filter((p) => covers(p, from)).map((p) => [p]);
  for (let len = 1; len <= maxPacks && frontier.length; len++) {
    const next: P[][] = [];
    for (const chain of frontier) {
      const last = chain[chain.length - 1];
      if (len > 1 && ends.has(last.id)) {
        chains.push(chain);
        continue;
      }
      for (const p of linked.get(last.id) ?? []) if (!chain.includes(p)) next.push([...chain, p]);
    }
    frontier = next;
  }
  return chains;
}

/** Straight-line length of a chain through its best seams, to try the likeliest chains first. */
export function chainEstimate(chain: StitchPack[], from: LatLon, to: LatLon, costing: Costing): number {
  let at = from;
  let total = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const [seam] = nearestSeams(seamsBetween(chain[i], chain[i + 1], costing), at, to, 1);
    if (!seam) return Infinity;
    total += distanceMeters(at, seam);
    at = seam;
  }
  return total + distanceMeters(at, to);
}

/**
 * The cheapest way through layers of matrices: layers[0] is 1×n1 (origin to the first
 * border's seams), then n1×n2 …, the last nk×1 (to the destination); null = no way.
 * Returns the seam index chosen at each border and the total, or null.
 */
export function bestPath(layers: (number | null)[][][]): { picks: number[]; total: number } | null {
  let cost: (number | null)[] = [0];
  const back: number[][] = [];
  for (const m of layers) {
    const width = m[0]?.length ?? 0;
    const next: (number | null)[] = Array(width).fill(null);
    const from: number[] = Array(width).fill(-1);
    m.forEach((row, i) => {
      if (cost[i] == null) return;
      row.forEach((t, j) => {
        if (t == null) return;
        const c = cost[i]! + t;
        if (next[j] == null || c < next[j]!) {
          next[j] = c;
          from[j] = i;
        }
      });
    });
    back.push(from);
    cost = next;
  }
  if (cost.length !== 1 || cost[0] == null) return null;
  const picks: number[] = [];
  let at = 0;
  for (let k = back.length - 1; k > 0; k--) {
    at = back[k][at];
    picks.unshift(at);
  }
  return { picks, total: cost[0] };
}

const isDeparture = (type: number) => type >= 1 && type <= 3;
const isArrival = (type: number) => type >= 4 && type <= 6;

/**
 * One route from legs that meet end to start. At each seam the first leg's "you have
 * arrived" goes and the next leg's "head south on…" folds into the manoeuvre before it:
 * the road goes on across the border, and so does the instruction.
 */
export function joinRoutes(legs: Route[]): Route {
  if (legs.length === 1) return legs[0];
  const shape: [number, number][] = [];
  const maneuvers: Route['maneuvers'] = [];
  for (const [n, leg] of legs.entries()) {
    const offset = Math.max(0, shape.length - 1);
    shape.push(...(shape.length ? leg.shape.slice(1) : leg.shape));
    const own = leg.maneuvers.filter((m, i) => !(n < legs.length - 1 && i === leg.maneuvers.length - 1 && isArrival(m.type)));
    for (const [i, m] of own.entries()) {
      const moved = { ...m, begin: m.begin + offset, end: m.end + offset };
      const prev = maneuvers[maneuvers.length - 1];
      if (n > 0 && i === 0 && isDeparture(m.type) && prev) {
        maneuvers[maneuvers.length - 1] = { ...prev, end: moved.end, distanceM: prev.distanceM + m.distanceM, durationS: prev.durationS + m.durationS };
      } else {
        maneuvers.push(moved);
      }
    }
  }
  // From the legs' corners: a leg's box may run past 180° (fitBox).
  const bbox = fitBox(legs.flatMap((l) => [[l.bbox[0], l.bbox[1]] as const, [l.bbox[2], l.bbox[3]] as const])) ?? legs[0].bbox;
  return {
    costing: legs[0].costing,
    distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    durationS: legs.reduce((s, l) => s + l.durationS, 0),
    shape,
    maneuvers,
    bbox,
    hasToll: legs.some((l) => l.hasToll),
    hasHighway: legs.some((l) => l.hasHighway),
    hasFerry: legs.some((l) => l.hasFerry),
  };
}

// --- Talking to Valhalla ---------------------------------------------------------

type Json = Record<string, unknown>;

/** A seam as a Valhalla location: on that road, going that way (any road class, tunnels too). */
export function seamLocation(seam: Seam): Json {
  return { lat: seam.lat, lon: seam.lon, type: 'break', heading: seam.heading, heading_tolerance: 45 };
}

export function matrixRequest(sources: Json[], targets: Json[], costing: Costing): string {
  return JSON.stringify({ sources, targets, costing });
}

/** Times (s) of a sources_to_targets answer, [source][target]; null where there is no way. */
export function parseMatrix(json: string): (number | null)[][] {
  const rows = (JSON.parse(json) as { sources_to_targets: { time?: number | null }[][] }).sources_to_targets;
  return rows.map((row) => row.map((cell) => (typeof cell.time === 'number' ? cell.time : null)));
}

/**
 * A matrix that survives bad locations: Valhalla fails the whole request when one location
 * can't be used (170/171: outside the pack, an island of the graph), so a failing request is
 * halved along its longer side until the culprits are alone, and they get null.
 */
export async function robustMatrix<L>(
  run: (sources: L[], targets: L[]) => Promise<(number | null)[][]>,
  sources: L[],
  targets: L[],
): Promise<(number | null)[][]> {
  try {
    return await run(sources, targets);
  } catch {
    if (sources.length <= 1 && targets.length <= 1) return sources.map(() => targets.map(() => null));
    if (sources.length >= targets.length) {
      const h = Math.ceil(sources.length / 2);
      return [...(await robustMatrix(run, sources.slice(0, h), targets)), ...(await robustMatrix(run, sources.slice(h), targets))];
    }
    const h = Math.ceil(targets.length / 2);
    const [left, right] = [await robustMatrix(run, sources, targets.slice(0, h)), await robustMatrix(run, sources, targets.slice(h))];
    return left.map((row, i) => [...row, ...right[i]]);
  }
}
