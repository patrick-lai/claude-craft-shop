#!/usr/bin/env bash
# Runs hooks/desktop-worktree.sh against a throwaway repository, as Claude
# Code's clients run it (the hook's JSON on stdin, CLAUDE_PROJECT_DIR set),
# and checks each step against the disk and git:
#
#   e2e/desktop-hook.sh
#
# 1. The desktop (empty transcript_path), fishStack on: the offered slot,
#    held, on the session's branch, and only its path printed.
# 2. The desktop with none offered: a new slot.
# 3. remove: the hold goes, the slot stays.
# 4. Another client (a CLI without fishStack, ACP): Claude Code's own
#    worktree, .claude/worktrees/<name> on worktree-<name>, and no slot.
# 5. remove of that worktree removes it.
# 6. fishStack disabled: Claude Code's own worktree for the desktop too, and
#    fishStack's entries out of the settings, the rest kept.
set -euo pipefail

hook="$(cd "$(dirname "$0")/.." && pwd)/hooks/desktop-worktree.sh"
# Its real path: git prints paths with symlinks resolved (/var is
# /private/var on macOS).
work=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$work"' EXIT
repo="$work/repo"
pool="$work/pool"
fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}
run() { CLAUDE_CONFIG_DIR="$work/config" CLAUDE_PROJECT_DIR="$repo" bash "$hook" "$1" 2>"$work/stderr"; }
desktop() { printf '{"session_id":"%s","transcript_path":"","cwd":"%s","hook_event_name":"WorktreeCreate","name":"%s"}\n' "$1" "$repo" "$2"; }
cli() { printf '{"session_id":"%s","transcript_path":"/t/%s.jsonl","cwd":"%s","hook_event_name":"WorktreeCreate","name":"%s"}\n' "$1" "$1" "$repo" "$2"; }

git init -q -b main "$work/origin"
git -C "$work/origin" commit -q --allow-empty -m base
git clone -q "$work/origin" "$repo"
mkdir -p "$pool" "$repo/.git/fishstack" "$repo/.claude" "$work/config"
printf '%s\n' "$pool" >"$repo/.git/fishstack/slots-root"
touch "$repo/.git/fishstack/on"
printf '{ "enabledPlugins": { "fishstack@claude-fish-stack-mod": true } }\n' >"$work/config/settings.json"
command='bash \"$(git -C \"$CLAUDE_PROJECT_DIR\" rev-parse --path-format=absolute --git-common-dir)/fishstack/desktop-worktree.sh\"'
printf '{ "disabledMcpjsonServers": ["x"], "hooks": { "WorktreeCreate": [{ "hooks": [{ "type": "command", "command": "%s create" }] }], "WorktreeRemove": [{ "hooks": [{ "type": "command", "command": "%s remove" }] }], "Stop": [{ "hooks": [{ "type": "command", "command": "true" }] }] } }\n' "$command" "$command" >"$repo/.claude/settings.local.json"
git -C "$repo" worktree add -q --detach "$pool/1" origin/main
touch "$pool/1.ready"

out=$(desktop s-one bold-oak-a3f2 | run create) || fail "create: $(cat "$work/stderr")"
[ "$out" = "$pool/1" ] || fail "create printed [$out], not $pool/1"
[ ! -e "$pool/1.ready" ] || fail "the offer was not taken"
[ "$(cat "$pool/1.held")" = s-one ] || fail "slot 1 is not held for s-one"
[ "$(git -C "$pool/1" rev-parse --abbrev-ref HEAD)" = bold-oak-a3f2 ] || fail "slot 1 is not on bold-oak-a3f2"
echo "ok 1: the desktop gets the offered slot, held, on the session's branch"

out=$(desktop s-two calm-elm-1b2c | run create) || fail "create: $(cat "$work/stderr")"
[ "$out" = "$pool/2" ] || fail "create printed [$out], not $pool/2"
[ -e "$pool/2.held" ] || fail "slot 2 is not held"
[ "$(git -C "$pool/2" rev-parse --abbrev-ref HEAD)" = calm-elm-1b2c ] || fail "slot 2 is not on calm-elm-1b2c"
echo "ok 2: none offered, a new slot"

printf '{"session_id":"s-one","cwd":"%s","worktree_path":"%s"}\n' "$repo" "$pool/1" | run remove || fail "remove: $(cat "$work/stderr")"
[ ! -e "$pool/1.held" ] || fail "slot 1 is still held"
[ -d "$pool/1" ] || fail "slot 1 was deleted"
echo "ok 3: removed, the slot kept for the pool"

touch "$pool/1.ready"
out=$(cli s-three feat-x | run create) || fail "create: $(cat "$work/stderr")"
[ "$out" = "$repo/.claude/worktrees/feat-x" ] || fail "another client got [$out], not Claude Code's own worktree"
[ "$(git -C "$out" rev-parse --abbrev-ref HEAD)" = worktree-feat-x ] || fail "it is not on worktree-feat-x"
[ -e "$pool/1.ready" ] || fail "another client took the offered slot"
echo "ok 4: another client gets Claude Code's own worktree, no slot"

printf '{"session_id":"s-three","cwd":"%s","worktree_path":"%s"}\n' "$repo" "$out" | run remove || fail "remove: $(cat "$work/stderr")"
[ ! -e "$out" ] || fail "Claude Code's own worktree was not removed"
echo "ok 5: its worktree removed as Claude Code would"

printf '{ "enabledPlugins": { "fishstack@claude-fish-stack-mod": false } }\n' >"$work/config/settings.json"
out=$(desktop s-four quiet-fern-9z8y | run create) || fail "create: $(cat "$work/stderr")"
[ "$out" = "$repo/.claude/worktrees/quiet-fern-9z8y" ] || fail "with fishStack disabled the desktop got [$out]"
[ -e "$pool/1.ready" ] || fail "with fishStack disabled a slot was handed out"
grep -q desktop-worktree.sh "$repo/.claude/settings.local.json" && fail "fishStack's entries are still in the settings"
grep -q disabledMcpjsonServers "$repo/.claude/settings.local.json" || fail "the other settings were lost"
grep -q '"Stop"' "$repo/.claude/settings.local.json" || fail "the other hooks were lost"
echo "ok 6: fishStack disabled: Claude Code's own worktree, and its entries out of the settings"
