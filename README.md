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
  collapsed). Always: each team's league rank for pass/rush offense and
  defense (yards per game from every completed regular-season game), the
  injury report, and weather.
- **NBA** – once tipped: team stats comparison and a full box score per team
  (MIN, PTS, FG, 3PT, FT, REB, AST, STL, BLK, TO, PF, +/-), starters first.
  Before that: both rosters with injury status, plus the injury report.

While a game is live the open modal re-fetches every 10 seconds, so player
stats update in near real time (ESPN's feed itself trails play by 10–30 s).

Use the arrows, the date picker, or the left/right keys to move between days.
Soccer league chips filter the soccer section (the choice is remembered).

## Data sources

- Scores, fixtures, form, lineups, injuries, box scores: ESPN's public site
  API (`site.api.espn.com`). ESPN's `dates` parameter is interpreted in US
  Eastern time, so a "day" is an Eastern-time day; kickoff times are shown in
  your browser's local timezone.
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
lib/cache.js       in-memory TTL cache, disk cache, concurrency limiter
public/            index.html, styles.css, app.js (vanilla JS)
```

API routes: `/api/day?date=YYYYMMDD`, `/api/game/{nfl|nba|soccer}/{league}/{id}`,
`/api/nfl/rankings`, `/api/health`.

## Known limits

- ESPN is an unofficial, undocumented feed; shapes can change without notice.
- NBA projected starters are not published by ESPN before tip-off, so the
  pre-game view is roster plus injury report.
- Soccer form uses each club's last five matches in all competitions, as ESPN
  reports them.
