// NFL team rankings for passing/rushing offense and defense, computed from the
// box scores of every completed regular-season game (yards per game).
// ESPN's team-stats feed ranks offense but not yards allowed, so we aggregate
// both sides ourselves for a consistent methodology. Completed games are cached
// on disk, so after the first build only new games are fetched.
import { fetchJson, summary, SPORT_PATH } from './espn.js';
import { readDisk, writeDisk, pLimit } from './cache.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const REFRESH_MS = 3 * 3600_000;

let current = null; // last successful build
let building = null; // in-flight build promise

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractGame(sum) {
  const teams = sum?.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length !== 2) return null;
  const out = teams.map((t) => {
    const stat = (name) => num(t.statistics?.find((s) => s.name === name)?.displayValue);
    return {
      id: String(t.team?.id),
      name: t.team?.displayName,
      abbrev: t.team?.abbreviation,
      logo: t.team?.logo || t.team?.logos?.[0]?.href || null,
      pass: stat('netPassingYards'),
      rush: stat('rushingYards'),
      total: stat('totalYards'),
    };
  });
  if (out.some((t) => t.pass == null || t.rush == null)) return null;
  return out;
}

function rank(entries, key, dir) {
  // Standard competition ranking (ties share a rank).
  const sorted = [...entries].sort((a, b) => (dir === 'desc' ? b[key] - a[key] : a[key] - b[key]));
  let prev = null;
  let prevRank = 0;
  sorted.forEach((e, i) => {
    const r = prev !== null && e[key] === prev ? prevRank : i + 1;
    e[`${key}Rank`] = r;
    prev = e[key];
    prevRank = r;
  });
}

async function build() {
  const sb = await fetchJson(`${SITE}/${SPORT_PATH.nfl}/scoreboard`, 5 * 60_000);
  const year = sb.season?.year;
  const type = sb.season?.type; // 1 pre, 2 regular, 3 post
  const week = sb.week?.number || 1;
  if (!year || type < 2) {
    return { season: year, seasonType: type, week, games: 0, teams: {}, builtAt: new Date().toISOString(), note: 'Regular season has not started.' };
  }
  const maxWeek = type === 2 ? week : 18;
  const storeName = `nfl-games-${year}.json`;
  const store = await readDisk(storeName, {});
  const run = pLimit(6);

  const weekBoards = await Promise.all(
    Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) =>
      run(() =>
        fetchJson(`${SITE}/${SPORT_PATH.nfl}/scoreboard?seasontype=2&week=${w}&dates=${year}`, 30 * 60_000).catch(() => null),
      ),
    ),
  );
  const completed = [];
  for (const board of weekBoards) {
    for (const ev of board?.events || []) if (ev.status?.type?.completed) completed.push(ev.id);
  }

  const missing = completed.filter((id) => !store[id]);
  let added = 0;
  await Promise.all(
    missing.map((id) =>
      run(async () => {
        try {
          const teams = extractGame(await summary(SPORT_PATH.nfl, id, 3600_000));
          if (teams) {
            store[id] = { teams };
            added++;
          }
        } catch (e) {
          console.warn(`nflStats: summary ${id} failed: ${e.message}`);
        }
      }),
    ),
  );
  if (added) await writeDisk(storeName, store);

  const agg = new Map();
  const bump = (team, opp) => {
    let a = agg.get(team.id);
    if (!a) {
      a = { id: team.id, name: team.name, abbrev: team.abbrev, logo: team.logo, games: 0, passOff: 0, rushOff: 0, totalOff: 0, passDef: 0, rushDef: 0, totalDef: 0 };
      agg.set(team.id, a);
    }
    a.games++;
    a.passOff += team.pass;
    a.rushOff += team.rush;
    a.totalOff += team.total ?? team.pass + team.rush;
    a.passDef += opp.pass;
    a.rushDef += opp.rush;
    a.totalDef += opp.total ?? opp.pass + opp.rush;
  };
  let counted = 0;
  for (const id of completed) {
    const g = store[id];
    if (!g) continue;
    const [a, b] = g.teams;
    bump(a, b);
    bump(b, a);
    counted++;
  }
  const entries = [...agg.values()].map((a) => ({
    ...a,
    passOff: a.passOff / a.games,
    rushOff: a.rushOff / a.games,
    totalOff: a.totalOff / a.games,
    passDef: a.passDef / a.games,
    rushDef: a.rushDef / a.games,
    totalDef: a.totalDef / a.games,
  }));
  rank(entries, 'passOff', 'desc');
  rank(entries, 'rushOff', 'desc');
  rank(entries, 'totalOff', 'desc');
  rank(entries, 'passDef', 'asc');
  rank(entries, 'rushDef', 'asc');
  rank(entries, 'totalDef', 'asc');

  const teams = {};
  for (const e of entries) {
    teams[e.id] = {
      id: e.id,
      name: e.name,
      abbrev: e.abbrev,
      logo: e.logo,
      games: e.games,
      passOff: { rank: e.passOffRank, perGame: +e.passOff.toFixed(1) },
      rushOff: { rank: e.rushOffRank, perGame: +e.rushOff.toFixed(1) },
      totalOff: { rank: e.totalOffRank, perGame: +e.totalOff.toFixed(1) },
      passDef: { rank: e.passDefRank, perGame: +e.passDef.toFixed(1) },
      rushDef: { rank: e.rushDefRank, perGame: +e.rushDef.toFixed(1) },
      totalDef: { rank: e.totalDefRank, perGame: +e.totalDef.toFixed(1) },
    };
  }
  return { season: year, seasonType: type, week, games: counted, teamCount: entries.length, teams, builtAt: new Date().toISOString() };
}

export function getRankings({ wait = true } = {}) {
  const stale = !current || Date.now() - new Date(current.builtAt).getTime() > REFRESH_MS;
  if (stale && !building) {
    building = build()
      .then((r) => {
        current = r;
        return r;
      })
      .catch((e) => {
        console.warn('nflStats build failed:', e.message);
        if (current) return current;
        throw e;
      })
      .finally(() => {
        building = null;
      });
  }
  if (current && !wait) return Promise.resolve(current);
  return building || Promise.resolve(current);
}

export function warmRankings() {
  getRankings().then(
    (r) => console.log(`NFL rankings ready: ${r.games} games, ${r.teamCount ?? 0} teams (season ${r.season}, week ${r.week})`),
    (e) => console.warn('NFL rankings warm-up failed:', e.message),
  );
}
