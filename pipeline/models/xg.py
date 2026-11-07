"""Shot-quality (xG) model from the commentary shots table.

Logistic regression of goal on: zone (six-yard box, centre / side of the box,
outside, long range, difficult angle), body part, assist type (corner, cross,
through ball, fast break, set piece, ...), penalty, and field position (x =
distance from the goal line, y = across, as fractions of the pitch). Fitted on
shots of the train seasons only.
"""
import math

import numpy as np
import statsmodels.api as sm

ZONES = ["six_yard", "box_side", "outside", "long", "angle", "unknown"]  # base: box_centre
BODIES = ["head", "left", "other"]  # base: right
ASSISTS = ["corner", "cross", "direct_fk", "fast_break", "headed_pass", "none", "set_piece", "through_ball"]  # base: pass


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


def shot_row(s):
    """Features of one shot. x is the distance from the goal line as a share of
    half the pitch length (0.2 ~ 10 m), y across the pitch (0.5 = centre). A
    few matches (the current season) give both in percent, x measured from the
    other goal line; they are converted."""
    x, y = _num(s.get("x")), _num(s.get("y"))
    if x is not None and x > 1.5:
        x, y = (100 - x) / 50, (y or 0) / 100
    has_xy = x is not None and y is not None and (x > 0 or y > 0)
    if not has_xy:
        x, y = 0.3, 0.5
    zone, assist = s.get("zone"), s.get("assist")
    ttext = str(s.get("type_text") or "").lower()
    if ttext.startswith("goal - free-kick"):  # the goal text names no zone
        zone, assist = "outside", "direct_fk"
    pen = bool(s.get("penalty")) and (ttext.startswith("penalty") or zone == "unknown")
    if pen:
        return [1.0, 1.0] + [0.0] * (N_FEATS - 2)
    dx, dy = x * 52.5, abs(y - 0.5) * 68  # metres, roughly
    dist = math.sqrt(dx * dx + dy * dy)
    angle = math.atan2(7.32 * dx, dx * dx + dy * dy - 3.66**2)  # angle subtended by the goal mouth
    if angle < 0:
        angle += math.pi
    return (
        [1.0, 0.0, float(has_xy), math.log1p(dist) * has_xy, angle * has_xy]
        + [float(zone == z) for z in ZONES]
        + [float(s.get("body") == b) for b in BODIES]
        + [float(assist == a) for a in ASSISTS]
    )


N_FEATS = 5 + len(ZONES) + len(BODIES) + len(ASSISTS)


class XG:
    def fit(self, shots):
        X = np.asarray([shot_row(s) for s in shots])
        y = np.asarray([float(bool(s.get("goal"))) for s in shots])
        self.beta = sm.GLM(y, X, family=sm.families.Binomial()).fit_regularized(alpha=1e-4, L1_wt=0.0).params
        return self

    def predict_many(self, shots):
        if not shots:
            return np.zeros(0)
        X = np.asarray([shot_row(s) for s in shots])
        return 1 / (1 + np.exp(-(X @ self.beta)))
