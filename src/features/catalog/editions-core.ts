// Which catalog archives stand for one another, so the Library neither counts nor downloads the same
// thing twice. Two relations:
// - Editions: Kiwix publishes many books in scopes (top: the best articles; all: every one) and depths
//   (mini: the introduction; nopic: the whole text; maxi: text and images). An edition holds another of
//   the same book when it is at least as wide and at least as deep ("wikipedia_es_all_nopic" holds
//   "wikipedia_es_top_mini"; "wikibooks_es_all_maxi" holds "wikibooks_es_all_nopic"). Each ZIM is
//   self-contained, so the smaller one next to the bigger only takes room.
// - Collections: an archive that carries another one whole (zimgit's post-disaster library holds the
//   documents of four smaller zimgit libraries).
// - Languages: resources sharing a `sameAs` key are the same work in another language (iFixit in
//   Spanish and in English). For someone whose app is in Spanish, the English one goes under "Other
//   languages": out of the counts and the packs (owner's decision, 2026-11-02).
// No `@/` imports: unit tests load this file directly.

const SCOPE: Record<string, number> = { top: 0, all: 1 };
const DEPTH: Record<string, number> = { mini: 0, nopic: 1, maxi: 2 };
const EDITION = /^(.+)_(top|all)_(mini|nopic|maxi)$/;

/**
 * Archives that carry others whole. zimgit-post-disaster_en 2024-05 has every PDF of these, byte for byte
 * (checked 2026-11-04 on the catalog's files: 47 PDFs, 194 MB). Without it the kit downloaded them twice and
 * the assistant found each passage twice. Recheck when one of them gets a newer file.
 */
const CARRIES: Record<string, string[]> = {
  'zimgit-post-disaster_en': ['zimgit-medicine_en', 'zimgit-water_en', 'zimgit-knots_en', 'zimgit-food-preparation_en'],
};

type Edition = { book: string; scope: number; depth: number };

function edition(id: string): Edition | null {
  const m = EDITION.exec(id);
  return m ? { book: m[1], scope: SCOPE[m[2]], depth: DEPTH[m[3]] } : null;
}

/**
 * Whether catalog id `outer` holds everything in `inner`: a bigger edition of the same book, or a collection
 * that carries it. Never itself.
 */
export function editionIncludes(outer: string, inner: string): boolean {
  if (CARRIES[outer]?.includes(inner)) return true;
  const a = edition(outer);
  const b = edition(inner);
  return !!a && !!b && outer !== inner && a.book === b.book && a.scope >= b.scope && a.depth >= b.depth;
}

type Sized = { id: string; sizeMB: number };

/** The installed resource that already holds `id`, or undefined. With several, the smallest one. */
export function coveringResource<R extends Sized>(resources: Record<string, R>, id: string, installed: (id: string) => boolean): R | undefined {
  let best: R | undefined;
  for (const r of Object.values(resources)) {
    if (!editionIncludes(r.id, id) || !installed(r.id)) continue;
    if (!best || r.sizeMB < best.sizeMB) best = r;
  }
  return best;
}

/** Installed catalog ids that `id` holds: what downloading it made redundant. */
export function heldBy(id: string, installedIds: Iterable<string>): string[] {
  return [...installedIds].filter((other) => editionIncludes(id, other));
}

type Translatable = { id: string; language: string; sameAs?: string };

/**
 * Ids of the visible resources that are the same work as another visible one in `primary` (the app's
 * language): English iFixit when Spanish iFixit is shown too. Language-neutral ("mul") resources and
 * ones with no counterpart in `primary` are never "other": English-only content stays in the counts.
 */
export function otherLanguageIds(visible: Translatable[], primary: string): Set<string> {
  const groups = new Set(visible.filter((r) => r.sameAs && r.language === primary).map((r) => r.sameAs));
  return new Set(visible.filter((r) => r.sameAs && groups.has(r.sameAs) && r.language !== primary && r.language !== 'mul').map((r) => r.id));
}

/** A pack without the editions another one in it holds: Wikibooks with images makes the text-only one moot. */
export function withoutHeld<R extends { id: string }>(resources: R[]): R[] {
  return resources.filter((r) => !resources.some((o) => editionIncludes(o.id, r.id)));
}
