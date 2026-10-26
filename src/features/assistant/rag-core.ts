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

// Courtesy words that would only add noise to a search ("hola, ¿cómo se cura…?").
const COURTESY = new Set(['hola', 'buenas', 'buenos', 'hey', 'hello', 'gracias', 'thanks', 'thank', 'please', 'porfa', 'favor']);

/** Keywords of a question in their original spelling (lowercase, accents kept). */
export function extractKeywords(question: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of question.toLowerCase().match(WORD_RE) ?? []) {
    const n = normalize(raw);
    if (n.length < 3 && !/^\d+$/.test(n)) continue;
    if (isStopword(n) || COURTESY.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(raw);
  }
  return out;
}

/**
 * Full-text queries for the ZIM search engine, most specific first: all keywords,
 * then (short queries) the keywords without the last one or the one before it, or
 * (long ones) the longest few, then the single longest keyword as a broad fallback.
 * The engine wants every word, and one word the library doesn't have ("Michael
 * Jackson fallecimiento" in an English Wikipedia) would sink the whole query.
 */
export function buildSearchQueries(question: string, max = 4): string[] {
  const kw = extractKeywords(question);
  if (!kw.length) {
    const q = question.trim();
    return q ? [q] : [];
  }
  const queries: string[] = [kw.slice(0, 8).join(' ')];
  const byLength = [...kw].sort((a, b) => b.length - a.length);
  if (kw.length > 4) queries.push(byLength.slice(0, 3).join(' '));
  else if (kw.length > 1) {
    for (const drop of [kw.length - 1, kw.length - 2]) queries.push(kw.filter((_, i) => i !== drop).join(' '));
  }
  if (kw.length > 1) queries.push(byLength[0]);
  return [...new Set(queries)].slice(0, max);
}

const FOLLOW_UP_START = new Set(['y', 'e', 'and', 'pero', 'but', 'entonces', 'so', 'tambien', 'also', 'ademas', 'besides']);
const ANAPHORA = new Set(['eso', 'esto', 'ello', 'it', 'that', 'this', 'them', 'they', 'those', 'these']);
// Facets of a topic that make no sense on their own: "¿cómo se trata?", "what are the symptoms?".
const FACET_PREFIXES = [
  'trat', 'cura', 'curar', 'sintom', 'caus', 'preven', 'evit', 'funcion', 'dura', 'tipo', 'riesg', 'peligr', 'grav', 'signific', 'diagnost',
  'origen', 'efect', 'dosis', 'mortal', 'contagi', 'ejempl', 'historia', 'ventaj', 'desventaj',
  'symptom', 'treat', 'cure', 'cause', 'prevent', 'avoid', 'work', 'risk', 'danger', 'type', 'effect', 'sign', 'diagnos', 'origin',
  'example', 'history', 'advantage', 'disadvantage',
];

/**
 * The topic a follow-up question leaves implicit ("¿y cómo se trata?" after asking
 * about hypothermia): keywords of the previous user turn when the new question opens
 * with a conjunction, only names facets of a topic, or points back ("eso", "it") with
 * at most one word of its own. Empty when the question stands alone: English puts
 * "it" in most questions ("Is it safe to drink rain water?").
 */
export function followUpTopic(question: string, history: Turn[]): string[] {
  const prev = [...history].reverse().find((t) => t.role === 'user');
  if (!prev) return [];
  const own = extractKeywords(question);
  const ws = words(question);
  const ownTopic = own.filter((k) => !FACET_PREFIXES.some((p) => normalize(k).startsWith(p)));
  const followUp =
    FOLLOW_UP_START.has(ws[0] ?? '') || ownTopic.length === 0 || (ownTopic.length <= 1 && ws.some((w) => ANAPHORA.has(w)));
  if (!followUp) return [];
  const ownSet = new Set(own.map(normalize));
  return extractKeywords(prev.content)
    .filter((k) => !ownSet.has(normalize(k)))
    .slice(0, 4);
}

/**
 * Search queries for a question in a conversation: the implicit topic goes first, and
 * the question's own keywords are searched too in case the topic guess was wrong (the
 * engine wants every word, so a wrong topic would sink the merged queries).
 */
export function buildConversationQueries(question: string, history: Turn[], max = 4): string[] {
  const topic = followUpTopic(question, history);
  if (!topic.length) return buildSearchQueries(question, max);
  const merged = buildSearchQueries([...topic, ...extractKeywords(question)].join(' '), max);
  const own = extractKeywords(question).length ? buildSearchQueries(question, max) : [];
  return [...new Set([...merged.slice(0, max - 1), ...own.slice(0, 1), ...merged.slice(max - 1), ...own.slice(1)])].slice(0, max);
}

// ---------------------------------------------------------------------------
// Intent: chat or search

// Words that make up small talk: greetings, thanks, acknowledgements, farewells,
// "how are you", questions about the assistant itself, jokes and laughter.
const CHAT_WORDS = new Set(
  (
    'hola holi holaa buenas buenos dia dias tardes noches hey hi hello hiya saludos good morning afternoon evening night ' +
    'gracias muchas muchisimas mil thanks thank thx ty cheers lot favor please porfa plz ' +
    'ok okay okey vale genial perfecto perfect great cool nice bien guay entendido claro acuerdo estupendo excelente fantastico ' +
    'awesome fine sure yes si yep nope vaya wow guau ah oh eh uh vamos venga dale got it alright right ' +
    'adios chao chau bye goodbye hasta luego pronto manana see later vemos nos cuidate ' +
    'tal estas estoy va vas andas how are you doing going what up whats sup ' +
    'interesante increible curioso alucinante bonito precioso interesting amazing incredible wonderful lovely ' +
    'quien eres who llamas nombre name puedes can do hacer haces sabes ayudar ayudarme help capable funcionas work works yourself ti ' +
    'chiste chistes joke jokes cuentame tell gracioso funny ' +
    'jaja jajaja jajajaja jeje haha hahaha lol xd'
  ).split(' '),
);

// Requests about the previous answer: rewrite it, don't look anything up. Long stems
// match as prefixes ("resúmelo", "simplify"); short or ambiguous words only whole, so
// one-word follow-ups such as "¿Y moretones?", "What about itching?" or "Listeria?" still search.
const META_PREFIXES = [
  'resum', 'simplif', 'sencill', 'facil', 'breve', 'aclar', 'explic', 'tradu', 'repit', 'repet', 'continu',
  'detall', 'ejempl', 'ingles', 'espanol', 'escribelo', 'cuentamelo',
  'summar', 'simpl', 'clarif', 'explain', 'translat', 'rephras', 'reword', 'rewrit', 'repeat', 'elaborat',
  'expand', 'detail', 'exampl', 'english', 'spanish', 'sentence', 'paragraph',
];
const META_WORDS = new Set(
  (
    'corto corta cortos cortas cortito largo larga largos largas sigue seguir siguiente otra otro vez ' +
    'lista listas punto puntos tabla tablas frase frases palabra palabras parrafo parrafos menos ' +
    'dame ponlo ponerlo hazlo dimelo ' +
    'short shorter shorten long longer brief briefly again list lists bullet bullets bulleted table tables ' +
    'easier more less word words give make put write'
  ).split(' '),
);

export type Intent = 'chat' | 'search';

/**
 * Cheap, deterministic guess of whether a message needs the library: small talk and
 * requests about the previous answer ("resúmelo", "más simple") don't. Everything
 * else is treated as a question worth searching for.
 */
export function guessIntent(message: string, history: Turn[] = []): Intent {
  const ws = words(message);
  if (!ws.length) return 'chat';
  if (ws.length > 12) return 'search';
  const hasHistory = history.some((t) => t.role === 'assistant');
  const content = ws.filter((w) => !isStopword(w));
  const chatty = (w: string) =>
    CHAT_WORDS.has(w) || /^(?:ja|je|ha){2,}h?$/.test(w) || (hasHistory && (META_WORDS.has(w) || META_PREFIXES.some((p) => w.startsWith(p))));
  return content.every(chatty) ? 'chat' : 'search';
}

// ---------------------------------------------------------------------------
// Relevance

/**
 * Drops ranked chunks that share too few terms with the question: a library
 * without the topic still returns articles that mention one of its words. A chunk
 * needs 1 of 1–2 question terms, 2 of 3–5, 40 % of longer questions.
 */
export function relevantChunks<T extends Chunk>(question: string, ranked: Scored<T>[]): Scored<T>[] {
  const q = [...new Set(tokenize(question))];
  if (!q.length) return ranked;
  const need = q.length <= 2 ? 1 : Math.max(2, Math.ceil(q.length * 0.4));
  return ranked.filter(({ item }) => {
    const have = new Set([...tokenize(item.title), ...tokenize(item.text)]);
    return q.filter((t) => have.has(t)).length >= need;
  });
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
  /** Rank of the article in the search engine's results (0 = best), if known. */
  hitRank?: number;
};

/**
 * Split into sentences, keeping the terminator. A terminator only ends a sentence
 * when followed by whitespace or the end ("0.5 mg", "39.5 °C" stay intact), and
 * Spanish opening marks (¿ ¡) are kept.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^\n]+?(?:[.!?…]+(?=\s|$)|\n+|$)/g) ?? [];
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
  const qSet = new Set(q);
  const titleMatch = new Map<string, number>();
  const titleBoost = (title: string) => {
    let v = titleMatch.get(title);
    if (v === undefined) {
      const t = tokenize(title);
      // Share of the title's terms the question mentions ("Fotosíntesis" for "explain photosynthesis").
      v = t.length ? t.filter((x) => qSet.has(x)).length / t.length : 0;
      titleMatch.set(title, v);
    }
    return v;
  };
  return index
    .search(q)
    .map((s) => {
      const c = s.item;
      const lead = 1 + 0.15 / (1 + c.index);
      const title = 1 + 0.8 * titleBoost(c.title);
      const engine = c.hitRank === undefined ? 1 : 1 + 0.3 / (1 + c.hitRank);
      return { item: c, score: s.score * lead * title * engine };
    })
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

const SYSTEM: Record<Lang, [intro: string, tone: string, smallTalk: string, style: string]> = {
  es: [
    'Eres Nomad, un asistente que funciona sin conexión dentro de la app Nomad Pocket.',
    'Conversa de forma natural y cercana: saluda, responde a las gracias, charla, cuenta chistes y habla de ti con naturalidad.',
    'En la charla contesta con una o dos frases, sin listas, y no inventes datos sobre ti ni sobre la app.',
    'Responde siempre en español, de forma clara, práctica y breve. Usa Markdown sencillo (negritas, listas) cuando ayude.',
  ],
  en: [
    'You are Nomad, an assistant that runs offline inside the Nomad Pocket app.',
    'Talk naturally and warmly: greet back, answer thanks, chat, tell jokes and talk about yourself freely.',
    "In small talk reply in one or two sentences, without lists, and don't make up facts about yourself or the app.",
    'Always answer in English, clearly, practically and concisely. Use simple Markdown (bold, lists) when it helps.',
  ],
};

// Spelling out the small talk makes models chattier, and then they stop calling the
// tool (Gemma 4 searched 4 of 10 questions with it, 9 of 10 without): tools mode
// keeps the tone short.
const TOOLS_TONE: Record<Lang, string> = {
  es: 'Conversa de forma natural y cercana.',
  en: 'Talk naturally and warmly.',
};

/** What the assistant can lean on, so "what can you do?" gets a true answer. */
const LIBRARY_NOTE: Record<Lang, string> = {
  es: 'El usuario tiene en este dispositivo una biblioteca sin conexión (Wikipedia, medicina, supervivencia, bricolaje y más) en la que buscas cuando hace falta información.',
  en: "The user has an offline library on this device (Wikipedia, medicine, survival, DIY and more) that you search when information is needed.",
};

const RAG_RULES: Record<Lang, string> = {
  es: [
    'Cuando el mensaje del usuario traiga fragmentos numerados de su biblioteca, básate en ellos y cita la fuente de cada dato con su número entre corchetes, por ejemplo [1] o [2].',
    'No inventes citas ni números de fuente que no existan.',
    'Si los fragmentos no contienen la respuesta, dilo con honestidad ("No lo he encontrado en tu biblioteca") y, si puedes, añade lo que sepas por tu cuenta indicando que no procede de la biblioteca.',
  ].join(' '),
  en: [
    "When the user's message comes with numbered excerpts from their library, base your answer on them and cite the source of each fact with its number in square brackets, e.g. [1] or [2].",
    'Never invent citations or source numbers that do not exist.',
    'If the excerpts do not contain the answer, say so honestly ("I couldn\'t find this in your library") and, if you can, add what you know yourself, making clear it does not come from the library.',
  ].join(' '),
};

// Tuned with llama.cpp on Qwen3.5 0.8B/2B/4B and Gemma 4 E2B: 32–34 of 36 right on a
// chat/search bench with guessIntent first. Naming the follow-up case, the "don't
// search" list and "search even if you know" each fixed misses; the rest are mostly
// harmless extra searches on small talk (0.8B) or famous facts answered from memory.
const TOOL_RULES: Record<Lang, string> = {
  es: [
    'El usuario tiene una biblioteca sin conexión (Wikipedia, medicina, supervivencia, bricolaje y más) donde puedes buscar con la herramienta search_library.',
    'Busca siempre que el usuario pida información nueva: hechos, personas, lugares, historia, ciencia, salud, técnicas o cómo hacer algo, también en preguntas de seguimiento como "¿y cómo se trata?" (busca el tema completo).',
    'Busca aunque creas saber la respuesta: la biblioteca es la fuente fiable.',
    'No busques para saludos, agradecimientos, chistes, charla o peticiones sobre tu respuesta anterior (resumir, aclarar, simplificar, traducir): responde directamente.',
    'Cuando busques, básate en los resultados y cita cada dato con su número entre corchetes, por ejemplo [1]. No inventes citas.',
    'Si los resultados no responden, dilo y añade lo que sepas indicando que no viene de la biblioteca.',
  ].join(' '),
  en: [
    "The user has an offline library (Wikipedia, medicine, survival, DIY and more) that you can search with the search_library tool.",
    'Search whenever the user asks for new information: facts, people, places, history, science, health, techniques or how to do something, also in follow-up questions like "and how is it treated?" (search the full topic).',
    'Search even if you think you know the answer: the library is the trusted source.',
    "Don't search for greetings, thanks, jokes, small talk or requests about your previous answer (summarize, clarify, simplify, translate): reply directly.",
    'When you search, base your answer on the results and cite each fact with its number in square brackets, e.g. [1]. Never invent citations.',
    "If the results don't answer the question, say so and add what you know, making clear it doesn't come from the library.",
  ].join(' '),
};

export const SEARCH_TOOL_NAME = 'search_library';

/** OpenAI-style function definition of the library search, for chat templates with tools. */
export function searchToolSpec(lang: Lang) {
  const t =
    lang === 'es'
      ? {
          d: 'Busca en la biblioteca sin conexión del usuario (Wikipedia, medicina, supervivencia…) y devuelve fragmentos numerados de artículos.',
          q: 'Palabras clave del tema, completas aunque la pregunta dependa de la conversación (ej. "tratamiento hipotermia").',
        }
      : {
          d: "Searches the user's offline library (Wikipedia, medicine, survival…) and returns numbered article excerpts.",
          q: 'Keywords for the topic, self-contained even when the question depends on the conversation (e.g. "hypothermia treatment").',
        };
  return {
    type: 'function',
    function: {
      name: SEARCH_TOOL_NAME,
      description: t.d,
      parameters: { type: 'object', properties: { query: { type: 'string', description: t.q } }, required: ['query'] },
    },
  };
}

/** The search query in a tool call's JSON arguments (models sometimes send a bare string). */
export function parseToolQuery(args: string | undefined): string {
  if (!args) return '';
  try {
    const v: unknown = JSON.parse(args);
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object' && typeof (v as { query?: unknown }).query === 'string') return (v as { query: string }).query.trim();
  } catch {
    // not JSON: use as is
  }
  return args.trim();
}

/** The tool result handed back to the model: numbered sources, or what to do without them. */
export function buildToolResult(sources: PackedSource[], lang: Lang): string {
  if (!sources.length) return NO_RESULTS[lang];
  const cite = lang === 'es' ? 'Cita cada dato con su número entre corchetes, por ejemplo [1].' : 'Cite each fact with its number in square brackets, e.g. [1].';
  return `${formatSources(sources)}\n\n${cite}`;
}

const NO_RESULTS: Record<Lang, string> = {
  es: 'Sin resultados: la biblioteca no tiene artículos sobre esto. Empieza diciendo brevemente «No lo he encontrado en tu biblioteca» y responde con lo que sepas, avisando de que puede no ser exacto.',
  en: "No results: the library has no articles about this. Start by briefly saying \"I couldn't find this in your library\" and answer from what you know, warning that it may not be accurate.",
};

// Apple's on-device model rarely calls tools on its own (7–11 of 14 on the bench,
// worse with Spanish instructions), but classifies well with guided generation once
// guessIntent has filtered out small talk (all questions right, 8 of 10 chatty
// messages the heuristic missed): it decides search/chat in a short structured pass
// (~0.7 s) instead, and writes a better query. English instructions work best.
export const ROUTER_INSTRUCTIONS = [
  "You route messages for an offline assistant. The assistant can search the user's offline library (Wikipedia, medicine, survival, DIY) before answering.",
  'Set search to true only when the latest message asks for information the assistant should look up: facts, people, places, history, science, health, techniques or how to do something. Follow-up questions about a topic ("¿y cómo se trata?", "¿y en niños?") also need a search.',
  'Set search to false for everything else: greetings, how are you, thanks, okay/great, goodbye, jokes, small talk, questions about the assistant itself, and requests to rephrase, simplify, shorten, summarize, translate or continue the previous answer.',
  '',
  'Examples:',
  '"hola" → false',
  '"¿qué tal estás?" → false',
  '"gracias!" → false',
  '"¿quién eres?" → false',
  '"cuéntame un chiste" → false',
  '"explícamelo más fácil" → false',
  '"¿Quién fue Cervantes?" → true, "Miguel de Cervantes"',
  '"¿cómo hago un nudo as de guía?" → true, "nudo as de guía"',
  '"¿y cuáles son los síntomas?" (after talking about scurvy) → true, "síntomas escorbuto"',
].join('\n');

/** The router's prompt: recent turns (shortened) and the message to classify. */
export function buildRouterPrompt(question: string, history: Turn[]): string {
  const recent = history.slice(-4).map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.replace(/\s+/g, ' ').slice(0, 300)}`);
  return recent.length ? `Conversation:\n${recent.join('\n')}\n\nLatest user message: ${question}` : `Latest user message: ${question}`;
}

// Phrased as a note inside the user's turn: wording about "the user's library" got
// echoed back verbatim ("no lo he encontrado en la biblioteca del usuario").
const NO_HITS: Record<Lang, string> = {
  es: '(Nota: mi biblioteca sin conexión no tiene artículos sobre esto. Empieza diciendo brevemente «No lo he encontrado en tu biblioteca» y después responde con lo que sepas, avisando de que puede no ser exacto.)',
  en: "(Note: my offline library has no articles about this. Start by briefly saying \"I couldn't find this in your library\", then answer from what you know, warning that it may not be accurate.)",
};

const HEALTH_NOTE: Record<Lang, string> = {
  es: 'Termina con una línea breve: «Información de referencia, no consejo médico.»',
  en: 'End with one short line: "Reference information, not medical advice."',
};

const HEALTH_TERMS = [
  'salud', 'medic', 'enferm', 'herid', 'quemad', 'sangr', 'dolor', 'fiebre', 'hipoterm', 'picad', 'mordedur',
  'fractur', 'envenen', 'intoxic', 'auxilio', 'sintom', 'infecc', 'dosis', 'pastill', 'embaraz', 'alergi',
  'health', 'medical', 'medicine', 'injur', 'wound', 'burn', 'bleed', 'pain', 'fever', 'hypotherm', 'bite',
  'sting', 'fractur', 'poison', 'first aid', 'symptom', 'infect', 'dose', 'pill', 'pregnan', 'allerg', 'cpr', 'rcp',
];

/** Whether a question is about health/first aid (adds the "not medical advice" note). */
export function isHealthQuestion(question: string): boolean {
  const q = normalize(question);
  const ws = words(question);
  // Word-prefix match so "interesting" doesn't hit "sting".
  return HEALTH_TERMS.some((t) => (t.includes(' ') ? q.includes(t) : ws.some((w) => w.startsWith(t))));
}

/**
 * How the model meets the library: `chat` none (library off, or small talk), `sources`
 * excerpts arrive inside the user turn, `tools` the model calls search_library itself.
 */
export type PromptMode = 'chat' | 'sources' | 'tools';

export function systemPrompt(lang: Lang, mode: PromptMode, opts: { health?: boolean; library?: boolean } = {}): string {
  const [intro, tone, smallTalk, style] = SYSTEM[lang];
  const parts = mode === 'tools' ? [intro, TOOLS_TONE[lang], style] : [intro, tone, smallTalk, style];
  if (opts.health) parts.push(HEALTH_NOTE[lang]);
  const base = parts.join(' ');
  if (mode === 'tools') return `${base}\n\n${TOOL_RULES[lang]}`;
  if (mode === 'sources') return `${base}\n\n${RAG_RULES[lang]}`;
  return opts.library ? `${base}\n\n${LIBRARY_NOTE[lang]}` : base;
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
  const label =
    lang === 'es'
      ? { src: 'Fuentes de la biblioteca', q: 'Pregunta', a: 'Responde ahora a la pregunta con tus palabras, usando estas fuentes y citándolas con [n].' }
      : { src: 'Library sources', q: 'Question', a: 'Now answer the question in your own words using these sources, citing them with [n].' };
  // Question first and last: small models lose track of it after long context.
  return `${label.q}: ${question}\n\n${label.src}:\n\n${formatSources(sources)}\n\n${label.q}: ${question}\n${label.a}`;
}

/** Citation numbers actually used in an answer, e.g. "… [1][3]" → [1, 3]. */
export function citedNumbers(answer: string): number[] {
  const out = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g)) {
    for (const part of m[1].split(',')) {
      // "1-3" / "1–3" is a range: every source in it was cited.
      const [a, b] = part.split(/[–-]/).map((x) => Number(x.trim()));
      if (b && b >= a && b - a < 20) for (let n = a; n <= b; n++) out.add(n);
      else out.add(a);
    }
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
