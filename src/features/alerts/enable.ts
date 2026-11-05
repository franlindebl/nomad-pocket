// Turning official alerts on and off (docs/ALERTS_PLAN.md, decision 1): opt-in only. On asks for notifications, then
// for location "while using" if the app doesn't have it (never "Always"), registers the background check and runs a
// first check. Off unregisters it and forgets what was fetched and the position: nothing is fetched while it is off.
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';
import { Linking } from 'react-native';

import * as Location from '@/lib/location';

import { registerAlertsTask, unregisterAlertsTask } from './background';
import { runAlertsCheck } from './check';
import { ensureAlertsChannel } from './notify';
import { clearAlertsData, saveEnabled, saveOffered } from './state';

export type EnableResult = { notifications: boolean; location: boolean };

export async function enableAlerts(): Promise<EnableResult> {
  saveOffered();
  // Android 13+ shows the notification prompt only once a channel exists.
  await ensureAlertsChannel().catch(() => {});
  let notifications = false;
  try {
    const now = await getPermissionsAsync();
    notifications = now.granted || (now.canAskAgain && (await requestPermissionsAsync()).granted);
  } catch (e) {
    console.warn('[alerts] notification permission', e);
  }
  let location = false;
  try {
    const now = await Location.getForegroundPermissionsAsync();
    location = now.granted || (now.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted);
  } catch (e) {
    console.warn('[alerts] location permission', e);
  }
  saveEnabled(true);
  await registerAlertsTask();
  void runAlertsCheck('enable');
  return { notifications, location };
}

export async function disableAlerts() {
  saveEnabled(false);
  await unregisterAlertsTask();
  clearAlertsData();
}

/** "Ahora no": the offer is not shown again (Settings still has the switch). */
export const declineAlerts = saveOffered;

/** The offer was shown (the last onboarding step): Home won't show it again. */
export const markAlertsOffered = saveOffered;

/** Asks again for what was refused, or opens the app's system settings when the system won't ask. */
export async function askNotificationsAgain(): Promise<boolean> {
  const now = await getPermissionsAsync();
  if (now.granted) return true;
  if (now.canAskAgain) return (await requestPermissionsAsync()).granted;
  await Linking.openSettings();
  return false;
}

export async function askLocationAgain(): Promise<boolean> {
  const now = await Location.getForegroundPermissionsAsync();
  if (now.granted || (now.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted)) {
    void runAlertsCheck('manual');
    return true;
  }
  if (!now.canAskAgain) await Linking.openSettings();
  return false;
}
