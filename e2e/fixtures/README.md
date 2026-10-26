# E2E fixtures: third-party data

The files committed here are test data for the Maestro suite (`docs/E2E.md`). The
repository's GPL-3.0-or-later licence covers the project's code only, not these files; each
keeps the licence of its source.

| Files | Source | Licence |
|---|---|---|
| `wikipedia_en_100_mini_2026-01.zim` | A 100-article English Wikipedia sample packaged by [Kiwix](https://kiwix.org) (`download.kiwix.org/zim/wikipedia/`) | Text: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (Wikipedia contributors; the authors and licences of each article and image are in the archive). Committed because Kiwix removed it from its mirror |
| `es-ml.pmtiles`, `maps/ad.pmtiles` | Cuts of the [Protomaps](https://protomaps.com) daily planet build (basemap tiles from OpenStreetMap data) | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The Protomaps basemap schema and styles are credited in the app (Settings › Credits & licenses) |
| `routing/ad.tar`, `routing/ad.{pois,streets,places,addresses}.tsv` | Andorra, built by `scripts/routing/build-country.sh` (Valhalla 3.9.1 tiles and emergency points, street names, places and house numbers) from the [Geofabrik](https://download.geofabrik.de) extract of OpenStreetMap data | © OpenStreetMap contributors, ODbL 1.0 (a derived database: the same licence applies to it) |

The other fixtures `npm run e2e:setup` downloads (other Kiwix archives, a Qwen GGUF model
from Hugging Face) are git-ignored and keep their own licences; see `docs/E2E.md`.
