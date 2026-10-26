// The starter kit the onboarding proposes (docs/UX_SURVIVAL_PLAN.md): one list computed for
// the user's country and phone, each piece with a switch. The country download (map,
// navigation, emergency points) is sized by maps' useCountrySize; this file picks the
// catalog content and the assistant model.
import { catalog, getResource, matchesLanguages, tierResources, type CatalogResource } from '@/features/catalog';
import { GGUF_MODELS, recommendModel, type GgufModel } from '@/features/assistant/models';

/** Essential guides: first aid and medicine, survival, water and food, in the content languages. */
const GUIDE_CATEGORIES: { slug: string; maxItemMB: number }[] = [
  { slug: 'medicine', maxItemMB: 300 },
  { slug: 'survival', maxItemMB: 300 },
  { slug: 'agriculture', maxItemMB: 100 },
];
/** Worth having anyway, though bigger than the cap above. */
const EXTRA_GUIDES = ['zimgit-post-disaster_en'];

export function guideResources(langs: string[]): CatalogResource[] {
  const out = new Map<string, CatalogResource>();
  for (const { slug, maxItemMB } of GUIDE_CATEGORIES) {
    const category = catalog.categories.find((c) => c.slug === slug);
    const tier = category?.tiers[0];
    if (!category || !tier) continue;
    for (const r of tierResources(category, tier, langs)) if (r.sizeMB <= maxItemMB) out.set(r.id, r);
  }
  for (const id of EXTRA_GUIDES) {
    const r = getResource(id);
    if (r && matchesLanguages(r, langs)) out.set(r.id, r);
  }
  return [...out.values()];
}

/** Wikipedia variants, biggest first, and the free space each one wants left after it. */
const WIKIPEDIA_LADDER: { id: string; minFreeGB: number }[] = [
  { id: 'all-nopic', minFreeGB: 60 },
  { id: 'all-mini', minFreeGB: 20 },
  { id: 'top-nopic', minFreeGB: 6 },
  { id: 'top-mini', minFreeGB: 0 },
];

/**
 * The biggest Wikipedia that leaves the phone comfortable: the whole encyclopedia when
 * there is plenty of room (months without internet), the top articles otherwise.
 */
export function pickWikipedia(lang: 'es' | 'en', freeBytesAfterRest: number): { optionId: string; resource: CatalogResource } | null {
  const options = catalog.wikipedia[lang] ?? [];
  for (const step of WIKIPEDIA_LADDER) {
    const option = options.find((o) => o.id === step.id);
    const resource = option && getResource(option.resourceId);
    if (!resource) continue;
    if (freeBytesAfterRest - resource.sizeMB * 1e6 >= step.minFreeGB * 1e9) return { optionId: step.id, resource };
  }
  return null;
}

/** The assistant model to download, unless the phone's own model is available. */
export function pickModel(ram: number | null): GgufModel {
  return recommendModel(ram) ?? GGUF_MODELS[0];
}
