// JS API of the push module. Android only: FCM registration through the phone's own Play services, written without
// Firebase or Play services code (docs/ALERTS_PLAN.md, "Android: FCM over IPC"). On iOS the module doesn't exist
// (APNs tokens come from expo-notifications).
import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

type NomadPushEvents = {
  onMessage(event: { messageId: string | null; latencyMs: number | null }): void;
};

declare class NomadPushNative extends NativeModule<NomadPushEvents> {
  /** Play services' version code, or null without Play services (no FCM on that phone). */
  playServicesVersion(): number | null;
  /** Rejects with the Play services error (SERVICE_NOT_AVAILABLE, TIMEOUT, …). `path`: which IPC route answered. */
  register(projectId: string, projectNumber: string, appId: string, apiKey: string): Promise<{ token: string; fid: string; path: string }>;
}

export default requireOptionalNativeModule<NomadPushNative>('NomadPush');
