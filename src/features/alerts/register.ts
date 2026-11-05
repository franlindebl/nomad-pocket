// Official alerts at startup: how their notifications show while the app is open (with sound, unlike the kit's
// reminders), a tap opens the alert, the background check stays registered while the feature is on, and a check runs
// a while after launch and on coming back to the foreground (check.ts skips it within 10 minutes of the last one).
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  getLastNotificationResponse,
  type NotificationResponse,
} from 'expo-notifications';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { whenNavigatorReady } from '@/components/navigation';
import { registerInit } from '@/features/bootstrap';
import { setNotificationBehaviour } from '@/lib/notifications';

import { registerAlertsTask } from './background';
import { runAlertsCheck } from './check';
import { ALERT_KIND } from './notify';
import { reloadAlertsState, useAlertsState } from './state';

const handled = new Set<string>();

function openAlert(response: NotificationResponse) {
  const request = response.notification.request;
  const data = request.content.data ?? {};
  if (data.kind !== ALERT_KIND || handled.has(request.identifier + response.notification.date)) return;
  handled.add(request.identifier + response.notification.date);
  clearLastNotificationResponse();
  const key = typeof data.key === 'string' ? data.key : null;
  // At launch the navigator isn't up yet, and a push before it is ready is dropped.
  whenNavigatorReady(() => (key ? router.push({ pathname: '/alerts/[id]', params: { id: key } }) : router.push('/alerts')));
}

registerInit(() => {
  setNotificationBehaviour(ALERT_KIND, { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false });
  addNotificationResponseReceivedListener(openAlert);
  const launch = getLastNotificationResponse();
  if (launch) openAlert(launch);

  if (useAlertsState.getState().enabled) {
    void registerAlertsTask();
    setTimeout(() => void runAlertsCheck('launch'), 5000);
  }
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    // The background task may have written meanwhile (on Android it can run in its own JS context).
    reloadAlertsState();
    if (useAlertsState.getState().enabled) void runAlertsCheck('foreground');
  });
});
