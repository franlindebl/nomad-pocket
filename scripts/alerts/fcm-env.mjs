#!/usr/bin/env node
// Prints the EXPO_PUBLIC_FCM_* variables an Android build needs for alert push (modules/nomad-push), from the Firebase
// client config kept outside the repo. The values are public by design (they ship in the APK, and the API key is
// restricted to Firebase's APIs), but they stay out of the public repo so secret scanners don't flag them.
//
//   eval "$(node scripts/alerts/fcm-env.mjs)"   # before `./gradlew bundleRelease` / `assembleRelease`
//
// Without them the Android build still works: it just doesn't register for push and keeps the background check.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const path = process.env.FCM_CLIENT_CONFIG ?? `${homedir()}/.nomad-pocket/secrets/firebase-android.json`;
const c = JSON.parse(readFileSync(path, 'utf8'));
const vars = {
  EXPO_PUBLIC_FCM_PROJECT_ID: c.projectId,
  EXPO_PUBLIC_FCM_PROJECT_NUMBER: c.projectNumber,
  EXPO_PUBLIC_FCM_APP_ID: c.appId,
  EXPO_PUBLIC_FCM_API_KEY: c.apiKey,
};
for (const [k, v] of Object.entries(vars)) {
  if (!v) throw new Error(`${k}: missing in ${path}`);
  console.log(`export ${k}='${String(v).replace(/'/g, '')}'`);
}
