# Release

How Nomad Pocket gets to TestFlight and the App Store. Builds are made and uploaded
locally with `xcodebuild` (no EAS). Android is not published yet.

## Identity

| | |
|---|---|
| App name | Nomad Pocket |
| Bundle id / package | `com.fjlinde.nomadpocket` |
| Apple team | `F3VY6C7GKX` |
| App Store Connect app | 6826502392 (SKU `nomadpocket`, primary locale es-ES) |
| Categories | Books, Education |
| Privacy / support site | https://franlindebl.github.io/nomad-pocket/ (`site/`) |

The App Store Connect API key used for uploads lives outside the repo
(`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`); its key id and issuer id are in
the owner's local Claude memory, never in git. Ask the owner if they're missing.

## Versions

Everything lives in `app.json`; `ios/` and `android/` get it from `npx expo prebuild`.

- Marketing version: `expo.version` (currently **1.1.0**). Keep `package.json`'s
  `version` equal (not used by the build, but it's what people read).
- iOS build number: `expo.ios.buildNumber` (currently **"7"**) → `CFBundleVersion`. Bump it
  for every upload: App Store Connect rejects a build number it has already seen.
- Android: `expo.android.versionCode` (currently **7**, nothing published yet). Must grow
  with every Play upload.
- After changing any of them, run `npx expo prebuild` (it can regenerate `ios/` and
  `android/` from scratch: then `cd ios && pod install`).

| Version | Build | State (2026-10-25) |
|---|---|---|
| 1.0.0 | — | prepared, superseded by 1.0.1 |
| 1.0.1 | 3 | submitted to App Review (auto-release after approval) |
| 1.0.2 | 4 | uploaded to TestFlight 2026-10-24 (`51fbe2a`) |
| 1.1.0 | 5 | TestFlight 2026-10-25: map search, Emergencias, offline road routing, Preparedness, conversational assistant |
| 1.1.0 | 6 | TestFlight 2026-10-25: whole-country routing packs, street search from the packs, compass beam |
| 1.1.0 | 7 | TestFlight 2026-10-25: stronger compass beam |
| 1.1.0 | 8 | TestFlight 2026-10-25: navigation view ("Iniciar", map follows the user) |
| 1.1.0 | 9 | TestFlight 2026-10-25: routes never start in garages or tunnels, mountain trails on foot, thinner service roads |

Check App Store Connect for the current state before assuming the table is still true,
and update it here after each upload or review result.

## Before uploading

1. `npx tsc --noEmit && npx expo lint && npm test && npm run check:i18n`
2. `npm run e2e -- --build` (smoke). Before an App Store submission also
   `npm run e2e:full` and `npm run e2e:ipad` (look at the iPad screenshots), and the
   Android tour if shared code changed (`docs/E2E.md`).
3. Bump `ios.buildNumber` (and `android.versionCode`) always, `version` (+ `package.json`)
   for a new marketing version; then `npx expo prebuild` (+ `pod install` if it
   regenerated `ios/`) and check `CFBundleVersion` in `ios/NomadPocket/Info.plist`.
4. Update `docs/PROGRESS.md` (log entry) and the table above.

## Upload to App Store Connect (iOS)

```bash
KEY_ID=…; ISSUER_ID=…; KEY=~/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

xcodebuild archive -workspace ios/NomadPocket.xcworkspace -scheme NomadPocket \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath ios/build/NomadPocket.xcarchive -packageAuthorizationProvider netrc \
  DEVELOPMENT_TEAM=F3VY6C7GKX CODE_SIGN_STYLE=Automatic "${AUTH[@]}"

cat > ios/build/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>F3VY6C7GKX</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF

xcodebuild -exportArchive -archivePath ios/build/NomadPocket.xcarchive \
  -exportOptionsPlist ios/build/ExportOptions.plist -exportPath ios/build/export "${AUTH[@]}"
```

`signingStyle automatic` matters: there is no distribution certificate in the keychain,
and without it the export fails with `No "iOS Distribution" signing certificate`; with it
the API key gets a cloud-managed one. Everything goes under `ios/build/` (gitignored with `ios/`). After processing (~10–30 min) the build
appears in TestFlight. Export compliance is answered by `ITSAppUsesNonExemptEncryption =
false` in `app.json`.

## TestFlight

Internal group "Equipo" has access to every build; the owner is its tester. No external
testing so far.

## App Store listing

- Locales: es-ES, es-MX, en-US, en-GB. Free in 175 territories. Auto-release after
  approval. Age rating 12+ (medical information: infrequent). Privacy label: no data
  collected. Review contact: the owner's.
- **The owner reviews any listing change before it is sent to review.** Prepare it, show
  it, then submit.
- The App Store Connect API cannot create apps or edit privacy labels: those need the
  web UI, in the owner's own browser session.
- In-app requirements already met: Settings links to the privacy policy
  (`PRIVACY_URL` in `src/app/settings/index.tsx`); the assistant shows an AI / health
  disclaimer; medical archives show "information, not medical advice".

### Screenshots

Raw simulator captures go to `docs/store/screenshots/<lang>/<iphone|ipad>/NN-name.png`
(gitignored). `python3 scripts/store-screenshots.py` adds the headline (captions in the
script, es + en) and writes `docs/store/marketing/<lang>/<device>/` at App Store sizes:
iPhone 1320×2868, iPad 2064×2752. Current set: home, library, reader, map, assistant,
courses, reader dark, search.

## Privacy / support site

`site/` (`index.html`, `privacy.html`, `style.css`, icons) is deployed to GitHub Pages
by `.github/workflows/pages.yml` on every push to `main` that touches `site/**`. Keep the
privacy policy in line with what the app does (no accounts, no analytics, no data leaves
the device except content download requests).

## Android (not published)

Release builds are signed with the debug keystore (`android/app/build.gradle` generated by
prebuild). A Play release needs an upload keystore (configured through a config plugin or
EAS credentials, never committed), a Play listing
and its data-safety form.
