// Where the navigation camera looks (like Google Maps' and Waze's driving view): the
// map turns the way the user is going, tilts, and zooms out as the speed goes up and in
// before a turn. The user sits on the route (snapped), and the camera glides to where
// they will be at the next fix, so it moves without stopping and never trails behind.
// Also when a trip is over (arrived) or idle, so guidance can let the screen sleep.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { bearingDegrees, distanceMeters, type LatLon } from './geo.ts';
import { isOffRoute, pointAlong, type Costing, type Route, type RouteProgress } from './routing-core.ts';

/** A GPS fix kept to tell which way the user moved. at: ms. */
export type TrackFix = LatLon & { at: number; accuracy: number | null };

/** Fixes are kept this long: enough to measure the last metres, even walking. */
const TRACK_MS = 30_000;
const TRACK_MAX = 40;
/** A fix worse than this says little about direction. */
const TRACK_ACCURACY_M = 40;
/** The direction of travel is measured over the last this many metres (or the fix's error, if larger). */
const TRAVEL_MIN_M: Record<Costing, number> = { pedestrian: 8, bicycle: 12, auto: 15 };
const TRAVEL_MAX_M = 40;

/** The track with a new fix; old ones drop off. */
export function pushFix(track: TrackFix[], fix: TrackFix): TrackFix[] {
  const kept = track.filter((f) => fix.at - f.at <= TRACK_MS);
  kept.push(fix);
  return kept.length > TRACK_MAX ? kept.slice(kept.length - TRACK_MAX) : kept;
}

/**
 * Which way the user went over their last metres (degrees from north): from the newest
 * good fix back to the first one far enough away to be more than GPS jitter. null while
 * standing (or only bad fixes).
 */
export function travelBearing(track: TrackFix[], costing: Costing): number | null {
  const good = track.filter((f) => f.accuracy === null || f.accuracy <= TRACK_ACCURACY_M);
  const newest = good[good.length - 1];
  if (!newest) return null;
  const need = Math.min(TRAVEL_MAX_M, Math.max(TRAVEL_MIN_M[costing], newest.accuracy ?? 0));
  for (let i = good.length - 2; i >= 0; i--) {
    if (distanceMeters(good[i], newest) >= need) return bearingDegrees(good[i], newest);
  }
  return null;
}

/**
 * The direction the user moves in. A car's GPS course is quick and steady; on foot or by
 * bike the course is noisy at those speeds and the track of the last metres is better.
 */
export function movingBearing(costing: Costing, course: number | null, travel: number | null): number | null {
  return costing === 'auto' ? (course ?? travel) : (travel ?? course);
}

export type FollowInput = {
  /** Direction of travel (movingBearing); null when standing. */
  moving: number | null;
  /** Snapped onto the route, when there is one. */
  progress: RouteProgress | null;
  accuracy: number | null;
};

/** On the route with a direction to read. */
function onRoad(progress: RouteProgress | null, accuracy: number | null): progress is RouteProgress & { roadBearing: number } {
  return !!progress && progress.roadBearing !== null && !isOffRoute(progress.offRouteM, accuracy);
}

/** Going against the route by more than this is going the wrong way. */
const WRONG_WAY_DEG = 120;

/** On the route but moving against it (walked back, missed a U-turn): as good as off it. */
export function isWrongWay(progress: RouteProgress | null, accuracy: number | null, moving: number | null): boolean {
  return moving !== null && onRoad(progress, accuracy) && turnBetween(moving, progress.roadBearing) > WRONG_WAY_DEG;
}

/**
 * The map's bearing. On the route, the road's direction where the user is (steady, and
 * right while stopped at a light), unless they move against it; off it, the way they
 * move. null (standing off the route): keep the last one, the map doesn't follow the
 * compass (the beam under the arrow shows where the phone points).
 */
export function followBearing({ moving, progress, accuracy }: FollowInput): number | null {
  if (onRoad(progress, accuracy) && (moving === null || turnBetween(moving, progress.roadBearing) <= 90)) return progress.roadBearing;
  return moving;
}

/** How fast the map may turn, degrees per second: a GPS jump never spins it. */
const TURN_RATE: Record<Costing, number> = { auto: 90, bicycle: 90, pedestrian: 60 };
/** Smaller turns are noise: the map holds still. */
const TURN_DEADBAND = 2;

/** From one bearing towards another, at most the turn rate allows in `ms`. */
export function smoothTurn(from: number, to: number, ms: number, costing: Costing): number {
  const delta = ((to - from + 540) % 360) - 180;
  if (Math.abs(delta) < TURN_DEADBAND) return from;
  const max = (TURN_RATE[costing] * Math.max(0, ms)) / 1000;
  const step = Math.max(-max, Math.min(max, delta));
  return (from + step + 360) % 360;
}

/** Predict no further than this ahead (a bad speed reading never throws the map away). */
const PREDICT_MAX_M = 60;
/** Slower than this is standing (GPS speed jitters around 0.3 m/s). */
const PREDICT_MIN_SPEED = 0.5;

/** The point `m` metres from `p` towards `bearing` (flat, fine for tens of metres). */
export function offsetMeters(p: LatLon, bearing: number, m: number): LatLon {
  const b = (bearing * Math.PI) / 180;
  const dLat = (m * Math.cos(b)) / 111_320;
  const dLon = (m * Math.sin(b)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lon: p.lon + dLon };
}

export type CenterInput = {
  position: LatLon & { accuracy: number | null; speed?: number | null };
  route: Pick<Route, 'shape'> | null;
  cumulative: number[];
  progress: RouteProgress | null;
  moving: number | null;
  /** Expected time to the next fix, ms. */
  gapMs: number;
};

/**
 * Where the camera glides to: where the user will be when the next fix comes. On the
 * route, further along it (so it goes round corners with the road); off it, straight on.
 * Standing, or no speed: where they are (snapped onto the route when on it).
 */
export function followCenter({ position, route, cumulative, progress, moving, gapMs }: CenterInput): LatLon {
  const speed = position.speed ?? 0;
  const ahead = speed >= PREDICT_MIN_SPEED ? Math.min(PREDICT_MAX_M, (speed * gapMs) / 1000) : 0;
  if (route && progress?.snapped && !isOffRoute(progress.offRouteM, position.accuracy)) {
    const total = cumulative[cumulative.length - 1] ?? 0;
    return (ahead > 0 ? pointAlong(route.shape, cumulative, Math.min(total, progress.alongM + ahead)) : null) ?? progress.snapped;
  }
  if (ahead > 0 && moving !== null) return offsetMeters(position, moving, ahead);
  return { lat: position.lat, lon: position.lon };
}

const ARRIVED_METERS = 20;
/** A worse fix widens the radius up to this, no further (approximate location is kilometres). */
const ARRIVED_MAX_METERS = 50;

/** Close enough to the target to call it arrived, given how good the fix is. */
export function hasArrived(distanceM: number, accuracy: number | null): boolean {
  return distanceM <= Math.max(ARRIVED_METERS, Math.min(accuracy ?? 0, ARRIVED_MAX_METERS));
}

/** Less than this from where the user stood is GPS jitter, not walking on. */
const IDLE_MOVE_METERS = 30;

/** The user moved on from a spot (beyond jitter and the fix's own error). */
export function hasMoved(distanceM: number, accuracy: number | null): boolean {
  return distanceM > Math.max(IDLE_MOVE_METERS, accuracy ?? 0);
}

/** Closer in town, further out on the motorway (speed in m/s), and closer again before a turn. */
export function followZoom(costing: Costing, speed: number | null, toNextM: number | null = null): number {
  if (costing === 'pedestrian') return toNextM !== null && toNextM < 30 ? 18 : 17.5;
  if (costing === 'bicycle') return toNextM !== null && toNextM < 60 ? 17.5 : 17;
  const s = speed ?? 0;
  const base = s < 14 ? 17 : s < 25 ? 16 : 15; // < 50 km/h, < 90 km/h, faster
  // About ten seconds before the maneuver (at least 150 m): the junction shows.
  return toNextM !== null && toNextM < Math.max(150, s * 10) ? Math.min(17.5, base + 0.75) : base;
}

/** Tilted like a driving view; less on foot, where the street around matters more than far ahead. */
export function followPitch(costing: Costing): number {
  return costing === 'auto' ? 45 : costing === 'bicycle' ? 40 : 30;
}

/** Smallest turn between two bearings, degrees (0..180). */
export function turnBetween(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

/** No fix for this long while moving, or one this poor: the arrow greys out (like Google Maps'). */
const WEAK_FIX_MS = 10_000;
const WEAK_ACCURACY_M = 50;
/** Faster than this the user was going somewhere, and fixes should keep coming. */
const WEAK_MOVING_SPEED = 1;

/**
 * The position is too rough to trust, or fixes stopped while the user was moving (a
 * tunnel, no sky). Standing still brings no fixes either (the 3 m distance filter), so an
 * old fix alone isn't a lost signal.
 */
export function isWeakFix(at: number, accuracy: number | null, speed: number | null, now: number): boolean {
  return (accuracy ?? 0) > WEAK_ACCURACY_M || (now - at > WEAK_FIX_MS && (speed ?? 0) > WEAK_MOVING_SPEED);
}
