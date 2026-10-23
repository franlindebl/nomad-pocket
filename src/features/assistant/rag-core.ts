// Pure retrieval helpers for the assistant's RAG over the offline library:
// tokenizer, light stemming, chunking, BM25 ranking, context packing and prompt
// construction. No React Native or `@/` imports so `node --test` can load it.

export type Lang = 'es' | 'en';

// ---------------------------------------------------------------------------
// Tokenizer

const STOPWORDS_ES = new Set(
  (
    'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada casi como con contra cual cuales cuando cuanto cuanta de del desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estan estar este esto estos fue fueron ha habia han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otras otro otros para pero poco por porque puede pueden que quien quienes se ser si sin sobre son su sus tambien tan tanto te tiene tienen todo todos tu tus un una unas uno unos usted y ya yo hacer hago hace cosa cosas debo debe deberia puedo quiero saber explica explicame dime cual cuales sirve sirven mejor forma manera'
  ).split(' '),
);

const STOPWORDS_EN = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours tell explain please best way ways thing things know get make need want much many'
  ).split(' '),
);

/** Lowercase and strip diacritics ("Canción" → "cancion"). */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Raw words (normalized), no stopword removal. */
export function words(text: string): string[] {
  return normalize(text).match(WORD_RE) ?? [];
}

export function isStopword(word: string): boolean {
  return STOPWORDS_ES.has(word) || STOPWORDS_EN.has(word);
}

/**
 * Light suffix stemmer shared by Spanish and English: enough to match
 * plurals and common derivations ("quemaduras" ~ "quemadura", "boiling" ~ "boil").
 */
export function stem(word: string): string {
  if (word.length <= 3 || /^\d+$/.test(word)) return word;
  // Each step applies at most one rule and never leaves fewer than 3 letters.
  const steps: [RegExp, string][][] = [
    // Derivational suffixes.
    [
      [/(?:aciones|acion)$/, 'ac'],
      [/(?:iciones|icion)$/, 'ic'],
      [/(?:ciones|cion)$/, 'c'],
      [/mente$/, ''],
      [/(?:ization|isation)s?$/, 'iz'],
      [/ations?$/, 'at'],
      [/(?:ingly|edly)$/, ''],
      [/ing$/, ''],
      [/ed$/, ''],
    ],
    // Plurals.
    [
      [/ies$/, 'y'],
      [/ces$/, 'z'],
      [/([^aeiou])es$/, '$1'],
      [/([^s])s$/, '$1'],
    ],
    // Gender / final vowel (es: "herido"/"herida", en: "fire"/"fires").
    [[/[aeo]$/, '']],
  ];
  let w = word;
  for (const rules of steps) {
    for (const [re, rep] of rules) {
      if (!re.test(w)) continue;
      const out = w.replace(re, rep);
      if (out.length >= 3) w = out;
      break;
    }
  }
  return w;
}

/** Content tokens for ranking: normalized, stopwords removed, stemmed. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (w.length < 2 || isStopword(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Guess Spanish vs English from stopwords and orthography. */
export function detectLanguage(text: string, fallback: Lang = 'en'): Lang {
  if (/[¿¡ñ]/i.test(text)) return 'es';
  let es = 0;
  let en = 0;
  for (const w of words(text)) {
    if (STOPWORDS_ES.has(w)) es++;
    if (STOPWORDS_EN.has(w)) en++;
  }
  if (/[áéíóú]/i.test(text)) es += 1;
  if (es === en) return fallback;
  return es > en ? 'es' : 'en';
}

// ---------------------------------------------------------------------------
// Search queries

/** Keywords of a question in their original spelling (lowercase, accents kept). */
export function extractKeywords(question: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of question.toLowerCase().match(WORD_RE) ?? []) {
    const n = normalize(raw);
    if (n.length < 3 && !/^\d+$/.test(n)) continue;
    if (isStopword(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(raw);
  }
  return out;
}

/**
 * Full-text queries for the ZIM search engine, most specific first:
 * all keywords, then the longest few (more discriminative), then the single
 * longest keyword as a broad fallback.
 */
export function buildSearchQueries(question: string, max = 3): string[] {
  const kw = extractKeywords(question);
  if (!kw.length) {
    const q = question.trim();
    return q ? [q] : [];
  }
  const queries: string[] = [kw.slice(0, 8).join(' ')];
  const byLength = [...kw].sort((a, b) => b.length - a.length);
  if (kw.length > 3) queries.push(byLength.slice(0, 3).join(' '));
  if (kw.length > 1) queries.push(byLength[0]);
  return [...new Set(queries)].slice(0, max);
}

// ---------------------------------------------------------------------------
// Chunking

export type Chunk = {
  /** Source key, e.g. `${itemId}\u0000${path}`. */
  sourceKey: string;
  title: string;
  text: string;
  /** Position of the chunk within its article (0 = lead). */
  index: number;
};

/** Split into sentences, keeping the terminator. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?¡¿\n]+(?:[.!?]+|\n+|$)/g) ?? [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * Split article text into ~`size`-char chunks on paragraph/sentence boundaries,
 * with `overlap` chars of trailing context repeated at the start of the next one.
 */
export function chunkText(text: string, size = 700, overlap = 120): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const sentences: string[] = [];
  for (const para of clean.split(/\n{2,}|\n/)) {
    for (const s of splitSentences(para)) {
      if (s.length <= size) sentences.push(s);
      else for (let i = 0; i < s.length; i += size - overlap) sentences.push(s.slice(i, i + size));
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let len = 0;
  let fresh = 0; // sentences added since the last chunk was emitted
  for (const s of sentences) {
    if (len + s.length + 1 > size && fresh) {
      chunks.push(current.join(' '));
      // Carry trailing sentences as overlap.
      const carry: string[] = [];
      let carryLen = 0;
      for (let i = current.length - 1; i >= 0 && carryLen + current[i].length <= overlap; i--) {
        carry.unshift(current[i]);
        carryLen += current[i].length + 1;
      }
      // Drop the overlap if it would push the next chunk over the size.
      current = carryLen + s.length + 1 <= size ? carry : [];
      len = current.length ? carryLen : 0;
      fresh = 0;
    }
    current.push(s);
    len += s.length + 1;
    fresh++;
  }
  if (fresh) chunks.push(current.join(' '));
  return chunks;
}

// ---------------------------------------------------------------------------
// BM25

export type Scored<T> = { item: T; score: number };

export class BM25<T> {
  private docs: { item: T; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private totalLen = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  add(item: T, tokens: string[]) {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ item, tf, len: tokens.length });
    this.totalLen += tokens.length;
  }

  get size() {
    return this.docs.length;
  }

  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Scores for every document with score > 0, best first. */
  search(queryTokens: string[], limit = Infinity): Scored<T>[] {
    if (!this.docs.length) return [];
    const avgdl = this.totalLen / this.docs.length || 1;
    const terms = [...new Set(queryTokens)];
    const idfs = terms.map((t) => this.idf(t));
    const out: Scored<T>[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (let i = 0; i < terms.length; i++) {
        const f = d.tf.get(terms[i]);
        if (!f) continue;
        score += (idfs[i] * (f * (this.k1 + 1))) / (f + this.k1 * (1 - this.b + (this.b * d.len) / avgdl));
      }
      if (score > 0) out.push({ item: d.item, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
}

/**
 * Rank chunks against a question. The article title is indexed with the chunk
 * (so the lead of "Water purification" matches "purify water"), and earlier
 * chunks get a small boost because article leads summarise the topic.
 */
export function rankChunks(question: string, chunks: Chunk[], limit = 12): Scored<Chunk>[] {
  const index = new BM25<Chunk>();
  for (const c of chunks) index.add(c, [...tokenize(c.title), ...tokenize(c.text)]);
  const q = tokenize(question);
  return index
    .search(q)
    .map((s) => ({ item: s.item, score: s.score * (1 + 0.15 / (1 + s.item.index)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Context packing

export type SourceRef = { itemId: string; path: string; title: string };

export type PackedSource = SourceRef & { n: number; passages: string[] };

export type PackedContext = {
  sources: PackedSource[];
  /** Number of characters used by passages. */
  used: number;
};

/**
 * Greedily take the best chunks until `budgetChars` is spent, at most
 * `maxPerSource` passages per article. Sources are numbered 1..n in order of
 * their best chunk, passages kept in article order.
 */
export function packContext(
  ranked: Scored<Chunk>[],
  resolve: (sourceKey: string) => SourceRef | undefined,
  budgetChars: number,
  maxPerSource = 3,
): PackedContext {
  const bySource = new Map<string, { ref: SourceRef; chunks: Chunk[] }>();
  const order: string[] = [];
  let used = 0;
  for (const { item } of ranked) {
    const ref = resolve(item.sourceKey);
    if (!ref) continue;
    const cost = item.text.length + 2;
    if (used + cost > budgetChars) continue;
    let entry = bySource.get(item.sourceKey);
    if (!entry) {
      // A new source also costs its header line.
      const header = ref.title.length + 8;
      if (used + cost + header > budgetChars) continue;
      used += header;
      entry = { ref, chunks: [] };
      bySource.set(item.sourceKey, entry);
      order.push(item.sourceKey);
    }
    if (entry.chunks.length >= maxPerSource) continue;
    if (entry.chunks.some((c) => c.index === item.index)) continue;
    entry.chunks.push(item);
    used += cost;
  }
  const sources = order.map((key, i) => {
    const { ref, chunks } = bySource.get(key)!;
    return { ...ref, n: i + 1, passages: chunks.sort((a, b) => a.index - b.index).map((c) => c.text) };
  });
  return { sources, used };
}

/** Rough token estimate for budget math (Spanish/English ~3.6 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * 3.4);
}

// ---------------------------------------------------------------------------
// Prompt

const SYSTEM: Record<Lang, string> = {
  es: [
    'Eres Nomad, un asistente que funciona sin conexión dentro de la app Nomad Pocket.',
    'Responde siempre en español, de forma clara, práctica y breve. Usa Markdown sencillo (negritas, listas) cuando ayude.',
    'Si la pregunta trata de salud o emergencias, recuerda que es información de referencia y no consejo médico.',
  ].join(' '),
  en: [
    'You are Nomad, an assistant that runs offline inside the Nomad Pocket app.',
    'Always answer in English, clearly, practically and concisely. Use simple Markdown (bold, lists) when it helps.',
    'If the question is about health or emergencies, remind the user this is reference information, not medical advice.',
  ].join(' '),
};

const RAG_RULES: Record<Lang, string> = {
  es: [
    'Te daré fragmentos numerados de la biblioteca sin conexión del usuario.',
    'Básate en esos fragmentos y cita la fuente de cada dato con su número entre corchetes, por ejemplo [1] o [2].',
    'No inventes citas ni números de fuente que no existan.',
    'Si los fragmentos no contienen la respuesta, dilo con honestidad ("No lo he encontrado en tu biblioteca") y, si puedes, añade lo que sepas por tu cuenta indicando que no procede de la biblioteca.',
  ].join(' '),
  en: [
    "I will give you numbered excerpts from the user's offline library.",
    'Base your answer on those excerpts and cite the source of each fact with its number in square brackets, e.g. [1] or [2].',
    'Never invent citations or source numbers that do not exist.',
    'If the excerpts do not contain the answer, say so honestly ("I couldn\'t find this in your library") and, if you can, add what you know yourself, making clear it does not come from the library.',
  ].join(' '),
};

const NO_HITS: Record<Lang, string> = {
  es: 'He buscado en la biblioteca sin conexión del usuario y no hay artículos relevantes para esta pregunta. Empieza diciendo brevemente que no lo has encontrado en su biblioteca y después responde con lo que sepas, avisando de que puede no ser exacto.',
  en: "I searched the user's offline library and found no relevant articles for this question. Start by briefly saying you couldn't find it in their library, then answer from your own knowledge, warning that it may not be accurate.",
};

export function systemPrompt(lang: Lang, rag: boolean): string {
  return rag ? `${SYSTEM[lang]}\n\n${RAG_RULES[lang]}` : SYSTEM[lang];
}

/** Renders packed sources as the numbered context block. */
export function formatSources(sources: PackedSource[]): string {
  return sources.map((s) => `[${s.n}] ${s.title}\n${s.passages.join('\n…\n')}`).join('\n\n');
}

/**
 * Builds the final user turn for a RAG question. With no sources the model is
 * told the library had nothing so it can say so honestly.
 */
export function buildRagUserMessage(question: string, sources: PackedSource[], lang: Lang): string {
  if (!sources.length) return `${NO_HITS[lang]}\n\n${lang === 'es' ? 'Pregunta' : 'Question'}: ${question}`;
  const label = lang === 'es' ? { src: 'Fuentes', q: 'Pregunta', a: 'Responde citando las fuentes con [n].' } : { src: 'Sources', q: 'Question', a: 'Answer citing the sources with [n].' };
  return `${label.src}:\n\n${formatSources(sources)}\n\n${label.q}: ${question}\n\n${label.a}`;
}

/** Citation numbers actually used in an answer, e.g. "… [1][3]" → [1, 3]. */
export function citedNumbers(answer: string): number[] {
  const out = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g)) {
    for (const n of m[1].split(/[,–-]/)) out.add(Number(n.trim()));
  }
  return [...out].filter((n) => n > 0).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Conversation trimming

export type Turn = { role: 'user' | 'assistant'; content: string };

/** Keeps the most recent turns that fit in `budgetChars` (always whole turns). */
export function trimHistory(turns: Turn[], budgetChars: number): Turn[] {
  const out: Turn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].content.length + 16;
    if (used + cost > budgetChars) break;
    out.unshift(turns[i]);
    used += cost;
  }
  // A conversation should not start with an assistant turn.
  while (out.length && out[0].role === 'assistant') out.shift();
  return out;
}

/** Removes reasoning blocks some models emit (<think>…</think>), also unterminated ones. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
}
