// Segmented transfer: one big file fetched as many byte ranges at once, from several mirrors
// (Kiwix) or several connections to one URL (GitHub, Hugging Face). Mirrors cap what one
// connection gets (the default Kiwix mirror: ~0.4 MB/s); 8 connections over good mirrors
// fill the link. Decisions live in segments-core.ts; this file moves the bytes.
//
// Each range is a DownloadTask with a Range header into its own file under
// partial/<id>.chunks/. Finished ranges are appended to partial/<id>.part in order, checking
// every metalink piece (sha-1, 4 MiB) on the way, so the .part file is always a verified
// prefix of the download: after a pause, a network drop or the app being killed (iOS can't
// reattach its background transfers), the download continues from it and from the range files
// already on disk. A corrupt piece costs one range, refetched from another mirror.
//
// iOS: the ranges run in the background URLSession, so the ones in flight finish while the
// app is suspended. When the app leaves the foreground, a few bigger ranges are queued as a
// reserve to keep it downloading, and each finished one is acknowledged only after the next
// ranges were started (deferBackgroundSessionCompletion), so a wake-up keeps the chain going.
import { Directory, DownloadTask, File, FileMode } from 'expo-file-system';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Platform } from 'react-native';

import { downloadErrorKind } from './errors';
import type { Pieces } from './mirrors';
import {
  appendable,
  appended,
  jobDone,
  jobFailed,
  jobStopped,
  MiB,
  newSource,
  newState,
  nextJob,
  nextWake,
  progressBytes,
  sortChunkFiles,
  sourceFailed,
  startJob,
  stuck,
  validPrefix,
  type Job,
  type Ready,
  type SegState,
} from './segments-core';

/** Bytes moved per read while appending (a piece when the metalink has them). */
const SLICE_BYTES = 4 * MiB;
/** Ranges queued as the app leaves the foreground on iOS, each this many chunks long. */
const RESERVE_RANGES = 4;
const RESERVE_CHUNKS = 8;
/** Corrupt pieces tolerated (each rules its mirror out) before the download gives up. */
const MAX_CORRUPT = 3;
const PROGRESS_MS = 250;

export type SegmentedInput = {
  partial: File;
  dir: Directory;
  size: number;
  chunkBytes: number;
  sources: { url: string; host: string; bps: number; maxConns: number }[];
  pieces?: Pieces;
  /** Connections this download may hold now (the manager shares them). */
  maxConns: () => number;
  /** How far past the verified prefix ranges may start (disk space for ranges finished early). */
  aheadBytes: (background: boolean) => number;
  onProgress: (bytesWritten: number, totalBytes: number) => void;
};

/** Hex of a digest. */
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** A refused range (4xx other than 408/429) won't work on a retry from that source. */
function refused(error: string): boolean {
  const { kind, status } = downloadErrorKind(error);
  return kind === 'server' && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Segmented downloads running now. A source's connection cap counts every download's
 * connections to that host: two archives fetched at once still open at most 3 to a mirror.
 */
const running = new Set<SegmentedTransfer>();

function hostConnections(host: string): number {
  let n = 0;
  for (const t of running) n += t.connectionsTo(host);
  return n;
}

/** A connection was freed: the other downloads may take it (a mirror's slot, the shared budget). */
function wakeOthers(from: SegmentedTransfer) {
  for (const t of running) if (t !== from) t.poke();
}

export class SegmentedTransfer {
  private s!: SegState;
  /** Each source's own cap, before what other downloads hold on its host. */
  private caps = new Map<string, number>();
  private tasks = new Map<string, DownloadTask>();
  private appending: Promise<void> | null = null;
  private stopped = false;
  private settled = false;
  private background = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReport = 0;
  private lastError = '';
  private corrupt = 0;
  private wantsMore = false;
  private started = { at: 0, bytes: 0 };
  private pieces?: Pieces;
  private settle!: { resolve: (f: File | null) => void; reject: (e: Error) => void };

  constructor(private o: SegmentedInput) {
    // Pieces must fall on chunk boundaries to be checked as chunks are appended.
    if (o.pieces && o.chunkBytes % o.pieces.length === 0) this.pieces = o.pieces;
  }

  /** Resolves with the complete .part file, or null when paused; rejects when it can't go on. */
  run(): Promise<File | null> {
    return new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
      try {
        this.load();
      } catch (e) {
        this.fail(e);
        return;
      }
      running.add(this);
      this.started = { at: Date.now(), bytes: progressBytes(this.s) };
      // One line per run, for field reports: where it resumes from and how the sources measured.
      const mb = (n: number) => (n / 1e6).toFixed(1);
      console.log(
        `[downloads] segmented ${this.o.partial.name}: ${mb(this.s.prefix)}/${mb(this.s.size)} MB done, ${this.s.ready.length} ranges waiting, sources`,
        this.o.sources.map((x) => `${x.host} ${mb(x.bps)} MB/s`).join(', '),
      );
      this.tick();
    });
  }

  /** Connections this download holds to `host`. */
  connectionsTo(host: string): number {
    return this.s?.sources.reduce((n, x) => n + (x.host === host ? x.inFlight : 0), 0) ?? 0;
  }

  /** Connections this download holds. */
  connections(): number {
    return this.s?.jobs.length ?? 0;
  }

  /** It would use another connection now if the budget gave it one. */
  get hungry(): boolean {
    return this.wantsMore;
  }

  /** Another download freed a connection. */
  poke() {
    this.tick();
  }

  /** Stops every range; what is on disk stays for the next run. */
  async pause(): Promise<void> {
    this.stop();
    await this.appending;
    this.done(null);
  }

  /** Stops without waiting (the caller deletes the files). */
  cancel() {
    this.stop();
    this.done(null);
  }

  /** iOS: the app leaves the foreground. Queue bigger ranges that run while it is suspended. */
  setBackground(background: boolean) {
    if (this.background === background) return;
    this.background = background;
    // Before run() (iOS launched the app in the background for its session) the flag is enough.
    if (this.s) this.tick();
  }

  private load() {
    const { dir, partial, size, chunkBytes } = this.o;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    if (!partial.exists) partial.create();
    const prefix = validPrefix(Number(partial.size ?? 0), size, chunkBytes);
    const files = dir.list().filter((f): f is File => f instanceof File);
    const { ready, stale } = sortChunkFiles(
      files.map((f) => ({ name: f.name, size: Number(f.size ?? 0) })),
      { size, chunkBytes, prefix },
    );
    for (const name of stale) new File(dir, name).delete();
    for (const x of this.o.sources) this.caps.set(x.host, x.maxConns);
    this.s = newState({ size, chunkBytes, prefix, ready, sources: this.o.sources.map(newSource) });
  }

  private stop() {
    const wasRunning = running.delete(this);
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const task of this.tasks.values()) {
      try {
        task.cancel();
      } catch {
        // already over
      }
    }
    this.tasks.clear();
    if (wasRunning) wakeOthers(this);
  }

  private done(file: File | null) {
    if (this.settled) return;
    this.settled = true;
    this.settle.resolve(file);
  }

  private fail(e: unknown) {
    this.stop();
    if (this.settled) return;
    this.settled = true;
    this.settle.reject(e instanceof Error ? e : new Error(String(e)));
  }

  private tick = () => {
    if (this.stopped || !this.s) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.s;
    const now = Date.now();
    if (!this.appending) {
      const next = appendable(s);
      if (next) {
        this.appending = this.append(next).finally(() => {
          this.appending = null;
          this.tick();
        });
      }
    }
    if (s.prefix >= s.size) {
      if (!this.appending) {
        this.stop();
        const secs = (now - this.started.at) / 1000;
        console.log(
          `[downloads] segmented ${this.o.partial.name}: done, ${((s.size - this.started.bytes) / 1e6 / Math.max(secs, 0.001)).toFixed(1)} MB/s over ${secs.toFixed(0)} s`,
          s.sources.map((x) => `${x.host} ${(x.bps / 1e6).toFixed(1)}${x.bad ? ' (ruled out)' : ''}`).join(', '),
        );
        this.done(this.o.partial);
      }
      return;
    }
    const why = stuck(s);
    if (why) {
      this.fail(new Error(why === 'no-source' && this.corrupt ? 'CHECKSUM_MISMATCH: every mirror sent corrupt pieces' : this.lastError || 'DOWNLOAD_STALLED'));
      return;
    }
    const share = this.o.maxConns();
    const opts = this.background
      ? { maxConns: share + RESERVE_RANGES, aheadBytes: this.o.aheadBytes(true), chunks: RESERVE_CHUNKS }
      : { maxConns: share, aheadBytes: this.o.aheadBytes(false) };
    // What other downloads hold on a host counts against its cap.
    let heldElsewhere = false;
    for (const x of s.sources) {
      const others = hostConnections(x.host) - x.inFlight;
      if (others > 0) heldElsewhere = true;
      x.maxConns = Math.max(0, (this.caps.get(x.host) ?? 1) - others);
    }
    for (let next = nextJob(s, now, opts); next; next = nextJob(s, now, opts)) this.launch(startJob(s, next, now));
    // Held back by the budget only (not by the mirrors' caps or the window): the manager shares fairly then.
    this.wantsMore = s.jobs.length >= opts.maxConns && nextJob(s, now, { ...opts, maxConns: opts.maxConns + 1 }) !== null;
    if (!s.jobs.length && !this.appending) {
      // Nothing can run now: every usable source is resting after errors, or its slots are
      // taken by other downloads (they poke this one as they free them).
      const wake = nextWake(s, now);
      if (wake) this.timer = setTimeout(this.tick, wake - now + 50);
      else if (heldElsewhere) this.timer = setTimeout(this.tick, 5000);
      else this.fail(new Error(this.lastError || 'DOWNLOAD_STALLED'));
    }
    this.report(true);
  };

  private report(force = false) {
    const now = Date.now();
    if (!force && now - this.lastReport < PROGRESS_MS) return;
    this.lastReport = now;
    this.o.onProgress(progressBytes(this.s), this.s.size);
  }

  private launch(job: Job) {
    const { dir } = this.o;
    const file = new File(dir, job.key);
    if (file.exists) file.delete();
    const len = job.end - job.start;
    let ignoredRange = false;
    const task = new DownloadTask(job.source.url, file, {
      headers: { Range: `bytes=${job.start}-${job.end - 1}` },
      sessionType: 'background',
      deferBackgroundSessionCompletion: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        // An exception thrown from a native event callback is fatal in release builds.
        try {
          // iOS accepts any 2xx: a server that ignores Range sends the whole file. Stop it at once.
          const total = Number(totalBytes);
          if (total > 0 && total !== len && !ignoredRange) {
            ignoredRange = true;
            task.cancel();
            return;
          }
          job.bytes = Number(bytesWritten);
          this.report();
        } catch (e) {
          console.warn('[downloads] range progress', e);
        }
      },
    });
    this.tasks.set(job.key, task);
    task.downloadAsync().then(
      (got) => {
        this.tasks.delete(job.key);
        if (this.stopped) return;
        if (!got) jobStopped(this.s, job);
        else if (Number(got.size ?? 0) !== len) {
          got.delete();
          jobFailed(this.s, job, Date.now(), 'refused');
        } else {
          const { file: keep, cancel } = jobDone(this.s, job, Date.now());
          if (keep === 'discard') got.delete();
          for (const twin of cancel) this.drop(twin.key);
        }
        this.tick();
        wakeOthers(this);
        // The next ranges are started: iOS may suspend the app again.
        task.acknowledgeBackgroundCompletionAsync().catch(() => {});
      },
      (e) => {
        this.tasks.delete(job.key);
        if (this.stopped || !this.s.jobs.includes(job)) return;
        const error = String((e as Error)?.message ?? e);
        // Android writes as it goes: a failed range leaves part of its file.
        if (file.exists) file.delete();
        if (ignoredRange || refused(error)) jobFailed(this.s, job, Date.now(), 'refused');
        else jobFailed(this.s, job, Date.now(), 'error');
        this.lastError = error;
        console.warn('[downloads] range failed', job.source.host, error);
        this.tick();
        wakeOthers(this);
      },
    );
  }

  /** Cancels a range that is no longer needed (its twin finished first). */
  private drop(key: string) {
    const task = this.tasks.get(key);
    this.tasks.delete(key);
    try {
      task?.cancel();
    } catch {
      // already over
    }
    const file = new File(this.o.dir, key);
    if (file.exists) file.delete();
  }

  /**
   * Appends a finished range to the .part file, checking each piece against the metalink.
   * Written at its offset: a crash halfway leaves bytes past the prefix that the next append
   * overwrites (validPrefix only trusts whole chunks).
   */
  private async append(r: Ready) {
    const src = new File(this.o.dir, r.key);
    const pieces = this.pieces;
    const slice = pieces?.length ?? SLICE_BYTES;
    let ok = true;
    try {
      const input = src.open(FileMode.ReadOnly);
      const output = this.o.partial.open(FileMode.ReadWrite);
      try {
        output.offset = r.start;
        for (let at = r.start; at < r.end; at += slice) {
          const want = Math.min(slice, r.end - at);
          const bytes = await input.readBytes(want);
          if (bytes.length !== want) throw new Error(`short read in ${r.key}`);
          if (pieces && hex(await digest(CryptoDigestAlgorithm.SHA1, bytes)) !== pieces.sha1[at / pieces.length]) {
            ok = false;
            break;
          }
          await output.writeBytes(bytes);
        }
      } finally {
        input.close();
        output.close();
      }
    } catch (e) {
      // Cancelled meanwhile (its files are gone), or the disk (full, gone): nothing to retry here.
      if (!this.stopped) this.fail(e);
      return;
    }
    if (this.stopped && !src.exists) return;
    src.delete();
    appended(this.s, r, ok);
    if (ok) {
      this.report(true);
      return;
    }
    this.corrupt++;
    this.lastError = `CHECKSUM_MISMATCH: piece at ${r.start} from ${r.host ?? 'an earlier session'}`;
    console.warn('[downloads]', this.lastError);
    const source = this.s.sources.find((x) => x.host === r.host);
    if (source) sourceFailed(this.s, source, Date.now(), 'corrupt');
    if (this.corrupt > MAX_CORRUPT) this.fail(new Error('CHECKSUM_MISMATCH: too many corrupt pieces'));
  }
}

/** iOS's background session runs ranges while the app is suspended; Android stops them with the app. */
export const SEGMENTS_IN_BACKGROUND = Platform.OS === 'ios';
