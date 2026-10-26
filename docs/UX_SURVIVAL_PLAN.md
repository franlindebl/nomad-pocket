# UX redesign: a survival kit, not a knowledge hub

Approved by the owner on 2026-10-25. The app stops presenting itself as an offline
knowledge hub with separate modules and becomes **a survival kit for a crisis** (internet
down for days or months): what you download while online is what keeps you oriented,
informed and safe when the network is gone.

## What was wrong

- Identity: home opened with a greeting and a storage card; Emergencias and Preparedness
  were two cards among others; the module grid repeated the tabs; onboarding sold
  "knowledge that goes with you".
- Onboarding picked a content pack only: no country, no map, no navigation, no AI. A user
  who finished it had no map in a crisis.
- Maps were four separate downloads (world, region with 3 detail levels, visible area,
  routing pack in another sheet), with Spanish communities and US states, and emergency
  points as one more download ("descarga los de OpenStreetMap").
- Too many choices: content languages, 4 packs, 5 Wikipedias, 3 tiers per collection,
  5 AI models.

## Principles

1. **No extras.** One country = one download with everything: map at full detail, road
   navigation where a pack exists, emergency points, street names for search. Nothing to
   discover later in another sheet.
2. **Works from second zero.** The world map (z0–5, ~15 MB) ships inside the app.
3. **Decide for the user, let them opt out.** Onboarding proposes a kit computed for the
   country and the phone (storage, RAM, system AI); every piece can be switched off.
4. **Two moments.** Prepare (online: download, update, plan) and use (offline: emergency
   points, first aid, plan, map). Home shows both.

## Decisions (owner, 2026-10-25)

| Topic | Decision |
|---|---|
| Map of a country | Built in CI (GitHub Actions) next to the routing packs, downloaded like any file (background, resumable), refreshed monthly. On-device extraction stays only as a fallback while a country has no published map. |
| Detail | Always the maximum (z15). Very large countries drop to the highest zoom that keeps the archive under the size cap. No detail picker. |
| Regions | Countries only. Spanish communities, US states and "visible area" go. Region maps already installed are kept (listed under "Other maps", deletable). |
| World map | Bundled in the app, always present, not deletable. |
| Emergency points | Inside the country download (routing pack or country map pack). Overpass only as a silent fallback; no "download from OpenStreetMap" prompt. |
| Tabs | 4: Home · Map · Library (Courses becomes a section) · Assistant. |
| Onboarding kit | One proposal with a switch per piece and the total size (not tiers). |

## Measured sizes (Protomaps build 2026-10-25)

| Country | Map z12 | z14 | z15 | Routing pack |
|---|---|---|---|---|
| Spain | 408 MB | 1.6 GB | 3.2 GB | 2.3 GB |
| Portugal | 84 MB | 336 MB | 635 MB | 0.6 GB |
| France | 1.1 GB | 4.5 GB | 9.4 GB | — |
| Germany | 873 MB | 3.5 GB | 7.2 GB | — |

By the country's outline instead of its bbox (`scripts/maps/country-region.py`, used by
CI), z15: Spain 2.3 GB with Canarias, Baleares, Ceuta and Melilla (the bbox missed
Canarias and carried half of Portugal), Portugal 584 MB with the Azores and Madeira,
France 5.5 GB, Germany 5.5 GB.

## Status (2026-10-26)

Phases 1–4 built on branch `ux-survival` and checked on the iOS 27 simulator (Android:
onboarding, Home and the bundled world map). Country maps catalog not published yet: the
workflow has never run, so the app extracts on the phone (z15 by bbox) until it does.

## Phases

1. **Maps by country.** Country catalog (maps manifest + routing manifest), one row per
   country with combined size and progress, one delete; country picker without
   subdivisions; confirm sheet without a detail picker; routing packs sheet removed from
   the UI; bundled world map; CI workflow `country-packages.yml` (pmtiles extract z15 + points +
   street names for countries without a routing pack).
2. **Onboarding.** Welcome (crisis message, language) → country (preselected from the
   phone's region) → your kit (country package, essential guides, Wikipedia sized to free
   space, assistant: system model or the recommended GGUF) → downloading + "while you
   wait: your family plan". Content languages derived from the app language.
3. **Home and tabs.** "In an emergency" (emergency points, first aid, my plan, emergency
   number) and "Your preparation" (checklist with status and stale-data warnings). 4 tabs.
4. **Settings and polish.** Country in settings, storage grouped by kind, advanced
   options (content languages, Kiwix explore, import) out of the main path.

Later: bundled quick cards (first aid basics, water, radio frequencies) that need no
download; emergency numbers per country.
