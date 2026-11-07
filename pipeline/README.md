# Shot model pipeline

Offline data, backtest and improvement loop for the soccer shot simulator.
Python; the app itself stays dependency-free JavaScript.

```
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python -m pipeline.crawl      # download every completed match (resumable; --refresh for new ones; --leagues ...)
.venv/bin/python -m pipeline.extract    # raw summaries -> data/tables/<league>/*.csv.gz
.venv/bin/python -m pipeline.check      # data checks per competition and season -> reports/data-check.md
.venv/bin/python -m pipeline.evaluate   # score every model on the dev split, every competition
.venv/bin/python -m pipeline.evaluate --leagues eng.1 --history league   # the original Premier League-only setup
.venv/bin/python -m pipeline.tune       # tune team_share's recency/shrinkage settings on dev (Premier League)
```

`data/` (raw downloads and tables) is gitignored and rebuilt by the first two
commands. Reports and the experiment ledger in `pipeline/reports/` are
committed.

## Data

The app's seven soccer competitions (`config.LEAGUES`: Premier League,
LaLiga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League),
2022/23 to the current season (8,966 matches so far), from ESPN's public
feed. Cups are keyed by the season's starting year like the leagues (group or
league phase in the autumn, knockouts the next spring); the stage and leg are
kept, and knockout games that went to extra time are scored on regulation
time only. Team and player ids are global, so a club's league and European
games share one history; league reference rates are per competition. Per match:

| table | one row per | from |
|---|---|---|
| matches | match | header, box score |
| appearances | player who played | rosters: minutes on/off (substitution and red-card minutes), shots, on target, goals, saves |
| shots | shot | commentary: minute, half, shooter, outcome, field x/y, body part, assist type, zone |
| events | goal, own goal, red card, substitution | key events |

Checks (`reports/data-check.md`): a team's commentary shot count is within 2
of its players' box-score total 98-100% of the time in every competition and
season (exactly equal 62-73% before 2026/27, where the commentary runs ~0.4
shots per team short; 99-100% in 2026/27). Team box-score totals are
unreliable, with zeros in older seasons, so the commentary is the target.
Matches where a team's commentary count is more than 2 away from its players'
total are excluded (1.4-2.4% per competition).
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
| `team_share_tuned`, `team_share_ridge` | Premier League loop rounds: tuned recency settings; ridge on the man-advantage effect |
| `team_share_pooled` | `team_share_ridge` fitted once over every competition with a team-shot intercept per competition (models/pooled.py) |
| `team_share_oppadj` | multi-competition candidate: pooled + in-play shots so far (team and player) + opponent-adjusted team form |

Single-competition models are fitted per competition by `evaluate`; models with
`pooled = True` once over all of them (`<name>:per` fits a pooled model per
competition instead). Results: `reports/multicomp-summary.md`.

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
