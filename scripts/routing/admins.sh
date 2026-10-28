#!/usr/bin/env bash
# Admin boundaries of a routing pack's country from Overpass: the country (level 2) and its
# regions (level 4) as complete relations. Geofabrik's are clipped at the extract edge, so
# Valhalla can't build areas from them, and without them it gets driving side and country
# access rules wrong; crossings.py draws the pack's border from them too.
#
# Usage: scripts/routing/admins.sh <ISO[,ISO…]> <out dir>
# Writes <out dir>/admins-<ISO>.osm.pbf ("DO,HT" → admins-DO_HT), or admins-<ISO>.none when OSM
# has none (the pack is then built without them: right-hand traffic, default access). Exits 1
# when no server answers. Needs curl and osmium-tool.
#
# Run monthly for every pack by .github/workflows/admin-boundaries.yml, which keeps the files
# in the routing-admins release; build-country.sh reads them from there and only calls this
# for a country missing in it. Territories are often not level 2 in OSM (Puerto Rico, Aruba,
# Åland): then the relation with that ISO 3166-1 code at any level, then by ISO 3166-2
# ("US-PR"). The public servers answer 502/504 for a while under load: rounds over all of
# them, waiting longer after each (half an hour of pauses in all).
set -euo pipefail

ISO="$1"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
KEY="admins-${ISO//,/_}"
# maps.mail.ru last, as a CI-only fallback: these queries ask for public admin boundaries
# and carry no user data. The app lists European servers only (emergency.ts).
OVERPASS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.kumi.systems/api/interpreter
  https://maps.mail.ru/osm/tools/overpass/api/interpreter)
UA="NomadPocket-routing/1.0 (+https://github.com/franlindebl/nomad-pocket)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
log() { echo "[admins $ISO] $*"; }

RE="${ISO//,/|}"
query() { # <tag filter of the country relation>
  echo "[out:xml][timeout:900];
relation[\"boundary\"=\"administrative\"]$1->.c;
.c map_to_area->.a;
(.c; relation(area.a)[\"boundary\"=\"administrative\"][\"admin_level\"=\"4\"];);
(._;>;);
out body;"
}

for filter in "[\"admin_level\"=\"2\"][\"ISO3166-1\"~\"^($RE)\$\"]" "[\"ISO3166-1\"~\"^($RE)\$\"]" "[\"ISO3166-2\"~\"-($RE)\$\"]"; do
  answered=0
  for attempt in 1 2 3 4 5 6; do
    for server in "${OVERPASS[@]}"; do
      log "$filter from $server (attempt $attempt)"
      if curl -fsS --max-time 1200 -A "$UA" --data-urlencode "data=$(query "$filter")" -o "$TMP/admins.osm" "$server" \
        && grep -q '</osm>' "$TMP/admins.osm"; then answered=1; break 2; fi
      sleep 30
    done
    [[ $attempt == 6 ]] || sleep $((attempt * 120))
  done
  [[ $answered == 1 ]] || { log "no answer from Overpass"; exit 1; }
  if grep -q '<relation' "$TMP/admins.osm"; then
    osmium cat --overwrite "$TMP/admins.osm" -o "$TMP/$KEY.osm.pbf"
    mv "$TMP/$KEY.osm.pbf" "$OUT/$KEY.osm.pbf"
    rm -f "$OUT/$KEY.none"
    log "$(osmium fileinfo -e -g data.count.relations "$OUT/$KEY.osm.pbf") relations"
    exit 0
  fi
done
log "none in OSM"
echo none > "$OUT/$KEY.none" # GitHub refuses empty assets
rm -f "$OUT/$KEY.osm.pbf"
