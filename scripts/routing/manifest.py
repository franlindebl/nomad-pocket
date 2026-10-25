"""Describes built routing packs for the app (src/features/maps/routing-catalog.ts).
  fragment <out dir> <country> <YYYYMMDD>                → JSON list of this country's packs
  merge <release tag> <fragment.json...>                 → routing-manifest.json
  carry <previous manifest> <new manifest> <packs.json>  → new + previous packs of countries not rebuilt
                                                           (and still listed in packs.json)
  clip <manifest> <packs.json>                           → cells limited to each extract's .poly
A pack is one tar (Valhalla tile extract) in one or more parts; the app downloads the
parts in order and appends them. bbox comes from the tile names, like tileBBox() in
src/features/maps/routing-core.ts."""
import glob, hashlib, json, math, os, sys, time, urllib.request

LEVEL_DEGREES = {0: 4.0, 1: 1.0, 2: 0.25}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tar_names(parts):
    """Entry names of a tar split across files (headers only)."""
    sizes = [os.path.getsize(p) for p in parts]
    total = sum(sizes)
    handles = [open(p, "rb") for p in parts]

    def read(offset, n):
        out = b""
        for h, size in zip(handles, sizes):
            if offset >= size:
                offset -= size
                continue
            h.seek(offset)
            out += h.read(min(n - len(out), size - offset))
            offset = 0
            if len(out) == n:
                break
        return out

    names, offset = [], 0
    while offset + 512 <= total:
        block = read(offset, 512)
        if block == b"\0" * 512:
            break
        name = block[0:100].split(b"\0")[0].decode()
        prefix = block[345:500].split(b"\0")[0].decode()
        size = int(block[124:136].split(b"\0")[0].strip() or b"0", 8)
        names.append(f"{prefix}/{name}" if prefix else name)
        offset += 512 + (size + 511) // 512 * 512
    for h in handles:
        h.close()
    return names


def tile_bbox(names):
    by_level = {}
    for n in names:
        parts = n.replace("./", "", 1)[:-4].split("/") if n.endswith(".gph") else None
        if not parts or not parts[0].isdigit() or int(parts[0]) not in LEVEL_DEGREES:
            continue
        by_level.setdefault(int(parts[0]), []).append(int("".join(parts[1:])))
    level = next((l for l in (2, 1, 0) if l in by_level), None)
    if level is None:
        return None
    size = LEVEL_DEGREES[level]
    cols = round(360 / size)
    w = s = float("inf")
    e = n = float("-inf")
    cells = set()
    for tid in by_level[level]:
        row, col = divmod(tid, cols)
        lon, lat = -180 + col * size, -90 + row * size
        w, s, e, n = min(w, lon), min(s, lat), max(e, lon + size), max(n, lat + size)
        # 1° cells with roads (cellOf in routing-core.ts): a bbox over-claims.
        for y in range(math.floor(lat), max(math.ceil(lat + size), math.floor(lat) + 1)):
            for x in range(math.floor(lon), max(math.ceil(lon + size), math.floor(lon) + 1)):
                cells.add((y + 90) * 360 + (x + 180))
    return [w, s, e, n], sorted(cells)


def described(path):
    """A side file of a pack (points, streets, places, addresses), or None when missing or empty (GitHub
    refuses empty assets, and there is nothing to import)."""
    if not os.path.exists(path):
        return None
    if os.path.getsize(path) == 0:
        os.remove(path)
        return None
    return {"name": os.path.basename(path), "size": os.path.getsize(path), "sha256": sha256(path)}


def fragment(out_dir, country, build_date):
    packs = []
    for pid in [country]:
        whole = os.path.join(out_dir, f"{pid}.tar")
        parts = [whole] if os.path.exists(whole) else sorted(glob.glob(os.path.join(out_dir, f"{pid}.tar.part*")))
        if not parts:
            raise SystemExit(f"no tar for {pid}")
        coverage = tile_bbox(tar_names(parts))
        if coverage is None:
            raise SystemExit(f"no road tiles in {pid}")
        packs.append({
            "id": pid,
            "country": country,
            "regionId": pid,
            "buildDate": build_date,
            "bbox": coverage[0],
            "cells": coverage[1],
            "size": sum(os.path.getsize(p) for p in parts),
            "parts": [{"name": os.path.basename(p), "size": os.path.getsize(p), "sha256": sha256(p)} for p in parts],
            "pois": described(os.path.join(out_dir, f"{pid}.pois.tsv")),
            "streets": described(os.path.join(out_dir, f"{pid}.streets.tsv")),
            "places": described(os.path.join(out_dir, f"{pid}.places.tsv")),
            "addresses": described(os.path.join(out_dir, f"{pid}.addresses.tsv")),
        })
    json.dump(packs, sys.stdout, indent=1)


def merge(release, files):
    # Each pack names its release: packs carried over from a previous month keep theirs.
    packs = [dict(p, release=release) for f in files for p in json.load(open(f))]
    json.dump({
        "version": 1,
        "release": release,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # Packs are only readable by the same Valhalla release that built them.
        "valhalla": "3.9.1",
        "packs": sorted(packs, key=lambda p: p["id"]),
    }, sys.stdout, indent=1)


def carry(previous, current, packs_json):
    prev, cur = json.load(open(previous)), json.load(open(current))
    listed = set(json.load(open(packs_json))["countries"])
    rebuilt = {p["country"] for p in cur["packs"]}
    # A country's packs are replaced as a whole (the region packs Spain had are gone with
    # its first country-only build); countries dropped from packs.json go too.
    kept = [dict(p, release=p.get("release", prev["release"])) for p in prev["packs"]
            if p["country"] not in rebuilt and p["country"] in listed]
    cur["packs"] = sorted(cur["packs"] + kept, key=lambda p: p["id"])
    json.dump(cur, sys.stdout, indent=1)


def read_poly(text):
    """Rings of an Osmosis .poly file (holes, marked with '!', are kept as rings: a cell
    inside a hole is rare and only means an extra pack offered there)."""
    rings, ring = [], None
    for line in text.splitlines()[1:]:
        line = line.strip()
        if line == "END":
            if ring is None:
                break
            rings.append(ring)
            ring = None
        elif ring is None:
            ring = []
        elif line:
            x, y = map(float, line.split()[:2])
            ring.append((x, y))
    return rings


def segment_meets_box(x0, y0, x1, y1, w, s, e, n):
    """Liang–Barsky: does the segment cross the box?"""
    t0, t1, dx, dy = 0.0, 1.0, x1 - x0, y1 - y0
    for p, q in ((-dx, x0 - w), (dx, e - x0), (-dy, y0 - s), (dy, n - y0)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def inside(x, y, ring):
    hit = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def cell_meets_poly(cell, rings):
    lat, lon = cell // 360 - 90, cell % 360 - 180
    w, s, e, n = lon, lat, lon + 1, lat + 1
    for ring in rings:
        if inside(w + 0.5, s + 0.5, ring):
            return True
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            if max(x0, x1) >= w and min(x0, x1) <= e and max(y0, y1) >= s and min(y0, y1) <= n \
                    and segment_meets_box(x0, y0, x1, y1, w, s, e, n):
                return True
    return False


def clip_polys(manifest_path, packs_json):
    """Geofabrik extracts carry whole ways that leave them, ferry lines above all (Ireland's
    reach Bilbao): limit every pack's cells to its extract's polygon, so the app doesn't
    offer it where it can't route. Packs carried over from older runs get it too."""
    manifest = json.load(open(manifest_path))
    countries = json.load(open(packs_json))["countries"]
    polys = {}
    for p in manifest["packs"]:
        src = countries.get(p["country"])
        if not src or not p.get("cells"):
            continue
        if p["country"] not in polys:
            rings = []
            for g in src["geofabrik"] if isinstance(src["geofabrik"], list) else [src["geofabrik"]]:
                url = f"https://download.geofabrik.de/{g}.poly"
                req = urllib.request.Request(url, headers={"User-Agent": "NomadPocket-routing/1.0 (+https://github.com/franlindebl/nomad-pocket)"})
                rings += read_poly(urllib.request.urlopen(req, timeout=60).read().decode())
            polys[p["country"]] = rings
        rings = polys[p["country"]]
        kept = [c for c in p["cells"] if cell_meets_poly(c, rings)]
        if not kept:
            continue  # never empty a pack's coverage on a bad polygon
        if len(kept) < len(p["cells"]):
            print(f"{p['id']}: {len(p['cells'])} → {len(kept)} cells", file=sys.stderr)
        xs = [x for r in rings for x, _ in r]
        ys = [y for r in rings for _, y in r]
        w, s, e, n = p["bbox"]
        p["cells"] = kept
        p["bbox"] = [max(w, min(xs)), max(s, min(ys)), min(e, max(xs)), min(n, max(ys))]
    json.dump(manifest, sys.stdout, indent=1)


if sys.argv[1] == "fragment":
    fragment(sys.argv[2], sys.argv[3], sys.argv[4])
elif sys.argv[1] == "merge":
    merge(sys.argv[2], sys.argv[3:])
elif sys.argv[1] == "carry":
    carry(sys.argv[2], sys.argv[3], sys.argv[4])
elif sys.argv[1] == "clip":
    clip_polys(sys.argv[2], sys.argv[3])
else:
    raise SystemExit(__doc__)
