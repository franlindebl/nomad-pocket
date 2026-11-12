// Local notifications for official alerts (docs/ALERTS_PLAN.md, decision 4): Android channel `alerts` (importance
// HIGH; once created, Android only lets its name and description change), iOS Time Sensitive for red warnings and
// tsunamis (needs the time-sensitive entitlement in app.json), `active` for the rest. Never Critical Alerts, never a
// Do Not Disturb bypass. A tap opens the alert (register.ts). Headless-safe.
import { AndroidImportance, getPermissionsAsync, scheduleNotificationAsync, setNotificationChannelAsync } from 'expo-notifications';
import { Platform } from 'react-native';

import i18n from '@/i18n';

import { timeSensitive, type Alert, type Place } from './alerts-core';
import { alertKey, alertLine, alertTitle } from './present';

export const ALERT_KIND = 'official-alert';
const CHANNEL = 'alerts';
/** More than this at once (a first check after a long time offline) becomes one summary for the rest. */
const MAX_EACH = 3;

export async function ensureAlertsChannel() {
  if (Platform.OS !== 'android') return;
  await setNotificationChannelAsync(CHANNEL, {
    name: i18n.t('alerts:channel'),
    description: i18n.t('alerts:channelBody'),
    importance: AndroidImportance.HIGH,
    enableVibrate: true,
    vibrationPattern: [0, 400, 200, 400],
  });
}

const trigger = () => (Platform.OS === 'android' ? { channelId: CHANNEL } : null);

/** Shows the alerts (most serious first, as `decide` sorts them). Returns how many notifications were shown. */
export async function notifyAlerts(alerts: Alert[], place: Place): Promise<number> {
  if (!alerts.length) return 0;
  if (!(await getPermissionsAsync().catch(() => null))?.granted) return 0;
  await ensureAlertsChannel();
  const each = alerts.length > MAX_EACH + 1 ? alerts.slice(0, MAX_EACH) : alerts;
  let shown = 0;
  for (const a of each) {
    await scheduleNotificationAsync({
      // The same alert replaces its earlier notification (a raise) instead of stacking.
      identifier: `alert:${a.topic || alertKey(a)}`,
      content: {
        title: alertTitle(a),
        body: alertLine(a, place.pos),
        data: { kind: ALERT_KIND, key: alertKey(a) },
        sound: true,
        interruptionLevel: timeSensitive(a) ? 'timeSensitive' : 'active',
      },
      trigger: trigger(),
    });
    shown++;
  }
  const rest = alerts.length - each.length;
  if (rest > 0) {
    await scheduleNotificationAsync({
      content: {
        title: i18n.t('alerts:notifyMore', { count: rest }),
        body: i18n.t('alerts:notifyMoreBody'),
        data: { kind: ALERT_KIND },
        sound: true,
        interruptionLevel: alerts.slice(MAX_EACH).some(timeSensitive) ? 'timeSensitive' : 'active',
      },
      trigger: trigger(),
    });
    shown++;
  }
  return shown;
}
