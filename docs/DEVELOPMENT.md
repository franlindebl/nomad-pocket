# Development

How to set up, build, run and check Nomad Pocket. Architecture is in
`ARCHITECTURE.md`, functional tests in `E2E.md`, store builds in `RELEASE.md`.

## Prerequisites (macOS)

- Node 22.6+ and npm (the repo uses `package-lock.json`; `npm test` needs
  `--experimental-strip-types`).
- Xcode. The iOS 27 simulator runtime that comes with Xcode 27 is needed for Apple
  Intelligence (it fails on 26.5) and for the E2E suite (`scripts/e2e-setup.sh` creates its
  simulators on the iOS 27.0 runtime); plain builds and the unit tests also work with Xcode 26.
  CocoaPods comes with `expo prebuild`/`run:ios`.
- Android Studio (SDK, NDK, emulator `Pixel_API_36`). Gradle needs its bundled JDK:
  `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Optional: Maestro 2.x (`brew install mobile-dev-inc/tap/maestro`) + `openjdk` for E2E,
  `axe` for iOS simulator UI automation, Python 3 + Pillow for store screenshots.

## Install

```bash
npm install
```

- `postinstall` runs `scripts/postinstall.mjs` (no bash needed; it skips both iOS fetches off
  macOS): `modules/nomad-zim/scripts/fetch-ios-libs.sh` downloads the pinned
  libkiwix xcframework (14.2.1-2, sha256-checked, ~200 MB unpacked) into
  `modules/nomad-zim/ios/Frameworks/` (gitignored). Skipped with
  `NOMAD_ZIM_SKIP_FETCH=1`. Then `modules/nomad-route/scripts/fetch-ios-libs.sh`: the
  Valhalla routing engine (Rallista valhalla-mobile 0.6.4 xcframework, ~22 MB download,
  + `tzdata.tar`, sha256-checked) into `modules/nomad-route/ios/Frameworks/`
  (`NOMAD_ROUTE_SKIP_FETCH=1` skips it). Android gets it from Maven Central.
- Routing packs for testing: `scripts/routing/build-country.sh <country> <dir>` builds a
  country's packs. Only the Valhalla calls run in Docker (`ghcr.io/valhalla/valhalla:3.9.1`); the host
  also needs `python3`, `osmium-tool` and `pyosmium` (and, for maps, `go-pmtiles` and `shapely`),
  or run the whole script inside the image as CI does. Andorra takes a minute, Spain ~15 min and
  ~10 GB disk. Copy a `.tar` into the app's `Documents/content/routing/`
  (simulator) and it registers at startup.
- `prepare` (`scripts/git-hooks.mjs`) sets `git config core.hooksPath .githooks` only when no
  hooks path is set (an existing one is left alone) (pre-commit: tsc, lint, unit tests, i18n).
  Skip once with `git commit --no-verify`.
- After any dependency change run `node scripts/licenses.mjs` (regenerates
  `src/data/licenses.json`, the Credits screen; `--check` fails if it is stale). When you bump a
  fetch script, podspec or Gradle version of a native library, update
  `scripts/licenses/native.json` too.

## Native projects

`ios/` and `android/` are generated (Continuous Native Generation) and gitignored. Create
or refresh them with `npx expo prebuild` (`--clean` to regenerate from scratch); `npx
expo run:ios|android` does it when they are missing. Native configuration belongs in
`app.json` (plugins: expo-router, splash, fonts, sqlite, localization, location,
MapLibre, `llama.rn` with OpenCL/Hexagon, build-properties iOS 16.4 / minSdk 26) and in
the local modules under `modules/`.

Prebuild may regenerate both folders from scratch (always with `--clean`, and when the
config changed), which deletes anything set by hand there and `ios/build/` (the E2E
simulator app, archives): run `cd ios && pod install` afterwards, or prebuild without
`--no-install`. Versions and build numbers come from `app.json` (`docs/RELEASE.md`).

## Run

Development (Metro + dev client):

```bash
npx expo run:ios                 # builds the dev client and opens the simulator
npx expo run:android             # same for the emulator / a USB device
npm start                        # Metro only, for an already installed dev client
```

Expo Go does not work: the app needs its own native modules (nomad-zim, nomad-llm,
llama.rn, MapLibre).

Release build on the iOS simulator (what the E2E suite and most manual checks use — no
Metro, real startup speed):

```bash
xcodebuild -workspace ios/NomadPocket.xcworkspace -scheme NomadPocket \
  -configuration Release -sdk iphonesimulator -derivedDataPath ios/build/sim \
  -packageAuthorizationProvider netrc build
xcrun simctl install booted ios/build/sim/Build/Products/Release-iphonesimulator/NomadPocket.app
xcrun simctl launch booted com.fjlinde.nomadpocket
```

Release APK for the emulator (signed with the debug keystore; no Play signing yet):

```bash
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

On a physical iPhone you need your own Apple team *and your own bundle id*:
`com.fjlinde.nomadpocket` is registered to the maintainer, so another team can't sign it. Locally
change `ios.bundleIdentifier` in `app.json` (don't commit that), run `npx expo prebuild`, open
`ios/NomadPocket.xcworkspace` in Xcode and select your team with automatic signing, or build from
the command line with `DEVELOPMENT_TEAM=<your team> CODE_SIGN_STYLE=Automatic
-allowProvisioningUpdates`. llama.rn's extended-virtual-addressing and increased-memory-limit
entitlements are only added to production builds (`NODE_ENV=production`), and whether a free
developer account can provision them is untested. The maintainer uses team `F3VY6C7GKX`
(maintainer only). Simulator and emulator builds need no account.

## Checks

| Command | What | When |
|---|---|---|
| `npx tsc --noEmit` | typecheck | always (pre-commit) |
| `npx expo lint` | ESLint, `eslint-config-expo` flat config | always (pre-commit) |
| `npm test` | unit tests, `node --test --experimental-strip-types "src/**/*.test.ts"` | always (pre-commit) |
| `npm run check:i18n` | every `t('…')` key exists in `es` and `en`, same plural/template keys; also prints an informational list of unused keys | always (pre-commit) |
| `node scripts/licenses.mjs --check` | the committed `src/data/licenses.json` matches `package-lock.json` and `scripts/licenses/native.json` | after dependency changes, before a store build |
| `npm run check:catalog` | catalog schema + every download URL and size (`-- --offline` for schema only) | after editing `catalog.json` |
| `PMTILES_NETWORK=1 npm test` | adds a live extract against build.protomaps.com | after touching `src/lib/pmtiles` |
| `npm run e2e` (`-- --build`) | Maestro smoke suite on the iOS simulator | before every TestFlight build |
| `npx expo-doctor` | dependency/config sanity | after dependency changes |

Unit tests import with `.ts` extensions and no `@/` aliases (Node loads them directly).

## Debugging

- iOS simulator logs: `xcrun simctl spawn booted log stream --predicate 'process == "NomadPocket"'`;
  JS `console.*` shows there in Release builds too.
- Android: `adb logcat | grep -E "ReactNativeJS|nomad|kiwix|AndroidRuntime"`.
- Simulator app data: `xcrun simctl get_app_container booted com.fjlinde.nomadpocket data`
  → `Documents/content/…`; the databases are in `Library/Application Support/SQLite/nomad.db` (user data;
  open it with `sqlite3`) and `Documents/content/index/search.db` (map search index and emergency points). Drop a
  `.zim` into `Documents/content/zim/` or a `.pmtiles` (named after a region id) into
  `Documents/content/maps/` and relaunch: they are registered at startup.
- Re-run the setup wizard: Settings → "Revisar descargas recomendadas" ("Review recommended downloads"), or reinstall.
- UI automation: Maestro (`maestro --device <udid> hierarchy`, `maestro studio`) or `axe`
  on iOS; `adb shell uiautomator dump` + `adb shell input tap x y` on Android.
- Deep links: `xcrun simctl openurl booted "nomadpocket:///library/resource/<id>"`
  (scheme `nomadpocket`, any route works).

## Build gotchas

- **xcodebuild hangs at "Resolve packages"** (MapLibre is a SwiftPM binary): SwiftPM
  waits on a macOS Keychain prompt for github.com credentials. Always pass
  `-packageAuthorizationProvider netrc`; for `swift package` use `--disable-keychain`.
- Android builds need `JAVA_HOME` pointing at Android Studio's JBR (above).
- Android `libc++_shared.so` is shared between React Native and libkiwix (one copy wins);
  it works with the current versions — recheck after upgrading either.
- `llama.rn` is a release candidate (0.13.0-rc.8): `stopCompletion()`/`release()` may not
  return promises, so don't chain `.catch` on them directly (`engine.ts` wraps them).
- Apple Intelligence fails every request on the iOS 26.5 simulator (`GenerationError -1`):
  use iOS 27. (Android's Gemini Nano bridge is being removed: the Android assistant uses downloadable models only.)
- `xcodebuild` builds for a simulator need `ios/` from `npx expo prebuild`; the E2E runner
  builds `ios/build/sim/…/NomadPocket.app` itself when it is missing.
