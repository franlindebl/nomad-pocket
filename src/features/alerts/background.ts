// The background check (docs/ALERTS_PLAN.md, phase 1): expo-background-task runs it through WorkManager on Android
// (we ask every 30 min; 15 is the floor) and BGTaskScheduler on iOS, which decides when (often far less often, and
// not after the person swipes the app away). The task must be defined when the JS bundle loads, before React, so a
// headless start (no UI) finds it: this file is imported from the entry point (index.ts) and keeps its own imports
// light; the check itself loads on demand.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

export const ALERTS_TASK = 'nomad-alerts-check';
const INTERVAL_MIN = 30;

TaskManager.defineTask(ALERTS_TASK, async () => {
  try {
    const { reloadAlertsState } = await import('./state');
    const { runAlertsCheck } = await import('./check');
    // Another JS context (the app, on Android) may have changed the state since this one loaded it.
    reloadAlertsState();
    await runAlertsCheck('background');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[alerts] background check failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerAlertsTask() {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(ALERTS_TASK)) return;
    await BackgroundTask.registerTaskAsync(ALERTS_TASK, { minimumInterval: INTERVAL_MIN });
  } catch (e) {
    console.warn('[alerts] cannot register the background check', e);
  }
}

export async function unregisterAlertsTask() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(ALERTS_TASK)) await BackgroundTask.unregisterTaskAsync(ALERTS_TASK);
  } catch (e) {
    console.warn('[alerts] cannot unregister the background check', e);
  }
}
