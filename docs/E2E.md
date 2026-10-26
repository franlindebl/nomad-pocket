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
| `npm run e2e` | 21 | ~14 min | P0: every screen's main path (incl. map search, Emergencias, road routing and Preparedness) | nothing (offline) |
| `npm run e2e:full` | 38 | ~24 min | + P1: secondary features (themes, markers, find in page, courses, reminders, PDF…) | nothing (offline) |
| `npm run e2e:all` | 49 | ~35 min | + P2: real downloads (incl. a published routing pack), OSM emergency points and the on-device AI | internet, Apple Intelligence, the GGUF fixture |
| `npm run e2e:ipad` | 1 | ~3 min | iPad tour: every main screen, portrait and landscape, light and dark | nothing (offline) |
| `npm run e2e:android` | 4 | ~15 min | Android tour: main screens and the shared controls (find bar, row buttons, bookmarks, course check), map search and Emergencias, Preparedness, road routing with a published pack | internet, Android emulator |

When to run what: smoke before every TestFlight build or after a risky change; full and the
iPad tour before an App Store release (then look through the iPad screenshots in
`e2e/artifacts/latest/ipad-01-tour/takeScreenshot/`); all occasionally (downloads depend on
the Kiwix and Protomaps servers, so a failure there can be the network rather than the app).

The suite runs by hand: no CI (a macOS runner or EAS builds cost money), and it is too
slow for a git hook. The pre-commit hook (`.githooks/pre-commit`, enabled by `npm install`)
runs the fast checks instead: typecheck, lint, unit tests and i18n keys (~5–10 s). Flows match Spanish texts; `onb-02` and `set-01` check English.

The iPhone flows don't run on iPad: there the tabs are a text bar at the top instead of
icons. The iPad tour taps them by name (`tapOn: { text: "Mapas", index: 0 }`).

Android has its own tour (`e2e/flows/android/`, `scripts/e2e-android.sh`): it installs the
release APK on the `Pixel_API_36` emulator (`--build` rebuilds it), gives the app Spanish as
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
 │   before each `routing-live` flow the routing manifest is swapped for a copy of the
 │   published one (GitHub's routing-index), so that flow downloads a real pack
 ├─ boot NP-e2e, set its location to Madrid
 └─ for each flow
     ├─ uninstall + install the app        → fresh state, nothing left from the last flow
     ├─ grant location permission
     ├─ if tagged `seeded`: clone e2e/fixtures/*.zim into the app's Documents/content/zim/
     ├─ if tagged `seeded-map`: clone e2e/fixtures/*.pmtiles into Documents/content/maps/
     ├─ if tagged `seeded-route`: clone e2e/fixtures/routing/*.tar into Documents/content/routing/
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
| settings | `set-02-theme` | SET-02 | full | — |
| settings | `set-03-storage` | SET-03, SET-04 | full | seeded |
| settings | `set-05-credits` | SET-05 | full | — (GPL notice, source/licence links, libkiwix, a JS package's licence via search) |
| library | `lib-01-open` | LIB-01, RDR-01 | smoke | seeded |
| library | `lib-02-delete` | LIB-02, LIB-05 | smoke | seeded |
| library | `lib-03-category` | LIB-03 | full | — |
| library | `lib-04-wikipedia` | LIB-04 | full | — |
| library | `lib-06-explore` | LIB-06 | nightly | network |
| library | `lib-07-download` | LIB-07 | nightly | network |
| search | `srch-01-no-archives` | SRCH-01 | smoke | — |
| search | `srch-02-titles` | SRCH-02 | smoke | seeded |
| search | `srch-03-fulltext` | SRCH-03, SRCH-04 | smoke | seeded |
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
| courses | `crs-01-empty` | CRS-01 | smoke | — |
| courses | `crs-02-course` | CRS-02, CRS-03, CRS-04 | full | seeded |
| assistant | `ai-01-no-model` | AI-01, AI-02 | smoke | — |
| assistant | `ai-03-chat-sources` | AI-03, AI-04 | nightly | seeded, Apple Intelligence |
| assistant | `ai-05-conversations` | AI-05 | nightly | Apple Intelligence |
| assistant | `ai-06-conversation` | AI-06 | nightly | seeded, Apple Intelligence |
| assistant | `ai-07-gguf-tools` | AI-07 | nightly | seeded, seeded-model |
| downloads | `dl-02-controls` | DL-02 | nightly | network |
| prepare | `prep-01-plan` | PREP-01 | smoke | — |
| prepare | `prep-02-kit` | PREP-02 | smoke | — |
| prepare | `prep-03-reminder-export` | PREP-03 | full | taps the system notifications alert |
| prepare | `prep-04-meeting-pin` | PREP-04 | full | seeded-map |
| ipad | `ipad-01-tour` | IPAD-01 | ipad | seeded, seeded-map |
| android | `android-01-tour` | ANDROID-01 | android | network |
| android | `android-03-search-emergency` | ANDROID-03 | android | network (Andorra country download) |
| android | `android-04-prepare` | ANDROID-04 | android | — (offline) |
| android | `android-05-routing` | ANDROID-05 | android | network (published catalog + Andorra pack from GitHub) |

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
  `routing-server` if it downloads a routing pack from the local server, `maps-server` if
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
  | `tier-<slug>`, `pack-download` | collection tier card and its download button |
  | `resource-<id>`, `download-<id>` | catalog row and its download / open / pause button |
  | `lesson-<n>`, `lesson-check-<n>` | course lesson (1-based) and its done check |
  | `marker-name`, `marker-note` | fields of the place sheet |
  | `marker-delete`, `region-delete`, `conversation-delete` | delete buttons in lists |
  | `map-search`, `map-emergency` | map search pill and Emergencias button |
  | `search-input`, `search-result`, `search-coordinates` | search sheet field, result rows, "go to coordinates" row |
  | `place-card`, `place-guide`, `place-save`, `place-close` | selected place card and its actions |
  | `place-call` | one "Llamar" button per phone number of the place (several numbers = several buttons) |
  | `map-credit` | the "© OpenStreetMap contributors" pill shown when the map first appears (gone after ~5 s or the first gesture) |
  | `guidance-panel`, `guidance-distance`, `guidance-stop` | guidance panel: remaining distance (route) or distance + direction (straight line), stop |
  | `guidance-costing-<auto\|pedestrian\|bicycle>`, `guidance-next`, `guidance-next-distance`, `guidance-steps` | mode chips, next maneuver and its distance, directions button |
  | `guidance-note`, `guidance-get-routing` | straight-line note and its "Descargar la navegación de este país" button (opens the country sheet) |
  | `guidance-start`, `guidance-banner`, `guidance-remaining` | "Iniciar" (trip preview); navigation view: maneuver banner, remaining distance/time in the bottom bar |
  | `maps-empty`, `maps-incoming` | Maps tab with no country yet: the card that offers one, or the one that shows the country on its way (progress, "Ver descargas") |
  | `map-recenter`, `map-overview` | navigation view: "Recentrar" pill (not following) and whole-route button (following) |
  | `route-summary`, `route-step` | directions sheet: distance · time, maneuver rows |
  | `country-row`, `add-country`, `country-retry`, `region-delete` | "Tus mapas" sheet: one row per country, "Añadir un país", retry a failed download, delete (also older maps) |
  | `country-retry-size`, `country-update` | country sheet: retry the size check; "Tus mapas": update a country |
  | `country-<id>` | a country in the picker (onboarding, maps, settings), e.g. `country-ad` |
  | `country-download`, `country-size` | country sheet: download button, total size |
  | `home-emergency`, `home-first-aid`, `home-plan`, `home-call` | Home: "En una emergencia" actions |
  | `home-readiness`, `ready-<map\|guides\|wikipedia\|assistant\|plan\|kit>`, `home-downloads`, `home-network` | Home: "Tu preparación" card and rows, downloads card, connection line |
  | `onboarding-start`, `onboarding-next`, `onboarding-download`, `onboarding-finish`, `onboarding-plan`, `onboarding-close` | setup wizard buttons (`onboarding-close` only on a second run) |
  | `download-allow-cellular`, `downloads-waiting-wifi`, `downloads-allow-cellular-all` | download row: "use mobile data" for this download; Downloads sheet: the "waiting for Wi-Fi" card and its "use mobile data for all" button |
  | `kit-country`, `kit-guides`, `kit-wikipedia`, `kit-assistant` | setup wizard kit rows (the whole row toggles) |
  | `open-courses` | Courses card in the Library |
  | `settings-country`, `settings-credits` | Settings: your country, Credits & licenses |
  | `credits-source`, `credits-gpl`, `credits-js`, `credits-search` | Credits screen: source link, GPL text, JavaScript packages, package search |
  | `emergency-call`, `emergency-share`, `emergency-position` | Emergencias sheet: call, share position, position text |
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
  | `house`, `map`, `books.vertical`, `sparkles` | tabs (SF Symbol ids, set by iOS); Courses is inside the Library (`subflows/open-courses.yaml`) |
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
