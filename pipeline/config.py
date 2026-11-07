"""Shared settings for the shot-model pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # gitignored
RAW = DATA / "raw"  # one gzipped ESPN summary per match
TABLES = DATA / "tables"  # extracted tables (csv.gz)
REPORTS = ROOT / "pipeline" / "reports"  # evaluation reports (committed)
MODELS = ROOT / "models"  # exported model parameters (committed)

SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# First pass: Premier League. Seasons are named by their starting year
# (2023 = 2023/24). Roles:
#   warmup  history only: feeds the form/season features of later matches
#   train   models are fitted here
#   dev     the improvement loop scores every candidate here
#   test    sealed: scored only when a candidate is up for promotion. It is the
#           current season, so it also grows with fresh, never-seen matches.
LEAGUES = ["eng.1"]
SEASONS = {2022: "warmup", 2023: "train", 2024: "train", 2025: "dev", 2026: "test"}
