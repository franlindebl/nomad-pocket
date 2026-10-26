#!/usr/bin/env bash
# Android tour on an emulator (Maestro). See docs/E2E.md.
#
#   scripts/e2e-android.sh            # flows tagged `android`
#   scripts/e2e-android.sh --build    # rebuild the release APK first (after code changes)
#
# A release build can't be seeded with fixtures (no run-as), so the flows download what
# they need. The app gets Spanish as its per-app language and location permission.
# Env: AVD (default Pixel_API_36), ANDROID_HOME, MAESTRO.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG=com.fjlinde.nomadpocket
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="${AVD:-Pixel_API_36}"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
MAESTRO="${MAESTRO:-maestro}"

if [[ "${1:-}" == "--build" || ! -f "$APK" ]]; then
  echo "Building ${APK}…"
  (cd "$ROOT/android" && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -q)
fi

if ! "$ADB" devices | grep -q "emulator-.*device$"; then
  echo "Starting emulator ${AVD}…"
  # Explicit DNS: after the Mac changes network the emulator's resolver can go stale
  # (pings work, "Unable to resolve host github.com").
  "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-audio -dns-server 8.8.8.8,1.1.1.1 >/dev/null 2>&1 &
  "$ADB" wait-for-device
  until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
fi
SERIAL="$("$ADB" devices | awk '/^emulator-.*device$/ {print $1; exit}')"
# Mobile data only, so "Wi-Fi only" (on by default) always asks before a download and the
# flows can require that question ("Usar datos móviles"). Some images connect to AndroidWifi.
"$ADB" -s "$SERIAL" shell svc wifi disable || true
# The app trusts Android's "validated" flag: until the network is validated it says
# "Necesitas conexión". The emulator's probes flap between validated and partial
# connectivity, so captive portal detection is off; an airplane-mode toggle makes Android
# evaluate the network again.
"$ADB" -s "$SERIAL" shell settings put global captive_portal_mode 0
validated() { "$ADB" -s "$SERIAL" shell dumpsys connectivity | grep -q "INTERNET&.*&VALIDATED"; }
for attempt in 1 2 3; do
  for _ in $(seq 1 15); do validated && break 2; sleep 2; done
  "$ADB" -s "$SERIAL" shell cmd connectivity airplane-mode enable; sleep 3
  "$ADB" -s "$SERIAL" shell cmd connectivity airplane-mode disable
done
validated || echo "warning: the emulator's network is not validated; network flows will fail"

if ! java -version >/dev/null 2>&1; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

OUT="$ROOT/e2e/artifacts/$(date +%Y%m%d-%H%M%S)-android"
mkdir -p "$OUT"
ln -sfn "$OUT" "$ROOT/e2e/artifacts/latest-android"
passed=0; failed=()
for flow in $(grep -lE '^tags:.*[[ ,]android[],]' "$ROOT"/e2e/flows/**/*.yaml "$ROOT"/e2e/flows/*/*.yaml 2>/dev/null | sort -u); do
  name="$(basename "$flow" .yaml)"
  echo "▶ $name"
  "$ADB" -s "$SERIAL" install -r "$APK" >/dev/null
  "$ADB" -s "$SERIAL" shell pm clear "$PKG" >/dev/null
  "$ADB" -s "$SERIAL" shell cmd locale set-app-locales "$PKG" --locales es-ES
  "$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION
  "$ADB" -s "$SERIAL" emu geo fix -3.7038 40.4168 >/dev/null
  mkdir -p "$OUT/$name"
  if "$MAESTRO" --device "$SERIAL" test "$flow" --test-output-dir "$OUT/$name" > "$OUT/$name/maestro.log" 2>&1; then
    passed=$((passed + 1)); echo "  ✓"
  else
    reason="$(grep -m1 '^\[Failed\]' "$OUT/$name/maestro.log" | sed -E 's/^\[Failed\] [^ ]+ \([^)]*\) //' || true)"
    failed+=("$name  ${reason:-see maestro.log}"); echo "  ✗ ${reason:-}"
  fi
  # Lift <dir>/<timestamp>/<flow>/ to <dir>, as scripts/e2e.sh does.
  # (`|| true`: under set -e a flow without that folder would end the whole run.)
  for inner in "$OUT/$name"/*/"$name"; do [[ -d "$inner" ]] && mv "$inner"/* "$OUT/$name"/ && rm -r "$(dirname "$inner")" || true; done
done

{
  echo "$passed passed, ${#failed[@]} failed — $OUT"
  [[ ${#failed[@]} -eq 0 ]] || printf '  ✗ %s\n' "${failed[@]}"
} | tee "$OUT/summary.txt"
[[ ${#failed[@]} -eq 0 ]]
