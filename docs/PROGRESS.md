# Progress

Living document: current status, backlog, known issues and a dated log. Update it at
the end of every work block (status table, a log entry, next steps) so the next session
can pick up without re-deriving anything.

## Current state (2026-10-25)

- **Version 1.1.0 (iOS build 10)** on TestFlight 2026-10-25 (builds 5–9 earlier that day);
  **1.0.1 (build 3)** waiting for App Review. Release process and version table: `docs/RELEASE.md`.
- All four MVP modules plus onboarding work end to end on the iOS simulator (iOS 27,
  Release) and the Android emulator (API 36, release APK). iPad layout verified (visual
  tour). Not yet run on a physical device by the agent.
- Checks: 132 unit tests (131 pass, 1 network test skipped), `tsc` clean, lint clean, i18n keys complete. E2E: 55 Maestro flows (21 smoke,
  16 full, 12 nightly, iPad tour, 5 Android flows) covering 53 of 55 test-plan cases plus the new maps cases, AI-06/07 and PREP-01…04.

| Area | Status |
|---|---|
| Foundation (design system, nav, i18n, db, downloads core) | done |
| Catalog (101 resources, 6 categories, Wikipedia picker, Kiwix OPDS explore, Files import) | done |
| Downloads (queue, pause/resume, iOS background, fastest Kiwix mirror, Wi-Fi-only) | done |
| Onboarding (language → starter pack → tips) | done |
| ZIM library + reader (search, TOC, bookmarks, history, find, text size, dark mode) | done — iOS + Android |
| Courses (14 courses, syllabus with fallbacks, progress) | done |
| Maps (in-app PMTiles extraction, regions, visible area, world basemap, markers, GPS, multi-script labels) | done — iOS + Android |
| Maps search + Emergencias + straight-line guidance (plan phase 1, `docs/MAPS_NAVIGATION_PLAN.md`) | done — iOS sim + Android emulator (Release, E2E) |
| Maps road routing on the device (Valhalla, plan phase 2): packs, catalog, downloads, route guidance | done — iOS sim + Android emulator (Andorra pack); 79 packs live 2026-10-25 (Europe + Latin America up to Spain's size); E2E vs the live catalog on iOS + Android |
| Maps turn-by-turn (voice, background location; plan phase 3) | planned |
| Assistant (Apple Intelligence / Gemini Nano / 4 GGUF models, RAG with citations, conversational: the model decides when to search) | done — iOS sim (Apple FM + llama.cpp), Android emulator (llama.cpp, before the conversational change); Gemini Nano untested |
| Store (listing, screenshots, privacy site, in-app disclaimers) | done for iOS; Android not published |
| Preparedness (family plan, emergency kit with expiry reminders, printable PDF, offline guides) | done — iOS sim + Android emulator (E2E) |
| E2E suite (Maestro) + pre-commit hook | done |

## Decisions (kickoff 2026-10-24, by the owner)

- Standalone app (no NOMAD server), React Native + Expo, iOS + Android.
- MVP: ZIM library, offline maps, courses, local AI. UI + content in ES and EN.
- GPL-3.0 open source (libkiwix). Public GitHub repo `franlindebl/nomad-pocket`.
- Maps: in-app extraction from the Protomaps daily build (bbox/country).
- AI: system models (Apple FM / Gemini Nano) + downloadable GGUF via llama.rn.
- Courses: educational ZIMs + progress layer (Kolibri not in MVP).
- Name "Nomad Pocket", bundle id `com.fjlinde.nomadpocket`, iOS 16.4+ / Android 8+.
- Later: E2E suite run by hand (no CI, no E2E git hook), flows in Spanish; iPad covered
  by a visual tour; release builds uploaded locally with xcodebuild (no EAS).

## Next steps / backlog

Roughly by value. Item 0 is in progress; the rest are not started. (Preparedness was added
on 2026-10-25 from an "internet goes down" checklist; follow-ups are at the end.)

0. Routing packs: 60 whole-country packs live since 2026-10-25 (20.6 GB, with street
   names for search): Spain (incl. Canarias), Portugal, Andorra and 57 more countries of
   Europe and Latin America (every one whose Geofabrik extract is ≤ Spain's). E2E against the live catalog passes on iOS
   (`map-16-routing-github`) and Android (`android-05-routing`). Next, step 4 of the
   coverage roadmap in `docs/MAPS_NAVIGATION_PLAN.md`: Brazil, Poland, Italy, UK,
   Germany, France, Russia need sub-country packs (no subdivisions in `regions.json`
   except Spain and the USA), then the rest of the world.
   Measure on a real phone: route time/memory, assembling Spain (2.2 GB, JS copy), mmap of
   a 2 GB tar on iOS (may need `com.apple.developer.kernel.extended-virtual-addressing`).
   Then phase 3 (turn-by-turn: voice with expo-speech, background location).
1. Watch App Review for 1.0.1; test 1.1.0 (build 10, TestFlight) on a real iPhone: navigation view (driving and on foot), compass beam, street and school search, routing
   packs (download Spain 2.2 GB, route time/memory), Preparedness reminders, GPU
   llama.cpp, Apple Intelligence, background downloads, Files import, airplane mode.
2. Publish packs with the search side files: the next routing-packs build (monthly or
   manual dispatch) adds `.places.tsv` / `.addresses.tsv` to every pack (code landed
   2026-10-26; the published packs don't have them yet). The country packages of the
   redesign (`ux-survival`) call the same scripts and index functions. Measure the import
   on a real phone (Spain: 1.0 M places + 2.2 M doors).
3. Resume downloads after the app is killed on iOS: reattach the background URLSession
   (small native module) instead of restarting from zero.
4. Map extraction: resume after a kill (persist the plan + written ranges) and move it off
   the JS thread.
5. Android release: upload keystore, Play listing + data safety;
   test Gemini Nano on an AICore device.
6. Reader: auto-hiding toolbar on scroll (style guide), syllabus for SPA course ZIMs read
   from the rendered DOM.
7. Assistant: copy / regenerate an answer; better small-model citations; check the
   conversational flow on Android (llama.cpp tools + Gemini Nano heuristics) and on a
   real iPhone (tool-call latency with Metal).
8. Preparedness follow-ups: share ZIMs/maps phone to phone (share sheet export, import
   exists); "Ready.gov"-style quick cards bundled in the app (radio frequencies, first aid)
   that need no download; optional Face ID lock for the plan; cold-start notification tap
   (only a warm tap opens the kit now); link the plan's meeting points to maps' Llévame
   guidance and the hub to the Emergencias sheet (both landed on main in parallel).


## Known issues / limitations

- Map search: house numbers and far-away POIs need a pack built with the side files
  (none published yet). Without one, big regions are indexed at a lower zoom (≤ 40k tiles:
  Spain z14 → z12) with full detail only within ~25 km of the user or the searched area.
  House numbers are as complete as OSM (Spain: 2.2 M doors; "Calle de Alcalá 50" isn't
  mapped, so it lands between 48 and 52, marked approximate). Indexing and imports run on
  the JS thread in batches (not yet measured on a device).
- Emergency points depend on public Overpass servers (best effort; they can be at capacity
  for minutes). Fallback: the POIs in the map's own tiles (complete only at z15).
- OSM data quality shows through: a garage mapped without `access=private`/`tunnel=yes`
  still draws as a thin line (routes no longer start in it). Not modelled: low-emission
  zones (Madrid ZBE), live closures, traffic.
- Road routing needs a routing pack for the area (else the straight line). No
  isochrones (valhalla-mobile exposes none), no cross-pack routes (the country pack covers
  them), no voice / background navigation yet. Pack sha256 is not verified (size is).
  Overpass still runs after each map download even where a pack brought the points.
- Bbox queries (map dots, locality context) don't handle regions across the antimeridian.
- Map screen first opens on the world when a region is registered after the first render
  (seeded/loose maps): pre-existing, cosmetic.
- `app.json` location purpose string changed (distances/guidance): needs `npx expo prebuild`
  before the next store build.

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs on the JS thread in the foreground (screen kept awake) and does
  not resume after the app is killed.
- Gemini Nano path compiled but untested on a real AICore device; its output-token limits
  are unverified.
- Qwen3.5 0.8B rarely emits `[n]` (all retrieved sources are shown then) and is
  unreliable for health answers — the app recommends 2B+ where RAM allows. In small talk
  it sometimes rambles or echoes its instructions, and it searches some chit-chat
  ("¿te gusta la música?") on its own.
- The models still answer some famous facts from memory instead of searching ("What is
  photosynthesis?"); the "Buscar en mi biblioteca" button covers it. Apple FM tends to
  open every answer with "¡Hola!" once the chat started with a greeting.
- Apple Intelligence fails on the iOS 26.5 simulator (works on iOS 27).
- E2E: the setup wizard occasionally doesn't show on a fresh install (`lib-03` failed once
  in a full run on 2026-10-25, then passed 3/3): the onboarding push race, not new code.
- Kit reminder texts are written in the language active when the expiry was saved.
- Map labels in Bengali, Tamil and other Indic scripts, Myanmar and Khmer are not drawn
  (MapLibre Native can't shape them); country bboxes skip far-flung territories.
- ZIM media Range path untested with a real video archive.
- Not automated: importing a ZIM from Files (system picker) and true offline mode
  (simulator has no airplane mode); the Android tour covers visible-area map downloads but
  not the named-region picker or the assistant (both checked by hand on the emulator).

Build gotchas moved to `docs/DEVELOPMENT.md`.

## Log

### 2026-10-26 — Maps: every named place and house number in the packs

- Owner decision: a country download holds everything, more storage is fine. Every named
  place of the country (whatever the map zoom) and every house number now come from the
  pack: `scripts/routing/places.py` (one osmium filter `nwr/name nwr/addr:housenumber`,
  two pyosmium passes for relation centres) → `<pack>.places.tsv`, `<pack>.addresses.tsv`,
  in the manifest as `places` / `addresses`, downloaded and imported like the street names.
- Spain (Geofabrik 2026-10-25): 1,001,318 places (50 MB) and 2,237,121 doors (97 MB),
  4 min in the build. On the phone: ~137 MB FTS rows and ~49 MB of doors (migration v3:
  streets keyed by `nameKey`, `WITHOUT ROWID` doors with 1e-5° integer coordinates,
  ~22 B each); Mac import 17 s, phone not measured.
- Search: an address shows the door first ("Calle Mayor, 1" · Portal), else an
  approximate one between neighbours or the nearest number on that side ("Calle de Alcalá,
  50" · Portal aproximado: OSM has 48 and 52 but not 50).
- Abbreviations also match the Catalan word ("Avda" → avinguda, "Pº" → passeig, "Pza" →
  plaça). With only a routing pack (no map), an empty search said "download a map": fixed.
- E2E: map-15 now also searches a place ("Comapedrosa") and an address ("Avda Meritxell
  86" → Portal) from the pack's new side files (Andorra fixtures); all 15 maps flows pass.
- Shared with the redesign session, which wires the same files into its country packages
  (maps without a routing pack call places.py from `build-country-map.sh`).

### 2026-10-25 — Maps: search finds nearby schools; addresses and abbreviations

- Owner on build 9 (Spain map): schools near a Madrid test spot not found; "Calle Alcalá 50" found nothing. Cause: Spain's map is indexed at z12, where
  Protomaps keeps no schools (they are in z14/z15 tiles); a number in the query was a word
  that had to match.
- Detail index: the map's max zoom (≤ 15) over a 50 km square around the user / the
  searched area, besides the whole-map index (`listZoomTiles` takes a bbox). Checked on
  the live planet around that spot: z14 finds one school's grounds and a sports centre; the school building itself only at z15. On the simulator
  (a z15 Madrid extract, index budget forced down on a throwaway build): all three found.
  A fresh install has no last known position: startup takes one coarse fix instead.
- Addresses: "Calle Alcalá 50", "C/ Mayor 1", "Dr Fleming 10" find the street;
  abbreviations (Avda., Pº, C/, Dr., Sta., Ntra. Sra.…) match the full word; "de/la/…"
  don't count when ranking ("Calle Alcalá" ranks "Calle de Alcalá" first). House numbers
  and every POI of the country from the routing packs: backlog item 2.

### 2026-10-25 — Maps: garages, tunnels and mountain trails

- Owner on build 8: a private garage under a Madrid block
  showed as a street and routes started through it. Cause, reproduced on a local Valhalla
  3.9.1 with the Madrid graph: the start snapped to the garage's parking aisle (OSM:
  driveways + `parking_aisle` at `layer=-1`, mostly without access tags). Car routes now
  snap both ends to streets (`min_road_class: residential`).
- Looked for similar traps (owner asked; the web had little Valhalla-specific): starts
  above a tunnel snapped into it (Plaza de España) → `exclude_tunnel` except on reroutes;
  foot routes allowed only T1 trails → `max_hiking_difficulty: 2` (Andorra hut: 3.6 km on
  the trail instead of 6.4 km to the wrong place); `date_time`: no effect; car tracks are
  already avoided by default (`use_tracks` 0).
- Map: private and underground service roads hidden, the rest at half width.

### 2026-10-25 — Maps: navigation view

- Owner asked for Google Maps / Waze driving view, then (seeing the half-screen card)
  for an "Iniciar" button and a smaller panel. Guidance now opens as a preview (card +
  "Iniciar", whole route framed above the card); started, a maneuver banner at the top
  and a slim bar (time, km · arrival, directions, stop). `FollowCamera.tsx`: the
  map follows the user, tilted, the way ahead up (the route's direction, else GPS course,
  else compass on foot), user low on the screen above the panel, an arrow instead of the
  dot. Pan → "Recentrar"; route button → whole trip. Pure `follow-core.ts` (+ tests),
  `RouteProgress.aheadBearing`, `pointAlong`. New flow `map-17-follow` (drives the CG-1
  in Andorra with Maestro `travel`).
- Build 7 (stronger beam) on TestFlight with notes; build 8 with the navigation view.
- CarPlay analysed at the owner's request (not planned for now): Apple's navigation
  entitlement is the gate, background location and voice come first; analysis in
  `docs/MAPS_NAVIGATION_PLAN.md` ("CarPlay — analysis").

### 2026-10-25 — Maps: compass beam

- Owner asked for Google Maps' "flashlight": `HeadingBeam.tsx` draws a fan under the
  position puck that turns with the compass (wider while uncalibrated), only while the
  Maps tab is in front. New `location` token (blue) for the puck (map `tintColor`, was
  `textSecondary` grey on iOS) and the beam images (`scripts/maps/make-beam.py`).
- Checked on the Android emulator with a fixed heading (it has no rotation-vector
  sensor, so no compass events; the iOS simulator has no compass either): the beam
  renders from the puck, under the map's dots. Tab blur/focus verified; a sheet over the
  map keeps it. iOS map-08/10/14 pass. Needs a real phone to see it turn.
- Owner on build 6: beam too faint. Peak opacity 0.5 → 0.72 (dark 0.56 → 0.78), slower fade (build 7).

### 2026-10-25 — Whole-country packs; street search from the packs

- Owner feedback on build 5: no region packs, whole countries only (very large ones may
  be split coarsely later). Spain's 17 region packs are gone; Spain merges Geofabrik's
  Spain + Canary Islands extracts (`geofabrik` may be a list, `osmium merge`); `carry`
  drops packs of rebuilt countries and of countries no longer listed. `slice.py` removed.
- A Madrid side street wasn't found: a big map is indexed at a low zoom
  (40 000-tile budget) where only main roads exist. Packs now carry `<id>.streets.tsv`
  (`streets.py`: every named street per ~1 km + localities), imported into the search
  index (`indexPackStreets`, batched), also for packs installed earlier
  (`fetchMissingStreets` after each catalog refresh, which now also runs 4 s after
  startup). Search also matches within 30 km of the user (a common name nearby was lost
  among the first 600 hits of a country).
- Run 40210737248 rebuilt every country (61 jobs, all green): catalog `routing-20261025-5`,
  60 packs, 20.6 GB, no region packs, every pack with street names. Spain 2.27 GB (2
  parts, Canarias covered) + 73.6 MB of street names; Mexico 60.7 MB of names.
- Local pipeline test (Andorra + Monaco merged): 548 points, 1736 names. iOS maps flows
  13/13 (map-08 passed on rerun: onboarding race); map-15 now also finds a pack street.

### 2026-10-25 — Routing packs: Europe and Latin America, E2E against GitHub

- `packs.json` +57 countries (all of Europe / Latin America with a Geofabrik extract ≤
  Spain's 1.4 GB): run 40200828250, 57/57 built in 57 min (8 in parallel; slowest 17 min,
  Austria and the Netherlands). Biggest packs: Mexico 1.9 GB, Ukraine 1.0 GB. `iso` may list
  several countries (`DO,HT`, `IE,GB`) for extracts that span them.
- Coverage clipped to each extract's `.poly` in the publish job (`manifest.py clip`):
  the ferry lines in the extracts made Ireland "cover" Cherbourg and Roscoff, Denmark
  Tallinn, Albania Slovenia; Spain went from 182 to 101 cells, and Ceuta, Melilla,
  Baleares, Madeira, the Azores and Galápagos stay covered.
- E2E against the published catalog: `map-16-routing-github` (iOS, nightly; the suite's
  local server serves a copy of the live manifest, packs come from GitHub) and
  `android-05-routing` (the release APK reads GitHub). iOS map-15 + map-16 pass; Android
  5/5 on the merged code (incl. Preparedness, after `npx expo prebuild --clean`).

### 2026-10-25 — Routing packs: first publish

- First workflow run (40186942180): Portugal (10 min, 582 MB) and Andorra published in
  `routing-20261025-1`; Spain built in 25 min (2.19 GB in 2 parts, 17 region packs) but
  `gh release upload` refused the 0-byte `es-cn.pois.tsv`: Geofabrik's Spain has no
  Canary Islands, so the slice was empty.
- Fixes: Canarias is its own `packs.json` entry (`africa/canary-islands`, ISO ES; the
  country build skips subdivisions with their own entry); `manifest.py` drops packs with
  no tiles and empty point files and clips subdivision coverage to the region bbox (the
  Canary extract's ferry lines reached Cádiz); the upload step sends exactly the files
  the fragment lists; the publish job prunes releases no manifest points at.
- Canarias built locally with the CI recipe: 77 MB, 377 KB of points, 13 cells.
- Re-run 40198385548 (`es es-cn`, 14 min): `routing-index` now lists 22 packs; pruning
  kept `-1` (Portugal, Andorra) and `-2`. Asset URLs answer 200 with the manifest sizes.

### 2026-10-25 — Maps: offline road routing (plan phase 2)
- Owner: commit phase 1 and start phase 2. `modules/nomad-route`: Valhalla 3.9.1 via
  Rallista valhalla-mobile 0.6.4 (iOS xcframework fetched + sha256-pinned by postinstall,
  Android Maven AAR, ~7.5 MB per platform). iOS pitfall: including Valhalla headers in our
  `.mm` made every tile-extract search fail (171) through ODR — found with lldb on
  `__cxa_throw`; the bridge now calls only the wrapper's free functions.
- Routing packs (`content/routing/*.tar`, kind `route`): coverage by 1° cells, smallest
  covering pack first with fallback, serialized engine calls. Catalog from GitHub Releases
  (`routing-index`), downloads in parts (≤ 1900 MiB) reassembled crash-safely, pack
  emergency points imported into Emergencias/search. Sheet "Rutas sin conexión" (from the
  guidance panel and Regiones), directions sheet.
- Guidance: car / foot / bike, next maneuver + distance, remaining distance/time/arrival,
  route line, reroute after two off-route fixes, recovery from failed reroutes and stale
  fixes, straight-line last stretch when the route ends at the road.
- Pack pipeline: `scripts/routing/build-country.sh` (Geofabrik + Overpass admins →
  Valhalla tiles → country + subdivision packs → POIs via osmium → split → manifest),
  `.github/workflows/routing-packs.yml` (monthly + manual, one tag per run). Andorra built
  locally end to end (3.1 MB, 408 points) — it is the E2E fixture.
- E2E: `map-14-route` (smoke, seeded pack) and `map-15-routing-download` (full, local pack
  server started by `scripts/e2e.sh`, two-part assembly) pass on the iOS 27 simulator; the
  same download + route checked on the Android emulator (throwaway cleartext build).
  Independent review: 16 findings, fixed (assembly crash safety, orphan parts/POIs,
  size checks, bbox over-claiming, reroute recovery, false arrival, CI dropping countries,
  engine call races, Android close on the JS thread, tzdata marker order, …).

### 2026-10-25 — Maps: search, Emergencias, straight-line guidance
- Owner approved the maps plan (`docs/MAPS_NAVIGATION_PLAN.md`): phase 1 now, routing packs
  on GitHub Releases later, Overpass at download time, military sites shown.
- `src/lib/mvt/decode.ts` (minimal MVT decoder: wanted layers only, one point per feature)
  and `src/lib/pmtiles/reader.ts` (tiles of one zoom from a local archive), with tests on
  the real Soria fixture.
- Search: FTS5 index of places/POIs/streets per installed map (migration v2), background
  queue, ranking by match/importance/distance, locality context, saved places, coordinates
  in decimal/DMS/UTM (`geo.ts`, tested against UTM reference points).
- Emergencias: sheet from the map (red button) and Home — call 112/911, share position
  (decimal + UTM + OSM link), position card, 5 categories by distance, police force from
  `operator` (Guardia Civil / Nacional / Local / autonómica), ER badge, phone; points from
  Overpass per region (cells ≤ 3°, TSV, 3 servers, per-request timeout) with the tiles'
  own POIs as offline fallback; map layer with category colours.
- Place card (Llévame / Guardar / Llamar) and straight-line guidance panel (GPS + compass,
  keep-awake, arrival haptic); Llévame also in saved places.
- Privacy page: Overpass and "share my position" added (not deployed: push needed).
- E2E: `map-10-search`, `map-12-emergency-empty` (smoke), `map-13-emergency-points`
  (nightly, Overpass) pass on the iOS 27 simulator (Release); `android-03-search-emergency`
  passes on the Android emulator (API 36, release APK) with the rest of the Android tour.
- Independent review fixed: Overpass retries ignoring a removed map (abortable sleep,
  re-check before storing), re-downloaded maps not re-indexed / re-fetched while a job was
  queued (run-again flag), map dots dropping hospitals in dense areas (priority ORDER BY
  before LIMIT), search ranking only an arbitrary 600 rows (ORDER BY importance), "arrived"
  with a coarse fix (accuracy capped at 50 m), guidance starting from a stale position;
  Overpass CSV-quoted names ("Acuartelamiento ""Capitán…""") unquoted.
- Valhalla spike: viable (numbers and pack design in the plan).

### 2026-10-24
- Analysed Project NOMAD source (admin/ AdonisJS app + collections JSON).
- Scaffolded Expo 58 app, design tokens + UI kit, navigation shell (native tabs),
  i18n (es/en), SQLite schema, content registry, download manager, settings screen,
  downloads sheet, home screen.
- Library UI (categories, cumulative tiers, resource sheet, Wikipedia picker,
  Kiwix OPDS explore with prefix search, ZIM import from Files).
- Catalog agent delivered `src/data/catalog.json` (101 verified resources, 23 es,
  14 courses), `scripts/validate-catalog.mjs`, OPDS client + tests.
- Courses tab: my courses, subject filter, detail with syllabus (main-page links)
  and lesson completion (history ∪ manual marks).
- Setup wizard (language → starter pack sized to free space → tips), auto-shown
  on first launch. App icon (compass mark), adaptive icons, themed splash.

- Verified on iOS 26.5 simulator (Release): onboarding, library, category tiers,
  courses, Light pack real download with progress/ETA, pause/resume, queue (2 slots).
  Verified Android emulator (API 36, Release APK) boots and renders onboarding.
- Fixed: crash from BigInt sizes in expo-file-system progress events; large titles
  (`headerLargeTitleEnabled`); home double top inset on iOS; Wi‑Fi-only prompt now
  offers "use mobile data"; lighter starter packs.

### 2026-10-24 — Integration (lead)
- All agent branches merged into main (catalog, maps, ZIM, AI). 70 tests pass.
- Android runtime fixes: R8 stripped `org.kiwix.libzim.Archive.nativeHandle` used by
  JNI → `modules/nomad-zim/android/consumer-rules.pro` keeps `org.kiwix.**`; WebView
  fits desktop pages (`useWideViewPort`); tab bar themed. Verified on the emulator:
  download → register → reader (WikiRoca), world basemap extraction + rendering.
- iOS: native large title renders blank inside native tabs on iOS 26 → tab roots draw
  their own title (`<Screen title>`); onboarding waits for settings hydration; course
  syllabus rebuild loop fixed; scanned ZIMs recover catalog metadata; reader ignores
  file-name titles; downloads interrupted during "processing" finish on next launch;
  stored content URIs re-anchored after container moves; `File.move/copy` awaited.
- Android emulator verified end to end: Qwen3.5 0.8B download → llama.cpp answer with
  `[n]` citations from WikiRoca (screenshot `assistant-android.png`); composer now sits
  right above the keyboard (keyboard height minus the bottom-nav gap).
- Apple Intelligence on the **iOS 26.5 simulator** fails every request with
  `GenerationError -1` (works on the iOS 27 simulator per the AI agent) — environment,
  not app; errors now keep the case name to diagnose on a real device.

### 2026-10-24 — Maps (phase 3)
- `src/lib/pmtiles`: PMTiles v3 reader/extractor in TS with node tests (Hilbert ids
  vs. the official `pmtiles` package, directory round-trips, end-to-end extracts
  validated with the official reader, a real 120 KB planet fixture, opt-in live
  test `PMTILES_NETWORK=1 npm test`).
- Maps tab: full-screen MapLibre map on local `pmtiles://file://` archives, bundled
  glyphs/sprites, world z0–5 basemap under regions, region picker (countries, CCAA,
  US states), "download visible area" with zoom choice and exact size, markers,
  locate-me, compass. Verified on the iOS simulator (Release build).
- Known limits: extraction runs on the JS thread in the foreground (screen kept
  awake) and does not resume after the app is killed; no CJK/Arabic glyphs bundled
  (those labels are dropped); country bboxes skip remote territories; very large
  areas are refused above 2.5 M tiles (choose less detail).

### 2026-10-24 — ZIM library (phase 2)
- `modules/nomad-zim`: libkiwix 14.2.1 xcframework (iOS, Obj-C++ wrapper) and
  `org.kiwix:libkiwix:2.7.0` (Android). Open/close, metadata + illustration, suggestions,
  full-text search with snippets, entry content, random page, exclude-from-backup.
- `ZimWebView` native view with custom scheme handler (Range/206, redirects, MIME),
  dark mode (CSS invert, media re-inverted), text zoom, find in page, external links.
- `src/features/library/{zim,register,html}.ts`: facade, registration (download
  completion, removal hook, startup init that also registers stray `.zim` files found
  in `content/zim`, e.g. copied with Finder/Files), HTML→text and link extraction.
- Reader (`/reader/[itemId]`) and global search (`/search`) screens; `reader` i18n namespace.
- Verified on the iOS 26.5 simulator (Release) with `wikipedia_en_100_mini`: reader
  (main page, links, back/forward, bookmark, text size, dark mode, find, history
  sheet), in-book and global search (titles + full text), and the facade
  (`getLinks` 95 links in order, `getArticleText`, `randomPath`, `search` snippets).
  Screenshots in `docs/screenshots/{reader,reader-dark,reader-search-sheet,search}-ios.png`.
  Android: `assembleDebug` compiles (runtime not tested).
- Fixed in shared code: `formatRelativeDate` crashed on Hermes (no `Intl.RelativeTimeFormat`).
- Known limits / TODO: reader toolbar doesn't auto-hide on scroll; no table of contents;
  Android `libc++_shared.so` is shared between RN and libkiwix (one copy wins — check at
  runtime); media Range path untested with a real video ZIM; iOS find-in-page is a
  JS highlighter (counts), Android uses WebView's native find.

### 2026-10-24 — Local AI assistant (phase 5)
- `modules/nomad-llm`: Apple Foundation Models (weak-linked, iOS 26+) and Gemini Nano
  (ML Kit GenAI Prompt API `1.0.0-beta4`) with status, streaming and cancel.
- `llama.rn` 0.13.0-rc.8 (+ config plugin) for GGUF; curated Qwen3.5 0.8B/2B/4B and
  Gemma 4 E2B (Q4_K_M, commit-pinned HF URLs, sizes HEAD-checked); RAM-based pick.
- `src/features/assistant`: engine (lazy load, stream, stop, release on background /
  4 min idle), RAG (keyword queries → ZIM full-text → BM25 over chunks → packed
  numbered sources → `[n]` citations), chats in `chat_sessions`/`chat_messages`.
- UI: chat with streaming Markdown, source chips → reader, stop, "use my library"
  toggle, starters; conversations sheet; model screen with downloads.
- Verified on the iOS 27 simulator (Release): Qwen3.5 0.8B downloaded in-app and
  streamed on the CPU (llama.cpp); Apple Intelligence available and streaming; RAG
  over `wikipedia_es_top_mini` with Apple FM answers with inline `[n]` citations and
  source chips that open the reader. Android `assembleDebug` OK (runtime untested).
  Screenshots: `docs/screenshots/assistant-*.png`.
- Limits / TODO: Qwen3.5 0.8B rarely emits `[n]` (all retrieved sources are shown
  then) and is unreliable for health answers — recommend 2B+; keyboard avoidance only
  checked with the hardware keyboard; Gemini Nano path untested on a real AICore
  device; `maxOutputTokens` limits of Gemini Nano unverified; no copy/regenerate yet.

### 2026-10-24 — Review pass (lead + review agent)
- Independent bug review (16 findings) fixed: Android background download stall,
  ZIM import could delete the installed archive, Android archive dispose while in use,
  UUID map clobbered by metadata probes, decimals split in RAG passages, stop ignored
  while searching/loading, cancel during processing, pause right at completion,
  partial-file leaks + startup sweep, storage check ignores queued downloads,
  citation ranges, empty syllabus persisted, orphan chat answers, untranslated map
  storage error, archive re-opened after deletion. i18n checker: `npm run check:i18n`.
- Reader table of contents (h2/h3 anchors). Scanned/imported ZIMs match the catalog by
  file name (ZIM `Name` lacks the flavour) and their ids migrate with history intact.
- Verified again on both platforms; Android background → foreground resumes downloads.

### 2026-10-24 — App Store 1.0.1
- Store listing (ASC app 6826502392): privacy/support site in `site/` (GitHub Pages),
  Settings links to the privacy policy, assistant shows an AI/health disclaimer,
  screenshots composed by `scripts/store-screenshots.py` into `docs/store/marketing`.
- Courses: syllabus fell back to nothing for JS-app ZIMs and for Wikiversity. Now: main
  page links → freeCodeCamp `content/curriculum/index.json` → HTML articles in title order
  (new native `listArticles`, iOS + Android). `portal\S*` chrome filter narrowed (it hid
  Wikiversity's `portal-columna-*` layout). Opening a lesson from the syllabus records a
  visit (JS apps navigate away from the lesson path). Empty stored syllabi retry once per launch.
- Reader dark mode: the web view always gets `prefers-color-scheme: light` (recent
  MediaWiki dumps darkened themselves and were inverted back to light); pages dark by
  design (Based.Cooking) get `data-nomad-native-dark` and are not inverted.
- iOS reader uses a persistent website data store: the ephemeral one can't store Blobs in
  IndexedDB on `zim://`, which hung PouchDB-based (nautilus/zimgit) archives forever.
- Catalog item titles/descriptions follow the app language (read from the catalog).
- Kiwix downloads pick the fastest of the first metalink mirrors (`downloads/mirrors.ts`):
  the default mirror served ~300 KB/s per connection while others gave 4–20 MB/s.
- Verified on the iOS 27 simulator (Release). Android: nomad-zim compiles (runtime untested).

### 2026-10-24 — Functional E2E suite (Maestro, iOS simulator)
- 36 Maestro flows cover 53 of the 55 cases of the functional test plan (Claude doc
  "Plan de tests funcionales iOS — Nomad App"). How to run and write them: `docs/E2E.md`
  (`npm run e2e:setup` once, then `npm run e2e` / `e2e:full` / `e2e:all`).
- Fixed from the first pass: buttons nested in another button were unreachable by
  VoiceOver (pack download, catalog row download, lesson check, delete in places /
  regions / conversations; `ListRow` gained `trailingAction`); the reader's find bar
  sat under the keyboard; the bookmarks sheet kept listing a removed bookmark (content
  now remounts on every opening); hardcoded English labels (Settings, Dismiss, OK, Clear).
- `testID`s on the controls tests need (list in `docs/E2E.md`).
- Then fixed the rest of the first pass: the assistant cited Wikipedia's HTML redirect
  pages (`<meta http-equiv="refresh">`, e.g. "Prince Michael Jackson" → "Michael Jackson")
  as empty sources and answered wrongly — `getArticleHtml` now follows them and RAG
  counts each article once; find-in-page count dropped on navigation; spinner until the
  reader's first page loads (JS-app archives); "N en cola" apart from active downloads;
  toolbar history buttons renamed "Página anterior / siguiente" (the header's is "Atrás");
  Explore shows "ES" instead of Kiwix's "SPA"; the setup wizard waits for the root
  navigator (a push before it was ready was dropped, ~1 in 40 fresh installs).
- Maestro 2.11 (`brew install mobile-dev-inc/tap/maestro`; `maestro@1.38` kept unlinked).
- Decisions: suite run by hand (no CI, no git hook); Spanish, with `onb-02`/`set-01` for
  English; iPad covered by a visual tour (`npm run e2e:ipad`). iPad findings, open: wide
  screens had no max content width (assistant buttons ~800 pt wide) and landscape Home
  wrapped the 4 module cards as 3 + 1: fixed with a centred 720 pt column (`layout.column`).
- Loose `.pmtiles` in content/maps are registered at startup (header → bbox/zoom; a region
  id as file name gives the region's name), like loose ZIMs: maps can be copied in via
  Finder/Files, and the E2E suite seeds a 0.6 MB Melilla (`seeded-map`) to test maps offline.
- Maps showed no detail (only a stretched low-zoom coastline) wherever labels used a script
  the bundled glyphs lack (Arabic names around Melilla; also Hebrew, Devanagari, CJK…):
  MapLibre Native does not draw a tile while a glyph range it needs fails to load. The asset
  unpack (v2) now writes an empty placeholder for every range not shipped
  (`features/maps/glyphs.ts`), so those characters are just not drawn. Real glyphs now ship
  for Hebrew, Arabic, Thai, Georgian, Ethiopic and Devanagari (asset zip 1.4 → 3 MB,
  `scripts/maps/make-zip.py`); CJK uses the system font. Checked on the simulator with
  Melilla, Tokyo, Bangkok, Tbilisi, Addis Ababa and Kathmandu. Left as placeholders:
  Bengali, Tamil and the other Indic scripts, Myanmar, Khmer — MapLibre Native can't shape
  them, so their names would come out garbled.
- Android pass (emulator, release APK, `npm run e2e:android`): everything shared works;
  the reader's find bar sat under the keyboard there too (edge-to-edge Android doesn't
  resize either, and its keyboard height leaves out the gesture strip): fixed.
- Pre-commit hook (`.githooks/`, set by `npm install`): tsc, lint, unit tests, i18n (~5 s).
  Lint is clean now (two setState-in-effect errors fixed).
  `wikipedia_en_100_mini_2026-01.zim` committed: Kiwix removed it from the mirror.

### 2026-10-24 — Documentation pass
- `CLAUDE.md` (agent guide: stack, commands, conventions, pitfalls) and `AGENTS.md`
  pointing to it. New `docs/DEVELOPMENT.md` (setup, builds, checks, debugging, build
  gotchas) and `docs/RELEASE.md` (versions, xcodebuild upload, TestFlight, listing,
  screenshots, site). `ARCHITECTURE.md` rewritten against the code (startup, storage,
  every contract); this file restructured (current state, backlog, known issues);
  STYLE_GUIDE and README corrected (i18n paths, components, in-content titles).
- Fixed what the pass turned up: build numbers now live in `app.json` (`ios.buildNumber`
  "4", `android.versionCode` 4) instead of the generated `Info.plist`; `package.json` at
  1.0.2; native projects regenerated (Android had `versionName 0.1.0`); lint warnings in
  `src/i18n/index.ts` and the i18n checker's unresolved `tc` binding on Home fixed.

### 2026-10-25 — Conversational assistant
- The owner's report: "hola" made the assistant search the library for "hola". Now it
  chats, and searches only when it helps. `chats.ts` `answer()` decides per message:
  library off → chat; `guessIntent` (rag-core, deterministic: greetings, thanks, "who are
  you", jokes, laughter, and requests about the previous answer like "resúmelo" / "más
  simple") → chat; otherwise the model decides when it can, and a question is searched
  when it can't (Gemini Nano).
- GGUF models call a `search_library` tool (llama.rn `tools`, two passes: decide/answer,
  then answer from the results with `tool_choice: 'none'`). Qwen3.5 only calls tools with
  thinking on (budget 256 tokens; it mostly closes the block at once), Gemma 4 without
  (with thinking it reasons ~350 tokens first): `models.ts` `tools: 'thinking' | 'direct'`.
- Apple FM ignores tools most of the time (7–11 of 14), so it routes instead: native
  `route()` asks for a `@Generable { search, query }` with greedy sampling (~0.7 s), with
  English few-shot instructions from `ROUTER_INSTRUCTIONS`. With `guessIntent` first it
  got every question right and 8 of 10 chatty messages the heuristic missed.
- Prompts tuned on the Mac (llama-server from Homebrew with the same GGUFs, Foundation
  Models via swiftc): 32–34 of 36 for Qwen 0.8B/2B/4B and Gemma 4 on a chat/search
  bench. Findings in the comments: spelling out small talk makes models stop calling
  the tool (tools mode keeps the tone short); "search even if you know" fixed famous
  facts answered from memory; wording about "the user's library" got echoed back.
- Retrieval: follow-ups ("¿y cómo se trata?", "¿Y cuándo murió?") borrow the previous
  question's keywords (`followUpTopic`); queries drop one word at a time so a word the
  library lacks doesn't sink them (the router's "Michael Jackson fallecimiento" found
  nothing in an English Wikipedia); greetings are left out of queries; chunks sharing
  too few question terms are dropped (`relevantChunks`).
- UI: "Buscar en mi biblioteca" under the latest answer given without the library
  (answers again with a forced search; in memory only, not stored), phase "Pensando…",
  conversational copy ("Pregunta o charla…").
- Catalog GGUFs copied into `content/models` register at startup (Files/Finder, and
  the new `seeded-model` E2E tag; fixture fetched by `e2e:setup`).
- Verified on the iOS 27 simulator (Release, new `NP-chat` simulator): all 5 assistant
  flows pass, including new `ai-06-conversation` (Apple FM: greeting without sources →
  question with sources → follow-up with sources) and `ai-07-gguf-tools` (Qwen 0.8B:
  greeting → button → tool call with sources); smoke suite 16/16.

### 2026-10-25 — Preparedness (worktree `preparedness`)
- New Home card → `/prepare`: family plan (two meeting points, one of them can be a map
  pin; contacts with call button; important numbers; health per person; home notes),
  emergency kit (household steppers + 72 h / 1 week / 2 weeks → water, kcal, medication
  days; 29-item checklist in 8 categories, children/pet items only when they apply;
  custom items; expiry month per item with a local reminder the month before), PDF export
  (A4, blank rows to fill by hand) through the share sheet, and the catalog's offline
  guides (Ready.gov, post-disaster, medicine, water, food) with download buttons.
- Data: one kv-store document (`prepare`), no SQL migration, nothing leaves the device;
  privacy policy updated. New deps: `expo-print`, `expo-sharing`, `expo-notifications`
  (plugin with `enableRemoteNotifications: false`: no push entitlement; Android
  notification icon `assets/images/notification-icon.png`).
- Android: form sheets show no native header, so `SheetHeader` draws title + Save in the
  content there (native header on iOS). `android-04-prepare` passes on the emulator
  (API 36, release APK); the reminder alarm is set for the 1st of the month before expiry.
- `ListRow` takes `accessibilityRole` / `accessibilityState` (checkbox rows).
- Found by E2E and fixed: the keyboard covered the sheets' bottom Save button (Save moved
  to the top: native header on iOS, `SheetHeader` row on Android); cards hid their status from accessibility; "Show on map" didn't move a
  map in a hidden tab (viewport seeded + focus after the tab shows); kit quantities
  printed `{{days}}`.
- Verified on the iOS 27 simulator (Release, `NP-prepare`): PREP-01…04 pass; smoke + full
  32/33 (the flaky `lib-03`, then 3/3). PDF checked by eye (2 pages).
- Rebased on main after the maps search/Emergencias, road routing and conversational
  assistant work (docs-only conflicts; Home card moved under Emergencias): smoke + full
  36/37 on the merged Release build (`ai-01` hit the onboarding race, then 3/3).
