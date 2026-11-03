# T041 — gradual tax response, signed Option B

**Option B is signed under D2**, by [NOTE-050-new05-option-b.md](../queue/NOTE-050-new05-option-b.md), following
[NOTE-048-desk-requests.md](../queue/NOTE-048-desk-requests.md). B's simulation calibration and bot strategy are unchanged.
This round merges fresh dev, directly confirms all six base runs, explains the accepted annual-path and cash effects,
and records signed B under `polish`. Rejected A remains archival only.

bot reference: residents [ 62577, 92903, 38351 ] = 193831

Branch `local/T041-new05-tax` includes dev `683d02b` and NOTE-050 through merge `3011ac8`. D2's comparator is fresh
dev without T041, not rejected A or B's own recorded baseline. Since `fb1531f`, dev adds T038's fireworks/palette and
T036 step 3's New Year/toast pacing plus documents; `src/sim/**`, tools/simbot.ts and dev's balance fixture are unchanged.
Direct fresh runs confirm the recorded `b3` populations and funds. No retune was needed.

## Fresh base gates and source provenance

All six fresh base drivers completed with `failures: []`. Every existing phase0 population floor, funds, EQ,
unemployment/access, utilities and emergency gate remains in force. Minimum daily funds are positive in every run.

| Run | Fresh dev population | Signed B population | B minus dev | Dev/B minimum daily funds |
|---|---:|---:|---:|---:|
| 128 × 15 seed 7 | 192,899 | 193,831 | +932 (+0.4832%) | 3,774 / 5,033 |
| 256 × 60 seed 7 | 1,513,835 | 1,511,394 | −2,441 (−0.1612%) | 4,125 / 4,481 |
| 256 × 60 seed 11 | 1,427,340 | 1,468,252 | +40,912 (+2.8663%) | 3,957 / 4,459 |

Every endpoint is inside its ±3% D2 range: 187,112.03–198,685.97; 1,468,419.95–1,559,250.05; and
1,384,519.80–1,470,160.20. Both seed-7 endpoints are also within ±1%; no retune is needed under the signed ±3% condition. The short resident change is `[+1453, −901, +380]` from dev's
`[61124, 93804, 37971]`. The tiers are R$/R$$/R$$$, not residential/commercial/industrial families.

| Final canonical state | SHA-256 |
|---|---|
| Fresh dev 128 seed 7 | `946863a2eb877657b10fb336993f6a2e897ad1a8209b2d29ebd03487c029e0bd` |
| Signed B 128 seed 7 | `02f7c8a16b7d5fbc91a5d7fc11fd672a7a1e423a5aaf9c43c5fe4f97271eb1f1` |
| Fresh dev 256 seed 7 | `001b2df7fa1be7817c2f6167f348d2c39da55ac362e982478190cc0e473d4edf` |
| Signed B 256 seed 7 | `c27a732ac985788aa61c7df651dc195ab7ad272867d591971117d5c7fd406ae9` |
| Fresh dev 256 seed 11 | `f945aec1d89d111fa4126001585fa8c534c211a754682037078ed385f4e3bbc4` |
| Signed B 256 seed 11 | `46a11ef1b6a52cbcf30cdc99c94a87bed161a11dc2ed8f9c4dfa146c2c565a2a` |

Fresh dev came from native Git archive `S/round3-dev683d02b.tar`, revision
`683d02b401716d96b2a512c88f31e65b7a08c810`, archive SHA-256
`6208fa37d8a011391a6813379a46763129b16711702420087c8ff60e4fdff858`. The audits
`S/round3-build-dev-683d02b.json` and `S/round3-build-ledger-dev-683d02b.json` both passed: each checks all 85 project
inputs against archived dev, verifies project configuration and records dependencies. Exact archived bytes overlay the
three economy modules, tools/simbot.ts and the fixture; every other loaded project source matches archived dev.
Node's `spawnSync` call to Git hit EPERM; the root created the archive with native Git instead, and the audits
verify its commit metadata, hash and all loaded project bytes. This creates no other worktree or branch change.

Dev128's primary record is `S/round3-dev-base128.json`, produced by the audited ledger-dev driver. The long dev
records use `round3-dev-gates/round3-dev-driver.js`. B uses `round3-B-gates/check-gates.js`. The six records are named
`round3-{dev,B}-base128.json` and `round3-{dev,B}-base256-{s7,s11}.json`.

## Formula and constants

For eligible subtype d in family f, positive absolute demand a[d] and displayed demand[d] retain the original gates
`a[d] > 0 && demand[d] > .01`. Existing wanted growth and the new family response are:

```text
w[d] = max(a[d] * .06, min(a[d], minimum[f]))
W[f] = sum(w[d])
M[f] = sum(w[d] * min(1, demand[d] / full[f])) / W[f]
C[f] = base[f] + .0006 * capacity[f] / sqrt(1 + capacity[f] / 25000)
response[f] = M[f] ** .1
allowance[d] = w[d] * min(1, C[f] * response[f] / W[f])
```

Empty families receive zero. Capping each subtype before the wanted-weighted mean prevents hot demand masking weak
demand. Family scaling preserves wanted subtype proportions. Small wanted growth below the reduced cap remains
unchanged; weaker demand can bring that cap below previously uncapped growth. Existing carry/debt banking and the
absolute-demand building-size limit remain intact.

| Constant | Signed B | Dev |
|---|---|---|
| `GROWTH_DEMAND_FULL` | `{ R: 1, C: .1, I: .1 }` | No displayed-demand throughput response |
| `GROWTH_DEMAND_EXPONENT` | `.1` | None |
| `GROWTH_MAX_BASE` | `{ R: 19, C: 8, I: 9 }` | `{ R: 18, C: 7, I: 8 }` |
| `GROWTH_MAX_FRAC` / `SCALE` | `.0006` / `25000` | Same |
| `GROWTH_RESPONSE` / `MIN_ALLOW` | `.06` / `{ R: 25, C: 10, I: 10 }` | Same |
| `TAX_NEUTRAL` / `TAX_DEMAND_PIVOT` | `9` / `11` | Neutral 9 |
| `TAX_DEMAND_RESPONSE` | `.3`, above-pivot curvature | None |
| `TAX_FACTOR_MIN` / `MAX` | `.05` / `1.5` | Same |

`TAX_SENS` remains `[.35, .5, .8, .4, .5, .7, .55, .8, .3, .35, .45, .75]` in DevType order, including its
use in desirability. Through 11%, taxFactor preserves the exact dev expression and clamp. Above 11%:

```text
delta = rate - 11
F11 = 1 - TAX_SENS[d] * (11 - 9) / 9
factor = clamp(F11 - (TAX_SENS[d] / 9) * delta / (1 + .3 * delta), .05, 1.5)
```

Value and first derivative match at 11%. The multiplication/division order matches calibration; no intermediate
shape quotient changes rounding. The rational tail preserves demand headroom. The concave response and lower C/I
thresholds moderate a second penalty on their already labor/headroom-filtered demand. Small additive startup
compensation replaces A's large permanent capacity-fraction increase.

No RNG draw sites or simulation save keys are added. Existing carry, smoothed demand and optional growth scan state
load through the existing schema. Tax receipts, approval rules and default bot strategy remain unchanged.

## Fixed-tax and late-tax acceptance

All twelve rates stay fixed throughout each sweep run. Managed base is separate. All five fresh fixed-tax runs
match the signed values and pass the monotonicity and 3–15% adjacent-loss gates.

| 128 × 15 seed 7 | Fresh population | Adjacent loss | Loss from fixed 10% |
|---|---:|---:|---:|
| Managed base | 193,831 | — | — |
| 10% | 193,860 | — | 0% |
| 11% | 187,547 | 3.2565% | 3.2565% |
| 12% | 173,781 | 7.3400% | 10.3575% |
| 13% | 167,809 | 3.4365% | 13.4380% |
| 14% | 146,245 | 12.8503% | 24.5615% |

All populations decrease and every adjacent step costs 3–15%. The first adjacent loss exceeding 10% occurs at
**14%**. NOTE-050 chooses that interpretation for taxColor; the earlier 12% cumulative-loss recommendation is obsolete.

| 256 × 30 seed 7 | Fresh population | Fresh funds |
|---|---:|---:|
| Matching B base | 521,916 | 3,207,591 |
| 12% from year 21 | 489,387 | 10,946,923 |
| Difference | −32,529 (−6.2326121445%) | — |

The matching B base is the 2030 prefix of its fresh 60-year seed-7 run; the horizon controls the loop, not the mayor strategy. The required late-tax population loss is at least 3%. `--tax-start-year 21` preserves normal management before year 21,
then fixes every rate before its first simulation day. Finance changes the tax array at day 7200. Year-20 metrics
and population therefore remain equal to base while its serialized boundary contains the new rates. Fresh evidence
matches 20 annual metric objects and the first 19 full-state hashes exactly; the year-20 hash difference is the
expected newly fixed tax array.

Historical `population vs partB` misses remain in diagnostics, but that obsolete reference is not the current
baseline gate. High fixed taxes intentionally lose population; their tax gates do not require obsolete partB floors.
Actual base balance tests retain every threshold, independent phase0 floor and wrong-choice comparison.

`S/round3-summary.json` passes: all 135 annual population comparisons and return years are recorded; all 135 B
state hashes and full gate-year objects match signed B exactly; fresh dev has zero non-timing differences from b3.
It also verifies the five fresh sweep runs and four adjacent steps, the late-tax loss of 6.232612144483021%, and the exact delayed/base prefix.
Fresh sweep evidence is `S/round3-B-tax-{10..14}.json`; late evidence is `S/round3-B-tax12-from21-256.json`.

## Accepted annual-path effects

NOTE-050 explicitly signs 95 of 135 annual population rows moving more than ±3%. The fresh artifact
`S/round3-summary.json` confirms those comparisons and return years against direct fresh dev; the earlier
`S/review-ci-metrics.json` remains historical evidence. Endpoint agreement is not annual equivalence.

| Run versus dev | Rows | Mean absolute population delta | Maximum / year | Rows outside ±3% |
|---|---:|---:|---|---:|
| 128 × 15 seed 7 | 15 | 2.7951% | 7.8926% / 2004 | 6 |
| 256 × 60 seed 7 | 60 | 4.8103% | 10.6816% / 2008 | 47 |
| 256 × 60 seed 11 | 60 | 3.9649% | 7.4622% / 2002 | 42 |
| Total | 135 | 4.2107% | 10.6816% / 2008 | 95 |

The requested first return within the band can be temporary, so the sustained return is also stated:

| Run | First outside ±3% | First return within ±3% | Last outside ±3% | Within ±3% for every remaining year from |
|---|---:|---:|---:|---:|
| 128 × 15 seed 7 | 2002 | 2008 | 2007 | 2008 |
| 256 × 60 seed 7 | 2002 | 2003, temporary | 2053 | 2054 |
| 256 × 60 seed 11 | 2002 | 2004, temporary | 2053 | 2054 |

These years were derived from the annual comparisons in the fresh summary, confirming the earlier
`annualDeviation.yearsOutside3Percent` lists and fixture populations. At fixture precision, B changes these
simulation columns against fresh dev:

| Columns | 128 × 15 seed 7 years | 256 × 60 seed 7 years | 256 × 60 seed 11 years |
|---|---|---|---|
| `pop,funds,approval,eq,commute,jobs,buildings` | 2001–2015 | 2001–2060 | 2001–2060 |
| `unemployment` | 2011–2015 | 2042–2060 | 2042–2060 |
| `access` | 2011–2015 | 2042–2056,2058–2060 | 2042–2049,2051–2060 |

All 135 population rows move by design. Year remains unchanged. The two timing columns are remeasured for all
135 rows; they are diagnostics, not evidence of a performance improvement. Exact earlier comparisons remain in
`S/review-ci-metrics.json`; fresh dev reproduces its non-timing reference values exactly.

## Why short-run funds rise 22%

**B ends with §32,394 more because it spends §65,636 less on one-off work, mainly §77,827 less construction,
which outweighs §33,242 less recurring net cash.** The cash rise is a spending/layout effect; it is not an increase
in operating surplus or a new grant.

`S/round3-cashflow-comparison.json` passes exact conservation for 180 monthly ledgers per model. Its B observer
matches all 15 unobserved B yearly hashes and metric objects, with no residual. Both models start at §100,000.

| Cumulative 15-year cash flow | Fresh dev | Signed B | B minus dev |
|---|---:|---:|---:|
| Recurring income | 7,741,447 | 7,807,195 | +65,748 |
| Recurring expense, including scheduled loan payments | 6,555,520 | 6,654,510 | +98,990 |
| Recurring net | 1,185,927 | 1,152,685 | −33,242 |
| One-off income | 120,000 | 120,000 | 0 |
| One-off expense | 1,259,578 | 1,193,942 | −65,636 |
| One-off net | −1,139,578 | −1,073,942 | +65,636 |
| Closing funds | 146,349 | 178,743 | +32,394 |

| One-off expense detail | Fresh dev | Signed B | B minus dev |
|---|---:|---:|---:|
| Construction | 1,046,280 | 968,453 | −77,827 |
| Zoning | 207,628 | 220,426 | +12,798 |
| Demolition | 5,670 | 5,063 | −607 |

Tax receipts increase by §121,550, but other recurring income falls §55,802 and recurring costs rise §98,990.
The table therefore does not attribute the final cash gain to stronger operating earnings. Both take §120,000 in
loans and finish with zero loan balance; B's net loan cash is §1 worse, not a hidden funding source. The unchanged
bot's affordability thresholds send the changed growth layout down a different spending path. Ledger evidence
quantifies that effect without treating nonadditive layout outcomes as independent causal shares.

| Endpoint funds | Fresh dev | Signed B | Difference | Change |
|---|---:|---:|---:|---:|
| 128 × 15 seed 7 | 146,349 | 178,743 | +32,394 | +22.1348% |
| 256 × 60 seed 7 | 14,233,559 | 14,534,867 | +301,308 | +2.1169% |
| 256 × 60 seed 11 | 16,451,097 | 16,910,754 | +459,657 | +2.7941% |

Later SIM money comparisons must use signed B's recorded rows.

## Rejected A remains archival

NOTE-048 rejects A's +18.5% short uplift. A is retained only in commit `098d038`, immutable bundles and historical
evidence, not the active fixture or a fallback recommendation.

| Historical A base | Residents R$/R$$/R$$$ | Population | Funds | Evidence in S |
|---|---|---:|---:|---|
| 128 × 15 seed 7 | 73577 / 111744 / 43223 | 228,544 | 208,751 | `accepted-base-128.json` |
| 256 × 60 seed 7 | 516391 / 775252 / 362627 | 1,654,270 | 23,961,672 | `accepted-base-256-s7.json` |
| 256 × 60 seed 11 | 504458 / 770053 / 357791 | 1,632,302 | 24,659,932 | `accepted-base-256-s11.json` |

A used scalar full=.575, linear family response M, bases 24.15/9.2/10.35, fraction .000805, and reciprocal
`1 / (1 + .5 * SENS * (rate - 9) / 9)` above 9%. A retained growth response .06, minimum allowance
`{ R: 25, C: 10, I: 10 }`, cap scale 25000, neutral 9%, the unchanged TAX_SENS array and .05/1.5 clamps listed above.
Its raw R cap was 1.341667× dev at every capacity. Historical controlled counterfactuals on A produced:

| A counterfactual, other terms fixed | 2015 population | Difference from A 228,544 |
|---|---:|---:|
| Restore dev R base and R fraction | 155,232 | −73,312 |
| Restore dev C/I bases and fractions | 220,020 | −8,524 |
| Restore all dev caps/fractions | 136,851 | −91,693 |
| Restore only dev linear tax factor | 197,272 | −31,272 |

These are nonadditive layout/affordability responses, not independent causal shares. Evidence remains in
`S/ablation-{Rcap-dev,CIcap-dev,caps-dev,tax-dev}-128.json`.

| Historical A fixed tax | Population | Adjacent loss |
|---|---:|---:|
| 10% | 247,701 | — |
| 11% | 215,438 | 13.0250% |
| 12% | 194,858 | 9.5526% |
| 13% | 178,213 | 8.5421% |
| 14% | 163,216 | 8.4152% |

A's 256 × 30 seed-7 base was 717,660; 12% from year 21 gave 626,883, a loss of 90,777 (12.6490260012%).
The sweep lives in `S/grid-capped-paired-M1.15-tax-{10..14}.json`; late evidence is
`S/accepted-tax12-from21-256.json`, compared with the 2030 prefix of `S/accepted-base-256-s7.json`.
Those tax passes did not justify A's broad base uplift. The bounded search found B; it does not establish globally
minimal base change or complexity.

## Fixture normalization and scope

Pre-T041 dev has five arrays per run—`preSpec`, `phase0`, `partB`, `b1`, `b3`—for **15 original historical arrays**.
The prior count of 18 included A's three rejected `polish` arrays; adding review B made 21. The applied signed recording
replaces A under `polish` and removes the duplicate B alias: **15 historical arrays + 3 signed B arrays = 18 total**.
A remains in git and immutable evidence. `S/round3-record-polish-applied.json` reports `status: applied`, active
reference `polish`, 135 fresh B rows, all 15 historical arrays byte-for-byte preserved and 18 total arrays. This is
explicit rejection/normalization, not a new baseline hiding a miss.

Round 3 changes only the fixture and report. The economy implementation, simbot and tests are retained unchanged
from signed B in `2521f5c`. The carried T041 implementation is:

- `src/sim/economy/growth.ts`: capped wanted-weighted family response and scalar concavity; original bank/limits.
- `src/sim/economy/tuning.ts`: family thresholds, exponent, startup caps and tax pivot/tail constants.
- `src/sim/economy/demand.ts`: exact legacy through 11%, continuous rational tail above 11%.
- `tools/simbot.ts`: optional fixed-tax start year, validation, usage and bot metadata.
- `tests/sim/taxResponse.test.ts`: 51 response, bank, eligibility, RNG, old-save and tax-curve cases.
- `tests/sim/botTaxStart.test.ts`: 15 parsing, persistence and exact year-21-boundary cases.
- `tests/sim/balance.test.ts`: task-authorized hunk outside explicit owns; uses `baseline.reference` while retaining
  every numeric threshold and independent phase0/wrong-choice gate.
- `tests/sim/fixtures/balance-baseline.json`: task-authorized hunk outside explicit owns; signed `polish` rows,
  15/60/60 years, D2 note, original 15 arrays preserved and rejected-A/duplicate-B cleanup.
- `docs/dev/reports/local-T041-new05-tax.md`: signed decision, fresh comparison, cash/annual effects and verification.

Round 3 had no `src/sim/infra/*` hunks, worker/host/save implementation changes or cloud-held UI edits. Round 4
explicitly authorizes the BudgetPanel changes below; other cloud-held files remain untouched. All new changes stay
uncommitted under the user's instructions.

The final audit is recorded in `S/round3-final-audit.json`: nine task files are UTF-8 without BOM; the other seven task files retain their signed-B bytes; the 15 historical arrays retain exact fresh-dev bytes and values; `polish` contains the 135 fresh B rows and there are 18 arrays total. Native Git scope and whitespace checks cover the complete worktree diff.

## Completed prior checks and fresh final validation

| Check | Prior signed-B evidence | Fresh round 3 |
|---|---|---|
| Six direct dev/B base drivers | Three B bases passed previously | All six passed, no failures |
| Cash-flow attribution | Annual funds only | 180 months each; exact conservation and observer equivalence passed |
| Fixed 10–14% / late 12% from 21 | Signed passes above | Fresh runs and complete summary passed |
| Actual 128 balance/wrong choices | 1 passed / 1 skipped, verified shadow, 123.81s | Native pass, 80.696s |
| Actual 256 seed-7 spec | 1 passed / 1 skipped, verified shadow, 185.64s | Native pass, 255.206s |
| Nine focused files | 135 executed passed | Fresh taxResponse: 51 passed; botTaxStart: 15 passed |
| Worker hygiene | 17 passed / 1 skipped | Fresh 17 passed / 1 skipped |
| `npx tsc --noEmit` | Passed after B installation | Passed after fixture normalization, exit 0 |
| Old serialization/save continuation | Passed in prior focused files | Historical evidence, not a new round-3 run |

The prior 135 focused cases were taxResponse 51, botTaxStart 15, botLongGame 28, growth 12, economy 12,
balanceEconomy 10, serializePhase0 4, continuity 2 and grownCity 1. With 17 hygiene cases that was 152 executed
cases. Evidence remains in `S/targeted-B-results.json`, `S/review-ci-shadow-balance{128,256}-proof.json`, and
`S/review-B-source-proof.json`; it is distinguished from this round's validations.

Canonical hashing fixes `Date.now()` to 0, sorts unordered object/Map/Set keys and preserves array order and raw
typed-array bytes. The fresh summary verifies all 135 B annual hashes and full gate-year objects against the signed
references, including the final hashes above. Prior independent installed-source base128 and fixed12 repeats matched all
15 annual hashes and metrics. No new save fields were needed; interactive old-save checks remain with the lead.

Fresh validation passes **85 executed cases**, with one existing hygiene skip: native `balance.test.ts` with `BALANCE=256` runs both cases (2 passed, no test-name filter), taxResponse has 51 passed, botTaxStart has 15 passed, and hygiene has 17 passed / 1 skipped. The balance file takes 336.89s in total. JSON evidence is `round3-balance.json`, `round3-taxResponse.json`, `round3-botTaxStart.json` and `round3-hygiene.json`. Final `npx tsc --noEmit` exits 0 after fixture normalization. Full suite, browser and shared A/A-envelope runs remain with the lead.

## Reproduction commands

All sim/test runs are serialized through the shared quiet gate. `npx tsx` is unavailable in the offline cache
(`ENOTCACHED`); bundled drivers import real SimBot/botSystems and add diagnostic gates/hashes without gameplay changes.
The native scratch Vitest config uses preserveSymlinks and the thread pool to avoid Windows Vite net-use spawn EPERM.
No repository config change is needed.

The requested bot commands are the three bases, each fixed tax and the late-tax continuation:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 10
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 11
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 12
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 13
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --tax 14
npx tsx tools/simbot.ts --size 256 --years 30 --seed 7 --tax 12 --tax-start-year 21
```

Recorded fresh commands use these paths. The build helpers refuse existing artifacts; use new output names for reruns.

```powershell
$T041Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T041/scratch'
$T041Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
# Native archive; the two round3-build-*-683d02b.json audits describe verified source overlays/bundles.
git archive --format=tar --output="$T041Scratch/round3-dev683d02b.tar" 683d02b -- src tools tests/sim/fixtures/balance-baseline.json '*.json'
# B was built freshly in its own directory; immutable A evidence is never rebuilt.
node node_modules/rolldown/bin/cli.mjs "$T041Scratch/check-gates.ts" --platform node --format esm --dir "$T041Scratch/round3-B-gates"
node "$T041Scratch/round3-build-dev.mjs"
node node_modules/rolldown/bin/cli.mjs "$T041Scratch/round3-ledger-driver.ts" --platform node --format esm --dir "$T041Scratch/round3-ledger-B-gates"
node "$T041Scratch/round3-build-dev.mjs" --ledger
# Fresh dev's primary short run includes the observer; B's diagnostic repeat verifies observation leaves every yearly hash unchanged.
node $T041Quiet node "$T041Scratch/round3-ledger-dev-gates/round3-ledger-dev-driver.js" "$T041Scratch/round3-dev-base128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/round3-dev-gates/round3-dev-driver.js" "$T041Scratch/round3-dev-base256-s7.json" --size 256 --years 60 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/round3-dev-gates/round3-dev-driver.js" "$T041Scratch/round3-dev-base256-s11.json" --size 256 --years 60 --seed 11 --quiet
node $T041Quiet node "$T041Scratch/round3-B-gates/check-gates.js" "$T041Scratch/round3-B-base128.json" --size 128 --years 15 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/round3-B-gates/check-gates.js" "$T041Scratch/round3-B-base256-s7.json" --size 256 --years 60 --seed 7 --quiet
node $T041Quiet node "$T041Scratch/round3-B-gates/check-gates.js" "$T041Scratch/round3-B-base256-s11.json" --size 256 --years 60 --seed 11 --quiet
node $T041Quiet node "$T041Scratch/round3-ledger-B-gates/round3-ledger-driver.js" "$T041Scratch/round3-B-ledger128.json" --size 128 --years 15 --seed 7 --quiet
foreach ($T041Tax in 10..14) {
  node $T041Quiet node "$T041Scratch/round3-B-gates/check-gates.js" "$T041Scratch/round3-B-tax-$T041Tax.json" --size 128 --years 15 --seed 7 --quiet --tax $T041Tax
}
node $T041Quiet node "$T041Scratch/round3-B-gates/check-gates.js" "$T041Scratch/round3-B-tax12-from21-256.json" --size 256 --years 30 --seed 7 --quiet --tax 12 --tax-start-year 21
# Completed final validation. BALANCE=256 executes both actual cases; there is no test-name filter.
$env:BALANCE = '256'
node $T041Quiet npx vitest run tests/sim/balance.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T041Scratch/round3-balance.json"
node $T041Quiet npx vitest run tests/sim/taxResponse.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T041Scratch/round3-taxResponse.json"
node $T041Quiet npx vitest run tests/sim/botTaxStart.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T041Scratch/round3-botTaxStart.json"
node $T041Quiet npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T041Scratch/round3-hygiene.json"
npx tsc --noEmit
```

The three fresh-dev populations reproduce dev's durable b3 rows. Plan §8.0's durable checkpoint/frame/screenshot
collection and the full suite are lead-owned; this lane does not claim to have completed those broader gates.

## Plan differences, lead follow-up and cloud requests

D2 is already signed. The plan's historical 194,627 reference predates branch dev 192,899. B uses an expressly
reported third response beyond its linear-min/smoothstep examples; the finite search makes no global-minimality claim.
T041 still merges first among SIM lanes after B2. T042–T045 then remeasure final relative gates on that merged dev.

The shared A/A protocol now follows [NOTE-052](../queue/NOTE-052-aa-perturbation.md): symmetric funds nudges at the
smallest size that forks all three rows, at day 1 and the start of year 5. T062 owns the table in
`docs/dev/reports/sim-aa-envelope.md`, including its rerun on dev+T041. It does not replace this lane's signed D2
endpoint/sweep/late-tax requirements.

NOTE-050's BudgetPanel requests are completed in round 4; the advisor request remains pending:

- `src/ui/panels/BudgetPanel.ts`, `renderTaxes()`: gradual-growth wording with numeric copy imported from tuning.
- The same file, `taxColor()`: red starts at **14%**, using `TAX_GROWTH_WARNING_RATE` from tuning. See round 4 below.
- `src/sim/economy/advisors.ts`, GUIDE `taxHigh`: wait for T037b to reach dev, then change only the collapse string
  and its pinned sentence in `tests/sim/taxHighAdvice.test.ts`. Dev683d02b has no advisors rewrite since fb1531f;
  this conditional owner request remains open. Preserve the honest-copy rule.

Browser acceptance checklist for the lead's real-GPU slot:

- [ ] From one developed checkpoint, fix all rates at 10%, 12% and 14% in separate continuations; observe gradual
  demand/building response and persistence across month boundaries.
- [ ] From a year-20 checkpoint, apply 12% for ten years against a matching base continuation.
- [ ] Load old Medium/Hard saves; continue several months and check carry, smoothed demand, buildings and controls.
- [ ] Check Budget/advisor copy and the red-14 boundary after owner changes.
- [ ] Confirm the growth response with the worker host enabled.

The worker reports round 3 at `46b20b2` passed the full suite (222 files, 2,263 tests) and the bot reference.
Browser and shared-envelope checks remain with the lead. The measurements above describe round 3; round 4 follows.

## Round 4 — GUIDE tax copy and colors

Based on `60ca91d`, including dev `50a6b29` (docs only). NOTE-050 is read and B's simulation calibration stays fixed.
The following two changes have separate source and test hunks so they can be committed independently. This report
is their shared documentation; nothing is committed here.

**Change 1 — gradual-growth copy.** Files: `src/ui/panels/BudgetPanel.ts` (`renderTaxes()` hint),
`tests/game/budgetTaxes.test.ts` (the old collapse-copy assertion only), and new `tests/game/budgetTaxCopy.test.ts`.
The hint says “Higher taxes gradually slow growth.” Its neutral rate and approval slopes come from imported
`TAX_NEUTRAL` and `APPROVAL`; it names no response time or numeric growth loss. The new DOM test supplies non-default
neutral/slopes (8.75, −4.125, +2.375) and checks every numeric token in the hint against those constants.

**Change 2 — red threshold.** Files: `src/sim/economy/tuning.ts` (one new presentation constant),
`src/ui/panels/BudgetPanel.ts` (import and `taxColor()`), `tests/game/budgetTaxes.test.ts` (constant import, threshold
pin and 13.5% expectation), and new `tests/game/budgetTaxColor.test.ts`. `TAX_GROWTH_WARNING_RATE = 14` cites the
signed 128×15 s7 sweep: 13→14% loses 12.8503%, the first one-point loss exceeding 10%. Warn still starts strictly above
9.5%; 13.5% is now amber and 14% is red. Both individual and All sliders use the tuning constant. A DOM test moves it
to 15.5% and verifies all 15 sliders, including red→amber→clear transitions. No simulation system consumes it.

The existing `tests/game/budgetTaxes.test.ts` edits are minimal required hunks outside the task's explicit source
file list: its previous assertions pinned the rejected collapse wording and old color boundary. No infra hunks,
host/listener changes, save fields or RNG draws are added. `src/sim/economy/advisors.ts` and its pinned
`tests/sim/taxHighAdvice.test.ts` sentence remain unchanged; the `taxHigh` wording waits for T037b.

Quiet-gated verification passes: `npx tsc --noEmit` exits 0, and the following files run individually with one worker:

| Test file | Passed | Skipped |
|---|---:|---:|
| `tests/game/budgetTaxCopy.test.ts` | 1 | 0 |
| `tests/game/budgetTaxColor.test.ts` | 1 | 0 |
| `tests/game/budgetTaxes.test.ts` | 13 | 0 |
| `tests/game/panelCommands.test.ts` | 5 | 0 |
| `tests/game/panelsMisc.test.ts` | 10 | 0 |
| `tests/game/sliderRetention.test.ts` | 6 | 0 |
| `tests/sim/taxResponse.test.ts` | 51 | 0 |
| `tests/sim/botTaxStart.test.ts` | 15 | 0 |
| `tests/sim/taxHighAdvice.test.ts` | 2 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |
| Total | 121 | 1 |

The fresh 128×15 s7 bot remains **residents [ 62577, 92903, 38351 ] = 193831**, funds §178,743, minimum sampled daily
funds §5,033, with no gate failures. All 15 canonical yearly hashes, full annual gate objects and non-timing fixture
rows exactly match signed B. Final hash remains `02f7c8a16b7d5fbc91a5d7fc11fd672a7a1e423a5aaf9c43c5fe4f97271eb1f1`.
CPU timing columns are diagnostic measurements; no fixture rows are rewritten. `S/round4-proof.json` records the
comparison, test counts, UTF-8/no-BOM checks and source/fixture hashes. The only tuning addition is the UI threshold;
all previous tuning bytes and the growth/demand/bot source remain unchanged.

Exact bot equivalent: `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`. The offline environment still uses
the bundled SimBot driver described above. Recorded commands (with `S`/`Q` paths defined earlier):

```powershell
node $T041Quiet npx tsc --noEmit
# Each file in the table is run separately, with its own round4-<name>.json output.
node $T041Quiet npx vitest run tests/game/budgetTaxes.test.ts --maxWorkers=1 --config "$T041Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T041Scratch/round4-budgetTaxes.json"
node node_modules/rolldown/bin/cli.mjs "$T041Scratch/check-gates.ts" --platform node --format esm --dir "$T041Scratch/round4-B-gates"
node $T041Quiet node "$T041Scratch/round4-B-gates/check-gates.js" "$T041Scratch/round4-B-base128.json" --size 128 --years 15 --seed 7 --quiet
```

No full-suite, long-bot, benchmark or browser run is added in this UI-only round. Browser follow-up:

- [ ] Check the short hint and keyboard/stepper controls in the Taxes tab.
- [ ] Check amber at 13.5% and red at 14%, on individual and All sliders, in both directions.
- [ ] After T037b, update and check the pending advisor wording separately.
