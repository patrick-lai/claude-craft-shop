#!/usr/bin/env bash
# Drives Claude Code with this mod loaded, in a 200x50 tmux session in the
# fullscreen layout, through the four features, checking each and capturing
# the screen (with colors) into e2e/out/*.ansi.
#
#   e2e/drive.sh            # needs tmux, node and a signed-in claude
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
out="$here/out"
port="${COMMISSION_DEV_PORT:-4517}"
export COMMISSION_DEV_PORT="$port"
export FISH_E2E="${TMPDIR%/}/fish-e2e/run-$(date +%s)"
mkdir -p "$out"

c() { python3 -I "$here/tmuxctl.py" "$@"; }
screen() { tmux capture-pane -p -t fish; }
pass() { printf '  \033[32mpass\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; screen; exit 1; }

# Approves permission prompts until the condition command succeeds.
approve_until() {
  local condition="$1" timeout="$2" waited=0
  until eval "$condition"; do
    if screen | grep -q 'Do you want to proceed?'; then
      tmux send-keys -t fish 1
    fi
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt "$timeout" ] || fail "timed out waiting for: $condition"
  done
}

# The diff panel docks over the pane once a file changes; close it.
close_diff_panel() {
  if screen | head -3 | grep -q 'changed'; then c click fish '✕'; fi
}

fixture="$("$here/setup.sh")"
app="$fixture/app"
tmux kill-session -t fish 2>/dev/null || true
tmux new-session -d -s fish -x 200 -y 50 -e CLAUDE_CODE_NO_FLICKER=1 -e COLORTERM=truecolor \
  "unset NO_COLOR; cd '$app' && claude --plugin-dir '$repo' --settings '$fixture/settings.json' --permission-mode acceptEdits"

echo "1. Worktree head start ($fixture)"
c wait fish 'trust this folder' 30
sleep 1
tmux send-keys -t fish Down
c wait fish '❯ 2\. Yes, I trust this folder|❯ Yes, I trust this folder' 10
tmux send-keys -t fish Enter
c wait fish 'Read-only until the worktree is ready' 30
pass 'the band says read-only while the worktree is prepared'
c type fish '/fishstack dials'
c click fish '[ Balanced ]' 2
c type fish '/fishstack worktree'
c shot fish "$out/01-head-start.ansi"

c ask fish 'Create a file hello.txt containing the line: hello from fishStack. If you cannot write yet, say so and end your turn.'
[ ! -e "$app/hello.txt" ] || fail 'hello.txt was written into the main checkout during the head start'
screen | grep -q 'Read-only until the worktree is ready' || fail 'the head start ended before the early prompt was answered'
pass 'the early write was held back while read-only'
c shot fish "$out/02-early-prompt.ansi"

approve_until 'ls "$fixture"/slots/*/*/hello.txt >/dev/null 2>&1' 180
slot="$(dirname "$(ls "$fixture"/slots/*/*/hello.txt)")"
git -C "$app" worktree list | grep -q "$(basename "$slot")" || fail 'the slot is not in git worktree list'
[ ! -e "$app/hello.txt" ] || fail 'hello.txt also landed in the main checkout'
pass "the session moved into $slot and hello.txt landed there, not in the main checkout"
c idle fish 180
close_diff_panel
c type fish '/fishstack worktree'
c wait fish '● Ready · fish/' 30
c shot fish "$out/03-worktree.ansi"

echo '2. Crew dials'
c type fish '/fishstack dials'
close_diff_panel
c click fish '[ Balanced ]' 2
c click fish '[ Quick ]' 2
c click fish 'Voice       ■' 16
c click fish 'Voice       ■' 0
c click fish '[ What agents are told ]' 2
c wait fish 'Voice \(Teach\)' 10
pass 'pressing the pips changes the brief'
c shot fish "$out/04-dials.ansi"
tmux send-keys -t fish Escape
c ask fish 'Which level labels are your Voice and Foresight dials set to now? Answer as "Voice: X, Foresight: Y" only.'
screen | grep -q 'Voice: Teach, Foresight: Dive in' || fail 'the agent did not echo the dials'
pass 'the agent echoes the working style it was given'

echo '3. Context library'
c type fish '/fishstack context'
c click fish 'Or paste a link' 0
c type fish "The Workshop API's launch codename is BLUE HERON."
c wait fish '1 of 1 sources on' 10
pass 'a note added in the field is on'
c click fish 'Make strict' 0
c wait fish 'Strict' 10
pass 'the note is strict'
c shot fish "$out/05-context.ansi"
tmux send-keys -t fish Escape
c ask fish "What is the Workshop API's launch codename? Answer in two words."
screen | grep -qi 'BLUE HERON' || fail 'the agent did not cite the strict note'
pass 'the agent cites the strict note'

echo 'All checks passed.'
