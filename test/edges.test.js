// Line gaps: price math, leave-one-out EV, arbitrage and venue matching. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToDecimal,
  analyzeGame,
  bookQuote,
  espnBookQuote,
  exchangeQuote,
  kalshiFee,
  matchOddsApiEvent,
  matchPolyEvent,
  oddsApiQuotes,
  polyBook,
  polyFee,
} from '../lib/edges.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const TWO = ['home', 'away'];
const THREE = ['home', 'draw', 'away'];

const nfl = {
  date: '2026-11-08T21:25Z',
  sport: 'nfl',
  home: { name: 'New England Patriots', shortName: 'Patriots', abbrev: 'NE' },
  away: { name: 'Green Bay Packers', shortName: 'Packers', abbrev: 'GB' },
};
const epl = {
  date: '2026-11-21T12:30Z',
  sport: 'soccer',
  home: { name: 'Manchester City', shortName: 'Man City', abbrev: 'MNC' },
  away: { name: 'Fulham', shortName: 'Fulham', abbrev: 'FUL' },
};

test('americanToDecimal handles favourites, underdogs and even', () => {
  near(americanToDecimal('-200'), 1.5);
  near(americanToDecimal('+150'), 2.5);
  near(americanToDecimal('EVEN'), 2);
  assert.equal(americanToDecimal('n/a'), null);
});

test('fees: Kalshi 0.07 p(1-p); Polymarket p x rate x (p(1-p))^exp', () => {
  near(kalshiFee(0.5), 0.0175);
  near(polyFee(0.5, { rate: 0.03, exponent: 1 }), 0.5 * 0.03 * 0.25);
  assert.equal(polyFee(0.5, null), 0);
});

test('bookQuote removes the margin proportionally', () => {
  const q = bookQuote('Book', { home: 1.5, away: 2.5 }, TWO);
  near(q.cost.home, 1 / 1.5);
  near(q.fair.home + q.fair.away, 1);
  near(q.fair.home, (1 / 1.5) / (1 / 1.5 + 1 / 2.5));
});

test('exchangeQuote: cost is ask + fee; wide spreads give no fair price', () => {
  const tight = exchangeQuote('X', { home: { bid: 0.6, ask: 0.62 }, away: { bid: 0.38, ask: 0.4 } }, TWO, () => 0.01);
  near(tight.cost.home, 0.63);
  near(tight.fair.home, 0.61);
  const wide = exchangeQuote('X', { home: { bid: 0.5, ask: 0.62 }, away: { bid: 0.38, ask: 0.4 } }, TWO, () => 0);
  assert.equal(wide.fair, null);
  near(wide.cost.home, 0.62);
});

test('analyzeGame: EV uses the other venues only, and needs two of them', () => {
  const fair = (h) => ({ source: `F${h}`, kind: 'book', cost: { home: null, away: null }, fair: { home: h, away: 1 - h } });
  const cheap = { source: 'Cheap', kind: 'exchange', cost: { home: 0.5, away: 0.55 }, fair: { home: 0.9, away: 0.1 } };
  const r = analyzeGame([fair(0.6), fair(0.62), cheap], TWO);
  const home = r.outcomes[0].quotes.find((q) => q.source === 'Cheap');
  near(home.consensus, 0.61); // median of the two others; its own 0.9 is ignored
  near(home.ev, 0.61 / 0.5 - 1);
  const lonely = analyzeGame([fair(0.6), cheap], TWO).outcomes[0].quotes.find((q) => q.source === 'Cheap');
  assert.equal(lonely.ev, null);
});

test('analyzeGame finds arbitrage when the cheapest legs cost under $1', () => {
  const a = { source: 'A', kind: 'book', cost: { home: 0.45, away: 0.6 }, fair: null };
  const b = { source: 'B', kind: 'book', cost: { home: 0.55, away: 0.5 }, fair: null };
  const r = analyzeGame([a, b], TWO);
  near(r.arb.total, 0.95);
  assert.deepEqual(r.arb.legs.map((l) => l.source), ['A', 'B']);
  assert.equal(analyzeGame([a], TWO).arb, null);
});

test('espnBookQuote reads ESPN moneyline close odds, including the draw', () => {
  const ev = {
    competitions: [
      {
        odds: [
          {
            provider: { name: 'Draft Kings' },
            moneyline: { home: { close: { odds: '-220' } }, away: { close: { odds: '+475' } }, draw: { close: { odds: '+370' } } },
          },
        ],
      },
    ],
  };
  const q = espnBookQuote(ev, THREE);
  assert.equal(q.source, 'DraftKings');
  near(q.cost.draw, 1 / 4.7);
  assert.equal(espnBookQuote({ competitions: [{ odds: [null] }] }, TWO), null);
});

test('The Odds API: event matched by teams and time, outcomes mapped to sides', () => {
  const events = [
    { commence_time: '2026-11-08T21:25:00Z', home_team: 'Seattle Seahawks', away_team: 'Arizona Cardinals', bookmakers: [] },
    {
      commence_time: '2026-11-08T21:25:00Z',
      home_team: 'New England Patriots',
      away_team: 'Green Bay Packers',
      bookmakers: [
        { key: 'fanduel', title: 'FanDuel', markets: [{ key: 'h2h', outcomes: [{ name: 'Green Bay Packers', price: 2.4 }, { name: 'New England Patriots', price: 1.62 }] }] },
        { key: 'x', title: 'NoH2H', markets: [{ key: 'spreads', outcomes: [] }] },
      ],
    },
  ];
  const ev = matchOddsApiEvent(events, nfl);
  assert.equal(ev.home_team, 'New England Patriots');
  const qs = oddsApiQuotes(ev, nfl, TWO);
  assert.equal(qs.length, 1);
  near(qs[0].cost.away, 1 / 2.4);
});

// Shapes copied from Polymarket's gamma API (2026-11-08).
test('Polymarket two-way market: second outcome mirrors the first', () => {
  const e = {
    slug: 'nfl-gb-ne-2026-11-08',
    title: 'Packers vs. Patriots',
    start: '2026-11-08T21:25:00Z',
    teams: [{ name: 'Green Bay Packers', alias: 'Packers' }, { name: 'New England Patriots', alias: 'Patriots' }],
    markets: [{ outcomes: '["Packers", "Patriots"]', bestBid: 0.37, bestAsk: 0.38, feeSchedule: { rate: 0.03, exponent: 1 } }],
  };
  assert.equal(matchPolyEvent([e], nfl), e);
  const { book, schedule } = polyBook(e, nfl, TWO);
  assert.deepEqual(book.away, { bid: 0.37, ask: 0.38 });
  near(book.home.ask, 0.63);
  near(book.home.bid, 0.62);
  assert.equal(schedule.rate, 0.03);
});

test('Polymarket soccer: one Yes/No market per team plus the draw', () => {
  const e = {
    title: 'Manchester City FC vs. Fulham FC',
    start: '2026-11-21T12:30:00Z',
    teams: [{ name: 'Manchester City FC', alias: 'Man City' }, { name: 'Fulham FC', alias: 'Fulham' }],
    markets: [
      { groupItemTitle: 'Manchester City FC', outcomes: '["Yes","No"]', bestBid: 0.66, bestAsk: 0.67 },
      { groupItemTitle: 'Draw (Manchester City FC vs. Fulham FC)', outcomes: '["Yes","No"]', bestBid: 0.18, bestAsk: 0.2 },
      { groupItemTitle: 'Fulham FC', outcomes: '["Yes","No"]', bestBid: 0.14, bestAsk: 0.15 },
    ],
  };
  assert.equal(matchPolyEvent([e], epl), e);
  const { book } = polyBook(e, epl, THREE);
  assert.deepEqual(book, { home: { bid: 0.66, ask: 0.67 }, draw: { bid: 0.18, ask: 0.2 }, away: { bid: 0.14, ask: 0.15 } });
  assert.equal(matchPolyEvent([{ ...e, start: '2026-11-25T12:30:00Z' }], epl), null);
});
