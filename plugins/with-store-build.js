// Strips dev-client leftovers from the generated native projects when NOMAD_STORE_BUILD=1
// (`NOMAD_STORE_BUILD=1 npx expo prebuild --platform ios`, docs/RELEASE.md). The generated
// Info.plist and main AndroidManifest are shared by Debug and Release, so without this the
// store build ships the development client's `exp+<slug>` URL scheme, the Metro port key, the
// local-network ATS exception, the Bonjour service and its usage string. On Android it also signs
// release builds with the Play upload key, read from Gradle properties kept outside the repo
// (`~/.gradle/gradle.properties`: NOMAD_UPLOAD_STORE_FILE, NOMAD_UPLOAD_STORE_PASSWORD,
// NOMAD_UPLOAD_KEY_ALIAS, NOMAD_UPLOAD_KEY_PASSWORD); without them a store release build fails
// instead of shipping signed with the debug key.
//
// Never set it for dev builds or the E2E Release builds: those load their catalogs and
// routing manifests over plain http from localhost (scripts/e2e.sh), which needs
// NSAllowsLocalNetworking. Without the variable this plugin does nothing.
const { withAndroidManifest, withAppBuildGradle, withInfoPlist } = require('expo/config-plugins');

const isStore = () => process.env.NOMAD_STORE_BUILD === '1';

function withIosClean(config) {
  return withInfoPlist(config, (config) => {
    const plist = config.modResults;
    plist.CFBundleURLTypes = (plist.CFBundleURLTypes ?? [])
      .map((t) => ({ ...t, CFBundleURLSchemes: (t.CFBundleURLSchemes ?? []).filter((s) => !s.startsWith('exp+')) }))
      .filter((t) => t.CFBundleURLSchemes.length > 0);
    delete plist.RCTMetroPort;
    delete plist.NSBonjourServices;
    delete plist.NSLocalNetworkUsageDescription;
    if (plist.NSAppTransportSecurity) {
      delete plist.NSAppTransportSecurity.NSAllowsLocalNetworking;
      if (Object.keys(plist.NSAppTransportSecurity).every((k) => k === 'NSAllowsArbitraryLoads')) {
        plist.NSAppTransportSecurity = { NSAllowsArbitraryLoads: false };
      }
    }
    return config;
  });
}

function withAndroidClean(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    for (const activity of app?.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (!filter.data) continue;
        filter.data = filter.data.filter((d) => !String(d.$?.['android:scheme'] ?? '').startsWith('exp+'));
        if (filter.data.length === 0) delete filter.data;
      }
    }
    return config;
  });
}

const SIGNING_MARK = '// plugins/with-store-build.js: Play upload key';
const SIGNING = `
${SIGNING_MARK} (docs/RELEASE.md, Android).
def uploadProps = ['NOMAD_UPLOAD_STORE_FILE', 'NOMAD_UPLOAD_STORE_PASSWORD', 'NOMAD_UPLOAD_KEY_ALIAS', 'NOMAD_UPLOAD_KEY_PASSWORD']
if (uploadProps.every { project.hasProperty(it) }) {
    android {
        signingConfigs {
            upload {
                storeFile file(NOMAD_UPLOAD_STORE_FILE)
                storePassword NOMAD_UPLOAD_STORE_PASSWORD
                keyAlias NOMAD_UPLOAD_KEY_ALIAS
                keyPassword NOMAD_UPLOAD_KEY_PASSWORD
            }
        }
        buildTypes.release.signingConfig signingConfigs.upload
    }
} else {
    gradle.taskGraph.whenReady { graph ->
        if (graph.allTasks.any { it.name.contains('Release') && (it.name.startsWith('bundle') || it.name.startsWith('assemble')) }) {
            throw new GradleException('Store build without the Play upload key: set ' + uploadProps.join(', ') + ' in ~/.gradle/gradle.properties')
        }
    }
}
`;

function withAndroidUploadSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(SIGNING_MARK)) config.modResults.contents += SIGNING;
    return config;
  });
}

module.exports = function withStoreBuild(config) {
  if (!isStore()) return config;
  return withAndroidUploadSigning(withAndroidClean(withIosClean(config)));
};
