"""Describes built country maps for the app (src/features/maps/country-maps.ts).
  fragment <out dir> <country> <YYYYMMDD> <max zoom> <bbox>  → JSON object of this country's map
  merge <release tag> <fragment.json...>                     → maps-manifest.json
  carry <previous manifest> <new manifest> <regions.json>    → new + previous maps of countries
                                                               not rebuilt (still in regions.json)
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


def fragment(out_dir, country, build_date, zoom, bbox):
    whole = os.path.join(out_dir, f"{country}.pmtiles")
    parts = [whole] if os.path.exists(whole) else sorted(glob.glob(os.path.join(out_dir, f"{country}.pmtiles.part*")))
    if not parts:
        raise SystemExit(f"no map for {country}")
    json.dump({
        "id": country,
        "regionId": country,
        "buildDate": build_date,
        "maxZoom": int(zoom),
        "bbox": [float(v) for v in bbox.split(",")],
        "size": sum(os.path.getsize(p) for p in parts),
        "parts": [{"name": os.path.basename(p), "size": os.path.getsize(p), "sha256": sha256(p)} for p in parts],
        "pois": described(os.path.join(out_dir, f"{country}.pois.tsv")),
        "streets": described(os.path.join(out_dir, f"{country}.streets.tsv")),
        "places": described(os.path.join(out_dir, f"{country}.places.tsv")),
        "addresses": described(os.path.join(out_dir, f"{country}.addresses.tsv")),
    }, sys.stdout, indent=1)


def merge(release, files):
    # A fragment may name its own release (one per continent); else the run's.
    maps = [(lambda m: dict(m, release=m.get("release") or release))(json.load(open(f))) for f in files]
    json.dump({
        "version": 1,
        "release": release,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "maps": sorted(maps, key=lambda m: m["id"]),
    }, sys.stdout, indent=1)


def carry(previous, current, regions_json):
    prev, cur = json.load(open(previous)), json.load(open(current))
    listed = {r["id"] for r in json.load(open(regions_json))["regions"] if r["type"] == "country"}
    rebuilt = {m["id"] for m in cur["maps"]}
    kept = [dict(m, release=m.get("release", prev["release"])) for m in prev["maps"] if m["id"] not in rebuilt and m["id"] in listed]
    cur["maps"] = sorted(cur["maps"] + kept, key=lambda m: m["id"])
    json.dump(cur, sys.stdout, indent=1)


if len(sys.argv) > 1 and sys.argv[1] == "fragment":
    fragment(*sys.argv[2:7])
elif len(sys.argv) > 1 and sys.argv[1] == "merge":
    merge(sys.argv[2], sys.argv[3:])
elif len(sys.argv) > 1 and sys.argv[1] == "carry":
    carry(sys.argv[2], sys.argv[3], sys.argv[4])
else:
    raise SystemExit(__doc__)
