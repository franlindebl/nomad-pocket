// When the navigation voice speaks, and the distance it says. Per maneuver: an early
// announcement ("In 500 metres, turn right onto…", Valhalla's transition alert) and the prompt a
// few seconds before it (its pre-transition instruction, which already says "then…" when the next
// one comes close behind). Plus the start instruction when the trip starts. Nothing twice: the
// caller keeps the keys already spoken for the current route.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import type { Costing, Maneuver } from './routing-core.ts';
import type { MeasurementSystem } from '../../lib/units.ts';

export type VoiceManeuver = Pick<Maneuver, 'type' | 'verbal' | 'alert' | 'multiCue'>;

export type Cue = {
  /** Spoken once per route: add it to the caller's set. */
  key: string;
  kind: 'start' | 'early' | 'now';
  /** Into the route's maneuvers. */
  index: number;
  /** What to say: Valhalla's own sentence (early: to put after "In 500 m, "). */
  text: string;
  /** early: how far, metres. */
  distanceM?: number;
};

/** Off the route by more than this, the next prompt may be wrong: wait for the reroute. */
const OFF_ROUTE_M = 60;

/** How far ahead the early announcement comes: further on a fast road. */
export function earlyDistance(costing: Costing, speedMps: number | null): number {
  if (costing === 'pedestrian') return 100;
  if (costing === 'bicycle') return 200;
  const v = speedMps ?? 0;
  return v >= 25 ? 2000 : v >= 16 ? 1000 : 400;
}

/** The prompt itself: about six seconds before by car, a few metres on foot. */
export function nowDistance(costing: Costing, speedMps: number | null): number {
  if (costing === 'pedestrian') return 15;
  if (costing === 'bicycle') return 30;
  return Math.min(250, Math.max(40, (speedMps ?? 0) * 6));
}

const key = (index: number, kind: Cue['kind']) => `${index}:${kind}`;

/** The keys that silence a maneuver already announced (its "now" covers its "early"). */
export function keysOf(cue: Cue): string[] {
  return cue.kind === 'now' ? [cue.key, key(cue.index, 'early')] : [cue.key];
}

/** The key that marks the start as said, for a route that replaced another mid-trip. */
export const START_KEY = key(0, 'start');

/**
 * What to say now, or null. `next` / `toNextM`: routing-core's progress (the next maneuver to
 * perform and how far it is along the route).
 */
export function nextCue(input: {
  maneuvers: VoiceManeuver[];
  next: number;
  toNextM: number;
  offRouteM: number;
  costing: Costing;
  speedMps: number | null;
  spoken: ReadonlySet<string>;
}): Cue | null {
  const { maneuvers, next, toNextM, costing, speedMps, spoken } = input;
  if (input.offRouteM > OFF_ROUTE_M) return null;
  const first = maneuvers[0];
  // The start, only while the first maneuver after it is still the next one.
  if (!spoken.has(START_KEY) && next <= 1 && first?.verbal) return { key: START_KEY, kind: 'start', index: 0, text: first.verbal };
  const m = maneuvers[next];
  if (!m || next === 0) return null;
  const now = nowDistance(costing, speedMps);
  if (toNextM <= now) {
    const k = key(next, 'now');
    return !spoken.has(k) && m.verbal ? { key: k, kind: 'now', index: next, text: m.verbal } : null;
  }
  // Announced already by the previous prompt ("…then turn right"), or too close to the prompt itself.
  if (maneuvers[next - 1]?.multiCue || toNextM < 2 * now) return null;
  const k = key(next, 'early');
  const text = m.alert ?? m.verbal;
  if (spoken.has(k) || !text || toNextM > earlyDistance(costing, speedMps)) return null;
  return { key: k, kind: 'early', index: next, text, distanceM: toNextM };
}

export type SpokenUnit = 'm' | 'km' | 'ft' | 'yd' | 'mi';

const FEET_PER_METER = 3.28084;
const YARDS_PER_METER = 1.09361;
const METERS_PER_MILE = 1609.344;

// toFixed: 3 × 0.1 is 0.30000000000000004.
const roundTo = (v: number, step: number) => Math.max(step, Number((Math.round(v / step) * step).toFixed(2)));

/**
 * A distance the way a voice says it: round numbers ("400 metres", "1.5 kilometres", "0.3 miles",
 * "800 feet"), in the units of the region's road signs.
 */
export function spokenDistance(meters: number, system: MeasurementSystem): { value: number; unit: SpokenUnit } {
  const m = Math.max(0, meters);
  const short = (v: number) => roundTo(v, v >= 300 ? 100 : 50);
  if (system === 'metric') {
    const v = short(m);
    if (v < 1000) return { value: v, unit: 'm' };
    const km = m / 1000;
    return { value: km < 10 ? roundTo(km, 0.5) : Math.round(km), unit: 'km' };
  }
  const miles = m / METERS_PER_MILE;
  if (miles >= 0.2) return { value: miles < 1 ? roundTo(miles, 0.1) : miles < 10 ? roundTo(miles, 0.5) : Math.round(miles), unit: 'mi' };
  return system === 'us' ? { value: short(m * FEET_PER_METER), unit: 'ft' } : { value: short(m * YARDS_PER_METER), unit: 'yd' };
}

/** "Gire a la derecha…" → "gire a la derecha…", to follow "En 400 metros, ". */
export function lowerFirst(text: string): string {
  return text ? text[0].toLocaleLowerCase() + text.slice(1) : text;
}
