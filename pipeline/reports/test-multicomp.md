# Backtest: test split

601 matches in 7 competition(s), 0 excluded by the data check; history: all. Lower is better except 80% cover (ideal 0.80).

Paired bootstrap over matches, team_share_oppadj minus each model (summed per match over checkpoints; negative = team_share_oppadj better):

**all competitions**

- vs          current: team NLL -4.517 [-5.201, -3.869] better; P(1+) logloss -2.299 [-2.705, -1.898] better; P(goal) logloss -1.777 [-2.103, -1.469] better
- vs team_share_ridge: team NLL -0.227 [-0.335, -0.119] better; P(1+) logloss -0.081 [-0.166, +0.003] no clear difference; P(goal) logloss -0.052 [-0.090, -0.013] better

**Premier League**

- vs          current: team NLL -4.430 [-6.468, -2.536] better; P(1+) logloss -2.220 [-3.136, -1.326] better; P(goal) logloss -1.900 [-2.641, -1.130] better
- vs team_share_ridge: team NLL +0.055 [-0.129, +0.230] no clear difference; P(1+) logloss +0.133 [-0.053, +0.310] no clear difference; P(goal) logloss -0.016 [-0.096, +0.080] no clear difference

**LaLiga**

- vs          current: team NLL -4.815 [-6.243, -3.467] better; P(1+) logloss -2.061 [-3.260, -1.057] better; P(goal) logloss -1.618 [-2.408, -0.910] better
- vs team_share_ridge: team NLL -0.398 [-0.637, -0.176] better; P(1+) logloss -0.192 [-0.401, -0.005] better; P(goal) logloss -0.115 [-0.208, -0.027] better

**Bundesliga**

- vs          current: team NLL -5.706 [-7.510, -3.975] better; P(1+) logloss -2.155 [-3.163, -1.169] better; P(goal) logloss -1.536 [-2.452, -0.636] better
- vs team_share_ridge: team NLL -0.015 [-0.267, +0.220] no clear difference; P(1+) logloss -0.043 [-0.234, +0.138] no clear difference; P(goal) logloss -0.081 [-0.190, +0.028] no clear difference

**Serie A**

- vs          current: team NLL -4.571 [-6.433, -2.786] better; P(1+) logloss -3.459 [-4.647, -2.409] better; P(goal) logloss -2.087 [-2.897, -1.343] better
- vs team_share_ridge: team NLL -0.067 [-0.285, +0.149] no clear difference; P(1+) logloss -0.057 [-0.228, +0.104] no clear difference; P(goal) logloss +0.027 [-0.026, +0.081] no clear difference

**Ligue 1**

- vs          current: team NLL -3.250 [-4.927, -1.717] better; P(1+) logloss -2.091 [-3.290, -0.900] better; P(goal) logloss -1.996 [-2.841, -1.150] better
- vs team_share_ridge: team NLL -0.382 [-0.766, -0.036] better; P(1+) logloss -0.149 [-0.384, +0.069] no clear difference; P(goal) logloss -0.023 [-0.103, +0.061] no clear difference

**Champions League**

- vs          current: team NLL -4.896 [-6.746, -3.241] better; P(1+) logloss -2.248 [-3.363, -1.189] better; P(goal) logloss -1.926 [-2.944, -0.894] better
- vs team_share_ridge: team NLL -0.182 [-0.518, +0.164] no clear difference; P(1+) logloss -0.107 [-0.366, +0.166] no clear difference; P(goal) logloss -0.019 [-0.146, +0.105] no clear difference

**Europa League**

- vs          current: team NLL -3.954 [-5.977, -2.275] better; P(1+) logloss -1.567 [-2.494, -0.618] better; P(goal) logloss -1.274 [-2.370, -0.361] better
- vs team_share_ridge: team NLL -0.630 [-1.086, -0.243] better; P(1+) logloss -0.152 [-0.475, +0.173] no clear difference; P(goal) logloss -0.143 [-0.303, +0.015] no clear difference

## By competition (all checkpoints)

### Premier League (91 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.954 | 2.286 | 3.02 | -1.70 | 0.66 | 0.5315 | 0.029 | 0.3461 | 0.1829 | 0.2044 | 0.021 |
| team_share_ridge | 2.580 | 1.935 | 2.72 | -0.42 | 0.81 | 0.5136 | 0.010 | 0.3270 | 0.1714 | 0.1901 | 0.006 |
| team_share_oppadj | 2.585 | 1.949 | 2.73 | -0.50 | 0.80 | 0.5146 | 0.015 | 0.3288 | 0.1726 | 0.1900 | 0.005 |

### LaLiga (110 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.038 | 2.442 | 3.24 | -1.87 | 0.59 | 0.5306 | 0.040 | 0.3284 | 0.1709 | 0.2094 | 0.019 |
| team_share_ridge | 2.669 | 2.118 | 2.97 | -0.70 | 0.75 | 0.5164 | 0.016 | 0.3169 | 0.1642 | 0.1980 | 0.006 |
| team_share_oppadj | 2.636 | 2.056 | 2.88 | -0.75 | 0.76 | 0.5149 | 0.017 | 0.3149 | 0.1627 | 0.1971 | 0.006 |

### Bundesliga (73 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.215 | 2.752 | 3.65 | -2.19 | 0.55 | 0.5594 | 0.054 | 0.3584 | 0.2005 | 0.2276 | 0.027 |
| team_share_ridge | 2.741 | 2.248 | 3.16 | -0.93 | 0.73 | 0.5434 | 0.022 | 0.3426 | 0.1884 | 0.2165 | 0.004 |
| team_share_oppadj | 2.739 | 2.237 | 3.12 | -0.97 | 0.74 | 0.5431 | 0.022 | 0.3426 | 0.1884 | 0.2159 | 0.003 |

### Serie A (101 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.130 | 2.595 | 3.43 | -1.56 | 0.61 | 0.5606 | 0.057 | 0.3384 | 0.1805 | 0.2112 | 0.022 |
| team_share_ridge | 2.754 | 2.281 | 3.10 | -1.14 | 0.74 | 0.5348 | 0.022 | 0.3164 | 0.1687 | 0.1952 | 0.004 |
| team_share_oppadj | 2.749 | 2.277 | 3.10 | -1.26 | 0.74 | 0.5344 | 0.023 | 0.3154 | 0.1678 | 0.1954 | 0.004 |

### Ligue 1 (82 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.923 | 2.290 | 3.08 | -1.36 | 0.63 | 0.5475 | 0.049 | 0.3382 | 0.1656 | 0.2145 | 0.021 |
| team_share_ridge | 2.684 | 2.088 | 2.91 | -0.32 | 0.74 | 0.5327 | 0.019 | 0.3272 | 0.1595 | 0.1995 | 0.005 |
| team_share_oppadj | 2.652 | 2.053 | 2.88 | -0.27 | 0.76 | 0.5316 | 0.018 | 0.3259 | 0.1579 | 0.1994 | 0.004 |

### Champions League (72 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.103 | 2.545 | 3.38 | -2.04 | 0.60 | 0.5413 | 0.038 | 0.3616 | 0.1889 | 0.2577 | 0.023 |
| team_share_ridge | 2.710 | 2.152 | 2.98 | -0.78 | 0.78 | 0.5251 | 0.024 | 0.3465 | 0.1799 | 0.2433 | 0.014 |
| team_share_oppadj | 2.695 | 2.128 | 2.96 | -0.85 | 0.77 | 0.5243 | 0.022 | 0.3447 | 0.1805 | 0.2431 | 0.012 |

### Europa League (72 matches, 0 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.939 | 2.348 | 3.15 | -1.64 | 0.63 | 0.5492 | 0.051 | 0.3466 | 0.1827 | 0.2014 | 0.018 |
| team_share_ridge | 2.662 | 2.142 | 3.02 | -0.54 | 0.79 | 0.5385 | 0.015 | 0.3344 | 0.1742 | 0.1928 | 0.005 |
| team_share_oppadj | 2.609 | 2.035 | 2.91 | -0.43 | 0.79 | 0.5374 | 0.020 | 0.3323 | 0.1722 | 0.1917 | 0.005 |

## All competitions, by checkpoint

### Checkpoint: all checkpoints

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.042 | 2.462 | 3.27 | -1.75 | 0.61 | 0.5451 | 0.043 | 0.3439 | 0.1808 | 0.2167 | 0.022 |
| team_share_ridge | 2.685 | 2.136 | 2.98 | -0.70 | 0.76 | 0.5283 | 0.010 | 0.3285 | 0.1714 | 0.2036 | 0.002 |
| team_share_oppadj | 2.666 | 2.105 | 2.93 | -0.73 | 0.77 | 0.5277 | 0.011 | 0.3276 | 0.1708 | 0.2032 | 0.002 |

### Checkpoint: 0

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.425 | 3.333 | 4.47 | -2.00 | 0.59 | 0.5559 | 0.044 | 0.4859 | 0.3256 | 0.3008 | 0.031 |
| team_share_ridge | 3.060 | 2.943 | 4.09 | -1.00 | 0.77 | 0.5372 | 0.016 | 0.4656 | 0.3085 | 0.2812 | 0.006 |
| team_share_oppadj | 3.052 | 2.921 | 4.08 | -1.08 | 0.77 | 0.5373 | 0.017 | 0.4652 | 0.3078 | 0.2808 | 0.007 |

### Checkpoint: 15

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.391 | 3.122 | 4.15 | -2.15 | 0.59 | 0.5776 | 0.047 | 0.4585 | 0.2779 | 0.2755 | 0.030 |
| team_share_ridge | 2.981 | 2.706 | 3.77 | -0.90 | 0.77 | 0.5582 | 0.014 | 0.4380 | 0.2642 | 0.2587 | 0.004 |
| team_share_oppadj | 2.964 | 2.669 | 3.72 | -0.95 | 0.78 | 0.5576 | 0.015 | 0.4371 | 0.2633 | 0.2582 | 0.004 |

### Checkpoint: 30

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 3.310 | 2.856 | 3.77 | -2.18 | 0.59 | 0.5883 | 0.050 | 0.4079 | 0.2164 | 0.2410 | 0.025 |
| team_share_ridge | 2.868 | 2.425 | 3.37 | -0.83 | 0.76 | 0.5705 | 0.018 | 0.3903 | 0.2055 | 0.2267 | 0.002 |
| team_share_oppadj | 2.848 | 2.384 | 3.31 | -0.87 | 0.76 | 0.5698 | 0.019 | 0.3893 | 0.2042 | 0.2263 | 0.002 |

### Checkpoint: 45

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.987 | 2.270 | 3.02 | -1.63 | 0.62 | 0.5731 | 0.055 | 0.3188 | 0.1417 | 0.2033 | 0.021 |
| team_share_ridge | 2.672 | 1.998 | 2.78 | -0.64 | 0.76 | 0.5572 | 0.013 | 0.3040 | 0.1351 | 0.1912 | 0.003 |
| team_share_oppadj | 2.649 | 1.962 | 2.73 | -0.67 | 0.76 | 0.5564 | 0.015 | 0.3028 | 0.1346 | 0.1909 | 0.004 |

### Checkpoint: 60

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.717 | 1.815 | 2.41 | -1.39 | 0.65 | 0.5221 | 0.048 | 0.2303 | 0.0804 | 0.1561 | 0.014 |
| team_share_ridge | 2.439 | 1.599 | 2.23 | -0.51 | 0.77 | 0.5073 | 0.015 | 0.2222 | 0.0772 | 0.1469 | 0.004 |
| team_share_oppadj | 2.414 | 1.565 | 2.19 | -0.52 | 0.77 | 0.5066 | 0.018 | 0.2213 | 0.0771 | 0.1465 | 0.004 |

### Checkpoint: 75

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 2.423 | 1.376 | 1.81 | -1.19 | 0.63 | 0.4532 | 0.040 | 0.1609 | 0.0417 | 0.1230 | 0.009 |
| team_share_ridge | 2.088 | 1.147 | 1.62 | -0.30 | 0.76 | 0.4388 | 0.011 | 0.1502 | 0.0373 | 0.1165 | 0.004 |
| team_share_oppadj | 2.068 | 1.128 | 1.58 | -0.29 | 0.76 | 0.4379 | 0.011 | 0.1491 | 0.0370 | 0.1161 | 0.004 |
