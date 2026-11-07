// Inference for the fitted team-share shot model (models/shot-<league>.json,
// fitted by pipeline/export.py). Used by the browser simulator (public/app.js)
// and by the parity / Monte Carlo checks (pipeline/parity.mjs).
//
// The model, at checkpoint t (0, 15, ..., 75) of a match:
//   team shots after t ~ NB(mu, k_team),
//     log mu = b_t + b_att log(att/rate) + b_def log(oppDef/rate) + b_home home
//            + b_trail trail + b_lead lead + late (b_trail_late trail + b_lead_late lead)
//            + b_man manAdv + log(rate)
//   player shots after t ~ NB(lambda, k_player),
//     log lambda = log mu + c_t + c_share log(r90 / sum of on-pitch r90) + c_pos
//   player goals after t: log E = log lambda + g0 + g1 log(conv)
//
// Between checkpoints log mu (and the player intercept) is interpolated
// linearly, so the late flag ramps from 0 at 45' to 1 at 60'. After 75' the
// remaining team shots fall linearly to zero at full time (90' on the clock,
// added time included); beyond 90 (hypothetical extra minutes) the same
// per-minute rate continues. Shots in a window [a, b) under a fixed state are
// M(a) - M(b), where M(t) is the model's expected shots from t to full time;
// a player's are M(a) pi(a) - M(b) pi(b). Without red cards or substitutions
// in the window this telescopes back to the model's own prediction.
//
// The multi-competition model (models/shot-pooled.json, team_share_oppadj;
// model.league names the competition being simulated) adds to log mu the
// competition intercept b_lg and b_sf sf_ratio + b_osf opp_sf_ratio (each
// side's shots so far vs its pre-match expectation for that much of the
// match), and to log lambda c_psf p_sf_ratio (the player's shots so far vs his
// expectation for the minutes he has played). The in-play terms are evaluated
// once, at the live minute, and held for the rest of the simulation: like the
// pipeline's checkpoints, they summarise what is known when predicting.

const LATE_FROM = 45;
const LATE_TO = 60;
const FT = 90;

function interp(checks, beta, prefix, t) {
  const c = checks;
  if (t <= c[0]) return beta[`${prefix}${c[0]}`];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i]) {
      const w = (t - c[i - 1]) / (c[i] - c[i - 1]);
      return (1 - w) * beta[`${prefix}${c[i - 1]}`] + w * beta[`${prefix}${c[i]}`];
    }
  }
  return beta[`${prefix}${c[c.length - 1]}`];
}

export const lateWeight = (t) => Math.min(1, Math.max(0, (t - LATE_FROM) / (LATE_TO - LATE_FROM)));

// Static part of log mu: strength, home, league rate offset; for the
// multi-competition model also the competition intercept and the in-play
// evidence (fixed at the moment of prediction).
// rate: the league reference rate (defaults to the exported one).
export function teamStatic(model, { att, oppDfn, home, rate = model.league_ref.rate, sfRatio = 0, oppSfRatio = 0 }) {
  const b = model.team.beta;
  return (
    b.log_att * Math.log(att / rate) +
    b.log_opp_def * Math.log(oppDfn / rate) +
    b.home * (home ? 1 : 0) +
    (b[`lg_${model.league}`] ?? 0) +
    (b.sf_ratio ?? 0) * sfRatio +
    (b.opp_sf_ratio ?? 0) * oppSfRatio +
    Math.log(rate)
  );
}

// ---- in-play evidence (multi-competition model, pipeline/models/pooled.py) ----
// Pre-match expected shots for the whole match (InPlayEvidence._pre_match).
export const expectedShots = (model, att, oppDfn, rate = model.league_ref.rate) => (att * oppDfn) / rate;
// A side's shots so far at minute t vs what was expected for that much of the match.
export function teamSfRatio(model, sf, expected, t) {
  const ip = model.inplay;
  if (!ip || t <= 0) return 0;
  return Math.log((sf + ip.team_prior_shots) / ((expected * t) / ip.match_minutes + ip.team_prior_shots));
}
// A player's shots so far vs his expected shots for the minutes he has played.
export function playerSfRatio(model, sf, r90, played, t) {
  const ip = model.inplay;
  if (!ip || t <= 0) return 0;
  return Math.log((sf + ip.player_prior_shots) / ((r90 * Math.max(0, played)) / 90 + ip.player_prior_shots));
}

// In-match state part of log mu at minute t: diff = goals for - against, manAdv in [-1, 1].
export function stateTerm(model, t, diff, manAdv) {
  const b = model.team.beta;
  const trail = diff < 0 ? 1 : 0;
  const lead = diff > 0 ? 1 : 0;
  const late = lateWeight(t);
  return b.trail * trail + b.lead * lead + late * (b.trail_late * trail + b.lead_late * lead) + b.man_adv * Math.max(-1, Math.min(1, manAdv));
}

// Expected team shots from minute t to full time, given the static part and state.
export function teamRemaining(model, t, stat, diff, manAdv) {
  const checks = model.checkpoints;
  const last = checks[checks.length - 1];
  const at = (u) => Math.exp(interp(checks, model.team.beta, 't', u) + stat + stateTerm(model, u, diff, manAdv));
  if (t <= last) return at(t);
  const mLast = at(last);
  return (mLast * (FT - t)) / (FT - last); // negative beyond 90: keeps the late per-minute rate
}

// Player's expected share of the team's remaining shots at minute t.
// psf: his in-play shots-so-far ratio (multi-competition model), fixed at the moment of prediction.
export function playerShare(model, t, group, logShare, psf = 0) {
  const b = model.player.beta;
  const pos = group === model.player.base_position ? 0 : b[`pos_${group}`] ?? 0;
  return Math.exp(interp(model.checkpoints, b, 't', Math.min(t, model.checkpoints[model.checkpoints.length - 1])) + b.log_share * logShare + pos + (b.p_sf_ratio ?? 0) * psf);
}

export function goalPerShot(model, conv) {
  return Math.min(0.95, Math.exp(model.goal.intercept + model.goal.log_conv * Math.log(Math.max(conv, 0.005))));
}

// Point prediction at one moment (the pipeline's predict()), for parity checks.
// team: {att, oppDfn, home, rate?, sfRatio?, oppSfRatio?}; onPitch: [{id, group, r90, pconv, psf?}]
export function predictAt(model, t, team, diff, manAdv, onPitch) {
  const stat = teamStatic(model, team);
  const mu = teamRemaining(model, t, stat, diff, manAdv);
  const tot = onPitch.reduce((a, p) => a + p.r90, 0) || 1;
  const k = model.player.k;
  const players = onPitch.map((p) => {
    const lambda = mu * playerShare(model, t, p.group, Math.log(p.r90 / tot), p.psf || 0);
    const lg = lambda * goalPerShot(model, p.pconv);
    return { id: p.id, lambda, p1: nbTail(lambda, k, 1), p2: nbTail(lambda, k, 2), p3: nbTail(lambda, k, 3), pgoal: 1 - Math.pow(k / (k + lg), k) };
  });
  return { mu, k: model.team.k, players };
}

// ---- scenario plan ----
// units: [{id, group, r90, pconv, s, e, psf?}] players with their on-pitch interval
// inside [now, end] (s == null: not used). Returns expected shots per unit and
// for "others" (team shots the listed players do not take: later substitutes).
// reds: [{minute, delta}] changes to this team's man advantage inside the window.
export function planTeam(model, { now, end, team, diff, manAdv0, reds = [], units, tempo = 1 }) {
  const stat = teamStatic(model, team);
  const cuts = new Set([now, end]);
  for (const r of reds) if (r.minute > now && r.minute < end) cuts.add(r.minute);
  for (const u of units) {
    if (u.s == null) continue;
    for (const m of [u.s, u.e]) if (m > now && m < end) cuts.add(m);
  }
  const bounds = [...cuts].sort((a, b) => a - b);
  const lam = new Map(units.map((u) => [u.id, 0]));
  let teamMean = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b <= a) continue;
    const manAdv = Math.max(-1, Math.min(1, manAdv0 + reds.filter((r) => r.minute <= a && r.minute >= now).reduce((s, r) => s + r.delta, 0)));
    const Ma = teamRemaining(model, a, stat, diff, manAdv);
    const Mb = teamRemaining(model, b, stat, diff, manAdv);
    const seg = Math.max(0, Ma - Mb);
    teamMean += seg;
    const on = units.filter((u) => u.s != null && u.s <= a && u.e >= b);
    const tot = on.reduce((s, u) => s + u.r90, 0) || 1;
    const xs = on.map((u) => {
      const ls = Math.log(u.r90 / tot);
      return Math.max(0, Ma * playerShare(model, a, u.group, ls, u.psf || 0) - Mb * playerShare(model, b, u.group, ls, u.psf || 0));
    });
    const sx = xs.reduce((s, x) => s + x, 0);
    const scale = sx > seg && sx > 0 ? seg / sx : 1; // players never take more than the team
    on.forEach((u, j) => lam.set(u.id, lam.get(u.id) + xs[j] * scale));
  }
  const players = units.map((u) => ({ id: u.id, lambda: lam.get(u.id) * tempo, q: goalPerShot(model, u.pconv) }));
  const sumP = players.reduce((s, p) => s + p.lambda, 0);
  const mu = teamMean * tempo;
  return { mu, players, others: { lambda: Math.max(0, mu - sumP), q: goalPerShot(model, model.league_ref.conv_all) } };
}

// ---- distributions ----
export function nbLogPmf(y, mu, k) {
  return lgamma(y + k) - lgamma(k) - lgamma(y + 1) + k * Math.log(k / (k + mu)) + y * Math.log(mu / (k + mu) || 1e-300);
}
export function nbTail(mu, k, n) {
  mu = Math.max(mu, 1e-9);
  let s = 0;
  for (let y = 0; y < n; y++) s += Math.exp(nbLogPmf(y, mu, k));
  return 1 - s;
}
export function nbCdf(y, mu, k) {
  let s = 0;
  for (let i = 0; i <= y; i++) s += Math.exp(nbLogPmf(i, Math.max(mu, 1e-9), k));
  return s;
}
function lgamma(x) {
  // Lanczos approximation (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ---- Monte Carlo ----
// Team total must be NB(mu, k_team) and each player NB(lambda, k_player). Per
// run a shared team frailty G ~ Gamma(mean 1, var vG) multiplies every unit,
// and each unit gets its own noise e ~ Gamma(mean 1, var vE):
//   Y_i ~ Poisson(lambda_i G e_i).
// vG and vE are set so both the team total and each player match the target
// mean and variance:
//   player: (1 + vG)(1 + vE) = 1 + 1/k_player
//   team:   vG mu^2 + (1 + vG) vE S2 = mu^2 / k_team,  S2 = sum lambda_i^2
// which gives vG = (mu^2/k_team - S2/k_player) / (mu^2 - S2).
export function mixing(mu, lambdas, kTeam, kPlayer) {
  const c = 1 / kPlayer;
  const d = 1 / kTeam;
  const s2 = lambdas.reduce((a, l) => a + l * l, 0);
  const mu2 = mu * mu;
  let vG = mu2 > s2 ? (d * mu2 - c * s2) / (mu2 - s2) : 0;
  vG = Math.max(0, Math.min(c, vG));
  const vE = Math.max(0, (1 + c) / (1 + vG) - 1);
  return { vG, vE };
}

export function gammaSample(shape, rng) {
  if (shape < 1) return gammaSample(shape + 1, rng) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u || 1e-300) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function normal(rng) {
  const u = rng() || 1e-12;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function poissonSample(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + normal(rng) * Math.sqrt(lambda)));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
// Mean-one gamma with variance v (1 when v = 0).
export const frailty = (v, rng) => (v > 0 ? gammaSample(1 / v, rng) * v : 1);

// Runs the simulation. teams: [{base: {shots, sot, goals}, units: [{lambda, q, sot}]}]
// (each unit is a player or the team's "others"; sot = share of shots on
// target). Returns per-unit and per-team sums and the shot histograms.
export function simulate(model, teams, runs, rng = Math.random) {
  const kT = model.team.k;
  const kP = model.player.k;
  const prep = teams.map((tm) => {
    const mu = tm.units.reduce((s, u) => s + u.lambda, 0);
    const { vG, vE } = mixing(mu, tm.units.map((u) => u.lambda), kT, kP);
    return { tm, vG, vE, mu };
  });
  const out = prep.map(({ tm, vG, vE, mu }) => ({
    mu,
    vG,
    vE,
    shots: 0,
    sot: 0,
    goals: 0,
    hist: new Map(),
    units: tm.units.map(() => ({ shots: 0, sot: 0, goals: 0, c1: 0, c2: 0, c3: 0, g1: 0 })),
  }));
  const total = { sum: 0, hist: new Map() };
  for (let r = 0; r < runs; r++) {
    let all = 0;
    prep.forEach(({ tm, vG, vE }, ti) => {
      const acc = out[ti];
      const G = frailty(vG, rng);
      let ts = tm.base.shots;
      let tsot = tm.base.sot;
      let tg = tm.base.goals;
      tm.units.forEach((u, ui) => {
        if (u.lambda <= 0) return;
        const k = poissonSample(u.lambda * G * frailty(vE, rng), rng);
        if (!k) return;
        let sot = 0;
        let goals = 0;
        const pSot = Math.max(u.sot, u.q); // every goal is on target
        for (let i = 0; i < k; i++) {
          const x = rng();
          if (x < u.q) goals++;
          if (x < pSot) sot++;
        }
        const pa = acc.units[ui];
        pa.shots += k;
        pa.sot += sot;
        pa.goals += goals;
        pa.c1++;
        if (k >= 2) pa.c2++;
        if (k >= 3) pa.c3++;
        if (goals) pa.g1++;
        ts += k;
        tsot += sot;
        tg += goals;
      });
      acc.shots += ts;
      acc.sot += tsot;
      acc.goals += tg;
      acc.hist.set(ts, (acc.hist.get(ts) || 0) + 1);
      all += ts;
    });
    total.sum += all;
    total.hist.set(all, (total.hist.get(all) || 0) + 1);
  }
  return { teams: out, total, runs };
}
