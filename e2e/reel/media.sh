#!/usr/bin/env bash
# Rebuilds the README's pictures in docs/media: the desktop ones from the
# tests' drawings (tests/media.test.ts, tests/desktop.test.ts), the terminal
# GIFs from the captures scenes.sh recorded in e2e/reel/out.
#
#   e2e/reel/scenes.sh && e2e/reel/media.sh     # needs Chrome and ffmpeg
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
media="$repo/docs/media"
previews="$repo/e2e/out/media"
mkdir -p "$media" "$previews"

claude plugin test "$repo" > "$previews/test.txt" 2>&1 || { tail -30 "$previews/test.txt"; exit 1; }
node "$repo/e2e/preview.mjs" "$previews" < "$previews/test.txt" > /dev/null

desktop() { node "$here/desktop.mjs" "$previews" "$@" > /dev/null; }
REEL_PANE_WIDTH=860 REEL_WIDTH=1848 desktop "$media/rail" media-rail-1:1.6 media-rail-2:2.2 media-rail-3:2.6 media-rail-4:2.4 media-rail-5:0.9 media-rail-6:0.9 media-rail-7:1.4 media-rail-8:2.8 media-rail-9:2
# The presets and the radar; the dials' rows are cut off below them.
REEL_PANE_HEIGHT=478 REEL_WIDTH=1636 desktop "$media/dials" media-dials-balanced:1.8 media-dials-quick:1.8 media-dials-deep-work:1.8 media-dials-autopilot:2.6
REEL_WIDTH=1100 desktop "$media/worktree-desktop" worktree-ready
REEL_WIDTH=1100 desktop "$media/context-desktop" context-library
rm -f "$media/rail.png" "$media/dials.png"

for scene in claim context autopilot; do
  [ -d "$here/out/$scene" ] || { echo "no captures for $scene: run scenes.sh first"; continue; }
  node "$here/render.mjs" "$here/out/$scene" "$media/$scene" --title 'claude — workshop-api' --width 1800 --hold 1.6
done
ls -la "$media"
