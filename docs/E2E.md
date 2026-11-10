# E2E functional tests (iOS simulator)

[Maestro](https://maestro.mobile.dev) flows that drive the Release build of the app on an
iOS simulator, the same way a person would: tapping, typing and reading the screen through
accessibility. Every flow names the functional cases it covers (`RDR-03`, `MAP-06`, `PREP-02`…)
on its first line and in the Flow catalog below, which is the list of what is automated;
"Not automated" under the catalog lists the cases that are not, and why.

## Quick start

```bash
npm run e2e:setup        # once per machine: checks tools, creates the simulator, gets fixtures
npm run e2e              # smoke suite (~10 min)
```

After changing app code, add `--build`: the suite runs a compiled Release `.app`, so JS
changes are not picked up until it is rebuilt.

```bash
npm run e2e -- --build
```

The run ends with a summary; exit code 0 means everything passed.

```
▶ rdr-02-search-in-book
  ✓
▶ rdr-03-bookmark
  ✗ (Assertion is false: "Aún no has guardado nada" is visible)
…
14 passed, 1 failed — e2e/artifacts/20261024-135832
  ✗ rdr-03-bookmark  (Assertion is false: "Aún no has guardado nada" is visible)
```

(That failure was a real bug: the bookmarks list kept a removed bookmark.)

## Suites

Each flow is tagged with one suite. Bigger suites include the smaller ones.

| Command | Flows | Time | Covers | Needs |
|---|---|---|---|---|
| `npm run e2e` | 24 | ~14 min | P0: every screen's main path (incl. map search, Emergencias, road routing and Preparedness) | nothing (offline) |
| `npm run e2e:full` | 50 | ~30 min | + P1: secondary features (markers, find in page, courses, reminders, PDF…) | nothing (offline) |
| `npm run e2e:all` | 67 | ~41 min | + P2: real downloads (incl. a published routing pack), OSM emergency points and the on-device AI | internet, Apple Intelligence, the GGUF fixture |
| `PLANET_PORT=8766 scripts/e2e.sh --build --tags planet` | 2 | ~12 min | extraction resumed after a kill (`map-22`) and retried after a network failure (`map-23`) (tag `planet`, their own build: rebuild without `PLANET_PORT` before other suites) | nothing (local stand-in planet) |
| `npm run e2e:ipad` | 1 | ~3 min | iPad tour: every main screen, portrait and landscape | nothing (offline) |
| `npm run e2e:android` | 8 | ~22 min | Android tour: main screens and the shared controls (find bar, row buttons, bookmarks, course check), map search and Emergencias, Preparedness, road routing with a published pack, content updates, official alerts, the assistant's map answers | internet, Android emulator |
| `npm run e2e:carplay` | 1 + car steps | ~5 min | CarPlay on the simulator's car screen: opened from the car, Destinos › Emergencias cerca › trip preview › Ir › ✕ (map button), the phone adopting the app the car started, a phone trip shown and ended on the car (section CarPlay) | Xcode 26.5's Simulator + iOS 26.5 simulator (`scripts/carplay/carplay-sim.sh setup`), a Release build with CarPlay on, Accessibility permission for the terminal |
| `npm run e2e:androidauto` | 1 + car steps | ~8 min | Android Auto on the Android Automotive emulator: opened from the car with the app not running, Destinos › Emergencias cerca › preview › Ir › Terminar, Buscar › preview › back, a `geo:` destination › Ir › arrival, the phone UI on the JS the car started (section Android Auto) | The Automotive emulator `NP-auto-34` (created on the first run), Maestro, the Automotive APK (`--build`) |

When to run what: smoke before every TestFlight build or after a risky change; full and the
iPad tour before an App Store release (then look through the iPad screenshots in
`e2e/artifacts/latest/ipad-01-tour/takeScreenshot/`); all occasionally (downloads depend on
the Kiwix and Protomaps servers, so a failure there can be the network rather than the app).

The suite runs by hand: no CI (a macOS runner or EAS builds cost money), and it is too
slow for a git hook. The pre-commit hook (`.githooks/pre-commit`, enabled by `npm install`)
runs the fast checks instead: typecheck, lint, unit tests and i18n keys (~5–10 s). Flows match Spanish texts; `onb-02` and `set-01` check English.

The iPhone flows don't run on iPad: there the tabs are a text bar at the top instead of
icons. The iPad tour taps them by name (`tapOn: { text: "Mapas", index: 0 }`).

Android has its own tour (`e2e/flows/android/`, `scripts/e2e-android.sh`; `ONLY=<flow name>` runs one flow,
`ANDROID_SERIAL=emulator-5554` picks the emulator when another one runs, e.g. the Android Auto session's Automotive
emulator): it installs the release APK on the `Pixel_API_36` emulator (`--build` rebuilds it), gives the app Spanish as
its per-app language (`cmd locale set-app-locales`) and location, and runs the flows tagged
`android`. A release build can't be seeded (no `run-as`), so the tour downloads a 1 MB and
a 12 MB archive; the runner turns the emulator's Wi-Fi off (`svc wifi disable`), so it is on mobile data and
"Wi-Fi only" (on by default) always asks first ("Descargas solo con Wi-Fi"): android-03 and
android-05 wait for that question and accept it ("Usar datos móviles"); without the answer a
country download would wait for Wi-Fi. Android tabs show only the active label, so they are tapped
by position (4 tabs: Inicio 12 %, Mapas 37 %, Biblioteca 63 %, Asistente 88 %). The
script-labels tour (`android-02-map-scripts`, six cities by visible-area download) was
removed with the visible-area downloads in the 2026-10-25 redesign: maps are whole
countries now, too big for a per-script check; check map labels in other scripts by hand.
Results go to `e2e/artifacts/latest-android/`.

Emulator network (2026-10-26): the app follows Android's "validated" flag
(`isInternetReachable`), so "Sin conexión" / "Necesitas conexión" on the emulator usually
means the network isn't validated, not the app. The script boots the emulator with
`-dns-server 8.8.8.8,1.1.1.1` (its resolver went stale after the Mac changed network:
pings fine, "Unable to resolve host github.com"), turns captive portal probing off and
waits for `VALIDATED` (toggling airplane mode). Behind a TLS-intercepting proxy every
download fails with `CertPathValidatorException: Trust anchor for certification path not
found` (Downloads sheet): the emulator doesn't trust the proxy's CA. Run the network
flows on a network without one.

## Running part of the suite

```bash
scripts/e2e.sh --tags nightly                          # one suite on its own
scripts/e2e.sh --tags reader                           # one area, any suite (reader, maps, search…)
scripts/e2e.sh --tags reader,maps                      # several tags: flows with any of them
scripts/e2e.sh e2e/flows/reader                        # a folder
scripts/e2e.sh e2e/flows/reader/rdr-03-bookmark.yaml   # one flow
scripts/e2e.sh --list --tags full                      # which flows would run, without running
npm run e2e -- e2e/flows/maps --build                  # options also work through npm
```

| Option / variable | Effect |
|---|---|
| `--tags a,b` | flows whose `tags:` contain any of the tags (default `smoke`) |
| `--build` | rebuild the Release `.app` before running |
| `--list` | print the selected flows and exit |
| `DEVICE=…` | simulator name (default `NP-e2e`) |
| `DERIVED=…` | xcodebuild derived data for `--build` (default `ios/build/sim`): use another one (`ios/build/e2e`) to keep the suite's build apart from a dev build |
| `APP=…` | another simulator `.app` (default `$DERIVED/…/NomadPocket.app`) |
| `ROUTING_PORT=…` | port of the local catalog server (default 8765). It is baked into the app at build time: change it when another checkout runs its suite at the same time, and rebuild |
| `MAESTRO=…` | Maestro binary (default `maestro` on `PATH`) |

## Reading the results

Every run writes to `e2e/artifacts/<timestamp>/` and points `e2e/artifacts/latest` at it
(gitignored).

```
e2e/artifacts/latest/
  summary.txt              # the summary printed at the end
  rdr-03-bookmark/
    maestro.log            # Maestro's output: each step and why it failed
    report.xml             # JUnit, for CI
    takeScreenshot/        # screenshots the flow takes on purpose (01-bookmarks.png…)
    screenshots/           # the screen at the failing step
    screen-hierarchy/      # what Maestro could see at the failing step (labels, ids, bounds)
    commands.json          # every step with its status and timing
    logs/                  # Maestro and simulator logs
```

To look into a failure:

1. Read the reason in the summary, then open `screenshots/` to see the screen and
   `screen-hierarchy/` to see which labels and ids were there.
2. Re-run only that flow: `scripts/e2e.sh e2e/flows/<area>/<flow>.yaml`.
3. To inspect a screen live, leave the app on it and run `maestro --device <udid> hierarchy`,
   or `maestro studio` for an interactive inspector.

## How a run works

```
scripts/e2e.sh
 ├─ pick flows by tag (the `tags:` line of each e2e/flows/**/*.yaml)
 ├─ build the Release .app if missing or --build (with EXPO_PUBLIC_ROUTING_MANIFEST_URL and
 │   EXPO_PUBLIC_MAPS_MANIFEST_URL pointing at the local server below: a build without
 │   them reads GitHub's catalogs and the `*-server` flows fail)
 ├─ if any flow is tagged `routing-server`, `routing-live` or `maps-server`: serve on
 │   http://localhost:8765 the Andorra routing pack split in two parts + its emergency
 │   points and street names + routing-manifest.json, and the Andorra country map
 │   (e2e/fixtures/maps/ad.pmtiles, z0–10) split in two parts + maps-manifest.json;
 │   the same catalogs also list two countries in regions with Andorra's files as stand-ins
 │   (see "Countries in regions" below);
 │   before each `routing-live` flow the routing manifest is swapped for a copy of the
 │   published one (GitHub's routing-index), so that flow downloads a real pack
 ├─ boot NP-e2e, set its location to Madrid
 └─ for each flow
     ├─ uninstall + install the app        → fresh state, nothing left from the last flow
     ├─ grant location permission
     ├─ if tagged `seeded`: clone e2e/fixtures/*.zim into the app's Documents/content/zim/
     ├─ if tagged `seeded-map`: clone e2e/fixtures/*.pmtiles into Documents/content/maps/
     ├─ if tagged `seeded-route`: clone e2e/fixtures/routing/*.tar into Documents/content/routing/
     ├─ if tagged `seeded-stitch`: clone e2e/fixtures/routing-stitch/* (two packs + crossings) there too
     ├─ if tagged `seeded-old-country`: Andorra's map and pack into content/{maps,routing} dated
     │   2026-01-01 (a loose file's build date is its modification time): older than the catalog's
     ├─ if tagged `seeded-country`: Andorra installed offline as a country is: map, routing pack and its
     │   side files (points, places, streets, house numbers), imported by the app at startup
     ├─ if tagged `seeded-onboarded`: the settings store written as onboarded (Library/Application Support/
     │   SQLite/ExpoSQLiteStorage, key `settings`): an install from before a feature, no wizard
     ├─ if tagged `updates-server`: serve the stand-in catalog of newer editions (below); else 404
     ├─ if tagged `seeded-model`: clone e2e/fixtures/models/*.gguf into Documents/content/models/
     │   (the app registers loose files there at startup:
     │    src/features/{library,maps,assistant}/register.ts)
     └─ maestro test <flow>
         └─ subflows/launch.yaml: launch, walk the setup wizard (suggested country, every
            piece of the kit switched off: "Continuar sin descargar") and land on Home;
            then the flow's own steps
```

The reinstall costs ~15 s per flow, but it means a flow never depends on another one and
can run alone. Tests use a Release build because it has no Metro dev server, starts like
the shipped app and is not slowed down by dev-mode checks.

```
e2e/
  config.yaml          # Maestro workspace config
  flows/<area>/*.yaml  # one file per test, named after its main case (rdr-03-bookmark)
  subflows/            # shared steps: launch, finish-onboarding, open-wikipedia, open-courses
  fixtures/            # ZIM, map and routing files for `seeded` / `seeded-map` / `seeded-route` flows (see Setup)
  artifacts/           # results (gitignored)
scripts/e2e.sh         # runner
scripts/e2e-setup.sh   # one-time setup
```

## Setup

`npm run e2e:setup` checks and prepares everything below, and only does what is missing.
By hand:

- **Maestro CLI** 2.x: `brew install mobile-dev-inc/tap/maestro` (not the `maestro` cask,
  which is a different app). It needs Java: the runner falls back to Homebrew's `openjdk` when
  `java` is not on `PATH`.
- **Simulators** `NP-e2e` (iPhone 17 Pro) and `NP-e2e-iPad` (iPad Air 11" M4), iOS 27.0,
  language `es-ES`. iOS 27.0 because Apple Intelligence works there (not on 26.5); Spanish
  because the flows match Spanish texts. By hand, for each (iPad type:
  `com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M4`):
  ```bash
  U=$(xcrun simctl create NP-e2e com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
  xcrun simctl boot $U
  xcrun simctl spawn $U defaults write "Apple Global Domain" AppleLanguages -array es-ES
  xcrun simctl spawn $U defaults write "Apple Global Domain" AppleLocale -string es_ES
  xcrun simctl shutdown $U
  ```
- **App**: the runner builds `ios/build/sim/…/NomadPocket.app` with `xcodebuild` when it is
  missing (needs `ios/`, from `npx expo prebuild`).
- **Fixtures** in `e2e/fixtures/`, from `download.kiwix.org`. The assertions depend on these
  exact files (article names, item counts), so they are pinned:

  | File | Size | Used for |
  |---|---|---|
  | `wikipedia_en_100_mini_2026-01.zim` | 4 MB | reader, search, bookmarks, AI sources |
  | `devdocs_en_node_2026-08.zim` | 1 MB | library list and delete |
  | `freecodecamp_es_all_2026-10.zim` | 11 MB | courses |
  | `nhs.uk_en_medicines_2026-09b.zim` | 15 MB | medical disclaimer |
  | `es-ml.pmtiles` | 0.6 MB | maps: Melilla up to zoom 12 (© OpenStreetMap, Protomaps build), a region map as older versions downloaded ("Otros mapas"), in git |
  | `maps/ad.pmtiles` | 2.5 MB | country download: Andorra up to zoom 10, served by the local catalog (`maps-server`; Protomaps build 2026-10-25, © OpenStreetMap), in git |
  | `routing/ad.tar`, `routing/ad.pois.tsv`, `routing/ad.streets.tsv` | 3 MB | routing: Andorra pack + emergency points + street names built by `scripts/routing/build-country.sh ad` (Valhalla 3.9.1, Geofabrik 2026-10-24, © OpenStreetMap), in git |
  | `routing-stitch/xadw.tar`, `xade.tar`, `*.crossings.tsv` | 3.5 MB | routes across packs: Andorra cut at 1.555°E, each half built apart with its crossings, by `scripts/routing/stitch-fixture.sh` (Valhalla 3.9.1, Geofabrik 2026-10-28, © OpenStreetMap), in git |
  | `routing/ad.places.tsv`, `routing/ad.addresses.tsv` | 140 KB | named places and house numbers of Andorra from `scripts/routing/places.py` (Geofabrik 2026-10-25), served with the pack by the local pack server |
  | `models/Qwen3.5-0.8B-Q4_K_M.gguf` | 533 MB | assistant with a llama.cpp model (`seeded-model`), from Hugging Face |

  The committed fixtures are third-party data: see `e2e/fixtures/README.md` for their sources and
  licences (ODbL, CC BY-SA).

  Kiwix removes old files from the mirror. `wikipedia_en_100_mini_2026-01.zim` is no
  longer there, so it is committed to git; the other three are downloaded by
  `npm run e2e:setup`. When one of them disappears too, commit it the same way
  (`.gitignore` has the exception).

## Flow catalog

| Area | Flow | Cases | Suite | Needs |
|---|---|---|---|---|
| onboarding | `onb-01-first-launch` | ONB-01 | smoke | — |
| onboarding | `onb-02-language` | ONB-02 | full | — |
| onboarding | `onb-04-pack` | ONB-04 | nightly | network, routing-server, maps-server (kit for Andorra + survival guides) |
| home | `home-01-storage-modules` | HOME-01 | smoke | seeded |
| home | `home-02-header` | HOME-02, DL-01 | smoke | — |
| home | `x-01-persistence` | X-01 | smoke | seeded |
| settings | `set-01-language` | SET-01 | smoke | — |
| settings | `set-03-storage` | SET-03, SET-04 | full | seeded |
| settings | `set-05-credits` | SET-05 | full | — (GPL notice, source/licence links, libkiwix, a JS package's licence via search) |
| library | `lib-01-open` | LIB-01, RDR-01 | smoke | seeded |
| library | `lib-02-delete` | LIB-02, LIB-05 | smoke | seeded (long press offers Share and Delete) |
| library | `lib-03-category` | LIB-03 | full | — |
| library | `lib-04-wikipedia` | LIB-04 | full | — |
| library | `lib-06-explore` | LIB-06 | nightly | network |
| library | `lib-07-download` | LIB-07 | nightly | network |
| library | `lib-08-clear-recent` | LIB-08 | full | seeded ("Limpiar" on Library's "Seguir leyendo" and Home's "Continuar": asks, Cancelar keeps it, Borrar clears the reading history) |
| search | `srch-01-no-archives` | SRCH-01 | smoke | — |
| search | `srch-02-titles` | SRCH-02 | smoke | seeded |
| search | `srch-03-fulltext` | SRCH-03, SRCH-04 | smoke | seeded |
| search | `srch-05-kiwix` | SRCH-05 | nightly | network |
| reader | `rdr-02-search-in-book` | RDR-02 | smoke | seeded |
| reader | `rdr-03-bookmark` | RDR-03 | smoke | seeded |
| reader | `rdr-04-history-nav` | RDR-04, RDR-06, RDR-08 | full | seeded |
| reader | `rdr-05-text-find` | RDR-05, RDR-07 | full | seeded |
| reader | `rdr-09-medical` | RDR-09 | full | seeded |
| reader | `rdr-10-dark` | RDR-10 | full | seeded |
| maps | `map-01-empty` | MAP-01, MAP-02 | smoke | — |
| maps | `map-02-seeded-region` | MAP-09 (offline) | smoke | seeded-map |
| maps | `map-03-pick-region` | MAP-03 | full | routing-server, maps-server |
| maps | `map-04-region` | MAP-04, MAP-09 | nightly | network (on-device extraction of a country the catalog lacks) |
| maps | `map-06-markers` | MAP-06, MAP-07 | full | — |
| maps | `map-08-locate` | MAP-08 | full | — |
| maps | `map-10-search` | MAP-10, MAP-11 | smoke | seeded-map |
| maps | `map-12-emergency-empty` | MAP-12 | smoke | — |
| maps | `map-13-emergency-points` | MAP-13 | nightly | network, seeded-map |
| maps | `map-14-route` | MAP-14 | smoke | seeded-route (Andorra pack, location set by the flow) |
| maps | `map-15-routing-download` | MAP-15 | full | routing-server, maps-server (country download from guidance: map + pack; also searches a street, a place and an address from the pack's side files) |
| maps | `map-16-routing-github` | MAP-16 | nightly | routing-live, maps-server (published routing catalog, Andorra pack from GitHub, 3 MB) |
| maps | `map-17-follow` | MAP-17 | full | seeded-route (navigation view; drives the CG-1 with Maestro `travel`) |
| maps | `map-18-credit` | MAP-18 | full | — (OSM credit shown when the map first appears, then fades) |
| maps | `map-19-stitch` | MAP-19 | full | seeded-stitch (a route across two packs built apart: Andorra cut in two, by car and on foot) |
| maps | `map-20-regions-packs` | MAP-20 | full | routing-server, maps-server (country in regions with a pack per region, as the USA: tick, download, "Tus mapas", add the other region, delete each) |
| maps | `map-21-regions-national-pack` | MAP-21 | full | routing-server, maps-server (regions for the map only + a national pack, as Canada/Russia: region ticked from the location, pack with the first region only, deleting the last region removes the pack) |
| maps | `map-22-extract-resume` | MAP-22 | planet (by hand) | maps-server, planet-server (an on-device extraction killed mid-way continues from its saved progress). Its own build: `PLANET_PORT=8766 scripts/e2e.sh --build e2e/flows/maps/map-22-extract-resume.yaml` bakes `EXPO_PUBLIC_PLANET_BUILD_URL` and serves `scripts/dev-planet-server.ts`; that app no longer reaches Protomaps, so rebuild without `PLANET_PORT` before other suites |
| maps | `map-23-extract-retry` | MAP-23 | planet (by hand) | maps-server, planet-server (an extraction failing on the network shows Retry in Downloads; Retry continues it to an installed map). The same build as `map-22`; the flow turns the stand-in planet off and on through its `/__outage?ms=` endpoint (`e2e/scripts/planet-outage.js`, `PLANET_PORT` passed to Maestro by `scripts/e2e.sh`) |
| maps | `map-24-search-recent` | MAP-24 | full | seeded map (a place picked in search shows under "Recientes" when the search opens again; picking it there opens its card; "Limpiar" asks, then empties the list) |
| courses | `crs-01-empty` | CRS-01 | smoke | — |
| courses | `crs-02-course` | CRS-02, CRS-03, CRS-04 | full | seeded |
| assistant | `ai-01-no-model` | AI-01, AI-02 | smoke | — |
| assistant | `ai-03-chat-sources` | AI-03, AI-04 | nightly | seeded, Apple Intelligence |
| assistant | `ai-05-conversations` | AI-05 | nightly | Apple Intelligence |
| assistant | `ai-06-conversation` | AI-06 | nightly | seeded, Apple Intelligence |
| assistant | `ai-07-gguf-tools` | AI-07 | nightly | seeded, seeded-model |
| assistant | `ai-08-dictation` | AI-08 | nightly | — (microphone shown; not tapped: the simulator's audio input aborts the app) |
| assistant | `ai-09-copy-regenerate` | AI-09 | nightly | seeded (system model: Copy shows "Copiado"; Regenerate answers the last question again) |
| assistant | `ai-10-map-answers` | AI-10 | smoke | seeded-country (map answers with no model: pharmacies near a town, New chat hidden until there is a chat, where am I with the 112 button, the nearest hospital opens the trip preview) |
| assistant | `ai-11-map-model` | AI-11 | nightly | seeded, seeded-country, Apple Intelligence (a map question the parser misses goes to the map through the router: petrol stations near Sant Julià de Lòria; a library answer naming a town gets its map chip; "¿qué es este pueblo?" asks the library about the town you're in) |
| assistant | `ai-12-map-phase2` | AI-12 | nightly | seeded-country (save the spot as the car and find it again, today's light, "estoy perdido" with the guide's advice first and, out of town, the arrow to the nearest one, a town's coordinates and UTM, official alerts while off, a route from elsewhere drawn on the map) |
| assistant | `ai-13-map-phase3` | AI-13 | nightly | seeded-country (petrol stations on the way to Encamp and the last within a range, alerts on the route while alerts are off, a trip to a country without its map) |
| downloads | `dl-02-controls` | DL-02 | nightly | network |
| updates | `upd-01-archives` | UPD-01, UPD-02, UPD-03 | full | seeded, updates-server (Home's card, Library's badge and link, the sheet; "Actualizar todo" replaces two archives and leaves the course that can't fit; its delete-first is refused with nothing deleted) |
| updates | `upd-02-country` | UPD-04 | full | seeded-old-country, routing-server, maps-server (Andorra as a January build: Home's card, update from the sheet, "Tus mapas" with October's build) |
| alerts | `alr-01-official-alerts` | ALR-01 | smoke | alerts-server (asked on its own onboarding step and turned on in Barcelona: quiet Home card; moved to Madrid: the orange warning drawn over the city and the M 4.8 quake 25 km away are listed and rung; detail with the official text and actions, the guide card, the quake's facts; Home's card; the run log; off again) |
| alerts | `alr-02-later` | ALR-02 | full | alerts-server ("Ahora no" on the wizard in Madrid: no offer or card on Home, also after a relaunch; turned on in Settings: the first check rings nothing already in force, its log line says so; Home shows the orange warning) |
| alerts | `alr-03-update-offer` | ALR-03 | smoke | alerts-server, seeded-onboarded (an install from before alerts: Home's once-only offer, turned on from it in Madrid: the orange warning card, no offer after a relaunch) |
| prepare | `prep-01-plan` | PREP-01 | smoke | — |
| prepare | `prep-02-kit` | PREP-02 | smoke | — |
| prepare | `prep-03-reminder-export` | PREP-03 | full | taps the system notifications alert |
| prepare | `prep-04-meeting-pin` | PREP-04 | full | seeded-map |
| ipad | `ipad-01-tour` | IPAD-01 | ipad | seeded, seeded-map |
| android | `android-01-tour` | ANDROID-01 | android | network |
| android | `android-03-search-emergency` | ANDROID-03 | android | network (Andorra country download) |
| android | `android-04-prepare` | ANDROID-04 | android | — (offline) |
| android | `android-05-routing` | ANDROID-05 | android | network (published catalog + Andorra pack from GitHub) |
| android | `android-07-alerts` | ANDROID-07 | android | stand-in alert feeds (official alerts turned on in Madrid from onboarding: Home's card, the list, an alert's official text, the run log) |
| android | `android-08-map-answers` | ANDROID-08 | android | network (Andorra from the published catalog; the assistant's map answers with no model: pharmacies near a town, no health gate on Android, where am I, the nearest hospital's trip preview) |
| android | `android-06-updates` | ANDROID-06 | android | network (a 1 MB archive from Kiwix), updates-server (its newer edition from the stand-in catalog, through `adb reverse`) |
| carplay | `car-00-prepare` | CAR-01…CAR-04 (with `scripts/carplay/e2e-carplay.sh`) | carplay | routing-server, maps-server; the iOS 26.5 CarPlay simulator |
| androidauto | `auto-00-prepare` | AUTO-01…AUTO-05 (with `scripts/androidauto/e2e-androidauto.sh`) | androidauto | its own local catalogs; the Android Automotive emulator |

### CarPlay (CAR, `npm run e2e:carplay`)

Maestro can't see the car screen: nothing of it reaches an accessibility tree, and only Xcode 26.5's Simulator
with an iOS 26.5 simulator shows it at all (`docs/CARPLAY_PLAN.md`, "Testing in the simulator"). So
`scripts/carplay/e2e-carplay.sh` mixes both: phone steps are Maestro (`e2e/flows/carplay/car-00-prepare.yaml`
through `scripts/e2e.sh` for the fresh install and the local catalogs; `e2e/subflows/carplay/*` run straight on
the app as the car left it), car steps are taps from `carplay-sim.sh tap` and checks of the car screen's text,
read from its screenshot with Vision (`scripts/carplay/ocr.swift`, lines of "x y<TAB>text" in the 800×480
screenshot's pixels, the same coordinates `tap` takes). Rows and bar buttons are tapped by their text; the
preview's green "Ir" is too short for the OCR, so it is tapped under the estimates.

| Case | What |
|---|---|
| CAR-01 | Opened from the car with the phone app closed: the car's map with "Destinos" (React Native started by the car) |
| CAR-02 | Destinos › Emergencias cerca › Salud lists the hospital; picking it shows the trip preview (llegada, Cancelar); "Ir" starts turn-by-turn (maneuver distance, no bar); the ✕ map button (bottom right, where the pan button is without a trip) goes back to the map |
| CAR-03 | The phone opened afterwards adopts the app the car started (its tab bar shows, not a blank window) |
| CAR-04 | A trip started on the phone ("Iniciar") shows on the car with its estimates; the ✕ on the car ends it on the phone |

Run it after `npm run e2e -- --build` while `app.json` has CarPlay on (the suite's build is the one it installs),
and not at the same time as another suite: both serve the local catalogs on port 8765. Results in
`e2e/artifacts/carplay-<timestamp>/` (each car screen as `NN.png` with its text in `NN.txt`).

### Android Auto (AUTO, `npm run e2e:androidauto`)

Play doesn't offer Android Auto to the phone emulator, so the car screens run on the **Android Automotive** emulator
(AVD `NP-auto-34`, Google Play image), whose templates host draws the same templates (`docs/ANDROID_AUTO_PLAN.md`,
Testing). `scripts/androidauto/e2e-androidauto.sh` builds the Automotive APK (`ANDROID_AUTOMOTIVE=1`, kept in
`~/Library/Caches/nomad-androidauto`, out of `android/`'s build folder so the phone suite never installs it), boots
or creates the emulator, serves Andorra's map and routing pack from its own local catalogs (port 8766, through
`adb reverse`) and runs `e2e/flows/androidauto/auto-00-prepare.yaml` with Maestro on the app's phone UI there (the
download, as `car-00`). Car steps are `adb shell input tap` and checks of the main display's text read with Vision
(`scripts/carplay/ocr.swift`, image pixels = tap coordinates, 1024×768).

Learned on the way (in the script's comments too):
- The driver is Android user 10: permissions, `pm clear`, the app locale and location (off on a new image) are
  per user.
- Android's network check (Google's servers over HTTPS) fails behind a network that intercepts TLS, leaving
  "partial connectivity", and the app won't download: the script points it at a local server answering 204
  (`captive_portal_*_url` = `http://10.0.2.2:8767/generate_204`).
- The host hides the map's buttons a few seconds after the last touch (the first tap only shows them), loses a
  tap that lands while it swaps a template, and delays results typed in a burst: the script taps the map first,
  types one key at a time and taps a search result again when its preview doesn't come.
- The preview's "Ir" is a short link the OCR sometimes misses: then it is tapped under the card's last line.
- Never stop the app while the car shows it (Google's templates host crashes): the script goes home first.

| Case | What |
|---|---|
| AUTO-01 | Opened from the car with the app not running: the offline map and "Destinos" (the app's JS started without UI) |
| AUTO-02 | Destinos › Emergencias cerca › Seguridad lists the police; picking it shows the preview (min, km, "Por …"); "Ir" starts guidance (maneuver distance, "Terminar"); "Terminar" goes back to the map |
| AUTO-03 | Buscar with the car's keyboard finds Canillo; its preview's back cancels the trip |
| AUTO-04 | A `geo:` destination from another app (`androidx.car.app.action.NAVIGATE`) opens its preview; "Ir", then the GPS at the destination: "Has llegado"; "Terminar" |
| AUTO-05 | The phone UI opened afterwards runs on the JS the car started (its tab bar shows) |

Results in `e2e/artifacts/androidauto-<timestamp>/` (each car screen as `NN.png` with its text in `NN.txt`). It
leaves `android/` prebuilt for Automotive: the phone suite's `--build` (or its missing APK) prebuilds it again.

### Official alerts (ALR)

`scripts/e2e.sh` and `scripts/e2e-android.sh` bake `EXPO_PUBLIC_ALERTS_URL=http://localhost:<port>/alerts` in, and
`scripts/e2e-alerts-feed.py` writes the feeds every source reads from there (on iOS for `alerts-server` flows; on
Android always): the real samples of `src/features/alerts/fixtures/` with every time moved so their moment
(2026-11-04 23:00 UTC) is now, an orange rain warning drawn over Madrid (a copy of AEMET's Cartagena warning with a
box around the city) and an M 4.8 quake 25 km from Madrid ten minutes ago. The suite puts the simulator in Madrid;
ALR-01 starts in Barcelona (`setLocation`) so turning alerts on records nothing serious, then moves to Madrid.

Gotchas paid for: iOS's notification prompt isn't covered by Maestro's launch permissions (the flow taps
"Permitir", and a prompt left open by a failed run outlives the reinstall); the alerts' banners are the system's (not
in the app's hierarchy) and cover the back button for a few seconds, so the flow waits a fixed 10 s after the check
that rings them; Maestro's `back` does nothing on iOS (tap `BackButton` after `waitForAnimationToEnd`). On Android the flows before
ANDROID-07 leave the emulator's last fix in Andorra, so it sets Madrid itself (`setLocation`).

Cases: **ALR-01** above (in smoke, so every run before a TestFlight build has it); **ALR-02**, alerts declined on
the wizard and turned on later in Settings (the check on turning them on records what is in force without ringing
it); **ALR-03**, someone updating from a version without alerts (`seeded-onboarded`): Home's offer, turned on
from it; **ANDROID-07** turns alerts on in Madrid from onboarding and checks Home's card, the
list, the detail and the run log on the emulator (served always on Android). Not automated: the background task (BGTaskScheduler doesn't run on the simulator; on a
device, a debug build's `triggerTaskWorkerForTestingAsync`, or on Android
`adb shell cmd jobscheduler run -f com.fjlinde.nomadpocket <job id>`), a raise (orange → red) notifying again, and the
Time Sensitive level breaking through a Focus (checked by hand on a phone).

### Content updates (UPD, ANDROID-06)

The check for newer archive editions (`docs/CONTENT_UPDATES_PLAN.md`) asks
`EXPO_PUBLIC_UPDATES_OPDS_URL` instead of Kiwix in E2E builds: `scripts/e2e.sh` and
`scripts/e2e-android.sh` bake `http://localhost:<port>/opds` in and serve the feed that
`scripts/e2e-updates-feed.py` writes: a "2099-12" edition of `wikipedia_en_100` (mini) and
`devdocs_en_node` (the fixtures under the new name, so they download and replace the old file) and a
50 TB one of `freecodecamp_es_all` (never fits: the "no room" and delete-first refusal path). A date no
real edition reaches, so the fixtures never catch up. On iOS it is served only to `updates-server`
flows (other flows get a 404: no updates); on Android always, forwarded with `adb reverse`, and the APK
must allow plain http to localhost: `--build` prebuilds with `NOMAD_E2E=1`
(`plugins/with-e2e-local-network.js`; a store prebuild removes it). Downloads and Explore keep
Kiwix's real catalog.

Cases: **UPD-01** newer editions are found and shown (Home's card for old data, Library's badge and
link, the sheet's rows); **UPD-02** "Actualizar todo" downloads what fits and replaces the old file
once the new one is in; **UPD-03** an update that can't fit is marked, and its delete-first is refused
before anything is deleted when even that wouldn't fit; **UPD-04** a country's newer map and pack
replace the old ones; **ANDROID-06** an archive's update on Android. Not automated: a delete-first update that goes through (it needs a phone
nearly full; checked by hand, PROGRESS 2026-10-31).

### Countries in regions (MAP-20, MAP-21)

`scripts/e2e.sh` adds two countries in regions to the local catalogs it serves for `routing-server` /
`maps-server` flows. They are stand-ins: every map is a copy of `maps/ad.pmtiles` and every pack a copy
of `routing/ad.tar` (+ its four side files) under another file name, so a download is small (~2.5 MB per
map, ~3 MB per pack) and the flows only check the app's logic, not the data.

| Country | Catalog | Region ids | Flow |
|---|---|---|---|
| United States (`us`) | a map and a pack per region, like the real USA | `us-alaska`, `us-hawaii` | `map-20-regions-packs` |
| Canada (`ca`) | two regional maps with outline `cells` (Ontario: Toronto/Ottawa, Quebec: Montreal) + one pack `ca` that belongs to no region | `ca-ontario`, `ca-quebec` | `map-21-regions-national-pack` |

Region names come from `maps:parts.<id>` (Alaska, Hawái, Ontario, Quebec). Andorra stays a country in one
part, so the other `*-server` flows are not affected. In `map-21` the location is set (Toronto) after the
wizard: set before, the wizard would propose Canada's kit and open the region checklist. The flows are
long-running by nature (downloads, preparing search files): their waits are 90 s. To add a region, add its
id to the copy loops and to `maps` / `packs` in `scripts/e2e.sh`. `region-delete` (a row of "Tus mapas")
removes a whole country; `region-delete-<id>` (inside the country sheet) one region.

Not automated: LIB-08 (import from Files: the system picker is outside the app) and X-02
(offline: the simulator has no airplane mode). Check them by hand on a device. Also by hand: map
labels in other scripts (ANDROID-02's script tour went with the visible-area downloads).

The Settings row that reruns the wizard is "Revisar descargas recomendadas" ("Review recommended
downloads"; flows `home-02`, `onb-02`). The wizard's download button reads "Descargar · <size>"
and its confirmation "Tu contenido se está descargando".

Removed in the 2026-10-25 redesign (docs/UX_SURVIVAL_PLAN.md): MAP-05 (the world map is
bundled, nothing to download; `map-01` checks it is "Incluido"), ONB-03 (content languages
left the wizard; they follow the app language) and ANDROID-02 (visible-area downloads).
The Preparedness hub (`/prepare`, PDF export) opens from Home's plan row (`ready-plan`);
"Mi plan familiar" (`home-plan`) goes straight to the plan.

## Writing a flow

```yaml
# RDR-11 — what the flow checks, in one line.
appId: com.fjlinde.nomadpocket
tags: [full, reader, seeded]     # suite, area, needs (seeded / network)
---
- runFlow: ../../subflows/launch.yaml
- runFlow: ../../subflows/open-wikipedia.yaml
- tapOn: "Buscar en este libro"
- assertVisible: "Michael Jackson.*"
- takeScreenshot: rdr-11-01-result
```

- Put it in `e2e/flows/<area>/`, named after its main case. Tag `seeded` if it needs the
  ZIM fixtures, `seeded-map` for the map one, `seeded-route` for the routing pack,
  `seeded-stitch` for the two packs to route across,
  `routing-server` if it downloads a routing pack from the local server, `updates-server` for the
  stand-in catalog of newer archive editions, `seeded-old-country` for Andorra as an old build, `seeded-country` for Andorra installed offline with its points and search files, `seeded-onboarded` for an install that
  finished the wizard before (someone updating), `maps-server` if
  it needs the local country maps catalog (Andorra), `routing-live`
  if it downloads a published one (needs internet and the live catalog), `seeded-model`
  for the GGUF model, and `network` if it downloads from the internet. A map file
  named after a region id (`es-ml.pmtiles`) registers as that region.
- Map search is asynchronous (the query runs on a second connection after a 200 ms debounce, and
  a newer search cancels the older): after typing, wait for the result with `extendedWaitUntil`
  instead of asserting at once.
- Text matching is a full-string regex: `"Michael Jackson.*"`, and escape `. ( ) ?`.
- Cards and rows expose one merged accessibility label (`"Mapa de España, Máximo detalle…"`):
  match them with a regex (`"Mapa de España.*"`).
- Prefer visible text, as a person would. Use a `testID` (`tapOn: { id: "…" }`) when the
  text is ambiguous or there is none (icon buttons). `testID` is supported by `Button`,
  `IconButton`, `Card`, `ListRow` and `Chip`; the ones in use:

  | testID | Control |
  |---|---|
  | `open-downloads`, `open-settings` | Home header buttons |
  | `reader-back`, `reader-forward`, `reader-search`, `reader-bookmark`, `reader-text`, `reader-more` | reader toolbar |
  | `find-previous`, `find-next`, `find-close` | find in page |
  | `popover-dismiss` | backdrop that closes a reader popover |
  | `pack-download-<tier slug>` | a collection level's download button (`pack-download-medicine-essential`) |
  | `resource-<id>`, `download-<id>` | catalog row and its download / open / pause button |
  | `lesson-<n>`, `lesson-check-<n>` | course lesson (1-based) and its done check |
  | `marker-name`, `marker-note` | fields of the place sheet |
  | `marker-delete`, `region-delete`, `conversation-delete` | delete buttons in lists |
  | `composer-mic` | assistant composer: dictate / stop listening |
  | `assistant-new-chat` | assistant header: New chat (hidden on a fresh, empty chat) |
  | `map-answer`, `map-answer-row`, `map-answer-locality` | assistant map answer: the card, a place row (opens it on the map), the town of "¿dónde estoy?" |
  | `map-answer-go`, `map-answer-go-first`, `map-answer-call` | map answer actions: a row's "Llévame", the main "Llévame a …" / "Cómo llegar", a row's call button |
  | `map-answer-emergency`, `map-answer-share`, `map-answer-sms`, `map-answer-open`, `map-answer-option`, `map-answer-maps` | call the emergency number, share / SMS the position, see on the map, a "which one?" option, download maps |
  | `map-answer-save`, `map-answer-coords`, `map-answer-sun`, `map-answer-lost`, `map-answer-town`, `map-answer-arrival`, `map-answer-no-alerts` | phase 2 cards: save the spot, a place's coordinates, today's light, the lost card's advice and nearest town, the arrival before dark, no alerts |
  | `map-answer-range`, `map-answer-avoid`, `map-answer-trip-map`, `map-answer-download`, `map-answer-chips`, `map-answer-chip` | phase 3: the last stop within a range, the route avoiding an alert area, a trip's map state and download, place chips under a library answer |
  | `route-preview`, `route-preview-travel`, `route-preview-close` | a route from elsewhere drawn on the map (from the assistant): its card, time and distance, close |
  | `assistant-copy`, `assistant-regenerate`, `assistant-report` | icon buttons under a finished answer: copy it as plain text; answer the last question again (last answer only); report it by email (opens the mail app; Android only) |
  | `assistant-suggestion-<n>` | assistant empty screen: suggested question in card n (0–3; the questions rotate) |
  | `assistant-model-banner` | assistant with no model ready: the banner recommending one (download / built-in model) |
  | `assistant-retry` | assistant error banner: resend the failed question (hidden when retrying can't help) |
  | `map-search`, `map-emergency` | map search pill and the red "SOS" (Emergencias) button |
  | `map-points`, `points-show`, `points-<category>` | Puntos (legend) map button, its show-on-map row and one row per category |
  | `search-input`, `search-result`, `search-coordinates` | search sheet field, result rows, "go to coordinates" row |
  | `search-recent`, `search-recent-clear` | search sheet with nothing typed: recent places picked in search, and their "Limpiar" |
  | `place-card`, `place-guide`, `place-save`, `place-close` | selected place card and its actions |
  | `place-address` | the card's "street, number · locality" line, for a place tapped on the map |
  | `nav-speed`, `nav-speed-limit` | while navigating by car or bike: the speed badge, and by car the posted limit sign above it (needs fixes with a speed: `simctl location start`, not Maestro's `travel`) |
  | `place-call` | one "Llamar" button per phone number of the place (several numbers = several buttons) |
  | `map-credit` | the "© OpenStreetMap contributors" pill shown when the map first appears (gone after ~5 s or the first gesture) |
  | `guidance-panel`, `guidance-distance`, `guidance-stop` | guidance panel: remaining distance (route) or distance + direction (straight line), stop |
  | `guidance-costing-<auto\|pedestrian\|bicycle>`, `guidance-next`, `guidance-next-distance`, `guidance-steps` | mode chips, next maneuver and its distance, directions button |
  | `guidance-voice` | navigation bar: mutes / unmutes the spoken prompts (setting `navVoice`) |
  | `guidance-note`, `guidance-get-routing` | straight-line note and its "Descargar la navegación de este país" button (opens the sheet of the first country the trip lacks: destination, origin, then on the way) |
  | `guidance-start`, `guidance-banner`, `guidance-remaining` | "Iniciar" (trip preview); navigation view: maneuver banner, remaining distance/time in the bottom bar |
  | `maps-empty`, `maps-incoming` | Maps tab with no country yet: the card that offers one, or the one that shows the country on its way (progress, "Ver descargas") |
  | `map-recenter`, `map-overview` | navigation view: "Recentrar" pill (not following) and whole-route button (following) |
  | `map-locate` | "my location" button outside navigation; `selected` while the map follows the user |
  | `map-north-up` | navigation view: "Norte arriba" toggle (following; selected keeps the map north up) |
  | `route-summary`, `route-step` | directions sheet: distance · time, maneuver rows |
  | `country-row`, `add-country`, `country-retry`, `region-delete` | "Tus mapas" sheet: one row per country, "Añadir un país", retry a failed download, delete (also older maps) |
  | `country-retry-size`, `country-update` | country sheet: retry the size check; "Tus mapas": update a country |
  | `country-<id>` | a country in the picker (onboarding, maps, settings), e.g. `country-ad` |
  | `country-download`, `country-size` | country sheet: download button, total size |
  | `region-all`, `region-<id>`, `region-delete-<id>` | country sheet and onboarding kit of a country in regions (the USA: `region-us-west`…; Canada, Russia: `region-ca-ontario`…): whole-country shortcut, tick a region, delete a region on the phone |
  | `home-emergency`, `home-first-aid` (`home-guides` on Android: no health features), `home-plan`, `home-call` | Home: "En una emergencia" actions (`home-first-aid` opens the emergency guide) |
  | `guide-search`, `guide-card-<id>` (e.g. `guide-card-cpr-adult`), `guide-notes` | Emergency guide: search field, a card's row, the card's Nomad notes |
  | `home-readiness`, `ready-<map\|guides\|wikipedia\|assistant\|plan\|kit>`, `home-downloads`, `home-network` | Home: "Tu preparación" card and rows, downloads card (also while a country is being prepared), connection line |
  | `onboarding-start`, `onboarding-next`, `onboarding-download`, `onboarding-finish`, `onboarding-plan`, `onboarding-close` | setup wizard buttons (`onboarding-close` only on a second run) |
  | `download-allow-cellular`, `downloads-waiting-wifi`, `downloads-allow-cellular-all` | download row: "use mobile data" for this download; Downloads sheet: the "waiting for Wi-Fi" card and its "use mobile data for all" button |
  | `home-updates`, `downloads-updates`, `updates-check`, `updates-checked`, `update-row`, `updates-all`, `updates-blocked` | Content updates: Home's card (urgent ones, online), the Downloads sheet's row to `/updates`; in `/updates`: "Buscar ahora", the last-check line, each update's row, "Actualizar todo", the "doesn't fit" note |
  | `downloads-keep-awake` | Downloads sheet: the "the screen stays on while downloading" note (while something runs or installs; DL-02) |
  | `download-preparing` | Downloads sheet: a downloaded country still being prepared (search, emergency points), with its progress |
  | `kit-country`, `kit-guides`, `kit-wikipedia`, `kit-assistant` | setup wizard kit rows (the whole row toggles) |
  | `library-search`, `continue-reading` | Library: the big search block (opens `/search`), the "Seguir leyendo" row |
  | `continue-reading-clear`, `home-continue-clear` | "Limpiar" on Library's "Seguir leyendo" and on Home's "Continuar" (clears the reading history after asking) |
  | `collection-<key>` | Library: a collection row (`medicine`, `survival`, `wikipedia`, `agriculture`, `diy`, `education`, `computing`, `courses`, `other`); archives are opened inside their collection |
  | `search-kiwix` | search screen: "Buscar «…» en Kiwix" (online only) |
  | `settings-country`, `settings-credits` | Settings: your country, Credits & licenses |
  | `credits-source`, `credits-gpl`, `credits-js`, `credits-search` | Credits screen: source link, GPL text, JavaScript packages, package search |
  | `emergency-call`, `emergency-share`, `emergency-position`, `emergency-number-country` | Emergencias sheet: call, share position, position text, the country whose number it is |
  | `emergency-cat-<category>`, `emergency-place`, `emergency-guide` | category chips (health, security, water, supplies, official), rows and their Llévame button |
  | `emergency-region`, `emergency-fetch` | per-map rows and their retry/refresh button (points come with the country; Overpass runs by itself for maps without them) |
  | `marker-guide` | Llévame in a saved place's sheet |
  | `search-library` | "Buscar en mi biblioteca" under an answer given without the library |
  | `prepare-plan`, `prepare-kit`, `prepare-export` | Preparedness hub (`nomadpocket:///prepare`) |
  | `meeting-primary`, `meeting-secondary`, `add-contact`, `add-number`, `add-person`, `call-contact-<n>`, `home-notes` | family plan (n 0-based) |
  | `entry-<field>`, `entry-save` | plan entry sheet (`entry-name`, `entry-phone`…) |
  | `meeting-place`, `meeting-details`, `meeting-pin-<id>`, `meeting-save` | meeting point sheet |
  | `adults-plus`/`-minus`/`-value` (also `children-`, `pets-`), `kit-progress`, `kit-<item>`, `kit-<item>-details`, `kit-add` | kit screen |
  | `item-name`, `item-add-expiry`, `expiry-month`, `item-save` | kit item sheet |
  | `house`, `map`, `books.vertical`, `text.bubble` | tabs (SF Symbol ids, set by iOS); Courses is a collection of the Library (`subflows/open-courses.yaml`) |
  | `onboarding-alerts-enable`, `onboarding-alerts-decline` | setup wizard's official alerts step (after the kit, before "Todo listo"; skipped when alerts are already on): "Activar avisos", "Ahora no". Every flow through the wizard answers it (`subflows/finish-onboarding.yaml` says "Ahora no") |
  | `home-alert`, `home-alerts-status`, `home-alerts-offer`, `home-alerts-offer-enable`, `home-alerts-offer-decline` | Home: an orange/red warning where the person is; the quiet line while alerts are on and nothing serious applies; the once-only offer (installs from before the feature) and its buttons |
  | `settings-alerts`, `alerts-settings-switch` | Settings: the Avisos oficiales row; the on/off switch in its screen |
  | `alerts-status`, `alerts-refresh`, `alerts-no-position`, `alerts-no-notifications`, `alert-row-<n>`, `alerts-list-offer` | `/alerts`: freshness line, "Comprobar ahora", the no-location and no-notifications cards, rows (0-based), the offer while off |
  | `alert-title`, `alert-official`, `alert-action-<map\|guide\|plan\|kit\|call\|web>` | `/alerts/[id]`: title, the official text, the action rows |
  | `BackButton` | the native header's back button |

- A control inside another button is invisible to VoiceOver and to Maestro (iOS merges it
  into the outer button). Put it beside the button instead: `ListRow` has
  `trailingAction` for that.
- Any screen opens directly with a deep link: `- openLink: nomadpocket:///library/resource/<id>`.
- iOS alerts keep the screen behind them in the hierarchy: if the alert's button has the
  same text as a control on screen, pick it by position relative to that control
  (`tapOn: { text: "Eliminar", above: { id: "marker-delete" } }`), or between the alert's
  message and "Cancelar" when the title repeats it too; `index` follows the position on
  screen, not the order things appeared.
- `hideKeyboard` can tap a link inside the web view; dismiss the keyboard by tapping a
  non-interactive text instead.
- Assistant flows assert structure (sources, buttons), never the answer text.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Simulator 'NP-e2e' not found` | `npm run e2e:setup` |
| A change in the app is not there | run with `--build` |
| Java / `JAVA_HOME` errors | `brew install openjdk`, or set `JAVA_HOME` |
| First flow times out on `onboarding-start` | the simulator was cold-booting; run again |
| Many flows fail at random steps | close other simulators and heavy apps, and run again: Maestro waits for a calm screen, and a slow Mac makes it time out |
| `seeded` flows show an empty library | a fixture is missing: `npm run e2e:setup` |
| A `network` flow fails | check the server first (download.kiwix.org, build.protomaps.com, `curl https://overpass-api.de/api/status` for `map-13`) before suspecting the app |
| `map-04-region` times out on the installed row | another suite was downloading at the same time (e.g. `e2e:android`): run the network suites one at a time |
| `*-server` flows show "Aún no disponible" or no size | the app was built without the local catalog URLs: rebuild with `--build` (not a dev build) |
