import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

import type { GenerateOptions, NomadLlmEvents, RouteDecision, SystemModelInfo } from './NomadLlm.types';

declare class NomadLlmNative extends NativeModule<NomadLlmEvents> {
  getSystemModelStatus(): Promise<SystemModelInfo>;
  /** Resolves with the full text once generation ends (also emits onDelta/onDone/onError). */
  generate(requestId: string, options: GenerateOptions): Promise<string>;
  cancel(requestId: string): void;
  /** Asks the model, with guided generation, whether a message needs a library search. */
  route(prompt: string, instructions: string): Promise<RouteDecision>;
}

/**
 * Null when the native module is not linked: always on Android (the module is iOS-only,
 * see index.ts), on web and on an old dev client.
 */
export default requireOptionalNativeModule<NomadLlmNative>('NomadLlm');
