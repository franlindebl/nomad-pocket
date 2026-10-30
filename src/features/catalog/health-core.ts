// The catalog without health content, for builds without health features (src/lib/health.ts):
// every medical archive, the medicine category, the health course subject and the survival
// archives that are mostly first aid. No `@/` imports: unit tests load this file directly.
import type { Catalog, CatalogResource } from './types.ts';

/** Survival archives that are mostly medical and first-aid guides, though not tagged medical. */
export const FIRST_AID_ARCHIVES = new Set(['zimgit-post-disaster_en']);

const HEALTH_CATEGORY = 'medicine';
const HEALTH_SUBJECT = 'health';

export function isHealthResource(r: CatalogResource): boolean {
  return !!r.medical || r.category === HEALTH_CATEGORY || r.subject === HEALTH_SUBJECT || FIRST_AID_ARCHIVES.has(r.id);
}

export function withoutHealth(catalog: Catalog): Catalog {
  const resources = Object.fromEntries(Object.entries(catalog.resources).filter(([, r]) => !isHealthResource(r)));
  const kept = (id: string) => id in resources;
  return {
    ...catalog,
    resources,
    categories: catalog.categories
      .filter((c) => c.slug !== HEALTH_CATEGORY)
      .map((c) => ({ ...c, tiers: c.tiers.map((t) => ({ ...t, resources: t.resources.filter(kept) })) })),
    wikipedia: { es: catalog.wikipedia.es.filter((o) => kept(o.resourceId)), en: catalog.wikipedia.en.filter((o) => kept(o.resourceId)) },
    courseSubjects: catalog.courseSubjects.filter((s) => s.slug !== HEALTH_SUBJECT),
    courses: catalog.courses.filter(kept),
  };
}

/** Ids the full catalog has and the one without health drops: Explore hides them too. */
export function healthResourceIds(catalog: Catalog): Set<string> {
  return new Set(
    Object.values(catalog.resources)
      .filter(isHealthResource)
      .map((r) => r.id),
  );
}
