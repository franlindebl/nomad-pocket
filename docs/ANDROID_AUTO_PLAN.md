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
| `plugins/with-carplay.js` | `plugins/with-android-auto.js`: the service, permissions (`NAVIGATION_TEMPLATES`, `ACCESS_SURFACE`) and `automotive_app_desc` only when enabled, off by default like CarPlay was |

Host validation: debug builds accept any host (the Desktop Head Unit); release builds only the hosts in the
library's allowlist (Android Auto, Android Automotive).

## Phases

1. **Spike: the map on the car's surface** (2026-11-05). Service, session, `CarMap`, the map screen and the
   Destinos lists, the module bridge. Risk being checked: MapLibre in a `Presentation` on a `VirtualDisplay`
   (SurfaceView vs. texture mode, the offline style's `file://` and `pmtiles://` URLs, frame rate).
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

- **Desktop Head Unit (DHU)**: `extras;google;auto` in the SDK (`~/Library/Android/sdk/extras/google/auto/desktop-head-unit`).
  It needs the real **Android Auto app** on the emulator or phone: the `Pixel_API_36` image only has a stub
  (`1.2.551000-stub`) that downloads it from Play, so someone signs in to Play on the emulator once and updates it
  (the owner: an agent never enters credentials). Then in Android Auto: tap the version ten times (developer mode),
  ⋮ › Start head unit server, and "Unknown sources" so an app not installed from Play shows;
  `adb forward tcp:5277 tcp:5277` and run the DHU.
- A physical Android phone with Android Auto over USB works the same way.
- Unit tests: `androidx.car.app:app-testing` (TestCarContext, ScreenController) if the screens grow logic.

## Not decided yet

- Rename `nomad-carplay` / `NomadCarPlay` to a neutral name (`nomad-car`) once both platforms work: cosmetic, it
  touches the iOS plugin's autolinking exclusion, so not during the spike.
- Android Automotive (built-in): its own distribution and the templates host the car must have.

## Status

See `docs/PROGRESS.md` (Android Auto entries).
