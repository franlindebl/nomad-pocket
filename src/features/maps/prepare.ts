// What downloaded maps and routing packs still have to do before they are ready (prepare-core.ts):
// the search index from a map's tiles, each side file's import, a map's emergency points from
// Overpass. A country shows it as "Preparando… 40 %" once its bytes are in (countries.ts), and
// only counts as ready after it.
import { create } from 'zustand';

import * as core from './prepare-core';

export const usePreparing = create<{ items: core.Preparing }>(() => ({ items: {} }));

const apply = (fn: (s: core.Preparing) => core.Preparing) =>
  usePreparing.setState((st) => {
    const items = fn(st.items);
    return items === st.items ? st : { items };
  });

/** `weight`: bytes (a file), or what the work is worth next to them. */
export const beginTask = (itemId: string, key: string, weight: number) => apply((s) => core.beginTask(s, itemId, key, weight));
export const updateTask = (itemId: string, key: string, done: number) => apply((s) => core.updateTask(s, itemId, key, done));
export const endTask = (itemId: string, key: string) => apply((s) => core.endTask(s, itemId, key));

/** Resolves once no map or pack has anything left to prepare (now, if nothing has). */
export function whenPrepared(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (s: { items: core.Preparing }) => Object.keys(s.items).length === 0;
    if (idle(usePreparing.getState())) return resolve();
    const stop = usePreparing.subscribe((s) => {
      if (!idle(s)) return;
      stop();
      resolve();
    });
  });
}
