#!/usr/bin/env node
// Sends one FCM HTTP v1 data message to an Android registration token (docs/ALERTS_PLAN.md, "Android: FCM over
// IPC", spike). Data-only with priority HIGH, like the alerts server will: the app's own receiver
// (modules/nomad-push) shows it, so it looks the same whether the app is open, in the background or swiped away.
//
//   FCM_SERVICE_ACCOUNT=~/.nomad-pocket/secrets/fcm-service-account.json \
//     node scripts/alerts/fcm-send.mjs <token|@file> [title] [body]
//
// The service account key never goes in the repo. OAuth2 by hand (JWT RS256 with node:crypto): no Google library.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const [tokenArg, title = 'Nomad Pocket · prueba', body] = process.argv.slice(2);
if (!tokenArg) {
  console.error('usage: fcm-send.mjs <token|@file> [title] [body]');
  process.exit(2);
}
const token = (tokenArg.startsWith('@') ? readFileSync(tokenArg.slice(1).replace(/^~/, homedir()), 'utf8') : tokenArg).trim();
const saPath = (process.env.FCM_SERVICE_ACCOUNT ?? '~/.nomad-pocket/secrets/fcm-service-account.json').replace(/^~/, homedir());
const sa = JSON.parse(readFileSync(saPath, 'utf8'));

const b64url = (s) => Buffer.from(s).toString('base64url');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri, iat: now, exp: now + 3600 }),
  );
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key).toString('base64url');
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const sentAt = Date.now();
const message = {
  token,
  data: {
    kind: 'official-alert',
    title,
    body: body ?? `Push FCM sin Firebase en la APK · ${new Date(sentAt).toISOString()}`,
    sentAt: String(sentAt),
  },
  android: { priority: 'HIGH', ttl: '3600s' },
};
const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
  method: 'POST',
  headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
  body: JSON.stringify({ message }),
});
const text = await res.text();
console.log(`HTTP ${res.status} in ${Date.now() - sentAt} ms`, text.trim());
process.exit(res.ok ? 0 : 1);
