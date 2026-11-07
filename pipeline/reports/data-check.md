# Data checks by competition and season

Shots come from ESPN's commentary (minute, shooter, outcome, x/y, zone, body part, assist).
`player box`: team-matches with an 11+ player box score; `agree exact` / `agree ±2`: team-matches where the
commentary shot count equals (is within 2 of) the players' box-score total; `excluded`: matches dropped by
the data check (a team more than 2 off). Knockout games that went to extra time are scored on regulation
time only; the check counts every shot before the shoot-out, as the box score does.

| competition | season | role | matches | knockout | extra time | with commentary | shots/team | with x/y | zone known | player box | agree exact | agree ±2 | excluded |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 2022/23 | warmup | 380 | 0 | 0 | 100.0% | 12.1 | 96.0% | 98.7% | 100.0% | 68.9% | 99.3% | 5 |
| Premier League | 2023/24 | train | 380 | 0 | 0 | 100.0% | 13.1 | 96.3% | 98.8% | 100.0% | 64.5% | 99.2% | 6 |
| Premier League | 2024/25 | train | 380 | 0 | 0 | 100.0% | 12.5 | 97.5% | 99.0% | 100.0% | 71.8% | 99.1% | 7 |
| Premier League | 2025/26 | dev | 380 | 0 | 0 | 99.7% | 12.0 | 98.0% | 98.7% | 100.0% | 65.1% | 98.9% | 7 |
| Premier League | 2026/27 | test | 91 | 0 | 0 | 100.0% | 13.7 | 100.0% | 99.0% | 100.0% | 100.0% | 100.0% | 0 |
| LaLiga | 2022/23 | warmup | 375 | 0 | 0 | 100.0% | 11.7 | 95.6% | 98.5% | 100.0% | 67.5% | 98.3% | 13 |
| LaLiga | 2023/24 | train | 380 | 0 | 0 | 100.0% | 11.6 | 96.0% | 98.6% | 100.0% | 62.0% | 98.7% | 10 |
| LaLiga | 2024/25 | train | 380 | 0 | 0 | 100.0% | 11.4 | 97.1% | 98.2% | 100.0% | 72.2% | 98.7% | 10 |
| LaLiga | 2025/26 | dev | 380 | 0 | 0 | 100.0% | 12.1 | 98.0% | 98.3% | 100.0% | 70.8% | 99.6% | 3 |
| LaLiga | 2026/27 | test | 110 | 0 | 0 | 100.0% | 13.4 | 100.0% | 98.5% | 100.0% | 100.0% | 100.0% | 0 |
| Bundesliga | 2022/23 | warmup | 306 | 0 | 0 | 100.0% | 12.2 | 96.0% | 98.1% | 100.0% | 67.0% | 99.2% | 5 |
| Bundesliga | 2023/24 | train | 306 | 0 | 0 | 100.0% | 13.2 | 96.0% | 98.5% | 100.0% | 67.5% | 99.0% | 6 |
| Bundesliga | 2024/25 | train | 306 | 0 | 0 | 100.0% | 12.5 | 97.4% | 98.6% | 100.0% | 69.6% | 99.3% | 4 |
| Bundesliga | 2025/26 | dev | 306 | 0 | 0 | 100.0% | 12.8 | 97.8% | 98.3% | 100.0% | 63.7% | 98.7% | 8 |
| Bundesliga | 2026/27 | test | 73 | 0 | 0 | 100.0% | 15.2 | 100.0% | 99.1% | 100.0% | 100.0% | 100.0% | 0 |
| Serie A | 2022/23 | warmup | 381 | 0 | 0 | 100.0% | 12.1 | 95.6% | 98.6% | 100.0% | 66.3% | 99.2% | 6 |
| Serie A | 2023/24 | train | 380 | 0 | 0 | 100.0% | 12.1 | 95.5% | 98.3% | 100.0% | 63.7% | 98.6% | 9 |
| Serie A | 2024/25 | train | 380 | 0 | 0 | 100.0% | 11.5 | 96.8% | 98.5% | 100.0% | 67.5% | 98.6% | 11 |
| Serie A | 2025/26 | dev | 380 | 0 | 0 | 100.0% | 11.9 | 97.8% | 98.6% | 100.0% | 68.3% | 98.3% | 13 |
| Serie A | 2026/27 | test | 101 | 0 | 0 | 100.0% | 14.5 | 99.9% | 99.0% | 100.0% | 99.5% | 100.0% | 0 |
| Ligue 1 | 2022/23 | warmup | 380 | 0 | 0 | 100.0% | 11.6 | 95.7% | 98.1% | 100.0% | 65.1% | 99.2% | 6 |
| Ligue 1 | 2023/24 | train | 306 | 0 | 0 | 99.7% | 12.0 | 95.7% | 98.3% | 100.0% | 64.4% | 98.2% | 8 |
| Ligue 1 | 2024/25 | train | 306 | 0 | 0 | 100.0% | 12.0 | 97.2% | 98.2% | 100.0% | 69.9% | 100.0% | 0 |
| Ligue 1 | 2025/26 | dev | 305 | 0 | 0 | 100.0% | 12.1 | 97.8% | 98.4% | 100.0% | 70.0% | 98.9% | 7 |
| Ligue 1 | 2026/27 | test | 82 | 0 | 0 | 100.0% | 13.3 | 100.0% | 98.4% | 100.0% | 100.0% | 100.0% | 0 |
| Champions League | 2022/23 | warmup | 125 | 29 | 0 | 100.0% | 12.2 | 96.0% | 98.2% | 100.0% | 71.6% | 99.2% | 2 |
| Champions League | 2023/24 | train | 125 | 29 | 3 | 100.0% | 13.1 | 96.1% | 98.6% | 100.0% | 69.6% | 98.8% | 3 |
| Champions League | 2024/25 | train | 189 | 45 | 4 | 99.5% | 12.5 | 96.4% | 98.2% | 100.0% | 68.0% | 98.4% | 4 |
| Champions League | 2025/26 | dev | 189 | 45 | 3 | 100.0% | 13.3 | 97.8% | 98.2% | 100.0% | 69.8% | 99.5% | 2 |
| Champions League | 2026/27 | test | 72 | 0 | 0 | 100.0% | 14.8 | 100.0% | 98.7% | 100.0% | 99.3% | 100.0% | 0 |
| Europa League | 2022/23 | warmup | 141 | 45 | 6 | 100.0% | 11.9 | 96.1% | 98.5% | 100.0% | 65.2% | 99.3% | 2 |
| Europa League | 2023/24 | train | 141 | 45 | 4 | 100.0% | 12.3 | 95.3% | 98.3% | 100.0% | 64.2% | 99.6% | 1 |
| Europa League | 2024/25 | train | 189 | 45 | 5 | 100.0% | 12.8 | 97.1% | 98.6% | 100.0% | 64.6% | 98.9% | 4 |
| Europa League | 2025/26 | dev | 189 | 45 | 5 | 100.0% | 12.3 | 97.6% | 98.6% | 100.0% | 72.8% | 99.2% | 3 |
| Europa League | 2026/27 | test | 72 | 0 | 0 | 100.0% | 13.9 | 100.0% | 98.9% | 100.0% | 100.0% | 100.0% | 0 |

| competition | matches | excluded | excluded % |
|---|---|---|---|
| Premier League | 1611 | 25 | 1.6% |
| LaLiga | 1625 | 36 | 2.2% |
| Bundesliga | 1297 | 23 | 1.8% |
| Serie A | 1622 | 39 | 2.4% |
| Ligue 1 | 1379 | 21 | 1.5% |
| Champions League | 700 | 11 | 1.6% |
| Europa League | 732 | 10 | 1.4% |
