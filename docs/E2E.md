# E2E functional tests (iOS simulator)

Maestro flows that drive the Release build on an iOS simulator. The full test plan
(case catalog, priorities, roadmap) lives in the shared doc "Plan de tests funcionales
iOS — Nomad App"; case ids (`RDR-03`, `MAP-06`…) are quoted at the top of each flow.

## Run

```bash
npm run e2e                          # smoke: P0, no network (~10 min)
npm run e2e:full                     # smoke + full
scripts/e2e.sh --tags nightly        # P2: real downloads (Kiwix, Protomaps), Apple Intelligence
scripts/e2e.sh e2e/flows/reader      # one area, or any flow files
```

Results go to `e2e/artifacts/<timestamp>/<flow>/`: `report.xml` (JUnit), the flow's
screenshots, `maestro.log`, and `debug/` (commands + screenshot at the failing step).

## Setup (once)

- Maestro CLI (`brew install mobile-dev-inc/tap/maestro`) and a Java runtime; the script
  falls back to Homebrew's `openjdk` when `java` is missing.
- Simulator `NP-e2e`: iPhone 17 Pro, iOS 27.0 (Apple Intelligence works there, not on
  26.5), language `es-ES`. Create it with:
  ```bash
  U=$(xcrun simctl create NP-e2e com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
  xcrun simctl boot $U
  xcrun simctl spawn $U defaults write "Apple Global Domain" AppleLanguages -array es-ES
  xcrun simctl spawn $U defaults write "Apple Global Domain" AppleLocale -string es_ES
  xcrun simctl shutdown $U
  ```
- Release simulator build at `ios/build/sim/…/NomadPocket.app` (built by the script when
  missing; set `APP=` to use another).
- Fixtures in `e2e/fixtures/` (gitignored, from `download.kiwix.org`):
  `wikipedia_en_100_mini_2026-01.zim`, `devdocs_en_node_2026-08.zim`,
  `freecodecamp_es_all_2026-10.zim` (course), `nhs.uk_en_medicines_2026-09b.zim` (medical).

## How a run works

Each flow gets a fresh install (`simctl uninstall/install`), location permission granted
and a simulated position (Madrid). Flows tagged `seeded` get the fixtures cloned into
`Documents/content/zim/`, which the app registers at startup
(`src/features/library/register.ts`). Every flow starts with `subflows/launch.yaml`, which
walks the setup wizard without downloading ("Lo elijo yo").

## Writing flows

- Tags: `smoke` (P0, no network), `full` (P1), `nightly` (P2: network / AI), plus the area
  (`reader`, `maps`…), plus `seeded` / `network` for what the flow needs.
- Tabs by SF Symbol id: `house`, `books.vertical`, `map`, `graduationcap`, `sparkles`.
- Cards and rows expose one merged accessibility label (`"Lo elijo yo, Empieza vacío…"`):
  match them with a regex (`"Lo elijo yo.*"`).
- The reader has two "Atrás" buttons: index 0 is the header, index 1 the history toolbar.
- `hideKeyboard` can tap a link inside the web view; dismiss the keyboard by tapping a
  non-interactive text instead.
- Assistant flows assert structure (sources, buttons), never the answer text.
- A few steps tap by position (`point:`) because nested buttons are not reachable through
  accessibility; they are marked in the flow and go away once those controls get `testID`s.
