**T044 / LG-07 — round 2 review: base gate remains unresolved**

Branch `local/T044-lg07-industry`, supplied WIP commit `adeda44`, task base `fb1531f`. This round changes only this report. Production code, tests and fixtures remain at the supplied WIP; all switches and rejected candidates are scratch-only. No commit, push, merge or `.done` file was made.

The base drift is isolated to the interaction of the required I-D EQ penalty and the added high-tech floor. Retooling and the new CO$$$ soil weight do not move these base population rows. Neither removing an individual contributor nor the four scoped floor corrections below satisfies every yearly ±1% row. I stopped further balance tuning before changing the clean bot, as requested. The report provides measured trade-offs; it does **not** prove that no broader coordinated rebalance could meet the targets.

**Changes per file / ownership**

- `docs/dev/reports/local-T044-lg07-industry.md`: replaces the round-1 handoff with this quantified review, diagnostic methods, decisions and remaining checks.
- No new production or test changes. The committed WIP still owns `demand.ts` (saved 12-month ramp, 50% I-M / 25% I-HT above EQ 70, labour reservation and read-only strategy accessor), `tuning.ts` (30% high-tech floor and CO3 soil weight), `desirability.ts` (exact I-D EQ penalty and soil explanation), and `ordinances.ts` (copy).
- **Infra hunks: none. Hunks outside named production files: none. Cloud-held edits: none.**
- The optional payload remains `systemData.economy.industry`; `industrialStrategy(state)` exposes refused/retooled targets, filled dirty-job share and resident-weighted air through the existing economy mirror. No Worker protocol, host mutation, listener or RNG change was added this round.

**1. Base drift — isolated before other tuning**

The scratch bundler has separate `no-retool`, `no-eq`, `no-soil` and `no-floor` switches. Retooling-off disables both converted targets and the new I-D labour-reservation exemption. Soil-off restores only the new CO3 coefficient to zero; existing residential soil costs, contamination accumulation and cleanup remain. All switches off reproduces **every population row** of both b3 fixture runs exactly: 15/15 at 128 and 60/60 at 256. Controls end at 192,899 and 1,513,835.

| Scratch variant | 256 year-60 population | Worst yearly drift vs dev | Years outside ±1% | 128 year-15 population |
|---|---:|---:|---:|---:|
| WIP: all four on | 1,505,488 | -1.6477% (2053) | 4 | 191,937 |
| All four off (dev control) | 1,513,835 | 0.0000% (2001) | 0 | 192,899 |
| Retooling off, including reservation change | 1,505,488 | -1.6477% (2053) | 4 | 191,937 |
| High-tech floor off | 1,497,089 | -1.2907% (2058) | 4 | 191,937 |
| New CO$$$ soil weight off | 1,505,488 | -1.6477% (2053) | 4 | 191,937 |
| I-D EQ penalty off | 1,469,170 | -2.9505% (2060) | 8 | 192,438 |

The WIP's four failed rows remain:

| Year | Dev b3 | WIP | Drift |
|---|---:|---:|---:|
| 2053 | 1,392,709 | 1,369,762 | −1.6477% |
| 2056 | 1,455,861 | 1,435,960 | −1.3670% |
| 2058 | 1,488,790 | 1,471,610 | −1.1540% |
| 2059 | 1,504,810 | 1,484,878 | −1.3246% |

Retooling-off matches all recorded WIP annual numeric fields, not just population. Every base annual 360-day cohort has zero converted demand; the ramp cannot hide a positive refusal between those samples. Soil-off leaves all 60 base population rows identical. At 128, all four-on residents stay **[60,544, 94,177, 37,216] = 191,937**, versus dev **[61,124, 93,804, 37,971] = 192,899** (−0.4987%; all years within tolerance). Removing only the EQ penalty gives [60,844, 93,408, 38,186] = 192,438; removing the floor alone leaves population unchanged at this horizon but changes its demand bar.

The floor raises the EQ 110 I-HT target from 20% to 30%, taking I-M from 43.33% to 33.33% while base IndHigh land is absent. These targets also enter shared labour allocation. The exact required I-D penalty changes growth selection, stages and existing hiring. Their later development effects are coupled: subtracting the single-off population deltas is not a valid attribution.

Scoped corrections were tested with the penalty, soil and retooling retained:

| Rejected scratch correction | Year-60 population | Worst yearly drift | Failed years | I-HT in 2040 | I-HT in 2060 |
|---|---:|---:|---:|---:|---:|
| 30% floor funded from I-D; native I-M preserved | 1,465,334 | -3.2249% (2059) | 8 | 0.00% | 10.72% |
| 35% floor; ramp starts EQ 100 | 1,455,827 | -3.9028% (2059) | 8 | 0.00% | 10.39% |
| 28% floor; original EQ 90..110 ramp | 1,444,813 | -4.9302% (2059) | 9 | 0.00% | 10.75% |
| 30% floor; ramp starts EQ 100 | 1,446,788 | -4.4523% (2059) | 9 | 0.00% | 10.42% |

No correction was copied into production. No fixture was weakened or re-recorded. There was no subsequent clean-strategy tuning.

**2. 128×15 clean city — placement and air limits**

Fresh diagnostic runs reproduce the round-1 annual measurements exactly.

| Measure | Result |
|---|---|
| Clean year-15 population | **153,840** = [43,529, 74,950, 35,361] |
| Fixed-dev population ratio | **0.797515798**; needs 154,320, so short by **480** |
| Same-code population ratio | 153,840 / 191,937 = **0.801512996** |
| Mean air, WIP base / clean | **0.0574983363 / 0.0496569492** |
| Mean-air improvement | **13.6375895%**, short of 15% |
| Required clean mean air | ≤ **0.0488735859**; excess **0.0007833634** |
| Years 2001–2010 mean air, base / clean | 0.0459157744 / 0.0312233899 |
| Years 2011–2015 mean air, base / clean | 0.0806634602 / 0.0865240679 |

The metric is exactly LD15a's: the arithmetic mean of the **15 annual `stats.avgAir` samples**, each already resident-weighted at homes. It is not the last year's air, map-wide air, or a mean of source emissions. The all-off dev mean is 0.0572208005; using that denominator also fails 15%, so this is not a denominator escape.

Retooling helps substantially. With the entire retooling component off (including its reservation correction), the same clean scenario ends at **85,342** (0.442418× dev), with mean air **0.0327216642** (43.0911% cleaner than the WIP base). Enabling it adds **68,498 residents** in this paired experiment. That difference cannot be attributed solely to the ramp; the switch also restores the old reservation rule.

At year 15, refused dirty target is **21,189.448**. Its converted additions are **10,339.002 I-M** and **5,169.501 I-HT** after receiving modifiers. They are target additions, not tagged filled jobs.

| Sector | Raw target | Soft-capped target | Built working capacity | Filled jobs | Throttled demandAbs |
|---|---:|---:|---:|---:|---:|
| I-M | 28,997 | 27,579 | 11,730 | 10,972 | 135.731 |
| I-HT | 21,903 | 20,438 | 1,660 | 1,453 | 160.711 |

**The converted demand is not fully placed.** Staffing is relatively high within the capacity that exists; the missing target is principally unbuilt capacity. There is no IndMed, but I-M is permitted on IndHigh. The 1,128 IndHigh cells include 30 serviced vacant frontage cells. A deterministic scan mirroring `growth.fitNew`'s footprint, full-road-front, slope and utilities checks finds **zero valid empty lots for every I-M/I-HT definition, even 2×2 lots**. Those cells are fragmented remnants, not usable industrial room. This scan does not count occupied-lot redevelopment or claim disjoint packing capacity.

Labour throttling separately limits lot size. The annual snapshot's incremental growth capacity limit is **162.877 I-M** and **192.853 I-HT**; bank values are 242.004 for each, so absolute demand is the tighter size limit. For **new lots**, a 400-capacity I-M stage 4 needs demandAbs ≥333.333 and bank ≥120; a 620-capacity stage 5 needs ≥516.667 and bank ≥186. A 520-capacity I-HT campus needs ≥433.333 and bank ≥156. Redevelopment credits existing live capacity and charges net added capacity: I-M 110→400 needs demandAbs ≥241.667, exceeding the observed 135.731; I-HT 110→520 needs ≥341.667, exceeding 160.711. It also requires at least 1.6× the summed live capacity replaced, independently of the demand and bank checks. Raising raw retooling targets alone cannot bypass these throttled growth limits. The empty frontier also has mean I-HT desirability **−0.1374**, with **zero** frontage cells supporting stage 4; I-M's mean is **0.6623**.

The air miss is concentrated late. Clean home air jumps **0.0409807 → 0.0874559** from 2010 to 2011, when its first coal plant appears at (92,74). Power demand rises 180.09 → 210.10 MW; the new plant's cached air-source strength is 12.4765 at 31.45% load. In 2015 both strategies retain coal. Clean I-M also emits **103.537 source units** versus base I-M's **54.165**, despite similar filled I-M jobs, because the clean city has many more small factories (155 versus 46). Clean I-HT emits zero direct air. Source sums are not resident exposure attribution: traffic, spatial exposure, landfill and other sources remain, and a coal-to-gas counterfactual was deliberately not tuned after the base gate failed.

**3. High-tech pays — actual jobs, not target share**

The blocker in base is chiefly **bot land planning**. At its first qualifying EQ, 2024:

- EQ **110.9128**, zero IndHigh cells, zero I-HT jobs/capacity.
- I-HT raw target **42,176**, capped target **40,324**, but demandAbs **92.578** and displayed demand **0.019786**.
- Labour scale **0.008**, headroom **1,267**. The bot's dedicated IndHigh threshold is >0.35.
- By 2040, EQ **128.5040**, I-HT target **93,825** and raw target **115,949**, but still no IndHigh or I-HT jobs; the bar is **0.190**.

The floor already supplies a substantial target and does not get land placed in time. Every tested floor variant still has **0% base I-HT in 2040**. Base first fills I-HT in 2049 and ends at only **10.0006%**. Formula-only tuning did not solve this circular planning problem.

The clean variant already zones IndHigh, so its blocker is different. At EQ 110 in 2020 it has 1,212 IndHigh cells, but only 1,680 I-HT capacity / 1,428 jobs, versus target 27,269. Mean vacant-front I-HT desirability is −0.1168 and no front cell supports stage 4. In 2040 it has 1,185 IndHigh cells, **880 I-HT jobs** and target **71,253**; mean frontier I-HT desirability is **−0.3119** and again zero stage 4 cells. Small labs/data centers can lose to larger I-M redevelopment, while mature campus capacity has not been established. The clean share first reaches 25% in **2052**, twelve years after the deadline.

The following shares use filled jobs and include agriculture in the industrial denominator. These are every year where either city's EQ qualifies; both base EQ and clean EQ remain below 110 before 2020.

| Year | Base EQ | Base I-HT share | Clean EQ | Clean I-HT share |
|---|---:|---:|---:|---:|
| 2020 | 100.10 | 0.00% | 110.67 | 11.38% |
| 2021 | 102.20 | 0.00% | 112.68 | 11.39% |
| 2022 | 105.27 | 0.00% | 114.93 | 11.40% |
| 2023 | 108.29 | 0.00% | 117.18 | 11.41% |
| 2024 | 110.91 | 0.00% | 118.91 | 11.39% |
| 2025 | 113.04 | 0.00% | 120.34 | 11.17% |
| 2026 | 114.80 | 0.00% | 121.52 | 8.38% |
| 2027 | 116.28 | 0.00% | 122.46 | 8.38% |
| 2028 | 117.67 | 0.00% | 123.24 | 7.80% |
| 2029 | 119.08 | 0.00% | 123.90 | 7.70% |
| 2030 | 120.39 | 0.00% | 124.46 | 7.59% |
| 2031 | 121.59 | 0.00% | 125.11 | 7.61% |
| 2032 | 122.76 | 0.00% | 126.01 | 7.60% |
| 2033 | 123.83 | 0.00% | 126.85 | 7.05% |
| 2034 | 124.71 | 0.00% | 127.59 | 7.05% |
| 2035 | 125.46 | 0.00% | 128.21 | 7.04% |
| 2036 | 126.09 | 0.00% | 128.76 | 7.05% |
| 2037 | 126.78 | 0.00% | 129.18 | 6.88% |
| 2038 | 127.51 | 0.00% | 129.55 | 7.08% |
| 2039 | 128.09 | 0.00% | 129.95 | 7.07% |
| 2040 | 128.50 | 0.00% | 130.50 | 7.09% |
| 2041 | 128.77 | 0.00% | 130.93 | 6.53% |
| 2042 | 128.85 | 0.00% | 131.26 | 5.53% |
| 2043 | 128.89 | 0.00% | 131.40 | 4.46% |
| 2044 | 128.95 | 0.00% | 131.42 | 4.01% |
| 2045 | 129.18 | 0.00% | 131.36 | 2.31% |
| 2046 | 129.48 | 0.00% | 131.26 | 2.06% |
| 2047 | 129.74 | 0.00% | 131.36 | 1.88% |
| 2048 | 129.95 | 0.00% | 131.61 | 10.25% |
| 2049 | 130.13 | 0.59% | 131.83 | 16.40% |
| 2050 | 130.35 | 1.83% | 131.93 | 21.01% |
| 2051 | 130.61 | 2.92% | 132.01 | 24.46% |
| 2052 | 130.86 | 3.91% | 132.09 | 27.50% |
| 2053 | 131.07 | 5.07% | 132.13 | 30.36% |
| 2054 | 131.33 | 6.03% | 132.14 | 32.20% |
| 2055 | 131.51 | 6.43% | 132.06 | 32.89% |
| 2056 | 131.62 | 7.39% | 132.01 | 32.05% |
| 2057 | 131.71 | 8.23% | 132.00 | 30.58% |
| 2058 | 131.79 | 8.31% | 131.96 | 29.72% |
| 2059 | 131.91 | 9.24% | 131.92 | 29.34% |
| 2060 | 131.96 | 10.00% | 131.82 | 27.71% |

**4. Approval — exact monthly decomposition**

Approval is **80.222986 base / 80.711119 clean** in 2060: **+0.488133**, missing +1 by **0.511867**. The run means are 74.224337 / 76.330447: **+2.106110**.

Scratch observation captured each monthly approval term and applied the existing 0.3 EMA separately per term. Their sums reconstruct final approval to 1.5×10⁻¹⁴; this accounts for smoothing rather than substituting the final annual air snapshot.

| Clean minus base contribution | Mean over annual samples | Year-60 smoothed contribution |
|---|---:|---:|
| unemployment | +0.070295 | +0.329619 |
| services | +0.209273 | -0.311049 |
| parks | +0.492765 | +0.163123 |
| justice | +0.007458 | +0.091781 |
| crime | +0.397787 | +0.084748 |
| garbage | +0.065936 | +0.076039 |
| hq | +0.140354 | +0.074489 |
| pollution | +0.150562 | -0.071782 |
| emergencies | +0.086782 | +0.051882 |
| needs | +0.159577 | -0.034969 |
| noise | +0.290825 | +0.026908 |
| tapWater | +0.048259 | +0.007343 |
| tax | -0.177238 | +0.000000 |
| ordinances | -0.034347 | +0.000000 |
| civic | +0.136730 | +0.000000 |
| tourism | +0.061092 | +0.000000 |
| **Total** | **+2.106110** | **+0.488133** |

The earlier parks/crime/noise/services gains mostly fade. Services changes from +0.2093 over the run to **−0.3110** at the endpoint, almost cancelling unemployment's **+0.3296**. The unemployment formula scores only excess above 8%: base ends at 8.7249%, clean at 5.2317%; the whole 3.49-point employment difference does not earn approval. Pollution changes from +0.1506 over the run to **−0.0718** after smoothing. Annual home air is also worse in clean at the endpoint (0.176195 versus 0.169481). There is no explicit +1 clean-industry bonus to preserve; +1 is the plan's required observed outcome.

**decisions for the lead**

| Choice / trade-off | Measured consequence | Decision needed |
|---|---|---|
| Keep the supplied WIP | Best retained implementation remains four base-row misses, 79.75% fixed-dev clean population, 13.64% cleaner air, late high-tech and +0.488 endpoint approval | Not acceptance-complete |
| Remove the unproductive HT floor, retain required costs | Worst yearly base drift improves to 1.2907%, but still four misses; I-HT is 0% in 2040 and6.27% in 2060 | Requires a wider base tolerance and still needs HT placement work |
| Remove the required I-D penalty | Worst base drift becomes 2.9505%; no HT deadline benefit | Reject; it also violates the specified cost |
| Fund the floor from dirty demand, change its size or timing | Worst drift 3.2249–4.9302%; every variant remains0% HT in 2040 | Reject these isolated formula fixes |
| Permit coordinated default-bot HT planning and growth work | Needs land planning before labour throttling, viable campus sites and larger-lot progression; no passing default-row identity result exists | A default strategy change must either demonstrate identical default rows or receive a revised constraint; a clean-only branch cannot fix base HT |
| Later, try a small clean-only bot correction | `ensurePower`: replace selected coal with gas only under `skips('dirty')`; `zoning`: count usable industrial footprints rather than fragmented empty cells, and prefer viable campus sites | Authorized in principle by the review, but not tuned because the primary base gate is still unresolved; gas's higher cost/MW must be measured |

These results establish a practical conflict among the **tested scoped changes**, not mathematical impossibility for all future designs. I have not retained an arbitrary compensation to residential growth, a weakened EQ penalty, a free approval bonus or a re-recorded baseline. No default-bot or clean-only bot change is included.

**Checks and gates**

- `npx tsc --noEmit`: **pass**.
- Normal quiet-gated `npx vitest run tests/sim/industryRetooling.test.ts --maxWorkers=1`: still cannot start; Vite `externalize-deps / optimizeSafeRealPathSync` raises **spawn EPERM** while loading `vite.config.ts`.
- Scratch native-loader config, `preserveSymlinks: true`, thread pool, one worker: **industryRetooling.test.ts 7 passed; industryCosts.test.ts 4 passed; desirability.test.ts 20 passed; worker/hygiene.test.ts 17 passed, 1 skipped**. All ran through the quiet gate, serially. The config changes module resolution only for these diagnostic test processes; no repository config changed.
- All-off controls match all b3 population rows. Current WIP reference series match the fresh replay's recorded annual fields exactly for both sizes/strategies; the 256 base replay disables an inactive retooling component.
- Existing LD15a air assertion passes by reproduced inputs: 0.0496569492 <0.0574983363. The entire `balance.test.ts` file was **not** run.
- 256 clean year-60 population: **1,509,462 /1,505,488 =1.002640**, within3% (also within3% of dev's1,513,835).
- EQ gates pass: 128 base/clean EQ 103.582/108.591 at 2015; 256 base/clean EQ 120.387/124.457 by 2030.
- Maximum |unemp−(1−accW)| across the four WIP series: **0.002624722**, below 0.02.
- Required population/air/HT/approval misses remain as above. Full Vitest and browser checks remain with the lead.

**Reproduction / artifacts**

All commands ran from the named worktree, one bot/test/probe at a time. All bots and Vitest processes used the quiet gate. `tsx` is absent; the existing rolldown package bundled a scratch driver importing unchanged `SimBot`, `botSystems` and `parseArgs`. Source overlays are applied by a scratch-only transform plugin, with exact-anchor checks. Observation adds no RNG or simulation writes.

The prescribed simbot commands remain:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --skip dirty --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --skip dirty --quiet
```

Actual commands for every round-2 variant/replay are in [r2-allcommands.txt](C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-allcommands.txt). The serial replay driver is [r2-replays.mjs](C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-replays.mjs). Key data: [r2-summary.json](C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-summary.json), [r2-analysis.json](C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-analysis.json), [r2-fitprobe.json](C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-fitprobe.json). Bundler and scan sources are `r2-build.mjs`, `r2-diagnostics.ts` and `r2-fitprobe.ts` in the same scratch folder. All original `final-*.json` files remain unchanged.

The successful targeted-test form (one file per invocation) is:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/sim/industryRetooling.test.ts --config C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/r2-vitest.config.mjs --configLoader native --pool threads --maxWorkers=1
```

The same command was run separately for `tests/sim/industryCosts.test.ts`, `tests/sim/desirability.test.ts` and `tests/worker/hygiene.test.ts`. The lead should run the full suite using the standard project configuration in its normal environment.

**Plan versus code / cloud requests**

- The current fixture is **b3**, not the plan's older194,627/1.547M rows; all-off controls confirm the reference.
- Saved `st.soil`, I-D accumulation, persistence after demolition, residential penalties and Brownfield Cleanup's5× decay already existed. WIP added only the missing CO$$$ term; no duplicate map, infra edit or save schema was needed.
- Current frontage stock is not full-footprint capacity. The WIP's dirty-room heuristic also reads geometric frontage, so zero base retooling does not prove every prospective factory can fit. A shared read-only growth-fit query would support more accurate planning; do not infer room from empty-cell counts.
- Raw / capped target share is not realized filled-job share. The floor cannot meet the veteran's goal without usable sites and sufficient growth size/bank.
- **GUIDE / `src/ui/TopBar.ts` (or split RCI component), `buildRciPop` / `update` equivalent:** read `industrialStrategy(ctx.state)` for the retooled I-M/I-HT target additions. Label them demand-target jobs, not filled employment; hide missing optional data without initializing the replica.
- **GUIDE / `src/ui/panels/StatsPanel.ts`, `build` / `update`:** add Industrial strategy with dirty share, air at homes and converted target jobs from the same mirrored accessor. Any listeners must use `ctx.signal`.
- No new request for Worker, infra, save, region or other cloud-held production files. The UI requests above remain unimplemented.

**Not verified / left for the lead**

No accepted base fix exists. No combined all-gates-passing change was established. The full standard-config suite, actual complete balance test, browser behavior, seed 11, full-city two-process state hashes, GPU timings and Worker frame/packet costs were not checked. Identical annual replay measurements are not a full-state hash. No claim is made about untested gas/site-planning candidates.

Browser acceptance checklist (all unchecked; GUIDE lines need its follow-up):

- [ ] With no usable IndMed room, verify the 12-month I-M ramp, I-HT disabled at EQ 70 and enabled above 70; restore room and verify gradual unwind.
- [ ] Enable Clean Air Act / Industrial Pollution Controls separately and together; check copy, cost and conversion without double counting or double taxation.
- [ ] Inspect I-D at EQ 90/95/110: penalties0/−0.015/−0.06, matching the stored layer and reason.
- [ ] Demolish an old dirty lot, rezone R/CO$$$ and verify persistent soil costs plus faster gradual Brownfield Cleanup.
- [ ] Compare RCI/Stats numbers against host-mirrored targets, dirty jobs and air at homes; test old saves without the optional payload and overlay closed/open.
- [ ] Save/load mid-ramp, continue play and check no reset or instant conversion; check descriptions at 720p.
- [ ] In an EQ 110+ mature city, inspect actual HT filled-job share and industrial space, not just its demand bar. The bot deadline currently fails.
