// The starter kit the onboarding proposes (docs/UX_SURVIVAL_PLAN.md): one list computed for
// the user's country and phone, each piece with a switch. The country download (map,
// navigation, emergency points) is sized by maps' useCountrySize; this file picks the
// catalog content (kit-core.ts: every collection's essential level) and the assistant model.
import { catalog, getResource, type CatalogResource } from '@/features/catalog';
import { GGUF_MODELS, recommendModel, type GgufModel } from '@/features/assistant/models';

import { essentialResources, WIKIPEDIA_LADDER } from './kit-core';

/** The essential guides: every collection's "Essential" level in the content languages. */
export function guideResources(langs: string[], primary: string): CatalogResource[] {
  return essentialResources(catalog, langs, primary);
}

/**
 * The biggest Wikipedia of the ladder that leaves the phone comfortable: the top articles in full,
 * their intros when space is short.
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
