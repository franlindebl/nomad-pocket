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
| 2. ZIM library (native module, reader, search) | done (Android runtime untested) |
| 3. Maps (extractor, MapLibre, regions, markers) | pending |
| 4. Courses | pending |
| 5. Local AI (system + GGUF, RAG) | pending |
| 6. Polish, icon, builds on simulator/emulator | pending |

## Log

### 2026-10-24
- Analysed Project NOMAD source (admin/ AdonisJS app + collections JSON).
- Scaffolded Expo 58 app, design tokens + UI kit, navigation shell (native tabs),
  i18n (es/en), SQLite schema, content registry, download manager, settings screen,
  downloads sheet, home screen.

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

- Verify iOS + Android builds of the foundation.
- Spawn parallel work: ZIM native module, maps, AI, catalog data.

## Known issues / risks

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs in the JS thread while the app is in foreground.
