// The alerts server's HTTP API (docs/ALERTS_PLAN.md, phase 2 design):
//   POST   /v1/register   a phone with alerts on: its push token, 0.1° cell, country, language, time zone, thresholds
//   DELETE /v1/register   alerts off (body {token}): the row is deleted
//   GET    /health        last poll and each source's last answer (for a monitor)
//   POST   /v1/test-push  owner only (Bearer secret): one push to a token
// Nothing public can send a push to anyone. Bodies are small and checked; tokens are never echoed back.
import { timingSafeEqual } from 'node:crypto';

import type { Request } from 'firebase-functions/https';

import type { ApnsKey } from './apns.ts';
import { sendApns } from './apns.ts';
import { lang2, type Level } from './core.ts';
import { plan, pushedSources, snapCell, type Registration } from './match.ts';
import { currentAlerts, notifyAll } from './poll.ts';
import { BUNDLE_ID, deliver } from './push.ts';
import { db, deleteReg, getReg, putReg, regId } from './store.ts';

type Reply = { status: number; body: unknown };
const reply = (status: number, body: unknown): Reply => ({ status, body });

// One instance at most (setGlobalOptions), so an in-memory limit per IP is a real limit.
const hits = new Map<string, number[]>();
const LIMIT = 30;
const WINDOW_MS = 3600_000;

function limited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > LIMIT;
}

const LEVELS: Level[] = ['yellow', 'orange', 'red'];

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function authorised(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

function validToken(platform: string, token: unknown): token is string {
  if (typeof token !== 'string') return false;
  return platform === 'ios' ? /^[0-9a-f]{64,200}$/i.test(token) : /^[A-Za-z0-9_:.-]{16,4096}$/.test(token);
}

/** The registration in a request body, or the reason it isn't one. */
export function parseRegistration(b: Record<string, unknown>): Omit<Registration, 'notified'> | string {
  const platform = b.platform;
  if (platform !== 'ios' && platform !== 'android') return 'platform';
  if (!validToken(platform, b.token)) return 'token';
  if (platform === 'ios' && b.env !== 'sandbox' && b.env !== 'production') return 'env';
  const cell = b.cell as { lat?: unknown; lon?: unknown } | undefined;
  if (typeof cell?.lat !== 'number' || typeof cell?.lon !== 'number' || Math.abs(cell.lat) > 90 || Math.abs(cell.lon) > 180) return 'cell';
  const country = b.country === null || b.country === undefined ? null : typeof b.country === 'string' && /^[a-z]{2}$/.test(b.country) ? b.country : undefined;
  if (country === undefined) return 'country';
  const prefs = (b.prefs ?? {}) as { minLevel?: unknown; quakes?: unknown };
  const minLevel = LEVELS.includes(prefs.minLevel as Level) ? (prefs.minLevel as Level) : 'orange';
  return {
    platform,
    token: b.token as string,
    ...(platform === 'ios' ? { env: b.env as 'sandbox' | 'production' } : {}),
    cell: snapCell({ lat: cell.lat, lon: cell.lon }),
    country,
    lang: typeof b.lang === 'string' ? lang2(b.lang) : 'en',
    ...(validTimeZone(b.timeZone) ? { timeZone: b.timeZone } : {}),
    prefs: { minLevel, quakes: prefs.quakes !== false },
  };
}

export async function handle(req: Request, secrets: { testPush: string; apns: () => ApnsKey }): Promise<Reply> {
  const now = Date.now();
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  if (req.method === 'GET' && req.path === '/health') {
    const docs = await db().collection('state').get();
    const state = Object.fromEntries(
      docs.docs.map((d) => {
        const { alertsGz: _gz, ...rest } = d.data();
        return [d.id, rest];
      }),
    );
    const poll = state.poll as { at?: number } | undefined;
    const ok = !!poll?.at && now - poll.at < 5 * 60_000;
    return reply(ok ? 200 : 503, { ok, state });
  }

  if (req.path === '/v1/register' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (limited(req.ip ?? 'unknown', now)) return reply(429, { error: 'too many requests' });
    if (req.method === 'DELETE') {
      if (typeof body.token !== 'string' || body.token.length > 4096) return reply(400, { error: 'token' });
      await deleteReg(regId(body.token));
      return reply(200, { ok: true });
    }
    const parsed = parseRegistration(body);
    if (typeof parsed === 'string') return reply(400, { error: parsed });
    const id = regId(parsed.token);
    const prev = await getReg(id);
    const base: Registration = { ...parsed, notified: prev?.notified ?? {} };
    // A new phone, or one that moved: what covers its cell now is recorded without a push (its own check just showed it).
    const moved = !prev || prev.cell.lat !== parsed.cell.lat || prev.cell.lon !== parsed.cell.lon || prev.country !== parsed.country;
    const notified = moved ? plan(await currentAlerts(), base, now, true).notified : base.notified;
    await putReg(id, { ...base, notified, createdAt: (prev as { createdAt?: number } | undefined)?.createdAt ?? now, updatedAt: now });
    return reply(200, { ok: true, sources: pushedSources(parsed.country) });
  }

  // Owner only: match every registration now (end-to-end checks without waiting for a source to change).
  if (req.method === 'POST' && req.path === '/v1/run-notify') {
    if (!authorised(req.get('authorization'), secrets.testPush)) return reply(401, { error: 'unauthorised' });
    return reply(200, await notifyAll(now, secrets.apns()));
  }

  if (req.method === 'POST' && req.path === '/v1/test-push') {
    if (!authorised(req.get('authorization'), secrets.testPush)) return reply(401, { error: 'unauthorised' });
    const platform = body.platform === 'android' ? 'android' : 'ios';
    if (!validToken(platform, body.token)) return reply(400, { error: 'token' });
    const title = typeof body.title === 'string' ? body.title : 'Nomad Pocket';
    const text = typeof body.body === 'string' ? body.body : `Prueba ${new Date(now).toISOString()}`;
    const push = { title, body: text, collapseId: 'test', timeSensitive: body.level === 'time-sensitive', expires: now + 6 * 3600_000 };
    if (platform === 'ios') {
      const env = body.env === 'sandbox' ? 'sandbox' : 'production';
      const [r] = await sendApns(secrets.apns(), [
        {
          token: body.token as string,
          env,
          topic: BUNDLE_ID,
          payload: { aps: { alert: { title, body: text }, sound: 'default' }, body: { kind: 'official-alert', sentAt: now } },
        },
      ]);
      return reply(r.status === 200 ? 200 : 502, r);
    }
    const r = await deliver([{ id: 'test', reg: { platform, token: body.token as string }, push }], null, now);
    return reply(r.sent ? 200 : 502, { sent: r.sent, dead: r.dead.size > 0, errors: r.errors });
  }

  return reply(404, { error: 'not found' });
}

