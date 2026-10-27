"""The area the map of a country's region covers (packs.json "region": us-west, us-alaska…),
for `pmtiles extract --region`: Geofabrik's polygon of the region (the same one its routing
pack is cut by) ∩ the country's Natural Earth polygons, each grown by BUFFER degrees as in
country-region.py. Every polygon of the country counts, far islands too: the region's
polygon decides what is in (Hawaii, the Aleutians), and the country's keeps the
neighbours' land out (Geofabrik's polygons reach over the border).
Usage: python3 -I region-outline.py <region.poly> <ne_10m_admin_0_countries.geojson> <country id> <out.geojson>
Prints the region's bbox (minlon,minlat,maxlon,maxlat) for the manifest: the side of the
antimeridian with most of the land when it straddles it (Alaska). Needs shapely."""
import json, sys

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

BUFFER = 0.05  # ~5 km, as country-region.py
TOLERANCE = 0.01


# Keep in step with country-region.py.
def country_id(p):
    iso = p.get("ISO_A2_EH") if p.get("ISO_A2_EH") not in (None, "-99") else p.get("ISO_A2")
    return (iso if iso and iso != "-99" else p["ADM0_A3"]).lower()


def parts(geom):
    return list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom] if isinstance(geom, Polygon) else []


def read_poly(path):
    """Osmosis .poly: sections of lon/lat pairs, END after each; a section named !… is a hole."""
    lines = [l.strip() for l in open(path)][1:]
    shells, holes, ring, name = [], [], None, None
    for line in lines:
        if not line:
            continue
        if line == "END":
            if ring is None:
                break
            (holes if name.startswith("!") else shells).append(Polygon(ring))
            ring = None
        elif ring is None:
            name, ring = line, []
        else:
            x, y = line.split()[:2]
            ring.append((float(x), float(y)))
    area = unary_union(shells)
    return area.difference(unary_union(holes)) if holes else area


def main(poly_path, ne_path, cid, out_path):
    features = json.load(open(ne_path))["features"]
    match = [f for f in features if country_id(f["properties"]) == cid] or [f for f in features if f["properties"]["ADM0_A3"].lower() == cid]
    if not match:
        sys.exit(f"{cid}: not in Natural Earth")
    country = unary_union([p.buffer(BUFFER) for f in match for p in parts(shape(f["geometry"]))])
    region = read_poly(poly_path).intersection(country).simplify(TOLERANCE)
    polys = [p for p in parts(region) if not p.is_empty]
    if not polys:
        sys.exit(f"{poly_path}: no land of {cid} in it")
    json.dump({"type": "Feature", "properties": {"id": cid}, "geometry": mapping(MultiPolygon(polys))}, open(out_path, "w"))
    east = [p for p in polys if p.centroid.x >= 0]
    west = [p for p in polys if p.centroid.x < 0]
    if east and west and max(p.bounds[2] for p in polys) - min(p.bounds[0] for p in polys) > 180:
        polys = east if sum(p.area for p in east) >= sum(p.area for p in west) else west
    w, s, e, n = unary_union(polys).bounds
    print(f"{max(-180, w):.3f},{max(-85, s):.3f},{min(180, e):.3f},{min(85, n):.3f}")


main(*sys.argv[1:5])
