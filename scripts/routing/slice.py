"""Copies the Valhalla tiles of a country build that intersect a bbox into a new tile dir.
A region pack cut this way routes exactly like the country build inside it (packs built
from separate extracts break at their borders). Usage:
  python3 -I slice.py <src_tile_dir> <dst_tile_dir> minlon minlat maxlon maxlat
Tile ids follow Valhalla's TileHierarchy: level 0 = 4 deg, 1 = 1 deg, 2 = 0.25 deg; the
path is the level, then the id in groups of three digits; id = row * ncols + col."""
import os, shutil, sys

src, dst = sys.argv[1], sys.argv[2]
minlon, minlat, maxlon, maxlat = map(float, sys.argv[3:7])
SIZES = {0: 4.0, 1: 1.0, 2: 0.25, 3: 0.25}
n = total = 0
for root, _, files in os.walk(src):
    for f in files:
        if not f.endswith(".gph"):
            continue
        rel = os.path.relpath(os.path.join(root, f), src)
        parts = rel[:-4].split(os.sep)
        level = int(parts[0])
        tid = int("".join(parts[1:]))
        size = SIZES[level]
        ncols = int(round(360 / size))
        row, col = divmod(tid, ncols)
        tminlon, tminlat = -180 + col * size, -90 + row * size
        if tminlon < maxlon and tminlon + size > minlon and tminlat < maxlat and tminlat + size > minlat:
            out = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copy2(os.path.join(root, f), out)
            n += 1
            total += os.path.getsize(out)
print(f"slice {os.path.basename(dst)}: {n} tiles, {total} bytes")
