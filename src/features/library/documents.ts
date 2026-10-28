// The library's document index: the text of the PDFs inside installed archives, searchable
// with SQLite FTS5 (doc_passages in the index file). libzim's full-text index covers HTML only,
// so without it the assistant saw none of what the document collections (zimgit-* medicine,
// water, post-disaster…, military medicine) say. Each archive is read once, in the background,
// one document at a time (native extraction: PDFKit on iOS, PDFBox on Android), and every
// document is written in one transaction, so an index cut short by a kill resumes where it
// stopped. Pure half: documents-core.ts.
import { indexDb, indexDbAsync, indexWrite } from '@/db';
import { getItem, listItems } from '@/features/content/items';

import {
  deleteArchive,
  DOC_INDEX_VERSION,
  pagePassages,
  documentTitle,
  fusePassages,
  insertDocument,
  MAX_PAGES,
  MAX_SCAN,
  searchPassages,
  type AsyncSql,
  type DocHit,
  type PassageRow,
} from './documents-core';
import { getCollection, getLinks, getPdfText, listEntries } from './zim';

export type { DocHit } from './documents-core';

function background(): AsyncSql {
  const d = indexDbAsync();
  return { run: (sql, params) => d.runAsync(sql, params ?? {}), all: (sql, params) => d.getAllAsync(sql, params ?? {}) };
}

type ArchiveState = { uuid: string; version: number; done_at: number | null };

const archiveState = (itemId: string) =>
  indexDb().getFirstSync<ArchiveState>('SELECT uuid, version, done_at FROM doc_archives WHERE item_id = ?', itemId);

const queue: string[] = [];
let running = false;
/** Archives removed while queued or being read: their work stops and nothing more is written. */
const dropped = new Set<string>();

/** Reads an archive's documents into the index (once per file; no-op when already done). */
export function indexDocuments(itemId: string) {
  dropped.delete(itemId);
  if (!queue.includes(itemId)) queue.push(itemId);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        await indexArchive(id);
      } catch (e) {
        console.warn('[docs] cannot index', id, e);
      }
    }
  } finally {
    running = false;
  }
}

/** Forgets an archive's documents (removed, or replaced by another file). */
export function dropDocuments(itemId: string): Promise<void> {
  dropped.add(itemId);
  const at = queue.indexOf(itemId);
  if (at >= 0) queue.splice(at, 1);
  return indexWrite(() => deleteArchive(background(), itemId));
}

const PAGES_PER_SLICE = 40;
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** documentPassages in slices: a 600-page guide is a few hundred ms of regexes for the JS thread. */
async function passagesOf(pages: string[]): Promise<{ rows: PassageRow[]; textPages: number }> {
  const rows: PassageRow[] = [];
  let textPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const out = pagePassages(pages[i], i + 1);
    if (out) {
      textPages++;
      rows.push(...out);
    }
    if (i % PAGES_PER_SLICE === PAGES_PER_SLICE - 1) await nextTick();
  }
  return { rows, textPages };
}

/** Names for an archive's documents: its collection list (zimgit) and its main page's links. */
async function documentNames(itemId: string, mainPath: string | null) {
  const collection = new Map<string, string>();
  for (const doc of (await getCollection(itemId)) ?? []) {
    doc.files.forEach((f, i) => collection.set(f, doc.files.length > 1 ? `${doc.title} (${i + 1}/${doc.files.length})` : doc.title));
  }
  const links = new Map<string, string>();
  if (!collection.size && mainPath) {
    for (const l of await getLinks(itemId, mainPath)) if (!links.has(l.path)) links.set(l.path, l.title);
  }
  return { collection, links };
}

async function indexArchive(itemId: string) {
  const item = getItem(itemId);
  const uuid = typeof item?.meta.uuid === 'string' ? item.meta.uuid : null;
  if (!item || item.kind !== 'zim' || !uuid) return;
  const state = archiveState(itemId);
  if (state && state.uuid === uuid && state.version === DOC_INDEX_VERSION && state.done_at) return;
  // Another file under the same id (an update) or older passage rules: start over.
  if (state && (state.uuid !== uuid || state.version !== DOC_INDEX_VERSION)) await indexWrite(() => deleteArchive(background(), itemId));

  const listed = await listEntries(itemId, 'application/pdf', MAX_SCAN);
  if (!listed || dropped.has(itemId)) return;
  const pdfs = listed.entries;
  await indexWrite(() =>
    background().run(
      `INSERT INTO doc_archives (item_id, uuid, version, documents, done_at) VALUES ($item, $uuid, $version, $docs, NULL)
       ON CONFLICT(item_id) DO UPDATE SET uuid = excluded.uuid, version = excluded.version, documents = excluded.documents`,
      { $item: itemId, $uuid: uuid, $version: DOC_INDEX_VERSION, $docs: pdfs.length },
    ),
  );
  if (pdfs.length) {
    const done = new Set(indexDb().getAllSync<{ path: string }>('SELECT path FROM doc_files WHERE item_id = ?', itemId).map((r) => r.path));
    const names = await documentNames(itemId, typeof item.meta.mainPath === 'string' ? item.meta.mainPath : null);
    const started = Date.now();
    let read = 0;
    let passages = 0;
    for (const pdf of pdfs) {
      if (done.has(pdf.path)) continue;
      if (dropped.has(itemId) || !getItem(itemId)) return;
      const text = await getPdfText(itemId, pdf.path, MAX_PAGES);
      if (dropped.has(itemId)) return;
      const { rows, textPages } = await passagesOf(text?.pages ?? []);
      const title = documentTitle(pdf.path, { collection: names.collection.get(pdf.path), link: names.links.get(pdf.path), pdf: text?.title });
      await indexWrite(() =>
        dropped.has(itemId)
          ? undefined
          : insertDocument(background(), {
              itemId,
              path: pdf.path,
              title,
              pages: text?.pages.length ?? 0,
              textPages,
              rows,
              status: !text ? 'failed' : text.locked ? 'locked' : 'done',
            }),
      );
      read++;
      passages += rows.length;
    }
    if (read) console.log(`[docs] ${itemId}: ${read} documents, ${passages} passages in ${Math.round((Date.now() - started) / 1000)} s`);
  }
  if (dropped.has(itemId)) return;
  await indexWrite(() => background().run('UPDATE doc_archives SET done_at = $now WHERE item_id = $item', { $now: Date.now(), $item: itemId }));
}

/**
 * Startup: forget archives that are gone, and read the ones not (fully) indexed yet: new
 * installs, an index cut short, or older passage rules.
 */
export async function reconcileDocuments() {
  const installed = new Map(listItems('zim').map((i) => [i.id, i]));
  const rows = indexDb().getAllSync<ArchiveState & { item_id: string }>('SELECT item_id, uuid, version, done_at FROM doc_archives');
  for (const r of rows) if (!installed.has(r.item_id)) await dropDocuments(r.item_id);
  const known = new Map(rows.map((r) => [r.item_id, r]));
  for (const item of installed.values()) {
    const r = known.get(item.id);
    if (!r || !r.done_at || r.version !== DOC_INDEX_VERSION || r.uuid !== item.meta.uuid) indexDocuments(item.id);
  }
}

/**
 * Passages of the given archives' documents for keyword queries (most specific first): those
 * with every word of the first query fused with the best of those with any word of any query,
 * without duplicates. The second list finds what the libzim-style narrowing (drop the last
 * keyword, then the one before) never tries: "heavy bleeding wound" → "bleeding" + "wound".
 * Runs on the index file's background connection.
 */
export async function searchDocuments(itemIds: string[], queries: string[], limit: number): Promise<DocHit[]> {
  if (!itemIds.length || !queries.length) return [];
  const db = background();
  const lists = await Promise.all([
    searchPassages(db, queries[0], itemIds, limit * 2, 'all').catch(() => [] as DocHit[]),
    searchPassages(db, queries.join(' '), itemIds, limit * 2, 'any').catch(() => [] as DocHit[]),
  ]);
  return fusePassages(lists, limit);
}
