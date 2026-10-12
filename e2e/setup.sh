#!/usr/bin/env bash
# Builds the end-to-end fixture: a bare origin and a clone of it holding a
# small JSON API and its openapi.json, plus settings that point Craft Shop's
# worktree root into the fixture.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="${CRAFT_E2E:-${TMPDIR%/}/craft-e2e}"
port="${COMMISSION_DEV_PORT:-4517}"

rm -rf "$root"
mkdir -p "$root"
git init -q --bare -b main "$root/origin.git"
git clone -q "$root/origin.git" "$root/app" 2>/dev/null

cp "$here/fixture/server.js" "$here/fixture/openapi.json" "$root/app/"
cat > "$root/app/README.md" <<'MD'
# Workshop API

A tiny JSON API: `node server.js` serves /items on $COMMISSION_DEV_PORT.
MD
git -C "$root/app" add -A
git -C "$root/app" -c user.name=craft -c user.email=craft@example.com commit -q -m "Workshop API"
git -C "$root/app" push -q origin main

cat > "$root/settings.json" <<JSON
{
  "pluginConfigs": {
    "craft-shop": { "options": { "autoWorktree": true, "worktreeRoot": "$root/slots", "setupCommand": "sleep ${CRAFT_SETUP_SECONDS:-25}" } },
    "craft-shop@inline": { "options": { "autoWorktree": true, "worktreeRoot": "$root/slots", "setupCommand": "sleep ${CRAFT_SETUP_SECONDS:-25}" } }
  }
}
JSON

echo "$root"
