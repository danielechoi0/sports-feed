// Pure parts of the whale-trade feed: fill parsing, grouping fills into
// orders, and matching a Kalshi event to a board game. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFills, fillOf, matchEvent, mergeTrades, nameMatches, newBook, normName } from '../lib/whales.js';

const S52 = Date.parse('2026-11-08T16:50:52Z') / 1000;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const trade = (o) => ({
  trade_id: o.id,
  taker_side: o.side,
  count_fp: String(o.count),
  yes_price_dollars: String(o.yes),
  no_price_dollars: String(1 - o.yes),
  created_time: o.time,
  is_block_trade: !!o.block,
});

test('fillOf prices a fill at the side the taker bought', () => {
  const yes = fillOf(trade({ id: 'a', side: 'yes', count: 100, yes: 0.62, time: '2026-11-08T16:50:52.702Z' }));
  near(yes.price, 0.62);
  near(yes.notional, 62);
  assert.equal(yes.sec, Date.parse('2026-11-08T16:50:52Z') / 1000);
  const no = fillOf(trade({ id: 'b', side: 'no', count: 100, yes: 0.62, time: '2026-11-08T16:50:52.702Z' }));
  near(no.price, 0.38);
  near(no.notional, 38);
  // Older integer-cent fields still work.
  const cents = fillOf({ trade_id: 'c', taker_side: 'yes', count: 10, yes_price: 40, created_time: '2026-11-08T16:00:00Z' });
  near(cents.notional, 4);
  assert.equal(fillOf({ trade_id: 'd', taker_side: 'yes', count_fp: '0', yes_price_dollars: '0.5', created_time: '2026-11-08T16:00:00Z' }), null);
  assert.equal(fillOf({ taker_side: 'yes', count_fp: '1', yes_price_dollars: '0.5', created_time: '2026-11-08T16:00:00Z' }), null); // no trade id
});

test('addFills groups same side + exact same timestamp into one order', () => {
  const T = '2026-11-08T16:50:52.100437Z'; // one order sweeping two price levels
  const fills = [
    { id: 1, side: 'yes', count: 1000, yes: 0.5, time: T },
    { id: 2, side: 'yes', count: 2000, yes: 0.51, time: T, block: true },
    { id: 3, side: 'no', count: 500, yes: 0.5, time: T }, // other side: separate
    { id: 4, side: 'yes', count: 300, yes: 0.5, time: '2026-11-08T16:50:52.100438Z' }, // 1 µs later, same second: another trader
  ].map((t) => fillOf(trade(t)));
  const orders = addFills(new Map(), fills);
  assert.equal(orders.size, 3);
  const big = orders.get(`yes|${T}`);
  assert.equal(big.fills, 2);
  assert.equal(big.contracts, 3000);
  near(big.notional, 500 + 1020);
  assert.equal(big.block, true);
  assert.equal(orders.get('yes|2026-11-08T16:50:52.100438Z').fills, 1);
  // A fill with the same stamp arriving in a later fetch joins the same order.
  addFills(orders, [fillOf(trade({ id: 5, side: 'yes', count: 100, yes: 0.5, time: T }))]);
  assert.equal(orders.get(`yes|${T}`).fills, 3);
});

test('nameMatches handles city names, short forms and accents', () => {
  const lakers = { name: 'Los Angeles Lakers', shortName: 'Lakers' };
  const clippers = { name: 'LA Clippers', shortName: 'Clippers' };
  assert.ok(nameMatches('Los Angeles L', lakers));
  assert.ok(!nameMatches('Los Angeles L', clippers));
  assert.ok(nameMatches('Atlético Madrid', { name: 'Atletico Madrid', shortName: 'Atlético' }));
  assert.ok(nameMatches('Inter', { name: 'Internazionale', shortName: 'Internazionale' }));
  assert.ok(nameMatches('Manchester United', { name: 'Manchester United', shortName: 'Man United' }));
  assert.ok(!nameMatches('Manchester City', { name: 'Manchester United', shortName: 'Man United' }));
  assert.equal(normName('AFC Bournemouth'), 'bournemouth');
});

const team = (name, abbrev, homeAway) => ({ name, shortName: name, abbrev, code: abbrev, homeAway });

test('matchEvent finds the event by date and team and assigns each market a side', () => {
  const g = { date: '2026-11-08T21:25:00Z', away: team('Los Angeles Rams', 'LAR', 'away'), home: team('Washington Commanders', 'WSH', 'home') };
  const events = [
    { ticker: 'KXNFLGAME-26NOV08DALIND', markets: [{ ticker: 'KXNFLGAME-26NOV08DALIND-DAL', code: 'DAL', name: 'Dallas' }, { ticker: 'KXNFLGAME-26NOV08DALIND-IND', code: 'IND', name: 'Indianapolis' }] },
    { ticker: 'KXNFLGAME-26NOV08LARWAS', markets: [{ ticker: 'KXNFLGAME-26NOV08LARWAS-LAR', code: 'LAR', name: 'Los Angeles R' }, { ticker: 'KXNFLGAME-26NOV08LARWAS-WAS', code: 'WAS', name: 'Washington' }] },
  ];
  const m = matchEvent(events, g, 'KXNFLGAME');
  assert.equal(m.event.ticker, 'KXNFLGAME-26NOV08LARWAS');
  assert.equal(m.sides.get('KXNFLGAME-26NOV08LARWAS-LAR'), 'away');
  assert.equal(m.sides.get('KXNFLGAME-26NOV08LARWAS-WAS'), 'home'); // WSH -> WAS alias
});

test('matchEvent: soccer by name, tie market, and the other side filled in', () => {
  // ESPN calls the club "Internazionale"; Kalshi's code is INT and name "Inter".
  const g = { date: '2026-11-08T19:45:00Z', away: team('Como', 'COMO', 'away'), home: team('Internazionale', 'INT', 'home') };
  const events = [
    {
      ticker: 'KXSERIEAGAME-26NOV08INTCOM',
      markets: [
        { ticker: 'KXSERIEAGAME-26NOV08INTCOM-INT', code: 'INT', name: 'Inter' },
        { ticker: 'KXSERIEAGAME-26NOV08INTCOM-COM', code: 'COM', name: 'Como 1907' },
        { ticker: 'KXSERIEAGAME-26NOV08INTCOM-TIE', code: 'TIE', name: 'Tie' },
      ],
    },
  ];
  const m = matchEvent(events, g, 'KXSERIEAGAME');
  assert.equal(m.sides.get('KXSERIEAGAME-26NOV08INTCOM-INT'), 'home');
  assert.equal(m.sides.get('KXSERIEAGAME-26NOV08INTCOM-COM'), 'away');
  assert.equal(m.sides.get('KXSERIEAGAME-26NOV08INTCOM-TIE'), 'tie');
});

test('matchEvent ignores events on other dates', () => {
  const g = { date: '2026-11-08T19:45:00Z', away: team('Fulham', 'FUL', 'away'), home: team('Manchester City', 'MNC', 'home') };
  const events = [{ ticker: 'KXEPLGAME-26NOV21MCIFUL', markets: [{ ticker: 'KXEPLGAME-26NOV21MCIFUL-MCI', code: 'MCI', name: 'Manchester City' }, { ticker: 'KXEPLGAME-26NOV21MCIFUL-FUL', code: 'FUL', name: 'Fulham' }] }];
  assert.equal(matchEvent(events, g, 'KXEPLGAME'), null);
});

test('mergeTrades: re-fetching the edge second never double counts', () => {
  const b = newBook(0);
  const T52 = '2026-11-08T16:50:52.100437Z';
  const t1 = trade({ id: 'a', side: 'yes', count: 1000, yes: 0.5, time: '2026-11-08T16:50:51.100Z' });
  const t2 = trade({ id: 'b', side: 'yes', count: 1000, yes: 0.5, time: T52 });
  mergeTrades(b, [t2, t1], 100);
  assert.equal(b.newestSec, S52);
  // Next fetch uses min_ts = newestSec, so t2 comes back again with a late fill of the same order.
  const t3 = trade({ id: 'c', side: 'yes', count: 1000, yes: 0.5, time: T52 });
  mergeTrades(b, [t3, t2], 100);
  const o = b.orders.get(`yes|${T52}`);
  assert.equal(o.fills, 2);
  near(o.notional, 1000);
  // The same fetch twice (overlapping requests) changes nothing.
  mergeTrades(b, [t3, t2], 100);
  assert.equal(b.orders.get(`yes|${T52}`).fills, 2);
  // A later second moves the edge; the old edge ids are dropped.
  const t4 = trade({ id: 'd', side: 'no', count: 10, yes: 0.5, time: '2026-11-08T16:50:53.000Z' });
  mergeTrades(b, [t4, t3], 100);
  assert.equal(b.newestSec, S52 + 1);
  assert.deepEqual([...b.edgeIds], ['d']);
  assert.equal(b.orders.get(`yes|${T52}`).fills, 2); // t3 came back again but was still an edge id
});

test('mergeTrades drops small orders except in the newest second', () => {
  const b = newBook(0);
  mergeTrades(b, [
    trade({ id: 'a', side: 'yes', count: 10, yes: 0.5, time: '2026-11-08T16:50:51.000Z' }), // $5, old: dropped
    trade({ id: 'b', side: 'yes', count: 10, yes: 0.5, time: '2026-11-08T16:50:52.000Z' }), // $5, newest: kept for now
  ], 100);
  assert.equal(b.orders.size, 1);
  assert.ok(b.orders.has('yes|2026-11-08T16:50:52.000Z'));
});

test('matchEvent needs both teams on a neighbouring day', () => {
  const g = { date: '2026-11-08T23:00:00Z', away: team('Boston Celtics', 'BOS', 'away'), home: team('Milwaukee Bucks', 'MIL', 'home') };
  // The day before: Milwaukee played someone else.
  const events = [{ ticker: 'KXNBAGAME-26NOV07MILCHI', markets: [{ ticker: 'KXNBAGAME-26NOV07MILCHI-MIL', code: 'MIL', name: 'Milwaukee' }, { ticker: 'KXNBAGAME-26NOV07MILCHI-CHI', code: 'CHI', name: 'Chicago' }] }];
  assert.equal(matchEvent(events, g, 'KXNBAGAME'), null);
});
