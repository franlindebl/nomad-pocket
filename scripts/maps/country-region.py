"""The area a country map covers, for `pmtiles extract --region`: the country's polygons from
Natural Earth 1:10m admin-0 (public domain), its mainland plus islands and exclaves within
DIST degrees (Canarias, Baleares, Ceuta and Melilla for Spain; not French Guiana for
France), each grown by BUFFER degrees so coasts and borders keep their edge tiles.
A polygon instead of the bbox keeps neighbours out (Spain's bbox carries half of
Portugal and northern Morocco) and far islands in.
Usage: python3 -I country-region.py <id> <ne_10m_admin_0_countries.geojson> <out.geojson>
Prints the region's bbox (minlon,minlat,maxlon,maxlat) for the manifest. Needs shapely.
The id follows scripts/maps/make-regions.mjs (ISO_A2_EH, else ISO_A2, else ADM0_A3).
Exits with NOT_FOUND when Natural Earth has no such country (the caller then cuts by the
regions.json bbox); any other failure is an error."""
import json, sys

from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import unary_union

DIST = 10.0
BUFFER = 0.05  # ~5 km
TOLERANCE = 0.01
NOT_FOUND = 3  # 1 is any uncaught exception


def country_id(p):
    iso = p.get("ISO_A2_EH") if p.get("ISO_A2_EH") not in (None, "-99") else p.get("ISO_A2")
    return (iso if iso and iso != "-99" else p["ADM0_A3"]).lower()


def parts(geom):
    return list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]


def main(cid, ne_path, out_path):
    features = json.load(open(ne_path))["features"]
    match = [f for f in features if country_id(f["properties"]) == cid] or [f for f in features if f["properties"]["ADM0_A3"].lower() == cid]
    if not match:
        print(f"{cid}: not in Natural Earth", file=sys.stderr)
        sys.exit(NOT_FOUND)
    polys = [p for f in match for p in parts(shape(f["geometry"]))]
    # The side of the antimeridian with most of the land (Russia's Chukotka, Fiji, US Aleutians).
    east = [p for p in polys if p.centroid.x >= 0]
    west = [p for p in polys if p.centroid.x < 0]
    if east and west and max(p.bounds[2] for p in polys) - min(p.bounds[0] for p in polys) > 180:
        polys = east if sum(p.area for p in east) >= sum(p.area for p in west) else west
    polys.sort(key=lambda p: p.area, reverse=True)
    kept = [polys[0]]
    rest = polys[1:]
    changed = True
    while changed:
        changed = False
        core = unary_union(kept)
        for p in list(rest):
            if p.area >= 0.25 * polys[0].area or core.distance(p) <= DIST:
                kept.append(p)
                rest.remove(p)
                changed = True
    region = unary_union([p.buffer(BUFFER) for p in kept]).simplify(TOLERANCE)
    json.dump({"type": "Feature", "properties": {"id": cid}, "geometry": mapping(region)}, open(out_path, "w"))
    w, s, e, n = region.bounds
    print(f"{max(-180, w):.3f},{max(-85, s):.3f},{min(180, e):.3f},{min(85, n):.3f}")


main(*sys.argv[1:4])
