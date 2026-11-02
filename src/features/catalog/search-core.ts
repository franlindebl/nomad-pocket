// Search of the bundled catalog by words, for the Library search's "You can download it" results. The
// catalog ships inside the app, so this works with no connection: a search finds what to get next time
// there is one. Accents and case don't matter; every word of the query has to start a word of the title
// or the description, and title matches come first.
// No `@/` imports: unit tests load this file directly.

export type SearchableResource = { id: string; title: { es: string; en: string }; description: { es: string; en: string } };

/** Lower case without accents: "Quemaduras" and "quemadúras" match. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function words(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Resources whose title or description holds every word of `query` (as word starts), best first. */
export function searchCatalog<T extends SearchableResource>(resources: T[], query: string, lang: 'es' | 'en', limit = 5): T[] {
  const terms = words(query);
  if (!terms.length) return [];
  const scored: { r: T; score: number; i: number }[] = [];
  resources.forEach((r, i) => {
    const title = words(r.title[lang]);
    const text = [...title, ...words(r.description[lang])];
    const has = (list: string[], term: string) => list.some((w) => w.startsWith(term));
    if (!terms.every((term) => has(text, term))) return;
    const score = terms.filter((term) => has(title, term)).length;
    scored.push({ r, score, i });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.r);
}
