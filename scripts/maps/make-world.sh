#!/usr/bin/env bash
# Rebuilds assets/maps/world.pmtiles, the world basemap bundled in the app (z0–5, ~15 MB),
# from the latest Protomaps planet build. Then set BUNDLED_BUILD in
# src/features/maps/world.ts to the printed date. Needs pmtiles (go-pmtiles) and curl.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY="$(curl -fsSL https://build-metadata.protomaps.dev/builds.json |
  python3 -I -c 'import json, re, sys; print(sorted(b["key"] for b in json.load(sys.stdin) if re.match(r"^\d{8}\.pmtiles$", b["key"]))[-1])')"
pmtiles extract "https://build.protomaps.com/$KEY" "$ROOT/assets/maps/world.pmtiles" --maxzoom=5
echo "build ${KEY%.pmtiles}: $(wc -c < "$ROOT/assets/maps/world.pmtiles") bytes"
