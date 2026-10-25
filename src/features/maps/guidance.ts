// "Take me there" in a straight line: GPS position and compass heading while a
// target is set, so the map can draw the line and the panel can point the way.
// Works anywhere, with or without map data (no routing involved).
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { create } from 'zustand';

import type { LatLon } from './geo';

export type GuidanceTarget = LatLon & { name: string };

type GuidanceState = {
  target: GuidanceTarget | null;
  position: (LatLon & { accuracy: number | null }) | null;
  /** Degrees clockwise from true north (magnetic when true north is unavailable). */
  heading: number | null;
  start: (target: GuidanceTarget) => Promise<boolean>;
  stop: () => void;
};

const KEEP_AWAKE_TAG = 'maps-guidance';
let subscriptions: Location.LocationSubscription[] = [];
/** Bumped by every start/stop, so a slow start that was superseded cleans up after itself. */
let session = 0;

function remove(subs: Location.LocationSubscription[]) {
  for (const s of subs) {
    try {
      s.remove();
    } catch {
      // already removed
    }
  }
}

function unsubscribe() {
  remove(subscriptions);
  subscriptions = [];
}

export const useGuidance = create<GuidanceState>((set) => ({
  target: null,
  position: null,
  heading: null,
  start: async (target) => {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return false;
    unsubscribe();
    const mine = ++session;
    // Never start from the previous session's fix.
    set({ target, position: null, heading: null });
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last && session === mine)
      set({ position: { lat: last.coords.latitude, lon: last.coords.longitude, accuracy: last.coords.accuracy } });
    const subs: Location.LocationSubscription[] = [];
    try {
      subs.push(
        await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 2000 }, (p) =>
          set({ position: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy } }),
        ),
      );
      subs.push(
        await Location.watchHeadingAsync((h) => {
          const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (heading >= 0) set({ heading });
        }),
      );
    } catch (e) {
      // No compass (some emulators): the panel falls back to a north-up arrow.
      console.warn('[maps] guidance sensors', e);
    }
    // stop() or another start() may have run while the watchers were starting.
    if (session === mine) subscriptions = subs;
    else remove(subs);
    return true;
  },
  stop: () => {
    session++;
    unsubscribe();
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    set({ target: null, position: null, heading: null });
  },
}));
