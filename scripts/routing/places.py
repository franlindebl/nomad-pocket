"""Every named place of an OSM extract (schools, shops, peaks, stations…) and every house
number, for the app's offline search: the map tiles a phone can index hold only the POIs
of the zoom it reads, and none of the house numbers.
Usage: python3 -I places.py <filtered.osm.pbf> <places.tsv> <addresses.tsv>
The input is `osmium tags-filter <extract> nwr/name nwr/addr:housenumber` output
(referenced objects included, so ways have their nodes and relations their member ways).
Ways and relations get the centre of their bounding box, as Overpass `out center` does.
places.tsv columns: kind, name, other names (space separated, may be empty), lat, lon;
kind is the OSM value of the first key of KEYS the object has (school, supermarket,
peak…), or the key itself for "yes". addresses.tsv columns: street, house number, lat,
lon. Both are read by parsePlacesTsv / parseAddressesTsv in src/features/maps/places-core.ts."""
import re
import sys

import osmium

# Which key names the kind, in order: an object tagged amenity=school + building=yes is a school.
KEYS = ["amenity", "shop", "tourism", "healthcare", "leisure", "office", "craft", "historic", "emergency",
        "military", "man_made", "natural", "aeroway", "railway", "public_transport", "sport", "waterway",
        "landuse", "building"]
# Named but never a useful search result (street furniture, minor infrastructure, linear features).
SKIP = {"bench", "waste_basket", "vending_machine", "post_box", "street_lamp", "tree", "crossing", "give_way",
        "stop", "traffic_signals", "parking_space", "parking_entrance", "bicycle_parking", "motorcycle_parking",
        "grit_bin", "hydrant", "fire_hydrant", "manhole", "pipeline", "power_line", "cable", "street_cabinet",
        "utility_pole", "survey_point", "rail", "tram", "subway", "light_rail", "narrow_gauge", "disused",
        "abandoned", "razed", "construction", "proposed", "platform", "buffer_stop", "switch", "level_crossing",
        "signal", "stop_position", "milestone", "boundary_stone", "kerb", "ditch", "drain", "tree_row", "hedge", "cliff",
        "ridge", "coastline", "grass", "residential", "farmland", "meadow", "forest", "farmyard"}
# Waterways: only those you would look up by name.
WATERWAYS = {"river", "canal", "waterfall", "dam", "lock_gate", "dock"}
OTHER_NAMES = ["name:es", "name:en", "alt_name", "official_name", "short_name", "loc_name"]


def clean(v):
    return v.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def kind_of(tags):
    for k in KEYS:
        v = tags.get(k)
        if not v or v == "no":
            continue
        if k == "waterway" and v not in WATERWAYS:
            continue
        kind = k if v == "yes" else v
        return None if kind in SKIP else clean(kind)
    return None


def addresses_of(tags):
    """(street, number) pairs: '12;14' or '12, 14' are two doors."""
    street = tags.get("addr:street") or tags.get("addr:place")
    number = tags.get("addr:housenumber")
    if not street or not number:
        return []
    return [(clean(street), n.strip()) for n in re.split(r"[;,]", number) if n.strip()]


class Members(osmium.SimpleHandler):
    """First pass: the member ways of relations that are places or addresses."""

    def __init__(self):
        super().__init__()
        self.ways = set()

    def relation(self, r):
        if (r.tags.get("name") and kind_of(r.tags)) or addresses_of(r.tags):
            for m in r.members:
                if m.type == "w":
                    self.ways.add(m.ref)


class Collect(osmium.SimpleHandler):
    def __init__(self, member_ways, places, addresses):
        super().__init__()
        self.member_ways = member_ways
        self.boxes = {}
        self.places = places
        self.addresses = addresses
        self.counts = [0, 0]

    def emit(self, tags, lat, lon):
        name = tags.get("name")
        kind = kind_of(tags) if name else None
        if kind:
            name = clean(name)
            other = []
            for k in OTHER_NAMES:
                v = tags.get(k)
                if v and clean(v) != name and clean(v) not in other:
                    other.append(clean(v))
            self.places.write(f"{kind}\t{name}\t{' '.join(other)}\t{lat:.6f}\t{lon:.6f}\n")
            self.counts[0] += 1
        for street, number in addresses_of(tags):
            self.addresses.write(f"{street}\t{number}\t{lat:.6f}\t{lon:.6f}\n")
            self.counts[1] += 1

    def node(self, n):
        if n.tags and n.location.valid() and ("name" in n.tags or "addr:housenumber" in n.tags):
            self.emit(n.tags, n.location.lat, n.location.lon)

    def way(self, w):
        wanted = "name" in w.tags or "addr:housenumber" in w.tags
        if not wanted and w.id not in self.member_ways:
            return
        lats = [nd.location.lat for nd in w.nodes if nd.location.valid()]
        lons = [nd.location.lon for nd in w.nodes if nd.location.valid()]
        if not lats:
            return
        box = (min(lats), min(lons), max(lats), max(lons))
        if w.id in self.member_ways:
            self.boxes[w.id] = box
        if wanted:
            self.emit(w.tags, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2)

    def relation(self, r):
        boxes = [self.boxes[m.ref] for m in r.members if m.type == "w" and m.ref in self.boxes]
        if not boxes:
            return
        s, w = min(b[0] for b in boxes), min(b[1] for b in boxes)
        n, e = max(b[2] for b in boxes), max(b[3] for b in boxes)
        self.emit(r.tags, (s + n) / 2, (w + e) / 2)


def main():
    members = Members()
    members.apply_file(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as places, open(sys.argv[3], "w", encoding="utf-8") as addresses:
        h = Collect(members.ways, places, addresses)
        h.apply_file(sys.argv[1], locations=True)
    print(f"places {sys.argv[2]}: {h.counts[0]} names; addresses {sys.argv[3]}: {h.counts[1]} doors")


main()
