// One alerts check (docs/ALERTS_PLAN.md, phase 1): position (foreground only) → the sources for the country → their
// answers cached → what covers the person → the notify policy → local notifications (except what the push server
// already rings, phase 2). Runs at launch, on coming to the
// foreground (at most every 10 min unless the person moved), from the background task, and when asked. Headless-safe:
// nothing here touches React, so the background task (a JS run with no UI) can call it.
import * as Network from 'expo-network';

import { noteHere, useHereCountry } from '@/features/maps/emergency';
import * as Location from '@/lib/location';
import { useSettings } from '@/stores/settings';

import { decide, distanceKm, snap, sourcesFor, visible, type LatLon, type Place, type SourceId } from './alerts-core';
import { notifyAlerts } from './notify';
import { pushCovers, refreshPushHealth, serverAlerts, serverOnly, syncPush } from './push-register';
import { FETCHERS, type FetchedSource } from './sources';
import { logRun, placeOf, saveCache, saveNotified, savePosition, useAlertsState, type Cache, type SourceCache, type Trigger } from './state';

const FOREGROUND_EVERY_MS = 10 * 60_000;
/** Moving this far since the last check is worth a check even inside the 10 minutes. */
const MOVED_KM = 5;
/** A last known fix older than this isn't taken as where the person is now. */
const FIX_MAX_AGE_MS = 30 * 60_000;
/** The position kept on the device is snapped to ~100 m. */
const KEPT_GRID = 0.001;

let running: Promise<void> | null = null;

/** Runs a check unless one is running already (then it waits for that one). */
export function runAlertsCheck(trigger: Trigger): Promise<void> {
  running ??= check(trigger)
    .catch((e) => console.warn('[alerts] check failed', e))
    .finally(() => {
      running = null;
      useAlertsState.setState({ checking: false });
    });
  return running;
}

/**
 * The person's position from the system's last fix (asks nothing; `fresh` also takes one coarse fix when there is no
 * recent one). Kept snapped to ~100 m, and noted for the country of the emergency number too.
 */
async function refreshPosition(fresh: boolean): Promise<LatLon | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const fix =
      (await Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE_MS })) ??
      (fresh ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low, mayShowUserSettingsDialog: false }) : null);
    if (!fix) return null;
    const p = snap({ lat: fix.coords.latitude, lon: fix.coords.longitude }, KEPT_GRID);
    savePosition({ ...p, at: fix.timestamp || Date.now() });
    noteHere(p.lat, p.lon);
    return p;
  } catch (e) {
    console.warn('[alerts] no position', e);
    return null;
  }
}

/** Where the person is for matching: the kept position and its country, else the country chosen in onboarding. */
export function currentPlace(): Place {
  const { position: pos, push } = useAlertsState.getState();
  return placeOf(pos ? { lat: pos.lat, lon: pos.lon } : null, useHereCountry.getState().id ?? useSettings.getState().country, push);
}

async function check(trigger: Trigger) {
  const state = useAlertsState.getState();
  if (!state.enabled) return;
  const started = Date.now();
  const before = state.position;
  // In the background the app may not ask the system for a position ("while using" only): the kept one serves.
  const pos = trigger === 'background' ? null : await refreshPosition(trigger === 'manual' || trigger === 'enable');
  const moved = !!pos && (!before || distanceKm(before, pos) >= MOVED_KM);
  const recent = state.cache.checkedAt !== null && started - state.cache.checkedAt < FOREGROUND_EVERY_MS;
  if ((trigger === 'launch' || trigger === 'foreground') && recent && !moved) return;

  useAlertsState.setState({ checking: true });
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (!net || net.isConnected === false || net.isInternetReachable === false) {
    logRun({ at: started, trigger, ms: Date.now() - started, ok: [], failed: [], notified: 0, offline: true });
    return;
  }

  let place = currentPlace();
  const now = Date.now();
  const sources = sourcesFor(place.country).filter((s): s is FetchedSource => s in FETCHERS);
  const prev = useAlertsState.getState().cache;
  const results = await Promise.allSettled(sources.map((s) => FETCHERS[s](prev.sources[s], now, place.pos)));
  const next: Cache = { checkedAt: prev.checkedAt, sources: {} };
  const ok: SourceId[] = [];
  const failed: SourceId[] = [];
  const keep = (s: SourceId, r: PromiseSettledResult<SourceCache>) => {
    if (r.status === 'fulfilled') {
      next.sources[s] = r.value;
      ok.push(s);
    } else {
      const old: SourceCache = prev.sources[s] ?? { fetchedAt: 0, alerts: [] };
      next.sources[s] = { ...old, error: String(r.reason) };
      failed.push(s);
      console.warn('[alerts] source failed', s, r.reason);
    }
  };
  results.forEach((r, i) => keep(sources[i], r));

  // Phase 2: keep the server registration current; what it pushes isn't rung again here while it is healthy. The
  // sources only the server reads (MeteoAlarm) come from it, for the cell it has.
  await syncPush(place);
  await refreshPushHealth();
  const fromServer = serverOnly();
  for (const s of fromServer) keep(s, (await Promise.allSettled([serverAlerts(now)]))[0]);
  place = currentPlace();
  if (ok.length) next.checkedAt = now;
  saveCache(next);

  // Notify only what covers the person; without a position nothing does (the list shows the country instead).
  const all = [...sources, ...fromServer].flatMap((s) => next.sources[s]?.alerts ?? []);
  const shown = visible(all, place, now);
  const covering = shown.nearby ? shown.alerts : [];
  const { prefs, notified } = useAlertsState.getState();
  const decision = decide(covering, notified, { now, minLevel: prefs.minLevel });
  saveNotified(decision.notified);
  // Turning the feature on shows the list at once: what is already in force there isn't rung on top of it.
  const ring = trigger === 'enable' ? [] : decision.notify.filter((a) => (prefs.quakes || a.kind !== 'quake') && !pushCovers(a.source));
  const sent = await notifyAlerts(ring, place);
  logRun({ at: started, trigger, ms: Date.now() - started, ok, failed, notified: sent });
}
