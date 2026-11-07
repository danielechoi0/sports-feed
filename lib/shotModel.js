// Player-level shot model inputs for the soccer shot simulator.
//
// For one match it gathers: the current (or most recent) lineups and live
// state, each club's last 10 completed matches (per-player shots, on target,
// goals and minutes from ESPN box scores), each player's league season totals
// (ESPN core athlete statistics), and opponent defensive strength (shots faced
// per game from ESPN core team statistics). It turns those into per-player
// rates per 90 (form-weighted, opponent-adjusted, shrunk toward a position
// prior) and team-level factors. The browser runs the Monte Carlo itself.
// Those are the original hand-set model's inputs; the fitted models' inputs
// (Premier League: teamShareInputs; every other competition: pooledInputs,
// the multi-competition model) are built alongside and sent as `model` and
// each team's and player's `ts`.
import { fetchJson, summary, soccerLineups, soccerKeyEvents, teamStats, lastFive } from './espn.js';
import { cached, readDisk, writeDisk, pLimit } from './cache.js';
import { readFileSync } from 'node:fs';
import { extractModelMatch, teamRates, playerRate, resolvePosition, posGroupTS, rawRelative, oppAdjRates, competitionRateAt, liveShots, EXTRACT_VERSION } from './teamShareFeatures.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
const HISTORY_MATCHES = 10;
const HALF_LIFE = 3; // matches
const SHRINK_MIN = 270; // minutes of evidence that count as much as the prior
const LEAGUE_AVG_SHOTS_FALLBACK = 12.5;

// Fitted models (pipeline/export.py), by league. Leagues without one keep the
// hand-set model below.
const FITTED = {};
for (const slug of ['eng.1']) {
  try {
    FITTED[slug] = JSON.parse(readFileSync(new URL(`../models/shot-${slug}.json`, import.meta.url), 'utf8'));
  } catch (e) {
    console.warn(`fitted shot model for ${slug} not loaded: ${e.message}`);
  }
}
// The multi-competition model (team_share_oppadj, models/shot-pooled.json):
// one fit over all seven competitions, used for the ones without their own
// file (all but the Premier League).
let POOLED = null;
try {
  POOLED = JSON.parse(readFileSync(new URL('../models/shot-pooled.json', import.meta.url), 'utf8'));
} catch (e) {
  console.warn(`pooled shot model not loaded: ${e.message}`);
}
const usesPooled = (slug) => !FITTED[slug] && !!POOLED?.serves?.includes(slug);

// Position priors: shots per 90, share on target, conversion per shot.
const PRIORS = {
  G: { shots: 0.0, sot: 0.3, conv: 0.05 },
  D: { shots: 0.4, sot: 0.33, conv: 0.08 },
  M: { shots: 0.9, sot: 0.33, conv: 0.09 },
  AM: { shots: 1.6, sot: 0.36, conv: 0.11 },
  F: { shots: 2.3, sot: 0.38, conv: 0.14 },
};

export function posGroup(abbr) {
  const a = String(abbr || '').toUpperCase();
  if (a === 'G' || a === 'GK') return 'G';
  if (/^(CD|LB|RB|LWB|RWB|D|CB|SW)/.test(a)) return 'D';
  if (/^(AM|LW|RW|W|LAM|RAM)/.test(a)) return 'AM';
  if (/^(F|CF|ST|SS|LF|RF)/.test(a)) return 'F';
  if (/^(CM|DM|M|LM|RM|CDM)/.test(a)) return 'M';
  return 'M';
}

function clockMinute(txt) {
  const m = String(txt || '').match(/(\d+)'?/);
  if (!m) return null;
  const extra = String(txt).match(/\+(\d+)/);
  return Number(m[1]) + (extra ? 0 : 0); // added time counts as the base minute
}

function parseMinute(sum) {
  const st = sum?.header?.competitions?.[0]?.status || {};
  const state = st.type?.state || 'pre';
  if (state === 'pre') return { state, minute: 0, clock: null, period: 0 };
  if (state === 'post') return { state, minute: 90, clock: st.type?.shortDetail || 'FT', period: st.period ?? 2 };
  const detail = st.type?.shortDetail || '';
  const clock = st.displayClock || detail;
  if (/HT|half/i.test(detail) && !/\d/.test(detail)) return { state, minute: 45, clock: 'HT', period: 1 };
  let minute = clockMinute(clock);
  if (minute == null) minute = st.period === 2 ? 70 : 25;
  return { state, minute: Math.min(minute, 90), clock, period: st.period ?? null };
}

// Minutes played from a roster entry's plays (substitution / red-card clocks).
function playerMinutes(p) {
  const plays = p.plays || [];
  const subs = plays.filter((x) => x.substitution).map((x) => clockMinute(x.clock?.displayValue)).filter((m) => m != null);
  const reds = plays.filter((x) => x.redCard).map((x) => clockMinute(x.clock?.displayValue)).filter((m) => m != null);
  let start = p.starter ? 0 : null;
  let end = 90;
  if (p.starter) {
    if (p.subbedOut) end = subs.length ? subs[0] : 70;
  } else if (p.subbedIn) {
    start = subs.length ? subs[0] : 65;
    if (p.subbedOut) end = subs.length > 1 ? subs[1] : Math.min(90, start + 20);
  }
  if (reds.length) end = Math.min(end, reds[0]);
  if (start == null) return { start: null, end: null, minutes: 0, red: reds[0] ?? null };
  return { start, end, minutes: Math.max(0, end - start), red: reds[0] ?? null };
}

function statOf(p, name) {
  const s = (p.stats || []).find((x) => x.name === name);
  return Number(s?.value ?? s?.displayValue ?? 0) || 0;
}

// Compact, cacheable extract of a completed match.
export function extractMatch(sum) {
  const comp = sum?.header?.competitions?.[0];
  if (!comp) return null;
  const teams = (comp.competitors || []).map((c) => ({
    id: String(c.team?.id),
    name: c.team?.displayName,
    abbrev: c.team?.abbreviation,
    homeAway: c.homeAway,
    goals: Number(c.score ?? 0) || 0,
  }));
  const ts = teamStats(sum);
  for (const t of teams) {
    const s = ts.find((x) => String(x.team.id) === t.id)?.stats || {};
    t.shots = Number(s.totalShots ?? 0) || 0;
    t.sot = Number(s.shotsOnTarget ?? 0) || 0;
    t.saves = Number(s.saves ?? 0) || 0;
    t.possession = Number(s.possessionPct ?? 0) || null;
  }
  const players = [];
  for (const r of sum.rosters || []) {
    const teamId = String(r.team?.id);
    for (const p of r.roster || []) {
      const mins = playerMinutes(p);
      if (mins.minutes <= 0) continue;
      players.push({
        id: String(p.athlete?.id),
        name: p.athlete?.displayName,
        pos: p.position?.abbreviation || null,
        teamId,
        starter: !!p.starter,
        minutes: mins.minutes,
        shots: statOf(p, 'totalShots'),
        sot: statOf(p, 'shotsOnTarget'),
        goals: statOf(p, 'totalGoals'),
        saves: statOf(p, 'saves'),
        conceded: statOf(p, 'goalsConceded'),
      });
    }
  }
  return {
    id: String(sum.header?.id || comp.id),
    date: comp.date,
    competition: sum.header?.league?.name || null,
    teams,
    players,
  };
}

let gameStore = null;
let storeDirty = false;
let flushTimer = null;
async function loadStore() {
  if (!gameStore) gameStore = await readDisk('soccer-games.json', {});
  return gameStore;
}
function scheduleFlush() {
  storeDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!storeDirty) return;
    storeDirty = false;
    try {
      await writeDisk('soccer-games.json', gameStore);
    } catch (e) {
      console.warn('soccer-games cache write failed', e.message);
    }
  }, 1500);
}

async function matchExtract(slug, eventId, meta) {
  const store = await loadStore();
  if (store[eventId]) {
    meta.cacheHits++;
    return store[eventId];
  }
  const sum = await summary(`soccer/${slug}`, eventId, 24 * 3600_000);
  const ex = extractMatch(sum);
  if (!ex || !ex.players.length) return null;
  const completed = sum.header?.competitions?.[0]?.status?.type?.completed;
  if (completed) {
    store[eventId] = ex;
    scheduleFlush();
  }
  meta.matchesFetched++;
  return ex;
}

// Candidate completed matches for a team: league schedule + lastFiveGames (cups, Europe).
async function recentMatchIds(slug, teamId, sum, excludeId) {
  const byId = new Map();
  try {
    const sched = await fetchJson(`${SITE}/soccer/${slug}/teams/${teamId}/schedule`, 3 * 3600_000);
    for (const ev of sched.events || []) {
      const st = ev.competitions?.[0]?.status?.type;
      if (st?.completed || st?.state === 'post') byId.set(String(ev.id), ev.date);
    }
  } catch (e) {
    console.warn(`schedule for team ${teamId} failed: ${e.message}`);
  }
  for (const g of lastFive(sum, teamId) || []) byId.set(String(g.id), g.date);
  byId.delete(String(excludeId));
  return [...byId.entries()]
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, HISTORY_MATCHES)
    .map(([id]) => id);
}

async function athleteSeason(slug, year, athleteId) {
  const url = `${CORE}/${slug}/seasons/${year}/types/1/athletes/${athleteId}/statistics`;
  return cached(`ath:${url}`, 6 * 3600_000, async () => {
    try {
      const j = await fetchJson(url, 6 * 3600_000);
      const out = {};
      for (const c of j.splits?.categories || []) for (const s of c.stats || []) out[s.name] = Number(s.value) || 0;
      return {
        minutes: out.minutes || 0,
        appearances: out.appearances || 0,
        starts: out.starts || 0,
        shots: out.totalShots || 0,
        sot: out.shotsOnTarget || 0,
        goals: out.totalGoals || 0,
        saves: out.saves || 0,
        conceded: out.goalsConceded || 0,
      };
    } catch {
      return null;
    }
  });
}

// Bench players are listed as "SUB"; recover a real position from history or the athlete record.
async function athletePosition(slug, year, athleteId, history) {
  const counts = new Map();
  for (const h of history) if (h.pos && h.pos !== 'SUB') counts.set(h.pos, (counts.get(h.pos) || 0) + 1);
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const url = `${CORE}/${slug}/seasons/${year}/athletes/${athleteId}`;
  return cached(`athpos:${url}`, 24 * 3600_000, async () => {
    try {
      const j = await fetchJson(url, 24 * 3600_000);
      return j.position?.abbreviation || null;
    } catch {
      return null;
    }
  });
}

// Opponent defensive strength: shots faced per game in the league this season.
async function teamShotsFaced(slug, year, teamId, gamesPlayed) {
  const url = `${CORE}/${slug}/seasons/${year}/types/1/teams/${teamId}/statistics`;
  return cached(`teamdef:${url}`, 6 * 3600_000, async () => {
    try {
      const j = await fetchJson(url, 6 * 3600_000);
      let faced = null;
      let shots = null;
      for (const c of j.splits?.categories || []) {
        for (const s of c.stats || []) {
          if (s.name === 'shotsFaced') faced = Number(s.value) || 0;
          if (s.name === 'totalShots') shots = Number(s.value) || 0;
        }
      }
      if (faced == null || !gamesPlayed) return null;
      return { facedPerGame: faced / gamesPlayed, shotsPerGame: shots != null ? shots / gamesPlayed : null, games: gamesPlayed };
    } catch {
      return null;
    }
  });
}

async function leagueGamesPlayed(slug) {
  return cached(`gp:${slug}`, 3 * 3600_000, async () => {
    try {
      const j = await fetchJson(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`, 3 * 3600_000);
      const entries = (j.children || []).flatMap((c) => c.standings?.entries || []).concat(j.standings?.entries || []);
      const gp = {};
      for (const e of entries) {
        const g = e.stats?.find((s) => s.name === 'gamesPlayed')?.value;
        if (e.team?.id && g) gp[String(e.team.id)] = Number(g);
      }
      return gp;
    } catch {
      return {};
    }
  });
}

function weightedRate(samples, key) {
  // samples: [{idx, minutes, value, adj}] idx 0 = most recent
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const w = Math.pow(0.5, s.idx / HALF_LIFE);
    num += w * s[key] * (s.adj || 1);
    den += w * s.minutes;
  }
  return den > 0 ? (num / den) * 90 : null;
}

function shrink(rate, minutes, prior) {
  if (rate == null || !minutes) return prior;
  return (rate * minutes + prior * SHRINK_MIN) / (minutes + SHRINK_MIN);
}

function round(x, d = 3) {
  return x == null ? null : Number(Number(x).toFixed(d));
}

function buildPlayerRates(p, history, season, group) {
  const prior = PRIORS[group] || PRIORS.M;
  const samples = history.map((h) => ({ idx: h.idx, minutes: h.minutes, shots: h.shots, sot: h.sot, goals: h.goals, adj: h.adj }));
  const formMin = samples.reduce((a, s) => a + s.minutes, 0);
  const form90 = weightedRate(samples, 'shots');
  const formSot90 = weightedRate(samples, 'sot');
  const formGoals90 = weightedRate(samples, 'goals');
  const seasonMin = season?.minutes || 0;
  const season90 = seasonMin > 0 ? (season.shots / seasonMin) * 90 : null;
  const seasonSot90 = seasonMin > 0 ? (season.sot / seasonMin) * 90 : null;
  const seasonGoals90 = seasonMin > 0 ? (season.goals / seasonMin) * 90 : null;

  const formAdj = shrink(form90, formMin, prior.shots);
  const seasonAdj = shrink(season90, seasonMin, prior.shots);
  let shots;
  if (form90 != null && season90 != null) shots = 0.5 * formAdj + 0.35 * seasonAdj + 0.15 * prior.shots;
  else if (form90 != null) shots = 0.8 * formAdj + 0.2 * prior.shots;
  else if (season90 != null) shots = 0.8 * seasonAdj + 0.2 * prior.shots;
  else shots = prior.shots;

  const totShots = samples.reduce((a, s) => a + s.shots, 0) + (season?.shots || 0);
  const totSot = samples.reduce((a, s) => a + s.sot, 0) + (season?.sot || 0);
  const totGoals = samples.reduce((a, s) => a + s.goals, 0) + (season?.goals || 0);
  const sotRatio = (totSot + prior.sot * 4) / (totShots + 4);
  const conv = (totGoals + prior.conv * 6) / (totShots + 6);
  const baseline = season90 ?? prior.shots;
  const formIndex = form90 != null && baseline > 0.15 ? form90 / baseline : form90 != null && form90 > 0 ? 1.5 : 1;

  return {
    shots: round(shots),
    sotRatio: round(Math.min(0.8, sotRatio)),
    conv: round(Math.min(0.5, conv)),
    components: {
      form90: round(form90),
      formSot90: round(formSot90),
      formGoals90: round(formGoals90),
      formMinutes: formMin,
      formMatches: samples.length,
      season90: round(season90),
      seasonSot90: round(seasonSot90),
      seasonGoals90: round(seasonGoals90),
      seasonMinutes: seasonMin,
      seasonApps: season?.appearances || 0,
      seasonShots: season?.shots || 0,
      seasonGoals: season?.goals || 0,
      prior: prior.shots,
    },
    formIndex: round(Math.min(3, Math.max(0.2, formIndex)), 2),
  };
}

function keeperRate(p, history, season) {
  const saves = history.reduce((a, h) => a + h.saves, 0) + (season?.saves || 0);
  const conceded = history.reduce((a, h) => a + h.conceded, 0) + (season?.conceded || 0);
  const faced = saves + conceded;
  return { saveRate: round((saves + 0.7 * 8) / (faced + 8)), saves, conceded, sample: faced };
}

function lineupMinutes(p) {
  const subs = (p.plays || []).filter((x) => x.substitution).map((x) => clockMinute(x.clock?.displayValue)).filter((m) => m != null);
  const reds = (p.plays || []).filter((x) => x.redCard).map((x) => clockMinute(x.clock?.displayValue)).filter((m) => m != null);
  return {
    subInMin: !p.starter && p.subbedIn ? subs[0] ?? null : null,
    subOutMin: p.subbedOut ? (p.starter ? subs[0] ?? null : subs[1] ?? subs[0] ?? null) : null,
    redMin: reds[0] ?? null,
  };
}

function shapeFromFormation(formation) {
  const parts = String(formation || '').split('-').map(Number).filter((n) => n > 0);
  if (!parts.length) return { defenders: 4, factor: 1 };
  const defenders = parts[0];
  return { defenders, factor: defenders >= 5 ? 0.93 : defenders <= 3 ? 1.03 : 1 };
}

// ---- fitted team-share model inputs (leagues in FITTED) ----
// History is this league's matches only, as in the pipeline: each club's
// league schedule for this season and the previous one (about 40-50 matches,
// enough for the 30-match team window). Completed matches are reduced to a
// compact extract (commentary shot counts, player minutes/shots/goals) and
// kept on disk.
let modelStore = null;
let modelDirty = false;
let modelTimer = null;
async function loadModelStore() {
  if (!modelStore) modelStore = await readDisk('soccer-model-games.json', {});
  return modelStore;
}
function flushModelStore() {
  modelDirty = true;
  if (modelTimer) return;
  modelTimer = setTimeout(async () => {
    modelTimer = null;
    if (!modelDirty) return;
    modelDirty = false;
    try {
      await writeDisk('soccer-model-games.json', modelStore);
    } catch (e) {
      console.warn('soccer-model-games cache write failed', e.message);
    }
  }, 1500);
}

async function modelExtract(slug, eventId, meta) {
  const store = await loadModelStore();
  if (store[eventId]?.v === EXTRACT_VERSION) {
    meta.cacheHits++;
    return store[eventId];
  }
  return cached(`modelx:${eventId}`, 24 * 3600_000, async () => {
    // Fetched directly (not through the summary cache) so only the compact extract stays in memory.
    const url = `${SITE}/soccer/${slug}/summary?event=${eventId}`;
    let res = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null);
    if (!res?.ok) res = await fetch(url, { headers: { accept: 'application/json' } }); // one retry
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const sum = await res.json();
    meta.matchesFetched++;
    const ex = extractModelMatch(sum);
    if (ex && sum.header?.competitions?.[0]?.status?.type?.completed) {
      store[eventId] = ex;
      flushModelStore();
    }
    return ex;
  });
}

async function leagueScheduleIds(slug, teamId, season, before) {
  try {
    const sched = await fetchJson(`${SITE}/soccer/${slug}/teams/${teamId}/schedule?season=${season}`, 3 * 3600_000);
    return (sched.events || [])
      .filter((ev) => {
        const st = ev.competitions?.[0]?.status?.type;
        return (st?.completed || st?.state === 'post') && String(ev.date) < before;
      })
      .map((ev) => ({ id: String(ev.id), date: ev.date }));
  } catch (e) {
    console.warn(`schedule ${season} for team ${teamId} failed: ${e.message}`);
    return [];
  }
}

async function teamShareInputs(slug, year, competitors, kickoff, meta, run) {
  const model = FITTED[slug];
  const cfg = model.recency;
  const ref = model.league_ref;
  const games = new Map(); // eventId -> extract
  const perTeam = {};
  await Promise.all(
    competitors.map(async (t) => {
      const lists = await Promise.all([year, year - 1].map((s) => leagueScheduleIds(slug, t.id, s, kickoff)));
      const ids = [...new Map(lists.flat().map((x) => [x.id, x])).values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const exs = await Promise.all(ids.map((x) => run(() => modelExtract(slug, x.id, meta).catch(() => null))));
      perTeam[t.id] = exs.filter((ex) => ex && ex.ok && (!ex.league || ex.league === slug) && String(ex.date) < kickoff);
      for (const ex of perTeam[t.id]) games.set(ex.id, ex);
    }),
  );
  const recent = [...games.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const rowsByPlayer = new Map();
  for (const g of recent) for (const a of g.apps) {
    if (!rowsByPlayer.has(a.id)) rowsByPlayer.set(a.id, []);
    rowsByPlayer.get(a.id).push(a);
  }
  const teams = {};
  for (const t of competitors) {
    const own = perTeam[t.id].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    teams[t.id] = teamRates(own, t.id, cfg, ref.rate);
  }
  const player = (id, pos) => {
    const rows = rowsByPlayer.get(String(id)) || [];
    const resolved = resolvePosition(pos ?? null, rows, cfg.position_history_n);
    const group = posGroupTS(resolved);
    const r = playerRate(rows, group, cfg, ref);
    return { group, pos: resolved === 'NAN' ? null : resolved, r90: round(r.r90, 4), pconv: round(r.pconv, 4), apps: r.apps, minutes: r.minutes, shots: r.shots, goals: r.goals };
  };
  return { model, teams, player, matches: games.size };
}

// ---- multi-competition model inputs (team_share_oppadj; every competition but eng.1) ----
// As pipeline/models/pooled.py, a club's history is its matches in all seven
// competitions (league and European games feed one form), and its form is
// opponent-adjusted: each past match's shots are divided by that opponent's
// strength at the time (the opponent's own previous 30 matches, relative to
// its competition's rate that day). So the build needs, for both clubs, their
// last matches in every competition, and for each opponent in their last 30,
// the opponent's 30 matches before that game.
//
// Match lists come from one scoreboard request per competition and calendar
// year (as pipeline/crawl.py; finished years are kept on disk for good, the
// current one for 30 minutes), loaded newest first and further back only when
// a club needs more matches (seasons from 2022/23, like the pipeline).
// Completed matches are reduced to the same compact extract as above and kept
// on disk, so a competition's first build fetches a few hundred summaries and
// later ones mostly hit the cache.
const POOLED_FIRST_SEASON = 2022;
const POOLED_FIRST_YEAR = 2022;
const POOLED_PLAYER_GAMES = 80; // each club's last 80 matches (all competitions) feed the player features
const extractLimit = pLimit(12); // concurrent summary fetches across requests

let indexStore = null;
let indexTimer = null;
async function loadIndexStore() {
  if (!indexStore) indexStore = await readDisk('soccer-model-index.json', {});
  return indexStore;
}
function flushIndexStore() {
  if (indexTimer) return;
  indexTimer = setTimeout(async () => {
    indexTimer = null;
    await writeDisk('soccer-model-index.json', indexStore);
  }, 1500);
}

// Completed matches of one competition in one calendar year: [{id, date, lg, h, a}].
async function competitionYear(lg, year, meta) {
  const thisYear = new Date().getUTCFullYear();
  const key = `${lg}:${year}`;
  const store = await loadIndexStore();
  if (year < thisYear && store[key]) return store[key];
  return cached(`mindex:${key}`, year < thisYear ? 24 * 3600_000 : 30 * 60_000, async () => {
    const res = await fetch(`${SITE}/soccer/${lg}/scoreboard?dates=${year}&limit=1000`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${lg} ${year}`);
    const j = await res.json();
    meta.indexFetched = (meta.indexFetched || 0) + 1;
    const events = (j.events || [])
      .filter((e) => e.status?.type?.completed && (e.season?.year ?? 0) >= POOLED_FIRST_SEASON)
      .map((e) => {
        const cs = e.competitions?.[0]?.competitors || [];
        return { id: String(e.id), date: e.date, lg, h: String(cs.find((c) => c.homeAway === 'home')?.team?.id), a: String(cs.find((c) => c.homeAway === 'away')?.team?.id) };
      });
    if (year < thisYear) {
      store[key] = events;
      flushIndexStore();
    }
    return events;
  });
}

// Per-request view of the match index and the extracts it fetched.
function pooledContext(meta) {
  const leagues = POOLED.leagues;
  const byTeam = new Map(); // teamId -> [entry] ascending by date
  let oldest = new Date().getUTCFullYear() + 1; // oldest calendar year loaded
  let loading = null;
  const addYear = async (year) => {
    const lists = await Promise.all(leagues.map((lg) => competitionYear(lg, year, meta).catch((e) => (console.warn(`match index ${lg} ${year}: ${e.message}`), []))));
    for (const e of lists.flat()) for (const tid of [e.h, e.a]) {
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid).push(e);
    }
    for (const arr of byTeam.values()) arr.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    oldest = year;
  };
  const loadOlder = async () => {
    if (oldest <= POOLED_FIRST_YEAR) return false;
    loading ||= addYear(oldest - 1).finally(() => (loading = null));
    await loading;
    return true;
  };
  const extracts = new Map(); // eventId -> Promise<extract|null>
  const extract = (e) => {
    if (!extracts.has(e.id))
      extracts.set(
        e.id,
        extractLimit(() => modelExtract(e.lg, e.id, meta))
          .then((ex) => (ex ? { ...ex, league: e.lg } : null))
          .catch((err) => {
            meta.extractErrors = (meta.extractErrors || 0) + 1;
            console.warn(`model extract ${e.lg} ${e.id}: ${err.message}`);
            return null;
          }),
      );
    return extracts.get(e.id);
  };
  // A club's last n matches before `date` that pass the data check (History.team_recent), most recent first.
  const memo = new Map();
  const lastOk = (teamId, date, n) => {
    const key = `${teamId}|${date}|${n}`;
    if (!memo.has(key))
      memo.set(
        key,
        (async () => {
          const out = [];
          let cursor = date;
          for (;;) {
            const scanned = oldest; // years loaded when this scan started (others may load more meanwhile)
            const cands = (byTeam.get(teamId) || []).filter((e) => e.date < cursor).reverse();
            for (let i = 0; i < cands.length && out.length < n; ) {
              const chunk = cands.slice(i, i + (n - out.length) + 2);
              i += chunk.length;
              for (const ex of await Promise.all(chunk.map(extract))) if (ex?.ok && out.length < n) out.push(ex);
            }
            if (out.length >= n) break;
            if (cands.length) cursor = cands[cands.length - 1].date;
            if (oldest < scanned) continue; // older years arrived during the scan: look at them first
            if (!(await loadOlder())) break;
          }
          return out;
        })(),
      );
    return memo.get(key);
  };
  return {
    init: async () => {
      const y = new Date().getUTCFullYear();
      await addYear(y);
      await addYear(y - 1);
    },
    lastOk,
    extracts,
  };
}

async function pooledInputs(slug, competitors, kickoff, meta, sum) {
  const t0 = Date.now();
  const model = POOLED;
  const cfg = model.recency;
  const ref = model.league_ref[slug];
  const rate = ref.rate;
  const ctx = pooledContext(meta);
  await ctx.init();
  const own = {};
  await Promise.all(competitors.map(async (t) => (own[t.id] = await ctx.lastOk(t.id, kickoff, Math.max(cfg.team_n, POOLED_PLAYER_GAMES)))));
  // Opponent strength at each past match: its previous 30 matches, relative to its competition's rate that day.
  const rel = new Map();
  await Promise.all(
    competitors.flatMap((t) =>
      own[t.id].slice(0, cfg.team_n).map(async (g) => {
        const o = g.teams.find((x) => x.id !== t.id).id;
        const key = `${o}|${g.date}`;
        if (rel.has(key)) return;
        rel.set(key, null);
        const games = await ctx.lastOk(o, g.date, cfg.team_n);
        rel.set(key, rawRelative(games, o, cfg, competitionRateAt(model, g.league, g.date)));
      }),
    ),
  );
  const teams = {};
  for (const t of competitors) {
    teams[t.id] = oppAdjRates(own[t.id], t.id, cfg, rate, (g, o) => rel.get(`${o}|${g.date}`));
    teams[t.id].games = own[t.id].length;  }
  // Player rows (History.player_recent): every appearance in the matches this
  // build fetched, i.e. both clubs' last 80 and the opponents' windows, plus,
  // for players who came from another club in these competitions, that club's
  // matches before he joined (preparePlayers below).
  let rowsByPlayer = new Map();
  const rebuildRows = async () => {
    const all = (await Promise.all([...ctx.extracts.values()])).filter((ex) => ex?.ok && String(ex.date) < kickoff);
    all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    rowsByPlayer = new Map();
    for (const g of all)
      for (const a of g.apps) {
        if (!rowsByPlayer.has(a.id)) rowsByPlayer.set(a.id, []);
        rowsByPlayer.get(a.id).push({ ...a, date: g.date });
      }
  };
  // Previous clubs: from the rows already fetched and from ESPN's athlete event
  // log (his last 20 matches in any competition, with the team he played for).
  // For each previous club in these competitions, fetch its matches before he
  // joined, as many as his last 40 appearances still need. Two rounds, so a
  // club found in the first can lead to the one before it.
  const clubsIndexed = new Set(competitors.map((t) => t.id));
  const preparePlayers = async (list) => {
    const t1 = Date.now();
    const logs = new Map();
    await Promise.all(list.map(({ id }) => extractLimit(async () => logs.set(id, await athleteEventLog(slug, id)))));
    const ownStart = Object.fromEntries(competitors.map((t) => [t.id, own[t.id].length >= POOLED_PLAYER_GAMES ? own[t.id][own[t.id].length - 1].date : null]));
    for (let round = 0; round < 3; round++) {
      await rebuildRows();
      const jobs = [];
      for (const { id, teamId } of list) {
        const rows = rowsByPlayer.get(String(id)) || [];
        if (rows.length >= cfg.player_n && !rows.slice(0, cfg.player_n).some((r) => r.teamId !== teamId)) continue; // last 40 all with this club: complete
        const atClub = rows.filter((r) => r.teamId === teamId);
        const joined = atClub.length ? atClub[atClub.length - 1].date : kickoff;
        const need = cfg.player_n - rows.filter((r) => r.date >= joined).length;
        if (need <= 0) continue;
        // Still at this club when its fetched matches start: fetch its matches before that too.
        if (ownStart[teamId] && joined <= ownStart[teamId]) jobs.push(ctx.lastOk(teamId, joined, need + 2));
        const clubs = new Set([...rows.map((r) => r.teamId), ...(logs.get(id) || [])]);
        clubs.delete(teamId);
        for (const z of clubs) {
          clubsIndexed.add(z);
          // the club's matches before he joined this one (a direct move) and before his latest known match for it
          jobs.push(ctx.lastOk(z, joined, need + 2));
          const atZ = rows.filter((r) => r.teamId === z);
          if (atZ.length) jobs.push(ctx.lastOk(z, `${atZ[0].date}~`, need + 2));
        }
      }
      if (!jobs.length) break;
      await Promise.all(jobs);
    }
    await rebuildRows();
    meta.playerPrepMs = Date.now() - t1;
    meta.previousClubs = clubsIndexed.size - competitors.length;
  };
  // In-play: commentary shots so far (regulation time) per team and player, and each player's minute on.
  const live = liveShots(sum);
  const reg = live.shots.filter((s) => s.period == null || s.period <= 2);
  for (const t of competitors) teams[t.id].sf = reg.filter((s) => s.teamId === t.id).length;
  const player = (id, pos) => {
    const rows = rowsByPlayer.get(String(id)) || [];
    const resolved = resolvePosition(pos ?? null, rows, cfg.position_history_n);
    const group = posGroupTS(resolved);
    const r = playerRate(rows, group, cfg, ref);
    return {
      group,
      pos: resolved === 'NAN' ? null : resolved,
      r90: round(r.r90, 4),
      pconv: round(r.pconv, 4),
      apps: r.apps,
      minutes: r.minutes,
      shots: r.shots,
      goals: r.goals,
      sf: reg.filter((s) => s.playerId === String(id)).length,
      onMin: live.onMin[String(id)] ?? null,
    };
  };
  const { rate_history: _rh, league_ref: _lr, backtest, ...rest } = model;
  const bt = backtest.by_league[slug] || {};
  const view = {
    ...rest,
    league: slug,
    league_ref: ref,
    backtest: { split: backtest.split, season: backtest.season, source: backtest.source, ...bt },
  };
  await rebuildRows();
  meta.modelBuildMs = Date.now() - t0;
  return {
    model: view,
    teams,
    player,
    preparePlayers,
    get matches() {
      return ctx.extracts.size;
    },
  };
}

// Teams a player played for in his last 20 matches (any competition), from ESPN's athlete event log.
async function athleteEventLog(slug, athleteId) {
  const url = `${CORE}/${slug}/athletes/${athleteId}/eventlog`;
  return cached(`evlog:${url}`, 12 * 3600_000, async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return [];
      const j = await res.json();
      return Object.keys(j.teams || {});
    } catch {
      return [];
    }
  });
}

export async function buildShotModel(slug, eventId) {
  const t0 = Date.now();
  const meta = { matchesFetched: 0, cacheHits: 0, athleteStats: 0, athleteStatsMissing: 0 };
  const path = `soccer/${slug}`;
  const sum = await summary(path, eventId, 20_000);
  const header = sum.header?.competitions?.[0];
  if (!header) throw new Error('no match header');
  const year = sum.header?.season?.year || new Date().getFullYear();
  const competitors = (header.competitors || []).map((c) => ({
    id: String(c.team?.id),
    name: c.team?.displayName,
    abbrev: c.team?.abbreviation,
    logo: c.team?.logo || c.team?.logos?.[0]?.href || null,
    homeAway: c.homeAway,
    score: Number(c.score ?? 0) || 0,
  }));
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1];
  const clock = parseMinute(sum);

  // Lineups: announced XI, else each team's most recent XI.
  const rawRosters = sum.rosters || [];
  let lineups = soccerLineups(sum);
  let lineupsAnnounced = lineups.some((l) => l.starters.length >= 11);
  const lineupSource = {};
  const run = pLimit(6);

  // Fitted model inputs. Premier League: league-only history, 30/40-match windows.
  // Other competitions: the multi-competition model (history across all seven, opponent-adjusted).
  const kickoff = String(header.date || new Date().toISOString());
  const tsPromise = FITTED[slug]
    ? teamShareInputs(slug, year, competitors, kickoff, meta, run)
    : usesPooled(slug)
      ? pooledInputs(slug, competitors, kickoff, meta, sum).catch((e) => {
          console.warn(`pooled model inputs for ${slug} ${eventId} failed: ${e.message}`);
          return null;
        })
      : null;
  const histories = {}; // teamId -> [extract]
  await Promise.all(
    competitors.map(async (t) => {
      const ids = await recentMatchIds(slug, t.id, sum, eventId);
      const exs = await Promise.all(ids.map((id) => run(() => matchExtract(slug, id, meta).catch(() => null))));
      histories[t.id] = exs.filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }),
  );

  const tsIn = tsPromise ? await tsPromise : null;
  const prepPlayers = (lus) => (tsIn?.preparePlayers ? tsIn.preparePlayers(lus.flatMap((l) => [...l.starters, ...(l.subs || [])].map((p) => ({ id: String(p.id), teamId: String(l.team?.id) })))).catch((e) => console.warn(`player histories: ${e.message}`)) : null);

  if (!lineupsAnnounced) {
    lineups = competitors.map((t) => {
      const last = histories[t.id][0];
      if (!last) return { team: t, homeAway: t.homeAway, formation: null, starters: [], subs: [] };
      lineupSource[t.id] = { opponent: last.teams.find((x) => x.id !== t.id)?.name, date: last.date, competition: last.competition };
      const starters = last.players.filter((p) => p.teamId === t.id && p.starter).map((p) => ({ id: p.id, name: p.name, pos: p.pos, jersey: null, starter: true }));
      const subs = last.players.filter((p) => p.teamId === t.id && !p.starter).map((p) => ({ id: p.id, name: p.name, pos: p.pos, jersey: null, starter: false }));
      return { team: t, homeAway: t.homeAway, formation: null, starters, subs };
    });
  }

  // Multi-competition model: complete the lineup players' histories (previous clubs).
  const prepDone = prepPlayers(lineups);

  // League average shots per team per match from the fetched history.
  const seen = new Set();
  let shotSum = 0;
  let shotN = 0;
  for (const exs of Object.values(histories)) {
    for (const ex of exs) {
      if (seen.has(ex.id)) continue;
      seen.add(ex.id);
      for (const t of ex.teams) {
        if (t.shots > 0) {
          shotSum += t.shots;
          shotN++;
        }
      }
    }
  }
  const leagueAvg = shotN >= 6 ? shotSum / shotN : LEAGUE_AVG_SHOTS_FALLBACK;

  // Opponent defensive strength for every opponent in the histories (league data only).
  const gp = await leagueGamesPlayed(slug);
  const oppIds = new Set();
  for (const t of competitors) for (const ex of histories[t.id]) for (const x of ex.teams) if (x.id !== t.id) oppIds.add(x.id);
  const oppDef = {};
  await Promise.all(
    [...oppIds].map((id) =>
      run(async () => {
        oppDef[id] = gp[id] ? await teamShotsFaced(slug, year, id, gp[id]) : null;
      }),
    ),
  );
  const leagueFacedAvg = (() => {
    const vals = Object.values(oppDef).filter(Boolean).map((d) => d.facedPerGame);
    return vals.length >= 4 ? vals.reduce((a, b) => a + b, 0) / vals.length : leagueAvg;
  })();
  // adj > 1 means the opponent concedes few shots (strong defense) so shots against them count for more.
  const oppAdj = (id) => {
    const d = oppDef[id];
    if (!d || !d.facedPerGame) return 1;
    return Math.min(1.35, Math.max(0.75, leagueFacedAvg / d.facedPerGame));
  };

  const keyEvents = soccerKeyEvents(sum);
  const ts = teamStats(sum);
  const redCards = keyEvents
    .filter((k) => /red/i.test(k.type))
    .map((k) => ({ teamId: String(k.teamId), minute: clockMinute(k.clock), player: k.player }));

  await prepDone;
  const teams = await Promise.all(
    competitors.map(async (t) => {
      const opp = competitors.find((c) => c.id !== t.id);
      const hist = histories[t.id];
      const lu = lineups.find((l) => String(l.team?.id) === t.id) || { starters: [], subs: [], formation: null };
      const rawRoster = rawRosters.find((r) => String(r.team?.id) === t.id)?.roster || [];
      const rawById = new Map(rawRoster.map((p) => [String(p.athlete?.id), p]));

      // Team-level rates from history (recency weighted).
      let wFor = 0;
      let wAg = 0;
      let wN = 0;
      let homeFor = 0;
      let homeN = 0;
      let awayFor = 0;
      let awayN = 0;
      hist.forEach((ex, idx) => {
        const me = ex.teams.find((x) => x.id === t.id);
        const them = ex.teams.find((x) => x.id !== t.id);
        if (!me || !them) return;
        const w = Math.pow(0.5, idx / HALF_LIFE);
        wFor += w * me.shots * oppAdj(them.id);
        wAg += w * them.shots;
        wN += w;
        if (me.homeAway === 'home') {
          homeFor += me.shots;
          homeN++;
        } else {
          awayFor += me.shots;
          awayN++;
        }
      });
      const shotsFor90 = wN ? wFor / wN : leagueAvg;
      const shotsAgainst90 = wN ? wAg / wN : leagueAvg;
      const overall = homeN + awayN ? (homeFor + awayFor) / (homeN + awayN) : null;
      let homeAwayFactor = t.homeAway === 'home' ? 1.08 : 0.92;
      if (overall && homeN >= 2 && awayN >= 2) {
        const split = t.homeAway === 'home' ? homeFor / homeN / overall : awayFor / awayN / overall;
        homeAwayFactor = Math.min(1.25, Math.max(0.8, 0.5 * homeAwayFactor + 0.5 * split));
      }

      const players = [...lu.starters.map((p) => ({ ...p, role: 'starter' })), ...(lu.subs || []).map((p) => ({ ...p, role: 'sub' }))];
      const rates = await Promise.all(
        players.map((p) =>
          run(async () => {
            const pid = String(p.id);
            const season = await athleteSeason(slug, year, pid);
            if (season) meta.athleteStats++;
            else meta.athleteStatsMissing++;
            const history = [];
            hist.forEach((ex, idx) => {
              const row = ex.players.find((x) => x.id === pid);
              if (!row) return;
              const them = ex.teams.find((x) => x.id !== t.id);
              history.push({ idx, pos: row.pos, minutes: row.minutes, shots: row.shots, sot: row.sot, goals: row.goals, saves: row.saves, conceded: row.conceded, adj: them ? oppAdj(them.id) : 1 });
            });
            let pos = p.pos;
            if (!pos || pos === 'SUB') pos = (await athletePosition(slug, year, pid, history)) || (season && (season.saves > 0 || season.conceded > 0) ? 'G' : 'M');
            const group = posGroup(pos);
            const raw = rawById.get(pid);
            const mins = raw ? lineupMinutes(raw) : { subInMin: null, subOutMin: null, redMin: null };
            const subbedIn = !!raw?.subbedIn;
            const subbedOut = !!raw?.subbedOut;
            const onPitch = lineupsAnnounced
              ? (p.role === 'starter' ? !subbedOut : subbedIn && !subbedOut) && mins.redMin == null
              : p.role === 'starter';
            const live = raw?.stats ? { shots: statOf(raw, 'totalShots'), sot: statOf(raw, 'shotsOnTarget'), goals: statOf(raw, 'totalGoals') } : null;
            const out = {
              id: pid,
              name: p.name,
              shortName: p.shortName || null,
              pos,
              group,
              jersey: p.jersey || null,
              role: p.role,
              onPitch,
              subbedIn,
              subbedOut,
              subInMin: subbedIn ? mins.subInMin ?? 65 : null,
              subOutMin: subbedOut ? mins.subOutMin ?? 70 : null,
              redMin: mins.redMin,
              live,
              rate: buildPlayerRates(p, history, season, group),
              // fitted model: position group, shots per 90 and conversion (recency-weighted, shrunk)
              ts: tsIn ? tsIn.player(pid, p.pos) : null,
              keeper: group === 'G' ? keeperRate(p, history, season) : null,
            };
            return out;
          }),
        ),
      );

      const myStats = ts.find((x) => String(x.team.id) === t.id)?.stats || {};
      const keeper = rates.find((p) => p.group === 'G' && p.onPitch) || rates.find((p) => p.group === 'G');
      return {
        id: t.id,
        name: t.name,
        abbrev: t.abbrev,
        logo: t.logo,
        homeAway: t.homeAway,
        formation: lu.formation || null,
        shape: shapeFromFormation(lu.formation),
        lineupSource: lineupSource[t.id] || null,
        goals: t.score,
        shotsSoFar: Number(myStats.totalShots ?? 0) || 0,
        sotSoFar: Number(myStats.shotsOnTarget ?? 0) || 0,
        shotsFor90: round(shotsFor90, 2),
        shotsAgainst90: round(shotsAgainst90, 2),
        // >1 = concedes more shots than average (leaky); multiplies the opponent's attack.
        leakiness: round(Math.min(1.4, Math.max(0.7, shotsAgainst90 / leagueAvg)), 3),
        homeAwayFactor: round(homeAwayFactor, 3),
        keeper: keeper ? { id: keeper.id, name: keeper.name, ...keeper.keeper } : { saveRate: 0.7, sample: 0 },
        matchesUsed: hist.length,
        // fitted model: recency-weighted shots for / against per match, shrunk to the league rate
        // (multi-competition model: opponent-adjusted, over all seven competitions; sf = commentary shots so far)
        ts: tsIn ? { att: round(tsIn.teams[t.id].att, 4), dfn: round(tsIn.teams[t.id].dfn, 4), matches: tsIn.teams[t.id].matches, sf: tsIn.teams[t.id].sf } : null,
        redCards: redCards.filter((r) => r.teamId === t.id).length,
        players: rates,
        opponentId: opp?.id || null,
      };
    }),
  );

  return {
    match: {
      id: String(eventId),
      slug,
      state: clock.state,
      minute: clock.minute,
      clock: clock.clock,
      period: clock.period,
      homeId: home.id,
      awayId: away.id,
      score: { home: home.score, away: away.score },
      lineupsAnnounced,
      redCards,
      neutral: !!header.neutralSite,
    },
    league: { slug, avgShots: round(leagueAvg, 2), avgShotsFaced: round(leagueFacedAvg, 2) },
    // The fitted model's parameters when this league has one (the browser applies them); else null.
    model: tsIn ? { kind: 'team_share', historyMatches: tsIn.matches, ...tsIn.model } : null,
    teams,
    meta: { ...meta, ms: Date.now() - t0, historyMatches: HISTORY_MATCHES },
  };
}
