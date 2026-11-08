# Progress

## Done
- Claude Code setup from cc-scaffold: agents (explore, logreader, reviewer), hooks, python rule, verify skill, CLAUDE.md
- Whales tab on main: lib/whales.js, /api/whales/:sport/:league/:id, public/whales.js, test/whales.test.js; all 44 games on 2026-11-08 matched
- Whales: orders keyed by exact fill timestamp, not by second (second-grouping merged different traders)

## In progress
-

## Next
- After ~1 week: `ccusage daily` and compare `/context` with the baseline
- Watch the Whales tab on Vercel for function timeouts on first load

## Decisions / gotchas (one line each)
- Hooks are registered in project `.claude/settings.json`, not global, so other repos don't call missing scripts.
- `advisorModel` is a top-level key in `~/.claude/settings.json` (the scaffold had it inside `modelSettings`).
- Tests have no npm script: `node --test "test/*.test.js"`; the trim-bash hook tails its output.
- Whales: game-winner markets only; fills grouped by market + taker side + exact timestamp (µs); $500 server floor; 6 pages (6k fills) per market fetch, so the busiest live markets are partial.
- Kalshi's public feed has no account/order id: split orders and big resting (maker) orders can't be identified.
- Kalshi lists finished games via `status=settled&min_close_ts=`; open/closed lists don't include them.
