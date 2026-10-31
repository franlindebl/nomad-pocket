# Progress

Living document: current status, backlog, known issues and a dated log. Update it at
the end of every work block (status table, a log entry, next steps) so the next session
can pick up without re-deriving anything.

## Current state (2026-10-28)

- **Version 1.1.0 (iOS build 23)** on TestFlight 2026-10-28 (build 22 plus assistant retrieval in English; build 22 = build 21 plus the right neighbourhood on search results, first aid in the app's language, an assistant that no longer greets every answer and empty image boxes gone; build 21 added a photo library purpose string): dictation in the assistant, a more
  capable model becomes the default, answers survive switching chats, the navigation view reworked,
  Canada and Russia by regions, on top of build 19 (document collections, map legend, SOS button);
  **1.1.0 (build 23) waiting for App Review** since 2026-10-28 (it replaced 1.0.1 in the same submission after
  a 2.1(b) business-model question; listing `docs/store/listing-1.1.0.md`, auto-release after approval). Release process and version table: `docs/RELEASE.md`;
  store builds are tagged from build 13 on (`v1.1.0-23`). Build 17 shipped another session's
  unfinished edits: don't use it.
- All four MVP modules plus onboarding work end to end on the iOS simulator (iOS 27,
  Release) and the Android emulator (API 36, release APK). iPad layout verified (visual
  tour). Downloads measured and tuned by the agent on the owner's iPhone 14 Pro (2026-10-27), re-timed
  2026-10-28 with segments from 4 MiB: the 20.7 GB kit in 6:47 (`docs/DOWNLOADS_SPEED_PLAN.md`, run 8).
- Checks: `npm test` (the count drifts: run it), `tsc` clean, lint clean, i18n keys complete. E2E: 63 Maestro flows
  (21 smoke, 22 full, 13 nightly, 1 iPad tour, 4 Android, 2 by hand: `map-22` and `map-23`, their own build); which cases they cover
  is in the catalog of `docs/E2E.md`. On f4b32d4 (2026-10-28): smoke 21/21, full 20/20 after a stale `map-15`
  assertion was fixed (`map-19` flaked once on a tap), iPad tour 1/1. The flows added later (map-20/21/22, ai-09)
  passed on their own branches; on main afb07af smoke + full passed 43/43 (2026-10-28, after making the region
  flows' `hideKeyboard` optional), then ai-09, map-22 and the Android tour (4/4) too.
- Routes across routing packs (Madrid to Paris, US regions) are on main and pushed since bdc1fae/6f68b43
  (2026-10-28), but need packs that carry `<pack>.crossings.tsv`. The CI run that rebuilds them (run
  40681896621, launched by hand on 2026-10-28: `ad` and `pt` as the small check, under a Europe
  release tag) succeeded: the published `ad` and `pt` packs now carry `crossings` (264 B and 3.2 KB in the
  routing manifest). Every other pack gets them with the monthly full run on 2026-11-05.

| Area | Status |
|---|---|
| Foundation (design system, nav, i18n, db, downloads core) | done |
| Catalog (101 resources, 6 categories, Wikipedia picker, Kiwix OPDS explore, Files import) | done |
| Downloads (queue, pause/resume, iOS background, Wi-Fi-only enforced in the manager, size + sha-256 checks, retry with backoff; segmented multi-mirror engine with throughput-ranked Kiwix mirrors, per-piece sha-1, resume from disk after a kill; adaptive connection budget; screen kept on; CDN files first, stall watchdog, in-process sessions on iOS while open; segmented from 4 MiB; rows whose partial bytes didn't survive a backup restore marked failed) | done — tuned on a real iPhone 14 Pro (build 18), re-timed 2026-10-28 (run 8, 6:47); Android: the tour's downloads pass (2026-10-28), speed not measured |
| UX redesign: survival kit (`docs/UX_SURVIVAL_PLAN.md`): onboarding country + kit, Home "En una emergencia" + "Tu preparación", 4 tabs, maps by country, bundled world map, simpler settings | done — iOS sim (E2E smoke + full), Android spot check; build 11; country maps CI first run 2026-10-26 |
| ZIM library + reader (search, TOC, bookmarks, history, find, text size, dark mode) | done — iOS + Android |
| Courses (14 courses, syllabus with fallbacks, progress; inside Library since the redesign) | done |
| Maps (country downloads: prebuilt z15 map + routing pack + points; the USA by regions; Canada and Russia by regions for the map with one national pack; on-device extraction as fallback, resumed after a kill; bundled world map; markers, GPS, multi-script labels; location asked on opening Maps) | done — iOS sim (Andorra and US regions, local catalogs; E2E map-20/21 for both kinds of regions); build 16. Canada/Russia regions: maps published 2026-10-27 (run 40544693154) and the app code is in builds 20+ (3c75852); a real-phone check of one region is pending (`docs/COUNTRY_REGIONS_PLAN.md`) |
| Maps search + Emergencias + straight-line guidance (plan phase 1, `docs/MAPS_NAVIGATION_PLAN.md`) | done — iOS sim + Android emulator (Release, E2E) |
| Maps road routing on the device (Valhalla, plan phase 2): packs, catalog, downloads, route guidance | done — iOS sim + Android emulator (Andorra pack); 237 packs live (every inhabited country; the USA in six regions) since 2026-10-27; E2E vs the live catalog on iOS + Android |
| Maps turn-by-turn (voice, background location; plan phase 3) | built on branch `carplay` (2026-10-31): spoken prompts (iOS + Android, offline system voices), guidance with the screen locked (iOS background location, Android foreground service); iOS sim E2E map-14/17 pass; Android emulator: tour 4/4, foreground service checked by hand (starts with Iniciar, survives Home, ends with Finalizar); not yet heard on a real phone |
| CarPlay navigation (`docs/CARPLAY_PLAN.md`) | built on branch `carplay` (2026-10-31): map, destinations (search, saved, Emergencias cerca), trip preview, turn-by-turn session; **tested on the CarPlay simulator screen** (Xcode 26.5's Simulator + iOS 26.5 + shim, `scripts/carplay/carplay-sim.sh`), every flow in the plan's "Testing" list works; the entitlement must be requested by the owner, then a real car |
| Assistant (Apple Intelligence / 4 GGUF models, RAG with citations, conversational: the model decides when to search; the most capable installed model is the default; on-device dictation; reads the PDFs inside archives (document index) and the family plan; copy and regenerate an answer) | done — iOS sim (Apple FM + llama.cpp), Android emulator (llama.cpp, before the conversational change). Android: no system model (ML Kit removed 2026-10-26), downloadable models only |
| Store (listing, screenshots, privacy site, in-app disclaimers) | done for iOS; Android: app created in Play Console, App content forms done (PEGI 3 since 2026-10-29, see `docs/store/play-listing.md`), 1.1.0 (23) on internal testing, Android screenshots and en-US listing done, 1.1.0 (24) for the closed test **rejected** 2026-10-29 (health apps need an organization account): Android now ships without health features; listing, screenshots, Health apps and content rating redone; **1.1.0 (26) approved for the closed test 2026-10-30**; then 12 testers × 14 days and production (`docs/ANDROID_PLAY.md`) |
| Preparedness (family plan, emergency kit with expiry reminders, printable PDF, offline guides) | done — iOS sim + Android emulator (E2E) |
| E2E suite (Maestro) + pre-commit hook | done |
| Pre-release audit (2026-10-26): ~60 verified findings fixed in code and docs | merged to main; device checks and the deferred items below pending |

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

Roughly by value. Items A, U and 0 are in progress; 3, 4 and 7 are partly done (see each); the rest are not
started. (Preparedness was added
on 2026-10-25 from an "internet goes down" checklist; follow-ups are at the end.)

A. **After the pre-release audit** (2026-10-26). Deferred on purpose, **re-check in ~2 days, with the
   country-coverage work**:
   - ~~Regenerate the store screenshots (DOCS-PUBLIC-3 / LEGAL-14)~~ done 2026-10-27 for 1.1.0 (OSM credit
     under the map shots; `docs/RELEASE.md`, Screenshots).
   - ~~OSS-9: obsolete PNGs in the repo~~ done 2026-10-28 (12 unreferenced early screenshots removed).
   - ~~The history rewrite that removes the owner's old location examples, then tagging the store
     builds~~ done: main was rewritten (de6574b per the owner's notes) and the store builds are tagged and
     pushed, `v1.1.0-12` to `v1.1.0-23` (no `-17`: that build is not to be used; GPL section 6).
   Owner decisions still open or to carry out:
   - Android before any Play release: ML Kit GenAI is removed and Firebase kept out of the APK
     (done 2026-10-26); ~~list the full transitive Android notices~~ done 2026-10-28 (Credits › Android
     libraries, `scripts/licenses/android-deps.mjs`); ~~Play services and the Install Referrer next to GPL
     libkiwix~~ done 2026-10-29, owner's option A: no proprietary library left in the APK (log). ~~Upload key,
     listing and Data safety draft~~ done 2026-10-29 (backlog item 5).
   - ~~Store prebuild gated by an env var (LEGAL-9)~~ done 2026-10-28: `NOMAD_STORE_BUILD=1 npx expo prebuild`
     (`plugins/with-store-build.js`, `docs/RELEASE.md`); check the archived `Info.plist` on the next store build.
   - A planned index rebuild to reclaim the space of existing users' old index file.
   - ~~Ship `OFL.txt` and the sprites' MIT licence inside `basemap-assets.zip`~~ done 2026-10-28 (`VERSION` v5).
   - ~~Geofabrik mis-tags: matching by name~~ done 2026-10-28 for the one country it affected: of the list,
     `pf`, `wf`, `as`, `gu`, `mp` have routing packs (which bring their side files), `tk` and Clipperton
     aren't offered; the Pitcairn Islands (`pn`, tagged MH) get side files from the next monthly run, matched by
     name. Saint Pierre and Miquelon (`pm`) has no Geofabrik extract at all (Overpass).
   - ~~The pronoun threshold of the assistant~~ done 2026-10-28: a pronoun that is an object ("on it", last
     word) carries the topic with two words of its own ("Can I put ice on it?"). Long questions (> 600
     chars) are still searched once.
   - ~~Code cleanup: `places.ts`'s private `forEachLineBlock`~~ already gone (it imports `side-files.ts`'s).
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
     place is untested); removing a real installed country; phone timings of search (the imports were timed on
     the iPhone 14 Pro on 2026-10-28: Spain's four side files in 51 s, log).
   - Reader on Android (new origin, CSP, external-link prompt, recovery after `chrome://crash`, an
     imported PouchDB archive); iOS reader with a remote image/fetch (verified blocked on the simulator).
   - Android build with the new native dependency (`expo-screen-orientation`); dark mode, VoiceOver and
     iPad width of the new screens (Credits, onboarding); a real GGUF backgrounded mid-load/search;
     Apple FM error codes translated. (Done since: Android release builds with it and the Android tour pass,
     2026-10-28; the Maestro suites run on main, smoke + full 43/43.)

C. **CarPlay + voice + background navigation** (branch `carplay`, `docs/CARPLAY_PLAN.md`), built and tested on the
   simulator's car screen 2026-10-31. Next, in order:
   - Owner: request the CarPlay navigation entitlement (draft text at the end of `docs/CARPLAY_PLAN.md`).
   - Hear the voice prompts on a real phone (walk or drive a short route with "Iniciar"), screen locked.
   - Merge `carplay` into main when the owner is happy (it changes the location purpose string and the privacy
     policy; the Android build adds a foreground service: Play Console declaration first, `docs/ANDROID_PLAY.md`).
   - With the entitlement: `entitlement: true` for `./plugins/with-carplay` in `app.json`, TestFlight, a real car;
     then the Dashboard and instrument cluster (`docs/CARPLAY_PLAN.md`, "Later").

U. **UX redesign and country packages** (`docs/UX_SURVIVAL_PLAN.md`, `docs/COUNTRY_REGIONS_PLAN.md`):
   done and live. State at 2026-10-27 (resume point for the "rediseño" session, which also owns
   `scripts/routing/*` and `scripts/maps/*` since the "navegador nomad" session closed):
   - **Catalogs**: maps-index 246 maps (every country of regions.json at z15 except Canada and
     Russia at z14; the USA as six regional maps at z15); routing-index 237 packs (every country
     but `pm` and uninhabited territories: atc gs hm io kas pn tf; `ht` uses `do`; the USA as
     us-west, us-midwest, us-northeast, us-south, us-alaska, us-hawaii). Every part and side file
     checked in its release on 2026-10-27.
   - **Owner, on a real iPhone**: (1) a US region end to end (Northeast, 5.5 GB:
     sheet → region list → download → Tus mapas "Noreste"); (2) ~~Spain from a fresh install~~ done on the
     iPhone 14 Pro (2026-10-27 runs 1–7, 2026-10-28 run 8: the whole kit in 6:47, search ready at 3:23);
     (3) bigger side-file imports than Spain's (Germany's 780 MB of house numbers, ~450 MB per US region).
   - **Agent, when asked**: (1) ~~E2E flows for countries in regions~~ done 2026-10-28 (`map-20`, `map-21`) (owner wants them, 2026-10-27),
     both kinds, against a local catalog (`scripts/e2e.sh` maps server; testIDs `region-*` in
     docs/E2E.md): (a) a pack per region, as the USA (Andorra split in two regions, each with its
     map and pack): tick, download, delete; (b) regions for the map only plus a national pack, as
     Canada and Russia (two regional maps with outline `cells` + one country pack; the manual run
     of 2026-10-27 used real Ontario/Quebec z8 maps and Andorra's pack as `ca`): the region ticked
     from the location, the pack downloaded with the first region only, the second region
     costing only its map, deleting the last region removing the pack; (2) watch the monthly
     run on 2026-11-05, the first full one with regions, the CI hardening and the retries
     (`gh run list --workflow country-packages.yml`; then spot-check both catalogs and their
     assets); (3) admin boundaries without Overpass (it often refuses GitHub runners: 502/504;
     `build-country.sh` step 2 takes any OSM file of the level-2/4 relations; reruns have
     always worked so far).
   - **Canada and Russia by regions** (owner, 2026-10-27, option B of `docs/COUNTRY_REGIONS_PLAN.md`):
     seven map regions each at z15, routing pack and side files whole for the country (they come
     with the first region, so routes between regions work); Crimea inside `ru-south` with no name
     of its own. Code ready (CI `scripts/maps/map-regions.json`, app `CountryOffer.common`).
     Checked on the simulator with a local catalog (two Canadian regions, a stand-in pack).
     **Published** (owner's call, ahead of the build): run 40544693154 (`countries="ca ru"
     parts=maps`), maps-index now 258 maps: the 14 regions at z15 (Canada 16.1 GB, Russia
     13.5 GB in all), no whole ca/ru map, packs unchanged; every part checked in its release.
     Builds 16–19 show the region ids and download regions without routing; builds 20 and later (3c75852)
     have the fix. **Next**: a real-phone check of one region.
   - **Routes across packs** (between countries and US regions): stitched at border crossings, on main
     and pushed since bdc1fae (2026-10-28). Works once the published packs carry `<pack>.crossings.tsv`: the first
     `country-packages.yml` run after it: run 40681896621 (`ad pt`, 2026-10-28) succeeded and both carry
     crossings; the full run of every country (40691060942, 2026-10-28) succeeded (263/263 jobs): 165 of 237 packs
     carry crossings (the rest are islands, plus `ie`, whose pack holds Northern Ireland, `ps`, covered by `il`'s,
     and `va`); the monthly one is on 2026-11-05 and adds ferry crossings (2026-10-29). Needs app builds from bdc1fae on (store builds up to 23 predate it). Tried with the live packs on iOS and Android (Luxembourg → Brussels). The US stays split. `docs/ROUTING_ACROSS_PACKS.md`.
   - **Deferred by decision**: bundled quick cards (first aid, water, radio; owner
     reviews medical content first). ~~Emergency numbers per country~~ done 2026-10-29 (log); the 8 doubtful
     rows checked by the owner the same day (`docs/EMERGENCY_NUMBERS.md`).
   - **CI notes**: a failed country is relaunched alone with `gh workflow run
     country-packages.yml -f countries="<ids>" -f parts=routing|maps` (region ids work too:
     `us-alaska`); admin boundaries come from the `routing-admins` release, refreshed on the 1st by
     `admin-boundaries.yml` (by hand: `gh workflow run admin-boundaries.yml [-f isos="PT ES"]`); the `country-packages` concurrency group queues runs; this Mac's corporate VPN
     breaks TLS to Protomaps/Kiwix/Overpass from simulators (E2E `map-04`, `map-13`), and `map-04`
     needs another server-tagged flow in the same run for its local catalogs.

0. Routing packs for the whole world: **live** (237 packs, 2026-10-27; item U). Still to do from
   `docs/MAPS_NAVIGATION_PLAN.md`: measure on a real phone (route time/memory, mmap of a 2 GB tar
   on iOS, which may need `com.apple.developer.kernel.extended-virtual-addressing`), then phase 3
   (turn-by-turn: voice with expo-speech, background location).
1. Watch App Review for 1.1.0 (build 23, submitted 2026-10-28; 1.0.1 was folded into it); test it
   (TestFlight) on a real iPhone: navigation view (driving and on foot), compass beam, street and school search, routing
   packs (download Spain 2.2 GB, route time/memory), Preparedness reminders, GPU
   llama.cpp, Apple Intelligence, background downloads, Files import, airplane mode.
2. Search side files: published (the 2026-10-26 full run; packs and country maps carry
   `.places.tsv` / `.addresses.tsv`). ~~Measure the import on a real phone~~ done: Spain's on the iPhone 14 Pro
   in 51 s (pois 4.6 s, streets 16 s, places 10 s, addresses 20 s; 2026-10-28). Not measured on an Android phone.
3. Faster, resumable downloads: built (log 2026-10-26, `docs/DOWNLOADS_SPEED_PLAN.md`); Spanish
   Wikipedia nopic, 13.3 GB, in 8.6 min on the simulator instead of ~2 h; adaptive connection
   budget built. Measured and tuned on the owner's iPhone 14 Pro (2026-10-27, runs 1–7). Next: an Android phone
   (and the emulator's speed), and iOS with the app in the background for long. Since 2026-10-28 files
   from 4 MiB go segmented and resume after an iOS kill; only one-chunk files (< 4 MiB) restart (BUG-CORE-16).
   The whole kit on the phone with it: 6:47 (run 8, 2026-10-28), no slower.
4. Map extraction: resumes after a kill since 2026-10-28. Still to do: move it off the JS thread (a native
   range fetcher writing at offsets, background URLSession / foreground service; ~3–5 days with both
   platforms). ~~A Retry for a failed extraction~~ done 2026-10-28 (Downloads row; flow `map-23`).
5. Android release (`docs/RELEASE.md`, Android; `docs/store/play-listing.md`). Done 2026-10-29: upload key and
   signed store AAB, permissions trimmed, 64-bit ABIs only, "Report answer" for Play's AI policy, Play texts,
   form answers, icon and feature graphic; the app created in Play Console with every App content form,
   store settings, es-ES and en-US listings with Android screenshots; 1.1.0 (23) on internal testing; **1.1.0 (24)
   on the closed track "Alpha" ("Friends and family", all countries) sent to Google's review with the listings and
   forms (15 changes)**. To do: once approved, 12 testers opt in and keep it 14 days in a row (required for every
   new app of this personal account), then apply for production (Play asks a short questionnaire about the test). Content rating is PEGI 18 (audience 18+) until IARC answers the owner's question.
6. Reader: auto-hiding toolbar on scroll (style guide), syllabus for SPA course ZIMs read
   from the rendered DOM.
7. Assistant: ~~copy / regenerate an answer~~ done 2026-10-28; better small-model citations; check the
   conversational flow on Android (llama.cpp tools) and on a
   real iPhone (tool-call latency with Metal). Document index follow-ups (log 2026-10-28): OCR for scanned
   PDFs, open a PDF at the cited page (native PDFKit view), English guides for Spanish questions, measure
   the indexing time and memory on a real iPhone and Android phone; ~~search the passages from the
   library's global search~~ done 2026-10-28.
8. Preparedness follow-ups: ~~share ZIMs phone to phone~~ done 2026-10-28 (maps still need an import); "Ready.gov"-style quick cards bundled in the app (radio frequencies, first aid)
   that need no download; optional Face ID lock for the plan; link the plan's meeting points to maps' Llévame
   guidance and the hub to the Emergencias sheet (both landed on main in parallel).


- **Seen while making the 1.1.0 store screenshots** (2026-10-27, iOS 27 simulators with the Spain kit in
  Madrid and the US Northeast kit in New York; build 21). Fixed in c03c0cc / c7cf754: wrong neighbourhood
  on search rows, Home's first aid opening English PDFs for Spanish users, the assistant's greeting,
  Spanish retrieval ("potabilizo"), empty image boxes in nopic archives. Then fixed for build 23
  (log 2026-10-28): assistant retrieval in English (Apple's router translated queries into Spanish;
  English noise words; exact-title lookup) and small talk inside answers with sources (the coffee joke
  in a burn answer). Then (log 2026-10-28, units): distances in miles and feet for US users, yards in
  the UK, water in gallons in the US, and US English copy. All fixed.

- **Functional review on the simulator** (2026-10-28, Release of 332b8ad against the live catalogs; sims
  `NP-review` — Spanish, Spain kit in Madrid + Israel — and `NP-review-en` — US English, Hawaii). Full list,
  repro, causes and fix status: `docs/FUNCTIONAL_REVIEW_2026-10-28.md` (R1–R15). Fixed the same day (log
  2026-10-28, re-tested on both sims): R1 assistant ignoring Spanish questions' words behind Apple's
  English router queries (family plan meeting point never found), R2 nearest hospital in SOS and category
  search ("hospital", "farmacia"), R4 guardrail error in raw English + retry, R5 sources on "not found"
  answers and PDF titles, R7 map dots thinned by zoom, R8 country aliases, R9–R12 small UI fixes, R14
  duplicate address rows. Then R3 (relevance for title-less
  chunks) and R13 (SVG images not re-inverted in dark mode). R6 localized names: tile rows and
  apostrophes at once; pack POIs and streets once the monthly CI rebuilds the packs with the new name:es /
  name:en columns (next run 2026-11-05). The search index version went to 2: every installed
  map re-indexes its tiles once after the update.

## Known issues / limitations

- ~~Android: big GitHub / Hugging Face downloads stall~~ fixed 2026-10-29 (log): expo-file-system's download client
  queued every call past OkHttp's 5 per host, and the segmented engine's queued ranges looked stalled.
- Android, also seen then: the country picker scrolls stiffly on a Mi 9 (~240 heavy rows in a plain scroll view; a
  virtualized list needs testing inside the form sheet on both platforms); the emergency sheet's "Agua y refugio" chip
  clipped on its first render (English "Water &");
  after a location change the app kept the old country's emergency number until restarted (emulator mock location,
  may be emulator-only); the 0.8B model's Spanish first-aid answers are poor on the emulator (meta text, odd advice).
- Map search: house numbers and far-away POIs come from the country package's side files
  (published). Without them (a map from the extraction fallback), big regions are indexed at a
  lower zoom (≤ 40k tiles: Spain z14 → z12) with full detail only within ~25 km of the user or the
  searched area. House numbers are as complete as OSM (a missing number lands between its
  neighbours, marked approximate). Indexing and imports run on the JS thread in batches (Spain's side-file
  imports: 51 s on an iPhone 14 Pro); search itself runs on a second connection.
- Chinese and Japanese names: a map's tile index was rebuilt with the character-pair indexing when
  `INDEX_VERSION` went to 2 (2026-10-28). Country side-file imports (places, streets, addresses) are not
  covered by that bump: ones made before the pair indexing only match from their first character until the
  country is downloaded or imported again.
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
  isochrones (valhalla-mobile exposes none), routes across packs only where the packs carry
  crossings (see item U), no voice / background navigation yet. Pack and map files are verified against the
  manifest's size and sha-256. Maps downloaded as a country (map with the pack or its own points) no longer ask Overpass.
- Across the antimeridian: search, map points, locality context, routing coverage, Overpass cells and the
  camera framing of routes and trips (`fitBox`, east past 180) are handled (2026-10-28). Map boxes still
  stop at 180°: `regions.json` and the published country maps (`fj` ends at 180, `ru-far-east` too), so
  Fiji's Lau group and Chukotka's eastern tip are not in their maps, and extraction never gets a box that
  crosses (a fix spans `regions.json`, the CI outlines, the PMTiles header bounds and the camera).
- After a backup restore the database comes back without the content (items are dropped at
  startup, see ARCHITECTURE). A segmented download whose partial bytes didn't come back is marked
  failed ("didn't come back with your backup", Retry); a queued row that never started and one-chunk
  files (< 4 MiB) can't be told apart from a relaunch and still download again.
- Downloads interrupted by app termination: files ≥ 4 MiB (segmented) continue from their
  verified `.part` prefix and the ranges on disk on both platforms; only the ranges in flight are
  fetched again (on iOS the orphaned tasks also fetch them once more). One-chunk files (< 4 MiB) and
  sources without ranges on iOS still restart from zero (BUG-CORE-16: the background session isn't reattached).
- The segmented engine is measured on an iPhone 14 Pro (in the foreground, and 1–2 min in the background:
  `docs/DOWNLOADS_SPEED_PLAN.md`), not on an Android phone; long stays in the background on iOS are unmeasured.
- Compass heading in landscape: iOS reports an orientation of UNKNOWN until the first rotation after
  launch, so the heading is withheld in landscape until then; Android tablets whose natural
  orientation is landscape stay 90° off.
- Map extraction runs on the JS thread in the foreground (screen kept awake); after a kill or a network
  failure it continues on the next launch, or at once with Retry in Downloads (cancel or a 4xx starts over).
- Qwen3.5 0.8B rarely emits `[n]` (all retrieved sources are shown then) and is
  unreliable for health answers — the app recommends 2B+ where RAM allows. (It answered from memory after
  saying it found nothing, dangerously wrong: bleach as "a sea salt solution"; since 2026-10-28 no model answers
  from memory when the library has nothing.) In small talk
  it sometimes rambles or echoes its instructions, and it searches some chit-chat
  ("¿te gusta la música?") on its own.
- The models still answer some famous facts from memory instead of searching ("What is
  photosynthesis?") when the router or the model takes them for small talk: the not-found guard only acts
  when an answer says it found nothing. The "Buscar en mi biblioteca" button covers it. Apple FM tends to
  open every answer with "¡Hola!" once the chat started with a greeting.
- Apple Intelligence fails on the iOS 26.5 simulator (works on iOS 27).
- Map labels in Bengali, Tamil and other Indic scripts, Myanmar and Khmer are not drawn
  (MapLibre Native can't shape them); country bboxes skip far-flung territories.
- ZIM media Range path untested with a real video archive.
- Not automated: importing a ZIM from Files (system picker) and true offline mode
  (simulator has no airplane mode); the Android tour covers country downloads, search,
  Emergencias, Preparedness and routing, but not the assistant or labels in other scripts
  (checked by hand on the emulator).

Build gotchas moved to `docs/DEVELOPMENT.md`.

## Log

### 2026-10-31 — CarPlay: seen and fixed on the simulator's car screen

- Xcode 27 has no CarPlay screen (Device Hub); Xcode 26.5 installed next to it for its Simulator.app (owner's
  go), iOS 26.5 simulator `NP-carplay-26`, Apple's simulator-only CarPlay host crash worked around with
  `scripts/carplay/sim-shim.m`; synthetic taps on the car screen work with a click state (`tap.swift`), so the
  whole thing is scripted (`scripts/carplay/carplay-sim.sh`, recipe in `docs/CARPLAY_PLAN.md`, "Testing").
- Bugs found there and fixed: an empty route polyline crashed MapLibre; the car map never got a position
  (MapLibre's user tracking is dormant without the phone app in front: own location manager, own camera,
  user/route/destination as style layers); MapLibre's default demo style was fetched from the internet
  before ours (now a local placeholder); opened from the car, React Native never rendered (its root view now
  sits invisible behind the car map); a pop with nothing to pop raised an exception (completion handlers
  everywhere); the camera ignored the safe area (edge padding per move); overview padding counted twice;
  the bar hid itself and "Terminar" took two taps (bar always shown); zoom on start; "Has llegado" alert;
  lists measure from the car's own fix; the second maneuver row only when close (it hid the arrival time).
- Checked end to end (list in `docs/CARPLAY_PLAN.md`): car-first start then phone adoption, preview,
  navigation with turn panel and estimates while driving the CG-1, reroute, arrival, end from either side.

### 2026-10-31 — CarPlay navigation, voice prompts and guidance in the background (branch `carplay`)

- Owner asked (night of 2026-10-30) for CarPlay, navigation only, and answered the open questions: the owner requests
  the CarPlay entitlement (draft text in `docs/CARPLAY_PLAN.md`); voice and background first, for the
  phone too, iOS and Android; v1 = map + navigation, saved places, Emergencias cerca, search; work on a branch,
  commits pushed there, not to main.
- **Voice** (`modules/nomad-voice`, `features/maps/voice{,-core}.ts`): an early announcement and the prompt per
  maneuver from Valhalla's verbal instructions (`alert` and `multiCue` now parsed), start instruction once, round
  distances in the region's units, speaker button (`guidance-voice`, setting `navVoice`). iOS voice-prompt audio
  session ducking other audio, off the main thread; Android navigation-guidance audio focus.
- **Background** (`watchNavigationAsync`, `modules/nomad-location` with a new iOS side and an Android foreground
  service): starts with "Iniciar"; with CarPlay connected even the preview's watch survives a locked phone.
  `UIBackgroundModes` location + audio, location purpose string and privacy policy (es/en) say so.
- **CarPlay** (`modules/nomad-carplay`, `features/carplay`, `plugins/with-carplay.js`): see ARCHITECTURE
  ("CarPlay"). The entitlement is only added with `CARPLAY_ENTITLEMENT=1` at prebuild (simulator) until Apple
  grants it; `app.json` keeps it off so device builds still sign.
- Checks: tsc, lint, unit tests (new: voice-core, carplay-core), i18n; iOS Release sim build; E2E map-14-route and
  map-17-follow pass on iOS (a rerun of map-17 under a parallel Gradle build lost typed text, a Maestro flake).
- Android emulator (AVD `Pixel_API_36` recreated, it was gone, like the iOS simulators: `NP-carplay` created):
  tour 4/4; by hand with Maestro, "Iniciar" starts `NavigationService` (foreground, type location, notification
  "Navegación en curso · Hacia …"), the high-accuracy request stays registered after Home, "Finalizar" stops it.
- Not done: seeing the car screen (Xcode 27 replaced Simulator.app by DeviceHub, which opened no window from the
  command line: the owner opens the simulator UI and its CarPlay external display, see `docs/CARPLAY_PLAN.md` testing); hearing the voice on
  a phone.

### 2026-10-30 — Repo: commit rules (no session links, weekday commits at night)

- The owner's rules for this repo: no claude.ai session links in commits, and Mon–Fri commits dated 22:00–02:00
  (weekends free). History rewritten twice and force-pushed (main, the 40 remote tags with their Releases, the
  git-ai notes in `refs/notes/ai`): first the dates (each weekday 02:00→02:00 squeezed into 22:00→02:00, today's two
  commits at 01:55), then the `Claude-Session:` trailers dropped from all 291 commits that had them. Hashes quoted in
  messages were translated; every commit hash in older notes is stale.
- Enforced from now on: `scripts/commit-hours.mjs` (+ tests) behind three new hooks in `.githooks/` (commit-msg
  strips the link, post-commit amends a daytime commit into that night and carries git-ai's note over, pre-push
  refuses what slipped through; notes refs are skipped), `attribution.sessionUrl: false` in `.claude/settings.json`, the rule in CLAUDE.md.

### 2026-10-30 — Android: closed test 1.1.0 (26) sent to review; Android/Play doc

- Play Console: the rejected 1.1.0 (24) couldn't be edited, so a new release on "Prueba cerrada - Alpha" with the
  versionCode 26 AAB (the owner uploaded it; 24 "not included"), release notes es/en from `play-listing.md`, saved
  through review (no errors, no devices lost). The owner sent the 15 changes to review (release, listings, content
  rating PEGI 3, audience 13+, Health apps "none", Data safety and the other forms).
- New `docs/ANDROID_PLAY.md`: one place for Android + Google Play, written for the next session: hard rules (no
  health features, never a remote switch, no Play services, who clicks what in Play Console), track state, timeline
  of the rejection and Play support's answer, map of every `HEALTH_FEATURES` gate in the code, checklist for new
  health-related code, the assistant model check, other Play requirements and how we meet them, release steps and
  Play Console gotchas. Linked from `CLAUDE.md`, `docs/RELEASE.md` and `docs/store/play-listing.md`.
- Google approved it the same morning (live for testers at 9:40). Next: 12+ testers opted in for 14 days, then the
  production application.

### 2026-10-29 — Android: Play listing redone without health; build 26 tightens the assistant

- Play Console: Health apps declaration "no health features"; es-ES and en-US descriptions without first aid or
  medical details; the 8 Android phone screenshots of each language redone on the versionCode 25 APK (home with
  survival guides, a survival guide instead of first aid, the water starter answered by Qwen3.5 4B, library and
  kit without medicine). Content rating redone: violence, language and drugs "no", as Kiwix and Wikipedia rate the
  same content (owner's decision) → **PEGI 3**, ESRB Everyone; target audience back to 13+. All saved, not sent.
- Seen while shooting: the no-health prompt made the model refuse water questions or add "consult a doctor", and
  the assistant's empty screen still said "for health questions, consult a professional". Fixed for versionCode
  26: the prompt now forbids only medical treatment and first-aid steps and says water, food, shelter, fire and
  hygiene aren't health topics (Qwen3.5 4B on the Mac, 3 runs per question: clean water answers in es and en, where
  the old prompt appended a refusal); `empty.disclaimerNoHealth`; `isHealthQuestion` also catches emergencies that
  name no condition ("me he cortado", "swallowed bleach", fainting, choking, seizures…), which the model answered
  with improvised first aid once in 3 runs with the old prompt.
- Known: an update from 23/24 (internal testers only) keeps medical archives already installed; they stay readable
  under the "not medical advice" banner. Fresh installs (Play's reviewers, closed testers) never see them.

### 2026-10-29 — Android without health features (Play rejected the closed test)

Google rejected the closed test 1.1.0 (24) the same day: our Health apps declaration ("Emergency and First
Aid", "Medical Reference and Education") needs an organization account, and the owner's is personal and will
stay so. Declaring "no health features" with the app as it was would have been inaccurate (Play support
confirmed it in a ticket), so Android now has none; iOS keeps everything.

- `src/lib/health.ts`: `HEALTH_FEATURES`, false on Android, fixed at build time (Play forbids switching
  undeclared features on after review). `features/catalog/health-core.ts` (+ tests) drops the medicine
  category, every medical archive, "Después del desastre" and the 2 health courses from the bundled catalog;
  Explore hides them and anything `looksMedical`.
- Home: a survival guides shortcut instead of first aid; readiness and onboarding guides without medicine.
  Assistant: a health question gets a fixed answer with the emergency number (`noHealthAnswer`), the prompt
  forbids health advice, the burn starter becomes a knot one; `isHealthQuestion` no longer takes "paint",
  "medición", "sangría", "picadillo" or "burner" for health. Plan: no health card.
- Kept (owner's choices): the kit's health supplies, Ready.gov and CD3WD, Wikipedia; emergency number and the
  map's hospitals and pharmacies (Play: general utility).
- Library texts no longer mention medicine on either platform ("Wikipedia, guides and courses").
- Next: versionCode 25 AAB, Android screenshots without first aid (home, first aid, assistant, library),
  Play listing per `docs/store/play-listing.md`, Health apps declaration "no health features", redo the
  content rating (the injury photos that made it PEGI 18 were in the medical guides), resubmit the closed test.

### 2026-10-29 — Android: downloads no longer stall; country picker opens fast and once

Owner's Mi 9 (Android 11) by USB, store APK, logcat of the app while the owner downloaded the Spain kit.
- **Stalls**: expo-file-system's `DownloadTask` sends every download through one OkHttpClient whose dispatcher runs 5
  calls per host and queues the rest. The segmented engine opens 12 ranges to one URL (GitHub, Hugging Face, Kiwix's
  load balancer when no mirror could be measured): the 7 queued ranges got 0 bytes, the 15 s watchdog cancelled them as
  errors, and the download gave up with DOWNLOAD_STALLED (the log showed exactly 7 stalls of 12 on Wikipedia).
  `modules/nomad-files` now raises that dispatcher to 32 per host at startup (`raiseDownloadConcurrency`, finding the
  client field by type: R8 renames it; compiles against the prebuilt expo-file-system artifact), and the manager keeps
  its per-host connections under what the client allows (4 if raising ever fails). After: Spanish Wikipedia 13.3 GB in
  950 s (14 MB/s), Portugal and Belgium with 12 connections to github.com and no stall (the Belgian map 838 MB in 45 s).
- **Country picker**: tapping "Añadir un país" several times stacked as many sheets (`router.push` before the first sheet
  was up): `router.navigate` now. It also took a second or more to appear: the first 30 rows render at once, the rest
  350 ms later. Scrolling it is still stiff on the Mi 9 (known issues).

### 2026-10-29 — Android: ready for Play (upload key, AAB, AI reports, listing draft)

Owner asked what Android still needed for Play, then to do it. Play Console (owner's account, checked
in Chrome): personal account with two other apps; Nomad Pocket isn't created yet; new apps there need a
closed test with 12 testers for 14 days (another app's dashboard says so).

- **Signing**: upload key `~/.android-upload/nomadpocket-upload.jks` + properties in
  `~/.gradle/gradle.properties`, used by `plugins/with-store-build.js` when `NOMAD_STORE_BUILD=1` (a store
  release build without them fails). `bundleRelease` → 204 MB AAB signed with it (`docs/RELEASE.md`, Android).
- **Manifest**: `SYSTEM_ALERT_WINDOW` (Expo's template) and the storage permissions that a clean prebuild
  brings back are blocked (`android.blockedPermissions`). Left: location, network, notifications + boot
  (kit reminders), microphone, vibrate.
- **ABIs**: arm64-v8a + x86_64 only (llama.rn has no 32-bit libraries). Download size per bundletool:
  arm64 ~90 MB, x86_64 ~66 MB (limit 200 MB). 16 KB pages: every `.so` aligned, zipalign -P 16 passes.
- **Report answer** (Play's AI-generated content policy): a flag under each finished answer opens the mail
  app with the answer, app version and system (`features/assistant/report-core.ts`, tested); privacy
  policy says so in es + en (last updated 29 Oct).
- **Listing**: `docs/store/play-listing.md` (texts from the App Store listing minus Apple Intelligence,
  every Play Console form answered: content rating, target audience 18+, health apps "medical reference",
  Data safety "no data collected"); `scripts/store-screenshots.py` also writes Play's 512 px icon and
  the 1024 × 500 feature graphics (`docs/store/play/`) and composes `android` captures at 1080 × 1920.
- Checked: tsc, lint, 388 unit tests, i18n; AAB manifest and signature; Android tour with the store-signed APK: **4/4 with the
  VPN off** (a first run with GlobalProtect on passed only android-04: the VPN leaves the emulator's network in
  partial connectivity, the app treats it as offline and never asks the Wi-Fi question).
- **Play Console** (owner's OK): the app form filled (name, `com.fjlinde.nomadpocket` available, es-ES, app, free);
  the owner ticks the two declarations and creates it. Testers: the account-wide email list "Friends and family"
  (19 addresses, used by Theri.App's closed test) goes to Nomad Pocket's closed test.

### 2026-10-29 — Android without Play services; an emergency number per country

Owner's decisions of 2026-10-28: option A for Play (no proprietary library next to GPL libkiwix) and
one emergency number per country, emergency only.

- **Android location without Play services**: `modules/nomad-location` (Kotlin, Android only): the
  system's `LocationManager` (fused provider on Android 12+, GPS + network before, a network fix dropped
  while GPS gave one in the last 10 s), the compass from magnetometer + accelerometer with expo-location's
  thresholds and true north from `GeomagneticField`, watches and compass paused in the background like
  expo-location. `src/lib/location.ts` is the one import for the app (ESLint bans `expo-location`
  elsewhere): expo-location on iOS, `location.android.ts` on Android with expo-location's types and watch
  defaults; several compass watchers share one native listener (expo-location kept only the last one).
  `package.json` leaves expo-location out of Android autolinking. `plugins/with-android-no-install-referrer.js`
  excludes `com.android.installreferrer`; R8 is told not to fail on the Play services tasks that
  expo-notifications' unused push-token code names (they used to come along with play-services-location).
  The release runtime classpath has no `gms` or `installreferrer` artifact; the dex only names them from
  code that never runs. Lost: Android's "turn on location accuracy" dialog (a Play services feature).
- **Emergency number per country**: `emergency-numbers.json` (235 of 242 countries) from
  `scripts/maps/make-emergency-numbers.py` (Wikipedia's list + 26 corrections: 112 for every service in
  the EU/EEA, Switzerland, Liechtenstein, Monaco, San Marino; Colombia 123; Pakistan 1122; police where
  the ambulance number is a landline or missing; Australian territories 000; and 8 rows the owner checked:
  Andorra 116, Ethiopia 911, Uganda 911, Tanzania 112 (every service), Peru 106, Bolivia 118, Sri Lanka 1990, UAE 998). One number: the one for
  every service, else the ambulance's ("Llamar al 119 (ambulancia)"), else the police's. The country is
  where the last position seen is (`country-at-core.ts` over `country-shapes.json`, Natural Earth 1:50m
  simplified to ~2 km, 218 KB, plus Ceuta and Melilla from 1:10m; kv `maps.hereCountry`), else the
  onboarding country, else the device region, else 112. The Emergencias sheet names the country under
  the button. Review table: `docs/EMERGENCY_NUMBERS.md`. Credits: Wikipedia (CC BY-SA)
  for the numbers.
- Also: dictation verified on the owner's iPhone (2026-10-28).
- Checked: unit tests (country lookup: Madrid, Ceuta, Melilla, Tangier, Maseru inside South Africa,
  Tijuana/San Diego, off Barcelona, open sea), tsc, lint, i18n; Android release APK built from a clean
  prebuild; dependency tree and dex scanned; credits regenerated (191 Android artifacts, 5 fewer); iOS smoke 21/21
  (clean prebuild; home and Emergencias offer 112 at Madrid). Android
  tour 4/4 over two runs: with the corporate VPN on, android-01's last download failed on its TLS proxy ("Trust
  anchor not found"); with it off android-01 passed and android-03 (the number names Andorra) flaked once on a
  slow emulator (a dozen iOS simulators booted) and passed alone.

### 2026-10-29 — Maps: ferries join packs; Android tried; routes must reach their ends

- **Android**: the Release APK on a second emulator (the other agent's untouched), packs from the
  live catalog: Luxembourg city → Brussels by car, 213 km, 1 h 58 min, as on iOS. Belgium's pack
  stalled once on the emulator's network (`DOWNLOAD_STALLED`); the guidance button fetched it again.
- **Ferries as crossings** (Spain–Morocco, Great Britain–France, the Baltic): Estonia and Finland
  built locally with `build-country.sh` showed both packs hold the whole Tallinn–Helsinki ferries
  up to the other side's port. `crossings.py` now lists each ferry (and car shuttle) with one end
  abroad at that port, class `ferry`; the app takes ferry seams for every costing, without a
  heading, only from the departure pack's file (from the other's, the next leg started on the
  boat: "Conduzca … por Helsinki (FIN) – Tallinn (EST)") and only needing the arrival pack's
  coverage (the catalog clips Estonia's cells short of Helsinki); at a port the next leg's first
  instruction stays. Simulator: Tallinn → Lahti 192 km with "Tome la … Ferri", 0.3 s.
- **Routes must reach their ends** (`endGap`, `pickRoute`): Finland's pack covers Tallinn's cell,
  where it has only the boat, and the on-foot answer starting there began 1.5 km away on the ferry.
  Answers to one trip are now compared by end distance first (250 m slack), then time.
- Published packs get ferry crossings with the next CI run; older app versions ignore those rows.
  Figures: `docs/ROUTING_ACROSS_PACKS.md`.

### 2026-10-29 — Maps: routes across countries tried with the published packs; the missing download offered right

The stitched routes, until now tried with packs built on the Mac, tried end to end with the live catalogs on
the simulator (iPhone 17 Pro, iOS 27; the Release app with a JS bundle pointing at the GitHub catalogs):
Luxembourg city → Brussels with nothing installed, then Belgium, then Luxembourg downloaded from the sheet
(1.5 GB and 139 MB, each with its `<pack>.crossings.tsv`). Car 213 km / 1 h 58 min, foot 41 h 52 min, bike too,
each one route with one arrival (`[maps] stitched route-lu → route-be`, 0.5–3 s); a car reroute off the
route north of the city took 28 ms. Figures in `docs/ROUTING_ACROSS_PACKS.md`.

Bug found and fixed: with the destination's country installed but not the origin's, the guidance panel's
"Descargar la navegación de este país" opened the destination's sheet again (0 MB). `packToFetch`
(routing-core.ts, tested) now picks the first country the trip lacks: the destination's, the origin's, then
one on the straight line between them (Lisbon → Paris also needs Spain); none when every point is covered.

### 2026-10-29 — CI: admin boundaries cached for every pack, sturdier prune

Full routing run 40691060942 (from before the cache existed) succeeded, 263/263 jobs, 165 of 237 packs with
crossings. `admin-boundaries.yml` (run 40774092206, ~4 h) then filled `routing-admins` with all 230 ISO codes
of `packs.json`, none unanswered. Test run 40801730164 (`ad pt`, routing) read them from the cache (`admin
boundaries from the cache`; same 7 and 77 crossings; `pt` 9 min instead of ~30) and published, but its prune
failed twice: GitHub answers 502 to deleting a release of 280 files (9.5 GB, `routing-20261026-…-africa`) in one
call. The prune now deletes such a release's files one by one first and only warns when one still won't go
(the catalogs are already out; the next run retries). Old unreferenced releases remain until then.

### 2026-10-28 — Assistant: no answers from memory when the library has nothing

Asked by the owner after the Android check, where Qwen 0.8B said it found nothing and then called bleach "a
sea salt solution" unfit for drinking water. The prompts told the models to "answer from what you know"
when the library had nothing; now:
- A search with no passages answers a fixed text (`NOT_FOUND_ANSWER`: not found, no answer from memory so as
  not to give wrong information, try other words or download guides) without calling the model; in tools
  mode the search tool hands the engine that text as the final answer (no second pass).
- With "Usar mi biblioteca" on and nothing to search (no archives, an empty family plan), a question gets
  `NO_LIBRARY_ANSWER` (download guides, or turn the library off to talk to the model alone) without loading
  the model. Small talk still goes to the model, and so does everything with the library off.
- `guardNotFound` cuts any answer that opens with "No lo he encontrado…" and cites no source to the fixed
  text, while streaming too; one that goes on to cite a source stays whole. The prompts say "say only that".
- The family plan is searched even with no archive installed (it used to need one).
- Checked: Android emulator (Qwen 0.8B, tools mode) and iOS 27 simulator (Apple Intelligence): the bleach
  question gives the fixed text with an empty library and with the E2E archives, "hola" still chats, and
  questions the library answers keep their sources. `ai-03` and `ai-06` waited for a "Usar modelo integrado"
  button that the most capable model's preselection (build 20) hides: optional now, like `ai-09`; all three
  pass.

### 2026-10-28 — Small leftovers: extraction Retry, antimeridian framing, Android notices, follow-ups

The owner asked for the pending work that needs no device or decision. Done:

- **Retry for a failed map extraction**: `startExternalJob`'s `fail(error, { retry, discard })`; the Downloads
  row shows Retry for an external job that offers it (`retryable`). A network failure keeps the saved progress
  and Retry continues it on the build it started with; dismissing the row discards that progress (it used to
  resume silently on the next launch). Flow `map-23-extract-retry` (tag `planet`): the stand-in planet answers
  503 through its new `/__outage?ms=` endpoint (called from Maestro, `e2e/scripts/planet-outage.js`).
  Passed on the iOS 27 simulator (Release build with `PLANET_PORT`): of the 6 ranges done before the outage,
  none was fetched again after Retry.
- **Antimeridian**: `fitBox` (geo.ts) gives a camera box that runs east past 180 when the points cross it
  (MapLibre takes unwrapped bounds on iOS; Android's `LatLngBounds.from` only refuses east < west, checked in
  the 13.6.1 bytecode). Used for a route's bbox, a stitched route's and the trip framing. Extraction clipping
  left as is: no box that reaches it crosses 180 (`regions.json` and the published maps stop at 180; Fiji's
  Lau group and Chukotka's tip are outside their maps: known issue).
- **Map opens on the world** when the first region registers after the first render: framed once the native
  map has loaded (`onDidFinishLoadingMap`: a `fitBounds` before that is dropped, seen with a temporary log),
  unless the user's location, a place or a trip moved the camera first. Checked on the iOS simulator with a
  loose Melilla map and location denied: it opens on Melilla.
- **Map assets**: `OFL.txt` and `LICENSE-sprites.txt` inside `basemap-assets.zip` (+2.8 KB; `make-zip.py` adds
  them from `scripts/licenses/texts`), `VERSION` v5.
- **Assistant follow-ups**: a pronoun that is an object (last word, or after on/in/with/en/con…) carries the
  topic with two words of its own ("Can I put ice on it?", "¿Puedo poner hielo en eso?").
- **Geofabrik by name**: with no extract under the country's code, one named after it (the Pitcairn Islands,
  tagged MH). The rest of the old list already had routing packs; `pm` has no extract at all.
- **Android notices** (Play prerequisite): `scripts/licenses/android-deps.mjs` reads `./gradlew :app:dependencies`
  (release runtime classpath) and each POM's licence from the Gradle cache into `scripts/licenses/android.json`
  (196 artifacts; Expo modules are left to the JS list); Credits › Android libraries on Android builds. Not open
  source: four play-services artifacts and the Play Install Referrer (expo-application, via expo-notifications).
  BSD-2-Clause and GPL-3.0 standard texts added to `spdxFallback`.
- **PDFs in the library's global search**: full text also searches the passages of the PDFs inside the
  archives (the assistant's document index, `useDocSearch` → `searchDocuments`), a section per archive
  ("… · en sus PDF") whose rows read "<document> · pág. N" with the passage, opening the document like a
  source does (at page 1, like sources: the viewer ignores `#page=`), each archive's PDFs right after its
  articles. Checked on a clone of the docs simulator (67,858 passages): "tourniquet" lists *First Aid for
  Soldier · p. 68* and *Hospital Corpsman · p. 34* under Military Medicine, and opens the field manual.
- **Share an archive with another phone** (Preparedness follow-up): Library's long press offers Share or Delete
  (Delete still asks), and the resource sheet has Share; the share sheet gets the archive file itself (no copy,
  AirDrop/Nearby Share/Files), which the other phone adds with Import ZIM file. Maps aren't shareable yet (no
  import for them). `lib-02` follows the new long press and passes; the share sheet comes up with the
  ZIM file on the simulator (Copy, Save to Files; no AirDrop there).
- **Android** (release APK with all of the above, Pixel_API_36). Behind this Mac's corporate VPN (GlobalProtect)
  Kiwix and Hugging Face downloads fail on the emulator (`CertPathValidatorException: Trust anchor for
  certification path not found`: TLS intercepted); with the VPN off (the owner switched it off) they work. Tour:
  `android-03/04/05` pass (05 downloads Andorra's published pack with its `ad.crossings.tsv` and routes);
  `android-01` reaches the course and fails twice on its 30 s wait for the syllabus. Measured with temporary
  logs: the PDF scan of the new archive takes 0.19 s and the syllabus 0.18 s; the time goes to Maestro waiting
  for an overloaded emulator (4–7 s per hierarchy dump, skipped frames, a dozen simulators booted on the Mac);
  with a 120 s wait the course part passes. Assistant with llama.cpp (Qwen3.5 0.8B downloaded in the app, 533 MB
  at ~2 MB/s on the emulator's link): an answer, Copy (the keyboard offers the copied text) and Regenerate
  work. The 0.8B answer to "¿Cómo potabilizo agua con lejía?" with an empty library said it found nothing and
  then called bleach "a sea salt solution" unfit for drinking water (see Known issues). Credits › Android
  libraries checked by hand. Not tried on Android: a route across two packs (needs packs rebuilt with crossings
  by the full run), restore recovery, download speed on a real phone.

### 2026-10-28 — Docs: backlog checked against the day's work

Another session's summary of the pending work (read from this file) still listed things done on 2026-10-28.
Fixed here: item 2 (side-file imports timed on the phone), item 3 (the iPhone is measured; the Android phone
is what's left), item U (Spain from a fresh install done on the phone; the `ad pt` CI run succeeded; the full
run 40691060942 in progress), item A's device checks (Android build with expo-screen-orientation and the
Maestro suites on main are done), the backlog header (3, 4, 7 partly done) and two known issues (imports and
the segmented engine are measured on a phone).

### 2026-10-28 — The batch's leftovers: Android, map-22/ai-09, store plist, kit on the iPhone

- **Android** (release APK of ea7718e, Pixel_API_36): the tour passed 4/4 (its 12 MB archive now takes the
  segmented path). The first try failed 4/4 on a "Pixel Launcher isn't responding" dialog over the app (the Mac
  at load 80+ with three builds): an emulator problem, not the app. Copy/regenerate and the restore and
  antimeridian changes were not tried on Android (no model on the emulator, no restore to replay).
- **iOS**: `ai-09` passed on main's build. `map-22` passed after accepting the row while it prepares search
  (it timed out at 3 min under load). The planet server's log shows the resume: the first finished range isn't
  fetched again, the 7 around the kill are (they finished within the 1.5 s between saves, which is the design;
  487ad4b adds a trailing save so a burst of completions is never left unsaved longer than that).
- **Store prebuild** (`NOMAD_STORE_BUILD=1`, a signed Release build for the device): the app's `Info.plist`
  keeps only the `nomadpocket` and bundle-id schemes and ATS `NSAllowsArbitraryLoads: false`; no `exp+`,
  `RCTMetroPort`, `NSAllowsLocalNetworking` or Bonjour keys.
- **The kit on the owner's iPhone 14 Pro** (that store build, fresh install, next to the router): 20.7 GB in
  6:47, the guides in 0:49, the map at 1:56, search ready at 3:23 (imports 51 s), Wikipedia 47 MB/s: as fast
  as the best runs, so segmenting from 4 MiB costs nothing (`docs/DOWNLOADS_SPEED_PLAN.md`, run 8).

### 2026-10-28 — Pending work batch: region E2E, full/iPad runs, three bugs, small extras

The owner asked for the pending and postponed work that could be done now (items 1, 2, 4, 10 of a review of this
file, plus six small extras), done by Sonnet agents in their own worktrees, simulators and ports, reviewed and
integrated by the lead on branch `integrate-2026-10-28`:

- **E2E for countries in regions** (item U): `scripts/e2e.sh` serves the USA (`us-alaska`, `us-hawaii`: a map and a pack
  each) and Canada (`ca-ontario`, `ca-quebec`: maps with outline cells + one national pack `ca`) from Andorra's files.
  `map-20-regions-packs` and `map-21-regions-national-pack` (full) passed 4 and 3 times in a row. Maestro can't read
  `checked` on region rows (asserted through sizes); the picker's keyboard covers the last row after an alert.
- **Full and iPad suites on f4b32d4**: full 18/20 on the first run; `map-15` was stale (R2 leads Salud with the
  hospitals, the pharmacy fell off screen: now asserts the pack's clinic), `map-19` flaked once on a tap; iPad tour 1/1.
- **Backup restore** (known issue): `restore-core.ts` marks a segmented download whose `.part`/`.chunks` are gone as
  failed (`PARTIAL_LOST`, "didn't come back with your backup", Retry). Lead's fix: a failure that restarts a download
  from zero now drops `meta.segments`, or a kill before the restart would read as a restore.
- **BUG-CORE-16**: segmented from 4 MiB (was 16 MB), so 4–16 MB files resume after an iOS kill. Checked on the
  simulator with a 9 MB file and `simctl terminate`: after relaunch the finished first range wasn't fetched again.
- **Map extraction resume** (item 4): the job's inputs, the pinned planet build, a plan fingerprint and the finished
  tile requests are kept in kv (every 1.5 s, `extraction-core.ts`); `resumeMapDownloads()` re-plans at startup and
  skips them. `EXPO_PUBLIC_PLANET_BUILD_URL` + `scripts/dev-planet-server.ts` (a synthetic Swiss planet, slowed) stand in
  for Protomaps, which the corporate VPN intercepts; `map-22-extract-resume` (by hand, its own build) relaunched at
  ~28 % and ~75 %, never 0. Lead's fix: a network failure (offline at launch) keeps the saved progress instead of
  deleting it. Off the JS thread: assessed only (~3–5 days, native).
- **Small extras**: antimeridian-aware bbox queries (`geo.ts` `lonRanges`/`lonSql`/`nearOrderSql`, used by map dots,
  nearest search, locality, routing coverage, country parts, Overpass cells); LEGAL-9 store prebuild
  (`NOMAD_STORE_BUILD=1`, generated files diffed both ways); OSS-9 (12 screenshots); assistant Copy and Regenerate
  under an answer (`expo-clipboard`, `toPlainText`, `regenerateLast`; `ai-09`, nightly, passed on the iOS 27 sim).
  Already done in the code, only the docs were stale: the duplicate `forEachLineBlock` and the kit reminders'
  language (`planReminders` rewrites them on `languageChanged` and at launch).
- **Docs** (item 10): stale status, backlog and known issues refreshed (separate entry below). CI run 40681896621
  (`ad pt`) succeeded: both packs carry crossings in the routing manifest.

E2E on the integrated build (main afb07af, NP-e2e): smoke + full 41/43; `map-20` and `map-21` failed on a
`hideKeyboard` with no keyboard up (it shows on some simulators only): made optional, both pass. Not done:
Android for any of this; `map-22` and `ai-09` were not rerun on the integrated build.

### 2026-10-28 — Docs: stale statements refreshed

Status, backlog and known issues checked against the code, the tags and `gh`: the Current state date and E2E
counts (58 flows: 21 smoke, 20 full, 12 nightly, 1 iPad, 4 Android, counted from the flows' tags), the
Canada/Russia and audit rows, backlog items 1 and A (store builds are tagged `v1.1.0-12`…`-23`), the
cross-pack routing note (routes across packs exist since bdc1fae, but need packs with crossings), the CJK known
issue (`INDEX_VERSION` is 2; only side-file imports made earlier are not re-indexed) and the README status
(1.1.0 build 23 is in App Review). CI run 40681896621 succeeded afterwards (`ad` and `pt` carry crossings). Nothing else run.

### 2026-10-28 — Maps: routes across routing packs, stitched at the border

The owner wants real routes between countries (Madrid → Paris) and between US regions, the same to the
person as a route inside one country, with no paid machines (open source, no income). One Valhalla graph for
the planet was proven on the desktop (spike 1: packs as tile subsets of one build route exactly like the whole
graph) but needs a ~17 h, 64–128 GB build a month: shelved. Built instead (`docs/ROUTING_ACROSS_PACKS.md`):

- **Crossings** per pack (`scripts/routing/crossings.py`, step 6c of `build-country.sh`, manifest
  `crossings`, uploaded by the workflow): where a road from motorway to tertiary crosses the pack's border
  (a US region: its states' outline), with the bearing out and the one-way direction. A few KB.
- **Stitching** (`stitch-core.ts`, pure, 9 tests; `routing.ts` `computeRoute`): with no pack covering both
  ends, or an end in another pack's margin, chains of installed packs, a matrix per pack border by border
  (car: motorway…secondary seams only; bike/foot: primary…tertiary), the cheapest sum wins, one route per
  leg, joined into one `Route` (the seam's "arrive"/"depart" folded away). Reroutes recompute only the leg
  to the next crossing (16–18 ms on the simulator). `canRoute` gates guidance.
- `valhalla-defaults.json`: `max_matrix_distance` is where the matrix search gives up, not just a
  straight-line check: 500 km lost a 472 km bike leg; now 2000 km by bike, 1000 km on foot.
- Measured, desktop (Galicia and Portugal built apart vs one graph of both): by car all 8 trips equal the
  true best route (−0.6…0 %); bike and foot equal in 11 of 16 (up to +8 % where the best route crosses on a
  local road the rule leaves out). Simulator, Release, the same packs seeded: Santiago → Porto by car 0.3 s
  (234 km, one route through Valença), on foot 1.7 s; Ourense → Lisboa by car 0.5 s, by bike 1.8 s (533 km).
- E2E `map-19-stitch` (`seeded-stitch`: Andorra cut in two at 1.555°E, each half built apart,
  `scripts/routing/stitch-fixture.sh`, 3.5 MB). Run on simulator NP-routing: map-14, map-17, map-19 pass.
- Not done: a CI run (the published packs have no crossings yet: routes across packs start working after the
  next `country-packages.yml` run; nothing changes before it); map-15 (local catalog download) not rerun;
  Android not tried; ferries (Spain–Morocco, UK–France) aren't crossings yet.
- Merged to main (fast-forward, bdc1fae) after a rebase on the functional review fixes; map-14/17/19 passed
  again on the merged code. Then: the crossings step in `build-country.sh` made never fatal (it has not run
  in CI yet: a failure publishes the pack without crossings instead of losing it).
- CI: a test run (`ad pt`, routing; 40681896621) published both packs with crossings (Portugal 77, as built
  locally; Andorra 7: CG-1 and CG-6 to Spain, CG-2 to France). The full run that followed (40684248282)
  never started a job: since the Canada and Russia map regions a full run has 261 jobs, over GitHub's 256
  per matrix (the monthly run of 2026-11-05 would have failed the same way). The build jobs moved to
  `country-build.yml`, called twice with half the list each, 4 at a time each (8 in all, as before). The full
  run 40691060942 started with them (131 + 130 jobs). Then admin boundaries moved out of the pack builds (Portugal waited 23 min
  for Overpass): `admin-boundaries.yml` refreshes them monthly into a `routing-admins` release (owner's idea:
  a separate workflow, the builds always read the freshest there); a build asks Overpass only for a country
  missing in it (`scripts/routing/admins.sh`, checked locally: cache hit, cached none, miss → Overpass).

### 2026-10-28 — Functional review on the simulator and its fixes (R1–R14)

The owner asked for a functional bug hunt across the app's main flows, in Spanish and English and several
countries. Driven with axe on two iOS 27 sims (Release of 332b8ad, live catalogs): Spain kit in Madrid plus
Israel and Georgia (scripts), and US English with Hawaii (miles, 911). Findings, repro, causes and status:
`docs/FUNCTIONAL_REVIEW_2026-10-28.md`. Fixed by a Sonnet workflow (one agent per area in its own worktree),
reviewed, corrected and re-tested by the lead:

- Assistant: `planRetrieval` keeps the question's words when Apple's router writes a short query in another
  language ("meeting point" for "¿Dónde quedamos…?": `detectLanguage` fell back to Spanish on two words);
  stricter `relevantChunks`; health caution rule (only the condition asked, no tourniquet, 20 min cool
  water); `sourcesToShow` (no sources on "not found"); readable PDF titles; guardrail errors map to
  `declined` in Swift and JS, with a retry button (`assistant-retry`).
- Maps: SOS lists lead with the 3 nearest hospitals (police/fire in Security); category words search the
  nearest of that kind; map points thinned by zoom below z17; apostrophes optional; cities by their
  English/Spanish names; tile rows keep name slots (`NAME_SEP`, `INDEX_VERSION` 2: one re-index per map
  after the update, ~5 min for Spain on the sim) and show the app-language name with the native one under
  it; duplicate rows from diacritic variants merged. Lead's fix: the agent's dedupe was O(n²) with regex
  keys and made "farmacia" take 9 s (now ~1.6 s).
- UI: country aliases (`region-terms.ts`), guides not "ready" while downloading, plan form sheets without
  `automaticallyAdjustKeyboardInsets` (it opened them scrolled under the native header), storage total
  shared by Home and Settings and formatted in the current language, onboarding region picked from a late
  fix after a location timeout.
- Partial: R3 (old manuals still in the library), R6 (pack POIs and streets: native names only until
  `places.tsv` has es/en columns). Open: R13 (dark-mode invert on freeCodeCamp's dark header).
- Follow-up the same day: R3, a chunk whose title shares no root with a 4+ term question or query needs
  one more term (the router's "quemadura aceite hirviendo tratamiento" let the urushiol article in); R13,
  the dark-mode CSS no longer re-inverts SVG images (freeCodeCamp's white header logo stayed white on its
  inverted bar). Both checked on the simulator. R6, pack side files: places.py and streets.py append
  name:es and name:en columns (older apps read only the first columns, checked in `import-core.ts`'s SQL)
  and the import builds the NAME_SEP slots from them (`packNames`); checked with real Jerusalem files
  through the import, not yet in a published pack.
- Checks: tsc, lint, unit tests, i18n; E2E smoke 21/21 on e27cbe4 (iOS 27 simulator, 2026-10-28).

### 2026-10-28 — Units: miles/feet and gallons for the US, US English copy

Asked by the owner after the store screenshots in New York showed "3.1 km" and "10 m". Distances and water
now follow the device region (`expo-localization` `measurementSystem`, read once; iOS restarts apps when the
region changes), not the app language, so a Spanish speaker in Texas reads miles:

- `lib/units.ts` `scaleDistance` / `scaleWater` (pure, tested): m/km; ft below 0.1 mi then mi in the US;
  yd then mi in the UK (Apple Maps does the same); short distances round to 10 of their unit (1 for a
  GPS accuracy). US water in gallons with one decimal ("3.2 gal"); litres elsewhere, including the UK.
- `lib/format.ts` `formatDistance(meters, step?)` / `formatWater(liters)` add the app language's number
  format. They replace `maps/labels.ts` `formatDistance(meters, language)`: emergency list, search rows,
  place card, route steps, guidance panel. The GPS accuracy ("± 10 m" on Emergencias, in the guidance note
  and in the shared position message) goes through it too, so `maps:guidance.accuracy` and
  `maps:emergency.shareMessage` take a formatted `{{distance}}`/`{{accuracy}}`; `prepare:kit.quantity.water`
  is gone (the kit screen and the checklist rows call `formatWater`).
- Valhalla still answers in kilometres (`routing-core` reads metres); its verbal texts with distances are not
  shown, so nothing else changes. E2E runs in es_ES (metric): no flow changed.
- English copy switched to US English: color, center, theater, neighborhood, flashlight, canned food, trash
  bags, diapers, pediatrician, canceled, cellular data. OSM keys (`theatre`, `sports_centre`…) stay.
- Checked on the iOS 27 simulator in en_US with the US Northeast kit in New York (Release build).

### 2026-10-28 — Assistant: the PDFs inside archives (document index) and the family plan as sources

Asked by the owner ("¿tendría sentido hacer RAG de la documentación disponible?"). The assistant already
did RAG over libzim's full-text search, but that index covers HTML only: the guides that are collections of
PDFs (zimgit medicine/water/food/post-disaster/knots, FAS military medicine, a few in scoutwiki and the CDC
archive) were invisible. Measured on the six English guides: ~25k pages, ~37 M characters, ~2,500 scanned
pages without a text layer (among them the *Special Forces Medical Handbook* and *Bandaging and Splinting*).
- **Document index** (`library/documents.ts` + pure `documents-core.ts`; native `listEntries` and
  `getPdfText` in `modules/nomad-zim`: PDFKit on iOS, PdfBox-Android 2.0.27.0 on Android, credited in
  Settings › Credits with Liberation Sans): each archive's PDFs are read once in the background after a
  download or import (and at startup for what is missing), cleaned and cut into ~650-char passages that
  never span pages, into `doc_passages` (FTS5, porter) in `search.db` (`INDEX_MIGRATIONS` v2). One
  transaction per document through the index file's write queue, now shared with maps (`indexWrite` in
  `src/db`). iOS simulator (US kit of the store screenshots: 11 archives, 13 GB Wikipedia mini included):
  179 PDFs, 67,858 passages, 65 MB, ~80 s; Android emulator: water 7 documents in 2 s, military medicine 24
  in 17 s. Wikipedia-size archives are scanned for PDFs only up to 50,000 entries, in path order (cluster
  order sorted all of Wikipedia's entries first: 13 s for nothing).
- **Retrieval**: up to 8 passages per question join the article chunks in the same BM25 ranking, found as
  all the words of the first keyword query fused with any word of any query (the libzim-style narrowing
  never tried "bleeding wound" for "heavy bleeding wound"); duplicate passages (the same guide in two
  archives) dropped. A source is one page: the chip reads "First Aid · p. 52" ("pág." in Spanish) and opens
  the document with its name (at page 1: WKWebView's PDF view ignores `#page=`).
- **Family plan** (`prepare/passages.ts`): meeting points, contacts, each person's medication/allergies/blood
  type, numbers and home notes are passages too (source `prepare:plan`, the chip opens the plan). Apple's
  router took "Where do we meet if we can't reach each other?" for small talk until its instructions (and
  the tool rules for GGUF) named the plan, with two examples.
- Before/after on the same simulator (offline harness mirroring `retrieve()`, libzim through python-libzim):
  "How do I treat diarrhea in a child?" had *Health effects of wine* and a CDC page on international adoption
  as sources, now *Where There Is No Doctor* pp. 199–205; "How do I splint a broken leg?" had *Splints* (a
  horse ailment), now *Hospital Corpsman* p. 48–49 and FM 21-76; "How much bleach per gallon?" had a sourdough
  recipe, now *Purifying Water During an Emergency* and *Water Treatment*. Apple Intelligence answers to 12
  practical questions and 6 plan questions checked by hand (all grounded; the plan ones exact), plus Qwen 0.8B
  on Android (malaria, cited from the pocket guide's pages).
- Not done / follow-ups (backlog item 7): OCR of scanned pages (Vision on iOS; Android has no on-device OCR
  without ML Kit); opening a PDF at the cited page (needs a native PDFKit view); Spanish questions don't
  reach the English-only guides (Spanish kits don't install them, but a bilingual user's would); old military
  manuals carry dated advice (a 1980s snake-bite tourniquet) that the assistant now repeats with a citation.
- Checks: tsc, lint, 319 unit tests, i18n, licences. Not run: E2E suites.

### 2026-10-28 — Store: 1.1.0 (build 23) submitted to App Review

1.0.1 sat in "Unresolved Issues" after App Review's 2.1(b) questions (business model) and the owner's reply on
2026-10-27; forum reports say a Resolution Center reply alone leaves such a submission out of the queue for days
or weeks. The owner chose to resubmit as 1.1.0 once build 23 (English retrieval) was ready. On the same version
record, through the App Store Connect API: version 1.1.0, the approved texts in es-ES/es-MX/en-US/en-GB (no
"What's new": the app's first release), name "Nomad Pocket: Kit Offline" / "Offline Kit" with its subtitles,
review notes plus the four 2.1(b) answers, the 60 new screenshots, build 23. Then "Actualizar revisión" and
"Volver a enviar a revisión de apps" in the web UI (the API refuses an unresolved submission): state
WAITING_FOR_REVIEW, auto-release after approval. Still open from the screenshots: metric-only distances for
US users.

### 2026-10-27 — Store: 1.1.0 listing approved, new screenshots

App Store Connect showed 1.0.1 (build 3) rejected since 2026-10-24 (App Review didn't understand the
monetization; the owner replied in the Resolution Center). Plan agreed with the owner: wait for that answer
(fastest path to production), then submit 1.1.0 with the latest build. Meanwhile:
- **Listing** (`docs/store/listing-1.1.0.md`), approved by the owner: aimed at the internet going down
  (blackouts, cyberattacks, infrastructure failures). New name "Nomad Pocket: Kit Offline" / "Offline Kit",
  subtitle "Supervivencia sin internet" / "Survival with no internet"; promotional text, description,
  keywords per locale, what's new and App Review notes that start with the monetization (free, no
  purchases, ads, accounts or server of its own). No real events named, no third-party trademarks in
  keywords. "Pocket" stays in the name (a bare "NOMAD" would read as the official Project N.O.M.A.D. app).
- **Screenshots** regenerated (backlog A): iPhone 6.9" es/en (8 each) and iPad 13" es/en (7 each), the
  Spanish ones in Madrid, the English ones in New York; captions in the same crisis tone
  (`scripts/store-screenshots.py`), OSM credit under the map shots. Recipe in `docs/RELEASE.md`.
- **E2E on build 21**: full suite 39/40 then 40/40 (map-15 lost a tap on "Ir a estas coordenadas", passed
  alone), iPad tour 1/1 (a first run caught the reader before its page painted; passed on a rerun).
- What the screenshots turned up went to the backlog; the neighbourhood, first-aid, greeting, Spanish
  retrieval and empty-box items were fixed by another session in c03c0cc / c7cf754 (build 22).

### 2026-10-28 — Release: 1.1.0 build 23 to TestFlight

Build 23 = build 22 plus the assistant's retrieval in English and no small talk in answers with sources
(6db8a3a), for the 1.1.0 App Store submission (the screenshots session prepares it). Smoke E2E 21/21 on an
iOS 27 simulator with that code; archived from the clean worktree `e2e-21` at the release commit, tagged
`v1.1.0-23`.

### 2026-10-28 — Assistant: retrieval in English (router language, noise words, exact titles)

Reported by the screenshots session (en-US, US Northeast kit: English Wikipedia complete (compact) +
10 guides, Apple Intelligence): water without boiling → "I couldn't find this in your library",
hypothermia → "Una cepa de Salmonella…", wet fire → a Billboard chart, minor burn → Mecca Ointment.
Reproduced offline with a harness (libzim over that simulator's ZIMs, the same pipeline as `rag.ts`)
and in the app with a temporary log of the router's decision. Causes and fixes:
- **Apple's router wrote the query in Spanish** ("purificación de agua sin hervir" for an English
  question): `ROUTER_INSTRUCTIONS` only had Spanish examples. Now it says to keep the message's language,
  with English examples, and `retrieve` ignores a model query in another language than the question.
- **English noise words** were not stopwords ("without", "everything", "start", "minor", "safe", "stop",
  "long"…), so libzim's all-words query hit song lists and the broad single-word query was "without" or
  "everything". Facets ("signs", "treat") are never searched alone; "first aid" / "primeros auxilios" stay
  one keyword.
- **Exact-title lookup** replaces c7cf754's title-index lookup (which turned "signs" into the film
  *Signs*): `buildTitleCandidates` gives survival topics (water treatment → Water purification, Portable
  water purification, Solar water disinfection, Potabilización del agua; fire → Fire making, Hacer fuego;
  signalling → Distress signal, SOS), then runs of 2–3 topic words, then compounds and the head word
  (alternatives: "Burn" before "Burns", "Bleeding" for "heavy bleeding"). Found by path (redirects
  resolved), ranked first and weighted ×2.5 when ranking chunks. Full-text search over a whole Wikipedia
  doesn't even return "Burn" for "burn".
- **Small talk in answers with sources**: the tone lines about jokes and talking about itself are only
  in chat mode now (a burn answer said "I like how my little corner of Nomad Pocket…").

In the app (iOS 27 simulator, Apple Intelligence): water → chemical disinfection, filtration, SODIS and
portable purifiers citing Water purification, Portable water purification, Solar water disinfection and
CDC; hypothermia → signs and what to do from Hypothermia and CDC; minor burn → First aid, Burn, First aid
kit (twice, no filler); wet fire → Fire making. Spanish checked in the harness with Wikipedia Médica
(Quemadura + Primeros auxilios, Hipotermia, Hemorragia, Agua potable). Smoke E2E 21/21.

### 2026-10-27 — Release: 1.1.0 build 22 to TestFlight

Build 22 = build 21 plus the right neighbourhood on map search results (c03c0cc) and the fixes seen
while making the store screenshots (c7cf754): first aid in the app's language, the assistant without a
greeting on every answer and finding articles named after the question, no empty image boxes in
Wikipedia Médica. Smoke E2E 21/21 on an iOS 27 simulator at c7cf754 (worktree `e2e-21`); archived from
a clean worktree of the release commit, tagged `v1.1.0-22`. The main checkout's `ios/` predates the
dictation dependency (a Release build from it crashes on launch: `ExpoSpeechRecognition` missing):
`npx expo prebuild --platform ios` there before building from it.

### 2026-10-27 — Fixes from the store screenshots: first aid in Spanish, assistant, empty image boxes

The other three items seen while making the 1.1.0 screenshots (backlog), checked on an iOS 27
simulator with the Spain kit and Apple Intelligence (Release):
- **First aid** (Home): the quick action tried a fixed list that began with the medical library
  (English PDFs). Archives in the app's language come first now, and Wikipedia Médica opens at its
  "Primeros auxilios" article; English keeps the medical library first.
- **Assistant greeting**: the tone line said "saluda, responde a las gracias…", and Apple
  Intelligence opened every answer with "Hola, ¿qué tal? Muchas gracias por la pregunta". It now
  greets only when greeted and goes straight to the answer otherwise (both languages, tools tone too).
- **"¿Cómo potabilizo agua sin hervirla?"** got municipal residual-chlorine levels: full-text ranking
  puts titles that repeat a word ("Planta Potabilizadora de …") above the article about the process.
  Retrieval now also asks each archive's title index (`buildTitleQueries`: the first two queries with
  "-izar/-ificar" verbs as their "-ción" noun) and ranks those articles first; the light stemmer joins
  "potabilizo" with "potabilización". The answer now covers chlorine, ozone and UV disinfection; a
  burn question cites the "Quemadura" article.
- **Wikipedia Médica's empty image boxes**: mwoffliner's nopic editions keep each image as a transparent
  SVG (`alt-text-clip`) of its size in its bordered frame. The reader (iOS user script, Android
  injected style) always hides those placeholders, the figures/thumbs holding only them and template
  table cells whose only child is such a figure. Selectors match only that placeholder, so archives
  with pictures are untouched. Android not run yet.

### 2026-10-27 — Maps: a search result's neighbourhood is the nearest one again

The owner saw Calle de Alcalá as "· Nudo Sur" and Hospital Gregorio Marañón as "· Entrevías /
Palomeras Bajas". `localityNear` took 400 localities of a 15 km box with no ORDER BY and picked the
nearest among them, but Madrid's box holds ~1,000: SQLite walks the `lat` index, so the 400 were the
box's southern band. Now the nearest is chosen in SQL (equirectangular distance, `ORDER BY … LIMIT 1`),
first in a 2 km box (~5 ms on a Mac against the whole of Spain's index) and only then in the 15 km
one; a hit counts only within the box's radius. Checked on a copy of a simulator's `search.db` for
Spain: Alcalá 219 → Fuente del Berro, the hospital → Ibiza (Retiro). Not yet looked at in the app.

### 2026-10-27 — Release: 1.1.0 build 21 to TestFlight (photo library purpose string)

App Store Connect answered build 20 with ITMS-90683: the binary references photo library APIs
without `NSPhotoLibraryUsageDescription`. Not the dictation: `expo-image`
(`Loaders/PhotoLibraryAssetLoader.swift`, `ph://` URIs) and `expo-file-system`'s legacy module
(`FileSystemHelpers.swift`, `copyPHAsset`) `import Photos` and are always compiled in. The app never
asks for the photo library, so the string (`app.json` + `locales/{es,en}.json`) says exactly that; it
is never shown and the privacy policy stays true. Build 21 = build 20 plus that key; no JS or native
code change, so no E2E run (build 20's smoke was 21/21). Archived from a clean worktree of the release
commit, tagged `v1.1.0-21`. Also: the main checkout's `node_modules` lacked `expo-speech-recognition`
(build 20 came from the dictation worktree); `npm install` there before building from it.

### 2026-10-27 — Release: 1.1.0 build 20 to TestFlight

Build 20 = build 19 plus dictation in the assistant, the most capable installed model as the
default, answers that keep going while another chat is open, the reworked navigation view (session
"5-navegacion", d27bd7e) and Canada and Russia as regional maps (3c75852): until now builds 16–19
showed those regions by their raw ids and without routes. One build for everyone after asking the
other sessions working on the repo. Smoke E2E 21/21 on an iOS 27 simulator (lib-02 and x-01 first failed because a fresh worktree lacks the gitignored ZIM fixtures: copy them from the main checkout; ai-08 passes too; Maestro needs Bash outside the sandbox); archived from the clean
worktree `.claude/worktrees/dictation` at the release commit, tagged `v1.1.0-20`. To check on the
owner's iPhone: ~~dictation~~ (works, owner 2026-10-28) and the navigation view.

### 2026-10-27 — Assistant: dictate questions with the phone's own speech recognition

Owner: a microphone in the AI chat that transcribes with the native dictation, not with an AI model
of ours. `expo-speech-recognition` 58 with `requiresOnDeviceRecognition`: the audio never leaves the
phone. The button (`composer-mic`) only appears where that holds: iOS checks the locale with a new
`nomad-llm` function, `supportsOnDeviceDictation` (on a locale without on-device support iOS would
quietly use Apple's servers, and the library only checks the phone's own locale); Android needs 13+
and offers the system's language-pack download when it's missing. Only the microphone permission is
asked (on-device needs no speech permission: checked, iOS shows just the microphone prompt with our
text). The spoken text goes after what was typed, live; it stops after a pause, on a second tap, when
the person types, sends or leaves the app, and is never sent by itself. Privacy policy (es + en) has
a "Micrófono y dictado" section; InfoPlist strings in `locales/`. Built in the worktree
`.claude/worktrees/dictation`.

- Checked: iOS 27 simulator (Release): the button shows for es-ES, the permission prompt, the
  listening state ("Te escucho…", red button). Android 16 emulator (Release): the button shows, the
  RECORD_AUDIO prompt.
- Not checked: the transcription itself. On this Mac both the iOS simulator (CoreAudio "RPC timeout.
  Apparently deadlocked", a known simulator AVAudioEngine input bug) and the Android emulator (host
  audio, QEMU hung) die as soon as they open the microphone. `ai-08-dictation` only checks the button
  is there. **Checked on the owner's iPhone (2026-10-28): transcription works.** Still pending on a
  real Android phone.

### 2026-10-27 — Maps: a navigation view that reads like Google Maps'

- Owner found the navigation view hard to read: the route never got consumed, the map turned
  before corners (bearing from the route 30 m ahead) and with the phone on foot (GPS course
  ignored under 2 m/s), and the arrow sat on the raw fix. Analysis, research (Google Maps / Waze,
  Mapbox's vanishing route line and following camera) and plan in `docs/NAVIGATION_VIEW_PLAN.md`.
  Owner decisions: travelled part disappears like Google's; standing on foot the map holds (beam
  under the arrow); "Norte arriba" ships now.
- Built: direction of travel from the last 8/12/15 m of fixes (`travelBearing`); the road's
  direction right at the snapped point (`RouteProgress.roadBearing`, replaces `aheadBearing`);
  bearing smoothing and wrong-way rerouting; a camera that glides to where the user will be at the
  next fix, on the route; zoom in before maneuvers, flatter pitch on foot; the route line starts
  at the user; grey arrow on a rough fix or no fixes while moving; compass beam under the arrow
  on foot/bike; `map-north-up` toggle (persisted `navNorthUp`).
- Checked: tsc, lint, unit tests (new follow-core and routing-core cases), i18n; `map-17-follow`
  passes on the iOS 27 simulator (Release), now also pressing "Norte arriba". Seen in its
  screenshots: the line starts under the arrow; north up turns the arrow, not the map.
- Next: a walk and a drive on the owner's iPhone (simulated fixes are perfect), and the Android
  emulator with a route playback.

### 2026-10-27 — Maps: Canada and Russia by regions for the map, one routing pack for the country

Canada and Russia were the last maps below z15: whole at z15 they are 16 and 13 GB, over the
10 GB cap, so the script took z14 (8.4 and 6.9 GB). Measured every province and federal district
with pmtiles dry runs (build 20261026) and proposed two splits; the owner took option B: each
region is its own z15 map, the routing pack and its side files stay whole for the country and
come with the first region. Routes between regions keep working (Moscow–Saint Petersburg,
Toronto–Montreal), unlike the USA, whose national pack would be ~21 GB. Regions: Canada
`ca-bc-yukon` 2.2, `ca-prairies` 1.9, `ca-ontario` 2.0, `ca-quebec` 2.5, `ca-atlantic` 1.0,
`ca-nwt` 1.6, `ca-nunavut` 4.8 GB; Russia `ru-central` 1.9, `ru-northwest` 2.4, `ru-south` 1.1
(North Caucasus and Crimea, which Natural Earth puts in Russia, inside it with no name of its own:
owner's call), `ru-volga` 2.1, `ru-ural` 1.3, `ru-siberia` 2.4, `ru-far-east` 2.1 GB. A typical
download goes from 11–12 GB at z14 to ~4.4 GB (Toronto) or ~6.5 GB (Moscow) at z15.

- CI: `scripts/maps/map-regions.json` lists them; `build-country-map.sh` cuts a region by the union
  of its Geofabrik polygons (`region-outline.py` now takes several and writes the outline's 1° cells
  into the map's catalog entry); the workflow builds the country's pack in its own job and one map
  job per region; `maps-manifest.py carry` keeps them. `ru-south` and `us-hawaii` built locally end
  to end (USA unchanged: Hawaii 32 MB at z15, as published).
- App: `countryWidePacks` (country-core, tested) and `CountryOffer.common`: the national pack comes
  with any region and goes with the last; `partAt` uses the map's outline cells (Ottawa is in both
  Ontario's and Quebec's bboxes); the region list explains what comes with the first region, the
  straight-line note is hidden for these countries; region names in es and en. Checked on the iOS
  simulator (Release) against a local catalog: Ontario ticked from Toronto in the onboarding kit,
  map + national pack downloaded, Quebec then costs only its map, deleting the last region removes
  the pack too.
- Future: the owner wants routes across packs (US regions, countries). `docs/ROUTING_ACROSS_PACKS.md`
  explains why today's packs can't be joined on the phone (separate Valhalla builds, ids don't
  match at the seams) and proposes one graph cut into tile subsets, with a spike to measure it.

### 2026-10-27 — Release: 1.1.0 build 19 to TestFlight

Build 19 = build 18 plus document collections as a native list (PDFs open in the system viewer on
Android), the map's legend and switches for the emergency dots, the red "SOS" button, the bundled
world map renamed, the toast without the springy fade and no empty band at the end of scrolling
screens. Smoke E2E 21/21 on an iOS 27 simulator; archived from a clean worktree of the release
commit, tagged `v1.1.0-19`. prep-01 broke with the shorter bottom padding: Maestro's `hideKeyboard`
gesture (the simulator shows no on-screen keyboard) landed on "Añadir número" and opened its sheet;
the flow now taps the "Notas de casa" title instead. map-14 failed once in the full run, on a screen
from another flow (the assistant), and passed alone.
Android tour 4/4 with the same commit's APK (versionCode 19, VPN off so download.kiwix.org is
reachable): android-01 passes with the "N de M" find-bar check. android-04 and -05 first hit an ANR
on launch while another session booted a second emulator (Mac load average ~50) and passed rerun.

### 2026-10-27 — Assistant: an answer keeps going when you open another conversation

Owner: asking something and opening another chat cancelled the answer. Now `openSession` no longer
stops it: the answer is stored in its own conversation (which `answer()` already did), its error
only shows there, the other conversations show a "Respondiendo en otra conversación · Ver" bar and
can type but not send until it ends (one engine at a time), and the conversations sheet marks it
"Respondiendo…". Leaving the app still ends it (iOS suspends the app and forbids GPU work in the
background). Checked on the iOS 27 simulator (Release) with Qwen3.5 4B: bar, "Respondiendo…" in the
sheet, the answer still streaming when reopened and stored complete while another chat was open.

### 2026-10-27 — Assistant: a newly installed model becomes the default when it's more capable

Owner: installing a better model should make it the default; a model the user picks stays as
their choice. Each model has a `rank` (Qwen3.5 0.8B < 2B < Apple FM = Gemma 4 E2B < Qwen3.5 4B):
Apple's ~3B 2-bit on-device model is ahead of Qwen3.5 2B but behind 4B in reasoning, Spanish
and tool use, and its guardrails refuse some medical questions. A finished download switches the
active model only when it outranks the current one (or nothing usable is selected), so on an
iPhone with Apple Intelligence the setup kit's Qwen3.5 4B now takes over from the system model,
while a smaller model downloaded later waits to be picked. Removing the active model, or finding
its file gone at startup, now falls back to the best one left instead of "no model". Checked on the
iOS 27 simulator: with Apple Intelligence active, seeding Qwen3.5 0.8B and 4B made 4B the active one.

### 2026-10-27 — Maps: a legend for the dots, switches to hide them, and a red "SOS" button

Owner: in a city the map is a cloud of coloured dots nobody can read, and the siren button
didn't read as "emergency". A new map button (three coloured dots, grey when they're hidden)
opens the Puntos sheet: what each colour is (category + the kinds in it), a switch for the whole
layer and one per category, persisted in settings. Security was the same blue as water (and as the
user's dot): now purple. The Emergencias button is a red disc with "SOS". Found while testing: the
layer's query stops at 600 points with health first, so in central Madrid supermarkets never
showed; hidden categories are left out in SQL, before the limit, so hiding Salud brings them in.
Checked on the iOS simulator (Madrid, light and dark).

### 2026-10-27 — Library: document collections as a native list; PDFs on Android; no more "home" title

Owner: the Medical Library opened on a desktop web page (huge PDF cards, its own search box, a
"home" title). The zimgit-* archives (medicine, water, food preparation, knots, post-disaster) are
built by Kiwix's nautilus scraper: their main page is a Bootstrap app around `database.js`. The
reader now parses that file (`library/collection.ts`, tested) and shows a native list instead:
search on title/author/description, author and description per document, multi-file documents
expand; a document opens as a reader route titled with its name. Android's WebView can't show PDFs
(a tapped PDF stayed blank): PDF entries, from the list, links or a search/history route, are copied
to the cache and opened in the system viewer (`ZimExternalOpen`, own FileProvider), with an alert
when no app can. The "home" title came from libzim using the path as the title of an untitled
entry; native now reports the page's `<title>` then (both platforms).
Checked with zimgit-water (same format as the medical library) in Release builds: iOS 27 simulator
(list, search, light/dark, a PDF in the reader titled with the document's name, "Página principal"
back to the list) and the Android emulator (list; the PDF opened in Drive's viewer, back returns to the
list). Not checked: a device without any PDF viewer (the alert), multi-file documents (no zimgit
archive in the catalog has one), the medical archive itself on a phone. The Android `android/` folder
was regenerated with `prebuild --clean` (it was still at versionCode 12).

### 2026-10-27 — UI: no more empty band at the end of scrolling screens

Owner: Inicio and Biblioteca ended ~180 pt above the tab bar, which looked like a bug. `<Screen>`
padded the bottom with `insets.bottom + 96`, but inside native tabs the screen already ends above
the tab bar and iOS still reports the bar in `insets.bottom` (83 pt measured; Android reports only
the 24 dp gesture bar and also ends above its bottom nav), so the bar was counted twice plus 96.
Now `space.xxxl` (32), plus `insets.bottom` on Android only (modals draw under the gesture bar);
outside tabs iOS' automatic content inset clears the home indicator. Explorar todo Kiwix (120 →
32) and Credits › packages (120 → 48) lists too. Checked on the iOS 27 simulator (Inicio,
Biblioteca, Ajustes modal) and the Android emulator (Inicio), Release builds.

### 2026-10-27 — Maps: the bundled world map is called "Mapa básico del mundo"

Owner: "Mapa del mundo · Viene con la app" made people wonder why each country is a separate
download. The bundled z0–5 map is now "Mapa básico del mundo" / "Basic world map" (Tus mapas row
and item title), its row says it has no streets, and the Maps empty card says you are seeing a basic
world map until you download your country. READMEs and MAP-01 updated. The stored item title of
existing installs keeps the old name, but the world item is not listed anywhere else (Settings
skips it), so nothing visible keeps it. Not looked at on a device yet.

### 2026-10-27 — Toast: the confirmation pill no longer flickers as it bounces in

Owner: the "listo para usar sin conexión" pill bounced in fine but its opacity changed with each
bounce. `FadeInUp.springify()` springs the opacity too, so it overshot and dipped below 1. The pill
now slides down from just above the screen with the same spring (`damping: 18`), fully opaque the
whole time; the exit (FadeOutUp, 200 ms) is unchanged. Not looked at on a device yet: check it in
the next release build.

### 2026-10-27 — Maps: a country's search and points are prepared as the end of its download

Owner, after downloading Spain: opening map search froze for 1–2 s, then said "Preparando la búsqueda
en España" for ~10 s; asked for every deferred step to happen with the download, visibly.
- Found deferred: the detail index around the view (z15 over 50 km, run when search opened and
  again whenever the view moved 10 km) and, silently after the download, the tile index and the
  side-file imports (~2 min of JS on an iPhone 14 Pro: points 7 s, streets 40, places 20, doors 50).
  The freeze: all of it on the JS thread, plus `DELETE … WHERE source = ?` on the FTS table (reads
  the whole table) run synchronously.
- Detail index skipped for maps whose country brings search files (`searchFilesCover`): the files
  hold every named place and street. Such maps (`bundledSearch`, set at install) index their tiles
  at z10 at most (Spain: 9k rows instead of a z12 pass) for islands, regions and towns.
- Imports in SQLite (`import-core.ts`): each 1 MB block goes in as one JSON string and `json_each`
  does the parsing and inserts on the background connection; JS keeps `nameKey`/`houseNumberKey`
  per distinct value and `indexText` for possible CJK rows. Same rows as the old parsers (unit tests,
  and Spain's full files compared in node). Not native: no Swift/Kotlin, no second SQLite copy.
  Tile indexing decodes 12 ms slices and inserts as JSON; every bulk delete is async.
- "Preparando" (`prepare.ts`): tasks per item (tiles, each import, Overpass points), weighted by
  size; the country shows "Preparando búsqueda y puntos… %" in Tus mapas, Home (card and readiness),
  Downloads, the onboarding badge and the search sheet; ready and the "listo" toast only after it.
- Simulator (Release, Spain from GitHub): imports points 2.9 s, streets 9.2, places 5.5, doors 13.1;
  search opened during them with no wait; "Calle Alcala 50" → "Calle de Alcalá, 50 · Portal
  aproximado". Smoke E2E 21/21. Android tour 3/4: Andorra's download, imports, search and
  Emergencias (android-03) and routing (android-05) pass; android-01 failed on the reader's find bar
  showing "2 de 26" where the flow expects "1 de N" (unrelated, the assertion is too strict). Shipped
  in build 18; the owner tried it on their iPhone: "se comporta muy bien".
- Android emulator (Release APK from a clean worktree; Spain doesn't fit its 3.4 GB free, so Belgium,
  1.5 GB with 164 MB of doors): imports points 1.7 s, streets 4.6, places 7.9, doors 39.2; search
  answered during them ("Preparando la búsqueda en Bélgica… 90 %" above the results), "Rue de la Loi
  16" → "Rue de la Loi, 16", and the country row turned "Mapa y navegación" when it ended. A first try
  was spoiled by another session installing an old APK (versionCode 12) on the same emulator
  mid-import: its doors took 102 s, the old row-by-row path.
- android-01-tour's find bar step now takes any "N de M" and checks that "Siguiente" changes it
  (Android's WebView can land on the 2nd match while typing). Checked on iOS with the same steps
  ("1 de 8" → "2 de 8"; the control without a tap fails). Not rerun on Android: that afternoon the
  Mac's network sent download.kiwix.org through a TLS-inspecting proxy the emulator doesn't trust
  ("Trust anchor for certification path not found"), so the flow's 1 MB archive can't download.

### 2026-10-27 — Release: 1.1.0 build 18 to TestFlight (build 17 withdrawn)

Build 18 = the download tuning (below) and a country's search and emergency points prepared as the
end of its download (log entry above) on top of build 16. Smoke E2E 21/21 on an iOS 27 simulator;
tagged `v1.1.0-18`. Build 17 was archived from the main checkout while another session was
editing map search there: its JS bundle holds that half-done work (a `BATCH_TILES` with no
definition, found by grepping the intermediate `main.jsbundle`). Build 18 was archived from a
clean worktree of the release commit (the map-search session uploaded it once its work was
committed; the commit that first said "build 18" had not uploaded it); RELEASE.md says to archive
only from such a tree. Android check of the shared download and map-search changes is next.

### 2026-10-27 — Downloads tuned on a real iPhone: the setup kit in ~6:30 instead of 13 min

Seven runs of the same setup kit (Spain's map + 12 guides + Wikipedia es nopic + Qwen3.5 2B,
20.7 GB) on the owner's iPhone 14 Pro, next to a ~530 Mb/s Wi-Fi, each from a fresh install of a
Release build (`xcodebuild` + `devicectl`), reading `[dltrace]` timing lines (new
`downloads/trace.ts`) from `idevicesyslog`. Build 16 took 13:04 (Wikipedia at 18.8 MB/s, 40 % of
the line); now ~6:20–6:40 with the app open, the map ready in ~1:45, Wikipedia at 55 MB/s, ~90 %
of the line. Measurements and findings: `docs/DOWNLOADS_SPEED_PLAN.md` ("On a real iPhone");
contract: ARCHITECTURE (Downloads). What changed:

- Budget: Wi-Fi 16–32 connections, +4 per trial, kept unless the speed fell (the 15 % rule could
  never pass 14). A window spanning an iOS suspension decides nothing.
- iOS: ranges run in the in-process URLSession while the app is open (the background session held
  ranges at 0 % for minutes and topped out lower); the background reserve is queued on `inactive`
  (created in the background it was discretionary and got nothing); back in the foreground,
  never-started background ranges are dropped without blaming their mirror.
- Stall watchdog: a range with no byte for 15 s is fetched again. Sources under 25 % of the best
  get no ranges (was 10 %). Up to 2 GiB may wait behind the head range (was 1).
- CDN first: a Kiwix archive ≥ 1 GB waits while GitHub / Hugging Face files have ≥ 300 MB to go:
  each of those hosts is one HTTP/2 connection and lost to 20 connections to the mirrors (the map
  came last). 12 connections per CDN host (was 6).
- The whole-file sha-256 is skipped when every metalink piece was checked in the run (10 s at the
  end of a 13 GB file).

Also seen: processing is not the bottleneck (map assembly 4–7 s, search imports ~2 min that now
run under Wikipedia's download). In the background iOS lets the reserve finish (~1 GB in 2 min)
but nothing new starts until the app is back. Android not run yet (next).

### 2026-10-27 — Onboarding: the country's map no longer drops out when a catalog fetch fails

A fresh install has no cached maps/routing catalog, so one failed request (seen once in a Maestro
run: the network still waking up or a GitHub hiccup) made the kit step say "Ahora no se puede
descargar el mapa" until the app restarted. The catalog fetch now tries 3 times (2 s, 5 s apart)
with a 20 s timeout per try, so a hung request no longer spins forever (`maps/catalog-fetch.ts`).
The kit step retries on arrival if the catalogs still failed, and its "download without the map"
alert gains "Reintentar". Checked with a fake fetch (fails, 503, then succeeds; and gives up
after 3); not run on the simulator.

### 2026-10-27 — Release: 1.1.0 build 16 to TestFlight

Build 16 = the native sha-256 and file copies (`modules/nomad-files`; the app was killed while
"Preparando" a big download, entry below) on top of build 15, plus the USA as regional maps (the
other session's phase 4). Checked on the simulator first: Spain (map 2.29 GB + pack 2.27 GB, two
parts each) downloaded, hashed and assembled with the app at ≤ 704 MB the whole time. Smoke E2E
21/21 on an iOS 27 simulator; tagged `v1.1.0-16`. To verify on the owner's iPhone: build 14 left
Spain in "Preparando"; opening build 16 should finish it without closing.

### 2026-10-27 — Fix: the app was killed while "Preparando" a big download (iOS, memory)

The owner's iPhone 15 Pro (build 14) closed while Spain's map was "Preparando", and again a few
seconds after every launch (the manager resumes `processing`). No crash report: the device log
(`idevicesyslog`, libimobiledevice, over USB without Developer Mode) said "Process NomadPocket
killed by jetsam reason per-process-limit". Cause: expo-file-system 58's `File.digest`, used for
the sha-256 check since build 13, reads 64 KB blocks in one native loop with no
`autoreleasepool`, so it holds the whole file: a Swift copy of its loop peaked at 2064 MB on a
2 GB file (7 MB with a pool per block). A 13 GB Wikipedia would die the same way. New local module
`modules/nomad-files` (Swift + Kotlin): `sha256` and `copyInto` (copy at an offset, optional
sha-1 pieces), 4 MiB blocks, one pool each. The manager's check, the segmented engine's appends
and the country map / routing pack assembly use it; `expo-crypto` is gone. Per-call
`readBytes` from Expo's queues doesn't accumulate (measured 14 MB), but the copies no longer cross
into JS at all. Getting logs from a TestFlight install: `brew install libimobiledevice`, then
`idevicecrashreport -k` and `idevicesyslog` (`docs/DEVELOPMENT.md`).

### 2026-10-27 — Release: 1.1.0 build 15 to TestFlight

Build 15 = many downloads at once (up to 6, ≤ 2 per GitHub/Hugging Face host, mirror speeds
remembered, segmented from 16 MB) on top of build 14, plus what landed on `main` meanwhile: the
map asks for the location and starts on the user, USA routing packs (data). Smoke E2E 21/21 on an
iOS 27 simulator; tagged `v1.1.0-15`.

### 2026-10-27 — Downloads: many files at once (a kit no longer waits behind a country map)

The owner's phone (build 14) showed the setup kit running 2 files at a time: Spain's GitHub
parts and one archive filled the connection budget, and "start another file on spare
connections" never fired. Now up to 6 files run at once (2 on mobile data), ≤ 2 choosing their
sources and ≤ 2 from one single-host source (`hostHasRoom`), sharing the budget fairly;
segmented from 16 MB (was 64); 6 connections per GitHub/Hugging Face host (was 4); Kiwix
mirror speeds remembered for 10 min so small archives start without re-probing. Simulator, the
same kit (Spain + 12 guides): the guides finish in 80 s alongside the map instead of waiting
behind its six files (measurements in `docs/DOWNLOADS_SPEED_PLAN.md`). Also seen: the maps
catalog was briefly unavailable ("Ahora no se puede descargar el mapa") during one run (fixed
later the same day: catalog fetches retry).

### 2026-10-27 — Release: 1.1.0 build 14 to TestFlight

Build 14 = the faster downloads (segmented multi-mirror engine, throughput-ranked mirrors, adaptive
connection budget, per-piece checks, resume after a kill, screen kept on, two-line download rows) on
top of build 13. The privacy policy now says the app measures every Kiwix mirror and downloads from
several at once (es + en, dated 2026-10-27). Smoke E2E 21/21 on an iOS 27 simulator; tagged `v1.1.0-14`.

### 2026-10-26 — Downloads: segmented multi-mirror engine, throughput-ranked mirrors, screen kept on

Built `docs/DOWNLOADS_SPEED_PLAN.md` A, B, C and per-piece checks (contract in ARCHITECTURE,
Downloads; what changed from the plan and the measurements in the plan file):
- `mirrors.ts` `planSources()`: every Kiwix metalink mirror measured by throughput; other URLs
  probed for ranges and exact size. `segmented.ts` + `segments-core.ts` (pure, 17 tests): ranges
  over up to 8 connections (4 on mobile data), ≤ 3 per mirror across all downloads, scores from
  live pace, crawling ranges duplicated, ranges appended in order to `.part` with each metalink
  sha-1 piece checked (`expo-crypto`, new dependency; licences regenerated). Used for Kiwix,
  GitHub (maps, packs) and Hugging Face (models) files ≥ 64 MB.
- `keep-awake.ts`: screen on while something runs or installs and the app is open; a note in
  the Downloads sheet (`downloads-keep-awake`, DL-02). Download rows show the time left on a
  line of its own (the row used to wrap and unwrap as the estimate changed).
- Simulator (iOS 27, Release): Spanish Wikipedia nopic 13.3 GB in 8 min 38 s (~2 h before);
  656 MB killed after 12 s resumed with its finished ranges; Portugal (1.2 GB, GitHub) ~65 s;
  Qwen 0.8B 30.8 MB/s. Android emulator (API 36, release APK): resume after a force-stop and
  pause/resume on Home both work. Found and fixed on the way: iOS relaunches the app in the
  background when orphaned range tasks finish, and a transfer told it was in the background
  before loading crashed the run.
- Adaptive connection budget (`budget-core.ts`, pure, 7 tests), after the owner asked about
  queuing 10 courses on a 300 Mb/s line: one budget for every download, 8 → up to 16 on Wi-Fi
  while +2 connections raise the total speed ≥ 15 % (windows where a file started or ended, or
  right after, don't count: they dip the speed and fooled the first version), 3rd–6th files start on spare
  connections, fair sharing between segmented downloads. On the simulator (link-limited at
  ~30 MB/s) 12 archives (13 GB) queued in two batches all finished, 2 at a time, at 25–31 MB/s
  together; the budget tried 10 and went back to 8, but a build with an 8 % threshold also crept
  up to 16 on noise (+3–7 % per step), hence 15 %. The final version was not re-measured on the
  simulator (the E2E smoke ran on it).
- Not done: real phones; the budget on a line faster than the mirrors.

### 2026-10-26 — Release: 1.1.0 build 13 to TestFlight

Build 13 = the pre-release audit fixes (reader without network, Wi-Fi-only enforced, safer downloads
and storage, Credits & licences, data out of the Files app, re-downloadable data out of backups, OSM credit, guidance
auto-stop, translated permission prompt) and multi-pack countries (the USA). Smoke E2E 21/21 on an
iOS 27 simulator; tagged `v1.1.0-13` (GPL section 6).

### 2026-10-27 — USA in regions: plan; Alaska and Hawaii packs

The whole USA is 31 GB in one download (~60 GB free asked): the owner approved splitting it
into regions that each bring map, routing and side files, with a whole-country shortcut
(`docs/COUNTRY_REGIONS_PLAN.md`). Sizing found that Geofabrik's four US regions leave out
Alaska and Hawaii: `us-alaska` and `us-hawaii` added to packs.json, and the workflow now takes
region ids (`countries="us-alaska us-hawaii"`) so a region builds alone.
Space check: `countryNeed` counted a temp copy for every multi-part archive at once (the USA
asked ~60 GB free for 31 GB); assemblies now run one at a time (`assembly.ts`) and the check
adds the biggest copy only (~39 GB).
CI for regional maps (not run yet: TestFlight builds ≤ 15 would take the first regional map for
the whole USA): a region job builds its map too, cut by `region-outline.py` (Geofabrik `.poly` ∩
the country's Natural Earth polygons); `maps-manifest.py carry` keeps region maps and drops a
whole map once its regions have maps. Measured on build 20261026 at z15: west 4.6, midwest 3.9,
northeast 2.1, south 5.7 GB, Alaska 722 MB, Hawaii 32 MB (built end to end locally). Today's
whole-USA map has no Hawaii: country-region.py keeps islands within 10° of the mainland.
App: a country in regions (`CountryOffer.regions`, from `countryParts` once the catalog has
regional maps) is downloaded region by region. `RegionList` in the country sheet and in the
onboarding kit (whole-country shortcut, the region you are in ticked from a fix ≤ 10 min old,
location asked for there only for such a country), Tus mapas lists the regions and opens the
sheet, `removeCountryRegion` deletes one. Map items and files are keyed by map id (unchanged for
every other country). Simulator, local catalog with six US regions (Hawaii real): picked in the
kit, downloaded (map from the local server, pack from GitHub, 76 MB), listed, deleted. Next: a
TestFlight build, then the USA's maps run (`countries=us parts=maps`), then a real iPhone.
Live: build 16 reads regions; run 40482995938 published the six US regional maps at z15 (west
4.65, midwest 3.93, northeast 2.09, south 5.68 GB, Alaska 0.73 GB, Hawaii 32 MB; parts checked
in their releases) and the catalog dropped the whole-USA z14 map (246 maps). Owner: try a region
on the iPhone with build 16.

### 2026-10-27 — Maps: ask for the location and start on the user

Owner on the iPhone: the Maps tab opened where the map was left (or on the first country),
search measured distances from that centre, and the location prompt only came with "show my
location". Now the first time the map is in front in a session it asks (if undetermined) and
flies to the user, unless they moved the map, opened a place or set a trip meanwhile. Checked on
the simulator (prompt on opening Maps, then the map on the simulated position) and the maps
E2E folder: 13/14; map-04 failed only because that ad-hoc build read the live catalogs (San
Marino now has a pack), not the suite's local ones.

### 2026-10-27 — Routing packs for the whole world published; README coverage

- Runs 40407657017 (am ag fr ioa je rw) and 40417397392 (de, with the dated-extract fallback
  6bca652) published. routing-index: 231 packs (pm dropped, 73cb7af); maps-index: 241 maps,
  238 at z15 and ca/ru/us at z14. Every part and side file checked in its 19 releases (name and
  size). The de and fr maps no longer list side files (their packs bring them).
- No pack, on purpose: us (four regional packs added to packs.json in f3efa4d, run 40426777070;
  build 13+ reads several packs per country), ht (shares do), pm and the uninhabited
  territories atc gs hm io kas pn tf.
- Run 40426777070 published the USA as four packs (235 in routing-index): us-west 4.9 GB,
  us-midwest 5.5 GB, us-northeast 2.8 GB, us-south 7.8 GB (21 GB of routing tiles) plus 2.3 GB of
  side files; the us map (8 GB, z14) no longer lists side files. **The whole USA is ~31 GB in one
  download**: owner decision pending (keep, or let a phone take one region).
- README (en, es): routing everywhere but a few uninhabited territories;
  ca/ru/us maps one zoom lower. Closes DOCS-PUBLIC-1/2 and DOCS-INTERNAL-8.

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
- Published (routing-index, 22:39 UTC): 225 packs = 59 of the first run + 166 of this one
  (africa 56, asia 51, north-america 24, oceania 23, europe 10, south-america 2); every
  part and side file is in its release at the listed size. Biggest: India 4.5 GB, Russia
  3.8, China 3.75, Japan 3.6, Brazil 3.3. Clipped places look right (Saudi Arabia 715 MB,
  Malaysia 682, Singapore 87, Vatican 22). `unshare` left side files only on maps whose
  country has no pack (de, fr, am, rw, us…). Missing: ag am de fr ioa je rw (rerun
  40407657017). Saint-Pierre-et-Miquelon came out empty (20 KB, no roads: Newfoundland's
  extract stops short of it): dropped from `packs.json`, and a build with no road tiles
  now fails instead of publishing.
- Germany failed again in rerun 40407657017: `germany-latest` redirects to a mirror that
  lacks it (404 four times). The download now falls back to Geofabrik's own dated files
  of the last 3 days (`<extract>-YYMMDD.osm.pbf` + .md5); tested with a forced miss.

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
