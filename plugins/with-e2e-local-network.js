// Lets the Android E2E build talk plain http to localhost when NOMAD_E2E=1 (`scripts/e2e-android.sh
// --build` prebuilds with it): the content updates flow reads a stand-in Kiwix catalog that the
// script serves on the Mac and forwards with `adb reverse` (docs/E2E.md). Android refuses
// cleartext by default; this allows it for localhost only, through a network security config.
// Without the variable (and always for store builds) the config is removed again, since prebuild
// merges into an existing android/. iOS needs nothing: the E2E builds keep NSAllowsLocalNetworking.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const NAME = 'nomad_e2e_network';
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

const isE2E = () => process.env.NOMAD_E2E === '1' && process.env.NOMAD_STORE_BUILD !== '1';

function withManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (!app) return config;
    if (isE2E()) app.$['android:networkSecurityConfig'] = `@xml/${NAME}`;
    else if (app.$['android:networkSecurityConfig'] === `@xml/${NAME}`) delete app.$['android:networkSecurityConfig'];
    return config;
  });
}

function withFile(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml', `${NAME}.xml`);
      if (isE2E()) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, XML);
      } else if (fs.existsSync(file)) fs.unlinkSync(file);
      return config;
    },
  ]);
}

module.exports = (config) => withFile(withManifest(config));
