# Official alerts: weather warnings and earthquakes from public services — plan

Owner request (2026-11-04): notify the person when an official service warns about something serious
where they are (earthquake, tsunami, severe weather such as a DANA or a tornado), maybe with Apple's
"emergency" notifications. Researched the same day (sources at the end, each one read on 2026-11-04);
the owner approved documenting it to implement next. Not built yet.

## The idea in one paragraph

Nomad Pocket does not issue alerts and does not compete with the government's own channel. Spain's
ES-Alert (and EU-Alert elsewhere in Europe, WEA in the US) reaches every phone by cell broadcast:
no app, no internet, top priority, sent only by Protección Civil. That is the channel for "leave
now". What no official channel does is say **"prepare while you still have a connection"**: AEMET
issues its warnings up to 72 h ahead, so an orange warning for tomorrow is the moment to download
the area's map, check the kit and the family plan. So the feature is: **show the official warnings
that cover where you are, notify the serious ones, and turn each one into two or three concrete
actions inside the app.** Phase 1 needs no server of our own; push from a server is phase 2, only
if phase 1 proves the feature is used.

## What there is today (code as of 18a36db)

- `expo-notifications` ~58.1.6 is installed with `enableRemoteNotifications: false` (`app.json`):
  local notifications only, no push entitlement. Used by the kit's expiry reminders
  (`src/features/prepare/reminders.ts`, channel `reminders`, a notification handler set there).
- `plugins/with-android-no-firebase.js` keeps Firebase and Play services out of the APK. This stays:
  no FCM on Android, ever (`docs/ANDROID_PLAY.md`).
- No background task module (`expo-background-task` / `expo-task-manager` are not dependencies).
  `UIBackgroundModes` is `location` + `audio` (navigation).
- Atom/XML is parsed with a small regex parser (`src/features/catalog/opds.ts`, no DOMParser in RN);
  `fflate` is a dependency (gunzip). Point-in-polygon over bundled shapes exists for countries
  (`src/features/maps/country-at-core.ts` + `country-shapes.json`, 213 KB).
- The person's country (`settings.country`, a `regions.json` id) is chosen in onboarding. Location is
  asked when Maps opens, through `src/lib/location.ts` only.
- E2E already serves fake feeds from the Mac: `scripts/e2e-updates-feed.py` +
  `EXPO_PUBLIC_UPDATES_OPDS_URL`, plain http to localhost allowed by `plugins/with-e2e-local-network`.
- The privacy policy (`site/privacy.html`) says the app has **no server of its own** and lists every
  third party it connects to.

## Sources (verified 2026-11-04)

| Source | Covers | How to read it | Licence / conditions |
|---|---|---|---|
| **AEMET** (Spain) | Weather warnings (rain, wind, storms, snow, heat/cold, coastal, dust, fog…), per zone, up to D+2/D+3 | Public RSS/Atom, **no API key**: national `https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml` (Península, Baleares, Ceuta, Melilla) and Canarias `…/CAP_AFAC65_RSS.xml`; per comunidad `CAP_AFAC{61–79}`, province `CAP_AFAP{code}`, zone `CAP_AFAZ{code}`. The **first item of every feed is a `.tar.gz` with all active CAP files** for that area (`…/avisos/cap/Z_CAP_C_LEMM_<stamp>_AFAE.tar.gz`). Each CAP 1.2 file has two `<info>` blocks (`<language>es-ES` and `en-GB`), `severity`, `onset`/`expires`, `headline`, `description`, `instruction`, parameter `AEMET-Meteoalerta nivel` (amarillo/naranja/rojo), and an `<area>` with a **`<polygon>`** and geocode `AEMET-Meteoalerta zona`. Updated whenever the warning state changes; regular issue windows 07:30–09:00, 10:30–11:30 (D+1, D+2), 17:00–19:00, 23:50 (D+3) | `© AEMET` or "Información elaborada por la Agencia Estatal de Meteorología"; commercial and non-commercial reuse allowed; **must not "desnaturalizar el sentido"** of the information; show the update date; never imply AEMET takes part in or endorses the reuse (`aemet.es/es/nota_legal`) |
| **MeteoAlarm** (EUMETNET, ~38 European countries, Spain included via AEMET) | Weather warnings | One Atom feed per country: `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country}` (e.g. `-spain`, `-germany`), WebSub available. Each `<entry>` = one area × one warning with `cap:event`, `cap:severity`, `cap:urgency`, `cap:onset`, `cap:expires`, `cap:areaDesc`, `cap:geocode` **EMMA_ID** (e.g. `ES084`, `DE329`), `cap:message_type`, `cap:identifier`, and a link to the full CAP (`https://feeds.meteoalarm.org/api/v1/warnings/feeds-{country}/<uuid>`, one per warning, shared by its areas). Full CAP: national language + `en-GB` blocks, `parameter awareness_level` ("2; yellow; Moderate", 3 orange, 4 red). **No polygons** in the feed or the CAP files seen: matching a location needs EMMA_ID region geometries. Feed ~195 KB (Spain) / ~275 KB (Germany) | Feed `<rights>`: "Licensed under terms equivalent to CC BY 4.0, **with additional requirements for redistributing outlined in our Terms and Conditions**". That page could not be read (SPA): **read it or ask `meteoalarm@geosphere.at` before shipping Europe**. A Metadata API (`api.meteoalarm.org/metadata/v1`) lists "Region geometries" (not checked); direct APIs need approval |
| **NWS** (USA) | All US alerts (tornado, flood, hurricane, winter, fire weather…) | `https://api.weather.gov/alerts/active?point=lat,lon` (or `?area=XX` by state, `?zone=`). GeoJSON (or CAP with `Accept: application/cap+xml`). Requires a `User-Agent` identifying the app; ask at most every 30 s; rate limit not public | US public domain |
| **USGS** (world) | Earthquakes | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{4.5_day,significant_day,…}.geojson`, updated every minute; properties `mag`, `time`, `place`, `alert` (PAGER colour), `tsunami`, `sig`. Note: `tsunami: 1` only means a large event in an oceanic region, **not** that a tsunami exists | US public domain |
| **EMSC** (Euro-Mediterranean) | Earthquakes, faster and smaller ones than USGS around Europe (includes IGN's) | FDSN event query on seismicportal.eu (`format=json`, `minmagnitude`, `starttime`, box or `latitude`/`longitude`/`maxradius` in degrees; exact path in `https://www.seismicportal.eu/fdsnws/event/1/openapi.json`, check it). Also a WebSocket `ws://www.seismicportal.eu/standing_order/websocket` (only useful to a server). Solutions are preliminary and get revised | Free; cite EMSC |
| **IGN** (Spain) | Earthquakes in Spain and around | GeoRSS (`ign.es` RssTools, ~5 min). EMSC already carries them: not needed in phase 1 | Cite IGN |
| **NOAA tsunami.gov** (US, Pacific) | Tsunami warnings | Atom `https://www.tsunami.gov/events/xml/PAAQAtom.xml` (NTWC) and `PHEBAtom.xml` (PTWC); CAP `PAAQCAP.xml`, `PHEBCAP.xml` | US public domain |
| **GDACS** (UN + EU) | Disasters with humanitarian impact worldwide (EQ, TC cyclones, FL floods, VO, WF, DR), Green/Orange/Red | RSS `https://www.gdacs.org/xml/rss.xml` (~700 KB) and lighter per-type feeds (`xml/rss_24h.xml`, `rss_tc_7d.xml`, `rss_fl_7d.xml`…), refreshed every 6 min; `gdacs:alertlevel`, `gdacs:eventtype` | Cite GDACS. Phase 1b at most: coverage for countries outside Europe/US, Orange/Red only |

Out, on purpose:
- **Bomb threats, attacks, police incidents**: no official public feed exists, and relaying anything
  else would be dangerous. Never.
- **ES-Alert / EU-Alert content**: cell broadcast only, no public API. The phone shows it anyway.
- **Tsunami warnings for the Mediterranean/Atlantic Europe** (NEAM: IGN, IPMA, INGV, KOERI…): no public
  feed found. Covered by cell broadcast; the app's guide already has tsunami advice ("strong quake at the
  coast: go up, don't wait for a warning").
- AEMET OpenData (needs an API key): the public RSS/CAP files are enough. Historical data is not needed.

## Decisions (proposed; the owner confirms the ones marked ❓)

1. **Phase 1 has no server of our own.** The app downloads public feeds itself and decides on the
   device what applies to the person. The location never leaves the phone: feeds are downloaded by
   country (Spain: the national file; Europe: the country's MeteoAlarm feed; quakes: global/regional
   lists), so a server learns at most the country, like it already does from the IP. One exception ❓:
   the US (NWS), see 6.
2. **Opt-in.** Nothing is fetched until the person turns "Avisos oficiales" on. Offered once on Home
   (a card under "En una emergencia") and always in Settings; turning it on asks for notification
   permission right then. ❓ Also offer it at the end of onboarding.
3. **What gets a notification (defaults, tunable in Settings):**
   - Weather: **orange and red** in a watched place (yellow only shows in the list). A notification when
     a warning is new, or raises its level; not for plain updates; a cancel removes it from the list.
   - Earthquakes: M ≥ 4.5 within 100 km, or M ≥ 6 within 500 km, of a watched place (informative: it has
     already happened; the card links to the guide's earthquake/aftershock cards).
   - Tsunami (tsunami.gov, US/Pacific only): any warning or advisory whose area covers a watched place.
4. **Watched places**: the last known position of the phone (saved, rounded to ~100 m, on the device
   only, whenever the app gets a fix: opening Maps, navigating), and the country chosen in onboarding
   (its warnings show in the list, notified only if no position is known). Later: saved places / the
   family plan's meeting points. No background location: the app never asks for "Always" for this.
5. **Matching a place to a warning**: AEMET → point in the CAP `<polygon>`. MeteoAlarm → EMMA_ID region
   geometries bundled as an asset generated by a script (like `country-shapes.json`), source to be
   chosen (Metadata API "Region geometries" first); if no usable geometry, the person picks their
   region from the country's EMMA list instead of matching by position. Quakes → distance.
6. ❓ **USA**: NWS geometry is often null (zone-based alerts), so the reliable query is
   `?point=lat,lon`, which sends a position to NWS. Proposal: round it to 0.05° (~5 km) and say so in
   the privacy policy; the alternative (`?area=` state + county shapes bundled) costs an asset and a
   script. Phase 1 starts with Spain + Europe; the US comes right after this is decided.
7. **How often**: on launch and on coming to the foreground (at most every 15 min), and a background
   task (`expo-background-task`: WorkManager on Android, min 15 min, we ask 30; BGTaskScheduler on iOS,
   which decides when, "short intervals are often ignored"). AEMET's issue windows (above) mean a few
   checks a day already catch most warnings hours ahead; quakes in the background are best effort and
   said so. If iOS runs Expo's task too rarely on a real phone (it uses the `processing` mode), add a
   `BGAppRefreshTask` in a local module (`modules/nomad-alerts`) and measure again.
8. **Notification levels**: Android channel `alerts` (importance HIGH; created once: after that only its
   name and description can change), separate from `reminders`. iOS: red/tsunami/strong quake as
   `interruptionLevel: 'timeSensitive'` (breaks through Focus; needs the "Time Sensitive Notifications"
   capability → `com.apple.developer.usernotifications.time-sensitive` in `app.json` `ios.entitlements`,
   check it lands in the prebuilt entitlements), orange as `active`. **No Critical Alerts** (the
   "emergency" permission that sounds in silent mode): Apple grants it by hand for medical, home
   security and public safety, and refuses it when Time Sensitive is enough; for warnings issued hours
   ahead it is. Revisit only if phase 2 ships and the owner wants to apply. No Android DND bypass either.
9. **Official words, our frame.** The card and the notification show the source's own `headline`,
   `description` and `instruction` in the app's language when the CAP has it (es/en), else English,
   else the original. The app only adds the frame: level, phenomenon, place, from–until, "Fuente: AEMET ·
   emitido 18:12" and the actions. Never rewritten, summarised by the AI or translated by us (AEMET:
   "no desnaturalizar"). Each source credited where shown and in Credits.
10. **Actions per warning** (what makes it Nomad Pocket's): download or update the map of that area
    (if missing or old), open the family plan, check the kit, open the relevant guide card (flood,
    heat, storm, earthquake, tsunami), and "Llamar al 112" (the local number, `emergency-numbers.json`).
11. **Honest disclaimer**, on the alerts screen and in the opt-in: "Nomad Pocket no emite avisos: muestra
    los publicados por AEMET, MeteoAlarm… y puede retrasarse o no llegar. Los avisos de Protección Civil
    (ES-Alert) y el 112 son los que valen." (and the English equivalent).
12. **Offline**: the last fetched list stays visible with "actualizado hace X"; warnings past `expires`
    disappear on their own. Nothing to do offline beyond that.
13. **Android**: no health gate needed (weather and quakes are not health features), but no first-aid
    content is attached to a warning on Android (`HEALTH_FEATURES`, `docs/ANDROID_PLAY.md` section 4):
    heat warnings link to the guide only where the guide is shown.

## Design

```
src/features/alerts/
  cap-core.ts          CAP 1.2 parser (regex, like opds.ts): alert, info per language, area polygons/geocodes
  tar-core.ts          minimal ustar reader over fflate's gunzip (AEMET's .tar.gz)
  alerts-core.ts       normalised Alert type, level mapping (CAP severity / AEMET nivel / MeteoAlarm
                       awareness_level → yellow|orange|red), match to watched places (point in polygon,
                       EMMA region, distance), notify policy (new, raised, cancelled, dedup by identifier
                       and CAP references), expiry
  sources/aemet.ts     RSS → first item's tar.gz → CAP files (national + Canarias)
  sources/meteoalarm.ts  country Atom → entries by EMMA_ID → full CAP for the ones that match
  sources/nws.ts       (after decision 6)   sources/quakes.ts  USGS + EMSC   sources/tsunami.ts
  fetch.ts             runs the sources for the watched places, merges, persists, notifies
  notify.ts            channel `alerts`, interruption level, tap → /alerts/[id]
  background.ts        expo-background-task + TaskManager.defineTask at module scope
  register.ts          registerInit: define/register the task, foreground check
  *.test.ts + fixtures/ (real CAP/RSS/tar.gz/Atom/GeoJSON samples saved on 2026-11-xx)
src/app/alerts/index.tsx  list   src/app/alerts/[id].tsx  detail (official text + actions)
```

- Pure modules (`*-core.ts`) follow the repo rule: no `@/` aliases, siblings imported with `.ts`, so
  `node --test --experimental-strip-types` loads them; add them to the list in `CLAUDE.md`.
- State in kv (`@/db/kv`): `alerts.enabled`, `alerts.places` (rounded last position), `alerts.cache`
  (normalised alerts per source + fetch time + ETag/Last-Modified), `alerts.notified` (identifier →
  level). Small, derived; no SQLite table needed.
- Requests send `If-Modified-Since`/ETag where the server supports it and a `User-Agent` naming the app
  and its public repo (NWS requires one; no personal email in it).
- The background task runs headless: `background.ts` imports nothing from React or the UI; i18n is
  initialised before building notification text. The task is defined at module scope and imported from
  the entry so it exists when the OS launches the app in the background.
- New dependencies (`npx expo install expo-background-task expo-task-manager`): check that neither pulls
  `com.google.android.gms` into the APK (`./gradlew :app:dependencies`), then `node scripts/licenses.mjs`.
- E2E overrides like the updates feed: `EXPO_PUBLIC_ALERTS_AEMET_URL`, `…_METEOALARM_URL`,
  `…_QUAKES_URL`, served by a `scripts/e2e-alerts-feed.py` from fixtures with a warning over the
  simulator's set location.

## Privacy, store and legal

- **Privacy policy** (`site/privacy.html`, es + en): add each new connection (aemet.es,
  feeds.meteoalarm.org, earthquake.usgs.gov, seismicportal.eu, tsunami.gov, api.weather.gov if 6 goes
  ahead), only when "Avisos oficiales" is on, what they receive (IP, which country's feed; for NWS the
  rounded position), and that the position used for matching stays on the device. Still no server of
  our own in phase 1. The App Store privacy labels don't change (nothing is collected by us).
- **Store texts**: "What's new" and the description mention official warnings with the disclaimer (the
  owner reviews them, `docs/RELEASE.md`). Never call it an "emergency alert system" or use the look of
  the system's emergency alerts.
- **Credits**: AEMET, MeteoAlarm/EUMETNET (CC BY 4.0), USGS, EMSC, NOAA/NWS, GDACS (`features/credits`).
- **MeteoAlarm's extra redistribution terms**: unread (see Sources). Blocking for the Europe source,
  not for Spain (AEMET direct).

## Phase 2 (only if phase 1 is used): push from a small server

- Why: background checks on iOS are irregular; a server can watch feeds every minute (EMSC's WebSocket,
  MeteoAlarm's WebSub) and push within a minute or two.
- Shape: a Cloudflare Worker with a cron every minute + D1 (free tier is enough), diffing the feeds and
  sending APNs (HTTP/2, `.p8` key; `@fivesheepco/cloudflare-apns2` is a Workers-compatible fork with very
  few users: test it, or a ~4 €/month VPS instead). Devices register a token + the zones they watch
  (EMMA/AEMET zone codes, not coordinates).
- Costs: the first server of the app (privacy policy and possibly the App Store labels change: device
  token + zone is data we hold), `enableRemoteNotifications: true` on iOS only, monitoring and on-call
  for a channel people may rely on.
- Android: still no push (no FCM; UnifiedPush needs another app like ntfy installed). It keeps polling.
- **GitHub Actions is not an option** for this: scheduled runs come 15–30+ min late or not at all under
  load, are disabled after 60 days without activity, and there is nowhere safe to keep device tokens.

## Order of work

1. Fixtures (save real AEMET RSS + tar.gz + CAP, MeteoAlarm Atom + CAP, USGS/EMSC JSON) and the pure
   cores with tests: CAP parser, tar reader, levels, matching, notify policy. Measure the AEMET tar.gz size.
2. AEMET source + fetch/persist + the `/alerts` list and detail; Home card; Settings switch and opt-in.
3. Local notifications (channel, levels, tap), dedup across restarts.
4. Background task; measure how often it really runs on the owner's iPhone and on Android over a few
   days (log the runs in kv, shown in a debug row); decide on the native `BGAppRefreshTask`.
5. Earthquakes (USGS + EMSC). Then MeteoAlarm with EMMA geometries (after reading its terms). Then the US
   (after decision 6) and tsunami.gov. GDACS last, if at all.
6. Privacy policy, credits, i18n (es + en), `docs/ARCHITECTURE.md` (alerts section), `docs/E2E.md`
   (new flows, testIDs), `docs/STYLE_GUIDE.md` if the warning colours need tokens (yellow/orange/red
   levels next to the signal yellow: pick them with contrast checks).
7. Verify: unit tests, E2E on the iOS simulator and Android emulator with the fixture server, the
   background task on real phones (`triggerTaskWorkerForTestingAsync` in a debug build;
   `adb shell cmd jobscheduler run -f com.fjlinde.nomadpocket <id>` on Android; the simulator can't run
   background tasks).

## Open questions for the owner

- ❓ Opt-in also at the end of onboarding, or only Home + Settings?
- ❓ Default thresholds (orange+ for weather; the quake rule above)?
- ❓ US: send a rounded position to NWS, or bundle county shapes?
- ❓ GDACS for the rest of the world, or leave countries without a national source uncovered at first?
- ❓ Phase 2 and Critical Alerts: confirm they wait until phase 1 has been used for a while.

## Sources read (2026-11-04)

- AEMET feeds and format: https://www.aemet.es/es/rss_info/avisos/esp, https://www.aemet.es/es/eltiempo/prediccion/avisos/ayuda,
  a live CAP file and the national RSS; reuse terms https://www.aemet.es/es/nota_legal
- MeteoAlarm: https://feeds.meteoalarm.org (feed list, CC BY 4.0), live Spain/Germany feeds and a CAP file,
  https://api.meteoalarm.org (portal; Metadata API "Region geometries")
- NWS: https://www.weather.gov/documentation/services-web-api, https://www.weather.gov/documentation/services-web-alerts
- USGS: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- EMSC: https://www.seismicportal.eu/webservices.html, https://www.seismicportal.eu/fdsn-wsevent.html
- NOAA tsunami feeds: https://www.tsunami.gov/events/xml/PHEBAtom.xml (and PAAQ)
- GDACS: https://www.gdacs.org/feed_reference.aspx, https://www.gdacs.org/xml/rss.xml, https://www.gdacs.org/xml/gdacs_cap.xml
- ES-Alert / EU-Alert: https://www.xatakamovil.com/movil-y-sociedad/no-alarmas-aemet-madrid-lluvias-otras-no-vulneran-ley-proteccion-datos,
  https://en.wikipedia.org/wiki/EU-Alert
- Expo 58: https://docs.expo.dev/versions/v58.0.0/sdk/background-task/, https://docs.expo.dev/versions/v58.0.0/sdk/notifications/
- iOS interruption levels: https://onesignal.com/blog/ios-notification-changes-updates-from-apples-wwdc-21/; Critical Alerts
  criteria from Apple's rejection quoted at https://developer.apple.com/forums/thread/114385 (Apple's own page didn't render)
- GitHub Actions schedule delays: https://github.com/orgs/community/discussions/210925
- Android without FCM: https://nextcloud.com/blog/unifiedpush-android-nextcloud-talk/
- APNs from Workers: https://npmjs.com/package/@fivesheepco/cloudflare-apns2
