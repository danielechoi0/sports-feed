"""Fit the promoted model and export its parameters for the app.

    python -m pipeline.export                 # fits team_share_ridge, writes models/shot-eng.1.json
    python -m pipeline.export --parity-matches 20

Fits TeamShareRidge on the train and dev seasons (2023/24 to 2025/26; the
sealed test season was already used for the promotion check) and writes every
coefficient, both dispersions, the recency/shrinkage settings and the league
reference rates the app needs for inference, plus metadata: model name, seasons
fitted, fitted date and the sealed-test scores against the old live model
(parsed from pipeline/reports/test-latest.md).

It also writes data/parity-eng.1.json (gitignored): the fitted Python model's
features and predictions for a sample of dev-season matches, which
pipeline/parity.mjs recomputes in JavaScript from the same tables.
"""
import argparse
import json
import math
import re
from datetime import datetime, timezone

from .config import DATA, MODELS, REPORTS, SEASONS
from .dataset import CHECKPOINTS, History, load_matches
from .models.base import player_position
from .models.team_share import CHECKS, POS, TeamShareRidge

LEAGUE = "eng.1"
FIT_ROLES = ("train", "dev")
SCORE_COLS = ["team_nll", "team_rps", "team_mae", "bias", "cover80", "p1_logloss", "p1_ece", "p2_logloss", "p3_logloss", "pgoal_logloss", "pgoal_ece"]


def test_scores():
    """The 'all checkpoints' rows of the sealed-test report, by model name."""
    path = REPORTS / "test-latest.md"
    text = path.read_text()
    block = text.split("### Checkpoint: all checkpoints", 1)[1].split("###", 1)[0]
    out = {}
    for line in block.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != len(SCORE_COLS) + 1 or not re.match(r"^-?[\d.+]+$", cells[1]):
            continue
        out[cells[0]] = {k: float(v) for k, v in zip(SCORE_COLS, cells[1:])}
    n = re.search(r"^(\d+) matches", text, re.M)
    return out, int(n.group(1)) if n else None


def league_reference(model, history):
    """League shot rate, position rates per 90 and conversion over the latest 380
    league matches in the tables: what the pipeline would use for a match today."""
    last = history._league_dates[-1]
    probe = last[:10] + "T23:59Z"  # strictly after the latest match
    rate, pos90, conv = model._league(history, probe)
    games = history.league_games(probe)[-380:]
    shots = sum(len(m.shots) for m in games)
    goals = sum(1 for m in games for x in m.shots if x["goal"])
    return {
        "rate": rate,
        "pos90": pos90,
        "conv": conv,
        "conv_all": goals / shots if shots else 0.1,
        "matches": len(games),
        "from": games[0].date,
        "to": games[-1].date,
    }


def parity_fixtures(model, history, matches, n):
    """Python features and predictions for n dev matches, every checkpoint, both teams."""
    dev = [m for m in matches if m.ok and SEASONS.get(m.season) == "dev"]
    step = max(1, len(dev) // n)
    sample = dev[::step][:n]
    out = []
    for m in sample:
        rate, pos90, conv = model._league(history, m.date)
        rec = {"match_id": m.match_id, "date": m.date, "league": {"rate": rate, "pos90": pos90, "conv": conv}, "teams": []}
        for tid in (m.home.team_id, m.away.team_id):
            opp = m.other(tid).team_id
            att, dfn = model._team_rates(tid, m.date, history, rate)
            oatt, odfn = model._team_rates(opp, m.date, history, rate)
            team = {"team_id": tid, "att": att, "dfn": dfn, "opp_dfn": odfn, "checkpoints": []}
            for t in CHECKPOINTS:
                if t > 0 and t >= m.end_min:
                    continue
                x, on, off = model.features(m, tid, t, history)
                pred = model.predict(m, tid, t, history)
                mu = math.exp(sum(x[c] * b for c, b in zip(model.TEAM_COLS, model.team_beta)) + off)
                team["checkpoints"].append(
                    {
                        "t": t,
                        "x": {c: x[c] for c in model.TEAM_COLS},
                        "mu": mu,
                        "players": [
                            {
                                "player_id": pid,
                                "g": g,
                                "pos": None if not isinstance(m.team(tid).players[pid].get("pos"), str) else m.team(tid).players[pid]["pos"],
                                "pos_resolved": str(player_position(m.team(tid).players[pid], history, m.date)),
                                "r90": r90,
                                "pconv": pconv,
                                "lambda": pred["players"][pid]["mean"],
                                "p1": pred["players"][pid]["p1"],
                                "p2": pred["players"][pid]["p2"],
                                "p3": pred["players"][pid]["p3"],
                                "pgoal": pred["players"][pid]["pgoal"],
                            }
                            for pid, g, r90, pconv in on
                        ],
                    }
                )
            rec["teams"].append(team)
        out.append(rec)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parity-matches", type=int, default=20)
    args = ap.parse_args()

    matches = load_matches(["eng.1"])  # the shipped model is Premier League only
    history = History(matches)
    seasons = sorted(s for s, role in SEASONS.items() if role in FIT_ROLES)
    fit = [m for m in matches if m.ok and m.season in seasons and m.league == LEAGUE]
    model = TeamShareRidge().fit(fit, history)
    print(f"fitted {model.name} on {len(fit)} matches, seasons {seasons}")

    scores, test_n = test_scores()
    league = league_reference(model, history)
    out = {
        "model": model.name,
        "league": LEAGUE,
        "description": "Team shots after minute t ~ negative binomial (log link, offset log league rate); each on-pitch player's shots ~ negative binomial around a share of the team mean; goals ~ shots x fitted conversion.",
        "fitted": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons_fitted": [f"{s}/{str(s + 1)[2:]}" for s in seasons],
        "fit_matches": len(fit),
        "checkpoints": list(CHECKS),
        "team": {
            "cols": model.TEAM_COLS,
            "beta": {c: float(b) for c, b in zip(model.TEAM_COLS, model.team_beta)},
            "k": float(model.team_k),
            "ridge": model.team_ridge,
        },
        "player": {
            "cols": model.PLAYER_COLS,
            "beta": {c: float(b) for c, b in zip(model.PLAYER_COLS, model.player_beta)},
            "k": float(model.player_k),
            "positions": POS,
            "base_position": "M",
        },
        "goal": {"intercept": float(model.goal_beta[0]), "log_conv": float(model.goal_beta[1])},
        "recency": {
            "team_half_life": model.team_half_life,
            "team_n": model.team_n,
            "team_prior_games": model.team_prior_games,
            "player_half_life": model.player_half_life,
            "player_n": model.player_n,
            "player_prior_min": model.player_prior_min,
            "conv_prior_shots": model.conv_prior_shots,
            "position_history_n": 30,
        },
        "league_ref": league,
        "backtest": {
            "split": "test",
            "season": "2026/27",
            "matches": test_n,
            "model": scores.get(model.name),
            "previous_live_model": scores.get("current"),
            "source": "pipeline/reports/test-latest.md (fitted on 2023/24-2024/25 for that check)",
        },
    }
    MODELS.mkdir(parents=True, exist_ok=True)
    path = MODELS / f"shot-{LEAGUE}.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {path}")

    if args.parity_matches:
        fx = parity_fixtures(model, history, matches, args.parity_matches)
        DATA.mkdir(parents=True, exist_ok=True)
        ppath = DATA / f"parity-{LEAGUE}.json"
        ppath.write_text(json.dumps(fx))
        print(f"wrote {ppath} ({len(fx)} matches)")


if __name__ == "__main__":
    main()
