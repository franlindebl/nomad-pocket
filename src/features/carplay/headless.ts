// The car's JS task on Android (modules/nomad-carplay/android CarJs.kt). Opened from the car with the app not running,
// no activity starts, so the root layout never runs the app's startup: this task runs it without UI (the same
// bootstrap, idempotent, so a phone opened later just reuses it) and lasts while the car is connected, which also
// keeps JS timers running with the phone's activity paused. Registered from index.ts, before React loads.
import { AppRegistry } from 'react-native';

import NomadCarPlay from '../../../modules/nomad-carplay';

AppRegistry.registerHeadlessTask('NomadCar', () => async () => {
  await import('@/i18n');
  const { bootstrap } = await import('@/features/bootstrap');
  await bootstrap();
  const car = NomadCarPlay;
  if (!car?.isConnected()) return;
  await new Promise<void>((resolve) => {
    const sub = car.addListener('onDisconnect', () => {
      sub.remove();
      resolve();
    });
  });
});
