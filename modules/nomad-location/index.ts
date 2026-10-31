// JS API of the location module. On Android it is all of location (src/lib/location.android.ts;
// android/…/NomadLocationModule.kt says why); on iOS only the navigation watch, which keeps going
// in the background (src/lib/navigation-watch.ts; ios/NomadLocationModule.swift says why).
import { NativeModule, requireNativeModule, type PermissionResponse } from 'expo-modules-core';
import type { LocationHeadingObject, LocationObject } from 'expo-location';

type NomadLocationEvents = {
  onLocation(event: { watchId: number; location: LocationObject }): void;
  onHeading(event: LocationHeadingObject): void;
  onNavigation(event: { watchId: number; location: LocationObject }): void;
};

declare class NomadLocationNative extends NativeModule<NomadLocationEvents> {
  /** Android only. Granted with approximate location or better. */
  getPermissions(): Promise<PermissionResponse>;
  /** Android only. */
  requestPermissions(): Promise<PermissionResponse>;
  /** Android only. Negative values: no limit. */
  getLastKnown(maxAgeMs: number, requiredAccuracy: number): Promise<LocationObject | null>;
  /** Android only. `accuracy`: an expo-location Accuracy value. Rejects after 30 s without a fix. */
  getCurrent(accuracy: number): Promise<LocationObject>;
  /** Android only. Fixes arrive as onLocation events with this id (paused while the app is in the background). */
  startWatch(id: number, accuracy: number, distanceMeters: number, intervalMs: number): Promise<void>;
  stopWatch(id: number): Promise<void>;
  /** Android only. Rejects without a compass. Readings arrive as onHeading events. */
  startHeading(): Promise<void>;
  stopHeading(): Promise<void>;
  /**
   * Best-accuracy fixes as onNavigation events with this id, also in the background. Android shows
   * the notification `title` / `body` meanwhile (a foreground service); iOS the blue location pill.
   * `automotive`: iOS's activity type (driving vs. on foot or by bike).
   */
  startNavigation(id: number, distanceMeters: number, intervalMs: number, title: string, body: string, automotive: boolean): Promise<void>;
  stopNavigation(id: number): Promise<void>;
}

export default requireNativeModule<NomadLocationNative>('NomadLocation');
