// The connection budget every download shares, and how it adapts: a fixed 8 connections and
// 2 files at a time leaves a fast line idle when the mirrors are the limit (5–8 MB/s per
// connection against a 300 Mb/s home line), and wastes nothing when the line is the limit.
// So the budget climbs while it pays: when the downloads use all of it, try 2 more connections
// for a window; keep them if the total speed grew, give them back (and wait a minute) if not.
// Up to 6 files run at once and share the budget fairly: a queue of small archives (a kit)
// spreads over several mirrors at once instead of waiting behind a country map whose GitHub
// host can't use more connections. (Starting files only on spare connections didn't: a full
// budget never left any, and the queue ran 2 at a time.)
// No `@/` imports: unit tests load this file directly.

export type NetworkKind = 'wifi' | 'cellular';

const LIMITS: Record<NetworkKind, { start: number; min: number; max: number; files: number }> = {
  wifi: { start: 8, min: 4, max: 16, files: 6 },
  cellular: { start: 4, min: 2, max: 6, files: 2 },
};
/** Files choosing their sources at once (each probes every mirror, which briefly loads the link). */
const MAX_PLANNING = 2;
/** Files from one single-host source running at once. */
const FILES_PER_HOST = 2;
const STEP = 2;
/** A trial is kept when the total speed grew this much (the noise between windows is ~5–8 %). */
const GAIN = 1.15;
/** After a trial that didn't pay, the budget stays put this long. */
export const HOLD_MS = 60_000;
/** How long a decision window lasts (the manager samples speed within it). */
export const WINDOW_MS = 10_000;

export type Budget = {
  network: NetworkKind;
  conns: number;
  /** A trial running since the last window: the speed before it. */
  trial: { before: number } | null;
  holdUntil: number;
};

export function initialBudget(network: NetworkKind): Budget {
  return { network, conns: LIMITS[network].start, trial: null, holdUntil: 0 };
}

/**
 * One decision window ended. `bps`: total bytes per second over it; `saturated`: the downloads
 * used (nearly) every connection, so more might help; `stable`: the same downloads ran all
 * through it. A file finishing (hashing, moving) or starting (probing mirrors) dips the speed
 * for seconds: such a window says nothing about the connections, and a trial waits for the next.
 */
export function decide(b: Budget, o: { now: number; bps: number; saturated: boolean; stable?: boolean }): Budget {
  const { min, max } = LIMITS[b.network];
  if (o.stable === false) return b;
  if (b.trial) {
    if (o.bps >= b.trial.before * GAIN) return { ...b, trial: null };
    return { ...b, conns: Math.max(min, b.conns - STEP), trial: null, holdUntil: o.now + HOLD_MS };
  }
  if (!o.saturated || o.bps <= 0 || o.now < b.holdUntil || b.conns >= max) return b;
  return { ...b, conns: Math.min(max, b.conns + STEP), trial: { before: o.bps } };
}

/**
 * Connections one segmented download may hold. It takes what the others leave, but when any
 * other one wants more than it has (`othersHungry`), only its fair part, so a big archive
 * started first doesn't starve the next one.
 */
export function connectionsFor(o: { budget: number; othersInFlight: number; segmented: number; singles: number; othersHungry: boolean }): number {
  const free = o.budget - o.othersInFlight;
  const fair = Math.ceil((o.budget - o.singles) / Math.max(1, o.segmented));
  return Math.max(1, o.othersHungry ? Math.min(free, fair) : free);
}

/**
 * Whether the queue may start another file: up to 6 at once on Wi-Fi (2 on mobile data), and
 * at most 2 still choosing their sources (`planning`).
 */
export function canStartFile(o: { network: NetworkKind; running: number; planning: number }): boolean {
  return o.running < LIMITS[o.network].files && o.planning < MAX_PLANNING;
}

/**
 * Whether one more file from a single-host source (GitHub, Hugging Face) may start, with
 * `sameHost` of its files already running. Files from one host share its connection cap, so a
 * third part of a country map adds nothing but takes a slot a kit's archives (Kiwix, spread
 * over many mirrors: `multiMirror`) could use. Seen on the simulator: Spain's six map, pack and
 * search files filled every slot while twelve guides waited.
 */
export function hostHasRoom(o: { sameHost: number; multiMirror: boolean }): boolean {
  return o.multiMirror || o.sameHost < FILES_PER_HOST;
}
