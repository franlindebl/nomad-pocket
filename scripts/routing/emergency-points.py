"""Emergency points of interest from an OSM extract, written in the same TSV columns as
the app's Overpass query (src/features/maps/emergency-core.ts: overpassQuery and
OVERPASS_TAGS), so the app parses both with parseOverpassTsv. Ways and relations get
the centre of their bounding box, as Overpass `out center` does.
Usage: python3 -I emergency-points.py <filtered.osm.pbf> <out.tsv>[=minlon,minlat,maxlon,maxlat] ...
(one parse, any number of outputs; without a bbox an output gets every point)
The input is the output of `osmium tags-filter` with the filters below (referenced
objects included, so ways have their nodes and relations their member ways)."""
import sys

import osmium

# Keep in step with OVERPASS_TAGS in src/features/maps/emergency-core.ts.
TAGS = ["amenity", "healthcare", "emergency", "military", "natural", "shop", "office", "name", "operator",
        "phone", "contact:phone", "opening_hours", "drinking_water"]
# Keep in step with overpassQuery (and FILTERS in build-country.sh).
WANTED = {
    "amenity": {"hospital", "clinic", "doctors", "pharmacy", "police", "fire_station", "drinking_water", "water_point",
                "shelter", "fuel", "townhall", "embassy"},
    "healthcare": {"hospital", "centre", "clinic"},
    "emergency": {"ambulance_station", "defibrillator", "assembly_point"},
    "military": {"barracks", "base"},
    "natural": {"spring"},
    "shop": {"supermarket", "hardware", "doityourself"},
    "office": {"diplomatic"},
}


def wanted(tags):
    return any(tags.get(k) in v for k, v in WANTED.items())


def clean(v):
    # Overpass CSV quotes values with quotes or tabs; keep ours single-line and tab-free.
    return v.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.way_boxes = {}

    def emit(self, kind, oid, lat, lon, tags):
        self.rows.append([kind, str(oid), f"{lat:.7f}", f"{lon:.7f}"] + [clean(tags.get(t, "")) for t in TAGS])

    def node(self, n):
        if n.tags and wanted(n.tags) and n.location.valid():
            self.emit("node", n.id, n.location.lat, n.location.lon, n.tags)

    def way(self, w):
        lats, lons = [], []
        for nd in w.nodes:
            if nd.location.valid():
                lats.append(nd.location.lat)
                lons.append(nd.location.lon)
        if not lats:
            return
        box = (min(lats), min(lons), max(lats), max(lons))
        self.way_boxes[w.id] = box
        if wanted(w.tags):
            self.emit("way", w.id, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, w.tags)

    def relation(self, r):
        if not wanted(r.tags):
            return
        boxes = [self.way_boxes[m.ref] for m in r.members if m.type == "w" and m.ref in self.way_boxes]
        if not boxes:
            return
        s, w = min(b[0] for b in boxes), min(b[1] for b in boxes)
        n, e = max(b[2] for b in boxes), max(b[3] for b in boxes)
        self.emit("relation", r.id, (s + n) / 2, (w + e) / 2, r.tags)


def main():
    h = Collect()
    h.apply_file(sys.argv[1], locations=True)
    for spec in sys.argv[2:]:
        out, _, box = spec.partition("=")
        rows = h.rows
        if box:
            w, s, e, n = map(float, box.split(","))
            rows = [r for r in rows if w <= float(r[3]) <= e and s <= float(r[2]) <= n]
        with open(out, "w", encoding="utf-8") as f:
            for r in rows:
                f.write("\t".join(r) + "\n")
        print(f"pois {out}: {len(rows)} points")


main()
