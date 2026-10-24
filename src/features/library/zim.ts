// JS facade over the native ZIM module (modules/nomad-zim).
// CONTRACT: other features (assistant RAG, courses, home) import only from here.
// The signatures below are stable.
import { getItem } from '@/features/content/items';
import { toNativePath } from '@/lib/storage';

import { NomadZim, isNomadZimAvailable, type NativeZimHit, type NativeZimInfo } from '../../../modules/nomad-zim';

import { decodeEntities, extractHeadings, extractLinks, htmlToText, stripTags, type Heading } from './html';

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

const infos = new Map<string, ZimInfo>();
const opening = new Map<string, Promise<ZimInfo>>();

function toInfo(n: NativeZimInfo): ZimInfo {
  return {
    uuid: n.uuid,
    title: n.title,
    description: n.description,
    language: n.language,
    creator: n.creator,
    publisher: n.publisher,
    date: n.date,
    name: n.name,
    articleCount: Number(n.articleCount) || 0,
    mediaCount: Number(n.mediaCount) || 0,
    mainPath: n.mainPath ?? null,
    hasFulltextIndex: !!n.hasFulltextIndex,
    hasTitleIndex: !!n.hasTitleIndex,
    illustration: n.illustration ?? null,
  };
}

/** Open (or return already-open) archive for an installed item. */
export async function openArchive(itemId: string, fileUri: string): Promise<ZimInfo> {
  const cached = infos.get(itemId);
  if (cached && NomadZim.isOpen(itemId)) return cached;
  const pending = opening.get(itemId);
  if (pending) return pending;
  const p = NomadZim.openArchive(itemId, toNativePath(fileUri))
    .then((n) => {
      const info = toInfo(n);
      infos.set(itemId, info);
      return info;
    })
    .finally(() => opening.delete(itemId));
  opening.set(itemId, p);
  return p;
}

export function closeArchive(itemId: string): void {
  infos.delete(itemId);
  if (isNomadZimAvailable()) NomadZim.closeArchive(itemId);
}

/** Opens an installed item's archive on demand. Null when not installed / unreadable. */
async function ensureOpen(itemId: string): Promise<ZimInfo | null> {
  if (!isNomadZimAvailable()) return null;
  const cached = infos.get(itemId);
  if (cached && NomadZim.isOpen(itemId)) return cached;
  const item = getItem(itemId);
  if (!item || item.kind !== 'zim') return null;
  try {
    return await openArchive(itemId, item.fileUri);
  } catch (e) {
    console.warn('[zim] cannot open', itemId, e);
    return null;
  }
}

/** Round-robin merge so every archive gets a fair share of the first results. */
function interleave(lists: ZimSearchHit[][], limit: number): ZimSearchHit[] {
  const out: ZimSearchHit[] = [];
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const l of lists) {
      if (i < l.length) {
        any = true;
        out.push(l[i]);
        if (out.length >= limit) break;
      }
    }
    if (!any) break;
  }
  return out;
}

function toHit(itemId: string, h: NativeZimHit, withSnippet = true): ZimSearchHit {
  const hit: ZimSearchHit = { itemId, path: h.path, title: decodeEntities(h.title) };
  // Title-index "snippets" just repeat the highlighted title: keep only full-text ones.
  if (withSnippet && h.snippet) {
    const snippet = stripTags(h.snippet);
    // Redirect/stub entries come back with the title as their only "snippet".
    if (snippet && snippet.toLowerCase() !== hit.title.toLowerCase()) hit.snippet = snippet;
  }
  if (typeof h.wordCount === 'number' && h.wordCount >= 0) hit.wordCount = h.wordCount;
  return hit;
}

/** Title suggestions (prefix / title index). Fast; use for search-as-you-type. */
export async function suggest(itemIds: string[], query: string, limit = 20): Promise<ZimSearchHit[]> {
  const q = query.trim();
  if (!q || !itemIds.length) return [];
  const lists = await Promise.all(
    itemIds.map(async (id) => {
      if (!(await ensureOpen(id))) return [];
      try {
        return (await NomadZim.suggest(id, q, limit)).map((h) => toHit(id, h, false));
      } catch {
        return [];
      }
    }),
  );
  return interleave(lists, limit);
}

/** Full-text search (Xapian). Falls back to suggestions when there is no full-text index. */
export async function search(itemIds: string[], query: string, limit = 20): Promise<ZimSearchHit[]> {
  const q = query.trim();
  if (!q || !itemIds.length) return [];
  const lists = await Promise.all(
    itemIds.map(async (id) => {
      const info = await ensureOpen(id);
      if (!info) return [];
      try {
        const hits = info.hasFulltextIndex ? await NomadZim.search(id, q, limit) : [];
        if (hits.length) return hits.map((h) => toHit(id, h));
        return (await NomadZim.suggest(id, q, limit)).map((h) => toHit(id, h, false));
      } catch {
        return [];
      }
    }),
  );
  return interleave(lists, limit);
}

/** Article as plain text (HTML stripped, whitespace collapsed), truncated to maxChars. */
export async function getArticleText(itemId: string, path: string, maxChars = 8000): Promise<{ title: string; text: string } | null> {
  const article = await getArticleHtml(itemId, path);
  if (!article) return null;
  const { title, text } = htmlToText(article.html, maxChars);
  return { title: decodeEntities(article.title) || title, text };
}

/** Raw HTML of an entry (redirects resolved). */
export async function getArticleHtml(itemId: string, path: string): Promise<{ title: string; html: string; path: string } | null> {
  if (!(await ensureOpen(itemId))) return null;
  try {
    const c = await NomadZim.getContent(itemId, path);
    if (!c || !c.mimeType.startsWith('text/html')) return null;
    return { title: c.title, html: c.content, path: c.path };
  } catch {
    return null;
  }
}

/** Internal article links in document order (used to build course syllabi). */
export async function getLinks(itemId: string, path: string): Promise<ZimLink[]> {
  const article = await getArticleHtml(itemId, path);
  if (!article) return [];
  return extractLinks(article.html, article.path);
}

/** Linkable section headings of an article (table of contents). */
export async function getHeadings(itemId: string, path: string): Promise<Heading[]> {
  const article = await getArticleHtml(itemId, path);
  return article ? extractHeadings(article.html) : [];
}

export async function getMainPath(itemId: string): Promise<string | null> {
  const info = await ensureOpen(itemId);
  if (!info) return null;
  try {
    return (await NomadZim.getMainPath(itemId)) ?? info.mainPath;
  } catch {
    return info.mainPath;
  }
}

export async function randomPath(itemId: string): Promise<string | null> {
  if (!(await ensureOpen(itemId))) return null;
  try {
    return await NomadZim.randomPath(itemId);
  } catch {
    return null;
  }
}

/** Cached info of an archive opened in this session, if any. */
export function getOpenInfo(itemId: string): ZimInfo | null {
  return infos.get(itemId) ?? null;
}

/** iOS: excludes a file or directory from iCloud backup. No-op elsewhere. */
export async function excludeFromBackup(fileUri: string): Promise<boolean> {
  if (!isNomadZimAvailable()) return false;
  try {
    return await NomadZim.excludeFromBackup(toNativePath(fileUri));
  } catch {
    return false;
  }
}

/** Opens an installed archive (lazy helper for screens). */
export function ensureArchive(itemId: string): Promise<ZimInfo | null> {
  return ensureOpen(itemId);
}
