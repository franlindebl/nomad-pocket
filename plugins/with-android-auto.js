// Android Auto navigation (modules/nomad-carplay's Android side, docs/ANDROID_AUTO_PLAN.md) in the generated
// Android project. Off unless the `enabled` option is true or ANDROID_AUTO=1 at prebuild: then nomad-carplay is
// left out of Android autolinking, so the APK has no car service, no car permissions and no Car App Library;
// src/features/carplay finds no native module and does nothing. On: the module links as any other, and its own
// manifest brings the service (navigation category), the two car permissions and automotive_app_desc.
// Excluding a module in settings.gradle replaces package.json's expo.autolinking.android.exclude list for that
// build, so that list is carried over here.
// Android Automotive (the OS built into the car; its emulator is how the car screens are tried locally, since
// Play doesn't offer Android Auto to the phone emulator): the `automotive` option or ANDROID_AUTOMOTIVE=1 (either
// turns the module on too) adds the Car App Library's automotive artifact and its CarAppActivity, the launcher entry
// the car's templates host opens. Not for phone builds.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withAppBuildGradle, withSettingsGradle } = require('expo/config-plugins');

const MODULE = 'nomad-carplay';
const AUTOLINKING = 'expoAutolinking.useExpoModules()';
const MARK = '// with-android-auto';
const CAR_APP_VERSION = '1.7.0'; // as modules/nomad-carplay/android/build.gradle
const CAR_ACTIVITY = 'androidx.car.app.activity.CarAppActivity';

function packageExcludes(projectRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return pkg.expo?.autolinking?.android?.exclude ?? [];
}

function withAutomotive(config) {
  config = withAppBuildGradle(config, (config) => {
    const line = `    implementation "androidx.car.app:app-automotive:${CAR_APP_VERSION}" ${MARK}`;
    if (!config.modResults.contents.includes(MARK)) {
      config.modResults.contents = config.modResults.contents.replace(/\ndependencies \{\n/, (m) => `${m}${line}\n`);
    }
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    // app-automotive declares minSdk 29 (Android Automotive starts at Android 10); the phone's floor is 26.
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    manifest['uses-sdk'] = [{ $: { 'tools:overrideLibrary': 'androidx.car.app.automotive' } }];
    manifest['uses-feature'] ??= [];
    for (const name of ['android.hardware.type.automotive', 'android.software.car.templates_host']) {
      if (!manifest['uses-feature'].some((f) => f.$['android:name'] === name)) {
        manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.activity ??= [];
    if (!app.activity.some((a) => a.$['android:name'] === CAR_ACTIVITY)) {
      app.activity.push({
        $: {
          'android:name': CAR_ACTIVITY,
          'android:exported': 'true',
          'android:launchMode': 'singleTask',
          'android:theme': '@android:style/Theme.DeviceDefault.NoActionBar',
          'android:label': '@string/app_name',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
        'meta-data': [{ $: { 'android:name': 'distractionOptimized', 'android:value': 'true' } }],
      });
    }
    return config;
  });
}

module.exports = function withAndroidAuto(config, options = {}) {
  const automotive = options.automotive === true || process.env.ANDROID_AUTOMOTIVE === '1';
  const enabled = automotive || options.enabled === true || process.env.ANDROID_AUTO === '1';
  if (automotive) config = withAutomotive(config);
  return withSettingsGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (!gradle.includes(AUTOLINKING)) throw new Error(`with-android-auto: no ${AUTOLINKING} in settings.gradle (did Expo's Android template change?)`);
    // Both ways, in case prebuild merges into an android/ made the other way.
    const lines = gradle.split('\n').filter((l) => !l.includes(MARK));
    if (!enabled) {
      const exclude = [...new Set([...packageExcludes(config._internal.projectRoot), MODULE])];
      const at = lines.findIndex((l) => l.includes(AUTOLINKING));
      lines.splice(at, 0, `expoAutolinking.exclude = [${exclude.map((e) => `'${e}'`).join(', ')}] ${MARK}`);
    }
    config.modResults.contents = lines.join('\n');
    return config;
  });
};
