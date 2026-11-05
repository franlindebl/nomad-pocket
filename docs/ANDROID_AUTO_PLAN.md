# Android Auto navigation — plan

Asked for by the owner on 2026-11-05, after CarPlay shipped in 2.2.0 (`docs/CARPLAY_PLAN.md`). Same product as
CarPlay: **navigation only** in the car (the offline map, turn-by-turn, arrival estimates, voice), destinations from
saved places, Emergencias cerca and the offline search. Android Automotive (the OS built into some cars) is a
separate product and is left for later.

## What carries over

- **JS: all of it.** `src/features/carplay/` talks to the native module through calls with nothing Apple in them
  (`setStrings`, `setStyles`, `setRoute`, `update`, `alert`, `answer`; events `onConnect`, `onDisconnect`,
  `onRequest`, `onPick`, `onStart`, `onEnd`). The Android side of `modules/nomad-carplay` implements the same
  module (`NomadCarPlay`), so the same JS drives both cars: no new data paths.
- **Voice** (`modules/nomad-voice`, navigation-guidance audio with transient ducking: the car lowers its audio for
  the prompts) and **background guidance** (`modules/nomad-location`'s foreground service) already ship on Android.
- **Rules:** the Car App Library (`androidx.car.app`) is AndroidX, Apache-2.0, with no Google Play services in it,
  so it doesn't break the no-GMS rule next to libkiwix. The Android Auto app is Google's, but on the user's phone,
  not in our APK. The health gate keeps applying: `HEALTH_FEATURES` already drops the health category from
  Emergencias cerca on Android (`carplay.ts`), and hospitals and pharmacies are general utility for Play
  (`docs/ANDROID_PLAY.md`).

## Design (Android side of `modules/nomad-carplay`)

| iOS (CarPlay) | Android (Android Auto) |
|---|---|
| `CarPlaySceneDelegate` | `NomadCarAppService` (category `androidx.car.app.category.NAVIGATION`) + `NomadCarSession` |
| `CarPlayHub` | `CarHub`: keeps what JS sent, replays it when the car connects, request/answer for lists |
| `CarMapViewController` (`MLNMapView` in the `CPWindow`) | `CarMap`: the host gives a **Surface**, not a view. A `VirtualDisplay` on it shows a `Presentation` holding a MapLibre `MapView` (same style JSON, route, destination and user layers, same camera rules; the visible area the host reports instead of the safe area) |
| `CPMapTemplate` + `CPNavigationSession` | `NavigationTemplate` (action strip: Destinos, or Ir / Terminar; map strip: pan, zoom, recentre), `RoutingInfo` (step, distance, next step), `TravelEstimate`, `NavigationManager.navigationStarted/Ended` (the cluster and the host's audio follow it) |
| `CPListTemplate`, `CPSearchTemplate` | `ListTemplate` (Destinos, Emergencias cerca, results), `SearchTemplate` |
| `CPTrip` preview | First: `NavigationTemplate` with the route framed and "Ir". Then `RoutePreviewNavigationTemplate` (route choice with time and distance) |
| SF Symbols for maneuvers | Own icons per maneuver (Lucide, as the app), mapped from routing-core's `ManeuverIcon` to `Maneuver.TYPE_*` |
| `CarPlayBoot` (React Native started from the car) | Opened from the car with the app closed, only the process starts: start React Native's host from the session (no activity) so JS answers |
| `plugins/with-carplay.js` | `plugins/with-android-auto.js`: off by default like CarPlay was (the module out of Android autolinking, so no service, permissions or Car App Library); `automotive` adds what Android Automotive needs |

Host validation: debug builds accept any host (the Desktop Head Unit); release builds only the hosts in the
library's allowlist (Android Auto, Android Automotive).

## Phases

1. **Spike: the map on the car's surface** (2026-11-05, **done**, on the Android Automotive emulator). MapLibre in
   a `Presentation` on a `VirtualDisplay` draws the offline style JS builds (SurfaceView, no texture mode needed;
   `file://` and `pmtiles://` URLs work) and the host's templates go on top. Checked: map at street level following
   the user, Destinos › Emergencias cerca (no Salud on Android) › list, Buscar with the car keyboard › result ›
   route computed by JS (Valhalla, offline) and framed with Go / Cancel, arrival, minutes and distance › Go: the
   maneuver card, the next step, the estimate, the camera low on the screen › End: back to the map.
   Learned there (in the code's comments too):
   - Every template replaces the host's buttons, and a tap that lands meanwhile is lost: the map screen
     invalidates only when what it shows changed (JS sends guidance on every fix).
   - Two templates close together make the host delay the second ("too many refreshes in a short span of time");
     the search has no loading state (it answers in tens of ms) and refreshes once more after 1.5 s.
   - While navigating the host hides the action strip after a few seconds; the first tap only shows it again.
2. **Trip**: preview with time and distance, maneuver icons, estimates, reroute, arrival, "Terminar" both ways,
   the phone and the car in step (as CarPlay's checks in `docs/CARPLAY_PLAN.md`).
3. **Opened from the car with the app closed** (React Native without an activity), day/night, the car's own
   "stop navigation", `geo:` / `NAVIGATE` intents from the car's assistant (optional).
4. **Switch and tests**: `with-android-auto.js` (off by default), an `e2e:androidauto` script on the Desktop
   Head Unit if its console commands allow it (taps, screenshots), docs (E2E.md, ARCHITECTURE.md).
5. **Release**: only once the app is in production on Play. Play Console › Advanced settings › Form factors ›
   Android Auto (opt in), and Google's car app quality review. Store listing text and a car screenshot, reviewed by
   the owner first.

## Testing

- **Android Automotive emulator (what is used, all local).** Play says Android Auto "isn't compatible" with the
  phone emulator (`Pixel_API_36` only has the stub `1.2.551000-stub`), so the Desktop Head Unit has nothing to talk
  to there. The Automotive image with Google Play carries Google's templates host, which draws the same templates:
  - AVD `NP-auto-34`: `system-images;android-34-ext9;android-automotive-playstore;arm64-v8a`, device
    `automotive_1024p_landscape`, `hw.keyboard=yes`.
  - Build: `ANDROID_AUTOMOTIVE=1 npx expo prebuild --platform android` (`with-android-auto.js`: the
    `app-automotive` artifact, `CarAppActivity` as a launcher entry, minSdk override), then the release APK. For
    `run-as` (to seed fixtures) mark the generated release build type `debuggable true` locally (never committed).
  - The driver is Android **user 10**: `pm grant --user 10 com.fjlinde.nomadpocket android.permission.ACCESS_FINE_LOCATION`,
    `cmd location set-location-enabled true --user 10` (off on a new image), `run-as com.fjlinde.nomadpocket --user 10 …`.
  - Seeding Andorra: copy `e2e/fixtures/maps/ad.pmtiles` to `files/content/maps/` and the routing fixtures to
    `files/content/routing/`. Loose files register the map and pack, but the pack's emergency points and places
    are not imported (only a download does that), so the emergency lists come out empty and search finds only the
    tiles' towns; the phone suite downloads from the local catalogs for that reason (`car-00-prepare`).
  - Open `MainActivity` first (React Native starts; opening from the car with the app closed is phase 3), then
    `am start -n com.fjlinde.nomadpocket/androidx.car.app.activity.CarAppActivity`. GPS: `adb emu geo fix <lon> <lat>`.
    Screenshots: `adb exec-out screencap -p -d <id>` with the main display's id (`dumpsys SurfaceFlinger --display-id`);
    taps with `adb shell input tap` in that display's pixels (1024×768).
  - Don't `force-stop` the app while the car shows it: Google's templates host crashes ("Accessed the car host
    after it became invalidated") and the next start recovers.
- **Android Auto proper** (projected from a phone) still needs a real phone: Android Auto from Play, developer mode
  (tap its version ten times), ⋮ › Start head unit server, "Unknown sources", `adb forward tcp:5277 tcp:5277` and the
  Desktop Head Unit (`extras;google;auto`, installed). Before release, once.
- Unit tests: `androidx.car.app:app-testing` (TestCarContext, ScreenController) if the screens grow logic.

## Not decided yet

- Rename `nomad-carplay` / `NomadCarPlay` to a neutral name (`nomad-car`) once both platforms work: cosmetic, it
  touches the iOS plugin's autolinking exclusion, so not during the spike.
- Android Automotive (built-in): its own distribution and the templates host the car must have.

## Status

See `docs/PROGRESS.md` (Android Auto entries).
