#!/usr/bin/env bash
# Functional E2E suite on the iOS simulator (Maestro). Plan: docs/E2E.md.
#
#   scripts/e2e.sh                    # smoke (P0)
#   scripts/e2e.sh --tags full        # any tag: smoke, full, nightly, reader, maps…
#   scripts/e2e.sh e2e/flows/reader   # specific flows or folders
#   --build    rebuild the Release .app first (needed after any app code change)
#   --list     print the flows that would run, and exit
#
# Every flow runs on a fresh install. Flows tagged `seeded` get the ZIM files in
# e2e/fixtures/ copied to Documents/content/zim/, `seeded-map` the .pmtiles to
# content/maps/ and `seeded-route` the routing pack (fixtures/routing/*.tar) to
# content/routing/ (registered at startup by src/features/{library,maps}/register.ts).
# Results: e2e/artifacts/<timestamp>/.
#
# Env: DEVICE (simulator name, default NP-e2e), DERIVED (xcodebuild derived data, default
# ios/build/sim), APP (path to a Release simulator .app; built when missing), MAESTRO
# (binary), JAVA_HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE=com.fjlinde.nomadpocket
DEVICE="${DEVICE:-NP-e2e}"
DERIVED="${DERIVED:-$ROOT/ios/build/sim}"
APP="${APP:-$DERIVED/Build/Products/Release-iphonesimulator/NomadPocket.app}"
MAESTRO="${MAESTRO:-maestro}"
TAGS=smoke
TARGETS=()
BUILD=0
LIST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags) TAGS="$2"; shift 2 ;;
    --build) BUILD=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TARGETS+=("$1"); TAGS=""; shift ;;
  esac
done

# Flow files to run: explicit targets, or every flow carrying one of $TAGS.
FLOWS=()
if [[ ${#TARGETS[@]} -gt 0 ]]; then
  while IFS= read -r f; do FLOWS+=("$f"); done < <(find "${TARGETS[@]}" -name '*.yaml' | sort)
else
  pattern="$(echo "$TAGS" | sed 's/,/|/g')"
  while IFS= read -r f; do
    grep -qE "^tags:.*[[ ,]($pattern)[],]" "$f" && FLOWS+=("$f")
  done < <(find "$ROOT/e2e/flows" -name '*.yaml' | sort)
fi
[[ ${#FLOWS[@]} -gt 0 ]] || { echo "No flows match"; exit 1; }
if [[ $LIST -eq 1 ]]; then
  for f in "${FLOWS[@]}"; do echo "${f#"$ROOT"/}"; done
  echo "${#FLOWS[@]} flows"; exit 0
fi

if ! java -version >/dev/null 2>&1; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# The suite's app reads the routing and country map catalogs from the local server below.
ROUTING_PORT="${ROUTING_PORT:-8765}"
export EXPO_PUBLIC_ROUTING_MANIFEST_URL="http://localhost:$ROUTING_PORT/routing-manifest.json"
export EXPO_PUBLIC_MAPS_MANIFEST_URL="http://localhost:$ROUTING_PORT/maps-manifest.json"

if [[ $BUILD -eq 1 || ! -d "$APP" ]]; then
  echo "Building ${APP}…"
  xcodebuild -workspace "$ROOT/ios/NomadPocket.xcworkspace" -scheme NomadPocket \
    -configuration Release -sdk iphonesimulator -derivedDataPath "$DERIVED" \
    -packageAuthorizationProvider netrc build | tail -3
fi

UDID="$(xcrun simctl list devices available | grep -E "^ +$DEVICE \(" | head -1 | grep -oE '[0-9A-F-]{36}')"
[[ -n "$UDID" ]] || { echo "Simulator '$DEVICE' not found: run scripts/e2e-setup.sh"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl location "$UDID" set 40.4168,-3.7038

# `routing-server` flows download a routing pack: the Andorra fixture split in two
# parts (exercises reassembly) plus its emergency points and street names, served
# from localhost.
# `routing-live` flows get the published catalog instead (a copy of GitHub's
# routing-manifest.json, whose packs download from GitHub Releases), swapped in per flow.
# The country maps catalog (maps-manifest.json) always lists Andorra: the fixture map in
# e2e/fixtures/maps/ split in two parts, so a country download exercises reassembly.
SERVER_PID=""
if printf '%s\n' "${FLOWS[@]}" | xargs grep -lE '^tags:.*[[ ,](routing-server|routing-live|maps-server)[],]' >/dev/null 2>&1; then
  SERVE="$(mktemp -d)"
  if printf '%s\n' "${FLOWS[@]}" | xargs grep -lE '^tags:.*[[ ,]routing-live[],]' >/dev/null 2>&1; then
    curl -fsSL -o "$SERVE/live.json" "https://github.com/franlindebl/nomad-pocket/releases/download/routing-index/routing-manifest.json"
  fi
  split -b 2000000 -d -a 2 "$ROOT/e2e/fixtures/routing/ad.tar" "$SERVE/ad.tar.part"
  cp "$ROOT"/e2e/fixtures/routing/ad.{pois,streets,places,addresses}.tsv "$SERVE/"
  split -b 1500000 -d -a 2 "$ROOT/e2e/fixtures/maps/ad.pmtiles" "$SERVE/ad.pmtiles.part"
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
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "valhalla": "3.9.1", "packs": [pack]},
          open(os.path.join(d, "fixture.json"), "w"))
# The country map: its points and street names come with the routing pack, as for a real country.
mparts = [f(n) for n in sorted(os.listdir(d)) if n.startswith("ad.pmtiles.part")]
cmap = {"id": "ad", "regionId": "ad", "buildDate": "20261025", "maxZoom": 10, "bbox": [1.394, 42.414, 1.761, 42.663],
        "size": sum(p["size"] for p in mparts), "parts": mparts, "pois": None, "streets": None}
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "maps": [cmap]},
          open(os.path.join(d, "maps-manifest.json"), "w"))
PY
  python3 -m http.server "$ROUTING_PORT" --bind 127.0.0.1 --directory "$SERVE" >/dev/null 2>&1 &
  SERVER_PID=$!
  trap '[[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null' EXIT
fi

OUT="$ROOT/e2e/artifacts/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
ln -sfn "$OUT" "$ROOT/e2e/artifacts/latest"
passed=0; failed=()

reset_app() {
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl privacy "$UDID" grant location "$BUNDLE" 2>/dev/null || true
  local content
  content="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents/content"
  # `seeded`: the ZIM fixtures; `seeded-map`: the map fixtures; `seeded-route`: the routing
  # pack; `seeded-model`: the GGUF model. The app registers loose files in these folders at
  # startup. APFS clones: instant.
  if grep -qE '^tags:.*[[ ,]seeded[],]' "$1"; then
    mkdir -p "$content/zim" && cp -c "$ROOT"/e2e/fixtures/*.zim "$content/zim/"
  fi
  if grep -qE '^tags:.*[[ ,]seeded-map[],]' "$1"; then
    mkdir -p "$content/maps" && cp -c "$ROOT"/e2e/fixtures/*.pmtiles "$content/maps/"
  fi
  if grep -qE '^tags:.*[[ ,]seeded-route[],]' "$1"; then
    mkdir -p "$content/routing" && cp -c "$ROOT"/e2e/fixtures/routing/*.tar "$content/routing/"
  fi
  if grep -qE '^tags:.*[[ ,]seeded-model[],]' "$1"; then
    mkdir -p "$content/models" && cp -c "$ROOT"/e2e/fixtures/models/*.gguf "$content/models/"
  fi
  if [[ -n "$SERVER_PID" ]]; then
    if grep -qE '^tags:.*[[ ,]routing-live[],]' "$1"; then cp "$SERVE/live.json" "$SERVE/routing-manifest.json"
    else cp "$SERVE/fixture.json" "$SERVE/routing-manifest.json"; fi
  fi
}

# Maestro writes <dir>/<timestamp>/<flow>/{takeScreenshot,screenshots,…}: lift it to <dir>.
lift_output() {
  local inner
  for inner in "$1"/*/"$2"; do
    [[ -d "$inner" ]] || continue
    mv "$inner"/* "$1"/ && rm -r "$(dirname "$inner")"
  done
}

for flow in "${FLOWS[@]}"; do
  name="$(basename "$flow" .yaml)"
  abs="$(cd "$(dirname "$flow")" && pwd)/$(basename "$flow")"
  echo "▶ $name"
  reset_app "$flow"
  mkdir -p "$OUT/$name"
  if "$MAESTRO" --device "$UDID" test "$abs" --test-output-dir "$OUT/$name" \
      --format junit --output "$OUT/$name/report.xml" \
      > "$OUT/$name/maestro.log" 2>&1; then
    passed=$((passed + 1)); echo "  ✓"
  else
    # Maestro's last result line: "[Failed] <flow> (46s) (<reason>)".
    reason="$(grep -m1 '^\[Failed\]' "$OUT/$name/maestro.log" | sed -E 's/^\[Failed\] [^ ]+ \([^)]*\) //')"
    failed+=("$name  ${reason:-see maestro.log}"); echo "  ✗ ${reason:-}"
  fi
  lift_output "$OUT/$name" "$name"
done

{
  echo "$passed passed, ${#failed[@]} failed — $OUT"
  [[ ${#failed[@]} -eq 0 ]] || printf '  ✗ %s\n' "${failed[@]}"
} | tee "$OUT/summary.txt"
[[ ${#failed[@]} -eq 0 ]]
