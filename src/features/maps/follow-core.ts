// Where the navigation camera looks (like Google Maps' and Waze's driving view): the
// map turns so the way ahead points up, tilts, and zooms out as the speed goes up.
// Also when a trip is over (arrived) or idle, so guidance can let the screen sleep.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { isOffRoute, type Costing, type RouteProgress } from './routing-core.ts';

export type FollowInput = {
  costing: Costing;
  /** GPS course while moving, degrees; null when standing or unknown. */
  course: number | null;
  /** Compass, degrees; null without one. */
  heading: number | null;
  /** Snapped onto the route, when there is one. */
  progress: RouteProgress | null;
  accuracy: number | null;
};

/**
 * The map's bearing. On the route, the route's own direction (steady, and right even
 * while stopped at a light); off it, the GPS course; standing on foot or by bike, the
 * compass (the phone is in the hand; in a car it points anywhere). null: keep the last.
 */
export function followBearing({ costing, course, heading, progress, accuracy }: FollowInput): number | null {
  if (progress && progress.aheadBearing !== null && !isOffRoute(progress.offRouteM, accuracy)) return progress.aheadBearing;
  if (course !== null) return course;
  if (costing !== 'auto' && heading !== null) return heading;
  return null;
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

/** Closer in town, further out on the motorway (speed in m/s). */
export function followZoom(costing: Costing, speed: number | null): number {
  if (costing === 'pedestrian') return 17.5;
  if (costing === 'bicycle') return 17;
  const s = speed ?? 0;
  if (s < 14) return 17; // < 50 km/h
  if (s < 25) return 16; // < 90 km/h
  return 15;
}

export const FOLLOW_PITCH = 45;

/** Smallest turn between two bearings, degrees (0..180). */
export function turnBetween(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}
