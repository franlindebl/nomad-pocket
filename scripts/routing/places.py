"""Every named place of an OSM extract (schools, shops, peaks, stations…) and every house
number, for the app's offline search: the map tiles a phone can index hold only the POIs
of the zoom it reads, and none of the house numbers.
Usage: python3 -I places.py <filtered.osm.pbf> <places.tsv> <addresses.tsv>
The input is `osmium tags-filter <extract> nwr/name nwr/addr:housenumber nwr/addr:block_number` output
(referenced objects included, so ways have their nodes and relations their member ways).
Ways and relations get the centre of their bounding box, as Overpass `out center` does.
places.tsv columns: kind, name, other names (space separated, may be empty), lat, lon;
kind is the OSM value of the first key of KEYS the object has (school, supermarket,
peak…), or the key itself for "yes". addresses.tsv columns: street, house number, lat,
lon; a Japanese address (no streets: block numbers inside a chōme) is "台東2丁目" + "5-1".
Both are read by parsePlacesTsv / parseAddressesTsv in src/features/maps/places-core.ts."""
import re
import sys
import unicodedata

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
# The keys of the osmium filter: what makes an object a place or a door.
WANTED = ("name", "addr:housenumber", "addr:block_number")
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


KANJI_DIGITS = {c: i for i, c in enumerate("〇一二三四五六七八九", 0)}


def chome(v):
    """'二丁目', '2丁目' or '2' as '2丁目'; anything else (a place name) unchanged."""
    m = re.fullmatch(r"([〇一二三四五六七八九十]{1,3}|\d{1,2})(丁目)?", v)
    if not m:
        return v
    d = m.group(1)
    if not d.isdigit():
        tens, _, units = d.rpartition("十")
        d = str((KANJI_DIGITS.get(tens, 1) if "十" in d else 0) * 10 + KANJI_DIGITS.get(units, 0))
    return d + "丁目"


def japanese_address(tags):
    """Japan numbers blocks (番) inside a chōme of a quarter, not doors along streets:
    addr:quarter 台東 + addr:neighbourhood 2丁目 + addr:block_number 5 + addr:housenumber 1
    is the street "台東2丁目" and the number "5-1". Full-width digits and kanji numerals
    become ASCII, as the app's parseAddress does with what the user types."""
    t = {k: unicodedata.normalize("NFKC", clean(tags.get(k, ""))) for k in
         ("addr:quarter", "addr:neighbourhood", "addr:suburb", "addr:block_number", "addr:housenumber")}
    hood = chome(t["addr:neighbourhood"]) if t["addr:neighbourhood"] else ""
    if hood.endswith("丁目"):
        area = t["addr:quarter"] or t["addr:suburb"]
        street = area + hood if area else ""  # a chōme alone ("2丁目") names nothing
    else:
        street = t["addr:quarter"] + hood  # 大字 + 小字, either may be missing
    # "7番" + "22号", "1803番地2" are also written: the numbers are "7-22", "1803-2".
    number = "-".join(x for x in (t["addr:block_number"], t["addr:housenumber"]) if x)
    number = re.sub(r"-+", "-", re.sub(r"番地?|号|[‐‑‒–—―−ー]", "-", number)).strip("-")
    # A rural lot letter belongs to the place, as it is written: "二名甲2217-1".
    lot = re.fullmatch(r"([^\d-]{1,2})(\d[\d-]*)", number)
    if lot:
        street, number = street + lot.group(1), lot.group(2)
    return (street, number) if street and number else None


def addresses_of(tags):
    """(street, number) pairs: '12;14' or '12, 14' are two doors."""
    street = tags.get("addr:street") or tags.get("addr:place")
    number = tags.get("addr:housenumber")
    if not street and tags.get("addr:block_number"):
        jp = japanese_address(tags)
        return [jp] if jp else []
    if not street or not number:
        return []
    return [(clean(street), clean(n)) for n in re.split(r"[;,]", number) if clean(n)]


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
        if n.tags and n.location.valid() and any(k in n.tags for k in WANTED):
            self.emit(n.tags, n.location.lat, n.location.lon)

    def way(self, w):
        wanted = any(k in w.tags for k in WANTED)
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
