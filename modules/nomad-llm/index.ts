// JS API of the system-model bridge (Apple Foundation Models / Gemini Nano).
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

export function cancel(requestId: string) {
  NomadLlm?.cancel(requestId);
}

export async function downloadSystemModel(onProgress?: (done: number, total: number) => void): Promise<boolean> {
  if (!NomadLlm) return false;
  const sub = onProgress
    ? NomadLlm.addListener('onDownloadProgress', (e) => {
        try {
          // Longs may arrive as BigInt.
          onProgress(Number(e.bytesDownloaded), Number(e.totalBytes));
        } catch {
          // never throw from a native event
        }
      })
    : null;
  try {
    return await NomadLlm.downloadSystemModel();
  } finally {
    sub?.remove();
  }
}
