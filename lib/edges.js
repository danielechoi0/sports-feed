// Line gaps / +EV finder: the game-winner price of every board game across
// sportsbooks, Kalshi and Polymarket, and where one venue's price is far
// enough from the rest to be worth betting.
//
// Sources (all game winner / moneyline; soccer is three-way with the draw):
//  - Sportsbooks: The Odds API (many books) when ODDS_API_KEY is set,
//    otherwise the one book ESPN carries (DraftKings, pre-game only: ESPN
//    drops odds once an NFL/NBA game starts and keeps a stale line on soccer).
//  - Kalshi: the per-league game series (KXNFLGAME, ...), best bid/ask per team.
//  - Polymarket: the per-league sports series, best bid/ask per outcome.
//
// Method, per game and outcome:
//  - Each source gives a "fair" probability: a book's prices with its margin
//    removed (proportional devig), an exchange's bid/ask midpoints normalized
//    to sum to 1 (skipped when its spread is wide).
//  - Each source also gives a "cost": what $1 of payout costs to buy there now
//    (1 / decimal odds for a book; ask + taker fee for an exchange).
//  - Consensus for one source = median fair of the OTHER sources (leave one
//    out, so a venue is never judged against itself). EV per $1 staked =
//    consensus / cost - 1; it needs at least MIN_OTHERS other sources.
//  - Arbitrage: the cheapest cost of each outcome across venues sums below 1.
import { cached } from './cache.js';
import { SPORT_PATH, soccerPath, scoreboard } from './espn.js';
import { kalshiGet } from './kalshi.js';
import { WHALE_SERIES, matchEvent, nameMatches } from './whales.js';

export const EDGES = {
  minOthers: 2, // other sources needed before an EV is shown
  maxSpread: 0.08, // exchange quotes wider than this don't count toward consensus
  kalshiFeeRate: 0.07, // Kalshi taker fee: 0.07 x P x (1 - P) per contract
  ttlMs: 30_000,
  oddsTtlMs: 10 * 60_000, // The Odds API bills per call; keep its quotes longer
};

const POLY = 'https://gamma-api.polymarket.com';
const ODDS = 'https://api.the-odds-api.com/v4';

// Board league -> Polymarket sport code and The Odds API sport key.
const POLY_SPORT = { nfl: 'nfl', nba: 'nba', 'eng.1': 'epl', 'esp.1': 'lal', 'ger.1': 'bun', 'ita.1': 'sea', 'fra.1': 'fl1', 'uefa.champions': 'ucl', 'uefa.europa': 'uel' };
const ODDS_SPORT = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  'eng.1': 'soccer_epl',
  'esp.1': 'soccer_spain_la_liga',
  'ger.1': 'soccer_germany_bundesliga',
  'ita.1': 'soccer_italy_serie_a',
  'fra.1': 'soccer_france_ligue_one',
  'uefa.champions': 'soccer_uefa_champs_league',
  'uefa.europa': 'soccer_uefa_europa_league',
};

const num = (v) => (v == null || v === '' ? null : Number(v));
const leagueKey = (g) => (g.sport === 'soccer' ? g.league.slug : g.sport);
const outcomeKeys = (g) => (g.sport === 'soccer' ? ['home', 'draw', 'away'] : ['home', 'away']);

// ---- price math ------------------------------------------------------------

export function americanToDecimal(a) {
  const n = typeof a === 'string' ? (/^\s*even\s*$/i.test(a) ? 100 : parseFloat(a)) : a;
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
}

// Kalshi taker fee per contract (Kalshi rounds the order total up to a cent).
export const kalshiFee = (p, rate = EDGES.kalshiFeeRate) => rate * p * (1 - p);
// Polymarket taker fee per share from a market's feeSchedule:
// price x rate x (p(1-p))^exponent.
export const polyFee = (p, s) => (s?.rate ? p * s.rate * (p * (1 - p)) ** (s.exponent ?? 1) : 0);

// { outcome: number } -> same keys scaled to sum to 1; null if any is missing.
export function normalize(probs, keys) {
  const vals = keys.map((k) => probs[k]);
  if (vals.some((v) => !(v > 0))) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, vals[i] / sum]));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// A sportsbook: decimal odds per outcome -> quote.
export function bookQuote(source, decimals, keys, extra = {}) {
  const cost = {};
  for (const k of keys) cost[k] = decimals[k] > 1 ? 1 / decimals[k] : null;
  return { source, kind: 'book', cost, fair: normalize(cost, keys), ...extra };
}

// An exchange: { outcome: { bid, ask, size? } } plus a fee function -> quote.
export function exchangeQuote(source, book, keys, fee, extra = {}) {
  const cost = {};
  const mid = {};
  const size = {};
  let tight = true;
  for (const k of keys) {
    const b = book[k] || {};
    cost[k] = b.ask > 0 && b.ask < 1 ? b.ask + fee(b.ask) : null;
    mid[k] = b.ask > 0 && b.bid > 0 ? (b.ask + b.bid) / 2 : null;
    if (!(b.ask - b.bid <= EDGES.maxSpread)) tight = false;
    size[k] = b.size ?? null;
  }
  return { source, kind: 'exchange', cost, fair: tight ? normalize(mid, keys) : null, ask: Object.fromEntries(keys.map((k) => [k, book[k]?.ask ?? null])), size, ...extra };
}

// quotes -> per outcome: each source's cost, leave-one-out consensus and EV;
// the spread of fair prices across sources; and any arbitrage.
export function analyzeGame(quotes, keys, minOthers = EDGES.minOthers) {
  const outcomes = keys.map((k) => {
    const rows = quotes
      .filter((q) => q.cost[k] != null || q.fair?.[k] != null)
      .map((q) => {
        const others = quotes.filter((o) => o !== q && o.fair?.[k] != null).map((o) => o.fair[k]);
        const consensus = others.length >= minOthers ? median(others) : null;
        const cost = q.cost[k];
        return {
          source: q.source,
          kind: q.kind,
          cost,
          fair: q.fair?.[k] ?? null,
          ask: q.ask?.[k] ?? null,
          size: q.size?.[k] ?? null,
          consensus,
          others: others.length,
          ev: consensus != null && cost > 0 ? consensus / cost - 1 : null,
        };
      });
    const fairs = rows.map((r) => r.fair).filter((v) => v != null);
    const all = fairs.length ? median(fairs) : null;
    const best = rows.filter((r) => r.cost > 0).sort((a, b) => a.cost - b.cost)[0] || null;
    return {
      key: k,
      consensus: all,
      gap: fairs.length >= 2 ? Math.max(...fairs) - Math.min(...fairs) : null,
      best: best && { source: best.source, cost: best.cost },
      quotes: rows,
    };
  });
  const bests = outcomes.map((o) => o.best);
  const total = bests.every(Boolean) ? bests.reduce((a, b) => a + b.cost, 0) : null;
  const arb = total != null && total < 1 ? { total, margin: 1 / total - 1, legs: outcomes.map((o) => ({ key: o.key, ...o.best })) } : null;
  return { outcomes, arb };
}

// ---- sportsbooks -------------------------------------------------------------

// ESPN's DraftKings moneyline from a scoreboard event (current prices).
export function espnBookQuote(ev, keys) {
  const ml = ev?.competitions?.[0]?.odds?.[0]?.moneyline;
  if (!ml) return null;
  const dec = {};
  for (const k of keys) dec[k] = americanToDecimal(ml[k]?.close?.odds ?? ml[k]?.current?.odds);
  if (keys.some((k) => dec[k] == null)) return null;
  const name = String(ev.competitions[0].odds[0].provider?.name || 'Sportsbook').replace(/^Draft Kings$/i, 'DraftKings');
  return bookQuote(name, dec, keys, { via: 'ESPN' });
}

// The Odds API event -> one quote per bookmaker, sides mapped to the board game.
export function oddsApiQuotes(ev, g, keys) {
  const side = (name) => (/^draw$/i.test(name) ? 'draw' : nameMatches(name, g.home) ? 'home' : nameMatches(name, g.away) ? 'away' : null);
  const out = [];
  for (const bk of ev.bookmakers || []) {
    // Kalshi / Polymarket come straight from their own APIs; a second copy
    // from an exchange region would be judged against itself.
    if (/kalshi|polymarket/i.test(`${bk.key} ${bk.title}`)) continue;
    const h2h = (bk.markets || []).find((m) => m.key === 'h2h');
    if (!h2h) continue;
    const dec = {};
    for (const o of h2h.outcomes || []) {
      const k = side(o.name);
      if (k) dec[k] = num(o.price);
    }
    if (keys.some((k) => !(dec[k] > 1))) continue;
    out.push(bookQuote(bk.title || bk.key, dec, keys, { updated: bk.last_update || null }));
  }
  return out;
}

const near = (iso, g, hours = 12) => Math.abs(Date.parse(iso) - Date.parse(g.date)) <= hours * 3600_000;

export function matchOddsApiEvent(events, g) {
  return (
    (events || []).find(
      (e) => near(e.commence_time, g) && nameMatches(e.home_team, g.home) && nameMatches(e.away_team, g.away),
    ) || null
  );
}

async function oddsApiLeague(league) {
  const key = process.env.ODDS_API_KEY;
  const sport = ODDS_SPORT[league];
  if (!key || !sport) return null;
  const regions = process.env.ODDS_API_REGIONS || 'us';
  return cached(`edges:odds:${sport}:${regions}`, EDGES.oddsTtlMs, async () => {
    const res = await fetch(`${ODDS}/sports/${sport}/odds?regions=${encodeURIComponent(regions)}&markets=h2h&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`The Odds API ${res.status}`);
    return res.json();
  });
}

// ---- Kalshi ------------------------------------------------------------------

async function kalshiSeries(series) {
  return cached(`edges:kalshi:${series}`, EDGES.ttlMs, async () => {
    const out = [];
    let cursor = '';
    for (let page = 0; page < 3; page++) {
      const d = await kalshiGet(`/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const e of d.events || []) {
        out.push({
          ticker: e.event_ticker,
          title: e.title,
          markets: (e.markets || [])
            .filter((m) => m.status === 'active')
            .map((m) => ({
              ticker: m.ticker,
              code: m.ticker.split('-').pop(),
              name: m.yes_sub_title || m.title || '',
              bid: num(m.yes_bid_dollars),
              ask: num(m.yes_ask_dollars),
              size: num(m.yes_ask_size_fp),
            })),
        });
      }
      cursor = d.cursor;
      if (!cursor || !(d.events || []).length) break;
    }
    return out;
  });
}

export function kalshiQuote(events, g, series, keys) {
  const match = matchEvent(events, g, series);
  if (!match) return null;
  const book = {};
  for (const m of match.event.markets) {
    const side = match.sides.get(m.ticker);
    const k = side === 'tie' ? 'draw' : side;
    if (k && keys.includes(k)) book[k] = { bid: m.bid, ask: m.ask, size: m.size };
  }
  if (keys.some((k) => !book[k])) return null;
  return exchangeQuote('Kalshi', book, keys, kalshiFee, { ref: match.event.ticker });
}

// ---- Polymarket -----------------------------------------------------------------

async function polyGet(pathAndQuery) {
  const res = await fetch(`${POLY}${pathAndQuery}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Polymarket ${res.status}`);
  return res.json();
}

// Polymarket's series ids change by season, so look them up by sport code.
async function polySeriesIds() {
  return cached('edges:poly:sports', 12 * 3600_000, async () => {
    const list = await polyGet('/sports');
    return Object.fromEntries((list || []).map((s) => [s.sport, String(s.series || '').split(',')[0]]));
  });
}

async function polyEvents(league, date) {
  const code = POLY_SPORT[league];
  if (!code) return [];
  const series = (await polySeriesIds())[code];
  if (!series) return [];
  const day = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8));
  const from = new Date(day - 86400_000).toISOString();
  const to = new Date(day + 2 * 86400_000).toISOString();
  return cached(`edges:poly:${series}:${date}`, EDGES.ttlMs, async () => {
    const list = await polyGet(`/events?series_id=${series}&closed=false&limit=200&end_date_min=${from}&end_date_max=${to}`);
    // Keep only each game's main event (the one with the moneyline markets).
    return list
      .map((e) => ({
        slug: e.slug,
        title: e.title,
        start: e.startTime || e.endDate,
        teams: e.teams || [],
        markets: (e.markets || []).filter((m) => m.sportsMarketType === 'moneyline' && !m.closed && m.acceptingOrders !== false),
      }))
      .filter((e) => e.markets.length);
  });
}

const polyTeamMatches = (name, t) => nameMatches(name, t);
const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(v || '[]');
  } catch {
    return [];
  }
};

// One Polymarket game event -> { outcome: { bid, ask } } on the board game's
// sides. Two-way games are one market whose first outcome carries bestBid /
// bestAsk (the second outcome is the mirror). Soccer is one Yes/No market per
// team plus one for the draw.
export function polyBook(e, g, keys) {
  const book = {};
  let schedule = null;
  for (const m of e.markets) {
    schedule = schedule || m.feeSchedule || null;
    const bid = num(m.bestBid);
    const ask = num(m.bestAsk);
    const outcomes = parseList(m.outcomes);
    if (keys.includes('draw')) {
      const title = String(m.groupItemTitle || m.question || '');
      const k = /^draw\b/i.test(title) ? 'draw' : polyTeamMatches(title, g.home) ? 'home' : polyTeamMatches(title, g.away) ? 'away' : null;
      if (k) book[k] = { bid, ask };
    } else if (outcomes.length === 2) {
      const first = polyTeamMatches(outcomes[0], g.home) ? 'home' : polyTeamMatches(outcomes[0], g.away) ? 'away' : null;
      if (!first) continue;
      const second = first === 'home' ? 'away' : 'home';
      book[first] = { bid, ask };
      book[second] = { bid: ask != null ? 1 - ask : null, ask: bid != null ? 1 - bid : null };
    }
  }
  return { book, schedule };
}

export function matchPolyEvent(events, g) {
  return (
    events.find((e) => {
      if (!near(e.start, g)) return false;
      const names = e.teams.map((t) => [t.name, t.alias]);
      const has = (team) => names.some((ns) => ns.some((n) => n && polyTeamMatches(n, team)));
      if (names.length) return has(g.home) && has(g.away);
      // No team list: both sides of "A vs. B" must be the game's two teams.
      const [a, b] = String(e.title || '').split(/\s+vs\.?\s+/i);
      return !!a && !!b && ((polyTeamMatches(a, g.home) && polyTeamMatches(b, g.away)) || (polyTeamMatches(a, g.away) && polyTeamMatches(b, g.home)));
    }) || null
  );
}

export function polyQuote(events, g, keys) {
  const e = matchPolyEvent(events, g);
  if (!e) return null;
  const { book, schedule } = polyBook(e, g, keys);
  if (keys.some((k) => !book[k])) return null;
  return exchangeQuote('Polymarket', book, keys, (p) => polyFee(p, schedule), { ref: e.slug });
}

// ---- day entry point ---------------------------------------------------------------

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

// games: the board's games for `date` (from the day build). Final games are skipped.
export async function dayEdges(date, games) {
  const open = games.filter((g) => g.status.state !== 'post');
  const leagues = [...new Set(open.map(leagueKey))];
  const errors = [];
  const usingOddsApi = !!process.env.ODDS_API_KEY;

  const perLeague = new Map();
  await Promise.all(
    leagues.map(async (lg) => {
      const sample = open.find((g) => leagueKey(g) === lg);
      const path = sample.sport === 'soccer' ? soccerPath(lg) : SPORT_PATH[sample.sport];
      const series = WHALE_SERIES[lg];
      const [espn, kalshi, poly, odds] = await Promise.all([
        settle(scoreboard(path, date)),
        settle(series ? kalshiSeries(series) : Promise.resolve([])),
        settle(polyEvents(lg, date)),
        settle(oddsApiLeague(lg)),
      ]);
      for (const [name, r] of [['ESPN', espn], ['Kalshi', kalshi], ['Polymarket', poly], ['The Odds API', odds]]) {
        if (!r.ok) errors.push({ league: lg, source: name, message: r.e.message });
      }
      perLeague.set(lg, {
        series,
        espn: espn.ok ? espn.v.events || [] : [],
        kalshi: kalshi.ok ? kalshi.v : [],
        poly: poly.ok ? poly.v : [],
        odds: odds.ok ? odds.v : null,
      });
    }),
  );

  const out = open.map((g) => {
    const src = perLeague.get(leagueKey(g));
    const keys = outcomeKeys(g);
    const quotes = [];
    const oddsEv = src.odds ? matchOddsApiEvent(src.odds, g) : null;
    if (oddsEv) quotes.push(...oddsApiQuotes(oddsEv, g, keys));
    // ESPN's book only before kickoff (it keeps showing the pre-game line on
    // some live games) and only when The Odds API doesn't already carry it.
    const espnQ = g.status.state === 'pre' && espnBookQuote(src.espn.find((e) => String(e.id) === String(g.id)), keys);
    if (espnQ && !quotes.some((q) => q.source.toLowerCase() === espnQ.source.toLowerCase())) quotes.push(espnQ);
    const k = src.series ? kalshiQuote(src.kalshi, g, src.series, keys) : null;
    if (k) quotes.push(k);
    const p = polyQuote(src.poly, g, keys);
    if (p) quotes.push(p);
    const a = analyzeGame(quotes, keys);
    return {
      id: g.id,
      sport: g.sport,
      league: g.league,
      date: g.date,
      state: g.status.state,
      clock: g.status.shortDetail || null,
      home: { name: g.home.name, shortName: g.home.shortName, abbrev: g.home.abbrev, logo: g.home.logo },
      away: { name: g.away.name, shortName: g.away.shortName, abbrev: g.away.abbrev, logo: g.away.logo },
      sources: quotes.map((q) => q.source),
      refs: { kalshi: k?.ref || null, polymarket: p?.ref || null },
      ...a,
    };
  });

  return {
    date,
    generatedAt: new Date().toISOString(),
    books: usingOddsApi ? 'The Odds API' : 'ESPN (DraftKings only)',
    settings: { minOthers: EDGES.minOthers, maxSpread: EDGES.maxSpread, kalshiFeeRate: EDGES.kalshiFeeRate },
    errors,
    games: out,
  };
}
