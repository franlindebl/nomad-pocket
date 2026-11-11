"""Adds official points (scripts/official/es.py: pharmacies, hospitals, health centres from official registers)
to a pack's emergency points file (<pack>.pois.tsv, Overpass TSV columns: src/features/maps/emergency-core.ts)
where OpenStreetMap doesn't have them yet. OSM misses about a third of Spain's rural pharmacies (Castilla-La
Mancha, 2026-11: 433 of its 1,276), and those are the ones a village has.

An official point matches an OSM point of its group (GROUPS: pharmacies, hospitals, clinics) and is left out
when it is within `near` metres, or within `named` metres and they share a distinctive word (the register writes
a pharmacy's licence holder, and OSM often names the shop after them; a centre's place name). Each OSM point
matches one official point at most (hospitals excepted: GROUPS), a shared name first, then nearest: two
pharmacies 120 m apart in a town, one of them in OSM, must not both disappear.
The rows it adds have type `official` and an id `<source>:<code>` (the app reads them as `o…` ids;
versions before that skip a type they don't know, so old apps just don't show them).

Usage: python3 -I merge.py <pois.tsv> <official.tsv> [<report.json>]   (rewrites pois.tsv in place)
"""
import json
import math
import os
import re
import sys
import unicodedata

# official kinds → what they match in OSM and the tags they are written with.
GROUPS = {
    # Spanish regions require 250 m between pharmacies (a few older ones are closer): two points nearer than
    # 200 m are one pharmacy placed twice. The registers' points sit within 50 m of OSM's for ~85% of the
    # matches (Castilla-La Mancha); geocoded addresses within 15 m (median).
    "pharmacy": {"kinds": {"pharmacy", "botiquin"}, "near": 200, "named": 400, "tags": {"amenity": "pharmacy", "healthcare": "pharmacy"}},
    # A hospital is a campus: OSM puts it at its outline's centre, the register at its street door, and the
    # register lists a campus's hospitals one by one (Badajoz, Toledo): one OSM hospital takes all of them.
    "hospital": {"kinds": {"hospital"}, "near": 300, "named": 1500, "oneToOne": False,
                 "tags": {"amenity": "hospital", "healthcare": "hospital"}},
    # Health centres and consultorios: a village's (OSM often has it unnamed) is within 150 m; in a town a private
    # practice may be that close, which is why OSM's may take only one.
    "clinic": {"kinds": {"clinic"}, "near": 150, "named": 500, "tags": {"amenity": "clinic", "healthcare": "centre"}},
}
# Columns of the official file (es.py writes them).
OFFICIAL_COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
# Keep in step with OVERPASS_TAGS (emergency-core.ts) and TAGS (scripts/routing/emergency-points.py).
TAGS = ["amenity", "healthcare", "emergency", "military", "natural", "shop", "office", "name", "operator",
        "phone", "contact:phone", "opening_hours", "drinking_water"]
STOP = {"farmacia", "farmacias", "botiquin", "lda", "ldo", "con", "por", "sur", "norte", "este", "oeste", "nou",
        "nova", "nuevo", "nueva", "licenciada", "licenciado", "del", "de", "la", "las", "los",
        "y", "san", "santa", "cb", "sl", "slp", "c", "b", "dona", "don", "dr", "dra", "centro", "salud", "consultorio",
        "local", "hospital", "clinica", "clinico", "general", "universitario", "comarcal", "auxiliar", "periferico",
        "medico", "rural", "atencion", "primaria", "nuestra", "senora", "quiron", "quironsalud", "hm", "vithas"}


def words(text):
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return {w for w in re.findall(r"[a-z]+", t) if len(w) > 2 and w not in STOP}


def meters(a_lat, a_lon, b_lat, b_lon):
    x = math.radians(b_lon - a_lon) * math.cos(math.radians((a_lat + b_lat) / 2))
    return 6371000 * math.hypot(x, math.radians(b_lat - a_lat))


def read_official(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            cols = line.rstrip("\n").split("\t")
            if i == 0 and cols[0] == "source":
                continue
            r = dict(zip(OFFICIAL_COLUMNS, cols + [""] * (len(OFFICIAL_COLUMNS) - len(cols))))
            try:
                r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
            except ValueError:
                continue
            rows.append(r)
    return rows


def osm_group(tags):
    """The group of an OSM point, as the app reads its kind (emergencyKind: hospital before clinic)."""
    if tags["amenity"] == "hospital" or tags["healthcare"] == "hospital":
        return "hospital"
    if tags["amenity"] == "pharmacy":
        return "pharmacy"
    if tags["amenity"] in ("clinic", "doctors") or tags["healthcare"] in ("centre", "clinic"):
        return "clinic"
    return None


def read_osm(path):
    """OSM points by group: [(lat, lon, name words)]."""
    out = {g: [] for g in GROUPS}
    with open(path, encoding="utf-8") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 4 + len(TAGS) or cols[0] == "official":
                continue
            tags = dict(zip(TAGS, cols[4:]))
            g = osm_group(tags)
            if g:
                out[g].append((float(cols[2]), float(cols[3]), words(tags["name"]) | words(tags["operator"])))
    return out


def match(official, osm, near, named, one_to_one=True):
    """Indexes of the official points OSM already has."""
    # Every pair within `named` metres is in neighbouring cells (a degree of longitude is 80 km at 44° N).
    cell = named / 80000
    grid = {}
    for j, (lat, lon, _) in enumerate(osm):
        grid.setdefault((int(lat // cell), int(lon // cell)), []).append(j)
    pairs = []
    for i, r in enumerate(official):
        names = words(r["holder"]) | words(r["name"])
        ci, cj = int(r["lat"] // cell), int(r["lon"] // cell)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for j in grid.get((ci + di, cj + dj), ()):
                    lat, lon, osm_names = osm[j]
                    d = meters(r["lat"], r["lon"], lat, lon)
                    if d <= near or (d <= named and names & osm_names):
                        # A shared name wins over a nearer stranger.
                        pairs.append((0 if names & osm_names else 1, d, i, j))
    pairs.sort()
    used_official, used_osm = set(), set()
    for _, _, i, j in pairs:
        if i not in used_official and (j not in used_osm or not one_to_one):
            used_official.add(i)
            used_osm.add(j)
    return used_official


def clean(v):
    return (v or "").replace("\t", " ").replace("\n", " ").strip()


def row(r, group):
    tags = {t: "" for t in TAGS}
    tags.update(GROUPS[group]["tags"])
    tags["name"] = clean(r["name"])
    tags["phone"] = clean(r["phone"])
    return "\t".join(["official", f"{r['source']}:{r['code']}", f"{r['lat']:.6f}", f"{r['lon']:.6f}", *(tags[t] for t in TAGS)])


def main():
    pois, official_path = sys.argv[1], sys.argv[2]
    official = read_official(official_path)
    osm = read_osm(pois)
    added, report = [], {}
    for group, g in GROUPS.items():
        mine = [r for r in official if r["kind"] in g["kinds"]]
        known = match(mine, osm[group], g["near"], g["named"], g.get("oneToOne", True))
        new = [r for i, r in enumerate(mine) if i not in known]
        added += [(r, group) for r in new]
        sources = {}
        for i, r in enumerate(mine):
            s = sources.setdefault(r["source"], {"official": 0, "inOsm": 0, "added": 0})
            s["official"] += 1
            s["inOsm" if i in known else "added"] += 1
        report[group] = {"osm": len(osm[group]), "official": len(mine), "added": len(new), "sources": sources}
        print(f"[official] {group}: {len(mine)} official, {len(mine) - len(new)} already in OSM, {len(new)} added "
              f"(OSM has {len(osm[group])})", file=sys.stderr)
    # A file merged before (a re-run) keeps only its OSM rows.
    with open(pois, encoding="utf-8") as f:
        kept = [line for line in f if not line.startswith("official\t")]
    with open(pois + ".tmp", "w", encoding="utf-8") as f:
        f.writelines(kept)
        f.writelines(row(r, group) + "\n" for r, group in added)
    os.replace(pois + ".tmp", pois)
    if len(sys.argv) > 3:
        with open(sys.argv[3], "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
