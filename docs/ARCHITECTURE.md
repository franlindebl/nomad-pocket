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
