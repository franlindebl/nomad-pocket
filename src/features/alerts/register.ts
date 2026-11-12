// Official alerts at startup: how their notifications show while the app is open (with sound, unlike the kit's
// reminders), a tap opens the alert, the background check stays registered while the feature is on, and a check runs
// a while after launch and on coming back to the foreground (check.ts skips it within 10 minutes of the last one).
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  getDevicePushTokenAsync,
  getLastNotificationResponse,
  type NotificationResponse,
} from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';

import NomadPush from '../../../modules/nomad-push';

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

  // Phase 2 spike (docs/ALERTS_PLAN.md, task 0a): a build made with EXPO_PUBLIC_PUSH_SPIKE=1 writes its APNs token to
  // Library/push-spike-token.txt (read with `devicectl device copy from`) so the owner can send it a test push.
  // Remove when the app registers with the server.
  if (process.env.EXPO_PUBLIC_PUSH_SPIKE === '1' && Platform.OS === 'ios') {
    getDevicePushTokenAsync().then(
      (t) => new File(Paths.document, '..', 'Library', 'push-spike-token.txt').write(String(t.data)),
      (e) => console.warn('[push-spike] no token', e),
    );
  }
  // Android: FCM through the phone's Play services with only our code (modules/nomad-push); the config comes from
  // the build's environment for the spike.
  if (process.env.EXPO_PUBLIC_PUSH_SPIKE === '1' && Platform.OS === 'android' && NomadPush) {
    console.log('[push-spike] play services', NomadPush.playServicesVersion());
    NomadPush.addListener('onMessage', (m) => console.log('[push-spike] message', m.messageId, 'latencyMs', m.latencyMs));
    NomadPush.register(
      process.env.EXPO_PUBLIC_FCM_PROJECT_ID ?? '',
      process.env.EXPO_PUBLIC_FCM_PROJECT_NUMBER ?? '',
      process.env.EXPO_PUBLIC_FCM_APP_ID ?? '',
      process.env.EXPO_PUBLIC_FCM_API_KEY ?? '',
    ).then(
      (r) => console.log('[push-spike] fcm path', r.path, 'fid', r.fid, 'token', r.token),
      (e) => console.warn('[push-spike] fcm failed', String(e)),
    );
  }

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
