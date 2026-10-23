// Kiwix OPDS v2 client ("Explore all of Kiwix").
//
// The Kiwix library publishes its catalog as an Atom/OPDS feed at
// https://opds.library.kiwix.org/catalog/v2/entries (library.kiwix.org 301-redirects
// there). React Native has `fetch` but no DOMParser, so the feed is parsed with a
// small string/regex parser that only understands the subset of Atom Kiwix emits.
//
// Keep this file free of React Native and path-alias imports: it is unit-tested with
// `node --test --experimental-strip-types`.

export const OPDS_BASE = 'https://opds.library.kiwix.org';
const ENTRIES_PATH = '/catalog/v2/entries';
const ACQUISITION_REL = 'http://opds-spec.org/acquisition/open-access';
const THUMBNAIL_REL = 'http://opds-spec.org/image/thumbnail';

export type KiwixEntry = {
  /** Book UUID (without the "urn:uuid:" prefix). */
  id: string;
  /**
   * Book name without date, including the flavour when there is one, e.g.
   * "wikipedia_es_top_mini" (OPDS `<name>` "wikipedia_es_top" + `<flavour>` "mini").
   * Stable across versions; matches catalog resource ids / `kiwixName`.
   */
  name: string;
  /** OPDS `<flavour>` ("mini" | "nopic" | "maxi" | …), or null. */
  flavour: string | null;
  title: string;
  description: string;
  /** ISO 639-3 code(s) as published, e.g. "spa" or "eng,spa,fra". */
  language: string;
  category: string | null;
  sizeBytes: number;
  /** YYYY-MM of this file. */
  version: string;
  /** Direct .zim URL (the .meta4 acquisition link with ".meta4" stripped). */
  url: string;
  articleCount: number | null;
  /** Absolute URL of the 48px illustration, when published. */
  illustrationUrl: string | null;
  /** Public tags (internal "_key:value" tags are omitted). */
  tags: string[];
};

export type OpdsFeed = { total: number; entries: KiwixEntry[] };

export type SearchParams = {
  q?: string;
  /** ISO 639-3 codes; an array or comma-separated string. */
  lang?: ('spa' | 'eng')[] | string;
  category?: string;
  start?: number;
  count?: number;
};

// ---------------------------------------------------------------------------
// XML helpers

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[ent];
    return named ?? match;
  });
}

/**
 * Text content of a node. Child markup is dropped and entities decoded. CDATA
 * sections are treated as embedded HTML (tags dropped, entities decoded), which is
 * what feeds put there in practice.
 */
function textContent(raw: string): string {
  const plain = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ''));
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('<![CDATA[', i);
    if (start === -1) {
      out += plain(raw.slice(i));
      break;
    }
    out += plain(raw.slice(i, start));
    const end = raw.indexOf(']]>', start + 9);
    const cdata = raw.slice(start + 9, end === -1 ? raw.length : end);
    out += plain(cdata);
    if (end === -1) break;
    i = end + 3;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inner text of the first `<tag>` (optionally namespaced) in `xml`, or null. */
function childText(xml: string, tag: string): string | null {
  const t = escapeRegExp(tag);
  const re = new RegExp(`<${t}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${t}\\s*>)`);
  const m = re.exec(xml);
  if (!m) return null;
  return textContent(m[1] ?? '');
}

function parseAttributes(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}

function links(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = /<link\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(parseAttributes(m[1]));
  return out;
}

function absolute(href: string, base: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${base}${href}`;
  return `${base}/${href}`;
}

function toInt(s: string | null | undefined): number | null {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ---------------------------------------------------------------------------
// Feed parsing

function parseEntry(rawXml: string, base: string): KiwixEntry | null {
  const allLinks = links(rawXml);
  // <author>/<publisher> contain their own <name>; drop them before reading fields.
  const xml = rawXml.replace(/<(author|publisher|contributor)\b[\s\S]*?<\/\1\s*>/g, '');
  const acquisition = allLinks.find((l) => l.rel === ACQUISITION_REL);
  if (!acquisition?.href) return null;
  const url = acquisition.href.replace(/\.meta4$/i, '');

  const rawId = childText(xml, 'id') ?? '';
  const id = rawId.replace(/^urn:uuid:/i, '');

  const fileName = url.slice(url.lastIndexOf('/') + 1);
  // File names end in _YYYY-MM.zim, sometimes with a respin letter (_2026-10a.zim).
  const fileMatch = /^(.*)_(\d{4}-\d{2})[a-z]?\.zim$/i.exec(fileName);
  const issued = childText(xml, 'dc:issued') ?? childText(xml, 'updated') ?? '';
  const version = fileMatch?.[2] ?? (/^\d{4}-\d{2}/.exec(issued)?.[0] ?? '');

  const flavour = childText(xml, 'flavour') || null;
  const baseName = childText(xml, 'name') || '';
  const name = baseName ? (flavour ? `${baseName}_${flavour}` : baseName) : fileMatch?.[1] || id;

  const rawTags = (childText(xml, 'tags') ?? '').split(';').map((t) => t.trim()).filter(Boolean);
  const tags = rawTags.filter((t) => !t.startsWith('_'));
  let category = childText(xml, 'category') || null;
  if (!category) {
    const catTag = rawTags.find((t) => t.startsWith('_category:'));
    category = catTag ? catTag.slice('_category:'.length) || null : null;
  }

  const thumb = allLinks.find((l) => l.rel === THUMBNAIL_REL);

  return {
    id,
    name,
    flavour,
    title: childText(xml, 'title') ?? name,
    description: childText(xml, 'summary') ?? '',
    language: childText(xml, 'language') ?? '',
    category,
    sizeBytes: toInt(acquisition.length) ?? 0,
    version,
    url,
    articleCount: toInt(childText(xml, 'articleCount')),
    illustrationUrl: thumb?.href ? absolute(thumb.href, base) : null,
    tags,
  };
}

/** Parse a Kiwix OPDS v2 acquisition feed. Malformed entries are skipped. */
export function parseOpdsFeed(xml: string, base: string = OPDS_BASE): OpdsFeed {
  const entries: KiwixEntry[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const entry = parseEntry(m[1], base);
    if (entry) entries.push(entry);
  }
  // <totalResults> lives in the feed header (before the first entry).
  const firstEntry = xml.search(/<entry\b/);
  const header = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const total = toInt(childText(header, 'totalResults')) ?? entries.length;
  return { total, entries };
}

// ---------------------------------------------------------------------------
// Network

export function buildEntriesUrl(params: SearchParams & { name?: string }): string {
  const qs: string[] = [];
  const add = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === '') return;
    qs.push(`${k}=${encodeURIComponent(String(v))}`);
  };
  add('q', params.q?.trim());
  const lang = Array.isArray(params.lang) ? params.lang.join(',') : params.lang;
  add('lang', lang);
  add('category', params.category);
  add('name', params.name);
  add('start', params.start);
  add('count', params.count);
  return `${OPDS_BASE}${ENTRIES_PATH}${qs.length ? `?${qs.join('&')}` : ''}`;
}

async function fetchFeed(url: string, signal?: AbortSignal): Promise<OpdsFeed> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
  });
  if (!res.ok) throw new Error(`Kiwix catalog request failed: HTTP ${res.status}`);
  return parseOpdsFeed(await res.text());
}

/** Search the online Kiwix library. */
export function searchKiwix(params: SearchParams, signal?: AbortSignal): Promise<OpdsFeed> {
  return fetchFeed(buildEntriesUrl({ count: 50, ...params }), signal);
}

/** Newest first: by version (YYYY-MM), then by size as a tie-breaker. */
export function compareNewest(a: KiwixEntry, b: KiwixEntry): number {
  if (a.version !== b.version) return a.version < b.version ? 1 : -1;
  return b.sizeBytes - a.sizeBytes;
}

const FLAVOUR_SUFFIX = /_(mini|nopic|maxi)$/;

/**
 * Resolve the newest published file for a Kiwix book name, or null if unknown.
 * Accepts flavoured names ("wikipedia_es_top_mini"): OPDS indexes books by the
 * unflavoured `<name>`, so the flavour is stripped for the query and matched after.
 */
export async function resolveLatest(kiwixName: string, signal?: AbortSignal): Promise<KiwixEntry | null> {
  const queries = FLAVOUR_SUFFIX.test(kiwixName)
    ? [kiwixName.replace(FLAVOUR_SUFFIX, ''), kiwixName]
    : [kiwixName];
  for (const name of queries) {
    const { entries } = await fetchFeed(buildEntriesUrl({ name, count: 100 }), signal);
    const matches = entries.filter((e) => e.name === kiwixName);
    if (matches.length > 0) return [...matches].sort(compareNewest)[0];
  }
  return null;
}
