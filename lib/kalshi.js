// Kalshi prediction-market prices for NFL games, turned into implied lines
// (median total, spread, team totals, player yards) and a rule-based,
// plain-English read of how the market expects the game to be played.
//
// Public, unauthenticated market data only. Each game is a set of Kalshi
// events that share one suffix, e.g. KXNFLGAME-26NOV08DALIND and
// KXNFLPASSYDS-26NOV08DALIND (date in US Eastern time, then the away and home
// team codes). Most markets are threshold ladders ("Dak Prescott: 250+ passing
// yards"); the implied line is the 50% point of that ladder.
import { cached, pLimit } from './cache.js';
import { SPORT_PATH, summary, teamRoster } from './espn.js';
import { playerSeason, teamSeason } from './nflSeason.js';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const TTL = 3 * 60_000; // prices: a few minutes is fresh enough for a pre-game read
const LIST_TTL = 10 * 60_000;
// Kalshi rate-limits public reads aggressively (bursts of ~10 get 429s), so
// every request goes through one small shared queue and retries with backoff.
const run = pLimit(2);

// Series that make up one game. `kind` drives parsing.
export const SERIES = {
  game: { ticker: 'KXNFLGAME', label: 'moneyline (win probability)', kind: 'winner' },
  spread: { ticker: 'KXNFLSPREAD', label: 'spread', kind: 'team-ladder' },
  total: { ticker: 'KXNFLTOTAL', label: 'total points', kind: 'game-ladder' },
  teamTotal: { ticker: 'KXNFLTEAMTOTAL', label: 'team total points', kind: 'team-ladder' },
  teamYds: { ticker: 'KXNFLTEAMYDS', label: 'team total yards', kind: 'team-ladder' },
  passYds: { ticker: 'KXNFLPASSYDS', label: 'player passing yards', kind: 'player-ladder' },
  rushYds: { ticker: 'KXNFLRSHYDS', label: 'player rushing yards', kind: 'player-ladder' },
  recYds: { ticker: 'KXNFLRECYDS', label: 'player receiving yards', kind: 'player-ladder' },
  passAtt: { ticker: 'KXNFLPASSATT', label: 'passing attempts', kind: 'player-ladder' },
  rushAtt: { ticker: 'KXNFLRSHATT', label: 'rushing attempts', kind: 'player-ladder' },
  rushMean: { ticker: 'KXNFLLADDERRSHYDS', label: 'rushing yards (scalar)', kind: 'player-scalar' },
  recMean: { ticker: 'KXNFLLADDERRECYDS', label: 'receiving yards (scalar)', kind: 'player-scalar' },
};

// The read measures every market line against the current season: each
// player's own per-game average, and each team's points per game (and what its
// opponent allows). These thresholds decide when a line counts as above or
// below that average. Spread thresholds are absolute (a 10-point spread is
// lopsided whatever the teams' history).
export const BASELINES = {
  totalDiff: 3, // game total this many points above/below the season-based expectation: high/low
  teamPointsDiff: 3, // same for one team's implied points
  playerPct: 0.12, // player line this fraction above/below his season average: high/low
  minYds: { passYds: 15, rushYds: 8, recYds: 8, passAtt: 2, rushAtt: 2 }, // ...and at least this many yards/attempts
  minGames: 2, // fewer games played than this: no season baseline
  lopsidedSpread: 9.5, // favorite by this much or more: lopsided
  lopsidedWinProb: 0.8,
  closeSpread: 3, // within this: coin flip
  leanPp: 5, // pass share this many points above/below the players' season split: pass/run-leaning
};

// Line vs season average: 'high' | 'low' | 'in line', or null without a baseline.
function vsSeason(line, avg, key) {
  if (line == null || avg == null) return null;
  const d = line - avg;
  const need = Math.max(BASELINES.minYds[key] ?? 0, BASELINES.playerPct * Math.abs(avg));
  return d >= need ? 'high' : d <= -need ? 'low' : 'in line';
}


// ESPN and Kalshi disagree on a few codes; map both to one canonical code.
const CODE_ALIAS = { WSH: 'WAS', JAX: 'JAC', LA: 'LAR' };
const canon = (c) => CODE_ALIAS[String(c || '').toUpperCase()] || String(c || '').toUpperCase();

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// Kalshi tickers carry the game date in US Eastern time: 26NOV08.
function kalshiDate(iso, shiftDays = 0) {
  const d = new Date(new Date(iso).getTime() + shiftDays * 86400_000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${MONTHS[Number(get('month')) - 1]}${get('day')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kalshiGet(pathAndQuery) {
  return run(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { accept: 'application/json' } });
      if (res.status === 429 && attempt < 5) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 300 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`Kalshi ${res.status} for ${pathAndQuery}`);
      return res.json();
    }
  });
}

function marketsFor(eventTicker) {
  return cached(`kalshi:markets:${eventTicker}`, TTL, async () => {
    const d = await kalshiGet(`/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=1000`);
    return d.markets || [];
  });
}

// Open NFL game events, used to find the ticker suffix for an ESPN game.
function openGameEvents() {
  return cached('kalshi:nflgame:open', LIST_TTL, async () => {
    const out = [];
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const d = await kalshiGet(`/events?series_ticker=${SERIES.game.ticker}&status=open&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...(d.events || []).map((e) => ({ ticker: e.event_ticker, title: e.title })));
      cursor = d.cursor;
      if (!cursor || !(d.events || []).length) break;
    }
    return out;
  });
}

// ---- matching ------------------------------------------------------------

function espnGame(sum, eventId) {
  const comp = sum?.header?.competitions?.[0];
  if (!comp) return null;
  const teams = (comp.competitors || []).map((c) => ({
    id: String(c.team?.id),
    abbrev: c.team?.abbreviation,
    code: canon(c.team?.abbreviation),
    name: c.team?.displayName,
    shortName: c.team?.shortDisplayName || c.team?.name,
    logo: c.team?.logo || c.team?.logos?.[0]?.href || null,
    homeAway: c.homeAway,
  }));
  const away = teams.find((t) => t.homeAway === 'away');
  const home = teams.find((t) => t.homeAway === 'home');
  if (!away || !home) return null;
  return { eventId, year: sum?.header?.season?.year ?? null, date: comp.date, state: comp.status?.type?.state || sum?.header?.competitions?.[0]?.status?.type?.state || 'pre', away, home };
}

// Kalshi event suffix "26NOV08DALIND": date + two team codes. Match by date
// (+/- one day, for late kickoffs and international games) and by the set of
// canonical team codes, in either order.
function suffixMatches(suffix, g) {
  const m = /^(\d{2}[A-Z]{3}\d{2})([A-Z]+)$/.exec(suffix);
  if (!m) return false;
  const [, date, codes] = m;
  const dates = [-1, 0, 1].map((s) => kalshiDate(g.date, s));
  if (!dates.includes(date)) return false;
  const variants = (t) => [...new Set([t.code, t.abbrev?.toUpperCase(), ...Object.entries(CODE_ALIAS).filter(([, v]) => v === t.code).map(([k]) => k)])];
  for (const a of variants(g.away)) for (const h of variants(g.home)) if (codes === a + h || codes === h + a) return true;
  return false;
}

async function findSuffix(g) {
  const list = await openGameEvents().catch(() => []);
  for (const e of list) {
    const suffix = e.ticker.slice(SERIES.game.ticker.length + 1);
    if (suffixMatches(suffix, g)) return suffix;
  }
  // Not in the open list (finished, or the list call failed): probe the
  // likely tickers directly.
  const candidates = [
    `${kalshiDate(g.date)}${g.away.code}${g.home.code}`,
    `${kalshiDate(g.date)}${g.home.code}${g.away.code}`,
  ];
  for (const c of candidates) {
    const ms = await marketsFor(`${SERIES.game.ticker}-${c}`).catch(() => []);
    if (ms.length) return c;
  }
  return null;
}

// ---- prices and ladders --------------------------------------------------

const num = (v) => (v == null || v === '' ? null : Number(v));

// Probability for one market: bid/ask midpoint; last trade when the book is
// wide but the last trade sits inside it; nothing when there is no real book.
function priceOf(m) {
  if (m.status && m.status !== 'active') return null;
  const bid = num(m.yes_bid_dollars) ?? (m.yes_bid != null ? m.yes_bid / 100 : null);
  const ask = num(m.yes_ask_dollars) ?? (m.yes_ask != null ? m.yes_ask / 100 : null);
  const last = num(m.last_price_dollars) ?? (m.last_price != null ? m.last_price / 100 : null);
  if (bid == null || ask == null || ask <= 0 || ask < bid) return null;
  const width = ask - bid;
  if (width <= 0.25) return { p: (bid + ask) / 2, width, src: 'mid' };
  if (last && last >= bid && last <= ask) return { p: last, width, src: 'last' };
  if (width <= 0.4) return { p: (bid + ask) / 2, width, src: 'mid-wide' };
  return null;
}

// Pool-adjacent-violators: make P(X > t) non-increasing in t.
function isotonicDecreasing(pts) {
  const blocks = [];
  for (const pt of pts) {
    blocks.push({ sum: pt.p, n: 1, items: [pt] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n >= b.sum / b.n) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, n: a.n + b.n, items: [...a.items, ...b.items] });
    }
  }
  return blocks.flatMap((b) => b.items.map((it) => ({ ...it, p: b.sum / b.n })));
}

// Ladder of {t, p = P(X > t)} -> implied median (50% point), linear between
// rungs. Outside the ladder, report a bound instead of extrapolating.
export function ladderMedian(rawPts) {
  const pts = isotonicDecreasing([...rawPts].sort((a, b) => a.t - b.t));
  if (!pts.length) return null;
  const rungs = pts.map((x) => ({ t: x.t, p: Math.round(x.p * 1000) / 1000 }));
  if (pts[0].p < 0.5) return { median: null, below: pts[0].t, rungs };
  if (pts[pts.length - 1].p > 0.5) return { median: null, above: pts[pts.length - 1].t, rungs };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.p >= 0.5 && b.p <= 0.5) {
      const median = a.p === b.p ? (a.t + b.t) / 2 : a.t + ((a.p - 0.5) / (a.p - b.p)) * (b.t - a.t);
      return { median, rungs };
    }
  }
  return { median: pts[pts.length - 1].t, rungs };
}

// Probability that X > x, read off the ladder (for win probability from the
// spread when the moneyline market is missing).
function ladderProbAt(rawPts, x) {
  const pts = isotonicDecreasing([...rawPts].sort((a, b) => a.t - b.t));
  if (pts.length < 2 || x < pts[0].t || x > pts[pts.length - 1].t) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.t && x <= b.t) return a.p + ((x - a.t) / (b.t - a.t || 1)) * (b.p - a.p);
  }
  return null;
}

// A usable number for sums/comparisons, plus a display string.
function lineValue(l) {
  if (!l) return null;
  if (l.median != null) return l.median;
  if (l.below != null) return l.below / 2; // "under the lowest rung": rough
  if (l.above != null) return l.above; // "over the highest rung": at least this
  return null;
}

const teamPrefix = (participant, codes) => codes.filter((c) => participant.startsWith(c)).sort((a, b) => b.length - a.length)[0] || null;
const playerName = (m) => String(m.yes_sub_title || m.title || '').split(':')[0].replace(/\s+(rushing|receiving|passing) yards ladder$/i, '').trim();

function parseSeries(kind, markets, codes) {
  const groups = new Map();
  for (const m of markets) {
    const parts = String(m.ticker).split('-');
    const participant = parts[2] || '';
    const pr = priceOf(m);
    if (kind === 'winner') {
      if (!pr) continue;
      groups.set(canon(participant), { team: canon(participant), p: pr.p });
      continue;
    }
    if (kind === 'player-scalar') {
      if (!pr) continue;
      const cap = Number(m.custom_strike?.scalar_cap) || 400;
      const floor = Number(m.custom_strike?.scalar_floor) || 0;
      const id = m.custom_strike?.football_player || participant;
      groups.set(id, { id, name: playerName(m), team: teamPrefix(participant, codes), mean: floor + pr.p * (cap - floor) });
      continue;
    }
    const t = num(m.floor_strike);
    if (t == null || !pr) continue;
    let key;
    let base;
    if (kind === 'game-ladder') {
      key = 'game';
      base = {};
    } else if (kind === 'team-ladder') {
      const team = teamPrefix(canon(participant.replace(/\d+$/, '')), codes) || canon(participant.replace(/\d+$/, ''));
      key = team;
      base = { team };
    } else {
      key = m.custom_strike?.football_player || participant;
      base = { id: key, name: playerName(m), team: teamPrefix(participant, codes) };
    }
    if (!groups.has(key)) groups.set(key, { ...base, pts: [] });
    groups.get(key).pts.push({ t, p: pr.p });
  }
  return [...groups.values()];
}

// ---- positions from ESPN rosters ----------------------------------------

const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'\u2019]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();

async function rosterPositions(teams) {
  const map = new Map();
  await Promise.all(
    teams.map(async (t) => {
      try {
        const r = await teamRoster(SPORT_PATH.nfl, t.id);
        for (const grp of r.athletes || []) {
          for (const a of grp.items || (grp.displayName ? [grp] : [])) {
            const pos = a.position?.abbreviation;
            if (pos) map.set(`${t.code}|${normName(a.displayName)}`, { pos, id: String(a.id) });
          }
        }
      } catch {
        /* positions fall back to market-based inference */
      }
    }),
  );
  return map;
}

const POS_GROUP = { QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE' };

// ---- build ---------------------------------------------------------------

const round = (x, step = 1) => (x == null ? null : Math.round(x / step) * step);

function fmtLine(l, step = 1) {
  if (!l) return null;
  if (l.median != null) return String(round(l.median, step));
  if (l.below != null) return `<${round(l.below + 0.5, step)}`;
  if (l.above != null) return `>${round(l.above + 0.5, step)}`;
  return null;
}

export async function nflMarket(eventId) {
  let sum;
  try {
    sum = await summary(SPORT_PATH.nfl, eventId, 10 * 60_000);
  } catch (e) {
    return { available: false, reason: `Game not found on ESPN (${e.message}).` };
  }
  const g = espnGame(sum, eventId);
  if (!g) return { available: false, reason: 'Game not found on ESPN.' };
  const base = { eventId, teams: { away: pick(g.away), home: pick(g.home) }, state: g.state, generatedAt: new Date().toISOString() };
  if (g.state === 'post') return { ...base, available: false, reason: 'The game is over; its Kalshi markets have settled.' };
  const suffix = await findSuffix(g);
  if (!suffix) return { ...base, available: false, reason: 'Kalshi has no markets for this game (none listed yet, or already settled).' };

  const codes = [g.away.code, g.home.code];
  const fetched = {};
  const errors = [];
  await Promise.all(
    Object.entries(SERIES).map(async ([key, s]) => {
      try {
        fetched[key] = await marketsFor(`${s.ticker}-${suffix}`);
      } catch (e) {
        fetched[key] = [];
        errors.push(`${s.ticker}: ${e.message}`);
      }
    }),
  );
  const activeCount = Object.values(fetched).reduce((a, ms) => a + ms.filter((m) => m.status === 'active').length, 0);
  if (!activeCount) {
    const any = Object.values(fetched).some((ms) => ms.length);
    return {
      ...base,
      available: false,
      reason: any ? 'Kalshi markets for this game are closed or settled.' : 'Kalshi has no open markets for this game.',
      kalshi: { suffix, errors },
    };
  }
  const parsed = Object.fromEntries(Object.entries(SERIES).map(([k, s]) => [k, parseSeries(s.kind, fetched[k], codes)]));

  // Game level
  const winners = parsed.game;
  let winProb = null;
  if (winners.length) {
    const tot = winners.reduce((a, w) => a + w.p, 0) || 1;
    winProb = { source: 'moneyline', [g.away.code]: null, [g.home.code]: null };
    for (const w of winners) winProb[w.team] = w.p / tot;
    if (winProb[g.away.code] == null && winProb[g.home.code] != null) winProb[g.away.code] = 1 - winProb[g.home.code];
    if (winProb[g.home.code] == null && winProb[g.away.code] != null) winProb[g.home.code] = 1 - winProb[g.away.code];
  }

  const totalLadder = parsed.total[0] ? ladderMedian(parsed.total[0].pts) : null;

  // Spread: put both teams' "wins by over x" ladders on one axis, the home
  // team's margin M. Away "wins by over x" is P(M < -x) = 1 - P(M > -x).
  let spread = null;
  const homeSp = parsed.spread.find((s) => s.team === g.home.code);
  const awaySp = parsed.spread.find((s) => s.team === g.away.code);
  if (homeSp || awaySp) {
    const pts = [...(homeSp?.pts || []), ...(awaySp?.pts || []).map((x) => ({ t: -x.t, p: 1 - x.p }))];
    const lad = ladderMedian(pts);
    const m = lad?.median;
    if (m != null) {
      const fav = m >= 0 ? g.home : g.away;
      spread = { homeMargin: m, favorite: fav.code, line: round(Math.abs(m), 0.5), rungs: lad.rungs };
    } else if (lad) {
      spread = { homeMargin: null, bound: lad.below != null ? `home margin below ${lad.below}` : `home margin above ${lad.above}`, rungs: lad.rungs };
    }
    if (!winProb) {
      const pHome = ladderProbAt(pts, 0);
      if (pHome != null) winProb = { source: 'spread ladder', [g.home.code]: pHome, [g.away.code]: 1 - pHome };
    }
  }

  // Players: merge every player-level series by Kalshi player id.
  const players = new Map();
  const getP = (x) => {
    if (!players.has(x.id)) players.set(x.id, { id: x.id, name: x.name, team: x.team, lines: {}, means: {} });
    const p = players.get(x.id);
    if (!p.team && x.team) p.team = x.team;
    return p;
  };
  for (const k of ['passYds', 'rushYds', 'recYds', 'passAtt', 'rushAtt']) {
    for (const x of parsed[k]) {
      const lad = ladderMedian(x.pts);
      if (lad) getP(x).lines[k] = lad;
    }
  }
  for (const [k, field] of [['rushMean', 'rushYds'], ['recMean', 'recYds']]) for (const x of parsed[k]) getP(x).means[field] = x.mean;

  const [posMap, ...teamSeasons] = await Promise.all([rosterPositions([g.away, g.home]), teamSeason(g.away.id), teamSeason(g.home.id)]);
  const seasonOf = { [g.away.code]: teamSeasons[0], [g.home.code]: teamSeasons[1] };
  const year = g.year || teamSeasons.find(Boolean)?.year || null;
  const rosterOf = (p) => posMap.get(`${p.team}|${normName(p.name)}`) || null;
  const seasons = new Map(
    await Promise.all([...players.values()].map(async (p) => [p.id, year ? await playerSeason(rosterOf(p)?.id, year) : null])),
  );
  const playerList = [...players.values()].map((p) => {
    const rosterPos = rosterOf(p)?.pos || null;
    let pos = POS_GROUP[rosterPos] || null;
    let posSource = pos ? 'roster' : 'markets';
    if (!pos) {
      const rush = lineValue(p.lines.rushYds) ?? p.means.rushYds ?? 0;
      const rec = lineValue(p.lines.recYds) ?? p.means.recYds ?? 0;
      pos = p.lines.passYds || p.lines.passAtt ? 'QB' : rush > rec ? 'RB' : 'WR';
    }
    const ss = seasons.get(p.id);
    const season = ss && ss.gp >= BASELINES.minGames ? ss : null;
    const out = { name: p.name, team: p.team, pos, rosterPos, posSource, season: ss || null };
    for (const [k, l] of Object.entries(p.lines)) {
      out[k] = {
        line: l.median != null ? Math.round(l.median * 10) / 10 : null,
        display: fmtLine(l),
        below: l.below ?? null,
        above: l.above ?? null,
        rungs: l.rungs,
        seasonAvg: season?.[k] ?? null,
      };
    }
    for (const [k, v] of Object.entries(p.means)) {
      out[`${k}Mean`] = Math.round(v);
      // Median off the ladder (thin or one-sided book): show the scalar
      // market's mean instead of a bare bound.
      if (out[k] && out[k].line == null) {
        out[k].display = String(Math.round(v));
        out[k].basis = 'scalar mean';
      }
    }
    for (const k of Object.keys(p.lines)) {
      const v = out[k].line ?? out[`${k}Mean`] ?? null;
      out[k].vs = vsSeason(v, out[k].seasonAvg, k);
    }
    return out;
  });
  // Number used for sums and sorting: the median; when the median is off the
  // ladder, the scalar market's mean if there is one, else a rough bound.
  const val = (p, k) => (p[k] ? (p[k].line ?? p[`${k}Mean`] ?? (p[k].below != null ? p[k].below / 2 : p[k].above)) : null);
  const byPosition = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const key = pos === 'QB' ? 'passYds' : pos === 'RB' ? 'rushYds' : 'recYds';
    byPosition[pos] = playerList.filter((p) => p.pos === pos).sort((a, b) => (val(b, key) ?? -1) - (val(a, key) ?? -1) || a.name.localeCompare(b.name));
  }

  // Team level
  const teamOut = {};
  for (const t of [g.away, g.home]) {
    const tt = parsed.teamTotal.find((x) => x.team === t.code);
    const ty = parsed.teamYds.find((x) => x.team === t.code);
    const ttl = tt ? ladderMedian(tt.pts) : null;
    const tyl = ty ? ladderMedian(ty.pts) : null;
    let points = ttl?.median ?? null;
    let pointsSource = points != null ? 'team total market' : null;
    if (points == null && totalLadder?.median != null && spread?.homeMargin != null) {
      const sign = t === g.home ? 1 : -1;
      points = (totalLadder.median + sign * spread.homeMargin) / 2;
      pointsSource = 'total and spread';
    }
    const mine = playerList.filter((p) => p.team === t.code);
    const qbs = mine.filter((p) => p.pos === 'QB' && p.passYds).sort((a, b) => val(b, 'passYds') - val(a, 'passYds'));
    const qb = qbs[0] || null;
    const rushers = mine.filter((p) => p.rushYds).sort((a, b) => val(b, 'rushYds') - val(a, 'rushYds'));
    const receivers = mine.filter((p) => p.recYds && p.pos !== 'QB').sort((a, b) => val(b, 'recYds') - val(a, 'recYds'));
    // Pass/run tilt: the market's split of priced yards vs the same players'
    // season split. The QB falls back to the team's season passing average
    // (e.g. a new starter); a rusher without a season average is left out of
    // both sides so the comparison stays like for like.
    const ts = seasonOf[t.code];
    const passYds = qb ? val(qb, 'passYds') : null;
    const rushYds = rushers.length ? rushers.reduce((a, r) => a + val(r, 'rushYds'), 0) : null;
    const qbSeasonPass = qb?.passYds?.seasonAvg ?? ts?.passYds ?? null;
    const seasonRushers = rushers.filter((r) => r.rushYds.seasonAvg != null);
    let tilt = null;
    if (passYds != null && rushYds != null && qbSeasonPass != null && seasonRushers.length) {
      const mktCmp = passYds / (passYds + seasonRushers.reduce((a, r) => a + val(r, 'rushYds'), 0));
      const seasonRush = seasonRushers.reduce((a, r) => a + r.rushYds.seasonAvg, 0);
      const typical = qbSeasonPass / (qbSeasonPass + seasonRush);
      const pp = (mktCmp - typical) * 100;
      tilt = {
        passShare: Math.round(mktCmp * 1000) / 1000,
        typicalShare: Math.round(typical * 1000) / 1000,
        seasonPassYds: Math.round(qbSeasonPass),
        seasonRushYds: Math.round(seasonRush),
        qbBaseline: qb?.passYds?.seasonAvg != null ? 'player' : 'team',
        pp: Math.round(pp * 10) / 10,
        lean: pp >= BASELINES.leanPp ? 'pass' : pp <= -BASELINES.leanPp ? 'run' : 'balanced',
      };
    }
    const opp = seasonOf[t === g.home ? g.away.code : g.home.code];
    const expPoints = ts?.pointsFor != null && opp?.pointsAgainst != null ? (ts.pointsFor + opp.pointsAgainst) / 2 : ts?.pointsFor ?? null;
    teamOut[t.code] = {
      code: t.code,
      abbrev: t.abbrev,
      name: t.name,
      shortName: t.shortName,
      logo: t.logo,
      homeAway: t.homeAway,
      winProb: winProb?.[t.code] ?? null,
      points: points != null ? Math.round(points * 10) / 10 : null,
      pointsSource,
      totalYards: tyl?.median != null ? Math.round(tyl.median) : null,
      season: ts,
      expectedPoints: expPoints != null ? Math.round(expPoints * 10) / 10 : null,
      qb: qb
        ? { name: qb.name, passYds: Math.round(passYds), display: qb.passYds.display, passAtt: qb.passAtt?.display ?? null, seasonAvg: qb.passYds.seasonAvg, vs: qb.passYds.vs, gp: qb.season?.gp ?? null }
        : null,
      rushers: rushers.map((r) => ({ name: r.name, pos: r.pos, rushYds: Math.round(val(r, 'rushYds')), display: r.rushYds.display, rushAtt: r.rushAtt?.display ?? null, seasonAvg: r.rushYds.seasonAvg, vs: r.rushYds.vs })),
      receivers: receivers.slice(0, 4).map((r) => ({ name: r.name, pos: r.pos, recYds: Math.round(val(r, 'recYds')), display: r.recYds.display, seasonAvg: r.recYds.seasonAvg, vs: r.recYds.vs })),
      impliedPassYds: passYds != null ? Math.round(passYds) : null,
      impliedRushYds: rushYds != null ? Math.round(rushYds) : null,
      tilt,
    };
  }

  const missing = Object.entries(SERIES)
    .filter(([k]) => !fetched[k].some((m) => m.status === 'active'))
    .map(([, s]) => s.label);

  const lines = {
    total: totalLadder ? { line: totalLadder.median != null ? round(totalLadder.median, 0.5) : null, median: totalLadder.median, display: fmtLine(totalLadder, 0.5), rungs: totalLadder.rungs } : null,
    spread,
    winProb,
  };
  const result = {
    ...base,
    available: true,
    live: g.state === 'in',
    kalshi: {
      suffix,
      events: Object.fromEntries(Object.entries(SERIES).map(([k, s]) => [k, `${s.ticker}-${suffix}`])),
      markets: Object.fromEntries(Object.entries(fetched).map(([k, ms]) => [k, ms.filter((m) => m.status === 'active').length])),
      errors,
    },
    lines,
    teamLines: teamOut,
    players: byPosition,
    missing,
    baselines: BASELINES,
  };
  result.summary = summarize(result, g);
  return result;
}

function pick(t) {
  return { code: t.code, abbrev: t.abbrev, name: t.name, logo: t.logo };
}

// ---- rule-based summary --------------------------------------------------

const yds = (n) => `${Math.round(n)}`;
const approx = (d) => (/^[<>]/.test(String(d)) ? String(d) : `~${d}`);
const pctStr = (p) => `${Math.round(p * 100)}%`;
const last = (name) => String(name || '').replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(' ').slice(-1)[0];

export function summarize(r, g) {
  const B = BASELINES;
  const away = r.teamLines[g.away.code];
  const home = r.teamLines[g.home.code];
  const teams = [away, home];
  const total = r.lines.total?.median ?? null;
  const sp = r.lines.spread;
  const margin = sp?.homeMargin ?? null;
  const fav = margin != null ? (margin >= 0 ? home : away) : r.lines.winProb ? (home.winProb >= away.winProb ? home : away) : null;
  const dog = fav ? (fav === home ? away : home) : null;
  const favProb = fav?.winProb ?? null;
  const absMargin = margin != null ? Math.abs(margin) : null;

  // Season-based expectation: each team's points per game averaged with what
  // the opponent allows per game.
  const expTotal = away.expectedPoints != null && home.expectedPoints != null ? away.expectedPoints + home.expectedPoints : null;
  const highTotal = total != null && expTotal != null && total - expTotal >= B.totalDiff;
  const lowTotal = total != null && expTotal != null && expTotal - total >= B.totalDiff;
  const lopsided = (absMargin != null && absMargin >= B.lopsidedSpread) || (favProb != null && favProb >= B.lopsidedWinProb);
  const close = absMargin != null ? absMargin <= B.closeSpread : favProb != null && favProb < 0.6;
  const qbBig = teams.filter((t) => t.qb?.vs === 'high');
  const qbLow = teams.filter((t) => t.qb?.vs === 'low');
  const leadRb = (t) => t.rushers.find((x) => x.pos !== 'QB') || null;
  const rbBig = teams.filter((t) => leadRb(t)?.vs === 'high');
  const rbLow = teams.filter((t) => leadRb(t)?.vs === 'low');
  const lean = (t) => t.tilt?.lean || null;
  const passLean = teams.filter((t) => lean(t) === 'pass');
  const runLean = teams.filter((t) => lean(t) === 'run');
  const bothQbs = teams.every((t) => t.qb);

  const tags = [];
  if (highTotal) tags.push('high total');
  if (lowTotal) tags.push('low total');
  if (lopsided) tags.push('lopsided');
  if (close) tags.push('close');
  for (const t of passLean) tags.push(`${t.abbrev} pass-leaning`);
  for (const t of runLean) tags.push(`${t.abbrev} run-leaning`);

  // Headline: first rule that fits.
  let headline;
  if (lopsided && fav) {
    headline = `Lopsided: ${fav.shortName || fav.name} controls`;
    if (lean(fav) === 'run' || (leadRb(fav)?.vs === 'high')) headline += ' on the ground';
    else if (lean(dog) === 'pass') headline += `, ${dog.shortName || dog.name} forced to throw`;
  } else if (highTotal && (passLean.length === 2 || (bothQbs && qbBig.length === 2))) headline = 'Pass-heavy shootout';
  else if (highTotal && passLean.length === 1 && runLean.length === 1) headline = `Shootout, contrasting styles: ${passLean[0].abbrev} throws, ${runLean[0].abbrev} runs`;
  else if (highTotal && runLean.length >= 1 && passLean.length === 0) headline = 'High-scoring, run-powered';
  else if (highTotal) headline = 'Shootout expected';
  else if (lowTotal && (runLean.length >= 1 || rbBig.length >= 1) && qbBig.length === 0) headline = 'Run-first grind';
  else if (lowTotal) headline = 'Low-scoring grind';
  else if (passLean.length === 1 && runLean.length === 1) headline = `Contrasting styles: ${passLean[0].abbrev} throws, ${runLean[0].abbrev} runs`;
  else if (passLean.length === 2) headline = 'Air-it-out matchup';
  else if (runLean.length === 2) headline = 'Ground-and-pound matchup';
  else if (close) headline = 'Coin flip, balanced attacks';
  else if (fav) headline = `${fav.shortName || fav.name} modest favorite, balanced script`;
  else headline = 'Thin market: no clear read';

  const narrative = [];
  // 1. Score shape.
  const scoreBits = [];
  if (total != null && expTotal != null) scoreBits.push(`total ~${round(total, 0.5)} (${highTotal ? 'above' : lowTotal ? 'below' : 'in line with'} the ~${round(expTotal, 0.5)} these teams' season scoring points to)`);
  else if (total != null) scoreBits.push(`total ~${round(total, 0.5)}`);
  if (fav && absMargin != null) scoreBits.push(`${fav.shortName || fav.name} favored by ~${round(absMargin, 0.5)}${favProb != null ? ` (${pctStr(favProb)} to win)` : ''}`);
  else if (fav && favProb != null) scoreBits.push(`${fav.shortName || fav.name} ${pctStr(favProb)} to win`);
  if (away.points != null && home.points != null) scoreBits.push(`implied score ${away.abbrev} ${round(away.points, 0.5)}, ${home.abbrev} ${round(home.points, 0.5)}`);
  if (scoreBits.length) narrative.push(`Market prices ${highTotal ? 'more scoring than usual' : lowTotal ? 'less scoring than usual' : expTotal != null ? 'scoring in line with the season' : 'this game'}: ${scoreBits.join('; ')}.`);
  const ptsShift = teams.filter((t) => t.points != null && t.expectedPoints != null && Math.abs(t.points - t.expectedPoints) >= B.teamPointsDiff);
  if (ptsShift.length) {
    narrative.push(
      ptsShift
        .map((t) => `${t.shortName || t.name} implied ~${round(t.points, 0.5)} points vs ~${round(t.expectedPoints, 0.5)} expected from their ${t.season.pointsFor} per game and the opponent allowing ${(t === home ? away : home).season?.pointsAgainst ?? '?'}`)
        .join('; ') + '.',
    );
  }

  // 2. QBs vs RBs, framed by the headline's story.
  const qbVs = (t) => `${last(t.qb.name)} ~${yds(t.qb.passYds)} vs ${yds(t.qb.seasonAvg)} avg`;
  if (bothQbs && qbBig.length === 2) narrative.push(`Both QBs are priced above their season passing averages (${teams.map(qbVs).join(', ')}), so both teams are expected to throw more than usual.`);
  else if (qbLow.length === 2) narrative.push(`Both QBs are priced below their season passing averages (${teams.map(qbVs).join(', ')}).`);
  for (const t of teams) {
    const rb = leadRb(t);
    const bits = [];
    const level = (x) => (x.seasonAvg == null ? ' (no season average)' : x.vs === 'high' ? ` (above his ${yds(x.seasonAvg)} avg)` : x.vs === 'low' ? ` (below his ${yds(x.seasonAvg)} avg)` : ` (≈ his ${yds(x.seasonAvg)} avg)`);
    if (t.qb) bits.push(`${t.qb.name} ${approx(t.qb.display)} pass yds${t.qb.passAtt ? ` on ${approx(t.qb.passAtt)} attempts` : ''}${level(t.qb)}`);
    if (rb) bits.push(`${rb.name} ${approx(rb.display)} rush yds${rb.rushAtt ? ` on ${approx(rb.rushAtt)} carries` : ''}${level(rb)}`);
    if (!bits.length) continue;
    const l = lean(t);
    // NFL team nicknames are plural ("Bengals"), hence the plural verbs.
    const verdict = l === 'pass' ? 'are expected to throw more than usual' : l === 'run' ? 'are expected to run more than usual' : l === 'balanced' ? 'are expected to keep their usual pass/run mix' : 'have an incomplete pass/run picture';
    const tiltNote = t.tilt ? ` (${Math.round(t.tilt.passShare * 100)}% of priced yards through the air vs ${Math.round(t.tilt.typicalShare * 100)}% for the same players this season)` : '';
    narrative.push(`${t.shortName || t.name} ${verdict}${tiltNote}: ${bits.join(', ')}.`);
  }
  if (rbBig.length && !narrative.some((s) => /grind|ground/.test(s))) {
    for (const t of rbBig) if (t === fav && lopsided) narrative.push(`A ${approx(leadRb(t).display)}-yard rushing line for ${leadRb(t).name} fits a favorite expected to protect a lead by running the clock.`);
  }
  if (rbLow.length === 2 && !runLean.length) narrative.push(`Both lead backs are priced below their season rushing averages (${rbLow.map((t) => `${last(leadRb(t).name)} ~${leadRb(t).rushYds} vs ${yds(leadRb(t).seasonAvg)}`).join(', ')}).`);

  // 3. Receivers.
  const recs = teams.flatMap((t) => t.receivers.slice(0, 1).map((x) => ({ ...x, team: t.abbrev }))).filter((x) => x.recYds >= 40);
  if (recs.length) narrative.push(`Top receiving lines: ${recs.map((x) => `${x.name} (${x.team}) ${approx(x.display)}${x.seasonAvg != null ? ` vs ${yds(x.seasonAvg)} avg` : ''}`).join(', ')}.`);

  // 4. What is missing.
  const coreMissing = r.missing.filter((m) => ['player passing yards', 'player rushing yards', 'player receiving yards', 'total points', 'spread'].includes(m));
  if (coreMissing.length) narrative.push(`Thin data: no open Kalshi markets for ${coreMissing.join(', ')}, so parts of this read are incomplete.`);
  const noQb = teams.filter((t) => !t.qb);
  if (noQb.length && !coreMissing.includes('player passing yards')) narrative.push(`No passing-yards ladder for ${noQb.map((t) => t.abbrev).join(' or ')}, so that pass/run tilt is unknown.`);
  if (r.live) narrative.push('The game is in progress: these are in-play prices and already reflect the current score.');

  const keyNumbers = [];
  if (total != null) keyNumbers.push({ label: 'Total', value: String(round(total, 0.5)), note: expTotal != null ? `season-based ~${round(expTotal, 0.5)}` : undefined });
  if (fav && absMargin != null) keyNumbers.push({ label: 'Spread', value: `${fav.abbrev} -${round(absMargin, 0.5)}` });
  if (fav && favProb != null) keyNumbers.push({ label: 'Win prob', value: `${fav.abbrev} ${pctStr(favProb)}`, note: r.lines.winProb?.source !== 'moneyline' ? 'from spread' : undefined });
  for (const t of teams) if (t.points != null) keyNumbers.push({ label: `${t.abbrev} points`, value: String(round(t.points, 0.5)), note: t.expectedPoints != null ? `season-based ~${round(t.expectedPoints, 0.5)}` : undefined });
  for (const t of teams) if (t.qb) keyNumbers.push({ label: `${last(t.qb.name)} pass yds`, value: t.qb.display, note: t.qb.seasonAvg != null ? `season avg ${yds(t.qb.seasonAvg)}` : 'no season avg' });
  for (const t of teams) {
    const rb = leadRb(t);
    if (rb) keyNumbers.push({ label: `${last(rb.name)} rush yds`, value: rb.display, note: rb.seasonAvg != null ? `season avg ${yds(rb.seasonAvg)}` : 'no season avg' });
  }

  const teamTilt = teams.map((t) => ({
    team: t.abbrev,
    name: t.shortName || t.name,
    logo: t.logo,
    passYds: t.impliedPassYds,
    rushYds: t.impliedRushYds,
    passShare: t.tilt?.passShare ?? null,
    typicalShare: t.tilt?.typicalShare ?? null,
    pp: t.tilt?.pp ?? null,
    lean: t.tilt?.lean ?? null,
  }));

  return {
    headline,
    tags,
    narrative,
    teamTilt,
    keyNumbers,
    missing: r.missing,
    method:
      'Implied lines are the 50% point of each Kalshi yes-price ladder (bid/ask midpoint, made monotone, linear between rungs). Baselines are current-season averages from ESPN: each player\'s yards per game played, and each team\'s points per game averaged with what the opponent allows. A line counts as above or below average when it is off by 12% or more (and a few yards). Pass share = QB passing line / (QB line + the listed rushers\' lines), compared with the same players\' season averages.',
    caveat: 'A read of what market prices imply, not a prediction or betting advice.',
  };
}
