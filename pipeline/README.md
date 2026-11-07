# Shot model pipeline

Offline data, backtest and improvement loop for the soccer shot simulator.
Python; the app itself stays dependency-free JavaScript.

```
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python -m pipeline.crawl      # download every completed match (resumable; --refresh for new ones)
.venv/bin/python -m pipeline.extract    # raw summaries -> data/tables/*.csv.gz
.venv/bin/python -m pipeline.evaluate   # score every model on the dev split
.venv/bin/python -m pipeline.tune       # tune team_share's recency/shrinkage settings on dev
```

`data/` (raw downloads and tables) is gitignored and rebuilt by the first two
commands. Reports and the experiment ledger in `pipeline/reports/` are
committed.

## Data

Premier League, 2022/23 to the current season (1,611 matches so far), from
ESPN's public feed. Per match:

| table | one row per | from |
|---|---|---|
| matches | match | header, box score |
| appearances | player who played | rosters: minutes on/off (substitution and red-card minutes), shots, on target, goals, saves |
| shots | shot | commentary: minute, half, shooter, outcome, field x/y, body part, assist type, zone |
| events | goal, own goal, red card, substitution | key events |

Checks: commentary shot counts match the player box scores 97.5% of the time
(team box-score totals are unreliable, with zeros in older seasons, so the
commentary is the target). Matches where a team's commentary count is more than
2 away from its players' box-score total are excluded (7 of 380 in 2025/26).
The score at any minute rebuilds correctly in 99.9% of matches (own goals are
credited to the side that benefits).

## Splits

| season | role |
|---|---|
| 2022/23 | warmup: history only |
| 2023/24, 2024/25 | train: models are fitted here |
| 2025/26 | dev: the improvement loop scores every candidate here |
| 2026/27 (current) | test: sealed; scored only to promote a candidate (`--unseal`); grows weekly with never-seen matches |

Every prediction uses only matches that kicked off earlier, plus what had
happened in that match by the checkpoint minute.

## What is predicted and how it is scored

At kickoff and at minutes 15, 30, 45, 60 and 75, for both teams:

* **team shots after that minute**, as a full distribution: scored by
  negative log-likelihood (main score), ranked probability score, mean error
  and bias, and 80% coverage (randomised PIT; ideal 0.80)
* **each on-pitch player's chance of 1+, 2+ and 3+ shots and 1+ goals**:
  log-loss, Brier score and calibration error (ECE)

`evaluate` also runs a paired bootstrap over matches between the newest model
and every other one, so a change is only called better when the 95% interval
excludes zero.

## Models

| name | what it is |
|---|---|
| `league_avg` | league-average team rate; position-average player rate |
| `team_avg` | each team's and player's season-to-date rate, shrunk |
| `current` | replay of the live simulator (`lib/shotModel.js` + `simPlan`), hand-set constants |
| `team_share` | team shots first (negative binomial GLM: attack, opponent defence, home, score state, man advantage, time left), then each on-pitch player's share; all coefficients fitted on train |

## The improvement loop

1. Score the current best on dev; read where it is wrong (by checkpoint,
   calibration bins, bias).
2. Change one thing.
3. Re-score; keep it only if the paired bootstrap says better, else revert.
4. Every run is appended to `reports/ledger.jsonl` (with a note), tuning
   trials to `reports/tuning.jsonl`.
5. Stop when the targets are met or several rounds bring nothing.

Promotion to the app needs a win on the sealed test split too, and a person's
sign-off.
