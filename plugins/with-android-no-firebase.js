// Keeps Firebase out of the APK. expo-notifications depends on firebase-messaging for push,
// but the app only schedules local notifications (`enableRemoteNotifications: false`), and
// Firebase brings Google's proprietary Play services pieces (cloud-messaging, stats) and its
// datatransport telemetry along. Excluding the module from the app's classpath drops all of it.
//
// expo-notifications still compiles against Firebase (its own classpath is untouched). Its
// local path never loads a Firebase class: only the push-token and topic functions, which the
// app doesn't call, and its FirebaseMessagingService, which nothing can start without Firebase
// and which is removed from the manifest here. R8 is told not to fail on the classes those
// references point to. Re-check this after an expo-notifications update.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARK = '// plugins/with-android-no-firebase.js';
const GRADLE = `
${MARK}: local notifications only, no Firebase in the APK.
configurations.configureEach {
    exclude group: 'com.google.firebase', module: 'firebase-messaging'
}
`;
const PROGUARD = `
# plugins/with-android-no-firebase.js: expo-notifications' push code references Firebase, left out of the APK.
-dontwarn com.google.firebase.**
`;
const SERVICE = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';

function withGradleExclude(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(MARK)) config.modResults.contents += GRADLE;
    return config;
  });
}

function withProguardRule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const rules = await fs.promises.readFile(file, 'utf8');
      if (!rules.includes('with-android-no-firebase')) await fs.promises.writeFile(file, rules + PROGUARD);
      return config;
    },
  ]);
}

function withoutMessagingService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } });
    return config;
  });
}

module.exports = function withAndroidNoFirebase(config) {
  return withoutMessagingService(withProguardRule(withGradleExclude(config)));
};
