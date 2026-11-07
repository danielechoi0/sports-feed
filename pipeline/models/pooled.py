"""Multi-competition versions of the team-first model.

TeamShareRidge (team_share.py) is left exactly as it is; these subclasses add
what several competitions need:

* league reference rates (team shots per match, position shot and conversion
  rates) per competition, cached per competition and date
* one fit across all competitions with a team-shot intercept per competition
  (`pooled = True`); the per-competition alternative is team_share_ridge
  fitted on each competition's own train matches
Later loop rounds add one change each (see the class docstrings and the
ledger).
"""
import math
from collections import defaultdict

import numpy as np

from ..dataset import before, state_at, targets_after
from .base import pos_group
from .team_share import CHECKS, TeamShareRidge, fit_dispersion, nb_pmf
from .xg import XG


class TeamSharePooled(TeamShareRidge):
    """Scale-up: one fit over every competition, with a team-shot intercept per competition."""

    name = "team_share_pooled"
    pooled = True
    league_window = 380  # matches of the competition used for its reference rates

    # ---- league reference rates, per competition ----
    def _league_rates(self, history, date, league):
        key = (league, date[:10])
        cache = self.__dict__.setdefault("_lg2", {})
        if key not in cache:
            games = history.league_games(date, league=league)[-self.league_window :]
            cache[key] = self._rates_from(games)
        return cache[key]

    @staticmethod
    def _rates_from(games):
        shots = [tm.shots for m in games for tm in (m.home, m.away)]
        rate = sum(shots) / max(1, len(shots)) if shots else 12.5
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
        return rate, pos90, conv

    def _team_attack_defence(self, team_id, match, history, rate):
        return self._team_rates(team_id, match.date, history, rate)

    def _ref_rate(self, history, match, rate):
        """The competition's team shots per match today (offset of the team model)."""
        return rate

    def _extra_team(self, match, team_id, t, st, history):
        """Hook for later rounds: extra team-shot features."""
        return {}

    def team_cols(self, leagues):
        base = [f"t{c}" for c in CHECKS] + ["log_att", "log_opp_def", "home", "trail", "lead", "trail_late", "lead_late", "man_adv"]
        return base + self.extra_cols() + [f"lg_{lg}" for lg in sorted(leagues)[1:]]

    def extra_cols(self):
        return []

    def features(self, match, team_id, t, history):
        cache = self.__dict__.setdefault("_fc", {})
        key = (match.match_id, team_id)
        if key not in cache:
            rate, pos90, conv = self._league_rates(history, match.date, match.league)
            rate = self._ref_rate(history, match, rate)
            opp_id = match.other(team_id).team_id
            att, _ = self._team_attack_defence(team_id, match, history, rate)
            _, opp_dfn = self._team_attack_defence(opp_id, match, history, rate)
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
                "home": float(match.team(team_id).home and not match.neutral),
                "trail": float(diff < 0),
                "lead": float(diff > 0),
                "trail_late": float(diff < 0) * late,
                "lead_late": float(diff > 0) * late,
                "man_adv": float(np.clip(st.reds_against - st.reds_for, -1, 1)),
            }
        )
        x.update(self._extra_team(match, team_id, t, st, history))
        for c in self.TEAM_COLS:
            if c.startswith("lg_"):
                x[c] = float(match.league == c[3:])
        on = []
        for p in st.on_pitch:
            g, r90, pconv = players[p["player_id"]]
            on.append((p["player_id"], g, r90, pconv))
        return x, on, math.log(rate)

    def fit(self, train, history):
        self.TEAM_COLS = self.team_cols({m.league for m in train})
        return super().fit(train, history)


class TeamShareLevel(TeamSharePooled):
    """Round 1: follow league-wide shot level changes.

    The competition's shot level is an exponentially weighted mean over its
    recent matches (half-life `level_half_life` matches) instead of the last
    380. Team attack/defence are measured relative to the level of the
    competition each past match was played in, then scaled by today's level, so
    a league-wide rise shows up after a few rounds instead of a season."""

    name = "team_share_level"
    level_half_life = 60.0  # matches
    level_n = 300

    def _level(self, history, league, date):
        key = (league, date[:10])
        cache = self.__dict__.setdefault("_lvl", {})
        if key not in cache:
            games = history.league_games(date, league=league)[-self.level_n :]
            if len(games) < 40:  # too little of this competition yet: every competition
                games = history.league_games(date)[-self.level_n :]
            num = den = 0.0
            for i, m in enumerate(reversed(games)):
                w = 0.5 ** (i / self.level_half_life)
                num += w * (m.home.shots + m.away.shots) / 2
                den += w
            cache[key] = num / den if den else 12.5
        return cache[key]

    def _team_attack_defence(self, team_id, match, history, rate):
        hs = history.team_recent(team_id, match.date, self.team_n)
        w_for = w_ag = w = 0.0
        for i, m in enumerate(hs):
            wi = 0.5 ** (i / self.team_half_life)
            lv = self._level(history, m.league, m.date)
            w_for += wi * m.team(team_id).shots / lv
            w_ag += wi * m.other(team_id).shots / lv
            w += wi
        prior = self.team_prior_games
        now = self._level(history, match.league, match.date)
        # relative rates scaled to today's level, so log(att / now) is relative form
        return now * (w_for + prior) / (w + prior), now * (w_ag + prior) / (w + prior)

    def _ref_rate(self, history, match, rate):
        return self._level(history, match.league, match.date)


class CheckpointDispersion:
    """Mixin: the team-shot negative binomial gets its own dispersion per checkpoint."""

    def fit(self, train, history):
        super().fit(train, history)
        ys, mus = defaultdict(list), defaultdict(list)
        for m in train:
            for tid in (m.home.team_id, m.away.team_id):
                for t in CHECKS:
                    if t > 0 and t >= m.end_min:
                        continue
                    x, _, off = self.features(m, tid, t, history)
                    ys[t].append(targets_after(m, tid, t)[0])
                    mus[t].append(math.exp(float(np.dot([x[c] for c in self.TEAM_COLS], self.team_beta)) + off))
        self.team_k_t = {t: fit_dispersion(ys[t], mus[t]) for t in ys}
        self.__dict__.pop("_fc", None)
        return self

    def predict(self, match, team_id, t, history):
        out = super().predict(match, team_id, t, history)
        x, _, off = self.features(match, team_id, t, history)
        mu = math.exp(float(np.dot([x[c] for c in self.TEAM_COLS], self.team_beta)) + off)
        out["pmf"] = nb_pmf(mu, self.team_k_t.get(t, self.team_k))
        return out


class XGGoals:
    """Mixin: goal probabilities from shot quality (xG) instead of raw conversion.

    An xG model (models/xg.py) is fitted on the train shots. Each player's
    expected conversion = his recent xG per shot (shrunk to his position's)
    x his finishing, goals / xG (shrunk to 1); the goal calibration GLM is
    refitted on it."""

    q_prior_shots = 15.0
    fin_prior_xg = 8.0

    def fit(self, train, history):
        self.xg = XG().fit([s for m in train for s in m.shots])
        per = defaultdict(lambda: [0, 0.0, 0])
        for m in history.matches:
            if not m.ok or not m.shots:
                continue
            for s, q in zip(m.shots, self.xg.predict_many(m.shots)):
                acc = per[(m.match_id, s["player_id"])]
                acc[0] += 1
                acc[1] += float(q)
                acc[2] += int(bool(s["goal"]))
        self._pxg = dict(per)
        pos_n, pos_q = defaultdict(float), defaultdict(float)
        for m in train:
            for s in m.shots:
                row = m.team(s["team_id"]).players.get(s["player_id"])
                if row and row["pos"] not in (None, "SUB"):
                    g = pos_group(row["pos"])
                    pos_n[g] += 1
                    pos_q[g] += self._pxg[(m.match_id, s["player_id"])][1] / self._pxg[(m.match_id, s["player_id"])][0]
        self._pos_q = {g: pos_q[g] / pos_n[g] for g in pos_n}
        return super().fit(train, history)

    def _player(self, p, date, history, pos90, conv):
        g, rate90, _ = super()._player(p, date, history, pos90, conv)
        pid = p["player_id"]
        n = xs = gl = 0.0
        for x in history.player_recent(pid, date, self.player_n):
            a = self._pxg.get((x[5].match_id, pid))
            if a:
                n += a[0]
                xs += a[1]
                gl += a[2]
        q0 = self._pos_q.get(g, 0.1)
        q = (xs + q0 * self.q_prior_shots) / (n + self.q_prior_shots)
        fin = (gl + self.fin_prior_xg) / (xs + self.fin_prior_xg)
        return g, rate90, max(q * fin, 0.005)


class TeamShareDisp(CheckpointDispersion, TeamSharePooled):
    """Round 2: team-shot dispersion per checkpoint."""

    name = "team_share_disp"


class TeamShareXG(XGGoals, TeamSharePooled):
    """Round 3: goal probabilities from an xG shot-quality model."""

    name = "team_share_xg"


class InPlayEvidence:
    """Mixin: in-play, how many shots each side has taken so far compared with
    what was expected before kickoff for that much of the match (a team that
    outshoots its pre-match expectation tends to keep doing so)."""

    def extra_cols(self):
        return super().extra_cols() + ["sf_ratio", "opp_sf_ratio"]

    def _pre_match(self, match, history):
        cache = self.__dict__.setdefault("_pm", {})
        if match.match_id not in cache:
            rate = self._ref_rate(history, match, self._league_rates(history, match.date, match.league)[0])
            h_att, h_def = self._team_attack_defence(match.home.team_id, match, history, rate)
            a_att, a_def = self._team_attack_defence(match.away.team_id, match, history, rate)
            if len(cache) > 5000:
                cache.clear()
            cache[match.match_id] = {match.home.team_id: h_att * a_def / rate, match.away.team_id: a_att * h_def / rate}
        return cache[match.match_id]

    def _extra_team(self, match, team_id, t, st, history):
        x = super()._extra_team(match, team_id, t, st, history)
        if t == 0:
            x.update({"sf_ratio": 0.0, "opp_sf_ratio": 0.0})
            return x
        exp = self._pre_match(match, history)
        opp_id = match.other(team_id).team_id
        frac = t / 94.0  # share of a match (with added time) played by minute t
        opp_sf = sum(1 for s in match.shots if s["team_id"] == opp_id and before(s["minute"], s["period"], t))
        x["sf_ratio"] = math.log((st.shots_so_far + 2) / (exp[team_id] * frac + 2))
        x["opp_sf_ratio"] = math.log((opp_sf + 2) / (exp[opp_id] * frac + 2))
        return x


class TeamShareInPlay(InPlayEvidence, TeamSharePooled):
    """Round 4: in-play shot counts so far vs pre-match expectation."""

    name = "team_share_inplay"


class PlayerInPlay:
    """Mixin: in-play, each on-pitch player's shots so far compared with his
    expected shots for the minutes he has played (a player who is getting
    shots off today keeps getting a larger share)."""

    PLAYER_COLS = [f"t{c}" for c in CHECKS] + ["log_share"] + [f"pos_{g}" for g in ("G", "D", "AM", "F")] + ["p_sf_ratio"]

    def features(self, match, team_id, t, history):
        x, on, off = super().features(match, team_id, t, history)
        cur = {}
        if t > 0:
            sf = defaultdict(int)
            for s in match.shots:
                if s["team_id"] == team_id and before(s["minute"], s["period"], t):
                    sf[s["player_id"]] += 1
            rows = match.team(team_id).players
            for pid, g, r90, pconv in on:
                played = max(0.0, t - rows[pid]["on_min"])
                cur[pid] = math.log((sf.get(pid, 0) + 0.5) / (r90 * played / 90 + 0.5))
        self._cur = cur
        return x, on, off

    def _player_row(self, t, g, log_share, pid):
        return super()._player_row(t, g, log_share, pid) + [self._cur.get(pid, 0.0)]


class CupStage:
    """Mixin: cup knockout games. First legs are cagey, second legs are played
    to the aggregate score: knockout first leg / second leg / single game, and
    in a second leg whether the team trails or leads on aggregate (first-leg
    score plus the score so far). Ridge-shrunk: few knockout games."""

    team_ridge = {"man_adv": 50.0, "ko_leg1": 20.0, "ko_leg2": 20.0, "ko_single": 20.0, "agg_trail": 20.0, "agg_lead": 20.0}

    def extra_cols(self):
        return super().extra_cols() + ["ko_leg1", "ko_leg2", "ko_single", "agg_trail", "agg_lead"]

    def _first_leg(self, match, team_id, history):
        cache = self.__dict__.setdefault("_leg1", {})
        key = (match.match_id, team_id)
        if key not in cache:
            diff = None
            if match.knockout and match.leg == 2:
                opp = match.other(team_id).team_id
                for m in history.team_recent(team_id, match.date, 6):
                    if m.league == match.league and m.leg == 1 and m.other(team_id).team_id == opp:
                        diff = m.team(team_id).goals - m.other(team_id).goals
                        break
            cache[key] = diff
        return cache[key]

    def _extra_team(self, match, team_id, t, st, history):
        x = super()._extra_team(match, team_id, t, st, history)
        ko = match.knockout
        x["ko_leg1"] = float(ko and match.leg == 1)
        x["ko_leg2"] = float(ko and match.leg == 2)
        x["ko_single"] = float(ko and match.leg not in (1, 2))
        first = self._first_leg(match, team_id, history)
        agg = None if first is None else first + st.goals_for - st.goals_against
        x["agg_trail"] = float(agg is not None and agg < 0)
        x["agg_lead"] = float(agg is not None and agg > 0)
        return x


class TeamSharePlayerInPlay(PlayerInPlay, InPlayEvidence, TeamSharePooled):
    """Round 5: + each player's shots so far vs his expectation (player share model)."""

    name = "team_share_pinplay"


class TeamShareCup(CupStage, InPlayEvidence, TeamSharePooled):
    """Round 6: + cup knockout stage (first/second leg, single game) and aggregate score."""

    name = "team_share_cup"


class SeasonLevel:
    """Mixin: follow league-wide shot level changes, more smoothly than round 1.

    The competition's level = its season-to-date team shots per match, shrunk
    toward its previous 380 matches with a prior of `level_prior` matches.
    Team attack/defence are measured relative to the level of the competition
    and season each past match was played in, then scaled to today's level."""

    level_prior = 80.0  # matches

    def _level(self, history, league, date):
        key = (league, date[:10])
        cache = self.__dict__.setdefault("_lvl", {})
        if key not in cache:
            games = history.league_games(date, league=league)
            if len(games) < 40:
                games = history.league_games(date)
            season = games[-1].season if games else None
            cur = [m for m in games[-400:] if m.season == season]
            prev = [m for m in games if m.season != season][-380:] or games[-380:]
            prior = sum(m.home.shots + m.away.shots for m in prev) / (2 * max(1, len(prev))) if prev else 12.5
            cur_sum = sum(m.home.shots + m.away.shots for m in cur) / 2
            cache[key] = (cur_sum + self.level_prior * prior) / (len(cur) + self.level_prior)
        return cache[key]

    def _ref_rate(self, history, match, rate):
        return self._level(history, match.league, match.date)

    def _team_attack_defence(self, team_id, match, history, rate):
        hs = history.team_recent(team_id, match.date, self.team_n)
        w_for = w_ag = w = 0.0
        for i, m in enumerate(hs):
            wi = 0.5 ** (i / self.team_half_life)
            lv = self._level(history, m.league, m.date)
            w_for += wi * m.team(team_id).shots / lv
            w_ag += wi * m.other(team_id).shots / lv
            w += wi
        prior = self.team_prior_games
        now = self._level(history, match.league, match.date)
        return now * (w_for + prior) / (w + prior), now * (w_ag + prior) / (w + prior)


class NewTeam:
    """Mixin: teams with little history (promoted clubs, cup sides from leagues
    we do not crawl) are shrunk to the league average, which flatters them:
    indicator for the team and for its opponent having < 10 previous matches."""

    def extra_cols(self):
        return super().extra_cols() + ["new_team", "opp_new_team"]

    def _extra_team(self, match, team_id, t, st, history):
        x = super()._extra_team(match, team_id, t, st, history)
        cache = self.__dict__.setdefault("_nt", {})
        for tid, col in ((team_id, "new_team"), (match.other(team_id).team_id, "opp_new_team")):
            key = (match.match_id, tid)
            if key not in cache:
                if len(cache) > 20000:
                    cache.clear()
                cache[key] = float(len(history.team_recent(tid, match.date, 10)) < 10)
            x[col] = cache[key]
        return x


class TeamShareSeasonLevel(SeasonLevel, PlayerInPlay, InPlayEvidence, TeamSharePooled):
    """Round 7: + season-to-date league level, team form relative to it."""

    name = "team_share_slevel"


class TeamShareNewTeam(NewTeam, PlayerInPlay, InPlayEvidence, TeamSharePooled):
    """Round 8: + thin-history indicators for the team and its opponent."""

    name = "team_share_newteam"


class OpponentAdjusted:
    """Mixin: opponent-adjusted team form. Each past match's shots for (against)
    are divided by that opponent's defence (attack) rating at the time, so 12
    shots against a top side count for more than 12 against a weak one. Matters
    most across competitions (a club's league and European opponents differ).
    One adjustment step; the opponent ratings are the unadjusted ones, relative
    to their competition's rate at that date."""

    def _rate380(self, history, league, date):
        key = (league, date[:10])
        cache = self.__dict__.setdefault("_r380", {})
        if key not in cache:
            games = history.league_games(date, league=league)[-380:]
            if len(games) < 40:
                games = history.league_games(date)[-380:]
            cache[key] = sum(m.home.shots + m.away.shots for m in games) / (2 * len(games)) if games else 12.5
        return cache[key]

    def _raw_rel(self, team_id, date, league, history):
        key = (team_id, date[:10])
        cache = self.__dict__.setdefault("_raw", {})
        if key not in cache:
            rate = self._rate380(history, league, date)
            att, dfn = self._team_rates(team_id, date, history, rate)
            cache[key] = (att / rate, dfn / rate)
        return cache[key]

    def _team_attack_defence(self, team_id, match, history, rate):
        hs = history.team_recent(team_id, match.date, self.team_n)
        w_for = w_ag = w = 0.0
        for i, m in enumerate(hs):
            wi = 0.5 ** (i / self.team_half_life)
            opp = m.other(team_id).team_id
            o_att, o_def = self._raw_rel(opp, m.date, m.league, history)
            w_for += wi * m.team(team_id).shots / o_def
            w_ag += wi * m.other(team_id).shots / o_att
            w += wi
        prior = self.team_prior_games
        return (w_for + prior * rate) / (w + prior), (w_ag + prior * rate) / (w + prior)


class TeamShareOppAdj(OpponentAdjusted, PlayerInPlay, InPlayEvidence, TeamSharePooled):
    """Round 9: + opponent-adjusted team attack/defence form."""

    name = "team_share_oppadj"


class TeamShareDispInPlay(CheckpointDispersion, PlayerInPlay, InPlayEvidence, TeamSharePooled):
    """Round 10: round 2 again on the new base (team-shot dispersion per checkpoint)."""

    name = "team_share_disp2"
