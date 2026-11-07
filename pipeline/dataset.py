"""Matches, prediction checkpoints and leak-free history for the backtest.

Every prediction is made from what was known at that moment:
  * history only contains matches that kicked off before this one
  * in-play checkpoints only see shots, goals, cards and substitutions up to
    the checkpoint minute

Targets come from the commentary (one row per shot, with a minute), which
agrees with the player box scores 97.5% of the time. Matches where a team's
commentary shot count is more than 2 away from its players' box-score total
are excluded as unreliable.
"""
from bisect import bisect_left
from collections import defaultdict
from dataclasses import dataclass, field

import pandas as pd

from .config import SEASONS, TABLES

CHECKPOINTS = (0, 15, 30, 45, 60, 75)
MAX_SHOTS = 60  # support of the team-shot distributions


def _read(name, **kw):
    return pd.read_csv(TABLES / f"{name}.csv.gz", **kw)


@dataclass
class TeamMatch:
    team_id: str
    opp_id: str
    home: bool
    goals: int
    shots: int  # commentary shots
    sot: int
    formation: str | None
    players: dict = field(default_factory=dict)  # player_id -> appearance row (dict)


@dataclass
class Match:
    match_id: str
    league: str
    season: int
    date: str
    end_min: int
    home: TeamMatch
    away: TeamMatch
    shots: list  # dicts: team_id, player_id, minute, period, goal, on_target, ...
    goals: list  # (team_id, minute, period) incl. own goals, credited to the scoring side
    reds: list  # (team_id, minute)
    ok: bool  # passes the data-quality check

    def team(self, tid):
        return self.home if self.home.team_id == tid else self.away

    def other(self, tid):
        return self.away if self.home.team_id == tid else self.home


def before(minute, period, t):
    """Did an event at (minute, period) happen at or before checkpoint t?
    t <= 45 is a first-half minute (45 = half time); t > 45 a second-half one."""
    if minute is None:
        return False
    if t == 0:
        return False
    if period == 1:
        return t >= 45 or minute <= t
    if period == 2:
        return t > 45 and minute <= t
    return minute <= t


def load_matches():
    m = _read("matches", dtype={"match_id": str, "home_id": str, "away_id": str})
    a = _read("appearances", dtype={"match_id": str, "team_id": str, "opp_id": str, "player_id": str})
    s = _read("shots", dtype={"match_id": str, "team_id": str, "player_id": str})
    e = _read("events", dtype={"match_id": str, "team_id": str})
    apps = defaultdict(lambda: defaultdict(dict))
    for r in a.to_dict("records"):
        apps[r["match_id"]][r["team_id"]][r["player_id"]] = r
    shots = defaultdict(list)
    for r in s.to_dict("records"):
        shots[r["match_id"]].append(r)
    evs = defaultdict(list)
    for r in e.to_dict("records"):
        evs[r["match_id"]].append(r)

    out = []
    for r in m.sort_values("date").to_dict("records"):
        mid = r["match_id"]
        sh = shots[mid]
        tm = {}
        ok = True
        for side in ("home", "away"):
            tid = r[f"{side}_id"]
            mine = [x for x in sh if x["team_id"] == tid]
            players = apps[mid][tid]
            box = sum(p["shots"] for p in players.values())
            if abs(len(mine) - box) > 2:
                ok = False
            tm[side] = TeamMatch(
                team_id=tid,
                opp_id=r["away_id"] if side == "home" else r["home_id"],
                home=side == "home",
                goals=int(r[f"{side}_goals"]),
                shots=len(mine),
                sot=sum(1 for x in mine if x["on_target"]),
                formation=r.get(f"{side}_formation") if isinstance(r.get(f"{side}_formation"), str) else None,
                players=dict(players),
            )
        goals = [(x["team_id"], x["minute"], x["period"]) for x in sh if x["goal"]]
        # own goals: ESPN credits them to the side that benefits; no period, use minute
        for x in evs[mid]:
            if x["kind"] == "own_goal":
                mn = x["minute"] if pd.notna(x["minute"]) else None
                goals.append((x["team_id"], mn, 1 if mn is not None and mn <= 45 else 2))
        reds = [(x["team_id"], x["minute"]) for x in evs[mid] if x["kind"] == "red" and pd.notna(x["minute"])]
        out.append(
            Match(
                match_id=mid,
                league=r["league"],
                season=int(r["season"]),
                date=r["date"],
                end_min=int(r["end_min"]),
                home=tm["home"],
                away=tm["away"],
                shots=sh,
                goals=goals,
                reds=reds,
                ok=ok,
            )
        )
    return out


def split_of(season):
    return SEASONS.get(season)


@dataclass
class State:
    """What is known at checkpoint t of a match, for one team."""

    t: int
    team: TeamMatch
    opp: TeamMatch
    goals_for: int
    goals_against: int
    reds_for: int
    reds_against: int
    shots_so_far: int
    on_pitch: list  # appearance rows of players on the pitch at t
    opp_on_pitch: list


def state_at(match, team_id, t):
    me, opp = match.team(team_id), match.other(team_id)
    gf = sum(1 for (tid, mn, pr) in match.goals if tid == team_id and before(mn, pr, t))
    ga = sum(1 for (tid, mn, pr) in match.goals if tid != team_id and before(mn, pr, t))
    rf = sum(1 for (tid, mn) in match.reds if tid == team_id and mn <= t and t > 0)
    ra = sum(1 for (tid, mn) in match.reds if tid != team_id and mn <= t and t > 0)
    sf = sum(1 for x in match.shots if x["team_id"] == team_id and before(x["minute"], x["period"], t))

    def on(p):
        if t == 0:
            return bool(p["starter"])
        return p["on_min"] <= t < p["off_min"]

    return State(
        t=t,
        team=me,
        opp=opp,
        goals_for=gf,
        goals_against=ga,
        reds_for=rf,
        reds_against=ra,
        shots_so_far=sf,
        on_pitch=[p for p in me.players.values() if on(p)],
        opp_on_pitch=[p for p in opp.players.values() if on(p)],
    )


def targets_after(match, team_id, t):
    """Team shots after t, and per player {player_id: (shots, goals)} after t."""
    team = 0
    per = defaultdict(lambda: [0, 0])
    for x in match.shots:
        if x["team_id"] != team_id or before(x["minute"], x["period"], t):
            continue
        team += 1
        per[x["player_id"]][0] += 1
        per[x["player_id"]][1] += int(bool(x["goal"]))
    return team, per


class History:
    """Leak-free lookups over matches that kicked off before a given date."""

    def __init__(self, matches):
        self.matches = matches
        self.team_games = defaultdict(list)  # team_id -> [(date, Match)]
        self.player_games = defaultdict(list)  # player_id -> [(date, season, row, opp_id, team_id, Match)]
        for m in matches:
            if not m.ok:
                continue
            for tm in (m.home, m.away):
                self.team_games[tm.team_id].append((m.date, m))
                for pid, row in tm.players.items():
                    self.player_games[pid].append((m.date, m.season, row, tm.opp_id, tm.team_id, m))
        self._team_dates = {k: [d for d, _ in v] for k, v in self.team_games.items()}
        self._player_dates = {k: [x[0] for x in v] for k, v in self.player_games.items()}
        self._league = sorted(((m.date, m) for m in matches if m.ok), key=lambda x: x[0])
        self._league_dates = [d for d, _ in self._league]

    def team_recent(self, team_id, date, n=10):
        """Most recent first."""
        i = bisect_left(self._team_dates.get(team_id, []), date)
        return [m for _, m in reversed(self.team_games[team_id][max(0, i - n) : i])]

    def team_season(self, team_id, season, date):
        i = bisect_left(self._team_dates.get(team_id, []), date)
        return [m for d, m in self.team_games[team_id][:i] if m.season == season]

    def player_recent(self, player_id, date, n=None):
        i = bisect_left(self._player_dates.get(player_id, []), date)
        rows = self.player_games[player_id][:i]
        return list(reversed(rows if n is None else rows[-n:]))

    def player_season(self, player_id, season, date):
        return [x for x in self.player_recent(player_id, date) if x[1] == season]

    def league_games(self, date, season=None):
        i = bisect_left(self._league_dates, date)
        ms = [m for _, m in self._league[:i]]
        return [m for m in ms if season is None or m.season == season]
