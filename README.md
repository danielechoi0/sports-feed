# Game Day – sports dashboard

One page showing every game that matters today: NFL, NBA, and soccer from the
Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, Champions League and
Europa League.

## Run

```
npm start
```

Then open http://localhost:3000. No dependencies, no API keys. Node 20+.
`npm run dev` restarts the server on file changes. Set `PORT` to change the port.

## What it shows

**Cards (day view)**

- **Soccer** – home/away tags, each team's last five results as W/D/L chips
  (hover a chip for score, opponent, date and competition), venue, and the
  forecast at kickoff (temperature, rain chance, wind).
- **NFL** – teams, records, spread and broadcast, with a weather panel on the
  side (or "Indoors" for domes).
- **NBA** – teams, records, spread and broadcast.

**Live updates.** The server watches only the leagues with a game in progress
(or starting within two minutes), re-reads ESPN's scoreboard every 7 seconds,
and pushes any score, clock or status change to the page over Server-Sent
Events (`/api/live`). The top bar shows a LIVE badge while the stream is
connected; updated cards flash briefly. An open game modal re-fetches its
details every 10 seconds during a game (and in the hour before kickoff, for
lineups). If the stream drops, the page falls back to polling every 30 seconds
until it reconnects. Latency is bounded by ESPN's own feed, which typically
trails the broadcast by 10 to 30 seconds.

**Click a game**

- **Soccer** – once the match starts: a team comparison (possession, shots,
  on target, corners, fouls, cards, pass accuracy, tackles, saves) and the
  starting XIs as a table with per-player goals, assists, shots, shots on
  target, saves, cards and substitution flags. Pre-game: formation and XI, or
  each team's most recent XI before ESPN publishes lineups (about an hour
  before kickoff). Also key events, a last-five table per team, and weather.
- **NFL** – once the game starts: team stats comparison (yards, first downs,
  third down, turnovers, penalties, possession) and the full box score per
  team (passing, rushing, receiving; defense, kicking, returns and punting
  collapsed). Always: each team's depth chart (offense and defense three
  deep with the projected starter first and injury tags, special teams
  collapsed; from ESPN, so starters can still change at kickoff), each team's league rank for pass/rush offense and
  defense (yards per game from every completed regular-season game), the
  injury report, and weather.
- **NBA** – once tipped: team stats comparison and a full box score per team
  (MIN, PTS, FG, 3PT, FT, REB, AST, STL, BLK, TO, PF, +/-), starters first.
  Before that: both rosters with injury status, plus the injury report.

While a game is live the open modal re-fetches every 10 seconds, so player
stats update in near real time (ESPN's feed itself trails play by 10–30 s).

**Market read (Kalshi, NFL modal).** A plain-English read of how prediction
markets are pricing the game, e.g. "Shootout, contrasting styles: CIN throws,
ATL runs". The server pulls Kalshi's public NFL markets for the game (winner,
spread, total, team totals, team yards, player passing / rushing / receiving
yards, attempts and the scalar yardage ladders), turns each price ladder into an
implied median (the 50% point of the yes-price midpoints, made monotone,
linear between rungs) and compares every line with the current season (ESPN):
each player's line vs his own yards per game played (12%+ and a few yards off =
above/below), the game total and each team's implied points vs the season-based
expectation (team points per game averaged with what the opponent allows; ±3 =
more/less scoring than usual), and each team's pass share of priced yards (QB
line vs the listed rushers' lines) vs the same players' season split (±5 points
= throwing or running more than usual). Spread and win probability use fixed
cut-offs (lopsided at 9.5+ points or 80%, coin flip within 3).
An "at a glance" strip opens the panel: passing yards, rushing yards,
scoring and field goals, each marked more than normal / normal / less than
normal for the game (and per team), where normal is the same players' and
teams' season averages (field goals: made per game, averaged with what the
opponent allows; Kalshi's field-goal ladders are often barely traded, so that
tile only reads when the prices are real). The panel shows the headline, a short narrative, key numbers, per-team pass/run
tilt bars and every player line by position. Missing markets are named rather
than filled in, games without markets say so, and in-play prices are flagged.
It is a hypothesis about what bettors are saying, not advice. Prices are cached
for three minutes; the panel loads separately from the rest of the modal.

Use the arrows, the date picker, or the left/right keys to move between days.
Soccer league chips filter the soccer section (the choice is remembered).

## Data sources

- Scores, fixtures, form, lineups, injuries, box scores: ESPN's public site
  API (`site.api.espn.com`). ESPN's `dates` parameter is interpreted in US
  Eastern time, so a "day" is an Eastern-time day; kickoff times are shown in
  your browser's local timezone.
- Market read: Kalshi's public trade API (`api.elections.kalshi.com`, no key).
  A game's Kalshi events share one suffix, e.g. `KXNFLGAME-26NOV08DALIND`
  (Eastern date, away and home codes); it is matched to the ESPN game by date
  and team codes (ESPN `WSH`/`JAX` are Kalshi `WAS`/`JAC`). Player positions
  come from ESPN team rosters.
- Weather: Open-Meteo forecast at the venue city, hourly, nearest hour to
  kickoff. Venue cities are geocoded once and cached in `.cache/geocode.json`.
- NFL rankings: built from ESPN box scores of completed games. Each completed
  game is cached in `.cache/nfl-games-<season>.json`, so after the first start
  only new games are fetched. Rankings refresh every three hours.

## Layout

```
server.js          HTTP server, /api routes, static files
lib/espn.js        ESPN fetch helpers and normalizers
lib/weather.js     Open-Meteo geocoding + forecast
lib/nflStats.js    NFL offense/defense ranking aggregation
lib/kalshi.js      Kalshi NFL prices -> implied lines + rule-based market read
lib/cache.js       in-memory TTL cache, disk cache, concurrency limiter
public/            index.html, styles.css, app.js (vanilla JS), kalshi.js (market panel)
```

API routes: `/api/day?date=YYYYMMDD`, `/api/game/{nfl|nba|soccer}/{league}/{id}`,
`/api/nfl/rankings`, `/api/nfl/{id}/market` (Kalshi market read), `/api/live` (SSE stream), `/api/live-poll?date=YYYYMMDD`
(live fields of in-progress games, for hosts without streaming), `/api/health`.
`api/index.js` is the Vercel entry point and `vercel.json` the deployment config.

## Deploy to Vercel

The repo is ready to import as-is: `vercel.json` sets the "Other" preset with
`public/` as the static output and routes every `/api/*` request to one
serverless function (`api/index.js`), which reuses the same request handler
as the local server. No build step and no environment variables are needed.

1. Import the GitHub repo in the Vercel dashboard (or run `vercel`).
2. Leave the Build Command empty and the Output Directory as detected.
3. Deploy.

What differs from running locally:

- **Live updates use polling instead of push.** A serverless function cannot
  keep a Server-Sent Events stream open, so `/api/live` answers 404 there and
  the page falls back on its own to `/api/live-poll` every 7 seconds (the LIVE
  badge says "via polling"). You can force this mode locally with `?live=poll`.
- **Cold starts.** Each new function instance starts with an empty memory
  cache. The first request for a day view takes a couple of seconds, and the
  first NFL game detail builds the pass/rush rankings from every completed game
  (a few seconds with an empty cache; `maxDuration` is set to 60 s).
- **Disk cache lives in `/tmp`.** Geocoding results, NFL game extracts and
  other disk caches go to the OS temp dir when the project directory is not
  writable (`lib/cache.js` tries `CACHE_DIR`, then `.cache`, then the temp
  dir). Set `CACHE_DIR` to override the location anywhere.

## Shot simulator

The soccer modal's shot simulator (`/api/soccer/{league}/{id}/shotmodel`,
Monte Carlo in the browser) uses two models:

- **Premier League (`eng.1`): the fitted model** from the pipeline,
  `team_share_ridge`, exported to `models/shot-eng.1.json` by
  `python -m pipeline.export` (fitted on 2023/24–2025/26). On the sealed
  2026/27 test it beat the original model on every score (80% ranges hit 81%
  vs 66%; team-shots NLL 2.58 vs 2.92). The server (`lib/shotModel.js`,
  `lib/teamShareFeatures.js`) builds the features from ESPN: each club's league
  matches this season and last (commentary shot counts, as in the pipeline),
  recency-weighted team shots for/against (last 30) and player shots per 90
  and conversion (last 40 appearances). The browser (`public/teamShare.js`)
  applies the coefficients. Scenario controls map onto the model: current
  minute and minutes left interpolate the checkpoint intercepts (after 75' the
  remaining shots fall linearly to zero at full time); score state sets the
  trailing/leading features (the "late" versions ramp in from 45' to 60'); a
  red card sets man advantage from its minute on; substitutions recompute the
  on-pitch shares from their minute on; tempo stays a plain multiplier. Each
  run draws a team frailty and per-player noise, matched so a team total is
  NB(mu, k_team) and each player NB(lambda, k_player) (`node pipeline/parity.mjs`
  checks this and the JS/Python parity). Approximations: league reference rates
  are fixed at export; a player's matches for a previous club count only if
  that club is one of the two in the match; shots on target are not modelled
  (each player's recent ratio).
- **LaLiga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League:
  the multi-competition fitted model** `team_share_oppadj`, exported to
  `models/shot-pooled.json` by `python -m pipeline.export --pooled` (one fit
  over all seven competitions, 2023/24–2025/26, with a team-shot intercept per
  competition). On the sealed 2026/27 test it beat the original model in every
  competition (80% ranges hit 74–79% vs 55–63%; the model line shows the
  competition's numbers). Same structure as above plus: a club's history is
  its matches in all seven competitions (league and European games, and for a
  cup tie both clubs' domestic leagues); team form is opponent-adjusted (each
  past match's shots divided by that opponent's relative strength at the
  time: its own previous 30 matches against its competition's rate that day);
  and in play, each side's commentary shots so far against its pre-match
  expectation and each player's shots so far against his own, evaluated at
  the live minute and held for the rest of the run. The server
  (`pooledInputs` in `lib/shotModel.js`) lists matches with one scoreboard
  request per competition and year (finished years kept on disk), then fetches
  both clubs' last 80 matches, each recent opponent's 30 before it met them,
  and lineup players' previous clubs' matches (found from the rows fetched and
  ESPN's athlete event log), all reduced to the cached compact extract. A
  competition's first build fetches ~600–1,100 summaries (10–20 s); later
  builds mostly hit the disk cache (1–5 s). `node pipeline/parity-pooled.mjs`
  checks JS against Python (all features to ~1e-15 given the same reference
  rates), the ESPN extract against the pipeline tables (cup extra time and
  shoot-outs included) and the Monte Carlo marginals. Approximations:
  competition rates (today's and the history used for opponent ratings) are
  fixed at export; a player's appearances for a previous club count only for
  that club's matches the build fetched (on 12 recent matches checked against
  the pipeline, 80% of players' shot rates match exactly, 94% within 5%; team
  features match exactly).
- If the fitted model cannot be built, the original hand-set model (last 10
  club matches incl. cups, season totals, position priors) is used.

## Shot model pipeline

`pipeline/` holds the offline data, backtest and improvement loop for the
soccer shot simulator (Python; see `pipeline/README.md`). It downloads every
Premier League match since 2022/23, replays the live simulator and candidate
models on past matches, and scores them; results and the experiment ledger are
in `pipeline/reports/`.

## Known limits

- ESPN is an unofficial, undocumented feed; shapes can change without notice.
- The Kalshi read only sees players Kalshi lists, so rushing totals miss
  unlisted backs; the season split it is compared with uses the same listed
  players to keep it like for like. Season averages are per game played, so a
  backup stepping in as starter looks "above average"; players with fewer than
  2 games have no baseline (a new starting QB falls back to the team's season
  passing average). Kalshi
  rate-limits public reads, so a cold market read takes a few seconds.
- NBA projected starters are not published by ESPN before tip-off, so the
  pre-game view is roster plus injury report.
- Soccer form uses each club's last five matches in all competitions, as ESPN
  reports them.
