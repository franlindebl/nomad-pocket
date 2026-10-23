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
| 0. Foundation (project, design system, nav, i18n, db, downloads core) | in progress |
| 1. Catalog + downloads UI + onboarding | pending |
| 2. ZIM library (native module, reader, search) | pending |
| 3. Maps (extractor, MapLibre, regions, markers) | done (iOS verified, Android compiles) |
| 4. Courses | pending |
| 5. Local AI (system + GGUF, RAG) | pending |
| 6. Polish, icon, builds on simulator/emulator | pending |

## Log

### 2026-10-24
- Analysed Project NOMAD source (admin/ AdonisJS app + collections JSON).
- Scaffolded Expo 58 app, design tokens + UI kit, navigation shell (native tabs),
  i18n (es/en), SQLite schema, content registry, download manager, settings screen,
  downloads sheet, home screen.

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

## Next steps

- Verify iOS + Android builds of the foundation.
- Spawn parallel work: ZIM native module, maps, AI, catalog data.

## Known issues / risks

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs in the JS thread while the app is in foreground.
