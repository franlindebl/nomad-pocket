// The library's document index, pure half: the PDFs inside installed archives (the zimgit-*
// collections, military medicine…) have no full-text index of their own (libzim indexes HTML
// only), so the assistant never saw what they say. documents.ts extracts their text on the
// device once; this module cleans it, cuts it into passages, names the documents, and writes
// and searches the doc_passages FTS5 table. No `@/` aliases: documents-core.test.ts runs it
// against node:sqlite.

/** Bump to rebuild every archive's passages (cleaning or passage rules changed). */
export const DOC_INDEX_VERSION = 1;
/** Entries looked at to find an archive's PDFs: collections hold a few thousand; Wikipedia millions and no PDFs. */
export const MAX_SCAN = 50_000;
/** Pages read per document (the longest guides have ~650). */
export const MAX_PAGES = 1500;
export const PASSAGE_SIZE = 650;
const PASSAGE_OVERLAP = 100;

/** Named parameters, with their `$`: what expo-sqlite and node:sqlite both bind. */
export type Params = Record<string, string | number | null>;

/** What this module needs of a database: expo-sqlite's async API, or node:sqlite in tests. */
export type AsyncSql = {
  run(sql: string, params?: Params): Promise<unknown>;
  all<T>(sql: string, params?: Params): Promise<T[]>;
};

// ---------------------------------------------------------------------------
// Text

/**
 * A PDF page's text as prose: words hyphenated across lines joined, wrapped lines unwrapped
 * (PDF text breaks every line), blank lines kept as paragraph breaks.
 */
export function cleanPageText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[­￾￿]/g, '')
      // Ligatures some PDFs map to private code points: dropped, they only split words.
      .replace(/[-]/g, '')
      .replace(/[ \t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
      .replace(/([^\n])\n(?!\n)/g, '$1 ')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
  );
}

/** Whether a page has a usable text layer: scans give nothing, or a stray character per page. */
export function hasText(page: string): boolean {
  return (page.match(/\p{L}/gu)?.length ?? 0) >= 40;
}

function sentences(paragraph: string): string[] {
  return (paragraph.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** ~`size`-char passages of one page, on sentence boundaries, with a little overlap. */
export function splitPassages(text: string, size = PASSAGE_SIZE, overlap = PASSAGE_OVERLAP): string[] {
  if (!text) return [];
  if (text.length <= size) return [text];
  const parts: string[] = [];
  for (const para of text.split('\n\n')) {
    for (const s of sentences(para)) {
      if (s.length <= size) parts.push(s);
      else for (let i = 0; i < s.length; i += size - overlap) parts.push(s.slice(i, i + size));
    }
  }
  const out: string[] = [];
  let current: string[] = [];
  let len = 0;
  let fresh = 0;
  for (const s of parts) {
    if (len + s.length + 1 > size && fresh) {
      out.push(current.join(' '));
      const carry: string[] = [];
      let carryLen = 0;
      for (let i = current.length - 1; i >= 0 && carryLen + current[i].length <= overlap; i--) {
        carry.unshift(current[i]);
        carryLen += current[i].length + 1;
      }
      current = carryLen + s.length + 1 <= size ? carry : [];
      len = current.length ? carryLen : 0;
      fresh = 0;
    }
    current.push(s);
    len += s.length + 1;
    fresh++;
  }
  if (fresh) out.push(current.join(' '));
  return out;
}

export type PassageRow = { page: number; text: string };

/**
 * Passages of one page (1-based `page`): a passage never spans two pages, so a citation names
 * one. Null when the page has no text layer.
 */
export function pagePassages(raw: string, page: number): PassageRow[] | null {
  if (!hasText(raw)) return null;
  // Tables of contents and indexes (dot leaders, page numbers) are no use as passages.
  return splitPassages(cleanPageText(raw))
    .filter((text) => (text.match(/\p{L}/gu)?.length ?? 0) >= 0.5 * text.length)
    .map((text) => ({ page, text }));
}

/** Passages of a whole document, and how many of its pages have text. */
export function documentPassages(pages: string[]): { rows: PassageRow[]; textPages: number } {
  const rows: PassageRow[] = [];
  let textPages = 0;
  pages.forEach((raw, i) => {
    const out = pagePassages(raw, i + 1);
    if (!out) return;
    textPages++;
    rows.push(...out);
  });
  return { rows, textPages };
}

// ---------------------------------------------------------------------------
// Titles

/** A PDF's own title worth showing: not a file name, a word processor's or a scanner's code. */
export function looksLikeTitle(s: string | null | undefined): s is string {
  const t = s?.trim() ?? '';
  if (t.length < 4 || t.length > 160) return false;
  if (/^microsoft\s|\.(docx?|pdf|indd|qxd|rtf|txt)\b|^untitled\b|^document\d*$|^print$/i.test(t)) return false;
  // "42511cvr", "ATP4-25x13": one token mixing letters and digits.
  if (!/\s/.test(t) && /\d/.test(t)) return false;
  return (t.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

/** "Student_manual_2005" → "Student manual 2005", "the-ten-bushcraft-books" → "the ten bushcraft books". */
export function tidyTitle(title: string): string {
  let t = title.replace(/_+/g, ' ');
  if (!/\s/.test(t.trim())) t = t.replace(/-+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** "files/Water (3).pdf" → "Water (3)", "irp.fas.org/doddir/milmed/sfhandbook-pt2.pdf" → "sfhandbook pt2". */
export function fileTitle(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || path;
}

/**
 * The name to show for a document: its collection entry's title (zimgit), else a link text
 * from the archive's main page that says more than "Part 1", else the PDF's own title, else
 * the file name.
 */
export function documentTitle(path: string, names: { collection?: string; link?: string; pdf?: string | null }): string {
  if (names.collection?.trim()) return tidyTitle(names.collection);
  const link = names.link ? tidyTitle(names.link) : undefined;
  const vague = !link || link.length < 6 || /^(part|parte|vol(ume)?|chapter|full text|download|pdf)\b/i.test(link);
  if (link && !vague) return link;
  if (looksLikeTitle(names.pdf)) return names.pdf.trim().replace(/\s+/g, ' ');
  return link || fileTitle(path);
}

// ---------------------------------------------------------------------------
// SQL

const WORD_RE = /[\p{L}\p{N}]+/gu;

const quoted = (query: string) => [...new Set((query.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length > 1 || /\d/.test(w)))].map((w) => `"${w}"`);

/**
 * FTS5 MATCH expression for one keyword query, each word quoted (no FTS syntax gets through):
 * every word (`all`), or any of them (bm25 still ranks passages with more and rarer words first).
 */
export function docMatch(query: string, mode: 'all' | 'any' = 'all'): string | null {
  const words = quoted(query);
  return words.length ? words.join(mode === 'all' ? ' ' : ' OR ') : null;
}

/** One document's passages and its doc_files row, together or not at all. */
export async function insertDocument(
  db: AsyncSql,
  doc: { itemId: string; path: string; title: string; pages: number; textPages: number; rows: PassageRow[]; status: 'done' | 'locked' | 'failed' },
): Promise<void> {
  await db.run('BEGIN');
  try {
    if (doc.rows.length) {
      await db.run(
        `INSERT INTO doc_passages (text, title, item_id, path, page)
         SELECT value->>0, $title, $item, $path, value->>1 FROM json_each($json)`,
        { $json: JSON.stringify(doc.rows.map((r) => [r.text, r.page])), $title: doc.title, $item: doc.itemId, $path: doc.path },
      );
    }
    await db.run(
      `INSERT OR REPLACE INTO doc_files (item_id, path, title, pages, text_pages, passages, status)
       VALUES ($item, $path, $title, $pages, $textPages, $passages, $status)`,
      {
        $item: doc.itemId,
        $path: doc.path,
        $title: doc.title,
        $pages: doc.pages,
        $textPages: doc.textPages,
        $passages: doc.rows.length,
        $status: doc.status,
      },
    );
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** Everything indexed from an archive. */
export async function deleteArchive(db: AsyncSql, itemId: string): Promise<void> {
  await db.run('DELETE FROM doc_passages WHERE item_id = $item', { $item: itemId });
  await db.run('DELETE FROM doc_files WHERE item_id = $item', { $item: itemId });
  await db.run('DELETE FROM doc_archives WHERE item_id = $item', { $item: itemId });
}

export type DocHit = { id: number; itemId: string; path: string; page: number; title: string; text: string };

/**
 * Passages matching every (or any) word of `query` in the given archives, best first (bm25: a match
 * in the text counts 4× one in the document title, which every passage of it repeats).
 */
export async function searchPassages(db: AsyncSql, query: string, itemIds: string[], limit: number, mode: 'all' | 'any' = 'all'): Promise<DocHit[]> {
  const match = docMatch(query, mode);
  if (!match || !itemIds.length) return [];
  const ids = JSON.stringify(itemIds);
  return db.all<DocHit>(
    `SELECT rowid AS id, item_id AS itemId, path, page, title, text FROM doc_passages
     WHERE doc_passages MATCH $match AND item_id IN (SELECT value FROM json_each($ids))
     ORDER BY bm25(doc_passages, 4.0, 1.0) LIMIT $limit`,
    { $match: match, $ids: ids, $limit: limit },
  );
}

/** Reciprocal-rank fusion of several queries' passages (earlier queries are more specific), duplicates dropped. */
export function fusePassages(lists: DocHit[][], limit: number): DocHit[] {
  const score = new Map<number, { hit: DocHit; s: number }>();
  lists.forEach((hits, qi) =>
    hits.forEach((hit, rank) => {
      const add = 1 / (60 + rank) + (qi === 0 ? 0.002 : 0);
      const prev = score.get(hit.id);
      if (prev) prev.s += add;
      else score.set(hit.id, { hit, s: add });
    }),
  );
  // The same guide inside two archives (FAS' "First Aid" is zimgit's too) gives the same passages twice.
  const seen = new Set<string>();
  return [...score.values()]
    .sort((a, b) => b.s - a.s)
    .map((x) => x.hit)
    .filter((h) => {
      const key = h.text.slice(0, 200);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
