#!/bin/bash
# startzim.sh <udid> <port> <wikipedia.zim> [extra.zim…]: serve a simulator's installed ZIMs (the onboarding
# kit, Wikipedia skipped), one Wikipedia file and extra archives (id = file name without the date).
D=$(xcrun simctl get_app_container "$1" com.fjlinde.nomadpocket data)/Documents/content/zim; shift
ARGS=()
for f in "$D"/*.zim; do b=$(basename "$f" .zim); id=$(echo "$b" | sed -E 's/_[0-9]{4}-[0-9]{2}[a-z]?$//'); [[ $id == wikipedia_es_all* ]] && continue; ARGS+=("$id=$f"); done
ARGS+=("wikipedia_es_all_nopic=$2")
for f in "${@:3}"; do b=$(basename "$f" .zim); id=$(echo "$b" | sed -E 's/_[0-9]{4}-[0-9]{2}[a-z]?$//'); ARGS+=("$id=$f"); done
exec "$(dirname "$0")/venv/bin/python" -I "$(dirname "$0")/zimserver.py" "$1" "${ARGS[@]}"
