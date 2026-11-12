// Firestore, as the alerts server keeps it (docs/ALERTS_PLAN.md, phase 2 design):
//   state/{source}  the last answer of each source (alerts gzipped JSON, Last-Modified, AEMET bundle URL, hash)
//   state/poll      the last poll: when, how late, what changed, how many pushes (for /health)
//   regs/{sha256(token)}  one phone: platform, token, env, 0.1° cell, country, language, time zone, thresholds,
//                   and what was already pushed to it (`notified`)
// Only these functions touch it (the rules deny every client).
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import type { Registration } from './match.ts';
import type { PolledSource, SourceState } from './sources.ts';

export const db = (): Firestore => getFirestore();

export const regId = (token: string): string => createHash('sha256').update(token).digest('hex');

export type StoredReg = Registration & { createdAt: number; updatedAt: number };

export async function loadSource(source: PolledSource): Promise<SourceState | undefined> {
  const d = (await db().doc(`state/${source}`).get()).data();
  if (!d) return undefined;
  const alerts = d.alertsGz ? JSON.parse(gunzipSync(Buffer.from(d.alertsGz)).toString('utf8')) : [];
  return { fetchedAt: d.fetchedAt, alerts, lastModified: d.lastModified, bundleUrl: d.bundleUrl, hash: d.hash ?? '', error: d.error };
}

export async function saveSource(source: PolledSource, s: SourceState): Promise<void> {
  const alertsGz = gzipSync(JSON.stringify(s.alerts));
  await db()
    .doc(`state/${source}`)
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

export async function noteSourceError(source: PolledSource, at: number, error: string): Promise<void> {
  await db().doc(`state/${source}`).set({ errorAt: at, error }, { merge: true });
}

export async function allRegs(): Promise<{ id: string; reg: StoredReg }[]> {
  const snap = await db().collection('regs').get();
  return snap.docs.map((d) => ({ id: d.id, reg: d.data() as StoredReg }));
}

export const putReg = (id: string, reg: StoredReg) => db().doc(`regs/${id}`).set(reg);
export const getReg = async (id: string) => (await db().doc(`regs/${id}`).get()).data() as StoredReg | undefined;
export const deleteReg = (id: string) => db().doc(`regs/${id}`).delete();
export const updateNotified = (id: string, notified: Registration['notified']) => db().doc(`regs/${id}`).update({ notified });
