// Decisions the download manager takes, kept apart from expo-file-system so they can be
// unit-tested: whether a download may start on the current network ("Wi-Fi only"), what a
// failed transfer means for the bytes already downloaded, which file name is safe to write,
// whether a finished file is the one the server promised and what cancelling a row does.
// No `@/` imports: unit tests load this file directly.
import { downloadErrorKind } from './errors.ts';

/** What expo-network reports; `type` is a NetworkStateType value ('WIFI', 'CELLULAR'…). */
export type NetworkSnapshot = { type?: string; isConnected?: boolean; isInternetReachable?: boolean };

/**
 * go: a download may start. wifi: it waits for Wi-Fi (mobile data with "Wi-Fi only" on).
 * offline: it waits for a connection. unknown: the network hasn't been read yet (startup).
 */
export type NetworkGate = 'go' | 'wifi' | 'offline' | 'unknown';

export function networkGate(net: NetworkSnapshot | null, wifiOnly: boolean, allowCellular = false): NetworkGate {
  if (!net) return 'unknown';
  // Android says "not reachable" until it has validated the network: starting then only fails.
  if (net.isConnected === false || net.isInternetReachable === false) return 'offline';
  if (wifiOnly && !allowCellular && net.type === 'CELLULAR') return 'wifi';
  return 'go';
}

/** What to do after a transfer failed. */
export type FailurePlan =
  /** The saved state can't be continued: drop it and the partial file, start from zero. */
  | { kind: 'restart' }
  /** A passing problem (network, busy server): keep the bytes and try again by itself. */
  | { kind: 'retry'; delayMs: number }
  /** Show the error. The bytes stay, so the person's Retry continues where it stopped. */
  | { kind: 'fail' };

export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/**
 * The resume data (iOS) or partial file (Android) is no use any more: the state is unreadable,
 * or the server refused the range request (412: the file changed, 416: the offset is past its
 * end, 404/410: it is gone). Timeouts and rate limits (408, 429) are not about the file.
 */
export function isStaleResumeError(error: string): boolean {
  if (/invalid resume data|no resume ?data|has no resumeData|destination length does not match/i.test(error)) return true;
  const { kind, status } = downloadErrorKind(error);
  return kind === 'server' && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * `resumed`: the attempt continued saved state. `failures`: consecutive failures before this
 * one (the manager resets the count when bytes arrive).
 */
export function planAfterFailure(error: string, o: { resumed: boolean; failures: number }): FailurePlan {
  if (o.resumed && isStaleResumeError(error)) return { kind: 'restart' };
  const { kind, status } = downloadErrorKind(error);
  const transient = kind === 'offline' || (kind === 'server' && (status === undefined || status >= 500 || status === 408 || status === 429));
  if (transient) return o.failures < RETRY_DELAYS_MS.length ? { kind: 'retry', delayMs: RETRY_DELAYS_MS[o.failures] } : { kind: 'fail' };
  // An unexplained failure while continuing saved state may be the state itself (iOS keeps
  // resume data in a temp file it can purge): one more try with it, then from zero.
  if (o.resumed && kind === 'other') return o.failures < 1 ? { kind: 'retry', delayMs: RETRY_DELAYS_MS[0] } : { kind: 'restart' };
  return { kind: 'fail' };
}

const MAX_NAME = 200;

/**
 * A file name taken from a remote catalog, reduced to one plain name inside a content dir:
 * no path separators or leading dots (a decoded "..%2F..%2FSQLite%2Fnomad.db" must not climb
 * out of content/zim), only characters every file system takes. `fallback` is cleaned the
 * same way and used when nothing is left.
 */
export function safeFileName(name: string, fallback: string): string {
  const clean = (s: string) =>
    (s.split(/[/\\]/).pop() ?? '')
      .replace(/[^\w.+-]/g, '_')
      .replace(/^\.+/, '')
      .slice(-MAX_NAME);
  return clean(name) || clean(fallback) || 'download';
}

/** What the source promised about a file (Kiwix metalink, a manifest). */
export type Integrity = { size?: number; sha256?: string };

/** Why a finished file isn't the promised one, or null. `sha256` is only needed when one is expected. */
export function integrityProblem(actual: { size: number; sha256?: string }, expected: Integrity | undefined): string | null {
  if (!expected) return null;
  if (expected.size !== undefined && actual.size !== expected.size) return `SIZE_MISMATCH: ${actual.size} bytes, expected ${expected.size}`;
  if (expected.sha256 && actual.sha256 !== undefined && actual.sha256.toLowerCase() !== expected.sha256.toLowerCase())
    return `CHECKSUM_MISMATCH: sha-256 ${actual.sha256}`;
  return null;
}

/** Host of a URL, for remembering a mirror that served a bad file. */
export function urlHost(url: string): string {
  return /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
}

/**
 * What cancelling a Downloads-sheet row does to each of its records. A file being installed
 * ('processing') is kept: its handler would still install it. Unless the record is
 * `abortable` (a country's map or pack part): its assembly stops when the record goes.
 */
export function cancelAction(r: { status: string; meta: Record<string, unknown> }): 'dismiss' | 'cancel' | 'keep' {
  if (r.status === 'failed' || r.status === 'done') return 'dismiss';
  if (r.status === 'processing' && r.meta.abortable !== true) return 'keep';
  return 'cancel';
}
