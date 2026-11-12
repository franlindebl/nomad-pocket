// Delivering pushes: APNs for iPhones (apns.ts, HTTP/2 + JWT) and FCM for Android phones that registered through
// modules/nomad-push (data-only, priority high, shown by the app's own receiver). Returns the registrations whose
// token is dead for good, to delete.
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

import { isDeadToken, sendApns, type ApnsKey, type ApnsPush } from './apns.ts';
import type { Push, Registration } from './match.ts';

export const BUNDLE_ID = 'com.fjlinde.nomadpocket';
const KIND = 'official-alert';

export type Outgoing = { id: string; reg: Pick<Registration, 'platform' | 'token' | 'env'>; push: Push };

/** apns-collapse-id may be 64 bytes at most. */
const collapse = (s: string) => (Buffer.byteLength(s) <= 64 ? s : s.slice(0, 40) + '#' + Buffer.from(s).toString('base64url').slice(-20));

export function apnsOf(o: Outgoing, now: number): ApnsPush {
  return {
    token: o.reg.token,
    env: o.reg.env ?? 'production',
    topic: BUNDLE_ID,
    collapseId: collapse(o.push.collapseId),
    expiration: Math.floor(o.push.expires / 1000),
    payload: {
      aps: {
        alert: { title: o.push.title, body: o.push.body },
        sound: 'default',
        'interruption-level': o.push.timeSensitive ? 'time-sensitive' : 'active',
        'thread-id': KIND,
      },
      // expo-notifications reads a remote push's `data` from `body`.
      body: { kind: KIND, ...(o.push.key ? { key: o.push.key } : {}), sentAt: now },
    },
  };
}

export function fcmOf(o: Outgoing, now: number): Message {
  return {
    token: o.reg.token,
    data: { kind: KIND, title: o.push.title, body: o.push.body, key: o.push.key ?? '', collapse: o.push.collapseId, sentAt: String(now) },
    android: { priority: 'high', ttl: Math.max(60_000, o.push.expires - now) },
  };
}

export async function deliver(
  out: Outgoing[],
  key: ApnsKey | null,
  now: number,
): Promise<{ sent: number; failed: number; dead: Set<string>; errors: string[] }> {
  const dead = new Set<string>();
  const errors: string[] = [];
  let sent = 0;
  let failed = 0;
  const ios = out.filter((o) => o.reg.platform === 'ios');
  const android = out.filter((o) => o.reg.platform === 'android');
  if (ios.length && key) {
    const results = await sendApns(key, ios.map((o) => apnsOf(o, now)));
    results.forEach((r, i) => {
      if (r.status === 200) sent++;
      else {
        failed++;
        if (isDeadToken(r)) dead.add(ios[i].id);
        logger.warn('apns', { status: r.status, reason: r.reason });
        errors.push(`apns ${r.status}: ${r.reason ?? ''}`);
      }
    });
  }
  for (let i = 0; i < android.length; i += 500) {
    const batch = android.slice(i, i + 500);
    const res = await getMessaging().sendEach(batch.map((o) => fcmOf(o, now)));
    res.responses.forEach((r, j) => {
      if (r.success) sent++;
      else {
        failed++;
        const code = r.error?.code ?? '';
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.add(batch[j].id);
        logger.warn('fcm', { code, message: r.error?.message });
        errors.push(`${code}: ${r.error?.message ?? ''}`);
      }
    });
  }
  return { sent, failed, dead, errors };
}
