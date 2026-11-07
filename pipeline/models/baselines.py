"""Two reference models every candidate has to beat.

league_avg  every team shoots at the league's average rate; every player at
            his position's average rate.
team_avg    each team at its own season-to-date rate (blended with the league
            early in the season); each player at his own season rate, shrunk
            toward his position average. Poisson, players independent.
"""
from collections import defaultdict

from .base import Model, player_position, poisson_pmf, poisson_player, pos_group


_CACHE = {}


def _league_rates(history, date, season):
    key = (id(history), date[:10], season)
    if key not in _CACHE:
        _CACHE[key] = _league_rates_uncached(history, date, season)
    return _CACHE[key]


def _league_rates_uncached(history, date, season):
    games = history.league_games(date, season)
    if len(games) < 30:  # early season: use everything so far
        games = history.league_games(date)[-380:]
    team_shots = [tm.shots for m in games for tm in (m.home, m.away)]
    per_team_game = sum(team_shots) / max(1, len(team_shots))
    end = sum(m.end_min for m in games) / max(1, len(games)) if games else 97.0
    mins = defaultdict(float)
    shots = defaultdict(float)
    goals = 0
    for m in games:
        for tm in (m.home, m.away):
            for p in tm.players.values():
                g = pos_group(p["pos"]) if p["pos"] != "SUB" else None
                if g:
                    mins[g] += p["minutes"]
                    shots[g] += p["shots"]
                goals += p["goals"]
    pos90 = {g: 90 * shots[g] / mins[g] for g in mins if mins[g] > 0}
    conv = goals / max(1, sum(team_shots))
    return per_team_game, end, pos90, conv


class LeagueAvg(Model):
    name = "league_avg"

    def predict(self, match, team_id, t, history):
        st = self.state(match, team_id, t)
        rate, end, pos90, conv = _league_rates(history, match.date, match.season)
        remaining = max(1.0, end - t)
        pmf = poisson_pmf(rate * remaining / end)
        players = {}
        for p in st.on_pitch:
            g = pos_group(player_position(p, history, match.date))
            lam = pos90.get(g, 1.0) * (remaining / 90)
            players[p["player_id"]] = poisson_player(lam, conv)
        return {"pmf": pmf, "players": players}


class TeamAvg(Model):
    name = "team_avg"
    prior_min = 270

    def predict(self, match, team_id, t, history):
        st = self.state(match, team_id, t)
        rate, end, pos90, conv = _league_rates(history, match.date, match.season)
        games = history.team_season(team_id, match.season, match.date)
        n = len(games)
        team_rate = sum(g.team(team_id).shots for g in games) / n if n else rate
        w = n / (n + 3)
        team_rate = w * team_rate + (1 - w) * rate
        remaining = max(1.0, end - t)
        pmf = poisson_pmf(team_rate * remaining / end)
        players = {}
        for p in st.on_pitch:
            g = pos_group(player_position(p, history, match.date))
            rows = history.player_season(p["player_id"], match.season, match.date)
            mins = sum(x[2]["minutes"] for x in rows)
            sh = sum(x[2]["shots"] for x in rows)
            gl = sum(x[2]["goals"] for x in rows)
            prior = pos90.get(g, 1.0)
            r90 = (sh * 90 + prior * self.prior_min) / (mins + self.prior_min)
            pconv = (gl + conv * 6) / (sh + 6)
            lam = r90 * (remaining / 90)
            players[p["player_id"]] = poisson_player(lam, pconv)
        return {"pmf": pmf, "players": players}
