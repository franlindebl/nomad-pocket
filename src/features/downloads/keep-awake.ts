// Keeps the screen on while something downloads and the app is open. Beyond comfort: on
// Android, locking the screen sends the app to the background, which pauses every download
// (transfers stop with the process); on iOS the segmented engine only starts new ranges while
// the app runs. Released as soon as nothing is running or the app leaves the foreground.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';

import type { DownloadRecord } from './manager';

const TAG = 'downloads';

/** Running or being installed (hashing a 13 GB file or assembling a country takes a while too). Waiting ones don't count. */
export const keepsAwake = (records: Record<string, DownloadRecord>) =>
  Object.values(records).some((r) => r.status === 'running' || r.status === 'processing');

export function keepAwakeWhileDownloading(subscribe: (listener: () => void) => void, records: () => Record<string, DownloadRecord>) {
  let held = false;
  const update = () => {
    const want = AppState.currentState === 'active' && keepsAwake(records());
    if (want === held) return;
    held = want;
    if (want) activateKeepAwakeAsync(TAG).catch(() => {});
    else deactivateKeepAwake(TAG).catch(() => {});
  };
  subscribe(update);
  AppState.addEventListener('change', update);
  update();
}
