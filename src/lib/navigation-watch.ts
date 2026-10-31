// The GPS watch of a trip in progress, on both platforms: like watchPositionAsync, but it keeps
// going with the screen locked or the app in the background (and with only CarPlay on screen), so
// guidance and its voice go on. modules/nomad-location does it: an iOS location manager allowed to
// run in the background, an Android foreground service with a notification.
import type { EventSubscription } from 'expo-modules-core';
import type { LocationCallback, LocationSubscription } from 'expo-location';

import NomadLocation from '../../modules/nomad-location';

let nextId = 0;
const callbacks = new Map<number, LocationCallback>();
let events: EventSubscription | null = null;

export async function watchNavigationAsync(
  options: { distanceInterval: number; timeInterval: number; automotive: boolean; notice: { title: string; body: string } },
  callback: LocationCallback,
): Promise<LocationSubscription> {
  const id = ++nextId;
  callbacks.set(id, callback);
  events ??= NomadLocation.addListener('onNavigation', (e) => callbacks.get(e.watchId)?.(e.location));
  try {
    await NomadLocation.startNavigation(id, options.distanceInterval, options.timeInterval, options.notice.title, options.notice.body, options.automotive);
  } catch (e) {
    callbacks.delete(id);
    throw e;
  }
  return {
    remove: () => {
      if (callbacks.delete(id)) NomadLocation.stopNavigation(id).catch(() => {});
    },
  };
}
