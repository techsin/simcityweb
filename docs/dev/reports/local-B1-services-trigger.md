# local-B1-services-trigger: the services dirty trigger (WASM_PLAN B1 / PI-5a; T015)

> **Status: work in progress, pushed early for NOTE-014.** Every gate below has run except the speed A/B's
> replication: dense1m in the reverse order, and bot256 again with a tighter A/A. The `.done` marker comes with the final
> report.

Branch `local/B1-services-trigger`, base **`bf8b6e2`** (the dev-branch head when the task started).

Files:
- `src/sim/infra/services.ts`;
- `src/sim/actions.ts` (the funding and ordinance hunks only);
- `tests/sim/servicesTrigger.test.ts` (new, 24 tests);
- `tests/sim/fixtures/balance-baseline.json` (a new `b1` key per run; the old rows are untouched).

`ordinances.ts`, `utilities.ts` and `population.ts` are not touched.

Machine: Windows 10, Ryzen 7 9800X3D (8 cores / 16 threads), node 22.12 (no `process.threadCpuUsage`, NOTE-002).

## Results at a glance

| Gate | Result |
|---|---|
| Balance: 256 × 60 seeds 7 and 11, 128 × 15 | **pass** on every row but tourism (next line). Population at year 15: 183,671 / 181,028 / 196,101 (≥ 150k). At year 60: 1,527,090 / 1,504,571 (≥ 950k). Lowest ratio to base: 0.982 / 0.980 / 0.997 (≥ 0.9). Lowest approval from year 30: 79.5 / 80.0 (≥ 50). EQ at year 30: 121.6 / 118.8 (≥ 100). Lowest funds: 6,994 / 8,031 / 7,955 (≥ 0). Mean ms/day base → B1: 5.30 → 5.67, 5.37 → 5.56, 2.75 → 2.61 (≤ base + 3) |
| Tourism jobs within ±30 % | single years fall outside on each run: 4 of 55, 1 of 54 and 3 of 9 years. Across six 128 × 15 seeds the year-15 ratio has a geometric mean of **0.996**, in both directions. That is the bot's chaos, not a bias (section below) |
| New reference | the 128 × 15 seed-7 population in 2015 is now **196,101** (was 194,432). New `b1` key in `balance-baseline.json`, now the reference; old rows unchanged |
| Funding latency | unit test: **N = 2 days**. On the 1M cities: 1 day at design cadence (base 1–2). Headless: shows in 1–3 days and is applied in 2–4 (base: 1–40+ and 22–40+) |
| Strikes (trigger added in review) | unit test: a strike's start and its end each within N = 2 days. On the 1M cities a strike start shows in 1 day at design cadence, and in 2–5 days headless |
| Determinism, D1 for 120 days | identical: dense1m, bot256 y60 (the snapshot and the live city) |
| Speed, whole design-cadence day | dense1m **1.31×** (process CPU, median; mean 1.29×), A/A 1.017. bot256 **1.38×** and **1.43×** in the two orders (provisional). **Still to run:** dense1m in reverse order, and bot256 again with a tighter A/A |
| Services passes, design cadence | dense1m 90 → 14 per 180 days (30.0 → 4.7 per 60 days; target ≤ 10). bot256 135 → 18 per 270 days |
| Ultra emulation (frames mode) | passes per day: dense1m 0.089 → 0.050, bot256 0.094 → 0.050. The 1 s live cap holds B1 to 75 % of the periodic cadence at ultra (see that section) |
| Old saves | 6 of 6 load, run 45 days, and reload identically |
| `npx tsc --noEmit` / full vitest | clean / 1,115 passed, 6 skipped, 1 failed: `tests/wasm/binary.test.ts`, the Windows CRLF case that T012's `.gitattributes` fixes (this branch's base predates T012) |

## The trigger list as built

A pass used to run every `SERVICES_PERIOD` = 15 days, or within `SERVICES_DIRTY_DAYS` = 2 after any `buildingChanged`
on a coverage-relevant building. That included traffic's `Congested` flips, so big cities ran a pass about every 2 days.
`services.ts` now remembers each tracked building's inputs (`ServiceInput`) and reacts only to the changes below.

| Change | Before | Now | How it is seen |
|---|---|---|---|
| Service / park / transport / NIMBY-source building added or removed | dirty (≤ 2 days) | dirty (≤ 2 days) | `buildingAdded` / `buildingRemoved`; a building gone without an event is noticed by the daily visit |
| Tracked building's def, `Powered`, `Burnt`, `Abandoned` or construction finished | dirty | dirty | `buildingChanged`, plus a daily visit of the tracked buildings (flags written without an event) |
| `Watered` flip of a health facility | dirty | **dirty + urgent** | the same; `Watered` counts only for health facilities that use water |
| Staffing: `facilityOpFactor` moves ≥ `SERVICES_STAFF_DELTA` = 0.05 from the last captured value | (hidden by the 2-day passes) | **dirty + urgent** | daily visit (population writes jobs / hire without an event); small moves accumulate until they cross 0.05 |
| `Congested` or any other flag flip, partial construction progress | dirty (≤ 2 days) | **ignored** | flags are masked to the relevant set |
| `setFunding` with a new value | (hidden) | **urgent** | `CityActions.setFunding` → `services.invalidate()` |
| `setOrdinance` that enacts or repeals | (hidden) | **urgent** | `CityActions.setOrdinance` → `invalidate()`; unchanged and refused calls do nothing |
| Justice multiplier (`justiceFactors().policeMul`) | (hidden) | **urgent** | `month` listener (after `JusticeSystem.monthly`), the daily listener and every `due()` check |
| **Strike starts or ends** (added in review) | (hidden) | **urgent** | the funding factor of each service kind (0 during a strike) is recorded at each pass and compared by the `day` / `month` listeners |
| Road / network change | dirty | dirty | `networkChanged` (unchanged) |

- **Urgent** means the scheduler runs the task's steps first (up to 8 per day, or per frame) until that pass finishes.
  A change that arrives after a pass has captured its inputs stays pending for the next pass.
- **Live cap** (`SERVICES_MIN_PASS_MS` = 1000): in live mode (frames ticking) at most one pass *starts* per real second,
  urgent ones included. A pass already running keeps going. Headless and design-cadence paths never read the clock, so
  determinism is unaffected.
- **NIMBY** keeps its own flag: only NIMBY-source buildings (stigma, prestige, campus) and corridor changes mark it.

## Review: what I checked and the one trigger I added

- **No missed trigger.** I went through every input of a facility's op factor (`opOf`: funding × ordinance × justice ×
  power × water × staffing) and of the transit layer (`fundingFactor('transit')`, stops, network) and matched each
  against a trigger. All of the review's list is covered.
  - **One gap:** `fundingFactor` is 0 while a service is on strike. The monthly budget starts and ends strikes (funding
    under 50 %, 1–3 months) with no action or event. Before B1, the 2-day passes hid this; with B1 the coverage would
    have stayed at full strength for up to 15 days of a strike, and stayed at 0 for up to 15 days after it ended.
  - **Fix (mine):** `recordFunding` keeps the funding factor of each service kind, captured at each pass. The `day` and
    `month` listeners compare it and mark services urgent on a change. A first sighting only records it, so loading a
    city never forces an urgent pass. `due()` keeps only the cheap justice check, because the scheduler calls it many
    times per frame.
  - New test: a strike start and its end each show in coverage within N days. I checked that it fails with the
    detection disabled.
  - Evidence that it changes nothing where no strike happens: the 128 × 15 and both 256 × 60 bot tables are identical,
    line for line, to B1 without it. The D1 digests below compare two runs of the final code, not B1 before the trigger.
- **Other writers of funding.** `FallbackActions.setFunding` (the tools-only stand-in for `CityActions`) writes funding
  directly. The funding-factor check now catches that within a day too.
- **Determinism.** No clock on a headless or design-cadence path; the cap needs `frame()` calls and an active frame
  clock. Two runs are identical (D1 below), and the unit tests include a 60-day determinism check.
- **Cost.** The daily visit covers only the tracked service and NIMBY buildings (hundreds to a few thousand at 1M), not
  every building. The pass-start capture walks the building list the pass already walks.

## Balance: the SIM_DEPTH_SPEC procedure, side by side

- **Base:** `bf8b6e2`, run on this machine. Its rows match the recorded `partB` rows exactly.
- **B1:** this branch's final code.
- **Values:** exact, from `tools/balance-json.ts`.
- **Tourism:** `balance-json` has no tourism column, so the tourist column comes from the bot's printout. Tourism jobs are
  tourists × `CS_JOBS_PER_VISITOR` (`tourism.ts:454`), so their ratio is the same.
- **Gate line:** under each table, as the script computes it.

### 256 × 60, seed 7

| year | pop base | pop B1 | B1/base | approval base / B1 | EQ base / B1 | funds base / B1 | tourists base / B1 | ms/day base / B1 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2001 | 3,597 | 3,548 | 0.986 | 54.3 / 51.6 | 46.5 / 46.4 | 33k / 28k | 88 / 84 | 7.2 / 7.4 |
| 2002 | 9,695 | 9,534 | 0.983 | 54.6 / 51.0 | 47.7 / 47.2 | 42k / 33k | 528 / 743 | 3.5 / 3.5 |
| 2003 | 17,500 | 17,402 | 0.994 | 49.4 / 49.0 | 50.1 / 50.0 | 6090 / 6994 | 631 / 729 | 2.8 / 2.6 |
| 2004 | 26,585 | 26,267 | 0.988 | 48.7 / 47.5 | 52.9 / 53.3 | 6844 / 8752 | 652 / 736 | 2.0 / 1.8 |
| 2005 | 35,876 | 35,244 | 0.982 | 47.4 / 47.9 | 55.6 / 56.3 | 11k / 28k | 642 / 729 | 2.4 / 2.3 |
| 2006 | 45,369 | 47,381 | 1.044 | 49.6 / 56.9 | 58.3 / 59.4 | 35k / 40k | 1011 / 1168 | 3.0 / 2.5 |
| 2007 | 56,660 | 59,707 | 1.054 | 53.2 / 60.9 | 61.0 / 65.5 | 44k / 48k | 1374 / 1478 | 2.8 / 2.5 |
| 2008 | 69,116 | 73,041 | 1.057 | 56.2 / 64.4 | 63.3 / 72.0 | 52k / 56k | 1691 / 1549 | 3.2 / 2.6 |
| 2009 | 83,654 | 85,679 | 1.024 | 61.5 / 66.2 | 67.0 / 78.1 | 34k / 21k | 1768 / 1539 | 2.7 / 2.6 |
| 2010 | 97,232 | 99,281 | 1.021 | 62.0 / 64.6 | 71.3 / 83.1 | 58k / 29k | 1841 / 1597 | 2.7 / 3.0 |
| 2011 | 111,203 | 113,518 | 1.021 | 63.1 / 63.7 | 75.1 / 87.2 | 65k / 68k | 1866 / 1619 | 3.6 / 4.0 |
| 2012 | 125,759 | 128,807 | 1.024 | 60.6 / 64.1 | 78.1 / 90.2 | 74k / 93k | 2559 / 2529 | 5.1 / 5.9 |
| 2013 | 140,928 | 146,683 | 1.041 | 61.0 / 68.9 | 80.5 / 92.6 | 92k / 105k | 3419 / 3683 | 4.0 / 5.3 |
| 2014 | 158,764 | 164,605 | 1.037 | 60.7 / 70.7 | 82.3 / 94.6 | 105k / 123k | 4140 / 4487 | 5.1 / 6.0 |
| 2015 | 178,121 | 183,671 | 1.031 | 64.2 / 70.7 | 83.9 / 96.9 | 126k / 127k | 5527 / 7997 | 5.3 / 9.8 |
| 2016 | 197,801 | 202,205 | 1.022 | 69.0 / 71.2 | 86.5 / 99.3 | 105k / 160k | 8711 / 12k | 5.0 / 5.8 |
| 2017 | 216,752 | 221,364 | 1.021 | 70.1 / 71.6 | 89.5 / 101.3 | 155k / 184k | 12k / 16k | 4.5 / 6.7 |
| 2018 | 236,850 | 241,934 | 1.021 | 70.7 / 72.7 | 92.0 / 103.2 | 179k / 199k | 20k / 28k | 5.9 / 5.1 |
| 2019 | 257,697 | 264,330 | 1.026 | 71.4 / 73.5 | 94.1 / 105.1 | 193k / 239k | 27k / 35k | 4.8 / 5.8 |
| 2020 | 281,779 | 287,076 | 1.019 | 73.2 / 76.6 | 96.9 / 107.8 | 231k / 281k | 31k / 40k | 4.7 / 5.6 |
| 2021 | 304,083 | 309,724 | 1.019 | 75.5 / 77.4 | 100.6 / 110.2 | 240k / 315k | 36k / 45k | 5.3 / 6.3 |
| 2022 | 327,288 | 332,779 | 1.017 | 75.2 / 77.2 | 104.0 / 112.3 | 246k / 364k | 41k / 49k | 4.9 / 5.7 |
| 2023 | 350,730 | 356,795 | 1.017 | 76.2 / 77.0 | 107.0 / 114.1 | 312k / 651k | 47k / 51k | 5.2 / 5.9 |
| 2024 | 375,364 | 381,586 | 1.017 | 76.6 / 77.8 | 109.5 / 115.6 | 591k / 1.00M | 50k / 54k | 5.3 / 6.3 |
| 2025 | 401,318 | 407,092 | 1.014 | 76.6 / 77.6 | 111.7 / 116.8 | 934k / 1.42M | 53k / 55k | 5.2 / 6.1 |
| 2026 | 427,675 | 433,147 | 1.013 | 76.9 / 77.5 | 113.5 / 118.0 | 1.35M / 1.94M | 52k / 56k | 5.9 / 6.9 |
| 2027 | 455,871 | 462,381 | 1.014 | 77.4 / 78.9 | 115.2 / 118.9 | 1.89M / 2.56M | 53k / 57k | 4.8 / 6.9 |
| 2028 | 484,866 | 492,178 | 1.015 | 76.9 / 79.9 | 116.6 / 119.8 | 2.41M / 3.04M | 53k / 57k | 5.9 / 6.7 |
| 2029 | 514,847 | 523,204 | 1.016 | 78.4 / 81.8 | 117.7 / 120.6 | 2.87M / 2.95M | 62k / 64k | 5.6 / 6.6 |
| 2030 | 546,295 | 554,005 | 1.014 | 80.0 / 82.5 | 118.9 / 121.6 | 3.37M / 3.12M | 62k / 65k | 5.3 / 6.0 |
| 2031 | 577,926 | 585,862 | 1.014 | 81.2 / 82.1 | 120.1 / 122.5 | 3.69M / 3.36M | 64k / 67k | 5.8 / 6.0 |
| 2032 | 610,856 | 617,563 | 1.011 | 82.4 / 82.6 | 121.2 / 123.5 | 3.87M / 3.62M | 63k / 67k | 5.8 / 8.3 |
| 2033 | 643,344 | 649,695 | 1.010 | 82.6 / 82.6 | 122.3 / 124.4 | 4.11M / 3.98M | 64k / 68k | 6.0 / 6.0 |
| 2034 | 676,624 | 681,717 | 1.008 | 82.2 / 81.8 | 123.5 / 125.2 | 4.38M / 4.41M | 64k / 68k | 6.1 / 6.8 |
| 2035 | 710,264 | 715,072 | 1.007 | 82.8 / 82.9 | 124.5 / 125.9 | 4.70M / 4.84M | 64k / 69k | 5.7 / 6.5 |
| 2036 | 742,639 | 749,138 | 1.009 | 82.1 / 82.6 | 125.4 / 126.5 | 5.08M / 5.35M | 65k / 69k | 6.0 / 7.3 |
| 2037 | 777,248 | 782,557 | 1.007 | 82.2 / 82.8 | 126.1 / 127.1 | 5.49M / 5.61M | 66k / 69k | 6.3 / 7.0 |
| 2038 | 812,242 | 816,777 | 1.006 | 82.1 / 82.1 | 126.9 / 127.5 | 5.93M / 5.93M | 67k / 69k | 5.9 / 7.1 |
| 2039 | 849,103 | 852,464 | 1.004 | 82.0 / 83.0 | 127.6 / 127.9 | 6.41M / 6.21M | 67k / 70k | 6.0 / 7.0 |
| 2040 | 884,258 | 888,338 | 1.005 | 82.4 / 82.9 | 128.2 / 128.3 | 6.93M / 6.55M | 68k / 71k | 6.1 / 6.2 |
| 2041 | 918,776 | 922,924 | 1.005 | 81.3 / 82.1 | 128.7 / 128.6 | 7.52M / 6.93M | 67k / 70k | 6.6 / 5.8 |
| 2042 | 952,939 | 962,513 | 1.010 | 81.8 / 82.7 | 129.1 / 128.8 | 8.01M / 7.35M | 67k / 71k | 6.5 / 6.9 |
| 2043 | 991,493 | 1,001,292 | 1.010 | 82.4 / 82.8 | 129.3 / 128.9 | 8.20M / 7.81M | 68k / 71k | 6.5 / 6.7 |
| 2044 | 1,028,280 | 1,037,814 | 1.009 | 81.7 / 82.4 | 129.5 / 129.1 | 8.50M / 8.12M | 67k / 71k | 6.6 / 7.6 |
| 2045 | 1,065,804 | 1,078,984 | 1.012 | 81.0 / 81.9 | 129.8 / 129.2 | 8.83M / 8.55M | 66k / 71k | 6.0 / 6.9 |
| 2046 | 1,108,369 | 1,113,475 | 1.005 | 82.1 / 81.5 | 130.0 / 129.3 | 9.15M / 8.99M | 66k / 71k | 5.7 / 6.7 |
| 2047 | 1,145,930 | 1,152,087 | 1.005 | 81.4 / 81.9 | 130.1 / 129.4 | 9.45M / 9.47M | 66k / 71k | 5.7 / 6.7 |
| 2048 | 1,186,571 | 1,191,866 | 1.004 | 81.4 / 81.3 | 130.3 / 129.5 | 9.76M / 9.97M | 66k / 71k | 7.9 / 6.2 |
| 2049 | 1,230,311 | 1,234,258 | 1.003 | 81.1 / 81.5 | 130.4 / 129.6 | 10.04M / 10.44M | 67k / 71k | 6.8 / 5.8 |
| 2050 | 1,266,393 | 1,276,540 | 1.008 | 81.3 / 81.7 | 130.5 / 129.6 | 10.31M / 10.91M | 67k / 71k | 6.1 / 6.9 |
| 2051 | 1,309,486 | 1,310,888 | 1.001 | 80.6 / 80.3 | 130.6 / 129.7 | 10.57M / 11.31M | 67k / 71k | 5.9 / 6.8 |
| 2052 | 1,306,007 | 1,356,749 | 1.039 | 80.0 / 79.5 | 130.8 / 129.8 | 10.82M / 11.75M | 67k / 71k | 5.9 / 7.0 |
| 2053 | 1,313,721 | 1,397,489 | 1.064 | 79.9 / 80.6 | 131.0 / 129.9 | 11.08M / 12.17M | 66k / 71k | 6.0 / 6.3 |
| 2054 | 1,334,430 | 1,433,262 | 1.074 | 80.7 / 80.6 | 131.2 / 130.0 | 11.35M / 12.62M | 67k / 70k | 5.8 / 4.3 |
| 2055 | 1,329,734 | 1,466,413 | 1.103 | 79.5 / 80.2 | 131.3 / 130.1 | 11.64M / 13.07M | 68k / 70k | 6.1 / 4.7 |
| 2056 | 1,337,402 | 1,485,181 | 1.110 | 80.3 / 80.0 | 131.3 / 130.2 | 11.94M / 13.56M | 67k / 70k | 6.0 / 4.7 |
| 2057 | 1,346,266 | 1,494,926 | 1.110 | 80.5 / 81.0 | 131.4 / 130.3 | 12.23M / 14.04M | 67k / 70k | 6.0 / 4.3 |
| 2058 | 1,367,066 | 1,505,821 | 1.101 | 80.4 / 80.3 | 131.5 / 130.4 | 12.56M / 14.55M | 68k / 70k | 6.2 / 4.3 |
| 2059 | 1,375,061 | 1,518,281 | 1.104 | 80.6 / 80.2 | 131.7 / 130.4 | 12.89M / 15.07M | 68k / 70k | 5.9 / 4.7 |
| 2060 | 1,368,806 | 1,527,090 | 1.116 | 81.5 / 80.3 | 131.8 / 130.5 | 13.22M / 15.61M | 67k / 70k | 5.9 / 4.4 |

- gates (B1): pop y15 183,671, y60 1,527,090; min pop ratio vs base 0.982; min approval from y30 79.5; EQ 121.6 at y30 (first >= 100 in 2017); min funds 6994; tourists B1/base 0.87–1.45 (4 of 55 years with base >= 1k outside ±30 %); mean ms/day base 5.30, B1 5.67; printout matches rows: true

### 256 × 60, seed 11

| year | pop base | pop B1 | B1/base | approval base / B1 | EQ base / B1 | funds base / B1 | tourists base / B1 | ms/day base / B1 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2001 | 3,628 | 3,687 | 1.016 | 51.6 / 51.7 | 46.4 / 46.4 | 33k / 36k | 84 / 84 | 7.6 / 7.7 |
| 2002 | 9,824 | 9,833 | 1.001 | 50.3 / 51.8 | 47.3 / 47.3 | 48k / 54k | 509 / 436 | 3.0 / 3.3 |
| 2003 | 17,690 | 17,766 | 1.004 | 46.8 / 51.2 | 49.8 / 49.7 | 6831 / 13k | 615 / 590 | 2.6 / 2.6 |
| 2004 | 26,740 | 26,622 | 0.996 | 45.8 / 50.3 | 52.5 / 52.5 | 6714 / 8031 | 628 / 637 | 2.7 / 2.1 |
| 2005 | 35,871 | 35,602 | 0.993 | 43.9 / 48.9 | 55.3 / 55.3 | 22k / 11k | 627 / 645 | 2.1 / 2.7 |
| 2006 | 46,801 | 45,860 | 0.980 | 51.6 / 53.8 | 58.0 / 58.1 | 39k / 34k | 918 / 1037 | 2.8 / 2.9 |
| 2007 | 58,537 | 58,407 | 0.998 | 57.9 / 59.3 | 63.0 / 61.7 | 43k / 45k | 1074 / 1375 | 3.2 / 3.0 |
| 2008 | 71,727 | 71,135 | 0.992 | 61.9 / 62.6 | 68.7 / 65.7 | 53k / 53k | 1404 / 1710 | 2.4 / 2.9 |
| 2009 | 84,925 | 83,921 | 0.988 | 64.7 / 62.3 | 74.1 / 69.8 | 22k / 54k | 1643 / 1775 | 2.6 / 2.8 |
| 2010 | 98,298 | 97,913 | 0.996 | 62.5 / 64.0 | 78.8 / 73.4 | 27k / 48k | 1727 / 1752 | 2.6 / 3.2 |
| 2011 | 112,691 | 111,876 | 0.993 | 61.9 / 63.7 | 82.7 / 76.3 | 43k / 77k | 1766 / 2671 | 3.9 / 5.0 |
| 2012 | 127,628 | 128,067 | 1.003 | 61.7 / 65.1 | 85.9 / 78.6 | 69k / 83k | 2640 / 2881 | 5.3 / 5.9 |
| 2013 | 145,095 | 144,522 | 0.996 | 63.2 / 67.7 | 88.3 / 80.4 | 97k / 102k | 3466 / 3883 | 4.0 / 4.3 |
| 2014 | 162,841 | 162,322 | 0.997 | 67.3 / 67.2 | 90.4 / 82.2 | 114k / 116k | 4532 / 4778 | 5.7 / 5.8 |
| 2015 | 182,390 | 181,028 | 0.993 | 69.6 / 69.1 | 92.3 / 84.6 | 135k / 132k | 4577 / 5484 | 5.3 / 5.1 |
| 2016 | 202,378 | 200,656 | 0.991 | 70.8 / 70.2 | 94.6 / 87.7 | 124k / 129k | 6994 / 5540 | 5.1 / 4.6 |
| 2017 | 221,587 | 220,122 | 0.993 | 71.0 / 69.7 | 97.0 / 90.8 | 159k / 165k | 11k / 8403 | 4.5 / 5.6 |
| 2018 | 242,961 | 240,137 | 0.988 | 70.9 / 70.7 | 99.3 / 93.8 | 187k / 187k | 12k / 13k | 5.4 / 5.5 |
| 2019 | 264,417 | 261,848 | 0.990 | 71.9 / 71.8 | 101.5 / 96.4 | 198k / 203k | 20k / 22k | 4.8 / 5.9 |
| 2020 | 287,157 | 284,179 | 0.990 | 73.0 / 72.3 | 103.9 / 98.7 | 227k / 233k | 27k / 28k | 5.6 / 6.0 |
| 2021 | 310,238 | 307,751 | 0.992 | 74.6 / 74.8 | 106.4 / 101.8 | 264k / 271k | 32k / 34k | 4.8 / 6.0 |
| 2022 | 334,253 | 331,033 | 0.990 | 76.2 / 76.0 | 109.2 / 105.0 | 283k / 319k | 35k / 37k | 5.3 / 6.1 |
| 2023 | 358,055 | 353,992 | 0.989 | 76.9 / 76.5 | 111.8 / 107.7 | 325k / 291k | 41k / 48k | 5.4 / 5.2 |
| 2024 | 381,710 | 377,739 | 0.990 | 76.1 / 76.1 | 113.9 / 110.0 | 413k / 607k | 47k / 50k | 5.5 / 4.5 |
| 2025 | 406,802 | 403,513 | 0.992 | 76.7 / 77.3 | 115.7 / 111.8 | 725k / 983k | 51k / 53k | 5.3 / 6.1 |
| 2026 | 431,917 | 430,873 | 0.998 | 77.0 / 77.8 | 117.2 / 113.3 | 1.11M / 1.44M | 51k / 54k | 5.1 / 6.1 |
| 2027 | 459,770 | 459,432 | 0.999 | 77.7 / 78.0 | 118.4 / 114.7 | 1.58M / 1.98M | 53k / 54k | 5.7 / 6.0 |
| 2028 | 489,250 | 488,466 | 0.998 | 77.1 / 78.3 | 119.5 / 115.9 | 2.03M / 2.47M | 53k / 55k | 5.5 / 6.5 |
| 2029 | 519,521 | 519,539 | 1.000 | 78.1 / 79.3 | 120.7 / 117.1 | 2.42M / 2.87M | 59k / 62k | 5.8 / 6.0 |
| 2030 | 550,072 | 551,103 | 1.002 | 78.1 / 80.3 | 122.0 / 118.8 | 3.08M / 3.48M | 61k / 63k | 5.8 / 6.3 |
| 2031 | 581,783 | 584,972 | 1.005 | 80.0 / 82.4 | 123.2 / 120.4 | 3.63M / 3.76M | 62k / 65k | 6.1 / 5.8 |
| 2032 | 613,827 | 616,903 | 1.005 | 80.7 / 82.8 | 124.3 / 122.0 | 4.00M / 4.12M | 63k / 65k | 6.7 / 6.1 |
| 2033 | 645,262 | 649,404 | 1.006 | 80.9 / 83.2 | 125.2 / 123.4 | 4.32M / 4.53M | 63k / 65k | 6.0 / 5.6 |
| 2034 | 677,267 | 682,199 | 1.007 | 81.2 / 83.5 | 126.0 / 124.5 | 4.59M / 4.92M | 63k / 66k | 5.8 / 6.0 |
| 2035 | 710,807 | 714,915 | 1.006 | 81.8 / 83.5 | 126.6 / 125.5 | 4.93M / 5.19M | 63k / 66k | 6.4 / 6.4 |
| 2036 | 743,882 | 748,140 | 1.006 | 82.0 / 83.1 | 127.1 / 126.3 | 5.32M / 5.51M | 63k / 68k | 5.7 / 6.6 |
| 2037 | 776,841 | 782,274 | 1.007 | 82.0 / 83.1 | 127.5 / 126.9 | 5.74M / 5.90M | 65k / 68k | 5.6 / 7.2 |
| 2038 | 810,213 | 817,528 | 1.009 | 80.8 / 83.2 | 128.1 / 127.5 | 6.17M / 6.30M | 65k / 68k | 6.3 / 6.3 |
| 2039 | 848,739 | 853,294 | 1.005 | 81.3 / 82.9 | 128.6 / 128.2 | 6.67M / 6.72M | 66k / 69k | 5.8 / 6.3 |
| 2040 | 884,059 | 891,260 | 1.008 | 81.6 / 83.0 | 128.9 / 128.8 | 7.22M / 7.21M | 66k / 69k | 5.8 / 6.3 |
| 2041 | 919,689 | 925,043 | 1.006 | 80.7 / 83.0 | 129.2 / 129.1 | 7.81M / 7.76M | 64k / 69k | 6.0 / 6.2 |
| 2042 | 951,023 | 960,994 | 1.010 | 80.7 / 83.3 | 129.5 / 129.4 | 8.48M / 8.37M | 65k / 68k | 5.6 / 6.4 |
| 2043 | 989,198 | 994,337 | 1.005 | 81.8 / 82.2 | 129.6 / 129.6 | 8.71M / 8.91M | 65k / 69k | 6.2 / 6.6 |
| 2044 | 1,029,804 | 1,032,865 | 1.003 | 81.2 / 82.1 | 129.7 / 129.8 | 9.01M / 9.59M | 64k / 69k | 5.8 / 6.0 |
| 2045 | 1,066,370 | 1,071,299 | 1.005 | 81.0 / 81.5 | 130.1 / 129.9 | 9.29M / 10.25M | 65k / 69k | 6.6 / 9.0 |
| 2046 | 1,103,217 | 1,107,318 | 1.004 | 80.4 / 80.9 | 130.5 / 130.1 | 9.61M / 10.95M | 65k / 69k | 6.6 / 7.1 |
| 2047 | 1,147,320 | 1,145,780 | 0.999 | 80.9 / 80.9 | 130.7 / 130.2 | 9.92M / 11.67M | 64k / 69k | 6.3 / 7.1 |
| 2048 | 1,186,033 | 1,189,139 | 1.003 | 80.8 / 80.8 | 130.9 / 130.3 | 10.22M / 12.39M | 66k / 69k | 5.9 / 7.0 |
| 2049 | 1,227,028 | 1,228,411 | 1.001 | 80.1 / 81.3 | 131.1 / 130.3 | 10.54M / 13.15M | 66k / 68k | 6.4 / 6.3 |
| 2050 | 1,269,919 | 1,270,539 | 1.000 | 80.5 / 80.9 | 131.1 / 130.3 | 10.83M / 13.85M | 66k / 69k | 6.2 / 7.2 |
| 2051 | 1,315,115 | 1,312,064 | 0.998 | 79.7 / 80.6 | 131.2 / 130.4 | 11.13M / 14.57M | 66k / 69k | 6.6 / 7.2 |
| 2052 | 1,354,495 | 1,353,198 | 0.999 | 80.0 / 80.0 | 131.3 / 130.5 | 11.44M / 15.32M | 65k / 69k | 6.3 / 7.5 |
| 2053 | 1,392,506 | 1,390,911 | 0.999 | 80.2 / 80.5 | 131.3 / 130.6 | 11.74M / 16.09M | 66k / 68k | 6.3 / 7.1 |
| 2054 | 1,423,158 | 1,414,138 | 0.994 | 80.4 / 80.8 | 131.4 / 130.6 | 12.11M / 16.90M | 65k / 69k | 6.4 / 6.9 |
| 2055 | 1,442,249 | 1,440,500 | 0.999 | 80.5 / 81.1 | 131.4 / 130.7 | 12.50M / 17.75M | 66k / 69k | 6.3 / 4.7 |
| 2056 | 1,455,963 | 1,453,453 | 0.998 | 79.7 / 80.7 | 131.5 / 130.7 | 12.89M / 18.63M | 66k / 69k | 6.5 / 4.4 |
| 2057 | 1,473,972 | 1,474,061 | 1.000 | 80.3 / 80.7 | 131.6 / 130.8 | 13.34M / 19.54M | 65k / 69k | 6.3 / 4.9 |
| 2058 | 1,489,291 | 1,487,295 | 0.999 | 79.6 / 80.3 | 131.6 / 130.9 | 13.81M / 20.43M | 65k / 69k | 6.7 / 4.5 |
| 2059 | 1,501,089 | 1,495,299 | 0.996 | 79.8 / 81.0 | 131.5 / 131.0 | 14.31M / 21.35M | 66k / 69k | 7.0 / 4.3 |
| 2060 | 1,500,564 | 1,504,571 | 1.003 | 79.6 / 80.4 | 131.5 / 131.0 | 14.84M / 22.29M | 65k / 69k | 6.9 / 4.9 |

- gates (B1): pop y15 181,028, y60 1,504,571; min pop ratio vs base 0.980; min approval from y30 80.0; EQ 118.8 at y30 (first >= 100 in 2021); min funds 8031; tourists B1/base 0.76–1.51 (1 of 54 years with base >= 1k outside ±30 %); mean ms/day base 5.37, B1 5.56; printout matches rows: true

### 128 × 15, seed 7

| year | pop base | pop B1 | B1/base | approval base / B1 | EQ base / B1 | funds base / B1 | tourists base / B1 | ms/day base / B1 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2001 | 3,732 | 3,736 | 1.001 | 53.1 / 53.4 | 46.4 / 46.4 | 35k / 35k | 116 / 117 | 5.4 / 5.3 |
| 2002 | 9,796 | 9,902 | 1.011 | 53.9 / 54.4 | 47.5 / 47.6 | 47k / 46k | 475 / 624 | 1.7 / 2.0 |
| 2003 | 17,694 | 17,788 | 1.005 | 51.7 / 50.8 | 49.8 / 50.1 | 7102 / 7955 | 596 / 784 | 1.8 / 2.2 |
| 2004 | 26,767 | 26,814 | 1.002 | 49.6 / 49.5 | 53.0 / 53.3 | 6604 / 8555 | 658 / 828 | 2.2 / 1.7 |
| 2005 | 36,003 | 35,901 | 0.997 | 48.4 / 48.3 | 55.9 / 56.2 | 14k / 27k | 672 / 981 | 1.8 / 1.9 |
| 2006 | 46,713 | 47,662 | 1.020 | 52.4 / 56.9 | 58.9 / 59.9 | 39k / 42k | 844 / 1305 | 3.2 / 3.1 |
| 2007 | 58,343 | 60,300 | 1.034 | 57.3 / 61.0 | 64.2 / 66.4 | 41k / 36k | 1162 / 1806 | 2.6 / 2.3 |
| 2008 | 71,801 | 73,421 | 1.023 | 62.4 / 67.4 | 70.3 / 73.3 | 57k / 58k | 1657 / 2199 | 2.1 / 2.3 |
| 2009 | 85,383 | 87,516 | 1.025 | 65.7 / 72.0 | 75.9 / 79.5 | 61k / 62k | 2067 / 2530 | 1.9 / 2.1 |
| 2010 | 101,650 | 103,383 | 1.017 | 71.5 / 73.3 | 80.8 / 84.8 | 74k / 80k | 2900 / 3670 | 2.2 / 2.1 |
| 2011 | 119,622 | 120,589 | 1.008 | 74.7 / 75.3 | 85.5 / 89.6 | 74k / 100k | 4448 / 5799 | 4.5 / 3.3 |
| 2012 | 137,490 | 138,850 | 1.010 | 76.5 / 76.5 | 90.2 / 94.0 | 105k / 93k | 8627 / 10k | 3.3 / 2.5 |
| 2013 | 155,651 | 157,342 | 1.011 | 77.7 / 77.9 | 94.3 / 98.3 | 117k / 111k | 13k / 13k | 2.5 / 2.5 |
| 2014 | 174,720 | 175,969 | 1.007 | 78.7 / 79.5 | 98.7 / 103.2 | 144k / 144k | 22k / 27k | 2.8 / 2.9 |
| 2015 | 194,432 | 196,101 | 1.009 | 81.4 / 82.5 | 103.0 / 107.6 | 168k / 165k | 29k / 37k | 3.2 / 2.9 |

- gates (B1): pop y15 196,101; min pop ratio vs base 0.997; min funds 7955; tourists B1/base 1.00–1.55 (3 of 9 years with base >= 1k outside ±30 %); mean ms/day base 2.75, B1 2.61; printout matches rows: true

## Tourism: the ±30 % row, checked across seeds

The tourism criterion is the one balance row that a single seed cannot settle. B1's yearly tourist counts against
base, years with at least 1,000 tourists:
- 256 seed 7: 0.87–1.45 (4 of 55 years outside ±30 %);
- 256 seed 11: 0.76–1.51 (1 of 54);
- 128 seed 7: 1.00–1.55 (3 of 9).

The 128 seed-7 run is above base in every year (+30–55 % in 2005–2008). EQ and approval are slightly higher too.

**First idea, ruled out.** A pass zeroes `transitCov` partway through, and tourism access reads it. I measured it
(`transitProbe.ts`, `botPasses.ts`):
- the dips happen in both trees;
- the 128 bot runs 24 passes a year in both trees (B1 exactly 24, phase-locked with the bot's monthly building; base
  24–38);
- B1 has *less* transit coverage in several years.

**What it is: the bot's chaos.** The two trees' pass timing differs a little from year 1, and the bot amplifies that
into a different city. Five more 128 × 15 seeds per tree, year 15, base → B1:

| seed | population | approval | EQ | tourists |
|---|---|---|---|---|
| 1 | 197k → 193k | 81 → 79 | 102 → 101 | 36k → 28k |
| 2 | 191k → 195k | 81 → 80 | 101 → 102 | 30k → 28k |
| 3 | 194k → 196k | 80 → 80 | 105 → 102 | 31k → 27k |
| 4 | 197k → 197k | 81 → 80 | 100 → 100 | 24k → 29k |
| 5 | 193k → 194k | 79 → 81 | 98 → 102 | 24k → 24k |
| 7 | 194k → 196k | 81 → 83 | 103 → 108 | 29k → 37k |

- Year-15 tourists B1/base: 0.78, 0.93, 0.87, 1.21, 1.00, 1.28. Geometric mean **0.996**, in both directions.
- EQ: +1.0 points on average. Approval: −0.2 points.
- Single years swing much further on some seeds (0.54–2.40), so on one seed a per-year ±30 % test measures the bot,
  not the change.
- **Conclusion:** no tourism bias from B1. The row fails on single years of single seeds, as any change that moves the
  bot would.

## Funding latency

### The unit test

**N = 2 days**, in `tests/sim/servicesTrigger.test.ts` on a 32² city. A change without an event (staffing, water) needs
one end-of-day observation, then the next day's urgent pass. That city's pass takes at most 6 steps, within the 8
urgent steps the scheduler runs per day.

The test covers each of these, without stepping past the scheduler:
- a funding change;
- ordinance enact and repeal;
- health `Watered` loss and return, with and without an event;
- staffing up and down, plus drift that crosses the threshold in small steps;
- the monthly justice update;
- a strike start and its end.

### On the 1M-resident cities

Script: `serviceLatency.ts`, in the scratch folder like the other harnesses.
- **Method:** two identical sims are loaded from the fixture and warmed the same way; the change is applied to one of
  them. This is repeated at 15 start days in a row, so every phase of the 15-day cycle is covered.
- **First change:** the first day the coverage layer differs between the two sims.
- **Applied:** the day the first pass that *started after* the change finishes, so every tier reflects it.
- **Values:** median days (min–max) over the 15 start days, capped at 40.
- **Cadences:**
  - Design is `advanceDay` + `flush`.
  - Headless is the bot's budgeted `advanceDay`.
  - Live play sits between the two: it has a frame budget, and an urgent pass also runs first.

| city | cadence | change | base: first change | B1: first change | base: applied | B1: applied |
|---|---|---|---|---|---|---|
| bot256 live | design | eduFunding | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| bot256 live | design | freeClinics (repealed) | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| bot256 live | design | policeFunding | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| bot256 live | headless | eduFunding | 12 (5–19) | 1 (1–1) | 29 (22–36) | 2 (2–2) |
| bot256 live | headless | freeClinics (repealed) | 20 (13–27) | 1 (1–1) | 31 (23–38) | 2 (2–2) |
| bot256 live | headless | policeFunding | 8 (1–15) | 1 (1–1) | 30 (23–37) | 3 (3–3) |
| dense1m | design | eduFunding | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| dense1m | design | freeClinics (enacted) | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| dense1m | design | policeFunding | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| dense1m | headless | eduFunding | 13 (8–18; 4 of 15 over 40) | 1 (1–2) | 40 (39–40; 13 of 15 over 40) | 2 (2–4) |
| dense1m | headless | freeClinics (enacted) | 28 (23–33; 4 of 15 over 40) | 1 (1–3) | 40 (39–40; 13 of 15 over 40) | 2 (2–4) |
| dense1m | headless | policeFunding | 9 (3–40; 2 of 15 over 40) | 1 (1–2) | 40 (39–40; 13 of 15 over 40) | 2 (2–4) |

Strike start: the education strike written as the monthly budget writes it, with no action and no event.

| city | cadence | base: first change | B1: first change | base: applied | B1: applied |
|---|---|---|---|---|---|
| dense1m | design | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| dense1m | headless | 13 (8–18; 4 of 15 over 40) | 2 (2–2) | 40 (39–40; 13 of 15 over 40) | 3 (3–4) |
| bot256 live | design | 2 (1–2) | 1 (1–1) | 2 (1–2) | 1 (1–1) |
| bot256 live | headless | 12 (5–19) | 2 (2–5) | 30 (23–37) | 3 (3–19) |

- **Design cadence: 1 day with B1.** Base reaches 1–2 days only because traffic's `Congested` flips force a pass every
  2 days. That is the cost B1 removes, and finding 2 predicted it.
- **Headless:** B1 shows a funding or ordinance change in 1–3 days (a strike in 2–5) and finishes applying it in 2–4
  days (one strike case: 19). Base takes 1–40+ days to show it and 22–40+ days to finish.
- **The one slow B1 case: 19 days, bot256 headless strike.** A periodic pass started on the strike's own day, before the
  end-of-day listener saw the strike. Prep read the new funding factor, so that pass already carries the strike, but
  it is not urgent and runs at the headless budget's pace. Its first change still showed in 2–5 days.
  - Design cadence and live play finish any pass the same day or within a fraction of a second, so only headless runs
    see this.
  - I left it as is. Making a prep-time catch urgent would add code for a bot-only edge case.

## Determinism (D1)

`cityDigest.ts`: sha256 of `serializeCity({ copy: true })` after 120 design-cadence days. Two runs each, final code:

| fixture | digest | two runs |
|---|---|---|
| dense1m | `15c23cb326bf6b8d…` | identical |
| bot256 y60 (snapshot) | `7734f192b9dcd051…` | identical |
| bot256 y60 (live, 1.37M) | `9df0bfddd5b4477c…` | identical |

The unit tests add a 60-day two-run check and check that the cap's clock is never read headless.

## Old saves

Ran with the auditor's T013 script (`loadOld.mts`) on the final code. Each file loads, runs 45 days, and is loaded again
to check the same 45 days are identical. Then it goes through an export-bundle round trip and 3 more days.

| file | loaded | after 45 days | reload identical |
|---|---|---|---|
| CITIES small_s7_y10.city.metropolis | day 3600, 101,650 people | day 3645, 104,082 | yes |
| CITIES small_s7_y10.region.metropolis | day 3600, 101,650 people | day 3645, 104,082 | yes |
| CITIES vet_s7_y21.region.metropolis | day 7560, 304,083 people | day 7605, 306,970 | yes |
| CITIES vet_s7_y43.city.metropolis | day 15480, 991,493 people | day 15525, 992,669 | yes |
| written by 9948964 (city file) | day 3247, 84,777 people | day 3292, 86,373 | yes |
| written by 9948964 (region file) | day 3247, 84,777 people | day 3292, 86,373 | yes |

0 failures. Two of these cities had 2 live incidents.

## Ultra emulation (frames mode)

The scheduler's frame path at the ultra speed, about 18 simulated days per real second. Each run covers 180 days from
the fixture and counts the services passes. Single runs, not the A/B method.

| fixture | passes, base → B1 | per day | CPU ms per day, base → B1 |
|---|---|---|---|
| dense1m | 16 → 9 | 0.089 → 0.050 | 19.0 → 18.2 |
| bot256 y60 (live) | 17 → 9 | 0.094 → 0.050 | 16.1 → 17.1 |

- **The live cap binds at ultra.** `SERVICES_MIN_PASS_MS` = 1000 lets one pass start per real second. At about 18 days
  per second that is at most one pass every 18 days. So B1 gets 9 passes in 180 days: 75 % of the 12 periodic passes
  (`SERVICES_PERIOD` 15), and 64 % of the 14 it runs at design cadence over the same days.
- **Against S5.** S5's acceptance (AC4) asks for services at ≥ 90 % of design cadence at ultra.
- **The fix is one constant.** A cap near 700 ms (about 12.6 days at ultra) would no longer bind. S5 makes these caps
  host-overridable. I can set 700 here if you prefer it in B1.
- **Naming.** The constant is `SERVICES_MIN_PASS_MS`: it limits pass *starts*. WORKER_DESIGN §6 row S2 calls it
  `SERVICES_MIN_CYCLE_MS`. I can rename it to match.

## Speed: the whole design-cadence day (finding 4's method)

**Harness:** `abDay4.ts`, in the scratch folder like the other harnesses (not committed).
- **Arms.** Each arm is a bundle of its own tree: base `bf8b6e2`, and B1 this branch.
- **Isolates.** 2 fresh `worker_threads` isolates per arm. The order rotates and reverses every round: A0B0A1B1, A0B1A1B0,
  A1B1A0B0, A1B0A0B1.
- **Rounds.** Each round loads the fixture in every isolate, runs 20 warm days, then times a chunk of design-cadence
  days (`advanceDay` + `flush`): 180 days on dense1m, 270 on bot256. 24 rounds.
- **Clocks.** Process CPU (`process.cpuUsage`, in chunks ≥ 1 s, NOTE-002; node 22.12 has no thread CPU) and wall.
- **Statistics.** A hierarchical bootstrap over isolates and chunks (median and mean), the median of paired rounds, and
  the A/A pair (the two base isolates) and B/B pair (the two B1 isolates) from the same run.
- **Checks.** Both isolates of an arm end with the same city digest, and both protectors stay intact.

Speed-up = base ÷ B1 (above 1 means B1 is faster). ms/day are process CPU (median / mean).

| run | fixture | base ms/day | B1 ms/day | speed-up, median [95 % CI] | mean [95 % CI] | paired rounds | wall, median | A/A, paired; hierarchical | B/B, paired; hierarchical |
|---|---|---|---|---|---|---|---|---|---|
| order 1 (A = base) | dense1m | 20.53 / 21.13 | 15.71 / 16.33 | **1.31×** [1.29, 1.34] | 1.29× [1.20, 1.39] | 1.32× [1.29, 1.34] | 1.36× | 1.017 [1.006, 1.042]; hier. 1.011 [0.996, 1.042] | 0.981 [0.966, 1.016]; hier. 0.997 [0.965, 1.022] |
| order 1 (A = base) | bot256 y60 | 17.91 / 19.44 | 13.02 / 13.92 | **1.38×** [1.26, 1.49] | 1.40× [1.30, 1.51] | 1.40× [1.38, 1.42] | 1.44× | 0.997 [0.967, 1.025]; hier. 1.013 [0.864, 1.149] | 1.022 [0.945, 1.092]; hier. 1.022 [0.934, 1.152] |
| order 2 (A = B1) | bot256 y60 | 22.34 / 22.61 | 15.60 / 15.90 | **1.43×** [1.38, 1.49] | 1.42× [1.35, 1.49] | 1.43× [1.41, 1.45] | 1.47× | 1.006 [0.969, 1.032]; hier. 1.001 [0.961, 1.061] | 1.006 [0.967, 1.034]; hier. 1.034 [0.980, 1.063] |

- **dense1m:** **1.31×** (CPU median), 1.29× (mean), 1.36× (wall). The A/A paired median is 1.017, inside ±3 %.
- **bot256:** 1.38× and 1.43× in the two orders. Both are well above 1.2×, but I count them as **provisional**:
  - the A/A and B/B hierarchical intervals are wider than ±3 % (0.86–1.15 in the first order);
  - the absolute ms/day moved 15–25 % between the two runs while the ratio held.
  They run again with dense1m's reverse order.
- **Determinism inside each arm:** true in every run. **Protectors:** intact in all 4 isolates.

## Still to run

- **dense1m, reverse order (A = B1).** The first attempt stopped at round 13 of 24 and wrote no result.
- **bot256, both orders again**, aiming for an A/A within ±3 % on the hierarchical median as well.
- **Then** the final report and `docs/dev/queue/T015-b1-services-trigger.done`.

## Who wrote what

- **Codex** (max effort): the trigger list, the input tracking, the urgent flags, the live cap, the two `actions.ts`
  hunks and 23 of the 24 tests.
- **Me (Claude):**
  - the brief;
  - the review, which found the strike gap; I wrote the strike trigger and its test;
  - every gate: tests, tsc, full vitest, balance, latency on real cities, D1, old saves, the speed A/B, frames mode;
  - the multi-seed tourism check;
  - the new baseline key.
