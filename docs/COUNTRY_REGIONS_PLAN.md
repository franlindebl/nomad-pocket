# Countries in regions: the United States

Status: **approved by the owner 2026-10-27; built** (phases 1–4 on main, see "Phases"). The
regional maps go live with the first CI run that builds them (after the release that reads them).

## Why

A country is one download with everything in it (`docs/UX_SURVIVAL_PLAN.md`). For the
United States that download is now **31.2 GB** (2026-10-27 catalogs), and the app asks for
**~60 GB free** before it starts (see "Space check" below). It doesn't fit on most phones.

| USA today | Size |
|---|---|
| Map, whole country, z14 (z15 would be 17 GB, over the 10 GB cap) | 8.0 GB |
| Routing: us-west 4.9 · us-midwest 5.5 · us-northeast 2.8 · us-south 7.8 GB | 21.0 GB |
| Emergency points 38 MB · streets 395 MB · places 229 MB · house numbers 1.56 GB | 2.2 GB |
| **Download** | **31.2 GB** |

Every other country is far smaller: Canada 10.8 GB, Russia 11.6 GB, China 9.1 GB, India
7.8 GB, Brazil 7.8 GB. Only the USA needs this; the design stays general so others can
follow (Canada and Russia could then go from z14 to z15), but nothing else changes now.

## Findings while sizing it

1. **Alaska and Hawaii have no routing pack.** Geofabrik's `us-west` is the contiguous
   West only (its polygon stops at 49.5°N and -133°W), and none of the four regions holds
   Alaska or Hawaii. The packs published last night (`f3efa4d`, run 40426777070) leave them
   out. Geofabrik has them as `north-america/us/alaska` (0.14 GB) and `us/hawaii` (0.03 GB).
2. **A route only works inside one pack.** `packsFor` (routing-core.ts) needs one pack that
   covers both ends; there is no stitching across packs. Chicago → Denver (midwest → west)
   falls back to the straight line **even with both packs installed**. This is already true
   today (between countries too: Madrid → Lisbon), and what I told the owner earlier ("routes
   that cross regions work if you have both") was wrong. Each pack keeps a margin across its
   border (Geofabrik's polygons overlap their neighbours), so trips near a border work.
3. **The space check counts every assembly at once.** `countryNeed` adds the whole size of
   each multi-part archive (its temp copy) for the map and every pack together: 31 + 8 + 21
   ≈ 60 GB for the USA. Assemblies run one at a time, so the real peak is the download plus
   the biggest archive (~39 GB).

## Proposal: a region is a small country

The USA splits into **six regions**, each with everything a country has: its map at z15, its
routing pack and its emergency points, streets, places and house numbers.

| Region | States | Map z15 | Routing | Side files | **Total** |
|---|---|---|---|---|---|
| West | WA OR CA NV ID MT WY UT CO AZ NM | 4.6 GB | 4.9 GB | 0.6 GB | **10.1 GB** |
| Midwest | ND SD NE KS MN IA MO WI IL MI IN OH | 3.9 GB | 5.5 GB | 0.3 GB | **9.8 GB** |
| Northeast | PA NY NJ CT RI MA VT NH ME | 2.1 GB | 2.8 GB | 0.6 GB | **5.5 GB** |
| South | TX OK AR LA MS AL TN KY WV VA MD DE DC NC SC GA FL | 5.7 GB | 7.8 GB | 0.7 GB | **14.2 GB** |
| Alaska | AK | 0.72 GB | 0.06 GB | 0.005 GB | **0.79 GB** |
| Hawaii | HI | 0.03 GB | 0.04 GB | 0.003 GB | **0.08 GB** |
| **Whole USA** | | 17.1 GB | 21.1 GB | 2.2 GB | **~40.4 GB** |

Map sizes are pmtiles dry runs of build 20261026 over each region's outline (region-outline.py;
Hawaii built end to end). Routing and side files are the published packs (Alaska and Hawaii:
run 40465215179). States per region:
Geofabrik follows the US Census regions; to be confirmed from the polygons when built.

The whole USA gets more detail (z15 like Spain) and becomes larger (41 GB instead of 31 GB):
nobody is meant to take all of it on a phone; one or two regions are 5–24 GB.

### What the person sees

- **Country sheet (USA)**: instead of one size, the six regions as a checklist with their
  size, the one where they are already ticked, and the total. "Descargar · 14,2 GB". With no
  location yet: nothing ticked, the button says "Elige al menos una región". Above the list,
  a "Todo Estados Unidos · 41 GB" shortcut ticks every region (and unticks them all again);
  every country split in regions gets one.
- **Onboarding**: the kit proposal (country step) shows "Estados Unidos · Sur" and its size;
  tapping it opens the same checklist. Which region to propose without the location is an
  open question (below).
- **Tus mapas**: one row "Estados Unidos" with its regions in the subtitle ("Sur, Noreste ·
  19,7 GB"), and in its sheet "Añadir región" plus remove per region. Removing the last region
  removes the country.
- **Downloads**: one row per country as now ("Mapa de Estados Unidos"), whatever regions it
  brings.
- **Outside the downloaded regions**: the bundled world map (z0–5), search finds nothing
  offline there, Emergencias asks Overpass when online (as for a country without a download),
  guidance draws the straight line.
- **Updates**: monthly, per region (only the regions you have).
- **Every other country**: unchanged, no region list.

## Technical design

### Data (CI)

- `scripts/routing/packs.json`: add `us-alaska` (`north-america/us/alaska`) and `us-hawaii`
  (`north-america/us/hawaii`), `"iso": "US", "region": "us"`. A region is exactly a pack
  entry with `region`; its map is built from the same polygon. Independent of the rest: can
  ship first (it fixes finding 1 for builds 13+).
- `scripts/maps/build-country-map.sh <region id>` (e.g. `us-west`): outline = the region's
  Geofabrik `.poly` ∩ the country's Natural Earth outline (shapely, already on the runner),
  z15 if ≤ 10 GB, no side files (its pack brings them). Fragment `id: "us-west"`,
  `regionId: "us"`.
- `country-packages.yml`: a region job builds its map too (`maps=true`); a country with
  regions builds no whole-country map.
- `maps-manifest.py carry`: keep maps of regions (ids from packs.json), and drop a country's
  whole map once regional maps exist for it (and the other way round).

### App

- `country-core.ts` (pure, tested): `regionsOf(country)` from the catalogs: per region its
  map, pack(s) and sizes; `countryNeed` → download + biggest archive (finding 3, for every
  country).
- `country-maps.ts`: item id and file name from `map.id` instead of `map.regionId`. Identical
  for every country today (`id === regionId`), so installed maps keep their ids.
- `countries.ts`: `CountryOffer.parts` (regions; one implicit part for other countries);
  `planCountry`/`downloadCountry` take the chosen regions; `CountryState.maps: MapItem[]` and
  installed regions; `removeCountry` / new `removeRegion`; update per region.
- Region where the person is: the routing packs' 1° cells (already in the catalog).
- UI: `maps/download.tsx` (checklist), `onboarding.tsx` (proposal), `maps/regions.tsx`
  (Tus mapas row and sheet), `home/readiness.ts` (ready = at least one region).
- Search, places, emergency points and the map style already work with several items per
  country (several packs today; maps of neighbouring countries draw side by side).
- Tests: country-core units; E2E with a two-region fixture (two Andorra halves) for the
  checklist, add and remove region.

### Compatibility

- App Store 1.0.1 reads no catalog: unaffected.
- TestFlight builds 11–14 match maps by `regionId` and would take the first regional map
  ("us-midwest") as the whole USA. Same trade-off as the regional packs (builds ≤ 12):
  testers only; the release that ships this is the first that should be used for the USA.
- A whole-USA map already installed (z14) keeps working; the sheet offers to replace it by
  regions as an update.

## Open questions (answered: the owner's choice, else the recommendation)

1. **Proposal in onboarding** (it doesn't ask for location): (a) ask for location on that
   step only for the USA, to tick your region (recommended); (b) propose nothing and let the
   person choose; (c) propose the smallest region. Taken: (a).
2. **Show a "Todo Estados Unidos (~41 GB)" shortcut** in the checklist, or only per region.
   Owner: **yes**, a whole-country shortcut for every country we split.
3. **Cross-region routes** (finding 2): accept the straight line between regions for now
   (as between countries), or plan route stitching across packs later (separate work).
   Taken: straight line for now.
4. **Alaska and Hawaii packs now**: add them to packs.json and build them today, ahead of
   the rest (independent, small). Taken: yes, phase 1.

## Phases

1. Alaska and Hawaii packs (packs.json + one run). **Done** (24963d2, run 40465215179).
2. Space check fix (`countryNeed`: download + biggest archive; assemblies one at a time).
   **Done** (227b904).
3. CI: regional maps (script, workflow, manifest carry). **Done** (6ac5011); the run waits for
   the release that reads regions (TestFlight builds ≤ 15 would take the first regional map for
   the whole USA).
4. App: regions in the catalog model, download/remove/update per region, the checklist in the
   country sheet, onboarding and Tus mapas. **Done**; checked on the simulator against a local
   catalog (Hawaii downloaded from the onboarding kit, shown in Tus mapas, deleted from the
   sheet).
5. Next: a TestFlight build, then `gh workflow run country-packages.yml -f countries=us -f
   parts=maps`, then a real iPhone check (a 5 GB region end to end).
