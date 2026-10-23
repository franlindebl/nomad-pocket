# Nomad Pocket — Architecture

Nomad Pocket is a standalone, offline-first mobile port of the ideas in
[Project N.O.M.A.D.](https://github.com/Crosstalk-Solutions/project-nomad): download
knowledge (Wikipedia, medicine, survival, books, courses), offline maps and a local AI
model once, then use everything with no connection.

| NOMAD (server) | Nomad Pocket (device) |
|---|---|
| Kiwix serve + `.zim` | `modules/nomad-zim` — libkiwix/libzim native, `zim://` WebView |
| Kolibri courses | Educational ZIMs + app-side course progress |
| Protomaps `pmtiles extract` | `src/lib/pmtiles` — HTTP-range extractor in TS, MapLibre Native |
| Ollama + Qdrant RAG | `modules/nomad-llm` (Apple Foundation Models / Gemini Nano) + `llama.rn` GGUF; RAG over libzim full-text search |
| Curated collections JSON | `src/data/catalog.json` + live Kiwix OPDS |
| Docker apps, benchmark | not applicable |

## Stack

- Expo SDK 58 (React Native 0.88, New Architecture, React Compiler), dev builds
  (Continuous Native Generation — `ios/` and `android/` are generated, never edited).
- Expo Router (`src/app`), native tabs (`expo-router/native-tabs`) and native stacks.
- State: `zustand`; persistence: `expo-sqlite` (tables) + `expo-sqlite/kv-store` (settings).
- Files: `expo-file-system` (`File`, `Directory`, `DownloadTask`).
- i18n: `i18next` + `react-i18next`, namespaces per feature in `src/i18n/locales/{es,en}`.
- Icons: `lucide-react-native`; tab bar uses SF Symbols / Material Symbols.
- Min OS: iOS 16.4 (Expo 58 floor), Android 8.0 (API 26).
- License: GPL-3.0 (required by libkiwix/libzim).

## Directory layout

```
src/
  app/                 routes (Expo Router). Only screens here.
    (tabs)/            native tabs: (home) library maps courses assistant — each a Stack
    reader/[itemId]    ZIM reader
    downloads.tsx      downloads sheet
    settings/          settings stack (modal)
    onboarding.tsx     setup wizard (full screen modal)
  components/ui/       design system (see docs/STYLE_GUIDE.md)
  components/navigation.ts  shared stack options (large titles)
  theme/               tokens + useTheme()
  i18n/                i18next setup, resources.ts registers namespaces
  db/                  SQLite schema + migrations (src/db/index.ts)
  lib/                 pure helpers: storage paths, formatting, pmtiles extractor
  stores/              global zustand stores (settings)
  features/
    bootstrap.ts       startup sequence
    registry.ts        side-effect imports: one line per feature registering handlers
    content/items.ts   installed content registry (items table) + useContent
    downloads/         download queue (DownloadTask), external jobs, UI rows
    catalog/           bundled catalog + Kiwix OPDS client
    library/           ZIM library: history/bookmarks, search, reader helpers
    maps/              regions, extraction jobs, markers, map style
    courses/           course enrolment, syllabus, progress
    assistant/         models, chat sessions, RAG
modules/               local Expo native modules (Swift/Kotlin)
  nomad-zim/           libkiwix bridge + ZimWebView (zim:// scheme handler)
  nomad-llm/           Apple Foundation Models + Gemini Nano bridge
docs/                  STYLE_GUIDE, ARCHITECTURE, PROGRESS
```

## Data model (SQLite, `src/db/index.ts`)

- `items` — installed content of every kind (`zim` | `map` | `model`), with file URI,
  size, catalog id, `is_course`, kind-specific `meta` JSON.
- `downloads` — persistent download queue with resume data.
- `history`, `bookmarks` — reader state per item/path.
- `courses`, `course_progress` — enrolled courses, syllabus and completed pages.
- `map_markers` — user pins.
- `chat_sessions`, `chat_messages` — assistant conversations with cited sources.

Add a migration by appending a SQL string to `MIGRATIONS` (never edit old ones).

## Cross-feature contracts

### Downloads (`src/features/downloads/manager.ts`)
- `enqueueDownload({ id, kind, title, url, filename, expectedBytes, meta })` — checks
  free space (`NotEnoughStorageError`), persists, runs ≤ 2 at a time.
- `registerCompletionHandler(kind, async (file, record) => …)` — called after the file
  is moved to `content/<kind>/filename`; must register the item via `upsertItem`.
- `startExternalJob({...})` — for non-URL jobs (map extraction) to appear in the
  downloads UI with progress and cancel.
- Hooks: `useActiveDownloads()`, `useDownload(id)`.

### Content registry (`src/features/content/items.ts`)
- `upsertItem`, `removeItem(id)` (deletes file + history/bookmarks/courses),
  `onItemRemoved(kind, hook)`, `useItems(kind?)`, `getItem(id)`.

### ZIM (`modules/nomad-zim`, wrapped by `src/features/library/zim.ts`)
- `openArchive(path) → ZimInfo`, `search`, `suggest`, `getArticleText`, `getMainPath`,
  `randomPath`, `excludeFromBackup`.
- `<ZimWebView archiveId path … />` serves `zim://<archiveId>/<path>` natively
  (WKURLSchemeHandler / `shouldInterceptRequest`).

### Maps (`src/lib/pmtiles`, `src/features/maps`, `src/app/(tabs)/maps`)

**Extractor** (`src/lib/pmtiles`, pure TS, no `@/` aliases so `node --test` loads it):
`readArchiveInfo`, `planExtract(source, { bbox, minZoom, maxZoom, overfetch, signal,
onProgress })` → `ExtractPlan` (exact archive size + download size; this *is* the
dry-run estimate), `executeExtract(source, plan, sink)`, `extract()` = both.
I/O is injected: `RangeSource` (`FetchSource` = HTTP Range with retries and ETag
pinning via `If-Match`; `BytesSource` for tests) and `Sink.write(offset, bytes)`
(app: expo-file-system `FileHandle`; tests: memory / `node:fs`).

How it works (same idea as `pmtiles extract`): bbox → Hilbert tile-id ranges per
zoom via quadtree descent (descendants of a tile form one contiguous id range, so
ranges are O(perimeter)); walk the root directory and fetch only the leaf
directories whose id span intersects the ranges (coalesced); collect entries,
deduplicate contents by source offset (keeps the output clustered), lay out
`header | root | metadata | leaves | tile data`, rebuild directories (root ≤ 16 KiB,
gzip via fflate) and coalesce tile byte ranges (merge smallest gaps while overfetch
≤ 5 %, requests ≤ 4 MiB). Tiles are written straight to their final offsets, so
downloads run 4 at a time out of order. Measured against build 20261023: world
z0–5 15 MB (2 s plan), central Madrid z0–15 10.7 MB, Comunidad de Madrid z0–14
58 MB, Spain z0–14 1.6 GB (plan 4 s, 2.9 MB of directories).

**Rendering**: MapLibre Native (iOS 6.31 / Android 13.6 via maplibre-react-native
11.5) reads local archives natively with `pmtiles://file:///…/x.pmtiles` — no
local tile server or protocol handler needed (verified on the iOS simulator; the
app opens no network sockets while rendering). Style = `@protomaps/basemaps`
`layers()` per source (light/dark from the app theme, labels in the app language);
the world basemap (`map-world`, z0–5) is the bottom source and each region gets its
own layer stack on top, so the map is never empty outside a region (duplicate
labels collapse through symbol collision). Glyphs (Noto Sans Regular/Medium/Italic,
ranges 0–1279, 7680–8703: Latin, Latin Ext, Greek, Cyrillic, punctuation) and v4
sprites ship as `assets/maps/basemap-assets.zip` (1.4 MB), unpacked once to
`Documents/map-assets/v1/` and referenced with `file://` URLs (MapLibre
percent-decodes the `Noto%20Sans%20Regular` fontstack path). `regions.json` and
the zip are regenerated with the scripts in `scripts/maps/` (Natural Earth +
basemaps-assets downloads). Screenshots: `docs/screenshots/maps-*.png`.

**Feature**: `regions.json` (312 regions: Natural Earth countries with far-flung
overseas territories trimmed from the bbox, 19 Spanish autonomous communities,
51 US states; ES/EN names, continent), `extraction.ts` (`latestBuild` from
`builds.json`, `estimateExtract` cached plans, `startMapDownload` → external job →
`content/maps/<key>.pmtiles` → `upsertItem({ kind: 'map', meta: { role, bbox,
minZoom, maxZoom, buildDate, regionId } })`), `markers.ts` (`map_markers`),
`store.ts` (persisted viewport + camera requests from sheets), `style.ts`,
`assets.ts`. Routes: `maps/index` (full-screen map), sheets `regions`, `pick`,
`download` (zoom 12/14/15 + exact size before confirming), `markers`, `marker`.

### Assistant (`modules/nomad-llm`, `src/features/assistant`, `src/app/(tabs)/assistant`)
- `modules/nomad-llm`: `getSystemModelStatus()` → `available | notEnabled |
  deviceNotEligible | modelNotReady | downloadable | unsupportedOS | unsupported`,
  `generate(requestId, { prompt, system?, temperature?, maxTokens? }, onDelta)`
  (events `onDelta {requestId, delta, reset?}` / `onDone` / `onError`), `cancel(id)`,
  `downloadSystemModel()` (Android). iOS weak-links FoundationModels.
- `models.ts`: curated GGUF list (id, pinned URL, exact bytes, min RAM, context),
  `recommendModel(ramGB)`. Items are `kind: 'model'`, id = model id;
  `useSettings.aiModelId` is a model id or `'system'`.
- `engine.ts`: `withEngine(modelId, engine => engine.generate({ system, messages,
  onText }))`, `stopGeneration()`, `releaseEngine()`. One engine alive at a time;
  released on background and after 4 idle minutes.
- `rag-core.ts` (pure, tested) + `rag.ts`: `retrieve(question, lang, budgetChars)`
  uses `search`/`getArticleText` from `features/library/zim.ts` only.
- `chats.ts`: sessions/messages persistence, `sendMessage`, `stopAnswer`, `useChat`.

### Feature registration
Each feature exposes `src/features/<name>/register.ts` that calls
`registerCompletionHandler`, `onItemRemoved` and `registerInit` (from
`features/bootstrap.ts`). `src/features/registry.ts` imports them.

## Storage layout

`Documents/content/{zim,maps,models,partial}` — documents dir, excluded from iCloud
backup on iOS (large, re-downloadable content). Downloads write to `partial/` then move.

## Content sources

- ZIM files: `download.kiwix.org` (mirrors via redirect), metadata from
  `library.kiwix.org/catalog/v2` (OPDS).
- Map tiles: daily planet build `build.protomaps.com/<YYYYMMDD>.pmtiles` (list at
  `build-metadata.protomaps.dev/builds.json`), extracted per region with HTTP Range.
  Fonts/sprites bundled in the app for offline labels.
- AI models: GGUF from Hugging Face; system models where available.
