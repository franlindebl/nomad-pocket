// What the car's screen shows, from guidance's state: the maneuver panel, the trip's estimates and
// the preview, in the JSON shapes modules/nomad-carplay decodes (CarPlayHub.swift). Texts come in
// already translated (`text`), so this stays pure TypeScript (no `@/` aliases) for node's tests.
import { hasArrived, type FollowFrame } from '../maps/follow-core.ts';
import { bearingDegrees, compassSector, distanceMeters, type LatLon } from '../maps/geo.ts';
import { maneuverIcon, remainingSeconds, speedLimitAt, STRAIGHT_LINE_SPEED, type Costing, type Route, type RouteProgress } from '../maps/routing-core.ts';
import { scaleDistance, scaleSpeed, scaleSpeedLimit, type MeasurementSystem } from '../../lib/units.ts';

export type CarDistance = { value: number; unit: 'm' | 'km' | 'ft' | 'yd' | 'mi' };
export type CarEstimate = { distance: CarDistance; seconds: number };
/**
 * rotation: for the straight-line arrow, degrees clockwise from the way the car goes (the map's up).
 * variants: what the car's card says, most preferred first, shorter fallbacks after (CarPlay shows the
 * first that fits, nothing when none does). maneuverType: CarPlay's CPManeuverType (cpManeuverType).
 */
export type CarStep = {
  index: number;
  icon: string;
  instruction: string;
  street: string | null;
  estimate: CarEstimate;
  rotation?: number;
  variants: string[];
  maneuverType: number;
};
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
  /**
   * Navigating on a route: where the user is on it (`segment` of the shape, the snapped point), so
   * the car cuts the travelled part off where the phone does.
   */
  cut: CarCut | null;
  /** Navigating: the camera's next move (follow-core's, the phone's own), only with a new fix. */
  camera?: CarCamera | null;
  /** Navigating: the speed badge (the phone's SpeedBadge). */
  speed: CarSpeed | null;
};

/** The GPS speed and, by car, the posted limit where the user is, in the region's units; over: past the limit. */
export type CarSpeed = { value: number; unit: 'km/h' | 'mph'; limit: number | null; over: boolean };

export type CarCut = { segment: number; lat: number; lon: number };
/** follow-core's FollowFrame, flat. bearing null: keep the map's. duration: ms. */
export type CarCamera = { lat: number; lon: number; zoom: number; pitch: number; bearing: number | null; duration: number; first: boolean };

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
  /** Leaves the pan arrows. */
  done: string;
  end: string;
  rerouting: string;
  arrived: string;
  noLocation: string;
  straightLine: string;
};

export type GuidanceInput = {
  target: CarTarget | null;
  /** travel: the direction of the user's last metres (guidance.ts), course: the GPS one. */
  position: (LatLon & { accuracy: number | null; course?: number | null; travel?: number | null; speed?: number | null }) | null;
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
  /** "4.ª salida" for a roundabout's exit. */
  exit: (n: number) => string;
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
    cut: null,
    speed: null,
  };
  if (!target) return base;
  if (input.navigating) base.speed = carSpeed(input, system);
  if (input.navigating && route && progress?.snapped) base.cut = { segment: progress.segment, lat: progress.snapped.lat, lon: progress.snapped.lon };
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
        variants: cardVariants(m, text),
        maneuverType: cpManeuverType(m.type, m.exit),
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
          variants: cardVariants(after, text),
          maneuverType: cpManeuverType(after.type, after.exit),
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
      variants: [text.lineTo(sector)],
      maneuverType: CP_STRAIGHT,
    };
  }
  return base;
}

/**
 * The card's text, short like Apple Maps' and Waze's: the street (the arrow says which way; the whole
 * "Gire a la izquierda hacia…" made the card three lines tall), a roundabout's exit ("4.ª salida ·
 * CG-2", then "4.ª salida"), the sentence where it says more than a street (arriving: which side) or
 * there is no street.
 */
export function cardVariants(m: Pick<Route['maneuvers'][number], 'type' | 'instruction' | 'streets' | 'exit'>, text: Pick<GuidanceText, 'exit'>): string[] {
  const street = m.streets[0] || null;
  const icon = maneuverIcon(m.type);
  if (icon === 'roundabout' && m.exit) {
    const exit = text.exit(m.exit);
    return street ? [`${exit} · ${street}`, exit] : [exit];
  }
  if (icon === 'arrive' || icon === 'start' || !street) return street && street !== m.instruction ? [m.instruction, street] : [m.instruction];
  return [street];
}

const CP_STRAIGHT = 3;
/** Valhalla's maneuver type → CarPlay's CPManeuverType (iOS 17.4), which the car can draw and read itself. */
export function cpManeuverType(valhalla: number, exit: number | null): number {
  switch (valhalla) {
    case 1:
    case 2:
    case 3:
      return 11; // start route
    case 4:
      return 12; // arrive
    case 5:
      return 25; // arrive, destination on the right
    case 6:
      return 24; // on the left
    case 9:
      return 50; // slight right
    case 10:
      return 2;
    case 11:
      return 48; // sharp right
    case 12:
    case 13:
      return 4; // U-turn
    case 14:
      return 47; // sharp left
    case 15:
      return 1;
    case 16:
      return 49; // slight left
    case 17:
    case 18:
    case 19:
      return 9; // on ramp
    case 20:
      return 23; // highway off ramp right
    case 21:
      return 22; // left
    case 23:
      return 14; // keep right
    case 24:
      return 13; // keep left
    case 25:
      return 51; // change highway (merge)
    case 37:
      return 53;
    case 38:
      return 52;
    case 26:
      return exit && exit >= 1 && exit <= 19 ? 27 + exit : 6; // roundabout exit N, else enter roundabout
    case 27:
      return 7; // exit roundabout
    case 28:
      return 15; // enter ferry
    case 29:
      return 16; // exit ferry
    default:
      return CP_STRAIGHT;
  }
}

/**
 * As the phone's SpeedBadge: by car or bike (never on foot, it wanders at walking pace), the limit by car
 * only, from the route's limits where the user is on it. null without a speed (iOS gives -1 on a rough fix).
 */
export function carSpeed(input: Pick<GuidanceInput, 'position' | 'costing' | 'route' | 'progress'>, system: MeasurementSystem): CarSpeed | null {
  const mps = input.position?.speed;
  if (input.costing === 'pedestrian' || mps == null || mps < 0) return null;
  const now = scaleSpeed(mps, system);
  const kmh = input.costing === 'auto' && input.route && input.progress ? speedLimitAt(input.route.limits, input.progress.segment) : null;
  const limit = kmh === null ? null : scaleSpeedLimit(kmh, system);
  return { value: now.value, unit: now.unit, limit, over: limit !== null && now.value > limit };
}

/** A follow-core frame in the car's JSON shape. */
export function carCamera(frame: FollowFrame): CarCamera {
  return {
    lat: frame.center.lat,
    lon: frame.center.lon,
    zoom: frame.zoom,
    pitch: frame.pitch,
    bearing: frame.bearing,
    duration: Math.round(frame.duration),
    first: frame.first,
  };
}
