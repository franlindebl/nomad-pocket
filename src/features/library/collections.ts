// The Library's collections, in the order the tab shows them, each with the archives on the phone that
// belong to it and how many the catalog offers. collections-core.ts files each archive in exactly one,
// but a collection also shows (and counts) the catalog archives it lists that another one filed: a course
// in Computing, a book two categories list. Works in another language stay out of the counts and the
// packs (features/catalog/editions.ts), and so do editions a bigger installed one already holds.
import { router } from 'expo-router';
import { FolderOpen, Globe, GraduationCap, type LucideIcon } from 'lucide-react-native';
import { useMemo } from 'react';

import { catalog, courseResources, getResource, loc, matchesLanguages, sumMB, tierResources } from '@/features/catalog';
import { hasOrHeld, otherLanguageSet } from '@/features/catalog/editions';
import { withoutHeld } from '@/features/catalog/editions-core';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { useItems, type InstalledItem } from '@/features/content/items';
import i18n from '@/i18n';
import { formatMB } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import type { Hue } from '@/theme';

import { buildCollectionIndex, collectionCount, collectionOf, COURSES, OTHER, WIKIPEDIA } from './collections-core';

/** Crisis first: what you need in an emergency before what you learn with time. Not in the list: last. */
export const COLLECTION_ORDER = ['medicine', 'survival', WIKIPEDIA, 'agriculture', 'diy', 'education', 'computing', COURSES, OTHER];

const index = buildCollectionIndex(catalog, COLLECTION_ORDER);

export type Collection = {
  key: string;
  title: string;
  icon: LucideIcon;
  hue: Hue;
  /** Archives on the phone filed here, newest first. */
  members: InstalledItem[];
  have: number;
  total: number;
  /** What it takes to start one with nothing in it ("Essential pack · 510 MB"). */
  emptyHint: string;
};

/** The collection an installed archive is filed in. */
export function collectionOfItem(item: InstalledItem): string {
  return collectionOf(item, index);
}

function wikipediaIds(langs: string[]): string[] {
  return (['es', 'en'] as const).filter((l) => langs.includes(l)).flatMap((l) => (catalog.wikipedia[l] ?? []).map((o) => o.resourceId));
}

/** Every collection, empty ones included except "Other files", which shows only when something is in it. */
export function useCollections(): Collection[] {
  const items = useItems('zim');
  const langs = useSettings((s) => s.contentLanguages);
  const primary = useSettings((s) => s.language);
  const lang = i18n.language;
  return useMemo(() => {
    const t = i18n.getFixedT(lang, 'library');
    const other = otherLanguageSet(langs, primary);
    const main = (ids: string[]) => ids.filter((id) => !other.has(id));
    const has = (id: string) => hasOrHeld(items, id);
    const make = (key: string, title: string, icon: LucideIcon, hue: Hue, catalogIds: string[], emptyHint: string): Collection => {
      const listed = new Set(catalogIds);
      const members = items.filter((i) => collectionOfItem(i) === key || (!!i.catalogId && listed.has(i.catalogId)));
      const mainIds = main(catalogIds);
      const { have, total } = collectionCount(
        mainIds,
        catalogIds.filter((id) => other.has(id)),
        members.map((m) => m.catalogId ?? m.id),
        has,
      );
      return { key, title, icon, hue, members, have, total, emptyHint };
    };
    const out: Collection[] = [];
    for (const key of COLLECTION_ORDER) {
      if (key === WIKIPEDIA) {
        const ids = wikipediaIds(langs);
        const smallest = main(ids).map(getResource).filter(Boolean)[0];
        out.push(make(key, t('wikipedia'), Globe, 'reference', ids, smallest ? t('wikipediaFrom', { size: formatMB(smallest.sizeMB) }) : ''));
      } else if (key === COURSES) {
        out.push(make(key, t('common:tabs.courses'), GraduationCap, 'education', courseResources(langs).map((r) => r.id), t('coursesBody')));
      } else if (key === OTHER) {
        if (items.some((i) => collectionOfItem(i) === OTHER)) out.push(make(key, t('other'), FolderOpen, 'neutral', [], ''));
      } else {
        const c = catalog.categories.find((x) => x.slug === key);
        if (!c) continue;
        const all = tierResources(c, c.tiers[c.tiers.length - 1], langs);
        // Computing has no essential level: no hint.
        const tier = c.tiers.find((x) => x.recommended);
        const essential = tier ? withoutHeld(tierResources(c, tier, langs).filter((r) => !other.has(r.id))) : [];
        const hint = essential.length ? t('essentialPack', { size: formatMB(sumMB(essential)) }) : '';
        out.push(make(key, loc(c.name), iconByName(c.icon), c.hue ?? categoryHue(c.slug), all.map((r) => r.id), hint));
      }
    }
    // Categories a newer catalog adds that the order above doesn't know yet.
    for (const c of catalog.categories) {
      if (COLLECTION_ORDER.includes(c.slug)) continue;
      const all = tierResources(c, c.tiers[c.tiers.length - 1], langs);
      if (all.length) out.push(make(c.slug, loc(c.name), iconByName(c.icon), c.hue ?? categoryHue(c.slug), all.map((r) => r.id), ''));
    }
    return out;
  }, [items, langs, primary, lang]);
}

/** Whether any catalog resource is in the user's content languages (else the Library says to change them). */
export function catalogHasLanguages(langs: string[]): boolean {
  return Object.values(catalog.resources).some((r) => matchesLanguages(r, langs));
}

export function openCollection(key: string) {
  if (key === WIKIPEDIA) router.push('/library/wikipedia');
  else if (key === COURSES) router.push('/library/courses');
  else if (key === OTHER) router.push('/library/others');
  else router.push({ pathname: '/library/category/[slug]', params: { slug: key } });
}
