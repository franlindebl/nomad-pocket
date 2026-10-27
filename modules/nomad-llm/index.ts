// JS API of the system-model bridge (Apple Foundation Models, and the on-device dictation check). iOS only: Android has no
// system model in this app. Gemini Nano is reachable only through Google's proprietary
// ML Kit GenAI library, which can't ship inside this GPL-3 APK (next to libkiwix) and sends
// usage data to Google; Android users get the downloadable GGUF models instead.
import NomadLlm from './src/NomadLlmModule';
import type { GenerateOptions, RouteDecision, SystemModelInfo } from './src/NomadLlm.types';

export * from './src/NomadLlm.types';

export const isNativeModuleLinked = NomadLlm != null;

export async function getSystemModelStatus(): Promise<SystemModelInfo> {
  if (!NomadLlm) return { status: 'unsupported', provider: null, detail: 'native module not linked' };
  try {
    return await NomadLlm.getSystemModelStatus();
  } catch (e) {
    return { status: 'unsupported', provider: null, detail: String((e as Error)?.message ?? e) };
  }
}

/**
 * Streams a generation. `onDelta` receives incremental text; the promise
 * resolves with the full text (partial if cancelled) or rejects on error.
 */
export function generate(requestId: string, options: GenerateOptions, onDelta: (delta: string, reset: boolean) => void): Promise<string> {
  const mod = NomadLlm;
  if (!mod) return Promise.reject(new Error('System model not available'));
  return new Promise<string>((resolve, reject) => {
    const subs = [
      mod.addListener('onDelta', (e) => {
        if (e.requestId !== requestId) return;
        try {
          onDelta(e.delta, !!e.reset);
        } catch (err) {
          console.warn('[nomad-llm] onDelta handler failed', err);
        }
      }),
      mod.addListener('onDone', (e) => {
        if (e.requestId !== requestId) return;
        cleanup();
        resolve(e.text);
      }),
      mod.addListener('onError', (e) => {
        if (e.requestId !== requestId) return;
        cleanup();
        reject(Object.assign(new Error(e.message), { code: e.code }));
      }),
    ];
    function cleanup() {
      subs.forEach((s) => s.remove());
    }
    mod.generate(requestId, options).catch((e: unknown) => {
      cleanup();
      reject(e);
    });
  });
}

/** Apple Foundation Models only: whether a message needs a library search (guided generation). */
export async function route(prompt: string, instructions: string): Promise<RouteDecision> {
  if (!NomadLlm) throw new Error('System model not available');
  const r = await NomadLlm.route(prompt, instructions);
  return { search: !!r.search, query: String(r.query ?? '') };
}

/** iOS only: whether dictation in `locale` stays on the device (false where the module isn't linked). */
export function supportsOnDeviceDictation(locale: string): boolean {
  try {
    return NomadLlm?.supportsOnDeviceDictation(locale) ?? false;
  } catch {
    return false;
  }
}

export function cancel(requestId: string) {
  NomadLlm?.cancel(requestId);
}
