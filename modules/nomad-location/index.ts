// JS API of the Android location module (Android only: iOS uses expo-location). Only
// src/lib/location.android.ts imports it; android/…/NomadLocationModule.kt says why it exists.
import { NativeModule, requireNativeModule, type PermissionResponse } from 'expo-modules-core';
import type { LocationHeadingObject, LocationObject } from 'expo-location';

type NomadLocationEvents = {
  onLocation(event: { watchId: number; location: LocationObject }): void;
  onHeading(event: LocationHeadingObject): void;
};

declare class NomadLocationNative extends NativeModule<NomadLocationEvents> {
  /** Granted with approximate location or better. */
  getPermissions(): Promise<PermissionResponse>;
  requestPermissions(): Promise<PermissionResponse>;
  /** Negative values: no limit. */
  getLastKnown(maxAgeMs: number, requiredAccuracy: number): Promise<LocationObject | null>;
  /** `accuracy`: an expo-location Accuracy value. Rejects after 30 s without a fix. */
  getCurrent(accuracy: number): Promise<LocationObject>;
  /** Fixes arrive as onLocation events with this id (paused while the app is in the background). */
  startWatch(id: number, accuracy: number, distanceMeters: number, intervalMs: number): Promise<void>;
  stopWatch(id: number): Promise<void>;
  /** Rejects without a compass. Readings arrive as onHeading events. */
  startHeading(): Promise<void>;
  stopHeading(): Promise<void>;
}

export default requireNativeModule<NomadLocationNative>('NomadLocation');
