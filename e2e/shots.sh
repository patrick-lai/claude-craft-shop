#!/usr/bin/env bash
# Turns the colored captures drive.sh wrote (e2e/out/*.ansi) into HTML pages
# a browser can screenshot: aha keeps the ANSI colors, and the page pins a
# monospace font and the terminal's 200 columns.
set -euo pipefail

out="$(cd "$(dirname "$0")" && pwd)/out"
for capture in "$out"/*.ansi; do
  page="${capture%.ansi}.html"
  aha --black --no-header < "$capture" > "$page.body"
  {
    printf '<!doctype html><meta charset="utf-8"><title>%s</title>\n' "$(basename "${capture%.ansi}")"
    printf '<style>body{margin:0;background:#000;color:#ddd}pre{margin:0;padding:16px;font:11px/1.25 "SF Mono",Menlo,monospace;white-space:pre}</style>\n<pre>'
    cat "$page.body"
    printf '</pre>\n'
  } > "$page"
  rm "$page.body"
  echo "$page"
done
