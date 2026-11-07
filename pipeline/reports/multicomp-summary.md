# Shot model: seven competitions, ten loop rounds and the sealed test

Scope: the app's soccer competitions (lib/espn.js `SOCCER_LEAGUES`): Premier League, LaLiga, Bundesliga, Serie A,
Ligue 1, Champions League, Europa League; seasons 2022/23 to 2026/27 with the same roles as before (2022 warmup,
2023-24 train, 2025 dev, 2026 sealed test). Detailed tables: `data-check.md`, `dev-scaleup.md`, `dev-multicomp.md`,
`test-multicomp.md`; every run is in `ledger.jsonl` (one line per model and competition, plus `league: "all"`).

## Recommendation

| competition | export | why |
|---|---|---|
| Premier League | `team_share_ridge` (keep what is shipping) | dev: `team_share_oppadj` better on team NLL (-0.100 per match), but test is no clear difference (+0.055 [-0.129, +0.230]); no case to switch yet |
| LaLiga | `team_share_oppadj` | test better on all three scores vs `team_share_ridge` |
| Bundesliga | `team_share_oppadj` | dev better (team NLL, P(goal)); test no clear difference, point estimates better |
| Serie A | `team_share_oppadj` | dev better (team NLL, P(1+)); test no clear difference |
| Ligue 1 | `team_share_oppadj` | dev better; test better on team NLL (-0.382) |
| Champions League | `team_share_oppadj` | dev better (team NLL -0.197); test no clear difference, point estimates better |
| Europa League | `team_share_oppadj` | dev better; test better on team NLL (-0.630) |

`team_share_oppadj` is one pooled fit over all seven competitions (one coefficient set plus a team-shot intercept per
competition), so it is a single export. Against `current` (the live simulator) it is clearly better on every
competition, on dev and on test, on all three scores. If one model has to serve every competition, use
`team_share_oppadj`: over all competitions it beats `team_share_ridge` on test (team NLL -0.227 [-0.335, -0.119],
P(goal) -0.052 [-0.090, -0.013], P(1+) -0.081 [-0.166, +0.003]).

Open issue for everyone: in the 2026/27 season ESPN's commentary and box scores agree exactly (65-72% in earlier
seasons, where the commentary is ~0.4 shots per team short) and teams take 1.2-2.5 more shots per match in every
competition. All models under-predict the test season (bias -0.7 shots per team for the team-share models, -1.75 for
`current`). The two level-tracking rounds (1 and 7) could not be validated, because dev (2025/26) has no such
shift, and both were worse on dev. Once a few more rounds of 2026/27 are in, refit with the current season's first
weeks in training, or revisit round 7 with the new data.

## Data (per competition)

| competition | matches | warmup / train / dev / test | excluded by the check | agree exact (old seasons) | agree within 2 | x/y | knockout games (extra time) |
|---|---|---|---|---|---|---|---|
| Premier League | 1611 | 380 / 760 / 380 / 91 | 25 (1.6%) | 65-72% | 98.9-99.3% | 96-100% | - |
| LaLiga | 1625 | 375 / 760 / 380 / 110 | 36 (2.2%) | 62-72% | 98.3-99.6% | 96-100% | - |
| Bundesliga | 1297 | 306 / 612 / 306 / 73 | 23 (1.8%) | 64-70% | 98.7-99.3% | 96-100% | - |
| Serie A | 1622 | 381 / 760 / 380 / 101 | 39 (2.4%) | 64-68% | 98.3-99.2% | 96-100% | - |
| Ligue 1 | 1379 | 380 / 612 / 305 / 82 | 21 (1.5%) | 64-70% | 98.2-100% | 96-100% | - |
| Champions League | 700 | 125 / 314 / 189 / 72 | 11 (1.6%) | 68-72% | 98.4-99.5% | 96-100% | 148 (10) |
| Europa League | 732 | 141 / 330 / 189 / 72 | 10 (1.4%) | 64-73% | 98.9-99.6% | 95-100% | 180 (20) |

Every competition and season has commentary shots (99.5-100% of matches), field coordinates (95-100% of shots),
zones (98%+) and full player box scores (100%). In 2026/27 the commentary and box scores agree exactly
(99.3-100%). Cups: ESPN keys both phases by the season's starting year (`season.year`), so the group/league phase
(autumn) and the knockouts (next spring) of one season share a key; the stage comes from the season name
(Group Stage, League Phase, Knockout Round Playoffs, Round of 16, ..., Final) and `leg` from the header. Matches
that went to extra time are scored on regulation time only (shots, goals and cards after 90 minutes dropped);
shoot-out kicks (period 5) are never counted.

## Scale-up decisions

**History across competitions.** Team and player ids are global, so a club's league and European games feed one
form history; league reference rates (team shots per match, position rates, conversion) are per competition
(`History.view(league)`). Same model (`team_share_ridge`, fitted per competition), cross-competition history minus
competition-only history on dev: team NLL -0.013 [-0.053, +0.029] (no difference), P(1+ shot) -0.135
[-0.208, -0.066] better, P(goal) -0.062 [-0.103, -0.020] better; in the cups P(1+) -0.78 (UCL) and -0.54 (UEL)
per match. Kept.

**Pooled vs per-competition.** `team_share_pooled` (one fit, competition intercepts) vs `team_share_ridge` fitted
per competition: -0.017 [-0.044, +0.011] team NLL overall; per competition better on Premier League (-0.057),
worse on LaLiga (+0.058), no clear difference elsewhere. For the final candidate, pooled minus per-competition
(`team_share_oppadj` vs `team_share_oppadj:per`): overall no clear difference (team NLL -0.019 [-0.045, +0.008]);
pooled better on Premier League team NLL (-0.070), Serie A P(1+) (-0.036), Bundesliga and Ligue 1 P(goal); worse on
LaLiga team NLL (+0.056); cups no clear difference. Decision: **one pooled model with competition intercepts**:
as good or better almost everywhere, one coefficient set to export and maintain, and the small cup training sets
(300-330 matches) borrow strength from the leagues.

## Loop rounds (dev, all 7 competitions, 2,086 matches; candidate minus base, paired bootstrap per match, 95% interval)

| round | change (one each) | vs | team NLL | P(1+ shot) logloss | P(goal) logloss | result |
|---|---|---|---|---|---|---|
| 1 | league level from recent matches (EW half-life 60) + team form relative to each past match's level | pooled | +0.022 [+0.003, +0.041] | +0.022 [+0.006, +0.038] | +0.004 | rejected |
| 2 | team-shot dispersion per checkpoint | pooled | -0.006 [-0.014, +0.001] | 0 | 0 | rejected (Premier League alone -0.019) |
| 3 | goal probability from an xG model (zone, body, assist, x/y, angle, penalty) x shrunk finishing | pooled | 0 | 0 | -0.011 [-0.047, +0.025] | rejected (Bundesliga alone -0.109) |
| 4 | in-play: each side's shots so far vs its pre-match expectation | pooled | **-0.080 [-0.110, -0.050]** | **-0.058 [-0.084, -0.032]** | **-0.018 [-0.028, -0.008]** | **kept** |
| 5 | in-play: each player's shots so far vs his expectation (player share model) | round 4 | 0 | **-0.004 [-0.007, -0.002]** | **-0.001 [-0.002, -0.000]** | **kept** |
| 6 | cup knockouts: first leg / second leg / single game, aggregate trail/lead (ridge) | round 5 | -0.009 [-0.025, +0.005] | -0.007 [-0.018, +0.004] | -0.002 | rejected (UCL alone -0.149) |
| 7 | season-to-date league level (prior 80 matches), form relative to it | round 5 | +0.047 [+0.026, +0.067] | +0.038 [+0.022, +0.054] | +0.004 | rejected |
| 8 | thin-history (<10 matches) indicators, team and opponent | round 5 | -0.011 [-0.023, +0.001] | -0.009 [-0.018, +0.001] | +0.000 | rejected |
| 9 | opponent-adjusted team attack/defence form | round 5 | **-0.040 [-0.066, -0.013]** | **-0.039 [-0.059, -0.017]** | -0.007 [-0.016, +0.001] | **kept** |
| 10 | dispersion per checkpoint again, on the new base | round 5 | -0.004 [-0.010, +0.002] | 0 | 0 | rejected |

Round numbers are those of this multi-competition pass (as in `models/registry.py` and the ledger notes; the
earlier Premier League-only rounds produced `team_share_ridge`). The last two rounds brought nothing, after ten
rounds, so the loop stops. Final candidate:
`team_share_oppadj` = pooled team-share model + rounds 4, 5 and 9.

Error breakdowns that drove the rounds (`team_share_pooled`, dev): a team with no shots yet at the checkpoint was
over-predicted by 0.4 shots (round 4); knockout first legs over-predicted by 0.9 and second legs under-predicted by
0.3 (round 6: helps the Champions League only); teams with <10 previous matches over-predicted by 0.5 (round 8: not
significant).

## Final scores

Dev, all competitions (team-shot NLL / bias / 80% cover; P(1+ shot), P(goal) log-loss):

| model | team NLL | bias | cover | P(1+) | P(goal) |
|---|---|---|---|---|---|
| current | 2.735 | -0.97 | 0.66 | 0.5328 | 0.2020 |
| team_share_ridge (per competition) | 2.521 | -0.09 | 0.79 | 0.5167 | 0.1905 |
| team_share_oppadj | 2.510 | -0.06 | 0.80 | 0.5158 | 0.1903 |

`team_share_oppadj` minus `team_share_ridge` on dev: team NLL -0.137 [-0.184, -0.091], P(1+) -0.114
[-0.156, -0.073], P(goal) -0.032 [-0.050, -0.013] per match; minus `current`: -2.697, -2.230, -1.545.

Sealed test (2026/27 so far, scored once), per competition, team NLL (bias):

| competition | matches | current | team_share_ridge | team_share_oppadj | oppadj - ridge, team NLL per match | oppadj - current |
|---|---|---|---|---|---|---|
| Premier League | 91 | 2.954 (-1.70) | 2.580 (-0.42) | 2.585 (-0.50) | +0.055 [-0.129, +0.230] | -4.430 better |
| LaLiga | 110 | 3.038 (-1.87) | 2.669 (-0.70) | 2.636 (-0.75) | **-0.398 [-0.637, -0.176]** | -4.815 better |
| Bundesliga | 73 | 3.215 (-2.19) | 2.741 (-0.93) | 2.739 (-0.97) | -0.015 [-0.267, +0.220] | -5.706 better |
| Serie A | 101 | 3.130 (-1.56) | 2.754 (-1.14) | 2.749 (-1.26) | -0.067 [-0.285, +0.149] | -4.571 better |
| Ligue 1 | 82 | 2.923 (-1.36) | 2.684 (-0.32) | 2.652 (-0.27) | **-0.382 [-0.766, -0.036]** | -3.250 better |
| Champions League | 72 | 3.103 (-2.04) | 2.710 (-0.78) | 2.695 (-0.85) | -0.182 [-0.518, +0.164] | -4.896 better |
| Europa League | 72 | 2.939 (-1.64) | 2.662 (-0.54) | 2.609 (-0.43) | **-0.630 [-1.086, -0.243]** | -3.954 better |
| all | 601 | 3.042 (-1.75) | 2.685 (-0.70) | 2.666 (-0.73) | **-0.227 [-0.335, -0.119]** | -4.517 better |

P(1+ shot) / P(goal) log-loss on test, all competitions: current 0.5451 / 0.2167, team_share_ridge 0.5283 / 0.2036,
team_share_oppadj 0.5277 / 0.2032. LaLiga is also better on P(1+) (-0.192) and P(goal) (-0.115) vs ridge; every
competition is better than `current` on all three scores (95% intervals exclude zero).

## Reproducing

```
.venv/bin/python -m pipeline.crawl --leagues esp.1 ger.1 ita.1 fra.1 uefa.champions uefa.europa
.venv/bin/python -m pipeline.extract
.venv/bin/python -m pipeline.check
.venv/bin/python -m pipeline.evaluate --models league_avg team_avg current team_share_ridge team_share_pooled team_share_oppadj:per team_share_oppadj
.venv/bin/python -m pipeline.evaluate --leagues eng.1 --history league   # the original Premier League numbers, unchanged
```
