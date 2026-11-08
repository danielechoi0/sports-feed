#!/usr/bin/env bash
# PreToolUse hook for Bash: rewrite a few notoriously verbose commands to
# quieter equivalents before they run. Minimal stand-in for RTK; if you
# install RTK (github.com/rtk-ai/rtk) remove this hook and use theirs.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)"

new="$cmd"
case "$cmd" in
  "git status")                 new="git status --short" ;;
  "git diff")                   new="git diff --stat && git diff | head -300" ;;
  "git log")                    new="git log --oneline -20" ;;
  pytest|"pytest "*)            new="$cmd -q 2>&1 | tail -60" ;;
  "npm test"|"npm run test")    new="$cmd 2>&1 | tail -80" ;;
  "node --test"*)               new="$cmd 2>&1 | tail -80" ;;
  "cargo test"|"cargo build")   new="$cmd 2>&1 | tail -80" ;;
  "ls -la"|"ls -l")             new="ls -1" ;;
esac

if [ "$new" != "$cmd" ]; then
  # Replace the command. Exit 0 with updated JSON on stdout.
  printf '%s' "$input" | python3 -c '
import sys,json
d=json.load(sys.stdin)
d.setdefault("tool_input",{})["command"]=sys.argv[1]
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":d["tool_input"]}}))
' "$new"
fi
exit 0
