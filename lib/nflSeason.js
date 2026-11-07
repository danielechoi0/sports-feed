// Current-season per-game averages for NFL players and teams (ESPN), used as
// the baselines the Kalshi market read is measured against.
//
// Player: passing/rushing/receiving yards and attempts per game played, from
// ESPN's athlete stats (the current regular season's row(s); a player who
// changed teams mid-season has one row per team, which are summed).
// Team: points, passing and rushing yards per game, for and against, from
// ESPN's team statistics (the `opponent` block is what the team allows).
import { fetchJson } from './espn.js';
import { pLimit } from './cache.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
const TTL = 6 * 3600_000; // season averages move once a week
const run = pLimit(6);

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Sum one category's current-season row(s) into { field: total }.
function seasonTotals(cat, year) {
  const rows = (cat?.statistics || []).filter((s) => s.season?.year === year);
  if (!rows.length) return null;
  const out = {};
  for (const row of rows) {
    cat.names.forEach((name, i) => {
      const v = num(row.stats?.[i]);
      if (v != null) out[name] = (out[name] || 0) + v;
    });
  }
  return out;
}

export async function playerSeason(athleteId, year) {
  if (!athleteId) return null;
  try {
    const d = await run(() => fetchJson(`${WEB}/athletes/${athleteId}/stats?seasontype=2`, TTL));
    const cat = (name) => seasonTotals(d.categories?.find((c) => c.name === name), year);
    const pass = cat('passing');
    const rush = cat('rushing');
    const rec = cat('receiving');
    const gp = Math.max(pass?.gamesPlayed || 0, rush?.gamesPlayed || 0, rec?.gamesPlayed || 0);
    if (!gp) return null;
    const pg = (v) => (v == null ? null : Math.round((v / gp) * 10) / 10);
    return {
      gp,
      passYds: pg(pass?.passingYards),
      passAtt: pg(pass?.passingAttempts),
      rushYds: pg(rush?.rushingYards),
      rushAtt: pg(rush?.rushingAttempts),
      recYds: pg(rec?.receivingYards),
    };
  } catch {
    return null;
  }
}

function statMap(categories) {
  const m = {};
  for (const c of categories || []) for (const s of c.stats || []) if (m[s.name] == null) m[s.name] = s.value;
  return m;
}

export async function teamSeason(teamId) {
  try {
    const d = await run(() => fetchJson(`${SITE}/teams/${teamId}/statistics`, TTL));
    const own = statMap(d.results?.stats?.categories);
    const opp = statMap(Array.isArray(d.results?.opponent) ? d.results.opponent : d.results?.opponent?.categories);
    const gp = num(own.gamesPlayed) || num(own.teamGamesPlayed) || num(opp.teamGamesPlayed);
    if (!gp) return null;
    const r1 = (v) => (num(v) == null ? null : Math.round(num(v) * 10) / 10);
    return {
      year: d.season?.year ?? null,
      gp,
      pointsFor: r1(own.totalPointsPerGame),
      pointsAgainst: r1(opp.totalPointsPerGame),
      passYds: r1(own.netPassingYardsPerGame),
      rushYds: r1(own.rushingYardsPerGame),
      passYdsAllowed: r1(opp.netPassingYardsPerGame),
      rushYdsAllowed: r1(opp.rushingYardsPerGame),
    };
  } catch {
    return null;
  }
}
