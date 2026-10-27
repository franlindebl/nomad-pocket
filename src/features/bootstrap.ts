// App startup: database, installed content registry, download queue and
// per-feature initialisation. Each feature exports an `init` that must be
// idempotent and fast (heavy work goes to the background).
import { db } from '@/db';
import { useContent } from '@/features/content/items';
import { showToast } from '@/components/Toast';
import { initDownloads, onDownloadFinished } from '@/features/downloads/manager';
import { whenPrepared } from '@/features/maps/prepare';
import i18n from '@/i18n';

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
    onDownloadFinished((r) => {
      const toast = () => showToast(i18n.t('downloads.finished', { title: r.title }));
      // A map or routing pack is ready once its search and emergency points are in (maps/prepare.ts).
      if (r.kind === 'map' || r.kind === 'route') void whenPrepared().then(toast);
      else toast();
    });
  })();
  return started;
}
