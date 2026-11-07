"""Scores for predicted distributions.

Team shots (a full distribution over 0..MAX_SHOTS):
  nll       negative log-likelihood of what happened (lower is better; the main score)
  rps       ranked probability score: squared error of the cumulative distribution
  mae       absolute error of the predicted mean
  cover80   share of outcomes inside the central 80% range (ideal 0.80), using
            the randomised PIT so whole-number outcomes are not biased upward
  pit_lo/hi share below the 10th / above the 90th percentile (ideal 0.10 each)
Player events (probabilities of 1+, 2+, 3+ shots and 1+ goals):
  logloss, brier, and ece (expected calibration error over 10 probability bins)
"""
import numpy as np

EPS = 1e-9


def team_scores(pmfs, ys):
    pmfs = np.asarray(pmfs, dtype=float)
    ys = np.asarray(ys, dtype=int)
    n, k = pmfs.shape
    ys_c = np.clip(ys, 0, k - 1)
    p_obs = pmfs[np.arange(n), ys_c]
    cdf = np.cumsum(pmfs, axis=1)
    obs_cdf = (np.arange(k)[None, :] >= ys_c[:, None]).astype(float)
    rps = ((cdf - obs_cdf) ** 2).sum(axis=1)
    mean = (pmfs * np.arange(k)[None, :]).sum(axis=1)
    # randomised PIT tail shares, to avoid discreteness bias
    below = np.where(ys_c > 0, cdf[np.arange(n), np.maximum(ys_c - 1, 0)], 0.0)
    return {
        "n": int(n),
        "nll": float(-np.log(np.maximum(p_obs, EPS)).mean()),
        "rps": float(rps.mean()),
        "mae": float(np.abs(mean - ys).mean()),
        "bias": float((mean - ys).mean()),
        "pit_lo": (pit_lo := float(np.clip((0.1 - below) / np.maximum(p_obs, EPS), 0, 1).mean())),
        "pit_hi": (pit_hi := float(np.clip((cdf[np.arange(n), ys_c] - 0.9) / np.maximum(p_obs, EPS), 0, 1).mean())),
        # randomised-PIT coverage of the central 80% (unbiased for counts; ideal 0.80)
        "cover80": 1 - pit_lo - pit_hi,
    }


def binary_scores(ps, ys, bins=10):
    ps = np.clip(np.asarray(ps, dtype=float), 1e-6, 1 - 1e-6)
    ys = np.asarray(ys, dtype=float)
    idx = np.minimum((ps * bins).astype(int), bins - 1)
    ece = 0.0
    table = []
    for b in range(bins):
        sel = idx == b
        if sel.any():
            gap = ps[sel].mean() - ys[sel].mean()
            ece += sel.mean() * abs(gap)
            table.append((b / bins, int(sel.sum()), float(ps[sel].mean()), float(ys[sel].mean())))
    return {
        "n": int(len(ps)),
        "logloss": float(-(ys * np.log(ps) + (1 - ys) * np.log(1 - ps)).mean()),
        "brier": float(((ps - ys) ** 2).mean()),
        "ece": float(ece),
        "mean_p": float(ps.mean()),
        "rate": float(ys.mean()),
        "bins": table,
    }
