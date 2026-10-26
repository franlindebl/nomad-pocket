// Installed items vs. the files on disk, the pure part. Restoring an iPhone from a backup brings
// the database back (items rows) but not Documents/content, which is excluded from backups: every
// archive, map, routing pack and model would still look installed with nothing behind it. At
// startup each item's file is probed and items whose file is gone are dropped (content/register.ts).

/** One place an item's file may be: null when it could not be checked (never act on that). */
export type FileProbe = { exists: boolean; size: number } | null;

/**
 * ok: a file of a plausible size is there. missing: no file anywhere. damaged: a file is there but
 * smaller than when it was installed (kept: never delete a file that exists). unknown: a probe failed.
 */
export type ItemFileState = 'ok' | 'missing' | 'damaged' | 'unknown';

/** Installed files never change size: a smaller (or empty) one is truncated. */
export function plausibleSize(recordedBytes: number, actualBytes: number): boolean {
  if (!(actualBytes > 0)) return false;
  return !(recordedBytes > 0) || actualBytes >= recordedBytes;
}

/** State of an item's file from probes of every place it may live (stored path, then by name). */
export function itemFileState(recordedBytes: number, probes: FileProbe[]): ItemFileState {
  const found = probes.filter((p) => p?.exists);
  if (found.some((p) => plausibleSize(recordedBytes, p!.size))) return 'ok';
  if (found.length) return 'damaged';
  return probes.some((p) => p === null) || !probes.length ? 'unknown' : 'missing';
}

type ItemLike = { kind: string; fileUri: string; meta: Record<string, unknown> };

/** The bundled world map: maps/world.ts copies it back on its own when its file is gone. */
export function restoresItself(item: ItemLike): boolean {
  return item.kind === 'map' && item.meta.role === 'world';
}

/** File name of an item (stored URIs go stale when iOS moves the app container; names don't). */
export function fileName(uri: string): string {
  try {
    return decodeURIComponent(uri.split('/').pop() ?? '');
  } catch {
    return uri.split('/').pop() ?? '';
  }
}

/** Ids of the items to drop: those whose file is missing, except content that restores itself. */
export function itemsToDrop<T extends ItemLike & { id: string }>(items: T[], state: (item: T) => ItemFileState): string[] {
  return items.filter((i) => !restoresItself(i) && state(i) === 'missing').map((i) => i.id);
}
