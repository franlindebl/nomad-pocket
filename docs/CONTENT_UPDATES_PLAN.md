# Content updates: tell the person their data is old, and update it safely — plan

Owner request (2026-10-31): nothing told the person that their downloaded content (maps, guides,
Wikipedia, courses) had newer versions. Show it, let them download the new one, and when there is
room keep the old copy until the new one is in (never left without data); when there isn't, the
only way is to delete first and download, with the risk that brings. Approved the same day.

## What was there (code as of e446234)

- **Countries (map + routing pack): detected, hidden.** `useCountries()` sets `update` when the maps
  or routing catalog has a newer build (`isNewer`) or a pack this app's Valhalla can't read
  (`packOutdated`). "Mis mapas" shows "Hay un mapa más reciente" and a ⟳ button
  (`downloadCountry(…, { update: true })`, only the outdated pieces). Home's map card warns when
  there is any update or the data is over 6 months old. Catalogs are rebuilt monthly (the 5th).
- **ZIM archives: nothing.** `downloadResource` asks Kiwix's OPDS for the newest file at download
  time, but once installed the button says "Abrir" for good. Replacing works already:
  `registerZimFile` registers the new file under the same id and deletes the previous one only
  after the new one is in; bookmarks, history and course progress hang off the id and stay.
- **AI models**: no versions (GGUF files never change; Apple's model updates with the OS). Out.

## Decisions

1. **"Newer version exists", not "older than a month".** Kiwix only publishes when the source
   changes: the bundled catalog pins files from 2024-08 that are still the newest. Maps get a new
   build every month, so a one-month rule would warn forever about small OSM changes.
2. **Two levels.**
   - *Quiet*: any newer version shows on the item's row (Library, Courses, "Mis mapas") and in
     the "Actualizaciones" sheet (`/updates`), reachable from Downloads and Library.
   - *Proactive*: a card on Home when an update is **urgent**: the installed data is
     ≥ 3 months old and a newer version exists, or a routing pack this app can't read.
     Only shown online (offline there is nothing to do about it). Home's map card warns on
     the same rule (or data over 6 months old, as before) instead of on every monthly build.
3. **Never downloaded without asking.** iOS pauses the download manager in the background and
   multi-GB downloads on mobile data are unwelcome. One tap ("Actualizar todo") does all of it;
   an automatic "update on Wi-Fi" switch can come later, off by default.
4. **With room: download, then swap** (what the code already does). "Actualizar todo" starts what
   fits and starts the rest as earlier updates finish and free their old copy: the peak is about the
   biggest update, not the sum of all of them. Priority: urgent first, then smallest first.
5. **Without room: delete first, only on purpose.** Per item, from the sheet:
   - First offer the alternative: free space elsewhere (Settings › Storage).
   - "Borrar y descargar" is destructive, with a confirmation that says the item is unusable
     until the download finishes and lost if it fails.
   - Checked before deleting anything: a connection the download may use (Wi-Fi, or mobile data
     with "Solo Wi-Fi" off), the new file reachable (ZIM: OPDS answers again and the file URL
     answers a HEAD; country: both catalogs refresh), and that deleting the old copy makes room
     (else: "you need X free", nothing deleted).
   - Deletes only the outdated pieces (a country's outdated map or pack, not the whole country),
     keeping user data (`removeItem(id, { keepUserData: true })`): bookmarks, history and
     course progress come back with the new version.
   - Never offered while that item is downloading.
6. **Checking ZIM versions**: one OPDS request (two for flavoured names) per installed archive,
   at most once a week, in the background a few seconds after launch when online; "Buscar
   ahora" in the sheet forces it. Results live in kv (`updates.zim`). Archives without a Kiwix
   name (imports of unknown files, uuid ids) are skipped. Android never offers health archives
   (`HEALTH_FEATURES`, `docs/ANDROID_PLAY.md`).
7. **Privacy policy**: say that the app asks Kiwix's catalog weekly for the newest version of the
   archives installed (their names only).

## Design

- `src/features/updates/updates-core.ts` (pure, tested): data age in months from `YYYY-MM`,
  `YYYY-MM-DD` or `YYYYMMDD`; `isUrgent`; check due; ordering; one step of the "update all" run
  (which to start, which are done, which can't fit without deleting); room after freeing.
- `src/features/updates/zim-check.ts`: the weekly OPDS check, its kv state and store.
- `src/features/updates/updates.ts`: `collectUpdates()` (ZIM + countries, from the stores, no
  React), `useUpdates()`, `startUpdate`, `updateAll` (the run, subscribed to downloads and
  content), `deleteAndUpdate` (the preflight + delete-first path).
- `src/features/updates/register.ts`: the startup check (and on foreground, throttled).
- Countries: `buildCountries()` factored out of `useCountries()` so the run can read them outside
  React; `CountryState.incompatible`; `countryInFlight()`; `outdatedPieces()`.
- UI: `/updates` form sheet (rows, "Actualizar todo", last check, "Buscar ahora"), a card on Home
  (urgent), a row in Downloads, a badge on Library and Courses rows.

## Phases

1. Plan (this doc). **Done 2026-10-31.**
2. Core + ZIM check + updates list + "Actualizar todo" run + `/updates` sheet + Library/Home/
   Downloads entry points + delete-first flow + privacy policy. **2026-10-31 (see PROGRESS).**
3. Later: optional "update automatically on Wi-Fi"; a notification when an urgent update is found
   (needs the background fetch the app doesn't have); E2E flow (needs an outdated archive fixture).

## Risks

- A new ZIM edition may move articles: a bookmark or a course lesson can point to a path that is
  gone. The reader already handles a missing path (not found page); acceptable.
- A map update re-runs its preparation (search index, side files): minutes on a big country.
- Peak space of a multi-part map update: old map + parts + assembled copy (~3× the map).
  `countryNeed` counts it, so the room checks are right; the sheet shows "needs X free".
