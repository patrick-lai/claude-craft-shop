#!/bin/bash
# fishStack's WorktreeCreate and WorktreeRemove hook. fishStack keeps this
# copy beside the repository's git data and wires the repository's
# .claude/settings.local.json to it while Use worktrees is on:
#
#   bash "$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)/fishstack/desktop-worktree.sh" create
#
# Every client in the repository reads those settings, so this decides at
# each call who it is for. The desktop app (it sends an empty
# transcript_path) with fishStack enabled and Use worktrees on gets a slot
# from the pool: the one fishStack offered (<slot>.ready), held for the
# session (<slot>.held) until the desktop removes it, on a branch of the
# session's name from origin's default branch. With none offered, a new
# slot: a full checkout, slow. Anyone else (the CLI without fishStack, ACP,
# the SDK) gets the worktree Claude Code makes itself: .claude/worktrees/
# <name> on worktree-<name>. With fishStack disabled or Use worktrees off,
# this also takes its entries out of the settings, so the next worktree is
# Claude Code's own again.
#
# remove: a slot's hold goes and the slot stays in the pool (fishStack saves
# anything left in it under refs/fish/backup/ before another session has it);
# a worktree under .claude/worktrees/ is removed as Claude Code would.
set -uo pipefail

# Only the path goes to the caller: everything else is the hook's log.
exec 3>&1 1>&2

# In a blobless clone (jira, AFM) a checkout needs blobs it lacks; Claude
# Code's GIT_NO_LAZY_FETCH=1 would leave it grinding, so git may fetch them.
export GIT_NO_LAZY_FETCH=0

mode=${1:-}
input=$(cat)
field() { printf '%s' "$input" | sed -n "s/.*\"$1\":\"\([^\"\\\\]*\)\".*/\1/p" | head -n 1; }
die() {
  printf 'fishStack: %s\n' "$1"
  exit 1
}
g() { git -c core.hooksPath=/dev/null "$@"; }

repo=${CLAUDE_PROJECT_DIR:-$(field cwd)}
common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir) || die "$repo is not a git repository."
main=${common%/.git}
root=$(cat "$common/fishstack/slots-root" 2>/dev/null)

# fishStack enabled in the person's settings (installed and on, or loaded
# from a folder through CLAUDE_CODE_PLUGIN_DIRS), and Use worktrees on here.
isOn() {
  local settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
  [ -n "$root" ] && [ -e "$common/fishstack/on" ] || return 1
  [[ ${CLAUDE_CODE_PLUGIN_DIRS:-} == *fishstack* ]] ||
    grep -Eq '"fishstack@[^"]*"[[:space:]]*:[[:space:]]*true|"CLAUDE_CODE_PLUGIN_DIRS"[[:space:]]*:[[:space:]]*"[^"]*fishstack' "$settings" 2>/dev/null
}

# fishStack's entries out of the settings; the rest stays.
unwire() {
  local file="$main/.claude/settings.local.json"
  [ -f "$file" ] || return 0
  python3 -I - "$file" <<'EOF' || true
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
hooks = settings.get("hooks")
if isinstance(hooks, dict):
    for event in ("WorktreeCreate", "WorktreeRemove"):
        groups = [one for one in hooks.get(event, []) if "fishstack/desktop-worktree.sh" not in json.dumps(one)]
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    if not hooks:
        settings.pop("hooks")
    with open(path, "w") as out:
        json.dump(settings, out, indent=2)
        out.write("\n")
EOF
}

# What a new worktree starts from, as Claude Code's "fresh" base: origin's
# default branch, fetched; the local HEAD with no origin to use.
base() {
  local default
  default=$(git -C "$main" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) || {
    printf 'HEAD'
    return
  }
  default=${default#origin/}
  git -C "$main" fetch -q origin "$default" || true
  if git -C "$main" rev-parse -q --verify "origin/$default" >/dev/null; then printf 'origin/%s' "$default"; else printf 'HEAD'; fi
}

# The pool's lock, as fishStack takes it: an atomic mkdir, broken after 30 s.
lock() {
  mkdir -p "$root"
  local tries=0
  until mkdir "$root/.lock" 2>/dev/null; do
    local made
    made=$(stat -f %m "$root/.lock" 2>/dev/null) || continue
    if [ $(($(date +%s) - made)) -gt 30 ]; then
      rm -rf "$root/.lock"
      continue
    fi
    tries=$((tries + 1))
    [ "$tries" -lt 300 ] || die "another session held the worktree lock for too long."
    sleep 0.1
  done
  trap 'rm -rf "$root/.lock"' EXIT
}
unlock() {
  rm -rf "$root/.lock"
  trap - EXIT
}
# Every session's Slots list follows this file.
signal() { date +%s000 >"$root/.changed"; }

# The worktree Claude Code makes when no hook is set.
createPlain() {
  local path="$main/.claude/worktrees/$name"
  g -C "$main" worktree add -q -b "worktree-$name" "$path" "$(base)" || die "could not make a worktree at $path."
  printf '%s\n' "$path" >&3
}

createSlot() {
  lock
  local slot="" isNew=0 ready candidate
  for ready in "$root"/*.ready; do
    [ -e "$ready" ] || continue
    candidate=${ready%.ready}
    rm -f "$ready"
    if [ -d "$candidate" ] && [ ! -e "$candidate.held" ] && [ -z "$(git -C "$candidate" status --porcelain 2>/dev/null)" ]; then
      slot=$candidate
      break
    fi
  done
  if [ -z "$slot" ]; then
    local last=0 dir number
    for dir in "$root"/*/; do
      number=$(basename "$dir")
      [[ $number =~ ^[0-9]+$ ]] && [ "$number" -gt "$last" ] && last=$number
    done
    slot="$root/$((last + 1))"
    mkdir -p "$slot"
    isNew=1
  fi
  printf '%s\n' "$(field session_id)" >"$slot.held"
  signal
  unlock

  local from
  from=$(base)
  if [ "$isNew" = 1 ]; then
    g -C "$main" worktree add -q --detach --no-checkout "$slot" "$from" &&
      g -C "$slot" -c core.checkStat=minimal reset --hard -q ||
      {
        rm -f "$slot.held"
        die "could not make a worktree at $slot."
      }
  fi
  g -C "$slot" checkout -q -B "$name" "$from" || {
    rm -f "$slot.held"
    die "could not check out $name in $slot."
  }
  signal
  printf '%s\n' "$slot" >&3
}

case $mode in
create)
  name=$(field name)
  name=${name//[^A-Za-z0-9._-]/-}
  name=${name:0:40}
  [ -n "$name" ] || die "no worktree name was sent."
  if ! isOn; then
    unwire
    createPlain
  elif [[ $input == *'"transcript_path":""'* ]]; then
    createSlot
  else
    createPlain
  fi
  ;;
remove)
  isOn || unwire
  path=$(field worktree_path)
  [ -n "$path" ] || exit 1
  if [ -n "$root" ] && [ "${path%/*}" = "$root" ]; then
    rm -f "$path.held"
    signal
  elif [[ $path == "$main/.claude/worktrees/"* ]]; then
    g -C "$main" worktree remove "$path"
  else
    exit 1
  fi
  ;;
*)
  die "usage: desktop-worktree.sh create|remove, with the hook's JSON on stdin."
  ;;
esac
