# T041 — gradual tax response, A/B review

**Recommend B for the lead's D2 decision.** B is installed and passes the bot gates, both actual balance Vitest
checks under verified shadows, installed-source state-hash repeats, 152 focused cases and final typecheck.
All three dev endpoints meet ±3%, every fixed-tax step loses 3–15%, and delayed 12% taxes reduce population 6.2326%.
D2 approval, the full suite and browser checks remain with the lead.

Branch `local/T041-new05-tax`, based on `fb1531f`. A remains preserved in WIP commit `098d038`, the immutable
scratch bundles and the fixture's `polish` arrays. B is recorded separately as active `polishB`; every prior
array's values and source bytes are unchanged. Review changes remain uncommitted; no push or `.done` file.

**Annual-path limitation:** B's endpoints meet ±3%, but **95 of 135 annual population rows still differ by more
than 3%** from dev. Per-run mean absolute deviations are **2.7951% / 4.8103% / 3.9649%**, with maxima
**7.8926% / 10.6816% / 7.4622%**. A's corresponding means are 15.6010%/21.7405%/20.7406%, maxima
35.2734%/38.6721%/37.3086%. B substantially improves the annual path; it does not leave that path unchanged.

`S` below means the lane scratch folder, and `Q` the shared quiet gate; full paths appear with the commands.

## Decision evidence

| Gate | Dev / required result | Preserved A | Implemented B |
|---|---|---:|---:|
| 128 × 15 seed 7 | 192,899; ±3% range 187,112.03–198,685.97 | 228,544 (+18.4786%) | 193,831 (+0.4832%) |
| 256 × 60 seed 7 | 1,513,835; range 1,468,419.95–1,559,250.05 | 1,654,270 | 1,511,394 (−0.1612%) |
| 256 × 60 seed 11 | 1,427,340; range 1,384,519.80–1,470,160.20 | 1,632,302 | 1,468,252 (+2.8663%) |
| Fixed10→14% one-point population losses | Every step 3–15% | 8.4152–13.0250%: pass | 3.2565–12.8503%: pass |
| 12% from year 21, 256 × 30 seed 7 | At least 3% below same model's base | −12.6490%: pass | −6.2326%: pass |
| Base phase0/funds/EQ/utilities/emergency driver gates | All existing gates retained | Pass | All genuine gates pass |
| Actual balance/wrong-choice Vitest and final tsc | Required | Passed | Both verified shadows pass; installed-source tsc exit0 |

B's short residents are **`[62577,92903,38351] = 193,831`**, versus dev `[61124,93804,37971] = 192,899`:
`[+1453,−901,+380]`, total **+932 (+0.4831543968605332%)**. Its long deltas are **−2,441 (−0.16124610674214826%)**
for seed 7 and **+40,912 (+2.866310759875012%)** for seed 11. The completed annual-path comparison below qualifies
this endpoint agreement.

## Formula and unchanged constants

Both models retain the existing wanted allowance `w[d]`, eligibility, carry/debt banking and building-size limits.
For family `f`, `W = sum(w[d])` and `C = base[f] + frac * capacity / sqrt(1 + capacity / 25000)`.
Let `M = sum(w[d] * min(1, demand[d] / full[f])) / W` for positive W. Each subtype receives
`w[d] * min(1, C * response / W)`; empty families receive zero.

| Parameter | Dev | Preserved A | Implemented B |
|---|---|---|---|
| Family response | Existing cap clipping | `M`, scalar full=.575 | `M ** .1`, full `{R:1,C:.1,I:.1}` |
| Additive cap R/C/I | 18 / 7 / 8 | 24.15 / 9.2 / 10.35 | 19 / 8 / 9 |
| Capacity fraction | .0006 | .000805 | .0006 |
| Tax factor through 11% | Original linear, clamped | Original through9%; reciprocal above9% | **Exact dev expression through 11%** |
| Higher-tax response | Original linear | Reciprocal coefficient.5 | C1 rational tail, coefficient.3 above 11% |

A above9% uses `clamp(1/(1+.5*TAX_SENS[d]*(rate−9)/9), MIN, MAX)`. B through 11% retains
`clamp(1−TAX_SENS[d]*(rate−9)/9, MIN, MAX)`. Above11%, with `delta=rate−11` and
`F11=1−TAX_SENS[d]*2/9`, B uses `clamp(F11−(TAX_SENS[d]/9)*delta/(1+.3*delta), MIN, MAX)`.
Value and first derivative match at 11%; the bounded tail preserves demand headroom as rates rise.

Common unchanged constants: neutral 9%; `TAX_SENS=[.35,.5,.8,.4,.5,.7,.55,.8,.3,.35,.45,.75]` in DevType order;
`TAX_FACTOR_MIN=.05`, `TAX_FACTOR_MAX=1.5`; `GROWTH_RESPONSE=.06`; `GROWTH_MIN_ALLOW={R:25,C:10,I:10}`;
`GROWTH_MAX_SCALE=25000`. Desirability sensitivities, tax receipts and approval rules retain their existing rules.
No RNG draw sites or simulation save keys are added. Existing carry and smoothed demand continue on later days.

B's concave response exposes demand gradually while C/I's lower threshold avoids double-penalizing their
labor/headroom-filtered demand. Small additive startup compensation replaces A's large permanent capacity-fraction
increase. A increases additive caps 34.17%/31.43%/29.38% and fraction 34.17% over dev; B increases only additive
caps 5.56%/14.29%/12.50%, retaining the dev fraction. Neither changes a seed-specific or tax-start timing rule.

A's raw R cap is **1.341667 × dev at every capacity**, because its additive term and capacity fraction have that
same ratio while the scale stays fixed. Controlled counterfactuals are **nonadditive**, not causal shares:

| A counterfactual, other terms held fixed | 2015 population | Difference from A 228,544 |
|---|---:|---:|
| Restore dev R base and R fraction | 155,232 | −73,312 |
| Restore dev C/I bases and C/I fractions | 220,020 | −8,524 |
| Restore all dev caps/fractions | 136,851 | −91,693 |
| Restore only dev linear tax factor | 197,272 | −31,272 |

In particular, the dev-tax counterfactual is nonadditive: A's reciprocal target adds 31,272 with A's cap/response
held fixed, not a general independent share of the total increase.
Evidence: `S/ablation-{Rcap-dev,CIcap-dev,caps-dev,tax-dev}-128.json`.

## Complete tax sweep

128 × 15 seed 7, Medium/plains/water .2; all twelve rates fixed from setup. The managed base mayor is a separate row.

| Tax | A population | A adjacent loss | B population | B adjacent loss | B loss from fixed10 |
|---|---:|---:|---:|---:|---:|
| Managed base | 228,544 | — | 193,831 | — | — |
| 10% | 247,701 | — | 193,860 | — | 0% |
| 11% | 215,438 | 13.0250% | 187,547 | 3.2565% | 3.2565% |
| 12% | 194,858 | 9.5526% | 173,781 | 7.3400% | 10.3575% |
| 13% | 178,213 | 8.5421% | 167,809 | 3.4365% | 13.4380% |
| 14% | 163,216 | 8.4152% | 146,245 | 12.8503% | 24.5615% |

A funds/approval by managed,10,11,12,13,14 are respectively 208751/79.38,674628/78.29,714769/74.37,
1182632/70.53,1145283/67.87,1605781/60.93. A cumulative losses from 10% are 0/13.0250/21.3334/28.0532/34.1077%.
Both sweeps meet every 3–15% step. Fixed-tax records may miss obsolete partB population floors by the intended tax
loss; managed bases must retain every genuine phase0/balance gate.

A evidence: `S/grid-capped-paired-results.json`, `S/grid-capped-paired-M1.15-tax-{10,11,12,13,14}.json`.
B evidence: `S/review-ci-starter-R19-F0.0006-tax-{10,11}.json`,
`S/review-ci-tax-rational-A0.3-tax-{12,13,14}.json`, `S/review-ci-tax-results.json`.

## Base and delayed-tax runs

| Model/run | Residents R$/R$$/R$$$ | Population | Funds | Minimum sampled daily funds |
|---|---|---:|---:|---:|
| A128 × 15s7 | 73577/111744/43223 | 228,544 | 208,751 | 5,884 |
| B128 × 15s7 | 62577/92903/38351 | 193,831 | 178,743 | 5,033 |
| A256 × 60s7 | 516391/775252/362627 | 1,654,270 | 23,961,672 | 4,242 |
| B256 × 60s7 | 409265/736035/366094 | 1,511,394 | 14,534,867 | 4,481 |
| A256 × 60s11 | 504458/770053/357791 | 1,632,302 | 24,659,932 | 5,317 |
| B256 × 60s11 | 407999/712764/347489 | 1,468,252 | 16,910,754 | 4,459 |
| A256 × 30s7,12% from21 | 219855/288556/118472 | 626,883 | 12,199,843 | 4,242 |
| B256 × 30s7,12% from21 | 150086/234328/104973 | 489,387 | 10,946,923 | 4,481 |

The three resident entries are **wealth tiers**, not residential/commercial/industrial families. Endpoint money
also moves and must be reflected in later SIM comparisons:

| Base endpoint | Dev funds | B funds | B minus dev | Change |
|---|---:|---:|---:|---:|
| 128 × 15 seed7 | 146,349 | 178,743 | +32,394 | +22.1348% |
| 256 × 60 seed7 | 14,233,559 | 14,534,867 | +301,308 | +2.1169% |
| 256 × 60 seed11 | 16,451,097 | 16,910,754 | +459,657 | +2.7941% |

Source: the dev/B endpoint funds in `S/review-ci-metrics.json`; no claim that money remains unchanged.

A's short total changes +35,645 (+18.478582055894535%); maximum EQ by year 15 is 101.0318. Its long seed-7 run has
199,510 in 2015 and 717,660 in 2030, funds 3,209,438. A's delayed 2030 tax loss is 90,777 (12.649026001170471%).
Its strict seed-11 prefix has 195,471 in 2015 and 496,823 in 2025, residents `[172278,224208,100337]`, minimum
funds 5,317 and maximum EQ 113.0006.

B's 2030 base is **521,916**, funds **3,207,591**. Delayed 12% gives **489,387**, **32,529 fewer (6.232612144483021%)**,
passing the ≥3% gate; taxed funds are 10,946,923. Only two obsolete partB population-floor misses occur in the late
run, reflecting the intended tax loss. B's strict seed-11 prefix passes all genuine gates, with 385,542 in 2025,
minimum funds 4,459 and 2015 residents `[61984,75306,34278] = 171,568`.

All A long/late records are `S/accepted-{base-128,base-256-s7,base-256-s11,tax12-from21-256}.json`.
B records are `S/review-ci-starter-R19-F0.0006-base128.json`, `S/review-ci-R19-base-256-{s7,s11}.json`,
`S/review-ci-tax12-from21-256.json`. The high-tax tail leaves the managed 9–11% base path unchanged.

`S/review-ci-metrics.json` validates all 135 rows against b3, both complete sweeps, both delayed comparisons and
their exact prefixes. Annual ±3% is reported separately from the endpoint acceptance criterion. The artifact
retains all per-year differences across all twelve fixture columns; timing columns are diagnostics, not balance parameters.

| Run versus b3 | Rows | A mean absolute delta | A maximum / year | B mean absolute delta | B maximum / year | B rows outside±3% | B first/last outside year |
|---|---:|---:|---|---:|---|---:|---|
| 128 × 15s7 | 15 | 15.6010% | 35.2734% / 2003 | 2.7951% | 7.8926% / 2004 | 6 | 2002 / 2007 |
| 256 × 60s7 | 60 | 21.7405% | 38.6721% / 2042 | 4.8103% | 10.6816% / 2008 | 47 | 2002 / 2053 |
| 256 × 60s11 | 60 | 20.7406% | 37.3086% / 2042 | 3.9649% | 7.4622% / 2002 | 42 | 2002 / 2053 |
| Total | 135 | 20.6139% | 38.6721% / 2042 | 4.2107% | 10.6816% / 2008 | 95 | 2002 / 2053 |

A has 133 of 135 rows outside ±3% (15/15,59/60,59/60); B has 95 (6/15,47/60,42/60). This quantifies the improvement
without claiming annual equivalence. The exact per-year records remain in the metrics artifact rather than expanding this report.

## Determinism and save continuation

A source/diagnostic processes match all 15 canonical yearly hashes. Hashing pins `Date.now()` to 0, sorts unordered
object/Map/Set keys, preserves array order and hashes raw typed-array bytes. For **both A and B**, the metrics
artifact verifies exact equality of the first 20 complete annual metric objects and first 19 yearly hashes between
base and delayed-tax runs. Year-20 hashes differ as finance sets the day-7200 tax array, while that year's metrics
remain identical. Each 60-year base prefix is valid for 2030 because the horizon only controls the loop, not mayor
strategy. `S/review-B-source-proof.json` verifies independent installed-source base128 and fixed12% runs:
all 15 annual full-state hashes and metric objects in each equal the prototypes. Populations are 193831/173781;
the installed-source directory is `review-B-source-gates`. A evidence/source hashes remain unchanged.

| Final state | SHA-256 |
|---|---|
| A128s7 | `a73525af96afe00b780aea3f616ef3cf0f24e91a209832af6595cdb2fc3d7b1b` |
| A256s7 | `b977b3d40f7fd53f042a378b5e70f9580f7c921ccb7c1aedb0aace4ebe07c35c` |
| A256s11 | `1f57eb2513b1f01192c095f9c2029c626a50933812db6d81fd9f49c6800d2f0b` |
| B256s7 | `c27a732ac985788aa61c7df651dc195ab7ad272867d591971117d5c7fd406ae9` |
| B256s11 | `46a11ef1b6a52cbcf30cdc99c94a87bed161a11dc2ed8f9c4dfa146c2c565a2a` |
| B128 independent repeat | `02f7c8a16b7d5fbc91a5d7fc11fd672a7a1e423a5aaf9c43c5fe4f97271eb1f1` |
| B128 fixed12% repeat | `1dffa8fc21247d1693ec4371fdada967abb1781c84606b1750249374e72bf8a8` |

`--tax` already fixes every DevType through monthly management. New `--tax-start-year N` or `=N` keeps normal
management before year N and fixes all twelve rates before its first day; year 21 starts at day 7200. Parsing requires
`--tax` and a positive safe integer within the run. Optional bot metadata adds no simulation-state key.

## Bounded calibration evidence

These finite examples reject tested cells; they do not prove a model globally impossible. Incomplete runs are
excluded. Full failed sweeps remain in the immutable scratch JSON rather than expanding this report chronologically.

| Search family | Strongest limiting example | Evidence in S |
|---|---|---|
| Paired caps/full | M1 short/sweep pass but seed11 startup fails; M1.15 is preserved A, short+18.48% | `grid-capped-demand-results.json`, `grid-capped-paired-results.json` |
| A additive caps, lower fraction | F.0007 short192157 passes;13→14loss15.4933% fails. Nearby fractions fail EQ or endpoint | `grid-option-b-startup-results.json`, `grid-option-b-near-results.json` |
| Reciprocal coefficient | K.485 short197012;12→13loss2.6472% fails; K.510fails3steps | `grid-option-b-coefficient-results.json` |
| Tail / R startup | F700tail.02 sweep passes,6phase0 years fail. R25/F675 short/prefix pass; long s11=1604128(+12.3858%) fails±3% | `grid-option-B-tail-results.json`, `grid-option-b-r-startup-results.json`, `review-B-R25-F675-base-256-s11.json` |
| Wanted-family ramp | Five endpoint-eligible cells lose only.105–.748% on first step; K60p.1short178041 outside | `review-wanted-first-results.json` |
| Concave / fraction / exponent maps | R19.2/F600 short/prefix pass,12% step2.5854% fails; long s11=1381566 below range. Scalar s7 F601/F603/F610=1451992/1368259/1293716 below range; Rpower.2/CIpower.05 map misses startup | `review-concave-{first,near,fine}-results.json`, `review-concave-F{601,603,610}-base-256-s7.json`, `review-family-exp-results.json` |

## Scope and verification

The original task touches nine files. This review changes six: growth, tuning, demand, taxResponse, fixture and report.
The A commit's simbot, botTaxStart and balance-test changes remain intact.

- `src/sim/economy/growth.ts`: wanted-weighted capped family demand response, raised to scalar power 0.1.
- `src/sim/economy/tuning.ts`: family thresholds, scalar exponent and startup caps; dev capacity fraction retained.
- `src/sim/economy/demand.ts`: exact legacy tax factor through 11%; continuous rational tail above 11%.
- `tools/simbot.ts`: optional fixed-tax start year, validation, usage and save metadata.
- `tests/sim/taxResponse.test.ts`: 51 response, bank, deterministic/save and tax-curve cases.
- `tests/sim/botTaxStart.test.ts`: 15 parsing, all-rate persistence and exact day-7200 boundary cases.
- `tests/sim/balance.test.ts`: task-authorized hunk outside the explicit owns list; reads `baseline.reference`
  instead of hardcoded partB and retains independent phase0 gates.
- `tests/sim/fixtures/balance-baseline.json`: task-authorized edit outside the explicit owns list; **135 new
  `polishB` rows** (15/60/60), active reference `polishB` and one note. Recorder verification preserves every prior
  array's values and source bytes, including A's 135 `polish` rows.
- `docs/dev/reports/local-T041-new05-tax.md`: A/B decision, formula, evidence, limits and cloud/browser requests.

No `src/sim/infra/*` hunks or cloud-held file edits. A is also recoverable in `098d038`.

Both options move all 135 annual population rows. A remains in `polish`; B adds `polishB` without replacing it.
`review-ci-metrics.json` lists the exact simulation-column changes versus dev at fixture precision:

| Option / columns | 128seed7 years | 256seed7 years | 256seed11 years |
|---|---|---|---|
| A: `pop,funds,approval,commute,jobs,buildings` | 2001–2015 | 2001–2060 | 2001–2060 |
| A: `eq` | 2001–2015 | 2001–2060 | 2001–2039,2041–2044,2046–2060 |
| A: `unemployment` | 2008–2015 | 2006–2009,2018,2023–2060 | 2005–2008,2018,2022–2060 |
| A: `access` | 2008–2015 | 2006,2018,2023–2060 | 2006–2008,2018,2022–2060 |
| B: `pop,funds,approval,eq,commute,jobs,buildings` | 2001–2015 | 2001–2060 | 2001–2060 |
| B: `unemployment` | 2011–2015 | 2042–2060 | 2042–2060 |
| B: `access` | 2011–2015 | 2042–2056,2058–2060 | 2042–2049,2051–2060 |

`year` remains unchanged. Separately, the diagnostic timing columns `totalMsPerDay` and `econMsPerDay` are newly
measured in all 135 rows; they are not balance changes or evidence of a performance improvement. The metrics file
retains every exact value rather than relying only on the ranges above.

| Verification | Preserved A | Implemented B |
|---|---|---|
| Nine focused files |130passed |135passed: taxResponse51; other eight counts unchanged |
| BALANCE1 base/wrong-choice Vitest |1passed/1skipped,80.19s |1passed/1skipped,123.81s; four-hook shadow proof |
| BALANCE256 seed7 Vitest |1passed/1skipped,172.45s |1passed/1skipped,185.64s; four-hook shadow proof |
| Final `npx tsc --noEmit` |Passed,exit0 |Passed after installation,exit0 |
| Worker hygiene |17passed/1skipped |Rerun:17passed/1skipped |
| Scope/encoding audit |diff--check;9expectedfiles;UTF8noBOM | Passed: nine task files UTF-8 without BOM; 18 historical arrays retain exact bytes and values; 135 added rows |
| Full suite / browser / D2 decision | Lead | Lead |

B passed **152 executed focused cases**: 135 across the original nine files plus 17 worker-hygiene cases (one
hygiene case skipped). The nine counts are taxResponse51,botTaxStart15,botLongGame28,growth12,economy12,
balanceEconomy10,serializePhase0 4,continuity2,grownCity1. Evidence: `S/targeted-B-results.json`; A's original
130-case evidence remains unchanged in `S/targeted-results.json`. Legacy serialization and save/continue cases pass.
Final file/fixture evidence is `S/review-B-file-audit.json`; six files differ from the A WIP commit.

The actual balance Vitest ran before installation under verified B shadows. Both
`review-ci-shadow-balance{128,256}-proof.json` files verify tuning/growth/demand/fixture hooks and executed cases,
with no repository writes. B was then installed by the exact reviewed source/test patch and recorder; installed-source
hash repeats confirm prototype equivalence. The unit tolerance `+1e-10` corrects 3.5e-15 roundoff; no numeric balance
acceptance gate was relaxed.

## Commands and environment limits

Equivalent requested bot commands, all actual executions serialized through the quiet gate:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 10
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 11
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 12
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 13
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 14
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11
npx tsx tools/simbot.ts --size 256 --years 30 --seed 7
npx tsx tools/simbot.ts --size 256 --years 30 --seed 7 --tax 12 --tax-start-year 21
```

`npx tsx` is unavailable in the offline cache (`ENOTCACHED`), so measured runs use bundled drivers importing SimBot and
botSystems. The driver records gates and hashes and pins `Date.now()` to 0 without gameplay changes. **A's
`accepted-gates` bundle is immutable: never rebuild it from the current source.** Its retained driver commands are
below. B was compiled into fresh `review-B-source-gates`; normal native-config balance commands reproduce the
installed B implementation. Historical shadow commands require original A source frames and their proof files,
and must not be rerun against current B source.

```powershell
$T041Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T041/scratch'
$T041Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-256-s7.json" --size 256 --years 60 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-base-256-s11.json" --size 256 --years 60 --seed 11 --quiet
node $T041Quiet node "$T041Scratch/accepted-gates/check-gates.js" "$T041Scratch/accepted-tax12-from21-256.json" --size 256 --years 30 --seed 7 --quiet --tax 12 --tax-start-year 21
foreach ($T041Tax in 10..14) {
  node $T041Quiet node "$T041Scratch/grid-capped-paired-M1.15/check-gates.js" "$T041Scratch/grid-capped-paired-M1.15-tax-$T041Tax.json" --size 128 --years 15 --seed 7 --quiet --tax $T041Tax
}
# B prototype base class: tax10/11 and managed9–11% paths are unchanged by the selected high-tax tail.
node $T041Quiet node "$T041Scratch/review-ci-starter-R19-F0.0006/check-gates.js" "$T041Scratch/review-ci-starter-R19-F0.0006-base128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/review-ci-starter-R19-F0.0006/check-gates.js" "$T041Scratch/review-ci-R19-base-256-s7.json" --size 256 --years 60 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/review-ci-starter-R19-F0.0006/check-gates.js" "$T041Scratch/review-ci-R19-base-256-s11.json" --size 256 --years 60 --seed 11 --quiet
foreach ($T041Tax in 10..11) {
  node $T041Quiet node "$T041Scratch/review-ci-starter-R19-F0.0006/check-gates.js" "$T041Scratch/review-ci-starter-R19-F0.0006-tax-$T041Tax.json" --size 128 --years 15 --seed 7 --quiet --tax $T041Tax
}
foreach ($T041Tax in 12..14) {
  node $T041Quiet node "$T041Scratch/review-ci-tax-rational-A0.3/check-gates.js" "$T041Scratch/review-ci-tax-rational-A0.3-tax-$T041Tax.json" --size 128 --years 15 --seed 7 --quiet --tax $T041Tax
}
node $T041Quiet node "$T041Scratch/review-ci-tax-rational-A0.3/check-gates.js" "$T041Scratch/review-ci-tax12-from21-256.json" --size 256 --years 30 --seed 7 --quiet --tax 12 --tax-start-year 21
# Installed B: fresh directory; the immutable A directory above is retained.
node node_modules/rolldown/bin/cli.mjs "$T041Scratch/check-gates.ts" --platform node --format esm --dir "$T041Scratch/review-B-source-gates"
node $T041Quiet node "$T041Scratch/review-B-source-gates/check-gates.js" "$T041Scratch/review-B-source-base128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/review-B-source-gates/check-gates.js" "$T041Scratch/review-B-source-tax12.json" --size 128 --years 15 --seed 7 --quiet --tax 12
# Current installed-B balance reproduction; these are not the historical shadow invocations.
$env:BALANCE = '1'
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native
$env:BALANCE = '256'
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --testNamePattern '256 x 60 seed 7: the spec gates'
npx tsc --noEmit
```

The nine focused files and hygiene reproduce one file at a time with that same quiet/native-config/one-worker
invocation. Standard Vite hit Windows `net use` spawn EPERM; scratch preserveSymlinks/thread-pool configuration
avoids repository config edits. Full suite, benchmark and browser runs remain with the lead.

Historical shadow commands below document the completed 123.81s/185.64s checks. They require the preserved
A source frames described by the proof files; **do not run them against installed B**:

```powershell
$env:T041_B_CONCAVE_SHADOW_INPUT = "$T041Scratch/review-ci-shadow-input.json"
$env:BALANCE = '1'
$env:T041_B_CONCAVE_SHADOW_LOG = "$T041Scratch/review-ci-shadow-balance128-proof.json"
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/option-b-concave-shadow.config.mjs" --configLoader native
$env:BALANCE = '256'
$env:T041_B_CONCAVE_SHADOW_LOG = "$T041Scratch/review-ci-shadow-balance256-proof.json"
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/option-b-concave-shadow.config.mjs" --configLoader native --testNamePattern '256 x 60 seed 7: the spec gates'
```

## Differences, cloud requests and lead checks

The plan's 194,627 historical baseline predates branch dev 192,899. D14's partB assignment conflicts with the preceding
NEW-05 lead answer. A's broad target/cap uplift changed the base by 18.48%; B preserves the dev tax expression through
11% and dev capacity fraction while exposing a concave demand response. D2 and the lead's full suite/browser checks
remain outstanding; no cloud-held change was made.

**Plan deviation:** B's concave wanted-weighted demand response is a third form beyond the plan's linear-min and
smoothstep examples. Its formula and measured acceptance results are explicit above. The bounded search selected
a passing candidate; it does not establish a global minimum in base change or parameter complexity.

Cloud request: `src/ui/panels/BudgetPanel.ts`, `renderTaxes()`, remove the claim that demand collapses above 13%;
describe a gradual population cost measured **3.3–12.9% per point** across B's 10–14% sweep. `taxColor()` needs FH-09's
reference clarified: B first exceeds 10% cumulative loss at **12%**, versus either fixed 10% (10.3575%) or managed
base (10.3441%). Its first adjacent step ≥10% occurs at **14%** (12.8503%). Recommend red at 12% for the cumulative
fixed-10% interpretation, subject to the lead. A's preserved interpretation differs: fixed 10% first crosses at 11%;
managed base first at 12% (11%=−5.7346%,12%=−14.7394%). Neutral 9% approval remains unchanged.

Cloud request: `src/sim/economy/advisors.ts`, GUIDE `taxHigh`, replace the same collapse wording; its owner updates
the pinned sentence in `tests/sim/taxHighAdvice.test.ts`. No cloud edits here.

- [ ] Same developed checkpoint: fix all rates 10%,12%,14% in separate continuations; verify gradual demand/building
  response and persistence across month boundaries.
- [ ] Year-20 checkpoint: apply 12% for the next ten years and compare with matching base continuation.
- [ ] Load old Medium/Hard saves and continue several months; carry, demand smoothing, buildings and controls work.
- [ ] Check Budget/advisor/FH09 wording and boundary after cloud-owner changes.
- [ ] Confirm growth response with the worker host enabled.

## Decision for the lead

Recommend **B**, with **D2 approval pending**. Its three endpoints, fixed sweep, late-tax gate, balance tests,
save/worker checks, installed-source repeats, typecheck and final scope/UTF-8 audit pass. The full suite and
browser checklist remain outstanding.

B is a substantial improvement over A, not an unchanged dev trajectory: 95/135 annual population rows differ by
more than 3%, and endpoint funds change +22.1348%/+2.1169%/+2.7941%. Subsequent SIM money comparisons should use
the new recorded B rows. The finite search does not establish a globally minimal base change or complexity.
A stays available in `098d038`, immutable evidence and preserved `polish` arrays.
