"""Every model the backtest knows about, by name."""
from .baselines import LeagueAvg, TeamAvg
from .current import Current
from . import pooled as P
from .team_share import TeamShare, TeamShareRidge, TeamShareTuned

MODELS = {
    "league_avg": LeagueAvg,
    "team_avg": TeamAvg,
    "current": Current,
    "team_share": TeamShare,
    "team_share_tuned": TeamShareTuned,
    "team_share_ridge": TeamShareRidge,
    # multi-competition models (pipeline/models/pooled.py)
    "team_share_pooled": P.TeamSharePooled,
    "team_share_level": P.TeamShareLevel,  # round 1 (rejected)
    "team_share_disp": P.TeamShareDisp,  # round 2 (rejected)
    "team_share_xg": P.TeamShareXG,  # round 3 (rejected)
    "team_share_inplay": P.TeamShareInPlay,  # round 4 (kept)
    "team_share_pinplay": P.TeamSharePlayerInPlay,  # round 5 (kept)
    "team_share_cup": P.TeamShareCup,  # round 6 (rejected)
    "team_share_slevel": P.TeamShareSeasonLevel,  # round 7 (rejected)
    "team_share_newteam": P.TeamShareNewTeam,  # round 8 (rejected)
    "team_share_oppadj": P.TeamShareOppAdj,  # round 9
    "team_share_disp2": P.TeamShareDispInPlay,  # round 10
}


def get(name):
    """A model class by name; "<name>:per" fits a pooled model per competition instead."""
    if name.endswith(":per"):
        base = MODELS[name[:-4]]
        return type(base.__name__ + "PerLeague", (base,), {"name": name, "pooled": False})
    return MODELS[name]
