// Starter packs for the setup wizard, derived from the catalog (like NOMAD's
// Easy Setup tiers). Wikipedia is added only in the primary content language.
import { catalog, getResource, tierResources, type CatalogResource } from '@/features/catalog';

export type PackId = 'light' | 'balanced' | 'complete' | 'none';

const PACK_DEF: Record<Exclude<PackId, 'none'>, { wikipedia: string; tierIndex: number; categories?: string[] }> = {
  light: { wikipedia: 'top-mini', tierIndex: 0, categories: ['medicine', 'survival'] },
  balanced: { wikipedia: 'top-nopic', tierIndex: 0 },
  complete: { wikipedia: 'all-mini', tierIndex: 1 },
};

export function packResources(id: PackId, langs: string[], primary: 'es' | 'en'): CatalogResource[] {
  if (id === 'none') return [];
  const def = PACK_DEF[id];
  const out = new Map<string, CatalogResource>();
  const wikiLang = langs.includes(primary) ? primary : (langs[0] as 'es' | 'en');
  const wiki = catalog.wikipedia[wikiLang]?.find((o) => o.id === def.wikipedia);
  const wikiRes = wiki && getResource(wiki.resourceId);
  if (wikiRes) out.set(wikiRes.id, wikiRes);
  for (const category of catalog.categories) {
    if (def.categories && !def.categories.includes(category.slug)) continue;
    const tier = category.tiers[Math.min(def.tierIndex, category.tiers.length - 1)];
    if (!tier) continue;
    for (const r of tierResources(category, tier, langs)) out.set(r.id, r);
  }
  return [...out.values()];
}
