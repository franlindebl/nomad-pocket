# E2E functional tests (iOS simulator)

[Maestro](https://maestro.mobile.dev) flows that drive the Release build of the app on an
iOS simulator, the same way a person would: tapping, typing and reading the screen through
accessibility. 36 flows cover 53 of the 55 cases in the test plan (Claude doc "Plan de
tests funcionales iOS — Nomad App"); the case ids (`RDR-03`, `MAP-06`…) are on the first
line of each flow.

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
| `npm run e2e` | 15 | ~10 min | P0: every screen's main path | nothing (offline) |
| `npm run e2e:full` | 28 | ~18 min | + P1: secondary features (themes, markers, find in page, courses…) | nothing (offline) |
| `npm run e2e:all` | 36 | ~23 min | + P2: real downloads and the on-device AI | internet, Apple Intelligence |

When to run what: smoke before every TestFlight build or after a risky change; full before
an App Store release; all occasionally (downloads depend on the Kiwix and Protomaps servers,
so a failure there can be the network rather than the app).

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
| `APP=…` | another simulator `.app` (default `ios/build/sim/…/NomadPocket.app`) |
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
 ├─ build the Release .app if missing or --build
 ├─ boot NP-e2e, set its location to Madrid
 └─ for each flow
     ├─ uninstall + install the app        → fresh state, nothing left from the last flow
     ├─ grant location permission
     ├─ if tagged `seeded`: clone e2e/fixtures/*.zim into the app's Documents/content/zim/
     │   (the app registers loose ZIM files at startup: src/features/library/register.ts)
     └─ maestro test <flow>
         └─ subflows/launch.yaml: launch, walk the setup wizard with "Lo elijo yo"
            (no downloads) and land on Home; then the flow's own steps
```

The reinstall costs ~15 s per flow, but it means a flow never depends on another one and
can run alone. Tests use a Release build because it has no Metro dev server, starts like
the shipped app and is not slowed down by dev-mode checks.

```
e2e/
  config.yaml          # Maestro workspace config
  flows/<area>/*.yaml  # one file per test, named after its main case (rdr-03-bookmark)
  subflows/            # shared steps: launch, finish-onboarding, open-wikipedia
  fixtures/            # ZIM files for `seeded` flows (gitignored, see Setup)
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
- **Simulator `NP-e2e`**: iPhone 17 Pro, iOS 27.0, language `es-ES`. iOS 27.0 because Apple
  Intelligence works there (not on 26.5); Spanish because the flows match Spanish texts.
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

  Kiwix removes old files from the mirror. `wikipedia_en_100_mini_2026-01.zim` is no
  longer there, so it is committed to git; the other three are downloaded by
  `npm run e2e:setup`. When one of them disappears too, commit it the same way
  (`.gitignore` has the exception).

## Flow catalog

| Area | Flow | Cases | Suite | Needs |
|---|---|---|---|---|
| onboarding | `onb-01-first-launch` | ONB-01 | smoke | — |
| onboarding | `onb-02-language` | ONB-02, ONB-03 | full | — |
| onboarding | `onb-04-pack` | ONB-04 | nightly | network |
| home | `home-01-storage-modules` | HOME-01 | smoke | seeded |
| home | `home-02-header` | HOME-02, DL-01 | smoke | — |
| home | `x-01-persistence` | X-01 | smoke | seeded |
| settings | `set-01-language` | SET-01 | smoke | — |
| settings | `set-02-theme` | SET-02 | full | — |
| settings | `set-03-storage` | SET-03, SET-04 | full | seeded |
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
| maps | `map-03-pick-region` | MAP-03 | full | — |
| maps | `map-04-region` | MAP-04, MAP-09 | nightly | network |
| maps | `map-05-world` | MAP-05 | nightly | network |
| maps | `map-06-markers` | MAP-06, MAP-07 | full | — |
| maps | `map-08-locate` | MAP-08 | full | — |
| courses | `crs-01-empty` | CRS-01 | smoke | — |
| courses | `crs-02-course` | CRS-02, CRS-03, CRS-04 | full | seeded |
| assistant | `ai-01-no-model` | AI-01, AI-02 | smoke | — |
| assistant | `ai-03-chat-sources` | AI-03, AI-04 | nightly | seeded, Apple Intelligence |
| assistant | `ai-05-conversations` | AI-05 | nightly | Apple Intelligence |
| downloads | `dl-02-controls` | DL-02 | nightly | network |

Not automated: LIB-08 (import from Files: the system picker is outside the app) and X-02
(offline: the simulator has no airplane mode). Check them by hand on a device.

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
  fixtures and `network` if it downloads.
- Text matching is a full-string regex: `"Michael Jackson.*"`, and escape `. ( ) ?`.
- Cards and rows expose one merged accessibility label (`"Lo elijo yo, Empieza vacío…"`):
  match them with a regex (`"Lo elijo yo.*"`).
- Prefer visible text, as a person would. Use a `testID` (`tapOn: { id: "…" }`) when the
  text is ambiguous or there is none (icon buttons). `testID` is supported by `Button`,
  `IconButton`, `Card` and `ListRow`; the ones in use:

  | testID | Control |
  |---|---|
  | `open-downloads`, `open-settings` | Home header buttons |
  | `reader-back`, `reader-forward`, `reader-search`, `reader-bookmark`, `reader-text`, `reader-more` | reader toolbar (the header's back button is also labelled "Atrás") |
  | `find-previous`, `find-next`, `find-close` | find in page |
  | `popover-dismiss` | backdrop that closes a reader popover |
  | `tier-<slug>`, `pack-download` | collection tier card and its download button |
  | `resource-<id>`, `download-<id>` | catalog row and its download / open / pause button |
  | `lesson-<n>`, `lesson-check-<n>` | course lesson (1-based) and its done check |
  | `marker-name`, `marker-note` | fields of the place sheet |
| `marker-delete`, `region-delete`, `conversation-delete` | delete buttons in lists |
  | `house`, `books.vertical`, `map`, `graduationcap`, `sparkles` | tabs (SF Symbol ids, set by iOS) |
  | `BackButton` | the native header's back button |

- A control inside another button is invisible to VoiceOver and to Maestro (iOS merges it
  into the outer button). Put it beside the button instead: `ListRow` has
  `trailingAction` for that.
- Any screen opens directly with a deep link: `- openLink: nomadpocket:///library/resource/<id>`.
- iOS alerts keep the screen behind them in the hierarchy: if the alert's button has the
  same text as a control on screen, pick it by position relative to that control
  (`tapOn: { text: "Eliminar", above: { id: "marker-delete" } }`); `index` follows the
  position on screen, not the order things appeared.
- `hideKeyboard` can tap a link inside the web view; dismiss the keyboard by tapping a
  non-interactive text instead.
- Assistant flows assert structure (sources, buttons), never the answer text.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Simulator 'NP-e2e' not found` | `npm run e2e:setup` |
| A change in the app is not there | run with `--build` |
| Java / `JAVA_HOME` errors | `brew install openjdk`, or set `JAVA_HOME` |
| First flow times out on "Siguiente" | the simulator was cold-booting; run again |
| Many flows fail at random steps | close other simulators and heavy apps, and run again: Maestro waits for a calm screen, and a slow Mac makes it time out |
| `seeded` flows show an empty library | a fixture is missing: `npm run e2e:setup` |
| A `network` flow fails | check the server first (download.kiwix.org, build.protomaps.com) before suspecting the app |
