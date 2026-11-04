// What the onboarding kit downloads from the catalog: the "Essential" level (the recommended tier) of every
// collection, so "Essential" in the Library and the kit are the same thing (owner's decision, 2026-11-04;
// before, the kit took three collections and dropped items over a size cap, so half of "Essential" never
// came). Curation lives in catalog.json: an archive too big or not vital enough doesn't belong in Essential.
// No `@/` imports: unit tests load this file directly.
import { otherLanguageIds, withoutHeld } from '../catalog/editions-core.ts';
import type { Catalog, CatalogResource } from '../catalog/types.ts';

const visible = (r: CatalogResource, langs: string[]) => r.language === 'mul' || langs.includes(r.language);

/**
 * Every collection's essential archives in the content languages, without the same work in another language
 * (Vikidia in English next to the Spanish one) and without archives another one in the kit carries (zimgit's
 * water library inside its post-disaster one). Collections with no essential level (Computing) add nothing.
 */
export function essentialResources(catalog: Catalog, langs: string[], primary: string): CatalogResource[] {
  const other = otherLanguageIds(
    Object.values(catalog.resources).filter((r) => visible(r, langs)),
    primary,
  );
  const out = new Map<string, CatalogResource>();
  for (const category of catalog.categories) {
    const tier = category.tiers.find((t) => t.recommended);
    for (const id of tier?.resources ?? []) {
      const r = catalog.resources[id];
      if (r && visible(r, langs) && !other.has(id)) out.set(id, r);
    }
  }
  return withoutHeld([...out.values()]);
}

/**
 * Wikipedia variants the kit proposes, biggest first, and the free space each one wants left after it.
 * The top 50 000 articles in full text, not the whole encyclopedia: on the assistant bench (2026-11-04, 50 crisis
 * questions, blind-graded) the 13.3 GB one scored no better than 1.2 GB or none, the answers come from the
 * guides. The intros-only edition keeps ~12 % of an article's text. The whole one stays in the Library.
 */
export const WIKIPEDIA_LADDER: { id: string; minFreeGB: number }[] = [
  { id: 'top-nopic', minFreeGB: 6 },
  { id: 'top-mini', minFreeGB: 0 },
];
