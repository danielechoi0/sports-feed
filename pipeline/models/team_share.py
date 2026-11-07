"""Team-first model: team shots, then each player's share of them.

1. Team shots after minute t ~ negative binomial (fitted dispersion), with
   log mean = intercept for t (captures time left, added time included)
            + b1 log(team attack rate) + b2 log(opponent's shots-allowed rate)
            + home + score state (trailing / leading, stronger late)
            + man advantage
   Attack and defence rates are recency-weighted shots per match over each
   team's previous matches (across seasons), shrunk toward the league rate.
2. Player shots after t ~ negative binomial around
   log mean = log(predicted team mean) + intercept for t
            + c1 log(player's share of the on-pitch shooting rate) + position
   which learns how much of the team's remaining shots the current XI takes
   (subs take the rest) and how often each position is subbed off.
3. Player goals after t: expected shots x finishing rate (shrunk heavily to the
   position average), with a fitted calibration.
All coefficients are fitted on the train split by maximum likelihood.
"""
import math
from collections import defaultdict

import numpy as np
import statsmodels.api as sm
from scipy.optimize import minimize_scalar
from scipy.special import gammaln

from ..dataset import state_at, targets_after
from .base import K, Model, player_position, pos_group

POS = ["G", "D", "M", "AM", "F"]
CHECKS = (0, 15, 30, 45, 60, 75)


def nb_logpmf(y, mu, k):
    return gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))


def fit_dispersion(y, mu):
    y, mu = np.asarray(y, float), np.maximum(np.asarray(mu, float), 1e-6)
    res = minimize_scalar(lambda lk: -nb_logpmf(y, mu, math.exp(lk)).sum(), bounds=(-3, 8), method="bounded")
    return math.exp(res.x)


def nb_pmf(mu, k):
    p = np.exp(nb_logpmf(K.astype(float), max(mu, 1e-9), k))
    p[-1] += max(0.0, 1 - p.sum())
    return p


def nb_tail(mu, k, n):
    """P(X >= n) for n = 1, 2, 3."""
    mu = max(mu, 1e-9)
    ps = np.exp(nb_logpmf(np.arange(n), mu, k))
    return 1 - ps.sum()


class TeamShare(Model):
    name = "team_share"
    # recency settings (tuned by the improvement loop)
    team_half_life = 8.0  # matches
    team_n = 30
    team_prior_games = 4.0
    player_half_life = 10.0
    player_n = 40
    player_prior_min = 450.0
    conv_prior_shots = 40.0
    team_ridge = {}  # coefficient name -> penalty

    # ---- features ----
    def _league(self, history, date):
        key = date[:10]
        cache = self.__dict__.setdefault("_lg", {})
        if key not in cache:
            games = history.league_games(date)[-380:]
            shots = [tm.shots for m in games for tm in (m.home, m.away)]
            rate = sum(shots) / max(1, len(shots))
            mins, sh, gl = defaultdict(float), defaultdict(float), defaultdict(float)
            for m in games:
                for tm in (m.home, m.away):
                    for p in tm.players.values():
                        if p["pos"] in (None, "SUB"):
                            continue
                        g = pos_group(p["pos"])
                        mins[g] += p["minutes"]
                        sh[g] += p["shots"]
                        gl[g] += p["goals"]
            pos90 = {g: 90 * sh[g] / mins[g] for g in mins if mins[g]}
            conv = {g: gl[g] / sh[g] for g in sh if sh[g]}
            cache[key] = (rate, pos90, conv)
        return cache[key]

    def _team_rates(self, team_id, date, history, league_rate):
        hs = history.team_recent(team_id, date, self.team_n)
        w_for = w_ag = w = 0.0
        for i, m in enumerate(hs):
            wi = 0.5 ** (i / self.team_half_life)
            w_for += wi * m.team(team_id).shots
            w_ag += wi * m.other(team_id).shots
            w += wi
        prior = self.team_prior_games
        att = (w_for + prior * league_rate) / (w + prior)
        dfn = (w_ag + prior * league_rate) / (w + prior)
        return att, dfn

    def _player(self, p, date, history, pos90, conv):
        rows = history.player_recent(p["player_id"], date, self.player_n)
        mins = sh = gl = 0.0
        tot_sh = tot_gl = 0.0
        for i, x in enumerate(rows):
            wi = 0.5 ** (i / self.player_half_life)
            mins += wi * x[2]["minutes"]
            sh += wi * x[2]["shots"]
            tot_sh += x[2]["shots"]
            tot_gl += x[2]["goals"]
        g = pos_group(player_position(p, history, date))
        prior90 = pos90.get(g, 1.0)
        rate90 = (sh * 90 + prior90 * self.player_prior_min) / (mins + self.player_prior_min)
        c0 = conv.get(g, 0.1)
        pconv = (tot_gl + c0 * self.conv_prior_shots) / (tot_sh + self.conv_prior_shots)
        return g, max(rate90, 0.01), max(pconv, 0.005)

    def features(self, match, team_id, t, history):
        cache = self.__dict__.setdefault("_fc", {})
        key = (match.match_id, team_id)
        if key not in cache:
            rate, pos90, conv = self._league(history, match.date)
            opp_id = match.other(team_id).team_id
            att, _ = self._team_rates(team_id, match.date, history, rate)
            _, opp_dfn = self._team_rates(opp_id, match.date, history, rate)
            players = {pid: self._player(p, match.date, history, pos90, conv) for pid, p in match.team(team_id).players.items()}
            if len(cache) > 5000:
                cache.clear()
            cache[key] = (rate, att, opp_dfn, players)
        rate, att, opp_dfn, players = cache[key]
        st = state_at(match, team_id, t)
        diff = st.goals_for - st.goals_against
        late = 1.0 if t >= 60 else 0.0
        x = {f"t{c}": float(t == c) for c in CHECKS}
        x.update(
            {
                "log_att": math.log(att / rate),
                "log_opp_def": math.log(opp_dfn / rate),
                "home": float(match.team(team_id).home),
                "trail": float(diff < 0),
                "lead": float(diff > 0),
                "trail_late": float(diff < 0) * late,
                "lead_late": float(diff > 0) * late,
                "man_adv": float(np.clip(st.reds_against - st.reds_for, -1, 1)),
            }
        )
        on = []
        for p in st.on_pitch:
            g, r90, pconv = players[p["player_id"]]
            on.append((p["player_id"], g, r90, pconv))
        return x, on, math.log(rate)

    TEAM_COLS = [f"t{c}" for c in CHECKS] + ["log_att", "log_opp_def", "home", "trail", "lead", "trail_late", "lead_late", "man_adv"]
    PLAYER_COLS = [f"t{c}" for c in CHECKS] + ["log_share"] + [f"pos_{g}" for g in POS if g != "M"]

    def _player_row(self, t, g, log_share, pid):
        return [float(t == c) for c in CHECKS] + [log_share] + [float(g == q) for q in POS if q != "M"]

    # ---- fitting ----
    def fit(self, train, history):
        team_x, team_y, team_off = [], [], []
        prow = []  # (team_row_index, player features, shots_after, goals_after, pconv)
        for m in train:
            for tid in (m.home.team_id, m.away.team_id):
                for t in CHECKS:
                    if t > 0 and t >= m.end_min:
                        continue
                    x, on, off = self.features(m, tid, t, history)
                    y, per = targets_after(m, tid, t)
                    idx = len(team_y)
                    team_x.append([x[c] for c in self.TEAM_COLS])
                    team_y.append(y)
                    team_off.append(off)
                    tot = sum(r for _, _, r, _ in on) or 1.0
                    for pid, g, r90, pconv in on:
                        ys, yg = per.get(pid, (0, 0))
                        prow.append((idx, self._player_row(t, g, math.log(r90 / tot), pid), ys, yg, pconv))
        X = np.asarray(team_x)
        y = np.asarray(team_y, float)
        off = np.asarray(team_off)
        glm = sm.GLM(y, X, family=sm.families.Poisson(), offset=off)
        if self.team_ridge:
            # ridge penalty on selected coefficients (rare situations, e.g. red cards)
            alpha = np.array([self.team_ridge.get(c, 0.0) for c in self.TEAM_COLS]) / len(y)
            self.team_beta = glm.fit_regularized(method="elastic_net", alpha=alpha, L1_wt=0.0, start_params=glm.fit().params).params
        else:
            self.team_beta = glm.fit().params
        mu = np.exp(X @ self.team_beta + off)
        self.team_k = fit_dispersion(y, mu)

        # players: offset = log(fitted team mean)
        Xp, yp, offp, yg, conv_log = [], [], [], [], []
        for idx, row, ys, ygoal, pconv in prow:
            Xp.append(row)
            yp.append(ys)
            offp.append(math.log(mu[idx]))
            yg.append(ygoal)
            conv_log.append(math.log(pconv))
        Xp, yp, offp = np.asarray(Xp), np.asarray(yp, float), np.asarray(offp)
        pglm = sm.GLM(yp, Xp, family=sm.families.Poisson(), offset=offp).fit()
        self.player_beta = pglm.params
        lam = np.exp(Xp @ self.player_beta + offp)
        self.player_k = fit_dispersion(yp, lam)

        # goals: log E[goals] = log(lam) + g0 + g1 log(conv)
        Xg = np.column_stack([np.ones(len(yg)), np.asarray(conv_log)])
        gglm = sm.GLM(np.asarray(yg, float), Xg, family=sm.families.Poisson(), offset=np.log(lam)).fit()
        self.goal_beta = gglm.params
        self.__dict__.pop("_fc", None)
        return self

    # ---- prediction ----
    def predict(self, match, team_id, t, history):
        x, on, off = self.features(match, team_id, t, history)
        mu = math.exp(float(np.dot([x[c] for c in self.TEAM_COLS], self.team_beta)) + off)
        pmf = nb_pmf(mu, self.team_k)
        tot = sum(r for _, _, r, _ in on) or 1.0
        players = {}
        for pid, g, r90, pconv in on:
            row = self._player_row(t, g, math.log(r90 / tot), pid)
            lam = math.exp(float(np.dot(row, self.player_beta)) + math.log(mu))
            lam_g = math.exp(math.log(max(lam, 1e-9)) + self.goal_beta[0] + self.goal_beta[1] * math.log(pconv))
            k = self.player_k
            players[pid] = {
                "mean": lam,
                "p1": nb_tail(lam, k, 1),
                "p2": nb_tail(lam, k, 2),
                "p3": nb_tail(lam, k, 3),
                "pgoal": 1 - (k / (k + lam_g)) ** k,
            }
        return {"pmf": pmf, "players": players}



class TeamShareTuned(TeamShare):
    """Loop round 3: recency/shrinkage settings tuned on dev (pipeline.tune)."""

    name = "team_share_tuned"
    team_half_life = 20.0
    team_prior_games = 2.0
    player_half_life = 25.0
    player_prior_min = 180.0


class TeamShareRidge(TeamShareTuned):
    """Loop round 4: + shrink the man-advantage effect (few red cards in training)."""

    name = "team_share_ridge"
    team_ridge = {"man_adv": 50.0}

