// One poll (every minute, docs/ALERTS_PLAN.md phase 2): the registrations refreshed (only the rows changed since the
// last poll), each source fetched (conditionally; NWS only while a US phone is registered, each MeteoAlarm country
// only while a phone there is, every few minutes), and when any of them really changed, every registration is
// matched against the current alerts and pushed what is new for it. The last answer of each source lives in
// Firestore so a cold instance starts from it; a warm one keeps it in memory.
import { logger } from 'firebase-functions';

import type { ApnsKey } from './apns.ts';
import type { Alert } from './core.ts';
import { matching, plan } from './match.ts';
import { deliver, type Outgoing } from './push.ts';
import { ALWAYS, fetcherOf, hasDetails, keysFor, METEOALARM_EVERY_MS, withDetails, type SourceState } from './sources.ts';
import { db, deleteReg, loadSource, noteSourceError, RegCache, saveSource, updateNotified, type StoredReg } from './store.ts';

const FORGET_AFTER_MS = 90 * 24 * 3600_000;
/** MeteoAlarm warnings given their CAP's texts and issuer per poll, at most (the rest on the next ones). */
const DETAILS_PER_POLL = 30;

const memory = new Map<string, SourceState>();
const regs = new RegCache();
let running = false;

async function stateOf(key: string): Promise<SourceState | undefined> {
  if (!memory.has(key)) {
    const s = await loadSource(key).catch(() => undefined);
    if (s) memory.set(key, s);
  }
  return memory.get(key);
}

/** The state keys the registered phones need this minute (always the global sources). */
function keysDue(now: number): string[] {
  const keys = new Set<string>(ALWAYS);
  for (const [, r] of regs.entries()) for (const k of keysFor(r.country)) keys.add(k);
  return [...keys].filter((k) => {
    if (!k.startsWith('meteoalarm-')) return true;
    const prev = memory.get(k);
    // A few seconds' slack so a poll that starts a little early doesn't skip a round.
    return !prev || prev.error || now - prev.fetchedAt >= METEOALARM_EVERY_MS - 10_000;
  });
}

export type PollResult = { changed: string[]; failed: string[]; regs: number; read: number; pushes: number; sent: number; dead: number };

export async function poll(now: number, apnsKey: ApnsKey | null): Promise<PollResult | null> {
  if (running) return null;
  running = true;
  try {
    const { read } = await regs.sync(now);
    const changed: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      keysDue(now).map(async (key) => {
        const fetcher = fetcherOf(key);
        if (!fetcher) return;
        const prev = await stateOf(key);
        try {
          const next = await fetcher(prev, now);
          if (!next) return;
          memory.set(key, next);
          if (next.hash !== prev?.hash || prev?.error) {
            changed.push(key);
            await saveSource(key, next);
          }
        } catch (e) {
          failed.push(key);
          if (prev) memory.set(key, { ...prev, error: String(e) });
          logger.warn('source failed', { source: key, error: String(e) });
          await noteSourceError(key, now, String(e)).catch(() => {});
        }
      }),
    );
    const result: PollResult = { changed, failed, regs: regs.size, read, pushes: 0, sent: 0, dead: 0 };
    if (changed.length) Object.assign(result, await notify(now, apnsKey, [...memory.values()].flatMap((s) => s.alerts), regs));
    return result;
  } finally {
    running = false;
  }
}

/** Every source's current alerts, read from Firestore (for a caller on another instance than the poll's). */
export async function storedAlerts(keys: string[]): Promise<Alert[]> {
  const states = await Promise.all(keys.map((k) => loadSource(k).catch(() => undefined)));
  return states.flatMap((s) => s?.alerts ?? []);
}

/** The owner's run-notify, from the API instance: everything read fresh from Firestore, then the same as a poll. */
export async function notifyAllNow(now: number, apnsKey: ApnsKey | null) {
  const fresh = new RegCache();
  const { read } = await fresh.sync(now, true);
  const keys = new Set<string>(ALWAYS);
  for (const [, r] of fresh.entries()) for (const k of keysFor(r.country)) keys.add(k);
  return { read, ...(await notify(now, apnsKey, await storedAlerts([...keys]), fresh)) };
}

/** MeteoAlarm warnings that cover someone, given their CAP's texts and issuer (the push names the issuing service). */
async function detailed(all: Alert[], entries: [string, StoredReg][], now: number): Promise<Alert[]> {
  const wanted = new Set<string>();
  for (const [, reg] of entries) {
    for (const a of matching(all, reg, now)) if (a.source === 'meteoalarm') wanted.add(a.id);
  }
  if (!wanted.size) return all;
  const ids = new Set([...wanted].filter(hasDetails));
  for (const id of [...wanted].filter((i) => !hasDetails(i)).slice(0, DETAILS_PER_POLL)) ids.add(id);
  return Promise.all(all.map((a) => (a.source === 'meteoalarm' && ids.has(a.id) ? withDetails(a) : a)));
}

/** Matches every registration against `alerts`, pushes what's new, saves the records, drops dead and stale rows. */
async function notify(now: number, apnsKey: ApnsKey | null, alerts: Alert[], cache: RegCache) {
  const entries = cache.entries();
  const all = await detailed(alerts, entries, now);
  const out: Outgoing[] = [];
  const records = new Map<string, string[]>();
  const updates: Promise<unknown>[] = [];
  const expired: string[] = [];
  for (const [id, reg] of entries) {
    // A phone that hasn't refreshed its row for 90 days (it does every few days while alerts are on) is forgotten.
    if (now - (reg.updatedAt ?? 0) > FORGET_AFTER_MS) {
      expired.push(id);
      continue;
    }
    const { pushes, notified } = plan(all, reg, now);
    if (JSON.stringify(notified) !== JSON.stringify(reg.notified ?? {})) {
      cache.setNotified(id, notified);
      updates.push(updateNotified(id, notified).catch((e) => logger.warn('notified', { error: String(e) })));
    }
    for (const push of pushes) out.push({ id, reg, push });
    if (pushes.length) records.set(id, pushes.map((p) => p.key ?? 'more'));
  }
  await Promise.all(updates);
  const { sent, dead } = out.length ? await deliver(out, apnsKey, now) : { sent: 0, dead: new Set<string>() };
  for (const id of [...dead, ...expired]) cache.drop(id);
  await Promise.all([...dead, ...expired].map((id) => deleteReg(id)));
  if (out.length) logger.info('pushed', { pushes: out.length, sent, dead: dead.size, alerts: [...new Set([...records.values()].flat())] });
  return { regs: entries.length, pushes: out.length, sent, dead: dead.size };
}

/** state/poll: the last poll and a one-line summary of each source (all /health reads). */
export async function notePoll(at: number, scheduled: number, ms: number, r: PollResult | null) {
  const sources = Object.fromEntries(
    [...memory].map(([k, s]) => [k, { fetchedAt: s.fetchedAt, count: s.alerts.length, ...(s.error ? { error: s.error.slice(0, 200) } : {}) }]),
  );
  await db()
    .doc('state/poll')
    .set({ at, lagMs: at - scheduled, ms, skipped: r === null, ...(r ?? {}), sources }, { merge: false });
}
