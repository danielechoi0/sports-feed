"""Backtest models on past matches and write a report.

    python -m pipeline.evaluate                         # all models on the dev split
    python -m pipeline.evaluate --models current team_avg --split train
    python -m pipeline.evaluate --split test --unseal   # sealed: promotion only

For every match in the split, at every checkpoint (kickoff and minutes 15, 30,
45, 60, 75) and for both teams, each model predicts the distribution of team
shots after that minute and each on-pitch player's chance of 1+/2+/3+ shots and
1+ goals. Predictions use only matches that kicked off earlier and what had
happened in this match by that minute. Writes pipeline/reports/<split>-latest.json
and .md, and appends a line per model to pipeline/reports/ledger.jsonl.
"""
import argparse
import json
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from .config import REPORTS
from .dataset import CHECKPOINTS, History, load_matches, split_of, targets_after
from .metrics import binary_scores, team_scores
from .models.registry import MODELS


def run(model, matches, history, checkpoints):
    per_match = {}  # match_id -> [team NLL sum, P(1+ shot) logloss sum] for paired comparisons
    team = defaultdict(lambda: ([], []))
    player = defaultdict(lambda: defaultdict(lambda: ([], [])))
    for m in matches:
        for tid in (m.home.team_id, m.away.team_id):
            for t in checkpoints:
                if t > 0 and t >= m.end_min:
                    continue
                pred = model.predict(m, tid, t, history)
                y_team, per = targets_after(m, tid, t)
                acc = per_match.setdefault(m.match_id, [0.0, 0.0])
                acc[0] -= float(np.log(max(pred["pmf"][min(y_team, len(pred["pmf"]) - 1)], 1e-9)))
                for pid, pp in pred["players"].items():
                    y1 = per.get(pid, (0, 0))[0] >= 1
                    p1 = min(max(pp["p1"], 1e-6), 1 - 1e-6)
                    acc[1] -= float(np.log(p1 if y1 else 1 - p1))
                for key in (t, "all"):
                    team[key][0].append(pred["pmf"])
                    team[key][1].append(y_team)
                for pid, pp in pred["players"].items():
                    ys, yg = per.get(pid, (0, 0))
                    for key in (t, "all"):
                        for ev, p, y in (("1+ shots", pp["p1"], ys >= 1), ("2+ shots", pp["p2"], ys >= 2), ("3+ shots", pp["p3"], ys >= 3), ("1+ goals", pp["pgoal"], yg >= 1)):
                            player[key][ev][0].append(p)
                            player[key][ev][1].append(y)
    out = {}
    for key in list(team.keys()):
        out[str(key)] = {
            "team": team_scores(*team[key]),
            "player": {ev: binary_scores(*v) for ev, v in player[key].items()},
        }
    out["_per_match"] = per_match
    return out


def paired_bootstrap(a, b, n_boot=2000, seed=0):
    """Mean per-match difference (a - b) and its 95% interval, resampling matches."""
    ids = sorted(set(a) & set(b))
    d = np.array([[a[i][0] - b[i][0], a[i][1] - b[i][1]] for i in ids])
    rng = np.random.default_rng(seed)
    boots = d[rng.integers(0, len(d), (n_boot, len(d)))].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5], axis=0)
    return {"team_nll": (float(d[:, 0].mean()), float(lo[0]), float(hi[0])), "p1_logloss": (float(d[:, 1].mean()), float(lo[1]), float(hi[1]))}


def fmt_table(results, key="all"):
    lines = [
        f"### Checkpoint: {key if key != 'all' else 'all checkpoints'}",
        "",
        "| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, r in results.items():
        if key not in r:
            continue
        tm, pl = r[key]["team"], r[key]["player"]
        lines.append(
            f"| {name} | {tm['nll']:.3f} | {tm['rps']:.3f} | {tm['mae']:.2f} | {tm['bias']:+.2f} | {tm['cover80']:.2f} | "
            f"{pl['1+ shots']['logloss']:.4f} | {pl['1+ shots']['ece']:.3f} | {pl['2+ shots']['logloss']:.4f} | {pl['3+ shots']['logloss']:.4f} | "
            f"{pl['1+ goals']['logloss']:.4f} | {pl['1+ goals']['ece']:.3f} |"
        )
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=list(MODELS))
    ap.add_argument("--split", default="dev", choices=["train", "dev", "test"])
    ap.add_argument("--unseal", action="store_true", help="required to score the sealed test split")
    ap.add_argument("--checkpoints", nargs="*", type=int, default=list(CHECKPOINTS))
    ap.add_argument("--note", default="")
    args = ap.parse_args()
    if args.split == "test" and not args.unseal:
        raise SystemExit("The test split is sealed. Score it only to promote a candidate (--unseal).")

    matches = load_matches()
    history = History(matches)
    train = [m for m in matches if m.ok and split_of(m.season) == "train"]
    target = [m for m in matches if m.ok and split_of(m.season) == args.split]
    excluded = sum(1 for m in matches if not m.ok and split_of(m.season) == args.split)
    print(f"{args.split}: {len(target)} matches ({excluded} excluded by the data check)")

    results = {}
    REPORTS.mkdir(parents=True, exist_ok=True)
    ledger = REPORTS / "ledger.jsonl"
    for name in args.models:
        t0 = time.time()
        model = MODELS[name]().fit(train, history)
        results[name] = run(model, target, history, args.checkpoints)
        a = results[name]["all"]
        print(
            f"{name:>14}: team NLL {a['team']['nll']:.3f}  MAE {a['team']['mae']:.2f}  cover80 {a['team']['cover80']:.2f}  "
            f"P(1+) logloss {a['player']['1+ shots']['logloss']:.4f}  P(goal) logloss {a['player']['1+ goals']['logloss']:.4f}  ({time.time() - t0:.0f}s)",
            flush=True,
        )
        with ledger.open("a") as f:
            f.write(
                json.dumps(
                    {
                        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "split": args.split,
                        "model": name,
                        "note": args.note,
                        "matches": len(target),
                        "team_nll": round(a["team"]["nll"], 4),
                        "team_rps": round(a["team"]["rps"], 4),
                        "team_mae": round(a["team"]["mae"], 3),
                        "cover80": round(a["team"]["cover80"], 3),
                        "p1_logloss": round(a["player"]["1+ shots"]["logloss"], 5),
                        "p1_ece": round(a["player"]["1+ shots"]["ece"], 4),
                        "pgoal_logloss": round(a["player"]["1+ goals"]["logloss"], 5),
                    }
                )
                + "\n"
            )

    per_match = {k: v.pop("_per_match") for k, v in results.items()}
    names = list(results)
    comparisons = []
    if len(names) > 1:
        ref = names[-1]  # the newest candidate, compared with every other model
        print(f"\npaired bootstrap, {ref} minus each model (per match; negative = {ref} better; 95% interval):")
        for other in names[:-1]:
            c = paired_bootstrap(per_match[ref], per_match[other])
            sig = lambda x: "better" if x[2] < 0 else "worse" if x[1] > 0 else "no clear difference"
            line = (
                f"  vs {other:>14}: team NLL {c['team_nll'][0]:+.3f} [{c['team_nll'][1]:+.3f}, {c['team_nll'][2]:+.3f}] {sig(c['team_nll'])}; "
                f"P(1+) logloss {c['p1_logloss'][0]:+.3f} [{c['p1_logloss'][1]:+.3f}, {c['p1_logloss'][2]:+.3f}] {sig(c['p1_logloss'])}"
            )
            print(line)
            comparisons.append(line.strip())
    stem = REPORTS / f"{args.split}-latest"
    stem.with_suffix(".json").write_text(json.dumps(results, indent=1, default=float))
    md = [f"# Backtest: {args.split} split", "", f"{len(target)} matches, {excluded} excluded by the data check. Lower is better except 80% cover (ideal 0.80).", ""]
    if comparisons:
        md += [f"Paired bootstrap over matches, {names[-1]} minus each model (summed per match over checkpoints; negative = {names[-1]} better):", ""]
        md += [f"- {c}" for c in comparisons] + [""]
    for key in ["all"] + [str(c) for c in args.checkpoints]:
        md += [fmt_table(results, key), ""]
    stem.with_suffix(".md").write_text("\n".join(md))
    print(f"wrote {stem}.md")


if __name__ == "__main__":
    main()
