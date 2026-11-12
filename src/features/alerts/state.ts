// Official alerts state, kept in kv so the list shows offline and the background task (a headless JS run, no React)
// reads and writes the same thing as the app: whether it's on, the last position (rounded, on the device only), what
// each source last returned, what was notified and a log of recent checks for measuring background runs
// (docs/ALERTS_PLAN.md, phase 1). Sync reads at module load, like the other kv-backed stores.
import { create } from 'zustand';

import Storage from '@/db/kv';

import type { Alert, Level, Notified, SourceId } from './alerts-core';

const KEYS = {
  enabled: 'alerts.enabled',
  offered: 'alerts.offered',
  position: 'alerts.position',
  cache: 'alerts.cache',
  notified: 'alerts.notified',
  runs: 'alerts.runs',
  prefs: 'alerts.prefs',
  push: 'alerts.push',
} as const;

export type SavedPosition = { lat: number; lon: number; at: number };

export type SourceCache = {
  /** Last time the source answered (200 or 304). */
  fetchedAt: number;
  /** Every alert it returned, current or not yet (filtered when shown). */
  alerts: Alert[];
  lastModified?: string;
  /** AEMET: the bundle these alerts came from; a new URL means a new state. */
  bundleUrl?: string;
  /** NWS: the (rounded) point asked about. */
  point?: string;
  /** The last failure, cleared on the next answer. */
  error?: string;
};

export type Cache = { checkedAt: number | null; sources: Partial<Record<SourceId, SourceCache>> };

export type Trigger = 'launch' | 'foreground' | 'background' | 'manual' | 'enable' | 'push';
export type Run = {
  at: number;
  trigger: Trigger;
  ms: number;
  ok: SourceId[];
  failed: SourceId[];
  notified: number;
  /** No connection: nothing was asked. */
  offline?: boolean;
};

export type Prefs = {
  /** Lowest weather level that notifies (owner's default: orange). */
  minLevel: Level;
  /** Earthquakes that pass the distance rule notify. */
  quakes: boolean;
};

export const DEFAULT_PREFS: Prefs = { minLevel: 'orange', quakes: true };

/** This phone's registration with the push server (phase 2; push-register.ts). */
export type PushReg = {
  platform: 'ios' | 'android';
  token: string;
  /** The body last accepted by the server: a different one is sent again. */
  sent: string;
  /** When the server last accepted it. */
  at: number;
  /** The sources the server pushes to this phone (the app doesn't notify those itself while push is healthy). */
  sources: SourceId[];
  /** Last time /health answered ok. */
  healthyAt?: number;
};
const MAX_RUNS = 50;

function read<T>(key: string, fallback: T, valid: (v: unknown) => boolean = (v) => v !== null && typeof v === 'object'): T {
  try {
    const v = JSON.parse(Storage.getItemSync(key) ?? 'null') as unknown;
    return v !== null && valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[alerts] cannot save', key, e);
  }
}

type State = {
  enabled: boolean;
  offered: boolean;
  position: SavedPosition | null;
  cache: Cache;
  notified: Notified;
  runs: Run[];
  prefs: Prefs;
  push: PushReg | null;
  checking: boolean;
};

const isBool = (v: unknown) => typeof v === 'boolean';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function load(): Omit<State, 'checking'> {
  return {
    enabled: read(KEYS.enabled, false, isBool),
    offered: read(KEYS.offered, false, isBool),
    position: read<SavedPosition | null>(KEYS.position, null, (v) => isNum((v as SavedPosition)?.lat) && isNum((v as SavedPosition)?.lon)),
    cache: read<Cache>(KEYS.cache, { checkedAt: null, sources: {} }, (v) => typeof (v as Cache)?.sources === 'object'),
    notified: read<Notified>(KEYS.notified, {}),
    runs: read<Run[]>(KEYS.runs, [], Array.isArray),
    prefs: { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(KEYS.prefs, {}) },
    push: read<PushReg | null>(KEYS.push, null, (v) => typeof (v as PushReg)?.token === 'string'),
  };
}

export const useAlertsState = create<State>(() => ({ ...load(), checking: false }));

/** Re-reads kv: the background task may have run in another JS context (Android) since this one loaded. */
export function reloadAlertsState() {
  useAlertsState.setState(load());
}

export function saveEnabled(enabled: boolean) {
  write(KEYS.enabled, enabled);
  useAlertsState.setState({ enabled });
}

export function saveOffered() {
  write(KEYS.offered, true);
  useAlertsState.setState({ offered: true });
}

export function savePosition(position: SavedPosition | null) {
  if (position) write(KEYS.position, position);
  else Storage.removeItemSync(KEYS.position);
  useAlertsState.setState({ position });
}

export function saveCache(cache: Cache) {
  write(KEYS.cache, cache);
  useAlertsState.setState({ cache });
}

export function saveNotified(notified: Notified) {
  write(KEYS.notified, notified);
  useAlertsState.setState({ notified });
}

export function savePrefs(prefs: Partial<Prefs>) {
  const next = { ...useAlertsState.getState().prefs, ...prefs };
  write(KEYS.prefs, next);
  useAlertsState.setState({ prefs: next });
}

export function savePush(push: PushReg | null) {
  if (push) write(KEYS.push, push);
  else Storage.removeItemSync(KEYS.push);
  useAlertsState.setState({ push });
}

export function logRun(run: Run) {
  const runs = [run, ...useAlertsState.getState().runs].slice(0, MAX_RUNS);
  write(KEYS.runs, runs);
  useAlertsState.setState({ runs });
}

/** Turning the feature off forgets everything it fetched and the position (nothing is kept while it is off). */
export function clearAlertsData() {
  for (const key of [KEYS.position, KEYS.cache, KEYS.notified, KEYS.runs]) Storage.removeItemSync(key);
  useAlertsState.setState({ position: null, cache: { checkedAt: null, sources: {} }, notified: {}, runs: [] });
}
