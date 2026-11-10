#!/usr/bin/env bash
# CarPlay end to end on the simulator's car screen (docs/E2E.md "CarPlay", docs/CARPLAY_PLAN.md "Testing").
# Maestro can't see the car screen (no accessibility tree reaches it), so the car's steps are taps from
# carplay-sim.sh and checks of the screen's text read with Vision (ocr.swift); the phone's steps are
# Maestro flows. Needs carplay-sim.sh's setup (Xcode 26.5's Simulator, iOS 26.5 simulator, shim) and a
# Release simulator build with CarPlay on (`npm run e2e -- --build` builds one while app.json has it on).
#
#   npm run e2e:carplay
#
# What it checks, on a fresh install with Andorra downloaded by the phone (e2e/flows/carplay/car-00):
#   1. opened from the car with the phone app closed: the car's map, "Destinos"
#   2. Destinos › Emergencias cerca › Salud lists the hospital; picking it shows the trip preview
#      (arrival, min, km); "Ir" starts turn-by-turn (maneuver distance, no bar); the ✕ map button ends it
#   3. the phone opened afterwards adopts the app the car started (its tab bar shows, not a blank screen)
#   4. a trip started on the phone shows on the car; the ✕ on the car ends it on the phone too
# Results: e2e/artifacts/carplay-<timestamp>/ (car screenshots + their text, Maestro output).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIM="$ROOT/scripts/carplay/carplay-sim.sh"
BUNDLE=com.fjlinde.nomadpocket
export DEVICE="${DEVICE:-NP-carplay-26}"
MAESTRO="${MAESTRO:-maestro}"
CACHE="$HOME/Library/Caches/nomad-carplay"
OUT="$ROOT/e2e/artifacts/carplay-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT" "$CACHE"

if ! java -version >/dev/null 2>&1; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

UDID="$(xcrun simctl list devices available | grep -E "^ +$DEVICE \(" | head -1 | grep -oE '[0-9A-F-]{36}' || true)"
[[ -n "$UDID" ]] || { echo "Simulator '$DEVICE' not found: run $SIM setup"; exit 1; }
if ! osascript -e "tell application \"System Events\" to tell process \"Simulator\" to get name of every window" 2>/dev/null | grep -q "$DEVICE – CarPlay"; then
  "$SIM" setup
fi

OCR="$CACHE/ocr"
[[ "$OCR" -nt "$ROOT/scripts/carplay/ocr.swift" ]] || swiftc -O "$ROOT/scripts/carplay/ocr.swift" -o "$OCR"

# Screens are numbered in a file: the helpers run inside $(…) subshells.
echo 0 > "$OUT/.step"
next_step() { local n; n=$(($(cat "$OUT/.step") + 1)); echo $n > "$OUT/.step"; printf '%02d' $n; }
last_txt() { printf '%s/%02d.txt' "$OUT" "$(cat "$OUT/.step")"; }
fail() {
  { echo "  ✗ $*"; echo "    last car screen: ${OUT}/$(printf %02d "$(cat "$OUT/.step")").png"; } >&2
  echo "FAILED: $*" > "$OUT/summary.txt"
  exit 1
}

# The car screen's text into $OUT/NN.{png,txt}; prints the text file's path.
read_car() {
  local png
  png="$OUT/$(next_step).png"
  "$SIM" shot "$png" >/dev/null 2>&1
  "$OCR" "$png" > "${png%.png}.txt"
  echo "${png%.png}.txt"
}

# Waits until a line of the car's text matches the regex; prints that line's centre "x y".
wait_car() {
  # The text follows a tab: a leading ^ becomes that tab.
  local regex="$1" timeout="${2:-20}" start=$SECONDS txt pattern
  if [[ "$regex" == ^* ]]; then pattern=$'\t'"${regex#^}"; else pattern=$'\t'".*$regex"; fi
  while :; do
    txt="$(read_car)"
    if grep -qE "$pattern" "$txt"; then grep -E "$pattern" "$txt" | head -1 | cut -f1; return 0; fi
    (( SECONDS - start < timeout )) || fail "car screen: no \"$regex\" after ${timeout}s"
    sleep 1.5
  done
}

tap_car() { "$SIM" tap "$1" "$2" --still; }

# Navigating: the estimates show and the bar is gone ("Terminar" is the ✕ map button, the bottom one,
# where the pan button is without a trip).
wait_nav() {
  local timeout="${1:-20}" start=$SECONDS txt
  while :; do
    txt="$(read_car)"
    if grep -qE $'\t''llegada$' "$txt" && ! grep -qE $'\t''(Destinos|Cancelar)$' "$txt"; then return 0; fi
    (( SECONDS - start < timeout )) || fail "car screen: not navigating after ${timeout}s"
    sleep 1.5
  done
}
END_X=755
END_Y=432
tap_text() { local xy; xy="$(wait_car "$1" "${2:-20}")" || exit 1; tap_car $xy; }

phone() {
  local flow="$1" name
  name="$(basename "$flow" .yaml)"
  "$MAESTRO" --device "$UDID" test "$flow" --test-output-dir "$OUT/$name" > "$OUT/$name.log" 2>&1 \
    || fail "phone flow $name (see $OUT/$name.log)"
}

echo "▶ phone: Andorra from the local catalogs (car-00-prepare)"
# A fresh install and the download, through the phone suite's runner (local catalog server, reset).
DEVICE="$DEVICE" "$ROOT/scripts/e2e.sh" "$ROOT/e2e/flows/carplay/car-00-prepare.yaml" > "$OUT/car-00-prepare.log" 2>&1 \
  || fail "phone flow car-00-prepare (see $OUT/car-00-prepare.log)"
echo "  ✓"

echo "▶ car: open with the phone app closed"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl location "$UDID" set 42.5063,1.5218
# The car's home grid (bottom of the dashboard rail), then the app's icon by its name.
# The label is under the icon, which is what takes the tap.
tap_car 53 427; sleep 2
xy="$(wait_car "^Nomad")" || exit 1
read -r ix iy <<< "$xy"
"$SIM" tap "$ix" $((iy - 90))
wait_car "^Destinos$" 30 >/dev/null
echo "  ✓"

echo "▶ car: Destinos › Emergencias cerca › Salud › preview › Ir › ✕"
tap_text "^Destinos$"
wait_car "^Emergencias cerca$" >/dev/null
tap_text "^Salud$"
tap_text "Meritxell" 30
# The preview: arrival time, minutes and kilometres, and the green "Ir" (too short for the OCR to
# read: it sits under the estimates).
# The card slides in: wait for "Cancelar" in the bar, then read the settled screen once more.
wait_car "^llegada$" 30 >/dev/null
wait_car "^Cancelar$" 10 >/dev/null
sleep 1
xy="$(wait_car "^llegada$" 5)" || exit 1
read -r _ ly <<< "$xy"
tap_car 285 $((ly + 56))
wait_nav 15
txt="$(last_txt)"
grep -qE $'\t''[0-9]+([,.][0-9]+)? ?(m|km)$' "$txt" || fail "navigation without the maneuver distance"
tap_car $END_X $END_Y
wait_car "^Destinos$" 15 >/dev/null
echo "  ✓"

echo "▶ phone: opened after the car, adopts its app"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
sleep 5
phone_png="$OUT/$(next_step)-phone.png"
xcrun simctl io "$UDID" screenshot "$phone_png" >/dev/null 2>&1
"$OCR" "$phone_png" > "${phone_png%.png}.txt"
grep -qE $'\t''(Mapas|Inicio|Biblioteca)' "${phone_png%.png}.txt" || fail "the phone shows no tab bar after the car started the app ($phone_png)"
echo "  ✓"

echo "▶ phone trip shows on the car; the ✕ on the car ends it on the phone"
phone "$ROOT/e2e/subflows/carplay/phone-trip.yaml"
wait_nav 20
tap_car $END_X $END_Y
wait_car "^Destinos$" 15 >/dev/null
phone "$ROOT/e2e/subflows/carplay/phone-trip-ended.yaml"
echo "  ✓"

echo "CarPlay: all checks passed — $OUT" | tee "$OUT/summary.txt"
