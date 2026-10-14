#!/usr/bin/env bash
# Records the README's GIFs from real Claude Code with this mod loaded, in a
# 140x38 tmux pane on a fresh copy of the end-to-end fixture: each scene is a
# folder of captures that render.mjs turns into a GIF.
#
#   e2e/reel/scenes.sh [scene...]     # pool claim dials context autopilot
#   e2e/reel/media.sh                 # then draw them into docs/media
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export FISH_E2E="${FISH_DEMO:-$HOME/work/fishstack-demo}"
frames="$here/out"
# A tmux server of its own, so its options (focus events, which Claude Code
# asks for) touch no one else's.
export TMUX_TMPDIR="$frames/tmux"
mkdir -p "$TMUX_TMPDIR"
media="$repo/docs/media"
scenes=("${@:-pool claim dials context autopilot}")
read -r -a scenes <<< "${scenes[*]}"

c() { python3 -I "$repo/e2e/tmuxctl.py" "$@"; }
screen() { tmux capture-pane -p -t demo; }

approve_until() {
  local condition="$1" timeout="$2" waited=0
  until eval "$condition"; do
    if screen | grep -q 'Do you want to proceed?'; then sleep 1.2; tmux send-keys -t demo 1; fi
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt "$timeout" ] || { screen; echo "timed out: $condition"; exit 1; }
  done
}

rec_start() {
  rm -rf "$frames/$1"
  mkdir -p "$frames/$1"
  python3 -I "$here/record.py" demo "$frames/$1" 0.15 &
  recorder=$!
  current="$1"
}
rec_stop() {
  sleep "${1:-2.5}"
  touch "$frames/$current/stop"
  wait "$recorder"
}

launch() {
  tmux kill-session -t demo 2>/dev/null || true
  tmux new-session -d -s demo -x 140 -y 38 -e CLAUDE_CODE_NO_FLICKER=1 -e COLORTERM=truecolor \
    "unset NO_COLOR; cd '$app' && claude --plugin-dir '$repo' --settings '$FISH_E2E/settings.json' --permission-mode acceptEdits"
  tmux set -s focus-events on
}
ready() {
  c wait demo 'trust this folder|Try "' 40
  if screen | grep -q 'trust this folder'; then
    sleep 1; tmux send-keys -t demo Down; sleep 0.5; tmux send-keys -t demo Enter
  fi
  c wait demo 'Try "' 40
  sleep 1
}
quit() {
  c type demo '/exit'
  sleep 3
  tmux kill-session -t demo 2>/dev/null || true
}

# The --plugin-dir copy's store: saved first, put back however this ends.
for kept in ~/.claude/plugins/store/fishstack_inline-*.json; do
  [ -e "$kept" ] && cp "$kept" "$kept.reel-saved"
done
restore_store() {
  [ -z "${recorder:-}" ] || kill "$recorder" 2>/dev/null || true
  tmux kill-session -t demo 2>/dev/null || true
  for saved in ~/.claude/plugins/store/fishstack_inline-*.json.reel-saved; do
    [ -e "$saved" ] && mv "$saved" "${saved%.reel-saved}"
  done
  return 0
}
trap restore_store EXIT
store() {
  python3 -I - "$1" <<'PY'
import glob, json, os, sys
for path in glob.glob(os.path.expanduser('~/.claude/plugins/store/fishstack_inline-*.json')):
    data = json.load(open(path))
    data.update(json.loads(sys.argv[1]))
    json.dump(data, open(path, 'w'))
PY
}
BALANCED='{"foresight": 3, "crew": 2, "tenacity": 3, "autonomy": 3, "proof": 3, "voice": 3}'
QUICK='{"foresight": 1, "crew": 1, "tenacity": 2, "autonomy": 4, "proof": 2, "voice": 2}'
AUTOPILOT='{"foresight": 4, "crew": 3, "tenacity": 5, "autonomy": 5, "proof": 4, "voice": 2}'

FISH_SETUP_SECONDS=2 "$repo/e2e/setup.sh" > /dev/null
mv "$FISH_E2E/app" "$FISH_E2E/workshop-api"
app="$FISH_E2E/workshop-api"
sed -i '' 's/"autoAnswerMinutes": 0.1/"autoAnswerMinutes": 1/g' "$FISH_E2E/settings.json"
store "{\"autoWorktree\": false, \"dials\": $QUICK}"

has() { [[ " ${scenes[*]} " == *" $1 "* ]]; }

if has pool; then
  echo 'pool: the toggle warms three slots'
  launch; ready
  c type demo '/fishstack worktree'
  c wait demo 'Off: fishStack' 15
  sleep 1
  rec_start pool
  sleep 1.5
  c click demo '[ On ]' 2
  approve_until 'screen | grep -q "Pool: 3 slots, 3"' 120
  rec_stop 3
  quit
fi

if has claim; then
  echo 'claim: a new session moves into a warm slot'
  store '{"autoWorktree": true}'
  launch
  rec_start claim
  ready
  # Keys typed while the session moves into its slot are dropped: ask after.
  approve_until 'screen | grep -q "⎇ fish/"' 90
  sleep 2
  c type demo 'In one sentence, what does server.js serve?'
  sleep 2
  c idle demo 120
  rec_stop 3
fi

if has dials; then
  echo 'dials: presets, one dial, the brief'
  if ! tmux has-session -t demo 2>/dev/null; then launch; ready; fi
  store "{\"dials\": $BALANCED}"
  c type demo '/fishstack dials'
  c wait demo 'How the agent works' 15
  sleep 1
  rec_start dials
  sleep 1.5
  c click demo '[ Quick ]' 2; sleep 1.2
  c click demo '[ Deep work ]' 2; sleep 1.2
  c click demo '[ Autopilot ]' 2; sleep 1.5
  c click demo '[ What agents are told ]' 2
  sleep 2
  rec_stop 2
  c click demo '[ Hide brief ]' 2
  tmux send-keys -t demo Escape
fi

if has context; then
  echo 'context: a strict note reaches the agent'
  if ! tmux has-session -t demo 2>/dev/null; then launch; ready; fi
  store "{\"dials\": $QUICK}"
  c type demo '/fishstack context'
  c wait demo 'Context the agent reads' 15
  sleep 1
  rec_start context
  sleep 1.2
  c click demo 'Or paste a link' 0
  c type demo 'Every JSON response uses snake_case keys, never camelCase.'
  c wait demo '1 of 1 sources on' 10
  sleep 1
  c click demo '[ Strict ]' 2
  sleep 1.5
  tmux send-keys -t demo Escape
  c type demo 'I want to add a createdAt field to items. What should the key be called? One line.'
  sleep 2
  c idle demo 120
  rec_stop 3
fi

if has autopilot; then
  echo 'autopilot: a question nobody answers takes its recommended option'
  if ! tmux has-session -t demo 2>/dev/null; then launch; ready; fi
  c type demo '/fishstack dials'
  c wait demo 'How the agent works' 15
  c click demo '[ Autopilot ]' 2
  sleep 1
  c click demo '✕' 0
  sleep 1
  c type demo '/clear'
  sleep 2
  screen | grep -q 'Dials Autopilot' || { screen; echo 'the dials are not on Autopilot'; exit 1; }
  rec_start autopilot
  sleep 1
  c type demo 'Ask me with AskUserQuestion which port the dev server should use, options "4517 (Recommended)" and "8080". Then reply with only "Port: <answer>".'
  c wait demo 'Port: (4517|8080)' 150
  rec_stop 4
  quit
fi

echo "frames in $frames"
