# Progress

## Done
- Claude Code setup from cc-scaffold: agents (explore, logreader, reviewer), hooks, python rule, verify skill, CLAUDE.md

## In progress
-

## Next
- After ~1 week: `ccusage daily` and compare `/context` with the baseline

## Decisions / gotchas (one line each)
- Hooks are registered in project `.claude/settings.json`, not global, so other repos don't call missing scripts.
- `advisorModel` is a top-level key in `~/.claude/settings.json` (the scaffold had it inside `modelSettings`).
- Tests have no npm script: `node --test "test/*.test.js"`; the trim-bash hook tails its output.
