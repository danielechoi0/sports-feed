"""Model interface and shared helpers.

A model predicts, for one team at checkpoint t of a match:
  pmf      probability of 0..MAX_SHOTS more team shots after t
  players  {player_id: {"mean", "p1", "p2", "p3", "pgoal"}} for players on the
           pitch at t (probability of 1+/2+/3+ shots and 1+ goals after t)
using only History (matches before this one) and the State at t.
"""
from collections import Counter

import numpy as np
from scipy.stats import nbinom, poisson

from ..dataset import MAX_SHOTS, state_at

K = np.arange(MAX_SHOTS + 1)


def poisson_pmf(lam):
    p = poisson.pmf(K, max(lam, 1e-9))
    p[-1] += max(0.0, 1 - p.sum())
    return p


def negbin_pmf(mean, disp):
    """Negative binomial with variance mean + mean^2 / disp."""
    mean = max(mean, 1e-9)
    p = nbinom.pmf(K, disp, disp / (disp + mean))
    p[-1] += max(0.0, 1 - p.sum())
    return p


def poisson_player(lam, pgoal_per_shot):
    lam = max(lam, 0.0)
    e = np.exp(-lam)
    return {
        "mean": lam,
        "p1": 1 - e,
        "p2": 1 - e * (1 + lam),
        "p3": 1 - e * (1 + lam + lam * lam / 2),
        "pgoal": 1 - np.exp(-lam * pgoal_per_shot),
    }


def pos_group(abbr):
    a = str(abbr or "").upper()
    if a in ("G", "GK"):
        return "G"
    if a.startswith(("CD", "LB", "RB", "LWB", "RWB", "CB", "SW")) or a == "D":
        return "D"
    if a.startswith(("AM", "LW", "RW", "LAM", "RAM")) or a == "W":
        return "AM"
    if a.startswith(("F", "CF", "ST", "SS", "LF", "RF", "RCF", "LCF")):
        return "F"
    return "M"


def player_position(row, history, date):
    """A player's position; bench players are listed as SUB, so use their usual one."""
    pos = row.get("pos")
    if pos and pos != "SUB":
        return pos
    c = Counter(x[2]["pos"] for x in history.player_recent(row["player_id"], date, 30) if x[2].get("pos") not in (None, "SUB"))
    return c.most_common(1)[0][0] if c else "M"


class Model:
    name = "base"
    pooled = False  # True: one fit across competitions (evaluate fits the others per competition)

    def fit(self, train_matches, history):
        return self

    def predict(self, match, team_id, t, history):
        raise NotImplementedError

    def state(self, match, team_id, t):
        return state_at(match, team_id, t)
