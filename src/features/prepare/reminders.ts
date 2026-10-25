// Local notifications that remind to replace kit items before they expire. Local only:
// the expo-notifications plugin runs with `enableRemoteNotifications: false`, so the app
// has no push entitlement and nothing leaves the device.
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  cancelScheduledNotificationAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  SchedulableTriggerInputTypes,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import i18n from '@/i18n';

import { formatMonth, reminderDate } from './kit';
import { getKitEntry, usePrepare } from './store';

const CHANNEL = 'reminders';

let initialised = false;

export function initReminders() {
  if (initialised) return;
  initialised = true;
  setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.data?.kind === 'kit-expiry') router.push('/prepare/kit');
  });
}

async function ensurePermission(): Promise<boolean> {
  // Android 13+ shows the permission prompt only once a channel exists.
  if (Platform.OS === 'android') {
    await setNotificationChannelAsync(CHANNEL, {
      name: i18n.t('prepare:reminders.channel'),
      importance: AndroidImportance.DEFAULT,
    });
  }
  const current = await getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await requestPermissionsAsync()).granted;
}

async function cancel(id: string | null) {
  if (id) await cancelScheduledNotificationAsync(id).catch(() => {});
}

/**
 * Sets (or clears, with null) an item's expiry month and reschedules its reminder.
 * Resolves to false when a reminder was wanted but notifications are not allowed.
 */
export async function setExpiry(itemId: string, title: string, month: string | null): Promise<boolean> {
  const { setKitEntry } = usePrepare.getState();
  await cancel(getKitEntry(itemId).reminderId);
  setKitEntry(itemId, { expires: month, reminderId: null });
  if (!month) return true;
  const at = reminderDate(month, new Date());
  if (!at) return true;
  try {
    if (!(await ensurePermission())) return false;
    const reminderId = await scheduleNotificationAsync({
      content: {
        title: i18n.t('prepare:reminders.title'),
        body: i18n.t('prepare:reminders.body', { item: title, month: formatMonth(month, i18n.language) }),
        data: { kind: 'kit-expiry', itemId },
      },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
    // The month may have changed again while we awaited.
    if (getKitEntry(itemId).expires === month) setKitEntry(itemId, { reminderId });
    else await cancel(reminderId);
    return true;
  } catch (e) {
    console.warn('[prepare] reminder failed', e);
    return false;
  }
}

export async function removeCustomItem(id: string) {
  await cancel(getKitEntry(id).reminderId);
  usePrepare.getState().removeCustom(id);
}

/** Deletes the whole plan and kit, and their reminders. */
export async function resetPrepare() {
  await Promise.all(Object.values(usePrepare.getState().kit).map((e) => cancel(e.reminderId)));
  usePrepare.getState().reset();
}
