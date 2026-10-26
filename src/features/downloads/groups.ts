// Downloads that make one thing for the person read as one row. A country is up to a dozen
// files (map parts, routing pack parts, points, streets, places, doors); the Downloads sheet
// and the home card show "Mapa de España" with the combined bytes, not eight "España" rows.
// The feature that queues the files tags them with `meta.group`.
// No `@/` imports: unit tests load this file directly.

export type DownloadGroup = { id: string; title: string };

type Status = 'queued' | 'running' | 'paused' | 'processing' | 'failed' | 'done' | 'cancelled';

export type GroupableRecord = {
  id: string;
  title: string;
  status: Status;
  bytesWritten: number;
  totalBytes: number;
  error: string | null;
  meta: Record<string, unknown>;
  createdAt: number;
  speed?: number;
  external?: boolean;
};

/** One row of the Downloads sheet: a single download, or a group summed up. */
export type DownloadEntry<R extends GroupableRecord = GroupableRecord> = {
  id: string;
  title: string;
  status: Status;
  bytesWritten: number;
  totalBytes: number;
  speed: number;
  /** The first failure in the entry (the others may still be running). */
  error: string | null;
  external: boolean;
  records: R[];
};

export function recordGroup(r: { meta: Record<string, unknown> }): DownloadGroup | null {
  const g = r.meta.group as Partial<DownloadGroup> | undefined;
  return g && typeof g.id === 'string' && typeof g.title === 'string' ? { id: g.id, title: g.title } : null;
}

// A failure shows first (it needs a tap); otherwise what is happening now.
const ORDER: Status[] = ['failed', 'running', 'processing', 'queued', 'paused', 'done', 'cancelled'];

export function summarize<R extends GroupableRecord>(id: string, title: string, records: R[]): DownloadEntry<R> {
  const status = ORDER.find((s) => records.some((r) => r.status === s)) ?? 'done';
  return {
    id,
    title,
    status,
    bytesWritten: records.reduce((sum, r) => sum + r.bytesWritten, 0),
    totalBytes: records.reduce((sum, r) => sum + r.totalBytes, 0),
    speed: records.reduce((sum, r) => sum + (r.status === 'running' ? (r.speed ?? 0) : 0), 0),
    error: records.find((r) => r.status === 'failed')?.error ?? null,
    external: records.every((r) => !!r.external),
    records,
  };
}

/** Records as rows, oldest first; a group sits where its first file was queued. */
export function groupDownloads<R extends GroupableRecord>(records: R[]): DownloadEntry<R>[] {
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const groups = new Map<string, { title: string; records: R[] }>();
  const order: (R | string)[] = [];
  for (const r of sorted) {
    const g = recordGroup(r);
    if (!g) {
      order.push(r);
      continue;
    }
    const known = groups.get(g.id);
    if (known) known.records.push(r);
    else {
      groups.set(g.id, { title: g.title, records: [r] });
      order.push(g.id);
    }
  }
  return order.map((x) => {
    if (typeof x !== 'string') return summarize(x.id, x.title, [x]);
    const g = groups.get(x)!;
    return summarize(x, g.title, g.records);
  });
}
