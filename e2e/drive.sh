#!/usr/bin/env bash
# Drives real Claude Code with this mod loaded (--plugin-dir), in a 200x50
# tmux session in the fullscreen layout, through every feature, checking each
# against the disk and git, timing what should be quick, and capturing the
# screen (with colors) into e2e/out/*.ansi.
#
#   e2e/drive.sh            # needs tmux, node, python3 and a signed-in claude
#
# 1. Perm worktree: the toggle warms a pool of three slots, node_modules
#    cloned into each; a new session is read-only, then moves into a slot and
#    its writes land there; the next session reuses that slot, its leftover
#    work kept under refs/fish/backup/.
# 2. Dials: pressing them changes what the agent says it was told, mid-turn
#    too: changed while a tool runs, they reach the agent's next request.
# 3. Context: a strict note reaches the agent.
# 4. Claude Code's own worktrees (claude --worktree, the desktop's worktree
#    option) come up in a fishStack slot.
# 5. On Autopilot, a question nobody answers takes its recommended option
#    (the fixture waits 6 seconds, not 15 minutes).
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
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
took() { printf '%s.%ss' "$(( ($(now_ms) - $1) / 1000 ))" "$(( ($(now_ms) - $1) % 1000 / 100 ))"; }

# Waits for a shell condition, approving permission prompts meanwhile.
approve_until() {
  local condition="$1" timeout="$2" waited=0
  until eval "$condition"; do
    if tmux has-session -t fish 2>/dev/null && screen | grep -q 'Do you want to proceed?'; then
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

start_claude() {
  tmux kill-session -t fish 2>/dev/null || true
  tmux new-session -d -s fish -x 200 -y 50 -e CLAUDE_CODE_NO_FLICKER=1 -e COLORTERM=truecolor \
    "unset NO_COLOR; cd '$app' && claude --plugin-dir '$repo' --settings '$fixture/settings.json' --permission-mode acceptEdits ${1:-}"
  c wait fish 'trust this folder|for shortcuts|fishStack|≋' 40
  if screen | grep -q 'trust this folder'; then
    sleep 1
    tmux send-keys -t fish Down
    c wait fish '❯ 2\. Yes, I trust this folder|❯ Yes, I trust this folder' 10
    tmux send-keys -t fish Enter
  fi
  # Keys typed before the prompt is up are dropped: wait for its placeholder.
  c wait fish 'Try "' 40
  sleep 1
}

# Moving into the worktree (EnterWorktree) resets the prompt, dropping keys
# typed meanwhile: wait for the band to say it is done.
wait_moved_in() {
  approve_until 'screen | grep -q "Worktree ready"' 60
  sleep 2
}

quit_claude() {
  c idle fish 300
  c type fish '/exit'
  local waited=0
  while tmux has-session -t fish 2>/dev/null && [ "$waited" -lt 20 ]; do sleep 1; waited=$((waited + 1)); done
  tmux kill-session -t fish 2>/dev/null || true
}

# Slots git knows under the fixture's root, and how many hold a file.
slots() { git -C "$app" worktree list --porcelain | grep -c "^worktree .*/slots/" || true; }

fixture="$("$here/setup.sh")"
app="$fixture/app"

# The --plugin-dir copy's store is shared with any session using that copy
# (a developer's own): save it, and put it back however the run ends.
for kept in ~/.claude/plugins/store/fishstack_inline-*.json; do
  [ -e "$kept" ] && cp "$kept" "$kept.e2e-saved"
done
restore_store() {
  for saved in ~/.claude/plugins/store/fishstack_inline-*.json.e2e-saved; do
    [ -e "$saved" ] && mv "$saved" "${saved%.e2e-saved}"
  done
  return 0
}
trap restore_store EXIT

# The toggle and the dials are kept in the --plugin-dir copy's own store
# across runs: start each run with the toggle off (the run turns it on) and
# the Quick dials (no subagents, short answers), so turns stay short.
python3 -I - <<'PY'
import glob, json, os
for path in glob.glob(os.path.expanduser('~/.claude/plugins/store/fishstack_inline-*.json')):
    data = json.load(open(path))
    data['autoWorktree'] = False
    data['dials'] = {'foresight': 1, 'crew': 1, 'tenacity': 2, 'autonomy': 4, 'proof': 2, 'voice': 2}
    json.dump(data, open(path, 'w'))
PY

echo "1. Perm worktree ($fixture)"
start_claude
c type fish '/fishstack worktree'
c wait fish 'Off: fishStack leaves worktrees' 15
pass 'Perm worktree starts off'
t0="$(now_ms)"
c click fish '[ On ]' 2
c wait fish 'On: new sessions' 10
pass "the toggle turns on ($(took "$t0"))"
approve_until '[ "$(slots)" -ge 3 ]' 180
c wait fish 'Pool: 3 slots, 3 ready' 120
pass "three slots are warmed in the background, setup included ($(took "$t0"), each with a ${FISH_SETUP_SECONDS:-4}s setup)"
for n in 1 2 3; do
  slot="$(ls -d "$fixture"/slots/*/"$n")"
  [ -e "$slot/node_modules/left-pad/index.js" ] || fail "slot $n has no node_modules"
  [ -e "$slot/packages/api/node_modules/tiny/index.js" ] || fail "slot $n has no nested node_modules"
  [ -z "$(git -C "$slot" status --porcelain)" ] || fail "slot $n is not clean"
done
pass 'each slot has its node_modules cloned, nested ones too, and is clean'
pass 'the tab shows the pool: 3 slots, 3 ready'
c shot fish "$out/01-pool.ansi"
quit_claude

t0="$(now_ms)"
start_claude
approve_until 'git -C "$app" worktree list | grep -q "fish/"' 60
claim="$(took "$t0")"
first="$(git -C "$app" worktree list | grep 'fish/' | awk '{print $1}')"
pass "a new session claims a warm slot ($claim from launch): $first"
wait_moved_in
pass "it moved in, ready to type, $(took "$t0") from launch"
c type fish '/fishstack worktree'
c wait fish '● Ready · fish/' 30
pass 'the session moved into its worktree'
c shot fish "$out/02-claimed.ansi"
c ask fish 'Create a file hello.txt containing the line: hello from fishStack. Do not commit it.' 300
approve_until '[ -e "$first/hello.txt" ]' 120
[ ! -e "$app/hello.txt" ] || fail 'hello.txt landed in the main checkout'
pass 'hello.txt landed in the slot, not the main checkout'
approve_until '[ "$(slots)" -ge 3 ]' 60
pass "the pool keeps a spare: $(slots) slots"
quit_claude

start_claude
approve_until 'git -C "$app" worktree list | grep -c "fish/" | grep -q 1 && [ ! -e "$first/hello.txt" ]' 90
[ -n "$(git -C "$app" for-each-ref refs/fish/backup)" ] || fail 'the leftover work was not backed up'
pass 'the next session reused the slot: hello.txt kept under refs/fish/backup/, the slot clean'
git -C "$app" show "$(git -C "$app" for-each-ref --format='%(objectname)' refs/fish/backup | head -1)" --stat | grep -q hello.txt || fail 'the backup does not hold hello.txt'
pass 'the backup holds hello.txt'
wait_moved_in

echo '2. Crew dials'
t0="$(now_ms)"
c type fish '/fishstack dials'
c wait fish 'How the agent works' 10
pass "the Dials tab opens ($(took "$t0"))"
close_diff_panel
c click fish '[ Balanced ]' 2
c click fish '[ Quick ]' 2
c click fish 'Voice       ■' 16
c click fish 'Voice       ■' 0
c click fish '[ What agents are told ]' 2
c wait fish 'Voice \(Teach\)' 10
pass 'pressing the pips changes the brief'
c shot fish "$out/03-dials.ansi"
tmux send-keys -t fish Escape
c ask fish 'Which level labels are your Voice and Foresight dials set to now? Answer as "Voice: X, Foresight: Y" only.' 300
screen | grep -q 'Voice: Teach, Foresight: Dive in' || fail 'the agent did not echo the dials'
pass 'the agent echoes the working style it was given'

# Mid-turn: the dials change while the agent's command runs; its answer,
# after the command, must follow the new ones.
c click fish '[ Balanced ]' 2
c type fish 'Run the shell command `sleep 12` and wait for it to finish. Then, with no other tool, answer only "Voice: X, Foresight: Y" with your Voice and Foresight dial level labels as they are now.'
approve_until 'screen | grep -q "sleep 12"' 60
sleep 2
c click fish '[ Autopilot ]' 2
pass 'the dials were changed to Autopilot while the command ran'
c idle fish 300
screen | grep -q 'Voice: Terse, Foresight: Write a spec' || fail 'the agent answered with the dials from before the change'
pass 'changed mid-turn, the dials reached the agent before its next request'

echo '3. Context library'
t0="$(now_ms)"
c type fish '/fishstack context'
c wait fish 'Context the agent reads' 10
pass "the Context tab opens ($(took "$t0"))"
c click fish 'Or paste a link' 0
c type fish "The Workshop API's launch codename is BLUE HERON."
c wait fish '1 of 1 sources on' 10
pass 'a note added in the field is on'
c click fish '[ Strict ]' 2
c wait fish 'Strict' 10
pass 'the note is strict'
c shot fish "$out/04-context.ansi"
tmux send-keys -t fish Escape
c ask fish "What is the Workshop API's launch codename? Answer in two words." 300
screen | grep -qi 'BLUE HERON' || fail 'the agent did not cite the strict note'
pass 'the agent cites the strict note'

echo '5. Autopilot answers when nobody does'
c type fish '/fishstack dials'
c click fish '[ Autopilot ]' 2
tmux send-keys -t fish Escape
c type fish 'Ask me with the AskUserQuestion tool which colour I prefer, with the options "Red (Recommended)" and "Blue". Then reply with only "Picked: <the answer>".'
c wait fish 'Which colou?r' 60
pass 'the agent asked, and nobody answers'
# Nobody presses anything: the answer, when it comes, is Autopilot's.
c wait fish 'Picked: (Red|Blue)' 90
screen | grep -q 'Picked: Red' || fail 'the question was not answered with the recommended option'
pass 'after the wait, Autopilot answered with the recommended option'
quit_claude

echo "4. Claude Code's own worktree (claude --worktree)"
t0="$(now_ms)"
start_claude '--worktree feat-x'
approve_until 'git -C "$app" worktree list | grep -q "/slots/.*\[fish/feat-x\]"' 60
pass "claude --worktree came up in a fishStack slot on fish/feat-x ($(took "$t0"))"
c shot fish "$out/05-claude-worktree.ansi"
quit_claude

echo 'All checks passed.'
