# CarPlay navigation — plan

Approved by the owner on 2026-10-31 (night). Builds on "CarPlay — analysis" in
`docs/MAPS_NAVIGATION_PLAN.md` (2026-10-25). Work happens on the `carplay` branch (commits and
pushes there, not on `main`, until the owner merges it).

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
- Testing: Xcode simulator, I/O → External Displays → CarPlay; screenshots with
  `xcrun simctl io booted screenshot --display=external`.

## Phase 4 — after the entitlement

Entitlement on in `app.json`, provisioning profile regenerated, TestFlight build, test in a real
car (and with Apple's CarPlay Simulator app on the Mac with the phone over USB). Store listing
note and screenshots of the CarPlay screen (owner reviews).

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
