#!/usr/bin/env bash
# Fetches the prebuilt libkiwix/libzim xcframework (CoreKiwix.xcframework, ~200 MB
# unpacked: libkiwix + libzim + xapian + ICU + zstd/lzma/curl static libs) into
# modules/nomad-zim/ios/Frameworks. Idempotent: does nothing when the pinned
# version is already in place. The binaries are gitignored.
#
# Runs from the root package.json `postinstall`. Skips silently on non-macOS hosts
# (Linux CI building Android only) and when NOMAD_ZIM_SKIP_FETCH=1.
set -euo pipefail

VERSION="14.2.1-2"
MD5="78c0398d14228d11d2caf2c888314d04"
URL="https://download.kiwix.org/release/libkiwix/libkiwix_xcframework-${VERSION}.tar.gz"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/../ios/Frameworks"
STAMP="$DEST/.version"
# Bump LAYOUT when the post-processing below changes, to force a refresh.
LAYOUT="2"
STAMP_VALUE="$VERSION+$LAYOUT"

if [[ "${NOMAD_ZIM_SKIP_FETCH:-0}" == "1" ]]; then
  echo "[nomad-zim] NOMAD_ZIM_SKIP_FETCH=1, skipping libkiwix fetch"
  exit 0
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[nomad-zim] not macOS, skipping iOS libkiwix fetch"
  exit 0
fi
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" && -d "$DEST/CoreKiwix.xcframework" ]]; then
  echo "[nomad-zim] CoreKiwix.xcframework $VERSION already present"
  exit 0
fi

md5_of() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ARCHIVE="$TMP/libkiwix.tar.gz"

echo "[nomad-zim] downloading libkiwix xcframework $VERSION (~60 MB)…"
curl -fsSL --retry 3 --retry-delay 2 -o "$ARCHIVE" "$URL"

ACTUAL="$(md5_of "$ARCHIVE")"
if [[ "$ACTUAL" != "$MD5" ]]; then
  echo "[nomad-zim] md5 mismatch: expected $MD5, got $ACTUAL" >&2
  exit 1
fi

mkdir -p "$TMP/x"
tar -xzf "$ARCHIVE" -C "$TMP/x"
SRC="$TMP/x/libkiwix_xcframework-${VERSION}/lib/CoreKiwix.xcframework"
if [[ ! -d "$SRC" ]]; then
  echo "[nomad-zim] unexpected archive layout" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -rf "$DEST/CoreKiwix.xcframework"
mv "$SRC" "$DEST/CoreKiwix.xcframework"
PLIST="$DEST/CoreKiwix.xcframework/Info.plist"
# 1. Drop the macOS slice: not needed by the app, only bloats the checkout.
for i in 0 1 2 3 4 5; do
  ID="$(/usr/libexec/PlistBuddy -c "Print :AvailableLibraries:$i:LibraryIdentifier" "$PLIST" 2>/dev/null || true)"
  if [[ "$ID" == macos-* ]]; then
    /usr/libexec/PlistBuddy -c "Delete :AvailableLibraries:$i" "$PLIST"
    rm -rf "$DEST/CoreKiwix.xcframework/$ID"
    break
  fi
done
# 2. The slices ship the archive as "merged.a"; CocoaPods links static xcframeworks
#    with -l<name>, which needs a lib*.a file name. Rename to libCoreKiwix.a.
for i in 0 1 2 3 4 5; do
  ID="$(/usr/libexec/PlistBuddy -c "Print :AvailableLibraries:$i:LibraryIdentifier" "$PLIST" 2>/dev/null || true)"
  [[ -z "$ID" ]] && break
  SLICE="$DEST/CoreKiwix.xcframework/$ID"
  if [[ -f "$SLICE/merged.a" ]]; then
    mv "$SLICE/merged.a" "$SLICE/libCoreKiwix.a"
  fi
  /usr/libexec/PlistBuddy -c "Set :AvailableLibraries:$i:LibraryPath libCoreKiwix.a" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :AvailableLibraries:$i:BinaryPath libCoreKiwix.a" "$PLIST"
done
echo "$STAMP_VALUE" > "$STAMP"
echo "[nomad-zim] CoreKiwix.xcframework $VERSION installed"
