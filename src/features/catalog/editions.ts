// The app side of editions-core.ts: which catalog resources go under "Other languages" for this person,
// and which installed archive already holds a resource (a bigger edition of the same book).
import { useMemo } from 'react';

import { useContent } from '@/features/content/items';
import { useSettings } from '@/stores/settings';

import { coveringResource, otherLanguageIds } from './editions-core';
import { catalog, loc, matchesLanguages } from './index';
import type { CatalogResource } from './types';

const cache = new Map<string, Set<string>>();

/** Catalog ids that are the same work as a visible one in `primary`, the app's language. */
export function otherLanguageSet(langs: string[], primary: string): Set<string> {
  const key = `${primary}|${langs.join(',')}`;
  let set = cache.get(key);
  if (!set) {
    set = otherLanguageIds(
      Object.values(catalog.resources).filter((r) => matchesLanguages(r, langs)),
      primary,
    );
    cache.set(key, set);
  }
  return set;
}

export function useOtherLanguage(): Set<string> {
  const langs = useSettings((s) => s.contentLanguages);
  const primary = useSettings((s) => s.language);
  return useMemo(() => otherLanguageSet(langs, primary), [langs, primary]);
}

/** Resources that count in totals and packs, then the ones under "Other languages". */
export function splitByLanguage(resources: CatalogResource[], other: Set<string>): [CatalogResource[], CatalogResource[]] {
  return [resources.filter((r) => !other.has(r.id)), resources.filter((r) => other.has(r.id))];
}

/** How a resource is named next to its siblings: a Wikipedia by its size option ("Completa (sin imágenes)"). */
export function editionName(r: CatalogResource): string {
  for (const list of Object.values(catalog.wikipedia)) {
    const option = list.find((o) => o.resourceId === r.id);
    if (option) return loc(option.name);
  }
  return loc(r.title);
}

type Items = { catalogId: string | null; id: string }[];

const isInstalled = (items: Items, id: string) => items.some((i) => i.catalogId === id || i.id === id);

/** Whether a catalog resource is on the phone, or held by a bigger edition that is. */
export function hasOrHeld(items: Items, id: string): boolean {
  return isInstalled(items, id) || !!coveringResource(catalog.resources, id, (x) => isInstalled(items, x));
}

/** The installed archive that already holds this resource (a bigger edition of it), if any. */
export function useCovering(resourceId: string) {
  // Selectors return store or catalog objects (stable references), never new ones.
  const resource = useContent((s) => coveringResource(catalog.resources, resourceId, (id) => isInstalled(s.items, id)));
  const item = useContent((s) => (resource ? s.items.find((i) => i.catalogId === resource.id || i.id === resource.id) : undefined));
  return resource && item ? { resource, item, name: editionName(resource) } : null;
}
