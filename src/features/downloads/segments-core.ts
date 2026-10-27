// Decisions of the segmented download engine (segmented.ts), kept apart from expo-file-system
// so they can be unit-tested: which byte range to fetch next and from which source, what a
// finished or failed range means for its source, when to fetch a slow range again elsewhere,
// and how much of the file is done.
//
// The file is cut into fixed chunks (a multiple of the metalink's piece size). Finished
// chunks are appended to the .part file in order, so the bytes [0, prefix) on disk are always
// complete and verified: that prefix is the whole resume state, it survives the app being
// killed, and chunks that finished out of order wait as their own files. The next chunk is
// always the lowest one missing, within `aheadBytes` of the prefix (bounding that extra space).
//
// Sources are mirrors of the same file (Kiwix) or one URL taken several times (GitHub,
// Hugging Face). Each keeps a moving average of what one connection to it gives; a free
// connection goes to the best source with a free slot, so the choice follows the mirrors as
// their speed drifts. No `@/` imports: unit tests load this file directly.

export const MiB = 1024 * 1024;
/** Below this a single transfer is as fast: the segmented engine isn't worth its requests. */
export const MIN_SEGMENTED_BYTES = 64 * 1000 * 1000;
/**
 * Chunk sizes: about CHUNKS_PER_FILE chunks, between 4 and 32 MiB. Big chunks keep requests
 * few on a 13 GB file; a 170 MB file in 32 MiB chunks would be 6 ranges, and the one on the
 * slowest mirror would decide when it ends.
 */
const CHUNK_BYTES = 32 * MiB;
const MIN_CHUNK_BYTES = 4 * MiB;
const CHUNKS_PER_FILE = 48;
/** Weight of the newest measurement in a source's average. */
const EMA = 0.4;
/** A source failing this many times in a row rests for BENCH_MS. */
const BENCH_AFTER = 2;
const BENCH_MS = 2 * 60 * 1000;
/** A source this much slower than the best one gets no work. */
const SLOW_RATIO = 0.1;
/** A range in flight is fetched again elsewhere once it would take this many times longer there. */
const DUP_RATIO = 3;
/** A range in flight says how fast its source is once it ran this long. */
const LIVE_MIN_MS = 3000;
const DUP_MIN_MS = 8000;
/** Failures in a row, over every source, without a byte of progress: the download stops (the manager retries). */
export const GIVE_UP_AFTER = 6;

export type Range = { start: number; end: number };

export type SegSource = {
  url: string;
  host: string;
  /** Bytes per second one connection gets (moving average); 0 = not measured yet. */
  bps: number;
  /** Connections this source may hold at once. */
  maxConns: number;
  inFlight: number;
  errors: number;
  benchedUntil: number;
  /** Served a corrupt piece or ignored Range: never used again for this download. */
  bad: boolean;
};

export type Job = Range & {
  key: string;
  source: SegSource;
  startedAt: number;
  bytes: number;
  /** A second fetch of a range already in flight (the first to finish wins). */
  duplicate: boolean;
};

/** A finished range waiting to be appended; `key` names its file, `host` its source (unknown after a relaunch). */
export type Ready = Range & { key: string; host?: string };

export type SegState = {
  size: number;
  chunkBytes: number;
  prefix: number;
  ready: Ready[];
  jobs: Job[];
  sources: SegSource[];
  /** Failures in a row (any source) since the last progress. */
  failStreak: number;
  seq: number;
};

/** The chunk size for a file, in whole pieces so every piece can be checked as it is appended. */
export function chunkBytesFor(size: number, pieceLength?: number): number {
  const unit = pieceLength && pieceLength > 0 ? pieceLength : MIN_CHUNK_BYTES;
  const target = Math.min(CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, size / CHUNKS_PER_FILE));
  return Math.max(1, Math.ceil(target / unit)) * unit;
}

/** Bytes of a .part file that count as done: whole chunks only (a crash may have left half an append). */
export function validPrefix(partSize: number, size: number, chunkBytes: number): number {
  if (partSize >= size) return size;
  return Math.max(0, Math.floor(partSize / chunkBytes) * chunkBytes);
}

/** A chunk file's name: its range and a sequence number (duplicates of a range need their own file). */
export function chunkKey(r: Range, seq: number): string {
  return `${r.start}-${r.end}.${seq}`;
}

export function parseChunkKey(name: string): Range | null {
  const m = /^(\d+)-(\d+)\.\d+$/.exec(name);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return end > start ? { start, end } : null;
}

export function newSource(s: { url: string; host: string; bps?: number; maxConns: number }): SegSource {
  return { url: s.url, host: s.host, bps: s.bps ?? 0, maxConns: s.maxConns, inFlight: 0, errors: 0, benchedUntil: 0, bad: false };
}

export function newState(o: { size: number; chunkBytes: number; prefix: number; ready?: Ready[]; sources: SegSource[] }): SegState {
  return { size: o.size, chunkBytes: o.chunkBytes, prefix: o.prefix, ready: o.ready ?? [], jobs: [], sources: o.sources, failStreak: 0, seq: 0 };
}

/**
 * Which files found in the chunk dir after a relaunch are usable: a complete range (its file
 * as long as the range) beyond the prefix, on the chunk grid. Everything else is to delete.
 */
export function sortChunkFiles(
  files: { name: string; size: number }[],
  s: { size: number; chunkBytes: number; prefix: number },
): { ready: Ready[]; stale: string[] } {
  const ready: Ready[] = [];
  const stale: string[] = [];
  for (const f of files) {
    const r = parseChunkKey(f.name);
    const ok =
      r &&
      r.start >= s.prefix &&
      r.end <= s.size &&
      r.start % s.chunkBytes === 0 &&
      (r.end === s.size || r.end % s.chunkBytes === 0) &&
      f.size === r.end - r.start &&
      !ready.some((x) => x.start === r.start);
    if (ok) ready.push({ ...r, key: f.name });
    else stale.push(f.name);
  }
  return { ready, stale };
}

const covers = (r: Range, at: number) => r.start <= at && at < r.end;

/** True when `at` (a chunk start) is already done, waiting or in flight. */
function covered(s: SegState, at: number): boolean {
  return at < s.prefix || s.ready.some((r) => covers(r, at)) || s.jobs.some((j) => !j.duplicate && covers(j, at));
}

/** A job's own pace, once it ran long enough to tell (connection setup skews the first seconds). */
function jobBps(j: Job, now: number): number | null {
  const ms = now - j.startedAt;
  return ms >= LIVE_MIN_MS ? (j.bytes * 1000) / ms : null;
}

/**
 * What one connection to `src` gives now: its average over finished ranges, lowered by the
 * pace of its ranges in flight. A mirror that measured well but crawls under load (several
 * connections, a busy hour) stops getting work before its slow ranges finish. null: unknown.
 */
export function sourceBps(s: SegState, src: SegSource, now: number): number | null {
  const live = s.jobs.filter((j) => j.source === src).map((j) => jobBps(j, now)).filter((b): b is number => b !== null);
  const pace = live.length ? live.reduce((a, b) => a + b, 0) / live.length : null;
  if (pace === null) return src.bps > 0 ? src.bps : null;
  return src.bps > 0 ? Math.min(src.bps, pace) : pace;
}

/**
 * The source for the next connection: one not measured yet first (so it can prove itself),
 * else the fastest with a free slot. Sources far slower than the best usable one get no work
 * at all: a 0.3 MB/s mirror would hold a chunk for minutes while the rest of the file waits.
 * `exclude`: a source already fetching that range.
 */
export function pickSource(s: SegState, now: number, exclude?: SegSource): SegSource | null {
  const usable = s.sources.filter((x) => !x.bad && x.benchedUntil <= now).map((x) => ({ x, bps: sourceBps(s, x, now) }));
  const best = Math.max(0, ...usable.map((u) => u.bps ?? 0));
  const free = usable.filter(
    ({ x, bps }) => x !== exclude && x.inFlight < x.maxConns && (bps === null || bps >= best * SLOW_RATIO),
  );
  if (!free.length) return null;
  const fresh = free.find((u) => u.bps === null && u.x.inFlight === 0);
  if (fresh) return fresh.x;
  return free.reduce((a, b) => ((b.bps ?? 0) > (a.bps ?? 0) ? b : a)).x;
}

export type NextJob = Range & { source: SegSource; duplicate: boolean };

/**
 * The next range to fetch, or null. `maxConns`: connections this download may hold now.
 * `aheadBytes`: how far past the prefix a range may start. `chunks`: chunks per range (bigger
 * ranges for iOS's background session, which runs them while the app is suspended).
 * The range the prefix waits for, if it crawls, goes first: every finished range behind it
 * waits on disk until it lands.
 */
export function nextJob(s: SegState, now: number, o: { maxConns: number; aheadBytes: number; chunks?: number }): NextJob | null {
  if (s.jobs.length >= o.maxConns) return null;
  const head = duplicateJob(s, now, true);
  if (head) return head;
  const len = s.chunkBytes * Math.max(1, o.chunks ?? 1);
  const limit = Math.min(s.size, s.prefix + Math.max(o.aheadBytes, s.chunkBytes));
  for (let at = s.prefix; at < limit; at += s.chunkBytes) {
    if (covered(s, at)) continue;
    const source = pickSource(s, now);
    if (!source) return null;
    // A long range stops where something already covers the file.
    let end = at + s.chunkBytes;
    while (end < Math.min(s.size, at + len) && !covered(s, end)) end += s.chunkBytes;
    return { start: at, end: Math.min(end, s.size), source, duplicate: false };
  }
  return duplicateJob(s, now, false);
}

/** Expected milliseconds for `bytes` at `bps` (Infinity when nothing is known). */
const eta = (bytes: number, bps: number | null) => (bps ? (bytes * 1000) / bps : Infinity);

/**
 * A range that crawls, fetched again from a source that would finish it much sooner (the
 * first copy to land wins). `headOnly`: just the range the prefix waits for, at any time.
 * Otherwise (nothing new to start: the rest is in flight, or the window is full) any of
 * them, the earliest first. Keeps the end of a file, or the window, from waiting on one slow
 * mirror.
 */
function duplicateJob(s: SegState, now: number, headOnly: boolean): NextJob | null {
  const twinned = new Set(s.jobs.filter((j) => j.duplicate).map((j) => j.start));
  const slow = s.jobs
    .filter((j) => !j.duplicate && !twinned.has(j.start) && now - j.startedAt >= DUP_MIN_MS && (!headOnly || covers(j, s.prefix)))
    .sort((a, b) => a.start - b.start);
  for (const job of slow) {
    const source = pickSource(s, now, job.source);
    const bps = source && sourceBps(s, source, now);
    if (!source || !bps) return null;
    const len = job.end - job.start;
    if (eta(len - job.bytes, jobBps(job, now)) > DUP_RATIO * eta(len, bps)) return { start: job.start, end: job.end, source, duplicate: true };
  }
  return null;
}

export function startJob(s: SegState, next: NextJob, now: number): Job {
  const job: Job = { ...next, key: chunkKey(next, ++s.seq), startedAt: now, bytes: 0 };
  next.source.inFlight++;
  s.jobs.push(job);
  return job;
}

function dropJob(s: SegState, job: Job) {
  const i = s.jobs.indexOf(job);
  if (i < 0) return false;
  s.jobs.splice(i, 1);
  job.source.inFlight = Math.max(0, job.source.inFlight - 1);
  return true;
}

/**
 * A range finished. Returns what to do with its file ('keep': it waits to be appended;
 * 'discard': its twin already finished) and the twins still running, to cancel.
 */
export function jobDone(s: SegState, job: Job, now: number): { file: 'keep' | 'discard'; cancel: Job[] } {
  if (!dropJob(s, job)) return { file: 'discard', cancel: [] };
  const ms = Math.max(1, now - job.startedAt);
  const bps = ((job.end - job.start) * 1000) / ms;
  const src = job.source;
  src.bps = src.bps > 0 ? src.bps * (1 - EMA) + bps * EMA : bps;
  src.errors = 0;
  s.failStreak = 0;
  if (job.end <= s.prefix || s.ready.some((r) => r.start === job.start)) return { file: 'discard', cancel: [] };
  s.ready.push({ start: job.start, end: job.end, key: job.key, host: src.host });
  const twins = s.jobs.filter((j) => j.start === job.start);
  for (const t of twins) dropJob(s, t);
  return { file: 'keep', cancel: twins };
}

/**
 * A range failed. 'error': the request failed (network, 5xx); two in a row bench the source
 * for a while. 'refused': it ignored the Range header or refused the file (a 4xx); 'corrupt': a
 * piece didn't match its hash. Both rule the source out for this download.
 */
export function jobFailed(s: SegState, job: Job, now: number, why: 'error' | 'refused' | 'corrupt') {
  dropJob(s, job);
  sourceFailed(s, job.source, now, why);
}

export function sourceFailed(s: SegState, src: SegSource, now: number, why: 'error' | 'refused' | 'corrupt') {
  s.failStreak++;
  if (why !== 'error') {
    src.bad = true;
    return;
  }
  src.errors++;
  if (src.errors >= BENCH_AFTER) {
    src.benchedUntil = now + BENCH_MS;
    src.errors = 0;
  }
}

/** A job stopped without an outcome (paused, cancelled): its source's slot is free again. */
export function jobStopped(s: SegState, job: Job) {
  dropJob(s, job);
}

/** The finished range that continues the prefix, if any. */
export function appendable(s: SegState): Ready | undefined {
  return s.ready.find((r) => r.start === s.prefix);
}

/** After `r` was appended to the .part file (or found corrupt: `ok` false, to fetch again). */
export function appended(s: SegState, r: Ready, ok: boolean) {
  s.ready = s.ready.filter((x) => x !== r);
  if (ok) s.prefix = r.end;
}

/** Bytes done or in flight, for the progress bar (a range fetched twice counts once). */
export function progressBytes(s: SegState): number {
  const ready = s.ready.reduce((sum, r) => sum + (r.end - r.start), 0);
  const inFlight = new Map<number, number>();
  for (const j of s.jobs) inFlight.set(j.start, Math.max(inFlight.get(j.start) ?? 0, Math.min(j.bytes, j.end - j.start)));
  let flying = 0;
  for (const b of inFlight.values()) flying += b;
  return Math.min(s.size, s.prefix + ready + flying);
}

/** Why the download can't go on: every source ruled out, or failing again and again. Null while it can. */
export function stuck(s: SegState): 'no-source' | 'failing' | null {
  if (s.sources.every((x) => x.bad)) return 'no-source';
  if (s.failStreak >= GIVE_UP_AFTER) return 'failing';
  return null;
}

/** When the earliest benched source is back (for a timer while nothing else can run). */
export function nextWake(s: SegState, now: number): number | null {
  const times = s.sources.filter((x) => !x.bad && x.benchedUntil > now).map((x) => x.benchedUntil);
  return times.length ? Math.min(...times) : null;
}
