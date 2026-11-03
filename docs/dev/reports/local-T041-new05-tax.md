# T041 — NEW-05 gradual tax response

Branch `local/T041-new05-tax`, based on `fb1531f`. Changes are uncommitted; no push or `.done` file.

## Current status — selected model recorded

Paired model **M = 1.15** passes the 128 × 15 seed-7 base gates, all five fixed-tax sweep rows, and the strict
256 × 25 seed-11 prefix gates, including every historical phase0 population floor. An independent source-bundle
128 run reproduces all fifteen yearly state hashes.

`BALANCE=1` passes every 128-tile base gate and wrong-choice comparison on the selected source, and all 130
focused cases pass. Both selected 256 × 60 base runs pass every driver gate. The late-tax comparison passes with
**12.6490% fewer people**, and the fixture now records all 135 selected rows under `polish` with historical arrays
unchanged. Source parameters and measured results are finalized for review.

**D2 approval remains pending:** the base population changes **+18.4786%**. Actual 256-tile Vitest and the final
typecheck pass. The lead's full-suite/browser checks and D2 sign-off remain outstanding.

## Formula and scope

`growth.ts` retains the existing wanted allowance `w[d]`, eligibility, bank/debt rules and building-size limits.
For each eligible subtype, `r[d] = min(1, demand[d] / 0.575)`. Each family computes `W = sum(w[d])` and
`R = sum(w[d] * r[d]) / W`. Its throughput ceiling `C` becomes `C * R`, and each eligible subtype receives
`w[d] * min(1, C * R / W)`. Empty families receive zero. Capping each subtype response before averaging prevents
hot demand in one subtype from masking weaker demand elsewhere, while preserving wanted subtype proportions.

The selected throughput constants are:

| Constant | Original branch | Selected model |
|---|---|---|
| `GROWTH_DEMAND_FULL` | No demand response | 0.575 |
| `GROWTH_MAX_BASE` | R 18, C 7, I 8 | R 24.15, C 9.2, I 10.35 |
| `GROWTH_MAX_FRAC` | 0.0006 | 0.000805 |
| `GROWTH_MAX_SCALE` | 25000 | 25000 |
| `GROWTH_RESPONSE` | 0.06 | 0.06 |

Above 9%, `taxFactor` is
`clamp(1 / (1 + 0.5 * TAX_SENS[d] * (rate - 9) / 9), TAX_FACTOR_MIN, TAX_FACTOR_MAX)`.
At and below 9%, the original expression and clamp are unchanged. Desirability sensitivities, tax income and
approval rules are unchanged.

No RNG draw sites or serialized simulation keys were added. Old saves retain their demand smoothing and growth
carry; the response applies on subsequent simulation days. The bot's optional `taxStartYear` save metadata
describes its run and adds no simulation-state key. No worker, UI/game, infra or cloud-held file was changed.

## Calibration rationale

The capped M = 1 model passed the short tax sweep and seed-7 gates, but failed seed-11 phase0 population floors
in 2007–2023. Increasing caps alone also increased weak-demand throughput and flattened or reversed the first
tax step. Pairing the cap multiplier with the demand threshold avoids that compensation error.

Let `C0` denote the intermediate compensated ceiling with bases `21/8/9` and fraction `0.0007`. With multiplier
`m`, both the ceiling and threshold scale: `C = m * C0`, `FULL = 0.5 * m`. Each wanted-weighted contribution is
therefore `C0 * m * min(1, demand / (0.5 * m)) = C0 * min(m, 2 * demand)`. At a given city state, weak
contributions with demand at most 0.5 retain their throughput; hotter demand gains headroom instead of being
clipped early. This preserves tax elasticity while accelerating the starter city.

M = 1.10 failed because the 11% → 12% population increased. **M = 1.15 is the smallest passing paired multiplier
tested**, rather than a claim of a global minimum. Its larger base trajectory is reported for the lead's sign-off.

## Base-bot result and determinism

The selected 128 × 15 seed-7 run reaches **`[73577, 111744, 43223] = 228,544`** in 2015, compared with the b3
reference `[61124, 93804, 37971] = 192,899`. Changes are `[+12453, +17940, +5252]`, total **+35,645
(+18.478582055894535%)**. Its funds are 208,751, minimum sampled daily funds 5,884, approval 79.38 and maximum EQ
by year 15 101.0318. Both the diagnostic base and independent source run report `failures: []`.

Evidence: `grid-capped-paired-M1.15-base128.json` and `accepted-base-128.json`. All fifteen canonical yearly hashes
match between these independent processes. Hashing pins `Date.now()` to zero, sorts serialized object/Map/Set
keys, preserves array order and hashes typed-array bytes. The 2015 SHA-256 is
`a73525af96afe00b780aea3f616ef3cf0f24e91a209832af6595cdb2fc3d7b1b`.

## Fixed-tax sweep

128 × 15, seed 7, Medium, plains, water 0.2; all twelve rates are fixed from setup.

| Tax | 2015 population | Loss from previous rate | Loss from 10% | Funds | Approval |
|---|---:|---:|---:|---:|---:|
| Base mayor, managed rates | 228,544 | — | — | 208,751 | 79.38 |
| 10% | 247,701 | — | 0% | 674,628 | 78.29 |
| 11% | 215,438 | 13.0250% | 13.0250% | 714,769 | 74.37 |
| 12% | 194,858 | 9.5526% | 21.3334% | 1,182,632 | 70.53 |
| 13% | 178,213 | 8.5421% | 28.0532% | 1,145,283 | 67.87 |
| 14% | 163,216 | 8.4152% | 34.1077% | 1,605,781 | 60.93 |

**All four one-point steps pass the 3–15% gate.** Population decreases monotonically throughout 10–14%.
Evidence: `grid-capped-paired-results.json`, selected M = 1.15 entry, and
`grid-capped-paired-M1.15-tax-{10,11,12,13,14}.json`. Fixed-tax runs gate population response; managed-tax runs gate
ordinary base balance. The 13% and 14% records include old `partB` population-floor misses, which are recorded
rather than counted as failures of the tax-sweep acceptance.

Equivalent simbot commands:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 10
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 11
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 12
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 13
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 14
```

## Long-run gates

The selected model's **256 × 25 seed-11 prefix passes with `failures: []`**, including every phase0 floor.
It has 195,471 people in 2015 and 496,823 in 2025, residents `[172278, 224208, 100337]`, minimum sampled daily funds
5,317 and maximum EQ 113.0006. Evidence: `grid-capped-paired-M1.15-prefix256s11.json`.

The selected source's **256 × 60 seed-7 run passes with `failures: []`**. It reaches **1,654,270** people in 2060,
residents `[516391, 775252, 362627]`, funds **23,961,672**, and minimum sampled daily funds **4,242**. Its 2015
population is 199,510; in 2030 it has **717,660** people and funds **3,209,438**. The 2030 prefix supplies the base
for the completed late-tax comparison. Evidence: `accepted-base-256-s7.json`.

The 2060 canonical state SHA-256 is
`b977b3d40f7fd53f042a378b5e70f9580f7c921ccb7c1aedb0aace4ebe07c35c`.

The selected source's **256 × 60 seed-11 run also passes with `failures: []`**. It reaches **1,632,302** people in
2060, residents `[504458, 770053, 357791]`, funds **24,659,932**, and minimum sampled daily funds **5,317**.
Evidence: `accepted-base-256-s11.json`. Its 2060 canonical state SHA-256 is
`1f57eb2513b1f01192c095f9c2029c626a50933812db6d81fd9f49c6800d2f0b`.

| Required check | Status |
|---|---|
| 128 × 15 seed-7 base and independent state hashes | Passed |
| Fixed 10–14% tax sweep | Passed |
| 256 × 25 seed-11 historical prefix | Passed |
| 256 × 60 seed 7, all driver base gates | Passed: 1,654,270 in 2060 |
| 256 × 60 seed 11, all driver base gates | Passed: 1,632,302 in 2060 |
| 256 × 30 seed 7, 12% from year 21, at least 3% below base | Passed: 12.6490% below base |
| `BALANCE=1` 128-tile wrong-choice and base acceptance | Passed: 1 passed, 1 skipped |
| Actual 256-tile balance Vitest after fixture recording | Passed: 1 passed, 1 skipped in 172.45 s |
| Selected-model targeted tests | Passed: 130 cases across nine files |
| Final typecheck | Passed: exit 0 |
| `polish` fixture recording | Recorded: 15 / 60 / 60 rows; historical values and bytes unchanged |
| Lead full-suite and browser checks | Outstanding |
| D2 sign-off | Pending: +18.4786% base population |

The selected late-tax run completes with `failures: []`. In 2030, the base has **717,660** people against
**626,883** with 12% taxes from year 21: **−90,777 (−12.649026001170471%)**, passing the required 3% reduction.
The taxed residents are `[219855, 288556, 118472]`; funds are **12,199,843**, against the base's **3,209,438**.
Both have minimum sampled daily funds of **4,242**.

Evidence: `accepted-tax12-from21-256.json` and `accepted-late-tax-comparison.json`. The latter asserts exact
equality of the first twenty annual metrics and first nineteen yearly state hashes. At year 20, finance changes
the tax array at the day-7200 boundary, so that hash differs as expected while year-20 metrics remain identical.
The base's 2030 prefix comes from its 60-year run because the horizon controls the loop, not mayor strategy.

All selected long-run and late-tax measurements above are from this model; no earlier candidate's results are used.

```text
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11
npx tsx tools/simbot.ts --size 256 --years 30 --seed 7
npx tsx tools/simbot.ts --size 256 --years 30 --seed 7 --tax 12 --tax-start-year 21
```

## Actual quiet-gated fallback commands

`npx tsx` is unavailable in the offline npm cache (`ENOTCACHED`). Execution uses local rolldown bundles and one
quiet-gated Node driver at a time. The driver imports `SimBot`/`botSystems`, records balance gates and canonical
hashes, and pins `Date.now()` to zero without changing gameplay. From the worktree:

```powershell
$T041Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T041/scratch'
$T041Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node node_modules/rolldown/bin/cli.mjs "$T041Scratch/check-gates.ts" --platform node --format esm --dir "$T041Scratch/accepted-gates"
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-256-s7.json" --size 256 --years 60 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-256-s11.json" --size 256 --years 60 --seed 11 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-tax12-from21-256.json" --size 256 --years 30 --seed 7 --quiet --tax 12 --tax-start-year 21
foreach ($T041Tax in 10..14) {
  node $T041Quiet node "$T041Scratch/grid-capped-paired-M1.15/check-gates.js" "$T041Scratch/grid-capped-paired-M1.15-tax-$T041Tax.json" --size 128 --years 15 --seed 7 --quiet --tax $T041Tax
}
node $T041Quiet node "$T041Scratch/grid-capped-paired-M1.15/check-gates.js" "$T041Scratch/grid-capped-paired-M1.15-prefix256s11.json" --size 256 --years 25 --seed 11 --quiet
```

The source-bundle and diagnostic commands reproduce the recorded short, both long-base and delayed-tax measurements.

## Bot start year

`--tax=N` already fixes every DevType from setup and overrides monthly tax management. New `--tax-start-year N`
(also `=N`) keeps normal management before that year, then fixes all twelve rates before advancing its first day.
Year 21 begins at day 7200. Finance at that boundary also applies the fixed rate; year-20 population remains the
same while its saved tax-rate array can differ. Parsing requires a positive safe integer within the run and
`--tax`. The option is documented and included in bot save metadata.

## File scope and tests

- `src/sim/economy/growth.ts`: capped subtype responses averaged by wanted growth, applied to the family ceiling.
- `src/sim/economy/tuning.ts`: demand-response threshold, compensated caps and reciprocal demand-tax coefficient.
- `src/sim/economy/demand.ts`: the above-neutral reciprocal target penalty.
- `tools/simbot.ts` and new `tests/sim/botTaxStart.test.ts`: delayed fixed-tax runs and their boundary behavior.
- New `tests/sim/taxResponse.test.ts`: growth response, banking, determinism, legacy continuation and tax-curve cases.
- `tests/sim/balance.test.ts`: task-authorized minimal gate hunk outside the explicit owns list, comparing current rows through
  `baseline.reference` instead of hardcoded `partB`; historical phase0 gates remain independent.
- `tests/sim/fixtures/balance-baseline.json`: task-authorized gate edit outside the explicit owns list; reference is
  now `polish`, with 135 new rows (15 / 60 / 60) and one prepended T041 note marking D2 approval pending. Every
  historical array's values and source bytes are unchanged; no other fixture keys were edited.
- `docs/dev/reports/local-T041-new05-tax.md`: formula, sweep, gate evidence, remaining checks and cloud requests.
- No `src/sim/infra/*` hunks and no cloud-held file edits.

The standard Vite configuration hit `spawn EPERM` in Windows `net use` optimization. A scratch native Vite
configuration with `resolve.preserveSymlinks: true` and a thread pool allows targeted checks without repository
configuration/dependency edits. Every vitest command uses the quiet gate and one worker.

All **130 cases across these nine files pass on the selected model**, recorded in `targeted-results.json`:

| Test file | Cases |
|---|---:|
| `tests/sim/taxResponse.test.ts` | 46 |
| `tests/sim/botTaxStart.test.ts` | 15 |
| `tests/sim/botLongGame.test.ts` | 28 |
| `tests/sim/growth.test.ts` | 12 |
| `tests/sim/economy.test.ts` | 12 |
| `tests/sim/balanceEconomy.test.ts` | 10 |
| `tests/save/serializePhase0.test.ts` | 4 |
| `tests/save/continuity.test.ts` | 2 |
| `tests/save/grownCity.test.ts` | 1 |

Final `npx tsc --noEmit` passed with exit 0. Selected-model `BALANCE=1` single-file Vitest passed: **1 passed,
1 skipped in 80.19 s**, including all 128-tile base gates and all wrong-choice comparisons against `b3` before the
fixture advanced to `polish`. The 256-tile test is skipped in that mode.
`tests/worker/hygiene.test.ts` previously passed **17 cases, 1 skipped**; the subsequent changes are simulation
constants and do not alter UI/game ownership. Full-suite and browser execution remain with the lead. No performance
benchmark or browser was run.

After fixture recording, the actual 256-tile balance test passed with `BALANCE=256` and
`--testNamePattern '256 x 60 seed 7: the spec gates'`: **1 passed, 1 skipped in 172.45 s**, through the quiet gate
with one worker. The name filter skips the separately passing 128-tile case.

Exact balance commands and equivalent single-file reproduction of the nine focused files, using the scratch
variables defined above:

```powershell
$env:BALANCE = '1'
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native
$env:BALANCE = '256'
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --testNamePattern '256 x 60 seed 7: the spec gates'
$T041TestFiles = @(
  'tests/sim/taxResponse.test.ts',
  'tests/sim/botTaxStart.test.ts',
  'tests/sim/botLongGame.test.ts',
  'tests/sim/growth.test.ts',
  'tests/sim/economy.test.ts',
  'tests/sim/balanceEconomy.test.ts',
  'tests/save/serializePhase0.test.ts',
  'tests/save/continuity.test.ts',
  'tests/save/grownCity.test.ts'
)
foreach ($T041TestFile in $T041TestFiles) {
  node $T041Quiet npx vitest run $T041TestFile --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native
}
npx tsc --noEmit
```

Final scope audit passes `git diff --check`: exactly nine expected changed files on `local/T041-new05-tax`, all
valid UTF-8 without a BOM. No commit, push or `.done` file was created.

The tax unit test's floating-bound tolerance is `+1e-10`, correcting a 3.5e-15 roundoff discrepancy. No numeric
balance acceptance threshold was changed.

## Plan/code differences and cloud requests

- The plan's 194,627 historical baseline predates this branch's 192,899 b3 reference.
- The D14 decision-table row still assigns part-B triage, while the preceding lead answer assigns NEW-05 first.
- Steepening the old linear target penalty brings the coupled jobs/residents threshold earlier. The selected
  response instead exposes throughput to demand and retains target headroom through the reciprocal curve.
- The selected base moves +18.48%, rather than a small decline. This is reported for D2 review; no acceptance floor
  was relaxed to obtain the selected short/prefix passes.
- Cloud request after candidate acceptance: `src/ui/panels/BudgetPanel.ts`, `renderTaxes()`, replace “above 13%
  demand collapses” with growth copy such as “about 10% fewer people per point in the 10–14% sweep” (measured range
  **8.4–13.0%**); 9% remains approval-neutral. `taxColor()` needs FH-09's population reference clarified. With fixed
  10% as the reference, both the first adjacent and cumulative loss of at least 10% occur at **11%** (13.0250%).
  Against the managed-rate base of 228,544, 11% is only **5.7346%** lower, while 12% is **14.7394%** lower;
  that interpretation first crosses 10% at **12%**. Recommend the fixed-10% sweep interpretation and a red boundary
  at 11%; the owner should resolve the reference with the lead before replacing the current 13.5% boundary.
- Cloud request after candidate acceptance: `src/sim/economy/advisors.ts`, GUIDE's `taxHigh` finance rule, replace
  the same collapse claim. Its owner should update the pinned sentence in `tests/sim/taxHighAdvice.test.ts` too.
- Historical fixture arrays were preserved in values and source bytes; all 135 new base rows are under `polish`,
  with D2 sign-off pending.

## Browser checklist for the lead

- [ ] From the same developed-city checkpoint, fix every rate at 10%, 12% and 14% in separate continuations;
  demand/construction respond gradually, and rates persist through month boundaries.
- [ ] At a year-20 checkpoint, apply 12% for the next ten years and compare growth with the matching base continuation.
- [ ] Load an older Medium/Hard save and continue through several month boundaries; existing buildings, carry,
  demand smoothing and controls continue normally.
- [ ] Check Budget/advisor wording and the chosen FH-09 red boundary after the cloud owner updates them.
- [ ] Confirm the response remains visible with the worker host enabled.
