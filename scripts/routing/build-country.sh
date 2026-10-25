#!/usr/bin/env bash
# Builds the offline routing packs of one country (docs/MAPS_NAVIGATION_PLAN.md, phase 2):
# Geofabrik extract + admin boundaries from Overpass → Valhalla tiles (one build per
# country) → the country pack and, with "slices", one pack per subdivision cut from that
# build → emergency points per pack → parts of at most 1900 MiB (GitHub Release assets
# stop at 2 GiB) and a JSON fragment for the manifest (manifest.py).
#
# Usage: scripts/routing/build-country.sh <country id from packs.json> <work dir>
# Needs curl, python3 with pyosmium and osmium-tool, and the Valhalla tools: run inside
# ghcr.io/valhalla/valhalla (CI does: apt-get install osmium-tool python3-pyosmium), or
# on a host with docker, which then runs each Valhalla tool in that image.
# Output: <work dir>/out/<pack>.tar[.partNN], <pack>.pois.tsv, <country>.packs.json
set -euo pipefail

COUNTRY="$1"
WORK="$(mkdir -p "$2" && cd "$2" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../.."
# Keep in step with the engine the app embeds (modules/nomad-route: valhalla-mobile 0.6.4).
IMAGE="${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla:3.9.1}"
CONC="${CONC:-4}"
PART_BYTES=$((1900 * 1024 * 1024))
OVERPASS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter)
UA="NomadPocket-routing/1.0 (+https://github.com/franlindebl/nomad-pocket)"

read -r GEOFABRIK ISO SLICES < <(python3 -I - "$HERE/packs.json" "$COUNTRY" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["countries"][sys.argv[2]]
print(c["geofabrik"], c["iso"], "1" if c.get("slices") else "0")
PY
)

OUT="$WORK/out"
mkdir -p "$WORK/src" "$OUT"
PBF="$WORK/src/$COUNTRY.osm.pbf"
log() { echo "[routing $COUNTRY] $*"; }
# Valhalla tools see the work dir as /w: natively through a symlink, else as a docker mount.
if command -v valhalla_build_tiles >/dev/null; then
  ln -sfn "$WORK" /w
  valhalla() { "$@"; }
else
  valhalla() { docker run --rm --user "$(id -u):$(id -g)" -v "$WORK:/w" "$IMAGE" "$@"; }
fi

# 1. Extract (Geofabrik publishes an .md5 next to each file).
URL="https://download.geofabrik.de/${GEOFABRIK}-latest.osm.pbf"
log "downloading $URL"
curl -fsSL --retry 3 -A "$UA" -o "$PBF" "$URL"
EXPECTED="$(curl -fsSL --retry 3 -A "$UA" "$URL.md5" | cut -d' ' -f1)"
ACTUAL="$( (md5sum "$PBF" 2>/dev/null || md5 -r "$PBF") | cut -d' ' -f1)"
[[ "$EXPECTED" == "$ACTUAL" ]] || { log "md5 mismatch"; exit 1; }
STAMP="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$PBF" || true)"
BUILD_DATE="$(echo "${STAMP:-$(date -u +%Y-%m-%d)}" | cut -c1-10 | tr -d -)"
log "data of $BUILD_DATE"

# 2. Admin boundaries: country (level 2) and regions (level 4) as complete relations.
#    Geofabrik's are clipped at the extract edge, so Valhalla can't build areas from them,
#    and without them it gets driving side and country access rules wrong.
QUERY="[out:xml][timeout:900];
relation[\"boundary\"=\"administrative\"][\"admin_level\"=\"2\"][\"ISO3166-1\"=\"$ISO\"]->.c;
.c map_to_area->.a;
(.c; relation(area.a)[\"boundary\"=\"administrative\"][\"admin_level\"=\"4\"];);
(._;>;);
out body;"
ok=0
for attempt in 1 2 3; do
  for server in "${OVERPASS[@]}"; do
    log "admin boundaries from $server (attempt $attempt)"
    if curl -fsS --max-time 1200 -A "$UA" --data-urlencode "data=$QUERY" -o "$WORK/src/admins.osm" "$server" \
      && grep -q '<relation' "$WORK/src/admins.osm"; then ok=1; break 2; fi
    sleep 30
  done
done
[[ $ok == 1 ]] || { log "no admin boundaries"; exit 1; }
osmium cat --overwrite "$WORK/src/admins.osm" -o "$WORK/src/admins.osm.pbf"

# 3. Valhalla tiles. build_tiles segfaults now and then in "Enhancing local graph"
#    (3.9.1): retry from scratch. Paths that don't exist instead of "" for unused inputs.
valhalla valhalla_build_config \
  --mjolnir-tile-dir /w/tiles --mjolnir-tile-extract /w/tiles.tar --mjolnir-admin /w/admins.sqlite \
  --mjolnir-timezone /w/nonexistent/tz.sqlite --mjolnir-traffic-extract /w/nonexistent/traffic.tar \
  --mjolnir-landmarks /w/nonexistent/landmarks.sqlite --mjolnir-concurrency "$CONC" > "$WORK/valhalla.json"
valhalla valhalla_build_admins -c /w/valhalla.json /w/src/admins.osm.pbf > "$WORK/admins.log" 2>&1
built=0
for attempt in 1 2 3; do
  rm -rf "$WORK/tiles"
  log "building tiles (attempt $attempt)"
  if valhalla valhalla_build_tiles -c /w/valhalla.json "/w/src/$COUNTRY.osm.pbf" > "$WORK/tiles.log" 2>&1; then built=1; break; fi
  tail -5 "$WORK/tiles.log"
done
[[ $built == 1 ]] || { log "valhalla_build_tiles failed"; exit 1; }

# 4. Packs: the country, then its subdivisions as tile subsets of the same build.
extract() { # <tile dir under WORK> <pack id>
  valhalla bash -c "valhalla_build_config --mjolnir-tile-dir /w/$1 --mjolnir-tile-extract /w/out/$2.tar \
    --mjolnir-admin /w/nonexistent --mjolnir-timezone /w/nonexistent > /tmp/v.json && valhalla_build_extract -c /tmp/v.json" \
    > "$WORK/extract-$2.log" 2>&1
  log "pack $2: $(wc -c < "$OUT/$2.tar") bytes"
}
extract tiles "$COUNTRY"
POI_OUTS=("/w/out/$COUNTRY.pois.tsv")
SLICE_IDS=()
if [[ $SLICES == 1 ]]; then
  while read -r ID W S E N; do
    rm -rf "$WORK/slice"
    python3 -I "$HERE/slice.py" "$WORK/tiles" "$WORK/slice" "$W" "$S" "$E" "$N"
    extract slice "$ID"
    POI_OUTS+=("/w/out/$ID.pois.tsv=$W,$S,$E,$N")
    SLICE_IDS+=("$ID")
  done < <(python3 -I - "$ROOT/src/features/maps/regions.json" "$HERE/packs.json" "$COUNTRY" <<'PY'
import json, sys
own = json.load(open(sys.argv[2]))["countries"]
for r in json.load(open(sys.argv[1]))["regions"]:
    # A subdivision with its own packs.json entry is built from its own extract.
    if r.get("parent") == sys.argv[3] and r["id"] not in own:
        print(r["id"], *r["bbox"])
PY
)
  rm -rf "$WORK/slice"
fi

# 5. Emergency points per pack (same filters as the app's Overpass query).
osmium tags-filter --overwrite "$PBF" \
  nwr/amenity=hospital,clinic,doctors,pharmacy,police,fire_station,drinking_water,water_point,shelter,fuel,townhall,embassy \
  nwr/healthcare=hospital,centre,clinic nwr/emergency=ambulance_station,defibrillator,assembly_point \
  nwr/military=barracks,base nwr/natural=spring nwr/shop=supermarket,hardware,doityourself nwr/office=diplomatic \
  -o "$WORK/src/pois.osm.pbf"
python3 -I "$HERE/emergency-points.py" "$WORK/src/pois.osm.pbf" "${POI_OUTS[@]//\/w\//$WORK/}"

# 6. Parts for GitHub's 2 GiB asset limit (the app appends them back together).
for tar in "$OUT"/*.tar; do
  if (( $(wc -c < "$tar") > PART_BYTES )); then
    split -b "$PART_BYTES" -d -a 2 "$tar" "$tar.part"
    rm "$tar"
    log "split $(basename "$tar")"
  fi
done

python3 -I "$HERE/manifest.py" fragment "$OUT" "$COUNTRY" "$BUILD_DATE" "${SLICE_IDS[@]}" > "$OUT/$COUNTRY.packs.json"
log "done: $(ls "$OUT" | wc -l) files"
