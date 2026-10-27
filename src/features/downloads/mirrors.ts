// Where a download's bytes come from. For download.kiwix.org files: its load balancer often
// redirects to a mirror that serves one connection at a few hundred KB/s while others give
// tens of MB/s, so before a fresh download we read the file's metalink (.meta4), measure how
// fast every https mirror sends a few MB from a random spot in the file (sustained
// throughput, not the time to the first bytes: the quickest to answer is often a slow one)
// and rank them. Other URLs (GitHub Releases, Hugging Face) are one source; a one-byte range
// request tells whether they take ranges and how big the file is.
//
// The answer feeds the segmented engine (several connections, spread over the sources) or,
// when ranges aren't possible, a single transfer from the best source. Any failure falls back
// to the original URL.
//
// The mirrors are volunteers' servers, so the metalink's <size>, sha-256 and 4 MiB sha-1
// piece hashes are kept too: the manager checks every piece and the finished file against
// them (Kiwix's own downloader does). No `@/` imports: unit tests load this file directly.
import { urlHost, type Integrity } from './manager-core.ts';

const KIWIX_HOST = /^https:\/\/(?:lb\.)?download\.kiwix\.org\//;
/** Bytes asked of each mirror while measuring (less for small files). */
const PROBE_BYTES = 4 * 1024 * 1024;
/** Time counted from a mirror's first byte. */
const PROBE_WINDOW_MS = 2000;
const PROBE_TIMEOUT_MS = 5000;
const META_TIMEOUT_MS = 4000;

/** The parts of a fetch Response this needs: expo/fetch in the app (it streams), Node's in tests. */
export type ProbeResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
  text(): Promise<string>;
};
export type ProbeFetch = (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<ProbeResponse>;

/** sha-1 of every `length`-byte piece of the file, in order (Kiwix metalinks). */
export type Pieces = { length: number; sha1: string[] };

/** A URL serving the whole file, with what it measured (bytes per second, one connection; 0 = unknown). */
export type Source = { url: string; host: string; bps: number };

export type SourcePlan = {
  /** Best first. Never empty: the original URL when nothing else worked. */
  sources: Source[];
  /** Exact size, when the metalink or a range answer gave it. */
  size?: number;
  /** Every source answered a range request with 206. */
  ranges: boolean;
  integrity: Integrity;
  pieces?: Pieces;
};

async function fetchWithTimeout(fetch: ProbeFetch, url: string, ms: number): Promise<ProbeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The <file> element of `filename` in a .meta4 document, comments removed. */
function metalinkFile(xml: string, filename: string): string | undefined {
  const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
  return new RegExp(`<file\\b[^>]*\\bname="${escapeRe(filename)}"[^>]*>([\\s\\S]*?)</file>`).exec(doc)?.[1];
}

/** Mirror URLs of a .meta4 document, by priority (lowest first). */
export function parseMetalinkUrls(xml: string, filename: string): string[] {
  const out: { url: string; priority: number }[] = [];
  const re = /<url\b([^>]*)>\s*([^<\s]+)\s*<\/url>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const url = m[2].replace(/&amp;/g, '&');
    if (!/^https:\/\//.test(url) || !url.endsWith(`/${filename}`)) continue;
    const priority = Number(/priority="(\d+)"/.exec(m[1])?.[1] ?? 999);
    out.push({ url, priority });
  }
  return out.sort((a, b) => a.priority - b.priority).map((u) => u.url);
}

/** The <size> and sha-256 a .meta4 document gives for `filename` (empty when it has none). */
export function parseMetalinkIntegrity(xml: string, filename: string): Integrity {
  const file = metalinkFile(xml, filename);
  if (!file) return {};
  const out: Integrity = {};
  const size = /<size>\s*(\d+)\s*<\/size>/.exec(file)?.[1];
  if (size) out.size = Number(size);
  // Only the whole-file hash here: <pieces> holds the per-piece ones (parseMetalinkPieces).
  const sha256 = /<hash\s+type="sha-256"\s*>\s*([0-9a-fA-F]{64})\s*<\/hash>/.exec(file)?.[1];
  if (sha256) out.sha256 = sha256.toLowerCase();
  return out;
}

/** The sha-1 piece hashes of `filename`, or undefined (none, another type, or not enough to cover `size`). */
export function parseMetalinkPieces(xml: string, filename: string, size?: number): Pieces | undefined {
  const file = metalinkFile(xml, filename);
  const m = file && /<pieces\b([^>]*)>([\s\S]*?)<\/pieces>/.exec(file);
  if (!m || !/type="sha-1"/.test(m[1])) return undefined;
  const length = Number(/length="(\d+)"/.exec(m[1])?.[1] ?? 0);
  const sha1 = [...m[2].matchAll(/<hash>\s*([0-9a-fA-F]{40})\s*<\/hash>/g)].map((h) => h[1].toLowerCase());
  if (!length || !sha1.length) return undefined;
  if (size !== undefined && sha1.length !== Math.ceil(size / length)) return undefined;
  return { length, sha1 };
}

/** The total size in a Content-Range header ("bytes 0-0/13312345678"). */
export function contentRangeTotal(header: string | null): number | undefined {
  const total = /\/(\d+)\s*$/.exec(header ?? '')?.[1];
  return total ? Number(total) : undefined;
}

/**
 * Bytes per second a source sends on one connection: a range of up to PROBE_BYTES at a random
 * offset, counted for PROBE_WINDOW_MS from the first byte (connection setup and TLS don't
 * count). 0 when it fails or ignores ranges. `total`: the file size it reported.
 */
export async function probeThroughput(
  fetch: ProbeFetch,
  url: string,
  size: number | undefined,
  o: { now?: () => number; random?: () => number } = {},
): Promise<{ bps: number; total?: number }> {
  const now = o.now ?? Date.now;
  const len = Math.max(64 * 1024, Math.min(PROBE_BYTES, size ? Math.floor(size / 8) : PROBE_BYTES));
  // Deep in the file: the first bytes are often cached and fast everywhere.
  const offset = size && size > len ? Math.floor(((o.random ?? Math.random)() * (size - len)) / 4096) * 4096 : 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const asked = now();
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + len - 1}` }, signal: controller.signal });
    // A mirror ignoring Range would send the whole (multi-GB) file: drop it unread.
    if (res.status !== 206 || !res.body) {
      controller.abort();
      return { bps: 0 };
    }
    const total = contentRangeTotal(res.headers.get('content-range'));
    const reader = res.body.getReader();
    let first = 0;
    let bytes = 0;
    let all = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      all += value?.length ?? 0;
      if (!first) first = now();
      else bytes += value?.length ?? 0;
      if (now() - first >= PROBE_WINDOW_MS) break;
    }
    reader.cancel().catch(() => {});
    controller.abort();
    const elapsed = first ? now() - first : 0;
    // Everything came in one go: count from the request instead.
    const bps = elapsed >= 100 ? (bytes * 1000) / elapsed : (all * 1000) / Math.max(1, now() - asked);
    return { bps: all > 0 ? bps : 0, total };
  } catch {
    return { bps: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a single URL takes ranges (206 to a one-byte request), and the size it reports. */
async function probeRanges(fetch: ProbeFetch, url: string): Promise<{ ranges: boolean; total?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    const ranges = res.status === 206;
    const total = ranges ? contentRangeTotal(res.headers.get('content-range')) : undefined;
    controller.abort();
    return { ranges: ranges && total !== undefined, total };
  } catch {
    return { ranges: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where to fetch `url` from. download.kiwix.org files: every https mirror of its metalink
 * (except `avoid`, hosts that served a bad copy), measured and sorted, plus what the metalink
 * promises. Other URLs: that URL alone, with whether it takes ranges.
 */
export async function planSources(
  url: string,
  o: { fetch: ProbeFetch; avoid?: readonly string[]; probe?: typeof probeThroughput },
): Promise<SourcePlan> {
  const probe = o.probe ?? probeThroughput;
  const single = async (integrity: Integrity = {}, pieces?: Pieces): Promise<SourcePlan> => {
    const { ranges, total } = await probeRanges(o.fetch, url);
    return { sources: [{ url, host: urlHost(url), bps: 0 }], size: integrity.size ?? total, ranges, integrity, pieces };
  };
  if (!KIWIX_HOST.test(url)) return single();
  let integrity: Integrity = {};
  let pieces: Pieces | undefined;
  try {
    const filename = url.split('/').pop() ?? '';
    const res = await fetchWithTimeout(o.fetch, `${url}.meta4`, META_TIMEOUT_MS);
    if (!res.ok) return single();
    const xml = await res.text();
    integrity = parseMetalinkIntegrity(xml, filename);
    pieces = parseMetalinkPieces(xml, filename, integrity.size);
    const avoid = o.avoid ?? [];
    const mirrors = parseMetalinkUrls(xml, filename).filter((m) => !avoid.includes(urlHost(m)));
    if (!mirrors.length) return single(integrity, pieces);
    // All at once (~2–3 s in total). They share the link, which squeezes the ranking but keeps
    // its order; the segmented engine keeps measuring while it downloads.
    const probes = await Promise.all(mirrors.map((m) => probe(o.fetch, m, integrity.size)));
    const sources = mirrors
      .map((m, i) => ({ url: m, host: urlHost(m), bps: probes[i].bps }))
      .filter((s) => s.bps > 0)
      .sort((a, b) => b.bps - a.bps);
    if (!sources.length) return single(integrity, pieces);
    const size = integrity.size ?? probes.find((p) => p.total !== undefined)?.total;
    return { sources, size, ranges: true, integrity, pieces };
  } catch {
    return single(integrity, pieces);
  }
}
