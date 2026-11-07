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

from .config import CUPS, LEAGUES, SEASONS, TABLES

CHECKPOINTS = (0, 15, 30, 45, 60, 75)
MAX_SHOTS = 60  # support of the team-shot distributions


def _read(name, leagues, **kw):
    """One table across competitions (data/tables/<league>/<name>.csv.gz)."""
    frames = [pd.read_csv(TABLES / lg / f"{name}.csv.gz", **kw) for lg in leagues]
    return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]


def available_leagues():
    return [lg for lg in LEAGUES if (TABLES / lg / "matches.csv.gz").exists()]


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
    stage: str = "League"  # cups: "Group Stage", "League Phase", "Round of 16", ...
    knockout: bool = False
    leg: int | None = None  # 1 or 2 for two-legged ties
    neutral: bool = False
    extra_time: bool = False  # went beyond 90 minutes (only regulation time is predicted)

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


def load_matches(leagues=None):
    """Matches of the given competitions (default: every extracted one), by date.

    Knockout games that went to extra time are cut at the end of regulation
    time: shots, goals and cards after 90 minutes are dropped and end_min is
    where the second half ended. The data check still compares every shot
    before the shoot-out with the player box scores (which include extra time).
    """
    leagues = leagues or available_leagues()
    m = _read("matches", leagues, dtype={"match_id": str, "home_id": str, "away_id": str})
    a = _read("appearances", leagues, dtype={"match_id": str, "team_id": str, "opp_id": str, "player_id": str})
    s = _read("shots", leagues, dtype={"match_id": str, "team_id": str, "player_id": str})
    e = _read("events", leagues, dtype={"match_id": str, "team_id": str})
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
        extra_time = int(r.get("max_period", 2) if pd.notna(r.get("max_period", 2)) else 2) > 2
        all_sh = [x for x in shots[mid] if not (pd.notna(x["period"]) and x["period"] >= 5)]
        sh = [x for x in all_sh if not (pd.notna(x["period"]) and x["period"] > 2)] if extra_time else all_sh
        tm = {}
        ok = True
        for side in ("home", "away"):
            tid = r[f"{side}_id"]
            mine = [x for x in sh if x["team_id"] == tid]
            players = apps[mid][tid]
            box = sum(p["shots"] for p in players.values())
            if abs(sum(1 for x in all_sh if x["team_id"] == tid) - box) > 2:
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
                if extra_time and pd.notna(x.get("period")) and x["period"] > 2:
                    continue
                goals.append((x["team_id"], mn, 1 if mn is not None and mn <= 45 else 2))
        reds = [(x["team_id"], x["minute"]) for x in evs[mid] if x["kind"] == "red" and pd.notna(x["minute"])]
        stage = r.get("stage") if isinstance(r.get("stage"), str) else "League"
        leg = r.get("leg")
        out.append(
            Match(
                match_id=mid,
                league=r["league"],
                season=int(r["season"]),
                date=r["date"],
                end_min=int(r["end_min_reg"] if extra_time else r["end_min"]),
                home=tm["home"],
                away=tm["away"],
                shots=sh,
                goals=goals,
                reds=reds,
                ok=ok,
                stage=stage,
                knockout=r["league"] in CUPS and not any(k in stage for k in ("Group", "League Phase")),
                leg=int(leg) if pd.notna(leg) else None,
                neutral=bool(r.get("neutral", False)),
                extra_time=extra_time,
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
        # per competition, for league reference rates
        self._by_league = defaultdict(list)
        for d, m in self._league:
            self._by_league[m.league].append((d, m))
        self._by_league_dates = {k: [d for d, _ in v] for k, v in self._by_league.items()}
        self._views = {}

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

    def league_games(self, date, season=None, league=None):
        """Matches before date (of one competition if league is given)."""
        if league is None:
            rows, dates = self._league, self._league_dates
        else:
            rows, dates = self._by_league.get(league, []), self._by_league_dates.get(league, [])
        i = bisect_left(dates, date)
        ms = [m for _, m in rows[:i]]
        return [m for m in ms if season is None or m.season == season]

    def view(self, league):
        """This history with league reference rates scoped to one competition.

        Team and player lookups stay global (a club's league and European games
        both feed its form); league_games() only returns that competition's
        matches. Lets the single-competition models (league_avg, team_avg,
        current, team_share*) run unchanged on any competition."""
        if league not in self._views:
            self._views[league] = LeagueView(self, league)
        return self._views[league]


class LeagueView:
    def __init__(self, history, league):
        self.base = history
        self.league = league

    def __getattr__(self, name):
        return getattr(self.base, name)

    def league_games(self, date, season=None, league=None):
        return self.base.league_games(date, season, league or self.league)
