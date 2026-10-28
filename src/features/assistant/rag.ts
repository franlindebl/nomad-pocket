// Retrieval-augmented generation over the installed ZIM library.
// question (or the model's own query) → keyword queries → libzim full-text search
// across archives, plus articles named after the question (exact path), plus passages of the
// archives' PDF documents (the library's document index) and the user's family plan → fetch
// top articles → chunk →
// BM25 over chunks and passages → drop chunks that barely share terms with the question →
// pack the best within the model's context budget → numbered sources, cited as [n].
import { getItem, listItems } from '@/features/content/items';
import { searchDocuments, type DocHit } from '@/features/library/documents';
import { getArticleHtml, getArticleText, search, type ZimSearchHit } from '@/features/library/zim';
import { PLAN_SOURCE, planPassages } from '@/features/prepare/passages';
import { usePrepare } from '@/features/prepare/store';

import {
  buildRagUserMessage,
  buildTitleCandidates,
  chunkText,
  planRetrieval,
  readableDocTitle,
  packContext,
  rankChunks,
  relevantChunks,
  type Chunk,
  type Lang,
  type PackedSource,
  type SourceRef,
  type Turn,
} from './rag-core';

export type RetrievalResult = {
  /** No ZIM archives installed at all. */
  noLibrary: boolean;
  sources: PackedSource[];
  /** The final user turn to send to the model. */
  userMessage: string;
};

const HITS_PER_QUERY = 8;
/** Hits read to find MAX_ARTICLES distinct articles (several hits can redirect to one). */
const MAX_HITS = 12;
const MAX_ARTICLES = 6;
const ARTICLE_CHARS = 9000;
const CHUNK_SIZE = 650;
const CHUNK_OVERLAP = 120;
/** Articles titled after the question go before the full-text hits (one hit high in every query scores ~0.05). */
const TITLE_BONUS = 0.1;
/** Passages of PDF documents (guides, manuals) ranked with the article chunks. */
const DOC_PASSAGES = 8;

const keyOf = (itemId: string, path: string) => `${itemId}\u0000${path}`;

export function libraryItemIds(): string[] {
  return listItems('zim').map((i) => i.id);
}

/** Reciprocal-rank fusion of the hit lists of several queries, each with a bonus for its hits. */
function fuseHits(lists: { hits: ZimSearchHit[]; bonus: number }[]): ZimSearchHit[] {
  const score = new Map<string, { hit: ZimSearchHit; s: number }>();
  lists.forEach(({ hits, bonus }) => {
    hits.forEach((hit, rank) => {
      const k = keyOf(hit.itemId, hit.path);
      const add = 1 / (60 + rank) + bonus;
      const prev = score.get(k);
      if (prev) prev.s += add;
      else score.set(k, { hit, s: add });
    });
  });
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => x.hit);
}

/** Articles whose path is one of the titles ("First aid" → First_aid), redirects resolved, in title order. */
async function titleHits(itemIds: string[], titles: string[]): Promise<ZimSearchHit[]> {
  const found = await Promise.all(
    titles.map((t) =>
      Promise.all(itemIds.map(async (itemId) => ({ itemId, a: await getArticleHtml(itemId, t.replace(/ /g, '_')).catch(() => null) }))),
    ),
  );
  return found.flat().flatMap(({ itemId, a }) => (a ? [{ itemId, path: a.path, title: a.title }] : []));
}

/** The first alternative of each group that some archive has ("Burn" before "Burns", a surname page). */
async function firstTitleHits(itemIds: string[], groups: string[][]): Promise<ZimSearchHit[]> {
  const found = await Promise.all(
    groups.map(async (alts) => {
      for (const t of alts) {
        const hits = await titleHits(itemIds, [t]);
        if (hits.length) return hits;
      }
      return [];
    }),
  );
  return found.flat();
}

export type RetrieveOptions = {
  /** Earlier turns, to fill in the topic of a follow-up question. */
  history?: Turn[];
  /** Search keywords chosen by the model (tool call / router); replaces the question's. */
  query?: string;
  itemIds?: string[];
};

export async function retrieve(question: string, lang: Lang, budgetChars: number, opts: RetrieveOptions = {}): Promise<RetrievalResult> {
  const itemIds = opts.itemIds ?? libraryItemIds();
  if (!itemIds.length) return { noLibrary: true, sources: [], userMessage: buildRagUserMessage(question, [], lang) };

  const history = opts.history ?? [];
  // A model's query in another language than the question ("purificación de agua" for an English
  // question, "meeting point" for a Spanish one) finds nothing in that library: planRetrieval
  // keeps the question's own words whenever the query isn't positively in its language.
  const { queries, rankText, relevanceTexts } = planRetrieval(question, history, lang, opts.query);
  const [first, second] = buildTitleCandidates(relevanceTexts[0]);
  const [lists, titled, passages] = await Promise.all([
    Promise.all(queries.map((q) => search(itemIds, q, HITS_PER_QUERY).catch(() => [] as ZimSearchHit[]))),
    titleHits(itemIds, first).then(async (hits) => (hits.length ? hits : firstTitleHits(itemIds, second))),
    searchDocuments(itemIds, queries, DOC_PASSAGES).catch(() => [] as DocHit[]),
  ]);
  const hits = fuseHits([
    { hits: titled, bonus: TITLE_BONUS },
    // Earlier (more specific) queries weigh a bit more.
    ...lists.map((hits, qi) => ({ hits, bonus: qi === 0 ? 0.002 : 0 })),
  ]).slice(0, MAX_HITS);

  const refs = new Map<string, SourceRef>();
  const chunks: Chunk[] = [];
  const articles = await Promise.all(
    hits.map(async (h) => ({ hit: h, article: await getArticleText(h.itemId, h.path, ARTICLE_CHARS).catch(() => null) })),
  );
  const named = new Set(titled.map((h) => keyOf(h.itemId, h.path)));
  for (const { hit, article } of articles) {
    if (refs.size >= MAX_ARTICLES) break;
    const text = article?.text || hit.snippet;
    if (!text) continue;
    // Redirect pages ("Prince Michael Jackson" → "Michael Jackson") count once, as their target.
    const path = article?.path ?? hit.path;
    const key = keyOf(hit.itemId, path);
    if (refs.has(key)) continue;
    const title = article?.title || hit.title;
    const hitRank = refs.size;
    refs.set(key, { itemId: hit.itemId, path, title });
    chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP).forEach((c, index) => chunks.push({ sourceKey: key, title, text: c, index, hitRank, named: named.has(key) }));
  }

  // A document passage is its own source per page, so its citation says where to look.
  passages.forEach((p, rank) => {
    const key = `${keyOf(p.itemId, p.path)}\u0000${p.page}`;
    if (!refs.has(key)) refs.set(key, { itemId: p.itemId, path: p.path, title: readableDocTitle(p.title, getItem(p.itemId)?.title ?? ''), page: p.page });
    // Distinct indexes (packContext keeps one chunk per index): a page can give two passages.
    chunks.push({ sourceKey: key, title: p.title, text: p.text, index: 1 + rank, hitRank: rank });
  });

  // The family plan (meeting points, contacts, health, home notes) competes like any source.
  for (const p of planPassages(usePrepare.getState(), lang)) {
    const key = `${PLAN_SOURCE}\u0000${p.section}`;
    refs.set(key, { itemId: PLAN_SOURCE, path: p.section, title: p.title });
    chunks.push({ sourceKey: key, title: p.title, text: p.text, index: 0 });
  }

  let ranked = rankChunks(rankText, chunks, 16);
  if (ranked.length) {
    // Chunks that only share a word or two with a longer question are about something else.
    ranked = relevantChunks(relevanceTexts, ranked);
  } else if (chunks.length) {
    // The search engine matched (stemming, synonyms, other language) but no chunk
    // shares a term with the question: fall back to the article leads, in hit order.
    ranked = chunks.filter((c) => c.index === 0).map((c, i) => ({ item: c, score: 1 / (i + 1) }));
  }
  const { sources } = packContext(ranked, (k) => refs.get(k), budgetChars, 3);
  // Found, but nothing fits the budget (a very long question): don't claim the library has nothing.
  if (!sources.length && ranked.length) return { noLibrary: false, sources, userMessage: question };
  return { noLibrary: false, sources, userMessage: buildRagUserMessage(question, sources, lang) };
}
