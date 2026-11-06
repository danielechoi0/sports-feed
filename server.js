// Sports dashboard server: aggregates ESPN scoreboards + Open-Meteo weather and
// serves the static frontend. Zero dependencies (Node 20+).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOCCER_LEAGUES,
  SPORT_PATH,
  soccerPath,
  fetchJson,
  scoreboard,
  summary,
  normalizeEvent,
  lastFive,
  soccerLineups,
  soccerKeyEvents,
  teamStats,
  nflBoxPlayers,
  injuries,
  nbaBoxLineups,
  teamRoster,
  normalizeRoster,
} from './lib/espn.js';
import { venueWeather } from './lib/weather.js';
import { getRankings, warmRankings } from './lib/nflStats.js';
import { cached, pLimit, cacheStats } from './lib/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ESPN's `dates` parameter is interpreted in US Eastern time.
function todayET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

const LEAGUE_JOBS = [
  { sport: 'nfl', path: SPORT_PATH.nfl, league: { slug: 'nfl', name: 'NFL', short: 'NFL' } },
  { sport: 'nba', path: SPORT_PATH.nba, league: { slug: 'nba', name: 'NBA', short: 'NBA' } },
  ...SOCCER_LEAGUES.map((l) => ({ sport: 'soccer', path: `soccer/${l.slug}`, league: l })),
];

// ESPN's form string is newest-first ("WWLLD" = most recent W). Convert to the
// oldest -> newest shape used by lastFive() so the client has one format.
function formFallback(form) {
  if (!form) return null;
  return [...form].reverse().map((r) => ({ result: r, formOnly: true }));
}

async function enrichGame(g) {
  const jobs = [];
  if (g.sport === 'soccer') {
    jobs.push(
      summary(`soccer/${g.league.slug}`, g.id, 15 * 60_000)
        .then((s) => {
          g.home.last5 = lastFive(s, g.home.id) || formFallback(g.home.form);
          g.away.last5 = lastFive(s, g.away.id) || formFallback(g.away.form);
        })
        .catch(() => {
          g.home.last5 = formFallback(g.home.form);
          g.away.last5 = formFallback(g.away.form);
        }),
    );
  }
  if (g.sport === 'soccer' || g.sport === 'nfl') {
    jobs.push(
      venueWeather(g.venue, g.date).then((w) => {
        if (!w && g.espnWeather && g.venue.indoor !== true) {
          w = { indoor: false, tempF: g.espnWeather.tempF, label: g.espnWeather.label, icon: 'thermo', source: 'ESPN' };
        }
        g.weather = w;
      }),
    );
  }
  await Promise.all(jobs);
  delete g.espnWeather;
  delete g.home.form;
  delete g.away.form;
}

async function buildDay(date) {
  const errors = [];
  const perLeague = await Promise.all(
    LEAGUE_JOBS.map(async (j) => {
      try {
        const sb = await scoreboard(j.path, date);
        return (sb.events || []).map((ev) => normalizeEvent(ev, j.sport, j.league));
      } catch (e) {
        errors.push({ league: j.league.name, message: e.message });
        return [];
      }
    }),
  );
  const games = perLeague.flat();
  const run = pLimit(8);
  await Promise.all(games.map((g) => run(() => enrichGame(g))));
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const day = {
    date,
    generatedAt: new Date().toISOString(),
    nfl: games.filter((g) => g.sport === 'nfl').sort(byDate),
    nba: games.filter((g) => g.sport === 'nba').sort(byDate),
    soccer: games.filter((g) => g.sport === 'soccer').sort(byDate),
    leagues: SOCCER_LEAGUES,
    errors,
  };
  latestDays.set(date, day);
  return day;
}

// ---- live updates --------------------------------------------------------
// Poll ESPN every few seconds, but only for leagues that currently have a game
// in progress (or about to start), diff the live fields, patch the cached day
// in place and push the changes to connected browsers over Server-Sent Events.

const LIVE_FAST_MS = 7_000; // while something is live
const LIVE_IDLE_MS = 30_000; // nothing live: just re-check the schedule
const latestDays = new Map(); // date -> built day (shared reference with the cache)
const sseClients = new Set();
const liveSnapshot = new Map(); // game id -> serialized live fields

function liveFields(g) {
  const team = (t) => ({ score: t.score, winner: t.winner, record: t.record });
  return { id: g.id, sport: g.sport, league: g.league.slug, date: g.date, status: g.status, home: team(g.home), away: team(g.away) };
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function allGames(day) {
  return day ? [...day.nfl, ...day.nba, ...day.soccer] : [];
}

function needsWatching(g, now) {
  if (g.status.state === 'in') return true;
  if (g.status.state !== 'pre') return false;
  const kickoff = new Date(g.date).getTime();
  return kickoff - now < 2 * 60_000; // starts within two minutes, or should have started
}

async function livePoll() {
  const date = todayET();
  let day = latestDays.get(date);
  if (!day) day = await cached(`day:${date}`, 45_000, () => buildDay(date));
  const now = Date.now();
  const watched = new Set();
  for (const g of allGames(day)) if (needsWatching(g, now)) watched.add(g.sport === 'soccer' ? `soccer:${g.league.slug}` : g.sport);
  if (!watched.size) return false;

  const jobs = LEAGUE_JOBS.filter((j) => watched.has(j.sport === 'soccer' ? `soccer:${j.league.slug}` : j.sport));
  const byId = new Map(allGames(day).map((g) => [g.id, g]));
  await Promise.all(
    jobs.map(async (j) => {
      try {
        const sb = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${j.path}/scoreboard?dates=${date}`, 2_000);
        for (const ev of sb.events || []) {
          const fresh = normalizeEvent(ev, j.sport, j.league);
          const fields = liveFields(fresh);
          const key = JSON.stringify(fields);
          if (liveSnapshot.get(fresh.id) === key) continue;
          liveSnapshot.set(fresh.id, key);
          const g = byId.get(fresh.id);
          if (g) {
            g.status = fresh.status;
            for (const side of ['home', 'away']) Object.assign(g[side], fields[side]);
            broadcast('game', fields);
          }
        }
      } catch (e) {
        console.warn(`live poll ${j.league.name} failed: ${e.message}`);
      }
    }),
  );
  return true;
}

function startLiveLoop() {
  const tick = async () => {
    let busy = false;
    try {
      busy = await livePoll();
    } catch (e) {
      console.warn('live loop error:', e.message);
    }
    setTimeout(tick, busy ? LIVE_FAST_MS : LIVE_IDLE_MS).unref();
  };
  tick();
  setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 25_000).unref();
}

function handleSse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ time: new Date().toISOString(), fastMs: LIVE_FAST_MS })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function headerTeams(sum) {
  return (sum?.header?.competitions?.[0]?.competitors || []).map((c) => ({
    id: String(c.team?.id),
    name: c.team?.displayName,
    abbrev: c.team?.abbreviation,
    logo: c.team?.logo || c.team?.logos?.[0]?.href || null,
    homeAway: c.homeAway,
    score: c.score ?? null,
  }));
}

async function soccerDetail(slug, id) {
  const p = soccerPath(slug);
  const s = await summary(p, id, 60_000);
  const lineups = soccerLineups(s);
  const lineupsAvailable = lineups.some((l) => l.starters.length >= 11);
  let previousLineups = null;
  if (!lineupsAvailable) {
    previousLineups = (
      await Promise.all(
        (s.lastFiveGames || []).map(async (t) => {
          const teamId = String(t.team?.id);
          const last = [...(t.events || [])].sort((a, b) => String(b.gameDate).localeCompare(String(a.gameDate)))[0];
          if (!last) return null;
          try {
            const prev = await summary(p, last.id, 6 * 3600_000);
            const mine = soccerLineups(prev).find((l) => String(l.team.id) === teamId);
            if (!mine || !mine.starters.length) return null;
            return {
              ...mine,
              team: { id: teamId, name: t.team?.displayName, logo: t.team?.logo || t.team?.logos?.[0]?.href || null },
              context: {
                opponent: last.opponent?.shortDisplayName || last.opponent?.displayName,
                date: last.gameDate,
                score: last.score,
                result: last.gameResult,
                competition: last.leagueAbbreviation || last.leagueName,
                isHome: String(last.homeTeamId) === teamId,
              },
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
  }
  const teams = headerTeams(s);
  return {
    teams,
    lineupsAvailable,
    lineups: lineupsAvailable ? lineups : [],
    previousLineups,
    keyEvents: soccerKeyEvents(s),
    teamStats: teamStats(s),
    last5: teams.map((t) => ({ teamId: t.id, games: lastFive(s, t.id) })),
  };
}

async function nflDetail(id) {
  const s = await summary(SPORT_PATH.nfl, id, 60_000);
  const teams = headerTeams(s);
  let rankings = null;
  try {
    const rk = await getRankings();
    rankings = {
      meta: { season: rk.season, week: rk.week, games: rk.games, builtAt: rk.builtAt, note: rk.note || null },
      teams: Object.fromEntries(teams.map((t) => [t.id, rk.teams[t.id] || null])),
    };
  } catch (e) {
    rankings = { error: e.message };
  }
  const w = s.gameInfo?.weather;
  return {
    teams,
    injuries: injuries(s),
    rankings,
    players: nflBoxPlayers(s),
    teamStats: teamStats(s),
    espnWeather: w
      ? { tempF: w.temperature ?? null, high: w.highTemperature ?? null, low: w.lowTemperature ?? null, gust: w.gust ?? null, precip: w.precipitation ?? null }
      : null,
  };
}

async function nbaDetail(id) {
  const s = await summary(SPORT_PATH.nba, id, 60_000);
  const teams = headerTeams(s);
  const lineups = nbaBoxLineups(s);
  const inj = injuries(s);
  let rosters = null;
  if (!lineups) {
    rosters = await Promise.all(
      teams.map(async (t) => {
        try {
          const players = normalizeRoster(await teamRoster(SPORT_PATH.nba, t.id));
          const injByName = new Map((inj.find((x) => String(x.team.id) === t.id)?.list || []).map((i) => [i.id, i]));
          for (const p of players) {
            const i = injByName.get(p.id);
            if (i) p.injury = { status: i.status, type: i.type };
          }
          return { team: t, players };
        } catch (e) {
          return { team: t, players: [], error: e.message };
        }
      }),
    );
  }
  return { teams, lineups, rosters, injuries: inj, teamStats: teamStats(s) };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, cache: cacheStats(), todayET: todayET() });
  }
  if (pathname === '/api/day') {
    const date = url.searchParams.get('date') || todayET();
    if (!/^\d{8}$/.test(date)) return sendJson(res, 400, { error: 'date must be YYYYMMDD' });
    const data = await cached(`day:${date}`, 45_000, () => buildDay(date));
    return sendJson(res, 200, data);
  }
  if (pathname === '/api/nfl/rankings') {
    return sendJson(res, 200, await getRankings());
  }
  if (pathname === '/api/live') {
    return handleSse(req, res);
  }
  const m = pathname.match(/^\/api\/game\/(nfl|nba|soccer)\/([a-z0-9.]+)\/(\d+)$/);
  if (m) {
    const [, sport, league, id] = m;
    const ttl = 8_000; // short: lineups, key events and box scores move during a game
    let data;
    if (sport === 'soccer') data = await cached(`detail:soccer:${league}:${id}`, ttl, () => soccerDetail(league, id));
    else if (sport === 'nfl') data = await cached(`detail:nfl:${id}`, ttl, () => nflDetail(id));
    else data = await cached(`detail:nba:${id}`, ttl, () => nbaDetail(id));
    return sendJson(res, 200, data);
  }
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  handle(req, res)
    .catch((e) => {
      console.error(`${req.method} ${req.url} failed:`, e);
      if (!res.headersSent) sendJson(res, 500, { error: e.message || 'internal error' });
      else res.end();
    })
    .finally(() => {
      if (req.url.startsWith('/api/')) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    });
});

server.listen(PORT, () => {
  console.log(`Sports dashboard running at http://localhost:${PORT}`);
  warmRankings();
  startLiveLoop();
});
