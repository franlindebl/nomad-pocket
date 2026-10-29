# Routes across routing packs

Status: **stitching on main since bdc1fae (2026-10-28)**: crossings in CI, stitching in the app, E2E
`map-19-stitch`, measured on the simulator (below). It reaches people with the first `country-packages.yml`
run that publishes the crossings files and an app build from bdc1fae on. Owner's
decisions (2026-10-28): no paid build machine (open source, no income), so the one-graph design below is
shelved; instead

1. **Between countries and between US regions: legs across the border, stitched** into one route the
   person can't tell apart from a route inside one country (one line, one list of manoeuvres, one ETA,
   voice and rerouting as usual). The border crossing must be on a main road (never a track), and the best
   one is chosen by trying the combinations and adding up the times (across several countries too), not
   the first one found. The US stays split for map and routing as today.
2. **Compressed routing packs** (`.gph.gz` tiles in a `tile_dir`, spike 1: 2.3× smaller): on hold.
   The owner's concern: no temporary space the phone may not have, and the size announced must
   be the size used. Note: the phone never decompresses to disk (Valhalla reads the `.gz` tiles
   in memory), so the space used equals the download; splitting the tar into tile files can go
   part by part (at most one part, ≤ 1.9 GB, of extra room).
3. All tests on the simulator (owner).

The one-graph spike stays documented below: it is the right design if a free big machine
ever appears.

## Stitched routes across packs (chosen design)

### Spike 2 (2026-10-28, desktop, Valhalla 3.9.1): stitching matches the best route

Galicia and Portugal built **separately** (as today's packs), against the one-graph build of
spike 1 as the true best route. Road crossings of Portugal's land border taken from OSM
(77: 12 motorway, 1 trunk, 19 primary, 12 secondary, 33 tertiary). For a trip, every
crossing allowed for the costing (car: motorway…secondary; bike and foot: primary…tertiary,
no motorway or trunk) is tried: a one-to-many matrix in the origin's pack, a many-to-one
matrix in the destination's pack, the sum of both times, and the minimum wins. Then one
route per leg, the crossing as the seam with the heading of travel.

| Car | Best (one graph) | Stitched | Crossing chosen |
|---|---|---|---|
| Santiago → Porto | 135 min, 231.4 km | 135 min, 231.4 km | A-55 |
| Ourense → Lisboa | 279 min, 522.6 km | 279 min, 522.6 km | A-55 |
| A Coruña → Faro | 447 min, 849.4 km | 447 min, 849.4 km | A-55 |
| Lugo → Bragança | 174 min, 219.1 km | 174 min, 219.1 km | OU-311 (secondary) |
| Ourense → Chaves | 57 min, 97.1 km | 57 min, 97.1 km | A-24 |
| Ribadavia → Melgaço | 31 min, 34.3 km | 31 min, 36.6 km | PO-405 |
| Porto → Santiago | 141 min, 238.3 km | 141 min, 238.3 km | A-55 |

By car all 8 trips match (−0.6…0.0 %). Bike and foot: equal in 11 of 16 trips, up to +8 %
where the best route crosses on a local road the rule leaves out, and in two trips the
stitched route is even 9–10 % faster (Valhalla's long bike/foot searches are not exact).
Matrices take 0.1–0.25 s by car and 1–2 s by bike/foot on the desktop (18–27 crossings); the
two legs 10–90 ms. The seam is exact (0 m gap, same heading): dropping leg 1's "arrive"
and folding leg 2's "depart" into the manoeuvre before it leaves no trace.

Findings that shape the code:

- **One bad location fails the whole matrix** (170/171: a crossing outside one of the packs,
  or on an island of the graph). Candidates are filtered by both packs' coverage first, and
  a failing matrix is halved until the bad crossing is isolated and left out.
- Valhalla's default matrix limits (bike/foot 200 km) must be raised in our config.

### Built and measured (2026-10-28)

Simulator (iPhone 17 Pro, iOS 27, Release), Galicia and Portugal packs built apart and seeded with their
crossings files from `crossings.py`:

| Trip | Mode | Result | Time to compute |
|---|---|---|---|
| Santiago → Porto | car | 234 km, one route through Valença | 0.3 s |
| Santiago → Porto | foot | 42 h | 1.7 s |
| Ourense → Lisboa | car | 4 h 39 min (= one graph) | 0.5 s |
| Ourense → Lisboa | bike | 533 km (one graph: 529 km) | 1.8 s |
| Off the route near Cuntis, before the border | car reroute | leg to the same crossing only | 16–18 ms |

The simulator runs on the Mac's CPU: a phone will be slower. One fix it needed: Valhalla's
`max_matrix_distance` is also where the matrix search stops, and at 500 km a 472 km bike leg came back
empty; it is now 2000 km by bike and 1000 km on foot.

With the published packs (2026-10-29: catalog of run 40691060942, 165 of 237 packs with crossings),
downloaded in the app from GitHub on the same simulator: Luxembourg city → Brussels, `route-lu → route-be`:

| Mode | Result | Time to compute |
|---|---|---|
| car | 213 km, 1 h 58 min, one list of directions with one arrival | 0.5–1.4 s |
| foot | 213 km, 41 h 52 min | — |
| bike | stitched, 50 161 s | 3.0 s |
| car, navigating, moved off the route north of the city | rerouted, 221 km | 28 ms |

That test found the offer of the missing download wrong: with the destination's country installed, the
guidance panel's "Descargar la navegación de este país" offered that country again (0 MB) instead of the
origin's. It now offers the first country the trip lacks: the destination's, the origin's, then one on the
straight line between them (`packToFetch`, routing-core.ts).

Left: Android, ferries as crossings (Spain–Morocco, UK–France: no road crosses there).

### Data (CI)

- `scripts/routing/crossings.py`: every crossing of the pack's border by a road from
  motorway to tertiary, from the pack's extract and the admin boundaries the build already
  fetches: `<pack>.crossings.tsv` (lat, lon, class, bearing leaving the pack, `both|in|out`
  for one-way roads, ref). A few KB per pack. The border of a US region is the outline of
  its states (level 4).
- The manifest lists it as a side file of the pack (`crossings`), downloaded with it.

### App

- `routing-core` (pure, tested): parse crossings; candidates between two packs for a
  costing and direction (allowed classes, one-way direction, inside both coverages); the
  pack chain (installed packs as a graph joined by crossings; up to 4 packs); the best
  crossing combination (layer by layer: origin → crossings A|B → crossings B|C → … →
  destination, adding times, minimum wins); joining the legs into one `Route` (shape,
  manoeuvres with the seam folded, distance, time, bbox, toll/highway/ferry flags).
- `routing.ts` `computeRoute`: one pack covering both ends → as today. Otherwise the
  stitched route, so guidance, the route sheet, voice and the ETA see one route.
- Rerouting: the chosen crossings are kept for the trip. Off the route before the border,
  only the leg to the same crossing is recomputed (the legs after it don't change); past
  the border, a normal route in the new pack; a full re-choice only if far off.
- Middle countries: transit matrices between two borders of one pack (many-to-many) are
  the expensive part: per border only the crossings with the smallest straight-line detour
  are kept (a dozen), always main roads.
- No pack chain between the two ends (a country missing in between): the straight line as
  today.

## The problem

A route is computed inside one routing pack (`packsFor` in `features/maps/routing-core.ts`
needs one pack that covers both ends). Between two packs, guidance draws a straight line,
even with both installed:

- **Between US regions**: Chicago → Denver (us-midwest → us-west). The USA is the only
  country whose routing is split (a national pack would be ~21 GB); Canada (2.0 GB) and
  Russia (3.8 GB) keep one pack for the whole country (`docs/COUNTRY_REGIONS_PLAN.md`).
- **Between countries**: Madrid → Paris, Madrid → Lisbon, Toronto → Detroit.

Each pack keeps a margin across its border (Geofabrik's polygons overlap their neighbours),
so trips close to a border work today.

## Why today's packs can't be joined

Each pack is a separate Valhalla build of its own Geofabrik extract. Valhalla's graph is a
set of tiles on three levels (level 0: 4° tiles, motorways; level 1: 1°, arterials;
level 2: 0.25°, local roads). Every node and edge has a `GraphId` (level, tile, index in the
tile), and edges reach nodes in neighbouring tiles by those ids. In the band where two
extracts overlap, both builds make the same tiles with different content, so the indices
don't match. Joining them means rebuilding the graph from OSM data: not on a phone.

Measured (spike 1): a Galicia pack from its own build put next to a Portugal pack cut from
another build broke every cross-border route (171), and even Vigo → Braga, which the
Portugal pack routes alone, because the shared border tiles came from the other build.
No crash, but **packs from different builds must never be mixed**.

## The proposal: one graph, packs as subsets of its tiles

Build **one** Valhalla graph over a large area and cut each pack as the subset of its tiles
that meet the country's or region's polygon. All packs then share the ids: the packs a
person has are simply a bigger piece of the same graph, and a route works wherever the tiles
along the way are installed. Two packs that share a border tile hold identical copies of it.

### Spike 1 (2026-10-28, desktop, Valhalla 3.9.1 in docker): it works

Galicia (stand-in for Spain) + Portugal merged and built as one graph (512 MB of PBF, 80 s,
347 tiles, 833 MB). Cut by Geofabrik's `.poly` (a tile goes to a pack when its bbox meets
the polygon): Galicia 91 tiles / 244 MB, Portugal 273 tiles / 588 MB, 21 tiles shared. The
Portugal subset is about today's published pack (580 MB).

| Trip (car) | Whole graph | Galicia only | Portugal only | Both subsets |
|---|---|---|---|---|
| Santiago → Porto | 231.4 km, 134 min | 171 | 171 | **231.4 km, 134 min** |
| Vigo → Braga | 105.4 km, 64 min | 170 | 105.4 km | **105.4 km, 64 min** |
| Ourense → Lisboa | 522.6 km, 278 min | 171 | 518.4 km, 286 min (worse) | **522.6 km, 278 min** |
| A Coruña → Lugo | 100.0 km, 58 min | 100.0 km | 171 | **100.0 km, 58 min** |

The union gives exactly the whole graph's routes (bike and foot too); a missing tile is
just "no road there" (171/170), never a crash. Valhalla is built for partial tile sets.

**Compressed tiles**: Valhalla reads `<tile>.gph.gz` from a `tile_dir`
(`src/baldr/graphtile.cc`, no build flag). gzip -9 of the union: 731 → **322 MB (2.3×)**,
identical routes, cold route time ×2–3 on the desktop (Santiago → Porto by car: 110 →
375 ms, with process start). That alone would bring the USA from 21 GB to ~9 GB on the
phone and in the download. To be measured on a phone (spike 2).

### The engine on the phone

Valhalla 3.9.1 opens **one** `tile_extract` tar, and with an extract loaded it ignores
`tile_dir` (`graphreader.cc`: `tile_dir_(tile_extract_->tiles.empty() ? … : "")`, a tile
missing from the extract returns null). So:

- **Proposed: a shared `tile_dir`.** `content/routing/<build id>/` holds the tiles of every
  installed pack of that build, as `.gph.gz`. A pack download is still a tar (now of
  compressed tiles, in parts as today); installing it unpacks its entries into the build's
  directory (a streaming untar in `modules/nomad-files`, never the whole file in memory) and
  deletes the tar. A pack's tile list is kept in its item meta: removing a pack deletes the
  tiles no other installed pack of that build lists. Files: Spain ~2,000, the USA ~20,000.
  The native module opens a config with `tile_dir` and no extract, and reopens the actor
  when the set of installed packs changes (the stamp is no longer the extract's inode).
- Alternative if gzip is too slow on a phone: the same directory with plain `.gph` (space
  as today), or fork valhalla-mobile with a ~50-line patch so `GraphReader` maps several
  tars (keeps mmap, no unpacking, but we'd build and maintain the iOS and Android binaries).

### The app

- `routing-core`: packs grouped by build. A route uses the build whose installed packs
  cover both ends (union of their cells; the newest if several); if both ends are covered
  but Valhalla finds no path, the message names what's missing in between (cells along the
  straight line no installed pack covers → their countries/regions).
- Catalog: one `graph` id per build in `routing-manifest.json`, on every pack. The monthly
  update moves a person's packs to the new build together; until all of them are updated,
  each build's packs route among themselves (a per-build directory makes this free).
  Adding a country from a newer build than the installed ones offers to update those too.
- Side files (points, streets, places, house numbers) don't change: per country or region.
- Canada and Russia could then also split routing by region (smaller downloads), and the
  USA keeps its six regions with routes between them.

### CI: one big build a month

Numbers from Valhalla's issues (research 2026-10-28, issue #6312 and others):

- **Planet** (89 GB PBF): ~17–18 h on 24–30 vCPU / 70–98 GB RAM (3.8.x); a maintainer
  reports ~4 h on 16 vCPU / 64 GB with fast NVMe. ~250 GB of intermediate files; the graph
  ~90–130 GB (estimate). 32 GB machines get OOM-killed. `valhalla_build_admins` on the
  planet: ~2 h, one core, and it replaces today's Overpass step (a continent PBF has the
  whole boundaries), which is the flakiest part of the current CI.
- Geofabrik: Europe 32.9 GB, North America 18.2, Asia 15.3, Africa 7.4, Russia 3.9, South
  America 3.9, Oceania 1.5, Central America 0.76.
- **GitHub can't run it**: hosted jobs stop at 6 h; larger runners need an organisation on
  the Team plan and are billed even for public repos.
- **Hetzner Cloud**, created and destroyed by the workflow (`hetznercloud/setup-hcloud`,
  token in secrets; the VM uploads the packs to the release and deletes itself): CCX53
  (32 vCPU / 128 GB / 600 GB) €0.86/h, CCX63 (48 / 192 / 960 GB) €1.37/h → **~€15–25 a
  month** for the planet. CCX43 (16 / 64 / 360 GB, €0.44/h) for a single continent. AWS spot
  (16 vCPU / 64 GB ~$0.38/h + disk) as a fallback.
- Cutting ~240 packs from the graph is cheap (a file filter + tar + gzip), and replaces the
  ~240 per-country builds.

Landmasses with no road between them can be separate graphs: North + Central America
(Darién gap), South America, Oceania, and Europe + Russia + Asia + Africa (which is most of
the planet anyway). Routes only work inside one graph.

### Phases

1. **Spike 2, phone**: the Galicia + Portugal tiles of spike 1 as `.gph.gz` in a
   `tile_dir`, on the simulator and the owner's iPhone: route times (short, 500 km) with
   plain and gzipped tiles, memory, `max_cache_size`.
2. **Spike 3, a continent on Hetzner**: North America (US regions + Canada + Mexico) on a
   CCX43/53: time, RAM, disk, cost; cut the six US regions and route Chicago → Denver.
3. **App**: tile directory per build, streaming untar, pack grouping, messages, catalog
   `graph` id; E2E with two packs cut from one small graph (Andorra halves).
4. **CI**: the North America graph first (it fixes the US, the biggest gap), then the rest
   of the planet; the per-country builds stay for packs not yet moved.

## Other options considered

- **Legs across the border** (plan B): origin → a border crossing on pack A, crossing →
  destination on pack B. Done well (every road crossing from OSM, a matrix to all of them,
  crossing-to-crossing tables precomputed in CI for trips through a third country) it is
  close to the true best route, but it is real extra machinery on the phone (per costing
  tables, joining manoeuvres and voice at the seam, rerouting near a seam), and three
  countries in a row need a search over crossings. Kept as the fallback if spike 3 shows the
  big build isn't viable.
- **A national US pack**: ~21 GB as today, ~9 GB gzipped. Doesn't help between countries.
- **Making separate builds agree** (overlapping per-continent chunks that produce identical
  tiles): Valhalla's later stages (link reclassification, hierarchy, shortcuts) look across
  tiles, so nothing guarantees identical ids. Not pursued.
