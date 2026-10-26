#!/usr/bin/env bash
# Builds the offline map of one country for the app's country downloads
# (docs/UX_SURVIVAL_PLAN.md): an extract of the Protomaps planet build over the country's
# outline (country-region.py: Natural Earth polygons, islands included, neighbours out;
# the bbox of src/features/maps/regions.json for a country Natural Earth lacks) at full
# detail (z15). Very large countries get the highest zoom whose archive stays under
# MAX_BYTES. Parts of at most 1900 MiB (GitHub Release assets stop at 2 GiB). Countries
# without a routing pack (scripts/routing/packs.json:
# those packs already carry them) also get their emergency points, street names, named
# places and house numbers from their Geofabrik extract, so a country download is complete
# and never needs Overpass.
#
# Usage: scripts/maps/build-country-map.sh <country id> <work dir> <planet build url>
# Needs pmtiles (go-pmtiles), curl, python3 with shapely; for the points, osmium-tool and pyosmium.
# Output: <work dir>/out/<id>.pmtiles[.partNN], <id>.{pois,streets,places,addresses}.tsv, <id>.maps.json
set -euo pipefail

ID="$1"
WORK="$(mkdir -p "$2" && cd "$2" && pwd)"
BUILD_URL="$3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD_DATE="$(basename "$BUILD_URL" .pmtiles)"
# A phone holds a few of these; France at z15 is 9.4 GB.
MAX_BYTES="${MAX_BYTES:-10000000000}"
PART_BYTES="${PART_BYTES:-$((1900 * 1024 * 1024))}"
UA="NomadPocket-maps/1.0 (+https://github.com/franlindebl/nomad-pocket)"
OUT="$WORK/out"
mkdir -p "$OUT" "$WORK/src"
log() { echo "[map $ID] $*"; }

BBOX="$(python3 -I - "$ROOT/src/features/maps/regions.json" "$ID" <<'PY'
import json, sys
r = next((r for r in json.load(open(sys.argv[1]))["regions"] if r["id"] == sys.argv[2] and r["type"] == "country"), None)
if not r:
    sys.exit(f"unknown country {sys.argv[2]}")
print(",".join(str(v) for v in r["bbox"]))
PY
)"

# 0. The country's outline (and the bbox the manifest gives the app). A failed download or
#    outline fails the job (the catalog keeps last month's map): the bbox would drop islands
#    and exclaves (Spain's leaves out Canarias, Ceuta and Melilla; Portugal's the Azores and
#    Madeira). Natural Earth v5.1.2, pinned by commit and hash: the commit dl-ne.mjs fetches
#    for the region ids of make-regions.mjs.
NE_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_10m_admin_0_countries.geojson"
NE_SHA256="239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255"
NE="$WORK/src/ne_10m_admin_0_countries.geojson"
[[ -s "$NE" ]] || curl -fsSL --retry 3 -o "$NE" "$NE_URL"
NE_ACTUAL="$(python3 -I -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$NE")"
if [[ "$NE_ACTUAL" != "$NE_SHA256" ]]; then
  rm -f "$NE"
  log "Natural Earth sha256 mismatch: expected $NE_SHA256, got $NE_ACTUAL"
  exit 1
fi
REGION_STATUS=0
REGION_BBOX="$(python3 -I "$HERE/country-region.py" "$ID" "$NE" "$WORK/src/$ID.geojson")" || REGION_STATUS=$?
if (( REGION_STATUS == 0 )); then
  AREA=(--region="$WORK/src/$ID.geojson")
  BBOX="$REGION_BBOX"
  log "outline, bbox $BBOX"
elif (( REGION_STATUS == 3 )); then # country-region.py's NOT_FOUND
  AREA=(--bbox="$BBOX")
  log "not in Natural Earth: bbox $BBOX"
else
  log "country-region.py failed ($REGION_STATUS)"
  exit 1
fi

# 1. Points, street names, places and house numbers, unless a routing pack covers the
#    country. Before the map, so the extract is gone when the map needs the disk (~14 GB
#    on a runner). Countries with no Geofabrik extract of their own (Vatican, small
#    islands) get none: the app then asks Overpass for their points by itself.
if [[ "${SKIP_POINTS:-}" != "1" ]] && ! python3 -I - "$ROOT/scripts/routing/packs.json" "$ID" <<'PY'
import json, sys
# A pack of its own, or one whose extract covers the whole country (routePackFor in
# src/features/maps/country-core.ts). Not the UK: `ie` lists GB for Northern Ireland only.
SHARED = {"ht": "do"}
packs = json.load(open(sys.argv[1]))["countries"]
sys.exit(0 if sys.argv[2] in packs or SHARED.get(sys.argv[2]) in packs else 1)
PY
then
  INDEX="$WORK/src/geofabrik-index.json"
  curl -fsSL --retry 3 -A "$UA" -o "$INDEX" https://download.geofabrik.de/index-v1-nogeom.json
  # An extract of this country alone before one shared with neighbours, and among those the
  # one named after it: Geofabrik tags six Pacific extracts VU (American Oceania, Tokelau,
  # French Polynesia…) and two MH. A tie left after that takes none (Overpass then), never
  # another country's points.
  PBF_URL="$(python3 -I - "$INDEX" "$ROOT/src/features/maps/regions.json" "$ID" <<'PY'
import json, re, sys, unicodedata
cid = sys.argv[3]
iso = cid.upper()
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")
names = {slug(n) for r in json.load(open(sys.argv[2]))["regions"] if r["id"] == cid for n in r["name"].values()}
found = [f["properties"] for f in json.load(open(sys.argv[1]))["features"] if iso in f["properties"].get("iso3166-1:alpha2", [])]
rank = lambda p: (len(p["iso3166-1:alpha2"]), not {slug(p["name"]), p["id"].rsplit("/", 1)[-1]} & names)
found.sort(key=rank)
if len(found) > 1 and rank(found[0]) == rank(found[1]):
    print(f"[map {cid}] Geofabrik extracts tied: {', '.join(p['id'] for p in found if rank(p) == rank(found[0]))}", file=sys.stderr)
    found = []
print(found[0]["urls"]["pbf"] if found else "")
PY
)"
  pbf_bytes() { { curl -fsSLI --retry 3 -A "$UA" "$1" || true; } | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n+0}'; }
  URLS=()
  [[ -n "$PBF_URL" ]] && URLS=("$PBF_URL")
  # One too big to read at once (the USA, 11 GB: the runner ran out of memory) is read
  # in its Geofabrik sub-extracts (the states) and the files are merged after. Not
  # those of other countries (Puerto Rico and the US Virgin Islands sit under us/).
  if [[ -n "$PBF_URL" ]] && (( $(pbf_bytes "$PBF_URL") > ${SPLIT_BYTES:-6000000000} )); then
    URLS=()
    while IFS= read -r url; do URLS+=("$url"); done < <(python3 -I - "$INDEX" "$ID" "$PBF_URL" <<'PY'
import json, sys
iso, url = sys.argv[2].upper(), sys.argv[3]
props = [f["properties"] for f in json.load(open(sys.argv[1]))["features"]]
parent = next(p["id"] for p in props if p["urls"]["pbf"] == url)
for p in props:
    # Germany's Länder name their parent; the US states are only named "us/…".
    if (p.get("parent") == parent or p["id"].startswith(parent + "/")) and iso in p.get("iso3166-1:alpha2", [iso]) and all(c.startswith(iso + "-") for c in p.get("iso3166-2", [iso + "-"])):
        print(p["urls"]["pbf"])
PY
)
    log "extract too big to read at once: ${#URLS[@]} sub-extracts"
  fi
  ROLES=(pois streets places addresses)
  [[ ${#URLS[@]} -gt 0 ]] || log "no Geofabrik extract: no points"
  for URL in "${URLS[@]}"; do
    BYTES="$(pbf_bytes "$URL")"
    FREE_BYTES="$(python3 -I -c 'import shutil, sys; print(shutil.disk_usage(sys.argv[1]).free)' "$WORK")"
    if (( BYTES * 2 > FREE_BYTES )); then
      log "extract of $BYTES bytes doesn't fit in $FREE_BYTES free: no points from $URL"
      continue
    fi
    PBF="$WORK/src/$ID.osm.pbf"
    log "points from $URL"
    curl -fsSL --retry 3 -A "$UA" -o "$PBF" "$URL"
    # Keep in step with build-country.sh (step 5) and overpassQuery in emergency-core.ts.
    osmium tags-filter --overwrite "$PBF" \
      nwr/amenity=hospital,clinic,doctors,pharmacy,police,fire_station,drinking_water,water_point,shelter,fuel,townhall,embassy \
      nwr/healthcare=hospital,centre,clinic nwr/emergency=ambulance_station,defibrillator,assembly_point \
      nwr/military=barracks,base nwr/natural=spring nwr/shop=supermarket,hardware,doityourself nwr/office=diplomatic \
      -o "$WORK/src/pois.osm.pbf"
    python3 -I "$ROOT/scripts/routing/emergency-points.py" "$WORK/src/pois.osm.pbf" "$WORK/src/part.pois.tsv"
    rm -f "$WORK/src/pois.osm.pbf"
    osmium tags-filter --overwrite "$PBF" w/highway n/place -o "$WORK/src/streets.osm.pbf"
    python3 -I "$ROOT/scripts/routing/streets.py" "$WORK/src/streets.osm.pbf" "$WORK/src/part.streets.tsv"
    rm -f "$WORK/src/streets.osm.pbf"
    # Keep in step with build-country.sh (step 6b).
    osmium tags-filter --overwrite "$PBF" nwr/name nwr/addr:housenumber nwr/addr:block_number -o "$WORK/src/places.osm.pbf"
    python3 -I "$ROOT/scripts/routing/places.py" "$WORK/src/places.osm.pbf" "$WORK/src/part.places.tsv" "$WORK/src/part.addresses.tsv"
    rm -f "$PBF" "$WORK/src/places.osm.pbf"
    for ROLE in "${ROLES[@]}"; do
      cat "$WORK/src/part.$ROLE.tsv" >> "$OUT/$ID.$ROLE.tsv"
      rm -f "$WORK/src/part.$ROLE.tsv"
    done
  done
  for ROLE in "${ROLES[@]}"; do
    F="$OUT/$ID.$ROLE.tsv"
    [[ -f "$F" ]] || continue
    # Sub-extracts overlap along their borders: the same rows twice.
    (( ${#URLS[@]} > 1 )) && LC_ALL=C sort -u -T "$WORK/src" -o "$F" "$F"
    # A side file is one release asset (2 GiB at most) and one import on the phone.
    if (( $(wc -c < "$F") > PART_BYTES )); then
      log "$ROLE: $(wc -c < "$F") bytes, too big for one asset: left out"
      rm -f "$F"
    fi
  done
fi

# 2. The highest zoom (15 down to 10) whose archive fits, from pmtiles' dry run.
archive_bytes() {
  pmtiles extract "$BUILD_URL" /dev/null "${AREA[@]}" --maxzoom="$1" --dry-run 2>&1 |
    python3 -I -c '
import re, sys
m = re.search(r"archive size of ([\d.]+) (\w+)", sys.stdin.read())
units = {"B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}
print(int(float(m.group(1)) * units[m.group(2)]) if m else -1)'
}
ZOOM=""
for Z in 15 14 13 12 11 10; do
  BYTES="$(archive_bytes "$Z")"
  log "z$Z: $BYTES bytes"
  [[ "$BYTES" -lt 0 ]] && { log "dry run failed"; exit 1; }
  if (( BYTES <= MAX_BYTES )); then ZOOM="$Z"; break; fi
done
[[ -n "$ZOOM" ]] || { log "too large even at z10"; exit 1; }

pmtiles extract "$BUILD_URL" "$OUT/$ID.pmtiles" "${AREA[@]}" --maxzoom="$ZOOM" --download-threads=8
log "map z$ZOOM: $(wc -c < "$OUT/$ID.pmtiles") bytes"
# Parts cut from the end and truncated off, so the disk never holds the archive twice.
if (( $(wc -c < "$OUT/$ID.pmtiles") > PART_BYTES )); then
  python3 -I - "$OUT/$ID.pmtiles" "$PART_BYTES" <<'PY'
import os, sys
path, part = sys.argv[1], int(sys.argv[2])
n = (os.path.getsize(path) + part - 1) // part
with open(path, "r+b") as f:
    for i in reversed(range(1, n)):
        f.seek(i * part)
        with open(f"{path}.part{i:02d}", "wb") as out:
            while chunk := f.read(8 << 20):
                out.write(chunk)
        f.truncate(i * part)
os.rename(path, f"{path}.part00")
PY
fi

python3 -I "$HERE/maps-manifest.py" fragment "$OUT" "$ID" "$BUILD_DATE" "$ZOOM" "$BBOX" > "$OUT/$ID.maps.json"
log "done"
