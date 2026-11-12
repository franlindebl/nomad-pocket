// This phone's registration with the Nomad Pocket alerts server (docs/ALERTS_PLAN.md, phase 2). With alerts on, the
// phone sends the server its push token, the 0.1° cell it is in (never its position), its country, language, time
// zone and thresholds; the server pushes new warnings at once. iPhone: the APNs token from expo-notifications.
// Android: an FCM token from the phone's own Play services through modules/nomad-push (our code only; phones without
// Play services keep the background check). The body is sent again when it changes and every few days; turning
// alerts off deletes the row. While the registration is fresh and the server's /health is ok, the phone doesn't
// notify the sources the server pushes (check.ts), so nothing rings twice; if either fails, it notifies them itself.
import * as Application from 'expo-application';
import { getDevicePushTokenAsync, getPermissionsAsync } from 'expo-notifications';
import { Platform } from 'react-native';

import i18n from '@/i18n';

import NomadPush from '../../../modules/nomad-push';
import { cellOf, lang2, type Place, type SourceId } from './alerts-core';
import { savePush, useAlertsState, type PushReg } from './state';

export const ALERTS_API = process.env.EXPO_PUBLIC_ALERTS_API?.replace(/\/$/, '') ?? 'https://europe-west1-nomad-pocket.cloudfunctions.net/api';

/** The Firebase client config for Android (public by design; set at build time, docs/RELEASE.md). */
const FCM = {
  projectId: process.env.EXPO_PUBLIC_FCM_PROJECT_ID ?? '',
  projectNumber: process.env.EXPO_PUBLIC_FCM_PROJECT_NUMBER ?? '',
  appId: process.env.EXPO_PUBLIC_FCM_APP_ID ?? '',
  apiKey: process.env.EXPO_PUBLIC_FCM_API_KEY ?? '',
};

const HOUR = 3600_000;
/** Sent again at least this often, so a token Play services or APNs rotated quietly gets refreshed. */
const REFRESH_MS = 3 * 24 * HOUR;
/** A registration older than this isn't trusted to be alive (the server drops unrefreshed rows). */
const STALE_MS = 10 * 24 * HOUR;
/** /health is asked at most this often; an ok answer counts for HEALTHY_MS. */
const HEALTH_EVERY_MS = 30 * 60_000;
const HEALTHY_MS = 2 * HOUR;
const TIMEOUT_MS = 15_000;

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${ALERTS_API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

type Token = { platform: 'ios' | 'android'; token: string; env?: 'sandbox' | 'production' };

async function iosToken(): Promise<Token | null> {
  const t = await getDevicePushTokenAsync();
  // Development-signed builds talk to APNs' sandbox; TestFlight and the App Store to production.
  const env = (await Application.getIosPushNotificationServiceEnvironmentAsync().catch(() => null)) === 'development' ? 'sandbox' : 'production';
  return typeof t.data === 'string' ? { platform: 'ios', token: t.data, env } : null;
}

async function androidToken(prev: PushReg | null, refresh: boolean): Promise<Token | null> {
  if (!NomadPush || NomadPush.playServicesVersion() === null || !FCM.apiKey) return null;
  // Asking Play services costs a second or two: reuse the token until the periodic refresh.
  if (prev?.platform === 'android' && !refresh) return { platform: 'android', token: prev.token };
  const r = await NomadPush.register(FCM.projectId, FCM.projectNumber, FCM.appId, FCM.apiKey);
  return { platform: 'android', token: r.token };
}

/** Whether the server is pushing to this phone right now: a fresh registration and a healthy server. */
export function pushActive(now = Date.now()): boolean {
  const p = useAlertsState.getState().push;
  return !!p && now - p.at < STALE_MS && !!p.healthyAt && now - p.healthyAt < HEALTHY_MS;
}

/** Whether push carries `source` for this phone right now (fresh registration, server healthy). */
export function pushCovers(source: SourceId, now = Date.now()): boolean {
  return pushActive(now) && !!useAlertsState.getState().push?.sources.includes(source);
}

/** Asks the server's /health (at most every 30 min) and records an ok answer. Offline: nothing changes. */
export async function refreshPushHealth(now = Date.now()): Promise<void> {
  const p = useAlertsState.getState().push;
  if (!p || (p.healthyAt && now - p.healthyAt < HEALTH_EVERY_MS)) return;
  try {
    const res = await call('GET', '/health');
    if (res.ok) savePush({ ...p, healthyAt: now });
  } catch {
    // Offline or the server is down: the phone notifies by itself once HEALTHY_MS passes.
  }
}

let syncing: Promise<void> | null = null;

/**
 * Registers (or refreshes) this phone with the server for `place`. Cheap when nothing changed. Needs alerts on,
 * notifications allowed and a position (the cell); otherwise a registration that exists is left to go stale.
 */
export function syncPush(place: Place): Promise<void> {
  syncing ??= sync(place)
    .catch((e) => console.warn('[alerts] push registration', String(e)))
    .finally(() => (syncing = null));
  return syncing;
}

async function sync(place: Place) {
  const { enabled, prefs, push: prev } = useAlertsState.getState();
  if (!enabled || !place.pos || Platform.OS === 'web') return;
  if (!(await getPermissionsAsync()).granted) return;
  const now = Date.now();
  const due = !prev || now - prev.at > REFRESH_MS;
  const token = Platform.OS === 'ios' ? await iosToken() : await androidToken(prev, due);
  if (!token) return;
  const body = {
    ...token,
    cell: cellOf(place.pos),
    country: place.country,
    lang: lang2(i18n.language),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    prefs,
  };
  const sent = JSON.stringify(body);
  if (prev && prev.sent === sent && !due) return;
  const res = await call('POST', '/v1/register', body);
  if (!res.ok) throw new Error(`register HTTP ${res.status}`);
  const answer = (await res.json()) as { sources?: SourceId[] };
  // A new token replaces the old row: the old one is deleted so it doesn't get pushes twice.
  if (prev && prev.token !== token.token) void call('DELETE', '/v1/register', { token: prev.token }).catch(() => {});
  savePush({ platform: token.platform, token: token.token, sent, at: now, sources: answer.sources ?? [], healthyAt: now });
}

/** Alerts off: the server forgets this phone. Offline, the row goes stale and the server drops it later. */
export async function unregisterPush(): Promise<void> {
  const p = useAlertsState.getState().push;
  savePush(null);
  if (p) await call('DELETE', '/v1/register', { token: p.token }).catch(() => {});
}
