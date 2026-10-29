// Keeps the Play Install Referrer library out of the APK. expo-application (pulled in by
// expo-notifications) depends on com.android.installreferrer, which is under the Android SDK terms
// (not open source, so it can't ship next to GPL libkiwix) and talks to the Play Store. The app never
// calls getInstallReferrerAsync, the only code that loads it. Location without Play services is
// modules/nomad-location (expo-location is left out of Android autolinking in package.json).
//
// expo-application still compiles against it (its own classpath is untouched); R8 is told not to
// fail on the classes its referrer function points to. Re-check this after an expo-application update.
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARK = '// plugins/with-android-no-install-referrer.js';
const GRADLE = `
${MARK}: no Play Install Referrer in the APK.
configurations.configureEach {
    exclude group: 'com.android.installreferrer', module: 'installreferrer'
}
`;
const PROGUARD = `
# plugins/with-android-no-install-referrer.js: expo-application's referrer code, left out of the APK.
-dontwarn com.android.installreferrer.**
`;

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
      if (!rules.includes('with-android-no-install-referrer')) await fs.promises.writeFile(file, rules + PROGUARD);
      return config;
    },
  ]);
}

module.exports = function withAndroidNoInstallReferrer(config) {
  return withProguardRule(withGradleExclude(config));
};
