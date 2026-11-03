**T044 / LG-07 — scoped implementation, acceptance misses remain**

Branch `local/T044-lg07-industry`, task base `fb1531f`. Changes are uncommitted. No commit, push or `.done` file was made.

The 256 clean-city population gate passes. The 128 clean city reaches 80.15% of the same-code base, but only 79.75% of the fixed b3 base; it misses a strict §8.0-baseline reading by 480 residents. The 15% air improvement, high-tech deadline and strict yearly base tolerance also miss. Clean-city approval improves by 2.11 points over the run, but only 0.49 points at year 60; the latter misses a year-60 reading of the +1 requirement. This is not an all-gates-passed handoff.

**Final changes per file**

- `src/sim/economy/demand.ts`: refused dirty targets move through a saved, deterministic 360-day moving average. Sustained refusal reaches 50% I-M and, strictly above EQ 70, 25% I-HT after 12 months; the additions also unwind over 12 months. Refusal covers missing usable IndMed frontage, Clean Air Act and Industrial Pollution Controls without double counting. Conversion happens before tax, then receives the destination sector's tax/ordinance modifier once. Existing dirty capacity is not converted. Clean additions still meet caps and labour limits. Unplaceable dirty demand cannot reserve workers; occupied growable lots retain labour limits because redevelopment remains possible.
- `demand.ts`: the native I-HT target has a 30% floor reached at EQ 110, leaving the native formula unchanged through EQ 100 and rejoining it at EQ 130. This fixes the old 20% target at EQ 110, but does not guarantee realized jobs.
- `demand.ts`: optional `systemData.economy.industry` stores the ramp and strategy metrics. Exported `industrialStrategy(state)` returns a read-only metrics copy, or `undefined` for missing data, without initializing or writing the replica. Fields are `refused`, `retooledIM`, `retooledIHT`, `dirtyShare` and `airAtHomes`. Retooled jobs are additions to demand targets after receiving modifiers, before caps/labour; dirty share uses filled industrial jobs including farms. Air is the existing resident-weighted `stats.avgAir`.
- `src/sim/economy/tuning.ts`: adjacent `RETOOL_*` constants and one separate shared-table hunk, `CO3.soil = -0.3`.
- `src/sim/economy/desirability.ts`: I-D loses 0.03 per 10 EQ above 90, including fractional EQ. Stored layers and the inspector use the same penalty; the inspector explains educated workers avoiding smokestacks. Soil detail names Brownfield Cleanup.
- `src/sim/economy/ordinances.ts`: retooling and cleanup descriptions. Existing ordinance prices and effects are unchanged.
- New `tests/sim/industryRetooling.test.ts` (7 tests): ramp/upkeep, refusal sources, EQ gate, receiving taxes and no double taxation, exact save/load and optional old data, read-only metrics/caps/headroom, occupied-district redevelopment headroom.
- New `tests/sim/industryCosts.test.ts` (4 tests): EQ thresholds and stored/breakdown agreement; R/CO$$$ soil penalties; contamination accumulation, demolition persistence, save/load and faster cleanup; ordinance wording.

**Infra hunks: none. Hunks outside the named production files: none.** Experimental bot/growth changes were removed. `tools/simbot.ts` and `src/sim/economy/growth.ts` have no final diff. No cloud-held file was edited. No new RNG calls or listeners were added. These are intentional common economy balance changes, so Medium/Hard are not claimed bit-identical to dev.

**Checks**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass on final code |
| `git diff --check` | Pass |
| Quiet-gated `tests/sim/industryRetooling.test.ts` | Cannot start: Vite config loader / externalize-deps raises `spawn EPERM` |
| Quiet-gated `tests/worker/hygiene.test.ts` | Same startup failure |
| `industryCosts.test.ts`, existing desirability tests, full Vitest | Not executed; full suite is reserved for the lead |
| Standalone Node assertion probe | Pass: linear ramp, exact ramp/demand save/load, unwind, I-D EQ penalty, CO3 soil, industrial soil persistence/cleanup, donor tax not charged twice, receiving taxes, and occupied dirty redevelopment headroom |

Probe source/output: scratch `industry-probe.ts`, `industry-probe.mjs`, `industry-probe.json`. This is probe evidence, not a claim that Vitest's 11 new cases ran. In the soil probe, contamination was 0.144592 after 36 months; 12 months after demolition it was 0.141160 naturally versus 0.128165 with cleanup.

**Final bot gates**

All runs are Medium, plains, water 0.2, seed 7, full infra, normal strategy flags. Air means are means of yearly resident-weighted air samples, matching LD15a in `balance.test.ts`, rather than the last year's air. Baseline tolerance comparisons use annual population.

| Gate | Measured result |
|---|---|
| 128x15 clean population >= 0.8 x base | Same-code comparison **0.801513** (153,840 / 191,937). Fixed b3 comparison **0.797516** (153,840 / 192,899): **miss**, requiring at least 154,320 residents |
| 128x15 mean air >= 15% cleaner | **Miss:** 0.049656949 vs 0.057498336 = **13.6376% cleaner** |
| Existing LD15a “no dirty industry: air over the run” | **Pass by reproduced inputs:** clean mean < base mean; the test itself could not start |
| Other existing clean-industry assertions | Reproduced inputs satisfy population < 0.9 x base and peak unemployment > 0.04 (0.074110) |
| 256x60 clean population within 3% of base | **Pass:** 1,509,462 / 1,505,488 = **1.002640** (+0.2640%) |
| Keep +1 approval | Run mean **+2.10611** (76.33045 vs 74.22434); year 60 **+0.48813** (80.71112 vs 80.22299). Pass if assessed over the run; miss if assessed at year 60 |
| Base 128 within +/-1% of b3 rows | **Pass:** worst and final -0.4987%; b3 final 192,899 |
| Base 256 within +/-1% of every b3 row | **Miss:** 2053 -1.6477%, 2056 -1.3670%, 2058 -1.1540%, 2059 -1.3246%. Final -0.5514% (1,505,488 vs 1,513,835) is within tolerance |
| EQ >=100 by year 15 / 30 | **Pass:** 128 base/clean 103.582 / 108.591 by year 15; 256 base/clean 120.387 / 124.457 by year 30 |
| Employment ledger error <=0.02 | **Pass:** worst across all four runs **0.00262472** |
| I-HT >=25% by 2040 at EQ>=110 | **Miss:** base first reaches EQ110 in 2024, has 0% I-HT in 2040 and 10.0006% in 2060. Clean has 7.0945% in 2040, first reaches 25% in 2052, and ends at 27.7086% |

Final 128 base residents are **[60,544, 94,177, 37,216] = 191,937**, replacing dev's [61,124, 93,804, 37,971] = 192,899 by design. Clean residents are [43,529, 74,950, 35,361] = 153,840. Final 256 base/clean residents are [415,049, 732,020, 358,419] and [364,672, 770,694, 374,096].

Authoritative diagnostics are the four scratch files `final-128-base.json`, `final-128-clean.json`, `final-256-base.json`, `final-256-clean.json`, plus `final-summary.json`. Other scratch run files are discarded prototypes, not final results.

**Commands and measurement method**

The prescribed simbot command lines for reproduction are:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --skip dirty --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --skip dirty --quiet
```

`tsx` is absent locally. I used the existing `tools/balance-json.ts` precedent: rolldown bundled scratch `industry-gates.ts`, which calls the unchanged `parseArgs`, `SimBot` and `botSystems`, and records annual data in `SimBot.run`'s callback. The employment calculation is copied from `balance.test.ts` (including unknown-access worker fallback). Every bot ran through the quiet gate, one at a time. Actual final commands, from this worktree:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/gate-bundle/industry-gates.mjs --size 128 --years 15 --seed 7 --quiet C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/final-128-base.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/gate-bundle/industry-gates.mjs --size 128 --years 15 --seed 7 --skip dirty --quiet C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/final-128-clean.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/gate-bundle/industry-gates.mjs --size 256 --years 60 --seed 7 --quiet C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/final-256-base.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/gate-bundle/industry-gates.mjs --size 256 --years 60 --seed 7 --skip dirty --quiet C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/final-256-clean.json
```

**Plan versus code and remaining requests**

- Soil already exists as saved `st.soil`: pollution accumulates it under I-D, retains it after demolition and applies the cleanup multiplier. R already had negative soil weights. The missing requested term was CO$$$, so no duplicate map, infra edit or save schema was added.
- Current fixture reference is **b3**, not the plan's historical 194,627/1.547M rows or LG-10's older report numbers.
- The remaining high-tech blocker is chiefly the bot/placement path, not absence of an I-HT target. `SimBot.zoneFor()` requires displayed IHT >0.25 and >= ID; `zoning()` requires >0.35 for dedicated land; `density()` requires >0.4 and negative ID demand for conversion. The displayed value has already been reduced by shared labour headroom. In 2024 the base is EQ110.91 with no high-tech jobs/land and an IHT bar of about 0.020; in 2040 it is EQ128.50 with 0 jobs and a 0.190 bar. Raising the share alone cannot make the unchanged bot supply useful land in time.
- **Follow-up request, `tools/simbot.ts`, `zoneFor` / `zoning` / `density`:** jointly balance high-tech land planning against unmet targets before labour throttling, viable clean sites and occupied/construction capacity. A target-gap-only prototype supplied land earlier but still missed realized share and the population tolerance; a cleaner-site prototype also missed. These are not retained as unvalidated bot changes.
- **Follow-up request, `src/sim/economy/growth.ts`, `tryRedevelop`:** decide how live I-HT should compete with larger I-M redevelopment, including neighbouring lots in the new footprint. Current code allows subtype replacement and credits removed capacity to the new type. A prototype preserving I-HT plus a stronger target met the share deadline but missed base population badly, so imposing that rule alone is not a balanced fix. No growth hunk remains.
- The air target remains 1.3624 percentage points short. Pollution generation/power strategy was not changed to force this gate. The four strict base-row misses and the endpoint approval shortfall also need lead balance review. No baseline fixture was weakened or re-recorded.
- Existing `balance.test.ts` still expects the clean city below 0.9 x base and peak unemployment above 0.04; the final run satisfies those, so this item did not need to change that older test.

**Cloud / GUIDE requests**

- `src/ui/TopBar.ts`, `buildRciPop()` and the RCI portion of `update()` (or the split RCI component): use `industrialStrategy(ctx.state)` to add “Retooled from refused factories: +… I-M jobs”, plus I-HT when nonzero. These are demand-target additions, not a claim of filled employment. Missing optional data should hide the line or show Updating; do not call an initializing economy helper on the replica.
- `src/ui/panels/StatsPanel.ts`, `build()` / `update()`: add “Industrial strategy” with filled dirty-job share, resident-weighted air at homes, retooled I-M/I-HT target jobs, using the same accessor and mirrored `ctx.state`.
- No Worker protocol/query change is needed: `systemData.economy` is already mirrored wholesale. Any added listeners must use `ctx.signal`. No cloud-held source was changed.

**Left for the lead / not verified**

Run the two new test files, existing desirability/ordinance/save tests, Worker hygiene/query checks and the full Vitest suite in an environment that can start Vite. The actual slow `balance.test.ts` case was not executed, although its dirty-strategy inputs were reproduced above. No browser, GPU timing, benchmark, seed-11 run, full-city two-process state hash, or Worker packet/frame-cost measurement was performed. Re-run the four final bot gates after any follow-up balance or bot change.

Browser checklist (all unchecked; the two new strategy lines require GUIDE's changes first):

- [ ] With no usable IndMed room, watch I-M target additions ramp over 12 months; check I-HT is zero at EQ70 and enabled above it. Restore room and check the ramp unwinds without a jump.
- [ ] Enable Clean Air Act and Industrial Pollution Controls separately and together; confirm their copy, costs and non-duplicated target additions. Confirm receiving-sector taxes affect replacements once.
- [ ] Compare an I-D lot at EQ90/95/110 after its desirability refresh: penalty 0 / -0.015 / -0.06, with the educated-workers inspector reason matching the stored layer.
- [ ] Demolish an old dirty lot and rezone R or CO$$$: soil and its penalty persist. Enable Brownfield Cleanup and confirm faster gradual recovery in the Soil view and inspector.
- [ ] Check the RCI and Stats strategy lines against host-mirrored metrics, including old saves without the optional payload, both with the pollution overlay closed and open.
- [ ] Save/load partway through the ramp; confirm no reset or instant conversion and normal continued play. Check ordinance descriptions wrap at 720p.
- [ ] Inspect a mature EQ110+ city's actual I-HT jobs, not just its demand bar; the final bot still misses the 2040 share target as reported above.
