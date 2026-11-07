"""Shared settings for the shot-model pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # gitignored
RAW = DATA / "raw"  # one gzipped ESPN summary per match
TABLES = DATA / "tables"  # extracted tables (csv.gz)
REPORTS = ROOT / "pipeline" / "reports"  # evaluation reports (committed)
MODELS = ROOT / "models"  # exported model parameters (committed)

SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# The soccer competitions the app shows (lib/espn.js SOCCER_LEAGUES). ESPN team
# and player ids are global, so a club's league and European games share one
# history. Seasons are named by their starting year
# (2023 = 2023/24). Roles:
#   warmup  history only: feeds the form/season features of later matches
#   train   models are fitted here
#   dev     the improvement loop scores every candidate here
#   test    sealed: scored only when a candidate is up for promotion. It is the
#           current season, so it also grows with fresh, never-seen matches.
LEAGUES = ["eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions", "uefa.europa"]
LEAGUE_NAMES = {
    "eng.1": "Premier League",
    "esp.1": "LaLiga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
}
CUPS = {"uefa.champions", "uefa.europa"}  # group/league phase + knockouts (two legs, extra time)
SEASONS = {2022: "warmup", 2023: "train", 2024: "train", 2025: "dev", 2026: "test"}
