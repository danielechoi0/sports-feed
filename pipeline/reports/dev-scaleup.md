# Backtest: dev split

2086 matches in 7 competition(s), 43 excluded by the data check; history: all. Lower is better except 80% cover (ideal 0.80).

Paired bootstrap over matches, team_share_pooled minus each model (summed per match over checkpoints; negative = team_share_pooled better):

**all competitions**

- vs       league_avg: team NLL -3.091 [-3.440, -2.760] better; P(1+) logloss -5.640 [-5.932, -5.358] better; P(goal) logloss -1.117 [-1.233, -1.001] better
- vs         team_avg: team NLL -2.621 [-2.921, -2.337] better; P(1+) logloss -3.934 [-4.194, -3.674] better; P(goal) logloss -1.056 [-1.175, -0.936] better
- vs          current: team NLL -2.577 [-2.851, -2.308] better; P(1+) logloss -2.129 [-2.352, -1.924] better; P(goal) logloss -1.518 [-1.670, -1.367] better
- vs team_share_ridge: team NLL -0.017 [-0.044, +0.011] no clear difference; P(1+) logloss -0.013 [-0.042, +0.015] no clear difference; P(goal) logloss -0.005 [-0.020, +0.009] no clear difference

**Premier League**

- vs       league_avg: team NLL -2.611 [-3.397, -1.868] better; P(1+) logloss -4.501 [-5.162, -3.816] better; P(goal) logloss -0.808 [-1.062, -0.570] better
- vs         team_avg: team NLL -2.245 [-2.912, -1.599] better; P(1+) logloss -3.092 [-3.664, -2.505] better; P(goal) logloss -0.969 [-1.242, -0.687] better
- vs          current: team NLL -2.521 [-3.134, -1.910] better; P(1+) logloss -1.642 [-2.102, -1.190] better; P(goal) logloss -1.499 [-1.853, -1.139] better
- vs team_share_ridge: team NLL -0.057 [-0.101, -0.018] better; P(1+) logloss -0.005 [-0.067, +0.054] no clear difference; P(goal) logloss +0.011 [-0.015, +0.038] no clear difference

**LaLiga**

- vs       league_avg: team NLL -3.481 [-4.309, -2.735] better; P(1+) logloss -6.302 [-6.955, -5.623] better; P(goal) logloss -1.329 [-1.599, -1.049] better
- vs         team_avg: team NLL -3.030 [-3.807, -2.308] better; P(1+) logloss -4.198 [-4.816, -3.599] better; P(goal) logloss -0.847 [-1.091, -0.592] better
- vs          current: team NLL -2.792 [-3.557, -2.079] better; P(1+) logloss -2.060 [-2.536, -1.606] better; P(goal) logloss -1.003 [-1.319, -0.678] better
- vs team_share_ridge: team NLL +0.058 [+0.010, +0.104] worse; P(1+) logloss +0.034 [-0.020, +0.090] no clear difference; P(goal) logloss -0.010 [-0.044, +0.022] no clear difference

**Bundesliga**

- vs       league_avg: team NLL -2.294 [-3.126, -1.541] better; P(1+) logloss -5.837 [-6.644, -5.092] better; P(goal) logloss -1.464 [-1.745, -1.177] better
- vs         team_avg: team NLL -1.788 [-2.590, -1.076] better; P(1+) logloss -3.873 [-4.598, -3.193] better; P(goal) logloss -0.937 [-1.315, -0.580] better
- vs          current: team NLL -2.931 [-3.723, -2.192] better; P(1+) logloss -2.733 [-3.444, -2.061] better; P(goal) logloss -1.798 [-2.221, -1.368] better
- vs team_share_ridge: team NLL -0.015 [-0.064, +0.028] no clear difference; P(1+) logloss -0.046 [-0.115, +0.034] no clear difference; P(goal) logloss -0.055 [-0.099, -0.012] better

**Serie A**

- vs       league_avg: team NLL -2.842 [-3.679, -2.103] better; P(1+) logloss -5.716 [-6.393, -5.056] better; P(goal) logloss -0.790 [-1.014, -0.554] better
- vs         team_avg: team NLL -2.387 [-3.089, -1.725] better; P(1+) logloss -3.721 [-4.325, -3.115] better; P(goal) logloss -1.048 [-1.317, -0.786] better
- vs          current: team NLL -2.283 [-2.898, -1.709] better; P(1+) logloss -2.354 [-2.842, -1.892] better; P(goal) logloss -1.674 [-2.030, -1.338] better
- vs team_share_ridge: team NLL -0.015 [-0.047, +0.016] no clear difference; P(1+) logloss -0.033 [-0.060, -0.006] better; P(goal) logloss +0.015 [-0.003, +0.033] no clear difference

**Ligue 1**

- vs       league_avg: team NLL -3.591 [-4.628, -2.594] better; P(1+) logloss -5.384 [-6.112, -4.646] better; P(goal) logloss -1.198 [-1.463, -0.937] better
- vs         team_avg: team NLL -3.055 [-3.908, -2.266] better; P(1+) logloss -4.198 [-4.868, -3.517] better; P(goal) logloss -1.288 [-1.614, -0.960] better
- vs          current: team NLL -2.560 [-3.359, -1.822] better; P(1+) logloss -2.428 [-3.127, -1.743] better; P(goal) logloss -1.779 [-2.204, -1.375] better
- vs team_share_ridge: team NLL -0.057 [-0.150, +0.029] no clear difference; P(1+) logloss -0.040 [-0.099, +0.018] no clear difference; P(goal) logloss -0.025 [-0.054, +0.004] no clear difference

**Champions League**

- vs       league_avg: team NLL -3.997 [-5.217, -2.821] better; P(1+) logloss -6.105 [-7.164, -5.007] better; P(goal) logloss -1.463 [-1.898, -1.003] better
- vs         team_avg: team NLL -3.251 [-4.344, -2.202] better; P(1+) logloss -4.583 [-5.593, -3.575] better; P(goal) logloss -1.440 [-1.912, -0.942] better
- vs          current: team NLL -2.944 [-3.942, -2.068] better; P(1+) logloss -1.388 [-2.132, -0.737] better; P(goal) logloss -1.811 [-2.431, -1.241] better
- vs team_share_ridge: team NLL +0.081 [-0.060, +0.236] no clear difference; P(1+) logloss +0.071 [-0.029, +0.168] no clear difference; P(goal) logloss +0.028 [-0.029, +0.084] no clear difference

**Europa League**

- vs       league_avg: team NLL -3.322 [-4.318, -2.355] better; P(1+) logloss -6.065 [-6.971, -5.119] better; P(goal) logloss -0.912 [-1.246, -0.526] better
- vs         team_avg: team NLL -3.020 [-3.970, -2.170] better; P(1+) logloss -4.536 [-5.276, -3.794] better; P(goal) logloss -1.098 [-1.488, -0.712] better
- vs          current: team NLL -1.924 [-2.740, -1.131] better; P(1+) logloss -2.096 [-2.646, -1.512] better; P(goal) logloss -1.133 [-1.615, -0.630] better
- vs team_share_ridge: team NLL -0.133 [-0.298, +0.030] no clear difference; P(1+) logloss -0.073 [-0.260, +0.092] no clear difference; P(goal) logloss +0.011 [-0.070, +0.095] no clear difference

## By competition (all checkpoints)

### Premier League (373 matches, 7 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.723 | 2.037 | 2.83 | -0.44 | 0.68 | 0.5561 | 0.059 | 0.3291 | 0.1615 | 0.2029 | 0.011 |
| team_avg | 2.693 | 1.996 | 2.76 | -0.37 | 0.68 | 0.5454 | 0.056 | 0.3240 | 0.1587 | 0.2041 | 0.013 |
| current | 2.716 | 1.995 | 2.73 | -1.16 | 0.66 | 0.5344 | 0.034 | 0.3174 | 0.1556 | 0.2081 | 0.018 |
| team_share_ridge | 2.510 | 1.782 | 2.52 | -0.21 | 0.81 | 0.5220 | 0.006 | 0.3067 | 0.1492 | 0.1967 | 0.002 |
| team_share_pooled | 2.506 | 1.774 | 2.51 | -0.21 | 0.81 | 0.5219 | 0.010 | 0.3070 | 0.1491 | 0.1968 | 0.001 |

### LaLiga (377 matches, 3 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.797 | 2.173 | 3.02 | -0.28 | 0.65 | 0.5582 | 0.075 | 0.3186 | 0.1539 | 0.1921 | 0.012 |
| team_avg | 2.760 | 2.103 | 2.93 | -0.28 | 0.66 | 0.5422 | 0.071 | 0.3074 | 0.1476 | 0.1884 | 0.013 |
| current | 2.740 | 2.049 | 2.80 | -1.09 | 0.66 | 0.5260 | 0.042 | 0.2967 | 0.1413 | 0.1896 | 0.013 |
| team_share_ridge | 2.502 | 1.810 | 2.58 | +0.02 | 0.80 | 0.5101 | 0.011 | 0.2857 | 0.1355 | 0.1821 | 0.001 |
| team_share_pooled | 2.507 | 1.817 | 2.60 | +0.02 | 0.80 | 0.5104 | 0.012 | 0.2858 | 0.1354 | 0.1820 | 0.002 |

### Bundesliga (298 matches, 8 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.739 | 2.079 | 2.90 | -0.28 | 0.68 | 0.5723 | 0.075 | 0.3395 | 0.1714 | 0.2198 | 0.018 |
| team_avg | 2.696 | 2.007 | 2.81 | -0.31 | 0.69 | 0.5574 | 0.071 | 0.3282 | 0.1635 | 0.2158 | 0.018 |
| current | 2.792 | 2.109 | 2.88 | -1.03 | 0.66 | 0.5487 | 0.044 | 0.3225 | 0.1629 | 0.2223 | 0.026 |
| team_share_ridge | 2.549 | 1.859 | 2.65 | -0.14 | 0.79 | 0.5283 | 0.007 | 0.3085 | 0.1540 | 0.2091 | 0.005 |
| team_share_pooled | 2.548 | 1.855 | 2.64 | -0.14 | 0.80 | 0.5280 | 0.007 | 0.3079 | 0.1535 | 0.2087 | 0.002 |

### Serie A (367 matches, 13 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.720 | 2.048 | 2.84 | -0.14 | 0.68 | 0.5594 | 0.079 | 0.3110 | 0.1472 | 0.1836 | 0.011 |
| team_avg | 2.682 | 2.000 | 2.78 | -0.09 | 0.68 | 0.5443 | 0.069 | 0.2997 | 0.1414 | 0.1855 | 0.012 |
| current | 2.674 | 1.979 | 2.72 | -0.54 | 0.68 | 0.5339 | 0.048 | 0.2952 | 0.1387 | 0.1903 | 0.018 |
| team_share_ridge | 2.485 | 1.779 | 2.54 | -0.09 | 0.79 | 0.5163 | 0.010 | 0.2795 | 0.1298 | 0.1775 | 0.002 |
| team_share_pooled | 2.483 | 1.776 | 2.53 | -0.10 | 0.80 | 0.5161 | 0.011 | 0.2793 | 0.1297 | 0.1776 | 0.002 |

### Ligue 1 (298 matches, 7 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.817 | 2.191 | 3.03 | -0.27 | 0.65 | 0.5591 | 0.075 | 0.3163 | 0.1548 | 0.1919 | 0.017 |
| team_avg | 2.772 | 2.134 | 2.97 | -0.23 | 0.65 | 0.5501 | 0.072 | 0.3097 | 0.1533 | 0.1926 | 0.018 |
| current | 2.731 | 2.032 | 2.77 | -0.95 | 0.67 | 0.5367 | 0.044 | 0.3031 | 0.1494 | 0.1963 | 0.019 |
| team_share_ridge | 2.522 | 1.846 | 2.63 | -0.12 | 0.78 | 0.5185 | 0.011 | 0.2897 | 0.1414 | 0.1830 | 0.005 |
| team_share_pooled | 2.517 | 1.840 | 2.62 | -0.11 | 0.79 | 0.5182 | 0.010 | 0.2895 | 0.1414 | 0.1828 | 0.004 |

### Champions League (187 matches, 2 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.928 | 2.410 | 3.33 | -0.20 | 0.60 | 0.5514 | 0.073 | 0.3293 | 0.1786 | 0.2234 | 0.016 |
| team_avg | 2.866 | 2.321 | 3.24 | +0.17 | 0.62 | 0.5398 | 0.075 | 0.3172 | 0.1714 | 0.2232 | 0.020 |
| current | 2.840 | 2.220 | 3.02 | -1.38 | 0.62 | 0.5155 | 0.029 | 0.3020 | 0.1638 | 0.2261 | 0.019 |
| team_share_ridge | 2.588 | 1.974 | 2.81 | -0.29 | 0.79 | 0.5044 | 0.011 | 0.2941 | 0.1589 | 0.2121 | 0.006 |
| team_share_pooled | 2.595 | 1.988 | 2.84 | -0.29 | 0.77 | 0.5050 | 0.009 | 0.2952 | 0.1601 | 0.2123 | 0.005 |

### Europa League (186 matches, 3 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.807 | 2.198 | 3.07 | +0.12 | 0.63 | 0.5564 | 0.088 | 0.3256 | 0.1603 | 0.1887 | 0.014 |
| team_avg | 2.782 | 2.175 | 3.05 | +0.13 | 0.62 | 0.5448 | 0.079 | 0.3192 | 0.1572 | 0.1901 | 0.015 |
| current | 2.691 | 2.012 | 2.77 | -0.71 | 0.66 | 0.5263 | 0.043 | 0.3089 | 0.1494 | 0.1904 | 0.018 |
| team_share_ridge | 2.541 | 1.892 | 2.71 | +0.27 | 0.79 | 0.5109 | 0.014 | 0.2994 | 0.1432 | 0.1817 | 0.005 |
| team_share_pooled | 2.530 | 1.873 | 2.69 | +0.17 | 0.78 | 0.5103 | 0.011 | 0.2985 | 0.1431 | 0.1818 | 0.004 |

## All competitions, by checkpoint

### Checkpoint: all checkpoints

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.778 | 2.139 | 2.97 | -0.24 | 0.66 | 0.5594 | 0.074 | 0.3234 | 0.1595 | 0.1990 | 0.014 |
| team_avg | 2.738 | 2.082 | 2.90 | -0.18 | 0.66 | 0.5465 | 0.069 | 0.3142 | 0.1546 | 0.1985 | 0.015 |
| current | 2.735 | 2.045 | 2.80 | -0.97 | 0.66 | 0.5328 | 0.041 | 0.3063 | 0.1504 | 0.2020 | 0.018 |
| team_share_ridge | 2.521 | 1.834 | 2.61 | -0.09 | 0.79 | 0.5167 | 0.007 | 0.2942 | 0.1432 | 0.1905 | 0.001 |
| team_share_pooled | 2.520 | 1.831 | 2.61 | -0.10 | 0.80 | 0.5166 | 0.007 | 0.2941 | 0.1432 | 0.1905 | 0.001 |

### Checkpoint: 0

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.230 | 2.986 | 4.12 | -0.09 | 0.61 | 0.5969 | 0.083 | 0.4782 | 0.2981 | 0.2802 | 0.022 |
| team_avg | 3.145 | 2.850 | 3.96 | +0.00 | 0.63 | 0.5760 | 0.074 | 0.4594 | 0.2869 | 0.2795 | 0.022 |
| current | 3.113 | 2.770 | 3.80 | -0.80 | 0.64 | 0.5621 | 0.047 | 0.4479 | 0.2796 | 0.2850 | 0.031 |
| team_share_ridge | 2.892 | 2.509 | 3.56 | -0.07 | 0.81 | 0.5431 | 0.008 | 0.4286 | 0.2651 | 0.2665 | 0.004 |
| team_share_pooled | 2.890 | 2.506 | 3.56 | -0.08 | 0.81 | 0.5429 | 0.009 | 0.4285 | 0.2650 | 0.2663 | 0.004 |

### Checkpoint: 15

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.130 | 2.728 | 3.75 | -0.40 | 0.63 | 0.6059 | 0.079 | 0.4385 | 0.2478 | 0.2555 | 0.018 |
| team_avg | 3.061 | 2.624 | 3.63 | -0.32 | 0.64 | 0.5869 | 0.072 | 0.4242 | 0.2397 | 0.2549 | 0.019 |
| current | 3.049 | 2.585 | 3.54 | -1.10 | 0.64 | 0.5741 | 0.044 | 0.4150 | 0.2338 | 0.2602 | 0.026 |
| team_share_ridge | 2.812 | 2.321 | 3.29 | -0.08 | 0.80 | 0.5561 | 0.009 | 0.3982 | 0.2230 | 0.2443 | 0.003 |
| team_share_pooled | 2.809 | 2.316 | 3.29 | -0.09 | 0.80 | 0.5559 | 0.008 | 0.3980 | 0.2229 | 0.2442 | 0.003 |

### Checkpoint: 30

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.992 | 2.425 | 3.33 | -0.55 | 0.64 | 0.6061 | 0.078 | 0.3824 | 0.1894 | 0.2263 | 0.014 |
| team_avg | 2.942 | 2.357 | 3.25 | -0.49 | 0.65 | 0.5904 | 0.074 | 0.3723 | 0.1843 | 0.2255 | 0.016 |
| current | 2.932 | 2.317 | 3.15 | -1.26 | 0.66 | 0.5771 | 0.045 | 0.3630 | 0.1793 | 0.2303 | 0.022 |
| team_share_ridge | 2.685 | 2.051 | 2.92 | -0.12 | 0.80 | 0.5594 | 0.007 | 0.3493 | 0.1709 | 0.2170 | 0.001 |
| team_share_pooled | 2.683 | 2.047 | 2.91 | -0.13 | 0.80 | 0.5592 | 0.006 | 0.3492 | 0.1709 | 0.2169 | 0.000 |

### Checkpoint: 45

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.730 | 1.968 | 2.75 | -0.19 | 0.67 | 0.5854 | 0.086 | 0.2974 | 0.1212 | 0.1843 | 0.014 |
| team_avg | 2.704 | 1.937 | 2.71 | -0.14 | 0.67 | 0.5740 | 0.084 | 0.2920 | 0.1183 | 0.1840 | 0.016 |
| current | 2.668 | 1.874 | 2.58 | -0.90 | 0.68 | 0.5566 | 0.048 | 0.2813 | 0.1136 | 0.1870 | 0.017 |
| team_share_ridge | 2.498 | 1.705 | 2.43 | -0.07 | 0.79 | 0.5401 | 0.007 | 0.2710 | 0.1087 | 0.1767 | 0.002 |
| team_share_pooled | 2.496 | 1.703 | 2.43 | -0.08 | 0.80 | 0.5400 | 0.007 | 0.2709 | 0.1089 | 0.1768 | 0.002 |

### Checkpoint: 60

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.484 | 1.591 | 2.24 | -0.12 | 0.68 | 0.5268 | 0.086 | 0.2107 | 0.0684 | 0.1399 | 0.012 |
| team_avg | 2.477 | 1.584 | 2.23 | -0.09 | 0.68 | 0.5209 | 0.088 | 0.2072 | 0.0670 | 0.1398 | 0.014 |
| current | 2.452 | 1.539 | 2.11 | -0.87 | 0.68 | 0.4994 | 0.046 | 0.1984 | 0.0638 | 0.1406 | 0.009 |
| team_share_ridge | 2.279 | 1.385 | 1.99 | -0.11 | 0.79 | 0.4849 | 0.015 | 0.1925 | 0.0618 | 0.1342 | 0.000 |
| team_share_pooled | 2.279 | 1.385 | 1.99 | -0.11 | 0.79 | 0.4850 | 0.016 | 0.1927 | 0.0619 | 0.1343 | 0.001 |

### Checkpoint: 75

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.099 | 1.138 | 1.63 | -0.08 | 0.71 | 0.4348 | 0.031 | 0.1317 | 0.0310 | 0.1069 | 0.003 |
| team_avg | 2.101 | 1.141 | 1.63 | -0.06 | 0.71 | 0.4301 | 0.036 | 0.1290 | 0.0302 | 0.1067 | 0.004 |
| current | 2.193 | 1.186 | 1.59 | -0.88 | 0.67 | 0.4267 | 0.027 | 0.1310 | 0.0312 | 0.1084 | 0.007 |
| team_share_ridge | 1.962 | 1.030 | 1.49 | -0.09 | 0.78 | 0.4162 | 0.004 | 0.1243 | 0.0288 | 0.1039 | 0.001 |
| team_share_pooled | 1.962 | 1.030 | 1.49 | -0.09 | 0.78 | 0.4161 | 0.004 | 0.1242 | 0.0288 | 0.1038 | 0.001 |
