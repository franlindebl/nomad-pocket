// ZIM registration, the pure part (used by register.ts): which id an archive gets, whether it
// replaces the installed archive with that id, and moving chat citations when an archive's id
// changes.

/** File name without extension and Kiwix date: "wikipedia_fr_all_nopic_2026-09.zim" → "wikipedia_fr_all_nopic". */
export function zimFileStem(fileUri: string): string {
  const last = fileUri.split('/').pop() ?? '';
  let file: string;
  try {
    file = decodeURIComponent(last);
  } catch {
    file = last;
  }
  // "-1" is the suffix an import adds when the name is taken.
  return file.replace(/\.zim$/i, '').replace(/_\d{4}-\d{2}[a-z]?(?:-\d+)?$/i, '');
}

/**
 * Id of an archive the catalog doesn't know. The ZIM Name metadata leaves out the flavour
 * ("wikipedia_fr_all" for both _nopic and _maxi), so take the flavour from the file name when
 * the file follows Kiwix's naming (<name>_<flavour>_<date>.zim).
 */
export function fallbackZimId(name: string | null, uuid: string, fileUri: string): string {
  if (!name) return uuid;
  const stem = zimFileStem(fileUri);
  return stem === name || stem.startsWith(`${name}_`) ? stem : name;
}

/** Versions are dates (YYYY-MM or YYYY-MM-DD): a missing one never counts as newer. */
export function isNewerVersion(next: string | null, current: string | null): boolean {
  if (!next) return false;
  if (!current) return true;
  return next > current;
}

export type InstalledZim = { fileUri: string; uuid: string | null; version: string | null; fileExists: boolean };

export type ZimCandidate = {
  fileUri: string;
  uuid: string;
  version: string | null;
  /** A download the person started (catalog or Explore): replacing the installed one is the point. */
  requested: boolean;
};

/**
 * Final id of an archive whose derived id may already belong to another file. A requested
 * download, the same archive (uuid) or a newer edition replaces the installed one. Anything else
 * (an older edition, or another book that shares the name) gets an id of its own instead of
 * silently deleting the installed file.
 */
export function zimRegistrationId(derivedId: string, next: ZimCandidate, installed: InstalledZim | null): string {
  if (!installed || installed.fileUri === next.fileUri || next.requested || !installed.fileExists) return derivedId;
  if (installed.uuid && installed.uuid === next.uuid) return derivedId;
  if (isNewerVersion(next.version, installed.version)) return derivedId;
  return `${derivedId}_${next.uuid.replace(/-/g, '').slice(0, 8)}`;
}

/** chat_messages.sources JSON with citations of `from` moved to `to`; null when none cite it. */
export function retargetSources(json: string | null, from: string, to: string): string | null {
  if (!json) return null;
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out = list.map((s) => {
    if (!s || typeof s !== 'object' || (s as { itemId?: unknown }).itemId !== from) return s;
    changed = true;
    return { ...s, itemId: to };
  });
  return changed ? JSON.stringify(out) : null;
}
