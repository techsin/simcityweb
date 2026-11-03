# local-T043-lg06-neglect: safety record, rebuilding costs and scars

Branch `local/T043-lg06-neglect`, base `fb1531f` plus the committed task file. Status: **holds for B2; BALANCE GATES FAIL**. Changes remain uncommitted. No push, merge or `.done` file was made, following the explicit worktree instructions rather than the task footer.

The mechanics are implemented, but this is not a balance sign-off. All three base endpoints exceed the allowed population movement, seed 11 neglect gains population and funds, and seed 11 base tourism exceeds 1.3. The exact native checks and two-process determinism check pass. Vitest could not start in this sandbox.

## Changes by file

- `src/sim/economy/tourism.ts`: `emergencySafety` uses approval's existing rolling 12-month emergency counts, failures and deaths, with deaths normalized per 1,000 current residents. It replaces crime-only safety in the existing attractiveness scores. Those scores already feed tourism and the existing migration multiplier bounded by 0.88–1.12; there is no second safety multiplier. Optional `safetyMigrationLoss` lives in the already mirrored `systemData.economy`. The pure `emergencyMigrationImpact` helper exposes per-wealth multiplier loss and estimated current residential target loss. The tourism save/load output preservation also preserves this optional value.
- `src/sim/economy/tuning.ts`: adds `REBUILD_SHARE = 0.15`, `EM_SCAR` (0.15, radius 3, 540 days), `EM_REP = 4`, the denominator offset 30 and the deaths coefficient 0.002. `EM_REP = 4` is provisional: the specification names the constant without assigning a value. It has not been calibrated to passing gates. All specified coefficients remain literal.
- `src/sim/economy/budget.ts`: adds the `emergency:rebuild` expense and pure rebuilding-cost readers. Forecasts include the current month's accrued damage. Settlement charges the completed month after infrastructure rolls it to `lastMonth`, once, rounded to whole currency. Rolling annual readers use sums of the actual rounded monthly charges, including an unanswered-only subtotal. Difficulty income rules and funding sliders do not discount rebuilding; sandbox records the expense without reducing funds.
- **`src/sim/CityState.ts` — OUTSIDE NAMED FILES, interface only:** adds optional `EmergencyMonth.unansweredDamage`, `rebuildCost` and `unansweredRebuildCost`. No constructor/default or runtime behavior is changed in this file. Optional fields allow old saved months to omit the new counters.
- **`src/sim/infra/emergency.ts` — MINIMAL INFRA HUNKS, HOLD FOR B2:** listed separately below.
- **`src/sim/infra/nimby.ts` — MINIMAL INFRA HUNKS, HOLD FOR B2:** listed separately below.
- `tests/sim/neglectSafety.test.ts`: 11 cases covering the safety formula, purity, old fields, migration/next-pass tourism, target-loss exposure, rebuild rounding, rollover, difficulty/funding behavior and sandbox.
- `tests/sim/neglectScars.test.ts`: 6 cases covering unanswered and late-answered losses, cost exposure, the rolling rounded-charge totals, scar strength/radius/expiry, mid-scar save/load and old saves.
- `docs/dev/reports/local-T043-lg06-neglect.md`: this report.

`tools/simbot.ts` is unchanged. Its `--neglect` parser and daily early return already suppress manual dispatch correctly. The approval formula is unchanged. There are no new RNG calls.

## Every infrastructure hunk held for B2

`src/sim/infra/emergency.ts`:

1. Import the rebuild share and `addEmergencyScar`.
2. Add optional `Incident.rebuildCost` for the existing plain incident stream and old-save compatibility.
3. At monthly rollover, record rounded rebuilding cost and the rounded unanswered subtotal before storing the completed month.
4. At a building's burn-down, add a scar only if `inc.answered === 0`; preserve the existing damage expression, record unanswered damage and accumulate the incident's rebuild cost.
5. At riot damage, record unanswered damage and the incident rebuild cost alongside the existing damage total.
6. In `sumMonths`, sum the three optional counters with zero fallbacks. The existing incident/failure/death window is reused, not replaced.

`src/sim/infra/nimby.ts`:

1. Import the building type and scar tuning.
2. Add `EmergencyScar` and the append-only creation helper using optional `systemData.emergencyScars` (footprint plus absolute expiry day).
3. In the existing rebuild, prune expired sources and splat active scars into stigma. The inverse saturation amount makes a lone scar's core exactly 0.15 under the existing `1 - exp(-x)` saturation. Existing falloff and radius handling are reused.

These are small independent hunks; no infrastructure code is moved or refactored. The scar source expires at 540 days. Its raster follows the existing NIMBY refresh cadence, which can lag source creation or expiry by up to about 30 game days. No synchronous full raster rebuild was added to a burn-down.

## Verification completed and blocked

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| Diff whitespace and UTF-8 without BOM | PASS; all 9 changed/new files checked |
| `tests/sim/neglectSafety.test.ts` | Not executed: Vitest startup failed with `spawn EPERM`; 11 cases are authored |
| `tests/sim/neglectScars.test.ts` | Not executed: same startup restriction; 6 cases are authored |
| Native Node assertions, `neglect-smoke.mts` | PASS: 10 passed, 0 failed; details in `neglect-smoke.json` |
| Two separate 128×15 seed-7 processes | PASS: all 15 yearly state hashes identical |
| Full Vitest and individual regression/hygiene suites | Left for the lead; no full suite was attempted |

The 10 native assertions cover the exact safety formula and read purity; normalization/clamping/old stats; migration and next-pass visits; 15% rounding; single monthly settlement; difficulty/funding/sandbox behavior; old-save budget reads; 12-month expiry of counts and charges; unanswered scars with mid-scar save/load; and a late-answered loss without a scar or unanswered cost. These assertions are evidence separate from Vitest, not a claim that the new Vitest files ran.

The final repeated-run hash is `a6e96a4b4814701a9bdb3c5ebebdb0c9d87ad4446a40ff375b09bf5f28fb2c0a`. The driver hashes `serializeCity(..., { copy: true })` with sorted object keys, typed-array bytes and `savedAt = 0`. It records city/emergency RNG states without drawing from them.

Normal `npx tsx` was unavailable offline (`ENOTCACHED`). The fallback uses Node 22's TypeScript transform and a scratch-only extension resolver. A second loader reads snapshots of the five original simulation files from `HEAD`; it reproduces **all 15 dev 128×15 seed-7 rows**, including residents `[61124, 93804, 37971]` = **192,899** in 2015. The `CityState.ts` difference is interface-only and erased by the loader. No source file was reverted for these checks, and no other worktree was used.

All native bot processes ran through the supplied quiet gate, one at a time. Diagnostic loaders, drivers, original source snapshots and JSON output are in the user-provided scratch directory; they are not repository deliverables.

## Bot results

The reference is the fixture's current `b3` set, not the older FH-04/LG-10 report rows. `b3` endpoints are 192,899 for 128×15 s7, 1,513,835 for 256×60 s7, and 1,427,340 for 256×60 s11. Medium, plains and water 0.2 are the unchanged bot defaults.

### Base population tolerance: FAIL

| Run | Dev population | Branch population | Endpoint change | Largest absolute yearly-row movement | Gate |
|---|---:|---:|---:|---:|---|
| 128×15 s7 | 192,899 | 195,379 | +1.2856% | 7.2604% | FAIL ±0.5% |
| 256×60 s7 | 1,513,835 | 1,550,356 | +2.4125% | 4.0335% | FAIL ±0.5% |
| 256×60 s11 | 1,427,340 | 1,494,630 | +4.7144% | 33.2794% | FAIL ±0.5% |

Branch 128×15 residents are `[63918, 93966, 37495]`. Its endpoint funds are §152,842 and approval is 78.8665. These mechanics change balance by design; the permitted base tolerance is nevertheless missed.

Two scratch-only 128×15 probes changed only `EM_REP`: 0 gave 195,792 (+1.4997% versus dev); 1 gave 196,044 (+1.6304%). Neither passed. They are not repository changes, do not prove the target infeasible, and are not presented as calibration of the current value 4.

### Neglect population and funds: seed 7 PASS, seed 11 FAIL

Comparisons here are against the branch's attentive base of the same size/seed.

| Seed | Base population | Neglect population | Change | Base funds | Neglect funds | Change | Gates |
|---|---:|---:|---:|---:|---:|---:|---|
| 7 | 1,550,356 | 1,332,759 | −14.0353% | §18,419,687 | §17,847,550 | −3.1061% | PASS population ≤−2%, funds no higher |
| 11 | 1,494,630 | 1,536,884 | +2.8271% | §13,987,823 | §17,628,691 | +26.0288% | FAIL both |

### Approval cost and dev reference comparison

The source approval formula is untouched. In branch seed 7, neglect's final total approval is 72.8761 versus 79.4023 (−6.5261 points), and its final emergency term is −8 versus −1.4. Mean yearly emergency terms are −4.9380 versus −1.0165 (−3.9215 points).

In branch seed 11, neglect's final total approval is 73.9821 versus 81.1569 (−7.1748 points), and its final emergency term is −7.0069 versus −0.9. Mean yearly emergency terms are −4.0984 versus −0.7564 (−3.3420 points).

Two completed source-snapshot runs supply the dev neglect references. The attentive dev approval comes from the `b3` fixture (rounded to 0.01 point); neglect approval is recorded at full precision. Older report numbers are not substituted for current dev.

| Seed | Dev attentive/neglect final approval | Dev year-60 approval cost | Branch year-60 approval cost | Year-60 gate |
|---|---|---:|---:|---|
| 7 | 80.36 / 76.0251 | 4.3349 | 6.5261 | PASS, larger by 2.1912 points |
| 11 | 81.36 / 74.3485 | 7.0115 | 7.1748 | PASS, larger by 0.1633 points |

The whole-run mean of yearly attentive-minus-neglect approval is 3.9119 → 5.3077 points for seed 7, but 4.9158 → 2.5124 for seed 11. Thus the year-60 interpretation passes; a requirement that the average approval cost also be unchanged or larger would fail for seed 11. The plan does not specify that aggregation. Dev neglect endpoints are 1,390,920 / §14,168,774 (s7) and 1,455,512 / §14,334,083 (s11); their mean yearly emergency terms are −4.7449 and −4.7100.

### Base tourism and failures

Tourism is `econData(st).tourism / demandContext(st, rt).tourism`: current tourism jobs divided by the legacy jobs formula, sampled monthly and averaged over the last 12 samples. The table shows all monthly 12-month means from day 5,400 onward, plus the yearly endpoints. Failure shares use the rolling 12 monthly outcome buckets.

| Base run | Tourism ratio at yearly rows from year 15 | All monthly means from end of year 15 | Largest yearly failure share from year 10 | Largest monthly rolling failure share from year 10 | Gates |
|---|---|---|---:|---:|---|
| 128×15 s7 | 0.8996 | 0.8996 | 3.4483% | 3.5088% | PASS tourism 0.7–1.3, failed ≤5% |
| 256×60 s7 | 0.8788–1.2119 | 0.8741–1.2433 | 2.3669% | 3.2787% | PASS both |
| 256×60 s11 | 0.9449–1.3593 | 0.9007–1.3724 | 0.9615% | 1.1494% | FAIL tourism; PASS failures |

The refreshed monthly failure maxima start the stricter year-10 window at its first monthly sample, day 3,270. All three base runs remain below 5%.

## Reproducible commands and output

Run from `C:/Users/techsin/Desktop/projects/simcityweb-T043`. The exact equivalent simbot option sets used for the five gate runs and the repeat are:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --neglect
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --neglect
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

Those are equivalent bot configurations, not a claim that unavailable `npx tsx` executed. The actual fallback commands are below. Run each command to completion before starting the next. The loader URL must use `file:///`; Node's loader argument rejects a plain `C:/` URL. `--experimental-transform-types` is needed for the existing TypeScript enums.

```powershell
$S = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T043/scratch'
$Q = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$S/gate_128x15_s7_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 7 --quiet --out "$S/gate_256x60_s7_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 7 --quiet --neglect --out "$S/gate_256x60_s7_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 11 --quiet --out "$S/gate_256x60_s11_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$S/gate_256x60_s11_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$S/gate_128x15_s7_repeat.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$S/dev_128x15_s7_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 7 --neglect --quiet --out "$S/dev_256x60_s7_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 11 --neglect --quiet --out "$S/dev_256x60_s11_neglect.json"
```

The same driver and options with `ts-base.mjs` instead of `ts-resolve.mjs` read the scratch snapshots of the original source, producing `dev_128x15_s7_base.json` and the two `dev_256x60_s<seed>_neglect.json` references. Native smoke verification uses:

```powershell
node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/neglect-smoke.mts"
```

The authored Vitest files still need these allowed, gated invocations on the lead's environment:

```powershell
node "$Q" npx vitest run tests/sim/neglectSafety.test.ts --maxWorkers=1
node "$Q" npx vitest run tests/sim/neglectScars.test.ts --maxWorkers=1
```

## Plan/code differences and ownership requests

- **Annual fewer-newcomers wording needs a definition.** Migration currently scales residential capacity targets, not an arrival ledger. `emergencyMigrationImpact` reports the same city's current target shortfall against crime-only safety, holding the other inputs fixed. It does not claim a causal count of actual arrivals, and repeated monthly target stocks are not added into an annual flow. The panel's exact “Y fewer newcomers this year” cannot be supplied honestly without a defined estimate or a new arrival-flow model. Route this wording/definition to the lead and META.
- **The existing migration clamp supplies ±12%.** Safety now feeds that existing path through attractiveness. Adding a second multiplier would count safety twice and expand the total bound. This interpretation is explicit; it does not cure the failed balance gates.
- **Current reference rows differ from plan context.** Older plan and LG-10 population/funds examples predate B1/B3. Comparisons above use `b3`; no fixture was changed and no `polish` sign-off is claimed.
- **Scar timing:** the saved source expiry is exactly 18 months; the existing derived-raster refresh can lag it. Request B2 add a minimal scar-creation/next-expiry invalidation hook in `src/sim/infra/services.ts` (`due`/`prep` and NIMBY dirty handling). This file was not edited. Avoid a full synchronous raster rebuild on a burn-down.
- **Budget UI, cloud-held:** in `src/ui/panels/BudgetPanel.ts`, add `emergency:rebuild` to the existing `GROUP_LABELS`/`SLIDER_GROUP` handling with the exact label **“Rebuilding after emergencies”** and appropriate grouping. The simulation budget line exists; the UI file was not edited.
- **Emergencies panel, cloud-held:** in `src/ui/panels/EmergenciesPanel.ts` `renderStats`, read mirrored `stats.emergency.year.unansweredRebuildCost` (or `emergencyRebuildCosts(...).unansweredYear`). Use the target estimate only with wording agreed above; do not label it actual annual arrivals. Include that estimate in the render signature if it is displayed: the current signature covers emergency stats only. No live system read is needed.
- **Banner, META's round-3 hunk:** in `src/ui/EmergencyBanner.ts` `onEvent`, append the formatted rebuild amount to the outcome after the existing `b.inc = ctx.host.emergency.incident(e.id) ?? b.inc` read. `b.inc.rebuildCost` carries the outcome's amount. `IncidentRecord` already aliases `Incident`, and incident encoding already structured-clones it, so the new optional field crosses the existing stream. Display rounding belongs with the currency formatter. The banner/lifecycle files were not edited.
- **Worker audit, cloud-held:** add `emergencySafety`, `emergencyMigrationImpact` and `emergencyRebuildCosts` to `src/worker/replicaSafe.ts` and its parity/purity tests before UI adoption; include scalar `emergencyRebuildCost` if that catalog also lists scalar utilities. The helpers read mirrored data and return plain values. No worker file was edited.
- **Optional source-position mirror, cloud-held:** if rendering/UI needs source footprints or remaining durations, add `emergencyScars` to `src/worker/protocol.ts` `SYSTEM_KEYS`. `systemData.economy.safetyMigrationLoss`, the emergency stats and the stigma raster already use existing mirrors. Mirroring the scar source list is not required just to render its stigma.
- **Prestige view hook, render owner:** the existing `Overlay.Nimby` path reads `st.stigma` and shows prestige minus stigma. The scar splat is already in that raster. Source outlines, positions or expiry tooltips can use the optional mirrored list above. No render file was edited.

All cloud-held files remain untouched. The task footer's push/`.done` request is superseded by the user's explicit instruction to leave changes uncommitted.

## Left for the lead

The balance misses need a lead decision or further balance work; the current results do not satisfy LG-06 acceptance. Run the authored tests, all individual affected regression/hygiene checks, and the full Vitest suite in an environment where Vitest can spawn. Actual Worker/Loopback UI behavior, browser rendering, GPU/performance checks and B2's integration are unverified. This lane did not run a browser, a benchmark or the full suite.

Browser acceptance checklist:

- [ ] In an attentive and an ignored-call city, inspect Safety, attractiveness, migration and the following tourism pass; check that the displayed effect agrees with the modeled target estimate.
- [ ] Cause §56,000 monthly damage: the current forecast shows §8,400, rollover charges §8,400 once under the exact rebuilding label, and a following clean month adds no second charge.
- [ ] Compare an unanswered burn-down with a late-answered burn-down: both incur rebuilding; only the unanswered loss creates a scar and unanswered subtotal.
- [ ] Open Prestige/NIMBY and verify the scar's 0.15 core, radius-3 falloff and overlap behavior. Check creation/expiry update latency with the existing cadence and again after B2's hook.
- [ ] Bulldoze or rebuild the burnt lot; the timed neighborhood scar remains until its source expiry.
- [ ] Save halfway through a scar, reload and compare the exact source footprint/expiry and stigma after refresh. Continue through 18 months and verify expiry.
- [ ] Load an older save with no scars/cost fields, advance months and confirm normal play, no historical-year rebilling, and zero fallbacks in the new UI rows.
- [ ] Repeat the relevant readouts, costs, save/load and outcome checks with LocalSimHost and Loopback/Worker, using host reads and existing stream data.
