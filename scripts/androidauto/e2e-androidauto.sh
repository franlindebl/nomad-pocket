#!/usr/bin/env bash
# Android Auto end to end on the Android Automotive emulator (docs/E2E.md "Android Auto", docs/ANDROID_AUTO_PLAN.md
# "Testing"). Play doesn't offer Android Auto to the phone emulator; the Automotive image with Google Play carries
# Google's templates host, which draws the same car templates. Maestro sees the app's phone UI there (it downloads
# Andorra: e2e/flows/androidauto/auto-00-prepare.yaml) but not the car's templates, so the car's steps are adb taps
# and checks of the screen's text read with Vision (scripts/carplay/ocr.swift), as in the CarPlay check.
#
#   npm run e2e:androidauto              # builds the Automotive APK the first time
#   npm run e2e:androidauto -- --build   # rebuild it (after code changes)
#
# What it checks, on a fresh install with Andorra downloaded from the local catalogs:
#   1. opened from the car with the app not running: the offline map and "Destinos" (JS started without UI)
#   2. Destinos › Emergencias cerca › Seguridad lists the police; picking it shows the preview (min, km);
#      "Ir" starts guidance (maneuver distance, "Terminar"); "Terminar" ends it
#   3. Buscar with the car's keyboard finds Canillo; its preview's back cancels the trip
#   4. a geo: destination from another app opens its preview; "Ir", then the GPS at the destination: "Has llegado"
#   5. the phone's UI opened afterwards runs on the JS the car started (its tab bar shows)
# Results: e2e/artifacts/androidauto-<timestamp>/ (car screenshots + their text, Maestro output).
# The Automotive APK is kept in ~/Library/Caches/nomad-androidauto and taken out of android/'s build folder, so the
# phone suite (scripts/e2e-android.sh) never installs it; android/ is left prebuilt for Automotive: the phone suite's
# --build (or a missing APK) prebuilds it again.
# Env: AVD (default NP-auto-34, created when missing), ANDROID_HOME, MAESTRO, ROUTING_PORT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG=com.fjlinde.nomadpocket
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="${AVD:-NP-auto-34}"
IMAGE="system-images;android-34-ext9;android-automotive-playstore;arm64-v8a"
MAESTRO="${MAESTRO:-maestro}"
GRADLE_JAVA="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
CACHE="$HOME/Library/Caches/nomad-androidauto"
APK="$CACHE/app-automotive.apk"
OUT="$ROOT/e2e/artifacts/androidauto-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT" "$CACHE"

# The app reads the routing and country map catalogs from the local server below (as scripts/e2e.sh's).
PORT="${ROUTING_PORT:-8766}"
export EXPO_PUBLIC_ROUTING_MANIFEST_URL="http://localhost:$PORT/routing-manifest.json"
export EXPO_PUBLIC_MAPS_MANIFEST_URL="http://localhost:$PORT/maps-manifest.json"

if [[ "${1:-}" == "--build" || ! -f "$APK" ]]; then
  echo "▶ building the Automotive APK"
  # NOMAD_E2E=1: plain http to localhost allowed (plugins/with-e2e-local-network.js).
  (cd "$ROOT" && ANDROID_AUTOMOTIVE=1 NOMAD_E2E=1 npx expo prebuild --platform android --no-install >/dev/null)
  (cd "$ROOT/android" && JAVA_HOME="$GRADLE_JAVA" ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -q)
  mv "$ROOT/android/app/build/outputs/apk/release/app-release.apk" "$APK"
fi

if ! java -version >/dev/null 2>&1; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# The Automotive emulator: the running one with this AVD, else boot it (create it the first time).
serial_of_avd() {
  for s in $("$ADB" devices | awk '/^emulator-.*device$/ {print $1}'); do
    [[ "$("$ADB" -s "$s" emu avd name 2>/dev/null | head -1 | tr -d '\r')" == "$AVD" ]] && { echo "$s"; return; }
  done
}
SERIAL="$(serial_of_avd || true)"
if [[ -z "$SERIAL" ]]; then
  if [[ ! -d "$HOME/.android/avd/$AVD.avd" ]]; then
    echo "▶ creating the AVD $AVD"
    yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "$IMAGE" >/dev/null
    echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d automotive_1024p_landscape >/dev/null
    sed -i '' 's/^hw.keyboard=no$/hw.keyboard=yes/' "$HOME/.android/avd/$AVD.avd/config.ini"
  fi
  echo "▶ starting the emulator $AVD"
  "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-audio -dns-server 8.8.8.8,1.1.1.1 >/dev/null 2>&1 &
  for _ in $(seq 1 60); do SERIAL="$(serial_of_avd || true)"; [[ -n "$SERIAL" ]] && break; sleep 2; done
  [[ -n "$SERIAL" ]] || { echo "the emulator $AVD didn't come up"; exit 1; }
fi
adb_() { "$ADB" -s "$SERIAL" "$@"; }
adb_ wait-for-device
until [[ "$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
# The driver is a secondary Android user (10 on these images): permissions, data and location are per user.
USER_ID="$(adb_ shell am get-current-user | tr -d '\r')"
# Screenshots of the main display (the image has a second one for the cluster).
DISPLAY_ID="$(adb_ shell dumpsys SurfaceFlinger --display-id | awk '/^Display / {print $2; exit}')"

# Network: the catalogs come from the Mac through adb reverse, and the app also wants Android's "validated" flag,
# which Android's own check (Google's servers over HTTPS) may never give behind a network that intercepts TLS: the
# emulator is left with "partial connectivity" and downloads never start. The check asks a local server answering
# 204 instead (10.0.2.2 is the Mac seen from the emulator); an airplane-mode toggle makes Android check again.
adb_ reverse "tcp:$PORT" "tcp:$PORT" >/dev/null
CHECK_PORT=$((PORT + 1))
python3 -I - "$CHECK_PORT" >/dev/null 2>&1 <<'PY' &
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(204); self.send_header("Content-Length", "0"); self.end_headers()
    do_HEAD = do_GET
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
CHECK_PID=$!
for key in captive_portal_http_url captive_portal_https_url captive_portal_fallback_url; do
  adb_ shell settings put global "$key" "http://10.0.2.2:$CHECK_PORT/generate_204"
done
adb_ shell settings put global captive_portal_mode 1
validated() { adb_ shell dumpsys connectivity | grep -q "INTERNET&.*&VALIDATED"; }
for _ in 1 2 3; do
  adb_ shell cmd connectivity airplane-mode enable; sleep 3
  adb_ shell cmd connectivity airplane-mode disable
  for _ in $(seq 1 15); do validated && break 2; sleep 2; done
done
validated || echo "warning: the emulator's network is not validated; the download may fail"

# The local catalogs: Andorra's map and routing pack (with its emergency points, streets, places and addresses).
SERVE="$(mktemp -d)"
cp "$ROOT/e2e/fixtures/maps/ad.pmtiles" "$ROOT/e2e/fixtures/routing/ad.tar" "$SERVE/"
cp "$ROOT"/e2e/fixtures/routing/ad.{pois,streets,places,addresses}.tsv "$SERVE/"
python3 -I - "$SERVE" "$PORT" <<'PY'
import hashlib, json, os, sys
d, port = sys.argv[1], sys.argv[2]
def f(n):
    p = os.path.join(d, n)
    return {"name": n, "size": os.path.getsize(p), "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()}
tar = f("ad.tar")
pack = {"id": "ad", "country": "ad", "regionId": "ad", "buildDate": "20261024", "bbox": [1.25, 42.25, 2.0, 42.75],
        "size": tar["size"], "parts": [tar], **{k: f(f"ad.{k}.tsv") for k in ("pois", "streets", "places", "addresses")}}
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "valhalla": "3.9.1", "packs": [pack]},
          open(os.path.join(d, "routing-manifest.json"), "w"))
m = f("ad.pmtiles")
cmap = {"id": "ad", "regionId": "ad", "buildDate": "20261025", "maxZoom": 10, "bbox": [1.394, 42.414, 1.761, 42.663],
        "size": m["size"], "parts": [m], "pois": None, "streets": None}
json.dump({"version": 1, "release": "e2e", "baseUrl": f"http://localhost:{port}", "maps": [cmap]},
          open(os.path.join(d, "maps-manifest.json"), "w"))
PY
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVE" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" "$CHECK_PID" 2>/dev/null' EXIT

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
  adb_ exec-out screencap -p -d "$DISPLAY_ID" > "$png" 2>/dev/null
  "$OCR" "$png" > "${png%.png}.txt"
  echo "${png%.png}.txt"
}

# Waits until a line of the car's text matches the regex (a leading ^ anchors at the text's start); prints its centre.
wait_car() {
  local regex="$1" timeout="${2:-20}" start=$SECONDS txt pattern
  if [[ "$regex" == ^* ]]; then pattern=$'\t'"${regex#^}"; else pattern=$'\t'".*$regex"; fi
  while :; do
    txt="$(read_car)"
    if grep -qE "$pattern" "$txt"; then grep -E "$pattern" "$txt" | head -1 | cut -f1; return 0; fi
    (( SECONDS - start < timeout )) || fail "car screen: no \"$regex\" after ${timeout}s"
    sleep 1.5
  done
}

# The OCR mixes up i and l now and then ("Termınar", "Has Ilegado"): those letters are matched loosely.
tap() { adb_ shell input tap "$1" "$2"; sleep 1; }
# Whether a line matches within the timeout, without failing the run.
seen_car() {
  local start=$SECONDS pattern=$'\t'".*$1"
  while :; do
    grep -qE "$pattern" "$(read_car)" && return 0
    (( SECONDS - start < $2 )) || return 1
    sleep 1.5
  done
}
tap_text() { local xy; xy="$(wait_car "$1" "${2:-20}")" || exit 1; read -r x y <<< "$xy"; tap "$x" "$y"; }
# A search result: a line matching below the search field (which holds the same text, at the top).
tap_lowest() {
  local start=$SECONDS pattern xy
  if [[ "$1" == ^* ]]; then pattern=$'\t'"${1#^}"; else pattern=$'\t'".*$1"; fi
  while :; do
    xy="$(grep -E "$pattern" "$(read_car)" | cut -f1 | awk '$2 > 180' | sort -k2 -n | tail -1)"
    [[ -n "$xy" ]] && break
    (( SECONDS - start < ${2:-20} )) || fail "car screen: no result \"$1\" after ${2:-20}s"
    sleep 1.5
  done
  read -r x y <<< "$xy"
  tap "$x" "$y"
}
# The preview's "Ir" is a short blue link the OCR sometimes misses: then it sits under the card's last line of text
# (the trip's time, or the road it goes by), in the card on the left.
tap_go() {
  local txt last
  wait_car "[0-9]+ min" 30 >/dev/null || exit 1
  sleep 1
  txt="$(read_car)"
  # Read this time: there.
  if grep -qE $'\t''Ir$' "$txt"; then read -r x y <<< "$(grep -E $'\t''Ir$' "$txt" | head -1 | cut -f1)"; tap "$x" "$y"; return; fi
  last="$(awk -F'\t' '{ split($1, p, " "); if (p[1] < 510 && p[2] > 160 && p[2] < 330) print p[2] }' "$txt" | sort -n | tail -1)"
  [[ -n "$last" ]] || fail "no preview card"
  tap 45 $((last + 26))
}
# The host hides the map's buttons a few seconds after the last touch: a tap on the map shows them again.
show_buttons() { tap 512 450; }
car_app() { adb_ shell am start -n "$PKG/androidx.car.app.activity.CarAppActivity" "$@" >/dev/null 2>&1; }
gps() { adb_ emu geo fix "$2" "$1" >/dev/null; }

echo "▶ install, reset, permissions"
adb_ install -r "$APK" >/dev/null
adb_ shell pm clear --user "$USER_ID" "$PKG" >/dev/null
adb_ shell cmd locale set-app-locales "$PKG" --user "$USER_ID" --locales es-ES
adb_ shell pm grant --user "$USER_ID" "$PKG" android.permission.ACCESS_FINE_LOCATION
adb_ shell pm grant --user "$USER_ID" "$PKG" android.permission.ACCESS_COARSE_LOCATION
# Location is off for the driver on a new image.
adb_ shell cmd location set-location-enabled true --user "$USER_ID"
# Sant Julià de Lòria: a few km from every police station (from Andorra la Vella the nearest is 20 m away, a trip
# that arrives as it starts).
gps 42.4637 1.4913

echo "▶ phone UI: Andorra from the local catalogs (auto-00-prepare)"
"$MAESTRO" --device "$SERIAL" test "$ROOT/e2e/flows/androidauto/auto-00-prepare.yaml" --test-output-dir "$OUT/auto-00-prepare" \
  > "$OUT/auto-00-prepare.log" 2>&1 || fail "phone flow auto-00-prepare (see $OUT/auto-00-prepare.log)"
echo "  ✓"

echo "▶ car: opened with the app not running"
# Home first: stopping the app while the car shows it crashes Google's templates host.
adb_ shell input keyevent 3; sleep 2
adb_ shell am force-stop "$PKG"; sleep 1
car_app
gps 42.4637 1.4913
wait_car "^Destinos$" 40 >/dev/null
echo "  ✓"

echo "▶ car: Destinos › Emergencias cerca › Seguridad › preview › Ir › Terminar"
show_buttons
tap_text "^Destinos$"
tap_text "^Emergencias cerca$"
tap_text "^Seguridad$"
# The nearest police in Andorra (named "Policia", the customs at the border or unnamed: "Policía").
tap_text "^(Polic|Duana|Circulaci|Servei)" 20
tap_go
wait_car "^Term.nar$" 20 >/dev/null
txt="$(last_txt)"
# The maneuver's icon may come out of the OCR as a letter before the distance ("N 10 m").
grep -qE '[0-9]+([,.][0-9]+)? ?(m|km)$' "$txt" || fail "guidance without the maneuver distance"
show_buttons
tap_text "^Term.nar$"
wait_car "^Destinos$" 15 >/dev/null
echo "  ✓"

echo "▶ car: Buscar › Canillo › preview › back"
show_buttons
tap_text "^Destinos$"
tap_text "^Buscar$"
sleep 2
# One key at a time: a burst of keys makes the host delay the results ("too many refreshes").
for c in C a n i l l o; do adb_ shell input text "$c"; sleep 0.7; done
adb_ shell input keyevent 66
tap_lowest "^Canillo$" 20
# A tap that lands while the host swaps the template is lost: once more if the results are still there. Picked, the
# car goes back to the map while the route is worked out (seconds for the 17 km to Canillo), then the preview.
sleep 4
grep -qE $'\t'"Canillo$" "$(read_car)" && grep -qE $'\t'"[0-9]+ km$" "$(last_txt)" && tap_lowest "^Canillo$" 5
wait_car "[0-9]+ min" 40 >/dev/null
# The card's back arrow (the system's back key doesn't reach the car app on this image).
tap 56 132
show_buttons
wait_car "^Destinos$" 15 >/dev/null
echo "  ✓"

echo "▶ car: a geo: destination › preview › Ir › arrival › Terminar"
car_app -a androidx.car.app.action.NAVIGATE -d "'geo:0,0?q=42.566799,1.597738(Canillo)'"
wait_car "^Canillo$" 30 >/dev/null
tap_go
wait_car "^Term.nar$" 20 >/dev/null
gps 42.566799 1.597738; sleep 2; gps 42.566800 1.597740
wait_car "^Has .legado$" 30 >/dev/null
show_buttons
tap_text "^Term.nar$"
wait_car "^Destinos$" 15 >/dev/null
echo "  ✓"

echo "▶ phone UI opened after the car"
adb_ shell am start -n "$PKG/.MainActivity" >/dev/null
wait_car "^(Inicio|Mapas|Biblioteca)$" 20 >/dev/null
echo "  ✓"

echo "Android Auto: all checks passed — $OUT" | tee "$OUT/summary.txt"
