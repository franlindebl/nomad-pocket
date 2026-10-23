// ZIM feature registration: download completion handler, removal hook and startup
// init. CONTRACT: `registerZimFile` is used by the library import flow.
import { Directory, File, Paths } from 'expo-file-system';

import { db } from '@/db';
import { registerInit } from '@/features/bootstrap';
import { getItem, listItems, onItemRemoved, upsertItem, type InstalledItem } from '@/features/content/items';
import { registerCompletionHandler } from '@/features/downloads/manager';
import { contentDir, deleteFile, fileSize, resolveContentUri } from '@/lib/storage';

import { NomadZim, isNomadZimAvailable } from '../../../modules/nomad-zim';

import { closeArchive, excludeFromBackup, openArchive, type ZimInfo } from './zim';

/** Download meta written by src/features/catalog (downloadResource). */
type ZimDownloadMeta = {
  catalogId?: string | null;
  title?: string | null;
  description?: string | null;
  language?: string | null;
  category?: string | null;
  isCourse?: boolean | null;
  subject?: string | null;
  medical?: boolean | null;
  version?: string | null;
  sourceUrl?: string | null;
};

// ZIM "Language" metadata is ISO 639-3 ("eng", "spa", "eng,spa"); the app uses 639-1.
const ISO3_TO_1: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', por: 'pt', ita: 'it', cat: 'ca', glg: 'gl', eus: 'eu',
  ara: 'ar', zho: 'zh', rus: 'ru', jpn: 'ja', kor: 'ko', hin: 'hi', nld: 'nl', pol: 'pl', tur: 'tr', mul: 'mul',
};

function appLanguage(zimLanguage: string): string | null {
  const codes = zimLanguage.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!codes.length) return null;
  if (codes.length > 1) return 'mul';
  return ISO3_TO_1[codes[0]] ?? codes[0];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

let probeCounter = 0;

/** Open a ZIM file already inside content/zim, read its metadata and register it. */
export async function registerZimFile(fileUri: string, meta?: Record<string, unknown>): Promise<InstalledItem> {
  const m = (meta ?? {}) as ZimDownloadMeta;

  // Read the header under a temporary key to learn uuid/name, then open under the final id.
  const probeId = `__probe_${Date.now()}_${probeCounter++}`;
  let info: ZimInfo;
  try {
    info = await openArchive(probeId, fileUri);
  } finally {
    closeArchive(probeId);
  }

  const id = str(m.catalogId) ?? str(info.name) ?? info.uuid;
  const previous = getItem(id);
  if (previous && previous.fileUri !== fileUri) {
    // Updated version of an installed archive: drop the old file once the new one is in.
    closeArchive(id);
  }
  info = await openArchive(id, fileUri);

  const item: InstalledItem = {
    id,
    kind: 'zim',
    title: str(m.title) ?? (info.title || info.name || id),
    description: str(m.description) ?? (info.description || null),
    language: str(m.language) ?? appLanguage(info.language),
    category: str(m.category) ?? previous?.category ?? null,
    isCourse: m.isCourse ?? previous?.isCourse ?? false,
    fileUri,
    sizeBytes: Number(fileSize(fileUri)) || 0,
    version: str(m.version) ?? (info.date ? info.date.slice(0, 7) : null),
    sourceUrl: str(m.sourceUrl) ?? previous?.sourceUrl ?? null,
    catalogId: str(m.catalogId) ?? previous?.catalogId ?? null,
    meta: {
      uuid: info.uuid,
      name: info.name || null,
      articleCount: info.articleCount,
      mainPath: info.mainPath,
      illustration: info.illustration,
      subject: m.subject ?? (previous?.meta.subject as string | undefined) ?? null,
      medical: m.medical ?? (previous?.meta.medical as boolean | undefined) ?? false,
    },
    installedAt: previous?.installedAt ?? Date.now(),
  };
  upsertItem(item);

  if (previous && previous.fileUri !== fileUri) deleteFile(previous.fileUri);
  excludeFromBackup(fileUri);
  return getItem(id) ?? item;
}

registerCompletionHandler('zim', async (file, record) => {
  await registerZimFile(file.uri, record.meta);
});

onItemRemoved('zim', (item) => {
  closeArchive(item.id);
});

/** Files in content/zim that no item or pending download points to (e.g. copied in via Finder/Files). */
function unregisteredZimFiles(): File[] {
  const known = new Set(listItems('zim').map((i) => i.fileUri));
  const pending = db().getAllSync<{ dest_uri: string }>("SELECT dest_uri FROM downloads WHERE status NOT IN ('done','cancelled')");
  for (const p of pending) known.add(resolveContentUri(p.dest_uri));
  const norm = (u: string) => decodeURIComponent(u.replace(/^file:\/\//, ''));
  const knownPaths = new Set([...known].map(norm));
  return contentDir('zim')
    .list()
    .filter((e): e is File => e instanceof File && /\.zim$/i.test(e.name) && !knownPaths.has(norm(e.uri)));
}

registerInit(async () => {
  if (!isNomadZimAvailable()) return;
  // Large, re-downloadable content stays out of iCloud backups.
  const root = new Directory(Paths.document, 'content');
  if (root.exists) excludeFromBackup(root.uri);

  // Register stray archives in the background; never block startup on it.
  setTimeout(async () => {
    try {
      for (const file of unregisteredZimFiles()) {
        try {
          await registerZimFile(file.uri);
        } catch (e) {
          console.warn('[zim] cannot register', file.name, e);
        }
      }
    } catch (e) {
      console.warn('[zim] scan failed', e);
    }
    // Warm up installed archives so the first search is fast (opening is cheap).
    for (const item of listItems('zim')) {
      if (!NomadZim.isOpen(item.id) && new File(item.fileUri).exists) openArchive(item.id, item.fileUri).catch(() => {});
    }
  }, 500);
});
