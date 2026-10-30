# Release

How Nomad Pocket gets to TestFlight and the App Store. Builds are made and uploaded
locally with `xcodebuild` (no EAS). Android: signed AABs built locally with Gradle, not on Play yet (section Android).

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
(`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`); its key id and issuer id are kept
privately by the maintainer, never in git.

## Versions

Everything lives in `app.json`; `ios/` and `android/` get it from `npx expo prebuild`.

- Marketing version: `expo.version` (currently **1.1.0**). Keep `package.json`'s
  `version` equal (not used by the build, but it's what people read).
- iOS build number: `expo.ios.buildNumber` (currently **"23"**) → `CFBundleVersion`. Bump it
  for every upload: App Store Connect rejects a build number it has already seen.
- Android: `expo.android.versionCode` (currently **24**; 23 and 24 went to Play internal testing). Must grow
  with every Play upload.
- After changing any of them, run `npx expo prebuild` (it can regenerate `ios/` and
  `android/` from scratch: then `cd ios && pod install`).

| Version | Build | State (2026-10-27) |
|---|---|---|
| 1.0.0 | — | prepared, superseded by 1.0.1 |
| 1.0.1 | 3 | submitted to App Review 2026-10-24; reviewed 2026-10-27 as Guideline 2.1(b) Information Needed (business model); never released: its version record became 1.1.0 |
| 1.0.2 | 4 | uploaded to TestFlight 2026-10-24 (`51fbe2a`) |
| 1.1.0 | 5 | TestFlight 2026-10-25: map search, Emergencias, offline road routing, Preparedness, conversational assistant |
| 1.1.0 | 6 | TestFlight 2026-10-25: whole-country routing packs, street search from the packs, compass beam |
| 1.1.0 | 7 | TestFlight 2026-10-25: stronger compass beam |
| 1.1.0 | 8 | TestFlight 2026-10-25: navigation view ("Iniciar", map follows the user) |
| 1.1.0 | 9 | TestFlight 2026-10-25: routes never start in garages or tunnels, mountain trails on foot, thinner service roads |
| 1.1.0 | 10 | TestFlight 2026-10-25: search finds nearby schools and shops, street addresses ("Calle Alcalá 50") and abbreviations |
| 1.1.0 | 11 | TestFlight 2026-10-26: survival-kit redesign (country downloads with everything, new onboarding and Home, 4 tabs, bundled world map), every place and house number in the packs |
| 1.1.0 | 12 | TestFlight 2026-10-26: a country is one download (one row, one notice), the Maps tab shows a country on its way, onboarding buttons off the screen's edge, friendlier download errors, "couldn't check" vs "no navigation" |
| 1.1.0 | 13 | TestFlight 2026-10-26: pre-release audit fixes (reader without network, Wi-Fi-only enforced, safer downloads and storage, credits & licences screen, data out of the Files app and backups of re-downloadable data, OSM credit, guidance auto-stop, translated permission prompt), multi-pack countries (USA) |
| 1.1.0 | 14 | TestFlight 2026-10-27: faster downloads (segmented multi-mirror engine, mirrors ranked by throughput, adaptive connection budget, per-piece checks, resume after the app is killed), screen kept on while downloading, steadier download rows |
| 1.1.0 | 15 | TestFlight 2026-10-27: many downloads at once (up to 6, a kit no longer waits behind a country map), small archives start without re-probing mirrors, the map asks for the location and starts on the user, USA routing packs |
| 1.1.0 | 16 | TestFlight 2026-10-27: fix for the app being killed while "Preparando" a big download (sha-256 and file copies native, `modules/nomad-files`), the USA as regional maps |
| 1.1.0 | 17 | uploaded 2026-10-27 by mistake with another session's unfinished map-search edits in its JS bundle (archived from a shared working tree): don't use, expire it |
| 1.1.0 | 18 | TestFlight 2026-10-27: downloads tuned on a real iPhone (setup kit 20.7 GB in ~6:30 instead of 13 min, the country's map first, in-process sessions while the app is open, stall watchdog); a country's search and emergency points prepared as the end of its download ("Preparando… %", no freeze or wait when search opens); archived from a clean worktree of the release commit |
| 1.1.0 | 19 | TestFlight 2026-10-27: document collections (medical, water, knots…) as a native list with search, PDFs open on Android, a legend and switches for the map's emergency dots, a red SOS button |
| 1.1.0 | 20 | TestFlight 2026-10-27: dictation in the assistant (on-device speech recognition, never sent), a more capable installed model becomes the default, an answer keeps going while you open another chat; navigation view: the route is consumed behind the arrow, the map turns with your last metres, smooth camera, "Norte arriba" button; Canada and Russia as regional maps |
| 1.1.0 | 21 | TestFlight 2026-10-27: build 20 plus `NSPhotoLibraryUsageDescription` (App Store Connect flagged build 20 with ITMS-90683: expo-image and expo-file-system's legacy module link the Photos framework; the app never asks for the photo library) |
| 1.1.0 | 22 | TestFlight 2026-10-27: search results name the right neighbourhood (Calle de Alcalá no longer "· Nudo Sur"), first aid opens in the app's language (Wikipedia Médica at "Primeros auxilios"), the assistant goes straight to the answer and finds articles named after the question, no empty image boxes in image-less archives
| 1.1.0 | 23 | TestFlight 2026-10-28: the assistant finds its sources in English libraries (Apple's router no longer translates queries into Spanish, English noise words dropped, articles looked up by exact title) and keeps small talk out of answers with sources; **submitted to App Review 2026-10-28** (same submission as 1.0.1, after the owner's 2.1(b) reply; new listing `docs/store/listing-1.1.0.md`, auto-release after approval)

Check App Store Connect for the current state before assuming the table is still true,
and update it here after each upload or review result.

## Before uploading

Archive from a tree that holds exactly the commit: Metro bundles whatever is in the working tree,
so another session's uncommitted edits ship too (build 17). With other work in the checkout,
archive from a clean `git worktree` of the commit (`npm ci`, `NOMAD_STORE_BUILD=1 npx expo prebuild --platform ios`).

1. `npx tsc --noEmit && npx expo lint && npm test && npm run check:i18n` and
   `node scripts/licenses.mjs --check` (the Credits screen data is current).
2. `npm run e2e -- --build` (smoke). Before an App Store submission also
   `npm run e2e:full` and `npm run e2e:ipad` (look at the iPad screenshots), and the
   Android tour if shared code changed (`docs/E2E.md`).
3. Bump `ios.buildNumber` (and `android.versionCode`) always, `version` (+ `package.json`)
   for a new marketing version; then `NOMAD_STORE_BUILD=1 npx expo prebuild` (+ `pod install` if it
   regenerated `ios/`; see the store prebuild note below) and check `CFBundleVersion` in `ios/NomadPocket/Info.plist`.
4. Update `docs/PROGRESS.md` (log entry) and the table above.
5. After the archive, check the generated `Info.plist` of the archived app: the localised
   location string (from `locales/`) is there, and no dev-launcher keys leaked in (`exp+` URL scheme,
   `RCTMetroPort`, `NSAllowsLocalNetworking`, `NSBonjourServices`).
6. **Tag every store build** (for example `v1.1.0-12`, the version and build number) on the
   commit it was built from and push the tag, so the corresponding source is identifiable (GPL
   section 6). Do it right after the upload.

**Store prebuild.** The generated `Info.plist` and the main `AndroidManifest.xml` are shared by Debug and
Release, so a plain prebuild carries the dev client's leftovers. `plugins/with-store-build.js` removes them
when `NOMAD_STORE_BUILD=1` (iOS: the `exp+nomad-pocket` URL scheme, `RCTMetroPort`, `NSAllowsLocalNetworking`,
`NSBonjourServices`, `NSLocalNetworkUsageDescription`; Android: the `exp+nomad-pocket` intent-filter scheme;
the `src/debug` manifest only applies to debug builds). Use it for every archive that goes to a store, and
**never** for dev builds or `npm run e2e`: the E2E Release builds read their manifests over plain http from
localhost (`scripts/e2e.sh`), which needs `NSAllowsLocalNetworking`. Switching between the two needs
`npx expo prebuild --clean`, because prebuild merges into the existing `ios/`.

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
- **Listing changes are reviewed by the maintainer before they are sent to review.** Prepare
  them, show them, then submit.
- The App Store Connect API cannot create apps or edit privacy labels: those need the
  web UI, in the owner's own browser session.
- In-app requirements already met: Settings links to the privacy policy
  (`PRIVACY_URL` in `src/app/settings/index.tsx`) and to Credits & licenses; the assistant
  shows an AI / health disclaimer; medical archives show "information, not medical advice" (also
  Explore and imported archives, by a heuristic, `library/medical.ts`); the map shows the
  OpenStreetMap credit.

### Screenshots

Raw simulator captures go to `docs/store/screenshots/<lang>/<iphone|ipad>/NN-name.png`
(gitignored). `python3 scripts/store-screenshots.py` adds the headline (captions in the
script, es + en) and writes `docs/store/marketing/<lang>/<device>/` at App Store sizes:
iPhone 1320×2868 (iPhone 17 Pro Max simulator), iPad 2064×2752 (iPad Pro 13-inch).

Google Play (Android): `android` captures from an emulator (pixel_6 AVD `Nomad_Shots`, 1080×2400, SystemUI demo
mode for the status bar) composed at 1080 × 1920 (Play refuses a long side over twice the short one); same
eight screens and kits as iOS (2026-10-29), assistant with the downloaded Qwen3.5 2B. The script also writes
Play's 512 px icon and the 1024 × 500 feature graphics (`docs/store/play/`).

Current set (2026-10-27, for 1.1.0; texts in `docs/store/listing-1.1.0.md`): home, emergency, route,
first aid, assistant, family plan, library, kit (iPhone only). Spanish shots use the Spain kit in Madrid,
English ones the US Northeast kit in New York, each on a simulator in that language and region, with
fictional family-plan data (555 numbers in English). Screens with the map (`route`, `emergency`) get
"© OpenStreetMap contributors" under the phone from the script: the in-app credit fades after five
seconds. How they were made: a store Release build for the simulator with the real catalogs (no
`EXPO_PUBLIC_*_MANIFEST_URL`), the kit downloaded once per language and cloned into the iPad's app
container (`cp -c`), `simctl status_bar` at 9:41 (the route shots at the time that matches their
arrival), `axe` taps and pasted text (`simctl pbcopy` + Cmd-V: `axe type` can't type accents).

## Privacy / support site

`site/` (`index.html`, `privacy.html`, `style.css`, icons) is deployed to GitHub Pages
by `.github/workflows/pages.yml` on every push to `main` that touches `site/**`. Keep the
privacy policy in line with what the app does (no accounts, no analytics, no data leaves
the device except content download requests and the catalog checks). Update its "Last updated" date
whenever the policy changes, in both languages, and re-check the host list against
`docs/ARCHITECTURE.md` (External services).

## Android (Google Play)

Play Console: personal developer account 5502748653724108225 (it also holds Theri.App and Semáforo
del Sueño); Nomad Pocket is app 4972946077817579435, created 2026-10-29. **1.1.0 (versionCode 23) on
internal testing since 2026-10-29** (tag `v1.1.0-android-23` on fc268d6, the commit it was built from;
testers: email list "Nomad Pocket interno", the owner's two accounts; join link
https://play.google.com/apps/internaltest/4700702884318545923). **1.1.0 (24) on closed testing**
(track "Prueba cerrada - Alpha", the account's "Friends and family" list of 19 addresses, also Theri.App's;
all countries), sent to Google's review on 2026-10-29 with the listings and App content forms (tag
`v1.1.0-android-24` on 10a265b) and **rejected** the same day: health apps need an organization account.
Android builds have no health features since then (`src/lib/health.ts`; what changed and why in
`docs/store/play-listing.md`, "Health features on Android"). A new app in this
account needs a **closed test with at least 12 opted-in testers for 14 days in a row** before it can
apply for production. Listing texts, graphics and every form's answers: `docs/store/play-listing.md`.

**Signing.** Play App Signing holds the app signing key; we sign uploads with the **upload key**,
`~/.android-upload/nomadpocket-upload.jks` (PKCS12, alias `upload`, created 2026-10-29; its certificate
is `nomadpocket-upload-cert.pem` next to it, SHA-256 `FE:91:1E:57:…:08:58`). Its password and path are in
`~/.gradle/gradle.properties` (`NOMAD_UPLOAD_STORE_FILE`, `NOMAD_UPLOAD_STORE_PASSWORD`,
`NOMAD_UPLOAD_KEY_ALIAS`, `NOMAD_UPLOAD_KEY_PASSWORD`). Neither is ever committed; keep a copy of both
in the owner's password manager. A lost upload key can be reset from Play Console (Setup › App
integrity), which takes days. `plugins/with-store-build.js` signs release builds with it when
`NOMAD_STORE_BUILD=1`, and a store release build without those properties fails. Builds without the
variable (dev, E2E) stay signed with the debug key, so a store build and an E2E build can't replace
each other on a device without `adb uninstall`.

**Build an upload** (from a tree that holds exactly the commit, as for iOS):

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
NOMAD_STORE_BUILD=1 npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew :app:bundleRelease)       # android/app/build/outputs/bundle/release/app-release.aab
```

Then check it: `keytool -printcert -jarfile <aab>` shows the upload certificate's SHA-256;
`bundletool dump manifest --bundle=<aab>` lists only the permissions the app uses (location, network,
notifications and boot for the kit reminders, microphone, vibrate: no `SYSTEM_ALERT_WINDOW` and no
storage permissions, which `android.blockedPermissions` in `app.json` removes); `bundletool build-apks`
+ `bundletool get-size total --dimensions=ABI` gives the download size (1.1.0: arm64 ~90 MB, x86_64
~66 MB; Play's limit is 200 MB). Upload the AAB in Play Console (internal test first), then tag the
commit as for iOS (`v1.1.0-23` is shared when the iOS and Android builds come from the same commit;
otherwise tag `v<version>-android-<versionCode>`).

**ABIs.** Only `arm64-v8a` and `x86_64` (`expo-build-properties` `android.buildArchs`): llama.rn
ships no 32-bit libraries, so a 32-bit phone would install an app whose assistant can't load. Play then
doesn't offer the app to 32-bit-only devices.

**Native libraries and 16 KB pages.** Play requires 16 KB page support (Android 15+ targets). Every
`.so` of the 1.1.0 build has 16 KB-aligned LOAD segments and the APK passes `zipalign -c -P 16`;
re-check after updating libkiwix, valhalla-mobile, llama.rn or MapLibre:
`llvm-objdump -p <lib>.so | grep LOAD` (alignment `2**14` or more).

**AI-generated content.** Play's policy asks for a way to report offensive AI output inside the app:
each finished answer has "Report answer" (flag icon, Android only: the App Store doesn't ask for it), which opens the user's mail app with the answer
(`features/assistant/report-core.ts`).

**TODO before any Play release** (owner decision 2026-10-26, details in `docs/PROGRESS.md`):
ML Kit GenAI (Gemini Nano) is removed and Firebase is kept out of the APK
(`plugins/with-android-no-firebase.js`; re-check it after an expo-notifications update), so the app
has no third-party analytics-capable SDK. The full transitive Android notice set is in Credits
(Android libraries, Android builds only) since 2026-10-28: `node scripts/licenses/android-deps.mjs`
(after `npx expo prebuild --platform android`) lists every Maven artifact of the release runtime classpath
with its POM licence into `scripts/licenses/android.json`, then `node scripts/licenses.mjs`; re-run both
after a dependency or SDK change. Since 2026-10-29 (owner's decision, option A) none of them is
proprietary: the five that were (Android SDK terms) are gone. play-services-location/base/basement/tasks
came only from expo-location (MapLibre adds them only with `locationEngine=google`, not set): Android
location is `modules/nomad-location` and expo-location is out of Android autolinking (`package.json`).
`com.android.installreferrer` (expo-application, via expo-notifications; never called) is excluded by
`plugins/with-android-no-install-referrer.js`. The dex still names `com.google.android.gms.tasks` and the
referrer classes from code that never runs (expo-notifications' push token, expo-application's referrer):
R8 `-dontwarn`s them; check `./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -i
'gms\|installreferrer'` is empty after an Expo update. The Data safety answers that match
`site/privacy.html` are in `docs/store/play-listing.md`.
