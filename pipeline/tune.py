"""Tune a model's recency / shrinkage settings on the dev split.

    python -m pipeline.tune

Coordinate descent: try each value of each setting while holding the others,
keep the best by the dev objective (team NLL + player P(1+ shot) log-loss,
both per match), repeat until nothing changes. Every trial is appended to
pipeline/reports/tuning.jsonl. Only the dev split is used; test stays sealed.
"""
import json
from datetime import datetime, timezone

import numpy as np

from .config import REPORTS
from .dataset import History, load_matches, split_of
from .evaluate import run
from .models.team_share import TeamShare

GRID = {
    "team_half_life": [3.0, 5.0, 8.0, 12.0, 20.0],
    "team_prior_games": [1.0, 2.0, 4.0, 8.0],
    "player_half_life": [4.0, 7.0, 10.0, 15.0, 25.0],
    "player_prior_min": [180.0, 300.0, 450.0, 700.0, 1000.0],
    "conv_prior_shots": [15.0, 25.0, 40.0, 70.0, 120.0],
}


def objective(params, train, dev, history):
    m = TeamShare()
    for k, v in params.items():
        setattr(m, k, v)
    m.fit(train, history)
    r = run(m, dev, history, (0, 15, 30, 45, 60, 75))
    pm = r.pop("_per_match")
    a = r["all"]
    score = float(np.mean([v[0] + v[1] for v in pm.values()]))
    return score, a["team"]["nll"], a["player"]["1+ shots"]["logloss"], a["player"]["1+ goals"]["logloss"]


def main():
    matches = load_matches()
    history = History(matches)
    train = [m for m in matches if m.ok and split_of(m.season) == "train"]
    dev = [m for m in matches if m.ok and split_of(m.season) == "dev"]
    params = {k: getattr(TeamShare, k) for k in GRID}
    best = objective(params, train, dev, history)
    print("start", params, [round(x, 4) for x in best], flush=True)
    log = (REPORTS / "tuning.jsonl").open("a")
    changed = True
    while changed:
        changed = False
        for k, values in GRID.items():
            for v in values:
                if v == params[k]:
                    continue
                trial = {**params, k: v}
                sc = objective(trial, train, dev, history)
                log.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(timespec="seconds"), "params": trial, "objective": sc[0], "team_nll": sc[1], "p1_logloss": sc[2], "pgoal_logloss": sc[3]}) + "\n")
                log.flush()
                if sc[0] < best[0] - 1e-4:
                    best, params, changed = sc, trial, True
                    print(f"  {k}={v}: {[round(x, 4) for x in sc]}  <- better", flush=True)
    print("best", params, [round(x, 4) for x in best])


if __name__ == "__main__":
    main()
