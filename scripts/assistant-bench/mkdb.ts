// A search.db like the app's document index (documents.ts) from pdfindex.py's output, so the bench needs no
// simulator. Titles come from the PDFs (the app also uses zimgit's collection names). Usage:
//   node --experimental-strip-types mkdb.ts pdfs.jsonl search.db
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync } from 'node:fs';

const dc = await import(new URL('../../src/features/library/documents-core.ts', import.meta.url).pathname);
const [jsonl, dbPath] = process.argv.slice(2);
rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);
// The tables of INDEX_MIGRATIONS (src/db/schema.ts) that the bench reads.
db.exec(`CREATE VIRTUAL TABLE doc_passages USING fts5(text, title, item_id UNINDEXED, path UNINDEXED, page UNINDEXED, tokenize = 'porter unicode61 remove_diacritics 2');
CREATE TABLE doc_files (item_id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, pages INTEGER NOT NULL, text_pages INTEGER NOT NULL, passages INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (item_id, path));`);
const sql = {
  run: async (q: string, p: Record<string, unknown> = {}) => void db.prepare(q).run(p as never),
  all: async (q: string, p: Record<string, unknown> = {}) => db.prepare(q).all(p as never) as never,
};
let passages = 0;
for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
  if (!line) continue;
  const d = JSON.parse(line);
  const { rows, textPages } = dc.documentPassages(d.pages);
  await dc.insertDocument(sql, { itemId: d.itemId, path: d.path, title: dc.documentTitle(d.path, { pdf: d.pdfTitle }), pages: d.pages.length, textPages, rows, status: 'done' });
  passages += rows.length;
}
console.log(`${passages} passages`);
