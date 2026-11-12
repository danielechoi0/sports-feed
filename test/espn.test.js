// NFL live situation (possession, down & distance) from scoreboard events. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nbaBoxLineups, nflSituation, normalizeEvent } from '../lib/espn.js';

const league = { slug: 'nfl', name: 'NFL', short: 'NFL' };
const event = (state, situation, sport = 'nfl', name = 'STATUS_IN_PROGRESS') =>
  normalizeEvent(
    {
      id: '1',
      status: { type: { state, name } },
      competitions: [
        {
          situation,
          competitors: [
            { homeAway: 'home', team: { id: '29', abbreviation: 'CAR' } },
            { homeAway: 'away', team: { id: '7', abbreviation: 'DEN' } },
          ],
        },
      ],
    },
    sport,
    league,
  );

// Shape copied from a live ESPN scoreboard (2026-11-08, DEN @ CAR).
const LIVE = {
  down: 2, yardLine: 90, distance: 9,
  downDistanceText: '2nd & 9 at DEN 10', shortDownDistanceText: '2nd & 9', possessionText: 'DEN 10',
  isRedZone: true, homeTimeouts: 3, awayTimeouts: 0, possession: '29',
};

test('nflSituation keeps possession team id, down and spot', () => {
  assert.deepEqual(nflSituation(LIVE), { possession: '29', down: '2nd & 9', spot: 'DEN 10', redZone: true });
});

test('nflSituation is null between drives when ESPN sends no possession or down', () => {
  assert.equal(nflSituation({ down: 1, yardLine: 72, distance: 10, isRedZone: false, homeTimeouts: 3, awayTimeouts: 3 }), null);
  assert.equal(nflSituation(undefined), null);
});

test('nflSituation stringifies a numeric possession id', () => {
  assert.equal(nflSituation({ ...LIVE, possession: 29 }).possession, '29');
});

test('normalizeEvent sets situation only for live NFL games', () => {
  assert.equal(event('in', LIVE).situation.possession, '29');
  assert.equal(event('post', LIVE).situation, null);
  assert.equal(event('pre', LIVE).situation, null);
  assert.equal(event('in', LIVE, 'nba').situation, null);
});

test('normalizeEvent hides the stale down at halftime and between quarters', () => {
  assert.equal(event('in', LIVE, 'nfl', 'STATUS_HALFTIME').situation, null);
  assert.equal(event('in', LIVE, 'nfl', 'STATUS_END_PERIOD').situation, null);
});

test('nbaBoxLineups marks players ESPN flags active as on court', () => {
  const ath = (id, starter, active) => ({ athlete: { id, displayName: `P${id}`, jersey: id }, starter, active, stats: ['30', '10'] });
  const sum = {
    boxscore: {
      players: [
        {
          team: { id: '1', displayName: 'A' },
          statistics: [{ keys: ['minutes', 'points'], labels: ['MIN', 'PTS'], athletes: [ath('1', true, true), ath('2', true, false), ath('6', false, true), ath('7', false)] }],
        },
      ],
    },
  };
  const [t] = nbaBoxLineups(sum);
  assert.deepEqual(t.starters.map((p) => p.onCourt), [true, false]);
  assert.deepEqual(t.bench.map((p) => p.onCourt), [true, false]);
  assert.equal(t.starters[0].jersey, '1');
});
