// Registry of installed content (ZIM archives, map regions, AI models).
// The `items` table is the source of truth; `useContent` mirrors it for React.
import { create } from 'zustand';

import rawCatalog from '@/data/catalog.json';
import { db, parseJson } from '@/db';
import i18n from '@/i18n';
import { deleteFile, resolveContentUri, type ContentKind } from '@/lib/storage';

// Catalog texts are bilingual; the row keeps the language it was registered in, so
// catalog items get their title/description in the current app language when read.
// (Raw JSON rather than '@/features/catalog', which imports the download manager.)
type CatalogText = { es: string; en: string };
const catalogResources = (rawCatalog as unknown as { resources: Record<string, { title?: CatalogText; description?: CatalogText }> }).resources;
const localized = (v: CatalogText | undefined) => (v ? (i18n.language === 'es' ? v.es : v.en) || null : null);

export type InstalledItem = {
  id: string;
  kind: ContentKind;
  title: string;
  description: string | null;
  language: string | null;
  category: string | null;
  isCourse: boolean;
  fileUri: string;
  sizeBytes: number;
  version: string | null;
  sourceUrl: string | null;
  catalogId: string | null;
  meta: Record<string, unknown>;
  installedAt: number;
};

export type ItemInput = Omit<InstalledItem, 'installedAt' | 'meta'> & { meta?: Record<string, unknown> };

type Row = {
  id: string;
  kind: ContentKind;
  title: string;
  description: string | null;
  language: string | null;
  category: string | null;
  is_course: number;
  file_path: string;
  size_bytes: number;
  version: string | null;
  source_url: string | null;
  catalog_id: string | null;
  meta: string | null;
  installed_at: number;
};

const fromRow = (r: Row): InstalledItem => ({
  id: r.id,
  kind: r.kind,
  title: (r.kind === 'zim' && localized(catalogResources[r.catalog_id ?? '']?.title)) || r.title,
  description: (r.kind === 'zim' && localized(catalogResources[r.catalog_id ?? '']?.description)) || r.description,
  language: r.language,
  category: r.category,
  isCourse: !!r.is_course,
  fileUri: resolveContentUri(r.file_path),
  sizeBytes: r.size_bytes,
  version: r.version,
  sourceUrl: r.source_url,
  catalogId: r.catalog_id,
  meta: parseJson(r.meta, {}),
  installedAt: r.installed_at,
});

export function listItems(kind?: ContentKind): InstalledItem[] {
  const rows = kind
    ? db().getAllSync<Row>('SELECT * FROM items WHERE kind = ? ORDER BY installed_at DESC', kind)
    : db().getAllSync<Row>('SELECT * FROM items ORDER BY installed_at DESC');
  return rows.map(fromRow);
}

export function getItem(id: string): InstalledItem | null {
  const row = db().getFirstSync<Row>('SELECT * FROM items WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

export function upsertItem(input: ItemInput) {
  db().runSync(
    `INSERT INTO items (id, kind, title, description, language, category, is_course, file_path, size_bytes, version, source_url, catalog_id, meta, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, description=excluded.description,
       language=excluded.language, category=excluded.category, is_course=excluded.is_course, file_path=excluded.file_path,
       size_bytes=excluded.size_bytes, version=excluded.version, source_url=excluded.source_url,
       catalog_id=excluded.catalog_id, meta=excluded.meta`,
    input.id,
    input.kind,
    input.title,
    input.description,
    input.language,
    input.category,
    input.isCourse ? 1 : 0,
    input.fileUri,
    input.sizeBytes,
    input.version,
    input.sourceUrl,
    input.catalogId,
    JSON.stringify(input.meta ?? {}),
    Date.now(),
  );
  useContent.getState().refresh();
}

type RemoveHook = (item: InstalledItem) => void | Promise<void>;
const removeHooks: Partial<Record<ContentKind, RemoveHook>> = {};

/** Features register cleanup (e.g. closing a ZIM archive) before the file is deleted. */
export function onItemRemoved(kind: ContentKind, hook: RemoveHook) {
  removeHooks[kind] = hook;
}

/**
 * Removes an item, its file and what was derived from it (removal hooks). `keepUserData` keeps
 * the person's bookmarks, history and course progress: used when the file vanished on its own
 * (a restored backup), so they come back with the same archive downloaded again.
 */
export async function removeItem(id: string, options: { keepUserData?: boolean } = {}) {
  const item = getItem(id);
  if (!item) return;
  await removeHooks[item.kind]?.(item);
  deleteFile(item.fileUri);
  const d = db();
  d.runSync('DELETE FROM items WHERE id = ?', id);
  if (!options.keepUserData) {
    d.runSync('DELETE FROM bookmarks WHERE item_id = ?', id);
    d.runSync('DELETE FROM history WHERE item_id = ?', id);
    d.runSync('DELETE FROM courses WHERE item_id = ?', id);
    d.runSync('DELETE FROM course_progress WHERE item_id = ?', id);
  }
  useContent.getState().refresh();
}

type ContentState = {
  items: InstalledItem[];
  refresh: () => void;
};

export const useContent = create<ContentState>((set) => ({
  items: [],
  refresh: () => set({ items: listItems() }),
}));

i18n.on('languageChanged', () => useContent.getState().refresh());

export function useItems(kind?: ContentKind): InstalledItem[] {
  const items = useContent((s) => s.items);
  return kind ? items.filter((i) => i.kind === kind) : items;
}
