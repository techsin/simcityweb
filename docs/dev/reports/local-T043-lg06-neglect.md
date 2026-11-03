# local-T043-lg06-neglect: Round 3

Branch `local/T043-lg06-neglect`; merged dev base `683d02b` through `c12dc75`. **Round 3 is in progress: the shared A/A envelope is zero, the completed EM_REP=12 profile fails, and the final bounded EM_REP=24 profile is pending.** The original infrastructure commit `7c0e586` still **holds for B2**. Round-3 changes are uncommitted; the approved panel and additive Worker audit hunks are kept small for the lead to commit separately. No commit, push or `.done` file was made in this round. The Review-1 report below is preserved as historical evidence; its final-status and open-decision statements describe that earlier round only.

## Lead decisions and amendments to LG-06

`docs/dev/queue/NOTE-048-desk-requests.md`, “T043 (LG-06): the four decisions” and “The SIM balance rule”, supplies the following amendments:

- Retain the safety record, the **15%** rebuilding charge and **18-month** scars. This round does not change the bot's default strategy, growth/jobs/map/redevelopment calibration or tourism-ratio denominator.
- Replace the original all-year ±0.5% population gate with **every yearly base row from year 10 within max(±1%, that command row's shared A/A envelope)**. Investigate a systematic same-direction movement exceeding half the respective tolerance on all three command rows. The shared envelope also records air at homes, approval and I-HT share. Final gates must be repeated against the post-NEW-05 dev/envelope when that base lands.
- Judge “approval cost unchanged or larger” by the **year-60 gap, neglect minus attentive**, versus the same seed with LG-06 off at the same base, allowing **0.5 approval points** of slack. Thus `gap_on <= gap_off + 0.5`. Report the mean annual gap from year 10 separately; it does not gate.
- A variant miss smaller than its metric's A/A envelope counts as met only when the intended direction holds on the other seed; report the actual miss and margin. The envelope is evidence, not a replacement assumed tolerance.
- Amend the original panel's “Y fewer newcomers” wording to the approved **current multiplier** wording: “Cost of unanswered emergencies this year: §X rebuild; the safety record is cutting newcomers by N %”. Round N to a whole percent and hide the percentage clause at zero. There is no new arrival ledger.

The panel amendment is implemented. `emergencyMigrationImpact` now also returns a read-only aggregate multiplier, `R / (R + loss)`, using current nonnegative uncapped residential targets and their same-state counterfactual safety losses. It keeps full precision before display rounding, weights the wealth tiers by their targets and returns 1 for old saves or zero usable residential targets. The helper uses the existing mirrored economy outputs; it performs no simulation writes, initialization or RNG draws.

## Round-3 changes by file

- `src/sim/economy/tourism.ts`: add the aggregate `multiplier` to the existing pure `emergencyMigrationImpact` result. Existing safety scoring, migration behavior and stored outputs are unchanged by this display-reader extension.
- `src/ui/panels/EmergenciesPanel.ts` — **newly approved formerly cloud-held hunk**: add the exact cost row in Statistics. Read through `ctx.state`, the host's mirrored state; include the rounded cut in the render signature so the text refreshes even when emergency statistics do not change. Read actual rounded trailing-year unanswered rebuilding charges, not this month's unbilled estimate.
- `src/worker/replicaSafe.ts` — **approved additive Worker hunk**: register `emergencyRebuildCosts` and `emergencyMigrationImpact`. No protocol/schema/system-key change is needed: emergency stats and `systemData.economy` already travel in packets.
- `tests/worker/replicaSafe.test.ts` — **minimal approved registry audit hunk outside the original named files**: add the two readers to the existing parity/purity check calls.
- New `tests/sim/neglectMigrationImpact.test.ts`: **8 cases**, covering pure old-save fallbacks, target weighting, full-precision percentage rounding, unusable tiers, zero targets, missing optional losses and mid-month save/load with and without a saved venue pass.
- New `tests/sim/neglectPanel.test.ts`: **3 cases**, covering exact cost/current-percentage text, hidden rounded-zero percentages and refresh with unchanged emergency statistics. A hostile `ctx.sim` getter rejects accidental live-system reads.
- New `tests/sim/neglectReplica.test.ts`: **2 packet-host cases**, checking Ready and subsequent-packet parity/purity/copy isolation, plus neutral old-save fields on a real `LoopbackSimHost` with explicit empty modules.
- `docs/dev/reports/local-T043-lg06-neglect.md`: this current-round record, followed by the preserved historical report.

There are **no new infrastructure hunks in Round 3**. The emergency/nimby hunks itemized in the historical report remain separately held for B2. The optional `CityState.ts` interfaces from the original WIP also remain unchanged.

## Constants and bounded screening

The production source currently retains `EM_REP = 4` while scratch-only snapshots test **8**, **12** and **24**. Each trial changes that constant alone. They do not resurrect the rejected Review-1 migration mappings. No final profile has yet been selected.

Unchanged values: `EM_DEATHS_PER_1000 = 0.002`; `EM_REP_N0 = 30`; `REBUILD_SHARE = 0.15`; `EM_SCAR = { amount: 0.15, radius: 3, days: 18 * DAYS_PER_MONTH }`; the existing migration range `0.88–1.12`; and the existing tourism/attractiveness safety weights. No broader calibration is included. In particular, the SIM rule's prohibition on weakening specified costs is respected.

The initial 128×15 seed-7 screen is complete. Largest movement below is measured only over the newly gating years 2010–2015. Tourism is the trailing mean of 12 monthly new/legacy tourism-job ratios at year 15. **Every on profile in this table fails the amended 1% base-population gate**; the shared A/A envelope supplies no additional tolerance.

| Profile | Population 2015 | Funds | Approval | Largest absolute population movement from year 10 | Tourism at year 15 | Maximum failed share from year 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LG-06 off | 192,899 | §146,349 | 81.3650175 | 0% | 1.2043515 | 0% |
| Retained `EM_REP = 4` | 195,379 | §152,842 | 78.8664800 | 3.0643043% | 0.8996060 | 3.5087719% |
| Trial `EM_REP = 8` | 196,351 | §194,576 | 81.6700592 | 3.9998396% | 1.2310974 | 0% |
| Trial `EM_REP = 12` | 195,544 | §152,025 | 80.0462081 | 2.3618707% | 1.2092658 | 0% |

The response is not monotone in final population: the direct score is monotone, but stronger penalties also change discrete construction and affordability decisions. The prior ablations and seed-11 trace below establish those feedback paths. The 12 profile was selected for full-sized trials because its 128 screen has the smallest maximum post-year-10 population drift of the three on profiles; that is a reason to test it, not evidence that both 256 gates pass.

## Full-size gates and shared envelope

The shared report is now available through `git show local/T062-sim-aa-envelope:docs/dev/reports/sim-aa-envelope.md`, commit **`3833c8d2379d3350663e624fe30be7867c559310`**. It completes all six independent processes. **All twelve row/metric A/A envelopes are exactly zero**: the day-1 +§1 funds nudge remains exactly +§1 in annual funds, with no divergence in population, air, approval or I-HT share. This measures the specified perturbation; it does not demonstrate an envelope for larger costs or shocks. The amended base bands therefore remain **1%**, and there is no positive A/A allowance for a missed variant target.

T062 measured underlying dev `9fcc2ec` plus its task-file commit `0df76bce`. The read-only diff against `683d02b` is empty for **SIM, core, bot and Worker sources**, so its baseline applies here without a numerical rebaseline. The earlier fetch write restriction was bypassed by reading the newly available local ref; no shared Git metadata was written by this lane. NEW-05 is signed off in documentation but its runtime is not in this base; the SIM rule still requires final gates against the subsequent dev/envelope including NEW-05.

### Completed EM_REP=12 profile

All four 256×60 runs completed, one at a time through the quiet gate. This profile changes **only EM_REP, 4 → 12**, and is **not selected for production**. Its current 128 result is 195,544 residents, §152,025 and approval 80.0462081; population moves +1.37118% at the endpoint and reaches +2.36187% in a gating year.

| Seed | Attentive population | Neglect population | Neglect population gap | Attentive funds | Neglect funds | Funds gap | Population/funds gates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 1,390,161 | 1,443,396 | **+3.8294126%** | §18,880,115 | §17,259,391 | −§1,620,724 | **FAIL / PASS** |
| 11 | 1,384,178 | 1,343,735 | **−2.9218063%** | §20,521,861 | §19,143,688 | −§1,378,173 | **PASS / PASS** |

Seed 7 misses the required −2% population target by **5.8294126 percentage points** and has the wrong direction. Seed 11 clears it by 0.9218063 points. Both funds comparisons pass strictly. A/A supplies no near-miss credit.

The approval references below use T062's full-precision annual attentive approval table and the existing same-source off-neglect JSON, rather than the older balance fixture's two-decimal approval values. Report precision is 12 significant digits; these differences are far larger than its display rounding. The same-source comparison is backed by the source provenance above.

| Seed | Attentive approval | Neglect approval | Year-60 gap | LG-06-off gap | Largest permitted gap after 0.5 slack | Miss beyond slack | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 79.0592265450 | 77.3867087367 | −1.6725178083 | −4.3323668620 | −3.8323668620 | **2.1598490538 points** | **FAIL** |
| 11 | 79.5746997143 | 73.2039988460 | −6.3707008684 | −7.0081926632 | −6.5081926632 | **0.1374917948 points** | **FAIL** |

Mean annual approval gaps over 2010–2060, reporting only: seed 7 **−3.2824051469** versus off **−3.8879495827**; seed 11 **−4.5321751003** versus off **−5.1618123068**. The costs shrink in both means, but only the year-60 comparison gates.

| Row | Largest base population movement from year 10 | Year | Attentive tourism monthly bounds from year 15 | Maximum attentive rolling-year failed share from year 10 | Base population / tourism / failed gates |
| --- | ---: | ---: | ---: | ---: | --- |
| 128×15 s7 | +2.3618707% | 2012 | 1.2092658–1.2092658 | 0% | **FAIL / PASS / PASS** |
| 256×60 s7 | −8.6672736% | 2059 | 0.7498500–1.1422135 | 2.4390244% | **FAIL / PASS / PASS** |
| 256×60 s11 | −4.1438556% | 2052 | 0.8200349–1.2419598 | 1.6129032% | **FAIL / PASS / PASS** |

For completeness, neglect tourism monthly bounds are **0.7912311–1.1023346** on seed 7 and **0.7899194–1.2002925** on seed 11. Their maximum rolling-year failed shares are 7.0175439% and 10%, respectively; the ≤5% condition is a **base-run** gate, not a requirement for a deliberately neglectful city. Tourism bounds use the trailing mean of twelve monthly ratios at every monthly observation from year 15, rather than annual endpoints alone.

The following are the largest absolute **annual** changes from year 10 against T062's matching off rows, retaining the sign at the maximum. Air and I-HT are fractions; approval is in points. These are metric changes, not A/A envelopes:

| Base row | Population | Air at homes | Approval | I-HT share |
| --- | --- | --- | --- | --- |
| 128×15 s7 | +2.3618707% (2012) | −0.0088923068 (2015) | −1.3188094242 points (2015) | +0.0071208791 (2013; +0.7120879 points) |
| 256×60 s7 | −8.6672736% (2059) | −0.0170294056 (2047) | +4.2478121283 points (2012) | −0.1023986676 (2060; −10.2398668 points) |
| 256×60 s11 | −4.1438556% (2052) | +0.0263576178 (2011) | −4.5180430786 points (2021) | +0.1160789841 (2054; +11.6078984 points) |

**Systematic-shift investigation:** population endpoints have mixed signs (+1.37118%, −8.16958%, −3.02395%), so the three-row same-direction population trigger does not fire. Air and I-HT endpoint changes also have mixed signs. Approval endpoints all decrease: **−1.3188094, −1.2981982 and −1.7819948 points**, respectively. Each exceeds half its 1% relative base-approval band, so the broader metric check flags an approval shift for investigation. No approval term or free compensating bonus was changed. The mechanics do not directly edit approval, and the old ablations establish migration/tourism/spending/layout feedback; they do not decompose this profile's exact approval loss. Matching off term-level diagnostics remain necessary before attributing that loss to a particular approval term.

### Final bounded profile

ROUND3_REP24_PENDING

The remaining scratch-only profile changes **only EM_REP, 4 → 24**, and comprises a 128 screen plus both attentive/neglect 256 pairs, run serially. It tests stronger record exposure under the existing migration clamp; it is not a predicted correction to the base rows. The 4/8/12 screens and prior ablations already show nonmonotone final outcomes from monotone direct penalties. The production source still retains 4 pending the final disposition. No costs are weakened and no unrelated calibration is authorized by this additional trial.

## Same-base provenance and commands

`git diff --name-only fb1531f 683d02b -- src/sim src/core tools/simbot.ts` is empty; the corresponding SIM/core/bot/Worker diff from `683d02b` to T062's `9fcc2ec` base is also empty. The Round-3 off snapshots were nevertheless normalized to the **exact Git blob bytes at 683d02b**, rather than relying on the old exports' line endings. Scratch `review3/base-provenance.json` records:

| Off source | Git blob at `683d02b` |
| --- | --- |
| `src/sim/economy/tourism.ts` | `4fa042058064d40754e47738ef79a776b6bc5b51` |
| `src/sim/economy/budget.ts` | `c1e4e411ad9fe4b467ec59f08a3a952f1557b688` |
| `src/sim/economy/tuning.ts` | `ba9c80a6fc3e4addb2dfbbbe5aaacfb025bb1371` |
| `src/sim/infra/emergency.ts` | `21dc0739de87025f3f0542432cc9f8882e793928` |
| `src/sim/infra/nimby.ts` | `e78ff0689b7e5c1ea3a8f1ecbf8bbc9665b9b5d7` |

A fresh 128×15 off process reproduces **all 15 prior yearly hashes**, ending at 192,899. A fresh retained-4 process also reproduces **all 15 prior yearly hashes**, ending at 195,379. This confirms that the new pure display helper does not alter saved simulation state or the original WIP trajectory. This is one new process per profile compared with existing independent processes; it is not a claim that two new repeats were run for every trial.

Run from `C:/Users/techsin/Desktop/projects/simcityweb-T043`. The equivalent option sets remain:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --neglect
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --neglect
```

As in Review 1, the actual fallback uses Node 22 TypeScript transformation and an extension resolver because `tsx` is unavailable offline. All trial switches and frozen source copies stay in scratch. **All eight commands below completed**: the four initial 128 screens and the four EM_REP=12 full-sized runs. EM_REP=24's separate queue remains pending in its section above.

```powershell
$S = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T043/scratch'
$R = "$S/review3"
$Q = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=off" "$R/gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/128_s7_off_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep4" "$R/gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/128_s7_rep4_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep8" "$R/gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/128_s7_rep8_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep12" "$R/gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/128_s7_rep12_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep12" "$R/gates.mts" --size 256 --years 60 --seed 11 --quiet --out "$R/256_s11_rep12_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep12" "$R/gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$R/256_s11_rep12_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep12" "$R/gates.mts" --size 256 --years 60 --seed 7 --quiet --out "$R/256_s7_rep12_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep12" "$R/gates.mts" --size 256 --years 60 --seed 7 --quiet --neglect --out "$R/256_s7_rep12_neglect.json"
```

## Round-3 checks and remaining integration

TypeScript has passed with the new display/packet-reader code. The ordinary Vitest startup still failed with `spawn EPERM`, but T062's **native config loader and threads pool workaround succeeds**. Every file below was run separately through the quiet gate with `--maxWorkers=1`; these are actual formal Vitest results, not native-adapter substitutes:

| Test file / check | Result |
| --- | --- |
| `tests/sim/neglectReplica.test.ts` | **2 passed**; real Loopback Ready/subsequent packets, read parity/purity and old fields |
| `tests/sim/neglectMigrationImpact.test.ts` | **8 passed** |
| `tests/sim/neglectPanel.test.ts` | **3 passed** |
| `tests/sim/neglectSafety.test.ts` | **11 passed** |
| `tests/sim/neglectScars.test.ts` | **6 passed** |
| `tests/worker/replicaSafe.test.ts` | **2 passed, 1 skipped** |
| `tests/worker/hygiene.test.ts` | **17 passed, 1 skipped** |
| `npx tsc --noEmit` | **PASS** with the Round-3 implementation |

That is **49 formal cases passed and 2 skipped** across seven separately run files. The new formal packet-host cases supersede the earlier native adapter's CSS-import startup limitation. Short native probes additionally passed **10 mechanics**, **8 impact** and **3 panel** cases; they are redundant supporting checks, not additional formal-case coverage or a browser claim. No final native packet-adapter rerun is needed after the real packet-host file passes.

The exact successful invocation form, run from this worktree, is shown below; repeat it separately for each listed test file (substituting only the file argument):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T043/node_modules/vitest/vitest.mjs run tests/sim/neglectReplica.test.ts --maxWorkers=1 --configLoader native --pool threads
```

The successful workaround does not erase the ordinary startup failure, and skipped cases remain skipped. **The full suite, browser/real-Worker rendering, B2 integration, GPU timing and benchmarks remain for the lead** under the supplied restrictions. Post-NEW-05 final bot/envelope remeasurement also remains as required by NOTE-048.

The newly approved panel and Worker read requests are fulfilled by the small hunks above. Outstanding requests from the original WIP remain:

- **B2, `src/sim/infra/services.ts` due/prep and NIMBY dirty handling:** invalidate on scar creation and next expiry; avoid a synchronous full raster rebuild at burn-down. Source footprints/absolute expiries persist exactly, but the existing raster cadence can lag them by about 30 game days.
- **GUIDE/cloud, `src/ui/panels/BudgetPanel.ts`:** label/group `emergency:rebuild` as **“Rebuilding after emergencies”**. The charge already exists in budget data; this held file is untouched.
- **META, `src/ui/EmergencyBanner.ts` outcome text:** append the formatted incident rebuilding amount from the existing host-delivered optional `Incident.rebuildCost`. This round's panel permission does not authorize the banner hunk.
- **Prestige rendering:** the existing NIMBY/Prestige overlay already reads the scarred `st.stigma` raster. Footprint/expiry outlines would additionally require an optional `emergencyScars` source mirror, but no such source UI is needed for the specified splat and no protocol entry was added.

Browser checklist for the lead:

- [ ] Statistics shows settled unanswered rebuilding and the approved whole-percent current cut; a rounded-zero cut hides only that clause, and changing the current multiplier refreshes the row.
- [ ] Compare attentive/ignored-call safety and the following tourism pass; confirm no fixed-input emergency migration bonus.
- [ ] Cause §56,000 damage: forecast and settle §8,400 exactly once, with the requested budget label after its owner integrates it.
- [ ] Compare unanswered/late-answered burn-downs: both rebuild, only unanswered losses create scars and unanswered cost attribution.
- [ ] Prestige shows the .15 core/radius-3 falloff and overlapping scars; check creation/expiry cadence with B2's invalidation hook.
- [ ] Rebuilding the lot leaves its source until 18 months; save midway, reload exact footprint/expiry and continue through expiration.
- [ ] Old saves without optional counters/list/losses continue, display neutral fallbacks and do not retroactively bill historical months.
- [ ] Repeat costs, current-multiplier refresh, outcomes and save/load with LocalSimHost and packet/Worker hosts; browser rendering remains unverified by native adapters.

---

# local-T043-lg06-neglect: Review 1

Branch `local/T043-lg06-neglect`, base `fb1531f` plus the task-file commit. Status: **holds for B2; BALANCE GATES FAIL**. The original WIP is preserved in `7c0e586` (infrastructure hunks, held for B2) and `7b1f376` (economy, tests and report). **Final runtime source remains that original WIP.** Review 1's rejected migration candidate and its new tests were archived to scratch and rolled back; only this report update remains uncommitted. No new commit, push, merge or `.done` file was made in Review 1.

Review 1 separates direct effects from the bot's later feedback, records the complete seed-11 WIP pair before calibration, and tests an explicit non-positive emergency migration factor. **Candidate B is rejected and NOT RECOMMENDED FOR MERGE.** Its 128×15 diagnostic fails the ±0.5% base requirement, and its 256×60 seed-7 attentive run regresses to 1,253,791 residents (−17.1778% versus dev). All four full candidate runs are complete and fail the combined acceptance requirements, as recorded below. Its runtime changes were not promoted; immutable scratch runs are unaffected by the source rollback. Final verification of the restored runtime and archived candidate is recorded separately in Checks.

## Rejected migration candidate and choice

The specified safety score remains unchanged:

```text
C = clamp(1 - 1.6 * crime, 0, 1)
S = clamp(1 - 1.6 * crime - EM_REP * failed12 / (incidents12 + 30)
          - 0.002 * deaths12 * 1000 / population, 0, 1)
r = C > 0 ? 1 - 0.12 * clamp((C - S) / C, 0, 1) : 1
```

Empty-city deaths contribute zero, as before. In the rejected candidate, tourism retained the full safety score S while migration computed a separate, crime-only attractiveness A0 with the original per-weight summation order. It applied r immediately after the existing initial 0.88–1.12 clamp, keeping the 0.88 floor, then ran the unchanged unemployment rule, population fade and school adjustment. Its optional fifth `migrationFactor` argument defaulted to 1, and `MIG_SAFETY_MAX = 0.12` named the maximum new relative cut. These candidate APIs/constants are archived, not present in the retained runtime.

The neutral point is the same city's crime-only safety C, not a fixed score above which a new bonus appears. At C = 0.8, S = 0.8 gives r = 1; S = 0.6 gives r = 0.97; S = 0 gives r = 0.88. At C = 0 the new factor is neutral because crime-only safety is already saturated at zero. At any crime level, zero emergency loss produces r = 1. Existing positive migration from other attractiveness terms is retained; the new emergency contribution never adds a bonus.

The retained original WIP is already non-positive at identical inputs: it subtracts a nonnegative emergency deduction from safety, and its score weights and migration transforms are monotone. Higher final population therefore does not prove a positive mathematical emergency bonus. The Review-1 candidate made an emergency-only neutral point and maximum cut explicit, separated it from tourism and avoided counting emergency safety twice, but did not meet the balance requirements. That semantic distinction does not justify retaining the regression.

Two bounded candidates were tried, with rebuilding and scars left at their specified values:

| 128×15 s7 candidate | Attentive population | Funds | Approval | Largest absolute base yearly-row movement | Neglect population | Neglect funds | Neglect approval |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed neutral 0.75 | 196,697 | §178,787 | 81.6570 | 6.73335% | 196,709 | §149,823 | 81.5744 |
| Crime-only relative neutral, rejected | 196,169 | §157,521 | 78.4282258 | 6.75487% | 195,805 | §132,083 | 79.8907355 |

The fixed candidate used `r = 1 + .12 * clamp((S - .75) / .75, -1, 0)`; 0.75 was a trial neutral near the control's measured median crime-only safety, 0.7516291 (median full safety 0.7515389). Its attentive endpoint moves about +1.9690% versus dev. It also penalizes a city with C = S < 0.75 despite no emergency loss. The relative candidate avoids that additional crime penalty; it was selected for implementation/testing on that invariant, not accepted for merge or because its endpoint passed. Its attentive 128 endpoint is +1.6952% versus dev; residents are `[62667, 94560, 38942]`. Its 128 neglect endpoint is −0.1856% versus its own attentive run, with §25,438 fewer funds. This 128 comparison is diagnostic; the task's ≥2% neglect target is on 256×60. The later severe full-size base regression supersedes any preference based on this small sample.

No claim of impossibility follows from this small candidate set. The fixed rebuilding and scar effects already move some base yearly rows outside ±0.5% individually; other effects can interact or cancel them. Such cancellation has not been established as stable across both sizes and seeds. The round is bounded to the declared candidates rather than searching neutral points until one seed happens to pass.

## Ablations before recentering

All six 128×15 seed-7 runs use immutable scratch sources. Each isolated mode enables only the named direct mechanism; all WIP mechanics uses the original committed mapping. Migration and tourism have separate local score sets derived from one survey/pass. The control retains the original crime-only expression and weight-summing order. Its endpoint reproduces dev's 192,899 residents, funds §146,349 and resident triplet `[61124, 93804, 37971]`.

| Mode | Population in 2015 | Change versus control | Funds | Approval | Largest absolute yearly-row movement |
|---|---:|---:|---:|---:|---:|
| Control | 192,899 | 0% | §146,349 | 81.3650 | 0% |
| Migration safety only | 193,366 | +0.2421% | §225,461 | 81.3959 | 2.8454% |
| Tourism safety only | 195,347 | +1.2691% | §191,210 | 80.2564 | 5.0231% |
| Rebuilding only | 191,979 | −0.4769% | §204,789 | 81.0808 | 1.0982% |
| Scars only | 196,593 | +1.9150% | §198,260 | 81.7901 | 7.5078% |
| All original WIP mechanics | 195,379 | +1.2856% | §152,842 | 78.8665 | 7.2604% |

The separate 128×15 control-neglect reference ends at 191,351 residents, §157,502 and approval 80.859834, versus attentive control's 192,899 / §146,349 / 81.3650. It uses the same control loader with only `--neglect` added.

The effects are not additive. Rebuilding's endpoint is inside ±0.5%, but its year-6 row fails. Scars alone fails from year 1. The diagnostic `lg06Diag` and optional loss fields are additional serialized data, so these ablations are not claimed to have byte-identical full saves versus dev. They are controls for gameplay outputs and causal comparisons.

The sourced findings are in scratch `review1/feedback-findings.md` and `review1/seed11-causal-analysis.md`, backed by the JSON's monthly before/after bot snapshots:

- **Scars:** the simulation diverges before a bot purchase does. On day 240 the scar-only city has 2,006 people versus control's 1,975, crossing `ensureServices`' 2,000-person police threshold a month earlier. This is an observed purchase fork. Earlier changed school-need text is not a changed build choice.
- **Rebuilding:** the first bill is §84 on day 120. Actions and population remain identical for five years. On day 2,010 the rebuild-only bot buys three bus stops while control buys four. Source and balances indicate that the §84 difference crosses the repeated `canSpend(2000)` reserve test; the exact intra-loop balances are inferred, not instrumented. Year 6 ends −1.0982%, then year 7 reverses to +0.9709%.
- **Tourism:** its direct effect is lower tourism jobs on days 240/270/300. Population/buildings then diverge before the first changed actual zoning choice on day 390, when control also develops an industrial block. Tourism changes CS job targets, discrete growth and later bot geography. The trace does not identify the exact first daily lot choice responsible for the final gain.
- **Seed 11:** attentive and neglect WIP runs match through 2003. On day 1,200 attentive base can buy a §12,000 prison; neglect misses the investment floor by §60.4 and buys a clinic, delaying the prison one month. On day 1,290 base has a §2,400 rebuild charge, monthly net −§432 and no actions, while neglect has no damage that month, net +§3,070 and develops housing plus a clinic. Later incidents are no longer paired calls. Neglect develops an industrial block on day 1,320 which base delays until day 2,100. Taxes, loan counts and nominal funding match across the inspected early fork.
- **Seed-11 safety and tourism:** in 2006 safety is 0.512435 base versus 0.755357 neglect, but the latter's crime-only score is 0.755402. Almost all that gap is changed crime/layout, not an emergency-response reward. The base tourism ratio reaches 1.357834 in 2016 and 1.359295 in 2017 while its legacy denominator remains only 1,700/1,800 jobs; after the Convention Center raises the denominator to 3,300, the ratio falls. Lowering EM_REP cannot be presumed to correct a venue-mix/timing ratio overshoot. A smaller 1.30105 overshoot also occurs in 2022.

The seed-11 neglected city is already +51.1953% ahead in 2006 and finishes +2.8271%; seed 7 lacks that early lead and finishes −14.0353%. Same initial seed does not keep later incidents or maps matched after the simulation and dispatch paths fork. Monthly net is the latest recurring monthly budget, not annual cashflow, and excludes oneoff investments.

## Complete seed-11 WIP table captured before tuning

Both 256×60 telemetry reruns reproduced the original WIP endpoints before any calibration. Source: scratch `review1/seed11-before-tuning.md`, with its JSON/CSV and `wip_256_s11_{base,neglect}.json`. All 60 yearly pairs have an explicit scored safety value; no total attractiveness value was substituted for safety. Failure shares are trailing-12-month failures/incidents. Tourism is the trailing mean of 12 monthly ratios of current tourism jobs to the legacy jobs formula.

| Year | Base pop | Neglect pop | Neglect % | Base funds | Neglect funds | Base approval | Neglect approval | Base failed % | Neglect failed % | Base safety | Neglect safety | Base tourism 12m | Neglect tourism 12m |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2001 | 3749 | 3749 | 0 | 34402 | 34402 | 51.1192 | 51.1192 | 100 | 100 | 0.423648 | 0.423648 | 0.628969 | 0.628969 |
| 2002 | 10335 | 10335 | 0 | 35326 | 35326 | 51.7186 | 51.7186 | 0 | 0 | 0.559534 | 0.559534 | 0.327988 | 0.327988 |
| 2003 | 18265 | 18265 | 0 | 9595 | 9595 | 46.8594 | 46.8594 | 0 | 0 | 0.511525 | 0.511525 | 0.276385 | 0.276385 |
| 2004 | 24920 | 26284 | 5.4735 | 7915 | 8908 | 44.4292 | 42.9357 | 4.3478 | 4.3478 | 0.42095 | 0.418413 | 0.27322 | 0.269376 |
| 2005 | 27451 | 33589 | 22.3598 | 9876 | 27941 | 46.927 | 42.649 | 0 | 6.6667 | 0.483152 | 0.413237 | 0.279435 | 0.277724 |
| 2006 | 29700 | 44905 | 51.1953 | 25391 | 38373 | 47.9562 | 55.04 | 0 | 0 | 0.512435 | 0.755357 | 0.289879 | 0.356534 |
| 2007 | 38163 | 56983 | 49.3148 | 31904 | 45274 | 54.6486 | 58.3053 | 0 | 3.125 | 0.733588 | 0.713263 | 0.320895 | 0.439456 |
| 2008 | 49638 | 70649 | 42.3285 | 40736 | 55899 | 57.4387 | 59.7422 | 0 | 3.2258 | 0.77894 | 0.745789 | 0.397907 | 0.512522 |
| 2009 | 62135 | 83120 | 33.7732 | 49614 | 28373 | 61.6967 | 58.1883 | 0 | 5.2632 | 0.833435 | 0.640812 | 0.602208 | 0.550397 |
| 2010 | 75391 | 96746 | 28.3257 | 43445 | 56682 | 67.8961 | 61.5653 | 0 | 1.9231 | 0.829248 | 0.699852 | 0.828454 | 0.561518 |
| 2011 | 88124 | 110664 | 25.5776 | 24160 | 74533 | 66.9143 | 60.1939 | 0 | 3.3898 | 0.799653 | 0.630518 | 0.894676 | 0.723184 |
| 2012 | 102011 | 127254 | 24.7454 | 60893 | 89261 | 65.4961 | 62.4474 | 0 | 1.3333 | 0.767561 | 0.758995 | 0.90661 | 0.822237 |
| 2013 | 117074 | 143972 | 22.9752 | 80052 | 100798 | 65.8938 | 68.0683 | 0 | 1.2987 | 0.79227 | 0.760637 | 1.235787 | 0.849733 |
| 2014 | 133511 | 161417 | 20.9016 | 97384 | 120196 | 69.9798 | 63.125 | 0 | 3.0928 | 0.801914 | 0.702829 | 1.286683 | 0.839503 |
| 2015 | 150569 | 180642 | 19.9729 | 107233 | 136739 | 70.3499 | 71.5665 | 0 | 0 | 0.798164 | 0.802002 | 1.28033 | 0.967404 |
| 2016 | 168284 | 199787 | 18.7201 | 123841 | 156561 | 70.6494 | 71.888 | 0 | 0 | 0.807399 | 0.80243 | 1.357834 | 0.904467 |
| 2017 | 188205 | 219041 | 16.3843 | 142175 | 168395 | 72.0277 | 65.9441 | 0 | 3.6036 | 0.824101 | 0.68303 | 1.359295 | 0.905829 |
| 2018 | 206668 | 239485 | 15.8791 | 157038 | 209730 | 70.9373 | 69.359 | 0.9615 | 1.5504 | 0.785639 | 0.751923 | 1.115428 | 1.015332 |
| 2019 | 226127 | 261290 | 15.5501 | 173297 | 245197 | 71.3138 | 74.3626 | 0 | 0.641 | 0.80687 | 0.787804 | 1.003199 | 1.192764 |
| 2020 | 246453 | 282953 | 14.8101 | 160534 | 234714 | 71.8341 | 73.0764 | 0 | 2.1429 | 0.810446 | 0.746839 | 0.995422 | 1.120811 |
| 2021 | 268346 | 304950 | 13.6406 | 215849 | 287970 | 72.8275 | 70.4935 | 0 | 2.2599 | 0.817762 | 0.745668 | 1.160856 | 1.012713 |
| 2022 | 291069 | 327851 | 12.6369 | 198232 | 570488 | 75.504 | 75.0714 | 0 | 0.4762 | 0.823373 | 0.809777 | 1.30105 | 0.906472 |
| 2023 | 314194 | 351594 | 11.9035 | 216154 | 873000 | 75.8099 | 73.215 | 0.5376 | 1.0753 | 0.814564 | 0.789779 | 1.191391 | 0.952208 |
| 2024 | 338060 | 375862 | 11.182 | 284466 | 1278618 | 76.9748 | 73.8887 | 0 | 0.9259 | 0.833753 | 0.795642 | 1.128596 | 0.980034 |
| 2025 | 361752 | 400898 | 10.8212 | 549037 | 1755915 | 77.0924 | 73.9954 | 0 | 1.4218 | 0.837389 | 0.783021 | 0.944896 | 0.980948 |
| 2026 | 387342 | 427796 | 10.444 | 866930 | 2315759 | 77.7193 | 71.6035 | 0 | 1.5625 | 0.842723 | 0.785568 | 0.997315 | 0.972281 |
| 2027 | 412932 | 456432 | 10.5344 | 1276274 | 2819889 | 77.4005 | 76.8442 | 0.3922 | 0.8097 | 0.828717 | 0.822853 | 1.026226 | 0.987818 |
| 2028 | 440096 | 486514 | 10.5472 | 1778354 | 2836928 | 77.8618 | 75.5197 | 0.4274 | 1.0526 | 0.832236 | 0.823192 | 1.029161 | 0.995207 |
| 2029 | 468897 | 517363 | 10.3362 | 2237081 | 2756673 | 78.3025 | 78.7885 | 0.369 | 0.3401 | 0.84448 | 0.857459 | 1.038658 | 0.999312 |
| 2030 | 498803 | 548820 | 10.0274 | 2876430 | 2937299 | 78.4558 | 82.5589 | 0 | 0 | 0.864515 | 0.887981 | 1.044787 | 1.021699 |
| 2031 | 529604 | 580095 | 9.5337 | 3292701 | 3175807 | 80.2126 | 78.3248 | 0 | 0.9202 | 0.874274 | 0.862068 | 1.009601 | 1.028379 |
| 2032 | 561959 | 611773 | 8.8643 | 3602145 | 3480726 | 81.767 | 81.58 | 0.2994 | 0.3003 | 0.876964 | 0.891807 | 1.009119 | 1.038461 |
| 2033 | 593372 | 642971 | 8.3588 | 3985920 | 3843261 | 82.2829 | 82.3672 | 0 | 0.2747 | 0.899439 | 0.89667 | 1.021283 | 1.03753 |
| 2034 | 625387 | 675918 | 8.08 | 4302872 | 4288881 | 83.0972 | 80.7381 | 0 | 0.565 | 0.902657 | 0.885522 | 1.028444 | 1.037651 |
| 2035 | 656220 | 708765 | 8.0072 | 4568394 | 4596074 | 82.9651 | 81.1869 | 0 | 0.2439 | 0.901713 | 0.896485 | 1.031866 | 1.041797 |
| 2036 | 689792 | 741576 | 7.5072 | 4902695 | 4844182 | 82.7791 | 77.6485 | 0 | 1.2407 | 0.901097 | 0.865954 | 1.030955 | 1.051843 |
| 2037 | 723000 | 776221 | 7.3611 | 5282361 | 5087125 | 83.2351 | 80.7332 | 0 | 0 | 0.899867 | 0.910161 | 1.032138 | 1.052286 |
| 2038 | 756051 | 808559 | 6.945 | 5709655 | 5419975 | 82.6403 | 79.0408 | 0 | 0.6536 | 0.89774 | 0.883466 | 1.037576 | 1.05602 |
| 2039 | 790901 | 842805 | 6.5626 | 6158025 | 5782156 | 82.5878 | 78.6406 | 0 | 0.6494 | 0.894897 | 0.886467 | 1.048321 | 1.051643 |
| 2040 | 826266 | 877037 | 6.1446 | 6650018 | 6175271 | 82.2234 | 77.0903 | 0 | 0.6186 | 0.892102 | 0.88694 | 1.051691 | 1.043782 |
| 2041 | 862234 | 913095 | 5.8987 | 7194914 | 6638931 | 82.3138 | 77.8442 | 0 | 0.3839 | 0.894252 | 0.894625 | 1.054215 | 1.043154 |
| 2042 | 896393 | 946918 | 5.6365 | 7639328 | 7154917 | 82.7484 | 80.8007 | 0 | 0.1698 | 0.893105 | 0.901488 | 1.052624 | 1.044284 |
| 2043 | 934057 | 983258 | 5.2675 | 7913937 | 7689960 | 82.6709 | 75.8691 | 0 | 0.7181 | 0.891854 | 0.879985 | 1.056136 | 1.046771 |
| 2044 | 970766 | 1023527 | 5.435 | 8256769 | 8222225 | 82.8699 | 78.1588 | 0 | 0.4785 | 0.889631 | 0.886035 | 1.054698 | 1.045111 |
| 2045 | 1005417 | 1062917 | 5.719 | 8497056 | 8639032 | 82.2314 | 76.5359 | 0 | 0.4673 | 0.88787 | 0.882106 | 1.046236 | 1.056113 |
| 2046 | 1043018 | 1097611 | 5.2341 | 8854847 | 9197299 | 82.1507 | 77.0846 | 0 | 0.3067 | 0.886069 | 0.88326 | 1.046423 | 1.055284 |
| 2047 | 1082851 | 1146080 | 5.8391 | 9211285 | 9749458 | 81.2534 | 79.7843 | 0 | 0.1595 | 0.882686 | 0.891472 | 1.052612 | 1.050434 |
| 2048 | 1121558 | 1188001 | 5.9242 | 9603411 | 10310360 | 81.6266 | 80.1386 | 0 | 0.1404 | 0.878106 | 0.889992 | 1.051755 | 1.05605 |
| 2049 | 1155525 | 1227266 | 6.2085 | 9982820 | 10892679 | 80.7247 | 78.1754 | 0 | 0.8708 | 0.874088 | 0.859831 | 1.047431 | 1.047426 |
| 2050 | 1196168 | 1268939 | 6.0837 | 10407616 | 11470545 | 80.838 | 77.3236 | 0.1425 | 0.3906 | 0.872323 | 0.874387 | 1.042407 | 1.047528 |
| 2051 | 1234799 | 1301400 | 5.3937 | 10786498 | 12044778 | 81.0925 | 78.2767 | 0 | 0.5256 | 0.87516 | 0.865621 | 1.031393 | 1.044029 |
| 2052 | 1280413 | 1347251 | 5.22 | 11175030 | 12612842 | 81.1961 | 78.5674 | 0 | 0.135 | 0.871648 | 0.878358 | 1.044202 | 1.037181 |
| 2053 | 1320739 | 1396013 | 5.6994 | 11510241 | 13187606 | 80.1745 | 74.2129 | 0.1258 | 0.8838 | 0.862194 | 0.852746 | 1.044999 | 1.029858 |
| 2054 | 1368175 | 1420520 | 3.8259 | 11829506 | 13798868 | 80.4373 | 76.6505 | 0 | 0.4751 | 0.861806 | 0.868271 | 1.044086 | 1.024504 |
| 2055 | 1403017 | 1440746 | 2.6891 | 12174635 | 14394151 | 79.8925 | 74.0481 | 0.1214 | 1.3682 | 0.858631 | 0.833276 | 1.038744 | 1.029971 |
| 2056 | 1421930 | 1463449 | 2.9199 | 12535673 | 14997379 | 80.1152 | 74.7617 | 0 | 0.4367 | 0.866187 | 0.867961 | 1.036335 | 1.03393 |
| 2057 | 1448111 | 1494514 | 3.2044 | 12921307 | 15603814 | 80.3711 | 74.2728 | 0 | 0.8178 | 0.87248 | 0.852363 | 1.032767 | 1.036313 |
| 2058 | 1461402 | 1510419 | 3.3541 | 13258473 | 16254650 | 80.1251 | 73.7672 | 0 | 0.8686 | 0.882551 | 0.849321 | 1.045223 | 1.030794 |
| 2059 | 1474310 | 1521607 | 3.2081 | 13630618 | 16928180 | 80.3207 | 73.6495 | 0 | 0.5429 | 0.883336 | 0.860639 | 1.045248 | 1.027995 |
| 2060 | 1494630 | 1536884 | 2.8271 | 13987823 | 17628691 | 81.1569 | 73.9821 | 0 | 0.4197 | 0.882337 | 0.865344 | 1.053485 | 1.035384 |

## Gate record: original WIP and current candidate

The fixture reference is the current `b3` set. Its endpoints are 192,899 (128×15 s7), 1,513,835 (256×60 s7) and 1,427,340 (256×60 s11). Older FH-04/LG-10 report rows predate B1/B3 and are context only. No fixture has been changed and no `polish` sign-off is claimed.

The original WIP fails all three base population tolerances: 195,379 (+1.2856%), 1,550,356 (+2.4125%) and 1,494,630 (+4.7144%). Largest absolute yearly movements are 7.2604%, 4.0335% and 33.2794%. Original WIP neglect ends at 1,332,759 / §17,847,550 for s7 (−14.0353% population, −3.1061% funds versus WIP base) and 1,536,884 / §17,628,691 for s11 (+2.8271%, +26.0288%). Seed 7 passes the neglect population/funds comparisons; seed 11 fails both.

| Retained WIP pair | Base population | Neglect population | Base funds | Neglect funds | Base approval | Neglect approval |
|---|---:|---:|---:|---:|---:|---:|
| 256×60 s7 | 1,550,356 | 1,332,759 | §18,419,687 | §17,847,550 | 79.4023 | 72.8761 |
| 256×60 s11 | 1,494,630 | 1,536,884 | §13,987,823 | §17,628,691 | 81.1569 | 73.9821 |

Original WIP base tourism monthly 12-month means from day 5,400 are 0.8996 (128 s7), 0.8741–1.2433 (256 s7), and 0.9007–1.3724 (256 s11); s11 fails 1.3. Maximum monthly rolling failure shares from the first year-10 sample, day 3,270, are 3.5088%, 3.2787% and 1.1494%, all below 5%.

The approval source formula is unchanged. Original WIP year-60 attentive-minus-neglect approval costs are 6.5261 points (s7) and 7.1748 (s11), versus dev 4.3349 and 7.0115. The year-60 interpretation passes. Whole-run mean yearly costs move 3.9119→5.3077 (s7) and 4.9158→2.5124 (s11), so a whole-run-mean interpretation fails for s11; the plan does not specify that aggregation. Dev attentive approval uses the b3 fixture rounded to 0.01; its neglect references are full-precision source-snapshot runs. Dev neglect endpoints are 1,390,920 / §14,168,774 (s7) and 1,455,512 / §14,334,083 (s11).

### Rejected relative-neutral candidate: final full gates

Both full-size attentive candidate runs fail the ±0.5% base population tolerance. The 128×15 candidate also fails (+1.6952% at the endpoint; maximum yearly-row movement 6.75487%). Tourism and failure columns below use all monthly trailing-12-month samples from day 5,400 and day 3,270 respectively.

| Attentive candidate | Population | Funds | Approval | Endpoint versus dev | Maximum absolute yearly-row movement | Tourism ratio range | Maximum rolling failed share | Gates |
|---|---:|---:|---:|---:|---:|---|---:|---|
| 256×60 s7 | 1,253,791 | §18,566,243 | 79.3623713 | −17.1778% | 17.3461% | 0.850829–1.171122 | 4.0816% | FAIL population; PASS tourism/failures |
| 256×60 s11 | 1,448,015 | §14,175,786 | 78.6388265 | +1.4485% | 4.7352% | 0.944821–1.310941 | 3.3898% | FAIL population/tourism; PASS failures |

Neglect also fails the required population comparison on both seeds; seed 11 gains funds as well.

| Seed | Attentive population | Neglect population | Neglect population change | Attentive funds | Neglect funds | Funds change | Gates |
|---|---:|---:|---:|---:|---:|---|---|
| 7 | 1,253,791 | 1,500,039 | +19.6403% | §18,566,243 | §15,814,913 | −§2,751,330 (−14.8190%) | FAIL population; PASS funds |
| 11 | 1,448,015 | 1,506,237 | +4.0208% | §14,175,786 | §15,188,722 | +§1,012,936 (+7.1455%) | FAIL population/funds |

Neglect approval is 73.7986703 (s7) and 73.8797869 (s11). The approval formula remains unchanged, but the generated city paths change the measured cost. Candidate approval costs below are attentive minus neglect; dev comparisons use the same references described above.

| Seed | Candidate year-60 cost | Dev year-60 cost | Year-60 gate | Candidate mean yearly cost | Dev mean yearly cost | Mean-cost gate |
|---|---:|---:|---|---:|---:|---|
| 7 | 5.5637010 | 4.3349422 | PASS | 2.9173152 | 3.9118813 | FAIL |
| 11 | 4.7590396 | 7.0114981 | FAIL | 2.9496732 | 4.9157767 | FAIL |

No declared candidate passed the combined gates. These are failed tested combinations, not proof that every possible mapping is mathematically infeasible. No further neutral points, constants or seeds were searched.

The four immutable-scratch candidate runs are 256×60 s7/s11, each attentive and neglect. Final direct-production 128 verification is of the restored original WIP and is separate from these candidate results. Do not substitute original-WIP numbers for this section.

Scratch `review1/candidate-s7-relative-base-analysis.md` records the rejected seed-7 candidate's late regime. The maximum direct helper cut in the inspected late window is only 0.14945%; applied migration-factor loss peaks at 0.001216, and the same-state target shortfall peaks near 1,610 residents (mean 215; final 11.56), versus a final population gap of 260,044. Late funds stay above §6.91M and monthly net above §30,770. Density actions end in early 2043; unemployment stays near 10% while jobs/map/redevelopment eligibility constrain later growth. This identifies the observed late bottleneck, not a unique cause or a decomposition of the historical population gap.

## Changes by file

Only this report has a net Review-1 change. The source/test entries below describe the retained committed WIP; there are no new infrastructure, outside-ownership or cloud-held-file hunks in this round.

- `src/sim/economy/tourism.ts`: retained exactly as committed in the original WIP. Full safety feeds tourism and the existing attractiveness-based migration path. Optional `safetyMigrationLoss` in already mirrored `systemData.economy` compares actual migration with a same-city crime-only counterfactual; `emergencyMigrationImpact` exposes multiplier loss and current residential target loss, not arrivals. Save/load output preservation includes the optional loss. Review-1 candidate hunks were removed.
- `src/sim/economy/tuning.ts`: retained exactly as committed: `REBUILD_SHARE = 0.15`; `EM_SCAR` = 0.15, radius 3, 540 days; `EM_REP = 4`, denominator offset 30 and deaths coefficient 0.002. EM_REP is provisional because the task names it without a value; it has not been calibrated to passing gates. The candidate-only `MIG_SAFETY_MAX` was removed. All specified coefficients remain literal.
- `src/sim/economy/budget.ts`: `emergency:rebuild` expense and pure cost readers. Forecasts show current accrued damage; monthly settlement charges the completed month once after infrastructure rolls it to `lastMonth`. Annual readers sum actual rounded monthly charges, including an unanswered subtotal. Funding/difficulty do not discount rebuilding; sandbox records without reducing funds.
- **`src/sim/CityState.ts` — OUTSIDE NAMED FILES, interface only:** optional `EmergencyMonth.unansweredDamage`, `rebuildCost` and `unansweredRebuildCost`; no constructor/default/runtime change here.
- **`src/sim/infra/emergency.ts` and `nimby.ts` — MINIMAL INFRA HUNKS, HOLD FOR B2:** itemized below.
- `tests/sim/neglectSafety.test.ts`: 11 safety, migration/tourism, target-loss, rebuild, rollover, difficulty/funding, sandbox and old-save cases.
- `tests/sim/neglectScars.test.ts`: 6 unanswered/answered, rolling rounded costs, radius/strength/expiry, mid-scar save/load and old-save cases.
- Candidate-only `tests/sim/neglectMigration.test.ts`: its 18 proposed cases were archived as scratch `review1/candidate-neglectMigration.test.ts`, then removed from the repository with the rejected API. Original committed tests are unchanged.
- `docs/dev/reports/local-T043-lg06-neglect.md`: this coherent Review-1 record.

`tools/simbot.ts` is unchanged: `--neglect` already suppresses manual dispatch correctly. No new RNG calls, diagnostic production flags or unrelated refactors were added.

### Every infrastructure hunk held for B2

`src/sim/infra/emergency.ts`:

1. Import the rebuild share and `addEmergencyScar`.
2. Add optional `Incident.rebuildCost` to the existing plain incident/save shape.
3. At monthly rollover, record rounded rebuilding cost and rounded unanswered subtotal before storing the month.
4. At burn-down, add a scar only if `inc.answered === 0`; preserve the original damage arithmetic, record unanswered damage and accumulate the incident rebuild amount.
5. At riot damage, record unanswered damage and incident rebuilding beside the existing damage total.
6. In `sumMonths`, sum the three optional counters with zero fallbacks. Reuse the existing incident/failure/death window.

`src/sim/infra/nimby.ts`:

1. Import the building type and scar tuning.
2. Add `EmergencyScar` and its creation helper using optional `systemData.emergencyScars` (footprint and absolute expiry).
3. In the existing rebuild, prune expired sources and splat active scars into stigma. Inverse saturation makes a lone core exactly 0.15 under the existing `1 - exp(-x)` rule; reuse existing falloff/radius handling.

No infrastructure code was moved or refactored. The source expires at 540 days; its raster follows the existing NIMBY refresh cadence and can lag creation/expiry by about 30 game days. No synchronous full raster rebuild was added to a burn-down.

## Checks and reproducibility

The original WIP passed `npx tsc --noEmit`, whitespace/UTF-8-without-BOM checks and 10 native smoke assertions. Its authored Vitest files could not start because of `spawn EPERM`; they were not executed. Review 1's 18 candidate-specific formal cases were not executed and are now archived with the rejected API; they are not part of the retained runtime's test suite. Final runtime and archived-candidate checks are recorded here:

| Final check | Result |
|---|---|
| `git diff --check`; report UTF-8 without BOM; all 60 before-tuning reference rows present | PASS; `review1/report-static.json` records the text checks |
| `npx tsc --noEmit` on restored runtime | PASS |
| Archived candidate native checks, `migration-smoke.mts` through `candidate-production.mjs` | 6 passed, 0 failed: includes 4,800 exact-neutral, 726 bounded/monotone, 288 crime-neutral and 24,000 context comparisons |
| Restored original WIP native checks, `neglect-smoke.mts` through `ts-resolve.mjs` | 10 passed, 0 failed |
| One new restored-runtime 128×15 s7 process, through quiet gate | 195,379 residents `[63918, 93966, 37495]`, §152,842, approval 78.8664800472; all 15 yearly hashes match both prior original-WIP process files |
| `tests/sim/neglectSafety.test.ts`, attempted this round through quiet gate | Startup failed loading Vite config: `externalize-deps` / `windowsSafeRealPathSync`, `spawn EPERM`; no cases ran |
| `tests/sim/neglectScars.test.ts` | Prior-round startup `spawn EPERM`; not repeated after restoring its identical source/test block; no cases ran |
| Archived candidate's 18 formal cases | Not executed; retained in scratch with the rejected API |
| Full Vitest, affected regression/hygiene suites, browser and benchmarks | Not run; left for the lead under the supplied run restrictions |

Exact commands and outputs are in scratch `review1/checks.json`; `review1/final-checks.json` records the hash comparisons and native results. The final worktree status contains only this modified report.

The original WIP's 10 native assertions covered exact safety/read purity, normalization/old stats, migration/next-pass tourism, rebuild rounding, single settlement, difficulty/funding/sandbox behavior, old budget fields, rolling-window expiry, mid-scar save/load and answered losses. These are separate evidence, not a claim that Vitest ran.

The original WIP's two prior separate 128×15 processes matched all 15 yearly hashes. Review 1 ran one new process after rollback, and every yearly hash again matches both `gate_128x15_s7_base.json` and `gate_128x15_s7_repeat.json`; there was no second new repeat this round. All three finish at `a6e96a4b4814701a9bdb3c5ebebdb0c9d87ad4446a40ff375b09bf5f28fb2c0a`. This verifies the retained WIP, not candidate B. The driver sorts object keys, hashes typed arrays as bytes, and sets serialized `savedAt = 0`. A source-snapshot run reproduced all 15 dev 128×15 rows. Snapshots preserve the original five simulation sources; the CityState interface change is erased by TypeScript transformation.

Normal `npx tsx` was unavailable offline (`ENOTCACHED`). Actual bot executions use Node 22's TypeScript transform and a scratch extension resolver, through the supplied quiet gate, one process at a time. All trial modes, sources and loaders are scratch-only. Extra score evaluations and telemetry are excluded from performance claims; the diagnostics do not establish real-GPU or Worker frame costs.

Run from `C:/Users/techsin/Desktop/projects/simcityweb-T043`. The exact equivalent simbot option sets are:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet --neglect
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --neglect
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --neglect
```

The actual fallback commands below reproduce the declared scratch experiments. The loader argument requires a `file:///` URL and `--experimental-transform-types` for existing enums. Each command finishes before the next starts.

```powershell
$S = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T043/scratch'
$R = "$S/review1"
$Q = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=control" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_control.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=control" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --neglect --out "$R/candidate_128_s7_control_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=migration" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_migration.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=tourism" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_tourism.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rebuild" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_rebuild.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=scars" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_scars.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=wip" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/ablation_128_s7_wip.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=wip" "$R/review-gates.mts" --size 256 --years 60 --seed 11 --quiet --out "$R/wip_256_s11_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=wip" "$R/review-gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$R/wip_256_s11_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=fixed" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/candidate_128_s7_fixed_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=fixed" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --neglect --out "$R/candidate_128_s7_fixed_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --out "$R/candidate_128_s7_relative_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 128 --years 15 --seed 7 --quiet --neglect --out "$R/candidate_128_s7_relative_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 256 --years 60 --seed 7 --quiet --out "$R/candidate_256_s7_relative_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 256 --years 60 --seed 7 --quiet --neglect --out "$R/candidate_256_s7_relative_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 256 --years 60 --seed 11 --quiet --out "$R/candidate_256_s11_relative_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=relative" "$R/review-gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$R/candidate_256_s11_relative_neglect.json"
```

Scratch `review1/modes.json` defines M/T/B/S switches; `generate.mjs` creates the six immutable ablation sources and `candidates.mjs` creates the two migration trials. These switches are not simbot options or production settings. `feedback-findings.md`, `seed11-causal-analysis.md`, `ablation-analysis.json` and `metrics.json` summarize the recorded JSON, with the inference limits stated above.

Direct-production verification uses `ts-resolve.mjs` and `lg06-gates.mts`, not a trial mode, and verifies the restored original WIP. The single new final 128 run below was compared with both prior original process files; the hash flag records yearly hashes. No `final_128x15_s7_repeat.json` process was run this round. `ts-base.mjs` instead reads the preserved dev sources.

```powershell
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/lg06-gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/final_128x15_s7_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$S/dev_128x15_s7_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 7 --quiet --neglect --out "$S/dev_256x60_s7_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-base.mjs" "$S/lg06-gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$S/dev_256x60_s11_neglect.json"
node "$Q" npx vitest run tests/sim/neglectSafety.test.ts --maxWorkers=1
node "$Q" npx vitest run tests/sim/neglectScars.test.ts --maxWorkers=1
```

Exact candidate-production byte copies are preserved as scratch `review1/candidate-production-tourism.ts`, `candidate-production-tuning.ts` and `candidate-neglectMigration.test.ts`; copy hashes were checked before rollback. The scratch `candidate-production.mjs` loader redirects the original tourism/tuning module URLs to those archives, allowing candidate-specific native checks after restoring the runtime. It does not load a new production flag:

```powershell
node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/candidate-production.mjs" "$R/migration-smoke.mts"
node --no-warnings --experimental-transform-types --experimental-loader "file:///$S/ts-resolve.mjs" "$S/neglect-smoke.mts"
```

Those two native verification commands were plain short Node probes, not quiet-gated bot runs. Every bot and Vitest attempt used the quiet gate as required.

## Plan/code differences and ownership requests

- **Annual fewer-newcomers wording:** migration scales residential capacity targets, not arrivals. `emergencyMigrationImpact` reports current target loss versus the same city's crime-only migration; it does not sum target stocks into annual newcomers. META/lead must define an annual estimate or use honest current-target wording.
- **Migration interpretation:** the retained runtime feeds full safety through existing attractiveness-based migration, bounded by the existing pre-context 0.88–1.12 clamp. The explicit separate non-positive factor was tested and rejected; its formulas, examples, sources and comparisons remain in this report/scratch for review. The existing final school adjustment can still produce values below 0.88.
- **Current reference:** use b3, not older plan examples. No tolerances were weakened, baseline rows rewritten or rebuild/scar coefficients changed.
- **B2 scar cadence request:** in `src/sim/infra/services.ts` `due`/`prep` and NIMBY dirty handling, add a minimal scar-creation/next-expiry invalidation hook. This file is untouched; avoid a synchronous full raster rebuild at burn-down.
- **Cloud-held BudgetPanel:** in `src/ui/panels/BudgetPanel.ts`, add `emergency:rebuild` to `GROUP_LABELS`/`SLIDER_GROUP` handling with the exact label **“Rebuilding after emergencies”** and appropriate grouping.
- **Cloud-held EmergenciesPanel:** in `renderStats`, read mirrored `stats.emergency.year.unansweredRebuildCost` or `emergencyRebuildCosts(...).unansweredYear`. Clarify target-estimate wording above, and include any displayed target estimate in the render signature (currently emergency stats only).
- **META's banner hunk:** in `src/ui/EmergencyBanner.ts` `onEvent`, append formatted `b.inc.rebuildCost` after the existing `ctx.host.emergency.incident(e.id)` read. `IncidentRecord = Incident` and existing structured cloning already carry the optional field; no new live-system read is needed.
- **Cloud-held Worker audit:** add `emergencySafety`, `emergencyMigrationImpact` and `emergencyRebuildCosts` to `src/worker/replicaSafe.ts` and parity/purity tests before UI adoption; include scalar `emergencyRebuildCost` if that catalog includes scalar utilities. The rejected `safetyMigrationMultiplier` is not a runtime API to mirror or audit.
- **Optional source-position mirror:** add `emergencyScars` to `src/worker/protocol.ts` `SYSTEM_KEYS` only if a consumer needs footprints/remaining duration. Economy loss, emergency stats and the stigma raster already use existing mirrors; rendering stigma does not require the source list.
- **Render Prestige hook:** the existing `Overlay.Nimby` path reads `st.stigma` and draws prestige minus stigma, so the scar splat is already available. Source outlines/expiry tooltips can use the optional mirror above.

All cloud-held files remain untouched. Scar save/load preserves source footprints and absolute expiry; old saves omit new lists/counters safely, and historical saved months without rebuild counters are not added to annual paid totals.

## Decisions for the lead

This calibration round stops with the tested combinations failing. Production source has returned to the original WIP, whose gates also fail; candidate B is rejected despite its explicit neutral-point semantics. The evidence does not establish impossibility. The remaining choices are explicit:

- Decide whether to retain the specified rebuilding/scar mechanics and authorize further balance work against the existing all-year ±0.5% base gate, or explicitly revise those mechanics or that tolerance. Neither was silently changed here.
- Decide whether to authorize broader bot, jobs/map/redevelopment and tourism-ratio calibration. The observed affordability/layout forks and late bottleneck extend beyond a local `--neglect` dispatch bug; this lane did not change the bot strategy or tourism calibration to hide them.
- Define whether “approval cost unchanged or larger” means the year-60 gap, the mean yearly gap or both. Candidate s7 passes only the first; candidate s11 passes neither.
- Define the panel's annual “Y fewer newcomers” measure, or approve honest current residential-target wording. There is no modeled annual arrival ledger to expose directly.

## Limitations and browser checks

The formal tests, full Vitest, affected regression/hygiene checks, actual Worker/Loopback behavior, browser rendering, B2 integration and GPU/performance remain subject to the checks section and lead verification. No browser, benchmark or full suite was run by this lane. Monthly traces do not expose the precise first daily lot choice, effective demand-cap contribution or complete venue/hotel/access decomposition; causal inferences above are limited accordingly.

Browser acceptance checklist:

- [ ] Compare attentive/ignored-call safety, tourism attractiveness and the following venue pass; verify the retained safety deduction cannot increase migration at identical state/survey inputs. Check rejected-candidate neutral examples separately only if that design is revisited.
- [ ] Cause §56,000 monthly damage: forecast §8,400, settle §8,400 once under the exact rebuilding label, then no second charge in a clean month.
- [ ] Compare unanswered and late-answered burn-downs: both rebuild; only the unanswered loss creates a scar and unanswered subtotal.
- [ ] Verify Prestige/NIMBY's 0.15 core, radius-3 falloff and overlap; inspect creation/expiry latency before and after B2's invalidation hook.
- [ ] Bulldoze/rebuild the burnt lot; the timed scar remains until its source expiry.
- [ ] Save midway through a scar, reload exact footprint/expiry, compare stigma after refresh, and continue through 18 months.
- [ ] Load old saves without the new fields, advance months, confirm normal play/no historical-year rebilling/zero UI fallbacks.
- [ ] Repeat relevant reads, costs, outcomes and save/load with LocalSimHost and Loopback/Worker through the host and existing streams.
