// Offline bench of the assistant: the app's retrieval (rag.ts, mirrored) with the real pure
// modules (rag-core, html, documents-core) over a libzim HTTP server and the app's own
// search.db, and the GGUF answer flow of chats.ts + engine.ts (tools mode, two passes)
// against llama-server. Usage:
//   node --experimental-strip-types bench.ts <out.jsonl> [ids…] [--retrieval-only] [--v2] [--sources] [--zim=URL] [--llm=URL] [--db=search.db]
// README.md has the setup (servers, data) and every flag.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const APP = new URL('../../src', import.meta.url).pathname;
const rc = await import(`${APP}/features/assistant/rag-core.ts`);
const html = await import(`${APP}/features/library/html.ts`);
const dc = await import(`${APP}/features/library/documents-core.ts`);

const args = process.argv.slice(2);
const flag = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = args[0];
const ONLY = args.slice(1).filter((a) => !a.startsWith('--')).map(Number);
const RETRIEVAL_ONLY = args.includes('--retrieval-only');
const ZIM = flag('zim', 'http://127.0.0.1:8899');
const LLM = flag('llm', 'http://127.0.0.1:8080');
const DB = flag('db', `${import.meta.dirname}/search.db`);
const QFILE = flag('questions', `${import.meta.dirname}/questions.json`);
const CTX = Number(flag('ctx', '6144'));
const SOURCES_MODE = args.includes('--sources'); // Apple-style: always search, sources in the user turn

// ---------------------------------------------------------------- zim facade (zim.ts)
const get = async (p: string) => (await fetch(ZIM + p)).json();
const ids: Record<string, { fulltext: boolean }> = await get('/ids');
// The app searches archives in listItems order (installed_at DESC): newest first. Extras were installed last.
const APP_ORDER = ['wikipedia_es_all_nopic', 'zimgit-post-disaster_en', 'foss.cooking_en_all', 'wikipedia_es_medicine_nopic', 'irp.fas.org_en_military-medicine', 'zimgit-food-preparation_en', 'based.cooking_en_all', 'zimgit-knots_en', 'zimgit-water_en', 'wwwnc.cdc.gov_en_all', 'zimgit-medicine_en', 'scoutwiki.org_es_all_maxi', 'nhs.uk_en_medicines'];
const rank = (id: string) => { const i = APP_ORDER.indexOf(id); return i < 0 ? -1 : i; };
const itemIds = Object.keys(ids).sort((a, b) => rank(a) - rank(b));

type Hit = { itemId: string; path: string; title: string; snippet?: string };
function interleave(lists: Hit[][], limit: number): Hit[] {
  const out: Hit[] = [];
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const l of lists) if (i < l.length) { any = true; out.push(l[i]); if (out.length >= limit) break; }
    if (!any) break;
  }
  return out;
}
async function search(items: string[], query: string, limit: number, perArchive = limit): Promise<Hit[]> {
  const q = query.trim();
  if (!q) return [];
  const lists = await Promise.all(items.map(async (id) => {
    const enc = `id=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&limit=${perArchive}`;
    let hits: { path: string; title: string }[] = ids[id].fulltext ? await get(`/search?${enc}`) : [];
    if (!hits?.length) hits = (await get(`/suggest?${enc}`)) ?? [];
    return hits.map((h) => ({ itemId: id, path: h.path, title: html.decodeEntities(h.title) }));
  }));
  return interleave(lists, limit);
}
async function getArticleHtml(itemId: string, path: string) {
  let target = path;
  for (let hop = 0; hop < 4; hop++) {
    const c = await get(`/content?id=${encodeURIComponent(itemId)}&path=${encodeURIComponent(target)}`);
    if (!c || !c.content || !c.mimeType.startsWith('text/html')) return null;
    const next = html.metaRefreshTarget(c.content, c.path);
    if (!next || next === c.path || hop === 3) return { title: c.title, html: c.content, path: c.path };
    target = next;
  }
  return null;
}
async function getArticleText(itemId: string, path: string, maxChars: number) {
  const a = await getArticleHtml(itemId, path);
  if (!a) return null;
  const { title, text } = html.htmlToText(a.html, maxChars);
  return { title: html.decodeEntities(a.title) || title, text, path: a.path };
}

// ---------------------------------------------------------------- documents (documents.ts)
const db = existsSync(DB) ? new DatabaseSync(DB, { readOnly: true }) : null;
const sql = {
  run: async () => {},
  all: async (q: string, p: Record<string, unknown> = {}) => db!.prepare(q).all(p as never) as never,
};
async function searchDocuments(items: string[], queries: string[], limit: number) {
  if (!db || !queries.length) return [];
  const lists = await Promise.all([
    dc.searchPassages(sql, queries[0], items, limit * 2, 'all').catch(() => []),
    dc.searchPassages(sql, queries.join(' '), items, limit * 2, 'any').catch(() => []),
  ]);
  return dc.fusePassages(lists, limit);
}
const titles: Record<string, string> = {};

// ---------------------------------------------------------------- retrieve (rag.ts)
const HITS_PER_ARCHIVE = 3, MAX_HITS = 18, MAX_ARTICLES = 8, ARTICLE_CHARS = 9000, CHUNK_SIZE = 650, CHUNK_OVERLAP = 120, TITLE_BONUS = 0.1, DOC_PASSAGES = 8;
const keyOf = (i: string, p: string) => `${i}\u0000${p}`;
function fuseHits(lists: { hits: Hit[]; bonus: number }[]): Hit[] {
  const score = new Map<string, { hit: Hit; s: number }>();
  lists.forEach(({ hits, bonus }) => hits.forEach((hit, rank) => {
    const k = keyOf(hit.itemId, hit.path);
    const add = 1 / (60 + rank) + bonus;
    const prev = score.get(k);
    if (prev) prev.s += add; else score.set(k, { hit, s: add });
  }));
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => x.hit);
}
async function titleHits(items: string[], ts: string[]): Promise<Hit[]> {
  const found = await Promise.all(ts.map((t) => Promise.all(items.map(async (itemId) => ({ itemId, a: await getArticleHtml(itemId, t.replace(/ /g, '_')).catch(() => null) })))));
  return found.flat().flatMap(({ itemId, a }) => (a ? [{ itemId, path: a.path, title: a.title }] : []));
}
async function firstTitleHits(items: string[], groups: string[][]): Promise<Hit[]> {
  const found = await Promise.all(groups.map(async (alts) => {
    for (const t of alts) { const h = await titleHits(items, [t]); if (h.length) return h; }
    return [];
  }));
  return found.flat();
}
export async function retrieve(question: string, lang: 'es' | 'en', budgetChars: number, query?: string) {
  const { queries, rankText, relevanceTexts } = rc.planRetrieval(question, [], lang, query);
  const [first, second] = rc.buildTitleCandidates(relevanceTexts[0]);
  const [lists, titled, passages] = await Promise.all([
    Promise.all(queries.map((q: string) => search(itemIds, q, itemIds.length * HITS_PER_ARCHIVE, HITS_PER_ARCHIVE).catch(() => [] as Hit[]))),
    titleHits(itemIds, first).then(async (h) => (h.length ? h : firstTitleHits(itemIds, second))),
    searchDocuments(itemIds, queries, DOC_PASSAGES),
  ]);
  const hits = fuseHits([{ hits: titled, bonus: TITLE_BONUS }, ...lists.map((hits: Hit[], qi: number) => ({ hits, bonus: qi === 0 ? 0.002 : 0 }))]).slice(0, MAX_HITS);
  const refs = new Map<string, { itemId: string; path: string; title: string; page?: number }>();
  const chunks: any[] = [];
  const articles = await Promise.all(hits.map(async (h) => ({ hit: h, article: await getArticleText(h.itemId, h.path, ARTICLE_CHARS).catch(() => null) })));
  const named = new Set(titled.map((h) => keyOf(h.itemId, h.path)));
  const seenTitles = new Set<string>();
  for (const { hit, article } of articles) {
    if (refs.size >= MAX_ARTICLES) break;
    const text = article?.text || hit.snippet;
    if (!text) continue;
    const path = article?.path ?? hit.path;
    const key = keyOf(hit.itemId, path);
    if (refs.has(key)) continue;
    const title = article?.title || hit.title;
    if (seenTitles.has(rc.normalize(title))) continue;
    seenTitles.add(rc.normalize(title));
    const hitRank = refs.size;
    refs.set(key, { itemId: hit.itemId, path, title });
    rc.chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP).forEach((c: string, index: number) => chunks.push({ sourceKey: key, title, text: c, index, hitRank, named: named.has(key) }));
  }
  passages.forEach((p: any, rank: number) => {
    const key = `${keyOf(p.itemId, p.path)}\u0000${p.page}`;
    if (!refs.has(key)) refs.set(key, { itemId: p.itemId, path: p.path, title: rc.readableDocTitle(p.title, titles[p.itemId] ?? ''), page: p.page });
    chunks.push({ sourceKey: key, title: p.title, text: p.text, index: 1 + rank, hitRank: rank });
  });
  let ranked = rc.rankChunks(rankText, chunks, 16);
  if (ranked.length) ranked = rc.relevantChunks(relevanceTexts, ranked);
  else if (chunks.length) ranked = chunks.filter((c) => c.index === 0).map((c, i) => ({ item: c, score: 1 / (i + 1) }));
  const { sources } = rc.packContext(ranked, (k: string) => refs.get(k), budgetChars, 3);
  const candidates = [...refs.values()].map((r) => `${r.itemId} · ${r.title}${r.page ? ` p.${r.page}` : ''}`);
  if (!sources.length && ranked.length) return { sources, userMessage: question, overflow: true, queries, candidates };
  return { sources, userMessage: rc.buildRagUserMessage(question, sources, lang), queries, candidates };
}


// ---------------------------------------------------------------- v2 retrieval (experiment)
// Bilingual: the question's words for archives in its language, an English query for English ones;
// one copy of an article found in two archives (medicine Wikipedia ⊂ full Wikipedia); chunks
// reranked by a small multilingual embedding model (no index: only the candidates are embedded).
const V2 = args.includes('--v2');
const EMB = flag('emb', 'http://127.0.0.1:8081');
const EXTRA_LANG: Record<string, string> = { 'ready.gov_es_all': 'es', 'medlineplus.gov_es_all': 'es', nomad_guide_es: 'es', nomad_guide_en: 'en' };
const catalogRes = JSON.parse(readFileSync(`${APP}/data/catalog.json`, 'utf8')).resources;
const langOf = (id: string) => EXTRA_LANG[id] ?? (id.startsWith('wikipedia_es') ? 'es' : catalogRes[id]?.language ?? 'en');
const normTitle = (t: string) => rc.normalize(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function embed(texts: string[]): Promise<number[][]> {
  const r = await fetch(`${EMB}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: texts }) });
  const j: any = await r.json();
  return j.data.map((d: any) => { const v = d.embedding as number[]; const n = Math.hypot(...v) || 1; return v.map((x) => x / n); });
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const RERANK_POOL = Number(flag('pool', '40'));
const V2_ARTICLES = Number(flag('articles', '10'));
const MIN_COS = Number(flag('mincos', '0.45'));

const PER_ARCHIVE = Number(flag('per-archive', '3'));
/** Every archive's best hits (not the first archives' only): Xapian scores aren't comparable, the rerank orders them. */
async function searchAll(items: string[], q: string): Promise<Hit[]> {
  const lists = await Promise.all(items.map((id) => search([id], q, PER_ARCHIVE).catch(() => [] as Hit[])));
  return interleave(lists, PER_ARCHIVE * items.length);
}
async function gather(items: string[], lang: 'es' | 'en', question: string, query: string | undefined, seenTitles: Set<string>) {
  if (!items.length) return { chunks: [] as any[], refs: new Map<string, any>() };
  const { queries, rankText, relevanceTexts } = rc.planRetrieval(question, [], lang, query);
  const [first, second] = rc.buildTitleCandidates(relevanceTexts[0]);
  const [lists, titled, passages] = await Promise.all([
    Promise.all(queries.map((q: string) => searchAll(items, q))),
    titleHits(items, first).then(async (h) => (h.length ? h : firstTitleHits(items, second))),
    searchDocuments(items, queries, DOC_PASSAGES),
  ]);
  const hits = fuseHits([{ hits: titled, bonus: TITLE_BONUS }, ...lists.map((hits: Hit[], qi: number) => ({ hits, bonus: qi === 0 ? 0.002 : 0 }))]).slice(0, V2_ARTICLES * 2);
  const refs = new Map<string, any>();
  const chunks: any[] = [];
  const articles = await Promise.all(hits.map(async (h) => ({ hit: h, article: await getArticleText(h.itemId, h.path, ARTICLE_CHARS).catch(() => null) })));
  const named = new Set(titled.map((h) => keyOf(h.itemId, h.path)));
  let n = 0;
  for (const { hit, article } of articles) {
    if (n >= V2_ARTICLES) break;
    const text = article?.text || hit.snippet;
    if (!text) continue;
    const path = article?.path ?? hit.path;
    const key = keyOf(hit.itemId, path);
    const title = article?.title || hit.title;
    if (refs.has(key) || seenTitles.has(normTitle(title))) continue;
    seenTitles.add(normTitle(title));
    const hitRank = n++;
    refs.set(key, { itemId: hit.itemId, path, title });
    rc.chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP).forEach((c: string, index: number) => chunks.push({ sourceKey: key, title, text: c, index, hitRank, named: named.has(key) }));
  }
  passages.forEach((p: any, rank: number) => {
    const key = `${keyOf(p.itemId, p.path)}\u0000${p.page}`;
    if (!refs.has(key)) refs.set(key, { itemId: p.itemId, path: p.path, title: rc.readableDocTitle(p.title, ''), page: p.page });
    chunks.push({ sourceKey: key, title: p.title, text: p.text, index: 1 + rank, hitRank: rank });
  });
  // Lexical preselection in the group's own language, then the semantic rerank decides.
  let ranked = rc.rankChunks(rankText, chunks, RERANK_POOL);
  if (!ranked.length) ranked = chunks.filter((c) => c.index === 0).map((c, i) => ({ item: c, score: 1 / (i + 1) }));
  return { chunks: ranked.map((r: any) => r.item), refs, queries };
}

export async function retrieve2(question: string, lang: 'es' | 'en', budgetChars: number, query?: string, queryEn?: string) {
  const byLang = { es: itemIds.filter((i) => langOf(i) === 'es'), en: itemIds.filter((i) => langOf(i) !== 'es') };
  const seen = new Set<string>();
  const own = lang === 'es' ? await gather(byLang.es, 'es', question, query, seen) : { chunks: [], refs: new Map(), queries: [] };
  const enQ = lang === 'en' ? query : queryEn;
  const en = lang === 'en' || enQ ? await gather(byLang.en, 'en', lang === 'en' ? question : enQ!, lang === 'en' ? query : undefined, seen) : { chunks: [], refs: new Map(), queries: [] };
  const refs = new Map([...own.refs, ...en.refs]);
  const pool = [...own.chunks, ...en.chunks];
  if (!pool.length) return { sources: [], userMessage: question, queries: [own.queries, en.queries], candidates: [] };
  const [qv, ...cv] = await embed([`task: search result | query: ${question}`, ...pool.map((c) => `title: ${c.title} | text: ${c.text}`)]);
  const scored = pool.map((c, i) => ({ item: c, score: dot(qv, cv[i]) })).sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const kept = scored.filter((s) => s.score >= MIN_COS && s.score >= best - 0.12);
  const { sources } = rc.packContext(kept, (k: string) => refs.get(k), budgetChars, 3);
  const candidates = scored.slice(0, 12).map((s) => `${s.score.toFixed(2)} ${s.item.title}`);
  if (!sources.length) return { sources, userMessage: question, queries: [own.queries, en.queries], candidates };
  return { sources, userMessage: rc.buildRagUserMessage(question, sources, lang), queries: [own.queries, en.queries], candidates };
}

function toolSpecV2(lang: 'es' | 'en') {
  const spec: any = rc.searchToolSpec(lang);
  if (lang === 'es') {
    spec.function.parameters.properties.query_en = { type: 'string', description: 'Las mismas palabras clave traducidas al inglés (muchas guías están en inglés), ej. "hypothermia treatment".' };
    spec.function.parameters.required = ['query', 'query_en'];
  }
  return spec;
}

// ---------------------------------------------------------------- llama-server
const SAMPLING = { temperature: 0.5, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.05 };
async function chat(body: object) {
  const r = await fetch(`${LLM}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...SAMPLING, ...body }) });
  const j: any = await r.json();
  if (!j.choices) throw new Error(JSON.stringify(j).slice(0, 400));
  return j.choices[0].message as { content?: string; reasoning_content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
}

const MAX_ANSWER_TOKENS = Number(flag('answer-tokens', '768')), TOOL_PROMPT_TOKENS = 380;
const ROUTES: Record<number, any> = {};
if (flag('routes', '')) for (const l of readFileSync(flag('routes', ''), 'utf8').trim().split('\n')) { const r = JSON.parse(l); ROUTES[r.id] = r; }
const EMIT = flag('emit', '');
async function answer(text: string, qid = 0) {
  const lang: 'es' | 'en' = rc.detectLanguage(text, 'es');
  const health = rc.isHealthQuestion(text);
  const intent = rc.guessIntent(text, []);
  const mode = intent === 'chat' ? 'chat' : SOURCES_MODE ? 'sources' : 'tools';
  const sys = rc.systemPrompt(lang, mode, { health, library: true, noHealth: false });
  const questionTokens = rc.estimateTokens(mode === 'sources' ? rc.ragMessageFrame(text, lang) : text);
  const free = CTX - MAX_ANSWER_TOKENS - rc.estimateTokens(sys) - questionTokens - (mode === 'tools' ? TOOL_PROMPT_TOKENS : 0) - 120;
  const budget = rc.tokensToChars(free);
  const rec: any = { lang, health, intent, mode, budget };
  const t0 = Date.now();
  if (RETRIEVAL_ONLY) {
    const r: any = V2 ? await retrieve2(text, lang, budget, undefined, flag('qen', '') || undefined) : await retrieve(text, lang, budget);
    Object.assign(rec, { queries: r.queries, candidates: r.candidates, sources: r.sources.map((s: any) => `${s.itemId} · ${s.title}${s.page ? ` p.${s.page}` : ''}`), context: r.userMessage });
    return rec;
  }
  const messages: any[] = [{ role: 'system', content: sys }, { role: 'user', content: text }];
  if (mode === 'sources') {
    const route = ROUTES[qid];
    const r: any = V2 ? await retrieve2(text, lang, budget, route?.query?.trim() || undefined, route?.query_en?.trim() || undefined) : await retrieve(text, lang, budget, route?.query?.trim() || undefined);
    rec.routerQuery = route?.query ?? route?.error;
    if (EMIT) {
      const prompt = !r.sources.length && !r.overflow ? null : r.userMessage;
      appendFileSync(EMIT, JSON.stringify({ id: qid, system: r.sources.length ? sys : rc.systemPrompt(lang, 'chat', { health, library: true }), prompt }) + '\n');
      return { ...rec, queries: r.queries, sources: r.sources.map((s: any) => `${s.itemId} · ${s.title}${s.page ? ` p.${s.page}` : ''}`), answer: prompt ? '(emitted)' : rc.NOT_FOUND_ANSWER[lang] };
    }
    Object.assign(rec, { queries: r.queries, sources: r.sources.map((s: any) => `${s.itemId} · ${s.title}${s.page ? ` p.${s.page}` : ''}`), context: r.userMessage });
    if (!r.sources.length && !r.overflow) return { ...rec, answer: rc.NOT_FOUND_ANSWER[lang], ms: Date.now() - t0 };
    messages[1].content = r.userMessage;
    const m = await chat({ messages, max_tokens: MAX_ANSWER_TOKENS, chat_template_kwargs: { enable_thinking: false } });
    return { ...rec, answer: rc.guardNotFound(rc.stripThinking(m.content ?? ''), lang), ms: Date.now() - t0 };
  }
  if (mode === 'chat') {
    const m = await chat({ messages, max_tokens: MAX_ANSWER_TOKENS, chat_template_kwargs: { enable_thinking: false } });
    return { ...rec, answer: m.content, ms: Date.now() - t0 };
  }
  const tool = V2 ? toolSpecV2(lang) : rc.searchToolSpec(lang);
  const first = await chat({ messages, tools: [tool], tool_choice: 'auto', max_tokens: MAX_ANSWER_TOKENS, chat_template_kwargs: { enable_thinking: true } });
  rec.reasoning = first.reasoning_content;
  const call = first.tool_calls?.[0];
  if (!call) return { ...rec, toolCalled: false, answer: rc.guardNotFound(rc.stripThinking(first.content ?? ''), lang), ms: Date.now() - t0 };
  let query = rc.parseToolQuery(call.function.arguments);
  let queryEn: string | undefined;
  try { const a = JSON.parse(call.function.arguments); if (typeof a.query === 'string') query = a.query.trim(); if (typeof a.query_en === 'string') queryEn = a.query_en.trim(); } catch {}
  rec.queryEn = queryEn;
  const r: any = V2 ? await retrieve2(text, lang, budget, query || undefined, queryEn) : await retrieve(text, lang, budget, query || undefined);
  Object.assign(rec, { toolCalled: true, toolQuery: query, queries: r.queries, sources: r.sources.map((s: any) => `${s.itemId} · ${s.title}${s.page ? ` p.${s.page}` : ''}`), context: r.userMessage });
  if (!r.sources.length && !r.overflow) return { ...rec, answer: rc.NOT_FOUND_ANSWER[lang], ms: Date.now() - t0 };
  const id = call.id || 'call_0';
  const second = await chat({
    messages: [...messages, { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: call.function }] }, { role: 'tool', tool_call_id: id, name: rc.SEARCH_TOOL_NAME, content: rc.buildToolResult(r.sources, lang) }],
    tools: [tool], tool_choice: 'none', max_tokens: MAX_ANSWER_TOKENS, chat_template_kwargs: { enable_thinking: false },
  });
  return { ...rec, answer: rc.guardNotFound(rc.stripToolCalls(rc.stripThinking(second.content ?? '')), lang), ms: Date.now() - t0 };
}

const questions: { id: number; cat: string; q: string }[] = JSON.parse(readFileSync(QFILE, 'utf8'));
for (const q of questions) {
  if (ONLY.length && !ONLY.includes(q.id)) continue;
  try {
    const rec = await answer(q.q, q.id);
    appendFileSync(OUT, JSON.stringify({ ...q, ...rec }) + '\n');
    console.log(`#${q.id} ${rec.ms ?? ''}ms q=${rec.toolQuery ?? ''} src=${(rec.sources ?? []).length} :: ${(rec.answer ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
  } catch (e) {
    console.log(`#${q.id} ERROR ${e}`);
    appendFileSync(OUT, JSON.stringify({ ...q, error: String(e) }) + '\n');
  }
}
