"""Replay of the live simulator (lib/shotModel.js + simPlan in public/app.js).

Kept as close to the JavaScript as the data allows, with its hand-set
constants, so the backtest scores the model users see today. Two unavoidable
differences: history is Premier League only (the app also sees cup games), and
"season totals" are rebuilt from our own data before the match date (the app
asks ESPN for season-to-date totals, which in a backtest would leak the match
being predicted). Scenario settings are the defaults: score state "as it
stands", normal tempo, no lineup edits, remaining minutes = 90 - t.
"""
import numpy as np

from .base import Model, player_position, poisson_pmf, poisson_player, pos_group

HISTORY_MATCHES = 10
HALF_LIFE = 3
SHRINK_MIN = 270
LEAGUE_AVG_FALLBACK = 12.5
PRIORS = {
    "G": {"shots": 0.0, "sot": 0.3, "conv": 0.05},
    "D": {"shots": 0.4, "sot": 0.33, "conv": 0.08},
    "M": {"shots": 0.9, "sot": 0.33, "conv": 0.09},
    "AM": {"shots": 1.6, "sot": 0.36, "conv": 0.11},
    "F": {"shots": 2.3, "sot": 0.38, "conv": 0.14},
}


def weighted_rate(samples, key):
    num = den = 0.0
    for s in samples:
        w = 0.5 ** (s["idx"] / HALF_LIFE)
        num += w * s[key] * s.get("adj", 1)
        den += w * s["minutes"]
    return num / den * 90 if den > 0 else None


def shrink(rate, minutes, prior):
    if rate is None or not minutes:
        return prior
    return (rate * minutes + prior * SHRINK_MIN) / (minutes + SHRINK_MIN)


def player_rates(samples, season, group):
    prior = PRIORS.get(group, PRIORS["M"])
    form_min = sum(s["minutes"] for s in samples)
    form90 = weighted_rate(samples, "shots")
    smin = season["minutes"]
    season90 = season["shots"] / smin * 90 if smin > 0 else None
    form_adj = shrink(form90, form_min, prior["shots"])
    season_adj = shrink(season90, smin, prior["shots"])
    if form90 is not None and season90 is not None:
        shots = 0.5 * form_adj + 0.35 * season_adj + 0.15 * prior["shots"]
    elif form90 is not None:
        shots = 0.8 * form_adj + 0.2 * prior["shots"]
    elif season90 is not None:
        shots = 0.8 * season_adj + 0.2 * prior["shots"]
    else:
        shots = prior["shots"]
    tot_shots = sum(s["shots"] for s in samples) + season["shots"]
    tot_goals = sum(s["goals"] for s in samples) + season["goals"]
    conv = (tot_goals + prior["conv"] * 6) / (tot_shots + 6)
    return shots, min(0.5, conv)


def shape_factor(formation):
    parts = [int(x) for x in str(formation or "").split("-") if x.isdigit() and int(x) > 0]
    if not parts:
        return 1.0
    return 0.93 if parts[0] >= 5 else 1.03 if parts[0] <= 3 else 1.0


class Current(Model):
    name = "current"

    def team_context(self, match, team_id, history):
        """Team-level factors, as in buildShotModel()."""
        key = match.match_id
        if getattr(self, "_ctx_key", None) == key:
            return self._ctx
        hists = {tid: history.team_recent(tid, match.date, HISTORY_MATCHES) for tid in (match.home.team_id, match.away.team_id)}
        seen, tot, n = set(), 0, 0
        for hs in hists.values():
            for m in hs:
                if m.match_id in seen:
                    continue
                seen.add(m.match_id)
                for tm in (m.home, m.away):
                    if tm.shots > 0:
                        tot += tm.shots
                        n += 1
        league_avg = tot / n if n >= 6 else LEAGUE_AVG_FALLBACK

        # opponents' shots faced per game, season to date (league data only)
        faced = {}
        for hs in hists.values():
            for m in hs:
                for tm in (m.home, m.away):
                    oid = tm.team_id
                    if oid in faced:
                        continue
                    games = history.team_season(oid, match.season, match.date)
                    faced[oid] = sum(g.other(oid).shots for g in games) / len(games) if games else None
        vals = [v for v in faced.values() if v]
        league_faced = sum(vals) / len(vals) if len(vals) >= 4 else league_avg

        def opp_adj(oid):
            v = faced.get(oid)
            return 1.0 if not v else min(1.35, max(0.75, league_faced / v))

        teams = {}
        for tid, hs in hists.items():
            tm_now = match.team(tid)
            w_ag = w_n = 0.0
            hf = hn = af = an = 0
            for idx, m in enumerate(hs):
                me, them = m.team(tid), m.other(tid)
                w = 0.5 ** (idx / HALF_LIFE)
                w_ag += w * them.shots
                w_n += w
                if me.home:
                    hf += me.shots
                    hn += 1
                else:
                    af += me.shots
                    an += 1
            against = w_ag / w_n if w_n else league_avg
            overall = (hf + af) / (hn + an) if hn + an else None
            ha = 1.08 if tm_now.home else 0.92
            if overall and hn >= 2 and an >= 2:
                split = (hf / hn if tm_now.home else af / an) / overall
                ha = min(1.25, max(0.8, 0.5 * ha + 0.5 * split))
            # keeper save rate (the starting goalkeeper)
            gk = next((p for p in tm_now.players.values() if p["starter"] and p["pos"] == "G"), None)
            save_rate = 0.7
            if gk:
                saves = conceded = 0
                for x in history.player_recent(gk["player_id"], match.date, HISTORY_MATCHES):
                    saves += x[2]["saves"]
                    conceded += x[2]["conceded"]
                for x in history.player_season(gk["player_id"], match.season, match.date):
                    saves += x[2]["saves"]
                    conceded += x[2]["conceded"]
                save_rate = (saves + 0.7 * 8) / (saves + conceded + 8)
            teams[tid] = {
                "hist": hs,
                "leakiness": min(1.4, max(0.7, against / league_avg)),
                "home_away": ha,
                "shape": shape_factor(tm_now.formation),
                "save_rate": save_rate,
            }
        self._ctx_key, self._ctx = key, {"teams": teams, "opp_adj": opp_adj}
        return self._ctx

    def player_rate(self, p, tid, ctx, match, history):
        pid = p["player_id"]
        cache = ctx.setdefault("rates", {})
        if pid not in cache:
            cache[pid] = self._player_rate(p, tid, ctx, match, history)
        return cache[pid]

    def _player_rate(self, p, tid, ctx, match, history):
        pid = p["player_id"]
        samples = []
        for idx, m in enumerate(ctx["teams"][tid]["hist"]):
            row = m.team(tid).players.get(pid)
            if row and row["minutes"] > 0:
                samples.append({"idx": idx, "minutes": row["minutes"], "shots": row["shots"], "goals": row["goals"], "adj": ctx["opp_adj"](m.other(tid).team_id)})
        season = {"minutes": 0, "shots": 0, "goals": 0}
        for x in history.player_season(pid, match.season, match.date):
            season["minutes"] += x[2]["minutes"]
            season["shots"] += x[2]["shots"]
            season["goals"] += x[2]["goals"]
        group = pos_group(player_position(p, history, match.date))
        return player_rates(samples, season, group)

    def predict(self, match, team_id, t, history):
        st = self.state(match, team_id, t)
        ctx = self.team_context(match, team_id, history)
        me, opp = ctx["teams"][team_id], ctx["teams"][st.opp.team_id]
        lead = np.sign(st.goals_for - st.goals_against)
        state_mod = 1.2 if lead < 0 else 0.85 if lead > 0 else 1.0
        red_mod = (0.8 if st.reds_for else 1.0) * (1.2 if st.reds_against else 1.0)
        mult = opp["leakiness"] * me["home_away"] * opp["shape"] * state_mod * red_mod
        goal_base = max(0.05, 1 - opp["save_rate"]) / 0.3
        minutes = max(0, 90 - t)
        players, total = {}, 0.0
        for p in st.on_pitch:
            shots90, conv = self.player_rate(p, team_id, ctx, match, history)
            lam = shots90 * mult * minutes / 90
            total += lam
            players[p["player_id"]] = poisson_player(lam, min(0.6, conv * goal_base))
        return {"pmf": poisson_pmf(total), "players": players}
