// The archive reader's WebView only shows pages from local archives (https://<uuid>.zim.local), so it
// has nothing to report: opt out of WebView usage metrics, which a device with Google's diagnostics on
// would otherwise upload, and turn Safe Browsing off, whose lookups could never match those local URLs.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const META = {
  'android.webkit.WebView.MetricsOptOut': 'true',
  'android.webkit.WebView.EnableSafeBrowsing': 'false',
};

module.exports = function withAndroidWebViewPrivacy(config) {
  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    for (const [name, value] of Object.entries(META)) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, value);
    }
    return config;
  });
};
