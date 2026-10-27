# Progress

Living document: current status, backlog, known issues and a dated log. Update it at
the end of every work block (status table, a log entry, next steps) so the next session
can pick up without re-deriving anything.

## Current state (2026-10-26)

- **Version 1.1.0 (iOS build 13)** on TestFlight 2026-10-26: the pre-release audit fixes (log entry 2026-10-26)
  and multi-pack countries (the USA) on top of build 12 (a country as one download) and build 11 (the
  survival-kit redesign); **1.0.1 (build 3)** waiting for App Review. Release process and version table:
  `docs/RELEASE.md`; store builds are tagged from build 13 on (`v1.1.0-13`).
- All four MVP modules plus onboarding work end to end on the iOS simulator (iOS 27,
  Release) and the Android emulator (API 36, release APK). iPad layout verified (visual
  tour). Not yet run on a physical device by the agent.
- Checks: `npm test` (the count drifts: run it), `tsc` clean, lint clean, i18n keys complete. E2E: 54 Maestro flows
  (21 smoke, 17 full, 11 nightly, 1 iPad tour, 4 Android); which cases they cover is in the catalog of `docs/E2E.md`.
  The audit fixes passed the smoke suite (21/21, build 13, 2026-10-26); full and iPad suites not run on them yet.

| Area | Status |
|---|---|
| Foundation (design system, nav, i18n, db, downloads core) | done |
| Catalog (101 resources, 6 categories, Wikipedia picker, Kiwix OPDS explore, Files import) | done |
| Downloads (queue, pause/resume, iOS background, fastest Kiwix mirror, Wi-Fi-only enforced in the manager, size + sha-256 checks, retry with backoff) | done |
| UX redesign: survival kit (`docs/UX_SURVIVAL_PLAN.md`): onboarding country + kit, Home "En una emergencia" + "Tu preparación", 4 tabs, maps by country, bundled world map, simpler settings | done — iOS sim (E2E smoke + full), Android spot check; build 11; country maps CI first run 2026-10-26 |
| ZIM library + reader (search, TOC, bookmarks, history, find, text size, dark mode) | done — iOS + Android |
| Courses (14 courses, syllabus with fallbacks, progress; inside Library since the redesign) | done |
| Maps (country downloads: prebuilt z15 map + routing pack + points; on-device extraction as fallback; bundled world map; markers, GPS, multi-script labels) | done — iOS sim (Andorra, local catalog) |
| Maps search + Emergencias + straight-line guidance (plan phase 1, `docs/MAPS_NAVIGATION_PLAN.md`) | done — iOS sim + Android emulator (Release, E2E) |
| Maps road routing on the device (Valhalla, plan phase 2): packs, catalog, downloads, route guidance | done — iOS sim + Android emulator (Andorra pack); 60 whole-country packs live since 2026-10-25 (Europe + Latin America up to Spain's size; more countries in the 2026-10-26 full run); E2E vs the live catalog on iOS + Android |
| Maps turn-by-turn (voice, background location; plan phase 3) | planned |
| Assistant (Apple Intelligence / 4 GGUF models, RAG with citations, conversational: the model decides when to search) | done — iOS sim (Apple FM + llama.cpp), Android emulator (llama.cpp, before the conversational change). Android: no system model (ML Kit removed 2026-10-26), downloadable models only |
| Store (listing, screenshots, privacy site, in-app disclaimers) | done for iOS; Android not published |
| Preparedness (family plan, emergency kit with expiry reminders, printable PDF, offline guides) | done — iOS sim + Android emulator (E2E) |
| E2E suite (Maestro) + pre-commit hook | done |
| Pre-release audit (2026-10-26): ~60 verified findings fixed in code and docs | done on branch `audit-fixes`; device checks and the deferred items below pending |

## Decisions (kickoff 2026-10-24, by the owner)

- Standalone app (no NOMAD server), React Native + Expo, iOS + Android.
- MVP: ZIM library, offline maps, courses, local AI. UI + content in ES and EN.
- GPL-3.0 open source (libkiwix). Public GitHub repo `franlindebl/nomad-pocket`.
- Maps: in-app extraction from the Protomaps daily build (bbox/country).
- AI: Apple Foundation Models (iOS) + downloadable GGUF via llama.rn (both platforms).
- Courses: educational ZIMs + progress layer (Kolibri not in MVP).
- Name "Nomad Pocket", bundle id `com.fjlinde.nomadpocket`, iOS 16.4+ / Android 8+.
- Later: E2E suite run by hand (no CI, no E2E git hook), flows in Spanish; iPad covered
  by a visual tour; release builds uploaded locally with xcodebuild (no EAS).

## Next steps / backlog

Roughly by value. Items A, U and 0 are in progress; the rest are not started. (Preparedness was added
on 2026-10-25 from an "internet goes down" checklist; follow-ups are at the end.)

A. **After the pre-release audit** (2026-10-26). Deferred on purpose, **re-check in ~2 days, with the
   country-coverage work**:
   - README country claims and "60 countries", and the US map (DOCS-PUBLIC-1, DOCS-PUBLIC-2,
     DOCS-INTERNAL-8): the README's coverage lines stay as they are until that work lands.
   - Regenerate the store screenshots (DOCS-PUBLIC-3 / LEGAL-14); the map ones must show the OSM credit.
   - OSS-9: obsolete PNGs in the repo.
   - The git history rewrite that removes the owner's old location examples (pending a quiet window).
     **Then tag the store builds** (`v1.1.0-12` for build 12, and every later build: GPL section 6).
   Owner decisions still open or to carry out:
   - Android before any Play release: ML Kit GenAI is removed and Firebase kept out of the APK
     (done 2026-10-26). Still to do: list the full transitive Android notices (Gradle licence
     plugin), and decide how the proprietary Play services libraries that expo-location and
     MapLibre need (play-services-location/base/basement/tasks) sit next to GPL libkiwix; see
     `docs/RELEASE.md`.
   - Store prebuild gated by an env var (LEGAL-9): the generated `Info.plist` is shared by Debug and
     Release, so dev-launcher keys can reach a store build.
   - A planned index rebuild to reclaim the space of existing users' old index file.
   - Optionally ship `OFL.txt` and the sprites' MIT licence inside `basemap-assets.zip` (bump
     `features/maps/assets.ts` `VERSION`).
   - Geofabrik mis-tags `pf`, `wf`, `tk`, Clipperton (VU) and `pn` (MH), and `as`, `gu`, `mp` have no
     extract of their own: no side files for them (Overpass fallback); matching by name could give them
     points.
   - The pronoun threshold of the assistant (a follow-up inherits the previous topic only with at
     most one word of its own) loses some two-word English follow-ups ("Can I put ice on it?") on the
     heuristic search paths; long questions (> 600 chars) are searched once.
   - Code cleanup: `places.ts` keeps a private `forEachLineBlock` that duplicates `side-files.ts`'s.
   Decisions already taken (2026-10-26): the OSM credit fades after 5 s (approved); guidance
   auto-stops 60 s after arrival and keeps the screen awake only with movement in the last 10 min
   (approved); copyright line "Copyright (C) 2026 Fran Linde Blázquez and contributors"; Northern
   Cyprus, Somaliland and the Siachen Glacier (`cyn`, `sol`, `kas`) stay in the picker; private
   vulnerability reporting is enabled (SECURITY.md); emergency points and their state live in
   `search.db`, and both platforms back up `nomad.db` and the kv-store (log entry).
   Device checks pending from the audit fixes (nothing below was run on hardware):
   - iOS: Files import (file moved, duplicate toast, no Inbox copy); Explore download of a bundled
     course landing in Courses; medical banner on an Explore/imported medical ZIM; the "can't call"
     alert (iPad, Wi-Fi tablet); denied-location alert; landscape compass on phone and iPad (both
     sides, upside down, launch in landscape); iOS TOC on a PDF entry.
   - Downloads and countries: a multi-part download with one part failing, then restart and Retry;
     kill during a side-file import then relaunch (replay); delete a country during assembly; pack
     update with routing active; sha-256 time on a 2 GB part; Wi-Fi-only on a phone (the question,
     waiting, mobile-data override).
   - Database split on an existing phone with a big index, on iOS and on Android (the Android split in
     place is untested); removing a real installed country; phone timings of search and imports.
   - Reader on Android (new origin, CSP, external-link prompt, recovery after `chrome://crash`, an
     imported PouchDB archive); iOS reader with a remote image/fetch (verified blocked on the simulator).
   - Android build with the new native dependency (`expo-screen-orientation`); dark mode, VoiceOver and
     iPad width of the new screens (Credits, onboarding); a real GGUF backgrounded mid-load/search;
     Apple FM error codes translated; the Maestro suite on the merged branch.

U. **UX redesign** (`docs/UX_SURVIVAL_PLAN.md`): done and on main (ebafcdd, owner approved
   2026-10-26); TestFlight 1.1.0 build 11 = ebafcdd, build 12 (country as one download, friendlier
   errors, "couldn't check" vs "no navigation") on TestFlight. State at 2026-10-26 10:45 UTC, in order:
   1. **CI full run** `country-packages.yml` run 40289348691 (all 241 countries, parts=all,
      started 08:00 UTC, ~55 countries/h): 157 ok, 1 failed (`us`), 83 left; it publishes
      routing-index + maps-index at the end (~12:30 UTC). Check: `gh run view 40289348691`;
      then spot-check the manifests (packs keep places/addresses; maps per continent release).
   2. **US failed** (since addressed by a088642 and d430791: the USA's points are read state by state and a
      country can have several routing packs; confirm in the next full run): the runner shut down while `build-country-map.sh` processed Geofabrik's
      11 GB `us` extract (side files; likely OOM in pyosmium with node locations, 16 GB
      runner). Plan: for extracts above ~4 GB use Geofabrik's sub-regions (us-west,
      us-midwest, us-northeast, us-south, …), build side files per part and concatenate the
      TSVs (or skip side files and let the app use Overpass); then re-run
      `gh workflow run country-packages.yml -f countries="us" -f parts=maps`. Same for `ru`,
      `ca` or others if they fail.
   3. Owner: test build 11 on a real iPhone (onboarding kit, Spain ≈4.8 GB, assembly of a
      multi-GB map, places/addresses import, Emergencias offline). This Mac is sometimes behind
      a TLS-intercepting corporate proxy: simulators/emulators then fail
      on protomaps.dev / Kiwix with TLS errors — the network, not the app.
   4. Follow-ups: bundled quick cards (first aid, water, radio; owner reviews medical
      content first), emergency numbers per country, updating an installed routing pack to a
      newer build (maps already offer "Hay un mapa más reciente"), Hawaii (islands > 10° from
      the rest are outside the US outline), measure on a phone.

0. Routing packs for the whole world (232 countries, all but the USA) are in `packs.json`
   since 2026-10-26, waiting for a run. Before: 60 whole-country packs live since 2026-10-25 (20.6 GB, with street
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
2. Search side files: published (the 2026-10-26 full run; packs and country maps carry
   `.places.tsv` / `.addresses.tsv`). Still to measure the import on a real phone (Spain: 1.0 M
   places + 2.2 M doors).
3. Faster, resumable downloads: plan in `docs/DOWNLOADS_SPEED_PLAN.md` (analysis and
   measurements done 2026-10-26; Spanish Wikipedia nopic, 13.3 GB: ~2 h today, ~6–15 min
   expected). A: keep the screen on while downloading. B: pick Kiwix mirrors by throughput.
   C: segmented multi-mirror engine, after a device spike. D: piece-level repair. C also
   resumes after the app is killed on iOS. The alternative for single-task downloads is to
   reattach the background URLSession (small native module, BUG-CORE-16).
4. Map extraction: resume after a kill (persist the plan + written ranges) and move it off
   the JS thread.
5. Android release: upload keystore, Play listing + data safety; the Android notices and the Play
   services question of item A come first.
6. Reader: auto-hiding toolbar on scroll (style guide), syllabus for SPA course ZIMs read
   from the rendered DOM.
7. Assistant: copy / regenerate an answer; better small-model citations; check the
   conversational flow on Android (llama.cpp tools) and on a
   real iPhone (tool-call latency with Metal).
8. Preparedness follow-ups: share ZIMs/maps phone to phone (share sheet export, import
   exists); "Ready.gov"-style quick cards bundled in the app (radio frequencies, first aid)
   that need no download; optional Face ID lock for the plan; link the plan's meeting points to maps' Llévame
   guidance and the hub to the Emergencias sheet (both landed on main in parallel).


## Known issues / limitations

- Map search: house numbers and far-away POIs come from the country package's side files
  (published). Without them (a map from the extraction fallback), big regions are indexed at a
  lower zoom (≤ 40k tiles: Spain z14 → z12) with full detail only within ~25 km of the user or the
  searched area. House numbers are as complete as OSM (a missing number lands between its
  neighbours, marked approximate). Indexing and imports run on the JS thread in batches (not yet
  measured on a device); search itself runs on a second connection.
- Chinese and Japanese names indexed before the pair-indexing change only match from their first
  character until the map is re-indexed (`INDEX_VERSION` was not bumped).
- The search index file of an existing phone doesn't shrink: the old `nomad.db` was renamed to become
  `search.db` and can't switch to incremental `auto_vacuum` without a full `VACUUM` (too risky); freed
  pages are reused by later imports but not returned. Fresh installs are fine. A planned index rebuild
  would reclaim it (item A).
- Emergency points depend on public Overpass servers (best effort; they can be at capacity
  for minutes). Fallback: the POIs in the map's own tiles (complete only at z15).
- OSM data quality shows through: a garage mapped without `access=private`/`tunnel=yes`
  still draws as a thin line (routes no longer start in it). Not modelled: low-emission
  zones (Madrid ZBE), live closures, traffic.
- Road routing needs a routing pack for the area (else the straight line). No
  isochrones (valhalla-mobile exposes none), no cross-pack routes (the country pack covers
  them), no voice / background navigation yet. Pack and map files are verified against the
  manifest's size and sha-256. Maps downloaded as a country (map with the pack or its own points) no longer ask Overpass.
- Bbox queries (map dots, locality context) don't handle regions across the antimeridian.
- Map screen first opens on the world when a region is registered after the first render
  (seeded/loose maps): pre-existing, cosmetic.
- After a backup restore the database comes back without the content (items are dropped at
  startup, see ARCHITECTURE), but the `downloads` rows are not reconciled: paused or queued rows
  return and the manager retries them (not fixed).
- Downloads interrupted by app termination: Android continues from the `.part` on disk; on iOS
  the file restarts from zero, because the background session keeps transferring but is not
  reattached after the app is terminated (BUG-CORE-16: needs a small native hook), so the bytes
  may be fetched twice.
- Compass heading in landscape: iOS reports an orientation of UNKNOWN until the first rotation after
  launch, so the heading is withheld in landscape until then; Android tablets whose natural
  orientation is landscape stay 90° off.
- The generated `Info.plist` is shared by Debug and Release (LEGAL-9, item A).
- Map extraction runs on the JS thread in the foreground (screen kept awake) and does
  not resume after the app is killed.
- Qwen3.5 0.8B rarely emits `[n]` (all retrieved sources are shown then) and is
  unreliable for health answers — the app recommends 2B+ where RAM allows. In small talk
  it sometimes rambles or echoes its instructions, and it searches some chit-chat
  ("¿te gusta la música?") on its own.
- The models still answer some famous facts from memory instead of searching ("What is
  photosynthesis?"); the "Buscar en mi biblioteca" button covers it. Apple FM tends to
  open every answer with "¡Hola!" once the chat started with a greeting.
- Apple Intelligence fails on the iOS 26.5 simulator (works on iOS 27).
- Kit reminder texts are written in the language active when the expiry was saved.
- Map labels in Bengali, Tamil and other Indic scripts, Myanmar and Khmer are not drawn
  (MapLibre Native can't shape them); country bboxes skip far-flung territories.
- ZIM media Range path untested with a real video archive.
- Not automated: importing a ZIM from Files (system picker) and true offline mode
  (simulator has no airplane mode); the Android tour covers country downloads, search,
  Emergencias, Preparedness and routing, but not the assistant or labels in other scripts
  (checked by hand on the emulator).

Build gotchas moved to `docs/DEVELOPMENT.md`.

## Log

### 2026-10-26 — Release: 1.1.0 build 13 to TestFlight

Build 13 = the pre-release audit fixes (reader without network, Wi-Fi-only enforced, safer downloads
and storage, Credits & licences, data out of the Files app, re-downloadable data out of backups, OSM credit, guidance
auto-stop, translated permission prompt) and multi-pack countries (the USA). Smoke E2E 21/21 on an
iOS 27 simulator; tagged `v1.1.0-13` (GPL section 6).

### 2026-10-26 — CI: country packages workflow hardened (SUPPLY-1/2/3)

Audit findings on `.github/workflows/country-packages.yml`, fixed before the next big run:
- SUPPLY-1: every `gh release view` of an index went through `has_release`
  (`scripts/gh-releases.sh`): only "release not found" means "no catalog yet"; any other
  failure stops the step. Before, an API hiccup read as "no index", so the run published a
  catalog with only the countries it rebuilt and the prune deleted the rest.
- SUPPLY-2: a map's fragment is uploaded as an artifact only when its upload step succeeded
  (before: `!cancelled()`, so a failed upload still reached the catalog with missing files).
- SUPPLY-3: `persist-credentials: false` on every checkout; in the build job `GH_TOKEN` is only
  on the two upload steps (apt packages, the Valhalla image and Overpass/Geofabrik data run
  without it); `VALHALLA_IMAGE` pinned by digest (`3.9.1@sha256:4fd114eb…`, checked against
  ghcr.io); go-pmtiles 1.31.2 checked against its SHA-256 (same value as GitHub's asset digest).
- Run 40326036278: ag, fr and je hung in "Disk and tools" right after `df` (apt install or the
  go-pmtiles download, output silenced) until the job's 340 min timeout. That step now has a
  20 min timeout, apt network timeouts and retries, and curl `--retry 3 --max-time 300`.

### 2026-10-26 — Downloads: speed analysis (plan only)

- The owner reported the Spanish Wikipedia without images (13.3 GB) estimating ~2 h on a fast
  connection (~1.8 MB/s). Measured the 8 Kiwix metalink mirrors, plus GitHub Releases, Hugging Face and
  Protomaps, with 1, 4 and 8 connections. Plan and data: `docs/DOWNLOADS_SPEED_PLAN.md`.
- Findings: the 512 KB probe in `mirrors.ts` tracks latency, not throughput (it would pick a
  3.5 MB/s mirror over a 23 MB/s one) and only tries the first 4 mirrors. Mirrors cap each
  connection (the default one: 0.3–0.5 MB/s). 8 connections reached ~36–39 MB/s (this Mac's
  link). Courses and every Kiwix archive share the problem. GitHub (maps, packs) gains ~1.6× with
  more connections. Hugging Face and Protomaps fill the link with one.
- Nothing implemented yet (backlog item 3). Checked against `main` after the audit merge.

### 2026-10-26 — Setup wizard missing on a fresh install: kv-store first-open race

- The "onboarding race" (wizard not shown on a fresh install, ~1 in 25 launches: `lib-03`,
  `map-08`, `ai-01` on iOS, `android-04` on Android) was not the navigation push. Traced on
  the Android emulator (release APK, 50 fresh launches, 2 without wizard): the settings
  store never finished hydrating, so the root never decided to push. The kv-store's first
  open migrates inside a transaction; its async open (zustand `persist` on `settings`,
  `prepare`, `assistant`) yielded mid-transaction and the maps viewport's sync read on the
  same native connection failed with "cannot start a transaction within a transaction";
  that rollback left the async open hanging, and zustand swallows it.
- Fix: `src/lib/kv.ts` `kvStorage()` reads with `getItemSync` (writes stay async), used by
  the three persisted stores, so the first open is always synchronous; settings are
  hydrated when the store is created and `_layout.tsx` no longer waits for hydration.
  Checked: 50/50 fresh launches show the wizard (was 2 missing in 50), `android-04-prepare`
  passes, and a relaunch keeps `onboarded` and the plan. iOS 27 simulator (Release): smoke
  21/21, every flow through the wizard from a fresh install, `set-01`/`prep-01`/`prep-02`
  included.
- Seen on the way: on a fresh launch the emulator's JS thread stayed busy 4–8 s right
  after the wizard mounted (timers fired late), under heavy Mac load; not investigated.
  The long-running emulator's `system_server` also started crash-looping (cold boot fixed it).
  The iOS Release build failed twice in `[Expo] Configure project`: expo-modules-autolinking
  gives `ExpoModulesMacros scan-modules` a fixed 5 s, and with the Mac at load 45–73 it timed
  out (under 1 s by hand); the third build passed. Retry the build when it says so.

### 2026-10-26 — A country can have several routing packs (the USA)

- The full run lost the USA: the runner ran out of memory one hour into its 11 GB
  Geofabrik extract (map side files). build-country-map.sh now reads an extract over 6 GB in
  its Geofabrik sub-extracts (the 51 states and DC; not Puerto Rico or the US Virgin
  Islands), merges and deduplicates the TSVs, and leaves out a side file over 1900 MiB
  instead of failing the upload (a088642). Run 40323670602 builds the US map.
- The USA's routing comes as four regional packs (us-west, us-midwest, us-northeast,
  us-south; data side by the navigation session, d430791, inert until build 13 is on
  TestFlight). App: `routePacksFor` (country-core, tested) returns every pack with the
  country's `regionId`; offers, sizes, downloads (one group), "Tus mapas", readiness and
  removal handle a list. A route between two packs fails offline, as between two countries.
- build-country-map.sh skips side files for a country with regional packs too.

### 2026-10-26 — Routing packs for the rest of the world

- Owner approved navigation everywhere. `packs.json` 60 → 232 countries: every country and
  territory of `regions.json` but the uninhabited ones (aq, atc, gs, hm, io, kas, pn, tf),
  Haiti (routed by `do`) and the USA (12 GB PBF: several packs per country need app work
  first). Big ones as whole packs (Germany, France, Canada, Russia, Japan…): runners have
  ~100 GB of disk (`df` in run 40289348691), not the ~14 GB the plan assumed.
- `build-country.sh`: `clip` cuts a bigger extract to the country's bbox (43 places with
  no extract of their own: gcc-states, malaysia-singapore-brunei, central-america…); admin
  boundaries fall back to ISO 3166-1 at any level, then ISO 3166-2, then none (Guam is
  level 4 in OSM). Local Docker builds route: Guam 5 MB pack (9.5 km test route), Singapore
  87 MB (cut from malaysia-singapore-brunei; 21 km city → airport).
- Workflow: routing releases per continent (`routing-<stamp>-<continent>`, 1000-asset
  limit); `manifest.py unshare` drops a map's side files when its country's pack brings
  them (else the app would download and index both).
- Run 40326036278 (the 173 new packs): Armenia failed after 3 rounds of Overpass 502/504
  (8 builds at once), Germany on a Geofabrik 404 after a 7-minute download. Now 6 Overpass
  rounds with growing pauses, and the extract download + md5 is retried 4 times.

### 2026-10-26 — Pre-release audit: findings fixed (branch `audit-fixes`)

- An independent audit of the whole repo (code, native modules, CI scripts, docs, legal) produced
  findings; the verified ones were fixed in nine code packages and one docs pass, merged on
  `audit-fixes`. Final verification on simulators/emulators (not physical devices): iOS Release
  build, Maestro smoke (21/21) and full suite all pass, including the new `set-05-credits` and
  `map-18-credit`; Android `assembleRelease` with no ML Kit and no Firebase in the runtime
  classpath, and android-01/03/04/05 pass on an Android 16 emulator (a kit reminder fired with
  Firebase excluded). Device checks still pending: backlog item A.
- Android: ML Kit GenAI (Gemini Nano) removed, `nomad-llm` is Apple-only; Firebase kept out of the
  APK (`plugins/with-android-no-firebase.js`); a Downloads-sheet group cancel now stops a country
  part mid-assembly (`EnqueueInput.abortable`).
- Downloads: Wi-Fi only is enforced in the manager (held records wait, one question per country or
  kit, a running transfer that reaches mobile data pauses); size and sha-256 checks (Kiwix metalink,
  manifests) with the bad copy deleted; network errors keep the bytes and retry with backoff;
  `safeFileName`; storage message counts queued downloads; late network reads can't undo newer state.
- Maps and countries: downloads survive failures, kills and removal (side-file import queue with
  replay, assembly that never reports success without a map, abort on removal, one up-front room
  check, grouped records); manifests validated; pack updates and `ENGINE_VALHALLA` gate; sha-256
  integrity; names of the two San Martín, Taiwán and China fixed.
- Search and database: the search index and the emergency points moved to their own file
  (`Documents/content/index/search.db`, out of backups) and `nomad.db` plus the kv-store moved to
  Library/Application Support on iOS, out of the Files app (resumable migration, tested); search off
  the JS thread with a debounce and a match cap; Chinese/Japanese names found from any part.
- Reader and native: archive pages have no network (WKContentRuleList + CSP, per-archive origin on
  Android), external links need a tap and a confirmation, renderer crashes recover, `getContent`
  skips binary and big entries, a reopened routing pack file is noticed.
- Library: archive identity (a Files import can't replace an installed archive; fallback ids; chat
  citations retargeted), medical disclaimer for unknown archives, startup reconciliation drops items
  whose file is gone (after a restore) keeping bookmarks, history and course progress.
- Assistant: released engines stay released and background ends the answer, pronoun follow-ups
  inherit the topic only when short, the whole RAG frame counts in the token budget, "Search my
  library" keeps the old answer until the new one exists, model errors are translated.
- App shell: onboarding and Home honesty fixes, accessibility (toast announcements, hints), reminders
  reconciled with the plan, cold-start notification and link handling, PDF cleanup, root error
  boundary, localised permission prompt, Android backup rules, a Credits & licenses screen generated by
  `scripts/licenses.mjs`, seven unused dependencies and dead code removed, OSM credit on the map,
  guidance auto-stop and keep-awake rules, compass heading in landscape (new dependency
  `expo-screen-orientation`: native rebuild needed), phone calls through one helper.
- Scripts: SHA-256 for libkiwix, postinstall that works off macOS and keeps an existing hooks path,
  pinned Natural Earth, a failed outline fails the CI job, side files from the extract named after the
  country.
- Docs and legal (this pass): privacy policy rewritten to be exactly true (catalog check at launch,
  every host, where data lives, deletion, backups, reader without network, Android assistant),
  SECURITY.md (private vulnerability reporting), CONTRIBUTING.md, `e2e/fixtures/README.md`,
  GPL-3.0-or-later and the copyright line everywhere, Gemma 4 is Apache-2.0, ARCHITECTURE/E2E/
  STYLE_GUIDE/DEVELOPMENT/RELEASE/CLAUDE brought up to date, `.gitignore`, AGENTS.md without EAS.
- Final storage layout (owner decision): `nomad.db` holds only user data and bookkeeping and stays small;
  `search.db` holds the search index, the emergency points and their state; both platforms back up
  `nomad.db` and the kv-store and exclude `content/` and `map-assets/`.
- Owner decisions recorded in backlog item A (ML Kit/Firebase removal, tagging builds, cyn/sol/kas,
  timings, copyright). Deferred to the country-coverage work: README country claims, CI supply-chain
  findings, store screenshots, obsolete PNGs, the history rewrite.

### 2026-10-26 — Maps: street files read in blocks; manifest spot check

- Spot check of the published catalogs (run 40289348691): 240 maps, 60 packs; fr, de, it
  maps and es, mx, ar packs carry places and doors, samples well formed. Big side files:
  streets fr 151 MB, br 98, de 80; doors de 780 MB, ru 653, tw 415, nl 362, pl 304.
- Street files were read whole (`file.text()` + `parseStreetsTsv`): 150 MB in one Hermes
  string plus millions of rows could run an older iPhone out of memory. `indexPackStreets`
  / `indexMapStreets` now take the file and read it in 4 MB blocks like places and doors.
- `indexEmergencyPoints` deleted the map's `streets:<id>` rows: an emergency points
  refresh of a country map would have dropped its street names from search. Removed.
- Still to measure on a real iPhone: import time and DB size for Germany's doors
  (Spain's ratio says ~400 MB).

### 2026-10-26 — Maps: Japanese addresses

- Spot check of the first full country run: Italy, Mexico and Japan's places and doors
  are well formed, but Japan had 0.4 MB of doors. Japanese addresses aren't street +
  number: 324 k objects carry `addr:block_number` (番) inside a chōme, almost none
  `addr:street`. `places.py` now writes them as "台東2丁目" + "5-1" (kanji and full-width
  digits as ASCII, "7番22号"/"1803番地2" as "7-22"/"1803-2", lot letters such as 甲 with
  the place) and the osmium filters keep `addr:block_number`. The app reads what people
  type (`parseJapaneseAddress`) and looks the door up directly (`japaneseDoorHits`).
  Shikoku extract: 98 % of its doors are found from the address as written; the rest are
  odd tagging.
- `places.py` also cleans line breaks inside house numbers (3 broken rows in Japan).
- Takes effect on the next country run.

### 2026-10-26 — Build 11 on a real iPhone: a country is one download

- Owner, after the onboarding on build 11 with Spain: Downloads listed "España (1/2)" twice,
  "España (2/2)" and four plain "España" rows. Nothing was duplicated: Spain is the map (2
  parts), the routing pack (2 parts, both titled by country) and the pack's points,
  streets, places and doors. Now `enqueueDownload` takes a `group` and the sheet, the home
  card and the toast treat a country as one download, "Mapa de España", with combined
  bytes (`features/downloads/groups.ts`, tested). Before, every finished file also showed
  "España (1/2) está listo", which wasn't true yet.
- The Maps tab offered "Descargar España" while it was downloading: the empty card now
  shows "Descargando España", its progress and "Ver descargas" (a retry when it stopped).
  testID `maps-incoming`.
- Onboarding: the bottom button sat on the screen's edge on every step. The
  KeyboardAvoidingView (added with the country search) overwrites its own paddingBottom in
  'padding' mode; the safe-area inset is now a spacer view.
- Build 12 (TestFlight) carries this plus 27fb184 and 159f565.

### 2026-10-26 — Android check of the redesign (emulator)

- Owner asked for an Android run while the country packages build. Pass: android-03
  (country download, search, guidance, Emergencias), android-05 (route on the published
  Andorra pack), android-04 once (Preparedness).
- Not the app: the emulator's DNS went stale, Android's validation flapped (the app then
  says "Sin conexión"), and this Mac is now behind a TLS-intercepting proxy, so ZIM
  downloads fail on the emulator (android-01). The setup wizard didn't show once
  (android-04, the known onboarding race).
- Fixed: the startup coarse fix for the search detail (`indexDetailAroundUser`) showed
  Google's "Location Accuracy" dialog on Android (`mayShowUserSettingsDialog: false`);
  `scripts/e2e-android.sh` ended the run after the first failed flow (set -e/pipefail) and
  now waits for a validated network. Reported to the redesign session (fixed in 27fb184):
  a country sheet said "navigation not available" when the catalog simply hadn't loaded.
- Note: a download error shows the raw exception ("Call to function
  'FileSystemDownloadTask.start' has been rejected… CertPathValidatorException") in the
  Downloads sheet; a friendlier message would help.

### 2026-10-26 — CI: one workflow per country package

- Owner: why two workflows for one download? `country-packages.yml` replaces
  `routing-packs.yml` and `country-maps.yml`: one job per country builds the routing pack
  (build-country.sh in the Valhalla image, packs.json countries) and then the map
  (build-country-map.sh), and the run publishes both catalogs in their current formats
  (build 11 reads them unchanged). Kept from the routing workflow: one tag per run (now the
  run id), index uploaded last, partial runs publish, carry + clip, prune of releases
  neither the new nor the previous catalog points at (both families, read back from the
  indexes), one concurrency group, max-parallel 8 (Overpass). Inputs: countries, parts
  (all / maps / routing).
- First runs of the old workflows: Country maps 40281825369 (es pt ad fr de it gb) ran to
  the end (7 maps at z15: es 2.29 GB, fr and de 5.47 GB, it 2.73, gb 2.62, pt 0.58);
  gb came out without side files (the map script took `ie`'s `IE,GB` for a pack covering
  the UK: now it uses the app's rule, own pack or `ht` → `do`). Routing packs 40281828336 was cancelled at 17/61 (the unified run rebuilds them
  with places and house numbers). Runner disk: `/` has ~104 GB free, more than the plan's
  14 GB estimate.

### 2026-10-26 — UX redesign: a survival kit (branch `ux-survival`)

- Owner: the features felt scattered; the app should read as a crisis/survival tool;
  onboarding and settings offered too many choices and never asked for the map or the AI;
  maps must come with navigation and emergency points ("no extras"), countries only, always
  full detail, world map always there. Approved: prebuilt country maps in CI, 4 tabs,
  one kit proposal with switches, world map bundled.
- Maps: `countries.ts` (one country = map + routing pack + points + streets),
  `country-maps.ts` (maps catalog, multi-part downloads, assembly, side files),
  `country-core.ts` (+ tests), `world.ts` (bundled `assets/maps/world.pmtiles`, 15 MB),
  `country-maps.yml` + `scripts/maps/{build-country-map.sh,maps-manifest.py,make-world.sh}`.
  Sheets: "Tus mapas", countries-only picker, one-country download sheet; routing-packs
  sheet, zoom choice, visible area, communities and states gone (old maps listed as
  "Otros mapas"). Emergencias no longer offers "descarga los de OpenStreetMap": points come
  with the country, or are fetched on their own. Maps with bundled points skip Overpass
  and the tile-POI fallback (they showed twice).
- Onboarding: welcome → country → kit (country, guides, Wikipedia by free space, assistant:
  system model or recommended GGUF) → plan shortcut. Home: network state, emergency
  actions (nearby, first aid, plan, call 112/911), "Tu preparación" (6 items with status,
  stale-map warning). Tabs: Inicio · Mapas · Biblioteca (Cursos inside) · Asistente.
  Settings: country, storage by country/item, advanced (content languages).
- Measured (Protomaps 20261025): Spain z12/14/15 = 408 MB / 1.6 GB / 3.2 GB (+2.3 GB
  routing pack), Portugal 84 / 336 / 635 MB, France 1.1 / 4.5 / 9.4 GB, Germany 0.9 / 3.5 /
  7.2 GB. Checked on the iOS 27 simulator: onboarding (Spain sized 5.5 GB; Andorra kit
  installed), Home, Tus mapas, Emergencias with pack points, Library → Cursos, Settings;
  country download from a local maps catalog (3 parts assembled, 408 points, 1375 streets).
- CI maps extract by the country's outline (`scripts/maps/country-region.py`): Spain z15
  2.3 GB with Canarias (the regions.json bbox left them out), France 9.4 → 5.5 GB,
  Germany 7.2 → 5.5 GB; all 241 countries get an outline. Android release APK: onboarding,
  Home and the bundled world map render on the emulator.
- Rebased on faed459 (places and house numbers in the packs): country maps without a pack
  carry the same `places` / `addresses` side files (places.py in build-country-map.sh,
  imported with `indexPackPlaces` / `indexPackAddresses`).
- E2E rewritten for the redesign (subagent, on simulator `NP-ux-e2e`, `ROUTING_PORT=8791`):
  map-05 and android-02 removed (bundled world map, no visible area), map-15/16 download
  the country from guidance, new `maps-server` tag (Andorra country map fixture). Found and
  fixed: the Preparedness hub had no entry (now Home's plan row), the country search's
  keyboard covered the wizard's buttons, "Punto de encuentro y 0 contactos".

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

- Owner on build 9 (Spain map): schools near a Madrid test spot
  not found; "Calle Alcalá 50" found nothing. Cause: Spain's map is indexed at z12, where
  Protomaps keeps no schools (they are in z14/z15 tiles); a number in the query was a word
  that had to match.
- Detail index: the map's max zoom (≤ 15) over a 50 km square around the user / the
  searched area, besides the whole-map index (`listZoomTiles` takes a bbox). Checked on
  the live planet around that spot: z14 finds one school's grounds and a sports
  centre; the school building itself only at z15. On the simulator
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
- 36 Maestro flows covered 53 of the 55 cases of the functional test plan written for this
  suite (its case ids are in the flow catalog of `docs/E2E.md`). How to run and write them: `docs/E2E.md`
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
