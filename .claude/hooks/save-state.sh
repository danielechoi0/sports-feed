#!/usr/bin/env bash
# PreCompact hook: snapshot task state so compaction can't lose it.
# Claude Code passes hook input as JSON on stdin; we don't need it here.
set -euo pipefail

dir="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/state"
mkdir -p "$dir"
f="$dir/pre-compact-$(date +%Y%m%d-%H%M%S).md"

{
  echo "# Pre-compact snapshot $(date -Iseconds)"
  echo
  echo "## git"
  git -C "${CLAUDE_PROJECT_DIR:-.}" status --short 2>/dev/null | head -40 || true
  echo
  echo "## recent commits"
  git -C "${CLAUDE_PROJECT_DIR:-.}" log --oneline -10 2>/dev/null || true
  echo
  echo "## PROGRESS.md (if present)"
  cat "${CLAUDE_PROJECT_DIR:-.}/PROGRESS.md" 2>/dev/null || echo "(none)"
} > "$f"

# Tell Claude where the snapshot is so the compaction summary references it.
echo "State snapshot saved to $f. After compaction, re-read it and PROGRESS.md before continuing."
