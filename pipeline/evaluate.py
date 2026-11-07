"""Backtest models on past matches and write a report.

    python -m pipeline.evaluate                         # all models, every competition, dev split
    python -m pipeline.evaluate --models current team_avg --split train
    python -m pipeline.evaluate --leagues eng.1 --history league   # the original Premier League-only setup
    python -m pipeline.evaluate --split test --unseal   # sealed: promotion only

For every match in the split, at every checkpoint (kickoff and minutes 15, 30,
45, 60, 75) and for both teams, each model predicts the distribution of team
shots after that minute and each on-pitch player's chance of 1+/2+/3+ shots and
1+ goals. Predictions use only matches that kicked off earlier and what had
happened in this match by that minute.

Competitions: history (team and player form) spans every loaded competition,
because ESPN ids are global (a club's league and European games both count);
`--history league` restricts it to the competition being scored. Models with
`pooled = True` are fitted once on the train matches of all scored
competitions; the others are fitted per competition, with league reference
rates from that competition only.

Writes pipeline/reports/<split>-latest.json and .md, and appends a line per
model and competition to pipeline/reports/ledger.jsonl.
"""
import argparse
import json
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from .config import LEAGUE_NAMES, REPORTS
from .dataset import CHECKPOINTS, History, available_leagues, load_matches, split_of, targets_after
from .metrics import binary_scores, team_scores
from .models.registry import MODELS, get

EVENTS = ("1+ shots", "2+ shots", "3+ shots", "1+ goals")


def collect(model, matches, history, checkpoints, raw=None):
    """Predictions vs outcomes, unscored (so competitions can be merged)."""
    raw = raw or {"per_match": {}, "team": defaultdict(lambda: ([], [])), "player": defaultdict(lambda: defaultdict(lambda: ([], [])))}
    per_match, team, player = raw["per_match"], raw["team"], raw["player"]
    for m in matches:
        for tid in (m.home.team_id, m.away.team_id):
            for t in checkpoints:
                if t > 0 and t >= m.end_min:
                    continue
                pred = model.predict(m, tid, t, history)
                y_team, per = targets_after(m, tid, t)
                acc = per_match.setdefault(m.match_id, [0.0, 0.0, 0.0])
                acc[0] -= float(np.log(max(pred["pmf"][min(y_team, len(pred["pmf"]) - 1)], 1e-9)))
                for pid, pp in pred["players"].items():
                    y1 = per.get(pid, (0, 0))[0] >= 1
                    p1 = min(max(pp["p1"], 1e-6), 1 - 1e-6)
                    acc[1] -= float(np.log(p1 if y1 else 1 - p1))
                    yg = per.get(pid, (0, 0))[1] >= 1
                    pg = min(max(pp["pgoal"], 1e-6), 1 - 1e-6)
                    acc[2] -= float(np.log(pg if yg else 1 - pg))
                for key in (t, "all"):
                    team[key][0].append(pred["pmf"])
                    team[key][1].append(y_team)
                for pid, pp in pred["players"].items():
                    ys, yg = per.get(pid, (0, 0))
                    for key in (t, "all"):
                        for ev, p, y in (("1+ shots", pp["p1"], ys >= 1), ("2+ shots", pp["p2"], ys >= 2), ("3+ shots", pp["p3"], ys >= 3), ("1+ goals", pp["pgoal"], yg >= 1)):
                            player[key][ev][0].append(p)
                            player[key][ev][1].append(y)
    return raw


def merge(raws):
    out = {"per_match": {}, "team": defaultdict(lambda: ([], [])), "player": defaultdict(lambda: defaultdict(lambda: ([], [])))}
    for r in raws:
        out["per_match"].update(r["per_match"])
        for k, (a, b) in r["team"].items():
            out["team"][k][0].extend(a)
            out["team"][k][1].extend(b)
        for k, evs in r["player"].items():
            for ev, (a, b) in evs.items():
                out["player"][k][ev][0].extend(a)
                out["player"][k][ev][1].extend(b)
    return out


def score(raw):
    out = {}
    for key in list(raw["team"].keys()):
        out[str(key)] = {
            "team": team_scores(*raw["team"][key]),
            "player": {ev: binary_scores(*v) for ev, v in raw["player"][key].items()},
        }
    out["_per_match"] = raw["per_match"]
    return out


def run(model, matches, history, checkpoints):
    return score(collect(model, matches, history, checkpoints))


def paired_bootstrap(a, b, n_boot=2000, seed=0):
    """Mean per-match difference (a - b) and its 95% interval, resampling matches."""
    ids = sorted(set(a) & set(b))
    d = np.array([[a[i][j] - b[i][j] for j in range(3)] for i in ids])
    rng = np.random.default_rng(seed)
    boots = d[rng.integers(0, len(d), (n_boot, len(d)))].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5], axis=0)
    return {k: (float(d[:, j].mean()), float(lo[j]), float(hi[j])) for j, k in enumerate(("team_nll", "p1_logloss", "pgoal_logloss"))}


def verdict(x):
    return "better" if x[2] < 0 else "worse" if x[1] > 0 else "no clear difference"


def fmt_table(results, key="all", title=None):
    lines = [
        title or f"### Checkpoint: {key if key != 'all' else 'all checkpoints'}",
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


def ledger_line(split, name, league, note, n, a):
    return {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "split": split,
        "model": name,
        "league": league,
        "note": note,
        "matches": n,
        "team_nll": round(a["team"]["nll"], 4),
        "team_rps": round(a["team"]["rps"], 4),
        "team_mae": round(a["team"]["mae"], 3),
        "bias": round(a["team"]["bias"], 3),
        "cover80": round(a["team"]["cover80"], 3),
        "p1_logloss": round(a["player"]["1+ shots"]["logloss"], 5),
        "p1_ece": round(a["player"]["1+ shots"]["ece"], 4),
        "pgoal_logloss": round(a["player"]["1+ goals"]["logloss"], 5),
        "pgoal_ece": round(a["player"]["1+ goals"]["ece"], 4),
    }


def fit_and_collect(cls, leagues, matches, history_for, split, checkpoints):
    """{league: raw}; pooled models are fitted once, the others per competition."""
    raws = {}
    if getattr(cls, "pooled", False):
        hist = history_for(None)
        train = [m for m in matches if m.ok and split_of(m.season) == "train" and m.league in leagues]
        model = cls().fit(train, hist)
        for lg in leagues:
            target = [m for m in matches if m.ok and split_of(m.season) == split and m.league == lg]
            raws[lg] = collect(model, target, hist, checkpoints)
        return raws
    for lg in leagues:
        hist = history_for(lg)
        train = [m for m in matches if m.ok and split_of(m.season) == "train" and m.league == lg]
        target = [m for m in matches if m.ok and split_of(m.season) == split and m.league == lg]
        model = cls().fit(train, hist)
        raws[lg] = collect(model, target, hist, checkpoints)
    return raws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=list(MODELS), help='names from models/registry.py; "<name>:per" fits a pooled model per competition')
    ap.add_argument("--split", default="dev", choices=["train", "dev", "test"])
    ap.add_argument("--unseal", action="store_true", help="required to score the sealed test split")
    ap.add_argument("--checkpoints", nargs="*", type=int, default=list(CHECKPOINTS))
    ap.add_argument("--leagues", nargs="*", default=None, help="competitions to score (default: every extracted one)")
    ap.add_argument("--history", choices=["all", "league"], default="all", help="history from every loaded competition, or only the scored one")
    ap.add_argument("--out", default=None, help="report name (default <split>-latest)")
    ap.add_argument("--note", default="")
    args = ap.parse_args()
    if args.split == "test" and not args.unseal:
        raise SystemExit("The test split is sealed. Score it only to promote a candidate (--unseal).")

    leagues = args.leagues or available_leagues()
    if args.history == "league":
        per = {lg: load_matches([lg]) for lg in leagues}
        matches = [m for lg in leagues for m in per[lg]]
        hists = {lg: History(per[lg]) for lg in leagues}
        full = History(matches) if len(leagues) > 1 else hists[leagues[0]]
        history_for = lambda lg: full if lg is None else hists[lg].view(lg)  # noqa: E731
    else:
        matches = load_matches()
        full = History(matches)
        history_for = lambda lg: full if lg is None else full.view(lg)  # noqa: E731
    n_target, n_excl = {}, {}
    for lg in leagues:
        n_target[lg] = sum(1 for m in matches if m.ok and m.league == lg and split_of(m.season) == args.split)
        n_excl[lg] = sum(1 for m in matches if not m.ok and m.league == lg and split_of(m.season) == args.split)
        print(f"{args.split} {lg}: {n_target[lg]} matches ({n_excl[lg]} excluded by the data check)")

    by_league = defaultdict(dict)  # league -> model -> scores
    overall = {}
    per_match = defaultdict(dict)  # league/"all" -> model -> per-match
    REPORTS.mkdir(parents=True, exist_ok=True)
    ledger = REPORTS / "ledger.jsonl"
    for name in args.models:
        t0 = time.time()
        raws = fit_and_collect(get(name), leagues, matches, history_for, args.split, args.checkpoints)
        lines = []
        for lg in leagues:
            r = score(raws[lg])
            per_match[lg][name] = r.pop("_per_match")
            by_league[lg][name] = r
            lines.append(ledger_line(args.split, name, lg, args.note, n_target[lg], r["all"]))
        if len(leagues) > 1:
            r = score(merge(raws.values()))
            per_match["all"][name] = r.pop("_per_match")
            overall[name] = r
            lines.append(ledger_line(args.split, name, "all", args.note, sum(n_target.values()), r["all"]))
        else:
            overall[name] = by_league[leagues[0]][name]
            per_match["all"][name] = per_match[leagues[0]][name]
        a = overall[name]["all"]
        print(
            f"{name:>16}: team NLL {a['team']['nll']:.3f}  MAE {a['team']['mae']:.2f}  bias {a['team']['bias']:+.2f}  cover80 {a['team']['cover80']:.2f}  "
            f"P(1+) logloss {a['player']['1+ shots']['logloss']:.4f}  P(goal) logloss {a['player']['1+ goals']['logloss']:.4f}  ({time.time() - t0:.0f}s)",
            flush=True,
        )
        with ledger.open("a") as f:
            for ln in lines:
                f.write(json.dumps(ln) + "\n")

    names = list(overall)
    comparisons = defaultdict(list)
    if len(names) > 1:
        ref = names[-1]  # the newest candidate, compared with every other model
        scopes = (["all"] if len(leagues) > 1 else []) + leagues
        for scope in scopes:
            print(f"\npaired bootstrap [{scope}], {ref} minus each model (per match; negative = {ref} better; 95% interval):")
            for other in names[:-1]:
                c = paired_bootstrap(per_match[scope][ref], per_match[scope][other])
                line = (
                    f"vs {other:>16}: team NLL {c['team_nll'][0]:+.3f} [{c['team_nll'][1]:+.3f}, {c['team_nll'][2]:+.3f}] {verdict(c['team_nll'])}; "
                    f"P(1+) logloss {c['p1_logloss'][0]:+.3f} [{c['p1_logloss'][1]:+.3f}, {c['p1_logloss'][2]:+.3f}] {verdict(c['p1_logloss'])}; "
                    f"P(goal) logloss {c['pgoal_logloss'][0]:+.3f} [{c['pgoal_logloss'][1]:+.3f}, {c['pgoal_logloss'][2]:+.3f}] {verdict(c['pgoal_logloss'])}"
                )
                print("  " + line)
                comparisons[scope].append(line)
    stem = REPORTS / (args.out or f"{args.split}-latest")
    stem.with_suffix(".json").write_text(json.dumps({"overall": overall, "by_league": by_league}, indent=1, default=float))
    total, excl = sum(n_target.values()), sum(n_excl.values())
    md = [
        f"# Backtest: {args.split} split",
        "",
        f"{total} matches in {len(leagues)} competition(s), {excl} excluded by the data check; history: {args.history}. "
        "Lower is better except 80% cover (ideal 0.80).",
        "",
    ]
    if comparisons:
        md += [f"Paired bootstrap over matches, {names[-1]} minus each model (summed per match over checkpoints; negative = {names[-1]} better):", ""]
        for scope, cs in comparisons.items():
            md += [f"**{'all competitions' if scope == 'all' else LEAGUE_NAMES.get(scope, scope)}**", ""] + [f"- {c}" for c in cs] + [""]
    if len(leagues) > 1:
        md += ["## By competition (all checkpoints)", ""]
        for lg in leagues:
            md += [fmt_table(by_league[lg], "all", f"### {LEAGUE_NAMES.get(lg, lg)} ({n_target[lg]} matches, {n_excl[lg]} excluded)"), ""]
        md += ["## All competitions, by checkpoint", ""]
    for key in ["all"] + [str(c) for c in args.checkpoints]:
        md += [fmt_table(overall, key), ""]
    stem.with_suffix(".md").write_text("\n".join(md))
    print(f"wrote {stem}.md")


if __name__ == "__main__":
    main()
