// One poll (every minute, docs/ALERTS_PLAN.md phase 2): each source fetched (conditionally), and when any of them
// really changed, every registration is matched against the current alerts and pushed what is new for it. The last
// answer of each source lives in Firestore so a cold instance starts from it; a warm one keeps it in memory.
import { logger } from 'firebase-functions';

import type { ApnsKey } from './apns.ts';
import type { Alert } from './core.ts';
import { plan } from './match.ts';
import { deliver, type Outgoing } from './push.ts';
import { FETCHERS, type PolledSource, type SourceState } from './sources.ts';
import { allRegs, db, deleteReg, loadSource, noteSourceError, saveSource, updateNotified } from './store.ts';

const SOURCES = Object.keys(FETCHERS) as PolledSource[];
const FORGET_AFTER_MS = 90 * 24 * 3600_000;
const memory = new Map<PolledSource, SourceState>();
let running = false;

async function stateOf(source: PolledSource): Promise<SourceState | undefined> {
  if (!memory.has(source)) {
    const s = await loadSource(source).catch(() => undefined);
    if (s) memory.set(source, s);
  }
  return memory.get(source);
}

/** Every source's current alerts (from memory or Firestore). */
export async function currentAlerts(): Promise<Alert[]> {
  const all: Alert[] = [];
  for (const s of SOURCES) all.push(...((await stateOf(s))?.alerts ?? []));
  return all;
}

export type PollResult = { changed: PolledSource[]; failed: PolledSource[]; regs: number; pushes: number; sent: number; dead: number };

export async function poll(now: number, apnsKey: ApnsKey | null): Promise<PollResult | null> {
  if (running) return null;
  running = true;
  try {
    const changed: PolledSource[] = [];
    const failed: PolledSource[] = [];
    await Promise.all(
      SOURCES.map(async (source) => {
        const prev = await stateOf(source);
        try {
          const next = await FETCHERS[source](prev, now);
          if (!next) return;
          memory.set(source, next);
          if (next.hash !== prev?.hash || prev?.error) {
            changed.push(source);
            await saveSource(source, next);
          }
        } catch (e) {
          failed.push(source);
          logger.warn('source failed', { source, error: String(e) });
          await noteSourceError(source, now, String(e)).catch(() => {});
        }
      }),
    );
    const result: PollResult = { changed, failed, regs: 0, pushes: 0, sent: 0, dead: 0 };
    if (changed.length) Object.assign(result, await notifyAll(now, apnsKey));
    return result;
  } finally {
    running = false;
  }
}

/** Matches every registration against the current alerts, pushes what's new, saves the records, drops dead tokens. */
export async function notifyAll(now: number, apnsKey: ApnsKey | null) {
  const all = await currentAlerts();
  const regs = await allRegs();
  const out: Outgoing[] = [];
  const records = new Map<string, Alert['id'][]>();
  const updates: Promise<unknown>[] = [];
  const expired: string[] = [];
  for (const { id, reg } of regs) {
    // A phone that hasn't refreshed its row for 90 days (it does every few days while alerts are on) is forgotten.
    if (now - (reg.updatedAt ?? 0) > FORGET_AFTER_MS) {
      expired.push(id);
      continue;
    }
    const { pushes, notified } = plan(all, reg, now);
    if (JSON.stringify(notified) !== JSON.stringify(reg.notified ?? {})) updates.push(updateNotified(id, notified));
    for (const push of pushes) out.push({ id, reg, push });
    if (pushes.length) records.set(id, pushes.map((p) => p.key ?? 'more'));
  }
  await Promise.all(updates);
  const { sent, dead } = out.length ? await deliver(out, apnsKey, now) : { sent: 0, dead: new Set<string>() };
  await Promise.all([...dead, ...expired].map((id) => deleteReg(id)));
  if (out.length) logger.info('pushed', { pushes: out.length, sent, dead: dead.size, alerts: [...new Set([...records.values()].flat())] });
  return { regs: regs.length, pushes: out.length, sent, dead: dead.size };
}

export async function notePoll(at: number, scheduled: number, ms: number, r: PollResult | null) {
  await db()
    .doc('state/poll')
    .set({ at, lagMs: at - scheduled, ms, skipped: r === null, ...(r ?? {}) }, { merge: false });
}
