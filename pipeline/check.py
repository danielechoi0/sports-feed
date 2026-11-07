"""Data checks per competition and season.

    python -m pipeline.check            # writes pipeline/reports/data-check.md

For every competition and season: matches, whether ESPN has the commentary
(shots with minute), field coordinates and player box scores, how often the
commentary shot count agrees with the players' box-score total, and how many
matches the data check excludes (a team's commentary count more than 2 away
from its players' total).
"""
import numpy as np
import pandas as pd

from .config import LEAGUE_NAMES, REPORTS, SEASONS, TABLES
from .dataset import available_leagues, load_matches


def main():
    rows = []
    for lg in available_leagues():
        ms = load_matches([lg])
        shots = pd.read_csv(TABLES / lg / "shots.csv.gz", dtype={"match_id": str})
        meta = pd.read_csv(TABLES / lg / "matches.csv.gz", dtype={"match_id": str}).set_index("match_id")
        for season in sorted({m.season for m in ms}):
            sm = [m for m in ms if m.season == season]
            ids = {m.match_id for m in sm}
            sh = shots[shots.match_id.isin(ids) & ~(shots.period >= 5)]
            team_rows = []
            for m in sm:
                for tm in (m.home, m.away):
                    comm = sum(1 for x in sh[sh.match_id == m.match_id].itertuples() if x.team_id == int(tm.team_id))
                    box = sum(p["shots"] for p in tm.players.values())
                    team_rows.append((comm, box, len(tm.players)))
            tr = np.array(team_rows, dtype=float)
            has_xy = sh.x.notna() & sh.y.notna() & ((sh.x != 0) | (sh.y != 0))
            rows.append(
                {
                    "competition": LEAGUE_NAMES.get(lg, lg),
                    "season": f"{season}/{str(season + 1)[2:]}",
                    "role": SEASONS.get(season, "-"),
                    "matches": len(sm),
                    "knockout": sum(m.knockout for m in sm),
                    "extra time": sum(m.extra_time for m in sm),
                    "with commentary": float((meta.loc[list(ids), "n_commentary"] > 0).mean()),
                    "shots/team": float(tr[:, 0].mean()),
                    "with x/y": float(has_xy.mean()) if len(sh) else 0.0,
                    "zone known": float((sh.zone != "unknown").mean()) if len(sh) else 0.0,
                    "player box": float((tr[:, 2] >= 11).mean()),
                    "agree exact": float((tr[:, 0] == tr[:, 1]).mean()),
                    "agree ±2": float((np.abs(tr[:, 0] - tr[:, 1]) <= 2).mean()),
                    "excluded": sum(not m.ok for m in sm),
                }
            )
    df = pd.DataFrame(rows)
    pct = ["with commentary", "with x/y", "zone known", "player box", "agree exact", "agree ±2"]
    out = df.copy()
    for c in pct:
        out[c] = (100 * out[c]).map(lambda v: f"{v:.1f}%")
    out["shots/team"] = out["shots/team"].map(lambda v: f"{v:.1f}")
    md = [
        "# Data checks by competition and season",
        "",
        "Shots come from ESPN's commentary (minute, shooter, outcome, x/y, zone, body part, assist).",
        "`player box`: team-matches with an 11+ player box score; `agree exact` / `agree ±2`: team-matches where the",
        "commentary shot count equals (is within 2 of) the players' box-score total; `excluded`: matches dropped by",
        "the data check (a team more than 2 off). Knockout games that went to extra time are scored on regulation",
        "time only; the check counts every shot before the shoot-out, as the box score does.",
        "",
        "| " + " | ".join(out.columns) + " |",
        "|" + "---|" * len(out.columns),
    ]
    for r in out.itertuples(index=False):
        md.append("| " + " | ".join(str(v) for v in r) + " |")
    tot = df.groupby("competition", sort=False).agg(matches=("matches", "sum"), excluded=("excluded", "sum"))
    md += ["", "| competition | matches | excluded | excluded % |", "|---|---|---|---|"]
    for c, r in tot.iterrows():
        md.append(f"| {c} | {r.matches} | {r.excluded} | {100 * r.excluded / max(1, r.matches):.1f}% |")
    (REPORTS / "data-check.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
