// Content updates, the pure part (docs/CONTENT_UPDATES_PLAN.md): how old installed data is,
// which updates are worth a warning, when to ask Kiwix again, and one step of the "update all"
// run, which starts what fits and the rest as earlier updates free their old copy.
// No `@/` imports: unit tests load this file directly.

/** An update is urgent (Home warns) once the installed data is this old and a newer one exists. */
export const URGENT_MONTHS = 3;

/** How often installed archives are checked against Kiwix's catalog. */
export const CHECK_EVERY_MS = 7 * 24 * 3600_000;

const MONTH_MS = 30.4 * 24 * 3600_000;

/** A data date ("2026-10", "2026-10-05", "20261005") as a timestamp; null when it isn't one. */
export function parseDataDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = /^(\d{4})-?(\d{2})(?:-?(\d{2}))?$/.exec(d);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Number(m[1]), month - 1, m[3] ? Number(m[3]) : 1).getTime();
}

/** Months since a data date; 0 when unknown (unknown is never "old"). */
export function monthsOld(d: string | null | undefined, now: number): number {
  const t = parseDataDate(d);
  return t === null ? 0 : Math.max(0, (now - t) / MONTH_MS);
}

/** Whether `latest` is a newer edition than `installed` (both data dates in the same format). */
export function isNewerEdition(latest: string | null | undefined, installed: string | null | undefined): boolean {
  if (!latest) return false;
  if (!installed) return true;
  return latest > installed;
}

/** Worth a warning on Home: the installed data is old and there is something newer, or it no longer works. */
export function isUrgent(u: { installed: string | null; broken?: boolean }, now: number): boolean {
  return !!u.broken || monthsOld(u.installed, now) >= URGENT_MONTHS;
}

export function checkDue(lastCheck: number | null | undefined, now: number, every = CHECK_EVERY_MS): boolean {
  return !lastCheck || now - lastCheck >= every || now < lastCheck;
}

/** The order updates run in: urgent first, then the smallest (more of them done sooner). */
export function byPriority<T extends { urgent: boolean; bytes: number }>(a: T, b: T): number {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  return a.bytes - b.bytes;
}

/** Whether `needed` bytes fit once `freed` bytes are deleted (the old copy, for a delete-first update). */
export function fitsAfterFreeing(needed: number, freed: number, free: number, headroom: number): boolean {
  return free + freed - headroom >= needed;
}

/** What the run needs to know about one queued update right now. */
export type RunEntry = {
  key: string;
  /** Still outdated (false once the new version is in, or the item is gone). */
  outdated: boolean;
  /** Its downloads are queued, running or being processed. */
  inFlight: boolean;
  /** Its download failed and waits for a retry by hand. */
  failed: boolean;
  /** Free space it needs to start, the old copy kept. */
  needed: number;
};

export type RunStep = {
  /** Start these now, in this order. */
  start: string[];
  /** Out of the run: done, failed, or no longer outdated. */
  drop: string[];
  /** Can't fit even with nothing else running: only a delete-first update can bring them. */
  blocked: string[];
};

/**
 * One step of "update all". `queue`: the keys still in the run, in priority order; `started`:
 * those already started by it. `available`: free space minus headroom and what downloads in
 * flight still have to write (what the download manager's own room check counts).
 * Starts, in order, what fits; an update that doesn't fit waits for running ones to finish and
 * free their old copy, and is blocked once nothing is running any more.
 */
export function runStep(queue: string[], entries: Record<string, RunEntry | undefined>, started: Set<string>, available: number): RunStep {
  const start: string[] = [];
  const drop: string[] = [];
  const waiting: string[] = [];
  let room = available;
  let running = false;
  for (const key of queue) {
    const e = entries[key];
    if (!e || !e.outdated) {
      drop.push(key);
      continue;
    }
    if (e.inFlight) {
      running = true;
      continue;
    }
    // Started by the run and no longer in flight but still outdated: it failed (retried by hand).
    if (started.has(key) || e.failed) {
      drop.push(key);
      continue;
    }
    if (e.needed <= room) {
      start.push(key);
      room -= e.needed;
      running = true;
    } else waiting.push(key);
  }
  return { start, drop, blocked: running ? [] : waiting };
}
