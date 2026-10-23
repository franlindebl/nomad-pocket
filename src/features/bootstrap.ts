// App startup: database, installed content registry, download queue and
// per-feature initialisation. Each feature exports an `init` that must be
// idempotent and fast (heavy work goes to the background).
import { db } from '@/db';
import { useContent } from '@/features/content/items';
import { initDownloads } from '@/features/downloads/manager';

type InitFn = () => void | Promise<void>;
const featureInits: InitFn[] = [];

/** Features call this at module load (imported from src/features/registry.ts). */
export function registerInit(fn: InitFn) {
  featureInits.push(fn);
}

let started: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  if (started) return started;
  started = (async () => {
    // Side-effect imports register feature completion handlers and inits.
    await import('@/features/registry');
    db();
    useContent.getState().refresh();
    for (const fn of featureInits) {
      try {
        await fn();
      } catch (e) {
        console.warn('[bootstrap] feature init failed', e);
      }
    }
    initDownloads();
  })();
  return started;
}
