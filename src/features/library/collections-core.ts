// Which collection of the Library an installed archive belongs to. The Library groups everything by topic
// (owner's decision, 2026-11-02): the catalog's categories plus Wikipedia, Courses and "Other files" for
// archives the catalog doesn't know (imports, Kiwix downloads). Each archive lives in exactly one of them.
// No `@/` imports: unit tests load this file directly.

export const WIKIPEDIA = 'wikipedia';
export const COURSES = 'courses';
export const OTHER = 'other';

export type CollectionItem = { id: string; catalogId: string | null; category: string | null; isCourse: boolean };

export type CollectionIndex = {
  /** Resource id → the first category (in display order) whose tiers list it. */
  categoryOf: Record<string, string>;
  /** Resources of the catalog's `reference` category (the Wikipedia sizes). */
  reference: Set<string>;
  categories: Set<string>;
};

type CatalogShape = {
  categories: { slug: string; tiers: { resources: string[] }[] }[];
  resources: Record<string, { category: string }>;
};

/** `categories` in the order the Library shows them: a resource listed in two belongs to the first. */
export function buildCollectionIndex(catalog: CatalogShape, order: string[] = []): CollectionIndex {
  const rank = (slug: string) => {
    const i = order.indexOf(slug);
    return i < 0 ? order.length : i;
  };
  const categories = [...catalog.categories].sort((a, b) => rank(a.slug) - rank(b.slug));
  const categoryOf: Record<string, string> = {};
  for (const c of categories) for (const t of c.tiers) for (const id of t.resources) categoryOf[id] ??= c.slug;
  const reference = new Set(Object.entries(catalog.resources).filter(([, r]) => r.category === 'reference').map(([id]) => id));
  return { categoryOf, reference, categories: new Set(categories.map((c) => c.slug)) };
}

/** A whole-Wikipedia archive by its Kiwix name ("wikipedia_en_all_maxi", "wikipedia_en_100_mini"), not a topical one. */
const WIKIPEDIA_ID = /^wikipedia_[a-z]{2,3}(?:-[a-z]+)?_(?:all|top|100)(?:_|$)/;

export function collectionOf(item: CollectionItem, index: CollectionIndex): string {
  if (item.isCourse) return COURSES;
  const id = item.catalogId ?? item.id;
  // A topical Wikipedia (medicine, computing) sits in its category's tiers, so this check goes first.
  const category = index.categoryOf[id];
  if (category) return category;
  if (index.reference.has(id) || WIKIPEDIA_ID.test(id)) return WIKIPEDIA;
  if (item.category && index.categories.has(item.category)) return item.category;
  return OTHER;
}

/**
 * How many of a collection are on the phone. `mainIds` are the catalog resources that count (the app's
 * language, content with no counterpart in it, language-neutral ones); `otherIds` the same works in
 * another language, which never count. `has` says whether a resource is on the phone anywhere (another
 * collection may file it: a course, a book two categories list) or held by a bigger edition that is.
 * Members outside both lists (imports, archives the catalog doesn't know) count as one more each.
 */
export function collectionCount(
  mainIds: string[],
  otherIds: string[],
  memberIds: (string | null)[],
  has: (id: string) => boolean,
): { have: number; total: number } {
  const main = new Set(mainIds);
  const other = new Set(otherIds);
  const extra = memberIds.filter((id) => !id || (!main.has(id) && !other.has(id))).length;
  return { have: [...main].filter(has).length + extra, total: main.size + extra };
}
