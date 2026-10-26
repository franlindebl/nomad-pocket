// Side files of country maps and routing packs (emergency points, street names, named places,
// house numbers): downloaded next to the archive, imported into the search and emergency
// tables once its item is registered, then deleted. An import is not part of its download
// (a big country takes minutes and the download is done as soon as the file is in place), so
// it must survive a kill: a file still on disk whose item is installed is an import to run
// again (country-maps.ts / routing-packs.ts replay them at startup and their sweeps keep them),
// and kv-store remembers which files an item still expects, so the catalog refresh can fetch
// again one that got lost. Imports run one at a time, each file once at a time; a file that
// keeps failing (or taking the app down with it) is given up after a few tries.
import { File, FileMode } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';

import { getItem } from '@/features/content/items';
import { contentFile, deleteFile } from '@/lib/storage';

export type SideKind = 'map' | 'route';

/**
 * A side file an item still expects (not imported yet), and the imports already tried on it
 * (above MAX_ATTEMPTS: given up, and not fetched again until the next download of the item).
 */
type Expected = { item: string; attempts: number };

const KEY = 'maps.sideImports';
const MAX_ATTEMPTS = 3;

const keyOf = (kind: SideKind, name: string) => `${kind}/${name}`;

function load(): Record<string, Expected> {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function save(all: Record<string, Expected>) {
  try {
    Storage.setItemSync(KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('[maps] side imports', e);
  }
}

/** `item` will get these side files (queued with its download, new copies): import them once both are there. */
export function expectSideFiles(kind: SideKind, item: string, names: string[]) {
  if (!names.length) return;
  const all = load();
  for (const name of names) all[keyOf(kind, name)] = { item, attempts: 0 };
  save(all);
}

/** Side files still expected (by file name), with the item they are for; `gaveUp`: their import kept failing. */
export function expectedSideFiles(kind: SideKind): { name: string; item: string; gaveUp: boolean }[] {
  return Object.entries(load())
    .filter(([key]) => key.startsWith(`${kind}/`))
    .map(([key, e]) => ({ name: key.slice(kind.length + 1), item: e.item, gaveUp: e.attempts > MAX_ATTEMPTS }));
}

/** Drops what is expected of these files (given up, or their download was cancelled). */
export function forgetSideFile(kind: SideKind, name: string) {
  const all = load();
  if (!(keyOf(kind, name) in all)) return;
  delete all[keyOf(kind, name)];
  save(all);
}

/** An item was removed: it expects nothing any more. */
export function forgetSideFilesOf(item: string) {
  const all = load();
  const keys = Object.keys(all).filter((k) => all[k].item === item);
  if (!keys.length) return;
  for (const k of keys) delete all[k];
  save(all);
}

let chain: Promise<void> = Promise.resolve();
/** Queued or running, by kind/name. */
const busy = new Set<string>();
/** Running while a newer copy of the file landed: imported once more after. */
const again = new Set<string>();
let running: string | null = null;

/** Whether a file is waiting for its import or being imported. */
export function isImporting(kind: SideKind, name: string): boolean {
  return busy.has(keyOf(kind, name));
}

/**
 * Imports a side file into `item` with `run` and deletes it, after the imports before it.
 * Nothing happens while the item isn't installed (the file waits on disk for it). A second
 * call while the file is queued is a no-op (it reads the file when its turn comes); while it
 * runs, `landed` (a download just put a new copy in place) imports it once more after. A
 * failed import keeps the file for the next launch.
 */
export function importSideFile(kind: SideKind, name: string, item: string, run: (file: File) => Promise<void>, landed = false): Promise<void> {
  const key = keyOf(kind, name);
  if (busy.has(key)) {
    if (running === key && landed) again.add(key);
    return chain;
  }
  busy.add(key);
  chain = chain
    .then(async () => {
      running = key;
      do {
        again.delete(key);
        await importOnce(kind, name, item, run);
      } while (again.has(key));
    })
    .catch((e) => console.warn('[maps] import', name, e))
    .finally(() => {
      busy.delete(key);
      again.delete(key);
      if (running === key) running = null;
    });
  return chain;
}

async function importOnce(kind: SideKind, name: string, item: string, run: (file: File) => Promise<void>) {
  const key = keyOf(kind, name);
  const file = contentFile(kind, name);
  if (!file.exists || !getItem(item)) return;
  // Counted before the import: one that takes the app down counts too.
  const all = load();
  const attempts = (all[key]?.item === item ? all[key].attempts : 0) + 1;
  if (attempts > MAX_ATTEMPTS) {
    // Kept as given up: the catalog refresh must not fetch it again for this item.
    console.warn('[maps] giving up on', name);
    deleteFile(file.uri);
    all[key] = { item, attempts };
    save(all);
    return;
  }
  all[key] = { item, attempts };
  save(all);
  await run(file);
  // A newer copy landed meanwhile: it is imported next, from a clean count.
  if (again.has(key)) {
    const fresh = load();
    fresh[key] = { item, attempts: 0 };
    save(fresh);
    return;
  }
  deleteFile(file.uri);
  forgetSideFile(kind, name);
}

const LINE_BLOCK = 4 * 1024 * 1024;

/**
 * Calls `onBlock` with the text of a big TSV file a few MB of whole lines at a time (a
 * country's file read in one string would be hundreds of MB in Hermes). `onBlock` returns
 * false to stop.
 */
export async function forEachLineBlock(file: File, onBlock: (text: string) => Promise<boolean>) {
  const handle = file.open(FileMode.ReadOnly);
  const decoder = new TextDecoder('utf-8');
  let carry = new Uint8Array(0);
  try {
    for (;;) {
      const chunk = await handle.readBytes(LINE_BLOCK);
      let data = chunk;
      if (carry.length) {
        data = new Uint8Array(carry.length + chunk.length);
        data.set(carry);
        data.set(chunk, carry.length);
      }
      if (!chunk.length) {
        if (data.length) await onBlock(decoder.decode(data));
        return;
      }
      const cut = data.lastIndexOf(10);
      if (cut < 0) {
        carry = data;
        continue;
      }
      if (!(await onBlock(decoder.decode(data.subarray(0, cut))))) return;
      carry = data.slice(cut + 1);
    }
  } finally {
    handle.close();
  }
}
