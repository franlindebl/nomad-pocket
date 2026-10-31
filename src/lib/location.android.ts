// Android side of location.ts: the expo-location calls the app makes, with expo-location's types and
// defaults, over modules/nomad-location (no Google Play services). Several watchers of the compass
// share one native listener.
import type { EventSubscription } from 'expo-modules-core';
import type * as Expo from 'expo-location';

import NomadLocation from '../../modules/nomad-location';

export type { LocationHeadingObject, LocationObject, LocationSubscription } from 'expo-location';
export { watchNavigationAsync } from './navigation-watch';

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
} as unknown as typeof Expo.Accuracy;

// expo-location's defaults on Android when a watch gives no interval or distance.
const WATCH_DEFAULTS: Record<number, { distance: number; interval: number }> = {
  1: { distance: 3000, interval: 10_000 },
  2: { distance: 1000, interval: 5000 },
  3: { distance: 100, interval: 3000 },
  4: { distance: 50, interval: 2000 },
  5: { distance: 25, interval: 1000 },
  6: { distance: 0, interval: 500 },
};

export const getForegroundPermissionsAsync: typeof Expo.getForegroundPermissionsAsync = () => NomadLocation.getPermissions();

export const requestForegroundPermissionsAsync: typeof Expo.requestForegroundPermissionsAsync = () => NomadLocation.requestPermissions();

export const getLastKnownPositionAsync: typeof Expo.getLastKnownPositionAsync = (options = {}) =>
  NomadLocation.getLastKnown(options.maxAge ?? -1, options.requiredAccuracy ?? -1);

export const getCurrentPositionAsync: typeof Expo.getCurrentPositionAsync = (options = {}) =>
  NomadLocation.getCurrent(options.accuracy ?? Accuracy.Balanced);

let nextWatchId = 0;
const positionCallbacks = new Map<number, Expo.LocationCallback>();
let positionEvents: EventSubscription | null = null;

export const watchPositionAsync: typeof Expo.watchPositionAsync = async (options, callback) => {
  const id = ++nextWatchId;
  const accuracy = options.accuracy ?? Accuracy.Balanced;
  const defaults = WATCH_DEFAULTS[accuracy] ?? WATCH_DEFAULTS[3];
  positionCallbacks.set(id, callback);
  positionEvents ??= NomadLocation.addListener('onLocation', (e) => positionCallbacks.get(e.watchId)?.(e.location));
  try {
    await NomadLocation.startWatch(id, accuracy, options.distanceInterval ?? defaults.distance, options.timeInterval ?? defaults.interval);
  } catch (e) {
    positionCallbacks.delete(id);
    throw e;
  }
  return {
    remove: () => {
      if (positionCallbacks.delete(id)) NomadLocation.stopWatch(id).catch(() => {});
    },
  };
};

const headingCallbacks = new Set<{ callback: Expo.LocationHeadingCallback }>();
let headingEvents: EventSubscription | null = null;

export const watchHeadingAsync: typeof Expo.watchHeadingAsync = async (callback) => {
  // Listed before the start, so another watcher stopping meanwhile doesn't stop the compass.
  const entry = { callback };
  headingCallbacks.add(entry);
  headingEvents ??= NomadLocation.addListener('onHeading', (h) => headingCallbacks.forEach((c) => c.callback(h)));
  try {
    // Rejects without a compass; starting again while it runs is harmless.
    await NomadLocation.startHeading();
  } catch (e) {
    headingCallbacks.delete(entry);
    throw e;
  }
  return {
    remove: () => {
      if (headingCallbacks.delete(entry) && headingCallbacks.size === 0) NomadLocation.stopHeading().catch(() => {});
    },
  };
};
