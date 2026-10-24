// Retrieval-augmented generation over the installed ZIM library.
// question → keyword queries → libzim full-text search across archives →
// fetch top articles → chunk → BM25 over chunks → pack best chunks within the
// model's context budget → numbered-source prompt asking for [n] citations.
import { listItems } from '@/features/content/items';
import { getArticleText, search, type ZimSearchHit } from '@/features/library/zim';

import {
  buildRagUserMessage,
  buildSearchQueries,
  chunkText,
  packContext,
  rankChunks,
  type Chunk,
  type Lang,
  type PackedSource,
  type SourceRef,
} from './rag-core';

export type RagSource = SourceRef;

export type RetrievalResult = {
  /** No ZIM archives installed at all. */
  noLibrary: boolean;
  sources: PackedSource[];
  /** The final user turn to send to the model. */
  userMessage: string;
};

const HITS_PER_QUERY = 8;
const MAX_ARTICLES = 6;
const ARTICLE_CHARS = 9000;
const CHUNK_SIZE = 650;
const CHUNK_OVERLAP = 120;

const keyOf = (itemId: string, path: string) => `${itemId}\u0000${path}`;

export function libraryItemIds(): string[] {
  return listItems('zim').map((i) => i.id);
}

/** Reciprocal-rank fusion of the hit lists of several queries. */
function fuseHits(lists: ZimSearchHit[][]): ZimSearchHit[] {
  const score = new Map<string, { hit: ZimSearchHit; s: number }>();
  lists.forEach((hits, qi) => {
    hits.forEach((hit, rank) => {
      const k = keyOf(hit.itemId, hit.path);
      // Earlier (more specific) queries weigh a bit more.
      const add = 1 / (60 + rank) + (qi === 0 ? 0.002 : 0);
      const prev = score.get(k);
      if (prev) prev.s += add;
      else score.set(k, { hit, s: add });
    });
  });
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => x.hit);
}

export async function retrieve(question: string, lang: Lang, budgetChars: number, itemIds = libraryItemIds()): Promise<RetrievalResult> {
  if (!itemIds.length) return { noLibrary: true, sources: [], userMessage: buildRagUserMessage(question, [], lang) };

  const queries = buildSearchQueries(question);
  const lists = await Promise.all(queries.map((q) => search(itemIds, q, HITS_PER_QUERY).catch(() => [] as ZimSearchHit[])));
  const hits = fuseHits(lists).slice(0, MAX_ARTICLES);

  const refs = new Map<string, SourceRef>();
  const chunks: Chunk[] = [];
  const articles = await Promise.all(
    hits.map(async (h) => ({ hit: h, article: await getArticleText(h.itemId, h.path, ARTICLE_CHARS).catch(() => null) })),
  );
  for (const [hitRank, { hit, article }] of articles.entries()) {
    const text = article?.text || hit.snippet;
    if (!text) continue;
    const title = article?.title || hit.title;
    const key = keyOf(hit.itemId, hit.path);
    refs.set(key, { itemId: hit.itemId, path: hit.path, title });
    chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP).forEach((c, index) => chunks.push({ sourceKey: key, title, text: c, index, hitRank }));
  }

  let ranked = rankChunks(question, chunks, 16);
  // The search engine matched (stemming, synonyms, other language) but no chunk
  // shares a term with the question: fall back to the article leads, in hit order.
  if (!ranked.length && chunks.length) {
    ranked = chunks.filter((c) => c.index === 0).map((c, i) => ({ item: c, score: 1 / (i + 1) }));
  }
  const { sources } = packContext(ranked, (k) => refs.get(k), budgetChars, 3);
  return { noLibrary: false, sources, userMessage: buildRagUserMessage(question, sources, lang) };
}
