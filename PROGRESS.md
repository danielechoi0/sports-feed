# Progress

## Done
- Claude Code setup from cc-scaffold: agents (explore, logreader, reviewer), hooks, python rule, verify skill, CLAUDE.md
- Whales tab on main: lib/whales.js, /api/whales/:sport/:league/:id, public/whales.js, test/whales.test.js; all 44 games on 2026-11-08 matched
- Whales: orders keyed by exact fill timestamp, not by second (second-grouping merged different traders)
- NFL live possession: football marker by the team with the ball + down & distance on live cards and the game modal, pushed with live updates (test/espn.test.js)
- Edges tab: lib/edges.js, /api/edges?date=, public/edges.js, test/edges.test.js; game-winner prices from books (Odds API or ESPN DK), Kalshi, Polymarket -> leave-one-out EV + arbitrage. 2026-11-08: 13 pre-game games priced on 3 venues, best +2.1%

- NBA modal: jersey numbers in the box score (# column) and injury list; rosters and DNP list already had them
- NBA live box score: the five on the floor first (ESPN boxscore `active` flag), falls back to starters unless exactly five are flagged; unverified against a live payload (ESPN blocked in sandbox)
## In progress
-

## Next
- Set ODDS_API_KEY on Vercel to get more books into Edges; then consider spreads/totals (Polymarket and Kalshi both list them)
- After ~1 week: `ccusage daily` and compare `/context` with the baseline
- Watch the Whales tab on Vercel for function timeouts on first load

## Decisions / gotchas (one line each)
- Hooks are registered in project `.claude/settings.json`, not global, so other repos don't call missing scripts.
- `advisorModel` is a top-level key in `~/.claude/settings.json` (the scaffold had it inside `modelSettings`).
- Tests have no npm script: `node --test "test/*.test.js"`; the trim-bash hook tails its output.
- Whales: game-winner markets only; fills grouped by market + taker side + exact timestamp (µs); $500 server floor; 6 pages (6k fills) per market fetch, so the busiest live markets are partial.
- Kalshi's public feed has no account/order id: split orders and big resting (maker) orders can't be identified.
- NFL possession comes from scoreboard `competitions[0].situation`; ESPN drops `possession` between drives and the down goes stale at HALFTIME/END_PERIOD, so both are hidden then.
- `.live-card .foot` needs `margin: 0`: the global page `.foot { margin: 0 auto }` rule also matches it and stops it stretching.
- Edges: ESPN keeps a stale pre-game DraftKings line on live soccer, so ESPN's book is used pre-game only. Live gaps between Kalshi and Polymarket are mostly fetch-timing artifacts (live is off by default).
- Sandbox only: Node fetch ignores HTTPS_PROXY, so run the server with NODE_USE_ENV_PROXY=1 to reach newly allowed hosts (Polymarket).
- Kalshi lists finished games via `status=settled&min_close_ts=`; open/closed lists don't include them.
