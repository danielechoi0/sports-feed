// Features for the fitted team-share shot model (pipeline/models/team_share.py,
// exported to models/shot-<league>.json by pipeline/export.py).
//
// Pure functions shared by the server (lib/shotModel.js, from ESPN data) and
// the parity check (pipeline/parity.mjs, from the pipeline tables). They follow
// the Python code line by line: the same minute parsing, shot outcomes from the
// commentary, data-quality check, position groups, recency weights and
// shrinkage.

// "45'+2'" -> 47 (base + added time), as pipeline/extract.py.
// ESPN sub flags are booleans in played matches but { didSub } objects in
// pre-match lineups; see didSub in lib/espn.js (kept local so this module has
// no imports).
const didSub = (v) => v === true || v?.didSub === true;

export function minuteOf(txt) {
  const m = String(txt ?? '').match(/(\d+)'?(?:\s*\+\s*(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
}

const SHOT_TYPES = {
  'shot off target': 'off',
  'shot on target': 'saved',
  'shot blocked': 'blocked',
  'shot hit woodwork': 'woodwork',
  goal: 'goal',
  'goal - header': 'goal',
  'goal - free-kick': 'goal',
  'goal - volley': 'goal',
  'penalty - scored': 'goal',
  'penalty - saved': 'saved',
  'penalty - missed': 'off',
};

export function shotOutcome(typeText) {
  const t = String(typeText ?? '').toLowerCase();
  if (t in SHOT_TYPES) return SHOT_TYPES[t];
  if (t.startsWith('goal') && !t.includes('own goal')) return 'goal';
  if (t.startsWith('penalty')) return t.includes('scored') ? 'goal' : 'off';
  return null;
}

// Position group as pipeline/models/base.py pos_group. A missing position
// is "NAN" there (pandas NaN stringified), which falls through to M.
export function posGroupTS(abbr) {
  const a = String(abbr ?? 'NAN').toUpperCase();
  if (a === 'G' || a === 'GK') return 'G';
  if (/^(CD|LB|RB|LWB|RWB|CB|SW)/.test(a) || a === 'D') return 'D';
  if (/^(AM|LW|RW|LAM|RAM)/.test(a) || a === 'W') return 'AM';
  if (/^(F|CF|ST|SS|LF|RF|RCF|LCF)/.test(a)) return 'F';
  return 'M';
}

function stat(p, name) {
  const s = (p.stats || []).find((x) => x.name === name);
  const v = Number(s?.value ?? s?.displayValue ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// Bumped when the extract rules change, so cached extracts are rebuilt.
export const EXTRACT_VERSION = 2;

// Did an event at (minute, period) happen at or before checkpoint t? As
// pipeline/dataset.py before(): t <= 45 is a first-half minute (45 = half
// time, first-half added time included), t > 45 a second-half one.
export function before(minute, period, t) {
  if (minute == null || t === 0) return false;
  if (period === 1) return t >= 45 || minute <= t;
  if (period === 2) return t > 45 && minute <= t;
  return minute <= t;
}

// Compact model extract of one ESPN match summary, as pipeline/extract.py +
// pipeline/dataset.py load_matches (incl. its data check). Team shots are
// counted from the commentary: shoot-out kicks (period 5) never count, and in
// a knockout game that went to extra time only regulation-time shots count
// (the data check still compares every shot before the shoot-out with the
// player box scores, which include extra time). Players carry box-score shots
// and goals and minutes on/off.
export function extractModelMatch(sum) {
  const comp = sum?.header?.competitions?.[0];
  if (!comp) return null;
  const teams = (comp.competitors || []).map((c) => ({ id: String(c.team?.id), name: c.team?.displayName, home: c.homeAway === 'home', shots: 0, shotsAll: 0 }));
  if (teams.length !== 2) return null;
  const byName = new Map(teams.map((t) => [t.name, t]));
  const commentary = sum.commentary || [];
  const endMin = Math.max(90, ...commentary.map((x) => minuteOf(x.time?.displayValue) || 0));
  const periods = commentary.map((x) => x.play?.period?.number).filter((p) => p);
  const extraTime = Math.max(2, ...periods) > 2;
  for (const x of commentary) {
    const pl = x.play || {};
    if (!shotOutcome(pl.type?.text)) continue;
    const t = byName.get(pl.team?.displayName);
    if (!t) continue;
    const p = pl.period?.number;
    if (p != null && p >= 5) continue;
    t.shotsAll++;
    if (extraTime && p != null && p > 2) continue;
    t.shots++;
  }
  const apps = [];
  for (const r of sum.rosters || []) {
    const teamId = String(r.team?.id);
    if (!teams.some((t) => t.id === teamId)) continue;
    for (const p of r.roster || []) {
      const plays = p.plays || [];
      const subs = plays.filter((x) => x.substitution).map((x) => minuteOf(x.clock?.displayValue)).filter((m) => m != null);
      const reds = plays.filter((x) => x.redCard).map((x) => minuteOf(x.clock?.displayValue)).filter((m) => m != null);
      const starter = !!p.starter;
      const on = starter ? 0 : didSub(p.subbedIn) && subs.length ? subs[0] : null;
      if (on == null) continue; // unused substitute
      let off = endMin;
      if (didSub(p.subbedOut)) {
        const outs = starter ? subs : subs.slice(1);
        if (outs.length) off = outs[0];
      }
      if (reds.length) off = Math.min(off, reds[0]);
      apps.push({
        id: String(p.athlete?.id),
        teamId,
        pos: p.position?.abbreviation ?? null,
        starter,
        minutes: Math.max(0, off - on),
        shots: stat(p, 'totalShots'),
        goals: stat(p, 'totalGoals'),
      });
    }
  }
  // Data check: commentary team shots within 2 of the players' box-score total.
  const ok = teams.every((t) => Math.abs(t.shotsAll - apps.filter((a) => a.teamId === t.id).reduce((s, a) => s + a.shots, 0)) <= 2);
  return {
    v: EXTRACT_VERSION,
    id: String(sum.header?.id || comp.id),
    date: comp.date,
    league: sum.header?.league?.slug || null,
    endMin,
    extraTime,
    neutral: !!comp.neutralSite,
    ok,
    teams: teams.map(({ id, home, shots }) => ({ id, home, shots })),
    apps,
  };
}

// In-play state of a live (or finished) match from its summary, for the
// shots-so-far features: commentary shots per team and per player (shooter
// matched to the roster by name, as pipeline/extract.py), each with minute
// and period, and each player's minute on. Shoot-out kicks are left out.
export function liveShots(sum) {
  const comp = sum?.header?.competitions?.[0];
  const teams = (comp?.competitors || []).map((c) => ({ id: String(c.team?.id), name: c.team?.displayName }));
  const byName = new Map(teams.map((t) => [t.name, t.id]));
  const playerByName = new Map();
  const onMin = {};
  for (const r of sum?.rosters || []) {
    const teamId = String(r.team?.id);
    for (const p of r.roster || []) {
      const id = String(p.athlete?.id);
      playerByName.set(`${teamId}|${p.athlete?.displayName}`, id);
      const subs = (p.plays || []).filter((x) => x.substitution).map((x) => minuteOf(x.clock?.displayValue)).filter((m) => m != null);
      if (p.starter) onMin[id] = 0;
      else if (didSub(p.subbedIn) && subs.length) onMin[id] = subs[0];
    }
  }
  const shots = [];
  for (const x of sum?.commentary || []) {
    const pl = x.play || {};
    if (!shotOutcome(pl.type?.text)) continue;
    const teamId = byName.get(pl.team?.displayName);
    if (!teamId) continue;
    const period = pl.period?.number ?? null;
    if (period != null && period >= 5) continue;
    const shooter = pl.participants?.[0]?.athlete?.displayName;
    shots.push({ teamId, playerId: playerByName.get(`${teamId}|${shooter}`) ?? null, minute: minuteOf(pl.clock?.displayValue), period });
  }
  return { shots, onMin };
}

// games: one team's previous matches, most recent first (each {teams:[{id, shots}]}).
// Recency-weighted shots for and against per match, shrunk toward the league rate.
export function teamRates(games, teamId, cfg, leagueRate) {
  let wFor = 0;
  let wAg = 0;
  let w = 0;
  games.slice(0, cfg.team_n).forEach((g, i) => {
    const wi = Math.pow(0.5, i / cfg.team_half_life);
    const me = g.teams.find((t) => t.id === teamId);
    const them = g.teams.find((t) => t.id !== teamId);
    wFor += wi * me.shots;
    wAg += wi * them.shots;
    w += wi;
  });
  const prior = cfg.team_prior_games;
  return {
    att: (wFor + prior * leagueRate) / (w + prior),
    dfn: (wAg + prior * leagueRate) / (w + prior),
    matches: Math.min(games.length, cfg.team_n),
  };
}

// ---- multi-competition model (pipeline/models/pooled.py, team_share_oppadj) ----

// A team's unadjusted attack/defence relative to its competition's rate at the
// time (OpponentAdjusted._raw_rel): games = its previous matches before that
// date, most recent first; rate = the competition's rate on that day.
export function rawRelative(games, teamId, cfg, rate) {
  const r = teamRates(games, teamId, cfg, rate);
  return { att: r.att / rate, dfn: r.dfn / rate };
}

// Opponent-adjusted attack/defence (OpponentAdjusted._team_attack_defence):
// each past match's shots for are divided by that opponent's relative defence
// at the time, shots against by its relative attack; recency-weighted and
// shrunk toward today's competition rate. oppRel(game, oppId) -> {att, dfn}.
export function oppAdjRates(games, teamId, cfg, rate, oppRel) {
  let wFor = 0;
  let wAg = 0;
  let w = 0;
  games.slice(0, cfg.team_n).forEach((g, i) => {
    const wi = Math.pow(0.5, i / cfg.team_half_life);
    const me = g.teams.find((t) => t.id === teamId);
    const them = g.teams.find((t) => t.id !== teamId);
    const o = oppRel(g, them.id);
    wFor += (wi * me.shots) / o.dfn;
    wAg += (wi * them.shots) / o.att;
    w += wi;
  });
  const prior = cfg.team_prior_games;
  return { att: (wFor + prior * rate) / (w + prior), dfn: (wAg + prior * rate) / (w + prior), matches: Math.min(games.length, cfg.team_n) };
}

// A competition's team shots per match on a given day (its previous 380
// matches), from the exported history: the exact value for days in the
// pipeline tables; for later days the export's latest rate (fixed at export,
// like the league reference rates); a day missing from the tables takes the
// latest earlier day's value.
const DAYS = new WeakMap();
export function competitionRateAt(model, league, date) {
  const hist = model.rate_history?.[league];
  const latest = model.league_ref?.[league]?.rate ?? 12.5;
  if (!hist) return latest;
  const day = String(date).slice(0, 10);
  if (day in hist) return hist[day];
  if (!DAYS.has(hist)) DAYS.set(hist, Object.keys(hist).sort());
  const days = DAYS.get(hist);
  if (!days.length || day > days[days.length - 1]) return latest;
  let lo = 0;
  let hi = days.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < day) (best = days[mid]), (lo = mid + 1);
    else hi = mid - 1;
  }
  return best ? hist[best] : hist[days[0]];
}

// A player's usual position when the lineup lists him as SUB: most common in
// his last 30 appearances (ties: the most recent first), else "M". A missing
// position stays missing (the pipeline's NaN), which groups as M.
export function resolvePosition(pos, rowsRecentFirst, n = 30) {
  if (pos !== 'SUB') return pos ?? 'NAN';
  const counts = new Map();
  for (const r of rowsRecentFirst.slice(0, n)) {
    const p = r.pos ?? 'NAN';
    if (p === 'SUB') continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [p, c] of counts) if (c > bestN) [best, bestN] = [p, c];
  return best ?? 'M';
}

// rows: the player's previous appearances, most recent first ({minutes, shots, goals}).
export function playerRate(rows, group, cfg, ref) {
  let mins = 0;
  let sh = 0;
  let totSh = 0;
  let totGl = 0;
  const use = rows.slice(0, cfg.player_n);
  use.forEach((x, i) => {
    const wi = Math.pow(0.5, i / cfg.player_half_life);
    mins += wi * x.minutes;
    sh += wi * x.shots;
    totSh += x.shots;
    totGl += x.goals;
  });
  const prior90 = ref.pos90[group] ?? 1.0;
  const rate90 = (sh * 90 + prior90 * cfg.player_prior_min) / (mins + cfg.player_prior_min);
  const c0 = ref.conv[group] ?? 0.1;
  const pconv = (totGl + c0 * cfg.conv_prior_shots) / (totSh + cfg.conv_prior_shots);
  return { r90: Math.max(rate90, 0.01), pconv: Math.max(pconv, 0.005), apps: use.length, minutes: use.reduce((a, x) => a + x.minutes, 0), shots: totSh, goals: totGl };
}

// League reference rates over a list of matches (the parity check computes
// them per match date; the app uses the exported values).
export function leagueRef(games) {
  let shots = 0;
  let n = 0;
  const mins = {};
  const sh = {};
  const gl = {};
  for (const g of games) {
    for (const t of g.teams) {
      shots += t.shots;
      n++;
    }
    for (const a of g.apps) {
      if (a.pos === 'SUB') continue; // the pipeline skips SUB-listed rows (missing positions count as M)
      const grp = posGroupTS(a.pos);
      mins[grp] = (mins[grp] || 0) + a.minutes;
      sh[grp] = (sh[grp] || 0) + a.shots;
      gl[grp] = (gl[grp] || 0) + a.goals;
    }
  }
  const pos90 = {};
  const conv = {};
  for (const k of Object.keys(mins)) if (mins[k]) pos90[k] = (90 * sh[k]) / mins[k];
  for (const k of Object.keys(sh)) if (sh[k]) conv[k] = gl[k] / sh[k];
  return { rate: shots / Math.max(1, n), pos90, conv };
}
