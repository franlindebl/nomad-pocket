// Nomad Pocket official alerts server (docs/ALERTS_PLAN.md, phase 2), on Cloud Functions for Firebase:
// - `poll` every minute: AEMET, USGS, EMSC and GDACS fetched conditionally; when one really changes, every registered
//   phone is matched against the current alerts (the app's own cores) and pushed what is new for it, over APNs or FCM.
// - `api`: registration, health and the owner's test push (api.ts).
import { initializeApp } from 'firebase-admin/app';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/https';
import { setGlobalOptions } from 'firebase-functions/options';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/scheduler';

import { handle } from './api.ts';
import type { ApnsKey } from './apns.ts';
import { notePoll, poll as runPoll } from './poll.ts';

// Same region as the Firestore database. One instance at most: a runaway loop can't fan out (and cost), and the
// in-memory rate limit and source cache are real.
setGlobalOptions({ region: 'europe-west1', maxInstances: 1, memory: '512MiB' });
initializeApp();

/** JSON {keyId, teamId, key}: the APNs .p8 key with its ids (never in the repo). */
const APNS = defineSecret('APNS');
/** Bearer secret for the owner's test push. */
const TEST_PUSH_SECRET = defineSecret('TEST_PUSH_SECRET');

const apnsKey = (): ApnsKey => JSON.parse(APNS.value()) as ApnsKey;

export const poll = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Etc/UTC', retryCount: 0, timeoutSeconds: 120, secrets: [APNS] },
  async (event) => {
    const started = Date.now();
    const result = await runPoll(started, apnsKey());
    await notePoll(started, Date.parse(event.scheduleTime), Date.now() - started, result);
    if (result?.changed.length || result?.failed.length) logger.info('poll', result);
  },
);

export const api = onRequest({ secrets: [APNS, TEST_PUSH_SECRET], cors: false, invoker: 'public' }, async (req, res) => {
  try {
    const r = await handle(req, { testPush: TEST_PUSH_SECRET.value(), apns: apnsKey });
    res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('api', { path: req.path, error: String(e) });
    res.status(500).json({ error: 'internal' });
  }
});
