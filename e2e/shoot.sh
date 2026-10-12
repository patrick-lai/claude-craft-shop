#!/usr/bin/env bash
# Draws every tab on the desktop through the tests, renders the previews and
# screenshots each with headless Chrome into <out>/png.
#
#   e2e/shoot.sh [out-dir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/out/preview}"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$out/png"
claude plugin test "$(dirname "$here")" > "$out/test.txt" 2>&1 || { tail -30 "$out/test.txt"; exit 1; }
node "$here/preview.mjs" "$out" < "$out/test.txt"
for page in "$out"/*.html; do
  name="$(basename "$page" .html)"
  [ "$name" = index ] && continue
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=820,1500 --screenshot="$out/png/$name.png" "file://$page" >/dev/null 2>&1
done
ls "$out/png"
