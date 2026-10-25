"""Describes built routing packs for the app (src/features/maps/routing-catalog.ts).
  fragment <out dir> <country> <YYYYMMDD> [slice ids...]  → JSON list of this country's packs
  merge <release tag> <fragment.json...>                 → routing-manifest.json
  carry <previous manifest> <new manifest>               → new + previous packs of countries not rebuilt
A pack is one tar (Valhalla tile extract) in one or more parts; the app downloads the
parts in order and appends them. bbox comes from the tile names, like tileBBox() in
src/features/maps/routing-core.ts."""
import glob, hashlib, json, math, os, sys, time

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


def fragment(out_dir, country, build_date, slice_ids):
    packs = []
    for pid in [country] + slice_ids:
        whole = os.path.join(out_dir, f"{pid}.tar")
        parts = [whole] if os.path.exists(whole) else sorted(glob.glob(os.path.join(out_dir, f"{pid}.tar.part*")))
        if not parts:
            raise SystemExit(f"no tar for {pid}")
        pois = os.path.join(out_dir, f"{pid}.pois.tsv")
        coverage = tile_bbox(tar_names(parts))
        packs.append({
            "id": pid,
            "country": country,
            "regionId": pid,
            "buildDate": build_date,
            "bbox": coverage[0],
            "cells": coverage[1],
            "size": sum(os.path.getsize(p) for p in parts),
            "parts": [{"name": os.path.basename(p), "size": os.path.getsize(p), "sha256": sha256(p)} for p in parts],
            "pois": {"name": os.path.basename(pois), "size": os.path.getsize(pois), "sha256": sha256(pois)}
            if os.path.exists(pois) else None,
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


def carry(previous, current):
    prev, cur = json.load(open(previous)), json.load(open(current))
    rebuilt = {p["country"] for p in cur["packs"]}
    kept = [dict(p, release=p.get("release", prev["release"])) for p in prev["packs"] if p["country"] not in rebuilt]
    cur["packs"] = sorted(cur["packs"] + kept, key=lambda p: p["id"])
    json.dump(cur, sys.stdout, indent=1)


if sys.argv[1] == "fragment":
    fragment(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:])
elif sys.argv[1] == "merge":
    merge(sys.argv[2], sys.argv[3:])
elif sys.argv[1] == "carry":
    carry(sys.argv[2], sys.argv[3])
else:
    raise SystemExit(__doc__)
