// The emergency guide (src/data/guide.json, built from src/data/guide/*.md; docs/EMERGENCY_GUIDE_PLAN.md):
// short official texts, bilingual, searched by the assistant before the library. Vital cards (CPR, choking,
// bleeding, bleach doses…) answer a question on their own, word for word: the 4B model garbled them when it
// paraphrased (CPR on the side, too little bleach). Pure (no `@/` imports) so `node --test` can load it.
import { BM25, followUpTopic, tokenize, type Lang, type Turn } from '../assistant/rag-core.ts';

export type GuideSource = { agency: string; title: string; url: string; date: string };
export type GuideKind = 'copy' | 'excerpt' | 'translation' | 'own';

/** A card in one language. */
export type GuideText = {
  title: string;
  kind: GuideKind;
  sources: GuideSource[];
  licence: string;
  keywords: string[];
  /** `translation`: the language of the card it translates. */
  translatedFrom?: Lang;
  /** `own`: the guidelines our wording follows. */
  basis?: string;
  /** One sentence of ours shown outside the text. */
  note?: string;
  body: string;
};

export type GuideCard = {
  id: string;
  /** "1.1": the order of the guide; its first part is the section. */
  number: string;
  section: number;
  vital: boolean;
  health: boolean;
  see: string[];
  es: GuideText;
  en: GuideText;
};

/** Source id of a guide card in the assistant's sources (the path is the card id). */
export const GUIDE_SOURCE = 'guide';

/** Sections in the order of docs/emergency-guide/cards.md; their names are in the `guide` i18n namespace. */
export const GUIDE_SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** The cards this build may show: none about health without health features (Android, src/lib/health.ts). */
export function visibleCards(cards: GuideCard[], health: boolean): GuideCard[] {
  return health ? cards : cards.filter((c) => !c.health);
}

export type GuideMatch = {
  card: GuideCard;
  score: number;
  /** Share of the question's topic terms found in the card's title and keywords, weighted by rarity: "agua" in
   * a dozen cards' keywords counts less than "suministro" in none. */
  coverage: number;
  /** Share of the question's topic terms found anywhere in the card. */
  reach: number;
  /** Words of the card's title the question doesn't say ("bebés" in "RCP en niños y bebés" for "¿qué es la RCP?"). */
  titleMiss: number;
};

// Not the topic: who it happens to ("mi padre no respira" is still the CPR card) and how people ask
// ("primeros auxilios para…", "síntomas de…", "¿cómo se usa…?").
const NOT_TOPIC_WORDS = tokenize(
  'padre madre papá mamá hijo hija marido mujer esposo esposa novio novia abuelo abuela amigo amiga hermano hermana vecino vecina compañero compañera pareja persona alguien gente ' +
    'primeros auxilios sintomas síntomas signos señales usar usa uso utilizar seguro segura tratar trato tratamiento curar curo cura actuar pasos ayuda urgente ' +
    'tengo tiene tienes tenemos estoy está estamos llega llegar viene ambulancia creo parece ' +
    'ahora mismo ya ahí aquí rápido pronto sí normal grave peligroso puedo puede debo hay sirve vale pasa pasando hago hacemos hacer ' +
    'father mother dad mum mom son daughter husband wife boyfriend girlfriend friend brother sister neighbour neighbor partner person someone people grandfather grandmother ' +
    'first aid symptoms signs use used safe treat treatment cure steps help urgent got get gets getting has have having ambulance ' +
    'now right away quick quickly normal serious dangerous can could should must ok okay happening happen do does think',
);
// "no llega la ambulancia" is no more about the topic than "llega".
const NOT_TOPIC = new Set([...NOT_TOPIC_WORDS, ...NOT_TOPIC_WORDS.map((t) => `no${t}`)]);
// The default audience: a title naming it is no more specific than the question ("no respira" is CPR for adults,
// not drowning, whose one title word the question doesn't say either).
const DEFAULT_AUDIENCE = new Set(tokenize('adulto adultos adult adults'));

/**
 * Terms for the guide: a negation stays with its word, so "no respira" (CPR) is not "respira" (the recovery
 * position is for someone who breathes). The cards' keywords and texts go through the same.
 */
export function guideTerms(text: string): string[] {
  return tokenize(text.replace(/\b(no|not|ni|nor|isn['’]?t|doesn['’]?t|don['’]?t|can['’]?t|cannot|won['’]?t)\s+(\p{L}+)/giu, (_, neg: string, w: string) => ` no${w} `));
}

/** Same root: the stems share all but their last two letters, five at least ("atragantand" ~ "atragantad"). */
function sameRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 5 && i >= n - 2;
}

/** Whether a card's terms include `t` or a word of the same root. */
const hasTerm = (terms: Set<string>, t: string) => terms.has(t) || [...terms].some((x) => sameRoot(t, x));

/** Title terms weigh three times, keywords twice, the text once. */
export class GuideIndex {
  private bm25 = new BM25<GuideCard>();
  private heads = new Map<string, Set<string>>();
  private titles = new Map<string, string[]>();
  private terms = new Map<string, Set<string>>();
  private vocabulary = new Set<string>();
  readonly lang: Lang;

  constructor(cards: GuideCard[], lang: Lang) {
    this.lang = lang;
    for (const c of cards) {
      const t = c[lang];
      const title = guideTerms(t.title);
      const keywords = guideTerms(t.keywords.join(' '));
      const body = guideTerms(t.body);
      // People and asking words score from the keywords only, which use them as people ask ("se me ha perdido mi
      // hijo" is the lost child card): "mi madre sangra mucho" landed on childbirth, whose text says "madre" again
      // and again, and on the after-birth card, whose title names "la madre".
      const topicOnly = (terms: string[]) => terms.filter((t) => !NOT_TOPIC.has(t));
      this.bm25.add(c, [...topicOnly(title), ...topicOnly(title), ...topicOnly(title), ...keywords, ...keywords, ...topicOnly(body)]);
      this.heads.set(c.id, new Set([...title, ...keywords]));
      this.titles.set(c.id, [...new Set(title.filter((t) => !NOT_TOPIC.has(t) && !DEFAULT_AUDIENCE.has(t)))]);
      this.terms.set(c.id, new Set([...title, ...keywords, ...body]));
      for (const t of [...title, ...keywords, ...body]) this.vocabulary.add(t);
    }
  }

  /** The question's terms, plus the guide's words of the same root for those it never uses ("inunda" → "inundac"). */
  private expand(q: string[]): string[] {
    const out = [...q];
    for (const t of q) if (!this.vocabulary.has(t)) out.push(...[...this.vocabulary].filter((v) => sameRoot(t, v)).slice(0, 3));
    return out;
  }

  match(text: string, limit = 4): GuideMatch[] {
    const q = [...new Set(guideTerms(text))];
    if (!q.length) return [];
    const topic = q.filter((t) => !NOT_TOPIC.has(t));
    const weight = topic.map((t) => this.bm25.idf(t));
    const total = weight.reduce((a, b) => a + b, 0);
    return this.bm25.search(this.expand(q), limit).map(({ item, score }) => {
      const head = this.heads.get(item.id)!;
      const all = this.terms.get(item.id)!;
      return {
        card: item,
        score,
        coverage: total ? topic.reduce((sum, t, i) => sum + (hasTerm(head, t) ? weight[i] : 0), 0) / total : 0,
        reach: topic.length ? topic.filter((t) => hasTerm(all, t)).length / topic.length : 0,
        titleMiss: this.titles.get(item.id)!.filter((x) => !q.some((t) => sameRoot(t, x))).length,
      };
    });
  }
}

/**
 * To answer a question alone, a vital card's title and keywords must cover half of its terms, and the card
 * must say nearly all of them somewhere: "¿cómo sé si una seta es venenosa?" shares "venenosa" with the snake
 * bite card's keywords, but the card never says "seta".
 */
const VITAL_COVERAGE = 0.5;
const VITAL_REACH = 0.75;

/** Which cards may answer alone: the vital ones only, or any card that fits the question as well. */
export type CardAnswers = 'vital' | 'all';

const answerOf = (m: GuideMatch | undefined, which: CardAnswers) =>
  m && (which === 'all' || m.card.vital) && m.reach >= VITAL_REACH ? m.card : null;

/**
 * The best card among those whose title and keywords cover the question ("primeros auxilios para una quemadura"
 * is the burns card, though the first-aid kit's title shares two of its words), the general one before a
 * specific one the question doesn't name ("¿qué es la RCP?": adults, not children and babies).
 */
function bestCovering(matches: GuideMatch[]): GuideMatch | undefined {
  const fit = (m: GuideMatch) => m.score / (1 + 0.25 * m.titleMiss);
  // About as good: the earlier card in the guide, which is the general one ("choking": adults before babies).
  const order = (m: GuideMatch) => m.card.number.split('.').reduce((n, x) => n * 1000 + Number(x), 0);
  return matches
    .filter((m) => m.coverage >= VITAL_COVERAGE)
    .sort((a, b) => (Math.abs(fit(a) - fit(b)) <= 0.15 * Math.max(fit(a), fit(b)) ? order(a) - order(b) : fit(b) - fit(a)))[0];
}

/**
 * The card that answers `question` on its own, if any: a vital one, or with `which: 'all'` any card. Two cards
 * that fit about as well ("atragantamiento": adults or babies) still give the better one, whose related cards
 * name the other: a model's paraphrase is the risk this avoids.
 */
export function answerCard(index: GuideIndex, question: string, history: Turn[] = [], which: CardAnswers = 'vital'): GuideCard | null {
  const own = index.match(question, 20);
  const topic = history.length ? followUpTopic(question, history) : [];
  if (!topic.length) return answerOf(bestCovering(own), which);
  // A follow-up ("¿y si es un bebé?") is matched with the earlier question's topic, so it doesn't land on
  // whichever card says "bebé" most; the card must still cover what this question asks.
  const best = bestCovering(index.match(`${question} ${topic.join(' ')}`, 20));
  const mine = best && own.find((m) => m.card.id === best.card.id);
  return mine && mine.coverage >= VITAL_COVERAGE ? answerOf(mine, which) : null;
}

/** The vital card that answers `question` on its own, if any. */
export function vitalCard(index: GuideIndex, question: string, history: Turn[] = []): GuideCard | null {
  return answerCard(index, question, history, 'vital');
}

/** Guide cards worth offering the model as sources: some of the question's terms in their title or keywords (0.34 found the right card for 63 % of 65 unseen questions, 0.2 for 75 %). */
export function sourceCards(index: GuideIndex, question: string, max = 2): GuideCard[] {
  return index
    .match(question)
    .filter((m) => m.coverage >= 0.2)
    .slice(0, max)
    .map((m) => m.card);
}

const PROVENANCE: Record<Lang, Record<Exclude<GuideKind, 'own'>, string>> = {
  es: { copy: 'Texto de', excerpt: 'Fragmento de', translation: 'Traducción fiel de' },
  en: { copy: 'Text from', excerpt: 'Excerpt from', translation: 'Faithful translation of' },
};

/** Where the text comes from, e.g. "Fragmento de MedlinePlus, «Reanimación cardiopulmonar» (28/07/2026)." */
export function provenance(text: GuideText, lang: Lang): string {
  if (text.kind === 'own') return lang === 'es' ? `Redactado por Nomad Pocket según ${text.basis}.` : `Written by Nomad Pocket following ${text.basis}.`;
  const [open, close] = lang === 'es' ? ['«', '»'] : ['“', '”'];
  const list = text.sources.map((s) => `${s.agency}, ${open}${s.title}${close} (${s.date})`).join('; ');
  return `${PROVENANCE[lang][text.kind]} ${list}.`;
}

const US_EMERGENCY_RE = /\b9-?1-?1\b/;

/** Notes shown outside the card's text: the local emergency number, and the card's own note. */
export function cardNotes(card: GuideCard, lang: Lang, emergencyNumber: string): string[] {
  const t = card[lang];
  const out: string[] = [];
  if (US_EMERGENCY_RE.test(t.body) && emergencyNumber !== '911') {
    out.push(lang === 'es' ? `Donde el texto dice 911, llama al ${emergencyNumber}.` : `Where the text says 911, call ${emergencyNumber}.`);
  } else if (card.health || card.vital) {
    out.push(lang === 'es' ? `Número de emergencias: ${emergencyNumber}.` : `Emergency number: ${emergencyNumber}.`);
  }
  if (t.note) out.push(t.note);
  return out;
}

const HEADER: Record<Lang, string> = { es: 'Guía de emergencias', en: 'Emergency guide' };

/**
 * The answer a card gives on its own: its title, its text unchanged, the notes outside it and where it comes
 * from, cited as source [1] so the chip opens the card.
 */
export function cardAnswer(card: GuideCard, lang: Lang, emergencyNumber: string): string {
  const t = card[lang];
  const notes = cardNotes(card, lang, emergencyNumber).map((n) => `> ${n}`);
  return [`**${HEADER[lang]}: ${t.title}**`, t.body, ...notes, `*${provenance(t, lang)}* [1]`].join('\n\n');
}
