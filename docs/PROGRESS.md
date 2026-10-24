# Progress

Living document: current status, backlog, known issues and a dated log. Update it at
the end of every work block (status table, a log entry, next steps) so the next session
can pick up without re-deriving anything.

## Current state (2026-10-24)

- **Version 1.0.2 (iOS build 4)** prepared for TestFlight; **1.0.1 (build 3)** submitted
  to App Review. Release process and version table: `docs/RELEASE.md`.
- All four MVP modules plus onboarding work end to end on the iOS simulator (iOS 27,
  Release) and the Android emulator (API 36, release APK). iPad layout verified (visual
  tour). Not yet run on a physical device by the agent.
- Checks: 80 unit tests (79 pass, 1 network test skipped), `tsc` clean, lint clean, i18n keys complete. E2E: 40 Maestro flows (16 smoke,
  13 full, 8 nightly, iPad tour, 2 Android flows) covering 53 of 55 test-plan cases.

| Area | Status |
|---|---|
| Foundation (design system, nav, i18n, db, downloads core) | done |
| Catalog (101 resources, 6 categories, Wikipedia picker, Kiwix OPDS explore, Files import) | done |
| Downloads (queue, pause/resume, iOS background, fastest Kiwix mirror, Wi-Fi-only) | done |
| Onboarding (language → starter pack → tips) | done |
| ZIM library + reader (search, TOC, bookmarks, history, find, text size, dark mode) | done — iOS + Android |
| Courses (14 courses, syllabus with fallbacks, progress) | done |
| Maps (in-app PMTiles extraction, regions, visible area, world basemap, markers, GPS, multi-script labels) | done — iOS + Android |
| Assistant (Apple Intelligence / Gemini Nano / 4 GGUF models, RAG with citations) | done — iOS sim (Apple FM + llama.cpp), Android emulator (llama.cpp); Gemini Nano untested |
| Store (listing, screenshots, privacy site, in-app disclaimers) | done for iOS; Android not published |
| E2E suite (Maestro) + pre-commit hook | done |

## Decisions (kickoff 2026-10-24, by the owner)

- Standalone app (no NOMAD server), React Native + Expo, iOS + Android.
- MVP: ZIM library, offline maps, courses, local AI. UI + content in ES and EN.
- GPL-3.0 open source (libkiwix). Public GitHub repo `franlindebl/nomad-pocket`.
- Maps: in-app extraction from the Protomaps daily build (bbox/country).
- AI: system models (Apple FM / Gemini Nano) + downloadable GGUF via llama.rn.
- Courses: educational ZIMs + progress layer (Kolibri not in MVP).
- Name "Nomad Pocket", bundle id `com.fjlinde.nomadpocket`, iOS 16.4+ / Android 8+.
- Later: E2E suite run by hand (no CI, no E2E git hook), flows in Spanish; iPad covered
  by a visual tour; release builds uploaded locally with xcodebuild (no EAS).

## Next steps / backlog

Roughly by value. None is started.

1. Watch App Review for 1.0.1; upload 1.0.2 (build 4) to TestFlight if not done
   (`docs/RELEASE.md`), test it on a real iPhone (GPU llama.cpp, Apple Intelligence,
   background downloads, Files import, airplane mode).
2. Resume downloads after the app is killed on iOS: reattach the background URLSession
   (small native module) instead of restarting from zero.
3. Map extraction: resume after a kill (persist the plan + written ranges) and move it off
   the JS thread.
4. Android release: upload keystore, Play listing + data safety;
   test Gemini Nano on an AICore device.
5. Reader: auto-hiding toolbar on scroll (style guide), syllabus for SPA course ZIMs read
   from the rendered DOM.
6. Assistant: copy / regenerate an answer; better small-model citations.


## Known issues / limitations

- Downloads interrupted by app termination restart from zero unless paused first
  (expo-file-system tasks don't survive relaunch).
- Map extraction runs on the JS thread in the foreground (screen kept awake) and does
  not resume after the app is killed.
- Gemini Nano path compiled but untested on a real AICore device; its output-token limits
  are unverified.
- Qwen3.5 0.8B rarely emits `[n]` (all retrieved sources are shown then) and is
  unreliable for health answers — the app recommends 2B+ where RAM allows.
- Apple Intelligence fails on the iOS 26.5 simulator (works on iOS 27).
- Map labels in Bengali, Tamil and other Indic scripts, Myanmar and Khmer are not drawn
  (MapLibre Native can't shape them); country bboxes skip far-flung territories.
- ZIM media Range path untested with a real video archive.
- Not automated: importing a ZIM from Files (system picker) and true offline mode
  (simulator has no airplane mode); the Android tour covers visible-area map downloads but
  not the named-region picker or the assistant (both checked by hand on the emulator).

Build gotchas moved to `docs/DEVELOPMENT.md`.

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
- 36 Maestro flows cover 53 of the 55 cases of the functional test plan (Claude doc
  "Plan de tests funcionales iOS — Nomad App"). How to run and write them: `docs/E2E.md`
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
