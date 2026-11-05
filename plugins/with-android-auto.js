// Android Auto navigation (modules/nomad-carplay's Android side, docs/ANDROID_AUTO_PLAN.md) in the generated
// Android project. Off unless the `enabled` option is true or ANDROID_AUTO=1 at prebuild: then nomad-carplay is
// left out of Android autolinking, so the APK has no car service, no car permissions and no Car App Library;
// src/features/carplay finds no native module and does nothing. On: the module links as any other, and its own
// manifest brings the service (navigation category), the two car permissions and automotive_app_desc.
// Excluding a module in settings.gradle replaces package.json's expo.autolinking.android.exclude list for that
// build, so that list is carried over here.
const fs = require('fs');
const path = require('path');
const { withSettingsGradle } = require('expo/config-plugins');

const MODULE = 'nomad-carplay';
const AUTOLINKING = 'expoAutolinking.useExpoModules()';
const MARK = '// with-android-auto';

function packageExcludes(projectRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return pkg.expo?.autolinking?.android?.exclude ?? [];
}

module.exports = function withAndroidAuto(config, options = {}) {
  const enabled = options.enabled === true || process.env.ANDROID_AUTO === '1';
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
