# Official alerts: weather warnings and earthquakes from public services — plan (2 phases)

Owner request (2026-11-04): notify the person when an official service warns about something serious where
they are (earthquake, tsunami, severe weather such as a DANA or a tornado). Researched the same day (every
source below was read or downloaded on 2026-11-04). Owner's decisions, same day:

- **Two phases.** Phase 1 without a server of our own: the app reads the official feeds itself, matches them to
  where the person is on the device, and shows local notifications. Phase 2: a free server of our own that
  sends real push notifications to iPhones. Phase 2 is wanted (the owner sees push as the point of the
  feature), so it follows phase 1 directly; phase 1 is its base and its fallback.
- Offer it at the **end of onboarding** and **once** to existing installs; always in Settings.
- Default thresholds below (orange/red weather; the earthquake rule).
- US: county shapes if they don't cost much, else an approximate position (phase 1: approximate position;
  phase 2: counties on the server, where they cost the app nothing).
- GDACS: yes, for countries without a national source.

Approved to implement. **Phase 1 built 2026-11-05 (tasks 1–7; task 8 partly: unit tests, the iOS simulator and the
Android emulator E2E pass and the Android background task ran headless; the background runs on real phones are still
to be measured; task 9 waits for MeteoAlarm).** What's left
before phase 2: "Phase 1 — status" below.

## The idea in one paragraph

Nomad Pocket does not issue alerts and does not compete with the government's own channel. Spain's ES-Alert
(EU-Alert elsewhere in Europe, WEA in the US) reaches every phone by cell broadcast: no app, no internet, top
priority, sent only by Protección Civil. That is the channel for "leave now". What no official channel does is
say **"prepare while you still have a connection"**: AEMET issues its warnings up to 72 h ahead, so an orange
warning for tomorrow is the moment to download the area's map, check the kit and the family plan. So the
feature is: **show the official warnings that cover where the person is, notify the serious ones, and turn
each one into two or three concrete actions inside the app.**

## What there is today (code as of 47175a8)

- `expo-notifications` ~58.1.6 with `enableRemoteNotifications: false` (`app.json`): local notifications only,
  no `aps-environment` entitlement. Used by the kit's expiry reminders (`src/features/prepare/reminders.ts`,
  channel `reminders`; **the notification handler is set there**, so alerts must share one handler, not set
  a second one).
- `plugins/with-android-no-firebase.js` keeps Firebase and Play services out of the APK and removes
  expo-notifications' `FirebaseMessagingService`. This stays: **no Firebase or Play services code in the APK, ever**
  (`docs/ANDROID_PLAY.md`). Android push without it, through the phone's own Play services over IPC, is being
  analysed (phase 2, 2026-11-12); until then Android checks the sources in the background.
- No background task module (`expo-background-task` / `expo-task-manager` are not dependencies).
  `UIBackgroundModes` is `location` + `audio` (navigation).
- Atom/XML is parsed with a small regex parser (`src/features/catalog/opds.ts`; RN has no DOMParser). `fflate`
  is a dependency (gunzip). Point-in-polygon over bundled shapes exists (`src/features/maps/country-at-core.ts`
  + `country-shapes.json`, which also tells the country of a position).
- The person's country (`settings.country`, a `regions.json` id) is chosen in onboarding. Location is asked when
  Maps opens, only through `src/lib/location.ts`.
- E2E serves fake feeds from the Mac: `scripts/e2e-updates-feed.py` + `EXPO_PUBLIC_UPDATES_OPDS_URL`, plain http
  to localhost allowed by `plugins/with-e2e-local-network`.
- The privacy policy (`site/privacy.html`) says the app has no server of its own and lists every third party it
  connects to. Phase 1 adds third parties; phase 2 adds our own server.
- **Fixtures already saved**: `src/features/alerts/fixtures/` (real samples of every feed below, 2026-11-04;
  its README says what each file is and which ones are trimmed).

## Sources (verified 2026-11-04)

| Source | Covers | How to read it | Licence / conditions |
|---|---|---|---|
| **AEMET** (Spain) | Weather warnings (rain, wind, storms, snow, heat/cold, coastal, dust, fog…), per zone, up to D+2/D+3 | Public RSS, **no API key**: `https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml` (Península, Baleares, Ceuta, Melilla; 24 KB, 43 items) and Canarias `…/CAP_AFAC65_RSS.xml` (9 KB); also per comunidad `CAP_AFAC{61–79}`, province `CAP_AFAP{code}`, zone `CAP_AFAZ{code}`. Headers: `Last-Modified`, `Cache-Control: max-age=60`. **The first item is a `.tar.gz` with all active CAP files** (`…/avisos/cap/Z_CAP_C_LEMM_<stamp>_AFAE.tar.gz`: 115 KB, 219 files, 3.5 MB unpacked); its URL changes with each new state. Each CAP 1.2 file: two `<info>` blocks (`<language>es-ES` / `en-GB`), `severity`, `onset`/`expires`, `headline`, `description`, `instruction`, parameter `AEMET-Meteoalerta nivel` (amarillo/naranja/rojo), `<area>` with a **`<polygon>`** and geocode `AEMET-Meteoalerta zona` (e.g. `610403`). Issue windows 07:30–09:00, 10:30–11:30 (D+1, D+2), 17:00–19:00, 23:50 (D+3), plus any time the forecast changes. Zone shapes: "Delimitación de las zonas" zip on the help page | `© AEMET` or "Información elaborada por la Agencia Estatal de Meteorología"; commercial and non-commercial reuse allowed; **must not "desnaturalizar el sentido"**; show the update date; never imply AEMET takes part in or endorses the reuse (`aemet.es/es/nota_legal`) |
| **MeteoAlarm** (EUMETNET, ~38 European countries) | Weather warnings | One Atom feed per country: `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country}` (Spain 195 KB, 125 entries; Germany ~275 KB), `Cache-Control: max-age=0, must-revalidate`, WebSub. Each `<entry>` = one area × one warning: `cap:event`, `cap:severity`, `cap:urgency`, `cap:onset`, `cap:expires`, `cap:areaDesc`, `cap:geocode` **EMMA_ID** (`ES084`, `DE329`), `cap:message_type`, `cap:identifier`, link to the full CAP (`…/api/v1/warnings/feeds-{country}/<uuid>`, ~3 KB, national language + `en-GB`, `parameter awareness_level` "2; yellow" / 3 orange / 4 red). **No polygons.** Geometries: the Metadata API (`https://api.meteoalarm.org/metadata/v1`, OpenAPI at `/metadata/v1/docs/openapi.yaml`) has `/geocodes` → each geocode's GeoJSON `feature_url`, but **needs a token** (Bearer; "Request API Access" on api.meteoalarm.org) | Feed `<rights>`: "terms equivalent to CC BY 4.0, **with additional requirements for redistributing outlined in our Terms and Conditions**". That page didn't render: **read it or ask `meteoalarm@geosphere.at` before shipping Europe** (ask for the API token in the same email) |
| **NWS** (USA) | All US alerts, tsunami warnings for US coasts included | `https://api.weather.gov/alerts/active?point=lat,lon` (6 KB for one alert); the whole country is ~2 MB. Each alert has `geocode.UGC` (zones `TXZ211`, counties `TXC453`) and `geocode.SAME` (county FIPS); **only 37 of 506 active alerts had a geometry**, so matching on the device needs `?point=`. Requires a `User-Agent` naming the app; at most every 30 s | US public domain |
| **USGS** (world) | Earthquakes | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson` (3 KB), every minute; `mag`, `time`, `place`, `alert` (PAGER), `tsunami`, `sig`. `tsunami: 1` only means a large event in an oceanic region, **not** that a tsunami exists | US public domain |
| **EMSC** (Euro-Mediterranean + world) | Earthquakes, often faster than USGS around Europe (carries IGN's) | `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=4.5&start=<ISO>&limit=50` (2 KB): `mag`, `lat`, `lon`, `time`, `flynn_region`, `lastupdate`, `unid`. Solutions are preliminary and get revised. A WebSocket exists (`ws://www.seismicportal.eu/standing_order/websocket`): phase 2 only | Free; cite EMSC |
| **GDACS** (UN + EU JRC) | Disasters with humanitarian impact worldwide (EQ, TC, FL, VO, WF, DR), Green/Orange/Red | `https://www.gdacs.org/xml/rss_24h.xml` (350 KB, 114 items) and per-type feeds (`rss_tc_7d.xml`, `rss_fl_7d.xml`…), every 6 min; `gdacs:alertlevel`, `gdacs:eventtype`, `gdacs:country`/`iso3` | Cite GDACS. Orange/Red only, countries without a national source |
| **NOAA tsunami.gov** (PTWC/NTWC) | Tsunami threat messages, Pacific and US | Atom `https://www.tsunami.gov/events/xml/PHEBAtom.xml`, `PAAQAtom.xml` (2 KB) | US public domain. US coasts already come through NWS; PTWC's international messages are later (phase 2) |
| **IGN** (Spain) | Earthquakes | GeoRSS (~5 min). EMSC already carries them: not used | Cite IGN |

Out, on purpose:
- **Bomb threats, attacks, police incidents**: no official public feed; relaying anything else would be
  dangerous. Never.
- **ES-Alert / EU-Alert content**: cell broadcast only, no public API. The phone shows it anyway.
- **Tsunami warnings for the Mediterranean/Atlantic Europe** (NEAM centres): no public feed found. Covered by
  cell broadcast; the guide's tsunami card says "strong quake at the coast: go up, don't wait for a warning".
- AEMET OpenData (needs an API key): the public RSS/CAP files are enough.

## Decisions for both phases

1. **Opt-in, offered three ways**: the last step of onboarding; **once** to existing installs after the update
   (a sheet on Home, never again after "Ahora no", flag `alerts.offered`); always in Settings ("Avisos oficiales").
   Turning it on asks for notification permission, then for location "while using" if the app doesn't have it.
   Nothing is fetched while it is off.
2. **Which sources apply**: by the country of the person's position (`country-at-core`), else `settings.country`:
   Spain → AEMET; USA → NWS; other MeteoAlarm countries → MeteoAlarm (once its terms and geometries are sorted;
   until then, GDACS); everywhere else → GDACS. Earthquakes (USGS + EMSC) everywhere.
3. **What notifies (defaults, tunable in Settings):**
   - Weather: **orange and red** covering the position; yellow only in the list. Notify when a warning is new or
     raises its level; never for plain updates; a cancel removes it from the list.
   - Earthquakes: M ≥ 4.5 within 100 km, or M ≥ 6 within 500 km (informative: it already happened; the card links
     to the guide's earthquake/aftershock cards). The same event from USGS and EMSC is one (time ±60 s, distance
     < 100 km, keep the higher magnitude, update instead of notifying again). Quakes older than 6 h when a check
     first sees them are listed but not notified (a late background run shouldn't ring for something long over).
   - Tsunami: NWS tsunami warnings/advisories (US) like any red warning.
   - GDACS: Orange/Red events in the person's country, earthquakes excluded (USGS + EMSC cover them).
4. **Notification levels**: Android channel `alerts` (importance HIGH; once created only its name/description
   can change), separate from `reminders`. iOS: red, tsunami and M ≥ 6 as `interruptionLevel: 'timeSensitive'`
   (breaks through Focus; needs the Time Sensitive Notifications capability:
   `com.apple.developer.usernotifications.time-sensitive` in `app.json` `ios.entitlements`; check that it lands
   in the prebuilt entitlements and that signing picks it up), orange as `active`. **No Critical Alerts** (Apple
   grants them by hand and refuses them when Time Sensitive is enough; for warnings issued hours ahead it is).
   No Android DND bypass.
5. **Official words, our frame.** Show the source's own `headline`, `description` and `instruction` in the app's
   language when the CAP has it (es/en), else English, else the original. We only add the frame: level,
   phenomenon, place, from–until, "Fuente: AEMET · emitido 18:12", actions. Never rewritten, summarised by the AI
   or translated by us (AEMET: "no desnaturalizar").
6. **Actions per warning**: download or update the map of that area (if missing or old), open the family plan,
   check the kit, open the relevant guide card (flood, heat, storm, earthquake, tsunami), call the local
   emergency number (`emergency-numbers.json`). On Android no first-aid content is attached
   (`HEALTH_FEATURES`, `docs/ANDROID_PLAY.md` section 4); weather and quakes are not health features.
7. **Honest disclaimer** in the opt-in and on the alerts screen: "Nomad Pocket no emite avisos: muestra los
   publicados por AEMET, MeteoAlarm… y puede retrasarse o no llegar. En una emergencia, sigue siempre las alertas
   de Protección Civil en el móvil (ES-Alert) y llama al 112." (and the English equivalent, with the local number;
   reworded 2026-11-05: "son los que valen" read as if the app's own warnings were worthless).
8. **Offline**: the last list stays visible with "actualizado hace X"; warnings past `expires` disappear.
9. **Credits**: AEMET, MeteoAlarm/EUMETNET (CC BY 4.0), USGS, EMSC, NOAA/NWS, GDACS (`features/credits`).

## Phase 1 — no server of our own

### How it works

- **Where the person is**: the last known position, saved **on the device only** (kv `alerts.position`, rounded
  to ~100 m) whenever the app gets a fix (opening Maps, navigating, opening the alerts screen). No background
  location: the app never asks for "Always" for this. Without any fix, the list shows the country's warnings
  (no notifications).
- **When it checks**: on launch and on coming to the foreground (at most every 10 min), and in the background with
  `expo-background-task` (+ `expo-task-manager`): WorkManager on Android (minimum 15 min; we ask 30), BGTaskScheduler
  on iOS, which decides when ("short intervals are often ignored"; not available on the simulator; stops if the
  person swipes the app away). AEMET's issue windows mean even a few checks a day catch most warnings hours
  ahead; quakes in the background are best effort.
- **What one check downloads** (measured 2026-11-04): AEMET RSS 24 KB (`If-Modified-Since`; 304 when unchanged),
  the tar.gz 115 KB only when its URL changed (it covers Canarias too: one download for all Spain); USGS
  3 KB + EMSC 2 KB; NWS 6 KB per point; GDACS 350 KB only where it applies (prefer the per-type feeds if smaller).
- **Matching on the device**: AEMET → point in the CAP `<polygon>`; NWS → `?point=` with the position **rounded to
  0.05°** (~5 km; the only time a position, approximate, leaves the phone; said in the privacy policy); GDACS →
  country; MeteoAlarm → EMMA_ID geometries (below); quakes → distance.
- **MeteoAlarm (Europe minus Spain), when unblocked**: ask MeteoAlarm for the terms and an API token; a script
  (`scripts/alerts/build-emma.mjs`, the token only in the developer's environment, never in the app) downloads the
  `/geocodes` GeoJSON features, simplifies them and writes an asset like `country-shapes.json` (encoded polylines).
  Measure the size: bundled if small (< ~1 MB), else downloaded with the country. If no token, the person picks
  their region from the country's EMMA list instead.
- **Dedup**: kv `alerts.notified` (identifier → level notified, topic, end), so restarts and the two triggers
  (foreground, background) never notify twice; CAP `references` link updates/cancels to the original, and a
  **topic** (source + zone + phenomenon + measure for AEMET, zone + hazard for MeteoAlarm, the VTEC event for NWS,
  the event for GDACS) catches a re-issue whose reference the app never saw while the first one is still in force
  (`decide` in `alerts-core.ts`).

### Phase 1 — status (2026-11-05)

Built as planned, with these changes (each written into ARCHITECTURE.md, "Official alerts"):
- The once-only offer for existing installs is a dismissable card on Home (not a sheet): same "Ahora no" forever.
  While alerts are on, Home always has a line for them (orange/red card, or the quiet "no orange or red here"
  line), which is also the way into the list; Settings › Avisos oficiales holds the switch and the preferences.
- The position is the system's last fix read on each foreground check (`getLastKnownPositionAsync`, 30 min), not
  hooks in every screen that gets one; a manual check may take one coarse fix.
- The check that turns alerts on records what is in force without ringing it (the list shows it at once).
- Settings shows the last checks (`alerts.runs`), so the background measurement needs no debug build.
- Credits list AEMET, NWS, USGS, EMSC and GDACS (`scripts/licenses/native.json`, data).
- expo-task-manager's config plugin also adds the `fetch` background mode on iOS (unused by us; App Review notes
  in `docs/store/listing-2.3.0.md` explain both modes).

Still to do in phase 1:
- ~~Android~~ **done 2026-11-05**: no `com.google.android.gms` / Firebase in `releaseRuntimeClasspath`
  (expo-background-task brings `androidx.work` and Room only), `scripts/licenses/android.json` regenerated, R8 keep
  rule for WorkManager's Room database (the release APK crashed at startup without it), ANDROID-07 passes, and the
  background task ran headless on the emulator (`cmd jobscheduler run -f -n androidx.work.systemjobscheduler
  com.fjlinde.nomadpocket 0`; the run log said "En segundo plano · 3 fuentes").
- **Measure** the background runs on the owner's iPhone and an Android phone for a few days: Settings › Avisos
  oficiales › Comprobaciones recientes. That is phase 2's baseline.
- **Owner**: review the store texts (`docs/store/listing-2.3.0.md`), the privacy policy changes (`site/privacy.html`,
  not published until pushed), and check on a real iPhone that signing picks up the Time Sensitive entitlement
  (automatic signing should add the capability to the App ID).
- Not verified by hand yet: a raise (orange → red) ringing again, and Time Sensitive breaking through a Focus.

### Phase 1 — tasks (in order)

1. **Done 2026-11-05.** Pure cores + tests in `src/features/alerts/` against the fixtures (in the "Pure, tested
   modules" list in `CLAUDE.md`). What was built, and what the real data showed: `docs/PROGRESS.md` log, 2026-11-05.
   AEMET's bundle has 219 files, 177 green (skipped before parsing), leaving the 42 warnings its RSS lists; the
   `Alert` type gained `hazard` (picks the guide card), `topic`, `msgType`, `references`, `codes`, `countries`.
   tsunami.gov is not read in phase 1 (NWS carries US coasts). As planned:
   - `cap-core.ts`: CAP 1.2 → `{identifier, sent, msgType, references, infos: [{language, event, severity, urgency,
     certainty, onset, expires, headline, description, instruction, parameters, areas: [{desc, polygons, geocodes}]}]}`.
   - `tar-core.ts`: ustar reader over fflate's `gunzipSync` (the fixture has 219 files).
   - `feeds-core.ts`: AEMET RSS (first item = tar URL), MeteoAlarm Atom entries, NWS GeoJSON, USGS GeoJSON, EMSC JSON,
     GDACS RSS → one normalised `Alert {id, source, kind: 'weather'|'quake'|'tsunami'|'disaster', level:
     'yellow'|'orange'|'red', event, area, onset, expires, texts: {es?, en?, original}, polygons?, point?, mag?}`.
   - `alerts-core.ts`: levels (CAP severity / AEMET nivel / MeteoAlarm awareness_level / GDACS alertlevel), point in
     polygon, distance rule for quakes, USGS/EMSC dedup, the notify policy (new / raised / update / cancel), expiry,
     which sources apply to a country.
2. **Fetch + state**: `sources.ts` (fetch with timeouts, `User-Agent: NomadPocket/<version>
   (github.com/franlindebl/nomad-pocket)`, `If-Modified-Since`; base URLs overridable with `EXPO_PUBLIC_ALERTS_*`
   for E2E), `check.ts` (one check: sources → normalised → matched → persisted → notifications), kv keys
   `alerts.enabled`, `alerts.offered`, `alerts.position`, `alerts.cache` (list + fetch time + Last-Modified per
   source), `alerts.notified`, `alerts.runs` (last 50 check times and triggers, for measuring).
3. **Notifications**: `notify.ts` (channel `alerts`, levels, the shared handler with `reminders.ts`, tap →
   `/alerts/[id]`), the time-sensitive entitlement in `app.json`.
4. **UI**: `src/app/alerts/index.tsx` (list, disclaimer, "actualizado hace X") and `src/app/alerts/[id].tsx`
   (official text + actions); a Home card while an orange/red warning is active; the opt-in (onboarding last
   step, the once-only Home sheet, Settings section with thresholds); es + en strings; `testID`s for E2E. Warning
   colours as theme tokens (yellow/orange/red next to the signal yellow, contrast-checked; `docs/STYLE_GUIDE.md`).
5. **Background**: `npx expo install expo-background-task expo-task-manager`; `background.ts` defines the task at
   module scope, imported from the entry, headless (nothing from React; i18n initialised before building text);
   `register.ts` (`registerInit`: register the task when enabled, foreground check). Check that the APK still has
   no `com.google.android.gms`/Firebase (`./gradlew :app:dependencies`), then `node scripts/licenses.mjs`.
6. **Privacy + store**: `site/privacy.html` (es + en): the new connections, only when "Avisos oficiales" is on,
   what each receives (IP and which feed; NWS the rounded position), the position used for matching stays on the
   device; still no server of our own. App Store labels unchanged (nothing collected by us). Store texts mention
   it with the disclaimer, never "emergency alert system" (the owner reviews).
7. **Docs**: `docs/ARCHITECTURE.md` (alerts section), `docs/E2E.md` (flows, testIDs), `docs/PROGRESS.md`.
8. **Verify**: unit tests; E2E on the iOS simulator and the Android emulator with a `scripts/e2e-alerts-feed.py`
   serving the fixtures (a warning over the simulator's location: list, detail, Home card, local notification);
   the background task on real phones (`triggerTaskWorkerForTestingAsync` in a debug build; Android
   `adb shell cmd jobscheduler run -f com.fjlinde.nomadpocket <id>`); then **measure** `alerts.runs` on the owner's
   iPhone and an Android phone for a few days. That measurement is phase 2's baseline.
9. Europe (MeteoAlarm) as soon as its terms and token arrive; it can ship after the rest.

## Phase 2 — push from a free server of our own

Starts when phase 1 is on TestFlight and its background runs have been measured. Phase 1 stays as is: the app
keeps reading the sources itself for its list and keeps its background check as the fallback, and push comes on
top. So the server only does what the phone can't: watch the feeds every minute and wake the phones.

### Why push is needed (measured 2026-11-12)

The owner's iPhone (the owner opens the app every day), Settings › Avisos oficiales › Comprobaciones recientes:
background checks every ~30 min from 03:19 to 07:23, then **none until the app was opened at 12:44**. That is the
pattern of a `BGProcessingTask`: `expo-background-task` submits a `BGProcessingTaskRequest`
(`node_modules/expo-background-task/ios/BackgroundTaskScheduler.swift`), which iOS runs when the phone is idle,
mostly at night on the charger. AEMET issues in the morning and the afternoon, exactly when nothing runs. A
`BGAppRefreshTask` would not save it either: iOS spends it by how much the app is used, and the typical person
installs the app and doesn't open it again. Android's WorkManager does better while the app is used, but App Standby
Buckets cut a rarely opened app to about one run a day, and hibernation (Android 12+, months unused) stops it.
**Background polling can't be the alert channel; it stays only as the fallback.**

Owner's decisions (2026-11-12):
- **No second app** for push (UnifiedPush through ntfy/Sunup is out: the person would have to install it).
- **No Firebase/Play services code in the APK** (`docs/ANDROID_PLAY.md` rule 3; it would break the GPL of libkiwix,
  libzim and Xapian, whose holders can't all be asked for an exception).
- iOS: real APNs push (visible alerts, never silent `content-available` ones, which iOS throttles and drops for a
  closed app). It reaches a person who never opens the app again; the server matches the cell registered at the
  last fix (usually home), said in the opt-in.
- Android: analyse and spike **FCM through the Play services already on the phone, over Android IPC, with only free
  code in the APK** (next section). If it fails: WorkManager every 15 min + an invitation to exclude the app from
  battery optimisation (the system's settings screen, not the `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permission,
  which Play restricts), with honest copy ("en Android los avisos pueden retrasarse").

### Android: FCM over IPC to the phone's Play services (analysis 2026-11-12, to spike)

**The idea.** FCM on a phone is delivered by the Google Play services app installed on it (`com.google.android.gms`),
which keeps the one connection to Google. An app talks to it through Android intents. Firebase's client library
(Apache 2.0) is only a wrapper around that conversation, but it pulls in Google's closed `play-services-*` AARs,
which is what can't sit next to GPL libkiwix. If the APK carries **our own code** that speaks the same intents, the
APK has no proprietary code at all, and Play services is a separate program the app talks to at arm's length.

**What the protocol is, from open sources** (read 2026-11-12):
- Registration request: the extras are built in the open `firebase-messaging` source,
  `firebase-android-sdk/firebase-messaging/src/main/java/com/google/firebase/messaging/GmsRpc.java` (Apache 2.0):
  `scope=*`, `sender`/`subtype` (the Firebase project number), `appid` (the Firebase Installation ID),
  `Goog-Firebase-Installations-Auth` (its auth token), `gmp_app_id`, `Goog-Api-Key`, `gmsv`, `osv`, `app_ver`,
  `app_ver_name`, `cliv`, `firebase-app-name-hash`. Only the transport (`com.google.android.gms.cloudmessaging.Rpc`)
  is in the closed AAR.
- Transport, reimplemented as free software by microG (Apache 2.0):
  `GmsCore/play-services-gcm/src/main/java/org/microg/gms/gcm/CloudMessagingRpc.java` and
  `play-services-iid/.../InstanceIdRpc.java`: an intent `com.google.android.c2dm.intent.REGISTER` to the Play
  services package with the extras, a `google.messenger` `Messenger` for the reply and an `app` `PendingIntent` that
  proves who is asking; the reply (`com.google.android.c2dm.intent.REGISTRATION`) carries `registration_id` (the
  token) or `error`.
- Firebase Installation ID + auth token: a plain REST call (`firebaseinstallations.googleapis.com`, API key header,
  package + signing cert headers if the key is restricted). Our code, no library.
- Receiving: a manifest receiver for `com.google.android.c2dm.intent.RECEIVE`, guarded by
  `com.google.android.c2dm.permission.SEND` (Firebase's own manifest declares exactly this). Our receiver reads the
  data payload and posts the notification on the `alerts` channel with the same frame as phase 1. Firebase's
  receiver also declares `com.google.android.gms.cloudmessaging.FINISHED_AFTER_HANDLED` and acknowledges through the
  closed `CloudMessagingReceiver`; without that meta-data Play services should fall back to the legacy ordered
  broadcast (to verify).
- Server: FCM HTTP v1 (`fcm.googleapis.com/v1/projects/<id>/messages:send`, OAuth2 from a service account), data-only
  messages with `priority: high`, next to the APNs sender on the same server.

**Licences.** The APK would contain only GPL code of ours, written from Apache-2.0 sources (compatible with GPLv3;
libzim and Xapian are "2.0-or-later", so the whole is GPLv3). Talking to another program through intents is
communication between separate programs, not linking (FSF's FAQ on "aggregate" vs combined works: pipes, sockets,
command-line style exchanges of simple data; here, a bundle of strings). Play services is also part of the phone's
system on certified devices. My reading: clean, and the same position as an app that calls a Google web API. Not
legal advice; the owner decides. Side effects: F-Droid would accept such an app with the "NonFreeNet" anti-feature
(like the open UnifiedPush FCM distributor on IzzyOnDroid); `docs/ANDROID_PLAY.md` rule 3 still holds literally (no
proprietary code in the APK), but the app would use a Google service at run time, which the owner must accept.

**Why it may hold up.** Play services must keep answering every Firebase SDK version still in apps on the store,
so the registration intent can't change overnight; mirroring the current `GmsRpc` puts us on the newest one.

**Risks and unknowns (the spike answers them):**
1. Play services answers our REGISTER intent with a token (it can't tell our code from Firebase's, but it may check
   `cliv`, the Firebase app id against the package, or the API key restrictions).
2. FCM HTTP v1 delivers to that token, and our receiver wakes with the app swiped away, in Doze and in a rare
   standby bucket (high-priority FCM is exempt from both while the messages end in a visible notification;
   Google deprioritises high-priority messages that don't).
3. The legacy ack path works without `FINISHED_AFTER_HANDLED`, and Play services doesn't redeliver or throttle us.
4. Hibernation (months unused, Android 12+) blocks FCM for every app, official SDK included: same limit as any app.
   Whether Play services' notification proxying (`setRetainProxiedNotifications` in `GmsRpc`) changes that is unknown.
5. Phones without Play services (Huawei, de-Googled ROMs): no token; they keep the 15-min background check.
6. Google may still change the protocol for old clients: the background check stays as the fallback forever, and
   `/health` on the server can count registrations that stop refreshing.
7. Privacy: Google sees that the phone gets our pushes and their payload. Send the minimum (alert id, level, the
   official headline in the person's language); privacy policy and Play Data safety must say "Android: Google's
   FCM delivers the alert" (the policy says today that the app has no Google services).
8. The Mac's corporate TLS proxy may block the emulator's connection to Google (`mtalk.google.com:5228`): spike on a
   real Android phone or another network.

**Spike (about a day, after the owner creates a free Firebase project, Android app `com.fjlinde.nomadpocket`, and a
service account key kept out of the repo):**
- `modules/nomad-push` (Kotlin, Android only): `register(senderId, appId, apiKey, projectId)` → FIS REST → REGISTER
  intent → token; the RECEIVE receiver → a local notification. No Firebase/GMS dependency (the
  `releaseRuntimeClasspath` check in `docs/ANDROID_PLAY.md` stays empty).
- `scripts/alerts/fcm-send.mjs`: one FCM HTTP v1 message to a token (the service account from the environment).
- Measure on a real phone: token obtained; delivery with the app in the foreground, in the background, swiped away,
  after a night in Doze, after `adb shell am set-standby-bucket com.fjlinde.nomadpocket rare`; delivery latency.
- Go/no-go written here. Go → Android registers with the server like iPhones (`platform: 'android'`); no-go → the
  fallback above.

**Result (2026-11-12, Xiaomi Mi 9, MIUI on Android 11, Play services 26.42): GO.** `modules/nomad-push` (only our
Kotlin, no dependency) and `scripts/alerts/fcm-send.mjs` (FCM v1 with an OAuth JWT from `node:crypto`):
- FIS REST answered with a FID and auth token (the Firebase-made API key needed no extra headers).
- The legacy REGISTER intent works. Play services first answers `registration_id = "|ID|1|:MESSENGER"` with its own
  `Messenger` in `google.messenger`; the same request sent again through that Messenger returns
  `"|ID|2|:<token>"`. Strip the `|ID|n|:` prefix. The token came back **equal to the FID** (22 characters), and FCM v1
  accepted it (200). The bound-Messenger fallback was never needed.
- Delivery, data-only and `priority: HIGH`, shown by our receiver on the `alerts` channel, under 1 s each time
  (`google.delivered_priority=high`): app open; Doze forced (`dumpsys deviceidle force-idle`); standby bucket `rare`;
  Doze + `rare`; **app swiped away from recents with the screen locked** (Android started the process for the
  broadcast from Play services). Force-stopped: not delivered, as for any app (official FCM included) until the
  person opens it again.
- No `FINISHED_AFTER_HANDLED` meta-data: the ordered-broadcast result code was enough so far; no redelivery seen.
- APK: 0 Google/Firebase class definitions in the dex (only expo-notifications' old dangling references,
  `plugins/with-android-no-firebase.js`), `releaseRuntimeClasspath` clean; the manifest gains only the
  `c2dm.permission.RECEIVE` permission and our receiver guarded by `c2dm.permission.SEND`.
- Still to watch in the real build: a night of genuine Doze on battery; an Android 12+ phone; token refresh (Play
  services' `RST`/`SYNC` messages, FIS auth tokens expire after 7 days: re-register on every app start and when the
  server reports `UNREGISTERED`); and the privacy policy / Data safety lines from risk 7.

### Where: Firebase (Cloud Functions + Firestore), Blaze plan — chosen 2026-11-12

**Deno Deploy is out**: Deno joined Cloudflare and Deno Deploy shuts down about six months after 2026-10-09, i.e.
around April 2027 (https://deno.com/blog/cloudflare; the console shows the banner). Owner's choice the same day,
among Firebase/Google Cloud (~0 €, nothing to maintain), Cloudflare Workers paid (5 $/month fixed, HTTP/2 to APNs
unproven) and a Hetzner VPS (~4–5 €/month, patching): **Firebase**, the project the FCM spike already uses.

- Project `nomad-pocket` (owner's personal Google account, created 2026-11-12; Gemini and Google Analytics off),
  Android app `com.fjlinde.nomadpocket`, FCM HTTP v1 on. Blaze (pay as you go) is needed for Cloud Functions; the
  owner adds the billing account and a **1 € budget alert** (alerts don't cap spending: optional later, a function
  that unlinks billing when the budget's Pub/Sub topic fires).
- Cloud Functions for Firebase (2nd gen, Node 22, TypeScript bundled with esbuild so it can import the app's pure
  cores): `onSchedule('every 1 minutes')` for the poll (Cloud Scheduler: 3 free jobs per billing account) and one
  `onRequest` for the API, region `europe-west1` (or Madrid, `europe-southwest1`, if every piece is available there).
  Node's `http2` speaks to APNs directly; FCM v1 is plain HTTPS with the service account the function runs as.
- Firestore (Native, same region) for registrations and source state; Secret Manager (`defineSecret`) for the APNs
  key and the test-push secret.
- Budget against the free tier: ~44 k scheduled runs/month (2 M invocations free), a few seconds of 256 MB each
  (~20 k GB-s of 400 k free), Firestore writes only when a source or a registration changes (20 k writes/day free).
- Secrets on the owner's Mac, never in the repo: `~/.nomad-pocket/secrets/` (the APNs `.p8` + `apns.json` with its key and team
  ids: team-scoped, sandbox + production; `fcm-service-account.json`; `firebase-android.json`, the Android
  client config, which ships in the APK and isn't secret).

Not chosen:
- **Cloudflare Workers**: free plan 10 ms CPU and 50 subrequests per invocation (parsing a changed 200–700 KB feed may
  not fit); the 5 $ plan lifts that, but HTTP/2 to APNs from its `fetch` isn't documented (a Workers fork of `apns2`,
  `@fivesheepco/cloudflare-apns2`, exists). Fallback if Google ever stops fitting.
- **A VPS** (Hetzner ~4–5 €/month, or Google Cloud's always-free e2-micro): works with anything, but a machine to keep
  patched.
- **GitHub Actions**: scheduled runs come 15–30+ min late or not at all under load, are disabled after 60 days
  without activity, and there is nowhere to keep device tokens. GitHub hosts the code and deploys it; a daily job
  can watch `/health` (its delays don't matter there).

### Design

- **What the phone sends**: its APNs token, `env` (`production` for TestFlight/App Store, `sandbox` for dev builds),
  its **0.1° cell** (~11 × 8 km in Spain; never coordinates), language and thresholds. On enable, when the cell
  changes (a new fix), and when the token changes. Disabling deletes the row.
- **Geometry on the server**: AEMET polygons come in the CAP; a table *zone code → cells* built by
  `scripts/alerts/build-zones.mjs` covers MeteoAlarm EMMA_IDs (the phase-1 asset), NWS public zones and **US
  counties** (Census cartographic boundaries) for the alerts without geometry. Quakes → cells within the radius.
  A cell on a border gets both zones' warnings: acceptable.
- **Layout** (`server/alerts/`, Cloud Functions for Firebase in TypeScript, GPL like the app; it imports the app's
  pure cores directly, so both parse the same way and share the tests):
  ```
  index.ts      exports: poll = onSchedule('every 1 minutes'), api = onRequest (register, unregister, health, test push)
  poll.ts       sources with ETag/If-Modified-Since → normalised (the app's cores) → diff vs Firestore state
  cells.ts      polygon / radius / zone code → cells (data/zones.json.gz)
  apns.ts       JWT (ES256, the .p8 key) + POST https://api.push.apple.com/3/device/<token> over node:http2;
                410/400 BadDeviceToken → delete the registration
  fcm.ts        FCM HTTP v1, data-only, priority high (only if the Android spike is a go); UNREGISTERED → delete
  store.ts      Firestore: regs/{tokenHash} → {platform, token, env, cell, lang, prefs, updatedAt} (query by cell);
                state/{source} → Last-Modified/ETag + active alerts
  ```
- **API**: `POST /v1/register`, `DELETE /v1/register/{token}`, `GET /health` (last successful poll per source),
  `POST /v1/test-push` guarded by a secret (owner only). No public way to send a push. Rate-limit by IP, cap body
  sizes, never echo tokens; fake tokens die at the first 410.
- **Push payload**: the same frame and official texts as phase 1, in the registered language;
  `interruption-level` as in decision 4; `thread-id` per warning; the app's phase-1 dedup (`alerts.notified`) also
  marks pushed warnings so a background check doesn't notify them again.
- **The app**: `enableRemoteNotifications: true` (iOS `aps-environment`; re-check that the Android build still has
  no Firebase/Play services pieces), `getDevicePushTokenAsync` on iOS, `registration.ts`. Android unchanged.
- **Secrets** in Secret Manager: the APNs `.p8` key with its Key ID and Team ID (created 2026-11-12; ids in `apns.json`, never in the repo) and
  the test-push secret; FCM uses the functions' own service account (no key file in the cloud).
- **Monitoring**: a free uptime monitor (e.g. UptimeRobot) or a daily GitHub Actions job on `/health` that fails,
  and emails the owner, when a source hasn't been polled for 15 min. When the server is down, iPhones fall back
  to phase 1's checks.
- **Optional later**: PTWC/NTWC international tsunami messages; EMSC's WebSocket for faster quakes; Critical
  Alerts (apply only if the owner wants to, with the server's record); replacing the NWS point query with the
  server's county match.

### Phase 2 — privacy, store, legal

- Privacy policy: the app now has **one server of its own, only for iPhones with "Avisos oficiales" on**: what it
  stores (push token, 0.1° cell, language, thresholds), what it doesn't (coordinates, account, IP beyond request
  logs), retention (deleted on opt-out, when Apple reports the token dead, or after 90 days without a refresh),
  who runs it (the owner, on Google's Firebase, EU region). GDPR: the owner is the controller of that table; the
  policy is the notice.
- App Store privacy labels: "Coarse Location — App Functionality — not linked to you — no tracking" (the cell is
  derived from location and kept on our server). Google Play's Data safety changes only if Android registers too
  (the FCM spike is a go): the same coarse location, plus Google's FCM delivering the alerts.

### Phase 2 — tasks (in order)

0. **Spikes**: (a) a Firebase function that sends one APNs push (`node:http2` + JWT) to a dev build on the owner's
   iPhone, and a 1-minute scheduled function writing to Firestore (needs Blaze). **Passed 2026-11-12**
   (`server/alerts/`: APNs 200 in 0.7 s, banner on the iPhone; heartbeat every minute, ~1 s late; log in
   `docs/PROGRESS.md`). Remote `data` goes under the payload's `body` key (that's where expo-notifications reads it). (b) Android FCM over IPC ("Android: FCM over IPC…" above): **GO, 2026-11-12** (result
   there). The server sends FCM too, and Android registers like iPhones; the 15-min check stays as the fallback for
   phones without Play services.
1. `scripts/alerts/build-zones.mjs` + `data/zones.json.gz` (measure; Spain first, then EMMA, then NWS zones + counties).
2. Server: poll + diff (AEMET, quakes, then the rest), register/unregister, APNs sending, health, test push.
3. App: registration, push tap → detail, dedup with phase 1, opt-in copy for iPhone ("al momento") vs Android
   ("cada media hora aprox.").
4. Privacy policy, store labels, `docs/ARCHITECTURE.md` (server section), `docs/RELEASE.md` (deploying the server),
   `docs/DEVELOPMENT.md` (running it locally).
5. Verify: pushes on the owner's iPhone over a few days (`/v1/test-push`, then real warnings), the monitor firing when
   the cron is stopped, a disabled phone getting nothing.

## Sources read (2026-11-04)

- AEMET: https://www.aemet.es/es/rss_info/avisos/esp, https://www.aemet.es/es/eltiempo/prediccion/avisos/ayuda, the national and
  Canarias RSS and the tar.gz (saved as fixtures); reuse terms https://www.aemet.es/es/nota_legal
- MeteoAlarm: https://feeds.meteoalarm.org (feed list, CC BY 4.0), the Spain/Germany feeds and a CAP file, https://api.meteoalarm.org,
  https://api.meteoalarm.org/metadata/v1/docs/openapi.yaml (`/geocodes`, Bearer token)
- NWS: https://www.weather.gov/documentation/services-web-api, https://www.weather.gov/documentation/services-web-alerts, `/alerts/active`
- USGS: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- EMSC: https://www.seismicportal.eu/webservices.html, https://www.seismicportal.eu/fdsn-wsevent.html, `/fdsnws/event/1/openapi.json`
- NOAA tsunami: https://www.tsunami.gov/events/xml/PHEBAtom.xml (and PAAQ)
- GDACS: https://www.gdacs.org/feed_reference.aspx, https://www.gdacs.org/xml/rss_24h.xml, https://www.gdacs.org/xml/gdacs_cap.xml
- ES-Alert / EU-Alert: https://www.xatakamovil.com/movil-y-sociedad/no-alarmas-aemet-madrid-lluvias-otras-no-vulneran-ley-proteccion-datos,
  https://en.wikipedia.org/wiki/EU-Alert
- Expo 58: https://docs.expo.dev/versions/v58.0.0/sdk/background-task/, https://docs.expo.dev/versions/v58.0.0/sdk/notifications/
- iOS interruption levels: https://onesignal.com/blog/ios-notification-changes-updates-from-apples-wwdc-21/; Critical Alerts criteria from
  Apple's rejection quoted at https://developer.apple.com/forums/thread/114385 (Apple's own page didn't render)
- Hosting: https://developers.cloudflare.com/workers/platform/limits/, https://developers.cloudflare.com/workers/platform/pricing/,
  https://developers.cloudflare.com/queues/platform/pricing/, https://deno.com/deploy/pricing, https://docs.deno.com/deploy/reference/cron/,
  https://docs.deno.com/deploy/migration_guide/, https://docs.cloud.google.com/free/docs/free-cloud-features,
  https://npmjs.com/package/@fivesheepco/cloudflare-apns2
- GitHub Actions schedule delays: https://github.com/orgs/community/discussions/210925
- Android without FCM: https://nextcloud.com/blog/unifiedpush-android-nextcloud-talk/
