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
export CRAFT_E2E="${TMPDIR%/}/craft-e2e/run-$(date +%s)"
mkdir -p "$out"

c() { python3 -I "$here/tmuxctl.py" "$@"; }
screen() { tmux capture-pane -p -t craft; }
pass() { printf '  \033[32mpass\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; screen; exit 1; }

# Approves permission prompts until the condition command succeeds.
approve_until() {
  local condition="$1" timeout="$2" waited=0
  until eval "$condition"; do
    if screen | grep -q 'Do you want to proceed?'; then
      tmux send-keys -t craft 1
    fi
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt "$timeout" ] || fail "timed out waiting for: $condition"
  done
}

# The diff panel docks over the pane once a file changes; close it.
close_diff_panel() {
  if screen | head -3 | grep -q 'changed'; then c click craft '✕'; fi
}

fixture="$("$here/setup.sh")"
app="$fixture/app"
tmux kill-session -t craft 2>/dev/null || true
tmux new-session -d -s craft -x 200 -y 50 -e CLAUDE_CODE_NO_FLICKER=1 -e COLORTERM=truecolor \
  "unset NO_COLOR; cd '$app' && claude --plugin-dir '$repo' --settings '$fixture/settings.json' --permission-mode acceptEdits"

echo "1. Worktree head start ($fixture)"
c wait craft 'trust this folder' 30
sleep 1
tmux send-keys -t craft Down
c wait craft '❯ 2\. Yes, I trust this folder|❯ Yes, I trust this folder' 10
tmux send-keys -t craft Enter
c wait craft 'Read-only until the worktree is ready' 30
pass 'the band says read-only while the worktree is prepared'
c type craft '/craft dials'
c click craft '[ Balanced ]' 2
c type craft '/craft worktree'
c shot craft "$out/01-head-start.ansi"

c ask craft 'Create a file hello.txt containing the line: hello from craft shop. If you cannot write yet, say so and end your turn.'
[ ! -e "$app/hello.txt" ] || fail 'hello.txt was written into the main checkout during the head start'
screen | grep -q 'Read-only until the worktree is ready' || fail 'the head start ended before the early prompt was answered'
pass 'the early write was held back while read-only'
c shot craft "$out/02-early-prompt.ansi"

approve_until 'ls "$fixture"/slots/*/*/hello.txt >/dev/null 2>&1' 180
slot="$(dirname "$(ls "$fixture"/slots/*/*/hello.txt)")"
git -C "$app" worktree list | grep -q "$(basename "$slot")" || fail 'the slot is not in git worktree list'
[ ! -e "$app/hello.txt" ] || fail 'hello.txt also landed in the main checkout'
pass "the session moved into $slot and hello.txt landed there, not in the main checkout"
c idle craft 180
close_diff_panel
c type craft '/craft worktree'
c wait craft '● Ready · craft/' 30
c shot craft "$out/03-worktree.ansi"

echo '2. Crew dials'
c type craft '/craft dials'
close_diff_panel
c click craft '[ Balanced ]' 2
c click craft '[ Quick ]' 2
c click craft 'Voice       ■' 16
c click craft 'Voice       ■' 0
c click craft '[ What agents are told ]' 2
c wait craft 'Voice \(Teach\)' 10
pass 'pressing the pips changes the brief'
c shot craft "$out/04-dials.ansi"
tmux send-keys -t craft Escape
c ask craft 'Which level labels are your Voice and Foresight dials set to now? Answer as "Voice: X, Foresight: Y" only.'
screen | grep -q 'Voice: Teach, Foresight: Dive in' || fail 'the agent did not echo the dials'
pass 'the agent echoes the working style it was given'

echo '3. Context library'
c type craft '/craft context'
c click craft 'New folder' 0
c click craft 'Folder name' 0
c type craft 'Launch'
c wait craft 'New sources go into Launch' 10
pass 'a new folder becomes where new sources go'
c click craft 'Paste a link' 0
c type craft "The Workshop API's launch codename is BLUE HERON."
c wait craft '1 source · 1 on' 10
c click craft 'Make strict' 0
pass 'a strict note sits in the Launch folder'
c shot craft "$out/05-context.ansi"
tmux send-keys -t craft Escape
c ask craft "What is the Workshop API's launch codename? Answer in two words."
screen | grep -qi 'BLUE HERON' || fail 'the agent did not cite the strict note'
pass 'the agent cites the strict note'

echo 'All checks passed.'
