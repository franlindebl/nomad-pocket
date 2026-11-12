// The alerts server's HTTP API (docs/ALERTS_PLAN.md, phase 2 design):
//   POST   /v1/register   a phone with alerts on: its push token, 0.1° cell, country, language, time zone, thresholds;
//                         answers the sources the server pushes to it
//   DELETE /v1/register   alerts off (body {token}): the row is deleted
//   POST   /v1/alerts     body {token}: the current MeteoAlarm warnings for that phone's cell (the phone has no
//                         region shapes, so its list and the warning a push opens come from here)
//   GET    /health        last poll and each source's summary (for a monitor and the phones)
//   POST   /v1/test-push  owner only (Bearer secret): one push to a token
//   POST   /v1/run-notify owner only: match every registration now
// Nothing public can send a push to anyone. Bodies are small and checked; tokens are never echoed back.
import { timingSafeEqual } from 'node:crypto';

import type { Request } from 'firebase-functions/https';

import type { ApnsKey } from './apns.ts';
import { sendApns } from './apns.ts';
import { lang2, type Level } from './core.ts';
import { matching, METEOALARM_FEEDS, pushedSources, snapCell, type Registration } from './match.ts';
import { notifyAllNow, storedAlerts } from './poll.ts';
import { BUNDLE_ID, deliver } from './push.ts';
import { withDetails } from './sources.ts';
import { buryReg, db, getReg, putReg, regId } from './store.ts';
import { emmaZonesOf, nwsZonesOf } from './zones.ts';

type Reply = { status: number; body: unknown };
const reply = (status: number, body: unknown): Reply => ({ status, body });

// One instance at most (setGlobalOptions), so an in-memory limit per IP is a real limit. Generous enough for many
// phones behind one carrier NAT: registering happens every few days per phone, the alerts list every check.
const WINDOW_MS = 3600_000;
const LIMITS = { register: 60, alerts: 240 };
const hits = { register: new Map<string, number[]>(), alerts: new Map<string, number[]>() };

function limited(kind: keyof typeof LIMITS, ip: string, now: number): boolean {
  const map = hits[kind];
  const recent = (map.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  map.set(ip, recent);
  if (map.size > 10_000) map.clear();
  return recent.length > LIMITS[kind];
}

/** The cell's zones for the sources that name zones (NWS in the US, MeteoAlarm's EMMA regions in Europe). */
async function zonesOf(cell: Registration['cell'], country: string | null): Promise<string[]> {
  if (country === 'us') return nwsZonesOf(cell);
  if (country && METEOALARM_FEEDS[country]) return emmaZonesOf(cell, country);
  return [];
}

/** /health is asked by every phone every half hour: one Firestore read, shared for a short while. */
const HEALTH_CACHE_MS = 20_000;
let health: { at: number; reply: Reply } | null = null;

/** MeteoAlarm states by country, read at most once a minute per instance for the phones' lists. */
const STATE_CACHE_MS = 60_000;
const states = new Map<string, { at: number; alerts: Promise<import('./core.ts').Alert[]> }>();

function stateAlerts(key: string, now: number) {
  const hit = states.get(key);
  if (hit && now - hit.at < STATE_CACHE_MS) return hit.alerts;
  const alerts = storedAlerts([key]);
  states.set(key, { at: now, alerts });
  alerts.catch(() => states.delete(key));
  return alerts;
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
    if (health && now - health.at < HEALTH_CACHE_MS) return health.reply;
    const poll = (await db().doc('state/poll').get()).data() as { at?: number } | undefined;
    const ok = !!poll?.at && now - poll.at < 5 * 60_000;
    health = { at: now, reply: reply(ok ? 200 : 503, { ok, poll: poll ?? null }) };
    return health.reply;
  }

  if (req.path === '/v1/register' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (limited('register', req.ip ?? 'unknown', now)) return reply(429, { error: 'too many requests' });
    if (req.method === 'DELETE') {
      if (typeof body.token !== 'string' || body.token.length > 4096) return reply(400, { error: 'token' });
      await buryReg(regId(body.token), now);
      return reply(200, { ok: true });
    }
    const parsed = parseRegistration(body);
    if (typeof parsed === 'string') return reply(400, { error: parsed });
    const id = regId(parsed.token);
    const prev = await getReg(id);
    // A new phone, or one that moved: what its own check just showed is recorded without a push (match.ts `plan`),
    // and its cell's zones are worked out again.
    const moved = !prev || prev.cell.lat !== parsed.cell.lat || prev.cell.lon !== parsed.cell.lon || prev.country !== parsed.country;
    const zones = moved || !prev.zones?.length ? await zonesOf(parsed.cell, parsed.country) : prev.zones;
    await putReg(id, {
      ...parsed,
      zones,
      seededAt: moved ? now : (prev.seededAt ?? prev.createdAt),
      notified: prev?.notified ?? {},
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      changedAt: now,
    });
    return reply(200, { ok: true, sources: pushedSources(parsed.country), zones });
  }

  if (req.method === 'POST' && req.path === '/v1/alerts') {
    if (limited('alerts', req.ip ?? 'unknown', now)) return reply(429, { error: 'too many requests' });
    if (typeof body.token !== 'string' || body.token.length > 4096) return reply(400, { error: 'token' });
    const reg = await getReg(regId(body.token));
    if (!reg) return reply(404, { error: 'not registered' });
    if (!reg.country || !METEOALARM_FEEDS[reg.country]) return reply(200, { alerts: [] });
    const mine = matching(await stateAlerts(`meteoalarm-${reg.country}`, now), reg, now).filter((a) => a.source === 'meteoalarm');
    const alerts = await Promise.all(mine.slice(0, 30).map(withDetails));
    return reply(200, { alerts: alerts.map(({ capUrl: _c, ...a }: typeof alerts[number] & { capUrl?: unknown }) => a) });
  }

  // Owner only: match every registration now (end-to-end checks without waiting for a source to change).
  if (req.method === 'POST' && req.path === '/v1/run-notify') {
    if (!authorised(req.get('authorization'), secrets.testPush)) return reply(401, { error: 'unauthorised' });
    return reply(200, await notifyAllNow(now, secrets.apns()));
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

