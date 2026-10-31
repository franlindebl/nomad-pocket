// JS API of the CarPlay screen (iOS only). Only src/features/carplay imports it; the native side's
// files say how the car and JS share the work (ios/NomadCarPlayModule.swift).
import { requireOptionalNativeModule } from 'expo';
import type { NativeModule } from 'expo-modules-core';

type NomadCarPlayEvents = {
  onConnect(): void;
  onDisconnect(): void;
  /** The car wants list items: answer(id, items). */
  /** lat/lon: where the car map has the user, when it knows. */
  onRequest(e: { id: number; kind: 'saved' | 'emergency' | 'search'; category?: string; query?: string; lat?: number; lon?: number }): void;
  /** A destination chosen in the car. */
  onPick(e: { name: string; lat: number; lon: number }): void;
  /** "Ir" in the car's trip preview. */
  onStart(): void;
  /** "Finalizar" / "Cancelar" in the car, or the system ended the trip. */
  onEnd(): void;
};

declare class NomadCarPlayNative extends NativeModule<NomadCarPlayEvents> {
  isConnected(): boolean;
  /** JSON: carplay-core's CarStrings. */
  setStrings(json: string): Promise<void>;
  /** Style JSON for the car's light and dark appearance. */
  setStyles(light: string, dark: string): Promise<void>;
  /** [lon, lat] along the route; empty for none. */
  setRoute(shape: [number, number][]): Promise<void>;
  /** JSON: carplay-core's CarGuidance. */
  update(json: string): Promise<void>;
  /** A message on the car's screen with one button that closes it. */
  alert(message: string, button: string): Promise<void>;
  /** JSON: carplay-core's CarItem[]. */
  answer(id: number, json: string): Promise<void>;
}

/** null where there is no CarPlay (Android, or a build without the module). */
export default requireOptionalNativeModule<NomadCarPlayNative>('NomadCarPlay');
