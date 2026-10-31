#!/usr/bin/env bash
# CarPlay in the simulator, scripted (docs/CARPLAY_PLAN.md, "Testing"). Xcode 27 replaced Simulator.app
# with Device Hub, which has no CarPlay screen on public builds; Xcode 26.x's Simulator.app still has
# one (I/O > External Displays > CarPlay), but only for an iOS 26.x simulator, whose CarPlay host then
# crashes on any map template unless sim-shim.m is injected. Builds still come from Xcode 27.
#
#   scripts/carplay/carplay-sim.sh setup        # simulator, shim, Simulator.app with the CarPlay screen
#   scripts/carplay/carplay-sim.sh shim         # inject the shim again (lost on every simulator reboot)
#   scripts/carplay/carplay-sim.sh install      # install the Release build, open it on the car screen
#   scripts/carplay/carplay-sim.sh tap X Y      # tap the car screen, in its screenshot's pixels (800x480)
#   scripts/carplay/carplay-sim.sh tap X Y --still   # without movement (bar buttons, keyboard keys)
#   scripts/carplay/carplay-sim.sh shot [file]  # screenshot of the car screen
#
# Env: XCODE26 (default /Applications/Xcode-26.5.app), DEVICE (default NP-carplay-26), APP (default
# the Release simulator build in ios/build/sim). tap needs the Accessibility permission for the terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XCODE26="${XCODE26:-/Applications/Xcode-26.5.app}"
DEVICE="${DEVICE:-NP-carplay-26}"
APP="${APP:-$ROOT/ios/build/sim/Build/Products/Release-iphonesimulator/NomadPocket.app}"
RUNTIME=com.apple.CoreSimulator.SimRuntime.iOS-26-5
CACHE="$HOME/Library/Caches/nomad-carplay"
WINDOW="$DEVICE – CarPlay"
mkdir -p "$CACHE"

udid() { xcrun simctl list devices available | grep -E "^ +$DEVICE \(" | head -1 | grep -oE '[0-9A-F-]{36}'; }

shim() {
  xcrun -sdk iphonesimulator clang -arch arm64 -dynamiclib -mios-simulator-version-min=16.0 -framework Foundation \
    -o "$CACHE/shim.dylib" "$ROOT/scripts/carplay/sim-shim.m"
  # launchctl setenv truncates at 127 characters: the cache path is well under.
  xcrun simctl spawn "$(udid)" launchctl setenv DYLD_INSERT_LIBRARIES "$CACHE/shim.dylib"
  pkill -f CarPlayTemplateUIHost || true
}

tapper() {
  [[ "$CACHE/tap" -nt "$ROOT/scripts/carplay/tap.swift" ]] || swiftc -O "$ROOT/scripts/carplay/tap.swift" -o "$CACHE/tap"
  echo "$CACHE/tap"
}

window_frame() {
  osascript -e "tell application \"System Events\" to tell process \"Simulator\" to get {position, size} of window \"$WINDOW\"" | tr -d ','
}

# Where the car screen sits inside its window (the bezel and title bar around it), found by matching
# a screenshot of the car screen against a capture of the window. Stored per window size.
calibrate() {
  read -r WX WY WW WH < <(window_frame)
  local shot="$CACHE/cal-car.png" win="$CACHE/cal-win.png"
  xcrun simctl io "$(udid)" screenshot --display=external "$shot" >/dev/null
  screencapture -x -R"$WX,$WY,$WW,$WH" "$win"
  python3 -I - "$win" "$shot" "$WW" "$WH" > "$CACHE/calibration" <<'PY'
import sys
import numpy as np
from PIL import Image
win_path, car_path, ww, wh = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
q = 2  # search at half the window's point size
win = np.asarray(Image.open(win_path).convert('L').resize((ww // q, wh // q)), dtype=np.float32)
car = Image.open(car_path).convert('L')
cw, ch = car.size
best = (1e18, None)
for w in range(ww // q // 2, ww // q + 1, 2):
    h = round(w * ch / cw)
    if h > wh // q: break
    c = np.asarray(car.resize((w, h)), dtype=np.float32)
    for y in range(0, wh // q - h + 1, 2):
        for x in range(0, ww // q - w + 1, 2):
            d = float(np.mean(np.abs(win[y:y + h, x:x + w] - c)))
            if d < best[0]: best = (d, (x, y, w))
_, (x, y, w) = best
print(x * q, y * q, w * q / cw, ww, wh)
PY
}

tap() {
  read -r WX WY WW WH < <(window_frame)
  [[ -f "$CACHE/calibration" ]] || calibrate
  read -r OX OY S CW CH < "$CACHE/calibration"
  if [[ "$CW $CH" != "$WW $WH" ]]; then calibrate; read -r OX OY S CW CH < "$CACHE/calibration"; fi
  osascript -e 'tell application "Simulator" to activate' \
    -e "tell application \"System Events\" to tell process \"Simulator\" to perform action \"AXRaise\" of window \"$WINDOW\"" >/dev/null
  sleep 0.4
  "$(tapper)" "$(python3 -c "print($WX + $OX + $1 * $S)")" "$(python3 -c "print($WY + $OY + $2 * $S)")" ${3:-}
}

shot() {
  local file="${1:-$CACHE/car.png}"
  xcrun simctl io "$(udid)" screenshot --display=external "$file" >/dev/null
  sips -Z 800 "$file" >/dev/null
  echo "$file"
}

case "${1:-}" in
  setup)
    [[ -d "$XCODE26" ]] || { echo "Xcode 26.x not found at $XCODE26 (developer.apple.com/download/all, install it next to Xcode 27)"; exit 1; }
    if [[ -z "$(udid)" ]]; then xcrun simctl create "$DEVICE" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME" >/dev/null; fi
    xcrun simctl boot "$(udid)" 2>/dev/null || true
    xcrun simctl bootstatus "$(udid)" -b >/dev/null
    shim
    open -a "$XCODE26/Contents/Developer/Applications/Simulator.app" --args -CurrentDeviceUDID "$(udid)"
    sleep 8
    osascript -e 'tell application "System Events" to tell process "Simulator" to click menu item "CarPlay" of menu 1 of menu item "External Displays" of menu 1 of menu bar item "I/O" of menu bar 1' >/dev/null
    echo "CarPlay screen open on $DEVICE ($(udid)); install the app with: $0 install"
    ;;
  shim) shim ;;
  install)
    xcrun simctl install "$(udid)" "$APP"
    xcrun simctl privacy "$(udid)" grant location com.fjlinde.nomadpocket || true
    sleep 3
    # A reinstall closes the app on the car screen: the home grid, then the app (second row, first).
    tap 53 427; sleep 2; tap 202 282; sleep 5
    ;;
  tap) shift; tap "$@" ;;
  shot) shift; shot "$@" ;;
  calibrate) calibrate; cat "$CACHE/calibration" ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
