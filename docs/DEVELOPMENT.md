# Development

How to set up, build, run and check Nomad Pocket. Architecture is in
`ARCHITECTURE.md`, functional tests in `E2E.md`, store builds in `RELEASE.md`.

## Prerequisites (macOS)

- Node 22.6+ and npm (the repo uses `package-lock.json`; `npm test` needs
  `--experimental-strip-types`).
- Xcode 26+ with an iOS 27 simulator runtime (Apple Intelligence works there, not on
  26.5). CocoaPods comes with `expo prebuild`/`run:ios`.
- Android Studio (SDK, NDK, emulator `Pixel_API_36`). Gradle needs its bundled JDK:
  `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Optional: Maestro 2.x (`brew install mobile-dev-inc/tap/maestro`) + `openjdk` for E2E,
  `axe` for iOS simulator UI automation, Python 3 + Pillow for store screenshots.

## Install

```bash
npm install
```

- `postinstall` runs `modules/nomad-zim/scripts/fetch-ios-libs.sh`: downloads the pinned
  libkiwix xcframework (14.2.1-2, md5-checked, ~200 MB unpacked) into
  `modules/nomad-zim/ios/Frameworks/` (gitignored). Skipped off macOS or with
  `NOMAD_ZIM_SKIP_FETCH=1`.
- `prepare` sets `git config core.hooksPath .githooks` (pre-commit: tsc, lint, unit
  tests, i18n). Skip once with `git commit --no-verify`.

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

On a physical iPhone: open `ios/NomadPocket.xcworkspace` in Xcode, select team
`F3VY6C7GKX` with automatic signing, or build from the command line with
`DEVELOPMENT_TEAM=… CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates`.

## Checks

| Command | What | When |
|---|---|---|
| `npx tsc --noEmit` | typecheck | always (pre-commit) |
| `npx expo lint` | ESLint, `eslint-config-expo` flat config | always (pre-commit) |
| `npm test` | unit tests, `node --test --experimental-strip-types "src/**/*.test.ts"` | always (pre-commit) |
| `npm run check:i18n` | every `t('…')` key exists in `es` and `en`, same plural/template keys | always (pre-commit) |
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
  → `Documents/content/…`, `Documents/SQLite/nomad.db` (open it with `sqlite3`). Drop a
  `.zim` into `Documents/content/zim/` or a `.pmtiles` (named after a region id) into
  `Documents/content/maps/` and relaunch: they are registered at startup.
- Re-run the setup wizard: Settings → "Asistente de configuración", or reinstall.
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
  use iOS 27. Gemini Nano needs a real AICore device (untested so far).
- `xcodebuild` builds for a simulator need `ios/` from `npx expo prebuild`; the E2E runner
  builds `ios/build/sim/…/NomadPocket.app` itself when it is missing.
