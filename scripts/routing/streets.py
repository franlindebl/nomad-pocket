"""Street and locality names of an OSM extract, for the app's offline search: the map
tiles a phone can index hold only the main roads of a big area (places.ts reads one
zoom level under a tile budget), the routing pack's extract has every named street.
Usage: python3 -I streets.py <filtered.osm.pbf> <out.tsv>
The input is `osmium tags-filter w/highway n/place` output (ways keep their nodes).
Columns: kind, name, lat, lon; kind is 'street', 'path' or a place kind (city, town…),
read by parseStreetsTsv in src/features/maps/routing-core.ts. A street split into many
ways is written once per ~1 km cell (where it is, not one point per segment)."""
import sys

import osmium

# Keep in step with LOCALITY_KINDS in src/features/maps/places-core.ts.
PLACES = {"city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter", "locality", "borough", "isolated_dwelling"}
PATHS = {"path", "footway", "cycleway", "bridleway", "steps", "track", "pedestrian"}
SKIP = {"proposed", "construction", "abandoned", "razed", "platform", "bus_stop", "elevator", "corridor", "services", "rest_area"}
CELL = 0.01  # degrees, ~1 km


def clean(v):
    return v.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.seen = set()

    def node(self, n):
        kind = n.tags.get("place")
        name = n.tags.get("name")
        if kind in PLACES and name and n.location.valid():
            self.rows.append((kind, clean(name), n.location.lat, n.location.lon))

    def way(self, w):
        highway = w.tags.get("highway")
        name = w.tags.get("name")
        if not highway or not name or highway in SKIP:
            return
        locs = [nd.location for nd in w.nodes if nd.location.valid()]
        if not locs:
            return
        mid = locs[len(locs) // 2]
        name = clean(name)
        key = (name.lower(), round(mid.lat / CELL), round(mid.lon / CELL))
        if key in self.seen:
            return
        self.seen.add(key)
        self.rows.append(("path" if highway in PATHS else "street", name, mid.lat, mid.lon))


def main():
    h = Collect()
    h.apply_file(sys.argv[1], locations=True)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        for kind, name, lat, lon in h.rows:
            f.write(f"{kind}\t{name}\t{lat:.6f}\t{lon:.6f}\n")
    print(f"streets {sys.argv[2]}: {len(h.rows)} names")


main()
