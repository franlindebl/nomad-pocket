"""Describes built country maps for the app (src/features/maps/country-maps.ts).
  fragment <out dir> <id> <YYYYMMDD> <max zoom> <bbox> [<country> [<outline.geojson>]]
                                                             → JSON object of this map (a country's,
                                                               or a region's: id us-west, country us,
                                                               with the outline's 1° cells)
  merge <release tag> <fragment.json...>                     → maps-manifest.json
  carry <previous manifest> <new manifest> <regions.json> <packs.json> <map-regions.json>
                                                             → new + previous maps not rebuilt (countries
                                                               of regions.json, regions of packs.json
                                                               and map-regions.json)
A map is one .pmtiles archive in one or more parts; the app downloads the parts in order
and appends them. pois/streets/places/addresses are absent where a routing pack brings them."""
import hashlib, json, os, sys, time, glob


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def described(path):
    if not os.path.exists(path):
        return None
    if os.path.getsize(path) == 0:  # GitHub refuses empty assets
        os.remove(path)
        return None
    return {"name": os.path.basename(path), "size": os.path.getsize(path), "sha256": sha256(path)}


def fragment(out_dir, country, build_date, zoom, bbox, region_id=None, outline=None):
    whole = os.path.join(out_dir, f"{country}.pmtiles")
    parts = [whole] if os.path.exists(whole) else sorted(glob.glob(os.path.join(out_dir, f"{country}.pmtiles.part*")))
    if not parts:
        raise SystemExit(f"no map for {country}")
    m = {
        "id": country,
        "regionId": region_id or country,
        "buildDate": build_date,
        "maxZoom": int(zoom),
        "bbox": [float(v) for v in bbox.split(",")],
        "size": sum(os.path.getsize(p) for p in parts),
        "parts": [{"name": os.path.basename(p), "size": os.path.getsize(p), "sha256": sha256(p)} for p in parts],
        "pois": described(os.path.join(out_dir, f"{country}.pois.tsv")),
        "streets": described(os.path.join(out_dir, f"{country}.streets.tsv")),
        "places": described(os.path.join(out_dir, f"{country}.places.tsv")),
        "addresses": described(os.path.join(out_dir, f"{country}.addresses.tsv")),
    }
    # A region's 1° cells (region-outline.py): which region the person is in (country-core.ts partAt).
    if outline:
        m["cells"] = json.load(open(outline))["properties"]["cells"]
    json.dump(m, sys.stdout, indent=1)


def merge(release, files):
    # A fragment may name its own release (one per continent); else the run's.
    maps = [(lambda m: dict(m, release=m.get("release") or release))(json.load(open(f))) for f in files]
    json.dump({
        "version": 1,
        "release": release,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "maps": sorted(maps, key=lambda m: m["id"]),
    }, sys.stdout, indent=1)


def carry(previous, current, regions_json, packs_json, map_regions_json):
    prev, cur = json.load(open(previous)), json.load(open(current))
    listed = {r["id"] for r in json.load(open(regions_json))["regions"] if r["type"] == "country"}
    listed |= {k for k, v in json.load(open(packs_json))["countries"].items() if "region" in v}
    listed |= set(json.load(open(map_regions_json))["regions"])
    rebuilt = {m["id"] for m in cur["maps"]}
    kept = [dict(m, release=m.get("release", prev["release"])) for m in prev["maps"] if m["id"] not in rebuilt and m["id"] in listed]
    # One kind of map per country, the one this run built: a country's whole map goes once its
    # regions have maps (the USA's z14 map, after the regions' first run), and regions' maps
    # go if the country is built whole again.
    whole = lambda m: m["id"] == m["regionId"]
    whole_rebuilt = {m["regionId"] for m in cur["maps"] if whole(m)}
    kept = [m for m in kept if whole(m) or m["regionId"] not in whole_rebuilt]
    split = {m["regionId"] for m in cur["maps"] + kept if not whole(m)}
    kept = [m for m in kept if not whole(m) or m["regionId"] not in split]
    cur["maps"] = sorted(cur["maps"] + kept, key=lambda m: m["id"])
    json.dump(cur, sys.stdout, indent=1)


if len(sys.argv) > 1 and sys.argv[1] == "fragment":
    fragment(*sys.argv[2:9])
elif len(sys.argv) > 1 and sys.argv[1] == "merge":
    merge(sys.argv[2], sys.argv[3:])
elif len(sys.argv) > 1 and sys.argv[1] == "carry":
    carry(*sys.argv[2:7])
else:
    raise SystemExit(__doc__)
