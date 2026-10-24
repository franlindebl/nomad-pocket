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
# e2e/fixtures/ copied to Documents/content/zim/ (registered at startup by
# src/features/library/register.ts). Results: e2e/artifacts/<timestamp>/.
#
# Env: DEVICE (simulator name, default NP-e2e), APP (path to a Release simulator
# .app; built when missing), MAESTRO (binary), JAVA_HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE=com.fjlinde.nomadpocket
DEVICE="${DEVICE:-NP-e2e}"
APP="${APP:-$ROOT/ios/build/sim/Build/Products/Release-iphonesimulator/NomadPocket.app}"
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
    grep -qE "^tags:.*\b($pattern)\b" "$f" && FLOWS+=("$f")
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

if [[ $BUILD -eq 1 || ! -d "$APP" ]]; then
  echo "Building $APP…"
  xcodebuild -workspace "$ROOT/ios/NomadPocket.xcworkspace" -scheme NomadPocket \
    -configuration Release -sdk iphonesimulator -derivedDataPath "$ROOT/ios/build/sim" \
    -packageAuthorizationProvider netrc build | tail -3
fi

UDID="$(xcrun simctl list devices available | grep -E "^ +$DEVICE \(" | head -1 | grep -oE '[0-9A-F-]{36}')"
[[ -n "$UDID" ]] || { echo "Simulator '$DEVICE' not found: run scripts/e2e-setup.sh"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl location "$UDID" set 40.4168,-3.7038

OUT="$ROOT/e2e/artifacts/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
ln -sfn "$OUT" "$ROOT/e2e/artifacts/latest"
passed=0; failed=()

reset_app() {
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl privacy "$UDID" grant location "$BUNDLE" 2>/dev/null || true
  if grep -qE '^tags:.*\bseeded\b' "$1"; then
    local zim="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents/content/zim"
    mkdir -p "$zim"
    cp -c "$ROOT"/e2e/fixtures/*.zim "$zim/"   # APFS clone: instant
  fi
}

for flow in "${FLOWS[@]}"; do
  name="$(basename "$flow" .yaml)"
  abs="$(cd "$(dirname "$flow")" && pwd)/$(basename "$flow")"
  echo "▶ $name"
  reset_app "$flow"
  mkdir -p "$OUT/$name"
  # takeScreenshot writes to the working directory.
  if (cd "$OUT/$name" && "$MAESTRO" --device "$UDID" test "$abs" \
      --format junit --output "$OUT/$name/report.xml" --debug-output "$OUT/$name/debug" \
      --flatten-debug-output > "$OUT/$name/maestro.log" 2>&1); then
    passed=$((passed + 1)); echo "  ✓"
  else
    # Maestro's last result line: "[Failed] <flow> (46s) (<reason>)".
    reason="$(grep -m1 '^\[Failed\]' "$OUT/$name/maestro.log" | sed -E 's/^\[Failed\] [^ ]+ \([^)]*\) //')"
    failed+=("$name  ${reason:-see maestro.log}"); echo "  ✗ ${reason:-}"
  fi
done

{
  echo "$passed passed, ${#failed[@]} failed — $OUT"
  [[ ${#failed[@]} -eq 0 ]] || printf '  ✗ %s\n' "${failed[@]}"
} | tee "$OUT/summary.txt"
[[ ${#failed[@]} -eq 0 ]]
