// Registry of installed content (ZIM archives, map regions, AI models).
// The `items` table is the source of truth; `useContent` mirrors it for React.
import { create } from 'zustand';

import { db, parseJson } from '@/db';
import { deleteFile, resolveContentUri, type ContentKind } from '@/lib/storage';

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
  title: r.title,
  description: r.description,
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

export async function removeItem(id: string) {
  const item = getItem(id);
  if (!item) return;
  await removeHooks[item.kind]?.(item);
  deleteFile(item.fileUri);
  const d = db();
  d.runSync('DELETE FROM items WHERE id = ?', id);
  d.runSync('DELETE FROM bookmarks WHERE item_id = ?', id);
  d.runSync('DELETE FROM history WHERE item_id = ?', id);
  d.runSync('DELETE FROM courses WHERE item_id = ?', id);
  d.runSync('DELETE FROM course_progress WHERE item_id = ?', id);
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

export function useItems(kind?: ContentKind): InstalledItem[] {
  const items = useContent((s) => s.items);
  return kind ? items.filter((i) => i.kind === kind) : items;
}

export function isInstalled(catalogId: string): boolean {
  return useContent.getState().items.some((i) => i.catalogId === catalogId || i.id === catalogId);
}
