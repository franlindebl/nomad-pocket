# Progress log

Living document: current status, decisions and next steps. Update at the end of
every work block so work can resume after context compaction.

## Decisions (kickoff 2026-10-24)

- Standalone app (no NOMAD server), React Native + Expo, iOS + Android.
- MVP: ZIM library, offline maps, courses, local AI. UI + content in ES and EN.
- GPL-3.0 open source (libkiwix). Public GitHub repo `franlindebl/nomad-pocket`.
- Maps: in-app extraction from Protomaps daily build (bbox/country).
- AI: system models (Apple FM / Gemini Nano) + downloadable GGUF via llama.rn.
- Courses: educational ZIMs + progress layer (Kolibri not in MVP).
- Name "Nomad Pocket", bundle id `com.fjlinde.nomadpocket`, iOS 16.4+ / Android 8+.

## Phase status

| Phase | Status |
|---|---|
| 0. Foundation (project, design system, nav, i18n, db, downloads core) | done — iOS/Android builds OK |
| 1. Catalog + downloads UI + onboarding | done |
| 2. ZIM library (native module, reader, search) | done (iOS verified, Android compiles) |
| 3. Maps (extractor, MapLibre, regions, markers) | done (iOS verified, Android compiles) — merged |
| 4. Courses | UI + progress done (needs ZIM module for syllabus) |
| 5. Local AI (system + GGUF, RAG) | pending |
| 6. Polish, icon, builds on simulator/emulator | pending |

## Log

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

## In flight (parallel agents, git worktrees — merge into main when done)

- ZIM agent (worktree branch): `modules/nomad-zim`, `src/features/library/{zim,register}.ts`, reader + `/search` screens, `reader` i18n ns.
- AI agent (worktree branch): `modules/nomad-llm`, llama.rn, `src/features/assistant`, assistant tab, `assistant` i18n ns.

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
- Verified: iOS Release simulator build with a real ZIM; Android `assembleDebug` compiles.

## Next steps

- Merge agent branches (expect small conflicts in package.json, app.json, resources.ts, registry.ts).
- Full iOS + Android builds after merge; run on simulator + emulator; screenshots.

## Known issues / risks

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs in the JS thread while the app is in foreground.

## Build gotchas

- **xcodebuild hangs at "Resolve packages"** (MapLibre SPM binary): SwiftPM waits on a
  macOS Keychain prompt for github.com credentials. Always pass
  `-packageAuthorizationProvider netrc`; for `swift package` use `--disable-keychain`.
- Android builds need `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- UI automation: `axe` (brew cameroncooke/axe) for the iOS simulator; `adb shell uiautomator dump` + `input tap` on Android.
- Tests: `npm test` (node --test with type stripping; import with `.ts` extensions, no `@/` aliases).
- Catalog check: `node scripts/validate-catalog.mjs` (`--offline` to skip URL checks).
