
### LOW (ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11); isolated: true/true; quality low/low; 8 reps)

| event | ok (base/branch) | cell refills ms, base → branch (median, max) | terrain uploads base → branch (calls, bytes, ms) | update() ms base → branch (median) |
|---|---|---|---|---|
| plop | 8/8 | 0.365 → **0.010** (max 1.380 → 0.070) | 4 / 394240 / 0.017 → 15 / 150 / 0.010 | 1.215 → 0.798 |
| zone | 8/8 | 0.355 → **0.010** (max 0.525 → 0.015) | 4 / 394240 / 0.015 → 18 / 216 / 0.010 | 0.358 → 0.010 |
| road | 8/8 | 0.343 → **0.005** (max 0.585 → 0.010) | 4 / 394240 / 0.020 → 9 / 144 / 0.005 | 0.348 → 0.010 |
| trees | 7/7 | 0.340 → **0.010** (max 0.545 → 0.015) | 4 / 394240 / 0.015 → 15 / 150 / 0.005 | 0.343 → 0.010 |
| power | 8/8 | 0.348 → **0.010** (max 0.375 → 0.010) | 4 / 394240 / 0.020 → 9 / 144 / 0.003 | 0.350 → 0.010 |
| edge | 8/8 | 0.337 → **0.037** (max 0.350 → 0.170) | 4 / 394240 / 0.022 → 28 / 1402 / 0.017 | 17.743 → 16.630 |

Idle frames (30): base 0.005 ms max update, 0 terrain uploads; branch 0.010 ms max update, 0 terrain uploads. Errors: base 0, branch 0.

### HIGH (ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11); isolated: true/true; quality high/high; 8 reps)

| event | ok (base/branch) | cell refills ms, base → branch (median, max) | terrain uploads base → branch (calls, bytes, ms) | update() ms base → branch (median) |
|---|---|---|---|---|
| plop | 8/8 | 0.393 → **0.012** (max 1.230 → 0.055) | 4 / 394240 / 0.025 → 15 / 150 / 0.005 | 1.300 → 1.242 |
| zone | 8/8 | 0.502 → **0.010** (max 0.670 → 0.015) | 4 / 394240 / 0.020 → 18 / 216 / 0.010 | 0.502 → 0.012 |
| road | 8/8 | 0.492 → **0.010** (max 0.590 → 0.015) | 4 / 394240 / 0.023 → 9 / 144 / 0.007 | 0.492 → 0.010 |
| trees | 7/7 | 0.372 → **0.005** (max 0.820 → 0.010) | 4 / 394240 / 0.017 → 15 / 150 / 0.008 | 0.372 → 0.010 |
| power | 8/8 | 0.403 → **0.010** (max 0.630 → 0.010) | 4 / 394240 / 0.020 → 9 / 144 / 0.005 | 0.408 → 0.010 |
| edge | 8/8 | 0.473 → **0.037** (max 0.795 → 0.120) | 4 / 394240 / 0.030 → 28 / 1402 / 0.015 | 21.727 → 17.265 |

Idle frames (30): base 0.010 ms max update, 0 terrain uploads; branch 0.005 ms max update, 0 terrain uploads. Errors: base 0, branch 0.

| quality | pose | differing pixels | max channel difference | size |
|---|---|---|---|---|
| LOW | sites | **7267** | 120 | 1280x720 |
| LOW | edge | **1288** | 153 | 1280x720 |
| LOW | map | **3123** | 57 | 1280x720 |
| HIGH | sites | **15121** | 146 | 1280x720 |
| HIGH | edge | **5159** | 164 | 1280x720 |
| HIGH | map | **5722** | 70 | 1280x720 |
