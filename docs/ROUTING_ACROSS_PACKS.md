# Routes across routing packs (future project)

Status: **idea, not started** (owner's request, 2026-10-27). Nothing here is decided or
measured yet; the "to verify" items come first in any spike.

## The problem

A route is computed inside one routing pack (`packsFor` in `features/maps/routing-core.ts`
needs one pack that covers both ends). Between two packs, guidance draws a straight line,
even with both installed:

- **Between US regions**: Chicago → Denver (us-midwest → us-west). The USA is the only
  country whose routing is split (a national pack would be ~21 GB); Canada and Russia keep
  one pack for the whole country (`docs/COUNTRY_REGIONS_PLAN.md`).
- **Between countries**: Madrid → Lisbon, Strasbourg → Freiburg, Toronto → Detroit.

Each pack keeps a margin across its border (Geofabrik's polygons overlap their neighbours),
so trips close to a border work today.

## Why today's packs can't be joined on the phone

Each pack is a separate Valhalla build of its own Geofabrik extract. Valhalla's graph is a
set of tiles on three levels (level 0: 4° tiles, motorways; level 1: 1°, arterials;
level 2: 0.25°, local roads). Every node and edge has a `GraphId` (level, tile, index in the
tile), and edges reach nodes in neighbouring tiles by those ids. In the band where two
extracts overlap, both builds make the same tiles with different content (each with the
ways its extract has, cut at its polygon), so their ids don't match: tile X of one build
can't sit next to tile Y of the other. Joining them means rebuilding the graph, which needs
the OSM data and far more memory than a phone has.

## The proposal: one graph, packs as subsets of its tiles

Build **one** Valhalla graph over a large area (the planet, or one per landmass) and cut
each pack as the subset of its tiles that covers the country or region (plus a margin).
All packs then share the ids: on the phone, the packs a person has together are simply a
bigger piece of the same graph, and a route works wherever the tiles along the way are
installed (Madrid → Lisbon with Spain and Portugal; Chicago → Denver with Midwest and West).
Two installed packs that share a border tile hold identical copies of it.

This also covers the USA without a 21 GB pack: its regions become subsets of the same
graph and routes between the ones you have work.

### What it changes

- **CI**: one big build a month instead of ~240 small ones, then a cheap cutting step
  (tiles are files named by level and tile id, so selecting them by area is a filter, and
  each pack is a tar of its tiles, as today). Road connections by land join Europe, Asia and
  Africa, and North, Central and South America, so a build per continent leaves cross-border
  routes between continents out: realistically the planet, or Eurasia + Africa, the Americas
  and Oceania. **To verify**: memory, disk and time of such a build with Valhalla 3.9.1. It
  won't fit GitHub's standard runners (16 GB RAM, ~14 GB + /mnt disk); options are larger
  GitHub runners (paid per minute), a rented machine once a month, or a self-hosted runner.
- **Phone**: the engine opens one `tile_extract` tar per route today (`modules/nomad-route`).
  It would need every installed pack at once: unpack the packs into one tile directory
  (`mjolnir.tile_dir`, many small files) or build one tar from them after each download.
  **To verify**: valhalla-mobile 0.6.4 with `tile_dir`, route speed with ~100k tile files,
  and the time and room to unpack a multi-GB pack on the phone.
- **Updates**: every installed pack must come from the same build (ids change between
  months), so the monthly update replaces all of a person's packs together, and the catalog
  carries one build id that the app checks before routing across packs.
- **Side files** (points, streets, places, house numbers) don't change: they stay per country
  or region.
- `routing-core` `packsFor`: a route needs the packs that hold its corridor, not one pack
  with both ends; when a gap is missing, the straight line (or a message naming the missing
  country) as today.

### A spike to decide

1. Build Spain + Portugal as one graph (both extracts merged, as `build-country.sh` already
   does for Spain + Canarias), cut it into two tile subsets by country, and route Madrid →
   Lisbon on the simulator with both subsets in one tile directory.
2. Measure a continental build (Europe) on a big machine: RAM, disk, hours.
3. With those numbers, choose where the monthly build runs and its cost.

## Other options considered

- **Legs across the border**: route origin → a border crossing with pack A, crossing →
  destination with pack B, trying a few crossings and keeping the best. Works with today's
  packs and CI, but it's an approximation (crossings must be found; the result isn't the
  true best route; more code in the app for every pair of packs). Fallback if the spike
  fails.
- **Compress the US routing**: Valhalla reads tiles from a mapped tar, uncompressed, so
  compression only shortens the download, not the room on the phone (**to verify** whether
  3.9.1 reads gzipped tiles from a `tile_dir`, and how fast). Even halved, a national US
  pack would be ~10 GB, and it doesn't help between countries. Not recommended on its own.
- **A national US pack** (~21 GB): too big for most phones.
