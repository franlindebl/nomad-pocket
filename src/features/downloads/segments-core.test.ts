import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendable,
  appended,
  chunkBytesFor,
  GIVE_UP_AFTER,
  jobDone,
  jobFailed,
  MiB,
  newSource,
  newState,
  nextJob,
  nextWake,
  parseChunkKey,
  progressBytes,
  sortChunkFiles,
  STALL_MS,
  stalledJobs,
  startJob,
  stuck,
  validPrefix,
  type SegState,
} from './segments-core.ts';

const C = 32 * MiB;
const mirror = (host: string, bps = 0, maxConns = 3) => newSource({ url: `https://${host}/w.zim`, host, bps, maxConns });
const opts = { maxConns: 8, aheadBytes: 1024 * MiB };

/** Starts every job the scheduler offers now. */
function fill(s: SegState, now = 0, o = opts) {
  for (let next = nextJob(s, now, o); next; next = nextJob(s, now, o)) startJob(s, next, now);
}

test('chunkBytesFor: ~48 chunks per file, 4–32 MiB, on whole pieces', () => {
  const big = 13.3e9;
  assert.equal(chunkBytesFor(big), C);
  assert.equal(chunkBytesFor(big, 4 * MiB), C);
  assert.equal(chunkBytesFor(big, 5 * MiB), 35 * MiB);
  assert.equal(chunkBytesFor(big, 64 * MiB), 64 * MiB);
  // A 171 MB archive: 41 ranges of 4 MiB, not 6 of 32 MiB.
  assert.equal(chunkBytesFor(171e6, 4 * MiB), 4 * MiB);
  assert.equal(chunkBytesFor(656e6, 4 * MiB), 16 * MiB);
  assert.equal(chunkBytesFor(656e6), 16 * MiB);
});

test('validPrefix trusts whole chunks only (a crash may leave half an append)', () => {
  assert.equal(validPrefix(0, 100 * MiB, C), 0);
  assert.equal(validPrefix(C + 5, 100 * MiB, C), C);
  assert.equal(validPrefix(100 * MiB, 100 * MiB, C), 100 * MiB);
  // An Android single-transfer .part of any length continues from its last whole chunk.
  assert.equal(validPrefix(70 * MiB, 100 * MiB, C), 2 * C);
});

test('chunk files: complete ranges on the grid beyond the prefix are kept, the rest goes', () => {
  assert.deepEqual(parseChunkKey(`${C}-${2 * C}.7`), { start: C, end: 2 * C });
  assert.equal(parseChunkKey('w.part'), null);
  const size = 3 * C + 10;
  const { ready, stale } = sortChunkFiles(
    [
      { name: `${C}-${2 * C}.1`, size: C }, // complete
      { name: `${2 * C}-${3 * C}.2`, size: C - 1 }, // Android: cut short by a kill
      { name: `0-${C}.3`, size: C }, // already in the prefix
      { name: `${3 * C}-${size}.4`, size: 10 }, // the last, short chunk
      { name: `${C}-${2 * C}.9`, size: C }, // a second copy of a range
      { name: 'junk', size: 1 },
    ],
    { size, chunkBytes: C, prefix: C },
  );
  assert.deepEqual(
    ready.map((r) => r.key),
    [`${C}-${2 * C}.1`, `${3 * C}-${size}.4`],
  );
  assert.deepEqual(stale, [`${2 * C}-${3 * C}.2`, `0-${C}.3`, `${C}-${2 * C}.9`, 'junk']);
});

test('nextJob fills the file front to back, spread over the fastest mirrors, at most 3 each', () => {
  const fast = mirror('dotsrc', 20e6);
  const mid = mirror('accum', 10e6);
  const slow = mirror('lb', 0.4e6);
  const s = newState({ size: 100 * C, chunkBytes: C, prefix: 0, sources: [slow, mid, fast] });
  fill(s);
  assert.equal(s.jobs.length, 6, 'the slow mirror gets nothing while faster ones exist');
  assert.deepEqual(
    s.jobs.map((j) => j.start / C),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    s.jobs.map((j) => j.source.host),
    ['dotsrc', 'dotsrc', 'dotsrc', 'accum', 'accum', 'accum'],
  );
  assert.equal(slow.inFlight, 0);
});

test('nextJob tries a mirror nobody measured yet, once', () => {
  const known = mirror('dotsrc', 20e6);
  const fresh = mirror('new');
  const s = newState({ size: 100 * C, chunkBytes: C, prefix: 0, sources: [known, fresh] });
  fill(s, 0, { ...opts, maxConns: 2 });
  assert.deepEqual(
    s.jobs.map((j) => j.source.host),
    ['new', 'dotsrc'],
  );
});

test('one URL taken several times (GitHub, Hugging Face)', () => {
  const gh = newSource({ url: 'https://github.com/x/es.pmtiles', host: 'github.com', maxConns: 4 });
  const s = newState({ size: 10 * C, chunkBytes: C, prefix: 0, sources: [gh] });
  fill(s);
  assert.equal(s.jobs.length, 4);
});

test('the window bounds how far past the prefix ranges may start', () => {
  const s = newState({ size: 100 * C, chunkBytes: C, prefix: 0, sources: [mirror('a', 1e6, 8)] });
  fill(s, 0, { maxConns: 8, aheadBytes: 3 * C });
  assert.deepEqual(
    s.jobs.map((j) => j.start / C),
    [0, 1, 2],
  );
});

test('finished ranges are appended in order; progress counts all of it once', () => {
  const src = mirror('a', 1e6, 8);
  const s = newState({ size: 3 * C + 100, chunkBytes: C, prefix: 0, sources: [src] });
  fill(s);
  assert.equal(s.jobs.length, 4);
  assert.equal(s.jobs[3].end, 3 * C + 100, 'the last chunk ends with the file');
  const [j0, j1] = s.jobs;
  assert.equal(jobDone(s, j1, 1000).file, 'keep');
  assert.equal(appendable(s), undefined, 'chunk 1 waits for chunk 0');
  s.jobs[0].bytes = C / 2;
  assert.equal(progressBytes(s), C + C / 2);
  jobDone(s, j0, 2000);
  const first = appendable(s)!;
  assert.equal(first.start, 0);
  appended(s, first, true);
  appended(s, appendable(s)!, true);
  assert.equal(s.prefix, 2 * C);
  assert.ok(src.bps > 0);
});

test('a corrupt range is fetched again, from another mirror', () => {
  const bad = mirror('bad', 30e6);
  const good = mirror('good', 10e6);
  const s = newState({ size: 4 * C, chunkBytes: C, prefix: 0, sources: [bad, good] });
  const j = startJob(s, nextJob(s, 0, { ...opts, maxConns: 1 })!, 0);
  assert.equal(j.source, bad);
  jobDone(s, j, 1000);
  const r = appendable(s)!;
  appended(s, r, false);
  jobFailed(s, { ...j, source: bad }, 1000, 'corrupt');
  assert.ok(bad.bad);
  const again = nextJob(s, 1000, opts)!;
  assert.equal(again.start, 0);
  assert.equal(again.source, good);
});

test('two errors in a row bench a mirror for a while; failing everywhere gives up', () => {
  const a = mirror('a', 20e6);
  const b = mirror('b', 10e6);
  const s = newState({ size: 10 * C, chunkBytes: C, prefix: 0, sources: [a, b] });
  for (let i = 0; i < 2; i++) jobFailed(s, startJob(s, { start: 0, end: C, source: a, duplicate: false }, 0), 0, 'error');
  assert.ok(a.benchedUntil > 0);
  assert.equal(nextJob(s, 0, opts)!.source, b);
  assert.equal(nextWake(s, 0), a.benchedUntil);
  assert.equal(stuck(s), null);
  for (let i = 2; i < GIVE_UP_AFTER; i++) jobFailed(s, startJob(s, { start: 0, end: C, source: b, duplicate: false }, 0), 0, 'error');
  assert.equal(stuck(s), 'failing');
});

test('a mirror that ignores Range is never used again; none left means stuck', () => {
  const a = mirror('a', 20e6);
  const s = newState({ size: 10 * C, chunkBytes: C, prefix: 0, sources: [a] });
  jobFailed(s, startJob(s, nextJob(s, 0, opts)!, 0), 0, 'refused');
  assert.equal(nextJob(s, 0, opts), null);
  assert.equal(stuck(s), 'no-source');
});

test('the range the prefix waits for is fetched again elsewhere when it crawls; the first copy wins', () => {
  const slowish = mirror('slowish', 20e6, 1);
  const fast = mirror('fast', 20e6, 1);
  const s = newState({ size: 2 * C, chunkBytes: C, prefix: 0, sources: [slowish, fast] });
  fill(s, 0);
  assert.equal(s.jobs.length, 2);
  const [head, other] = s.jobs;
  // The other range finishes: its mirror is free. The head has done 1 MiB in 10 s.
  jobDone(s, other, 1600);
  head.bytes = MiB;
  const dup = nextJob(s, 10_000, opts)!;
  assert.ok(dup.duplicate);
  assert.equal(dup.start, head.start);
  assert.equal(dup.source, other.source);
  const twin = startJob(s, dup, 10_000);
  assert.equal(nextJob(s, 10_500, opts), null, 'one duplicate per range');
  const done = jobDone(s, twin, 12_000);
  assert.equal(done.file, 'keep');
  assert.deepEqual(done.cancel, [head]);
  assert.equal(s.jobs.length, 0);
  assert.equal(progressBytes(s), 2 * C);
});

test('a mirror that measured well but crawls under load loses its work before its ranges finish', () => {
  // Seen on the simulator: the probe ranked nluug first (7.8 MB/s); with 3 connections each
  // crawled, and the start of the file waited while later ranges piled up on disk.
  const nluug = mirror('nluug', 7.8e6);
  const accum = mirror('accum', 3.8e6);
  const s = newState({ size: 40 * C, chunkBytes: C, prefix: 0, sources: [nluug, accum] });
  fill(s, 0, { ...opts, maxConns: 6 });
  assert.equal(s.jobs[0].source, nluug);
  // 4 s later: nluug's ranges did 1 MiB each, accum's 12 MiB. One of accum's finishes.
  for (const j of s.jobs) j.bytes = j.source === nluug ? MiB : 12 * MiB;
  jobDone(s, s.jobs.find((j) => j.source === accum)!, 4000);
  assert.equal(nextJob(s, 4000, opts)?.source, accum, 'new work goes to the mirror that is fast now');
  // At 9 s the first range (on nluug) still crawls: fetched again on accum, before any new range.
  const head = s.jobs.find((j) => j.start === 0)!;
  head.bytes = 2 * MiB;
  const dup = nextJob(s, 9000, opts)!;
  assert.ok(dup.duplicate);
  assert.equal(dup.start, 0);
  assert.equal(dup.source, accum);
});

test('at the end of a file, any crawling range is fetched again, not only the first', () => {
  const slow = mirror('slow', 5e6, 1);
  const fast = mirror('fast', 16e6, 2);
  const s = newState({ size: 3 * C, chunkBytes: C, prefix: 0, sources: [slow, fast] });
  fill(s);
  const byStart = (n: number) => s.jobs.find((j) => j.start === n * C)!;
  assert.equal(byStart(2).source, slow, 'the last range went to the slow mirror');
  jobDone(s, byStart(0), 2000);
  jobDone(s, byStart(1), 2500);
  appended(s, appendable(s)!, true);
  appended(s, appendable(s)!, true);
  byStart(2).bytes = 4 * MiB;
  const dup = nextJob(s, 10_000, opts)!;
  assert.ok(dup.duplicate);
  assert.equal(dup.start, 2 * C);
  assert.equal(dup.source, fast);
});

test('a range that is merely in progress at a normal pace is not duplicated', () => {
  const a = mirror('a', 10e6, 1);
  const b = mirror('b', 10e6, 1);
  const s = newState({ size: C, chunkBytes: C, prefix: 0, sources: [a, b] });
  fill(s);
  s.jobs[0].bytes = 20 * MiB;
  assert.equal(nextJob(s, 9000, opts), null);
});

test('bigger ranges for the iOS background session stop where something else covers the file', () => {
  const s = newState({ size: 20 * C, chunkBytes: C, prefix: 0, sources: [mirror('a', 1e6, 8)] });
  startJob(s, { start: 5 * C, end: 6 * C, source: s.sources[0], duplicate: false }, 0);
  const big = nextJob(s, 0, { maxConns: 8, aheadBytes: 20 * C, chunks: 8 })!;
  assert.deepEqual([big.start, big.end], [0, 5 * C]);
});

test('a range with no byte for STALL_MS is stalled; failing it frees the slot and the range goes elsewhere', () => {
  const a = mirror('a.org', 5 * MiB);
  const b = mirror('b.org', 4 * MiB);
  const s = newState({ size: 10 * C, chunkBytes: C, prefix: 0, sources: [a, b] });
  fill(s, 0, { maxConns: 2, aheadBytes: 1024 * MiB });
  const [head, other] = s.jobs;
  other.bytes = 1000;
  other.progressAt = STALL_MS - 1;
  assert.deepEqual(stalledJobs(s, STALL_MS - 1), []);
  assert.deepEqual(stalledJobs(s, STALL_MS), [head]);
  jobFailed(s, head, STALL_MS, 'error');
  const next = nextJob(s, STALL_MS, { maxConns: 2, aheadBytes: 1024 * MiB });
  assert.equal(next?.start, 0, 'the head is fetched again first');
});
