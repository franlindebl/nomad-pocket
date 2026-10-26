// "Take me there": GPS position and compass heading while a target is set. With a
// routing pack covering both ends the way follows roads (Valhalla on the device:
// next maneuver, remaining distance, reroute when the user leaves the route);
// without one it falls back to a straight line, which works anywhere.
// Keep-awake holds for the whole app, so a trip nobody ended kept the screen, GPS and
// compass on for hours: guidance ends by itself a minute after arriving, and keeps the
// screen awake only while the Maps tab is in front and the user is on the move.
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Alert, Linking } from 'react-native';
import { create } from 'zustand';

import i18n from '@/i18n';

import { hasArrived, hasMoved } from './follow-core';
import { distanceMeters, type LatLon } from './geo';
import { watchScreenHeading } from './heading';
import { computeRoute, packFor, RoutingError } from './routing';
import { cumulativeDistances, isOffRoute, routeProgress, type Costing, type Route, type RouteProgress } from './routing-core';

export type GuidanceTarget = LatLon & { name: string };

/** none: no pack covers the trip (straight line). error: the engine found no way. */
export type RoutingStatus = 'none' | 'loading' | 'ready' | 'error';

/** course: GPS direction of travel while moving (degrees), else null. speed: m/s. */
type Position = LatLon & { accuracy: number | null; course?: number | null; speed?: number | null };

type GuidanceState = {
  target: GuidanceTarget | null;
  position: Position | null;
  /** Degrees clockwise from true north (magnetic when true north is unavailable), of the screen's top. */
  heading: number | null;
  costing: Costing;
  routing: RoutingStatus;
  route: Route | null;
  /** Why routing failed (RoutingError kind), for the panel's message. */
  routeError: string | null;
  progress: RouteProgress | null;
  /** "Iniciar" pressed: the navigation view (compact panel, camera following). */
  navigating: boolean;
  start: (target: GuidanceTarget) => Promise<boolean>;
  startNavigation: () => void;
  setCosting: (costing: Costing) => void;
  /** A routing pack was installed: try roads again if guidance is on a straight line. */
  retryRoute: () => void;
  /** The Maps tab came to the front or left it (a sheet over the map keeps it in front). */
  setMapFocused: (focused: boolean) => void;
  stop: () => void;
};

const KEEP_AWAKE_TAG = 'maps-guidance';
/** Don't reroute more often than this, whatever the GPS does. */
const REROUTE_MS = 10_000;
/** Arrived and still there after this: guidance ends (the panel says so meanwhile). */
const ARRIVED_STOP_MS = 60_000;
/** Not moving on for this long (a rest, a shelter, no GPS signal): the screen may sleep again. */
const IDLE_MS = 10 * 60_000;
let gps: Location.LocationSubscription | null = null;
/** The compass watcher (it starts asynchronously); only while the Maps tab is in front. */
let compass: Promise<{ remove: () => void }> | null = null;
/** Bumped by every start/stop, so a slow start that was superseded cleans up after itself. */
let session = 0;
/** Bumped by every route request: a late answer for an older request is dropped. */
let request = 0;
let cumulative: number[] = [];
let lastRouteAt = 0;
let offRouteFixes = 0;
/** GPS course while moving (degrees), else null. */
let course: number | null = null;
/** A last-known fix older than this is not a starting point (it may be another town). */
const STALE_FIX_MS = 2 * 60_000;
let arrivalTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Where the user stood when the idle countdown last restarted. */
let idleAnchor: Position | null = null;
let idle = false;
let mapFocused = true;
let awake = false;

function stopCompass() {
  const pending = compass;
  compass = null;
  pending?.then((s) => s.remove()).catch(() => {});
}

function unsubscribe() {
  try {
    gps?.remove();
  } catch {
    // already removed
  }
  gps = null;
  stopCompass();
  if (arrivalTimer) clearTimeout(arrivalTimer);
  if (idleTimer) clearTimeout(idleTimer);
  arrivalTimer = idleTimer = null;
}

export const useGuidance = create<GuidanceState>((set, get) => {
  /** (Re)computes the route from the current position; keeps the old one on screen meanwhile. */
  async function requestRoute() {
    const { target, position, costing, heading, route } = get();
    if (!target || !position) return;
    lastRouteAt = Date.now();
    if (!packFor(position, target)) {
      // Left the pack's area mid-trip: the route we have is still the best guide.
      if (!route) set({ routing: 'none', progress: null, routeError: null });
      return;
    }
    const mine = ++request;
    offRouteFixes = 0;
    set({ routing: route ? 'ready' : 'loading', routeError: null });
    try {
      // Start the way the user moves (GPS course); the compass only on foot or by bike,
      // where the phone is in the hand (in a car it points anywhere).
      const startHeading = course ?? (costing === 'auto' ? null : heading);
      const next = await computeRoute(position, target, costing, startHeading, !!route);
      if (mine !== request) return;
      cumulative = cumulativeDistances(next.shape);
      set({ route: next, routing: 'ready', progress: routeProgress(next, cumulative, get().position ?? position) });
    } catch (e) {
      if (mine !== request) return;
      const kind = e instanceof RoutingError ? e.kind : 'other';
      console.warn('[maps] routing failed', e);
      // A failed reroute (walked off the road, a moment off the map) keeps the old route.
      if (get().route) set({ routing: 'ready' });
      else set({ progress: null, routing: kind === 'noPack' ? 'none' : 'error', routeError: kind });
    }
  }

  function onPosition(position: Position) {
    const { route, progress, routing } = get();
    if (!route) {
      set({ position });
      // On the straight line: try roads again now and then (back on a road, a fresh fix
      // after a stale first one, a pack that now covers where the user is).
      if ((routing === 'none' || routing === 'error') && Date.now() - lastRouteAt > REROUTE_MS) requestRoute();
      return;
    }
    const next = routeProgress(route, cumulative, position, progress?.segment ?? 0);
    set({ position, progress: next });
    // Two fixes in a row off the route, so one GPS jump doesn't trigger it.
    offRouteFixes = isOffRoute(next.offRouteM, position.accuracy) ? offRouteFixes + 1 : 0;
    if (offRouteFixes >= 2 && Date.now() - lastRouteAt > REROUTE_MS) requestRoute();
  }

  /** The screen stays on only for a trip in progress, on the Maps tab, while moving. */
  function syncAwake() {
    const want = !!get().target && mapFocused && !idle;
    if (want === awake) return;
    awake = want;
    if (want) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }

  function startCompass(mine: number) {
    if (compass) return;
    const pending = watchScreenHeading((h) => {
      if (session === mine) set({ heading: h.deg });
    });
    compass = pending;
    // No compass (some emulators): the panel falls back to a north-up arrow.
    pending.catch((e) => {
      console.warn('[maps] guidance compass', e);
      if (compass === pending) compass = null;
    });
  }

  function armIdle(mine: number) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (session !== mine) return;
      idle = true;
      syncAwake();
    }, IDLE_MS);
  }

  /** Every fix: arriving ends guidance a minute later; moving on keeps the screen awake. */
  function watchProgress(p: Position, mine: number) {
    const { target } = get();
    if (!target) return;
    if (!hasArrived(distanceMeters(p, target), p.accuracy)) {
      if (arrivalTimer) clearTimeout(arrivalTimer);
      arrivalTimer = null;
    } else if (!arrivalTimer) {
      // Standing still brings no more fixes (distanceInterval): a timer, not the next fix.
      arrivalTimer = setTimeout(() => {
        arrivalTimer = null;
        if (session === mine) get().stop();
      }, ARRIVED_STOP_MS);
    }
    if (!idleAnchor || hasMoved(distanceMeters(idleAnchor, p), p.accuracy)) {
      idleAnchor = p;
      armIdle(mine);
      if (idle) {
        idle = false;
        syncAwake();
      }
    }
  }

  return {
    target: null,
    position: null,
    heading: null,
    costing: 'auto',
    routing: 'none',
    route: null,
    routeError: null,
    progress: null,
    navigating: false,
    start: async (target) => {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return false;
      unsubscribe();
      const mine = ++session;
      request++;
      cumulative = [];
      lastRouteAt = 0;
      idle = false;
      idleAnchor = null;
      // Never start from the previous session's fix or route.
      set({ target, position: null, heading: null, route: null, progress: null, routing: 'loading', routeError: null, navigating: false });
      syncAwake();
      // No fix at all for that long (indoors, no signal) also lets the screen sleep.
      armIdle(mine);
      if (mapFocused) startCompass(mine);
      let routed = false;
      const firstFix = (p: Position) => {
        set({ position: p });
        watchProgress(p, mine);
        if (!routed && session === mine) {
          routed = true;
          requestRoute();
        }
      };
      course = null;
      const last = await Location.getLastKnownPositionAsync({ maxAge: STALE_FIX_MS }).catch(() => null);
      if (last && session === mine && Date.now() - last.timestamp < STALE_FIX_MS)
        firstFix({ lat: last.coords.latitude, lon: last.coords.longitude, accuracy: last.coords.accuracy });
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 2000 },
          (p) => {
            if (session !== mine) return;
            course = (p.coords.speed ?? 0) > 2 && (p.coords.heading ?? -1) >= 0 ? p.coords.heading : null;
            const speed = p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed : null;
            const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, course, speed };
            if (!routed) firstFix(fix);
            else {
              onPosition(fix);
              watchProgress(fix, mine);
            }
          },
        );
        // stop() or another start() may have run while the watcher was starting.
        if (session === mine) gps = sub;
        else sub.remove();
      } catch (e) {
        console.warn('[maps] guidance GPS', e);
      }
      return true;
    },
    startNavigation: () => {
      if (get().target) set({ navigating: true });
    },
    setCosting: (costing) => {
      if (costing === get().costing) return;
      set({ costing, route: null, progress: null });
      cumulative = [];
      if (get().target && get().position) {
        set({ routing: 'loading' });
        requestRoute();
      }
    },
    retryRoute: () => {
      const { target, position, routing } = get();
      if (target && position && (routing === 'none' || routing === 'error')) {
        set({ routing: 'loading' });
        requestRoute();
      }
    },
    setMapFocused: (focused) => {
      if (focused === mapFocused) return;
      mapFocused = focused;
      syncAwake();
      // The compass only feeds the panel and the camera, both on the map.
      if (!get().target) return;
      if (focused) startCompass(session);
      else stopCompass();
    },
    stop: () => {
      session++;
      request++;
      unsubscribe();
      cumulative = [];
      set({ target: null, position: null, heading: null, route: null, progress: null, routing: 'none', routeError: null, navigating: false });
      syncAwake();
    },
  };
});

/** start() for a "take me there" button: without location access, says why nothing happens and offers Settings. */
export async function startGuidance(target: GuidanceTarget): Promise<boolean> {
  const ok = await useGuidance.getState().start(target);
  if (!ok) {
    Alert.alert(i18n.t('maps:guidance.deniedTitle'), i18n.t('maps:guidance.deniedBody'), [
      { text: i18n.t('common:actions.cancel'), style: 'cancel' },
      { text: i18n.t('maps:location.openSettings'), onPress: () => Linking.openSettings() },
    ]);
  }
  return ok;
}
