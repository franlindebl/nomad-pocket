// Apple Push Notification service over HTTP/2 with a token (.p8) key (docs/ALERTS_PLAN.md, phase 2). Node's own
// http2 and crypto do it all: no APNs library to keep up to date. Apple wants the provider JWT reused for 20–60
// minutes (refreshing it more often gets TooManyProviderTokenUpdates), so it is cached per key for 50.
import { createPrivateKey, sign } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';

export type ApnsKey = { keyId: string; teamId: string; key: string };
export type ApnsEnv = 'sandbox' | 'production';

export type ApnsPush = {
  token: string;
  env: ApnsEnv;
  topic: string;
  payload: Record<string, unknown>;
  /** 'alert' for anything the person sees; 'background' only with content-available and no alert. */
  pushType?: 'alert' | 'background';
  /** 10 = now (alerts), 5 = when convenient. */
  priority?: 10 | 5;
  /** Seconds since the epoch after which APNs drops it instead of storing it for an offline phone. */
  expiration?: number;
  collapseId?: string;
};

export type ApnsResult = { status: number; apnsId?: string; reason?: string };

const HOSTS: Record<ApnsEnv, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

const JWT_TTL_MS = 50 * 60 * 1000;
let cached: { keyId: string; jwt: string; at: number } | null = null;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function providerToken(k: ApnsKey, now = Date.now()): string {
  if (cached && cached.keyId === k.keyId && now - cached.at < JWT_TTL_MS) return cached.jwt;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: k.keyId }));
  const claims = b64url(JSON.stringify({ iss: k.teamId, iat: Math.floor(now / 1000) }));
  // JWS wants the raw r||s signature, not DER.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey(k.key), dsaEncoding: 'ieee-p1363' });
  const jwt = `${header}.${claims}.${b64url(signature)}`;
  cached = { keyId: k.keyId, jwt, at: now };
  return jwt;
}

function request(session: ClientHttp2Session, key: ApnsKey, p: ApnsPush): Promise<ApnsResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${p.token}`,
      authorization: `bearer ${providerToken(key)}`,
      'apns-topic': p.topic,
      'apns-push-type': p.pushType ?? 'alert',
      'apns-priority': String(p.priority ?? 10),
      'content-type': 'application/json',
    };
    if (p.expiration != null) headers['apns-expiration'] = String(p.expiration);
    if (p.collapseId) headers['apns-collapse-id'] = p.collapseId;
    const req = session.request(headers);
    let status = 0;
    let apnsId: string | undefined;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (h) => {
      status = Number(h[constants.HTTP2_HEADER_STATUS]);
      apnsId = typeof h['apns-id'] === 'string' ? h['apns-id'] : undefined;
    });
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      let reason: string | undefined;
      if (body) {
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason;
        } catch {
          reason = body.slice(0, 200);
        }
      }
      resolve({ status, apnsId, reason });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
    req.end(JSON.stringify(p.payload));
  });
}

/** Sends pushes that share an environment over one HTTP/2 connection. */
export async function sendApns(key: ApnsKey, pushes: ApnsPush[]): Promise<ApnsResult[]> {
  const byEnv = new Map<ApnsEnv, ApnsPush[]>();
  for (const p of pushes) byEnv.set(p.env, [...(byEnv.get(p.env) ?? []), p]);
  const results = new Map<ApnsPush, ApnsResult>();
  for (const [env, list] of byEnv) {
    const session = connect(HOSTS[env]);
    session.on('error', () => {});
    try {
      const out = await Promise.all(list.map((p) => request(session, key, p).catch((e: Error) => ({ status: 0, reason: e.message }))));
      list.forEach((p, i) => results.set(p, out[i]));
    } finally {
      session.close();
    }
  }
  return pushes.map((p) => results.get(p)!);
}

/** The token is dead for good: forget the registration. */
export const isDeadToken = (r: ApnsResult) => r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken');
