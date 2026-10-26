// Download manager: a small persistent queue on top of expo-file-system's
// DownloadTask (pause/resume, iOS background URLSession).
//
// Flow: enqueue → queued → running → (paused ⇄ running) → processing → done
//                                  ↘ failed / cancelled
// On completion the file is checked against what its source promised (size, sha-256), moved
// from content/partial to its content dir, and the kind-specific completion handler
// registers it as an installed item.
//
// Every URL download starts here, so the network rules live here too: nothing starts while
// offline, and with "Wi-Fi only" on nothing starts (or keeps running) on mobile data unless
// the person allowed it for that download. Held records stay 'queued' and start by
// themselves when the network allows (decisions in manager-core.ts).
//
// Long-running jobs that are not plain URL downloads (e.g. map region extraction)
// register themselves as "external jobs" so they show up in the same UI.
//
// Record meta the manager owns: group (groups.ts), allowCellular (mobile data allowed for
// this download), integrity (promised size/sha-256), source (the URL actually fetched) and
// avoidMirrors (hosts that served a bad copy).
import { DownloadTask, File, type DownloadPauseState } from 'expo-file-system';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { db, parseJson } from '@/db';
import {
  contentFile,
  deleteFile,
  hasRoomFor,
  partialDir,
  refreshFreeBytes,
  resolveContentUri,
  STORAGE_HEADROOM,
  type ContentKind,
} from '@/lib/storage';
import { useSettings } from '@/stores/settings';

import { recordGroup, type DownloadGroup } from './groups';
import {
  integrityProblem,
  networkGate,
  planAfterFailure,
  safeFileName,
  urlHost,
  type Integrity,
  type NetworkGate,
  type NetworkSnapshot,
} from './manager-core';
import { fastestMirror } from './mirrors';
import { askAboutMobileData } from './wifi-prompt';

export type { DownloadGroup } from './groups';
export type { Integrity, NetworkSnapshot } from './manager-core';

export type DownloadStatus = 'queued' | 'running' | 'paused' | 'processing' | 'failed' | 'done' | 'cancelled';

export type DownloadRecord = {
  id: string;
  kind: ContentKind;
  title: string;
  url: string;
  destUri: string;
  totalBytes: number;
  bytesWritten: number;
  status: DownloadStatus;
  error: string | null;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** Bytes per second, smoothed. In-memory only. */
  speed?: number;
  /** True for jobs that are not URL downloads (map extraction...). */
  external?: boolean;
};

export type EnqueueInput = {
  /** Stable id, usually the catalog id. Re-enqueueing an active id is a no-op. */
  id: string;
  kind: ContentKind;
  title: string;
  url: string;
  /** Final filename inside the kind's content dir (cleaned: never a path). */
  filename: string;
  /** Expected size, for the storage check and progress before headers arrive. */
  expectedBytes: number;
  meta?: Record<string, unknown>;
  /** Files that make one thing (a country's map, pack and search files): one row, one notice. */
  group?: DownloadGroup;
  /** What the source promises (a manifest's size and sha-256): checked before the handler runs. */
  integrity?: Integrity;
  /** Queued without the person asking (a missing search file): no mobile-data question. */
  quiet?: boolean;
};

export type CompletionHandler = (file: File, record: DownloadRecord) => Promise<void>;

export class NotEnoughStorageError extends Error {
  /** Free space this needs, counting the reserve hasRoomFor keeps, so the message adds up. */
  public needed: number;
  constructor(bytes: number) {
    super('NOT_ENOUGH_STORAGE');
    this.needed = bytes + STORAGE_HEADROOM;
  }
}

const MAX_CONCURRENT = 2;
const PERSIST_INTERVAL_MS = 2000;
/** Network events flap while a phone switches networks: act once it has settled. */
const GATE_SETTLE_MS = 1500;
/** Downloads queued within this moment share one mobile-data question. */
const PROMPT_DELAY_MS = 600;
/** After an answer, more downloads of the same batch (a kit, a pack) follow it without asking. */
const PROMPT_BATCH_MS = 20_000;
/** A fallback name when a remote one is unusable. */
const EXTENSIONS: Record<ContentKind, string> = { zim: '.zim', map: '.pmtiles', model: '.gguf', route: '.tar' };

const handlers: Partial<Record<ContentKind, CompletionHandler>> = {};
const tasks = new Map<string, DownloadTask>();
const lastPersist = new Map<string, number>();
const lastSample = new Map<string, { t: number; bytes: number }>();
const listeners = new Set<(r: DownloadRecord) => void>();
/** Consecutive failures without new bytes, for the automatic retries. */
const failures = new Map<string, number>();
/** A record queued for an automatic retry waits until then. */
const retryAt = new Map<string, number>();
/** Transfers being paused right now, and the status each ends in. */
const suspending = new Map<string, 'paused' | 'queued'>();
/** External jobs allowed to use mobile data (they have no persisted meta). */
const cellularJobs = new Set<string>();
/** External jobs waiting for the network rules (whenDownloadAllowed). */
const gateWaiters = new Set<() => void>();
/** The latest run() of each download. */
const runs = new Map<string, symbol>();

/** Each feature registers what to do with a finished file of its kind. */
export function registerCompletionHandler(kind: ContentKind, handler: CompletionHandler) {
  handlers[kind] = handler;
}

/**
 * Called once per finished download (after the completion handler succeeded); for a group,
 * once when its last file is done, with the group's title.
 */
export function onDownloadFinished(listener: (r: DownloadRecord) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Row = {
  id: string;
  kind: ContentKind;
  title: string;
  url: string;
  dest_uri: string;
  total_bytes: number;
  bytes_written: number;
  status: DownloadStatus;
  error: string | null;
  pause_state: string | null;
  meta: string | null;
  created_at: number;
  updated_at: number;
};

const fromRow = (r: Row): DownloadRecord => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  url: r.url,
  destUri: resolveContentUri(r.dest_uri),
  totalBytes: r.total_bytes,
  bytesWritten: r.bytes_written,
  status: r.status,
  error: r.error,
  meta: parseJson(r.meta, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type DownloadsState = {
  records: Record<string, DownloadRecord>;
  /** The network as last reported; null until read at startup (nothing starts before). */
  network: NetworkSnapshot | null;
  patch: (id: string, patch: Partial<DownloadRecord>) => void;
  remove: (id: string) => void;
};

export const useDownloads = create<DownloadsState>((set) => ({
  records: {},
  network: null,
  patch: (id, patch) =>
    set((s) => {
      const prev = s.records[id];
      if (!prev) return s;
      return { records: { ...s.records, [id]: { ...prev, ...patch } } };
    }),
  remove: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.records;
      return { records: rest };
    }),
}));

function persist(id: string, fields: Partial<Row>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db().runSync(
    `UPDATE downloads SET ${sets}, updated_at = ? WHERE id = ?`,
    ...(Object.values(fields) as (string | number | null)[]),
    Date.now(),
    id,
  );
}

function setStatus(id: string, status: DownloadStatus, extra: Partial<DownloadRecord> = {}, row: Partial<Row> = {}) {
  useDownloads.getState().patch(id, { status, ...extra, updatedAt: Date.now() });
  persist(id, { status, ...row });
}

function updateMeta(id: string, fields: Record<string, unknown>) {
  const rec = useDownloads.getState().records[id];
  if (!rec) return;
  const meta = { ...rec.meta, ...fields };
  useDownloads.getState().patch(id, { meta });
  if (!rec.external) persist(id, { meta: JSON.stringify(meta) });
}

function partialFile(id: string): File {
  return new File(partialDir(), `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.part`);
}

// ---------------------------------------------------------------------------
// Network rules ("Wi-Fi only")

const allowsCellular = (r: DownloadRecord) => r.meta.allowCellular === true || cellularJobs.has(r.id);

function gateOf(r: DownloadRecord): NetworkGate {
  return networkGate(useDownloads.getState().network, useSettings.getState().wifiOnly, allowsCellular(r));
}

/** Why a row's queued downloads aren't starting ('wifi', 'offline'), or null. For the UI. */
export function waitingReason(records: DownloadRecord[], network: NetworkSnapshot | null, wifiOnly: boolean): 'wifi' | 'offline' | null {
  let reason: 'wifi' | 'offline' | null = null;
  for (const r of records) {
    if (r.status !== 'queued') continue;
    const gate = networkGate(network, wifiOnly, allowsCellular(r));
    if (gate === 'offline') return 'offline';
    if (gate === 'wifi') reason = 'wifi';
  }
  return reason;
}

let gateTimer: ReturnType<typeof setTimeout> | null = null;

/** `settle`: wait for the network to settle before acting (events); the first reading acts at once. */
function setNetwork(net: NetworkSnapshot, settle: boolean) {
  const wait = settle && !!useDownloads.getState().network;
  useDownloads.setState({ network: { type: net.type, isConnected: net.isConnected, isInternetReachable: net.isInternetReachable } });
  if (gateTimer) clearTimeout(gateTimer);
  gateTimer = wait ? setTimeout(applyGate, GATE_SETTLE_MS) : null;
  if (!wait) applyGate();
}

/** Bumped by every network event: a read that started before one is stale. */
let networkSeq = 0;

function readNetwork() {
  // iOS answers "no connection" when its path monitor takes over 5 s: never let such a late
  // answer overwrite a newer event.
  const seq = ++networkSeq;
  Network.getNetworkStateAsync().then(
    (net) => seq === networkSeq && setNetwork(net, false),
    // Can't tell: don't hold downloads back forever.
    () => seq === networkSeq && !useDownloads.getState().network && setNetwork({ type: 'UNKNOWN', isConnected: true }, false),
  );
}

function onNetworkEvent(net: NetworkSnapshot) {
  networkSeq++;
  setNetwork(net, true);
}

/**
 * After the network or the setting changed: transfers on mobile data that may no longer run
 * wait as 'queued' (resume data kept), and whatever may start now starts.
 */
function applyGate() {
  for (const id of [...tasks.keys()]) {
    const rec = useDownloads.getState().records[id];
    if (rec?.status === 'running' && gateOf(rec) === 'wifi') void suspend(id, 'queued').then((held) => held && pump());
  }
  for (const check of [...gateWaiters]) check();
  pump();
}

/** Lets these downloads use mobile data although "Wi-Fi only" is on. The setting stays as it is. */
export function allowMobileData(ids: string[]) {
  for (const id of ids) {
    const rec = useDownloads.getState().records[id];
    if (!rec) continue;
    if (rec.external) cellularJobs.add(id);
    else if (!allowsCellular(rec)) updateMeta(id, { allowCellular: true });
  }
  for (const check of [...gateWaiters]) check();
  pump();
}

const prompt = {
  ids: new Set<string>(),
  timer: null as ReturnType<typeof setTimeout> | null,
  open: false,
  answer: null as { useMobileData: boolean; until: number } | null,
};

/** After the person asked for a download: if it waits for Wi-Fi, ask (once per batch) about mobile data. */
function promptIfWaiting(id: string) {
  const answer = prompt.answer;
  if (answer && Date.now() < answer.until) {
    // A kit queues its files over many seconds (each waits for the catalog): keep following.
    answer.until = Date.now() + PROMPT_BATCH_MS;
    if (answer.useMobileData) allowMobileData([id]);
    return;
  }
  prompt.ids.add(id);
  if (prompt.open) return;
  if (prompt.timer) clearTimeout(prompt.timer);
  prompt.timer = setTimeout(showPrompt, PROMPT_DELAY_MS);
}

function showPrompt() {
  prompt.timer = null;
  const records = useDownloads.getState().records;
  const waiting = [...prompt.ids].map((id) => records[id]).filter((r) => r && r.status === 'queued' && gateOf(r) === 'wifi');
  if (!waiting.length || AppState.currentState !== 'active') {
    prompt.ids.clear();
    return;
  }
  prompt.open = true;
  const titles = [...new Set(waiting.map((r) => recordGroup(r)?.title ?? r.title))];
  askAboutMobileData(titles, (useMobileData) => {
    prompt.open = false;
    prompt.answer = { useMobileData, until: Date.now() + PROMPT_BATCH_MS };
    // Downloads asked for while the question was open follow the answer too.
    const ids = [...prompt.ids];
    prompt.ids.clear();
    if (useMobileData) allowMobileData(ids);
  });
}

/** Asks again about downloads waiting for Wi-Fi (the person tapped one). */
export function askMobileData(ids: string[]) {
  prompt.answer = null;
  for (const id of ids) promptIfWaiting(id);
}

/**
 * For jobs that fetch outside the queue (an on-device map extraction, registered with
 * startExternalJob first): resolves once the network rules let `id` start, showing the job
 * as queued and asking about mobile data meanwhile. Rejects when `signal` aborts.
 */
export function whenDownloadAllowed(id: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const rec = useDownloads.getState().records[id];
      if (signal?.aborted) {
        gateWaiters.delete(check);
        reject(signal.reason ?? new Error('aborted'));
      } else if (!rec || gateOf(rec) === 'go') {
        gateWaiters.delete(check);
        if (rec?.status === 'queued') useDownloads.getState().patch(id, { status: 'running' });
        resolve();
      } else return false;
      return true;
    };
    if (check()) return;
    useDownloads.getState().patch(id, { status: 'queued' });
    gateWaiters.add(check);
    signal?.addEventListener('abort', check, { once: true });
    promptIfWaiting(id);
  });
}

// ---------------------------------------------------------------------------
// Queue

/** Load persisted downloads at startup; running ones resume or restart. */
export function initDownloads() {
  const rows = db().getAllSync<Row>("SELECT * FROM downloads WHERE status NOT IN ('done','cancelled') ORDER BY created_at");
  const records: Record<string, DownloadRecord> = {};
  for (const r of rows) {
    const rec = fromRow(r);
    // The JS task does not survive a relaunch. Paused tasks keep resume data;
    // interrupted running/processing ones go back to the queue.
    // A crash while processing leaves the finished file in place: finish it instead of re-downloading.
    if (rec.status === 'processing' && new File(rec.destUri).exists) {
      records[rec.id] = rec;
      continue;
    }
    if (rec.status === 'running' || rec.status === 'processing') {
      rec.status = r.pause_state ? 'paused' : 'queued';
      persist(rec.id, { status: rec.status });
    }
    records[rec.id] = rec;
  }
  useDownloads.setState({ records });
  sweepPartials(Object.keys(records));
  for (const rec of Object.values(records)) {
    if (rec.status !== 'processing') continue;
    finalize(rec.id, new File(rec.destUri)).catch((e) =>
      setStatus(rec.id, 'failed', { error: String((e as Error)?.message ?? e) }, { error: String((e as Error)?.message ?? e) }),
    );
  }
  refreshFreeBytes();

  // Nothing starts before the network is known (pump() holds the queue until then).
  readNetwork();
  Network.addNetworkStateListener(onNetworkEvent);
  useSettings.subscribe((s, prev) => {
    if (s.wifiOnly !== prev.wifiOnly) applyGate();
  });

  // Android stops transfers with the process: persist resume data when going to background
  // (the .part file would do too, but a clean pause is exact). iOS keeps going in its
  // background session while the app is suspended. If iOS terminates the app (memory
  // pressure), nsurlsessiond keeps the old task running, but expo-file-system can't adopt
  // or cancel it: the 'running' row restarts from zero at the next launch beside it.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      refreshFreeBytes();
      readNetwork();
    }
    if (Platform.OS !== 'android') return;
    if (state === 'background') {
      backgrounded = true;
      snapshotRunning();
    } else if (state === 'active' && backgrounded) {
      backgrounded = false;
      pump();
    }
  });
}

/** Android only: no new transfers start while the app is in the background. */
let backgrounded = false;

/** Delete leftover `.part` files of URL downloads that no longer exist (map jobs clean their own). */
function sweepPartials(activeIds: string[]) {
  const keep = new Set(activeIds.map((id) => partialFile(id).name));
  try {
    for (const entry of partialDir().list()) {
      if (entry instanceof File && entry.name.endsWith('.part') && !entry.name.startsWith('map-') && !keep.has(entry.name)) entry.delete();
    }
  } catch (e) {
    console.warn('[downloads] sweep failed', e);
  }
}

/**
 * Stops a running transfer and keeps its resume data; it ends 'paused' (the person) or
 * 'queued' (the network rules, Android's background). False when there was nothing to pause.
 */
async function suspend(id: string, next: 'paused' | 'queued'): Promise<boolean> {
  const task = tasks.get(id);
  if (!task) return false;
  if (suspending.has(id)) {
    // Already pausing (a second native pause would lose iOS's resume data): the person's pause wins.
    if (next === 'paused') suspending.set(id, 'paused');
    return false;
  }
  suspending.set(id, next);
  try {
    await task.pauseAsync();
    persist(id, { pause_state: JSON.stringify(task.savable()) });
  } catch {
    // Not pausable: it finished (or failed) meanwhile and run() handles that.
    suspending.delete(id);
    return false;
  }
  const status = suspending.get(id) ?? next;
  suspending.delete(id);
  tasks.delete(id);
  if (useDownloads.getState().records[id]?.status === 'running') setStatus(id, status);
  return true;
}

async function snapshotRunning() {
  await Promise.all([...tasks.keys()].map((id) => suspend(id, 'queued')));
  // Back in the foreground before the pauses settled: the 'active' pump found no free slot.
  if (!backgrounded) pump();
}

export function enqueueDownload(input: EnqueueInput): DownloadRecord {
  const existing = useDownloads.getState().records[input.id];
  if (existing && !['failed', 'cancelled', 'done'].includes(existing.status)) return existing;
  // Other queued/running downloads will need their remaining bytes too.
  const pending = Object.values(useDownloads.getState().records)
    .filter((r) => !r.external && ['queued', 'running', 'paused'].includes(r.status))
    .reduce((sum, r) => sum + Math.max(0, r.totalBytes - r.bytesWritten), 0);
  if (!hasRoomFor(input.expectedBytes + pending)) throw new NotEnoughStorageError(input.expectedBytes + pending);

  const now = Date.now();
  // Names come from remote catalogs (an OPDS href, a manifest): never let one be a path.
  const dest = contentFile(input.kind, safeFileName(input.filename, `${input.id}${EXTENSIONS[input.kind]}`));
  // The same file asked for again (after a failure) continues from its bytes; another one
  // (a newer version under the same id) must not be appended to them.
  const sameFile = existing?.status === 'failed' && existing.url === input.url;
  const pauseState = sameFile ? (db().getFirstSync<Row>('SELECT pause_state FROM downloads WHERE id = ?', input.id)?.pause_state ?? null) : null;
  if (!sameFile) deleteFile(partialFile(input.id).uri);
  const meta: Record<string, unknown> = { ...input.meta };
  if (input.group) meta.group = input.group;
  if (input.integrity) meta.integrity = input.integrity;
  const rec: DownloadRecord = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    url: input.url,
    destUri: dest.uri,
    totalBytes: input.expectedBytes,
    bytesWritten: 0,
    status: 'queued',
    error: null,
    meta,
    createdAt: now,
    updatedAt: now,
  };
  db().runSync(
    `INSERT OR REPLACE INTO downloads (id, kind, title, url, dest_uri, total_bytes, bytes_written, status, error, pause_state, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'queued', NULL, ?, ?, ?, ?)`,
    rec.id,
    rec.kind,
    rec.title,
    rec.url,
    rec.destUri,
    rec.totalBytes,
    pauseState,
    JSON.stringify(rec.meta),
    now,
    now,
  );
  failures.delete(rec.id);
  retryAt.delete(rec.id);
  useDownloads.setState((s) => ({ records: { ...s.records, [rec.id]: rec } }));
  pump();
  if (!input.quiet) promptIfWaiting(rec.id);
  return rec;
}

function activeCount() {
  return Object.values(useDownloads.getState().records).filter((r) => r.status === 'running' && !r.external).length;
}

function pump() {
  if (backgrounded) return;
  const now = Date.now();
  const queued = Object.values(useDownloads.getState().records)
    .filter((r) => r.status === 'queued' && !r.external && (retryAt.get(r.id) ?? 0) <= now && gateOf(r) === 'go')
    .sort((a, b) => a.createdAt - b.createdAt);
  let slots = MAX_CONCURRENT - activeCount();
  for (const rec of queued) {
    if (slots <= 0) break;
    slots--;
    run(rec.id).catch(() => {});
  }
}

function onProgress(id: string, bytesWritten: number, totalBytes: number) {
  const now = Date.now();
  // Bytes arrive again: a later failure is a new problem, with its full set of retries.
  failures.delete(id);
  const prev = lastSample.get(id);
  let speed: number | undefined;
  if (prev && now - prev.t > 800) {
    const instant = ((bytesWritten - prev.bytes) * 1000) / (now - prev.t);
    const old = useDownloads.getState().records[id]?.speed;
    speed = old ? old * 0.7 + instant * 0.3 : instant;
    lastSample.set(id, { t: now, bytes: bytesWritten });
  } else if (!prev) {
    lastSample.set(id, { t: now, bytes: bytesWritten });
  }
  const patch: Partial<DownloadRecord> = { bytesWritten };
  if (totalBytes > 0) patch.totalBytes = totalBytes;
  if (speed !== undefined) patch.speed = speed;
  useDownloads.getState().patch(id, patch);
  if (now - (lastPersist.get(id) ?? 0) > PERSIST_INTERVAL_MS) {
    lastPersist.set(id, now);
    persist(id, { bytes_written: bytesWritten, ...(totalBytes > 0 ? { total_bytes: totalBytes } : {}) });
  }
}

/**
 * Compares a finished file with the size and sha-256 its source promised (a Kiwix mirror is
 * a volunteer's server). A bad copy is deleted and its mirror avoided on the retry.
 */
async function checkIntegrity(id: string, file: File, rec: DownloadRecord) {
  const expected = rec.meta.integrity as Integrity | undefined;
  if (!expected || (expected.size === undefined && !expected.sha256)) return;
  const size = Number(file.size ?? 0);
  let problem = integrityProblem({ size }, expected);
  // Hashing streams the file natively, off the JS thread (seconds per GB).
  if (!problem && expected.sha256) problem = integrityProblem({ size, sha256: await file.digest('SHA-256') }, expected);
  if (!problem) return;
  deleteFile(file.uri);
  const host = urlHost(String(rec.meta.source ?? ''));
  if (host && host !== urlHost(rec.url)) updateMeta(id, { avoidMirrors: [...((rec.meta.avoidMirrors as string[] | undefined) ?? []), host] });
  throw new Error(problem);
}

/** Hand the finished file to its feature and mark the download done. */
async function finalize(id: string, dest: File) {
  const current = useDownloads.getState().records[id];
  if (!current || current.status === 'cancelled') {
    // Cancelled while the file was being moved into place.
    deleteFile(dest.uri);
    return;
  }
  await checkIntegrity(id, dest, current);
  const size = Number(dest.size ?? current.totalBytes);
  try {
    await handlers[current.kind]?.(dest, { ...current, bytesWritten: size, totalBytes: size });
  } catch (e) {
    // A file its feature can't use (a truncated or unsupported archive) would stay in the
    // content dir, invisible and retried at every launch: drop it, Retry fetches it again.
    deleteFile(dest.uri);
    throw e;
  }
  setStatus(id, 'done', { bytesWritten: size, totalBytes: size }, { bytes_written: size, total_bytes: size });
  const done = useDownloads.getState().records[id];
  if (done) finished(done);
}

const groupMembers = (groupId: string) => Object.values(useDownloads.getState().records).filter((r) => recordGroup(r)?.id === groupId);

/**
 * Finished downloads leave the active list after a moment. A group's files wait for the
 * last one, so the group's row keeps its total and the person hears about it once.
 */
function finished(done: DownloadRecord) {
  const group = recordGroup(done);
  if (!group) {
    listeners.forEach((l) => l(done));
    setTimeout(() => useDownloads.getState().remove(done.id), 4000);
    return;
  }
  if (groupMembers(group.id).some((r) => r.status !== 'done')) return;
  listeners.forEach((l) => l({ ...done, title: group.title }));
  setTimeout(() => clearGroup(group.id), 4000);
}

/** Drops a group's finished files once nothing else in it is left to finish. */
function clearGroup(groupId: string) {
  const members = groupMembers(groupId);
  if (members.every((r) => r.status === 'done')) members.forEach((r) => useDownloads.getState().remove(r.id));
}

/** The URL to fetch (the fastest Kiwix mirror), remembering what the source promises about the file. */
async function pickSource(id: string): Promise<string> {
  const rec = useDownloads.getState().records[id];
  if (!rec) return '';
  const { url, integrity } = await fastestMirror(rec.url, (rec.meta.avoidMirrors as string[] | undefined) ?? []);
  // A feature's own promise (a manifest) wins over the metalink's.
  const promised = !rec.meta.integrity && (integrity.size !== undefined || integrity.sha256);
  updateMeta(id, promised ? { source: url, integrity } : { source: url });
  return url;
}

async function run(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec) return;
  retryAt.delete(id);
  setStatus(id, 'running', { error: null }, { error: null });
  // Paused and resumed while probing mirrors: a newer run() owns the download then.
  const token = Symbol(id);
  runs.set(id, token);

  const row = db().getFirstSync<Row>('SELECT pause_state FROM downloads WHERE id = ?', id);
  const saved = parseJson<DownloadPauseState | null>(row?.pause_state, null);
  // iOS moves the app container on update: the saved .part path must follow it.
  if (saved?.fileUri) saved.fileUri = resolveContentUri(saved.fileUri);
  const options = {
    sessionType: 'background' as const,
    // Native sizes may arrive as BigInt (int64); everything downstream expects numbers.
    onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number | bigint; totalBytes: number | bigint }) => {
      // An exception thrown from a native event callback is fatal in release builds.
      try {
        onProgress(id, Number(bytesWritten), Number(totalBytes));
      } catch (e) {
        console.warn('[downloads] progress', e);
      }
    },
  };

  let resumed = false;
  let file: File | null;
  try {
    let task: DownloadTask;
    if (saved) {
      resumed = true;
      task = DownloadTask.fromSavable(saved, options);
    } else {
      const url = await pickSource(id);
      // Paused, cancelled or held back by the network while mirrors were being probed.
      const now = useDownloads.getState().records[id];
      if (now?.status !== 'running' || runs.get(id) !== token) return;
      if (gateOf(now) !== 'go') {
        setStatus(id, 'queued');
        return;
      }
      const part = partialFile(id);
      // Android writes straight into the .part file: a transfer that failed or died with the
      // process continues from what is on disk (its resume data is just that offset).
      const have = Platform.OS === 'android' && part.exists ? Number(part.size ?? 0) : 0;
      if (have > 0) {
        resumed = true;
        task = DownloadTask.fromSavable({ url, fileUri: part.uri, isDirectory: false, resumeData: String(have) }, options);
      } else {
        if (part.exists) part.delete();
        task = new DownloadTask(url, part, options);
      }
    }
    tasks.set(id, task);
    file = await (resumed ? task.resumeAsync() : task.downloadAsync());
  } catch (e) {
    tasks.delete(id);
    // Cancelled (the record is gone, or about to be).
    const current = useDownloads.getState().records[id];
    if (!current || current.status === 'cancelled') return;
    failed(id, e, resumed);
    return;
  }

  tasks.delete(id);
  if (!file) {
    // Paused: suspend() kept the resume data.
    pump();
    return;
  }

  try {
    setStatus(id, 'processing', {}, { pause_state: null });
    const dest = new File(rec.destUri);
    if (dest.exists) dest.delete();
    await file.move(dest);
    await finalize(id, dest);
  } catch (e) {
    console.warn('[downloads] failed', id, e);
    setStatus(id, 'failed', { error: String((e as Error)?.message ?? e) }, { error: String((e as Error)?.message ?? e) });
  }
  pump();
}

/**
 * A transfer failed. Network trouble keeps the bytes (iOS resume data, Android's .part) and
 * retries by itself; only a stale saved state starts over from zero (manager-core.ts).
 */
function failed(id: string, e: unknown, resumed: boolean) {
  const error = String((e as Error)?.message ?? e);
  const count = failures.get(id) ?? 0;
  failures.set(id, count + 1);
  const plan = planAfterFailure(error, { resumed, failures: count });
  console.warn('[downloads] failed', id, plan.kind, error);
  if (plan.kind === 'restart') {
    persist(id, { pause_state: null });
    deleteFile(partialFile(id).uri);
    setStatus(id, 'queued');
  } else if (plan.kind === 'retry') {
    // Queued, so it also waits for the network to come back (pump checks it).
    retryAt.set(id, Date.now() + plan.delayMs);
    setTimeout(pump, plan.delayMs);
    setStatus(id, 'queued', { error }, { error });
  } else {
    setStatus(id, 'failed', { error }, { error });
  }
  pump();
}

export async function pauseDownload(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec || rec.external) return;
  if (!tasks.has(id)) {
    if (rec.status === 'queued') setStatus(id, 'paused');
    else if (rec.status === 'running') {
      // Still choosing its mirror: run() checks the status after the probe. Its slot is free now.
      setStatus(id, 'paused');
      pump();
    }
    return;
  }
  if (await suspend(id, 'paused')) pump();
}

export function resumeDownload(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec || !['paused', 'failed'].includes(rec.status)) return;
  // The person's retry starts the automatic retries over.
  failures.delete(id);
  retryAt.delete(id);
  setStatus(id, 'queued', { error: null }, { error: null });
  pump();
  promptIfWaiting(id);
}

function forget(id: string) {
  failures.delete(id);
  retryAt.delete(id);
  cellularJobs.delete(id);
  runs.delete(id);
}

export async function cancelDownload(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec) return;
  if (rec.external) {
    externalCancels.get(id)?.();
    return;
  }
  setStatus(id, 'cancelled');
  const task = tasks.get(id);
  tasks.delete(id);
  try {
    task?.cancel();
  } catch {
    // ignore
  }
  forget(id);
  deleteFile(partialFile(id).uri);
  db().runSync('DELETE FROM downloads WHERE id = ?', id);
  useDownloads.getState().remove(id);
  const group = recordGroup(rec);
  if (group) clearGroup(group.id);
  pump();
}

// ---------------------------------------------------------------------------
// External jobs (map extraction, model setup...). Kept in memory only.

const externalCancels = new Map<string, () => void>();

export type ExternalJob = {
  update: (patch: { bytesWritten?: number; totalBytes?: number; status?: DownloadStatus; error?: string | null }) => void;
  finish: () => void;
  fail: (error: string) => void;
};

export function startExternalJob(input: {
  id: string;
  kind: ContentKind;
  title: string;
  totalBytes: number;
  cancel: () => void;
}): ExternalJob {
  const now = Date.now();
  externalCancels.set(input.id, input.cancel);
  useDownloads.setState((s) => ({
    records: {
      ...s.records,
      [input.id]: {
        id: input.id,
        kind: input.kind,
        title: input.title,
        url: '',
        destUri: '',
        totalBytes: input.totalBytes,
        bytesWritten: 0,
        status: 'running',
        error: null,
        meta: {},
        createdAt: now,
        updatedAt: now,
        external: true,
      },
    },
  }));
  return {
    update: (patch) => {
      if (patch.bytesWritten !== undefined) onProgress(input.id, patch.bytesWritten, patch.totalBytes ?? 0);
      const { bytesWritten: _b, ...rest } = patch;
      useDownloads.getState().patch(input.id, rest as Partial<DownloadRecord>);
    },
    finish: () => {
      externalCancels.delete(input.id);
      cellularJobs.delete(input.id);
      useDownloads.getState().patch(input.id, { status: 'done' });
      const done = useDownloads.getState().records[input.id];
      if (done) listeners.forEach((l) => l(done));
      setTimeout(() => useDownloads.getState().remove(input.id), 4000);
    },
    fail: (error) => {
      externalCancels.delete(input.id);
      cellularJobs.delete(input.id);
      useDownloads.getState().patch(input.id, { status: 'failed', error });
    },
  };
}

export function dismissDownload(id: string) {
  const rec = useDownloads.getState().records[id];
  forget(id);
  deleteFile(partialFile(id).uri);
  db().runSync('DELETE FROM downloads WHERE id = ?', id);
  useDownloads.getState().remove(id);
  const group = rec && recordGroup(rec);
  if (group) clearGroup(group.id);
}

/** A row of the Downloads sheet (one download or a group): pause, resume, retry, cancel it all. */
export async function pauseDownloads(records: DownloadRecord[]) {
  // Queued ones first: pausing a running one starts the next queued file.
  for (const r of records) if (r.status === 'queued') void pauseDownload(r.id);
  await Promise.all(records.filter((r) => r.status === 'running').map((r) => pauseDownload(r.id)));
}

export function resumeDownloads(records: DownloadRecord[]) {
  for (const r of records) if (r.status === 'paused' || r.status === 'failed') resumeDownload(r.id);
}

export async function cancelDownloads(records: DownloadRecord[]) {
  for (const r of records) {
    if (r.status === 'failed' || r.status === 'done') dismissDownload(r.id);
    else if (r.status !== 'processing') await cancelDownload(r.id);
  }
}

export function useActiveDownloads(): DownloadRecord[] {
  const records = useDownloads((s) => s.records);
  return Object.values(records).sort((a, b) => a.createdAt - b.createdAt);
}

export function useDownload(id: string | undefined): DownloadRecord | undefined {
  return useDownloads((s) => (id ? s.records[id] : undefined));
}

/** Why these downloads wait (for the Downloads sheet and download buttons), re-rendering on network changes. */
export function useWaitingReason(records: DownloadRecord[]): 'wifi' | 'offline' | null {
  const network = useDownloads((s) => s.network);
  const wifiOnly = useSettings((s) => s.wifiOnly);
  return waitingReason(records, network, wifiOnly);
}
