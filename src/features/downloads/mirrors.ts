// Mirror selection for download.kiwix.org files. Its load balancer often redirects to a
// mirror that serves a single connection at a few hundred KB/s while others give tens of
// MB/s, so before a fresh download we read the file's metalink (.meta4, mirrors sorted
// for the client's location), time a small range request on the first few mirrors and
// keep the fastest. Any failure falls back to the original URL.
//
// The mirrors are volunteers' servers, so the metalink's <size> and sha-256 are kept too:
// the manager checks the finished file against them (Kiwix's own downloader does).
// No `@/` imports: unit tests load this file directly.
import { urlHost, type Integrity } from './manager-core.ts';

const KIWIX_HOST = /^https:\/\/(?:lb\.)?download\.kiwix\.org\//;
const CANDIDATES = 4;
const PROBE_BYTES = 512 * 1024;
const META_TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
  const name = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const file = new RegExp(`<file\\b[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)</file>`).exec(doc)?.[1];
  if (!file) return {};
  const out: Integrity = {};
  const size = /<size>\s*(\d+)\s*<\/size>/.exec(file)?.[1];
  if (size) out.size = Number(size);
  // Only the whole-file hash: <pieces> holds per-piece sha-1 hashes without a type.
  const sha256 = /<hash\s+type="sha-256"\s*>\s*([0-9a-fA-F]{64})\s*<\/hash>/.exec(file)?.[1];
  if (sha256) out.sha256 = sha256.toLowerCase();
  return out;
}

/** Milliseconds to fetch the first PROBE_BYTES, or Infinity on failure. */
async function probe(url: string): Promise<number> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, signal: controller.signal });
    // A mirror ignoring Range would send the whole (multi-GB) file: drop it unread.
    if (res.status !== 206) {
      controller.abort();
      return Infinity;
    }
    const body = await res.arrayBuffer();
    return body.byteLength > 0 ? Date.now() - start : Infinity;
  } catch {
    return Infinity;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The fastest mirror for a download.kiwix.org URL, and what its metalink promises about the
 * file; other URLs are returned unchanged. `avoid`: hosts that already served a bad copy.
 */
export async function fastestMirror(url: string, avoid: readonly string[] = []): Promise<{ url: string; integrity: Integrity }> {
  if (!KIWIX_HOST.test(url)) return { url, integrity: {} };
  let integrity: Integrity = {};
  try {
    const filename = url.split('/').pop() ?? '';
    const res = await fetchWithTimeout(`${url}.meta4`, META_TIMEOUT_MS);
    if (!res.ok) return { url, integrity };
    const xml = await res.text();
    integrity = parseMetalinkIntegrity(xml, filename);
    const mirrors = parseMetalinkUrls(xml, filename)
      .filter((m) => !avoid.includes(urlHost(m)))
      .slice(0, CANDIDATES);
    if (!mirrors.length) return { url, integrity };
    const times = await Promise.all(mirrors.map(probe));
    const best = times.indexOf(Math.min(...times));
    return { url: Number.isFinite(times[best]) ? mirrors[best] : url, integrity };
  } catch {
    return { url, integrity };
  }
}
