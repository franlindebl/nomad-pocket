// JS facade over the native ZIM module (modules/nomad-zim).
// CONTRACT: other features (assistant RAG, courses, home) import only from here.
// The signatures below are stable; the implementation is filled in by the ZIM work.

export type ZimInfo = {
  /** Archive UUID from the ZIM header — stable across devices for the same file. */
  uuid: string;
  title: string;
  description: string;
  language: string;
  creator: string;
  publisher: string;
  /** YYYY-MM-DD */
  date: string;
  /** Kiwix book name, e.g. "wikipedia_es_top_mini" (M/Name metadata) when present. */
  name: string;
  articleCount: number;
  mediaCount: number;
  mainPath: string | null;
  hasFulltextIndex: boolean;
  hasTitleIndex: boolean;
  /** PNG data URI of the 48x48 illustration, if any. */
  illustration: string | null;
};

export type ZimSearchHit = {
  /** Installed item id (items.id) the hit belongs to. */
  itemId: string;
  path: string;
  title: string;
  /** Plain-text snippet (full-text search only). */
  snippet?: string;
  /** Word count of the article, when known. */
  wordCount?: number;
};

export type ZimLink = { path: string; title: string };

function notReady(): never {
  throw new Error('nomad-zim native module not implemented yet');
}

/** Open (or return already-open) archive for an installed item. */
export async function openArchive(itemId: string, fileUri: string): Promise<ZimInfo> {
  void itemId;
  void fileUri;
  return notReady();
}

export function closeArchive(itemId: string): void {
  void itemId;
}

/** Title suggestions (prefix / title index). Fast; use for search-as-you-type. */
export async function suggest(itemIds: string[], query: string, limit = 20): Promise<ZimSearchHit[]> {
  void itemIds;
  void query;
  void limit;
  return [];
}

/** Full-text search (Xapian). Falls back to suggestions when there is no full-text index. */
export async function search(itemIds: string[], query: string, limit = 20): Promise<ZimSearchHit[]> {
  void itemIds;
  void query;
  void limit;
  return [];
}

/** Article as plain text (HTML stripped, whitespace collapsed), truncated to maxChars. */
export async function getArticleText(itemId: string, path: string, maxChars = 8000): Promise<{ title: string; text: string } | null> {
  void itemId;
  void path;
  void maxChars;
  return null;
}

/** Raw HTML of an entry (redirects resolved). */
export async function getArticleHtml(itemId: string, path: string): Promise<{ title: string; html: string; path: string } | null> {
  void itemId;
  void path;
  return null;
}

/** Internal article links in document order (used to build course syllabi). */
export async function getLinks(itemId: string, path: string): Promise<ZimLink[]> {
  void itemId;
  void path;
  return [];
}

export async function getMainPath(itemId: string): Promise<string | null> {
  void itemId;
  return null;
}

export async function randomPath(itemId: string): Promise<string | null> {
  void itemId;
  return null;
}
