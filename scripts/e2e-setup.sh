#!/usr/bin/env bash
# One-time setup for the E2E suite (docs/E2E.md): checks the tools, creates the
# NP-e2e simulator and downloads the ZIM fixtures. Safe to re-run: it only does
# what is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${DEVICE:-NP-e2e}"
RUNTIME=com.apple.CoreSimulator.SimRuntime.iOS-27-0
MIRROR=https://download.kiwix.org/zim
# <mirror folder>/<file>. The suite's assertions depend on these exact files.
# wikipedia_en_100_mini_2026-01.zim is in git: Kiwix removed it from the mirror.
FIXTURES=(
  devdocs/devdocs_en_node_2026-08.zim
  freecodecamp/freecodecamp_es_all_2026-10.zim
  zimit/nhs.uk_en_medicines_2026-09b.zim
)
problems=0

echo "Tools"
xcrun simctl help >/dev/null 2>&1 && echo "  ✓ Xcode simulator tools" \
  || { echo "  ✗ Xcode command line tools (xcode-select --install)"; problems=1; }
command -v "${MAESTRO:-maestro}" >/dev/null && echo "  ✓ maestro $("${MAESTRO:-maestro}" --version 2>/dev/null | tail -1)" \
  || { echo "  ✗ maestro: brew install mobile-dev-inc/tap/maestro"; problems=1; }
if java -version >/dev/null 2>&1 || [[ -x /opt/homebrew/opt/openjdk/bin/java ]]; then
  echo "  ✓ java"
else
  echo "  ✗ java: brew install openjdk"; problems=1
fi

echo "Simulator"
if xcrun simctl list devices available | grep -qE "^ +$DEVICE \("; then
  echo "  ✓ $DEVICE"
elif xcrun simctl list runtimes | grep -q "$RUNTIME"; then
  udid="$(xcrun simctl create "$DEVICE" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME")"
  xcrun simctl boot "$udid"
  xcrun simctl spawn "$udid" defaults write "Apple Global Domain" AppleLanguages -array es-ES
  xcrun simctl spawn "$udid" defaults write "Apple Global Domain" AppleLocale -string es_ES
  xcrun simctl shutdown "$udid"
  echo "  ✓ $DEVICE created ($udid, iPhone 17 Pro, iOS 27.0, es-ES)"
else
  echo "  ✗ iOS 27.0 simulator runtime missing (Xcode › Settings › Components)"; problems=1
fi

echo "Fixtures (e2e/fixtures/)"
mkdir -p "$ROOT/e2e/fixtures"
for f in "${FIXTURES[@]}"; do
  file="$(basename "$f")" dest="$ROOT/e2e/fixtures/$(basename "$f")"
  if [[ -s "$dest" ]]; then
    echo "  ✓ $file"
  elif curl -fsSL -o "$dest.part" "$MIRROR/$f"; then
    mv "$dest.part" "$dest"; echo "  ✓ $file (downloaded)"
  else
    rm -f "$dest.part"
    echo "  ✗ $file is no longer on $MIRROR: copy it into e2e/fixtures/ from another machine"
    problems=1
  fi
done

echo
if [[ $problems -eq 0 ]]; then
  echo "Ready: npm run e2e"
else
  echo "Fix the ✗ items above, then re-run scripts/e2e-setup.sh"; exit 1
fi
