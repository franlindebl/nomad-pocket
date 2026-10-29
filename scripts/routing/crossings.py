"""Where roads cross a routing pack's border, for routes across packs (docs/ROUTING_ACROSS_PACKS.md).

The app routes a trip between two packs in legs joined at one of these crossings, chosen by
adding up the times of every combination (src/features/maps/stitch-core.ts). Only roads from
motorway to tertiary: a seam is never a track.

Ferries too (and the Channel Tunnel's car shuttle): Geofabrik keeps a way that leaves the
extract whole, so both countries' packs hold the whole crossing, each up to the port on the
other side (checked on Tallinn–Helsinki). The seam is that port, outside the pack: one leg
ends there off the boat, the next starts there on land. Its bearing is the boat's, arriving.

Usage: crossings.py <roads.osm.pbf> <admins.geojsonseq> <ISO[,ISO…]> <out.tsv> [<extract .poly>…]
- roads: the pack's extract filtered to w/highway=motorway,…,tertiary and w/route=ferry,shuttle_train
  (build-country.sh).
- admins: the admin boundaries of build-country.sh step 2 as areas (osmium export).
- The border is the country's (ISO 3166-1, any admin level, else ISO 3166-2 as for
  territories), or, given the pack's Geofabrik polygons (a part of a split country, "us-west"),
  the outline of the country's level-4 areas inside them.
Output, one crossing per line: lat, lon, class (a road's, or ferry), bearing leaving the pack,
both|in|out (which way a one-way road goes), ref. Nothing at all without a boundary (islands, territories
with none in OSM): the app then can't stitch through that pack.
"""
import json
import math
import sys

import osmium
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.prepared import prep

CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "ferry")
FERRIES = ("ferry", "shuttle_train")


def read_poly(path):
    """Outer rings of an Osmosis .poly file as one area (holes, marked '!', don't matter here)."""
    rings, ring, hole = [], None, False
    for line in list(open(path))[1:]:
        line = line.strip()
        if line == "END":
            if ring is None:
                break
            if not hole and len(ring) >= 3:
                rings.append(Polygon(ring))
            ring = None
        elif ring is None:
            hole, ring = line.startswith("!"), []
        elif line:
            x, y = map(float, line.split()[:2])
            ring.append((x, y))
    return unary_union(rings)


def pack_area(admins_path, isos, polys):
    countries, regions, by_subdivision = [], [], []
    for line in open(admins_path):
        f = json.loads(line.lstrip("\x1e"))
        if f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
            continue
        tags = f["properties"]
        geom = shape(f["geometry"]).buffer(0)
        if tags.get("ISO3166-1") in isos:
            countries.append(geom)
        elif tags.get("admin_level") == "4":
            regions.append(geom)
        if any(str(tags.get("ISO3166-2", "")).endswith("-" + iso) for iso in isos):
            by_subdivision.append(geom)
    country = unary_union(countries or by_subdivision) if (countries or by_subdivision) else None
    if not polys:
        return country
    extract = unary_union([read_poly(p) for p in polys])
    inside = [r for r in regions if extract.contains(r.representative_point())]
    return unary_union(inside) if inside else None


def bearing(a, b):
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def main(roads, admins, isos, out, polys):
    area = pack_area(admins, set(isos.split(",")), polys)
    rows = []
    if area is not None and not area.is_empty:
        border = area.boundary
        inside = prep(area)
        near = prep(border.buffer(0.01))

        class Roads(osmium.SimpleHandler):
            def way(self, w):
                if w.tags.get("route") in FERRIES:
                    return self.ferry(w)
                cls = w.tags.get("highway")
                if cls not in CLASSES:
                    return
                try:
                    pts = [(n.lon, n.lat) for n in w.nodes]
                except osmium.InvalidLocationError:
                    return
                if len(pts) < 2 or not near.intersects(LineString(pts)):
                    return
                oneway = w.tags.get("oneway") in ("yes", "1", "true") or cls == "motorway" or w.tags.get("junction") == "roundabout"
                reverse = w.tags.get("oneway") == "-1"
                for a, b in zip(pts, pts[1:]):
                    ia, ib = inside.contains(Point(a)), inside.contains(Point(b))
                    if ia == ib:
                        continue
                    x = LineString([a, b]).intersection(border)
                    p = x if x.geom_type == "Point" else x.centroid if not x.is_empty else Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    leaving = ia != reverse  # drawn from inside to outside (or the other way, oneway=-1)
                    dirs = "both" if not (oneway or reverse) else ("out" if leaving else "in")
                    rows.append((round(p.y, 6), round(p.x, 6), cls, round(bearing(a, b) if ia else bearing(b, a)), dirs, w.tags.get("ref", "")))

            def ferry(self, w):
                # One end at home and the other abroad: the port abroad. A ferry drawn in pieces
                # joins them out at sea: that point is the seam then, and each pack has its piece.
                try:
                    pts = [(n.lon, n.lat) for n in w.nodes]
                except osmium.InvalidLocationError:
                    return
                if len(pts) < 2:
                    return
                home = [inside.contains(Point(p)) for p in (pts[0], pts[-1])]
                if home[0] == home[1]:
                    return
                (a, b) = (pts[-2], pts[-1]) if home[0] else (pts[1], pts[0])
                name = w.tags.get("ref") or w.tags.get("name") or ""
                rows.append((round(b[1], 6), round(b[0], 6), "ferry", round(bearing(a, b)), "both", name.replace("\t", " ")[:80]))

        Roads().apply_file(roads, locations=True)
    with open(out, "w") as f:
        for r in sorted(rows, key=lambda r: (CLASSES.index(r[2]), r[0], r[1])):
            f.write("\t".join(map(str, r)) + "\n")
    print(f"{len(rows)} crossings: " + ", ".join(f"{c} {sum(r[2] == c for r in rows)}" for c in CLASSES), file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 5:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:])
