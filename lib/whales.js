// Large ("whale") trades on the Kalshi game-winner market of one board game.
//
// Kalshi's public trade feed reports fills, not orders: one big market order
// that sweeps several price levels shows up as many fills with the same
// timestamp. Fills on the same market, same taker side and same second are
// grouped back into one order, and an order's size is what the taker paid:
// contracts x the price of the side they bought (YES or NO).
//
// Each game is one Kalshi event in a per-league series (KXNFLGAME-26NOV08DALIND)
// with one market per team (plus TIE in soccer). The event is matched to the
// ESPN game by date (US Eastern, +/- one day) and team, by code or by name.
import { cached } from './cache.js';
import { SPORT_PATH, soccerPath, summary } from './espn.js';
import { espnGame, kalshiDate, kalshiGet } from './kalshi.js';

// Board league -> Kalshi game-winner series.
export const WHALE_SERIES = {
  nfl: 'KXNFLGAME',
  nba: 'KXNBAGAME',
  'eng.1': 'KXEPLGAME',
  'esp.1': 'KXLALIGAGAME',
  'ger.1': 'KXBUNDESLIGAGAME',
  'ita.1': 'KXSERIEAGAME',
  'fra.1': 'KXLIGUE1GAME',
  'uefa.champions': 'KXUCLGAME',
  'uefa.europa': 'KXUELGAME',
};

export const WHALES = {
  floor: 500, // orders below this many dollars are dropped server-side; the page filters higher
  beforeMs: 3 * 3600_000, // trades from this long before kickoff (or before now, for a game still ahead)
  maxPages: 6, // 1,000 fills per page; a busy NFL market trades ~1,000 times an hour
  tradesTtlMs: 45_000,
  listTtlMs: 10 * 60_000,
  maxOrders: 300, // largest orders kept per game
};

// ESPN and Kalshi team codes that differ (NFL and NBA).
const CODE_ALIAS = { WSH: 'WAS', JAX: 'JAC', LA: 'LAR', GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA' };
const codeOf = (c) => {
  const u = String(c || '').toUpperCase();
  return CODE_ALIAS[u] || u;
};

const num = (v) => (v == null || v === '' ? null : Number(v));

// ---- matching ------------------------------------------------------------

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'ssc', 'cd', 'ud', 'rcd', 'club', 'de', 'the', 'calcio']);
export function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .join(' ');
}

// Kalshi names are often a city or a short form ("Los Angeles L", "Inter",
// "Golden State"); ESPN's are full names. Match exact, word prefix, or a
// prefix of at least five letters either way.
export function nameMatches(kalshiName, team) {
  const k = normName(kalshiName);
  if (!k) return false;
  return [team.name, team.shortName].some((n) => {
    const e = normName(n);
    if (!e) return false;
    if (e === k || e.startsWith(`${k} `) || k.startsWith(`${e} `)) return true;
    return (e.startsWith(k) && k.length >= 5) || (k.startsWith(e) && e.length >= 5);
  });
}

function teamMatches(market, team) {
  if (market.code && [team.code, team.abbrev].some((c) => c && codeOf(c) === market.code)) return true;
  return nameMatches(market.name, team);
}

// events: [{ ticker, title, markets: [{ ticker, code, name }] }]
// g: { date, home: { name, shortName, abbrev, code }, away: {...} }
// -> { event, sides: Map(market ticker -> 'home' | 'away' | 'tie') } or null
export function matchEvent(events, g, series) {
  const days = [0, -1, 1].map((s) => kalshiDate(g.date, s));
  let best = null;
  for (const e of events) {
    const m = new RegExp(`^${series}-(\\d{2}[A-Z]{3}\\d{2})`).exec(e.ticker);
    const dayRank = m ? days.indexOf(m[1]) : -1;
    if (dayRank < 0) continue;
    const sides = new Map();
    const teams = { home: g.home, away: g.away };
    for (const mk of e.markets) {
      if (mk.code === 'TIE') {
        sides.set(mk.ticker, 'tie');
        continue;
      }
      const hits = Object.keys(teams).filter((k) => teamMatches(mk, teams[k]));
      if (hits.length === 1) sides.set(mk.ticker, hits[0]);
    }
    const used = new Set(sides.values());
    const matched = ['home', 'away'].filter((k) => used.has(k)).length;
    // A neighbouring day needs both teams (back-to-backs); the same day needs one.
    if (!matched || (dayRank > 0 && matched < 2)) continue;
    // One team matched: the one remaining team market is the other side.
    const rest = e.markets.filter((mk) => !sides.has(mk.ticker));
    const missing = ['home', 'away'].filter((k) => !used.has(k));
    if (rest.length === 1 && missing.length === 1) sides.set(rest[0].ticker, missing[0]);
    const score = matched * 10 - dayRank;
    if (!best || score > best.score) best = { score, event: e, sides };
  }
  return best && { event: best.event, sides: best.sides };
}

async function eventPages(query, maxPages = 5) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const d = await kalshiGet(`/events?${query}&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const e of d.events || []) {
      out.push({
        ticker: e.event_ticker,
        title: e.title,
        markets: (e.markets || []).map((m) => ({ ticker: m.ticker, code: m.ticker.split('-').pop(), name: m.yes_sub_title || m.title || '' })),
      });
    }
    cursor = d.cursor;
    if (!cursor || !(d.events || []).length) break;
  }
  return out;
}

// Open and closed events, plus events settled since the day before kickoff
// (settled lists come newest first, so finished games on the board are near
// the top).
async function seriesEvents(series, kickoffIso) {
  const since = Math.floor(Date.parse(kickoffIso) / 1000) - 86400;
  const [open, closed, settled] = await Promise.all([
    cached(`whales:events:${series}:open`, WHALES.listTtlMs, () => eventPages(`series_ticker=${series}&status=open`)),
    cached(`whales:events:${series}:closed`, WHALES.listTtlMs, () => eventPages(`series_ticker=${series}&status=closed`)),
    cached(`whales:events:${series}:settled:${kalshiDate(kickoffIso)}`, WHALES.listTtlMs, () =>
      eventPages(`series_ticker=${series}&status=settled&min_close_ts=${since}`),
    ),
  ]);
  const seen = new Map();
  for (const e of [...open, ...closed, ...settled]) if (!seen.has(e.ticker)) seen.set(e.ticker, e);
  return [...seen.values()];
}

// ---- trades -> orders ----------------------------------------------------

// One fill -> { id, side, sec (unix seconds), time, contracts, price, notional, block }
export function fillOf(t) {
  const side = t.taker_side || t.taker_outcome_side;
  if (side !== 'yes' && side !== 'no') return null;
  const contracts = num(t.count_fp) ?? num(t.count);
  const yes = num(t.yes_price_dollars) ?? (t.yes_price != null ? t.yes_price / 100 : null);
  const no = num(t.no_price_dollars) ?? (t.no_price != null ? t.no_price / 100 : yes != null ? 1 - yes : null);
  const price = side === 'yes' ? yes : no;
  const ms = Date.parse(t.created_time);
  if (!t.trade_id || !(contracts > 0) || price == null || !Number.isFinite(ms)) return null;
  return {
    id: t.trade_id,
    side,
    sec: Math.floor(ms / 1000),
    time: new Date(ms).toISOString(),
    contracts,
    price,
    notional: contracts * price,
    block: !!t.is_block_trade,
  };
}

// Merge fills into an order map keyed by taker side + second.
export function addFills(orders, fills) {
  for (const f of fills) {
    const key = `${f.side}|${f.sec}`;
    const o = orders.get(key);
    if (!o) {
      orders.set(key, { side: f.side, sec: f.sec, time: f.time, contracts: f.contracts, notional: f.notional, fills: 1, block: f.block });
    } else {
      o.contracts += f.contracts;
      o.notional += f.notional;
      o.fills += 1;
      o.block = o.block || f.block;
      if (f.time < o.time) o.time = f.time;
    }
  }
  return orders;
}

// Per market "book": orders seen so far and where to resume. Fetches after the
// first ask only for fills since the newest second already seen (min_ts is
// inclusive); fills in that second are remembered by id so they aren't counted
// twice.
export function newBook(fromSec) {
  return { fromSec, newestSec: null, edgeIds: new Set(), orders: new Map(), partial: false, at: 0, pending: null, used: Date.now() };
}

// Merge one fetch's raw trades into a book. Pure apart from mutating `b`.
export function mergeTrades(b, raw, floor = WHALES.floor) {
  const fills = [];
  const seen = new Set();
  for (const t of raw) {
    const f = fillOf(t);
    if (!f || b.edgeIds.has(f.id) || seen.has(f.id)) continue;
    seen.add(f.id);
    fills.push(f);
  }
  addFills(b.orders, fills);
  const newest = fills.reduce((m, f) => Math.max(m, f.sec), -Infinity);
  if (Number.isFinite(newest) && newest >= (b.newestSec ?? -Infinity)) {
    const ids = fills.filter((f) => f.sec === newest).map((f) => f.id);
    b.edgeIds = new Set(newest === b.newestSec ? [...b.edgeIds, ...ids] : ids);
    b.newestSec = newest;
  }
  // Keep small orders only in the newest second, where more fills may still arrive.
  for (const [k, o] of b.orders) if (o.notional < floor && o.sec !== b.newestSec) b.orders.delete(k);
  return b;
}

const books = new Map();
const BOOK_IDLE_MS = 6 * 3600_000;

async function marketOrders(ticker, fromSec) {
  const now = Date.now();
  for (const [k, v] of books) if (now - v.used > BOOK_IDLE_MS && !v.pending) books.delete(k);
  let b = books.get(ticker);
  if (!b || (fromSec < b.fromSec && !b.pending)) books.set(ticker, (b = newBook(fromSec)));
  b.used = now;
  if (b.pending) return b.pending; // another request is already fetching this market
  if (now - b.at < WHALES.tradesTtlMs) return b;

  b.pending = (async () => {
    const raw = [];
    let cursor = '';
    let pages = 0;
    const minTs = b.newestSec ?? b.fromSec;
    do {
      const d = await kalshiGet(`/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=1000&min_ts=${minTs}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      raw.push(...(d.trades || []));
      cursor = d.cursor;
      pages++;
    } while (cursor && pages < WHALES.maxPages);
    if (cursor) b.partial = true; // older fills in this window were not loaded
    mergeTrades(b, raw);
    b.at = Date.now();
    return b;
  })();
  try {
    return await b.pending;
  } finally {
    b.pending = null;
  }
}

// ---- entry point -----------------------------------------------------------

export async function gameWhales(sport, league, id) {
  const series = WHALE_SERIES[sport === 'soccer' ? league : sport];
  if (!series) return { available: false, reason: 'Kalshi has no game market for this league.' };
  const path = sport === 'soccer' ? soccerPath(league) : SPORT_PATH[sport];
  const g = espnGame(await summary(path, id), id);
  if (!g) throw new Error(`No ESPN game ${id}`);

  const events = await seriesEvents(series, g.date);
  const match = matchEvent(events, g, series);
  if (!match) return { available: false, reason: 'No matching Kalshi market found.' };

  const fromMs = Math.min(Date.parse(g.date), Date.now()) - WHALES.beforeMs;
  const fromSec = Math.floor(fromMs / 1000);
  const markets = match.event.markets.filter((m) => match.sides.has(m.ticker));
  const perMarket = await Promise.all(markets.map((m) => marketOrders(m.ticker, fromSec)));

  const orders = [];
  markets.forEach((m, i) => {
    for (const o of perMarket[i].orders.values()) {
      if (o.notional < WHALES.floor || Date.parse(o.time) < fromMs) continue;
      orders.push({
        market: m.ticker,
        team: match.sides.get(m.ticker),
        label: m.name,
        side: o.side,
        contracts: Math.round(o.contracts * 100) / 100,
        price: o.notional / o.contracts,
        notional: Math.round(o.notional * 100) / 100,
        fills: o.fills,
        block: o.block,
        time: o.time,
      });
    }
  });
  orders.sort((a, b) => b.notional - a.notional);
  const kept = orders.slice(0, WHALES.maxOrders).sort((a, b) => b.time.localeCompare(a.time));

  return {
    available: true,
    event: { ticker: match.event.ticker, title: match.event.title },
    floor: WHALES.floor,
    from: new Date(fromMs).toISOString(),
    partial: perMarket.some((b) => b.partial),
    orders: kept,
  };
}
