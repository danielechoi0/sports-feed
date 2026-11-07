"""Fit the promoted models and export their parameters for the app.

    python -m pipeline.export                 # fits team_share_ridge, writes models/shot-eng.1.json
    python -m pipeline.export --parity-matches 20
    python -m pipeline.export --pooled        # fits team_share_oppadj, writes models/shot-pooled.json

Fits TeamShareRidge on the train and dev seasons (2023/24 to 2025/26; the
sealed test season was already used for the promotion check) and writes every
coefficient, both dispersions, the recency/shrinkage settings and the league
reference rates the app needs for inference, plus metadata: model name, seasons
fitted, fitted date and the sealed-test scores against the old live model
(parsed from pipeline/reports/test-latest.md).

It also writes data/parity-eng.1.json (gitignored): the fitted Python model's
features and predictions for a sample of dev-season matches, which
pipeline/parity.mjs recomputes in JavaScript from the same tables.

`--pooled` does the same for the multi-competition model team_share_oppadj
(one fit over all seven competitions, 2023/24 to 2025/26, with a team-shot
intercept per competition), which the app uses for every competition except
the Premier League. It writes models/shot-pooled.json: coefficients,
competition intercepts, dispersions, settings, per-competition league reference
rates, each competition's shot-rate history (the opponent adjustment rates each
past opponent against its competition's rate at the time) and per-competition
sealed-test scores parsed from pipeline/reports/test-multicomp.md; and
data/parity-pooled.json for pipeline/parity-pooled.mjs.
"""
import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone

from .config import DATA, LEAGUE_NAMES, LEAGUES, MODELS, REPORTS, SEASONS
from .dataset import CHECKPOINTS, History, before, load_matches
from .models.base import player_position
from .models.pooled import TeamShareOppAdj
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
    ap.add_argument("--parity-matches", type=int, default=20, help="matches for the parity check (per competition with --pooled)")
    ap.add_argument("--pooled", action="store_true", help="export team_share_oppadj for every competition but the Premier League")
    args = ap.parse_args()
    if args.pooled:
        return export_pooled(args)

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


# ---------------------------------------------------------------------------
# Multi-competition model (team_share_oppadj), every competition but eng.1

POOLED_SERVES = ["esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions", "uefa.europa"]


def test_scores_multicomp():
    """{league: {matches, scores: {model: row}, bootstrap: [lines]}} from the
    sealed multi-competition test report (all checkpoints, per competition)."""
    text = (REPORTS / "test-multicomp.md").read_text()
    names = {v: k for k, v in LEAGUE_NAMES.items()}
    head, body = text.split("## By competition (all checkpoints)", 1)
    body = body.split("## All competitions", 1)[0]
    out = {}
    for sec in body.split("### ")[1:]:
        title, _, rest = sec.partition("\n")
        m = re.match(r"(.+?) \((\d+) matches", title)
        rows = {}
        for line in rest.splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) != len(SCORE_COLS) + 1 or not re.match(r"^-?[\d.+]+$", cells[1]):
                continue
            rows[cells[0]] = {k: float(v) for k, v in zip(SCORE_COLS, cells[1:])}
        out[names[m.group(1)]] = {"matches": int(m.group(2)), "scores": rows, "bootstrap": []}
    cur = None
    for line in head.splitlines():
        m = re.match(r"^\*\*(.+)\*\*$", line.strip())
        if m:
            cur = names.get(m.group(1))
        elif cur and line.startswith("- vs"):
            out[cur]["bootstrap"].append(" ".join(line[2:].split()))
    return out


def pooled_league_reference(model, history, league):
    """A competition's reference rates over its latest 380 matches in the tables:
    what the pipeline would use for a match of that competition today."""
    last = history.league_games("9999", league=league)[-1].date
    probe = last[:10] + "T23:59Z"  # strictly after the competition's latest match
    rate, pos90, conv = TeamShareOppAdj._rates_from(history.league_games(probe, league=league)[-model.league_window :])
    games = history.league_games(probe, league=league)[-model.league_window :]
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


def rate_history(history, league):
    """{day: team shots per match over the competition's previous 380 matches,
    at that day's first kickoff}, for every day the competition played. The
    opponent adjustment rates each past opponent relative to its competition's
    rate on the day of that past match (OpponentAdjusted._rate380, same window
    and fallback)."""
    out = {}
    for m in history.league_games("9999", league=league):
        day = m.date[:10]
        if day in out:
            continue
        games = history.league_games(m.date, league=league)[-380:]
        if len(games) < 40:
            games = history.league_games(m.date)[-380:]
        out[day] = round(sum(g.home.shots + g.away.shots for g in games) / (2 * len(games)), 5) if games else 12.5
    return out


def pooled_parity_fixtures(model, history, matches, n, leagues):
    """Python features and predictions for n dev matches per competition, every
    checkpoint, both teams, with the reference rates the Python side used."""
    out = []
    for lg in leagues:
        dev = [m for m in matches if m.ok and m.league == lg and SEASONS.get(m.season) == "dev"]
        step = max(1, len(dev) // n)
        for m in dev[::step][:n]:
            rate, pos90, conv = model._league_rates(history, m.date, m.league)
            exp = model._pre_match(m, history)
            rec = {"match_id": m.match_id, "league": lg, "date": m.date, "neutral": m.neutral, "league_ref": {"rate": rate, "pos90": pos90, "conv": conv}, "rate380": {}, "teams": []}
            for tid in (m.home.team_id, m.away.team_id):
                opp = m.other(tid).team_id
                att, dfn = model._team_attack_defence(tid, m, history, rate)
                past = []
                for g in history.team_recent(tid, m.date, model.team_n):
                    o = g.other(tid).team_id
                    rec["rate380"][f"{g.league}|{g.date[:10]}"] = model._rate380(history, g.league, g.date)
                    o_att, o_def = model._raw_rel(o, g.date, g.league, history)
                    past.append({"match_id": g.match_id, "opp": o, "league": g.league, "o_att": o_att, "o_def": o_def})
                team = {"team_id": tid, "att": att, "dfn": dfn, "exp": exp[tid], "past": past, "checkpoints": []}
                for t in CHECKPOINTS:
                    if t > 0 and t >= m.end_min:
                        continue
                    x, on, off = model.features(m, tid, t, history)
                    cur = dict(model._cur)
                    pred = model.predict(m, tid, t, history)
                    mu = math.exp(sum(x[c] * b for c, b in zip(model.TEAM_COLS, model.team_beta)) + off)
                    sf = defaultdict(int)
                    psf = defaultdict(int)
                    for s in m.shots:
                        if before(s["minute"], s["period"], t):
                            sf[s["team_id"]] += 1
                            if s["team_id"] == tid:
                                psf[s["player_id"]] += 1
                    rows = m.team(tid).players
                    team["checkpoints"].append(
                        {
                            "t": t,
                            "x": {c: x[c] for c in model.TEAM_COLS},
                            "sf": sf.get(tid, 0),
                            "opp_sf": sf.get(opp, 0),
                            "mu": mu,
                            "players": [
                                {
                                    "player_id": pid,
                                    "g": g,
                                    "on_min": rows[pid]["on_min"],
                                    "sf": psf.get(pid, 0),
                                    "p_sf_ratio": cur.get(pid, 0.0),
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


def export_pooled(args):
    matches = load_matches(LEAGUES)
    history = History(matches)
    seasons = sorted(s for s, role in SEASONS.items() if role in FIT_ROLES)
    fit = [m for m in matches if m.ok and m.season in seasons]
    model = TeamShareOppAdj().fit(fit, history)
    by_league = {lg: sum(1 for m in fit if m.league == lg) for lg in LEAGUES}
    print(f"fitted {model.name} on {len(fit)} matches, seasons {seasons}: {by_league}")
    beta = dict(zip(model.TEAM_COLS, (float(b) for b in model.team_beta)))
    tests = test_scores_multicomp()
    out = {
        "model": model.name,
        "pooled": True,
        "leagues": LEAGUES,
        "base_league": sorted(LEAGUES)[0],
        "serves": POOLED_SERVES,
        "description": "One fit over all seven competitions. Team shots after minute t ~ negative binomial (log link, offset log competition rate) with a team-shot intercept per competition, opponent-adjusted attack/defence form over each club's matches in every competition, and in-play shots so far vs the pre-match expectation (team and opponent); each on-pitch player's shots ~ negative binomial around a share of the team mean, with his own shots so far vs expectation; goals ~ shots x fitted conversion.",
        "fitted": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons_fitted": [f"{s}/{str(s + 1)[2:]}" for s in seasons],
        "fit_matches": len(fit),
        "fit_matches_by_league": by_league,
        "checkpoints": list(CHECKS),
        "team": {
            "cols": model.TEAM_COLS,
            "beta": beta,
            "k": float(model.team_k),
            "ridge": model.team_ridge,
            "league_intercepts": {lg: beta.get(f"lg_{lg}", 0.0) for lg in LEAGUES},
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
            "league_window": model.league_window,
        },
        # pooled.InPlayEvidence / PlayerInPlay
        "inplay": {
            "match_minutes": 94.0,  # share of the match played by minute t: t / 94
            "team_prior_shots": 2.0,  # sf_ratio = log((shots so far + 2) / (pre-match expected shots x t/94 + 2))
            "player_prior_shots": 0.5,  # p_sf_ratio = log((shots so far + 0.5) / (r90 x minutes played / 90 + 0.5))
        },
        "home_excludes_neutral": True,
        "league_ref": {lg: pooled_league_reference(model, history, lg) for lg in LEAGUES},
        "rate_history": {lg: rate_history(history, lg) for lg in LEAGUES},
        "backtest": {
            "split": "test",
            "season": "2026/27",
            "source": "pipeline/reports/test-multicomp.md (one pooled fit on 2023/24-2024/25 for that check)",
            "by_league": {
                lg: {
                    "name": LEAGUE_NAMES[lg],
                    "matches": t["matches"],
                    "model": t["scores"].get(model.name),
                    "previous_live_model": t["scores"].get("current"),
                    "team_share_ridge": t["scores"].get("team_share_ridge"),
                    "bootstrap": t["bootstrap"],
                }
                for lg, t in tests.items()
            },
        },
    }
    MODELS.mkdir(parents=True, exist_ok=True)
    path = MODELS / "shot-pooled.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {path}")

    if args.parity_matches:
        fx = pooled_parity_fixtures(model, history, matches, args.parity_matches, POOLED_SERVES)
        DATA.mkdir(parents=True, exist_ok=True)
        ppath = DATA / "parity-pooled.json"
        ppath.write_text(json.dumps({"fixtures": fx}))
        print(f"wrote {ppath} ({len(fx)} matches)")


if __name__ == "__main__":
    main()
