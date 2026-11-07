// Parity and Monte Carlo checks for the exported team-share model.
//
//   .venv/bin/python -m pipeline.export   # writes models/shot-eng.1.json and data/parity-eng.1.json
//   node pipeline/parity.mjs
//
// 1. Parity: for the dev-season matches in data/parity-eng.1.json (the Python
//    model's features and predictions), rebuild every feature in JavaScript from
//    the pipeline tables (lib/teamShareFeatures.js) and predict with the
//    exported coefficients (public/teamShare.js). Reports the largest relative
//    differences. This checks the formulas, separately from ESPN data issues.
// 2. Monte Carlo: simulate scenarios with the browser's sampler and compare
//    the simulated team totals and player marginals with NB(mu, k_team) and
//    NB(lambda, k_player).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { teamRates, playerRate, resolvePosition, posGroupTS, leagueRef } from '../lib/teamShareFeatures.js';
import { predictAt, planTeam, simulate, nbCdf, nbTail, goalPerShot } from '../public/teamShare.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUE = process.argv[2] || 'eng.1';
const model = JSON.parse(readFileSync(join(ROOT, 'models', `shot-${LEAGUE}.json`), 'utf8'));
const fixtures = JSON.parse(readFileSync(join(ROOT, 'data', `parity-${LEAGUE}.json`), 'utf8'));
const cfg = model.recency;

// ---- tables ----
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
const table = (name) => parseCsv(gunzipSync(readFileSync(join(ROOT, 'data', 'tables', `${name}.csv.gz`))).toString('utf8'));
const num = (x) => (x === '' || x == null ? 0 : Number(x));

const mRows = table('matches').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const apps = new Map();
for (const a of table('appearances')) {
  if (!apps.has(a.match_id)) apps.set(a.match_id, []);
  apps.get(a.match_id).push({ id: a.player_id, teamId: a.team_id, pos: a.pos === '' ? null : a.pos, starter: a.starter === 'True', minutes: num(a.minutes), shots: num(a.shots), goals: num(a.goals) });
}
const shotCount = new Map();
for (const s of table('shots')) shotCount.set(`${s.match_id}:${s.team_id}`, (shotCount.get(`${s.match_id}:${s.team_id}`) || 0) + 1);
const matches = mRows.map((r) => {
  const ap = apps.get(r.match_id) || [];
  const teams = [
    { id: r.home_id, home: true, shots: shotCount.get(`${r.match_id}:${r.home_id}`) || 0 },
    { id: r.away_id, home: false, shots: shotCount.get(`${r.match_id}:${r.away_id}`) || 0 },
  ];
  const ok = teams.every((t) => Math.abs(t.shots - ap.filter((a) => a.teamId === t.id).reduce((s, a) => s + a.shots, 0)) <= 2);
  return { id: r.match_id, date: r.date, ok, teams, apps: ap };
});
const okGames = matches.filter((m) => m.ok);
const byId = new Map(matches.map((m) => [m.id, m]));
const teamGames = (tid, date) => okGames.filter((m) => m.date < date && m.teams.some((t) => t.id === tid)).reverse();
const playerRows = (pid, date) =>
  okGames
    .filter((m) => m.date < date)
    .flatMap((m) => m.apps.filter((a) => a.id === pid))
    .reverse();

// The pipeline caches league rates per calendar day, computed at the day's
// first kickoff (the fit loop meets that match first). Its 380-match window
// can start inside a group of same-time kickoffs whose order comes from an
// unstable pandas sort, so the JS window may swap a match or two at its start:
// run with PARITY_LEAGUE=python to take the league reference from Python.
function leagueAt(date) {
  const day = date.slice(0, 10);
  const first = okGames.find((m) => m.date.slice(0, 10) === day)?.date || date;
  return leagueRef(okGames.filter((m) => m.date < first).slice(-380));
}

// ---- 1. parity ----
const worst = {};
const track = (key, js, py) => {
  const rel = Math.abs(js - py) / Math.max(Math.abs(py), 1e-9);
  if (!worst[key] || rel > worst[key].rel) worst[key] = { rel, js, py };
  (worst[key].n = (worst[key].n || 0) + 1);
};
let groupMismatch = 0;
let rows = 0;
let teamsN = 0;
// PARITY_LEAGUE=python takes the league reference rates from the Python side
// (isolates the per-match formulas from which 380 league games are in the window).
const USE_PY_LEAGUE = process.env.PARITY_LEAGUE === 'python';
for (const fx of fixtures) {
  const m = byId.get(fx.match_id);
  const lgJs = leagueAt(fx.date);
  track('league rate', lgJs.rate, fx.league.rate);
  for (const g of Object.keys(fx.league.pos90)) track('league pos90', lgJs.pos90[g], fx.league.pos90[g]);
  const lg = USE_PY_LEAGUE ? fx.league : lgJs;
  for (const tm of fx.teams) {
    const opp = fx.teams.find((x) => x.team_id !== tm.team_id).team_id;
    const mine = teamRates(teamGames(tm.team_id, fx.date), tm.team_id, cfg, lg.rate);
    const theirs = teamRates(teamGames(opp, fx.date), opp, cfg, lg.rate);
    track('team attack', mine.att, tm.att);
    track('opp defence', theirs.dfn, tm.opp_dfn);
    const home = m.teams.find((t) => t.id === tm.team_id).home;
    for (const cp of tm.checkpoints) {
      teamsN++;
      const diff = cp.x.lead ? 1 : cp.x.trail ? -1 : 0;
      const onPitch = cp.players.map((pp) => {
        const rowsP = playerRows(pp.player_id, fx.date);
        const app = m.apps.find((a) => a.id === pp.player_id && a.teamId === tm.team_id);
        const group = posGroupTS(resolvePosition(app.pos, rowsP, cfg.position_history_n));
        if (group !== pp.g) groupMismatch++;
        const pr = playerRate(rowsP, group, cfg, lg);
        track('player r90', pr.r90, pp.r90);
        track('player conv', pr.pconv, pp.pconv);
        return { id: pp.player_id, group, r90: pr.r90, pconv: pr.pconv };
      });
      const pred = predictAt(model, cp.t, { att: mine.att, oppDfn: theirs.dfn, home, rate: lg.rate }, diff, cp.x.man_adv, onPitch);
      track('team mean mu', pred.mu, cp.mu);
      for (const pp of cp.players) {
        rows++;
        const js = pred.players.find((p) => p.id === pp.player_id);
        track('player lambda', js.lambda, pp.lambda);
        track('player P(1+)', js.p1, pp.p1);
        track('player P(3+)', js.p3, pp.p3);
        track('player P(goal)', js.pgoal, pp.pgoal);
      }
    }
  }
}
console.log(`Parity: ${fixtures.length} dev matches, ${teamsN} team-checkpoints, ${rows} player predictions (JS features from the tables vs Python; league reference rates from ${USE_PY_LEAGUE ? 'Python' : 'JS'})`);
console.log('quantity'.padEnd(16), 'max rel diff'.padStart(13), '   JS at worst          Python at worst');
for (const [k, v] of Object.entries(worst)) console.log(k.padEnd(16), v.rel.toExponential(2).padStart(13), '  ', String(v.js.toPrecision(10)).padEnd(20), v.py.toPrecision(10));
console.log(`position group mismatches: ${groupMismatch}`);

// ---- 2. Monte Carlo vs analytic ----
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
  const lg = leagueAt(fx.date);
  return fx.teams.map((tm) => {
    const opp = fx.teams.find((x) => x.team_id !== tm.team_id).team_id;
    const cp = tm.checkpoints[0];
    const mine = teamRates(teamGames(tm.team_id, fx.date), tm.team_id, cfg, lg.rate);
    const theirs = teamRates(teamGames(opp, fx.date), opp, cfg, lg.rate);
    const units = cp.players.map((pp) => {
      const rowsP = playerRows(pp.player_id, fx.date);
      const app = m.apps.find((a) => a.id === pp.player_id && a.teamId === tm.team_id);
      const group = posGroupTS(resolvePosition(app.pos, rowsP, cfg.position_history_n));
      const pr = playerRate(rowsP, group, cfg, lg);
      return { id: pp.player_id, group, r90: pr.r90, pconv: pr.pconv, s: opts.now, e: opts.end };
    });
    if (opts.sub) {
      // take the highest-rate outfielder off at the sub minute; a bench player comes on
      const off = units.filter((u) => u.group !== 'G').sort((a, b) => b.r90 - a.r90)[0];
      off.e = opts.sub;
      const bench = m.apps.find((a) => a.teamId === tm.team_id && !a.starter);
      if (bench) {
        const rowsP = playerRows(bench.id, fx.date);
        const group = posGroupTS(resolvePosition(bench.pos, rowsP, cfg.position_history_n));
        const pr = playerRate(rowsP, group, cfg, lg);
        units.push({ id: bench.id, group, r90: pr.r90, pconv: pr.pconv, s: opts.sub, e: opts.end });
      }
    }
    const home = m.teams.find((t) => t.id === tm.team_id).home;
    const reds = opts.red ? [{ minute: opts.red.minute, delta: opts.red.home === home ? -1 : 1 }] : [];
    return planTeam(model, { now: opts.now, end: opts.end, team: { att: mine.att, oppDfn: theirs.dfn, home }, diff: opts.diff ? (home ? opts.diff : -opts.diff) : 0, manAdv0: 0, reds, units });
  });
}
const RUNS = 200000;
const scenarios = [
  { name: 'kickoff, default', now: 0, end: 90 },
  { name: 'minute 60, home leads, sub at 70', now: 60, end: 90, diff: 1, sub: 70 },
  { name: 'kickoff, home red card at 30', now: 0, end: 90, red: { minute: 30, home: true } },
];
console.log(`\nMonte Carlo (${RUNS.toLocaleString()} runs) vs analytic NB, match ${fixtures[0].match_id}:`);
for (const sc of scenarios) {
  const plans = scenarioFromFixture(fixtures[0], sc);
  const teams = plans.map((p) => ({ base: { shots: 0, sot: 0, goals: 0 }, units: [...p.players.map((u) => ({ ...u, sot: 0.35 })), { ...p.others, sot: 0.35 }] }));
  const res = simulate(model, teams, RUNS, rngSeeded(7));
  const kT = model.team.k;
  const kP = model.player.k;
  let teamWorst = 0;
  let playerWorst = 0;
  let goalWorst = 0;
  const lines = [];
  res.teams.forEach((t, ti) => {
    const mu = plans[ti].mu;
    const simMean = t.shots / RUNS;
    const counts = [...t.hist.entries()];
    const simVar = counts.reduce((s, [k, n]) => s + n * (k - simMean) ** 2, 0) / RUNS;
    let cum = 0;
    const sorted = counts.sort((a, b) => a[0] - b[0]);
    for (const [k, n] of sorted) {
      cum += n / RUNS;
      teamWorst = Math.max(teamWorst, Math.abs(cum - nbCdf(k, mu, kT)));
    }
    lines.push(`  team ${ti ? 'away' : 'home'}: mean ${simMean.toFixed(3)} vs ${mu.toFixed(3)}, sd ${Math.sqrt(simVar).toFixed(3)} vs ${Math.sqrt(mu + (mu * mu) / kT).toFixed(3)} (mixing vG ${t.vG.toFixed(4)}, vE ${t.vE.toFixed(4)})`);
    plans[ti].players.forEach((p, ui) => {
      if (p.lambda <= 0) return;
      const u = t.units[ui];
      for (const [n, c] of [[1, u.c1], [2, u.c2], [3, u.c3]]) playerWorst = Math.max(playerWorst, Math.abs(c / RUNS - nbTail(p.lambda, kP, n)));
      const lg = p.lambda * p.q;
      goalWorst = Math.max(goalWorst, Math.abs(u.g1 / RUNS - (1 - Math.pow(kP / (kP + lg), kP))));
    });
  });
  console.log(`- ${sc.name}`);
  lines.forEach((l) => console.log(l));
  console.log(`  max |CDF diff| team total ${teamWorst.toFixed(4)}; max |P(n+) diff| players ${playerWorst.toFixed(4)}; max |P(goal) diff| ${goalWorst.toFixed(4)}`);
}
