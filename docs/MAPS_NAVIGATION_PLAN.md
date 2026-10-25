# Maps: search, emergency places and navigation — plan

Approved by the owner on 2026-10-25. Goal: Google Maps / Waze-like search and navigation
(on foot and by car) that works with no connection, plus quick access to what matters in
a real crisis (hospitals, police, Guardia Civil, fire stations, barracks, water, shelters).
Status lives in `PROGRESS.md`; how the shipped parts work in `ARCHITECTURE.md` (Maps).

## Decisions

| Question | Decision |
|---|---|
| Own hosting for routing data? | Yes: static files built in CI and published as **GitHub Release** assets (no user data; the only exception to "no custom backend") |
| Overpass (public OSM servers) at region-download time? | Yes (ODbL; attribution already shown) |
| Show military sites? | Yes (public OSM data) |
| Order | Phase 1 now; Valhalla spike in parallel |

Not possible offline, by nature: live traffic, user reports (Waze). Fixed speed cameras
are in OSM (Protomaps POI kind `speed_camera`) if ever wanted.

## What the existing data gives (measured on build 20261024)

- Protomaps z15 tiles carry rich POIs with names: hospital, clinic, doctors, pharmacy,
  police, fire_station, drinking_water, water_point, shelter, fuel, supermarket,
  townhall, military… but almost all with `min_zoom` 15–17, so they exist only in z15
  extracts (the "Máximo" detail level). z12/z14 downloads have only the big ones.
- Roads have `kind`, `kind_detail`, `oneway`, `access`, `name`, but no turn restrictions,
  no speed limits, and topology cut per tile: fine for drawing, not for car routing.
- No house numbers in the tiles.

## Phase 1 — shipped 2026-10-25 (no own hosting)

1. **Offline search**: FTS5 index of each installed map (places, named POIs, streets),
   saved places, coordinates (decimal, DMS, UTM). No house numbers (phase 2 packs could add
   them).
2. **Emergencias**: red button on the map and a Home card. Call 112/911, share position
   (decimal + UTM + link, works by SMS without data), position card for rescuers, five
   categories sorted by distance with direction, police force (Guardia Civil / Nacional /
   Local / autonómica), ER badge, phone, hours. Data: Overpass per region at download time
   (or from the sheet), tile POIs as offline fallback. Map layer with category colours.
3. **"Llévame" in a straight line**: compass arrow, distance, walking time, accuracy;
   works anywhere, even without map data. Clearly labelled as a straight line.

Measured: Overpass for the Comunidad de Madrid = 15k points, 1.2 MB, ~60 s; a 3°×3° cell
over central Spain = 25k points, ~60 s (Spain ≈ 15 cells ≈ 15 min in the background).
Finding during testing: the main Overpass server was **at capacity** for several minutes
("this public endpoint is intended for browser-based and human-operated tools"). The app
copes (3 servers, timeouts, tile fallback), but see phase 2.

## Phase 2 — road routing on the device (built and packs published 2026-10-25)

Status: engine, packs, catalog and downloads work end to end on the iOS simulator and the
Android emulator (Andorra pack; E2E `map-14-route`, `map-15-routing-download`). What it
does: car / foot / bike routes with Spanish or English maneuvers, route line, next
maneuver + distance, remaining distance / time / arrival, directions list, reroute when off
the route, straight-line fallback with "Descargar rutas", packs with their emergency
points (no Overpass needed where a pack is installed). How: `ARCHITECTURE.md` (Maps →
Routing). Pending:

- **First packs** (2026-10-25, run 40186942180): Portugal and Andorra published; Spain
  built fine but its upload failed on an empty `es-cn.pois.tsv` (Geofabrik's Spain leaves
  out the Canary Islands, so that slice was empty). Fixed: Canarias is its own
  `packs.json` entry (`africa/canary-islands`), empty slices and point files are dropped,
  and subdivision coverage is clipped to the region's bbox (ferry lines). Re-run
  40198385548 published Spain, its 16 slices and Canarias: 22 packs live.
- Not measured on a phone: route time and memory, assembling a 2 GB pack (JS copy).
- Isochrones: neither valhalla-mobile wrapper exposes them (iOS would need Valhalla
  headers in our code, which broke tile reading: see CLAUDE.md pitfalls).
- Routes between two packs need the country pack (region packs are tile subsets).
- Overpass still runs after each map download, even where a pack already brought the points.


- **Engine: Valhalla** (MIT, OSM), embedded through a local Expo module
  (`modules/nomad-route`) — prebuilt mobile builds exist (Rallista `valhalla-mobile`:
  SPM / Maven). Gives car / foot / bike / motorbike costing with one-ways and turn
  restrictions, Spanish and English maneuver instructions, alternatives, **avoid areas**
  (`exclude_polygons`: a closed road or a flooded zone) and **isochrones** ("hospitals
  within 20 min on foot").
- **Data: per-region routing packs** built monthly by GitHub Actions from Geofabrik
  extracts and published as GitHub Release assets (2 GiB per asset; split big countries),
  downloaded through `features/downloads/manager.ts` as a new content kind.
- **Same pipeline for emergency points** (osmium tags-filter → compact file per region):
  removes the dependency on public Overpass servers; Overpass stays as a fallback.
  House numbers for address search can ship in the same packs.
- Rejected: GraphHopper (Java, Android only), OSRM (server-sized RAM), routing over the
  Protomaps tiles (no turn restrictions, guessed topology), the Organic Maps / CoMaps
  engine (a whole app with its own map format). A pure TypeScript router over a
  contraction-hierarchy graph built in CI is the fallback if embedding Valhalla fails.

Spike results (2026-10-25): viable — see "Valhalla spike" below.

## Pack coverage roadmap (agreed 2026-10-25)

Today only `es` (+ regions), `es-cn`, `pt`, `ad` have packs (`scripts/routing/packs.json`); everywhere else
"take me there" stays on the straight line (maps, search and Emergencias work worldwide).
Adding a country is one entry in `packs.json` (Geofabrik path + ISO code); the app picks it
up from the manifest with no app release. Order the owner agreed:

1. **Calibrate** — done with the first run (GitHub runner, `CONC=4`): Spain 25 min for
   the whole job (build + 17 slices + points), country tar 2.19 GB (2 parts), slices 8 MB
   (Ceuta) to 745 MB (Castilla y León); Portugal 10 min, 582 MB; Andorra 3 min, 3 MB;
   Canarias (local) 77 MB. Plenty of headroom for most European countries.
2. **Prune old releases** — done: the `publish` job deletes every `routing-YYYYMMDD-N`
   release that neither the new manifest nor the previous one points at.
3. **Europe + Latin America** (Spanish-speaking audience first).
4. **Rest of the world**, with big countries built from Geofabrik sub-extracts.

Limits to design around:

- GitHub-hosted runner: 4 vCPU, 16 GB RAM, ~14 GB on `/` + `/mnt`; job timeout is 300 min
  (GitHub's cap is 6 h). USA, Russia, Canada, Brazil, Germany, France, likely India and
  China won't fit as one build: build per sub-extract (US states, Länder, French regions…).
  A sub-extract is a `packs.json` entry whose id is a subdivision of
  `src/features/maps/regions.json` (like `es-cn`): `geofabrik` is its own extract, `iso`
  the country's (for admin boundaries), and the country's build skips that slice.
- Release assets: 2 GiB per file (already split, ≤1900 MiB parts) and 1000 assets per
  release. A world run (tar parts + `.pois.tsv` per pack) gets close: publish one release
  per continent (the manifest already stores a `release` per pack).
- Matrix: `max-parallel: 3` today; raise it for the world run (free runners allow ~20
  concurrent jobs on a public repo). Monthly cron is `0 3 5 * *`.
- Routes across a border need both ends in one pack (region packs are tile subsets of
  their country; there are no cross-country packs).

## Phase 3 — turn-by-turn navigation

Maneuver banner, distance and ETA, camera following the course, rerouting offline when
more than ~30 m off the route, voice with `expo-speech` (system voices work offline),
background location (iOS `UIBackgroundModes: location` with an App Review purpose string;
Android foreground service). Navigation logic either as a pure, tested TypeScript module or
Ferrostar (BSD-3, Rust core with Valhalla support) — decided after phase 2. Out of scope:
CarPlay / Android Auto, live traffic.

## Valhalla spike (2026-10-25, desktop measurements)

**Verdict: viable** for car, foot and bike. Valhalla 3.9.1 (`ghcr.io/valhalla/valhalla:3.9.1`),
no elevation.

| | Comunidad de Madrid | Spain |
|---|---|---|
| Geofabrik PBF | 85 MB | 1.50 GB |
| Routing tiles as `.tar` | 150 MB | 2,189 MB (2.04 GiB: **just over the 2 GiB Release asset limit**) |
| `.tar.zst -19` / `.tar.gz -9` | 47 / 55 MB | 777 / 880 MB |
| Tile build | 15–33 s | 6–8 min at 4 CPUs (est. 10–15 min on a GitHub runner with the download) |
| Peak memory / disk | 1.4–2 GB / 0.6 GB | ~7.6 GB incl. page cache (18 threads in 8 GB: OOM) / ~10 GB |

- **No unpacking on the device**: Valhalla mmaps tiles straight from an uncompressed tar
  (`tile_extract`); a tar without `index.bin` and concatenated tars (`tar -A`) both load.
  Service RSS ~90 MB anon (+ clean mmapped pages); lower `max_cache_size` on mobile.
- **Functional** (Madrid tar): auto Sol → La Paz 9.0 km / 12.8 min, pedestrian 8.2 km,
  bicycle 9.2 km; Spanish narrative ("Gire a la derecha hacia Gran Vía.", "Ha llegado a su
  destino."); `exclude_polygons` detours; pedestrian isochrone ~10 ms, auto 15 min
  ~140 ms; routes 10–15 ms warm, 60–260 ms cold; country-length routes on the Spain tar
  40–100 ms. `format: osrm` returns Spanish banner and voice instructions.
- **Admin boundaries are required** (`drive_on_right`, country access rules: Collado
  Villalba → Aranjuez 125.2 km without vs 114.9 km with) and **Geofabrik extracts can't
  provide them** (clipped relations). Tested fix: Spain + `admin_level=4` boundaries from
  Overpass → `osmium cat` → `valhalla_build_admins` (21 areas, 21 MB sqlite) passed as
  `mjolnir.admin`.
- **Pack design**: separately built packs break at borders and can't be merged (same tile
  ids, different content; Sol → Segovia 74 km/168 min on Madrid-extract tiles vs 90.8 km/
  58 min on Spain tiles). Build **per country** in CI and cut region packs as **tile
  subsets** of that build: Madrid + Castilla y León slices concatenated routed Sol →
  Valladolid exactly like the full Spain tar (210.4 km / 119 min). Madrid slice: 242 MB
  tar / 80 MB zstd (bigger than the Madrid-only build because it keeps whole border tiles).
- **2 GiB limit** options: split the raw tar (`split -b 1900M`) and let the download
  manager append the parts (simplest, byte-identical); ship `.tar.zst` and decompress
  natively (needs zstd + ~3 GB temp); or ship per-community packs only.
- **CI caveats**: `valhalla_build_tiles` 3.9.1 segfaults intermittently ("Enhancing local
  graph", 3 of ~12 runs; always with `admin: ""`): retries, concurrency ≤ 4, pass
  non-existent paths instead of `""`, free runner disk, pin builder = runtime version.
- **Mobile library: Rallista `valhalla-mobile` 0.6.4** (MIT, 2026-10-06, bundles Valhalla
  3.9.1; bus factor ≈ 1). iOS: SPM only, but the release ships a static xcframework
  (device arm64, simulator arm64 + x86_64, iOS 16.4) with headers → vendor it in a podspec
  like libkiwix (postinstall fetch + sha check), own `.mm`, copy `tzdata.tar` (1.4 MB).
  Android: Maven Central AAR (arm64-v8a 7.5 MB, x86_64, minSdk 24, 16 KB aligned). App size
  ≈ +7 MB per platform. API: config path + request JSON → response JSON, synchronous, not
  concurrent (16 MB-stack thread). Exposes route / trace / height / matrix but **not
  isochrone**: callable from our own iOS wrapper (symbols present); Android needs an
  upstream PR or our own NDK build. No real symbol clashes with CoreKiwix (shared weak
  libc++ templates). All linked licenses (MIT, BSD, Apache-2.0, BSL-1.0, zlib) are
  GPL-3.0-compatible; OSM data ODbL (attribution).
- **Ferrostar** 0.59.0 (BSD-3, pre-1.0, weekly breaking releases): its React Native
  packages are **not on npm**; a custom offline route provider could take Valhalla's OSRM
  output. Not now — start with route preview + our own TS navigation logic, revisit later.

Not yet measured: speed and memory on a phone.

### Proposed phase 2 steps (done, except publishing and isochrones)

1. `modules/nomad-route` (iOS xcframework vendored, Android Maven) with `route` and a
   route preview drawn in MapLibre; test with the Madrid tar copied into `content/`.
2. CI workflow (GitHub Actions, monthly): per country — Geofabrik PBF + Overpass admins →
   tiles → region slices (CCAA, US states) → split parts ≤ 1.9 GB → GitHub Release; plus a
   compact emergency-points file per region from the same PBF (osmium tags-filter).
3. Catalog of routing packs in the app (size, date), downloads through the manager, tars
   concatenated per device, "avoid area" and isochrones (iOS first).
