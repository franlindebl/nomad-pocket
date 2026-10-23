// Download manager: a small persistent queue on top of expo-file-system's
// DownloadTask (pause/resume, iOS background URLSession).
//
// Flow: enqueue → queued → running → (paused ⇄ running) → processing → done
//                                  ↘ failed / cancelled
// On completion the file is moved from content/partial to its content dir and the
// kind-specific completion handler registers it as an installed item.
//
// Long-running jobs that are not plain URL downloads (e.g. map region extraction)
// register themselves as "external jobs" so they show up in the same UI.
import { DownloadTask, File, type DownloadPauseState } from 'expo-file-system';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { db, parseJson } from '@/db';
import { contentFile, deleteFile, hasRoomFor, partialDir, type ContentKind } from '@/lib/storage';

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
  /** Final filename inside the kind's content dir. */
  filename: string;
  /** Expected size, for the storage check and progress before headers arrive. */
  expectedBytes: number;
  meta?: Record<string, unknown>;
};

export type CompletionHandler = (file: File, record: DownloadRecord) => Promise<void>;

export class NotEnoughStorageError extends Error {
  constructor(public needed: number) {
    super('NOT_ENOUGH_STORAGE');
  }
}

const MAX_CONCURRENT = 2;
const PERSIST_INTERVAL_MS = 2000;

const handlers: Partial<Record<ContentKind, CompletionHandler>> = {};
const tasks = new Map<string, DownloadTask>();
const lastPersist = new Map<string, number>();
const lastSample = new Map<string, { t: number; bytes: number }>();
const listeners = new Set<(r: DownloadRecord) => void>();

/** Each feature registers what to do with a finished file of its kind. */
export function registerCompletionHandler(kind: ContentKind, handler: CompletionHandler) {
  handlers[kind] = handler;
}

/** Called once per finished download (after the completion handler succeeded). */
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
  destUri: r.dest_uri,
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
  patch: (id: string, patch: Partial<DownloadRecord>) => void;
  remove: (id: string) => void;
};

export const useDownloads = create<DownloadsState>((set) => ({
  records: {},
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

function partialFile(id: string): File {
  return new File(partialDir(), `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.part`);
}

/** Load persisted downloads at startup; running ones resume or restart. */
export function initDownloads() {
  const rows = db().getAllSync<Row>("SELECT * FROM downloads WHERE status NOT IN ('done','cancelled') ORDER BY created_at");
  const records: Record<string, DownloadRecord> = {};
  for (const r of rows) {
    const rec = fromRow(r);
    // The JS task does not survive a relaunch. Paused tasks keep resume data;
    // interrupted running/processing ones go back to the queue.
    if (rec.status === 'running' || rec.status === 'processing') {
      rec.status = r.pause_state ? 'paused' : 'queued';
      persist(rec.id, { status: rec.status });
    }
    records[rec.id] = rec;
  }
  useDownloads.setState({ records });
  pump();

  // Persist resume data when going to background on Android, where the transfer
  // stops with the process. iOS keeps going in its background session.
  if (Platform.OS === 'android') {
    AppState.addEventListener('change', (state) => {
      if (state === 'background') snapshotRunning();
    });
  }
}

async function snapshotRunning() {
  for (const [id, task] of tasks) {
    try {
      await task.pauseAsync();
      persist(id, { pause_state: JSON.stringify(task.savable()), status: 'queued' });
      useDownloads.getState().patch(id, { status: 'queued' });
      tasks.delete(id);
    } catch {
      // ignore: task finished meanwhile
    }
  }
}

export function enqueueDownload(input: EnqueueInput): DownloadRecord {
  const existing = useDownloads.getState().records[input.id];
  if (existing && !['failed', 'cancelled', 'done'].includes(existing.status)) return existing;
  if (!hasRoomFor(input.expectedBytes)) throw new NotEnoughStorageError(input.expectedBytes);

  const now = Date.now();
  const dest = contentFile(input.kind, input.filename);
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
    meta: input.meta ?? {},
    createdAt: now,
    updatedAt: now,
  };
  db().runSync(
    `INSERT OR REPLACE INTO downloads (id, kind, title, url, dest_uri, total_bytes, bytes_written, status, error, pause_state, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'queued', NULL, NULL, ?, ?, ?)`,
    rec.id,
    rec.kind,
    rec.title,
    rec.url,
    rec.destUri,
    rec.totalBytes,
    JSON.stringify(rec.meta),
    now,
    now,
  );
  useDownloads.setState((s) => ({ records: { ...s.records, [rec.id]: rec } }));
  pump();
  return rec;
}

function activeCount() {
  return Object.values(useDownloads.getState().records).filter((r) => r.status === 'running' && !r.external).length;
}

function pump() {
  const queued = Object.values(useDownloads.getState().records)
    .filter((r) => r.status === 'queued' && !r.external)
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

async function run(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec) return;
  setStatus(id, 'running', { error: null }, { error: null });

  const row = db().getFirstSync<Row>('SELECT pause_state FROM downloads WHERE id = ?', id);
  const saved = parseJson<DownloadPauseState | null>(row?.pause_state, null);
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

  let task: DownloadTask;
  let file: File | null;
  try {
    if (saved) {
      task = DownloadTask.fromSavable(saved, options);
      tasks.set(id, task);
      file = await task.resumeAsync();
    } else {
      const part = partialFile(id);
      if (part.exists) part.delete();
      task = new DownloadTask(rec.url, part, options);
      tasks.set(id, task);
      file = await task.downloadAsync();
    }
  } catch (e) {
    tasks.delete(id);
    const current = useDownloads.getState().records[id];
    if (current?.status === 'cancelled') return;
    // Resume data can go stale (server changed, file purged): restart from zero once.
    if (saved) {
      persist(id, { pause_state: null });
      setStatus(id, 'queued');
      pump();
      return;
    }
    setStatus(id, 'failed', { error: String((e as Error)?.message ?? e) }, { error: String((e as Error)?.message ?? e) });
    pump();
    return;
  }

  tasks.delete(id);
  if (!file) {
    // Paused: resume data was captured by pause().
    pump();
    return;
  }

  try {
    setStatus(id, 'processing', {}, { pause_state: null });
    const dest = new File(rec.destUri);
    if (dest.exists) dest.delete();
    file.move(dest);
    const current = useDownloads.getState().records[id] ?? rec;
    const size = Number(dest.size ?? current.totalBytes);
    await handlers[rec.kind]?.(dest, { ...current, bytesWritten: size, totalBytes: size });
    setStatus(id, 'done', { bytesWritten: size, totalBytes: size }, { bytes_written: size, total_bytes: size });
    const done = useDownloads.getState().records[id];
    if (done) listeners.forEach((l) => l(done));
    // Finished downloads leave the active list after a moment.
    setTimeout(() => useDownloads.getState().remove(id), 4000);
  } catch (e) {
    setStatus(id, 'failed', { error: String((e as Error)?.message ?? e) }, { error: String((e as Error)?.message ?? e) });
  }
  pump();
}

export async function pauseDownload(id: string) {
  const task = tasks.get(id);
  if (!task) {
    if (useDownloads.getState().records[id]?.status === 'queued') setStatus(id, 'paused');
    return;
  }
  try {
    await task.pauseAsync();
    persist(id, { pause_state: JSON.stringify(task.savable()) });
  } catch {
    // Not pausable (already finished) — nothing to do.
  }
  tasks.delete(id);
  setStatus(id, 'paused');
  pump();
}

export function resumeDownload(id: string) {
  const rec = useDownloads.getState().records[id];
  if (!rec || !['paused', 'failed'].includes(rec.status)) return;
  setStatus(id, 'queued', { error: null }, { error: null });
  pump();
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
  deleteFile(partialFile(id).uri);
  db().runSync('DELETE FROM downloads WHERE id = ?', id);
  useDownloads.getState().remove(id);
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
      useDownloads.getState().patch(input.id, { status: 'done' });
      const done = useDownloads.getState().records[input.id];
      if (done) listeners.forEach((l) => l(done));
      setTimeout(() => useDownloads.getState().remove(input.id), 4000);
    },
    fail: (error) => {
      externalCancels.delete(input.id);
      useDownloads.getState().patch(input.id, { status: 'failed', error });
    },
  };
}

export function dismissDownload(id: string) {
  db().runSync('DELETE FROM downloads WHERE id = ?', id);
  useDownloads.getState().remove(id);
}

export function useActiveDownloads(): DownloadRecord[] {
  const records = useDownloads((s) => s.records);
  return Object.values(records).sort((a, b) => a.createdAt - b.createdAt);
}

export function useDownload(id: string | undefined): DownloadRecord | undefined {
  return useDownloads((s) => (id ? s.records[id] : undefined));
}
