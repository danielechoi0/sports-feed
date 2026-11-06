// ESPN public site API helpers + normalizers.
import { cached } from './cache.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HEADERS = { accept: 'application/json', 'user-agent': 'sports-dashboard/1.0' };

export const SOCCER_LEAGUES = [
  { slug: 'eng.1', name: 'Premier League', short: 'EPL' },
  { slug: 'esp.1', name: 'LaLiga', short: 'LaLiga' },
  { slug: 'ger.1', name: 'Bundesliga', short: 'BuLi' },
  { slug: 'ita.1', name: 'Serie A', short: 'Serie A' },
  { slug: 'fra.1', name: 'Ligue 1', short: 'Ligue 1' },
  { slug: 'uefa.champions', name: 'Champions League', short: 'UCL' },
  { slug: 'uefa.europa', name: 'Europa League', short: 'UEL' },
];

export const SPORT_PATH = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
};

export function soccerPath(slug) {
  if (!SOCCER_LEAGUES.some((l) => l.slug === slug)) throw new Error(`Unknown soccer league: ${slug}`);
  return `soccer/${slug}`;
}

export async function fetchJson(url, ttlMs = 60_000) {
  return cached(url, ttlMs, async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
    return res.json();
  });
}

export function scoreboard(path, date, extra = '') {
  return fetchJson(`${SITE}/${path}/scoreboard?dates=${date}${extra}`, 60_000);
}

export function summary(path, eventId, ttlMs = 60_000) {
  return fetchJson(`${SITE}/${path}/summary?event=${eventId}`, ttlMs);
}

export function teamRoster(path, teamId) {
  return fetchJson(`${SITE}/${path}/teams/${teamId}/roster`, 6 * 3600_000);
}

function pickRecord(c) {
  const recs = c.records || [];
  const total = recs.find((r) => r.type === 'total') || recs[0];
  return total?.summary || null;
}

function teamLogo(t) {
  return t?.logo || t?.logos?.[0]?.href || null;
}

export function normalizeTeam(c = {}) {
  const t = c.team || {};
  return {
    id: t.id,
    name: t.displayName || t.name,
    shortName: t.shortDisplayName || t.name || t.displayName,
    abbrev: t.abbreviation,
    logo: teamLogo(t),
    color: t.color || null,
    score: c.score ?? null,
    winner: !!c.winner,
    record: pickRecord(c),
    homeAway: c.homeAway,
    form: c.form || null,
  };
}

export function normalizeEvent(ev, sport, league) {
  const comp = ev.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0] || {};
  const away = comps.find((c) => c.homeAway === 'away') || comps[1] || {};
  const v = comp.venue || ev.venue || {};
  const st = ev.status || comp.status || {};
  const broadcasts = (comp.broadcasts || []).flatMap((b) => b.names || []);
  return {
    id: ev.id,
    sport,
    league,
    name: ev.name,
    shortName: ev.shortName,
    date: ev.date,
    status: {
      state: st.type?.state || 'pre',
      detail: st.type?.detail || '',
      shortDetail: st.type?.shortDetail || '',
      description: st.type?.description || '',
      completed: !!st.type?.completed,
      clock: st.displayClock || null,
      period: st.period ?? null,
    },
    venue: {
      name: v.fullName || null,
      city: v.address?.city || null,
      state: v.address?.state || null,
      country: v.address?.country || null,
      indoor: typeof v.indoor === 'boolean' ? v.indoor : null,
    },
    broadcast: [...new Set(broadcasts)].slice(0, 3).join(', ') || null,
    odds: comp.odds?.[0]?.details || null,
    espnWeather: ev.weather
      ? { label: ev.weather.displayValue || null, tempF: ev.weather.temperature ?? null }
      : null,
    home: normalizeTeam(home),
    away: normalizeTeam(away),
  };
}

// ---- Soccer ----------------------------------------------------------------

// Last five results for a team from a soccer summary's lastFiveGames block.
// Returned oldest -> newest.
export function lastFive(sum, teamId) {
  const block = (sum?.lastFiveGames || []).find((t) => String(t.team?.id) === String(teamId));
  if (!block) return null;
  return (block.events || [])
    .map((e) => {
      const isHome = String(e.homeTeamId) === String(teamId);
      const ts = isHome ? e.homeTeamScore : e.awayTeamScore;
      const os = isHome ? e.awayTeamScore : e.homeTeamScore;
      return {
        id: e.id,
        date: e.gameDate,
        result: e.gameResult, // W / D / L
        isHome,
        score: `${ts}-${os}`,
        opponent: e.opponent?.shortDisplayName || e.opponent?.displayName || null,
        opponentAbbrev: e.opponent?.abbreviation || null,
        opponentLogo: e.opponentLogo || e.opponent?.logo || null,
        competition: e.leagueAbbreviation || e.leagueName || null,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-5);
}

// Per-player match stats we surface for soccer, keyed by ESPN stat name.
const SOCCER_PLAYER_STATS = {
  totalGoals: 'G',
  goalAssists: 'A',
  totalShots: 'SH',
  shotsOnTarget: 'SOT',
  saves: 'SV',
  foulsCommitted: 'FC',
  foulsSuffered: 'FS',
  offsides: 'OFF',
  yellowCards: 'YC',
  redCards: 'RC',
};

function soccerPlayerStats(p) {
  const out = {};
  for (const s of p.stats || []) {
    const key = SOCCER_PLAYER_STATS[s.name];
    if (key) out[key] = s.value ?? Number(s.displayValue) ?? 0;
  }
  return Object.keys(out).length ? out : null;
}

// Discipline and substitution minutes from a roster entry's `plays` list
// (each play carries clock.displayValue plus redCard/yellowCard/substitution flags).
function soccerPlayerPlays(p) {
  const out = { sentOff: null, secondYellow: false, yellowAt: null, subbedInAt: null, subbedOutAt: null };
  let yellows = 0;
  for (const play of p.plays || []) {
    const clock = play.clock?.displayValue || null;
    if (play.yellowCard) {
      yellows++;
      out.yellowAt = out.yellowAt || clock;
    }
    if (play.redCard) {
      out.sentOff = clock || out.sentOff || "?'";
      out.secondYellow = yellows > 0 || /second yellow/i.test(play.text || '');
    }
    if (play.substitution) {
      if (p.subbedIn && !out.subbedInAt) out.subbedInAt = clock;
      else if (p.subbedOut) out.subbedOutAt = clock;
    }
  }
  // ESPN also reports a red via the stat line when plays are missing.
  if (!out.sentOff && (p.stats || []).some((s) => s.name === 'redCards' && Number(s.value) > 0)) out.sentOff = "?'";
  return out;
}

export function soccerLineups(sum) {
  return (sum?.rosters || []).map((r) => {
    const players = (r.roster || []).map((p) => ({
      id: p.athlete?.id,
      name: p.athlete?.displayName,
      shortName: p.athlete?.shortName,
      jersey: p.jersey || null,
      pos: p.position?.abbreviation || null,
      posName: p.position?.name || null,
      starter: !!p.starter,
      formationPlace: Number(p.formationPlace) || null,
      subbedIn: !!p.subbedIn,
      subbedOut: !!p.subbedOut,
      stats: soccerPlayerStats(p),
      ...soccerPlayerPlays(p),
    }));
    return {
      team: { id: r.team?.id, name: r.team?.displayName, logo: teamLogo(r.team) },
      homeAway: r.homeAway,
      formation: r.formation || null,
      starters: players
        .filter((p) => p.starter)
        .sort((a, b) => (a.formationPlace || 99) - (b.formationPlace || 99)),
      subs: players.filter((p) => !p.starter),
    };
  });
}

// Team-level stats from a box score as { statName: displayValue } per team.
export function teamStats(sum) {
  return (sum?.boxscore?.teams || []).map((t) => ({
    team: { id: t.team?.id, name: t.team?.displayName, abbrev: t.team?.abbreviation, logo: teamLogo(t.team) },
    homeAway: t.homeAway || null,
    stats: Object.fromEntries((t.statistics || []).map((s) => [s.name, s.displayValue ?? s.value ?? null])),
  }));
}

// NFL box score: per team, per category (passing, rushing, receiving, ...),
// column labels plus each player's stat row.
export function nflBoxPlayers(sum) {
  const players = sum?.boxscore?.players;
  if (!players?.length) return null;
  const out = players.map((p) => ({
    team: { id: p.team?.id, name: p.team?.displayName, abbrev: p.team?.abbreviation, logo: teamLogo(p.team) },
    categories: (p.statistics || [])
      .filter((c) => c.athletes?.length)
      .map((c) => ({
        name: c.name,
        label: c.text || c.name,
        labels: c.labels || [],
        descriptions: c.descriptions || [],
        athletes: (c.athletes || []).map((a) => ({
          id: a.athlete?.id,
          name: a.athlete?.displayName,
          shortName: a.athlete?.shortName,
          pos: a.athlete?.position?.abbreviation || null,
          jersey: a.athlete?.jersey || null,
          stats: a.stats || [],
        })),
      })),
  }));
  return out.some((t) => t.categories.length) ? out : null;
}

export function soccerKeyEvents(sum) {
  return (sum?.keyEvents || [])
    .filter((k) => /goal|card|penalty/i.test(k.type?.text || ''))
    .map((k) => ({
      type: k.type?.text || '',
      clock: k.clock?.displayValue || '',
      teamId: k.team?.id || null,
      player: k.participants?.[0]?.athlete?.displayName || null,
      text: k.text || k.shortText || '',
    }));
}

// ---- NFL / NBA -------------------------------------------------------------

export function injuries(sum) {
  return (sum?.injuries || []).map((t) => ({
    team: { id: t.team?.id, name: t.team?.displayName, logo: teamLogo(t.team) },
    list: (t.injuries || []).map((i) => ({
      id: i.athlete?.id,
      name: i.athlete?.displayName,
      pos: i.athlete?.position?.abbreviation || null,
      jersey: i.athlete?.jersey || null,
      headshot: i.athlete?.headshot?.href || null,
      status: i.status || null,
      type: i.details?.type || null,
      detail: i.details?.detail && i.details.detail !== 'Not Specified' ? i.details.detail : null,
      side: i.details?.side && i.details.side !== 'Not Specified' ? i.details.side : null,
      returnDate: i.details?.returnDate || null,
      fantasy: i.details?.fantasyStatus?.displayDescription || null,
      updated: i.date || null,
    })),
  }));
}

export function nbaBoxLineups(sum) {
  const players = sum?.boxscore?.players;
  if (!players?.length) return null;
  const out = players.map((p) => {
    const stat = p.statistics?.[0];
    const keys = stat?.keys || stat?.names || [];
    const labels = stat?.labels || stat?.names || [];
    const iMin = keys.findIndex((k) => /^min/i.test(k));
    const iPts = keys.findIndex((k) => /^points$|^pts$/i.test(k));
    const athletes = (stat?.athletes || []).map((a) => ({
      id: a.athlete?.id,
      name: a.athlete?.displayName,
      shortName: a.athlete?.shortName,
      pos: a.athlete?.position?.abbreviation || null,
      jersey: a.athlete?.jersey || null,
      headshot: a.athlete?.headshot?.href || null,
      starter: !!a.starter,
      dnp: !!a.didNotPlay,
      ejected: !!a.ejected,
      reason: a.reason || null,
      min: iMin >= 0 ? a.stats?.[iMin] ?? null : null,
      pts: iPts >= 0 ? a.stats?.[iPts] ?? null : null,
      stats: a.stats || [],
    }));
    return {
      team: { id: p.team?.id, name: p.team?.displayName, logo: teamLogo(p.team) },
      labels,
      descriptions: stat?.descriptions || [],
      totals: stat?.totals || [],
      starters: athletes.filter((a) => a.starter),
      bench: athletes.filter((a) => !a.starter),
    };
  });
  // Pre-game ESPN sometimes returns the block with no athletes at all.
  return out.some((t) => t.starters.length || t.bench.length) ? out : null;
}

export function normalizeRoster(rosterJson) {
  return (rosterJson?.athletes || []).map((a) => ({
    id: a.id,
    name: a.displayName,
    shortName: a.shortName,
    pos: a.position?.abbreviation || null,
    jersey: a.jersey || null,
    headshot: a.headshot?.href || null,
    injury: a.injuries?.[0]
      ? { status: a.injuries[0].status || null, type: a.injuries[0].type || null }
      : null,
  }));
}
