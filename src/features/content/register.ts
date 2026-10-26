// Content wiring: at startup, installed items whose file is gone are dropped (reconcile-core.ts).
// After an iPhone is restored from a backup the items rows come back but Documents/content does
// not, and Home, the catalog buttons, countries and the assistant would all say "ready" offline.
// Dropping the rows through removeItem runs each kind's removal hook (search rows, emergency
// points, the selected model…), so every screen offers the download again.
import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import { showToast } from '@/components/Toast';
import { registerInit } from '@/features/bootstrap';
import i18n from '@/i18n';
import { contentFile } from '@/lib/storage';

import { getItem, listItems, removeItem, type InstalledItem } from './items';
import { fileName, itemFileState, itemsToDrop, type FileProbe } from './reconcile-core';

function probe(uri: string): FileProbe {
  try {
    const f = new File(uri);
    return f.exists ? { exists: true, size: Number(f.size ?? 0) } : { exists: false, size: 0 };
  } catch {
    return null;
  }
}

/** The stored path (already re-anchored by items.ts), then the same name in the kind's folder. */
function fileState(item: InstalledItem) {
  const name = fileName(item.fileUri);
  const uris = [item.fileUri];
  try {
    if (name) uris.push(contentFile(item.kind, name).uri);
  } catch {
    // the stored path alone decides
  }
  return itemFileState(item.sizeBytes, [...new Set(uris)].map(probe));
}

/** Drops the items whose file is gone. Returns how many. */
export async function reconcileContent(): Promise<number> {
  const items = listItems();
  const states = new Map(items.map((i) => [i.id, fileState(i)]));
  for (const [id, state] of states) if (state === 'damaged') console.warn('[content] file smaller than installed', id);
  let dropped = 0;
  for (const id of itemsToDrop(items, (i) => states.get(i.id) ?? 'unknown')) {
    // Checked again right before: a download that just finished may have put it back.
    const item = getItem(id);
    if (!item || fileState(item) !== 'missing') continue;
    try {
      await removeItem(id, { keepUserData: true });
      dropped++;
    } catch (e) {
      console.warn('[content] cannot drop', id, e);
    }
  }
  return dropped;
}

/** Once, when the app is in front (a background launch, e.g. for a download, would show it to no one). */
function tellUser(count: number) {
  const show = () => showToast(i18n.t('downloads.missing', { count }), false);
  if (AppState.currentState !== 'background') {
    show();
    return;
  }
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    show();
  });
}

registerInit(() => {
  // In the background: the first screens render first (a few file checks, but removal hooks
  // can delete many search rows).
  setTimeout(() => {
    reconcileContent()
      .then((count) => count > 0 && tellUser(count))
      .catch((e) => console.warn('[content] reconcile failed', e));
  }, 1000);
});
