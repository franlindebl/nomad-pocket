// Nomad Pocket official alerts server (docs/ALERTS_PLAN.md, phase 2). For now the spike of task 0 (a): a scheduled
// function every minute that records a heartbeat in Firestore (does Cloud Scheduler really fire every minute, and
// what does it cost), and an owner-only test push to an iPhone over APNs. The poll, registrations and FCM come next.
import { timingSafeEqual } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/options';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/scheduler';

import { sendApns, type ApnsEnv, type ApnsKey } from './apns.js';

// Same region as the Firestore database. One instance at most: a runaway loop can't fan out (and cost).
setGlobalOptions({ region: 'europe-west1', maxInstances: 1, memory: '256MiB' });
initializeApp();

/** JSON {keyId, teamId, key}: the APNs .p8 key with its ids (never in the repo). */
const APNS = defineSecret('APNS');
/** Bearer secret for the owner's test push. */
const TEST_PUSH_SECRET = defineSecret('TEST_PUSH_SECRET');

const BUNDLE_ID = 'com.fjlinde.nomadpocket';

export const heartbeat = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', retryCount: 0 }, async (event) => {
  const now = Date.now();
  const scheduled = Date.parse(event.scheduleTime);
  await getFirestore()
    .doc('state/heartbeat')
    .set({ at: FieldValue.serverTimestamp(), scheduled: event.scheduleTime, lagMs: now - scheduled, runs: FieldValue.increment(1) }, { merge: true });
});

function authorised(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const api = onRequest({ secrets: [APNS, TEST_PUSH_SECRET], cors: false, invoker: 'public' }, async (req, res) => {
  if (req.method === 'GET' && req.path === '/health') {
    const hb = (await getFirestore().doc('state/heartbeat').get()).data();
    res.json({ ok: true, heartbeat: hb ? { at: hb.at?.toDate?.().toISOString(), lagMs: hb.lagMs, runs: hb.runs } : null });
    return;
  }
  if (req.method === 'POST' && req.path === '/v1/test-push') {
    if (!authorised(req.get('authorization'), TEST_PUSH_SECRET.value())) {
      res.status(401).json({ error: 'unauthorised' });
      return;
    }
    const { token, env, title, body, level } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof token !== 'string' || !/^[0-9a-f]{64,200}$/i.test(token) || (env !== 'sandbox' && env !== 'production')) {
      res.status(400).json({ error: 'token (hex) and env (sandbox|production) are required' });
      return;
    }
    const key = JSON.parse(APNS.value()) as ApnsKey;
    const sentAt = Date.now();
    const [result] = await sendApns(key, [
      {
        token,
        env: env as ApnsEnv,
        topic: BUNDLE_ID,
        payload: {
          aps: {
            alert: { title: typeof title === 'string' ? title : 'Nomad Pocket', body: typeof body === 'string' ? body : `Prueba de push ${new Date(sentAt).toISOString()}` },
            sound: 'default',
            'interruption-level': level === 'time-sensitive' ? 'time-sensitive' : 'active',
            'thread-id': 'official-alert-test',
          },
          // expo-notifications reads a remote push's `data` from `body`; the app opens the alerts list on tap.
          body: { kind: 'official-alert', sentAt },
        },
        expiration: Math.floor(sentAt / 1000) + 6 * 3600,
      },
    ]);
    logger.info('test push', { env, status: result.status, reason: result.reason, apnsId: result.apnsId });
    res.status(result.status === 200 ? 200 : 502).json(result);
    return;
  }
  res.status(404).json({ error: 'not found' });
});
