// Parity and Monte Carlo checks for the exported multi-competition model
// (team_share_oppadj, models/shot-pooled.json), which the app uses for every
// competition except the Premier League.
//
//   .venv/bin/python -m pipeline.export --pooled   # writes models/shot-pooled.json and data/parity-pooled.json
//   node pipeline/parity-pooled.mjs
//
// 1. Parity: for the dev-season matches in data/parity-pooled.json (20 per
//    competition; the Python model's features and predictions), rebuild every
//    feature in JavaScript from the pipeline tables of all seven competitions
//    (cross-competition club history, opponent-adjusted form, in-play shots so
//    far; lib/teamShareFeatures.js) and predict with the exported coefficients
//    (public/teamShare.js). The competition reference rates (today's, and each
//    past match's for the opponent adjustment) are taken from the Python side,
//    so this checks the formulas. The exported rate history is compared with
//    the rates Python used separately.
// 2. Extract check: if the raw ESPN summaries are available (data/raw, or
//    RAW_DIR), extractModelMatch (what the server builds from ESPN) is compared
//    with the pipeline tables for every cup match that went to extra time and
//    a sample of the others: team shots and the data check.
// 3. Monte Carlo: simulate scenarios with the browser's sampler (in play, with
//    the shots-so-far terms) and compare the simulated team totals and player
//    marginals with NB(mu, k_team) and NB(lambda, k_player).
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { teamRates, playerRate, resolvePosition, posGroupTS, leagueRef, rawRelative, oppAdjRates, competitionRateAt, before, extractModelMatch } from '../lib/teamShareFeatures.js';
import { predictAt, planTeam, simulate, nbCdf, nbTail, expectedShots, teamSfRatio, playerSfRatio } from '../public/teamShare.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pooled = JSON.parse(readFileSync(join(ROOT, 'models', 'shot-pooled.json'), 'utf8'));
const { fixtures } = JSON.parse(readFileSync(join(ROOT, 'data', 'parity-pooled.json'), 'utf8'));
const cfg = pooled.recency;
const view = (lg) => ({ ...pooled, league: lg, league_ref: pooled.league_ref[lg] });

// ---- tables (all competitions) ----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (f += '"'), i++;
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(f), (f = '');
    else if (c === '\n') row.push(f), rows.push(row), (row = []), (f = '');
    else if (c !== '\r') f += c;
  }
  if (f || row.length) row.push(f), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const table = (lg, name) => parseCsv(gunzipSync(readFileSync(join(ROOT, 'data', 'tables', lg, `${name}.csv.gz`))).toString('utf8'));
const num = (x) => (x === '' || x == null ? 0 : Number(x));
const numOrNull = (x) => (x === '' || x == null ? null : Number(x));

const t0 = Date.now();
const all = [];
const shotsById = new Map();
for (const lg of pooled.leagues) {
  const apps = new Map();
  for (const a of table(lg, 'appearances')) {
    if (!apps.has(a.match_id)) apps.set(a.match_id, []);
    apps.get(a.match_id).push({ id: a.player_id, teamId: a.team_id, pos: a.pos === '' ? null : a.pos, starter: a.starter === 'True', minutes: num(a.minutes), shots: num(a.shots), goals: num(a.goals), onMin: num(a.on_min) });
  }
  const shots = new Map();
  for (const s of table(lg, 'shots')) {
    if (!shots.has(s.match_id)) shots.set(s.match_id, []);
    shots.get(s.match_id).push({ teamId: s.team_id, playerId: s.player_id, minute: numOrNull(s.minute), period: numOrNull(s.period) });
  }
  for (const r of table(lg, 'matches')) {
    // As pipeline/dataset.py load_matches: no shoot-out kicks; regulation time only after extra time.
    const extraTime = (r.max_period === '' ? 2 : Number(r.max_period)) > 2;
    const allSh = (shots.get(r.match_id) || []).filter((x) => !(x.period != null && x.period >= 5));
    const sh = extraTime ? allSh.filter((x) => !(x.period != null && x.period > 2)) : allSh;
    const ap = apps.get(r.match_id) || [];
    const teams = [r.home_id, r.away_id].map((id, i) => ({ id, home: i === 0, shots: sh.filter((x) => x.teamId === id).length }));
    const ok = teams.every((t) => Math.abs(allSh.filter((x) => x.teamId === t.id).length - ap.filter((a) => a.teamId === t.id).reduce((s, a) => s + a.shots, 0)) <= 2);
    all.push({ id: r.match_id, league: lg, date: r.date, ok, neutral: r.neutral === 'True', teams, apps: ap });
    shotsById.set(r.match_id, sh);
  }
}
all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const okGames = all.filter((m) => m.ok);
const byId = new Map(all.map((m) => [m.id, m]));
const teamIdx = new Map();
const playerIdx = new Map();
for (const m of okGames) {
  for (const t of m.teams) {
    if (!teamIdx.has(t.id)) teamIdx.set(t.id, []);
    teamIdx.get(t.id).push(m);
  }
  for (const a of m.apps) {
    if (!playerIdx.has(a.id)) playerIdx.set(a.id, []);
    playerIdx.get(a.id).push({ ...a, date: m.date });
  }
}
const beforeDate = (arr, date) => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return arr.slice(0, lo).reverse();
};
const teamGames = (tid, date) => beforeDate(teamIdx.get(tid) || [], date);
const playerRows = (pid, date) => beforeDate(playerIdx.get(pid) || [], date);
console.log(`tables: ${all.length} matches in ${pooled.leagues.length} competitions (${okGames.length} pass the data check), loaded in ${Date.now() - t0} ms`);

// ---- 1. parity ----
const worst = {};
const track = (key, js, py) => {
  const rel = Math.abs(js - py) / Math.max(Math.abs(py), 1e-9);
  if (!worst[key] || rel > worst[key].rel) worst[key] = { rel, js, py, n: worst[key]?.n || 0 };
  worst[key].n++;
};
const perLeague = {};
const USE_EXPORTED_RATES = process.env.PARITY_RATES === 'export';
const rateKeys = new Map(); // competition|day -> rel diff of the exported rate history vs what Python used
let groupMismatch = 0;
let teamsN = 0;
let rows = 0;
for (const fx of fixtures) {
  const m = byId.get(fx.match_id);
  const model = view(fx.league);
  const lg = fx.league_ref;
  // PARITY_RATES=export: past-match competition rates from the exported history (what the server uses)
  const r380 = USE_EXPORTED_RATES ? (league, date) => competitionRateAt(pooled, league, date) : (league, date) => fx.rate380[`${league}|${date.slice(0, 10)}`];
  const pl =(perLeague[fx.league] ||= { matches: 0, worstMu: 0, worstLambda: 0, worstAtt: 0 });
  pl.matches++;
  // exported rate history vs the rates Python used
  for (const [k, v] of Object.entries(fx.rate380)) {
    if (rateKeys.has(k)) continue;
    const [league, day] = k.split('|');
    const js = competitionRateAt(pooled, league, `${day}T12:00Z`);
    rateKeys.set(k, Math.abs(js - v) / v);
    track('rate history (exported) vs Python', js, v);
  }
  // JS today's reference rate from the tables (last 380 ok matches of the competition before the day's first kickoff)
  const day = fx.date.slice(0, 10);
  const first = okGames.find((g) => g.league === fx.league && g.date.slice(0, 10) === day)?.date || fx.date;
  const lgJs = leagueRef(okGames.filter((g) => g.league === fx.league && g.date < first).slice(-cfg.league_window));
  track('league rate (JS tables)', lgJs.rate, lg.rate);

  const oppRel = (g, o) => rawRelative(teamGames(o, g.date), o, cfg, r380(g.league, g.date));
  const rates = {};
  for (const tm of fx.teams) {
    const hs = teamGames(tm.team_id, fx.date);
    rates[tm.team_id] = oppAdjRates(hs, tm.team_id, cfg, lg.rate, oppRel);
    hs.slice(0, cfg.team_n).forEach((g, i) => {
      const p = tm.past[i];
      if (p.match_id !== g.id) throw new Error(`history order differs for ${tm.team_id} at ${fx.match_id}: ${g.id} vs ${p.match_id}`);
      const o = oppRel(g, p.opp);
      track('opponent rel. attack', o.att, p.o_att);
      track('opponent rel. defence', o.dfn, p.o_def);
    });
  }
  for (const tm of fx.teams) {
    const opp = fx.teams.find((x) => x.team_id !== tm.team_id).team_id;
    const mine = rates[tm.team_id];
    const theirs = rates[opp];
    track('team attack (opp-adj)', mine.att, tm.att);
    track('team defence (opp-adj)', mine.dfn, tm.dfn);
    pl.worstAtt = Math.max(pl.worstAtt, Math.abs(mine.att - tm.att) / tm.att);
    const exp = expectedShots(model, mine.att, theirs.dfn, lg.rate);
    const expOpp = expectedShots(model, theirs.att, mine.dfn, lg.rate);
    track('pre-match expected', exp, tm.exp);
    const home = m.teams.find((t) => t.id === tm.team_id).home && !m.neutral;
    const sh = shotsById.get(fx.match_id);
    for (const cp of tm.checkpoints) {
      teamsN++;
      const t = cp.t;
      const sf = sh.filter((x) => x.teamId === tm.team_id && before(x.minute, x.period, t)).length;
      const osf = sh.filter((x) => x.teamId === opp && before(x.minute, x.period, t)).length;
      const sfRatio = teamSfRatio(model, sf, exp, t);
      const oppSfRatio = teamSfRatio(model, osf, expOpp, t);
      track('sf_ratio', 1 + sfRatio, 1 + cp.x.sf_ratio);
      track('opp_sf_ratio', 1 + oppSfRatio, 1 + cp.x.opp_sf_ratio);
      if (Number(home) !== cp.x.home) throw new Error(`home flag differs at ${fx.match_id}`);
      const diff = cp.x.lead ? 1 : cp.x.trail ? -1 : 0;
      const onPitch = cp.players.map((pp) => {
        const rowsP = playerRows(pp.player_id, fx.date);
        const app = m.apps.find((a) => a.id === pp.player_id && a.teamId === tm.team_id);
        const group = posGroupTS(resolvePosition(app.pos, rowsP, cfg.position_history_n));
        if (group !== pp.g) groupMismatch++;
        const pr = playerRate(rowsP, group, cfg, lg);
        track('player r90', pr.r90, pp.r90);
        track('player conv', pr.pconv, pp.pconv);
        const psfN = sh.filter((x) => x.teamId === tm.team_id && x.playerId === pp.player_id && before(x.minute, x.period, t)).length;
        const psf = playerSfRatio(model, psfN, pr.r90, t - app.onMin, t);
        track('p_sf_ratio', 1 + psf, 1 + pp.p_sf_ratio);
        return { id: pp.player_id, group, r90: pr.r90, pconv: pr.pconv, psf };
      });
      const pred = predictAt(model, t, { att: mine.att, oppDfn: theirs.dfn, home, rate: lg.rate, sfRatio, oppSfRatio }, diff, cp.x.man_adv, onPitch);
      track('team mean mu', pred.mu, cp.mu);
      pl.worstMu = Math.max(pl.worstMu, Math.abs(pred.mu - cp.mu) / cp.mu);
      for (const pp of cp.players) {
        rows++;
        const js = pred.players.find((p) => p.id === pp.player_id);
        track('player lambda', js.lambda, pp.lambda);
        pl.worstLambda = Math.max(pl.worstLambda, Math.abs(js.lambda - pp.lambda) / pp.lambda);
        track('player P(1+)', js.p1, pp.p1);
        track('player P(3+)', js.p3, pp.p3);
        track('player P(goal)', js.pgoal, pp.pgoal);
      }
    }
  }
}
console.log(`\nParity: ${fixtures.length} dev matches (${Object.keys(perLeague).length} competitions), ${teamsN} team-checkpoints, ${rows} player predictions (JS features from the tables of all 7 competitions vs Python; today's reference rates from Python, past-match competition rates from ${USE_EXPORTED_RATES ? 'the exported history' : 'Python'})`);
console.log('quantity'.padEnd(36), 'max rel diff'.padStart(13), '   JS at worst          Python at worst');
for (const [k, v] of Object.entries(worst)) console.log(k.padEnd(36), v.rel.toExponential(2).padStart(13), '  ', String(v.js.toPrecision(10)).padEnd(20), v.py.toPrecision(10));
console.log('(ratios compared as 1 + ratio; "league rate (JS tables)" and "rate history" are informational: same-day kickoff order)');
{
  const d = [...rateKeys.values()].sort((a, b) => a - b);
  const exact = d.filter((x) => x < 1e-5).length;
  console.log(`rate history: ${d.length} competition-days; exported value equals Python's for ${exact} (Python caches each day's rate at the first kickoff it meets, the export at the day's first kickoff); median rel diff ${d[d.length >> 1].toExponential(2)}, 95th pct ${d[Math.floor(d.length * 0.95)].toExponential(2)}`);
}
console.log(`position group mismatches: ${groupMismatch}`);
console.log('per competition, max rel diff: team mu / player lambda / team attack');
for (const [lg, v] of Object.entries(perLeague)) console.log(`  ${lg.padEnd(15)} ${String(v.matches).padStart(3)} matches  ${v.worstMu.toExponential(2)}  ${v.worstLambda.toExponential(2)}  ${v.worstAtt.toExponential(2)}`);

// ---- 2. extract check (raw ESPN summaries vs the tables) ----
const RAW = process.env.RAW_DIR || join(ROOT, 'data', 'raw');
const rawFor = (lg, id) => {
  const p = join(RAW, lg, `${id}.json.gz`);
  return existsSync(p) ? p : null;
};
{
  const cups = all.filter((m) => m.league.startsWith('uefa.'));
  const et = new Set(cups.filter((m) => {
    const r = rawFor(m.league, m.id);
    return r && JSON.parse(gunzipSync(readFileSync(r)).toString('utf8')).commentary?.some((x) => (x.play?.period?.number || 0) > 2);
  }).map((m) => m.id));
  const sample = [...all.filter((m) => et.has(m.id)), ...all.filter((_, i) => i % 97 === 0)];
  let checked = 0;
  let shotDiff = 0;
  let okDiff = 0;
  for (const m of sample) {
    const r = rawFor(m.league, m.id);
    if (!r) continue;
    const ex = extractModelMatch(JSON.parse(gunzipSync(readFileSync(r)).toString('utf8')));
    checked++;
    if (ex.ok !== m.ok) okDiff++;
    for (const t of m.teams) if (ex.teams.find((x) => x.id === t.id).shots !== t.shots) shotDiff++;
  }
  if (checked) console.log(`\nExtract check: ${checked} raw summaries (${et.size} cup games with extra time, the rest every 97th match): team shot counts differing ${shotDiff}, data-check flag differing ${okDiff}`);
  else console.log('\nExtract check skipped: no raw summaries found (set RAW_DIR)');
}

// ---- 3. Monte Carlo vs analytic ----
function rngSeeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scenarioFromFixture(fx, opts) {
  const m = byId.get(fx.match_id);
  const model = view(fx.league);
  const lg = fx.league_ref;
  const r380 = (league, date) => fx.rate380[`${league}|${date.slice(0, 10)}`];
  const oppRel = (g, o) => rawRelative(teamGames(o, g.date), o, cfg, r380(g.league, g.date));
  const rates = Object.fromEntries(fx.teams.map((tm) => [tm.team_id, oppAdjRates(teamGames(tm.team_id, fx.date), tm.team_id, cfg, lg.rate, oppRel)]));
  const sh = shotsById.get(fx.match_id);
  const plans = fx.teams.map((tm) => {
    const opp = fx.teams.find((x) => x.team_id !== tm.team_id).team_id;
    const cp = tm.checkpoints.find((c) => c.t === opts.now) || tm.checkpoints[0];
    const exp = expectedShots(model, rates[tm.team_id].att, rates[opp].dfn, lg.rate);
    const expOpp = expectedShots(model, rates[opp].att, rates[tm.team_id].dfn, lg.rate);
    const sfRatio = teamSfRatio(model, sh.filter((x) => x.teamId === tm.team_id && before(x.minute, x.period, opts.now)).length, exp, opts.now);
    const oppSfRatio = teamSfRatio(model, sh.filter((x) => x.teamId === opp && before(x.minute, x.period, opts.now)).length, expOpp, opts.now);
    const unit = (id, s) => {
      const rowsP = playerRows(id, fx.date);
      const app = m.apps.find((a) => a.id === id && a.teamId === tm.team_id);
      const group = posGroupTS(resolvePosition(app.pos, rowsP, cfg.position_history_n));
      const pr = playerRate(rowsP, group, cfg, lg);
      const n = sh.filter((x) => x.playerId === id && before(x.minute, x.period, opts.now)).length;
      const psf = s === opts.now ? playerSfRatio(model, n, pr.r90, opts.now - app.onMin, opts.now) : 0;
      return { id, group, r90: pr.r90, pconv: pr.pconv, s, e: opts.end, psf };
    };
    const units = cp.players.map((pp) => unit(pp.player_id, opts.now));
    if (opts.sub) {
      const off = units.filter((u) => u.group !== 'G').sort((a, b) => b.r90 - a.r90)[0];
      off.e = opts.sub;
      const onIds = new Set(units.map((u) => u.id));
      const bench = m.apps.find((a) => a.teamId === tm.team_id && !onIds.has(a.id));
      if (bench) units.push(unit(bench.id, opts.sub));
    }
    const home = m.teams.find((t) => t.id === tm.team_id).home && !m.neutral;
    const reds = opts.red ? [{ minute: opts.red.minute, delta: opts.red.home === home ? -1 : 1 }] : [];
    const plan = planTeam(model, { now: opts.now, end: opts.end, team: { att: rates[tm.team_id].att, oppDfn: rates[opp].dfn, home, rate: lg.rate, sfRatio, oppSfRatio }, diff: opts.diff ? (home ? opts.diff : -opts.diff) : 0, manAdv0: 0, reds, units });
    return { plan, sfRatio, oppSfRatio };
  });
  return { model, plans };
}
const RUNS = 200000;
const mcFixtures = ['uefa.champions', 'esp.1'].map((lg) => fixtures.find((f) => f.league === lg));
const scenarios = [
  { fx: 0, name: 'kickoff, default', now: 0, end: 90 },
  { fx: 0, name: 'minute 60 (shots so far from the match), home leads, sub at 70', now: 60, end: 90, diff: 1, sub: 70 },
  { fx: 1, name: 'minute 30 (shots so far), home red card at 40', now: 30, end: 90, red: { minute: 40, home: true } },
];
console.log(`\nMonte Carlo (${RUNS.toLocaleString()} runs) vs analytic NB:`);
for (const sc of scenarios) {
  const fx = mcFixtures[sc.fx];
  const { model, plans } = scenarioFromFixture(fx, sc);
  const teams = plans.map(({ plan: p }) => ({ base: { shots: 0, sot: 0, goals: 0 }, units: [...p.players.map((u) => ({ ...u, sot: 0.35 })), { ...p.others, sot: 0.35 }] }));
  const res = simulate(model, teams, RUNS, rngSeeded(7));
  const kT = model.team.k;
  const kP = model.player.k;
  let teamWorst = 0;
  let playerWorst = 0;
  let goalWorst = 0;
  const lines = [];
  res.teams.forEach((t, ti) => {
    const mu = plans[ti].plan.mu;
    const simMean = t.shots / RUNS;
    const counts = [...t.hist.entries()].sort((a, b) => a[0] - b[0]);
    const simVar = counts.reduce((s, [k, n]) => s + n * (k - simMean) ** 2, 0) / RUNS;
    let cum = 0;
    for (const [k, n] of counts) {
      cum += n / RUNS;
      teamWorst = Math.max(teamWorst, Math.abs(cum - nbCdf(k, mu, kT)));
    }
    lines.push(`  team ${ti ? 'away' : 'home'}: sf_ratio ${plans[ti].sfRatio.toFixed(3)}, mean ${simMean.toFixed(3)} vs ${mu.toFixed(3)}, sd ${Math.sqrt(simVar).toFixed(3)} vs ${Math.sqrt(mu + (mu * mu) / kT).toFixed(3)} (mixing vG ${t.vG.toFixed(4)}, vE ${t.vE.toFixed(4)})`);
    plans[ti].plan.players.forEach((p, ui) => {
      if (p.lambda <= 0) return;
      const u = t.units[ui];
      for (const [n, c] of [[1, u.c1], [2, u.c2], [3, u.c3]]) playerWorst = Math.max(playerWorst, Math.abs(c / RUNS - nbTail(p.lambda, kP, n)));
      const lgm = p.lambda * p.q;
      goalWorst = Math.max(goalWorst, Math.abs(u.g1 / RUNS - (1 - Math.pow(kP / (kP + lgm), kP))));
    });
  });
  console.log(`- ${fx.league} ${fx.match_id}, ${sc.name}`);
  lines.forEach((l) => console.log(l));
  console.log(`  max |CDF diff| team total ${teamWorst.toFixed(4)}; max |P(n+) diff| players ${playerWorst.toFixed(4)}; max |P(goal) diff| ${goalWorst.toFixed(4)}`);
}
