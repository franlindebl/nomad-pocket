// Firestore, as the alerts server keeps it (docs/ALERTS_PLAN.md, phase 2 design):
//   state/{source}  the last answer of each source (alerts gzipped JSON, Last-Modified, AEMET bundle URL, hash);
//                   MeteoAlarm one per country (`meteoalarm-de`)
//   state/poll      the last poll: when, how late, what changed, how many pushes, each source's summary (for /health)
//   regs/{sha256(token)}  one phone: platform, token, env, 0.1° cell, country, zones, language, time zone,
//                   thresholds, and what was already pushed to it (`notified`). Turning alerts off leaves a tombstone
//                   ({deleted, changedAt}) that the poll removes once it has seen it.
// Only these functions touch it (the rules deny every client).
//
// Reads are what costs here (50 k/day free): the poll keeps every registration in memory and asks Firestore only for
// the rows changed since its last look (`changedAt`, set by the API on every write), so a warm instance reads what
// changed instead of every phone on every source change.
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { Registration } from './match.ts';
import type { SourceState } from './sources.ts';

export const db = (): Firestore => getFirestore();

export const regId = (token: string): string => createHash('sha256').update(token).digest('hex');

export type StoredReg = Registration & {
  createdAt: number;
  /** Last time the phone sent its registration (every few days while alerts are on). */
  updatedAt: number;
  /** Last write by the API: what the poll's incremental read keys on. */
  changedAt: number;
};

type Tombstone = { deleted: true; changedAt: number };

export async function loadSource(key: string): Promise<SourceState | undefined> {
  const d = (await db().doc(`state/${key}`).get()).data();
  if (!d || d.fetchedAt === undefined) return undefined;
  const alerts = d.alertsGz ? JSON.parse(gunzipSync(Buffer.from(d.alertsGz)).toString('utf8')) : [];
  return { fetchedAt: d.fetchedAt, alerts, lastModified: d.lastModified, bundleUrl: d.bundleUrl, hash: d.hash ?? '', error: d.error };
}

export async function saveSource(key: string, s: SourceState): Promise<void> {
  const alertsGz = gzipSync(JSON.stringify(s.alerts));
  await db()
    .doc(`state/${key}`)
    .set({
      fetchedAt: s.fetchedAt,
      hash: s.hash,
      alertsGz,
      lastModified: s.lastModified ?? null,
      bundleUrl: s.bundleUrl ?? null,
      error: s.error ?? null,
      count: s.alerts.length,
    });
}

export async function noteSourceError(key: string, at: number, error: string): Promise<void> {
  await db().doc(`state/${key}`).set({ errorAt: at, error }, { merge: true });
}

export async function getReg(id: string): Promise<StoredReg | undefined> {
  const d = (await db().doc(`regs/${id}`).get()).data() as StoredReg | Tombstone | undefined;
  return d && !('deleted' in d) ? d : undefined;
}

export const putReg = (id: string, reg: StoredReg) => db().doc(`regs/${id}`).set(reg);
/** Alerts off: a tombstone the poll sees on its next incremental read (a plain delete would be invisible to it). */
export const buryReg = (id: string, now: number) => db().doc(`regs/${id}`).set({ deleted: true, changedAt: now } satisfies Tombstone);
export const deleteReg = (id: string) => db().doc(`regs/${id}`).delete();
export const updateNotified = (id: string, notified: Registration['notified']) => db().doc(`regs/${id}`).update({ notified });

/** Rows re-read on each incremental look: covers writes that commit a little after the time they carry. */
const OVERLAP_MS = 2 * 60_000;

/** Every live registration, kept in memory and refreshed with only the rows changed since the last refresh. */
export class RegCache {
  private regs = new Map<string, StoredReg>();
  private seen = -1;

  get size(): number {
    return this.regs.size;
  }

  entries(): [string, StoredReg][] {
    return [...this.regs];
  }

  /** `full`: read every row again (a cold instance, or a caller on another instance whose copy may be stale). */
  async sync(now: number, full = false): Promise<{ read: number }> {
    const col = db().collection('regs');
    const first = full || this.seen < 0;
    const snap = first ? await col.get() : await col.where('changedAt', '>', this.seen - OVERLAP_MS).get();
    if (first) this.regs.clear();
    const buried: Promise<unknown>[] = [];
    for (const d of snap.docs) {
      const data = d.data() as StoredReg | Tombstone;
      if (!('deleted' in data)) {
        this.regs.set(d.id, data);
        continue;
      }
      this.regs.delete(d.id);
      // Seen, so it can go (a cold instance reads the whole table and doesn't need it), unless the phone registered
      // again in the meantime: the precondition keeps a row rewritten since this read.
      buried.push(d.ref.delete({ lastUpdateTime: d.updateTime }).catch(() => {}));
    }
    this.seen = now;
    await Promise.all(buried);
    return { read: snap.size };
  }

  setNotified(id: string, notified: Registration['notified']) {
    const r = this.regs.get(id);
    if (r) this.regs.set(id, { ...r, notified });
  }

  drop(id: string) {
    this.regs.delete(id);
  }
}
