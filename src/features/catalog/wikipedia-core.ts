// Which Wikipedia variants contain which. Kiwix publishes each language in two scopes (top: the
// 50,000 best articles; all: every article) and three depths (mini: the introduction; nopic: the
// whole text; maxi: the text and its images). A variant holds another when it is at least as wide
// and at least as deep, so downloading the smaller one next to it would only duplicate data.
// No `@/` imports: unit tests load this file directly.
import type { WikipediaOption } from './types.ts';

const SCOPE: Record<string, number> = { top: 0, all: 1 };
const DEPTH: Record<string, number> = { mini: 0, nopic: 1, maxi: 2 };

function rank(optionId: string): [number, number] | null {
  const [scope, depth] = optionId.split('-');
  return scope in SCOPE && depth in DEPTH ? [SCOPE[scope], DEPTH[depth]] : null;
}

/** Whether variant `outer` ("all-nopic") holds everything in variant `inner` ("top-mini"). Never itself. */
export function wikipediaIncludes(outer: string, inner: string): boolean {
  const a = rank(outer);
  const b = rank(inner);
  return !!a && !!b && outer !== inner && a[0] >= b[0] && a[1] >= b[1];
}

/**
 * The installed variant that already holds `resourceId`, or undefined. Options come smallest
 * first, so with several installed the smallest one that holds it is named.
 */
export function coveringWikipedia(
  options: Record<string, WikipediaOption[]>,
  resourceId: string,
  installed: (resourceId: string) => boolean,
): WikipediaOption | undefined {
  for (const list of Object.values(options)) {
    const own = list.find((o) => o.resourceId === resourceId);
    if (own) return list.find((o) => installed(o.resourceId) && wikipediaIncludes(o.id, own.id));
  }
  return undefined;
}
