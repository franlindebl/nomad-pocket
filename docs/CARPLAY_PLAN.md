# CarPlay navigation — plan

Approved by the owner on 2026-10-31 (night). Builds on "CarPlay — analysis" in
`docs/MAPS_NAVIGATION_PLAN.md` (2026-10-25). Built on the `carplay` branch, merged into `main` on 2026-10-31
with **CarPlay switched off** (owner's call): voice and background navigation ship for the phone, the CarPlay
code waits in the repo for the entitlement.

## Decisions (owner)

- **Navigation only.** In the car: the offline map with the route, turn-by-turn, ETA; destinations
  from **saved places**, **Emergencias cerca** and **search** over the offline index. Nothing else
  of the app (library, assistant…) goes to CarPlay.
- **Prerequisites first, for the phone too, on iOS and Android:** spoken prompts and navigation
  that keeps going with the screen locked / the app in the background.
- **The entitlement** (`com.apple.developer.carplay-maps`) is requested by the owner (draft text at
  the end). Until Apple grants it, CarPlay is built and tested in the Xcode simulator only.

## Phase 1 — voice prompts (iOS + Android)

- `modules/nomad-voice` (local Expo module, no dependency): `speak(text, language)`, `stop()`.
  - iOS: `AVSpeechSynthesizer`, audio session `.playback` + mode `.voicePrompt` +
    `.duckOthers`/`.interruptSpokenAudioAndMixWithOthers`, deactivated with
    `.notifyOthersOnDeactivation` after each prompt (music and podcasts come back). That is what
    CarPlay expects of a navigation app (the car ducks its audio). `UIBackgroundModes: audio`
    so prompts play with the screen locked.
  - Android: `TextToSpeech` with `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` audio attributes and
    transient may-duck audio focus. Without a TTS engine on the device: silent, no error.
  - Not expo-speech: it doesn't set the audio session (no ducking, no background playback).
- `features/maps/voice-core.ts` (pure, tested): when to speak. Per maneuver, an early announcement
  ("En 500 metros, gire a la derecha…", distance by costing and speed: ~1.5 km on a fast road,
  ~400 m in town by car, ~150 m by bike, ~60 m on foot) and the "now" prompt a few seconds
  before (Valhalla's `verbal_pre_transition_instruction`). The start instruction when the trip
  starts, the arrival, and nothing twice. Texts from Valhalla (es-ES / en-US); the distance part
  from i18n with the region's units (`lib/units`).
- `features/maps/voice.ts`: follows `useGuidance` (navigating, progress) and speaks.
  A mute button in the navigation view (setting `navVoice`, on by default).

## Phase 2 — navigation in the background (iOS + Android)

- iOS: `modules/nomad-location` gets an iOS side with one call, a **navigation watch**: a
  `CLLocationManager` with `allowsBackgroundLocationUpdates`, `activityType` automotive /
  fitness, `pausesLocationUpdatesAutomatically = false`, the blue pill shown. expo-location's
  `watchPositionAsync` hard-codes `allowsBackgroundLocationUpdates = false`, and its task API
  needs expo-task-manager and "Always" permission: not needed, *when in use* is enough for a
  watch started in the foreground. `UIBackgroundModes: location`.
- Android: the same call starts a **foreground service** (`foregroundServiceType="location"`,
  notification "Navegando a …") while the watch runs, and the watch doesn't pause in the
  background. Started from the foreground, so `ACCESS_BACKGROUND_LOCATION` is **not** requested
  (no background-location review on Play). Play Console still asks for the foreground-service
  declaration (type location, a short video): `docs/ANDROID_PLAY.md`.
- `lib/location.ts` exports `watchNavigationAsync` (both platforms); `guidance.ts` uses it while a
  target is set. The compass stays foreground only.
- Privacy site: location is also used with the app in the background while navigating, never
  stored or sent (es + en).

## Phase 3 — CarPlay (iOS)

- `modules/nomad-carplay` (Swift, iOS only) + `plugins/with-carplay.js`:
  - **Off by default** (`enabled: false` in `app.json`): no CarPlay scene, Expo's own `SceneDelegate`,
    `nomad-carplay` left out of autolinking (`use_expo_modules!(exclude: …)` in the Podfile), so the binary
    carries no CarPlay code and `features/carplay` finds no native module. On with `enabled: true` or
    `CARPLAY=1` at prebuild; the entitlement option (or `CARPLAY_ENTITLEMENT=1`) turns it on too.
  - Info.plist scene `CPTemplateApplicationSceneSessionRoleApplication` →
    `NomadCarPlaySceneDelegate`; `UIApplicationSupportsMultipleScenes` stays false (CarPlay
    scenes don't count).
  - The entitlement only when the plugin's `entitlement` option (or `CARPLAY_ENTITLEMENT=1` at
    prebuild) says so: a device build with an entitlement the profile lacks doesn't sign. Off
    until Apple grants it; on for simulator work.
  - **Starting React Native from the car.** Expo starts React Native only when the phone's
    window scene connects. Opened from the car with the phone locked, only the CarPlay scene
    connects: the CarPlay delegate starts React Native into an off-screen window, and the
    app's `SceneDelegate` (rewritten by the plugin) adopts that root view controller when the
    phone scene connects later instead of starting a second app.
- The car's map: a native `MLNMapView` (MapLibre Native, the same SPM package
  maplibre-react-native uses) in the `CPWindow`, with the style JSON JS builds
  (`buildMapStyle`, same sources) and the route line JS sends; camera following the user
  natively (tilted, course up) inside the map template's safe area. Pan and zoom map buttons,
  recentre, day/night from the car's appearance.
- Templates: `CPMapTemplate` (root) with a "Destinos" button → `CPListTemplate`
  (Guardados, Emergencias cerca, Buscar → `CPSearchTemplate`); a chosen destination → JS
  computes the route (`startGuidance`) → trip preview (`CPTrip`, `CPRouteChoice` with time and
  distance) → "Ir" → `CPNavigationSession`: upcoming maneuver (`CPManeuver`, SF Symbol arrows,
  instruction variants), travel estimates updated from `progress`, rerouting, arrival. A trip
  started on the phone shows in the car too, and the other way round (one `useGuidance`).
- JS side `features/carplay/` (register.ts): mirrors `useGuidance` to the native module,
  answers its requests (list items, search, emergencies nearby) with the existing modules
  (`markers`, `places`, `emergency`), no new data paths.
- Testing: see "Testing in the simulator" below.

## Testing in the simulator (what works, 2026-10-31)

Xcode 27 replaced Simulator.app with Device Hub, which shows no CarPlay screen on public builds
(FB24785359). What works:

1. **Xcode 26.5 next to Xcode 27** (`/Applications/Xcode-26.5.app`, from developer.apple.com/download/all;
   `xcode-select` stays on 27, builds come from 27). Only its `Simulator.app` is used.
2. **An iOS 26.5 simulator** (`NP-carplay-26`): with an iOS 27 one the CarPlay menu item ticks but no
   screen appears.
3. **The shim** `scripts/carplay/sim-shim.m`: the 26.4/26.5 simulator's CarPlay host crashes on any map
   template (`-[CPSTemplateInstance vehicleSupportsDestinationSharing]: unrecognized selector`), a
   simulator-only Apple bug (Organic Maps PR #13507). Injected with `launchctl setenv
   DYLD_INSERT_LIBRARIES` in the simulator; lost on every simulator reboot.
4. **The entitlement** in the build: `CARPLAY_ENTITLEMENT=1 npx expo prebuild --platform ios`.

`scripts/carplay/carplay-sim.sh` does all of it: `setup` (simulator, shim, Simulator.app with the CarPlay
screen), `install` (install the build and open it on the car screen: a reinstall closes it there),
`tap X Y` / `tap X Y --still` (taps on the car screen in its screenshot's pixels: plain mouse events
don't reach it, see `tap.swift`; needs the Accessibility permission for the terminal), `shot`.
Trips are driven from the phone with Maestro (`travel`), seeded with the Andorra fixtures
(`e2e/fixtures/{maps,routing}` copied into the app's `Documents/content`). The simulator only sends
a location when it changes: `xcrun simctl location <udid> set …` after a reinstall.

The Simulator's hidden `defaults write com.apple.iphonesimulator CarPlayExtraOptions -bool YES` opens a
setup sheet (size, scale, touch, knob) when choosing CarPlay; the device keeps what it ran last. The
standard screen is 800×480 @2x, touch lo-fi + knob: set it back that way after trying another. A
1920×480 screen still showed CarPlay at 800 pt, and no Dashboard appeared in any layout tried, so the
Dashboard and instrument-cluster scenes are not built (they need a real car or a newer simulator to see).

Checked this way: opening from the car with the phone app closed (React Native starts behind the car's
map) and then opening the phone (it adopts it); the offline map in the car (day/night), following;
Destinos → Guardados / Emergencias cerca (empty state) / Buscar with the car keyboard; a trip from the
phone and one picked in the car: preview (route framed beside the card, time, distance, "Ir"),
"Cancelar"; navigation: maneuver panel, estimates, the route behind consumed, course up and tilted,
reroute after leaving the route, arrival ("Has llegado" with "Terminar"), guidance ending by itself a
minute later; "Terminar" in the bar ends it on the phone too.

## Later (not built)

- **Dashboard** (`CPTemplateApplicationDashboardScene`, `CPSupportsDashboardNavigationScene`): our map in the
  car home screen's tile, the system's maneuver card over it, a "Destinos" shortcut. Tried on 2026-10-31
  and taken out again: the simulator never showed a Dashboard, and code nobody has seen run isn't shipped.
- **Instrument cluster** (`CPTemplateApplicationInstrumentClusterScene`): the map in the cluster behind the
  wheel, on cars that offer it.

## Phase 4 — after the entitlement

`enabled: true` and `entitlement: true` in `app.json`, provisioning profile regenerated, TestFlight build, test in a real
car (and with Apple's CarPlay Simulator app on the Mac with the phone over USB). Store listing
note and screenshots of the CarPlay screen (owner reviews).

## App Review notes (first build with voice and background navigation)

Owner's plan: request the entitlement once 1.1.0 is approved (it is a separate form and team, but a live app
helps the request). The next build carries `UIBackgroundModes` location + audio; add to the review notes:

> Background modes: location is used in the background only while the user is following turn-by-turn
> directions they started ("Start" on a route), so guidance continues with the screen locked; it is never
> stored or sent. Audio is used for the spoken turn-by-turn prompts during that guidance, which lower other
> audio while they play. To try it: download Andorra, open Maps, tap a place, choose "Take me there" and
> then "Start".

## Entitlement request (draft for the owner)

Form: developer.apple.com/contact/carplay → "Navigation". Suggested text:

> Nomad Pocket is an offline-first app for travelling and emergencies where there is no mobile
> coverage. Users download country maps, routing data and points of interest (hospitals,
> pharmacies, police, fuel, drinking water) in advance; the app then calculates driving, walking
> and cycling routes entirely on the device (Valhalla engine) and gives turn-by-turn guidance
> with no network connection at all. On CarPlay we will offer a navigation app: the offline map
> following the driver, turn-by-turn maneuvers and arrival estimates, voice prompts, and
> destinations from the user's saved places, an offline search of streets and places, and the
> nearest emergency services. Its purpose is to keep drivers safely guided in rural areas,
> abroad without roaming, and after disasters when networks are down.

## Status

See `docs/PROGRESS.md` (CarPlay entries).
