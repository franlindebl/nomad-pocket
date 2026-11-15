#!/usr/bin/env bash
# E2E suite on an Android emulator (Maestro). See docs/E2E.md.
#
#   scripts/e2e-android.sh                     # flows tagged `android` (the Android tour, real network)
#   scripts/e2e-android.sh --tags smoke,full   # the shared suite (e2e/flows/*), as on iOS
#   scripts/e2e-android.sh e2e/flows/reader    # specific flows or folders
#   --build    rebuild the release APK first (needed after any app code change)
#   --list     print the flows that would run, and exit
#   ONLY=android-08-map-answers scripts/e2e-android.sh   # one flow by name
#
# The shared flows run on both platforms: tabs, back and other platform differences go through
# e2e/subflows (tab-*.yaml, back.yaml). Flows tagged `ios-only` never run here (Apple Intelligence,
# CarPlay, the iPad, health features: Android has none, src/lib/health.ts).
#
# Every flow runs on a fresh app (pm clear) with Spanish as its per-app language and location.
# The E2E APK is debuggable (plugins/with-e2e-local-network.js), so the seeding tags of scripts/e2e.sh
# work here too through `run-as`: `seeded`, `seeded-map`, `seeded-route`, `seeded-stitch`,
# `seeded-model`, `seeded-old-country`, `seeded-country`, `seeded-onboarded`.
# The stand-in server (scripts/e2e-serve.sh) runs on the Mac and reaches the emulator through
# `adb reverse`; `routing-live` / `maps-live` flows get the published catalogs instead.
#
# Env: AVD (default Pixel_API_36), ANDROID_HOME, MAESTRO, ONLY, ROUTING_PORT (default 8765), APK (another E2E APK),
# ANDROID_SERIAL (which emulator, when several run: e.g. the Android Auto session's Automotive one).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG=com.fjlinde.nomadpocket
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="${AVD:-Pixel_API_36}"
APK="${APK:-$ROOT/android/app/build/outputs/apk/release/app-release.apk}"
MAESTRO="${MAESTRO:-maestro}"
TAGS=android
TARGETS=()
BUILD=0
LIST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags) TAGS="$2"; shift 2 ;;
    --build) BUILD=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TARGETS+=("$1"); TAGS=""; shift ;;
  esac
done

FLOWS=()
if [[ ${#TARGETS[@]} -gt 0 ]]; then
  while IFS= read -r f; do FLOWS+=("$f"); done < <(find "${TARGETS[@]}" -name '*.yaml' | sort)
else
  pattern="$(echo "$TAGS" | sed 's/,/|/g')"
  while IFS= read -r f; do
    grep -qE "^tags:.*[[ ,]($pattern)[],]" "$f" && FLOWS+=("$f")
  done < <(find "$ROOT/e2e/flows" -name '*.yaml' | sort)
fi
# Never here: iOS-only flows and the car screens (their own runners).
kept=()
for f in "${FLOWS[@]}"; do
  grep -qE '^tags:.*[[ ,](ios-only|ipad|carplay|androidauto|planet)[],]' "$f" && continue
  [[ -n "${ONLY:-}" && "$(basename "$f" .yaml)" != "$ONLY" ]] && continue
  kept+=("$f")
done
FLOWS=("${kept[@]+"${kept[@]}"}")
[[ ${#FLOWS[@]} -gt 0 ]] || { echo "No flows match"; exit 1; }
if [[ $LIST -eq 1 ]]; then
  for f in "${FLOWS[@]}"; do echo "${f#"$ROOT"/}"; done
  echo "${#FLOWS[@]} flows"; exit 0
fi

# The app reads every catalog and feed from the stand-in server (built into the APK).
ROUTING_PORT="${ROUTING_PORT:-8765}"
export EXPO_PUBLIC_ROUTING_MANIFEST_URL="http://localhost:$ROUTING_PORT/routing-manifest.json"
export EXPO_PUBLIC_MAPS_MANIFEST_URL="http://localhost:$ROUTING_PORT/maps-manifest.json"
export EXPO_PUBLIC_UPDATES_OPDS_URL="http://localhost:$ROUTING_PORT/opds"
export EXPO_PUBLIC_ALERTS_URL="http://localhost:$ROUTING_PORT/alerts"
# The push server too, at a path the stand-in doesn't serve: an E2E build never registers with the real alerts server,
# and its checks keep notifying by themselves as the flows expect.
export EXPO_PUBLIC_ALERTS_API="http://localhost:$ROUTING_PORT/no-alerts-server"

if [[ $BUILD -eq 1 || ! -f "$APK" ]]; then
  echo "Building ${APK}…"
  # NOMAD_E2E=1: plain http to localhost and a debuggable app (plugins/with-e2e-local-network.js). A store
  # prebuild (NOMAD_STORE_BUILD=1, docs/ANDROID_PLAY.md) takes both out again.
  (cd "$ROOT" && NOMAD_E2E=1 npx expo prebuild --platform android --no-install >/dev/null)
  (cd "$ROOT/android" && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -q)
fi

SERVE="$(mktemp -d)"
"$ROOT/scripts/e2e-serve.sh" "$SERVE" "$ROUTING_PORT" live
cp "$SERVE/maps-manifest.json" "$SERVE/maps-stand-in.json"
python3 -m http.server "$ROUTING_PORT" --bind 127.0.0.1 --directory "$SERVE" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT

if ! "$ADB" devices | grep -q "emulator-.*device$"; then
  echo "Starting emulator ${AVD}…"
  # Cold boot: on an old snapshot Maestro kept losing the emulator ("device offline").
  # Explicit DNS: after the Mac changes network the emulator's resolver can go stale.
  "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-load -no-snapshot-save -no-audio -dns-server 8.8.8.8,1.1.1.1 >/dev/null 2>&1 &
  "$ADB" wait-for-device
  until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
fi
SERIAL="${ANDROID_SERIAL:-$("$ADB" devices | awk '/^emulator-.*device$/ {print $1; exit}')}"
adb_() { "$ADB" -s "$SERIAL" "$@"; }
adb_ reverse "tcp:$ROUTING_PORT" "tcp:$ROUTING_PORT" >/dev/null
adb_ shell settings put system screen_off_timeout 1800000
adb_ shell locksettings set-disabled true >/dev/null 2>&1 || true
# The app trusts Android's "validated" flag: until the network is validated it says
# "Necesitas conexión". The emulator's probes flap between validated and partial
# connectivity, so captive portal detection is off; an airplane-mode toggle makes Android
# evaluate the network again.
adb_ shell settings put global captive_portal_mode 0
validated() { adb_ shell dumpsys connectivity | grep -q "INTERNET&.*&VALIDATED"; }
for attempt in 1 2 3; do
  for _ in $(seq 1 15); do validated && break 2; sleep 2; done
  adb_ shell cmd connectivity airplane-mode enable; sleep 3
  adb_ shell cmd connectivity airplane-mode disable
done
validated || echo "warning: the emulator's network is not validated; network flows will fail"

if ! java -version >/dev/null 2>&1; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Fixtures go to the emulator once; each flow copies what its tags ask for into the app's files.
STAGE=/data/local/tmp/nomad-e2e
adb_ shell "rm -rf $STAGE && mkdir -p $STAGE/zim $STAGE/maps $STAGE/routing $STAGE/stitch $STAGE/models $STAGE/country"
adb_ push "$ROOT"/e2e/fixtures/*.zim "$STAGE/zim/" >/dev/null
adb_ push "$ROOT"/e2e/fixtures/*.pmtiles "$STAGE/maps/" >/dev/null
adb_ push "$ROOT"/e2e/fixtures/routing/*.tar "$STAGE/routing/" >/dev/null
adb_ push "$ROOT"/e2e/fixtures/routing-stitch/. "$STAGE/stitch/" >/dev/null
adb_ push "$ROOT/e2e/fixtures/maps/ad.pmtiles" "$ROOT/e2e/fixtures/routing/ad.tar" "$ROOT"/e2e/fixtures/routing/ad.{pois,places,streets,addresses}.tsv "$STAGE/country/" >/dev/null
if printf '%s\n' "${FLOWS[@]}" | xargs grep -lE '^tags:.*[[ ,]seeded-model[],]' >/dev/null 2>&1; then
  adb_ push "$ROOT"/e2e/fixtures/models/*.gguf "$STAGE/models/" >/dev/null
fi
# The settings store as the app persists it (expo-sqlite's kv-store, key `settings`; zustand merges it over the defaults):
# Wi-Fi only off for the shared flows, plus a finished setup wizard for `seeded-onboarded`.
settings_db() {
  local db; db="$(mktemp -d)/ExpoSQLiteStorage"
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT); PRAGMA user_version = 1;
    INSERT INTO storage (key, value) VALUES ('settings', '{\"state\":$1,\"version\":0}');"
  adb_ push "$db" "$STAGE/$2" >/dev/null
}
settings_db '{"wifiOnly":false}' settings-shared
settings_db '{"wifiOnly":false,"onboarded":true,"language":"es","country":"es"}' settings-onboarded
adb_ shell "chmod -R a+rX $STAGE"

has_tag() { grep -qE "^tags:.*[[ ,]$2[],]" "$1"; }

# Mobile data only: the emulator's Wi-Fi (AndroidWifi) connects but the app finds no internet on it ("Necesitas
# conexión"). "Wi-Fi only" (on by default) then asks before every download: the Android tour (tag `android`) requires
# that question ("Usar datos móviles"); the shared flows start with the setting off instead (below), as on the iOS
# simulator, which counts as Wi-Fi.
adb_ shell svc wifi disable || true
# Runs a shell line as the app (its files dir is the working directory: files/content/… as on iOS's Documents).
as_app() { adb_ shell "run-as $PKG sh -c '$1'"; }

reset_app() {
  adb_ shell am force-stop "$PKG"
  adb_ shell pm clear "$PKG" >/dev/null
  adb_ shell cmd locale set-app-locales "$PKG" --locales es-ES
  adb_ shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION
  adb_ shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  adb_ emu geo fix -3.7038 40.4168 >/dev/null
  local c=files/content
  has_tag "$1" seeded && as_app "mkdir -p $c/zim && cp $STAGE/zim/* $c/zim/"
  has_tag "$1" seeded-map && as_app "mkdir -p $c/maps && cp $STAGE/maps/* $c/maps/"
  has_tag "$1" seeded-route && as_app "mkdir -p $c/routing && cp $STAGE/routing/* $c/routing/"
  has_tag "$1" seeded-stitch && as_app "mkdir -p $c/routing && cp $STAGE/stitch/* $c/routing/"
  has_tag "$1" seeded-model && as_app "mkdir -p $c/models && cp $STAGE/models/* $c/models/"
  # Andorra's map and pack as a January build (their date is the file's): the local catalog's builds are newer.
  has_tag "$1" seeded-old-country && as_app "mkdir -p $c/maps $c/routing && cp $STAGE/country/ad.pmtiles $c/maps/ && cp $STAGE/country/ad.tar $c/routing/ && touch -t 202601010000 $c/maps/ad.pmtiles $c/routing/ad.tar"
  # Andorra installed as a country is: map, routing pack and the side files the app imports at startup.
  has_tag "$1" seeded-country && as_app "mkdir -p $c/maps $c/routing && cp $STAGE/country/ad.pmtiles $c/maps/ && cp $STAGE/country/ad.tar $STAGE/country/ad.*.tsv $c/routing/"
  # An install that finished the setup wizard before this version (the settings store says so, nothing else).
  if has_tag "$1" seeded-onboarded; then as_app "mkdir -p files/SQLite && cp $STAGE/settings-onboarded files/SQLite/ExpoSQLiteStorage"
  elif ! has_tag "$1" android; then as_app "mkdir -p files/SQLite && cp $STAGE/settings-shared files/SQLite/ExpoSQLiteStorage"; fi
  # Per flow: the published routing and maps catalogs, or the stand-in ones; the stand-in catalog of newer
  # editions answers `updates-server` flows and the Android tour's update flow only (else 404: no updates).
  if has_tag "$1" routing-live; then cp "$SERVE/live.json" "$SERVE/routing-manifest.json"
  else cp "$SERVE/fixture.json" "$SERVE/routing-manifest.json"; fi
  if has_tag "$1" maps-live; then cp "$SERVE/maps-live.json" "$SERVE/maps-manifest.json"
  else cp "$SERVE/maps-stand-in.json" "$SERVE/maps-manifest.json"; fi
  rm -rf "$SERVE/opds"
  if has_tag "$1" updates-server; then
    mkdir -p "$SERVE/opds/catalog/v2" && cp "$SERVE/updates-feed.xml" "$SERVE/opds/catalog/v2/entries"
  fi
}

lift_output() {
  local inner
  for inner in "$1"/*/"$2"; do
    [[ -d "$inner" ]] || continue
    cp -R "$inner"/. "$1"/ && rm -r "$(dirname "$inner")"
  done
}

OUT="$ROOT/e2e/artifacts/$(date +%Y%m%d-%H%M%S)-android"
mkdir -p "$OUT"
ln -sfn "$OUT" "$ROOT/e2e/artifacts/latest-android"
adb_ install -r "$APK" >/dev/null
passed=0; failed=()
for flow in "${FLOWS[@]}"; do
  name="$(basename "$flow" .yaml)"
  abs="$(cd "$(dirname "$flow")" && pwd)/$(basename "$flow")"
  echo "▶ $name"
  mkdir -p "$OUT/$name"
  # Up to 3 runs, only when the emulator's adb link drops ("device offline", "Device server died"), never on an
  # app failure. --no-reinstall-driver: reinstalling Maestro's driver for every flow dropped the link too.
  for attempt in 1 2 3; do
    # An adb hiccup while preparing must not end the whole run (set -e): wait for the emulator and prepare again.
    reset_app "$flow" || { echo "  (preparing the app failed; again)"; adb_ wait-for-device; sleep 5; reset_app "$flow" || true; }
    if "$MAESTRO" --device "$SERIAL" test --no-reinstall-driver "$abs" --test-output-dir "$OUT/$name" \
        --format junit --output "$OUT/$name/report.xml" > "$OUT/$name/maestro.log" 2>&1; then
      ok=1; break
    fi
    ok=0
    if cat "$OUT/$name/maestro.log" "$OUT/$name/report.xml" 2>/dev/null | grep -qE "device offline|Device server died|is unreachable|device '.*' not found"; then
      echo "  (adb link dropped, run $attempt; again)"; cp "$OUT/$name/maestro.log" "$OUT/$name/maestro-drop-$attempt.log"
      adb_ wait-for-device; sleep 3; continue
    fi
    break
  done
  if [[ $ok -eq 1 ]]; then
    passed=$((passed + 1)); echo "  ✓"
  else
    # The JUnit report's failure line: the step and why.
    reason="$(sed -n 's/.*<failure>\(.*\)/\1/p' "$OUT/$name/report.xml" 2>/dev/null | head -1 | cut -c1-200 || true)"
    failed+=("$name  ${reason:-see maestro.log}"); echo "  ✗ ${reason:-}"
  fi
  lift_output "$OUT/$name" "$name"
done

{
  echo "$passed passed, ${#failed[@]} failed — $OUT"
  [[ ${#failed[@]} -eq 0 ]] || printf '  ✗ %s\n' "${failed[@]}"
} | tee "$OUT/summary.txt"
[[ ${#failed[@]} -eq 0 ]]
