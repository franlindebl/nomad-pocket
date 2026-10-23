// Starter packs for the setup wizard, derived from the catalog (like NOMAD's
// Easy Setup tiers). Wikipedia is added only in the primary content language.
import { catalog, getResource, tierResources, type CatalogResource } from '@/features/catalog';

export type PackId = 'light' | 'balanced' | 'complete' | 'none';

type PackDef = {
  wikipedia: string;
  tierIndex: number;
  categories?: string[];
  /** Only the primary language (plus language-neutral content). */
  primaryOnly?: boolean;
  /** Skip single resources above this size (big video collections). */
  maxItemMB?: number;
};

const PACK_DEF: Record<Exclude<PackId, 'none'>, PackDef> = {
  light: { wikipedia: 'top-mini', tierIndex: 0, categories: ['medicine', 'survival'], primaryOnly: true, maxItemMB: 300 },
  balanced: { wikipedia: 'top-nopic', tierIndex: 0, maxItemMB: 1500 },
  complete: { wikipedia: 'all-mini', tierIndex: 1 },
};

export function packResources(id: PackId, langs: string[], primary: 'es' | 'en'): CatalogResource[] {
  if (id === 'none') return [];
  const def = PACK_DEF[id];
  const out = new Map<string, CatalogResource>();
  const wikiLang = langs.includes(primary) ? primary : (langs[0] as 'es' | 'en');
  const tierLangs = def.primaryOnly ? [wikiLang] : langs;
  const wiki = catalog.wikipedia[wikiLang]?.find((o) => o.id === def.wikipedia);
  const wikiRes = wiki && getResource(wiki.resourceId);
  if (wikiRes) out.set(wikiRes.id, wikiRes);
  for (const category of catalog.categories) {
    if (def.categories && !def.categories.includes(category.slug)) continue;
    const tier = category.tiers[Math.min(def.tierIndex, category.tiers.length - 1)];
    if (!tier) continue;
    for (const r of tierResources(category, tier, tierLangs)) {
      if (def.maxItemMB && r.sizeMB > def.maxItemMB) continue;
      out.set(r.id, r);
    }
  }
  return [...out.values()];
}
