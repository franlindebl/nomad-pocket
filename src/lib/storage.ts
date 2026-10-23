// On-disk layout for downloaded content. Everything lives under the app's document
// directory (never the cache dir — the OS may purge it, which defeats "offline").
import { Directory, File, Paths } from 'expo-file-system';

export type ContentKind = 'zim' | 'map' | 'model';

const ROOT = 'content';
const SUBDIRS: Record<ContentKind, string> = { zim: 'zim', map: 'maps', model: 'models' };

export function contentDir(kind: ContentKind): Directory {
  const dir = new Directory(Paths.document, ROOT, SUBDIRS[kind]);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Scratch dir for in-progress downloads, inside documents so it survives purges. */
export function partialDir(): Directory {
  const dir = new Directory(Paths.document, ROOT, 'partial');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function contentFile(kind: ContentKind, filename: string): File {
  return new File(contentDir(kind), filename);
}

/** Strip the file:// scheme — native libraries (libzim, llama.cpp) want plain paths. */
export function toNativePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

export function freeBytes(): number {
  return Paths.availableDiskSpace;
}

export function totalBytes(): number {
  return Paths.totalDiskSpace;
}

export function fileSize(uri: string): number {
  try {
    const f = new File(uri);
    return f.exists ? (f.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

export function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Keep 500 MB of headroom so the OS and other apps keep working. */
export const STORAGE_HEADROOM = 500 * 1e6;

export function hasRoomFor(bytes: number): boolean {
  return freeBytes() - STORAGE_HEADROOM >= bytes;
}
