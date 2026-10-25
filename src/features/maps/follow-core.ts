// Where the navigation camera looks (like Google Maps' and Waze's driving view): the
// map turns so the way ahead points up, tilts, and zooms out as the speed goes up.
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
