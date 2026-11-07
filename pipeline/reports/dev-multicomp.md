# Backtest: dev split

2086 matches in 7 competition(s), 43 excluded by the data check; history: all. Lower is better except 80% cover (ideal 0.80).

Paired bootstrap over matches, team_share_oppadj minus each model (summed per match over checkpoints; negative = team_share_oppadj better):

**all competitions**

- vs       league_avg: team NLL -3.211 [-3.571, -2.876] better; P(1+) logloss -5.742 [-6.036, -5.454] better; P(goal) logloss -1.143 [-1.258, -1.029] better
- vs         team_avg: team NLL -2.741 [-3.052, -2.452] better; P(1+) logloss -4.036 [-4.295, -3.764] better; P(goal) logloss -1.082 [-1.202, -0.963] better
- vs          current: team NLL -2.697 [-2.981, -2.422] better; P(1+) logloss -2.230 [-2.453, -2.023] better; P(goal) logloss -1.545 [-1.696, -1.395] better
- vs team_share_ridge: team NLL -0.137 [-0.184, -0.091] better; P(1+) logloss -0.114 [-0.156, -0.073] better; P(goal) logloss -0.032 [-0.050, -0.013] better
- vs team_share_pooled: team NLL -0.120 [-0.160, -0.079] better; P(1+) logloss -0.101 [-0.135, -0.065] better; P(goal) logloss -0.027 [-0.040, -0.013] better
- vs team_share_oppadj:per: team NLL -0.019 [-0.045, +0.008] no clear difference; P(1+) logloss -0.016 [-0.043, +0.011] no clear difference; P(goal) logloss -0.005 [-0.019, +0.009] no clear difference

**Premier League**

- vs       league_avg: team NLL -2.654 [-3.495, -1.846] better; P(1+) logloss -4.573 [-5.225, -3.875] better; P(goal) logloss -0.828 [-1.089, -0.586] better
- vs         team_avg: team NLL -2.288 [-2.984, -1.608] better; P(1+) logloss -3.164 [-3.734, -2.578] better; P(goal) logloss -0.989 [-1.268, -0.712] better
- vs          current: team NLL -2.564 [-3.217, -1.921] better; P(1+) logloss -1.713 [-2.198, -1.247] better; P(goal) logloss -1.518 [-1.878, -1.159] better
- vs team_share_ridge: team NLL -0.100 [-0.203, -0.005] better; P(1+) logloss -0.076 [-0.172, +0.013] no clear difference; P(goal) logloss -0.009 [-0.043, +0.024] no clear difference
- vs team_share_pooled: team NLL -0.043 [-0.138, +0.047] no clear difference; P(1+) logloss -0.072 [-0.150, +0.008] no clear difference; P(goal) logloss -0.020 [-0.053, +0.012] no clear difference
- vs team_share_oppadj:per: team NLL -0.070 [-0.106, -0.035] better; P(1+) logloss -0.039 [-0.097, +0.018] no clear difference; P(goal) logloss +0.002 [-0.025, +0.029] no clear difference

**LaLiga**

- vs       league_avg: team NLL -3.545 [-4.410, -2.787] better; P(1+) logloss -6.412 [-7.110, -5.701] better; P(goal) logloss -1.352 [-1.625, -1.064] better
- vs         team_avg: team NLL -3.093 [-3.881, -2.358] better; P(1+) logloss -4.308 [-4.971, -3.682] better; P(goal) logloss -0.869 [-1.123, -0.600] better
- vs          current: team NLL -2.856 [-3.622, -2.154] better; P(1+) logloss -2.170 [-2.650, -1.706] better; P(goal) logloss -1.025 [-1.349, -0.702] better
- vs team_share_ridge: team NLL -0.006 [-0.106, +0.101] no clear difference; P(1+) logloss -0.076 [-0.165, +0.014] no clear difference; P(goal) logloss -0.032 [-0.075, +0.013] no clear difference
- vs team_share_pooled: team NLL -0.064 [-0.156, +0.032] no clear difference; P(1+) logloss -0.110 [-0.196, -0.026] better; P(goal) logloss -0.023 [-0.052, +0.008] no clear difference
- vs team_share_oppadj:per: team NLL +0.056 [+0.010, +0.100] worse; P(1+) logloss +0.016 [-0.035, +0.070] no clear difference; P(goal) logloss -0.010 [-0.043, +0.023] no clear difference

**Bundesliga**

- vs       league_avg: team NLL -2.401 [-3.270, -1.610] better; P(1+) logloss -5.898 [-6.718, -5.155] better; P(goal) logloss -1.482 [-1.753, -1.196] better
- vs         team_avg: team NLL -1.895 [-2.697, -1.147] better; P(1+) logloss -3.933 [-4.657, -3.261] better; P(goal) logloss -0.954 [-1.329, -0.600] better
- vs          current: team NLL -3.038 [-3.856, -2.271] better; P(1+) logloss -2.793 [-3.504, -2.140] better; P(goal) logloss -1.815 [-2.231, -1.387] better
- vs team_share_ridge: team NLL -0.123 [-0.237, -0.012] better; P(1+) logloss -0.106 [-0.224, +0.009] no clear difference; P(goal) logloss -0.072 [-0.135, -0.011] better
- vs team_share_pooled: team NLL -0.107 [-0.212, -0.007] better; P(1+) logloss -0.060 [-0.152, +0.022] no clear difference; P(goal) logloss -0.017 [-0.050, +0.016] no clear difference
- vs team_share_oppadj:per: team NLL -0.022 [-0.075, +0.027] no clear difference; P(1+) logloss -0.032 [-0.102, +0.048] no clear difference; P(goal) logloss -0.042 [-0.085, -0.000] better

**Serie A**

- vs       league_avg: team NLL -2.972 [-3.828, -2.216] better; P(1+) logloss -5.822 [-6.514, -5.156] better; P(goal) logloss -0.804 [-1.030, -0.564] better
- vs         team_avg: team NLL -2.516 [-3.195, -1.867] better; P(1+) logloss -3.827 [-4.447, -3.205] better; P(goal) logloss -1.062 [-1.339, -0.797] better
- vs          current: team NLL -2.413 [-3.050, -1.830] better; P(1+) logloss -2.460 [-2.973, -1.984] better; P(goal) logloss -1.688 [-2.055, -1.355] better
- vs team_share_ridge: team NLL -0.144 [-0.245, -0.043] better; P(1+) logloss -0.140 [-0.230, -0.052] better; P(goal) logloss +0.001 [-0.032, +0.033] no clear difference
- vs team_share_pooled: team NLL -0.129 [-0.219, -0.041] better; P(1+) logloss -0.107 [-0.187, -0.025] better; P(goal) logloss -0.014 [-0.042, +0.015] no clear difference
- vs team_share_oppadj:per: team NLL -0.017 [-0.055, +0.017] no clear difference; P(1+) logloss -0.036 [-0.067, -0.006] better; P(goal) logloss +0.013 [-0.005, +0.031] no clear difference

**Ligue 1**

- vs       league_avg: team NLL -3.720 [-4.750, -2.696] better; P(1+) logloss -5.434 [-6.170, -4.707] better; P(goal) logloss -1.217 [-1.483, -0.952] better
- vs         team_avg: team NLL -3.184 [-4.064, -2.377] better; P(1+) logloss -4.248 [-4.920, -3.574] better; P(goal) logloss -1.307 [-1.627, -0.984] better
- vs          current: team NLL -2.689 [-3.517, -1.930] better; P(1+) logloss -2.479 [-3.185, -1.807] better; P(goal) logloss -1.797 [-2.230, -1.398] better
- vs team_share_ridge: team NLL -0.186 [-0.343, -0.037] better; P(1+) logloss -0.090 [-0.193, +0.004] no clear difference; P(goal) logloss -0.044 [-0.081, -0.004] better
- vs team_share_pooled: team NLL -0.129 [-0.241, -0.030] better; P(1+) logloss -0.050 [-0.139, +0.035] no clear difference; P(goal) logloss -0.019 [-0.050, +0.012] no clear difference
- vs team_share_oppadj:per: team NLL -0.053 [-0.143, +0.032] no clear difference; P(1+) logloss -0.055 [-0.117, +0.007] no clear difference; P(goal) logloss -0.032 [-0.061, -0.003] better

**Champions League**

- vs       league_avg: team NLL -4.276 [-5.535, -3.050] better; P(1+) logloss -6.301 [-7.394, -5.177] better; P(goal) logloss -1.557 [-1.988, -1.113] better
- vs         team_avg: team NLL -3.529 [-4.638, -2.485] better; P(1+) logloss -4.780 [-5.798, -3.774] better; P(goal) logloss -1.533 [-2.006, -1.042] better
- vs          current: team NLL -3.222 [-4.263, -2.287] better; P(1+) logloss -1.584 [-2.382, -0.901] better; P(goal) logloss -1.905 [-2.537, -1.306] better
- vs team_share_ridge: team NLL -0.197 [-0.369, -0.018] better; P(1+) logloss -0.125 [-0.299, +0.036] no clear difference; P(goal) logloss -0.065 [-0.171, +0.029] no clear difference
- vs team_share_pooled: team NLL -0.278 [-0.438, -0.122] better; P(1+) logloss -0.196 [-0.348, -0.048] better; P(goal) logloss -0.093 [-0.166, -0.023] better
- vs team_share_oppadj:per: team NLL +0.062 [-0.084, +0.209] no clear difference; P(1+) logloss +0.085 [-0.026, +0.187] no clear difference; P(goal) logloss +0.040 [-0.022, +0.097] no clear difference

**Europa League**

- vs       league_avg: team NLL -3.537 [-4.546, -2.573] better; P(1+) logloss -6.250 [-7.142, -5.294] better; P(goal) logloss -0.945 [-1.271, -0.574] better
- vs         team_avg: team NLL -3.235 [-4.174, -2.365] better; P(1+) logloss -4.721 [-5.458, -3.966] better; P(goal) logloss -1.131 [-1.516, -0.748] better
- vs          current: team NLL -2.138 [-3.004, -1.288] better; P(1+) logloss -2.281 [-2.865, -1.692] better; P(goal) logloss -1.166 [-1.643, -0.670] better
- vs team_share_ridge: team NLL -0.347 [-0.551, -0.138] better; P(1+) logloss -0.257 [-0.464, -0.062] better; P(goal) logloss -0.022 [-0.102, +0.054] no clear difference
- vs team_share_pooled: team NLL -0.214 [-0.371, -0.070] better; P(1+) logloss -0.185 [-0.300, -0.069] better; P(goal) logloss -0.033 [-0.088, +0.022] no clear difference
- vs team_share_oppadj:per: team NLL -0.100 [-0.241, +0.044] no clear difference; P(1+) logloss -0.003 [-0.171, +0.153] no clear difference; P(goal) logloss +0.015 [-0.058, +0.092] no clear difference

## By competition (all checkpoints)

### Premier League (373 matches, 7 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.723 | 2.037 | 2.83 | -0.44 | 0.68 | 0.5561 | 0.059 | 0.3291 | 0.1615 | 0.2029 | 0.011 |
| team_avg | 2.693 | 1.996 | 2.76 | -0.37 | 0.68 | 0.5454 | 0.056 | 0.3240 | 0.1587 | 0.2041 | 0.013 |
| current | 2.716 | 1.995 | 2.73 | -1.16 | 0.66 | 0.5344 | 0.034 | 0.3174 | 0.1556 | 0.2081 | 0.018 |
| team_share_ridge | 2.510 | 1.782 | 2.52 | -0.21 | 0.81 | 0.5220 | 0.006 | 0.3067 | 0.1492 | 0.1967 | 0.002 |
| team_share_pooled | 2.506 | 1.774 | 2.51 | -0.21 | 0.81 | 0.5219 | 0.010 | 0.3070 | 0.1491 | 0.1968 | 0.001 |
| team_share_oppadj:per | 2.508 | 1.784 | 2.54 | -0.04 | 0.80 | 0.5217 | 0.006 | 0.3067 | 0.1493 | 0.1966 | 0.003 |
| team_share_oppadj | 2.502 | 1.773 | 2.53 | -0.05 | 0.81 | 0.5214 | 0.008 | 0.3066 | 0.1490 | 0.1966 | 0.001 |

### LaLiga (377 matches, 3 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.797 | 2.173 | 3.02 | -0.28 | 0.65 | 0.5582 | 0.075 | 0.3186 | 0.1539 | 0.1921 | 0.012 |
| team_avg | 2.760 | 2.103 | 2.93 | -0.28 | 0.66 | 0.5422 | 0.071 | 0.3074 | 0.1476 | 0.1884 | 0.013 |
| current | 2.740 | 2.049 | 2.80 | -1.09 | 0.66 | 0.5260 | 0.042 | 0.2967 | 0.1413 | 0.1896 | 0.013 |
| team_share_ridge | 2.502 | 1.810 | 2.58 | +0.02 | 0.80 | 0.5101 | 0.011 | 0.2857 | 0.1355 | 0.1821 | 0.001 |
| team_share_pooled | 2.507 | 1.817 | 2.60 | +0.02 | 0.80 | 0.5104 | 0.012 | 0.2858 | 0.1354 | 0.1820 | 0.002 |
| team_share_oppadj:per | 2.497 | 1.801 | 2.56 | -0.20 | 0.80 | 0.5094 | 0.009 | 0.2853 | 0.1353 | 0.1819 | 0.001 |
| team_share_oppadj | 2.502 | 1.807 | 2.57 | -0.19 | 0.80 | 0.5095 | 0.010 | 0.2854 | 0.1352 | 0.1818 | 0.002 |

### Bundesliga (298 matches, 8 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.739 | 2.079 | 2.90 | -0.28 | 0.68 | 0.5723 | 0.075 | 0.3395 | 0.1714 | 0.2198 | 0.018 |
| team_avg | 2.696 | 2.007 | 2.81 | -0.31 | 0.69 | 0.5574 | 0.071 | 0.3282 | 0.1635 | 0.2158 | 0.018 |
| current | 2.792 | 2.109 | 2.88 | -1.03 | 0.66 | 0.5487 | 0.044 | 0.3225 | 0.1629 | 0.2223 | 0.026 |
| team_share_ridge | 2.549 | 1.859 | 2.65 | -0.14 | 0.79 | 0.5283 | 0.007 | 0.3085 | 0.1540 | 0.2091 | 0.005 |
| team_share_pooled | 2.548 | 1.855 | 2.64 | -0.14 | 0.80 | 0.5280 | 0.007 | 0.3079 | 0.1535 | 0.2087 | 0.002 |
| team_share_oppadj:per | 2.540 | 1.844 | 2.64 | +0.06 | 0.79 | 0.5278 | 0.009 | 0.3080 | 0.1537 | 0.2089 | 0.004 |
| team_share_oppadj | 2.539 | 1.840 | 2.63 | +0.05 | 0.80 | 0.5275 | 0.011 | 0.3074 | 0.1532 | 0.2085 | 0.002 |

### Serie A (367 matches, 13 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.720 | 2.048 | 2.84 | -0.14 | 0.68 | 0.5594 | 0.079 | 0.3110 | 0.1472 | 0.1836 | 0.011 |
| team_avg | 2.682 | 2.000 | 2.78 | -0.09 | 0.68 | 0.5443 | 0.069 | 0.2997 | 0.1414 | 0.1855 | 0.012 |
| current | 2.674 | 1.979 | 2.72 | -0.54 | 0.68 | 0.5339 | 0.048 | 0.2952 | 0.1387 | 0.1903 | 0.018 |
| team_share_ridge | 2.485 | 1.779 | 2.54 | -0.09 | 0.79 | 0.5163 | 0.010 | 0.2795 | 0.1298 | 0.1775 | 0.002 |
| team_share_pooled | 2.483 | 1.776 | 2.53 | -0.10 | 0.80 | 0.5161 | 0.011 | 0.2793 | 0.1297 | 0.1776 | 0.002 |
| team_share_oppadj:per | 2.474 | 1.757 | 2.50 | -0.16 | 0.79 | 0.5155 | 0.010 | 0.2789 | 0.1295 | 0.1774 | 0.002 |
| team_share_oppadj | 2.473 | 1.754 | 2.49 | -0.16 | 0.80 | 0.5153 | 0.011 | 0.2787 | 0.1295 | 0.1775 | 0.003 |

### Ligue 1 (298 matches, 7 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.817 | 2.191 | 3.03 | -0.27 | 0.65 | 0.5591 | 0.075 | 0.3163 | 0.1548 | 0.1919 | 0.017 |
| team_avg | 2.772 | 2.134 | 2.97 | -0.23 | 0.65 | 0.5501 | 0.072 | 0.3097 | 0.1533 | 0.1926 | 0.018 |
| current | 2.731 | 2.032 | 2.77 | -0.95 | 0.67 | 0.5367 | 0.044 | 0.3031 | 0.1494 | 0.1963 | 0.019 |
| team_share_ridge | 2.522 | 1.846 | 2.63 | -0.12 | 0.78 | 0.5185 | 0.011 | 0.2897 | 0.1414 | 0.1830 | 0.005 |
| team_share_pooled | 2.517 | 1.840 | 2.62 | -0.11 | 0.79 | 0.5182 | 0.010 | 0.2895 | 0.1414 | 0.1828 | 0.004 |
| team_share_oppadj:per | 2.511 | 1.828 | 2.61 | -0.04 | 0.78 | 0.5182 | 0.012 | 0.2891 | 0.1412 | 0.1829 | 0.005 |
| team_share_oppadj | 2.507 | 1.822 | 2.60 | -0.03 | 0.80 | 0.5178 | 0.011 | 0.2889 | 0.1413 | 0.1827 | 0.004 |

### Champions League (187 matches, 2 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.928 | 2.410 | 3.33 | -0.20 | 0.60 | 0.5514 | 0.073 | 0.3293 | 0.1786 | 0.2234 | 0.016 |
| team_avg | 2.866 | 2.321 | 3.24 | +0.17 | 0.62 | 0.5398 | 0.075 | 0.3172 | 0.1714 | 0.2232 | 0.020 |
| current | 2.840 | 2.220 | 3.02 | -1.38 | 0.62 | 0.5155 | 0.029 | 0.3020 | 0.1638 | 0.2261 | 0.019 |
| team_share_ridge | 2.588 | 1.974 | 2.81 | -0.29 | 0.79 | 0.5044 | 0.011 | 0.2941 | 0.1589 | 0.2121 | 0.006 |
| team_share_pooled | 2.595 | 1.988 | 2.84 | -0.29 | 0.77 | 0.5050 | 0.009 | 0.2952 | 0.1601 | 0.2123 | 0.005 |
| team_share_oppadj:per | 2.567 | 1.928 | 2.74 | -0.20 | 0.79 | 0.5029 | 0.008 | 0.2924 | 0.1575 | 0.2113 | 0.005 |
| team_share_oppadj | 2.572 | 1.943 | 2.77 | -0.21 | 0.77 | 0.5035 | 0.010 | 0.2935 | 0.1586 | 0.2116 | 0.004 |

### Europa League (186 matches, 3 excluded)

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.807 | 2.198 | 3.07 | +0.12 | 0.63 | 0.5564 | 0.088 | 0.3256 | 0.1603 | 0.1887 | 0.014 |
| team_avg | 2.782 | 2.175 | 3.05 | +0.13 | 0.62 | 0.5448 | 0.079 | 0.3192 | 0.1572 | 0.1901 | 0.015 |
| current | 2.691 | 2.012 | 2.77 | -0.71 | 0.66 | 0.5263 | 0.043 | 0.3089 | 0.1494 | 0.1904 | 0.018 |
| team_share_ridge | 2.541 | 1.892 | 2.71 | +0.27 | 0.79 | 0.5109 | 0.014 | 0.2994 | 0.1432 | 0.1817 | 0.005 |
| team_share_pooled | 2.530 | 1.873 | 2.69 | +0.17 | 0.78 | 0.5103 | 0.011 | 0.2985 | 0.1431 | 0.1818 | 0.004 |
| team_share_oppadj:per | 2.521 | 1.853 | 2.66 | +0.31 | 0.79 | 0.5089 | 0.015 | 0.2985 | 0.1424 | 0.1814 | 0.006 |
| team_share_oppadj | 2.512 | 1.837 | 2.65 | +0.27 | 0.78 | 0.5089 | 0.015 | 0.2976 | 0.1424 | 0.1815 | 0.005 |

## All competitions, by checkpoint

### Checkpoint: all checkpoints

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.778 | 2.139 | 2.97 | -0.24 | 0.66 | 0.5594 | 0.074 | 0.3234 | 0.1595 | 0.1990 | 0.014 |
| team_avg | 2.738 | 2.082 | 2.90 | -0.18 | 0.66 | 0.5465 | 0.069 | 0.3142 | 0.1546 | 0.1985 | 0.015 |
| current | 2.735 | 2.045 | 2.80 | -0.97 | 0.66 | 0.5328 | 0.041 | 0.3063 | 0.1504 | 0.2020 | 0.018 |
| team_share_ridge | 2.521 | 1.834 | 2.61 | -0.09 | 0.79 | 0.5167 | 0.007 | 0.2942 | 0.1432 | 0.1905 | 0.001 |
| team_share_pooled | 2.520 | 1.831 | 2.61 | -0.10 | 0.80 | 0.5166 | 0.007 | 0.2941 | 0.1432 | 0.1905 | 0.001 |
| team_share_oppadj:per | 2.512 | 1.816 | 2.59 | -0.06 | 0.79 | 0.5159 | 0.007 | 0.2936 | 0.1429 | 0.1903 | 0.001 |
| team_share_oppadj | 2.510 | 1.813 | 2.59 | -0.06 | 0.80 | 0.5158 | 0.007 | 0.2935 | 0.1428 | 0.1903 | 0.001 |

### Checkpoint: 0

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.230 | 2.986 | 4.12 | -0.09 | 0.61 | 0.5969 | 0.083 | 0.4782 | 0.2981 | 0.2802 | 0.022 |
| team_avg | 3.145 | 2.850 | 3.96 | +0.00 | 0.63 | 0.5760 | 0.074 | 0.4594 | 0.2869 | 0.2795 | 0.022 |
| current | 3.113 | 2.770 | 3.80 | -0.80 | 0.64 | 0.5621 | 0.047 | 0.4479 | 0.2796 | 0.2850 | 0.031 |
| team_share_ridge | 2.892 | 2.509 | 3.56 | -0.07 | 0.81 | 0.5431 | 0.008 | 0.4286 | 0.2651 | 0.2665 | 0.004 |
| team_share_pooled | 2.890 | 2.506 | 3.56 | -0.08 | 0.81 | 0.5429 | 0.009 | 0.4285 | 0.2650 | 0.2663 | 0.004 |
| team_share_oppadj:per | 2.888 | 2.498 | 3.55 | -0.00 | 0.80 | 0.5427 | 0.009 | 0.4281 | 0.2650 | 0.2664 | 0.004 |
| team_share_oppadj | 2.886 | 2.497 | 3.55 | -0.01 | 0.81 | 0.5425 | 0.010 | 0.4280 | 0.2648 | 0.2662 | 0.004 |

### Checkpoint: 15

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 3.130 | 2.728 | 3.75 | -0.40 | 0.63 | 0.6059 | 0.079 | 0.4385 | 0.2478 | 0.2555 | 0.018 |
| team_avg | 3.061 | 2.624 | 3.63 | -0.32 | 0.64 | 0.5869 | 0.072 | 0.4242 | 0.2397 | 0.2549 | 0.019 |
| current | 3.049 | 2.585 | 3.54 | -1.10 | 0.64 | 0.5741 | 0.044 | 0.4150 | 0.2338 | 0.2602 | 0.026 |
| team_share_ridge | 2.812 | 2.321 | 3.29 | -0.08 | 0.80 | 0.5561 | 0.009 | 0.3982 | 0.2230 | 0.2443 | 0.003 |
| team_share_pooled | 2.809 | 2.316 | 3.29 | -0.09 | 0.80 | 0.5559 | 0.008 | 0.3980 | 0.2229 | 0.2442 | 0.003 |
| team_share_oppadj:per | 2.805 | 2.306 | 3.27 | -0.04 | 0.80 | 0.5553 | 0.007 | 0.3977 | 0.2227 | 0.2439 | 0.003 |
| team_share_oppadj | 2.803 | 2.300 | 3.26 | -0.04 | 0.80 | 0.5551 | 0.008 | 0.3974 | 0.2225 | 0.2438 | 0.003 |

### Checkpoint: 30

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.992 | 2.425 | 3.33 | -0.55 | 0.64 | 0.6061 | 0.078 | 0.3824 | 0.1894 | 0.2263 | 0.014 |
| team_avg | 2.942 | 2.357 | 3.25 | -0.49 | 0.65 | 0.5904 | 0.074 | 0.3723 | 0.1843 | 0.2255 | 0.016 |
| current | 2.932 | 2.317 | 3.15 | -1.26 | 0.66 | 0.5771 | 0.045 | 0.3630 | 0.1793 | 0.2303 | 0.022 |
| team_share_ridge | 2.685 | 2.051 | 2.92 | -0.12 | 0.80 | 0.5594 | 0.007 | 0.3493 | 0.1709 | 0.2170 | 0.001 |
| team_share_pooled | 2.683 | 2.047 | 2.91 | -0.13 | 0.80 | 0.5592 | 0.006 | 0.3492 | 0.1709 | 0.2169 | 0.000 |
| team_share_oppadj:per | 2.674 | 2.027 | 2.88 | -0.09 | 0.80 | 0.5582 | 0.007 | 0.3485 | 0.1702 | 0.2166 | 0.001 |
| team_share_oppadj | 2.672 | 2.023 | 2.88 | -0.09 | 0.80 | 0.5580 | 0.006 | 0.3483 | 0.1702 | 0.2166 | 0.001 |

### Checkpoint: 45

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.730 | 1.968 | 2.75 | -0.19 | 0.67 | 0.5854 | 0.086 | 0.2974 | 0.1212 | 0.1843 | 0.014 |
| team_avg | 2.704 | 1.937 | 2.71 | -0.14 | 0.67 | 0.5740 | 0.084 | 0.2920 | 0.1183 | 0.1840 | 0.016 |
| current | 2.668 | 1.874 | 2.58 | -0.90 | 0.68 | 0.5566 | 0.048 | 0.2813 | 0.1136 | 0.1870 | 0.017 |
| team_share_ridge | 2.498 | 1.705 | 2.43 | -0.07 | 0.79 | 0.5401 | 0.007 | 0.2710 | 0.1087 | 0.1767 | 0.002 |
| team_share_pooled | 2.496 | 1.703 | 2.43 | -0.08 | 0.80 | 0.5400 | 0.007 | 0.2709 | 0.1089 | 0.1768 | 0.002 |
| team_share_oppadj:per | 2.484 | 1.680 | 2.40 | -0.05 | 0.80 | 0.5391 | 0.008 | 0.2703 | 0.1084 | 0.1765 | 0.002 |
| team_share_oppadj | 2.482 | 1.677 | 2.39 | -0.05 | 0.80 | 0.5390 | 0.007 | 0.2701 | 0.1085 | 0.1765 | 0.002 |

### Checkpoint: 60

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.484 | 1.591 | 2.24 | -0.12 | 0.68 | 0.5268 | 0.086 | 0.2107 | 0.0684 | 0.1399 | 0.012 |
| team_avg | 2.477 | 1.584 | 2.23 | -0.09 | 0.68 | 0.5209 | 0.088 | 0.2072 | 0.0670 | 0.1398 | 0.014 |
| current | 2.452 | 1.539 | 2.11 | -0.87 | 0.68 | 0.4994 | 0.046 | 0.1984 | 0.0638 | 0.1406 | 0.009 |
| team_share_ridge | 2.279 | 1.385 | 1.99 | -0.11 | 0.79 | 0.4849 | 0.015 | 0.1925 | 0.0618 | 0.1342 | 0.000 |
| team_share_pooled | 2.279 | 1.385 | 1.99 | -0.11 | 0.79 | 0.4850 | 0.016 | 0.1927 | 0.0619 | 0.1343 | 0.001 |
| team_share_oppadj:per | 2.266 | 1.367 | 1.96 | -0.09 | 0.79 | 0.4844 | 0.015 | 0.1920 | 0.0615 | 0.1341 | 0.001 |
| team_share_oppadj | 2.266 | 1.366 | 1.96 | -0.09 | 0.79 | 0.4845 | 0.015 | 0.1922 | 0.0615 | 0.1342 | 0.001 |

### Checkpoint: 75

| model | team NLL | team RPS | team MAE | bias | 80% cover | P(1+ shot) logloss | ECE | P(2+) logloss | P(3+) logloss | P(goal) logloss | ECE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| league_avg | 2.099 | 1.138 | 1.63 | -0.08 | 0.71 | 0.4348 | 0.031 | 0.1317 | 0.0310 | 0.1069 | 0.003 |
| team_avg | 2.101 | 1.141 | 1.63 | -0.06 | 0.71 | 0.4301 | 0.036 | 0.1290 | 0.0302 | 0.1067 | 0.004 |
| current | 2.193 | 1.186 | 1.59 | -0.88 | 0.67 | 0.4267 | 0.027 | 0.1310 | 0.0312 | 0.1084 | 0.007 |
| team_share_ridge | 1.962 | 1.030 | 1.49 | -0.09 | 0.78 | 0.4162 | 0.004 | 0.1243 | 0.0288 | 0.1039 | 0.001 |
| team_share_pooled | 1.962 | 1.030 | 1.49 | -0.09 | 0.78 | 0.4161 | 0.004 | 0.1242 | 0.0288 | 0.1038 | 0.001 |
| team_share_oppadj:per | 1.951 | 1.018 | 1.47 | -0.08 | 0.78 | 0.4154 | 0.003 | 0.1238 | 0.0286 | 0.1039 | 0.001 |
| team_share_oppadj | 1.951 | 1.018 | 1.47 | -0.08 | 0.78 | 0.4153 | 0.004 | 0.1237 | 0.0285 | 0.1038 | 0.001 |
