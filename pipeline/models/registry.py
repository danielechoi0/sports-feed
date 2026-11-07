"""Every model the backtest knows about, by name."""
from .baselines import LeagueAvg, TeamAvg
from .current import Current
from .team_share import TeamShare, TeamShareRidge, TeamShareTuned

MODELS = {
    "league_avg": LeagueAvg,
    "team_avg": TeamAvg,
    "current": Current,
    "team_share": TeamShare,
    "team_share_tuned": TeamShareTuned,
    "team_share_ridge": TeamShareRidge,
}
