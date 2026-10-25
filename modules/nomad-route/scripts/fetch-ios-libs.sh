#!/usr/bin/env bash
# Fetches the prebuilt Valhalla routing engine for iOS (Rallista valhalla-mobile,
# MIT: ValhallaWrapper.xcframework, ~31 MB unpacked: Valhalla + protobuf + absl +
# boost headers) and the IANA tzdata tar Valhalla's date library reads, into
# modules/nomad-route/ios/Frameworks. Idempotent; the binaries are gitignored.
#
# Runs from the root package.json `postinstall`. Skips silently on non-macOS hosts
# and when NOMAD_ROUTE_SKIP_FETCH=1.
set -euo pipefail

VERSION="0.6.4"
COMMIT="852dd75c356ecbcd0fa693dcbdd7178059013f4c"
ZIP_SHA="c12b796de073e89f6b0be02cbfabf845a324166467609268d747c094d27ddb47"
TZ_SHA="0d28b24fbbe940be9e0522086358ba74a438e4d81d2da4a2d290db929b7a8649"
ZIP_URL="https://github.com/Rallista/valhalla-mobile/releases/download/${VERSION}/valhalla-wrapper.xcframework.zip"
TZ_URL="https://raw.githubusercontent.com/Rallista/valhalla-mobile/${COMMIT}/apple/Sources/Valhalla/SupportData/tzdata.tar"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/../ios/Frameworks"
STAMP="$DEST/.version"
LAYOUT="1"
STAMP_VALUE="$VERSION+$LAYOUT"

if [[ "${NOMAD_ROUTE_SKIP_FETCH:-0}" == "1" ]]; then
  echo "[nomad-route] NOMAD_ROUTE_SKIP_FETCH=1, skipping valhalla-mobile fetch"
  exit 0
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[nomad-route] not macOS, skipping iOS valhalla-mobile fetch"
  exit 0
fi
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" && -d "$DEST/ValhallaWrapper.xcframework" && -f "$DEST/tzdata.tar" ]]; then
  echo "[nomad-route] valhalla-mobile $VERSION already present"
  exit 0
fi

check() {
  local actual
  actual="$(shasum -a 256 "$1" | cut -d' ' -f1)"
  if [[ "$actual" != "$2" ]]; then
    echo "[nomad-route] sha256 mismatch for $(basename "$1"): expected $2, got $actual" >&2
    exit 1
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[nomad-route] downloading valhalla-mobile $VERSION (~22 MB)…"
curl -fsSL --retry 3 --retry-delay 2 -o "$TMP/w.zip" "$ZIP_URL"
check "$TMP/w.zip" "$ZIP_SHA"
curl -fsSL --retry 3 --retry-delay 2 -o "$TMP/tzdata.tar" "$TZ_URL"
check "$TMP/tzdata.tar" "$TZ_SHA"

mkdir -p "$TMP/x"
unzip -q "$TMP/w.zip" -d "$TMP/x"
if [[ ! -d "$TMP/x/valhalla-wrapper.xcframework" ]]; then
  echo "[nomad-route] unexpected archive layout" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -rf "$DEST/ValhallaWrapper.xcframework"
mv "$TMP/x/valhalla-wrapper.xcframework" "$DEST/ValhallaWrapper.xcframework"
mv "$TMP/tzdata.tar" "$DEST/tzdata.tar"
echo "$STAMP_VALUE" > "$STAMP"
echo "[nomad-route] valhalla-mobile $VERSION installed"
