// Local notifications that remind to replace kit items before they expire. Local only:
// the expo-notifications plugin runs with `enableRemoteNotifications: false`, so the app
// has no push entitlement and nothing leaves the device.
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  cancelScheduledNotificationAsync,
  clearLastNotificationResponse,
  getAllScheduledNotificationsAsync,
  getLastNotificationResponse,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  SchedulableTriggerInputTypes,
  setNotificationChannelAsync,
  setNotificationHandler,
  type NotificationResponse,
} from 'expo-notifications';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { whenNavigatorReady } from '@/components/navigation';
import i18n from '@/i18n';

import { formatMonth, kitFor, planReminders, reminderDate, type ScheduledReminder } from './kit';
import { deletePlanPdfs } from './share';
import { getKitEntry, usePrepare } from './store';

const CHANNEL = 'reminders';
const KIND = 'kit-expiry';

let initialised = false;

export function initReminders() {
  if (initialised) return;
  initialised = true;
  setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  addNotificationResponseReceivedListener(openKit);
  // A tap that launched the app was delivered before this listener existed: it waits here.
  const launch = getLastNotificationResponse();
  if (launch) openKit(launch);

  // The scheduled reminders are rebuilt from the plan whenever they may have drifted: at
  // startup (a backup restored onto a new phone brings the plan back, not its notifications),
  // on coming back to the app (notifications allowed in Settings meanwhile), when the
  // household changes (items leave the kit) and when the language does (their text).
  const persist = usePrepare.persist;
  if (persist.hasHydrated()) syncReminders();
  else persist.onFinishHydration(syncReminders);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') syncReminders();
  });
  usePrepare.subscribe((s, prev) => {
    if (s.household !== prev.household || s.custom !== prev.custom) syncReminders();
  });
  i18n.on('languageChanged', syncReminders);
  // An exported plan left behind by a share sheet that didn't hand control back (see share.ts).
  deletePlanPdfs();
}

const handled = new Set<string>();

function openKit(response: NotificationResponse) {
  const request = response.notification.request;
  if (request.content.data?.kind !== KIND || handled.has(request.identifier)) return;
  handled.add(request.identifier);
  clearLastNotificationResponse();
  // At launch the navigator isn't up yet, and a push before it is ready is dropped.
  whenNavigatorReady(() => router.push('/prepare/kit'));
}

// Scheduling awaits the OS; one change at a time, so two of them never both schedule an item.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

async function ensureChannel() {
  // Android 13+ shows the permission prompt only once a channel exists.
  if (Platform.OS === 'android') {
    await setNotificationChannelAsync(CHANNEL, {
      name: i18n.t('prepare:reminders.channel'),
      importance: AndroidImportance.DEFAULT,
    });
  }
}

async function ensurePermission(): Promise<boolean> {
  await ensureChannel();
  const current = await getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await requestPermissionsAsync()).granted;
}

async function cancel(id: string | null) {
  if (id) await cancelScheduledNotificationAsync(id).catch(() => {});
}

function itemTitle(itemId: string): string {
  const custom = usePrepare.getState().custom.find((c) => c.id === itemId);
  return custom ? custom.name : i18n.t(`prepare:kit.items.${itemId}.title`);
}

/** Schedules the item's reminder; null when its moment has passed. */
async function schedule(itemId: string, month: string): Promise<string | null> {
  const at = reminderDate(month, new Date());
  if (!at) return null;
  return scheduleNotificationAsync({
    content: {
      title: i18n.t('prepare:reminders.title'),
      body: i18n.t('prepare:reminders.body', { item: itemTitle(itemId), month: formatMonth(month, i18n.language) }),
      data: { kind: KIND, itemId, lang: i18n.language },
    },
    trigger: { type: SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
  });
}

let syncQueued = false;

/** Brings the scheduled reminders in line with the plan. Never asks for permission. */
function syncReminders() {
  if (syncQueued) return;
  syncQueued = true;
  void serial(async () => {
    syncQueued = false;
    // Before the plan is loaded every reminder would look like a stray.
    if (!usePrepare.persist.hasHydrated() || !(await getPermissionsAsync()).granted) return;
    const { kit, custom, household, setKitEntry } = usePrepare.getState();
    const inKit = new Set([...kitFor(household).map((d) => d.id), ...custom.map((c) => c.id)]);
    const scheduled: ScheduledReminder[] = [];
    for (const n of await getAllScheduledNotificationsAsync()) {
      const data = n.content.data ?? {};
      if (data.kind !== KIND) continue;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      scheduled.push({ id: n.identifier, itemId: str(data.itemId), lang: str(data.lang) });
    }
    const plan = planReminders(kit, inKit, scheduled, new Date(), i18n.language);
    await Promise.all(plan.cancel.map(cancel));
    for (const id of plan.clear) setKitEntry(id, { reminderId: null });
    if (plan.schedule.length) await ensureChannel();
    for (const id of plan.schedule) {
      const month = getKitEntry(id).expires;
      setKitEntry(id, { reminderId: month ? await schedule(id, month) : null });
    }
  }).catch((e) => console.warn('[prepare] reminder sync failed', e));
}

/**
 * Sets (or clears, with null) an item's expiry month and reschedules its reminder.
 * Resolves to false when a reminder was wanted but notifications are not allowed.
 */
export function setExpiry(itemId: string, month: string | null): Promise<boolean> {
  return serial(async () => {
    const { setKitEntry } = usePrepare.getState();
    await cancel(getKitEntry(itemId).reminderId);
    setKitEntry(itemId, { expires: month, reminderId: null });
    if (!month || !reminderDate(month, new Date())) return true;
    try {
      if (!(await ensurePermission())) return false;
      setKitEntry(itemId, { reminderId: await schedule(itemId, month) });
      return true;
    } catch (e) {
      console.warn('[prepare] reminder failed', e);
      return false;
    }
  });
}

export function removeCustomItem(id: string): Promise<void> {
  return serial(async () => {
    await cancel(getKitEntry(id).reminderId);
    usePrepare.getState().removeCustom(id);
  });
}

/** Deletes the whole plan and kit, their reminders and any exported copy. */
export function resetPrepare(): Promise<void> {
  return serial(async () => {
    await Promise.all(Object.values(usePrepare.getState().kit).map((e) => cancel(e.reminderId)));
    usePrepare.getState().reset();
    deletePlanPdfs();
  });
}
