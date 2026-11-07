# Backtest: test split

91 matches, 0 excluded by the data check. Lower is better except 80% cover (ideal 0.80).

Paired bootstrap over matches, team_share_ridge minus each model (summed per match over checkpoints; negative = team_share_ridge better):

- vs     league_avg: team NLL -2.932 [-5.117, -1.110] better; P(1+) logloss -4.896 [-6.255, -3.444] better
- vs       team_avg: team NLL -2.730 [-4.648, -1.075] better; P(1+) logloss -3.757 [-4.943, -2.473] better
- vs        current: team NLL -4.015 [-5.840, -2.383] better; P(1+) logloss -2.090 [-2.893, -1.269] better

### Checkpoint: all checkpoints

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.826 | 2.193 | 3.00 | -0.51 | 0.68 | 0.5525 | 0.062 | 0.3557 | 0.1873 | 0.1983 | 0.013 |
| team_avg | 2.809 | 2.186 | 3.00 | -0.44 | 0.68 | 0.5438 | 0.056 | 0.3487 | 0.1841 | 0.2036 | 0.013 |
| current | 2.916 | 2.255 | 2.99 | -1.71 | 0.66 | 0.5312 | 0.030 | 0.3454 | 0.1822 | 0.2039 | 0.020 |
| team_share_ridge | 2.582 | 1.941 | 2.72 | -0.52 | 0.81 | 0.5153 | 0.015 | 0.3281 | 0.1727 | 0.1899 | 0.007 |

### Checkpoint: 0

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.204 | 2.892 | 3.90 | -0.49 | 0.68 | 0.5681 | 0.063 | 0.5028 | 0.3419 | 0.2790 | 0.025 |
| team_avg | 3.190 | 2.934 | 4.00 | -0.39 | 0.66 | 0.5555 | 0.059 | 0.4894 | 0.3356 | 0.2850 | 0.020 |
| current | 3.242 | 2.947 | 3.96 | -1.96 | 0.66 | 0.5431 | 0.039 | 0.4821 | 0.3279 | 0.2885 | 0.031 |
| team_share_ridge | 2.959 | 2.660 | 3.66 | -0.75 | 0.84 | 0.5258 | 0.025 | 0.4601 | 0.3172 | 0.2658 | 0.017 |

### Checkpoint: 15

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.174 | 2.755 | 3.70 | -0.79 | 0.67 | 0.5800 | 0.062 | 0.4704 | 0.2901 | 0.2492 | 0.021 |
| team_avg | 3.141 | 2.731 | 3.67 | -0.71 | 0.67 | 0.5719 | 0.062 | 0.4600 | 0.2840 | 0.2553 | 0.019 |
| current | 3.272 | 2.883 | 3.81 | -2.13 | 0.63 | 0.5644 | 0.044 | 0.4590 | 0.2819 | 0.2559 | 0.026 |
| team_share_ridge | 2.886 | 2.462 | 3.43 | -0.67 | 0.82 | 0.5447 | 0.026 | 0.4367 | 0.2700 | 0.2378 | 0.016 |

### Checkpoint: 30

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.087 | 2.569 | 3.47 | -0.85 | 0.66 | 0.5961 | 0.061 | 0.4214 | 0.2222 | 0.2277 | 0.018 |
| team_avg | 3.047 | 2.521 | 3.39 | -0.78 | 0.67 | 0.5859 | 0.067 | 0.4077 | 0.2192 | 0.2328 | 0.014 |
| current | 3.189 | 2.651 | 3.51 | -2.09 | 0.65 | 0.5778 | 0.052 | 0.4041 | 0.2168 | 0.2335 | 0.027 |
| team_share_ridge | 2.756 | 2.212 | 3.13 | -0.55 | 0.79 | 0.5587 | 0.017 | 0.3851 | 0.2016 | 0.2176 | 0.009 |

### Checkpoint: 45

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.817 | 2.064 | 2.84 | -0.47 | 0.69 | 0.5848 | 0.076 | 0.3363 | 0.1525 | 0.1945 | 0.013 |
| team_avg | 2.805 | 2.056 | 2.79 | -0.41 | 0.69 | 0.5742 | 0.076 | 0.3321 | 0.1484 | 0.1991 | 0.016 |
| current | 2.856 | 2.080 | 2.74 | -1.61 | 0.69 | 0.5562 | 0.039 | 0.3248 | 0.1445 | 0.1986 | 0.022 |
| team_share_ridge | 2.547 | 1.793 | 2.50 | -0.59 | 0.80 | 0.5398 | 0.014 | 0.3085 | 0.1348 | 0.1872 | 0.004 |

### Checkpoint: 60

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.543 | 1.704 | 2.43 | -0.32 | 0.68 | 0.5417 | 0.074 | 0.2491 | 0.0835 | 0.1393 | 0.012 |
| team_avg | 2.537 | 1.697 | 2.42 | -0.28 | 0.65 | 0.5370 | 0.079 | 0.2452 | 0.0831 | 0.1439 | 0.013 |
| current | 2.636 | 1.706 | 2.25 | -1.36 | 0.70 | 0.5157 | 0.028 | 0.2394 | 0.0857 | 0.1421 | 0.013 |
| team_share_ridge | 2.343 | 1.472 | 2.10 | -0.38 | 0.81 | 0.5011 | 0.019 | 0.2279 | 0.0811 | 0.1324 | 0.004 |

### Checkpoint: 75

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.132 | 1.173 | 1.68 | -0.12 | 0.72 | 0.4437 | 0.037 | 0.1525 | 0.0323 | 0.0992 | 0.005 |
| team_avg | 2.137 | 1.177 | 1.71 | -0.09 | 0.70 | 0.4379 | 0.040 | 0.1565 | 0.0328 | 0.1046 | 0.006 |
| current | 2.305 | 1.260 | 1.65 | -1.11 | 0.64 | 0.4293 | 0.031 | 0.1619 | 0.0355 | 0.1042 | 0.006 |
| team_share_ridge | 2.001 | 1.046 | 1.50 | -0.19 | 0.79 | 0.4213 | 0.018 | 0.1490 | 0.0302 | 0.0978 | 0.003 |
