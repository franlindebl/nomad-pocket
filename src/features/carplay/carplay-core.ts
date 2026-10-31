// What the car's screen shows, from guidance's state: the maneuver panel, the trip's estimates and
// the preview, in the JSON shapes modules/nomad-carplay decodes (CarPlayHub.swift). Texts come in
// already translated (`text`), so this stays pure TypeScript (no `@/` aliases) for node's tests.
import { hasArrived } from '../maps/follow-core.ts';
import { bearingDegrees, compassSector, distanceMeters, type LatLon } from '../maps/geo.ts';
import { maneuverIcon, remainingSeconds, STRAIGHT_LINE_SPEED, type Costing, type Route, type RouteProgress } from '../maps/routing-core.ts';
import { scaleDistance, type MeasurementSystem } from '../../lib/units.ts';

export type CarDistance = { value: number; unit: 'm' | 'km' | 'ft' | 'yd' | 'mi' };
export type CarEstimate = { distance: CarDistance; seconds: number };
/** rotation: for the straight-line arrow, degrees clockwise from the way the car goes (the map's up). */
export type CarStep = { index: number; icon: string; instruction: string; street: string | null; estimate: CarEstimate; rotation?: number };
export type CarTarget = { name: string; lat: number; lon: number };

export type CarGuidance = {
  target: CarTarget | null;
  navigating: boolean;
  routing: 'none' | 'loading' | 'ready' | 'error';
  routeId: number;
  arrived: boolean;
  summary: CarEstimate | null;
  remaining: CarEstimate | null;
  step: CarStep | null;
  nextStep: CarStep | null;
  note: string | null;
};

export type CarItem = { title: string; detail: string | null; lat: number; lon: number };

/** The texts the car shows (CarStrings in CarPlayHub.swift). */
export type CarStrings = {
  destinations: string;
  search: string;
  saved: string;
  savedEmpty: string;
  emergency: string;
  emergencyEmpty: string;
  searchEmpty: string;
  /** [category id, label], in the order of the list. */
  categories: [string, string][];
  go: string;
  cancel: string;
  end: string;
  rerouting: string;
  arrived: string;
  noLocation: string;
  straightLine: string;
};

export type GuidanceInput = {
  target: CarTarget | null;
  /** travel: the direction of the user's last metres (guidance.ts), course: the GPS one. */
  position: (LatLon & { accuracy: number | null; course?: number | null; travel?: number | null }) | null;
  navigating: boolean;
  routing: CarGuidance['routing'];
  costing: Costing;
  route: Route | null;
  progress: RouteProgress | null;
  routeId: number;
};

/** The street the route spends the longest on ("CG-1"), for the trip preview's "Por la CG-1". */
export function mainRoad(route: Pick<Route, 'maneuvers'>): string | null {
  let best: { street: string; m: number } | null = null;
  for (const m of route.maneuvers) {
    const street = m.streets[0];
    if (street && (!best || m.distanceM > best.m)) best = { street, m: m.distanceM };
  }
  return best?.street ?? null;
}

export type GuidanceText = {
  /** "Hacia el NE, en línea recta" for compass sector 0–7 (geo.ts compassSector). */
  lineTo: (sector: number) => string;
  toll: string;
  ferry: string;
  /** "Por la CG-1" for the route's main road. */
  via: (street: string) => string;
};

/** The maneuver after the next shows too ("then…") when it is at most this far after it. */
export const THEN_WITHIN_M = 200;

/** Index of the straight-line "maneuver": one per compass sector, so the panel changes with it. */
const LINE_INDEX = -100;

export function carDistance(meters: number, system: MeasurementSystem): CarDistance {
  const { value, unit } = scaleDistance(meters, system, 10);
  return { value: Number(value.toFixed(unit === 'km' || unit === 'mi' ? 1 : 0)), unit };
}

const estimate = (meters: number, seconds: number, system: MeasurementSystem): CarEstimate => ({
  distance: carDistance(meters, system),
  seconds: Math.max(0, Math.round(seconds)),
});

export function carGuidance(input: GuidanceInput, system: MeasurementSystem, text: GuidanceText): CarGuidance {
  const { target, position, route, progress } = input;
  const base: CarGuidance = {
    target,
    navigating: input.navigating,
    routing: input.routing,
    routeId: input.routeId,
    arrived: false,
    summary: null,
    remaining: null,
    step: null,
    nextStep: null,
    note: null,
  };
  if (!target) return base;
  const distance = position ? distanceMeters(position, target) : null;
  base.arrived = distance !== null && hasArrived(distance, position?.accuracy ?? null);
  const following = input.routing === 'ready' && route && progress && !(progress.remainingM < 15 && progress.offRouteM < 30);
  if (input.routing === 'ready' && route) {
    base.summary = estimate(route.distanceM, route.durationS, system);
    const via = mainRoad(route);
    base.note = [via ? text.via(via) : null, route.hasToll ? text.toll : null, route.hasFerry ? text.ferry : null].filter(Boolean).join(' · ') || null;
  }
  if (following && route && progress) {
    base.remaining = estimate(progress.remainingM, remainingSeconds(route, progress.remainingM), system);
    const m = route.maneuvers[progress.next];
    if (m) {
      base.step = {
        index: progress.next,
        icon: maneuverIcon(m.type),
        instruction: m.instruction,
        street: m.streets[0] ?? null,
        estimate: estimate(progress.toNextM, remainingSeconds(route, progress.toNextM), system),
      };
      // The one after only when it comes close behind (a turn right after a roundabout): on a
      // car screen a second row pushes the trip's arrival time off the panel.
      const after = m.distanceM <= THEN_WITHIN_M ? route.maneuvers[progress.next + 1] : undefined;
      if (after) {
        base.nextStep = {
          index: progress.next + 1,
          icon: maneuverIcon(after.type),
          instruction: after.instruction,
          street: after.streets[0] ?? null,
          estimate: estimate(m.distanceM, m.durationS, system),
        };
      }
    }
    return base;
  }
  // No route (no pack, no way found) or its end before the target: as the crow flies.
  if (distance !== null && position && input.routing !== 'loading') {
    // At the trip's own mode's speed: in a car, not on foot as the phone's "no routes here" note says.
    const speed = STRAIGHT_LINE_SPEED[input.costing];
    const bearing = bearingDegrees(position, target);
    const sector = compassSector(bearing);
    // The arrow points at the target from the way the car goes (the car map turns with it); stopped,
    // from north, as the map is then.
    const up = position.travel ?? position.course ?? 0;
    const turn = compassSector(bearing - up);
    const line = estimate(distance, distance / speed, system);
    base.summary ??= line;
    base.remaining = line;
    base.step = {
      index: LINE_INDEX - turn,
      icon: 'straight-line',
      instruction: text.lineTo(sector),
      street: null,
      estimate: line,
      rotation: turn * 45,
    };
  }
  return base;
}
