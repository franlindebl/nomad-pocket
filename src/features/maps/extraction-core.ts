// Bookkeeping for resuming an on-device map extraction after the app was killed (extraction.ts).
// The plan is deterministic for a pinned planet build + bbox + zooms, so only the job's inputs,
// the build and the indices of the tile requests already written to the .part file are saved;
// on the next launch the plan is rebuilt and the finished requests skipped. Pure: no `@/` aliases.

export type Bbox4 = [number, number, number, number];

/** What identifies a plan: if any of it differs after re-planning, the written ranges are void. */
export type PlanFingerprint = { archiveBytes: number; downloadBytes: number; requests: number; tileDataOffset: number };

export type SavedExtraction = {
  v: 1;
  key: string;
  title: string;
  bbox: Bbox4;
  minZoom: number;
  maxZoom: number;
  regionId: string | null;
  bundledPoints: boolean;
  build: { url: string; date: string };
  fingerprint: PlanFingerprint | null;
  /** Finished request indices as runs: "0-41,43,50-60". */
  done: string;
};

/** The parts of an ExtractPlan the bookkeeping needs. */
export type PlanShape = {
  archiveBytes: number;
  downloadBytes: number;
  header: { tileDataOffset: number };
  prefix: { length: number };
  requests: { length: number; copies: number[] }[];
};

export function fingerprintOf(plan: PlanShape): PlanFingerprint {
  return {
    archiveBytes: plan.archiveBytes,
    downloadBytes: plan.downloadBytes,
    requests: plan.requests.length,
    tileDataOffset: plan.header.tileDataOffset,
  };
}

export function sameFingerprint(a: PlanFingerprint | null, b: PlanFingerprint): boolean {
  return (
    !!a &&
    a.archiveBytes === b.archiveBytes &&
    a.downloadBytes === b.downloadBytes &&
    a.requests === b.requests &&
    a.tileDataOffset === b.tileDataOffset
  );
}

/** {0,1,2,5} -> "0-2,5". */
export function encodeDone(done: ReadonlySet<number>): string {
  const sorted = [...done].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return runs.join(',');
}

/** Inverse of encodeDone; garbage and indices outside [0, count) are dropped. */
export function decodeDone(text: string, count: number): Set<number> {
  const out = new Set<number>();
  for (const run of text.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(run.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    for (let i = a; i <= b && i < count; i++) out.add(i);
  }
  return out;
}

/** Bytes of tile data the finished requests stand for (progress to start from). */
export function doneBytes(plan: Pick<PlanShape, 'requests'>, done: ReadonlySet<number>): number {
  let sum = 0;
  for (const i of done) sum += plan.requests[i]?.length ?? 0;
  return sum;
}

/**
 * Smallest .part size that can hold everything the finished requests wrote (and the prefix):
 * a shorter file means the data is gone and the job must start over.
 */
export function requiredPartSize(plan: PlanShape, done: ReadonlySet<number>): number {
  let end = plan.prefix.length;
  for (const i of done) {
    const c = plan.requests[i]?.copies ?? [];
    for (let k = 0; k < c.length; k += 3) end = Math.max(end, plan.header.tileDataOffset + c[k + 1] + c[k + 2]);
  }
  return end;
}

/** Same job (inputs, not progress)? */
export function sameJob(a: SavedExtraction, b: Pick<SavedExtraction, 'key' | 'bbox' | 'minZoom' | 'maxZoom'>): boolean {
  return (
    a.key === b.key && a.minZoom === b.minZoom && a.maxZoom === b.maxZoom && a.bbox.length === 4 && a.bbox.every((v, i) => v === b.bbox[i])
  );
}

/**
 * Which finished requests can be trusted for `plan`: none unless the saved job used this build and
 * the plan has the same shape, the part file exists and holds all the data they wrote.
 */
export function usableDone(saved: SavedExtraction | null, buildUrl: string, plan: PlanShape, partSize: number | null): Set<number> {
  if (!saved || saved.build.url !== buildUrl || partSize === null) return new Set();
  if (!sameFingerprint(saved.fingerprint, fingerprintOf(plan))) return new Set();
  const done = decodeDone(saved.done, plan.requests.length);
  return partSize >= requiredPartSize(plan, done) ? done : new Set();
}

export function parseSaved(text: string | null): SavedExtraction[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (s): s is SavedExtraction =>
        !!s &&
        s.v === 1 &&
        typeof s.key === 'string' &&
        typeof s.title === 'string' &&
        Array.isArray(s.bbox) &&
        s.bbox.length === 4 &&
        typeof s.build?.url === 'string' &&
        typeof s.done === 'string',
    );
  } catch {
    return [];
  }
}
