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
| 1. Catalog + downloads UI + onboarding | library UI done; catalog data + onboarding in progress |
| 2. ZIM library (native module, reader, search) | pending |
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

## In flight (parallel agents, git worktrees — merge into main when done)

- Catalog data agent (main tree): `src/data/catalog.json`, `scripts/validate-catalog.mjs`, `src/features/catalog/opds.ts` (+test).
- ZIM agent (worktree branch): `modules/nomad-zim`, `src/features/library/{zim,register}.ts`, reader + `/search` screens, `reader` i18n ns.
- Maps agent (worktree branch): `src/lib/pmtiles`, `src/features/maps`, maps tab, `maps` i18n ns.
- AI agent (worktree branch): `modules/nomad-llm`, llama.rn, `src/features/assistant`, assistant tab, `assistant` i18n ns.
- Me (main): courses tab + progress, onboarding wizard, home polish, app icon.

## Next steps

- Merge agent branches (expect small conflicts in package.json, app.json, resources.ts, registry.ts).
- Full iOS + Android builds after merge; run on simulator + emulator; screenshots.

## Known issues / risks

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs in the JS thread while the app is in foreground.
