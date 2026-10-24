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
| 2. ZIM library (native module, reader, search) | done — iOS + Android verified |
| 3. Maps (extractor, MapLibre, regions, markers) | done — iOS + Android verified |
| 4. Courses | done (syllabus from static main-page links; SPA courses fall back to free exploration) |
| 5. Local AI (system + GGUF, RAG) | done — verified on iOS sim (llama.cpp CPU, Apple FM, RAG with citations) |
| 6. Polish, icon, builds on simulator/emulator | in progress |

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

## Next steps

- Smoke-test the merged build on iOS simulator + Android emulator (all tabs).
- Nice to have: reader TOC + auto-hiding toolbar; copy/regenerate in chat; map
  extraction resume after kill; syllabus for SPA course ZIMs (read links from the
  rendered DOM); Gemini Nano test on a real device; store submission assets.

## Known issues / risks

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs in the JS thread while the app is in foreground.
- llama.rn's `stopCompletion()`/`release()` may not return promises — don't chain `.catch`.
- Gemini Nano path compiled but untested on a real AICore device.

## Build gotchas

- **xcodebuild hangs at "Resolve packages"** (MapLibre SPM binary): SwiftPM waits on a
  macOS Keychain prompt for github.com credentials. Always pass
  `-packageAuthorizationProvider netrc`; for `swift package` use `--disable-keychain`.
- Android builds need `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- UI automation: `axe` (brew cameroncooke/axe) for the iOS simulator; `adb shell uiautomator dump` + `input tap` on Android.
- Tests: `npm test` (node --test with type stripping; import with `.ts` extensions, no `@/` aliases).
- Catalog check: `node scripts/validate-catalog.mjs` (`--offline` to skip URL checks).
