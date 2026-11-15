#!/usr/bin/env bash
# Fills a folder with what the E2E stand-in server serves on localhost, for scripts/e2e.sh (iOS) and
# scripts/e2e-android.sh: the content updates and official alerts stand-in feeds, the Andorra routing
# pack split in two parts (exercises reassembly) with its side files, the country maps catalog
# (maps-manifest.json: Andorra's fixture map in two parts, plus the regions stand-ins) and the routing
# catalog (fixture.json; the runners copy it, or live.json, to routing-manifest.json per flow).
#
#   scripts/e2e-serve.sh <dir> <port> [live]
#
# `live` also saves copies of the published catalogs (live.json, maps-live.json) for flows tagged
# routing-live / maps-live, whose packs and maps download from GitHub Releases.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVE="$1"; ROUTING_PORT="$2"; LIVE=0; [[ "${3:-}" == live ]] && LIVE=1
mkdir -p "$SERVE"
python3 -I "$ROOT/scripts/e2e-updates-feed.py" "$SERVE" "http://localhost:$ROUTING_PORT" >/dev/null
python3 -I "$ROOT/scripts/e2e-alerts-feed.py" "$SERVE" "http://localhost:$ROUTING_PORT" >/dev/null
if [[ "$LIVE" == 1 ]]; then
  curl -fsSL -o "$SERVE/live.json" "https://github.com/franlindebl/nomad-pocket/releases/download/routing-index/routing-manifest.json"
  curl -fsSL -o "$SERVE/maps-live.json" "https://github.com/franlindebl/nomad-pocket/releases/download/maps-index/maps-manifest.json"
fi
split -b 2000000 -d -a 2 "$ROOT/e2e/fixtures/routing/ad.tar" "$SERVE/ad.tar.part"
cp "$ROOT"/e2e/fixtures/routing/ad.{pois,streets,places,addresses}.tsv "$SERVE/"
split -b 1500000 -d -a 2 "$ROOT/e2e/fixtures/maps/ad.pmtiles" "$SERVE/ad.pmtiles.part"
# Countries in regions (docs/COUNTRY_REGIONS_PLAN.md), with Andorra's files as stand-ins under one
# file name each: the USA with a map and a pack per region (us-alaska, us-hawaii) and Canada with
# two regional maps (ca-ontario, ca-quebec) plus one national pack (ca) with its side files.
for id in us-alaska us-hawaii ca-ontario ca-quebec; do cp "$ROOT/e2e/fixtures/maps/ad.pmtiles" "$SERVE/$id.pmtiles"; done
for id in us-alaska us-hawaii ca; do
  cp "$ROOT/e2e/fixtures/routing/ad.tar" "$SERVE/$id.tar"
  for side in pois streets places addresses; do cp "$ROOT/e2e/fixtures/routing/ad.$side.tsv" "$SERVE/$id.$side.tsv"; done
done
python3 -I - "$SERVE" "$ROUTING_PORT" <<'PY'
import hashlib, json, os, sys
d, port = sys.argv[1], sys.argv[2]
def f(n):
  p = os.path.join(d, n)
  return {"name": n, "size": os.path.getsize(p), "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()}
parts = [f(n) for n in sorted(os.listdir(d)) if n.startswith("ad.tar.part")]
pack = {"id": "ad", "country": "ad", "regionId": "ad", "buildDate": "20261024", "bbox": [1.25, 42.25, 2.0, 42.75],
      "size": sum(p["size"] for p in parts), "parts": parts, "pois": f("ad.pois.tsv"), "streets": f("ad.streets.tsv"),
      "places": f("ad.places.tsv"), "addresses": f("ad.addresses.tsv")}
def rpack(i, region, bbox):
  sides = {k: f(f"{i}.{k}.tsv") for k in ("pois", "streets", "places", "addresses")}
  tar = f(i + ".tar")
  return {"id": i, "country": region, "regionId": region, "buildDate": "20261024", "bbox": bbox, "size": tar["size"], "parts": [tar], **sides}
packs = [pack, rpack("us-alaska", "us", [-170, 51, -129, 72]), rpack("us-hawaii", "us", [-161, 18, -154, 23]),
       rpack("ca", "ca", [-141, 41.6, -52, 83])]
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "valhalla": "3.9.1", "packs": packs},
        open(os.path.join(d, "fixture.json"), "w"))
# The country map: its points and street names come with the routing pack, as for a real country.
mparts = [f(n) for n in sorted(os.listdir(d)) if n.startswith("ad.pmtiles.part")]
cmap = {"id": "ad", "regionId": "ad", "buildDate": "20261025", "maxZoom": 10, "bbox": [1.394, 42.414, 1.761, 42.663],
      "size": sum(p["size"] for p in mparts), "parts": mparts, "pois": None, "streets": None}
def rmap(i, region, bbox, cells=None):
  m = f(i + ".pmtiles")
  return {"id": i, "regionId": region, "buildDate": "20261025", "maxZoom": 10, "bbox": bbox, "size": m["size"], "parts": [m],
          "pois": None, "streets": None, "cells": cells}
cell = lambda lat, lon: (lat + 90) * 360 + (lon + 180)  # routing-core cellOf
# Ontario holds Toronto (43.65, -79.38) and Ottawa; Quebec holds Montreal (45.50, -73.57) and Quebec City.
ontario = [cell(la, lo) for la in (43, 44, 45) for lo in (-80, -79, -76, -75)]
quebec = [cell(la, lo) for la in (45, 46) for lo in (-74, -73, -72, -71)]
maps = [cmap, rmap("us-alaska", "us", [-170, 51, -129, 72]), rmap("us-hawaii", "us", [-161, 18, -154, 23]),
      rmap("ca-ontario", "ca", [-95, 41.6, -74.3, 57], ontario), rmap("ca-quebec", "ca", [-79.8, 45, -57, 62], quebec)]
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "maps": maps},
        open(os.path.join(d, "maps-manifest.json"), "w"))
PY
