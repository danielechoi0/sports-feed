// Pure parts of the Kalshi market read: ladder math, game shape, line history
// from candles, sportsbook parsing and the comparisons. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareLines,
  espnModel,
  gameType,
  ladderMedian,
  ladderQuantile,
  marginClass,
  marginShape,
  parseBook,
  pricesByPeriod,
  probAbove,
  totalShape,
} from '../lib/kalshi.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// P(X > t) for a normal(mu, sd), on Kalshi-style half-point rungs.
function normalLadder(mu, sd, from, to, step = 1) {
  const cdf = (z) => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI) * Math.log(2) * z)); // close enough for tests
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ t, p: 1 - cdf((t - mu) / sd) });
  return out;
}

test('quantiles and median agree, and stay off-ladder as null', () => {
  const pts = normalLadder(47.5, 13, 25.5, 70.5, 3);
  near(ladderQuantile(pts, 0.5), ladderMedian(pts).median);
  assert.ok(ladderQuantile(pts, 0.25) < ladderQuantile(pts, 0.5));
  assert.ok(ladderQuantile(pts, 0.75) > ladderQuantile(pts, 0.5));
  assert.equal(ladderQuantile(pts.slice(0, 3), 0.9), null);
  const t = totalShape(pts);
  assert.ok(t.p25 < t.p50 && t.p50 < t.p75);
  near(t.p50, 47.5, 0.6);
});

test('probAbove interpolates inside and flags bounds outside the ladder', () => {
  const pts = [{ t: 1.5, p: 0.8 }, { t: 3.5, p: 0.6 }];
  near(probAbove(pts, 2.5).p, 0.7);
  assert.equal(probAbove(pts, 2.5).edge, false);
  assert.deepEqual(probAbove(pts, 10), { p: 0.6, edge: true });
  assert.deepEqual(probAbove(pts, -5), { p: 0.8, edge: true });
  // Unsorted, non-monotone input is cleaned up first.
  near(probAbove([{ t: 3.5, p: 0.65 }, { t: 1.5, p: 0.6 }], 1.5).p, 0.625);
});

test('marginShape buckets sum to one and read exact margins off adjacent rungs', () => {
  // Home margin ladder: home favored by ~6.
  const pts = normalLadder(6, 13, -20.5, 30.5, 1);
  const m = marginShape(pts);
  const sum = Object.values(m.buckets).reduce((a, b) => a + b, 0);
  near(sum, 1, 0.01);
  assert.ok(m.buckets.home17 > m.buckets.away17);
  near(m.oneScore, m.buckets.close);
  near(m.exact3, probAbove(pts, 2.5).p - probAbove(pts, 3.5).p, 0.002);
  assert.equal(m.approx, false);
  // Away favored: exact margins come from the mirrored side.
  const away = marginShape(normalLadder(-6, 13, -30.5, 20.5, 1));
  near(away.exact7, m.exact7, 0.002);
  // Not enough rungs on one side: no shape.
  assert.equal(marginShape(normalLadder(6, 13, 1.5, 30.5, 1)), null);
});

test('marginClass and gameType name the kind of game', () => {
  assert.equal(marginClass({ oneScore: 0.54, blowout: 0.2 }), 'tight');
  assert.equal(marginClass({ oneScore: 0.4, blowout: 0.35 }), 'one-sided');
  assert.equal(marginClass({ oneScore: 0.48, blowout: 0.25 }), 'normal');
  assert.equal(marginClass(null), null);
  assert.equal(gameType('more', 'tight').label, 'Back-and-forth shootout');
  assert.equal(gameType('less', 'one-sided').label, 'Low-scoring, one-sided');
  assert.deepEqual(gameType(null, 'normal'), { scoring: null, margin: 'normal', label: 'Standard script' });
  assert.equal(gameType('more', null), null);
});

test('pricesByPeriod carries prices forward and drops unpriceable books', () => {
  const c = (ts, bid, ask, last) => ({ end_period_ts: ts, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask }, price: last ? { close_dollars: last } : {} });
  const ev = {
    market_tickers: ['A', 'B'],
    market_candlesticks: [
      [c(100, '0.0000', '0.9900'), c(200, '0.4000', '0.4200'), c(400, '0.5000', '0.5200')],
      [c(100, '0.3000', '0.3200'), c(300, '0.3400', '0.3600')],
    ],
  };
  const out = pricesByPeriod(ev, 350);
  assert.deepEqual(out.map((x) => x.ts), [100, 200, 300]); // 400 is after "now"
  assert.equal(out[0].prices.has('A'), false); // 0 / 0.99 book: no price
  near(out[1].prices.get('A'), 0.41);
  near(out[2].prices.get('A'), 0.41); // carried forward
  near(out[1].prices.get('B'), 0.31); // carried forward from 100
  near(out[2].prices.get('B'), 0.35);
});

test('parseBook reads ESPN core odds (open and current) and pickcenter', () => {
  const core = {
    provider: { name: 'Draft Kings' },
    overUnder: 48.5,
    spread: -9.5,
    homeTeamOdds: { moneyLine: -535, open: { pointSpread: { american: '-9.5' }, moneyLine: { american: '-470' } }, current: { pointSpread: { american: '-9.5' }, moneyLine: { american: '-535' } } },
    awayTeamOdds: { moneyLine: 400, open: { pointSpread: { american: '+9.5' }, moneyLine: { american: '+360' } }, current: { pointSpread: { american: '+9.5' }, moneyLine: { american: '+400' } } },
    open: { total: { american: '41.5' } },
    current: { total: { american: '48.5' } },
  };
  const b = parseBook(core);
  assert.equal(b.provider, 'DraftKings');
  assert.equal(b.now.homeMargin, 9.5);
  assert.equal(b.now.total, 48.5);
  assert.equal(b.open.total, 41.5);
  near(b.now.homeWin, 0.808, 0.001); // -535 / +400, margin removed
  near(b.open.homeWin, 0.791, 0.001);
  // Pickcenter: away favorite, home line +3, no opening lines.
  const pc = parseBook({ provider: { name: 'DraftKings' }, spread: 3, overUnder: 52.5, homeTeamOdds: { moneyLine: 145 }, awayTeamOdds: { moneyLine: -175 } });
  assert.equal(pc.now.homeMargin, -3);
  assert.equal(pc.open, null);
  assert.ok(pc.now.homeWin < 0.5);
  assert.equal(parseBook(null), null);
  assert.equal(parseBook({}), null);
});

test('espnModel normalizes the matchup predictor', () => {
  near(espnModel({ predictor: { homeTeam: { gameProjection: '22.2' }, awayTeam: { gameProjection: '77.7' } } }).homeWin, 0.222, 0.001);
  near(espnModel({ predictor: { homeTeam: { gameProjection: '60' } } }).homeWin, 0.6);
  assert.equal(espnModel({}), null);
});

test('compareLines reports movement, disagreement and the model gap', () => {
  const g = { away: { abbrev: 'NYJ', shortName: 'Jets' }, home: { abbrev: 'KC', shortName: 'Chiefs' } };
  const history = [
    { ts: 1, total: 46, homeMargin: 9.8, homeWin: 0.82 },
    { ts: 2, total: 47.5, homeMargin: 9.5, homeWin: 0.81 },
  ];
  const book = { provider: 'DraftKings', now: { total: 48.5, homeMargin: 9.5, homeWin: 0.808 }, open: { total: 41.5, homeMargin: 9.5, homeWin: 0.791 } };
  const r = compareLines({ g, kalshi: { total: 47.8, homeMargin: 9.3, homeWin: 0.81 }, history, book, model: { name: 'm', homeWin: 0.8 } });
  assert.equal(r.rows.length, 3);
  const tot = r.rows.find((x) => x.key === 'total');
  assert.equal(tot.kalshi.first, 46);
  assert.equal(tot.kalshi.series.length, 3); // two days + now
  assert.deepEqual(tot.book, { now: 48.5, open: 41.5 });
  assert.ok(r.notes[0].startsWith('The total has risen 7 points since DraftKings opened (41.5 → 48.5)'));
  assert.ok(r.tags.includes('total ▲7 since open'));
  assert.ok(!r.notes.some((n) => /disagree|ESPN/.test(n)));

  // Kalshi off the book, and ESPN's model well off the market.
  const r2 = compareLines({ g, kalshi: { total: 51, homeMargin: 6, homeWin: 0.7 }, history: null, book, model: { name: 'm', homeWin: 0.85 } });
  assert.ok(r2.notes.some((n) => n.startsWith('Kalshi and DraftKings disagree: total 51 vs 48.5; KC margin +6 vs +9.5; KC win 70% vs 81%')));
  assert.ok(r2.notes.some((n) => n.startsWith("ESPN's model is higher on the Chiefs than the market (85% vs 70% to win)")));

  // No book: movement falls back to Kalshi's own first day; 1-point move reads "1 point".
  const r3 = compareLines({ g, kalshi: { total: 47, homeMargin: 10.8, homeWin: 0.82 }, history, book: null, model: null });
  assert.ok(r3.notes.some((n) => n === 'The spread has moved 1 point toward the Chiefs on Kalshi since its first day of trading (KC by 10 → KC by 11).'));
  assert.equal(r3.rows[0].book, null);
});
