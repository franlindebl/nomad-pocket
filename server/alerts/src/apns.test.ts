import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';

import { isDeadToken, providerToken } from './apns.ts';

test('provider token is an ES256 JWT Apple can verify, reused within 50 minutes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const key = { keyId: 'KEYID12345', teamId: 'TEAMID1234', key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const t0 = 1_800_000_000_000;
  const jwt = providerToken(key, t0);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KEYID12345' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), { iss: 'TEAMID1234', iat: t0 / 1000 });
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64);
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
  assert.equal(providerToken(key, t0 + 49 * 60_000), jwt);
  assert.notEqual(providerToken(key, t0 + 51 * 60_000), jwt);
});

test('only 410 and BadDeviceToken kill a registration', () => {
  assert.ok(isDeadToken({ status: 410, reason: 'Unregistered' }));
  assert.ok(isDeadToken({ status: 400, reason: 'BadDeviceToken' }));
  assert.ok(!isDeadToken({ status: 400, reason: 'DeviceTokenNotForTopic' }));
  assert.ok(!isDeadToken({ status: 429, reason: 'TooManyRequests' }));
});
