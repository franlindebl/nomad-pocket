#!/usr/bin/env bash
# Builds the E2E fixture for routes across packs (e2e/fixtures/routing-stitch, flow map-19):
# Andorra cut in two at 1.555°E and each half built on its own, as two neighbouring countries
# are (each with a margin across the cut, as Geofabrik's extracts have), plus each half's
# crossings (crossings.py, the cut as its border).
# Usage: scripts/routing/stitch-fixture.sh <work dir>
# Needs curl, osmium-tool, python3 with pyosmium and shapely, and docker (Valhalla 3.9.1).
set -euo pipefail

WORK="$(mkdir -p "$1" && cd "$1" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../e2e/fixtures/routing-stitch"
IMAGE="${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla:3.9.1}"
CUT=1.555

curl -fsSL -A "NomadPocket-routing/1.0 (+https://github.com/franlindebl/nomad-pocket)" -o "$WORK/andorra.osm.pbf" \
  https://download.geofabrik.de/europe/andorra-latest.osm.pbf
osmium extract -O -s smart -b "1.40,42.40,$(python3 -c "print($CUT + 0.02)"),42.67" "$WORK/andorra.osm.pbf" -o "$WORK/xadw.osm.pbf"
osmium extract -O -s smart -b "$(python3 -c "print($CUT - 0.02)"),42.40,1.80,42.67" "$WORK/andorra.osm.pbf" -o "$WORK/xade.osm.pbf"
osmium tags-filter -O "$WORK/andorra.osm.pbf" w/highway=motorway,trunk,primary,secondary,tertiary -o "$WORK/roads.osm.pbf"

# Each half's "country": a box on its side of the cut.
python3 -I - "$WORK" "$CUT" <<'PY'
import json, sys
work, cut = sys.argv[1], float(sys.argv[2])
for iso, (w, e) in {"XW": (1.30, cut), "XE": (cut, 1.90)}.items():
    ring = [[w, 42.3], [e, 42.3], [e, 42.8], [w, 42.8], [w, 42.3]]
    feature = {"type": "Feature", "properties": {"ISO3166-1": iso, "admin_level": "2"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}
    open(f"{work}/{iso}.geojsonseq", "w").write("\x1e" + json.dumps(feature) + "\n")
PY
mkdir -p "$OUT"
python3 -I "$HERE/crossings.py" "$WORK/roads.osm.pbf" "$WORK/XW.geojsonseq" XW "$OUT/xadw.crossings.tsv"
python3 -I "$HERE/crossings.py" "$WORK/roads.osm.pbf" "$WORK/XE.geojsonseq" XE "$OUT/xade.crossings.tsv"

docker run --rm -v "$WORK:/w" -v "$OUT:/out" "$IMAGE" bash -c 'for p in xadw xade; do
  valhalla_build_config --mjolnir-tile-dir /w/tiles-$p --mjolnir-tile-extract /out/$p.tar --mjolnir-admin /w/x \
    --mjolnir-timezone /w/x --mjolnir-traffic-extract /w/x > /tmp/v.json
  valhalla_build_tiles -c /tmp/v.json /w/$p.osm.pbf > /w/$p.log 2>&1 && valhalla_build_extract -c /tmp/v.json > /dev/null 2>&1
done'
ls -la "$OUT"
