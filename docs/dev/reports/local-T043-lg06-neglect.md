# local-T043-lg06-neglect: Round 3

Branch `local/T043-lg06-neglect`; merged dev base `683d02b` through `c12dc75`. **BALANCE GATES FAIL. All 13 Round-3 bot runs completed: five 128 screens and eight full-sized runs. No tested profile passes the amended contract.** The unchanged WIP constant remains **EM_REP=4**; trials 8, 12 and 24 are rejected, with no numerical tuning promoted. **The retained WIP is not recommended as a passing merge.** Infrastructure commit `7c0e586` still **holds for B2**. Round-3 changes are uncommitted; the approved panel and additive Worker audit hunks are kept small for the lead to commit separately. No commit, push or `.done` file was made in this round. The Review-1 report below is preserved as historical evidence; its final-status and open-decision statements describe that earlier round only.

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

The unchanged WIP source retains **EM_REP = 4**. Completed scratch-only trials changed that constant alone to **8**, **12** and **24**; each is rejected for failing the combined gates. They do not resurrect the rejected Review-1 migration mappings. **No source numeric value changed in Round 3**, and retaining 4 is not approval of its failing balance.

Unchanged values: `EM_DEATHS_PER_1000 = 0.002`; `EM_REP_N0 = 30`; `REBUILD_SHARE = 0.15`; `EM_SCAR = { amount: 0.15, radius: 3, days: 18 * DAYS_PER_MONTH }`; the existing migration range `0.88–1.12`; and the existing tourism/attractiveness safety weights. No broader calibration is included. In particular, the SIM rule's prohibition on weakening specified costs is respected.

The initial 128×15 seed-7 screen is complete. Largest movement below is measured only over the newly gating years 2010–2015. Tourism is the trailing mean of 12 monthly new/legacy tourism-job ratios at year 15. **Every on profile in this table fails the amended 1% base-population gate**; the shared A/A envelope supplies no additional tolerance.

| Profile | Population 2015 | Funds | Approval | Largest absolute population movement from year 10 | Tourism at year 15 | Maximum failed share from year 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LG-06 off | 192,899 | §146,349 | 81.3650175 | 0% | 1.2043515 | 0% |
| Retained `EM_REP = 4` | 195,379 | §152,842 | 78.8664800 | 3.0643043% | 0.8996060 | 3.5087719% |
| Trial `EM_REP = 8` | 196,351 | §194,576 | 81.6700592 | 3.9998396% | 1.2310974 | 0% |
| Trial `EM_REP = 12` | 195,544 | §152,025 | 80.0462081 | 2.3618707% | 1.2092658 | 0% |
| Trial `EM_REP = 24` | 197,088 | §157,955 | 79.6586787 | 2.963872% | 1.1503161 | 0% |

The response is not monotone in final population: the direct score is monotone, but stronger penalties also change discrete construction and affordability decisions. The prior ablations and seed-11 trace below establish those feedback paths. Profile 12 was tested at full size because it improved the initial 128 screen's worst drift; 24 tested stronger record exposure under the unchanged migration clamp. Neither rationale predicts a passing outcome, and both completed profiles fail. Profile 8 was screened out on its 128 base failure; its full-sized pairs were not run.

## Full-size gates and shared envelope

The shared report is now available through `git show local/T062-sim-aa-envelope:docs/dev/reports/sim-aa-envelope.md`, commit **`3833c8d2379d3350663e624fe30be7867c559310`**. It completes all six independent processes. **All twelve row/metric A/A envelopes are exactly zero**: the day-1 +§1 funds nudge remains exactly +§1 in annual funds, with no divergence in population, air, approval or I-HT share. This measures the specified perturbation; it does not demonstrate an envelope for larger costs or shocks. The amended base bands therefore remain **1%**, and there is no positive A/A allowance for a missed variant target.

T062 measured underlying dev `9fcc2ec` plus its task-file commit `0df76bce`. The read-only diff against `683d02b` is empty for **SIM, core, bot and Worker sources**, so its baseline applies here without a numerical rebaseline. Fetch could not write shared Git metadata; the newly available local ref provided the report read-only. No shared Git metadata was written. NEW-05 is signed off in documentation but its runtime is not in this base; the SIM rule still requires final gates against the subsequent dev/envelope including NEW-05.

### Retained EM_REP=4 systematic population shift

**The original WIP retained in the worktree triggers the systematic-shift check.** All three attentive endpoints increase by more than half the 1% tolerance: **128×15 s7, 195,379 versus 192,899 (+1.2856469%); 256×60 s7, 1,550,356 versus 1,513,835 (+2.4124822%); 256×60 s11, 1,494,630 versus 1,427,340 (+4.7143638%)**. All three also exceed the full endpoint band. The mixed-sign EM_REP=12 and later trial outcomes do not remove this flag from the retained profile. The unchanged constant is not a passing calibration or a recommendation to merge the failing mechanics.

The investigation is the controlled 128 ablation and monthly decision evidence preserved below. Migration alone adds +0.2421% at the endpoint, tourism +1.2691%, rebuilding −0.4769%, scars +1.9150%, and their combination +1.2856%; the effects are not additive. The first rebuilding bill is §84 on day 120; its observed changed purchase is the day-2010 bus-stop count. Scar-only simulation output differs before a purchase does: on day 240 its population passes the bot's 2,000-person police threshold a month earlier. Tourism changes jobs before the first changed zoning decision. These are concrete affordability/layout feedback paths, rather than a mathematical emergency bonus: at identical inputs the new safety score is no greater than crime-only safety and its migration transforms are monotone. They do not establish how much of each full-sized endpoint is attributable to each route. **With the measured A/A envelope equal to zero, fork evidence does not excuse any of these gate failures**; no bonus or unrelated calibration was added to cancel the shift.

Re-evaluating the **prior full-sized WIP runs** under the amended gates gives maximum annual base-population movements from year 10 of **3.0643043% on 128 s7, 4.0335319% on 256 s7, and 22.6513045% on 256 s11**. These reused runs share the verified exact simulation-source provenance; they are **not additional Round-3 bot executions**. Scratch `review3/retained4-analysis.json` records the comparison against precise T062 approval references:

| Retained-4 seed | Attentive population | Neglect population | Neglect population gap | Funds gap | Year-60 approval gap | Largest allowed gap after slack | Population / funds / approval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 1,550,356 | 1,332,759 | −14.0352925% | −§572,137 | −6.5261389 | −3.8323669 | **PASS / PASS / PASS** |
| 11 | 1,494,630 | 1,536,884 | +2.8270542% | +§3,640,868 | −7.1748386 | −6.5081927 | **FAIL / FAIL / PASS** |

Mean annual approval gaps from year 10 are **−5.8125832 versus off −3.8879496** on seed 7, and **−3.0296256 versus off −5.1618123** on seed 11. The year-60 approval gate passes both seeds under the lead's clarified definition; the mean seed-11 cost shrinks but does not gate. None of this rescues the failed base population rows or seed-11 population/funds variant requirements.

### Completed EM_REP=12 profile

All four 256×60 runs completed, one at a time through the quiet gate. This profile changes **only EM_REP, 4 → 12**, and is **rejected**. Its 128 result is 195,544 residents, §152,025 and approval 80.0462081; population moves +1.37118% at the endpoint and reaches +2.36187% in a gating year.

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

The following checks **every annual row from year 10** against T062's matching off rows with a 1% relative band. Absolute maxima retain their sign; air and I-HT are fractions and approval is in points. Maximum absolute and maximum relative changes can occur in different years. A nonzero I-HT share against a zero baseline has **infinite relative drift**; its absolute percentage-point change remains meaningful. These are metric changes, not A/A envelopes:

| REP12 base row | Metric | Largest absolute change | Year | Largest relative magnitude | Year | Failed/total annual rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 128×15 s7 | Population | +3,174 | 2012 | 2.361871% | 2012 | 6/6 |
| 128×15 s7 | Air at homes | −0.008892307 | 2015 | 10.671500% | 2013 | 6/6 |
| 128×15 s7 | Approval | −1.318809424 | 2015 | 1.620856% | 2015 | 1/6 |
| 128×15 s7 | I-HT share | +0.007120879 (+0.712088 points) | 2013 | ∞ | 2013 | 3/6 |
| 256×60 s7 | Population | −130,426 | 2059 | 8.667274% | 2059 | 46/51 |
| 256×60 s7 | Air at homes | −0.017029406 | 2047 | 13.910160% | 2016 | 43/51 |
| 256×60 s7 | Approval | +4.247812128 | 2012 | 6.727351% | 2012 | 28/51 |
| 256×60 s7 | I-HT share | −0.102398668 (−10.239867 points) | 2060 | 100% | 2051 | 10/51 |
| 256×60 s11 | Population | −56,133 | 2052 | 4.143856% | 2052 | 22/51 |
| 256×60 s11 | Air at homes | +0.026357618 | 2011 | 45.409923% | 2011 | 49/51 |
| 256×60 s11 | Approval | −4.518043079 | 2021 | 5.810683% | 2021 | 31/51 |
| 256×60 s11 | I-HT share | +0.116078984 (+11.607898 points) | 2054 | ∞ | 2010 | 32/51 |

**EM_REP=12 systematic-shift investigation:** this trial's population endpoints have mixed signs (+1.37118%, −8.16958%, −3.02395%), so its three-row same-direction population trigger does not fire. This is distinct from the retained-4 profile's flagged population shift above. Air and I-HT endpoint changes also have mixed signs. Approval endpoints all decrease: **−1.3188094, −1.2981982 and −1.7819948 points**, respectively. Each exceeds half its 1% relative base-approval band, so the broader metric check flags an approval shift for investigation. No approval term or free compensating bonus was changed. `EM_REP` is absent from `approval.ts`, the raw emergency approval coefficients are unchanged, and the existing approval EMA weight remains 0.3.

The captured 128 endpoint does not support a direct new approval penalty: its emergency term is **0 versus off −0.3**, visitors are 29,038 versus 30,483 (about **−0.0963 points** of current tourism pride at one point per 15,000 visitors), and crime-only safety improves from about .89872 to .90211 (about **+0.0635 points** of the crime term). These current contributions do not explain the **−1.3188-point smoothed total**. Both 256 attentive endpoints have over 60,000 visitors, so their current tourism-pride term already reaches its cap of 4; their losses cannot be attributed to current tourism pride alone. Remaining terms and their histories were not fully captured, so an exact decomposition is unverified.

The observed dependency routes are safety → attractiveness → visitors/jobs/taxes/affordability; rebuilding → funds/bot choices/layout; and scars → stigma/desirability/land value/crime. Prior 128 ablations also give mixed approval signs versus off: migration **+0.030836**, tourism **−1.108598**, rebuilding **−0.284174**, scars **+0.425056**, and all mechanics **−2.498537 points**. They are nonadditive outcomes. This explains why correcting approval with a free bonus or changing an unrelated term would hide the feedback rather than isolate it; no such compensation is included.

The variant approval miss has concrete term-level evidence but no complete ledger. On seed 7, the REP12 neglect emergency term is **−3.235294 versus off-neglect −7.339560**, improving by **4.104266 points**. Its smoothed total approval rises from 76.025058 to 77.386709 while its attentive base falls by 1.2982 points; together those movements narrow the year-60 gap by about 2.66 points. On seed 11 the neglect emergency term is capped at **−8 in both runs**. Its smoothed neglect total falls by 1.144503 points while its base falls by 1.781995, narrowing the gap by about .6375 points and leaving the .1375-point miss after slack. Changed later incidents and layouts are not paired-call experiments, and current terms cannot reconstruct the EMA history. The full term/history decomposition remains unverified.

### Completed EM_REP=24 profile, rejected

All five runs completed serially through the quiet gate. This final bounded trial changes **only EM_REP, 4 → 24**. Its 128 result is **197,088 residents `[64387, 93964, 38737]`, §157,955, approval 79.6586787**. Its endpoint moves +2.1716028%, and its worst annual population drift from year 10 is 2.963872%. It therefore fails even before the full-sized comparisons.

| Seed | Attentive population | Neglect population | Neglect population gap | Attentive funds | Neglect funds | Funds gap | Population/funds gates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 1,519,741 | 1,486,687 | **−2.1749759%** | §16,240,485 | §15,231,538 | −§1,008,947 | **PASS / PASS** |
| 11 | 1,311,100 | 1,421,044 | **+8.3856304%** | §19,716,381 | §22,240,303 | +§2,523,922 | **FAIL / FAIL** |

Seed 7 clears the population target by **0.1749759 percentage points**. Seed 11 misses it by **10.3856304 points**, has the wrong direction and also ends richer under neglect. All A/A margins are zero.

| Seed | Attentive approval | Neglect approval | Year-60 gap | Off gap | Largest permitted gap after 0.5 slack | Margin after slack | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 7 | 79.2869552685 | 81.4595103788 | **+2.1725551102** | −4.3323668620 | −3.8323668620 | **−6.0049219723 points** | **FAIL** |
| 11 | 80.3259541064 | 72.6023003041 | **−7.7236538022** | −7.0081926632 | −6.5081926632 | **+1.2154611390 points** | **PASS** |

Positive margins pass; negative margins miss. Mean annual approval gaps over 2010–2060, reporting only: seed 7 **−0.7368831951** versus off **−3.8879495827**; seed 11 **−5.3321039365** versus off **−5.1618123068**. A larger reputation coefficient does not guarantee a larger observed approval cost because the generated incidents, development paths and approval histories subsequently differ.

| REP24 base row | Endpoint population movement | Largest relative annual population movement from year 10 | Tourism monthly bounds from year 15 | Maximum rolling-year failed share from year 10 | Base population / tourism / failed gates |
| --- | ---: | ---: | ---: | ---: | --- |
| 128×15 s7 | +2.171603% | 2.963872% | 1.150316–1.150316 | 0% | **FAIL / PASS / PASS** |
| 256×60 s7 | +0.390135% | 2.623559% | 0.836362–1.214281 | 1.910828% | **FAIL / PASS / PASS** |
| 256×60 s11 | −8.143820% | 10.204255% | 0.909480–1.392147 | 1.470588% | **FAIL / FAIL / PASS** |

Seed 7's attentive population endpoint alone is inside 1%, but **34 of 51 gating annual rows fail**, so the base row fails. Seed 11 tourism exceeds 1.3 at **29 monthly observations**. Neglect tourism is 0.733453–1.157050 on seed 7 and 0.808895–1.366676 on seed 11 (13 monthly violations). Neglect's maximum failed shares are 5% and 7.5%, respectively; the ≤5% gate applies to the attentive base.

| REP24 base row | Metric | Largest absolute change | Year | Largest relative magnitude | Year | Failed/total annual rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 128×15 s7 | Population | +4,189 | 2015 | 2.963872% | 2012 | 6/6 |
| 128×15 s7 | Air at homes | −0.003485993 | 2010 | 4.709973% | 2010 | 4/6 |
| 128×15 s7 | Approval | −1.706338779 | 2015 | 2.097141% | 2015 | 3/6 |
| 128×15 s7 | I-HT share | 0 | 2010 | 0% | 2010 | 0/6 |
| 256×60 s7 | Population | +34,737 | 2055 | 2.623559% | 2011 | 34/51 |
| 256×60 s7 | Air at homes | −0.012457668 | 2045 | 12.799394% | 2018 | 45/51 |
| 256×60 s7 | Approval | +5.773327523 | 2012 | 9.143342% | 2012 | 26/51 |
| 256×60 s7 | I-HT share | −0.102398668 (−10.239867 points) | 2060 | 100% | 2051 | 10/51 |
| 256×60 s11 | Population | −141,732 | 2054 | 10.204255% | 2054 | 16/51 |
| 256×60 s11 | Air at homes | +0.018551815 | 2010 | 28.388242% | 2010 | 46/51 |
| 256×60 s11 | Approval | +3.958380306 | 2013 | 6.221851% | 2013 | 46/51 |
| 256×60 s11 | I-HT share | +0.079274721 (+7.927472 points) | 2054 | ∞ | 2010 | 21/51 |

REP24's zero-base/nonzero I-HT years on seed 11 are 2010–2013 and 2044–2050. Its 128 I-HT share stays zero like off; seed 7 ends at zero versus off's .1023987. The absence of a relative denominator is reported as infinity, not silently treated as zero drift.

**REP24 systematic shifts:** population endpoints have mixed signs (+2.17160%, +0.39013%, −8.14382%) and do not meet the all-three trigger. Air endpoints all decrease, by **.001452801, .001370267 and .002130136**, respectively (relative −1.598529%, −0.767114%, −1.444306%); all exceed half their 1% band. Approval endpoints also all decrease, by **1.706339, 1.070469 and 1.030740 points**, and the aligned 2012/2013 rows trigger too. Thus both air and approval require investigation. No direct pollution or approval coefficient changed: existing affordability/layout, desirability/crime and tourism/job routes can change both metrics. Their exact term/history decomposition was not captured, so improved air is not dismissed as measured A/A noise or presented as permission to overlook the base contract.

Scratch `review3/rep24-analysis.json` and `.md`, produced from completed files by `analyze24.mjs`, retain every annual metric comparison, counts, zero-baseline cases, monthly checks, endpoint and common-year systematic tests, full paired gaps and positive/negative gate margins. The analyzer starts no simulations or child processes.

### Decisions for the lead

These **bounded EM_REP-only trials did not meet the combined contract**. They do not prove that every authorized combination of LG-06 constants is impossible or constitute an exhaustive calibration search. The measured trade-off is:

| Profile | Base population rows | Neglect population s7 / s11 | Neglect funds s7 / s11 | Approval cost s7 / s11 | Base tourism |
| --- | --- | --- | --- | --- | --- |
| Retained 4, original WIP | **All three fail; systematic increase** | PASS / FAIL | PASS / FAIL | PASS / PASS | Seed 11 fails |
| Trial 8 | 128 fails; full-sized pairs not run | Not measured | Not measured | Not measured | 128 passes |
| Trial 12, rejected | **All three fail** | FAIL / PASS | PASS / PASS | FAIL / FAIL | All pass |
| Trial 24, rejected | **All three fail** | PASS / FAIL | PASS / FAIL | FAIL / PASS | Seed 11 fails |

- Keep the specified mechanics as WIP with **EM_REP=4**, **15% rebuilding**, and **.15 stigma / radius 3 / 18 months**. The approved panel/replica-safe reads are concrete and tested; neither the retained profile nor a trial is represented as balance-approved.
- Decide the disposition of the **unmet balance contract**, using the tables above. No exemption, broader calibration or change to specified costs has been assumed. Any continued calibration must address both seeds and every gating year; the measured endpoint on one seed is insufficient for acceptance.
- After NEW-05 runtime merges, run the required new shared envelope and remeasure the final LG-06 profile against that base. The current source-equivalent base results remain valid evidence for this round; a future base is not presumed to fix them.

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

As in Review 1, the actual fallback uses Node 22 TypeScript transformation and an extension resolver because `tsx` is unavailable offline. All trial switches and frozen source copies stay in scratch. **All thirteen commands below completed**, serially through the quiet gate: five 128 screens and eight full-sized runs. Source files and default simbot behavior were not switched between runs; loaders select immutable scratch snapshots.

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
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep24" "$R/gates.mts" --size 128 --years 15 --seed 7 --quiet --hash --out "$R/128_s7_rep24_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep24" "$R/gates.mts" --size 256 --years 60 --seed 11 --quiet --out "$R/256_s11_rep24_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep24" "$R/gates.mts" --size 256 --years 60 --seed 11 --quiet --neglect --out "$R/256_s11_rep24_neglect.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep24" "$R/gates.mts" --size 256 --years 60 --seed 7 --quiet --out "$R/256_s7_rep24_base.json"
node "$Q" node --no-warnings --experimental-transform-types --experimental-loader "file:///$R/loader.mjs?mode=rep24" "$R/gates.mts" --size 256 --years 60 --seed 7 --quiet --neglect --out "$R/256_s7_rep24_neglect.json"
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
| Final runtime `npx tsc --noEmit`; `git diff --check` | **PASS / PASS**, exit 0; unchanged WIP constant remains 4 |
| UTF-8 decoding / no BOM | **PASS** on all 8 changed/new repository files; scratch PowerShell log also normalized to UTF-8 without BOM |

That is **49 formal cases passed and 2 skipped** across seven separately run files. The new formal packet-host cases supersede the earlier native adapter's CSS-import startup limitation. Short native probes additionally passed **10 mechanics**, **8 impact** and **3 panel** cases; they are redundant supporting checks, not additional formal-case coverage or a browser claim. No final native packet-adapter rerun is needed after the real packet-host file passes.

The exact successful invocation form, run from this worktree, is shown below; repeat it separately for each listed test file (substituting only the file argument):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T043/node_modules/vitest/vitest.mjs run tests/sim/neglectReplica.test.ts --maxWorkers=1 --configLoader native --pool threads
```

The successful workaround does not erase the ordinary startup failure, and skipped cases remain skipped. **The full suite, browser/real-Worker rendering, B2 integration, GPU timing and benchmarks remain for the lead** under the supplied restrictions. Post-NEW-05 final bot/envelope remeasurement also remains as required by NOTE-048.

The newly approved panel and Worker read requests are fulfilled by the small hunks above. Outstanding requests from the original WIP remain:

- **B2, `src/sim/infra/services.ts`, `ServicesSystem.due()` / `prep()` and NIMBY dirty handling:** queue a bounded NIMBY pass on scar creation and the next absolute expiry; avoid a synchronous full raster rebuild at burn-down. Source footprints/absolute expiries persist exactly, but the existing raster cadence can lag them by about 30 game days.
- **GUIDE/cloud, `src/ui/panels/BudgetPanel.ts`, `ITEM_LABELS` consumed by `BudgetPanel.itemLabel()` / `ledgerTable()`:** map `emergency:rebuild` to **“Rebuilding after emergencies”** (for example, `ITEM_LABELS.emergency.rebuild`). The charge already exists in budget data; the current generic label does not describe it. This held file is untouched.
- **META, `src/ui/EmergencyBanner.ts`, `EmergencyBanner.onEvent()` resolved/failed outcome construction:** append the formatted negative rebuilding amount, such as **“−§8,400 rebuild”**, from the existing host-delivered optional `Incident.rebuildCost`. This explains the incident's charge without live-system reads or another bill. This round's panel permission does not authorize the banner hunk.
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

**Round-3 disposition: FAIL / trade-off for the lead.** The approved panel and read path are implemented and tested; no numerical trial is promoted. The unchanged mechanics remain WIP, all three retained base population rows fail, and the decisions above require explicit lead resolution. The bounded EM_REP-only search is complete; the other authorized LG-06 constants were not exhaustively searched. No mathematical impossibility or exemption from the unmet contract is claimed.

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

## NOTE-053 ensemble verdicts (T062 campaign, against the dev this lane is built on)

Measured on a throwaway tree (this lane plus T062's flag commit 3833c8d); final gates on the dev with T041 follow after B2 and T041 land.

# T043 (LG-06) ensemble judgement — NOTE-053

Measurement only, against the pre-T041 dev simulation that this lane started from. T043 source commit: `414e491`. These results do not replace the required final gate against dev after T041 lands. No simulation/bot constant is tuned and no baseline is re-recorded.

The ensemble is the control plus ±§100 on day 1 and day 1441 (five members). Stage two adds ±§200 at both timings (nine members). Each collection command uses `--jobs 4`; every child passes through the quiet gate; commands across the campaign run one at a time.

Tolerance: population **1% of each dev median**, from NOTE-048’s amended T043 item tolerance. Approval, air and I-HT share use **0 absolute item tolerance**. NOTE-053 requires both membership inside dev’s min–max band and absolute median delta ≤ max(item tolerance, half dev band), for every year from year 10. Funds are not a base-row balance metric; their raw annual values are reduced by the same median/min/max procedure for the variant target. Air is mean air at homes; I-HT share is a fraction; approval is in points; funds are unrounded observer values.

Positive target margin means pass; a negative margin means fail. Stage two is requested at five members when the absolute distance to a threshold is ≤ half the corresponding dev band. The approval-gap comparison uses half of the attentive dev approval band as NOTE-053’s metric-band reference; both LG-06-on and LG-06-off gaps are computed from same-commit ensemble medians. Stage two resolves the verdict with nine members and does not recurse.

## Summary and threshold margins

| Stage | Row | Check | Observed | Threshold (≤) | Margin | Half dev band | Current median verdict | Status |
|---:|---|---|---:|---:|---:|---:|---|---|
| 5 | 128x15_s7 | Base, all four metrics y10–end | 11 failed metric-years | 0 failed | -2271 (minimum active-interval margin; units vary) | varies | fail | needs stage two |
| 5 | 256x60_s7 | Base, all four metrics y10–end | 73 failed metric-years | 0 failed | -56647 (minimum active-interval margin; units vary) | varies | fail | needs stage two |
| 5 | 256x60_s11 | Base, all four metrics y10–end | 92 failed metric-years | 0 failed | -60772 (minimum active-interval margin; units vary) | varies | fail | needs stage two |
| 5 | 256x60_s7 | Neglect population at least 2% below attentive | 1450850 | 1515020.22 | 64170.22 people | 66956.5 | pass | needs stage two |
| 5 | 256x60_s7 | Neglect funds no higher than attentive | 15678152 | 16614962 | 936810 funds | 3645675.5 | pass | needs stage two |
| 5 | 256x60_s7 | Approval cost unchanged or larger, with 0.5pp slack | -5.134255465 | -3.680999367 | 1.453256098 approval points | 0.4008042029 | pass | final at this stage |
| 5 | 256x60_s11 | Neglect population at least 2% below attentive | 1476160 | 1404679.08 | -71480.92 people | 37930.5 | fail | final at this stage |
| 5 | 256x60_s11 | Neglect funds no higher than attentive | 16517336 | 14715421 | -1801915 funds | 887180.5 | fail | final at this stage |
| 5 | 256x60_s11 | Approval cost unchanged or larger, with 0.5pp slack | -6.545606048 | -5.592696823 | 0.9529092249 approval points | 1.109763647 | pass | needs stage two |
| 9 | 128x15_s7 | Base, all four metrics y10–end | 7 failed metric-years | 0 failed | -1675 (minimum active-interval margin; units vary) | varies | fail | final at this stage |
| 9 | 256x60_s7 | Base, all four metrics y10–end | 25 failed metric-years | 0 failed | -30773 (minimum active-interval margin; units vary) | varies | fail | final at this stage |
| 9 | 256x60_s11 | Base, all four metrics y10–end | 75 failed metric-years | 0 failed | -47994.68 (minimum active-interval margin; units vary) | varies | fail | final at this stage |
| 9 | 256x60_s7 | Neglect population at least 2% below attentive | 1450850 | 1507945.6 | 57095.6 people | 100437.5 | pass | final at this stage |
| 9 | 256x60_s7 | Neglect funds no higher than attentive | 15678152 | 16719627 | 1041475 funds | 3645675.5 | pass | final at this stage |
| 9 | 256x60_s7 | Approval cost unchanged or larger, with 0.5pp slack | -5.973151767 | -3.639498922 | 2.333652845 approval points | 1.178880145 | pass | final at this stage |
| 9 | 256x60_s11 | Neglect population at least 2% below attentive | 1489349 | 1404679.08 | -84669.92 people | 41884 | fail | final at this stage |
| 9 | 256x60_s11 | Neglect funds no higher than attentive | 16517336 | 14715421 | -1801915 funds | 1338258 | fail | final at this stage |
| 9 | 256x60_s11 | Approval cost unchanged or larger, with 0.5pp slack | -6.345888498 | -5.592696823 | 0.7531916758 approval points | 1.109763647 | pass | final at this stage |

The base summary’s minimum active-interval margin is diagnostic only because the four metrics have different units; the full comparison table gives each metric’s value, threshold and margin. Stage-one failures within the near-threshold window remain provisional until the requested nine-member row is available.

### Determining target verdicts

Each row uses its highest completed matching attentive/neglect/dev-reference stage. If a variant target is far enough from every threshold to retain five members, its five-member verdict stays valid even when its separate base comparison advances to nine members. No target mixes five- and nine-member medians.

| Row | Check | Determining members | Observed | Threshold (≤) | Margin | Verdict |
|---|---|---:|---:|---:|---:|---|
| 256x60_s7 | Neglect population at least 2% below attentive | 9 | 1450850 | 1507945.6 | 57095.6 people | pass |
| 256x60_s7 | Neglect funds no higher than attentive | 9 | 15678152 | 16719627 | 1041475 funds | pass |
| 256x60_s7 | Approval cost unchanged or larger, with 0.5pp slack | 9 | -5.973151767 | -3.639498922 | 2.333652845 approval points | pass |
| 256x60_s11 | Neglect population at least 2% below attentive | 9 | 1489349 | 1404679.08 | -84669.92 people | fail |
| 256x60_s11 | Neglect funds no higher than attentive | 9 | 16517336 | 14715421 | -1801915 funds | fail |
| 256x60_s11 | Approval cost unchanged or larger, with 0.5pp slack | 9 | -6.345888498 | -5.592696823 | 0.7531916758 approval points | pass |

## Stage-two disposition

Five-member rows requesting stage two: **128x15_s7, 256x60_s7, 256x60_s11**.

Nine-member dev/lane references determine the base verdicts. Variant targets use the determining stage listed above; five-member targets are retained only where no second-stage target request remains. Unresolved target requests: none. The five-member evidence is preserved above.

## Base comparisons, every year from year 10

| Stage | Row | Year | Metric | Dev median [min, max] | Lane median [min, max] | Delta | Delta % | Item tolerance | Allowed delta | Active passing interval | Signed margin | Current pass | Near threshold |
|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|
| 5 | 128x15_s7 | 10 (2010) | population | 100141 [98826, 101026] | 102785 [102104, 102954] | 2644 | 2.640277209 | 1001.41 | 1100 | [99041, 101026] | -1759 | fail | false |
| 5 | 128x15_s7 | 10 (2010) | approval | 70.85188531 [69.90005583, 72.42020171] | 71.45540359 [71.23475344, 71.80107469] | 0.6035182752 | 0.8518027044 | 0 | 1.260072937 | [69.90005583, 72.11195825] | 0.6565546621 | pass | true |
| 5 | 128x15_s7 | 10 (2010) | air | 0.07370387527 [0.06917694603, 0.07441642912] | 0.07532645594 [0.07322086772, 0.07562182856] | 0.001622580667 | 2.201486232 | 0 | 0.002619741547 | [0.07108413372, 0.07441642912] | -0.0009100268147 | fail | true |
| 5 | 128x15_s7 | 10 (2010) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 128x15_s7 | 11 (2011) | population | 116914 [115670, 118282] | 119615 [118805, 120107] | 2701 | 2.310245137 | 1169.14 | 1306 | [115670, 118220] | -1395 | fail | false |
| 5 | 128x15_s7 | 11 (2011) | approval | 73.33771917 [73.06794945, 75.22527722] | 73.42253878 [71.00021258, 73.78944156] | 0.08481960761 | 0.1156561843 | 0 | 1.078663882 | [73.06794945, 74.41638305] | 0.354589324 | pass | true |
| 5 | 128x15_s7 | 11 (2011) | air | 0.074557472 [0.07347336417, 0.07641983898] | 0.07698383566 [0.07466661183, 0.07731134325] | 0.002426363668 | 3.254353458 | 0 | 0.001473237404 | [0.07347336417, 0.0760307094] | -0.0009531262642 | fail | true |
| 5 | 128x15_s7 | 11 (2011) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 128x15_s7 | 12 (2012) | population | 135052 [133816, 136272] | 137855 [137218, 138449] | 2803 | 2.075496846 | 1350.52 | 1350.52 | [133816, 136272] | -1583 | fail | false |
| 5 | 128x15_s7 | 12 (2012) | approval | 75.06627753 [75.01476029, 76.99547539] | 75.02587736 [74.76036377, 75.32003238] | -0.04040017263 | -0.05381933668 | 0 | 0.990357551 | [75.01476029, 76.05663508] | 0.01111706953 | pass | true |
| 5 | 128x15_s7 | 12 (2012) | air | 0.07267668504 [0.07080482714, 0.07374932448] | 0.07286797087 [0.07214950967, 0.07527040826] | 0.0001912858302 | 0.2632010941 | 0 | 0.001472248668 | [0.07120443637, 0.07374932448] | 0.0008813536077 | pass | true |
| 5 | 128x15_s7 | 12 (2012) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 128x15_s7 | 13 (2013) | population | 154050 [151950, 154203] | 156203 [155829, 156743] | 2153 | 1.397598182 | 1540.5 | 1540.5 | [152509.5, 154203] | -2000 | fail | false |
| 5 | 128x15_s7 | 13 (2013) | approval | 76.71860519 [76.32924201, 78.13889513] | 76.55636202 [76.41561141, 76.93464947] | -0.1622431764 | -0.2114782665 | 0 | 0.9048265571 | [76.32924201, 77.62343175] | 0.2271200011 | pass | true |
| 5 | 128x15_s7 | 13 (2013) | air | 0.07853383177 [0.07771353972, 0.07877140413] | 0.08031546691 [0.07787192586, 0.08068026598] | 0.001781635143 | 2.268621183 | 0 | 0.0005289322075 | [0.07800489956, 0.07877140413] | -0.001544062783 | fail | false |
| 5 | 128x15_s7 | 13 (2013) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 128x15_s7 | 14 (2014) | population | 172301 [170539, 173724] | 175359 [175308, 177225] | 3058 | 1.774801075 | 1723.01 | 1723.01 | [170577.99, 173724] | -1635 | fail | false |
| 5 | 128x15_s7 | 14 (2014) | approval | 78.63132295 [78.38213823, 79.40495126] | 77.71170729 [77.47732503, 78.52780918] | -0.91961566 | -1.169528409 | 0 | 0.5114065157 | [78.38213823, 79.14272947] | -0.6704309335 | fail | false |
| 5 | 128x15_s7 | 14 (2014) | air | 0.08641309568 [0.08332830457, 0.08724739085] | 0.08707340378 [0.08300697713, 0.08846843246] | 0.000660308093 | 0.7641296586 | 0 | 0.001959543139 | [0.08445355255, 0.08724739085] | 0.0001739870683 | pass | true |
| 5 | 128x15_s7 | 14 (2014) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 128x15_s7 | 15 (2015) | population | 191588 [190132, 193108] | 195379 [194876, 196251] | 3791 | 1.978725181 | 1915.88 | 1915.88 | [190132, 193108] | -2271 | fail | false |
| 5 | 128x15_s7 | 15 (2015) | approval | 81.3650175 [80.9060989, 81.55629987] | 80.17311851 [78.86648005, 81.00064779] | -1.191898996 | -1.464878927 | 0 | 0.3251004828 | [81.03991702, 81.55629987] | -0.8667985128 | fail | false |
| 5 | 128x15_s7 | 15 (2015) | air | 0.09287306661 [0.09088359244, 0.09649320183] | 0.0943868709 [0.08953516655, 0.0951341412] | 0.001513804287 | 1.629971253 | 0 | 0.002804804697 | [0.09088359244, 0.09567787131] | 0.00129100041 | pass | true |
| 5 | 128x15_s7 | 15 (2015) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 10 (2010) | population | 99145 [98274, 99253] | 98127 [97499, 98544] | -1018 | -1.02677896 | 991.45 | 991.45 | [98274, 99253] | -147 | fail | true |
| 5 | 256x60_s7 | 10 (2010) | approval | 63.82076169 [62.17693823, 63.88308647] | 63.57734932 [62.20492528, 64.10195343] | -0.243412363 | -0.3813999655 | 0 | 0.85307412 | [62.96768757, 63.88308647] | 0.3057371499 | pass | true |
| 5 | 256x60_s7 | 10 (2010) | air | 0.07398504449 [0.06995632368, 0.08026279463] | 0.08298485266 [0.08077339258, 0.08477644047] | 0.008999808171 | 12.16436137 | 0 | 0.005153235476 | [0.06995632368, 0.07913827997] | -0.003846572696 | fail | true |
| 5 | 256x60_s7 | 10 (2010) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 11 (2011) | population | 112884 [112139, 113394] | 112065 [110812, 112347] | -819 | -0.7255235463 | 1128.84 | 1128.84 | [112139, 113394] | -74 | fail | true |
| 5 | 256x60_s7 | 11 (2011) | approval | 62.11639746 [61.6347523, 63.22293323] | 60.09462116 [58.25466701, 62.10278526] | -2.021776306 | -3.254818999 | 0 | 0.7940904648 | [61.6347523, 62.91048793] | -1.540131141 | fail | false |
| 5 | 256x60_s7 | 11 (2011) | air | 0.06948792381 [0.06015839156, 0.07004323351] | 0.06507256229 [0.06476713863, 0.06873547406] | -0.004415361515 | -6.354142235 | 0 | 0.004942420974 | [0.06454550283, 0.07004323351] | 0.0005270594589 | pass | true |
| 5 | 256x60_s7 | 11 (2011) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 12 (2012) | population | 129198 [127207, 130031] | 128762 [127030, 128989] | -436 | -0.3374665242 | 1291.98 | 1412 | [127786, 130031] | 976 | pass | true |
| 5 | 256x60_s7 | 12 (2012) | approval | 61.64717599 [61.05141453, 67.06703746] | 63.90477768 [62.54800311, 65.10957141] | 2.257601689 | 3.662133183 | 0 | 3.007811466 | [61.05141453, 64.65498746] | 0.7502097773 | pass | true |
| 5 | 256x60_s7 | 12 (2012) | air | 0.05901701842 [0.05475636211, 0.05905572116] | 0.05793188676 [0.0577824806, 0.0600674356] | -0.001085131659 | -1.838675839 | 0 | 0.002149679524 | [0.0568673389, 0.05905572116] | 0.001064547865 | pass | true |
| 5 | 256x60_s7 | 12 (2012) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 13 (2013) | population | 145600 [144178, 146526] | 145359 [143666, 145559] | -241 | -0.165521978 | 1456 | 1456 | [144178, 146526] | 1167 | pass | true |
| 5 | 256x60_s7 | 13 (2013) | approval | 64.35682185 [62.28396953, 67.78926031] | 67.41603996 [66.28616827, 68.1113973] | 3.059218108 | 4.753525764 | 0 | 2.752645392 | [62.28396953, 67.10946724] | -0.3065727161 | fail | true |
| 5 | 256x60_s7 | 13 (2013) | air | 0.05905463297 [0.05473584943, 0.06027168235] | 0.0568474305 [0.05429337049, 0.05957583086] | -0.002207202468 | -3.737560216 | 0 | 0.002767916464 | [0.05628671651, 0.06027168235] | 0.0005607139961 | pass | true |
| 5 | 256x60_s7 | 13 (2013) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 14 (2014) | population | 162928 [160481, 163206] | 162940 [161489, 163260] | 12 | 0.007365216537 | 1629.28 | 1629.28 | [161298.72, 163206] | 266 | pass | true |
| 5 | 256x60_s7 | 14 (2014) | approval | 66.18562745 [64.5977661, 67.84053077] | 67.90068315 [67.37066025, 69.16602264] | 1.715055699 | 2.591281166 | 0 | 1.621382337 | [64.5977661, 67.80700978] | -0.09367336214 | fail | true |
| 5 | 256x60_s7 | 14 (2014) | air | 0.05850393943 [0.05330417386, 0.06011290272] | 0.05496446533 [0.05247547443, 0.05630815306] | -0.003539474102 | -6.049975671 | 0 | 0.003404364428 | [0.055099575, 0.06011290272] | -0.0001351096744 | fail | true |
| 5 | 256x60_s7 | 14 (2014) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 15 (2015) | population | 181762 [180069, 182155] | 181527 [180454, 182013] | -235 | -0.1292899506 | 1817.62 | 1817.62 | [180069, 182155] | 628 | pass | true |
| 5 | 256x60_s7 | 15 (2015) | approval | 69.00507629 [68.77366167, 69.39037919] | 70.16789958 [68.06714219, 70.17386867] | 1.162823292 | 1.685127174 | 0 | 0.3083587573 | [68.77366167, 69.31343504] | -0.8544645348 | fail | false |
| 5 | 256x60_s7 | 15 (2015) | air | 0.05632347203 [0.05204742262, 0.05656213969] | 0.0519674817 [0.05136465745, 0.05531878332] | -0.004355990333 | -7.733881056 | 0 | 0.002257358533 | [0.0540661135, 0.05656213969] | -0.0020986318 | fail | true |
| 5 | 256x60_s7 | 15 (2015) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 16 (2016) | population | 201275 [199101, 201610] | 200813 [199049, 200924] | -462 | -0.2295367035 | 2012.75 | 2012.75 | [199262.25, 201610] | 797 | pass | true |
| 5 | 256x60_s7 | 16 (2016) | approval | 69.99510355 [69.92364864, 70.15988719] | 70.22464945 [69.83025628, 71.03458549] | 0.2295459056 | 0.3279456619 | 0 | 0.1181192746 | [69.92364864, 70.11322282] | -0.111426631 | fail | true |
| 5 | 256x60_s7 | 16 (2016) | air | 0.05513854761 [0.05268888525, 0.05789130553] | 0.0523497427 [0.05059576057, 0.05374189476] | -0.0027888049 | -5.057813493 | 0 | 0.002601210137 | [0.05268888525, 0.05773975774] | -0.0003391425458 | fail | true |
| 5 | 256x60_s7 | 16 (2016) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 17 (2017) | population | 220777 [218074, 221905] | 220439 [218763, 220631] | -338 | -0.1530956576 | 2207.77 | 2207.77 | [218569.23, 221905] | 1466 | pass | true |
| 5 | 256x60_s7 | 17 (2017) | approval | 69.51788691 [69.41882736, 70.6855795] | 70.37562724 [70.0034047, 70.71851346] | 0.8577403305 | 1.233841201 | 0 | 0.6333760687 | [69.41882736, 70.15126298] | -0.2243642618 | fail | true |
| 5 | 256x60_s7 | 17 (2017) | air | 0.05531328538 [0.05349866204, 0.06200433573] | 0.05500182221 [0.0537240202, 0.05806873803] | -0.0003114631633 | -0.5630892492 | 0 | 0.004252836844 | [0.05349866204, 0.05956612222] | 0.001503160169 | pass | true |
| 5 | 256x60_s7 | 17 (2017) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 18 (2018) | population | 241134 [239141, 242093] | 240650 [238720, 241001] | -484 | -0.2007182728 | 2411.34 | 2411.34 | [239141, 242093] | 1443 | pass | true |
| 5 | 256x60_s7 | 18 (2018) | approval | 69.98637804 [69.90046161, 70.38790662] | 70.97879344 [70.51938504, 71.40485328] | 0.9924153946 | 1.418012222 | 0 | 0.2437225059 | [69.90046161, 70.23010055] | -0.7486928887 | fail | false |
| 5 | 256x60_s7 | 18 (2018) | air | 0.05774630877 [0.05342982159, 0.06327370354] | 0.0563835625 [0.05588982049, 0.05917943459] | -0.001362746275 | -2.359884648 | 0 | 0.004921940974 | [0.05342982159, 0.06266824975] | 0.002953740909 | pass | true |
| 5 | 256x60_s7 | 18 (2018) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 19 (2019) | population | 262375 [260393, 263043] | 261498 [259949, 263343] | -877 | -0.3342544069 | 2623.75 | 2623.75 | [260393, 263043] | 1105 | pass | true |
| 5 | 256x60_s7 | 19 (2019) | approval | 71.17290726 [70.26711873, 71.47549716] | 71.26686555 [71.23967285, 73.20204502] | 0.09395829712 | 0.132014134 | 0 | 0.6041892152 | [70.56871804, 71.47549716] | 0.2086316098 | pass | true |
| 5 | 256x60_s7 | 19 (2019) | air | 0.05519922307 [0.05330468882, 0.06839823207] | 0.05508944578 [0.05419912903, 0.05665044207] | -0.000109777284 | -0.1988746904 | 0 | 0.007546771624 | [0.05330468882, 0.06274599469] | 0.001784756961 | pass | true |
| 5 | 256x60_s7 | 19 (2019) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 20 (2020) | population | 284938 [283841, 285431] | 283834 [282528, 285742] | -1104 | -0.387452709 | 2849.38 | 2849.38 | [283841, 285431] | -7 | fail | true |
| 5 | 256x60_s7 | 20 (2020) | approval | 72.13716937 [71.25365736, 72.56077558] | 72.52625836 [72.42288198, 75.55877174] | 0.3890889881 | 0.5393737951 | 0 | 0.6535591118 | [71.48361026, 72.56077558] | 0.03451722545 | pass | true |
| 5 | 256x60_s7 | 20 (2020) | air | 0.05489545306 [0.05222262828, 0.0595928519] | 0.05453199356 [0.0542437286, 0.05658068723] | -0.0003634594944 | -0.6620939881 | 0 | 0.003685111807 | [0.05222262828, 0.05858056486] | 0.00230936528 | pass | true |
| 5 | 256x60_s7 | 20 (2020) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 21 (2021) | population | 309055 [307460, 309551] | 306754 [305182, 308329] | -2301 | -0.7445276731 | 3090.55 | 3090.55 | [307460, 309551] | -706 | fail | true |
| 5 | 256x60_s7 | 21 (2021) | approval | 72.75571171 [72.41128196, 73.95833211] | 75.66714204 [74.67250478, 76.03979255] | 2.911430339 | 4.001651927 | 0 | 0.7735250791 | [72.41128196, 73.52923678] | -2.13790526 | fail | false |
| 5 | 256x60_s7 | 21 (2021) | air | 0.05367024742 [0.05104770164, 0.06183595995] | 0.05544164385 [0.05337427525, 0.05673138789] | 0.001771396422 | 3.300518457 | 0 | 0.005394129155 | [0.05104770164, 0.05906437658] | 0.003622732733 | pass | true |
| 5 | 256x60_s7 | 21 (2021) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 22 (2022) | population | 332599 [330779, 332670] | 331025 [328735, 331333] | -1574 | -0.4732425533 | 3325.99 | 3325.99 | [330779, 332670] | 246 | pass | true |
| 5 | 256x60_s7 | 22 (2022) | approval | 75.43106353 [75.33581133, 76.37000966] | 76.41177344 [74.60314146, 76.50373905] | 0.9807099118 | 1.300140639 | 0 | 0.5170991637 | [75.33581133, 75.9481627] | -0.463610748 | fail | true |
| 5 | 256x60_s7 | 22 (2022) | air | 0.05325238997 [0.04997855337, 0.06083121731] | 0.05347624324 [0.05333955458, 0.05793396585] | 0.0002238532659 | 0.4203628533 | 0 | 0.005426331971 | [0.04997855337, 0.05867872194] | 0.003497689866 | pass | true |
| 5 | 256x60_s7 | 22 (2022) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 23 (2023) | population | 356659 [354200, 357442] | 354525 [352793, 354568] | -2134 | -0.5983306183 | 3566.59 | 3566.59 | [354200, 357442] | 325 | pass | true |
| 5 | 256x60_s7 | 23 (2023) | approval | 76.3420324 [76.22880941, 76.95120441] | 76.28633531 [76.04659719, 76.7555385] | -0.05569708946 | -0.07295730506 | 0 | 0.3611975012 | [76.22880941, 76.7032299] | 0.05752590135 | pass | true |
| 5 | 256x60_s7 | 23 (2023) | air | 0.05369601085 [0.05073665229, 0.06230343784] | 0.05652507424 [0.0553436937, 0.05913668692] | 0.002829063393 | 5.268665862 | 0 | 0.005783392777 | [0.05073665229, 0.05947940363] | 0.002954329384 | pass | true |
| 5 | 256x60_s7 | 23 (2023) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 24 (2024) | population | 380900 [378985, 382163] | 379550 [377837, 379761] | -1350 | -0.3544237333 | 3809 | 3809 | [378985, 382163] | 565 | pass | true |
| 5 | 256x60_s7 | 24 (2024) | approval | 76.61324853 [75.46140119, 77.06614908] | 76.70334212 [75.82381396, 76.93601948] | 0.09009358691 | 0.1175953097 | 0 | 0.8023739434 | [75.81087459, 77.06614908] | 0.3628069605 | pass | true |
| 5 | 256x60_s7 | 24 (2024) | air | 0.05709067562 [0.05297240487, 0.06946386082] | 0.05745263435 [0.05592590297, 0.06088839174] | 0.0003619587299 | 0.6340067374 | 0 | 0.008245727976 | [0.05297240487, 0.06533640359] | 0.004480229477 | pass | true |
| 5 | 256x60_s7 | 24 (2024) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 25 (2025) | population | 406912 [404262, 407731] | 404703 [403260, 405386] | -2209 | -0.5428692199 | 4069.12 | 4069.12 | [404262, 407731] | 441 | pass | true |
| 5 | 256x60_s7 | 25 (2025) | approval | 76.84744866 [76.49970753, 77.12768499] | 77.03890007 [75.7330873, 77.07640842] | 0.1914514042 | 0.2491317636 | 0 | 0.3139887311 | [76.53345993, 77.12768499] | 0.08878492368 | pass | true |
| 5 | 256x60_s7 | 25 (2025) | air | 0.05785694715 [0.05725235073, 0.06818303004] | 0.0589988175 [0.05581161946, 0.06196930821] | 0.001141870352 | 1.973609753 | 0 | 0.005465339652 | [0.05725235073, 0.0633222868] | 0.001746466769 | pass | true |
| 5 | 256x60_s7 | 25 (2025) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 26 (2026) | population | 433030 [431806, 433598] | 432490 [429210, 432575] | -540 | -0.1247026765 | 4330.3 | 4330.3 | [431806, 433598] | 684 | pass | true |
| 5 | 256x60_s7 | 26 (2026) | approval | 76.50599368 [76.05781622, 77.20176766] | 76.47705993 [76.35187048, 77.54143833] | -0.02893374984 | -0.03781893215 | 0 | 0.5719757196 | [76.05781622, 77.0779694] | 0.4192437171 | pass | true |
| 5 | 256x60_s7 | 26 (2026) | air | 0.0578413541 [0.05765442376, 0.06814870098] | 0.0582745754 [0.05590806637, 0.06128260213] | 0.0004332213009 | 0.7489819485 | 0 | 0.005247138608 | [0.05765442376, 0.06308849271] | 0.0006201516367 | pass | true |
| 5 | 256x60_s7 | 26 (2026) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 27 (2027) | population | 461632 [460757, 461953] | 460455 [457619, 461735] | -1177 | -0.2549649938 | 4616.32 | 4616.32 | [460757, 461953] | -302 | fail | true |
| 5 | 256x60_s7 | 27 (2027) | approval | 77.76357147 [77.62602086, 78.20945248] | 77.79345213 [77.19953701, 78.3693627] | 0.02988065954 | 0.03842500927 | 0 | 0.2917158103 | [77.62602086, 78.05528728] | 0.1674312651 | pass | true |
| 5 | 256x60_s7 | 27 (2027) | air | 0.05928793344 [0.05795504928, 0.06949044687] | 0.0609214311 [0.05901099682, 0.06310264535] | 0.001633497664 | 2.755194134 | 0 | 0.005767698797 | [0.05795504928, 0.06505563223] | 0.002966381822 | pass | true |
| 5 | 256x60_s7 | 27 (2027) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 28 (2028) | population | 491442 [489700, 491659] | 490402 [487636, 491027] | -1040 | -0.2116221243 | 4914.42 | 4914.42 | [489700, 491659] | 702 | pass | true |
| 5 | 256x60_s7 | 28 (2028) | approval | 77.58782939 [77.38225682, 78.73043325] | 78.60827265 [78.30673863, 78.72925021] | 1.020443263 | 1.315210479 | 0 | 0.6740882169 | [77.38225682, 78.26191761] | -0.3463550459 | fail | true |
| 5 | 256x60_s7 | 28 (2028) | air | 0.05984054898 [0.0580580144, 0.07130186965] | 0.06145531022 [0.05896400109, 0.06342119143] | 0.001614761239 | 2.698439881 | 0 | 0.006621927626 | [0.0580580144, 0.0664624766] | 0.003397295819 | pass | true |
| 5 | 256x60_s7 | 28 (2028) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 29 (2029) | population | 522372 [519724, 522937] | 521019 [517602, 521095] | -1353 | -0.2590108199 | 5223.72 | 5223.72 | [519724, 522937] | 1295 | pass | true |
| 5 | 256x60_s7 | 29 (2029) | approval | 78.66518728 [78.53555884, 79.38332109] | 79.55693686 [78.23941276, 79.78519706] | 0.8917495794 | 1.133601292 | 0 | 0.4238811263 | [78.53555884, 79.0890684] | -0.4678684531 | fail | false |
| 5 | 256x60_s7 | 29 (2029) | air | 0.06465161068 [0.06251881772, 0.07664790395] | 0.06586735567 [0.0641281697, 0.0675388755] | 0.001215744996 | 1.880455852 | 0 | 0.007064543112 | [0.06251881772, 0.07171615379] | 0.003348537948 | pass | true |
| 5 | 256x60_s7 | 29 (2029) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 30 (2030) | population | 553169 [550399, 553583] | 551942 [549509, 552062] | -1227 | -0.2218128637 | 5531.69 | 5531.69 | [550399, 553583] | 1543 | pass | true |
| 5 | 256x60_s7 | 30 (2030) | approval | 79.88125531 [79.45763067, 80.37499072] | 80.55603604 [79.14307933, 80.91603338] | 0.6747807324 | 0.8447297551 | 0 | 0.4586800281 | [79.45763067, 80.33993534] | -0.2161007042 | fail | true |
| 5 | 256x60_s7 | 30 (2030) | air | 0.06629611533 [0.0657542974, 0.08013419957] | 0.06789094232 [0.0656010041, 0.06926255849] | 0.00159482699 | 2.405611524 | 0 | 0.007189951081 | [0.0657542974, 0.07348606641] | 0.002136644915 | pass | true |
| 5 | 256x60_s7 | 30 (2030) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 31 (2031) | population | 584845 [580940, 585610] | 583449 [581055, 583886] | -1396 | -0.2386957228 | 5848.45 | 5848.45 | [580940, 585610] | 2161 | pass | true |
| 5 | 256x60_s7 | 31 (2031) | approval | 81.31545386 [81.12959183, 81.34260413] | 81.13662844 [81.03936423, 82.36534491] | -0.1788254229 | -0.2199156672 | 0 | 0.1065061492 | [81.20894771, 81.34260413] | -0.07231927368 | fail | true |
| 5 | 256x60_s7 | 31 (2031) | air | 0.07205127143 [0.07138797056, 0.08440218457] | 0.07111599193 [0.07042194085, 0.07426306409] | -0.0009352794941 | -1.298074934 | 0 | 0.006507107004 | [0.07138797056, 0.07855837843] | -0.0002719786311 | fail | true |
| 5 | 256x60_s7 | 31 (2031) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 32 (2032) | population | 616271 [613290, 617395] | 615266 [613375, 616151] | -1005 | -0.1630776071 | 6162.71 | 6162.71 | [613290, 617395] | 1976 | pass | true |
| 5 | 256x60_s7 | 32 (2032) | approval | 81.8707558 [81.37807734, 82.20568232] | 82.31986153 [81.92800324, 82.37790177] | 0.4491057325 | 0.5485545212 | 0 | 0.4138024926 | [81.4569533, 82.20568232] | -0.1141792079 | fail | true |
| 5 | 256x60_s7 | 32 (2032) | air | 0.07779441403 [0.07623496412, 0.09215309722] | 0.0779171377 [0.07555663038, 0.07843538685] | 0.000122723666 | 0.1577538279 | 0 | 0.007959066549 | [0.07623496412, 0.08575348058] | 0.001682173571 | pass | true |
| 5 | 256x60_s7 | 32 (2032) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 33 (2033) | population | 649520 [645810, 649727] | 646977 [646136, 647599] | -2543 | -0.3915198916 | 6495.2 | 6495.2 | [645810, 649727] | 1167 | pass | true |
| 5 | 256x60_s7 | 33 (2033) | approval | 82.1871823 [81.90687577, 82.40353683] | 82.56408583 [82.02124804, 82.65703445] | 0.3769035311 | 0.4585916204 | 0 | 0.2483305293 | [81.93885177, 82.40353683] | -0.1605490019 | fail | true |
| 5 | 256x60_s7 | 33 (2033) | air | 0.08026825668 [0.08007267484, 0.09502526055] | 0.08204804199 [0.07751474242, 0.08374785704] | 0.001779785315 | 2.217296586 | 0 | 0.007476292858 | [0.08007267484, 0.08774454954] | 0.001975367158 | pass | true |
| 5 | 256x60_s7 | 33 (2033) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 34 (2034) | population | 681383 [678863, 681622] | 679375 [678928, 680619] | -2008 | -0.2946947605 | 6813.83 | 6813.83 | [678863, 681622] | 512 | pass | true |
| 5 | 256x60_s7 | 34 (2034) | approval | 81.87624095 [81.81164273, 82.72161931] | 82.58820217 [82.42248759, 82.68520553] | 0.7119612192 | 0.8695577752 | 0 | 0.4549882878 | [81.81164273, 82.33122924] | -0.2569729315 | fail | true |
| 5 | 256x60_s7 | 34 (2034) | air | 0.08629326293 [0.08541193814, 0.09840794208] | 0.08445102224 [0.08424640061, 0.09116805982] | -0.001842240689 | -2.134860389 | 0 | 0.006498001969 | [0.08541193814, 0.0927912649] | -0.0009609158986 | fail | true |
| 5 | 256x60_s7 | 34 (2034) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 35 (2035) | population | 715266 [711503, 715283] | 712843 [711060, 714149] | -2423 | -0.3387550925 | 7152.66 | 7152.66 | [711503, 715283] | 1340 | pass | true |
| 5 | 256x60_s7 | 35 (2035) | approval | 82.53841769 [82.11883848, 82.61152773] | 82.35093184 [82.01985267, 82.89335091] | -0.1874858513 | -0.2271498007 | 0 | 0.2463446247 | [82.29207307, 82.61152773] | 0.05885877343 | pass | true |
| 5 | 256x60_s7 | 35 (2035) | air | 0.09008933042 [0.08887255036, 0.1068540055] | 0.09190053114 [0.08951542404, 0.09408808587] | 0.001811200716 | 2.010449747 | 0 | 0.008990727566 | [0.08887255036, 0.09908005799] | 0.003027980782 | pass | true |
| 5 | 256x60_s7 | 35 (2035) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 36 (2036) | population | 747267 [745163, 747885] | 746501 [745682, 747463] | -766 | -0.1025068684 | 7472.67 | 7472.67 | [745163, 747885] | 1338 | pass | true |
| 5 | 256x60_s7 | 36 (2036) | approval | 81.68252893 [80.75969836, 82.08312859] | 82.47809757 [81.84407657, 82.76956646] | 0.7955686341 | 0.9739764971 | 0 | 0.6617151144 | [81.02081382, 82.08312859] | -0.3949689717 | fail | true |
| 5 | 256x60_s7 | 36 (2036) | air | 0.09857667571 [0.09655970828, 0.1127969766] | 0.09544427497 [0.09412768384, 0.09782987073] | -0.003132400737 | -3.177628698 | 0 | 0.008118634177 | [0.09655970828, 0.1066953099] | -0.001115433314 | fail | true |
| 5 | 256x60_s7 | 36 (2036) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 37 (2037) | population | 781483 [778371, 781532] | 780908 [779528, 782094] | -575 | -0.07357805608 | 7814.83 | 7814.83 | [778371, 781532] | 624 | pass | true |
| 5 | 256x60_s7 | 37 (2037) | approval | 81.970203 [81.35452451, 82.10804793] | 81.71716688 [81.66514244, 82.22318909] | -0.2530361117 | -0.3086927963 | 0 | 0.3767617129 | [81.59344128, 82.10804793] | 0.1237256012 | pass | true |
| 5 | 256x60_s7 | 37 (2037) | air | 0.1111848672 [0.1027556763, 0.1223969888] | 0.0998168659 [0.09898745934, 0.1081469597] | -0.01136800126 | -10.22441412 | 0 | 0.009820656255 | [0.1027556763, 0.1210055234] | -0.002938810349 | fail | true |
| 5 | 256x60_s7 | 37 (2037) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 38 (2038) | population | 816400 [814131, 818087] | 814193 [813916, 816105] | -2207 | -0.27033317 | 8164 | 8164 | [814131, 818087] | 62 | pass | true |
| 5 | 256x60_s7 | 38 (2038) | approval | 81.8263275 [79.77898811, 82.10776851] | 81.74401908 [81.09494439, 82.32053189] | -0.08230842251 | -0.1005891686 | 0 | 1.164390202 | [80.6619373, 82.10776851] | 0.3637494336 | pass | true |
| 5 | 256x60_s7 | 38 (2038) | air | 0.1137574554 [0.1115092066, 0.1328408683] | 0.107200509 [0.105784743, 0.1111848736] | -0.006556946391 | -5.763970694 | 0 | 0.01066583087 | [0.1115092066, 0.1244232863] | -0.004308697559 | fail | true |
| 5 | 256x60_s7 | 38 (2038) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 39 (2039) | population | 849116 [848274, 853454] | 850209 [849116, 850272] | 1093 | 0.1287221063 | 8491.16 | 8491.16 | [848274, 853454] | 1935 | pass | true |
| 5 | 256x60_s7 | 39 (2039) | approval | 81.66806406 [80.61492243, 82.03181268] | 81.87243247 [81.64337842, 82.99140437] | 0.2043684111 | 0.2502427522 | 0 | 0.708445125 | [80.95961893, 82.03181268] | 0.1593802129 | pass | true |
| 5 | 256x60_s7 | 39 (2039) | air | 0.1178890861 [0.1174690394, 0.1389095822] | 0.1129205541 [0.1065187738, 0.1143019601] | -0.004968532003 | -4.214581831 | 0 | 0.01072027136 | [0.1174690394, 0.1286093575] | -0.004548485347 | fail | true |
| 5 | 256x60_s7 | 39 (2039) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 40 (2040) | population | 885781 [885012, 890501] | 885189 [884058, 885279] | -592 | -0.06683367559 | 8857.81 | 8857.81 | [885012, 890501] | 177 | pass | true |
| 5 | 256x60_s7 | 40 (2040) | approval | 82.29785287 [81.49379686, 82.61861588] | 82.32142663 [80.81054913, 82.65435251] | 0.02357376001 | 0.02864444112 | 0 | 0.5624095107 | [81.73544336, 82.61861588] | 0.2971892444 | pass | true |
| 5 | 256x60_s7 | 40 (2040) | air | 0.1233978845 [0.1183672546, 0.139513872] | 0.1198265627 [0.1167680308, 0.1228271938] | -0.003571321821 | -2.894151577 | 0 | 0.01057330866 | [0.1183672546, 0.1339711932] | 0.001459308053 | pass | true |
| 5 | 256x60_s7 | 40 (2040) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 41 (2041) | population | 922651 [917818, 928329] | 919200 [919116, 921709] | -3451 | -0.3740309174 | 9226.51 | 9226.51 | [917818, 928329] | 1382 | pass | true |
| 5 | 256x60_s7 | 41 (2041) | approval | 82.68114513 [81.32439314, 82.68507816] | 81.9582051 [81.49582823, 82.77886848] | -0.722940026 | -0.8743710853 | 0 | 0.6803425115 | [82.00080262, 82.68507816] | -0.04259751444 | fail | true |
| 5 | 256x60_s7 | 41 (2041) | air | 0.1253183917 [0.1214132579, 0.1433797784] | 0.1209156226 [0.1197723033, 0.127524578] | -0.004402769101 | -3.513266523 | 0 | 0.01098326025 | [0.1214132579, 0.1363016519] | -0.0004976353495 | fail | true |
| 5 | 256x60_s7 | 41 (2041) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 42 (2042) | population | 954296 [951529, 957446] | 955357 [954787, 957663] | 1061 | 0.1111814364 | 9542.96 | 9542.96 | [951529, 957446] | 2089 | pass | true |
| 5 | 256x60_s7 | 42 (2042) | approval | 81.73189258 [80.84159195, 82.06396611] | 81.77414831 [81.65745809, 81.98802669] | 0.04225572477 | 0.05170041147 | 0 | 0.6111870793 | [81.1207055, 82.06396611] | 0.289817808 | pass | true |
| 5 | 256x60_s7 | 42 (2042) | air | 0.1315819697 [0.1282514802, 0.1476719558] | 0.1275682027 [0.1228812135, 0.1303737507] | -0.004013767016 | -3.050392866 | 0 | 0.009710237821 | [0.1282514802, 0.1412922075] | -0.0006832774913 | fail | true |
| 5 | 256x60_s7 | 42 (2042) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 43 (2043) | population | 990452 [988082, 997916] | 992415 [989714, 994780] | 1963 | 0.1981923405 | 9904.52 | 9904.52 | [988082, 997916] | 4333 | pass | true |
| 5 | 256x60_s7 | 43 (2043) | approval | 81.41846199 [79.84456931, 82.58274162] | 81.97720227 [81.18967812, 81.98050197] | 0.5587402788 | 0.6862574717 | 0 | 1.369086155 | [80.04937583, 82.58274162] | 0.6055393559 | pass | true |
| 5 | 256x60_s7 | 43 (2043) | air | 0.1322276017 [0.1303388481, 0.1552976909] | 0.1318297107 [0.1268411225, 0.1424274033] | -0.0003978909998 | -0.3009137236 | 0 | 0.01247942138 | [0.1303388481, 0.144707023] | 0.001490862563 | pass | true |
| 5 | 256x60_s7 | 43 (2043) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 44 (2044) | population | 1029252 [1023376, 1034676] | 1035433 [1030216, 1037326] | 6181 | 0.6005332028 | 10292.52 | 10292.52 | [1023376, 1034676] | -757 | fail | true |
| 5 | 256x60_s7 | 44 (2044) | approval | 81.40900837 [80.009705, 81.50775236] | 81.92900716 [81.19380507, 82.27506752] | 0.5199987886 | 0.6387484617 | 0 | 0.7490236774 | [80.65998469, 81.50775236] | -0.4212547983 | fail | true |
| 5 | 256x60_s7 | 44 (2044) | air | 0.1405887458 [0.1388256109, 0.1589794896] | 0.1398026557 [0.1308152791, 0.1410050078] | -0.0007860901658 | -0.5591416021 | 0 | 0.01007693937 | [0.1388256109, 0.1506656852] | 0.0009770447769 | pass | true |
| 5 | 256x60_s7 | 44 (2044) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 45 (2045) | population | 1066213 [1064870, 1072615] | 1071905 [1070693, 1075424] | 5692 | 0.533852054 | 10662.13 | 10662.13 | [1064870, 1072615] | 710 | pass | true |
| 5 | 256x60_s7 | 45 (2045) | approval | 80.96014544 [79.75209419, 81.18818587] | 81.3275523 [81.12129068, 81.75874687] | 0.3674068624 | 0.4538120088 | 0 | 0.7180458369 | [80.2420996, 81.18818587] | -0.1393664303 | fail | true |
| 5 | 256x60_s7 | 45 (2045) | air | 0.1456996772 [0.1431349529, 0.1605866295] | 0.1406695135 [0.1365652829, 0.1460437333] | -0.005030163758 | -3.452419287 | 0 | 0.008725838267 | [0.1431349529, 0.1544255155] | -0.002465439429 | fail | true |
| 5 | 256x60_s7 | 45 (2045) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 46 (2046) | population | 1106293 [1098739, 1110071] | 1110161 [1109183, 1117252] | 3868 | 0.3496361271 | 11062.93 | 11062.93 | [1098739, 1110071] | -90 | fail | true |
| 5 | 256x60_s7 | 46 (2046) | approval | 80.85124832 [79.570483, 81.00050684] | 80.89641466 [80.50004482, 81.20876454] | 0.04516633391 | 0.05586349605 | 0 | 0.715011921 | [80.1362364, 81.00050684] | 0.1040921842 | pass | true |
| 5 | 256x60_s7 | 46 (2046) | air | 0.1500675306 [0.144261355, 0.1664440982] | 0.1456592696 [0.1373923031, 0.1494612752] | -0.004408261014 | -2.937518194 | 0 | 0.01109137161 | [0.144261355, 0.1611589022] | 0.00139791457 | pass | true |
| 5 | 256x60_s7 | 46 (2046) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 47 (2047) | population | 1143633 [1138642, 1152095] | 1154164 [1152384, 1156607] | 10531 | 0.9208373665 | 11436.33 | 11436.33 | [1138642, 1152095] | -2069 | fail | true |
| 5 | 256x60_s7 | 47 (2047) | approval | 80.17480883 [79.25545705, 81.05888527] | 81.51245335 [80.77210622, 81.80837] | 1.337644513 | 1.668409982 | 0 | 0.9017141085 | [79.27309472, 81.05888527] | -0.4535680797 | fail | true |
| 5 | 256x60_s7 | 47 (2047) | air | 0.1476919285 [0.1476590325, 0.1677293132] | 0.1526874038 [0.1405406153, 0.1566593026] | 0.004995475327 | 3.38236177 | 0 | 0.01003514035 | [0.1476590325, 0.1577270689] | 0.005028371316 | pass | true |
| 5 | 256x60_s7 | 47 (2047) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s7 | 48 (2048) | population | 1186078 [1177033, 1187726] | 1197010 [1189847, 1198219] | 10932 | 0.921693177 | 11860.78 | 11860.78 | [1177033, 1187726] | -9284 | fail | false |
| 5 | 256x60_s7 | 48 (2048) | approval | 80.46248204 [79.89649044, 80.8686423] | 81.45852612 [80.3022503, 81.94307751] | 0.9960440798 | 1.237898775 | 0 | 0.4860759297 | [79.97640611, 80.8686423] | -0.589883817 | fail | false |
| 5 | 256x60_s7 | 48 (2048) | air | 0.1533697285 [0.1477530266, 0.1727237] | 0.1506166526 [0.1461418506, 0.1545138623] | -0.002753075863 | -1.795058184 | 0 | 0.01248533671 | [0.1477530266, 0.1658550652] | 0.002863625968 | pass | true |
| 5 | 256x60_s7 | 48 (2048) | ihtShare | 0 [0, 0.001755555991] | 0 [0, 0] | 0 | 0 | 0 | 0.0008777779957 | [0, 0.0008777779957] | 0 | pass | true |
| 5 | 256x60_s7 | 49 (2049) | population | 1225463 [1219475, 1232104] | 1235983 [1229969, 1240385] | 10520 | 0.8584510507 | 12254.63 | 12254.63 | [1219475, 1232104] | -3879 | fail | true |
| 5 | 256x60_s7 | 49 (2049) | approval | 80.74885377 [78.80766758, 80.95111054] | 81.31943181 [80.64963542, 81.56271059] | 0.570578035 | 0.7066082159 | 0 | 1.07172148 | [79.67713229, 80.95111054] | -0.3683212696 | fail | true |
| 5 | 256x60_s7 | 49 (2049) | air | 0.1504751014 [0.1473500515, 0.1696897742] | 0.1547410827 [0.143035178, 0.1598302315] | 0.004265981288 | 2.835008083 | 0 | 0.01116986135 | [0.1473500515, 0.1616449628] | 0.006903880064 | pass | true |
| 5 | 256x60_s7 | 49 (2049) | ihtShare | 0 [0, 0.01359736479] | 0 [0, 0] | 0 | 0 | 0 | 0.006798682396 | [0, 0.006798682396] | 0 | pass | true |
| 5 | 256x60_s7 | 50 (2050) | population | 1265741 [1260949, 1271588] | 1274504 [1270444, 1275132] | 8763 | 0.6923217309 | 12657.41 | 12657.41 | [1260949, 1271588] | -2916 | fail | true |
| 5 | 256x60_s7 | 50 (2050) | approval | 80.82823338 [79.00016158, 80.84473736] | 80.6827045 [80.26837815, 81.04717151] | -0.1455288886 | -0.1800470981 | 0 | 0.9222878924 | [79.90594549, 80.84473736] | 0.1620328675 | pass | true |
| 5 | 256x60_s7 | 50 (2050) | air | 0.1554648932 [0.1545329508, 0.1770923645] | 0.1584230689 [0.1490382102, 0.1658566083] | 0.002958175606 | 1.902793321 | 0 | 0.01127970685 | [0.1545329508, 0.1667446001] | 0.00389011809 | pass | true |
| 5 | 256x60_s7 | 50 (2050) | ihtShare | 0.01361078142 [0, 0.02668765661] | 0 [0, 0] | -0.01361078142 | -100 | 0 | 0.0133438283 | [0.0002669531187, 0.02668765661] | -0.0002669531187 | fail | true |
| 5 | 256x60_s7 | 51 (2051) | population | 1306287 [1299862, 1310245] | 1316826 [1309915, 1316938] | 10539 | 0.8067905445 | 13062.87 | 13062.87 | [1299862, 1310245] | -6581 | fail | false |
| 5 | 256x60_s7 | 51 (2051) | approval | 79.67800859 [78.98200837, 80.7534328] | 80.27536667 [79.48084092, 80.92310961] | 0.597358081 | 0.7497151241 | 0 | 0.8857122108 | [78.98200837, 80.5637208] | 0.2883541298 | pass | true |
| 5 | 256x60_s7 | 51 (2051) | air | 0.1641497153 [0.1526035944, 0.1787988062] | 0.1570688485 [0.1520328036, 0.1688571736] | -0.007080866779 | -4.31366376 | 0 | 0.01309760594 | [0.1526035944, 0.1772473212] | 0.004465254111 | pass | true |
| 5 | 256x60_s7 | 51 (2051) | ihtShare | 0.01771147824 [0.005922490129, 0.03229953108] | 0 [0, 0] | -0.01771147824 | -100 | 0 | 0.01318852047 | [0.005922490129, 0.03089999871] | -0.005922490129 | fail | true |
| 5 | 256x60_s7 | 52 (2052) | population | 1342501 [1317983, 1347980] | 1353336 [1352422, 1362826] | 10835 | 0.8070757489 | 13425.01 | 14998.5 | [1327502.5, 1347980] | -5356 | fail | true |
| 5 | 256x60_s7 | 52 (2052) | approval | 80.43766371 [78.7405309, 80.63697471] | 79.44555421 [79.35527855, 80.38522652] | -0.9921094969 | -1.23338925 | 0 | 0.9482219056 | [79.4894418, 80.63697471] | -0.04388759124 | fail | true |
| 5 | 256x60_s7 | 52 (2052) | air | 0.1549569774 [0.1533680434, 0.1778936906] | 0.1671985475 [0.1506056723, 0.1690965258] | 0.01224157013 | 7.899979941 | 0 | 0.01226282359 | [0.1533680434, 0.167219801] | 0.00002125345891 | pass | true |
| 5 | 256x60_s7 | 52 (2052) | ihtShare | 0.02565309911 [0.00814035221, 0.03947972997] | 0 [0, 0] | -0.02565309911 | -100 | 0 | 0.01566968888 | [0.009983410229, 0.03947972997] | -0.009983410229 | fail | true |
| 5 | 256x60_s7 | 53 (2053) | population | 1354614 [1331848, 1392709] | 1400139 [1396564, 1402755] | 45525 | 3.360735973 | 13546.14 | 30430.5 | [1331848, 1385044.5] | -15094.5 | fail | true |
| 5 | 256x60_s7 | 53 (2053) | approval | 80.00346448 [78.71713769, 80.75484701] | 80.11565783 [79.44197523, 80.51635344] | 0.1121933572 | 0.1402356235 | 0 | 1.01885466 | [78.98460981, 80.75484701] | 0.639189182 | pass | true |
| 5 | 256x60_s7 | 53 (2053) | air | 0.1640372879 [0.1553335117, 0.1746259797] | 0.1703509333 [0.1561688302, 0.1713003455] | 0.00631364542 | 3.848908685 | 0 | 0.009646233997 | [0.1553335117, 0.1736835219] | 0.003332588578 | pass | true |
| 5 | 256x60_s7 | 53 (2053) | ihtShare | 0.03893981383 [0.009564509565, 0.05883765404] | 0 [0, 0] | -0.03893981383 | -100 | 0 | 0.02463657224 | [0.01430324159, 0.05883765404] | -0.01430324159 | fail | true |
| 5 | 256x60_s7 | 54 (2054) | population | 1374323 [1341305, 1413703] | 1440562 [1439702, 1446231] | 66239 | 4.81975489 | 13743.23 | 36199 | [1341305, 1410522] | -30040 | fail | true |
| 5 | 256x60_s7 | 54 (2054) | approval | 80.59380575 [78.74415033, 81.01134176] | 80.19536719 [78.9241116, 80.75945707] | -0.3984385595 | -0.4943786384 | 0 | 1.133595713 | [79.46021004, 81.01134176] | 0.735157153 | pass | true |
| 5 | 256x60_s7 | 54 (2054) | air | 0.1641298778 [0.1526786937, 0.1829939663] | 0.167821452 [0.1568620237, 0.170776747] | 0.003691574161 | 2.249178644 | 0 | 0.0151576363 | [0.1526786937, 0.1792875141] | 0.01146606214 | pass | true |
| 5 | 256x60_s7 | 54 (2054) | ihtShare | 0.05354449472 [0.02363197522, 0.07475289161] | 0 [0, 0] | -0.05354449472 | -100 | 0 | 0.0255604582 | [0.02798403653, 0.07475289161] | -0.02798403653 | fail | false |
| 5 | 256x60_s7 | 55 (2055) | population | 1398399 [1338273, 1433758] | 1486134 [1470088, 1489981] | 87735 | 6.273960436 | 13983.99 | 47742.5 | [1350656.5, 1433758] | -52376 | fail | false |
| 5 | 256x60_s7 | 55 (2055) | approval | 79.81138752 [79.08766029, 81.11460045] | 79.99140795 [78.32491588, 80.02682743] | 0.180020436 | 0.2255573316 | 0 | 1.01347008 | [79.08766029, 80.8248576] | 0.833449644 | pass | true |
| 5 | 256x60_s7 | 55 (2055) | air | 0.1654050811 [0.1566320876, 0.1757489784] | 0.1695433761 [0.1596560825, 0.1736548509] | 0.004138295089 | 2.501915336 | 0 | 0.009558445391 | [0.1566320876, 0.1749635265] | 0.005420150302 | pass | true |
| 5 | 256x60_s7 | 55 (2055) | ihtShare | 0.06765643348 [0.03665874411, 0.07999608582] | 0 [0, 0] | -0.06765643348 | -100 | 0 | 0.02166867085 | [0.04598776263, 0.07999608582] | -0.04598776263 | fail | false |
| 5 | 256x60_s7 | 56 (2056) | population | 1419186 [1351622, 1455861] | 1512508 [1509841, 1530828] | 93322 | 6.575741305 | 14191.86 | 52119.5 | [1367066.5, 1455861] | -56647 | fail | false |
| 5 | 256x60_s7 | 56 (2056) | approval | 80.0662775 [79.06948717, 81.02231108] | 79.96302025 [79.64667757, 80.12204132] | -0.103257252 | -0.1289647218 | 0 | 0.9764119571 | [79.08986555, 81.02231108] | 0.8731547051 | pass | true |
| 5 | 256x60_s7 | 56 (2056) | air | 0.1563500001 [0.1542054697, 0.1861106634] | 0.1752732036 [0.1625869799, 0.1767352835] | 0.01892320353 | 12.10310426 | 0 | 0.01595259682 | [0.1542054697, 0.1723025969] | -0.002970606714 | fail | true |
| 5 | 256x60_s7 | 56 (2056) | ihtShare | 0.08384484785 [0.05593347797, 0.09675233074] | 0 [0, 0.01080099508] | -0.08384484785 | -100 | 0 | 0.02040942638 | [0.06343542147, 0.09675233074] | -0.06343542147 | fail | false |
| 5 | 256x60_s7 | 57 (2057) | population | 1418230 [1360384, 1470002] | 1526098 [1515651, 1542033] | 107868 | 7.60581852 | 14182.3 | 54809 | [1363421, 1470002] | -56096 | fail | false |
| 5 | 256x60_s7 | 57 (2057) | approval | 80.48260746 [79.25670151, 80.50791092] | 79.43480686 [79.25032538, 80.49995839] | -1.047800606 | -1.301896943 | 0 | 0.6256047058 | [79.85700276, 80.50791092] | -0.4221959003 | fail | true |
| 5 | 256x60_s7 | 57 (2057) | air | 0.1708420565 [0.1537251827, 0.1816357056] | 0.1827418837 [0.1663330575, 0.1827941754] | 0.01189982721 | 6.965396845 | 0 | 0.01395526147 | [0.156886795, 0.1816357056] | -0.001106178033 | fail | true |
| 5 | 256x60_s7 | 57 (2057) | ihtShare | 0.1102355994 [0.06957025131, 0.113108534] | 0 [0, 0.01073670992] | -0.1102355994 | -100 | 0 | 0.02176914135 | [0.08846645806, 0.113108534] | -0.08846645806 | fail | false |
| 5 | 256x60_s7 | 58 (2058) | population | 1442416 [1363572, 1488790] | 1535372 [1530344, 1564809] | 92956 | 6.444465397 | 14424.16 | 62609 | [1379807, 1488790] | -46582 | fail | true |
| 5 | 256x60_s7 | 58 (2058) | approval | 80.0913343 [79.76895612, 80.92687902] | 79.92231028 [79.44481888, 79.97806707] | -0.1690240242 | -0.2110390914 | 0 | 0.5789614534 | [79.76895612, 80.67029575] | 0.1533541593 | pass | true |
| 5 | 256x60_s7 | 58 (2058) | air | 0.1680511547 [0.1538286579, 0.1870111466] | 0.1768655615 [0.1703729598, 0.1776957211] | 0.008814406809 | 5.245073636 | 0 | 0.01659124434 | [0.1538286579, 0.184642399] | 0.00777683753 | pass | true |
| 5 | 256x60_s7 | 58 (2058) | ihtShare | 0.1231192589 [0.08384024956, 0.1290075199] | 0 [0, 0.01616813235] | -0.1231192589 | -100 | 0 | 0.02258363518 | [0.1005356238, 0.1290075199] | -0.1005356238 | fail | false |
| 5 | 256x60_s7 | 59 (2059) | population | 1447648 [1372983, 1504810] | 1542342 [1537000, 1579563] | 94694 | 6.541231017 | 14476.48 | 65913.5 | [1381734.5, 1504810] | -37532 | fail | true |
| 5 | 256x60_s7 | 59 (2059) | approval | 79.88367089 [79.44666304, 80.66228883] | 79.83410366 [78.52377686, 80.1401391] | -0.04956723722 | -0.06204927323 | 0 | 0.6078128925 | [79.44666304, 80.49148379] | 0.3874406159 | pass | true |
| 5 | 256x60_s7 | 59 (2059) | air | 0.169665794 [0.1561095287, 0.1851632801] | 0.1779202202 [0.1680361867, 0.1817474826] | 0.008254426186 | 4.86510922 | 0 | 0.01452687568 | [0.1561095287, 0.1841926697] | 0.006272449498 | pass | true |
| 5 | 256x60_s7 | 59 (2059) | ihtShare | 0.1228393709 [0.09390540347, 0.128900169] | 0 [0, 0.02165234183] | -0.1228393709 | -100 | 0 | 0.01749738274 | [0.1053419881, 0.128900169] | -0.1053419881 | fail | false |
| 5 | 256x60_s7 | 60 (2060) | population | 1461087 [1379922, 1513835] | 1545939 [1538720, 1595956] | 84852 | 5.807457051 | 14610.87 | 66956.5 | [1394130.5, 1513835] | -32104 | fail | true |
| 5 | 256x60_s7 | 60 (2060) | approval | 80.3574247 [79.73980132, 80.54140973] | 79.40225031 [79.22911343, 79.87547467] | -0.9551743827 | -1.188657285 | 0 | 0.4008042029 | [79.95662049, 80.54140973] | -0.5543701798 | fail | false |
| 5 | 256x60_s7 | 60 (2060) | air | 0.1671903774 [0.1583031651, 0.1832091934] | 0.1777455477 [0.1694576168, 0.1784102462] | 0.01055517029 | 6.313264229 | 0 | 0.01245301415 | [0.1583031651, 0.1796433916] | 0.001897843856 | pass | true |
| 5 | 256x60_s7 | 60 (2060) | ihtShare | 0.1261467211 [0.1023986676, 0.1376239046] | 0 [0, 0.02980662522] | -0.1261467211 | -100 | 0 | 0.01761261852 | [0.1085341026, 0.1376239046] | -0.1085341026 | fail | false |
| 5 | 256x60_s11 | 10 (2010) | population | 97010 [96079, 97480] | 79689 [73983, 90844] | -17321 | -17.85486032 | 970.1 | 970.1 | [96079, 97480] | -16390 | fail | false |
| 5 | 256x60_s11 | 10 (2010) | approval | 64.51316532 [63.07693914, 64.9457941] | 66.5220401 [65.27134256, 67.89609742] | 2.008874784 | 3.11389896 | 0 | 0.9344274793 | [63.57873784, 64.9457941] | -1.576246002 | fail | false |
| 5 | 256x60_s11 | 10 (2010) | air | 0.06535034949 [0.06064765631, 0.07417035988] | 0.06258650055 [0.05234112306, 0.08077487528] | -0.002763848944 | -4.229279515 | 0 | 0.006761351786 | [0.06064765631, 0.07211170128] | 0.001938844243 | pass | true |
| 5 | 256x60_s11 | 10 (2010) | ihtShare | 0 [0, 0] | 0 [0, 0.01809324983] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 11 (2011) | population | 111220 [110096, 111424] | 92940 [86565, 104820] | -18280 | -16.43589283 | 1112.2 | 1112.2 | [110107.8, 111424] | -17167.8 | fail | false |
| 5 | 256x60_s11 | 11 (2011) | approval | 63.40035286 [61.87578109, 64.04202902] | 65.34370423 [64.40034832, 66.91432063] | 1.943351372 | 3.065205925 | 0 | 1.083123963 | [62.3172289, 64.04202902] | -1.301675213 | fail | false |
| 5 | 256x60_s11 | 11 (2011) | air | 0.05930619274 [0.05585535923, 0.06455950736] | 0.07589041027 [0.07004441449, 0.08315196793] | 0.01658421753 | 27.96371975 | 0 | 0.004352074062 | [0.05585535923, 0.0636582668] | -0.01223214347 | fail | false |
| 5 | 256x60_s11 | 11 (2011) | ihtShare | 0 [0, 0] | 0 [0, 0.01805562069] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 12 (2012) | population | 126617 [125601, 127871] | 107063 [100493, 119061] | -19554 | -15.44342387 | 1266.17 | 1266.17 | [125601, 127871] | -18538 | fail | false |
| 5 | 256x60_s11 | 12 (2012) | approval | 62.74947787 [61.99241894, 63.56372661] | 65.02467143 [63.25756716, 65.49614024] | 2.275193563 | 3.625836645 | 0 | 0.7856538356 | [61.99241894, 63.5351317] | -1.489539727 | fail | false |
| 5 | 256x60_s11 | 12 (2012) | air | 0.0525824921 [0.0497127203, 0.05629496671] | 0.06926022685 [0.06047673394, 0.08366835406] | 0.01667773475 | 31.71727715 | 0 | 0.003291123205 | [0.0497127203, 0.0558736153] | -0.01338661155 | fail | false |
| 5 | 256x60_s11 | 12 (2012) | ihtShare | 0 [0, 0] | 0 [0, 0.01645613131] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 13 (2013) | population | 143996 [142480, 145099] | 122629 [114969, 136136] | -21367 | -14.83860663 | 1439.96 | 1439.96 | [142556.04, 145099] | -19927.04 | fail | false |
| 5 | 256x60_s11 | 13 (2013) | approval | 63.4843577 [62.40833624, 64.49076552] | 65.89376136 [64.76489802, 66.94910925] | 2.409403662 | 3.795271385 | 0 | 1.041214641 | [62.44314306, 64.49076552] | -1.40299584 | fail | false |
| 5 | 256x60_s11 | 13 (2013) | air | 0.05101842357 [0.04821648617, 0.0555974715] | 0.06165948152 [0.05650831432, 0.06796541906] | 0.01064105796 | 20.8572849 | 0 | 0.003690492664 | [0.04821648617, 0.05470891623] | -0.006950565291 | fail | false |
| 5 | 256x60_s11 | 13 (2013) | ihtShare | 0 [0, 0] | 0 [0, 0.01476598041] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 14 (2014) | population | 162893 [159429, 163214] | 138973 [131214, 152641] | -23920 | -14.68448614 | 1628.93 | 1892.5 | [161000.5, 163214] | -22027.5 | fail | false |
| 5 | 256x60_s11 | 14 (2014) | approval | 69.79220467 [64.80704387, 70.23553025] | 69.25251879 [67.46557949, 70.35934329] | -0.5396858818 | -0.7732753025 | 0 | 2.714243191 | [67.07796148, 70.23553025] | 0.9830114579 | pass | true |
| 5 | 256x60_s11 | 14 (2014) | air | 0.05225457552 [0.04624352531, 0.0554838653] | 0.05720197518 [0.05479344984, 0.06242301784] | 0.004947399661 | 9.467878384 | 0 | 0.004620169991 | [0.04763440553, 0.0554838653] | -0.001718109888 | fail | true |
| 5 | 256x60_s11 | 14 (2014) | ihtShare | 0 [0, 0] | 0 [0, 0.01346978969] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 15 (2015) | population | 181910 [178036, 182428] | 157017 [147647, 170157] | -24893 | -13.68423946 | 1819.1 | 2196 | [179714, 182428] | -22697 | fail | false |
| 5 | 256x60_s11 | 15 (2015) | approval | 70.2828252 [67.02157114, 71.14672034] | 70.34986661 [68.33142784, 70.71241139] | 0.06704141317 | 0.09538804535 | 0 | 2.062574601 | [68.2202506, 71.14672034] | 0.7968537302 | pass | true |
| 5 | 256x60_s11 | 15 (2015) | air | 0.05146711125 [0.04574636654, 0.05654868993] | 0.05533972107 [0.0520348554, 0.0592538409] | 0.003872609816 | 7.524435939 | 0 | 0.005401161693 | [0.04606594956, 0.05654868993] | 0.001208968856 | pass | true |
| 5 | 256x60_s11 | 15 (2015) | ihtShare | 0 [0, 0] | 0 [0, 0.009601660828] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 16 (2016) | population | 201032 [198931, 202147] | 174251 [165643, 190071] | -26781 | -13.32175972 | 2010.32 | 2010.32 | [199021.68, 202147] | -24770.68 | fail | false |
| 5 | 256x60_s11 | 16 (2016) | approval | 70.93092615 [70.40255001, 72.31156213] | 70.57875253 [70.37227042, 70.93486997] | -0.3521736276 | -0.4965022265 | 0 | 0.9545060629 | [70.40255001, 71.88543222] | 0.1762025198 | pass | true |
| 5 | 256x60_s11 | 16 (2016) | air | 0.05225743262 [0.04415267073, 0.0565367467] | 0.0527191022 [0.05016494113, 0.05990230422] | 0.0004616695762 | 0.8834524642 | 0 | 0.006192037982 | [0.04606539464, 0.0565367467] | 0.0038176445 | pass | true |
| 5 | 256x60_s11 | 16 (2016) | ihtShare | 0 [0, 0] | 0 [0, 0.006345909773] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 17 (2017) | population | 220264 [217743, 221560] | 193192 [184229, 208931] | -27072 | -12.2907057 | 2202.64 | 2202.64 | [218061.36, 221560] | -24869.36 | fail | false |
| 5 | 256x60_s11 | 17 (2017) | approval | 71.74620597 [70.17472352, 72.37161013] | 70.72769277 [69.86574547, 72.02765926] | -1.018513201 | -1.419605661 | 0 | 1.098443306 | [70.64776267, 72.37161013] | 0.07993010473 | pass | true |
| 5 | 256x60_s11 | 17 (2017) | air | 0.05730607325 [0.05038313857, 0.06288494318] | 0.05520374059 [0.04924829572, 0.06240115762] | -0.002102332658 | -3.668603585 | 0 | 0.006250902304 | [0.05105517094, 0.06288494318] | 0.004148569646 | pass | true |
| 5 | 256x60_s11 | 17 (2017) | ihtShare | 0 [0, 0] | 0 [0, 0.003812779385] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 18 (2018) | population | 240111 [238125, 242039] | 212383 [203449, 229426] | -27728 | -11.54799239 | 2401.11 | 2401.11 | [238125, 242039] | -25742 | fail | false |
| 5 | 256x60_s11 | 18 (2018) | approval | 72.68491844 [70.81756667, 73.15318316] | 70.93731682 [70.59349857, 71.08199269] | -1.747601622 | -2.404352456 | 0 | 1.167808246 | [71.5171102, 73.15318316] | -0.5797933754 | fail | true |
| 5 | 256x60_s11 | 18 (2018) | air | 0.05637508501 [0.05012809731, 0.06082287841] | 0.05845593826 [0.05227141991, 0.06566940013] | 0.002080853254 | 3.69108668 | 0 | 0.005347390548 | [0.05102769446, 0.06082287841] | 0.002366940144 | pass | true |
| 5 | 256x60_s11 | 18 (2018) | ihtShare | 0 [0, 0] | 0 [0, 0.008579068558] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 19 (2019) | population | 261751 [259674, 264481] | 232634 [221847, 250554] | -29117 | -11.12393076 | 2617.51 | 2617.51 | [259674, 264368.51] | -27040 | fail | false |
| 5 | 256x60_s11 | 19 (2019) | approval | 73.66968938 [72.03169892, 74.32395978] | 70.93337428 [70.56247236, 71.40672075] | -2.736315099 | -3.714302479 | 0 | 1.146130429 | [72.52355895, 74.32395978] | -1.59018467 | fail | false |
| 5 | 256x60_s11 | 19 (2019) | air | 0.05398893334 [0.05040153134, 0.05605219931] | 0.06100932274 [0.05926733011, 0.06866569924] | 0.007020389398 | 13.003386 | 0 | 0.002825333982 | [0.05116359936, 0.05605219931] | -0.004957123433 | fail | false |
| 5 | 256x60_s11 | 19 (2019) | ihtShare | 0 [0, 0] | 0 [0, 0.007990038394] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 20 (2020) | population | 284274 [281689, 287234] | 254154 [242068, 271736] | -30120 | -10.59541147 | 2842.74 | 2842.74 | [281689, 287116.74] | -27535 | fail | false |
| 5 | 256x60_s11 | 20 (2020) | approval | 76.16795867 [73.2030612, 76.44049195] | 71.71414678 [71.06100883, 72.3175127] | -4.453811897 | -5.847356257 | 0 | 1.618715374 | [74.5492433, 76.44049195] | -2.835096523 | fail | false |
| 5 | 256x60_s11 | 20 (2020) | air | 0.05237887456 [0.04962951098, 0.05571692536] | 0.05920299008 [0.05733593596, 0.06208409998] | 0.006824115526 | 13.02837372 | 0 | 0.003043707191 | [0.04962951098, 0.05542258175] | -0.003780408335 | fail | false |
| 5 | 256x60_s11 | 20 (2020) | ihtShare | 0 [0, 0] | 0 [0, 0.007786954323] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 21 (2021) | population | 307076 [303929, 310168] | 275468 [263589, 295273] | -31608 | -10.29321731 | 3070.76 | 3119.5 | [303956.5, 310168] | -28488.5 | fail | false |
| 5 | 256x60_s11 | 21 (2021) | approval | 76.9415584 [75.18406494, 77.75408367] | 72.82749147 [72.0655951, 72.89756174] | -4.114066929 | -5.347002341 | 0 | 1.285009362 | [75.65654904, 77.75408367] | -2.829057567 | fail | false |
| 5 | 256x60_s11 | 21 (2021) | air | 0.05236801726 [0.05065675113, 0.05720274841] | 0.05796303694 [0.05571870607, 0.06104371017] | 0.005595019685 | 10.68403957 | 0 | 0.003272998641 | [0.05065675113, 0.0556410159] | -0.002322021045 | fail | true |
| 5 | 256x60_s11 | 21 (2021) | ihtShare | 0 [0, 0] | 0 [0, 0.007665250863] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 22 (2022) | population | 331951 [327213, 333566] | 298497 [285844, 319012] | -33454 | -10.07799344 | 3319.51 | 3319.51 | [328631.49, 333566] | -30134.49 | fail | false |
| 5 | 256x60_s11 | 22 (2022) | approval | 77.35054465 [76.04791206, 77.48900359] | 75.50395855 [71.1393607, 76.24246782] | -1.8465861 | -2.387295537 | 0 | 0.7205457659 | [76.62999888, 77.48900359] | -1.126040334 | fail | false |
| 5 | 256x60_s11 | 22 (2022) | air | 0.05523368523 [0.05275935317, 0.05841344147] | 0.05666202655 [0.05509374157, 0.0601705106] | 0.001428341326 | 2.585996789 | 0 | 0.002827044148 | [0.05275935317, 0.05806072937] | 0.001398702821 | pass | true |
| 5 | 256x60_s11 | 22 (2022) | ihtShare | 0 [0, 0] | 0 [0, 0.007676713968] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 23 (2023) | population | 355340 [350807, 357155] | 322164 [308860, 342452] | -33176 | -9.336410199 | 3553.4 | 3553.4 | [351786.6, 357155] | -29622.6 | fail | false |
| 5 | 256x60_s11 | 23 (2023) | approval | 77.64335926 [76.28875672, 77.93360708] | 75.8099177 [74.52967799, 76.65363857] | -1.833441553 | -2.361362994 | 0 | 0.82242518 | [76.82093408, 77.93360708] | -1.011016373 | fail | false |
| 5 | 256x60_s11 | 23 (2023) | air | 0.06005253608 [0.05676927963, 0.06116426925] | 0.0567877594 [0.05522259997, 0.05993555661] | -0.00326477668 | -5.436534231 | 0 | 0.002197494809 | [0.05785504127, 0.06116426925] | -0.001067281871 | fail | true |
| 5 | 256x60_s11 | 23 (2023) | ihtShare | 0 [0, 0] | 0 [0, 0.007673653789] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 24 (2024) | population | 380475 [375374, 381880] | 345658 [332178, 365631] | -34817 | -9.150929759 | 3804.75 | 3804.75 | [376670.25, 381880] | -31012.25 | fail | false |
| 5 | 256x60_s11 | 24 (2024) | approval | 77.74143662 [76.46037695, 78.16919561] | 76.70895759 [75.79416011, 77.04431978] | -1.032479034 | -1.328093586 | 0 | 0.8544093308 | [76.88702729, 78.16919561] | -0.1780697028 | fail | true |
| 5 | 256x60_s11 | 24 (2024) | air | 0.06137736503 [0.05942750243, 0.06566557226] | 0.05990643386 [0.0556130646, 0.06599871564] | -0.001470931162 | -2.396536836 | 0 | 0.003119034916 | [0.05942750243, 0.06449639994] | 0.0004789314386 | pass | true |
| 5 | 256x60_s11 | 24 (2024) | ihtShare | 0 [0, 0] | 0 [0, 0.007677479394] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 25 (2025) | population | 405400 [400281, 406789] | 369705 [355541, 390459] | -35695 | -8.804884065 | 4054 | 4054 | [401346, 406789] | -31641 | fail | false |
| 5 | 256x60_s11 | 25 (2025) | approval | 77.18295067 [76.26400544, 78.00487489] | 76.89902027 [75.62420224, 77.24408694] | -0.2839304024 | -0.3678667373 | 0 | 0.8704347247 | [76.31251595, 78.00487489] | 0.5865043223 | pass | true |
| 5 | 256x60_s11 | 25 (2025) | air | 0.06295803103 [0.06173089776, 0.06688977435] | 0.0626719551 [0.06071367186, 0.06645370827] | -0.0002860759319 | -0.4543914846 | 0 | 0.002579438295 | [0.06173089776, 0.06553746932] | 0.0009410573373 | pass | true |
| 5 | 256x60_s11 | 25 (2025) | ihtShare | 0 [0, 0] | 0 [0, 0.007676713968] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 26 (2026) | population | 431885 [426244, 432624] | 395020 [380315, 416931] | -36865 | -8.535837086 | 4318.85 | 4318.85 | [427566.15, 432624] | -32546.15 | fail | false |
| 5 | 256x60_s11 | 26 (2026) | approval | 77.53477369 [77.25494353, 78.24462532] | 77.00924074 [75.63920089, 77.7192772] | -0.5255329546 | -0.6778029129 | 0 | 0.4948408959 | [77.25494353, 78.02961459] | -0.2457027922 | fail | true |
| 5 | 256x60_s11 | 26 (2026) | air | 0.06650752458 [0.06129593167, 0.06705069123] | 0.06303909661 [0.06246021204, 0.0711592513] | -0.003468427968 | -5.215091059 | 0 | 0.00287737978 | [0.0636301448, 0.06705069123] | -0.0005910481882 | fail | true |
| 5 | 256x60_s11 | 26 (2026) | ihtShare | 0 [0, 0] | 0 [0, 0.007676458859] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 27 (2027) | population | 459324 [454626, 460015] | 421716 [405212, 443932] | -37608 | -8.18768451 | 4593.24 | 4593.24 | [454730.76, 460015] | -33014.76 | fail | false |
| 5 | 256x60_s11 | 27 (2027) | approval | 77.59106086 [76.51653564, 78.20670063] | 77.07957755 [76.56620819, 77.40046395] | -0.5114833075 | -0.6592039106 | 0 | 0.8450824943 | [76.74597837, 78.20670063] | 0.3335991868 | pass | true |
| 5 | 256x60_s11 | 27 (2027) | air | 0.06574214381 [0.06158608725, 0.06960806194] | 0.06453363239 [0.06121678275, 0.07134673668] | -0.00120851142 | -1.838259829 | 0 | 0.004010987343 | [0.06173115647, 0.06960806194] | 0.002802475923 | pass | true |
| 5 | 256x60_s11 | 27 (2027) | ihtShare | 0 [0, 0] | 0 [0, 0.007674928567] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 28 (2028) | population | 488133 [484568, 489945] | 449068 [432786, 472021] | -39065 | -8.002941821 | 4881.33 | 4881.33 | [484568, 489945] | -35500 | fail | false |
| 5 | 256x60_s11 | 28 (2028) | approval | 78.13331267 [77.7653943, 80.15943041] | 77.26081564 [76.74886167, 77.86176605] | -0.872497026 | -1.116677376 | 0 | 1.197018053 | [77.7653943, 79.33033072] | -0.504578661 | fail | true |
| 5 | 256x60_s11 | 28 (2028) | air | 0.06303585149 [0.06110678851, 0.07163948255] | 0.06452864015 [0.06180086583, 0.07084441326] | 0.001492788661 | 2.368158161 | 0 | 0.005266347021 | [0.06110678851, 0.06830219851] | 0.00342185164 | pass | true |
| 5 | 256x60_s11 | 28 (2028) | ihtShare | 0 [0, 0] | 0 [0, 0.007668558908] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 29 (2029) | population | 518809 [515169, 520829] | 478054 [461060, 501010] | -40755 | -7.855492098 | 5188.09 | 5188.09 | [515169, 520829] | -37115 | fail | false |
| 5 | 256x60_s11 | 29 (2029) | approval | 79.59107519 [79.10365089, 81.60092264] | 77.64934074 [76.55716565, 78.30245863] | -1.941734448 | -2.439638418 | 0 | 1.248635875 | [79.10365089, 80.83971106] | -1.454310154 | fail | false |
| 5 | 256x60_s11 | 29 (2029) | air | 0.06797509411 [0.063640071, 0.07501475024] | 0.06599581397 [0.06569352408, 0.06877621614] | -0.001979280136 | -2.911772557 | 0 | 0.005687339622 | [0.063640071, 0.07366243373] | 0.002355742974 | pass | true |
| 5 | 256x60_s11 | 29 (2029) | ihtShare | 0 [0, 0] | 0 [0, 0.007611202636] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 30 (2030) | population | 549130 [545987, 551396] | 507548 [490400, 531451] | -41582 | -7.572341704 | 5491.3 | 5491.3 | [545987, 551396] | -38439 | fail | false |
| 5 | 256x60_s11 | 30 (2030) | approval | 81.44040119 [80.10150302, 81.63310176] | 77.96311083 [77.35245032, 80.19548441] | -3.477290362 | -4.269736287 | 0 | 0.7657993724 | [80.67460182, 81.63310176] | -2.71149099 | fail | false |
| 5 | 256x60_s11 | 30 (2030) | air | 0.06974128388 [0.0677812627, 0.07690397234] | 0.0679873094 [0.06703038473, 0.07286180164] | -0.001753974474 | -2.514973021 | 0 | 0.004561354817 | [0.0677812627, 0.07430263869] | 0.0002060467001 | pass | true |
| 5 | 256x60_s11 | 30 (2030) | ihtShare | 0 [0, 0] | 0 [0, 0.007140207715] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 31 (2031) | population | 579744 [577395, 582733] | 539750 [520584, 562400] | -39994 | -6.898562124 | 5797.44 | 5797.44 | [577395, 582733] | -37645 | fail | false |
| 5 | 256x60_s11 | 31 (2031) | approval | 81.89114661 [80.9234805, 82.22321433] | 79.71651949 [77.97306131, 81.45640992] | -2.174627114 | -2.655509421 | 0 | 0.6498669168 | [81.24127969, 82.22321433] | -1.524760197 | fail | false |
| 5 | 256x60_s11 | 31 (2031) | air | 0.07449274782 [0.0701001861, 0.0834208008] | 0.07164800295 [0.06941043877, 0.07480608421] | -0.002844744878 | -3.818821243 | 0 | 0.006660307351 | [0.0701001861, 0.08115305517] | 0.001547816845 | pass | true |
| 5 | 256x60_s11 | 31 (2031) | ihtShare | 0 [0, 0] | 0 [0, 0.007098518837] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 32 (2032) | population | 610615 [608730, 614845] | 570894 [551496, 593284] | -39721 | -6.505080943 | 6106.15 | 6106.15 | [608730, 614845] | -37836 | fail | false |
| 5 | 256x60_s11 | 32 (2032) | approval | 81.98163637 [81.53994577, 82.38683097] | 80.6621004 [79.12943793, 81.976905] | -1.319535969 | -1.60955066 | 0 | 0.4234426015 | [81.55819377, 82.38683097] | -0.8960933673 | fail | false |
| 5 | 256x60_s11 | 32 (2032) | air | 0.08001830361 [0.0724190333, 0.08589828281] | 0.07550049257 [0.07368023748, 0.07984082759] | -0.004517811039 | -5.645972028 | 0 | 0.006739624757 | [0.07327867886, 0.08589828281] | 0.002221813718 | pass | true |
| 5 | 256x60_s11 | 32 (2032) | ihtShare | 0 [0, 0] | 0 [0, 0.006970218159] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 33 (2033) | population | 643353 [641046, 647575] | 602691 [582890, 625356] | -40662 | -6.320324923 | 6433.53 | 6433.53 | [641046, 647575] | -38355 | fail | false |
| 5 | 256x60_s11 | 33 (2033) | approval | 82.23761924 [81.4447746, 83.17208614] | 81.56979157 [79.87445047, 82.51037373] | -0.6678276764 | -0.8120707804 | 0 | 0.8636557721 | [81.4447746, 83.10127501] | 0.1250169699 | pass | true |
| 5 | 256x60_s11 | 33 (2033) | air | 0.08373253689 [0.0757977681, 0.09083149239] | 0.07743401409 [0.07602352484, 0.08193678505] | -0.006298522804 | -7.522192731 | 0 | 0.007516862147 | [0.07621567475, 0.09083149239] | 0.001218339343 | pass | true |
| 5 | 256x60_s11 | 33 (2033) | ihtShare | 0 [0, 0] | 0 [0, 0.006738819686] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 34 (2034) | population | 675552 [671270, 679334] | 634827 [614389, 657308] | -40725 | -6.028403439 | 6755.52 | 6755.52 | [671270, 679334] | -36443 | fail | false |
| 5 | 256x60_s11 | 34 (2034) | approval | 82.13852936 [81.61488495, 82.96944983] | 82.06885687 [81.21337311, 83.09718764] | -0.06967249148 | -0.08482315428 | 0 | 0.6772824408 | [81.61488495, 82.8158118] | 0.4539719154 | pass | true |
| 5 | 256x60_s11 | 34 (2034) | air | 0.08674672979 [0.08272621183, 0.1017339747] | 0.08463124565 [0.07977047858, 0.09104013288] | -0.002115484138 | -2.438690361 | 0 | 0.009503881413 | [0.08272621183, 0.0962506112] | 0.001905033821 | pass | true |
| 5 | 256x60_s11 | 34 (2034) | ihtShare | 0 [0, 0] | 0 [0, 0.002119752237] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 35 (2035) | population | 708864 [705812, 713490] | 667812 [647549, 690961] | -41052 | -5.791237811 | 7088.64 | 7088.64 | [705812, 713490] | -38000 | fail | false |
| 5 | 256x60_s11 | 35 (2035) | approval | 82.72236631 [81.2325811, 82.89214726] | 82.39201611 [81.35413637, 82.96510758] | -0.3303502017 | -0.3993481043 | 0 | 0.8297830817 | [81.89258323, 82.89214726] | 0.49943288 | pass | true |
| 5 | 256x60_s11 | 35 (2035) | air | 0.09747635424 [0.08540472466, 0.1001168765] | 0.08744208662 [0.08429105412, 0.09331197982] | -0.01003426762 | -10.29405305 | 0 | 0.007356075896 | [0.09012027834, 0.1001168765] | -0.002678191724 | fail | true |
| 5 | 256x60_s11 | 35 (2035) | ihtShare | 0 [0, 0] | 0 [0, 0.002006776127] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 36 (2036) | population | 741622 [738362, 747427] | 701131 [679945, 724078] | -40491 | -5.459789488 | 7416.22 | 7416.22 | [738362, 747427] | -37231 | fail | false |
| 5 | 256x60_s11 | 36 (2036) | approval | 82.4672159 [81.85118079, 83.80687834] | 82.68511259 [81.75529892, 83.11437325] | 0.2178966874 | 0.2642221943 | 0 | 0.9778487743 | [81.85118079, 83.44506468] | 0.7599520868 | pass | true |
| 5 | 256x60_s11 | 36 (2036) | air | 0.1008104819 [0.09193023, 0.1074883004] | 0.0934854205 [0.09024419248, 0.09854477784] | -0.007325061373 | -7.26617038 | 0 | 0.007779035205 | [0.09303144667, 0.1074883004] | 0.0004539738313 | pass | true |
| 5 | 256x60_s11 | 36 (2036) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 37 (2037) | population | 776288 [773730, 781066] | 732614 [713331, 757658] | -43674 | -5.626004782 | 7762.88 | 7762.88 | [773730, 781066] | -41116 | fail | false |
| 5 | 256x60_s11 | 37 (2037) | approval | 82.3181607 [82.04106939, 83.14376412] | 82.47565666 [81.17131857, 83.71896494] | 0.1574959639 | 0.1913259025 | 0 | 0.5513473674 | [82.04106939, 82.86950807] | 0.3938514035 | pass | true |
| 5 | 256x60_s11 | 37 (2037) | air | 0.1034456881 [0.09815013697, 0.1137852842] | 0.09703657888 [0.09481648331, 0.1034424824] | -0.006409109171 | -6.195627185 | 0 | 0.007817573596 | [0.09815013697, 0.1112632616] | -0.001113558089 | fail | true |
| 5 | 256x60_s11 | 37 (2037) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 38 (2038) | population | 811907 [807517, 816651] | 766240 [747658, 791635] | -45667 | -5.624658982 | 8119.07 | 8119.07 | [807517, 816651] | -41277 | fail | false |
| 5 | 256x60_s11 | 38 (2038) | approval | 82.15921132 [81.4223369, 82.95403764] | 82.37043938 [80.70163295, 83.14037682] | 0.2112280613 | 0.2570960188 | 0 | 0.7658503678 | [81.4223369, 82.92506169] | 0.5546223064 | pass | true |
| 5 | 256x60_s11 | 38 (2038) | air | 0.108876402 [0.1021782978, 0.1192796154] | 0.1040808942 [0.1013021498, 0.1109144865] | -0.004795507798 | -4.404542866 | 0 | 0.008550658788 | [0.1021782978, 0.1174270608] | 0.001902596422 | pass | true |
| 5 | 256x60_s11 | 38 (2038) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 39 (2039) | population | 844940 [841049, 852303] | 800416 [782366, 827538] | -44524 | -5.269486591 | 8449.4 | 8449.4 | [841049, 852303] | -40633 | fail | false |
| 5 | 256x60_s11 | 39 (2039) | approval | 82.80909366 [81.73141645, 83.11019488] | 81.96796746 [81.32376294, 82.58776582] | -0.8411262001 | -1.015741343 | 0 | 0.6893892137 | [82.11970445, 83.11019488] | -0.1517369864 | fail | true |
| 5 | 256x60_s11 | 39 (2039) | air | 0.1172818654 [0.107450141, 0.1260569594] | 0.1119323079 [0.1066867548, 0.1136316845] | -0.005349557567 | -4.56128281 | 0 | 0.009303409177 | [0.1079784562, 0.1260569594] | 0.00395385161 | pass | true |
| 5 | 256x60_s11 | 39 (2039) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 40 (2040) | population | 880019 [878323, 889673] | 834909 [817002, 862908] | -45110 | -5.126025688 | 8800.19 | 8800.19 | [878323, 888819.19] | -43414 | fail | false |
| 5 | 256x60_s11 | 40 (2040) | approval | 82.8624901 [81.94548392, 83.0747486] | 81.59294319 [81.32163934, 82.62486347] | -1.269546913 | -1.532112916 | 0 | 0.564632337 | [82.29785776, 83.0747486] | -0.7049145759 | fail | false |
| 5 | 256x60_s11 | 40 (2040) | air | 0.1219509158 [0.1133072934, 0.1298870237] | 0.113328906 [0.1092145641, 0.1197793098] | -0.008622009781 | -7.070065631 | 0 | 0.008289865136 | [0.1136610506, 0.1298870237] | -0.0003321446448 | fail | true |
| 5 | 256x60_s11 | 40 (2040) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 41 (2041) | population | 914584 [913767, 924866] | 872331 [851991, 898943] | -42253 | -4.619914628 | 9145.84 | 9145.84 | [913767, 923729.84] | -41436 | fail | false |
| 5 | 256x60_s11 | 41 (2041) | approval | 82.18840328 [81.13102109, 82.73410334] | 82.31382633 [81.40240936, 82.96064381] | 0.1254230551 | 0.1526043214 | 0 | 0.8015411248 | [81.38686215, 82.73410334] | 0.4202770059 | pass | true |
| 5 | 256x60_s11 | 41 (2041) | air | 0.1241339084 [0.1238101216, 0.1426966907] | 0.1213239386 [0.1185090188, 0.1250713274] | -0.002809969793 | -2.263660131 | 0 | 0.009443284553 | [0.1238101216, 0.1335771929] | -0.002486182995 | fail | true |
| 5 | 256x60_s11 | 41 (2041) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 42 (2042) | population | 952007 [947049, 958822] | 907818 [888396, 935729] | -44189 | -4.641667551 | 9520.07 | 9520.07 | [947049, 958822] | -39231 | fail | false |
| 5 | 256x60_s11 | 42 (2042) | approval | 82.05408747 [81.58360699, 82.34373309] | 82.38636133 [81.74930947, 82.74840079] | 0.3322738632 | 0.4049449252 | 0 | 0.3800630526 | [81.67402442, 82.34373309] | -0.04262824024 | fail | true |
| 5 | 256x60_s11 | 42 (2042) | air | 0.1304500869 [0.1260867344, 0.1445750507] | 0.1269098816 [0.1218615336, 0.1299831392] | -0.003540205271 | -2.713838952 | 0 | 0.009244158141 | [0.1260867344, 0.1396942451] | 0.0008231471967 | pass | true |
| 5 | 256x60_s11 | 42 (2042) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 43 (2043) | population | 989261 [981631, 994389] | 945601 [923109, 970769] | -43660 | -4.413395454 | 9892.61 | 9892.61 | [981631, 994389] | -36030 | fail | false |
| 5 | 256x60_s11 | 43 (2043) | approval | 81.62380873 [81.00547299, 82.04536879] | 82.23019974 [81.46898545, 82.67089187] | 0.6063910108 | 0.7429094773 | 0 | 0.5199479028 | [81.10386082, 82.04536879] | -0.184830942 | fail | true |
| 5 | 256x60_s11 | 43 (2043) | air | 0.1354764254 [0.1297419765, 0.1466114374] | 0.1272641213 [0.1226224776, 0.1339626247] | -0.008212304098 | -6.061795678 | 0 | 0.008434730427 | [0.1297419765, 0.1439111558] | -0.002477855244 | fail | true |
| 5 | 256x60_s11 | 43 (2043) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 44 (2044) | population | 1030678 [1017766, 1031463] | 978657 [958138, 1009297] | -52021 | -5.047260153 | 10306.78 | 10306.78 | [1020371.22, 1031463] | -41714.22 | fail | false |
| 5 | 256x60_s11 | 44 (2044) | approval | 81.38859273 [80.85613817, 81.67388548] | 81.79526513 [80.90499605, 82.86986629] | 0.4066724051 | 0.4996675719 | 0 | 0.4088736571 | [80.97971907, 81.67388548] | -0.1213796511 | fail | true |
| 5 | 256x60_s11 | 44 (2044) | air | 0.1425945881 [0.127841465, 0.1533044999] | 0.1343551157 [0.1273787916, 0.1368416979] | -0.008239472468 | -5.778250476 | 0 | 0.01273151745 | [0.1298630707, 0.1533044999] | 0.004492044985 | pass | true |
| 5 | 256x60_s11 | 44 (2044) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 45 (2045) | population | 1068216 [1055287, 1072401] | 1013931 [994838, 1045852] | -54285 | -5.081837381 | 10682.16 | 10682.16 | [1057533.84, 1072401] | -43602.84 | fail | false |
| 5 | 256x60_s11 | 45 (2045) | approval | 80.94653094 [80.58265886, 81.36725251] | 81.57871689 [80.73508732, 82.2313696] | 0.6321859454 | 0.7809920178 | 0 | 0.3922968217 | [80.58265886, 81.33882776] | -0.2398891236 | fail | true |
| 5 | 256x60_s11 | 45 (2045) | air | 0.1432531656 [0.1347172314, 0.1582652729] | 0.1395877396 [0.1338942476, 0.1410092859] | -0.003665425992 | -2.558705056 | 0 | 0.01177402071 | [0.1347172314, 0.1550271863] | 0.00487050819 | pass | true |
| 5 | 256x60_s11 | 45 (2045) | ihtShare | 0 [0, 0] | 0 [0, 0.01242842213] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 46 (2046) | population | 1109143 [1094324, 1109943] | 1053071 [1030351, 1079698] | -56072 | -5.055434691 | 11091.43 | 11091.43 | [1098051.57, 1109943] | -44980.57 | fail | false |
| 5 | 256x60_s11 | 46 (2046) | approval | 81.02390851 [80.38641199, 81.39221442] | 80.59835369 [80.49890329, 82.15073015] | -0.4255548226 | -0.5252212963 | 0 | 0.5029012183 | [80.52100729, 81.39221442] | 0.07734639569 | pass | true |
| 5 | 256x60_s11 | 46 (2046) | air | 0.1519717894 [0.1357195976, 0.1599063541] | 0.1420274384 [0.1373714661, 0.1456627538] | -0.009944350954 | -6.543550612 | 0 | 0.01209337828 | [0.1398784111, 0.1599063541] | 0.002149027322 | pass | true |
| 5 | 256x60_s11 | 46 (2046) | ihtShare | 0 [0, 0] | 0 [0, 0.02273938533] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 47 (2047) | population | 1144048 [1132339, 1151307] | 1088689 [1072294, 1116051] | -55359 | -4.838870397 | 11440.48 | 11440.48 | [1132607.52, 1151307] | -43918.52 | fail | false |
| 5 | 256x60_s11 | 47 (2047) | approval | 80.57747308 [79.54124608, 81.87627023] | 81.21925959 [80.40933599, 81.49533153] | 0.641786513 | 0.7964837919 | 0 | 1.167512076 | [79.54124608, 81.74498516] | 0.5257255631 | pass | true |
| 5 | 256x60_s11 | 47 (2047) | air | 0.1571084706 [0.1384097742, 0.1691387619] | 0.1461831566 [0.141799927, 0.151081393] | -0.01092531396 | -6.953994218 | 0 | 0.01536449385 | [0.1417439767, 0.1691387619] | 0.004439179892 | pass | true |
| 5 | 256x60_s11 | 47 (2047) | ihtShare | 0 [0, 0] | 0 [0, 0.03418634033] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 48 (2048) | population | 1186527 [1169316, 1187525] | 1128831 [1107154, 1154533] | -57696 | -4.862594783 | 11865.27 | 11865.27 | [1174661.73, 1187525] | -45830.73 | fail | false |
| 5 | 256x60_s11 | 48 (2048) | approval | 80.48172881 [79.77912608, 81.47825416] | 80.6347039 [79.63566392, 81.62662912] | 0.1529750906 | 0.1900743098 | 0 | 0.8495640398 | [79.77912608, 81.33129285] | 0.6965889492 | pass | true |
| 5 | 256x60_s11 | 48 (2048) | air | 0.1571493191 [0.1425966385, 0.1718086539] | 0.14793865 [0.1382834524, 0.1580500036] | -0.0092106691 | -5.861093866 | 0 | 0.01460600772 | [0.1425966385, 0.1717553268] | 0.005342011518 | pass | true |
| 5 | 256x60_s11 | 48 (2048) | ihtShare | 0 [0, 0] | 0 [0, 0.05331081896] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 49 (2049) | population | 1225495 [1209924, 1233587] | 1169593 [1145695, 1177519] | -55902 | -4.561585319 | 12254.95 | 12254.95 | [1213240.05, 1233587] | -43647.05 | fail | false |
| 5 | 256x60_s11 | 49 (2049) | approval | 80.27118687 [79.83050167, 81.24841213] | 80.64222179 [79.5877949, 81.16871253] | 0.3710349172 | 0.4622267736 | 0 | 0.7089552314 | [79.83050167, 80.9801421] | 0.3379203142 | pass | true |
| 5 | 256x60_s11 | 49 (2049) | air | 0.1545464397 [0.1455525995, 0.173847097] | 0.1532765022 [0.1425714845, 0.1588374594] | -0.001269937518 | -0.8217190381 | 0 | 0.01414724875 | [0.1455525995, 0.1686936885] | 0.007723902703 | pass | true |
| 5 | 256x60_s11 | 49 (2049) | ihtShare | 0 [0, 0] | 0 [0, 0.05684687652] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 50 (2050) | population | 1262250 [1254073, 1272103] | 1197251 [1187658, 1221436] | -64999 | -5.149455338 | 12622.5 | 12622.5 | [1254073, 1272103] | -56822 | fail | false |
| 5 | 256x60_s11 | 50 (2050) | approval | 80.43833238 [79.83074281, 80.94993641] | 80.83804636 [80.16143895, 81.89020439] | 0.3997139857 | 0.4969197818 | 0 | 0.5595968013 | [79.87873557, 80.94993641] | 0.1118900476 | pass | true |
| 5 | 256x60_s11 | 50 (2050) | air | 0.1661781832 [0.1406264164, 0.1742082937] | 0.1599630872 [0.14100933, 0.1638457838] | -0.006215095998 | -3.740019224 | 0 | 0.01679093868 | [0.1493872445, 0.1742082937] | 0.01057584268 | pass | true |
| 5 | 256x60_s11 | 50 (2050) | ihtShare | 0 [0, 0] | 0 [0, 0.06768889881] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 5 | 256x60_s11 | 51 (2051) | population | 1307156 [1295571, 1313026] | 1234799 [1201219, 1267951] | -72357 | -5.53545254 | 13071.56 | 13071.56 | [1295571, 1313026] | -60772 | fail | false |
| 5 | 256x60_s11 | 51 (2051) | approval | 80.3679574 [79.66337622, 80.64145771] | 80.7772821 [79.84278647, 81.48178976] | 0.4093246975 | 0.5093133018 | 0 | 0.4890407411 | [79.87891666, 80.64145771] | -0.1358243927 | fail | true |
| 5 | 256x60_s11 | 51 (2051) | air | 0.1658588234 [0.1464726793, 0.1751268429] | 0.1619108579 [0.1441335073, 0.1655375552] | -0.003947965498 | -2.380316836 | 0 | 0.01432708183 | [0.1515317416, 0.1751268429] | 0.01037911633 | pass | true |
| 5 | 256x60_s11 | 51 (2051) | ihtShare | 0.001291821468 [0, 0.01001936682] | 0 [0, 0.07401259949] | -0.001291821468 | -100 | 0 | 0.005009683412 | [0, 0.00630150488] | 0 | pass | true |
| 5 | 256x60_s11 | 52 (2052) | population | 1352531 [1335822, 1354608] | 1280413 [1216389, 1310290] | -72118 | -5.332077416 | 13525.31 | 13525.31 | [1339005.69, 1354608] | -58592.69 | fail | false |
| 5 | 256x60_s11 | 52 (2052) | approval | 80.42325971 [79.59390783, 80.72519232] | 80.52580911 [80.06031243, 81.55628244] | 0.1025493948 | 0.1275121093 | 0 | 0.5656422459 | [79.85761746, 80.72519232] | 0.1993832133 | pass | true |
| 5 | 256x60_s11 | 52 (2052) | air | 0.1667704113 [0.1438624046, 0.1808752239] | 0.1625080917 [0.1489940825, 0.1657150643] | -0.004262319673 | -2.555800899 | 0 | 0.01850640963 | [0.1482640017, 0.1808752239] | 0.01424408996 | pass | true |
| 5 | 256x60_s11 | 52 (2052) | ihtShare | 0.005202820997 [0, 0.01089103103] | 0 [0, 0.08120938615] | -0.005202820997 | -100 | 0 | 0.005445515515 | [0, 0.01064833651] | 0 | pass | true |
| 5 | 256x60_s11 | 53 (2053) | population | 1387290 [1372356, 1392815] | 1320739 [1217398, 1337971] | -66551 | -4.79719453 | 13872.9 | 13872.9 | [1373417.1, 1392815] | -52678.1 | fail | false |
| 5 | 256x60_s11 | 53 (2053) | approval | 80.64803937 [79.31384766, 81.17715498] | 80.17445852 [80.14346416, 80.23402131] | -0.4735808499 | -0.587219297 | 0 | 0.9316536605 | [79.71638571, 81.17715498] | 0.4580728107 | pass | true |
| 5 | 256x60_s11 | 53 (2053) | air | 0.1635105973 [0.1428250091, 0.17666175] | 0.1625194937 [0.1428539779, 0.1688717063] | -0.0009911036624 | -0.6061403227 | 0 | 0.01691837045 | [0.1465922269, 0.17666175] | 0.0141422563 | pass | true |
| 5 | 256x60_s11 | 53 (2053) | ihtShare | 0.01610534701 [0, 0.02446134708] | 0.005919567513 [0, 0.09264062421] | -0.0101857795 | -63.24470682 | 0 | 0.01223067354 | [0.003874673472, 0.02446134708] | 0.002044894041 | pass | true |
| 5 | 256x60_s11 | 54 (2054) | population | 1401401 [1388950, 1440737] | 1359119 [1226920, 1371406] | -42282 | -3.017123578 | 14014.01 | 25893.5 | [1388950, 1427294.5] | -29831 | fail | false |
| 5 | 256x60_s11 | 54 (2054) | approval | 80.23384638 [79.70134958, 80.42361043] | 79.89415134 [79.43637519, 80.43732718] | -0.3396950343 | -0.4233812159 | 0 | 0.3611304216 | [79.87271596, 80.42361043] | 0.02143538725 | pass | true |
| 5 | 256x60_s11 | 54 (2054) | air | 0.1643790088 [0.1433599574, 0.1753004816] | 0.1632577898 [0.147062217, 0.1694265447] | -0.001121218974 | -0.6820937674 | 0 | 0.0159702621 | [0.1484087467, 0.1753004816] | 0.01204269176 | pass | true |
| 5 | 256x60_s11 | 54 (2054) | ihtShare | 0.02879834579 [0, 0.03162642268] | 0.01114565668 [0, 0.1022132939] | -0.01765268911 | -61.29758021 | 0 | 0.01581321134 | [0.01298513445, 0.03162642268] | -0.001839477766 | fail | true |
| 5 | 256x60_s11 | 55 (2055) | population | 1426671 [1386414, 1464302] | 1381428 [1225951, 1403017] | -45243 | -3.171228686 | 14266.71 | 38944 | [1387727, 1464302] | -6299 | fail | true |
| 5 | 256x60_s11 | 55 (2055) | approval | 80.41300596 [79.9308202, 80.9548984] | 79.8924593 [79.23363805, 80.38380994] | -0.5205466547 | -0.6473413703 | 0 | 0.5120391013 | [79.9308202, 80.92504506] | -0.03836089319 | fail | true |
| 5 | 256x60_s11 | 55 (2055) | air | 0.1693146158 [0.1448856511, 0.1840435431] | 0.1627324087 [0.1466252411, 0.1689142314] | -0.00658220712 | -3.887559907 | 0 | 0.01957894595 | [0.1497356698, 0.1840435431] | 0.01299673883 | pass | true |
| 5 | 256x60_s11 | 55 (2055) | ihtShare | 0.02858932898 [0, 0.04062968787] | 0.01929487241 [0, 0.1180151349] | -0.00929445657 | -32.51022987 | 0 | 0.02031484393 | [0.008274485051, 0.04062968787] | 0.01102038736 | pass | true |
| 5 | 256x60_s11 | 56 (2056) | population | 1444001 [1400344, 1476049] | 1398899 [1236771, 1421930] | -45102 | -3.123405039 | 14440.01 | 37852.5 | [1406148.5, 1476049] | -7249.5 | fail | true |
| 5 | 256x60_s11 | 56 (2056) | approval | 80.34134967 [80.24744558, 80.42085278] | 80.11515404 [79.30924045, 80.79695324] | -0.2261956254 | -0.2815432232 | 0 | 0.08670360305 | [80.25464606, 80.42085278] | -0.1394920224 | fail | false |
| 5 | 256x60_s11 | 56 (2056) | air | 0.1678335233 [0.1447515442, 0.1794281601] | 0.1630822547 [0.1459777422, 0.1720514777] | -0.004751268624 | -2.830941358 | 0 | 0.01733830792 | [0.1504952154, 0.1794281601] | 0.0125870393 | pass | true |
| 5 | 256x60_s11 | 56 (2056) | ihtShare | 0.04326690635 [0, 0.04940308648] | 0.02424374692 [0, 0.1288274532] | -0.01902315944 | -43.96699705 | 0 | 0.02470154324 | [0.01856536311, 0.04940308648] | 0.005678383801 | pass | true |
| 5 | 256x60_s11 | 57 (2057) | population | 1456317 [1403945, 1487877] | 1411981 [1261215, 1448111] | -44336 | -3.044392121 | 14563.17 | 41966 | [1414351, 1487877] | -2370 | fail | true |
| 5 | 256x60_s11 | 57 (2057) | approval | 80.12555661 [79.07665525, 81.11718024] | 80.37110753 [80.05613526, 80.65700486] | 0.2455509248 | 0.3064576837 | 0 | 1.020262495 | [79.10529411, 81.11718024] | 0.7460727061 | pass | true |
| 5 | 256x60_s11 | 57 (2057) | air | 0.1732706725 [0.1459097469, 0.1865505337] | 0.1613325229 [0.1436090334, 0.1691317244] | -0.01193814964 | -6.889884747 | 0 | 0.02032039338 | [0.1529502791, 0.1865505337] | 0.008382243741 | pass | true |
| 5 | 256x60_s11 | 57 (2057) | ihtShare | 0.05472910769 [0, 0.06055944415] | 0.03752211775 [0, 0.1374310253] | -0.01720698994 | -31.44028958 | 0 | 0.03027972207 | [0.02444938562, 0.06055944415] | 0.01307273213 | pass | true |
| 5 | 256x60_s11 | 58 (2058) | population | 1462768 [1414561, 1491046] | 1419563 [1263833, 1461402] | -43205 | -2.953646785 | 14627.68 | 38242.5 | [1424525.5, 1491046] | -4962.5 | fail | true |
| 5 | 256x60_s11 | 58 (2058) | approval | 80.0537241 [79.51884343, 80.79838335] | 80.12508533 [78.10998851, 81.10967373] | 0.07136123202 | 0.08914167683 | 0 | 0.6397699602 | [79.51884343, 80.69349406] | 0.5684087281 | pass | true |
| 5 | 256x60_s11 | 58 (2058) | air | 0.1701780575 [0.1424713535, 0.1822657263] | 0.165947198 [0.1420376789, 0.1748627555] | -0.004230859469 | -2.486136891 | 0 | 0.01989718637 | [0.1502808711, 0.1822657263] | 0.0156663269 | pass | true |
| 5 | 256x60_s11 | 58 (2058) | ihtShare | 0.05874456499 [0, 0.07624538554] | 0.04287806789 [0, 0.1483255116] | -0.0158664971 | -27.00930223 | 0 | 0.03812269277 | [0.02062187222, 0.07624538554] | 0.02225619567 | pass | true |
| 5 | 256x60_s11 | 59 (2059) | population | 1482680 [1416617, 1504106] | 1424104 [1269752, 1474310] | -58576 | -3.950683897 | 14826.8 | 43744.5 | [1438935.5, 1504106] | -14831.5 | fail | true |
| 5 | 256x60_s11 | 59 (2059) | approval | 80.01321869 [79.69065754, 80.75401766] | 80.11640835 [79.27931935, 80.77079714] | 0.1031896629 | 0.1289657692 | 0 | 0.531680062 | [79.69065754, 80.54489875] | 0.4257508135 | pass | true |
| 5 | 256x60_s11 | 59 (2059) | air | 0.1626696819 [0.1473044973, 0.1829738232] | 0.1653323835 [0.1396811971, 0.1766184017] | 0.002662701554 | 1.636876351 | 0 | 0.01783466296 | [0.1473044973, 0.1805043449] | 0.01517196141 | pass | true |
| 5 | 256x60_s11 | 59 (2059) | ihtShare | 0.07226376726 [0, 0.09103632444] | 0.05913673209 [0, 0.1485972794] | -0.01312703517 | -18.16544538 | 0 | 0.04551816222 | [0.02674560504, 0.09103632444] | 0.03189959235 | pass | true |
| 5 | 256x60_s11 | 60 (2060) | population | 1483518 [1427340, 1503201] | 1433346 [1276729, 1494630] | -50172 | -3.381960987 | 14835.18 | 37930.5 | [1445587.5, 1503201] | -12241.5 | fail | true |
| 5 | 256x60_s11 | 60 (2060) | approval | 80.44119872 [79.13716727, 81.35669456] | 80.08316611 [79.39118216, 81.15688928] | -0.3580326172 | -0.4450861286 | 0 | 1.109763647 | [79.33143508, 81.35669456] | 0.7517310294 | pass | true |
| 5 | 256x60_s11 | 60 (2060) | air | 0.1715168853 [0.1474850575, 0.1825615946] | 0.1688134834 [0.1407599336, 0.1732435945] | -0.002703401962 | -1.57617249 | 0 | 0.01753826856 | [0.1539786168, 0.1825615946] | 0.0137481112 | pass | true |
| 5 | 256x60_s11 | 60 (2060) | ihtShare | 0.08191000329 [0, 0.1032515065] | 0.07530865185 [0, 0.1492415482] | -0.006601351436 | -8.059273801 | 0 | 0.05162575324 | [0.03028425005, 0.1032515065] | 0.02794285463 | pass | true |
| 9 | 128x15_s7 | 10 (2010) | population | 100141 [96401, 101380] | 102165 [102092, 103294] | 2024 | 2.021150178 | 1001.41 | 2489.5 | [97651.5, 101380] | -785 | fail | true |
| 9 | 128x15_s7 | 10 (2010) | approval | 70.85188531 [69.04017356, 72.44259047] | 71.33999781 [69.83795833, 71.80107469] | 0.4881124948 | 0.6889195576 | 0 | 1.701208457 | [69.15067685, 72.44259047] | 1.102592664 | pass | true |
| 9 | 128x15_s7 | 10 (2010) | air | 0.07249853617 [0.06917694603, 0.0744802871] | 0.07402969375 [0.07285792937, 0.07562182856] | 0.001531157584 | 2.111984138 | 0 | 0.002651670536 | [0.06984686563, 0.0744802871] | 0.0004505933489 | pass | true |
| 9 | 128x15_s7 | 10 (2010) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 128x15_s7 | 11 (2011) | population | 116914 [113300, 118282] | 119615 [118396, 120191] | 2701 | 2.310245137 | 1169.14 | 2491 | [114423, 118282] | -1333 | fail | true |
| 9 | 128x15_s7 | 11 (2011) | approval | 73.47090005 [72.92696927, 75.22527722] | 73.39940656 [71.00021258, 73.78944156] | -0.07149349345 | -0.09730858531 | 0 | 1.149153975 | [72.92696927, 74.62005403] | 0.4724372902 | pass | true |
| 9 | 128x15_s7 | 11 (2011) | air | 0.074557472 [0.07347336417, 0.07641983898] | 0.0760101892 [0.0718841149, 0.07731134325] | 0.001452717204 | 1.948452871 | 0 | 0.001473237404 | [0.07347336417, 0.0760307094] | 0.00002052020008 | pass | true |
| 9 | 128x15_s7 | 11 (2011) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 128x15_s7 | 12 (2012) | population | 134932 [131160, 136360] | 137855 [136410, 138467] | 2923 | 2.166276347 | 1349.32 | 2600 | [132332, 136360] | -1495 | fail | true |
| 9 | 128x15_s7 | 12 (2012) | approval | 75.29595627 [75.01476029, 76.99547539] | 74.76036377 [74.70784549, 75.32003238] | -0.535592499 | -0.7113164179 | 0 | 0.990357551 | [75.01476029, 76.28631382] | -0.2543965199 | fail | true |
| 9 | 128x15_s7 | 12 (2012) | air | 0.07219251076 [0.07080482714, 0.07374932448] | 0.07219713044 [0.07005374158, 0.07527040826] | 0.000004619677699 | 0.00639910934 | 0 | 0.001472248668 | [0.07080482714, 0.07366475943] | 0.001392303303 | pass | true |
| 9 | 128x15_s7 | 12 (2012) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 128x15_s7 | 13 (2013) | population | 153902 [149266, 154998] | 155852 [154833, 157039] | 1950 | 1.267040064 | 1539.02 | 2866 | [151036, 154998] | -854 | fail | true |
| 9 | 128x15_s7 | 13 (2013) | approval | 76.93078279 [76.32924201, 78.13889513] | 76.47527223 [76.27625402, 76.93464947] | -0.4555105582 | -0.5921044108 | 0 | 0.9048265571 | [76.32924201, 77.83560935] | 0.1460302188 | pass | true |
| 9 | 128x15_s7 | 13 (2013) | air | 0.07877140413 [0.07657169713, 0.08011750603] | 0.07841978535 [0.07476398504, 0.08068026598] | -0.0003516187775 | -0.4463787099 | 0 | 0.00177290445 | [0.07699849968, 0.08011750603] | 0.001421285672 | pass | true |
| 9 | 128x15_s7 | 13 (2013) | ihtShare | 0 [0, 0.007137883008] | 0 [0, 0.01031102813] | 0 | 0 | 0 | 0.003568941504 | [0, 0.003568941504] | 0 | pass | true |
| 9 | 128x15_s7 | 14 (2014) | population | 172301 [168028, 173724] | 175308 [174385, 177225] | 3007 | 1.745201711 | 1723.01 | 2848 | [169453, 173724] | -1584 | fail | true |
| 9 | 128x15_s7 | 14 (2014) | approval | 78.56568623 [77.61503346, 79.40495126] | 77.71170729 [77.26052208, 78.52780918] | -0.8539789383 | -1.086961725 | 0 | 0.8949589018 | [77.67072733, 79.40495126] | 0.04097996349 | pass | true |
| 9 | 128x15_s7 | 14 (2014) | air | 0.08538606651 [0.08332830457, 0.08724739085] | 0.08408397143 [0.08159387748, 0.08846843246] | -0.001302095079 | -1.524950302 | 0 | 0.001959543139 | [0.08342652337, 0.08724739085] | 0.0006574480603 | pass | true |
| 9 | 128x15_s7 | 14 (2014) | ihtShare | 0 [0, 0.003328539141] | 0 [0, 0.0103062302] | 0 | 0 | 0 | 0.001664269571 | [0, 0.001664269571] | 0 | pass | true |
| 9 | 128x15_s7 | 15 (2015) | population | 191588 [187528, 193454] | 195129 [193968, 196477] | 3541 | 1.848236842 | 1915.88 | 2963 | [188625, 193454] | -1675 | fail | true |
| 9 | 128x15_s7 | 15 (2015) | approval | 80.9060989 [78.82921769, 81.55629987] | 80.17311851 [78.86648005, 81.00064779] | -0.7329803945 | -0.9059643271 | 0 | 1.36354109 | [79.54255781, 81.55629987] | 0.6305606953 | pass | true |
| 9 | 128x15_s7 | 15 (2015) | air | 0.09287306661 [0.09088359244, 0.09649320183] | 0.09217962039 [0.08927761041, 0.0951341412] | -0.0006934462219 | -0.7466601967 | 0 | 0.002804804697 | [0.09088359244, 0.09567787131] | 0.001296027956 | pass | true |
| 9 | 128x15_s7 | 15 (2015) | ihtShare | 0 [0, 0.003328265604] | 0 [0, 0.01043030277] | 0 | 0 | 0 | 0.001664132802 | [0, 0.001664132802] | 0 | pass | true |
| 9 | 256x60_s7 | 10 (2010) | population | 99145 [96440, 99363] | 98127 [97083, 99539] | -1018 | -1.02677896 | 991.45 | 1461.5 | [97683.5, 99363] | 443.5 | pass | true |
| 9 | 256x60_s7 | 10 (2010) | approval | 63.85190454 [62.17693823, 64.77944446] | 63.48732348 [61.93684433, 64.10195343] | -0.3645810567 | -0.570979142 | 0 | 1.301253115 | [62.55065142, 64.77944446] | 0.936672058 | pass | true |
| 9 | 256x60_s7 | 10 (2010) | air | 0.07043823962 [0.06817482578, 0.08026279463] | 0.0812159745 [0.0712630056, 0.08477644047] | 0.01077773488 | 15.30097137 | 0 | 0.006043984427 | [0.06817482578, 0.07648222405] | -0.004733750452 | fail | true |
| 9 | 256x60_s7 | 10 (2010) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 11 (2011) | population | 112884 [109928, 113636] | 112065 [110666, 113619] | -819 | -0.7255235463 | 1128.84 | 1854 | [111030, 113636] | 1035 | pass | true |
| 9 | 256x60_s7 | 11 (2011) | approval | 62.11639746 [61.1707493, 63.22293323] | 61.40390008 [58.25466701, 62.99313654] | -0.7124973835 | -1.147035908 | 0 | 1.026091964 | [61.1707493, 63.14248943] | 0.2331507793 | pass | true |
| 9 | 256x60_s7 | 11 (2011) | air | 0.06948792381 [0.05869429512, 0.08134973498] | 0.0656760141 [0.06476713863, 0.07431033476] | -0.003811909705 | -5.485715354 | 0 | 0.01132771993 | [0.05869429512, 0.08081564374] | 0.006981718987 | pass | true |
| 9 | 256x60_s7 | 11 (2011) | ihtShare | 0 [0, 0.017683709] | 0 [0, 0] | 0 | 0 | 0 | 0.008841854499 | [0, 0.008841854499] | 0 | pass | true |
| 9 | 256x60_s7 | 12 (2012) | population | 129086 [126172, 130667] | 128682 [127008, 130538] | -404 | -0.3129696481 | 1290.86 | 2247.5 | [126838.5, 130667] | 1843.5 | pass | true |
| 9 | 256x60_s7 | 12 (2012) | approval | 62.57990824 [61.05141453, 68.09720923] | 63.90477768 [59.97664103, 65.17028946] | 1.32486944 | 2.117084345 | 0 | 3.52289735 | [61.05141453, 66.10280559] | 2.19802791 | pass | true |
| 9 | 256x60_s7 | 12 (2012) | air | 0.05572988735 [0.05356245451, 0.05905572116] | 0.05803879589 [0.0577824806, 0.06107057729] | 0.002308908535 | 4.143034636 | 0 | 0.002746633324 | [0.05356245451, 0.05847652068] | 0.0004377247882 | pass | true |
| 9 | 256x60_s7 | 12 (2012) | ihtShare | 0 [0, 0.01585102482] | 0 [0, 0] | 0 | 0 | 0 | 0.007925512408 | [0, 0.007925512408] | 0 | pass | true |
| 9 | 256x60_s7 | 13 (2013) | population | 145600 [143285, 147798] | 145359 [143353, 146121] | -241 | -0.165521978 | 1456 | 2256.5 | [143343.5, 147798] | 2015.5 | pass | true |
| 9 | 256x60_s7 | 13 (2013) | approval | 64.75590584 [62.28396953, 70.66533059] | 66.28616827 [63.4040757, 68.1113973] | 1.530262435 | 2.363124127 | 0 | 4.190680534 | [62.28396953, 68.94658637] | 2.660418099 | pass | true |
| 9 | 256x60_s7 | 13 (2013) | air | 0.05574792928 [0.05208979383, 0.06027168235] | 0.0573327975 [0.05429337049, 0.0663630095] | 0.001584868221 | 2.842918547 | 0 | 0.00409094426 | [0.05208979383, 0.05983887354] | 0.00250607604 | pass | true |
| 9 | 256x60_s7 | 13 (2013) | ihtShare | 0 [0, 0.01411850768] | 0 [0, 0] | 0 | 0 | 0 | 0.007059253841 | [0, 0.007059253841] | 0 | pass | true |
| 9 | 256x60_s7 | 14 (2014) | population | 162743 [160481, 164908] | 162387 [160699, 163260] | -356 | -0.218749808 | 1627.43 | 2213.5 | [160529.5, 164908] | 1857.5 | pass | true |
| 9 | 256x60_s7 | 14 (2014) | approval | 66.18562745 [63.60599158, 70.42877756] | 67.90068315 [64.61503371, 69.16602264] | 1.715055699 | 2.591281166 | 0 | 3.411392989 | [63.60599158, 69.59702044] | 1.69633729 | pass | true |
| 9 | 256x60_s7 | 14 (2014) | air | 0.05746915865 [0.05047842086, 0.06011290272] | 0.05575635025 [0.05156644214, 0.05900704131] | -0.001712808393 | -2.980395805 | 0 | 0.004817240927 | [0.05265191772, 0.06011290272] | 0.003104432534 | pass | true |
| 9 | 256x60_s7 | 14 (2014) | ihtShare | 0 [0, 0.007912753294] | 0 [0, 0] | 0 | 0 | 0 | 0.003956376647 | [0, 0.003956376647] | 0 | pass | true |
| 9 | 256x60_s7 | 15 (2015) | population | 181682 [179070, 184286] | 181527 [178050, 182544] | -155 | -0.08531390011 | 1816.82 | 2608 | [179074, 184286] | 2453 | pass | true |
| 9 | 256x60_s7 | 15 (2015) | approval | 69.00507629 [64.57202938, 71.44771849] | 69.30217723 [66.02420327, 70.97182444] | 0.2971009487 | 0.4305494098 | 0 | 3.437844558 | [65.56723173, 71.44771849] | 2.14554126 | pass | true |
| 9 | 256x60_s7 | 15 (2015) | air | 0.05632347203 [0.04940233449, 0.06048279489] | 0.05466021243 [0.04969213884, 0.06258974207] | -0.001663259601 | -2.953048775 | 0 | 0.005540230201 | [0.05078324183, 0.06048279489] | 0.003876970601 | pass | true |
| 9 | 256x60_s7 | 15 (2015) | ihtShare | 0 [0, 0.007292235536] | 0 [0, 0] | 0 | 0 | 0 | 0.003646117768 | [0, 0.003646117768] | 0 | pass | true |
| 9 | 256x60_s7 | 16 (2016) | population | 200727 [198438, 203611] | 200813 [199049, 201278] | 86 | 0.04284426111 | 2007.27 | 2586.5 | [198438, 203313.5] | 2375 | pass | true |
| 9 | 256x60_s7 | 16 (2016) | approval | 69.99510355 [66.07328521, 71.47326263] | 70.22464945 [69.43802512, 71.03458549] | 0.2295459056 | 0.3279456619 | 0 | 2.699988713 | [67.29511483, 71.47326263] | 1.248613181 | pass | true |
| 9 | 256x60_s7 | 16 (2016) | air | 0.05513854761 [0.0497432232, 0.06191505325] | 0.05335896939 [0.04833384408, 0.0668598072] | -0.001779578213 | -3.227466609 | 0 | 0.006085915024 | [0.0497432232, 0.06122446263] | 0.003615746192 | pass | true |
| 9 | 256x60_s7 | 16 (2016) | ihtShare | 0 [0, 0.007048594939] | 0 [0, 0] | 0 | 0 | 0 | 0.003524297469 | [0, 0.003524297469] | 0 | pass | true |
| 9 | 256x60_s7 | 17 (2017) | population | 220398 [217756, 222690] | 220439 [218763, 221363] | 41 | 0.01860270964 | 2203.98 | 2467 | [217931, 222690] | 2251 | pass | true |
| 9 | 256x60_s7 | 17 (2017) | approval | 69.54731213 [67.33822717, 71.7247463] | 70.37562724 [68.51753085, 71.74542036] | 0.8283151135 | 1.191009527 | 0 | 2.193259564 | [67.35405257, 71.7247463] | 1.349119058 | pass | true |
| 9 | 256x60_s7 | 17 (2017) | air | 0.05562548409 [0.05213029692, 0.06452047476] | 0.05680637527 [0.05347644474, 0.07153543278] | 0.001180891178 | 2.122931957 | 0 | 0.006195088916 | [0.05213029692, 0.061820573] | 0.004676078343 | pass | true |
| 9 | 256x60_s7 | 17 (2017) | ihtShare | 0 [0, 0.006989992302] | 0 [0, 0] | 0 | 0 | 0 | 0.003494996151 | [0, 0.003494996151] | 0 | pass | true |
| 9 | 256x60_s7 | 18 (2018) | population | 241134 [238379, 242772] | 240650 [238720, 242106] | -484 | -0.2007182728 | 2411.34 | 2411.34 | [238722.66, 242772] | 1927.34 | pass | true |
| 9 | 256x60_s7 | 18 (2018) | approval | 69.99607389 [67.19431641, 71.33412958] | 70.97879344 [69.93229161, 71.9476675] | 0.9827195484 | 1.403963814 | 0 | 2.069906581 | [67.92616731, 71.33412958] | 0.3553361388 | pass | true |
| 9 | 256x60_s7 | 18 (2018) | air | 0.05833127499 [0.05267313326, 0.06562311307] | 0.05769391453 [0.05268529103, 0.07001623067] | -0.0006373604598 | -1.092656487 | 0 | 0.006474989903 | [0.05267313326, 0.06480626489] | 0.005020781264 | pass | true |
| 9 | 256x60_s7 | 18 (2018) | ihtShare | 0 [0, 0.00677731257] | 0 [0, 0] | 0 | 0 | 0 | 0.003388656285 | [0, 0.003388656285] | 0 | pass | true |
| 9 | 256x60_s7 | 19 (2019) | population | 262375 [259752, 264696] | 261866 [259949, 263592] | -509 | -0.1939971415 | 2623.75 | 2623.75 | [259752, 264696] | 2114 | pass | true |
| 9 | 256x60_s7 | 19 (2019) | approval | 71.17290726 [67.22560029, 72.5038928] | 71.26686555 [69.676158, 73.20204502] | 0.09395829712 | 0.132014134 | 0 | 2.639146256 | [68.533761, 72.5038928] | 1.237027244 | pass | true |
| 9 | 256x60_s7 | 19 (2019) | air | 0.05636567485 [0.05227635304, 0.06839823207] | 0.05653416353 [0.05391067373, 0.07240561834] | 0.0001684886776 | 0.2989207138 | 0 | 0.008060939512 | [0.05227635304, 0.06442661436] | 0.004257810485 | pass | true |
| 9 | 256x60_s7 | 19 (2019) | ihtShare | 0 [0, 0.004477344636] | 0 [0, 0] | 0 | 0 | 0 | 0.002238672318 | [0, 0.002238672318] | 0 | pass | true |
| 9 | 256x60_s7 | 20 (2020) | population | 284938 [281431, 287103] | 283834 [282528, 286247] | -1104 | -0.387452709 | 2849.38 | 2849.38 | [282088.62, 287103] | 1745.38 | pass | true |
| 9 | 256x60_s7 | 20 (2020) | approval | 72.13716937 [70.04594404, 73.42254239] | 72.52625836 [70.68257986, 75.55877174] | 0.3890889881 | 0.5393737951 | 0 | 1.688299177 | [70.44887019, 73.42254239] | 0.8962840336 | pass | true |
| 9 | 256x60_s7 | 20 (2020) | air | 0.05538108481 [0.05169701906, 0.05982058148] | 0.05616703063 [0.05410334041, 0.06488859057] | 0.0007859458233 | 1.419159314 | 0 | 0.004061781207 | [0.05169701906, 0.05944286601] | 0.003275835384 | pass | true |
| 9 | 256x60_s7 | 20 (2020) | ihtShare | 0 [0, 0.004442059446] | 0 [0, 0] | 0 | 0 | 0 | 0.002221029723 | [0, 0.002221029723] | 0 | pass | true |
| 9 | 256x60_s7 | 21 (2021) | population | 309055 [305041, 310742] | 307394 [305182, 309496] | -1661 | -0.5374447914 | 3090.55 | 3090.55 | [305964.45, 310742] | 1429.55 | pass | true |
| 9 | 256x60_s7 | 21 (2021) | approval | 73.05870927 [72.41128196, 76.68464971] | 75.50661998 [71.73225999, 76.03979255] | 2.447910703 | 3.350607651 | 0 | 2.136683879 | [72.41128196, 75.19539315] | -0.3112268235 | fail | true |
| 9 | 256x60_s7 | 21 (2021) | air | 0.05552578707 [0.05104770164, 0.06183595995] | 0.056179247 [0.05337427525, 0.06519120505] | 0.0006534599377 | 1.176858487 | 0 | 0.005394129155 | [0.05104770164, 0.06091991622] | 0.004740669218 | pass | true |
| 9 | 256x60_s7 | 21 (2021) | ihtShare | 0 [0, 0.004414089296] | 0 [0, 0] | 0 | 0 | 0 | 0.002207044648 | [0, 0.002207044648] | 0 | pass | true |
| 9 | 256x60_s7 | 22 (2022) | population | 332098 [327623, 333926] | 331025 [328735, 333260] | -1073 | -0.323097399 | 3320.98 | 3320.98 | [328777.02, 333926] | 2247.98 | pass | true |
| 9 | 256x60_s7 | 22 (2022) | approval | 75.43106353 [72.31779543, 76.88638891] | 76.20536969 [73.25486299, 76.73955076] | 0.7743061606 | 1.026508343 | 0 | 2.28429674 | [73.14676679, 76.88638891] | 0.6810192215 | pass | true |
| 9 | 256x60_s7 | 22 (2022) | air | 0.05560508237 [0.04997855337, 0.06439143228] | 0.05616944977 [0.05333955458, 0.07034325687] | 0.0005643674004 | 1.014956505 | 0 | 0.007206439456 | [0.04997855337, 0.06281152182] | 0.006190896395 | pass | true |
| 9 | 256x60_s7 | 22 (2022) | ihtShare | 0 [0, 0.00438950103] | 0 [0, 0] | 0 | 0 | 0 | 0.002194750515 | [0, 0.002194750515] | 0 | pass | true |
| 9 | 256x60_s7 | 23 (2023) | population | 356659 [351550, 357912] | 354525 [352771, 357183] | -2134 | -0.5983306183 | 3566.59 | 3566.59 | [353092.41, 357912] | 1432.59 | pass | true |
| 9 | 256x60_s7 | 23 (2023) | approval | 76.22880941 [73.46037825, 77.29952853] | 76.28633531 [74.67693969, 76.91262335] | 0.05752590135 | 0.07546477742 | 0 | 1.919575136 | [74.30923427, 77.29952853] | 1.013193218 | pass | true |
| 9 | 256x60_s7 | 23 (2023) | air | 0.05910142504 [0.05073665229, 0.06570402656] | 0.05907922483 [0.0553436937, 0.0685831555] | -0.00002220021155 | -0.037562904 | 0 | 0.007483687137 | [0.0516177379, 0.06570402656] | 0.006624801735 | pass | true |
| 9 | 256x60_s7 | 23 (2023) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 24 (2024) | population | 380531 [376917, 382300] | 379761 [377458, 382088] | -770 | -0.2023488231 | 3805.31 | 3805.31 | [376917, 382300] | 2539 | pass | true |
| 9 | 256x60_s7 | 24 (2024) | approval | 76.61324853 [73.9988384, 77.95795167] | 76.70334212 [74.58899391, 77.19303131] | 0.09009358691 | 0.1175953097 | 0 | 1.979556637 | [74.63369189, 77.95795167] | 1.254609554 | pass | true |
| 9 | 256x60_s7 | 24 (2024) | air | 0.0612263226 [0.05297240487, 0.06946386082] | 0.06039914745 [0.05592590297, 0.07193949282] | -0.0008271751542 | -1.351012308 | 0 | 0.008245727976 | [0.05298059463, 0.06946386082] | 0.007418552822 | pass | true |
| 9 | 256x60_s7 | 24 (2024) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 25 (2025) | population | 406143 [402631, 407893] | 405386 [402861, 407883] | -757 | -0.1863875532 | 4061.43 | 4061.43 | [402631, 407893] | 2507 | pass | true |
| 9 | 256x60_s7 | 25 (2025) | approval | 76.84744866 [73.90021836, 78.21330535] | 76.71023634 [75.68099612, 77.79501676] | -0.1372123189 | -0.1785515606 | 0 | 2.156543495 | [74.69090517, 78.21330535] | 1.50306901 | pass | true |
| 9 | 256x60_s7 | 25 (2025) | air | 0.06116826006 [0.05712679361, 0.06971361134] | 0.06187902972 [0.05581161946, 0.0752616073] | 0.0007107696612 | 1.161990975 | 0 | 0.006293408866 | [0.05712679361, 0.06746166892] | 0.004752236104 | pass | true |
| 9 | 256x60_s7 | 25 (2025) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 26 (2026) | population | 433030 [429660, 434886] | 432490 [429210, 433634] | -540 | -0.1247026765 | 4330.3 | 4330.3 | [429660, 434886] | 2396 | pass | true |
| 9 | 256x60_s7 | 26 (2026) | approval | 76.50599368 [74.14812095, 77.96432494] | 76.35187048 [75.17352526, 78.16073289] | -0.1541231996 | -0.2014524513 | 0 | 1.908101995 | [74.59789169, 77.96432494] | 1.612454455 | pass | true |
| 9 | 256x60_s7 | 26 (2026) | air | 0.05885411157 [0.05765442376, 0.07120974509] | 0.05980993724 [0.05590806637, 0.07590682845] | 0.000955825662 | 1.624059282 | 0 | 0.006777660663 | [0.05765442376, 0.06563177224] | 0.002155513472 | pass | true |
| 9 | 256x60_s7 | 26 (2026) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 27 (2027) | population | 461632 [458481, 463349] | 460455 [457619, 462278] | -1177 | -0.2549649938 | 4616.32 | 4616.32 | [458481, 463349] | 1974 | pass | true |
| 9 | 256x60_s7 | 27 (2027) | approval | 77.76357147 [75.66957497, 78.84031149] | 77.79345213 [75.4158011, 78.3693627] | 0.02988065954 | 0.03842500927 | 0 | 1.585368258 | [76.17820321, 78.84031149] | 1.046859363 | pass | true |
| 9 | 256x60_s7 | 27 (2027) | air | 0.0618420766 [0.05795504928, 0.06949044687] | 0.06119148115 [0.05901099682, 0.07421834766] | -0.0006505954432 | -1.052027162 | 0 | 0.005767698797 | [0.05795504928, 0.06760977539] | 0.003236431874 | pass | true |
| 9 | 256x60_s7 | 27 (2027) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 28 (2028) | population | 491442 [486939, 492668] | 489680 [487636, 491439] | -1762 | -0.3585367144 | 4914.42 | 4914.42 | [486939, 492668] | 2741 | pass | true |
| 9 | 256x60_s7 | 28 (2028) | approval | 77.89095846 [75.92416392, 78.73043325] | 78.58506036 [76.41813666, 79.94004104] | 0.6941019021 | 0.8911199911 | 0 | 1.40313467 | [76.48782379, 78.73043325] | 0.1453728942 | pass | true |
| 9 | 256x60_s7 | 28 (2028) | air | 0.06446007732 [0.0580580144, 0.0738836985] | 0.06302071434 [0.05896400109, 0.07317412605] | -0.001439362986 | -2.232952621 | 0 | 0.007912842053 | [0.0580580144, 0.07237291938] | 0.00496269994 | pass | true |
| 9 | 256x60_s7 | 28 (2028) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 29 (2029) | population | 522372 [516424, 523222] | 520153 [517602, 521658] | -2219 | -0.4247930594 | 5223.72 | 5223.72 | [517148.28, 523222] | 3004.72 | pass | true |
| 9 | 256x60_s7 | 29 (2029) | approval | 78.66518728 [75.94676826, 80.00888883] | 79.11010665 [76.97839075, 80.34852721] | 0.4449193704 | 0.5655861071 | 0 | 2.031060283 | [76.63412699, 80.00888883] | 0.8987821821 | pass | true |
| 9 | 256x60_s7 | 29 (2029) | air | 0.067121767 [0.06251881772, 0.07900248932] | 0.06586735567 [0.0641281697, 0.0777527512] | -0.001254411329 | -1.868859216 | 0 | 0.008241835799 | [0.06251881772, 0.0753636028] | 0.003348537948 | pass | true |
| 9 | 256x60_s7 | 29 (2029) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 30 (2030) | population | 553169 [547698, 554269] | 550694 [548099, 552779] | -2475 | -0.4474220356 | 5531.69 | 5531.69 | [547698, 554269] | 2996 | pass | true |
| 9 | 256x60_s7 | 30 (2030) | approval | 80.04681872 [77.06515207, 81.0494783] | 80.30249877 [77.37045313, 81.20790727] | 0.255680042 | 0.3194131211 | 0 | 1.992163113 | [78.05465561, 81.0494783] | 0.7469795297 | pass | true |
| 9 | 256x60_s7 | 30 (2030) | air | 0.07034633728 [0.0657542974, 0.08066902746] | 0.06789094232 [0.0656010041, 0.08071070711] | -0.002455394961 | -3.490437535 | 0 | 0.007457365027 | [0.0657542974, 0.07780370231] | 0.002136644915 | pass | true |
| 9 | 256x60_s7 | 30 (2030) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 31 (2031) | population | 584845 [578264, 586165] | 582430 [578650, 584664] | -2415 | -0.4129299216 | 5848.45 | 5848.45 | [578996.55, 586165] | 3433.45 | pass | true |
| 9 | 256x60_s7 | 31 (2031) | approval | 81.18954523 [77.22447043, 81.34260413] | 81.13662844 [77.80669756, 82.36534491] | -0.05291679015 | -0.06517685252 | 0 | 2.059066846 | [79.13047838, 81.34260413] | 0.2059756897 | pass | true |
| 9 | 256x60_s7 | 31 (2031) | air | 0.07449752974 [0.07138797056, 0.08641448016] | 0.07319812417 [0.07042194085, 0.08451686655] | -0.001299405572 | -1.744226388 | 0 | 0.007513254798 | [0.07138797056, 0.08201078454] | 0.001810153604 | pass | true |
| 9 | 256x60_s7 | 31 (2031) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 32 (2032) | population | 616271 [609732, 617587] | 615266 [609885, 616229] | -1005 | -0.1630776071 | 6162.71 | 6162.71 | [610108.29, 617587] | 2321 | pass | true |
| 9 | 256x60_s7 | 32 (2032) | approval | 81.8707558 [78.11353675, 82.20568232] | 81.92800324 [78.45823792, 82.80999058] | 0.05724743801 | 0.06992415968 | 0 | 2.046072788 | [79.82468301, 82.20568232] | 0.2776790866 | pass | true |
| 9 | 256x60_s7 | 32 (2032) | air | 0.08071848532 [0.07623496412, 0.09215309722] | 0.0779171377 [0.0739645298, 0.09307730484] | -0.002801347625 | -3.4705156 | 0 | 0.007959066549 | [0.07623496412, 0.08867755187] | 0.001682173571 | pass | true |
| 9 | 256x60_s7 | 32 (2032) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 33 (2033) | population | 649366 [642446, 650402] | 646977 [642169, 649154] | -2389 | -0.3678973029 | 6493.66 | 6493.66 | [642872.34, 650402] | 3425 | pass | true |
| 9 | 256x60_s7 | 33 (2033) | approval | 82.02128594 [79.8108193, 82.77562095] | 82.47027327 [78.63682061, 82.88854155] | 0.4489873254 | 0.5474034213 | 0 | 1.482400822 | [80.53888512, 82.77562095] | 0.3053476796 | pass | true |
| 9 | 256x60_s7 | 33 (2033) | air | 0.08297738522 [0.08007267484, 0.09681951461] | 0.08204804199 [0.07751474242, 0.09583884968] | -0.0009293432259 | -1.119995796 | 0 | 0.008373419887 | [0.08007267484, 0.09135080511] | 0.001975367158 | pass | true |
| 9 | 256x60_s7 | 33 (2033) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 34 (2034) | population | 681383 [674866, 682905] | 679375 [674783, 681394] | -2008 | -0.2946947605 | 6813.83 | 6813.83 | [674866, 682905] | 3530 | pass | true |
| 9 | 256x60_s7 | 34 (2034) | approval | 81.87624095 [79.96953811, 82.72161931] | 82.49659043 [80.0832585, 82.68520553] | 0.6203494824 | 0.7576672734 | 0 | 1.3760406 | [80.50020035, 82.72161931] | 0.2250288746 | pass | true |
| 9 | 256x60_s7 | 34 (2034) | air | 0.08894611552 [0.08541193814, 0.1010780601] | 0.08445102224 [0.08186788369, 0.09921836231] | -0.004495093275 | -5.053726348 | 0 | 0.007833060973 | [0.08541193814, 0.09677917649] | -0.0009609158986 | fail | true |
| 9 | 256x60_s7 | 34 (2034) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 35 (2035) | population | 715266 [707692, 716674] | 712843 [707407, 714997] | -2423 | -0.3387550925 | 7152.66 | 7152.66 | [708113.34, 716674] | 3831 | pass | true |
| 9 | 256x60_s7 | 35 (2035) | approval | 82.32127653 [79.82443739, 82.74602122] | 82.35093184 [80.58498936, 82.89335091] | 0.0296553167 | 0.03602387858 | 0 | 1.460791916 | [80.86048461, 82.74602122] | 0.3950893783 | pass | true |
| 9 | 256x60_s7 | 35 (2035) | air | 0.09408836462 [0.08887255036, 0.1070792466] | 0.09190053114 [0.08613195169, 0.1034766406] | -0.002187833478 | -2.32529653 | 0 | 0.009103348109 | [0.08887255036, 0.1031917127] | 0.003027980782 | pass | true |
| 9 | 256x60_s7 | 35 (2035) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 36 (2036) | population | 747267 [740445, 749944] | 746460 [740322, 748103] | -807 | -0.1079935284 | 7472.67 | 7472.67 | [740445, 749944] | 3484 | pass | true |
| 9 | 256x60_s7 | 36 (2036) | approval | 81.68252893 [80.05807507, 82.24079331] | 82.33645604 [80.0374354, 83.18729568] | 0.6539271044 | 0.8005715702 | 0 | 1.091359121 | [80.59116981, 82.24079331] | -0.09566272224 | fail | true |
| 9 | 256x60_s7 | 36 (2036) | air | 0.09857667571 [0.09655970828, 0.1127969766] | 0.09544427497 [0.09412768384, 0.1097881479] | -0.003132400737 | -3.177628698 | 0 | 0.008118634177 | [0.09655970828, 0.1066953099] | -0.001115433314 | fail | true |
| 9 | 256x60_s7 | 36 (2036) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 37 (2037) | population | 781483 [773598, 784083] | 780908 [774438, 782881] | -575 | -0.07357805608 | 7814.83 | 7814.83 | [773668.17, 784083] | 3175 | pass | true |
| 9 | 256x60_s7 | 37 (2037) | approval | 81.70508489 [79.34904833, 82.10804793] | 81.71716688 [79.70328391, 83.20647531] | 0.0120819931 | 0.0147873209 | 0 | 1.379499799 | [80.32558509, 82.10804793] | 0.3908810475 | pass | true |
| 9 | 256x60_s7 | 37 (2037) | air | 0.1111848672 [0.1003523775, 0.1223969888] | 0.100077575 [0.09283242611, 0.1157831844] | -0.01110729221 | -9.989931627 | 0 | 0.01102230563 | [0.1003523775, 0.1222071728] | -0.0002748025407 | fail | true |
| 9 | 256x60_s7 | 37 (2037) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 38 (2038) | population | 816400 [808253, 819015] | 814193 [809560, 816376] | -2207 | -0.27033317 | 8164 | 8164 | [808253, 819015] | 4822 | pass | true |
| 9 | 256x60_s7 | 38 (2038) | approval | 81.33656726 [79.56535669, 82.10776851] | 81.74401908 [79.46814896, 82.63812136] | 0.4074518205 | 0.5009454348 | 0 | 1.27120591 | [80.06536135, 82.10776851] | 0.3637494336 | pass | true |
| 9 | 256x60_s7 | 38 (2038) | air | 0.1137574554 [0.1046508963, 0.1328408683] | 0.107200509 [0.09955635406, 0.1235571232] | -0.006556946391 | -5.763970694 | 0 | 0.01409498601 | [0.1046508963, 0.1278524414] | 0.002549612726 | pass | true |
| 9 | 256x60_s7 | 38 (2038) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 39 (2039) | population | 849116 [844325, 853580] | 850209 [844434, 851600] | 1093 | 0.1287221063 | 8491.16 | 8491.16 | [844325, 853580] | 3371 | pass | true |
| 9 | 256x60_s7 | 39 (2039) | approval | 81.14146947 [80.61492243, 82.10791996] | 81.70715217 [80.19098906, 82.99140437] | 0.5656826982 | 0.6971560928 | 0 | 0.7464987651 | [80.61492243, 81.88796823] | 0.1808160669 | pass | true |
| 9 | 256x60_s7 | 39 (2039) | air | 0.117955218 [0.1105337442, 0.1389095822] | 0.1129205541 [0.1039877987, 0.1297694006] | -0.005034663888 | -4.268284163 | 0 | 0.01418791898 | [0.1105337442, 0.132143137] | 0.002386809888 | pass | true |
| 9 | 256x60_s7 | 39 (2039) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 40 (2040) | population | 885781 [878794, 890501] | 884168 [879723, 890344] | -1613 | -0.182099187 | 8857.81 | 8857.81 | [878794, 890501] | 5374 | pass | true |
| 9 | 256x60_s7 | 40 (2040) | approval | 81.9362789 [80.30807525, 82.77316574] | 82.23667738 [80.40428009, 82.65435251] | 0.3003984805 | 0.3666245093 | 0 | 1.232545245 | [80.70373365, 82.77316574] | 0.5364883597 | pass | true |
| 9 | 256x60_s7 | 40 (2040) | air | 0.1233978845 [0.1160728093, 0.139513872] | 0.1198265627 [0.1129057906, 0.1316073533] | -0.003571321821 | -2.894151577 | 0 | 0.01172053131 | [0.1160728093, 0.1351184158] | 0.003753753345 | pass | true |
| 9 | 256x60_s7 | 40 (2040) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 41 (2041) | population | 922651 [913777, 928329] | 919200 [915457, 928087] | -3451 | -0.3740309174 | 9226.51 | 9226.51 | [913777, 928329] | 5423 | pass | true |
| 9 | 256x60_s7 | 41 (2041) | approval | 81.5173743 [80.76867789, 82.68507816] | 81.9582051 [79.92894148, 82.79712622] | 0.4408308047 | 0.5407814083 | 0 | 0.958200135 | [80.76867789, 82.47557443] | 0.5173693303 | pass | true |
| 9 | 256x60_s7 | 41 (2041) | air | 0.1253183917 [0.1196793107, 0.1433797784] | 0.1209156226 [0.1152230486, 0.1353697644] | -0.004402769101 | -3.513266523 | 0 | 0.01185023386 | [0.1196793107, 0.1371686255] | 0.00123631188 | pass | true |
| 9 | 256x60_s7 | 41 (2041) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 42 (2042) | population | 954296 [948309, 964043] | 955357 [952824, 962039] | 1061 | 0.1111814364 | 9542.96 | 9542.96 | [948309, 963838.96] | 7048 | pass | true |
| 9 | 256x60_s7 | 42 (2042) | approval | 81.31818496 [80.25457551, 82.51772479] | 81.77414831 [80.31156707, 82.44955927] | 0.4559633427 | 0.5607151007 | 0 | 1.131574639 | [80.25457551, 82.4497596] | 0.6756112965 | pass | true |
| 9 | 256x60_s7 | 42 (2042) | air | 0.1315819697 [0.1260065345, 0.1476719558] | 0.1275682027 [0.1221592887, 0.1373640027] | -0.004013767016 | -3.050392866 | 0 | 0.01083271063 | [0.1260065345, 0.1424146803] | 0.001561668118 | pass | true |
| 9 | 256x60_s7 | 42 (2042) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 43 (2043) | population | 990452 [986884, 1001176] | 992415 [987716, 996966] | 1963 | 0.1981923405 | 9904.52 | 9904.52 | [986884, 1000356.52] | 5531 | pass | true |
| 9 | 256x60_s7 | 43 (2043) | approval | 81.41846199 [79.84456931, 82.58274162] | 81.97720227 [80.25430009, 82.1888187] | 0.5587402788 | 0.6862574717 | 0 | 1.369086155 | [80.04937583, 82.58274162] | 0.6055393559 | pass | true |
| 9 | 256x60_s7 | 43 (2043) | air | 0.1363692754 [0.1303388481, 0.1552976909] | 0.1318297107 [0.1214167864, 0.1481096096] | -0.004539564723 | -3.328876472 | 0 | 0.01247942138 | [0.1303388481, 0.1488486968] | 0.001490862563 | pass | true |
| 9 | 256x60_s7 | 43 (2043) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s7 | 44 (2044) | population | 1029252 [1021771, 1041125] | 1031239 [1026033, 1037326] | 1987 | 0.1930528189 | 10292.52 | 10292.52 | [1021771, 1039544.52] | 8305.52 | pass | true |
| 9 | 256x60_s7 | 44 (2044) | approval | 81.07316961 [79.71627546, 81.60598447] | 81.76894436 [79.75966659, 82.27506752] | 0.6957747492 | 0.85820593 | 0 | 0.9448545066 | [80.1283151, 81.60598447] | -0.1629598922 | fail | true |
| 9 | 256x60_s7 | 44 (2044) | air | 0.1405887458 [0.1387190142, 0.1589794896] | 0.1398026557 [0.1308152791, 0.1485247141] | -0.0007860901658 | -0.5591416021 | 0 | 0.01013023772 | [0.1387190142, 0.1507189835] | 0.001083641476 | pass | true |
| 9 | 256x60_s7 | 44 (2044) | ihtShare | 0 [0, 0.002702015386] | 0 [0, 0] | 0 | 0 | 0 | 0.001351007693 | [0, 0.001351007693] | 0 | pass | true |
| 9 | 256x60_s7 | 45 (2045) | population | 1066213 [1055686, 1079331] | 1070693 [1063463, 1075424] | 4480 | 0.4201787073 | 10662.13 | 11822.5 | [1055686, 1078035.5] | 7342.5 | pass | true |
| 9 | 256x60_s7 | 45 (2045) | approval | 80.76391805 [79.310177, 81.18818587] | 81.3275523 [79.74389855, 81.75874687] | 0.5636342482 | 0.6978787828 | 0 | 0.9390044332 | [79.82491362, 81.18818587] | -0.1393664303 | fail | true |
| 9 | 256x60_s7 | 45 (2045) | air | 0.1456996772 [0.1424804543, 0.1605866295] | 0.1424959769 [0.1328903228, 0.1535622085] | -0.003203700346 | -2.198838327 | 0 | 0.009053087569 | [0.1424804543, 0.1547527648] | 0.00001552258715 | pass | true |
| 9 | 256x60_s7 | 45 (2045) | ihtShare | 0 [0, 0.01075417812] | 0 [0, 0] | 0 | 0 | 0 | 0.005377089059 | [0, 0.005377089059] | 0 | pass | true |
| 9 | 256x60_s7 | 46 (2046) | population | 1106293 [1092663, 1118481] | 1110161 [1104066, 1117252] | 3868 | 0.3496361271 | 11062.93 | 12909 | [1093384, 1118481] | 8320 | pass | true |
| 9 | 256x60_s7 | 46 (2046) | approval | 80.54085542 [79.0075829, 81.00050684] | 80.89641466 [79.55890956, 81.64041059] | 0.3555592423 | 0.4414644474 | 0 | 0.9964619718 | [79.54439344, 81.00050684] | 0.1040921842 | pass | true |
| 9 | 256x60_s7 | 46 (2046) | air | 0.1500675306 [0.144261355, 0.1664440982] | 0.1456592696 [0.1360778964, 0.1577448372] | -0.004408261014 | -2.937518194 | 0 | 0.01109137161 | [0.144261355, 0.1611589022] | 0.00139791457 | pass | true |
| 9 | 256x60_s7 | 46 (2046) | ihtShare | 0 [0, 0.02938043341] | 0 [0, 0.001092384519] | 0 | 0 | 0 | 0.0146902167 | [0, 0.0146902167] | 0 | pass | true |
| 9 | 256x60_s7 | 47 (2047) | population | 1144132 [1127604, 1152537] | 1154164 [1139064, 1157332] | 10032 | 0.8768219052 | 11441.32 | 12466.5 | [1131665.5, 1152537] | -1627 | fail | true |
| 9 | 256x60_s7 | 47 (2047) | approval | 79.99850837 [78.95311956, 81.05888527] | 81.51245335 [79.09997117, 82.45888751] | 1.513944974 | 1.892466503 | 0 | 1.052882856 | [78.95311956, 81.05139123] | -0.4610621186 | fail | true |
| 9 | 256x60_s7 | 47 (2047) | air | 0.1499989357 [0.1434832025, 0.1677293132] | 0.1526874038 [0.1349442867, 0.1569693028] | 0.002688468124 | 1.7923248 | 0 | 0.01212305534 | [0.1434832025, 0.162121991] | 0.009204201282 | pass | true |
| 9 | 256x60_s7 | 47 (2047) | ihtShare | 0 [0, 0.0351572007] | 0 [0, 0.007557080073] | 0 | 0 | 0 | 0.01757860035 | [0, 0.01757860035] | 0 | pass | true |
| 9 | 256x60_s7 | 48 (2048) | population | 1186078 [1167763, 1189173] | 1190985 [1173843, 1198219] | 4907 | 0.4137164672 | 11860.78 | 11860.78 | [1174217.22, 1189173] | -1812 | fail | true |
| 9 | 256x60_s7 | 48 (2048) | approval | 80.45866684 [77.94694039, 80.8686423] | 80.74960344 [79.51187485, 81.94307751] | 0.2909366018 | 0.3615975919 | 0 | 1.460850957 | [78.99781588, 80.8686423] | 0.1190388631 | pass | true |
| 9 | 256x60_s7 | 48 (2048) | air | 0.155345503 [0.1477530266, 0.1727237] | 0.1506166526 [0.1461418506, 0.1638523872] | -0.004728850364 | -3.044085779 | 0 | 0.01248533671 | [0.1477530266, 0.1678308397] | 0.002863625968 | pass | true |
| 9 | 256x60_s7 | 48 (2048) | ihtShare | 0 [0, 0.05093371286] | 0 [0, 0.02534947782] | 0 | 0 | 0 | 0.02546685643 | [0, 0.02546685643] | 0 | pass | true |
| 9 | 256x60_s7 | 49 (2049) | population | 1225463 [1185004, 1235776] | 1231930 [1212992, 1240385] | 6467 | 0.5277189111 | 12254.63 | 25386 | [1200077, 1235776] | 3846 | pass | true |
| 9 | 256x60_s7 | 49 (2049) | approval | 80.56109889 [78.80766758, 80.95111054] | 81.18524873 [78.81260193, 82.00716525] | 0.6241498459 | 0.7747533916 | 0 | 1.07172148 | [79.48937741, 80.95111054] | -0.2341381943 | fail | true |
| 9 | 256x60_s7 | 49 (2049) | air | 0.1565685665 [0.1473500515, 0.1696897742] | 0.1547410827 [0.143035178, 0.1686145954] | -0.001827483847 | -1.167209924 | 0 | 0.01116986135 | [0.1473500515, 0.1677384279] | 0.00739103122 | pass | true |
| 9 | 256x60_s7 | 49 (2049) | ihtShare | 0 [0, 0.06220635087] | 0 [0, 0.03771644524] | 0 | 0 | 0 | 0.03110317544 | [0, 0.03110317544] | 0 | pass | true |
| 9 | 256x60_s7 | 50 (2050) | population | 1265741 [1202458, 1272989] | 1272249 [1233960, 1275132] | 6508 | 0.5141652202 | 12657.41 | 35265.5 | [1230475.5, 1272989] | 740 | pass | true |
| 9 | 256x60_s7 | 50 (2050) | approval | 80.31895548 [78.99120522, 80.84473736] | 80.6827045 [79.00755102, 81.25761567] | 0.3637490144 | 0.4528806584 | 0 | 0.926766074 | [79.39218941, 80.84473736] | 0.1620328675 | pass | true |
| 9 | 256x60_s7 | 50 (2050) | air | 0.1594034463 [0.1545329508, 0.1770923645] | 0.1584230689 [0.1482095966, 0.1701371491] | -0.0009803774343 | -0.6150290079 | 0 | 0.01127970685 | [0.1545329508, 0.1706831531] | 0.00389011809 | pass | true |
| 9 | 256x60_s7 | 50 (2050) | ihtShare | 0 [0, 0.07324135582] | 0 [0, 0.04643851022] | 0 | 0 | 0 | 0.03662067791 | [0, 0.03662067791] | 0 | pass | true |
| 9 | 256x60_s7 | 51 (2051) | population | 1310245 [1243720, 1315846] | 1315814 [1254556, 1316938] | 5569 | 0.4250350125 | 13102.45 | 36063 | [1274182, 1315846] | 32 | pass | true |
| 9 | 256x60_s7 | 51 (2051) | approval | 79.67800859 [78.27383883, 80.7534328] | 80.27536667 [78.90160132, 81.02544092] | 0.597358081 | 0.7497151241 | 0 | 1.239796984 | [78.4382116, 80.7534328] | 0.478066126 | pass | true |
| 9 | 256x60_s7 | 51 (2051) | air | 0.1641497153 [0.1526035944, 0.1787988062] | 0.1570688485 [0.1508572693, 0.1697007942] | -0.007080866779 | -4.31366376 | 0 | 0.01309760594 | [0.1526035944, 0.1772473212] | 0.004465254111 | pass | true |
| 9 | 256x60_s7 | 51 (2051) | ihtShare | 0.01085069444 [0, 0.07822800446] | 0 [0, 0.06292707316] | -0.01085069444 | -100 | 0 | 0.03911400223 | [0, 0.04996469667] | 0 | pass | true |
| 9 | 256x60_s7 | 52 (2052) | population | 1342501 [1259287, 1355405] | 1353336 [1293036, 1362826] | 10835 | 0.8070757489 | 13425.01 | 48059 | [1294442, 1355405] | 2069 | pass | true |
| 9 | 256x60_s7 | 52 (2052) | approval | 79.77321215 [78.30443511, 80.63697471] | 79.44555421 [78.7081903, 80.82172327] | -0.3276579448 | -0.4107368074 | 0 | 1.166269799 | [78.60694236, 80.63697471] | 0.8386118541 | pass | true |
| 9 | 256x60_s7 | 52 (2052) | air | 0.1606372863 [0.1533680434, 0.1778936906] | 0.1668986033 [0.1494987318, 0.1690965258] | 0.006261316919 | 3.89779799 | 0 | 0.01226282359 | [0.1533680434, 0.1729001099] | 0.006001506673 | pass | true |
| 9 | 256x60_s7 | 52 (2052) | ihtShare | 0.02565309911 [0, 0.09115856049] | 0 [0, 0.07759211753] | -0.02565309911 | -100 | 0 | 0.04557928024 | [0, 0.07123237935] | 0 | pass | true |
| 9 | 256x60_s7 | 53 (2053) | population | 1361273 [1266114, 1397353] | 1399697 [1308156, 1402755] | 38424 | 2.822652032 | 13612.73 | 65619.5 | [1295653.5, 1397353] | -2344 | fail | true |
| 9 | 256x60_s7 | 53 (2053) | approval | 79.53620354 [77.67852788, 80.75484701] | 80.11565783 [78.77508017, 80.9302989] | 0.5794542962 | 0.7285415578 | 0 | 1.538159567 | [77.99804397, 80.75484701] | 0.639189182 | pass | true |
| 9 | 256x60_s7 | 53 (2053) | air | 0.1640372879 [0.1553335117, 0.1746259797] | 0.1682943956 [0.1547237432, 0.1726942165] | 0.004257107701 | 2.59520732 | 0 | 0.009646233997 | [0.1553335117, 0.1736835219] | 0.005389126296 | pass | true |
| 9 | 256x60_s7 | 53 (2053) | ihtShare | 0.03539789825 [0, 0.1019341449] | 0 [0, 0.08205895602] | -0.03539789825 | -100 | 0 | 0.05096707243 | [0, 0.08636497068] | 0 | pass | true |
| 9 | 256x60_s7 | 54 (2054) | population | 1389189 [1282793, 1434433] | 1439702 [1328857, 1446231] | 50513 | 3.636150301 | 13891.89 | 75820 | [1313369, 1434433] | -5269 | fail | true |
| 9 | 256x60_s7 | 54 (2054) | approval | 79.90877555 [78.67552942, 81.01134176] | 80.19536719 [78.68544133, 81.7114331] | 0.2865916432 | 0.3586485229 | 0 | 1.167906169 | [78.74086938, 81.01134176] | 0.8159745627 | pass | true |
| 9 | 256x60_s7 | 54 (2054) | air | 0.1641298778 [0.1526786937, 0.1829939663] | 0.167821452 [0.1497758374, 0.1802763786] | 0.003691574161 | 2.249178644 | 0 | 0.0151576363 | [0.1526786937, 0.1792875141] | 0.01146606214 | pass | true |
| 9 | 256x60_s7 | 54 (2054) | ihtShare | 0.04693832437 [0.001336031985, 0.1018399496] | 0 [0, 0.08776923877] | -0.04693832437 | -100 | 0 | 0.0502519588 | [0.001336031985, 0.09719028317] | -0.001336031985 | fail | true |
| 9 | 256x60_s7 | 55 (2055) | population | 1401036 [1291560, 1463953] | 1470088 [1343542, 1489981] | 69052 | 4.928638522 | 14010.36 | 86196.5 | [1314839.5, 1463953] | -6135 | fail | true |
| 9 | 256x60_s7 | 55 (2055) | approval | 79.81138752 [77.45035609, 81.11460045] | 79.99140795 [77.85850437, 80.82995111] | 0.180020436 | 0.2255573316 | 0 | 1.83212218 | [77.97926534, 81.11460045] | 1.123192498 | pass | true |
| 9 | 256x60_s7 | 55 (2055) | air | 0.1682199265 [0.1566320876, 0.1757489784] | 0.1695433761 [0.1554591002, 0.1770087157] | 0.001323449657 | 0.7867377454 | 0 | 0.009558445391 | [0.1586614811, 0.1757489784] | 0.006205602244 | pass | true |
| 9 | 256x60_s7 | 55 (2055) | ihtShare | 0.05061165101 [0.01837909655, 0.1169417494] | 0 [0, 0.09681059614] | -0.05061165101 | -100 | 0 | 0.0492813264 | [0.01837909655, 0.09989297741] | -0.01837909655 | fail | true |
| 9 | 256x60_s7 | 56 (2056) | population | 1419186 [1304234, 1479068] | 1509841 [1343413, 1530828] | 90655 | 6.387816678 | 14191.86 | 87417 | [1331769, 1479068] | -30773 | fail | true |
| 9 | 256x60_s7 | 56 (2056) | approval | 80.0662775 [77.58031873, 81.02231108] | 79.96302025 [78.79211077, 80.94983648] | -0.103257252 | -0.1289647218 | 0 | 1.720996175 | [78.34528133, 81.02231108] | 1.059290827 | pass | true |
| 9 | 256x60_s7 | 56 (2056) | air | 0.1680693696 [0.1542054697, 0.1861106634] | 0.1734333041 [0.1496605233, 0.1767352835] | 0.00536393455 | 3.191500369 | 0 | 0.01595259682 | [0.1542054697, 0.1840219664] | 0.01058866227 | pass | true |
| 9 | 256x60_s7 | 56 (2056) | ihtShare | 0.06514895278 [0.03016699587, 0.1247583189] | 0.004243355386 [0, 0.1046654673] | -0.06090559739 | -93.48668673 | 0 | 0.04729566152 | [0.03016699587, 0.1124446143] | -0.02592364048 | fail | true |
| 9 | 256x60_s7 | 57 (2057) | population | 1418230 [1322291, 1487910] | 1515651 [1356368, 1542033] | 97421 | 6.869196111 | 14182.3 | 82809.5 | [1335420.5, 1487910] | -27741 | fail | true |
| 9 | 256x60_s7 | 57 (2057) | approval | 80.25815761 [77.71226593, 80.94654418] | 79.5141486 [78.36958363, 80.98997651] | -0.744009007 | -0.9270197936 | 0 | 1.617139126 | [78.64101848, 80.94654418] | 0.8731301193 | pass | true |
| 9 | 256x60_s7 | 57 (2057) | air | 0.1708420565 [0.1537251827, 0.1816357056] | 0.1762804499 [0.1527122522, 0.1827941754] | 0.005438393446 | 3.183287276 | 0 | 0.01395526147 | [0.156886795, 0.1816357056] | 0.005355255732 | pass | true |
| 9 | 256x60_s7 | 57 (2057) | ihtShare | 0.07402317233 [0.03886621156, 0.1301338446] | 0.009927564016 [0, 0.1143976398] | -0.06409560831 | -86.5885726 | 0 | 0.0456338165 | [0.03886621156, 0.1196569888] | -0.02893864754 | fail | true |
| 9 | 256x60_s7 | 58 (2058) | population | 1442416 [1335743, 1521883] | 1530344 [1361197, 1564809] | 87928 | 6.095883573 | 14424.16 | 93070 | [1349346, 1521883] | -8461 | fail | true |
| 9 | 256x60_s7 | 58 (2058) | approval | 80.01480223 [78.34044281, 80.92687902] | 79.92231028 [78.94574872, 81.49147915] | -0.09249195108 | -0.1155935508 | 0 | 1.293218108 | [78.72158412, 80.92687902] | 1.004568747 | pass | true |
| 9 | 256x60_s7 | 58 (2058) | air | 0.1680511547 [0.1538286579, 0.1870111466] | 0.1749357233 [0.1508446015, 0.1778912508] | 0.006884568591 | 4.096710079 | 0 | 0.01659124434 | [0.1538286579, 0.184642399] | 0.009706675747 | pass | true |
| 9 | 256x60_s7 | 58 (2058) | ihtShare | 0.08953625103 [0.04037183441, 0.1358433543] | 0.0107318199 [0, 0.1186644995] | -0.07880443113 | -88.01399458 | 0 | 0.04773575995 | [0.04180049108, 0.1358433543] | -0.03106867118 | fail | true |
| 9 | 256x60_s7 | 59 (2059) | population | 1447648 [1344677, 1537176] | 1537000 [1378408, 1579563] | 89352 | 6.172218661 | 14476.48 | 96249.5 | [1351398.5, 1537176] | 176 | pass | true |
| 9 | 256x60_s7 | 59 (2059) | approval | 79.88367089 [77.41282113, 80.66228883] | 79.83410366 [78.52377686, 81.18270151] | -0.04956723722 | -0.06204927323 | 0 | 1.624733848 | [78.25893705, 80.66228883] | 0.828185169 | pass | true |
| 9 | 256x60_s7 | 59 (2059) | air | 0.169665794 [0.1561095287, 0.1851632801] | 0.175391458 [0.1562470977, 0.1817474826] | 0.005725663987 | 3.374671967 | 0 | 0.01452687568 | [0.1561095287, 0.1841926697] | 0.008801211697 | pass | true |
| 9 | 256x60_s7 | 59 (2059) | ihtShare | 0.09739762725 [0.04440216472, 0.136353087] | 0.01075494906 [0, 0.1260860633] | -0.08664267818 | -88.95768884 | 0 | 0.04597546115 | [0.0514221661, 0.136353087] | -0.04066721704 | fail | true |
| 9 | 256x60_s7 | 60 (2060) | population | 1461087 [1341715, 1542590] | 1538720 [1387670, 1595956] | 77633 | 5.313372852 | 14610.87 | 100437.5 | [1360649.5, 1542590] | 3870 | pass | true |
| 9 | 256x60_s7 | 60 (2060) | approval | 80.16455676 [78.18364944, 80.54140973] | 79.65349972 [79.22911343, 80.76077082] | -0.5110570391 | -0.6375099668 | 0 | 1.178880145 | [78.98567661, 80.54140973] | 0.6678231057 | pass | true |
| 9 | 256x60_s7 | 60 (2060) | air | 0.1688953657 [0.155473291, 0.1832091934] | 0.1770269615 [0.1562825978, 0.1810752813] | 0.008131595788 | 4.814576028 | 0 | 0.01386795119 | [0.155473291, 0.1827633169] | 0.005736355403 | pass | true |
| 9 | 256x60_s7 | 60 (2060) | ihtShare | 0.1148219322 [0.04737672551, 0.1376239046] | 0.01079646392 [0, 0.1305509815] | -0.1040254683 | -90.59721108 | 0 | 0.04512358955 | [0.06969834269, 0.1376239046] | -0.05890187877 | fail | false |
| 9 | 256x60_s11 | 10 (2010) | population | 96965 [95898, 97480] | 79929 [73197, 90844] | -17036 | -17.56922601 | 969.65 | 969.65 | [95995.35, 97480] | -16066.35 | fail | false |
| 9 | 256x60_s11 | 10 (2010) | approval | 64.51316532 [61.86675442, 65.07270714] | 66.42366854 [64.77362703, 67.89609742] | 1.910503224 | 2.961416038 | 0 | 1.602976362 | [62.91018895, 65.07270714] | -1.350961397 | fail | true |
| 9 | 256x60_s11 | 10 (2010) | air | 0.0654003938 [0.05668998517, 0.07417035988] | 0.07346188306 [0.05058129813, 0.08853611852] | 0.008061489252 | 12.32636194 | 0 | 0.008740187354 | [0.05668998517, 0.07414058116] | 0.0006786981019 | pass | true |
| 9 | 256x60_s11 | 10 (2010) | ihtShare | 0 [0, 0.02515298993] | 0 [0, 0.01809324983] | 0 | 0 | 0 | 0.01257649496 | [0, 0.01257649496] | 0 | pass | true |
| 9 | 256x60_s11 | 11 (2011) | population | 111116 [110004, 111424] | 93158 [85871, 104820] | -17958 | -16.16148889 | 1111.16 | 1111.16 | [110004.84, 111424] | -16846.84 | fail | false |
| 9 | 256x60_s11 | 11 (2011) | approval | 62.9393458 [61.80972824, 64.04202902] | 65.19282809 [63.47133916, 67.30272763] | 2.253482294 | 3.580403109 | 0 | 1.116150391 | [61.82319541, 64.04202902] | -1.150799072 | fail | false |
| 9 | 256x60_s11 | 11 (2011) | air | 0.05930619274 [0.05107261594, 0.06455950736] | 0.07589041027 [0.07004441449, 0.08315196793] | 0.01658421753 | 27.96371975 | 0 | 0.00674344571 | [0.05256274703, 0.06455950736] | -0.01133090291 | fail | false |
| 9 | 256x60_s11 | 11 (2011) | ihtShare | 0 [0, 0.0223819917] | 0 [0, 0.01805562069] | 0 | 0 | 0 | 0.01119099585 | [0, 0.01119099585] | 0 | pass | true |
| 9 | 256x60_s11 | 12 (2012) | population | 126617 [125426, 127871] | 107177 [99547, 119061] | -19440 | -15.35338857 | 1266.17 | 1266.17 | [125426, 127871] | -18249 | fail | false |
| 9 | 256x60_s11 | 12 (2012) | approval | 63.03162844 [61.63120715, 65.24691981] | 65.02467143 [63.25756716, 66.09097244] | 1.993042993 | 3.161972874 | 0 | 1.80785633 | [61.63120715, 64.83948477] | -0.185186663 | fail | true |
| 9 | 256x60_s11 | 12 (2012) | air | 0.05227064013 [0.04821362898, 0.05629496671] | 0.06704833301 [0.06047673394, 0.08366835406] | 0.01477769289 | 28.27149783 | 0 | 0.004040668866 | [0.04822997126, 0.05629496671] | -0.0107533663 | fail | false |
| 9 | 256x60_s11 | 12 (2012) | ihtShare | 0 [0, 0.02062415197] | 0 [0, 0.01645613131] | 0 | 0 | 0 | 0.01031207598 | [0, 0.01031207598] | 0 | pass | true |
| 9 | 256x60_s11 | 13 (2013) | population | 143996 [141572, 145099] | 123229 [114295, 136136] | -20767 | -14.42192839 | 1439.96 | 1763.5 | [142232.5, 145099] | -19003.5 | fail | false |
| 9 | 256x60_s11 | 13 (2013) | approval | 63.77372029 [62.40833624, 65.62723822] | 65.82680555 [62.22394942, 68.38007727] | 2.053085255 | 3.219328033 | 0 | 1.609450991 | [62.40833624, 65.38317128] | -0.443634264 | fail | true |
| 9 | 256x60_s11 | 13 (2013) | air | 0.05050261419 [0.04779384543, 0.0555974715] | 0.06050994398 [0.05650831432, 0.06796541906] | 0.01000732979 | 19.81546885 | 0 | 0.00390181303 | [0.04779384543, 0.05440442723] | -0.006105516755 | fail | false |
| 9 | 256x60_s11 | 13 (2013) | ihtShare | 0 [0, 0.01948824755] | 0 [0, 0.01476598041] | 0 | 0 | 0 | 0.009744123773 | [0, 0.009744123773] | 0 | pass | true |
| 9 | 256x60_s11 | 14 (2014) | population | 162461 [158959, 163214] | 139741 [130213, 152641] | -22720 | -13.98489484 | 1624.61 | 2127.5 | [160333.5, 163214] | -20592.5 | fail | false |
| 9 | 256x60_s11 | 14 (2014) | approval | 68.72181555 [64.00144302, 70.23553025] | 67.72351457 [63.98322749, 70.35934329] | -0.9983009761 | -1.452669677 | 0 | 3.117043617 | [65.60477193, 70.23553025] | 2.118742641 | pass | true |
| 9 | 256x60_s11 | 14 (2014) | air | 0.05354769839 [0.04624352531, 0.05734784314] | 0.05720197518 [0.05479344984, 0.06242301784] | 0.003654276793 | 6.824339613 | 0 | 0.005552158911 | [0.04799553948, 0.05734784314] | 0.0001458679524 | pass | true |
| 9 | 256x60_s11 | 14 (2014) | ihtShare | 0 [0, 0.01916605706] | 0 [0, 0.01346978969] | 0 | 0 | 0 | 0.00958302853 | [0, 0.00958302853] | 0 | pass | true |
| 9 | 256x60_s11 | 15 (2015) | population | 181549 [178036, 182428] | 157082 [146745, 170157] | -24467 | -13.47680241 | 1815.49 | 2196 | [179353, 182428] | -22271 | fail | false |
| 9 | 256x60_s11 | 15 (2015) | approval | 69.99040013 [66.2917547, 71.14672034] | 69.22667991 [67.23956321, 70.71241139] | -0.763720223 | -1.091178535 | 0 | 2.427482822 | [67.56291731, 71.14672034] | 1.663762599 | pass | true |
| 9 | 256x60_s11 | 15 (2015) | air | 0.05146711125 [0.04574636654, 0.05654868993] | 0.0544430911 [0.05188795729, 0.06290392611] | 0.00297597985 | 5.782294319 | 0 | 0.005401161693 | [0.04606594956, 0.05654868993] | 0.002105598822 | pass | true |
| 9 | 256x60_s11 | 15 (2015) | ihtShare | 0 [0, 0.01881205994] | 0 [0, 0.009601660828] | 0 | 0 | 0 | 0.009406029969 | [0, 0.009406029969] | 0 | pass | true |
| 9 | 256x60_s11 | 16 (2016) | population | 201032 [198458, 202147] | 175715 [164801, 190071] | -25317 | -12.59351745 | 2010.32 | 2010.32 | [199021.68, 202147] | -23306.68 | fail | false |
| 9 | 256x60_s11 | 16 (2016) | approval | 70.95870622 [70.40255001, 72.31156213] | 70.5217926 [68.9983573, 71.39629174] | -0.4369136217 | -0.615729408 | 0 | 0.9545060629 | [70.40255001, 71.91321228] | 0.1192425894 | pass | true |
| 9 | 256x60_s11 | 16 (2016) | air | 0.05243901975 [0.04415267073, 0.0565367467] | 0.0527191022 [0.04953061855, 0.05990230422] | 0.000280082451 | 0.5341107677 | 0 | 0.006192037982 | [0.04624698176, 0.0565367467] | 0.0038176445 | pass | true |
| 9 | 256x60_s11 | 16 (2016) | ihtShare | 0 [0, 0.01864394696] | 0 [0, 0.006345909773] | 0 | 0 | 0 | 0.009321973478 | [0, 0.009321973478] | 0 | pass | true |
| 9 | 256x60_s11 | 17 (2017) | population | 220235 [217287, 221560] | 194160 [184076, 208931] | -26075 | -11.83962585 | 2202.35 | 2202.35 | [218032.65, 221560] | -23872.65 | fail | false |
| 9 | 256x60_s11 | 17 (2017) | approval | 71.2136114 [70.17472352, 72.37161013] | 70.72769277 [69.75289685, 72.02765926] | -0.4859186293 | -0.6823395413 | 0 | 1.098443306 | [70.17472352, 72.31205471] | 0.5529692484 | pass | true |
| 9 | 256x60_s11 | 17 (2017) | air | 0.05730607325 [0.05038313857, 0.06288494318] | 0.05356722923 [0.04922323546, 0.06240115762] | -0.003738844016 | -6.52434167 | 0 | 0.006250902304 | [0.05105517094, 0.06288494318] | 0.002512058288 | pass | true |
| 9 | 256x60_s11 | 17 (2017) | ihtShare | 0 [0, 0.01869225556] | 0 [0, 0.003812779385] | 0 | 0 | 0 | 0.009346127778 | [0, 0.009346127778] | 0 | pass | true |
| 9 | 256x60_s11 | 18 (2018) | population | 240111 [237922, 242097] | 212620 [203383, 229426] | -27491 | -11.44928804 | 2401.11 | 2401.11 | [237922, 242097] | -25302 | fail | false |
| 9 | 256x60_s11 | 18 (2018) | approval | 71.75804674 [70.81756667, 73.15318316] | 70.93731682 [70.46719615, 71.89436158] | -0.8207299188 | -1.143746181 | 0 | 1.167808246 | [70.81756667, 72.92585499] | 0.1197501478 | pass | true |
| 9 | 256x60_s11 | 18 (2018) | air | 0.0545566195 [0.05012809731, 0.06082287841] | 0.05845593826 [0.04832550689, 0.06566940013] | 0.003899318761 | 7.147288077 | 0 | 0.005347390548 | [0.05012809731, 0.05990401005] | 0.001448071787 | pass | true |
| 9 | 256x60_s11 | 18 (2018) | ihtShare | 0 [0, 0.0187645479] | 0 [0, 0.008579068558] | 0 | 0 | 0 | 0.009382273948 | [0, 0.009382273948] | 0 | pass | true |
| 9 | 256x60_s11 | 19 (2019) | population | 261751 [258901, 264481] | 232634 [221847, 250554] | -29117 | -11.12393076 | 2617.51 | 2790 | [258961, 264481] | -26327 | fail | false |
| 9 | 256x60_s11 | 19 (2019) | approval | 72.79350929 [72.03169892, 74.5682546] | 70.93337428 [70.25878054, 71.61320278] | -1.860135009 | -2.555358338 | 0 | 1.268277837 | [72.03169892, 74.06178713] | -1.098324639 | fail | true |
| 9 | 256x60_s11 | 19 (2019) | air | 0.05288659298 [0.05040153134, 0.05605219931] | 0.06042655485 [0.05288262118, 0.06866569924] | 0.007539961868 | 14.25684931 | 0 | 0.002825333982 | [0.05040153134, 0.05571192696] | -0.004714627885 | fail | false |
| 9 | 256x60_s11 | 19 (2019) | ihtShare | 0 [0, 0.01857826626] | 0 [0, 0.007990038394] | 0 | 0 | 0 | 0.009289133132 | [0, 0.009289133132] | 0 | pass | true |
| 9 | 256x60_s11 | 20 (2020) | population | 284274 [280865, 287234] | 254154 [242068, 271736] | -30120 | -10.59541147 | 2842.74 | 3184.5 | [281089.5, 287234] | -26935.5 | fail | false |
| 9 | 256x60_s11 | 20 (2020) | approval | 73.80951549 [72.99639975, 76.71686571] | 71.71414678 [69.29284151, 72.47206807] | -2.095368716 | -2.838886967 | 0 | 1.86023298 | [72.99639975, 75.66974847] | -1.282252978 | fail | true |
| 9 | 256x60_s11 | 20 (2020) | air | 0.05237887456 [0.04962951098, 0.05571692536] | 0.05733593596 [0.05254433949, 0.06208409998] | 0.004957061405 | 9.463856272 | 0 | 0.003043707191 | [0.04962951098, 0.05542258175] | -0.001913354214 | fail | true |
| 9 | 256x60_s11 | 20 (2020) | ihtShare | 0 [0, 0.01852379595] | 0 [0, 0.007786954323] | 0 | 0 | 0 | 0.009261897977 | [0, 0.009261897977] | 0 | pass | true |
| 9 | 256x60_s11 | 21 (2021) | population | 307076 [303929, 310168] | 276069 [263589, 295273] | -31007 | -10.09750029 | 3070.76 | 3119.5 | [303956.5, 310168] | -27887.5 | fail | false |
| 9 | 256x60_s11 | 21 (2021) | approval | 76.55271753 [75.18406494, 77.75408367] | 72.82749147 [71.87396896, 74.7582549] | -3.725226052 | -4.866223137 | 0 | 1.285009362 | [75.26770816, 77.75408367] | -2.44021669 | fail | false |
| 9 | 256x60_s11 | 21 (2021) | air | 0.05228719116 [0.04970068355, 0.05720274841] | 0.05600744262 [0.05270669591, 0.06104371017] | 0.003720251464 | 7.115034068 | 0 | 0.003751032432 | [0.04970068355, 0.05603822359] | 0.00003078096799 | pass | true |
| 9 | 256x60_s11 | 21 (2021) | ihtShare | 0 [0, 0.01858775772] | 0 [0, 0.007665250863] | 0 | 0 | 0 | 0.009293878859 | [0, 0.009293878859] | 0 | pass | true |
| 9 | 256x60_s11 | 22 (2022) | population | 331227 [327213, 333566] | 299194 [285844, 319012] | -32033 | -9.671011119 | 3312.27 | 3312.27 | [327914.73, 333566] | -28720.73 | fail | false |
| 9 | 256x60_s11 | 22 (2022) | approval | 77.20945433 [76.04791206, 77.48900359] | 75.50395855 [71.1393607, 76.65411749] | -1.705495785 | -2.208920914 | 0 | 0.7205457659 | [76.48890856, 77.48900359] | -0.9849500186 | fail | false |
| 9 | 256x60_s11 | 22 (2022) | air | 0.05457376169 [0.05017630248, 0.05841344147] | 0.05606904668 [0.05241974297, 0.0601705106] | 0.001495284989 | 2.739933886 | 0 | 0.004118569495 | [0.05045519219, 0.05841344147] | 0.002344394793 | pass | true |
| 9 | 256x60_s11 | 22 (2022) | ihtShare | 0 [0, 0.01857585139] | 0 [0, 0.007676713968] | 0 | 0 | 0 | 0.009287925697 | [0, 0.009287925697] | 0 | pass | true |
| 9 | 256x60_s11 | 23 (2023) | population | 354705 [350807, 357155] | 322372 [308860, 342452] | -32333 | -9.115462145 | 3547.05 | 3547.05 | [351157.95, 357155] | -28785.95 | fail | false |
| 9 | 256x60_s11 | 23 (2023) | approval | 77.29391853 [76.28875672, 77.93360708] | 75.36561497 [71.14522612, 77.43685901] | -1.928303555 | -2.494767495 | 0 | 0.82242518 | [76.47149335, 77.93360708] | -1.105878375 | fail | false |
| 9 | 256x60_s11 | 23 (2023) | air | 0.05773817249 [0.05498658602, 0.06238534093] | 0.05522259997 [0.0525231064, 0.05993555661] | -0.002515572524 | -4.356862047 | 0 | 0.003699377453 | [0.05498658602, 0.06143754995] | 0.0002360139454 | pass | true |
| 9 | 256x60_s11 | 23 (2023) | ihtShare | 0 [0, 0.01859437894] | 0 [0, 0.007673653789] | 0 | 0 | 0 | 0.00929718947 | [0, 0.00929718947] | 0 | pass | true |
| 9 | 256x60_s11 | 24 (2024) | population | 379628 [375350, 381880] | 345744 [332178, 365631] | -33884 | -8.925579778 | 3796.28 | 3796.28 | [375831.72, 381880] | -30087.72 | fail | false |
| 9 | 256x60_s11 | 24 (2024) | approval | 76.81842666 [76.46037695, 78.16919561] | 76.15589594 [75.05702805, 77.19242143] | -0.6625307189 | -0.8624632756 | 0 | 0.8544093308 | [76.46037695, 77.67283599] | -0.3044810088 | fail | true |
| 9 | 256x60_s11 | 24 (2024) | air | 0.05995732376 [0.05722897166, 0.06566557226] | 0.05990643386 [0.05269337846, 0.06599871564] | -0.00005088989316 | -0.08487685903 | 0 | 0.004218300299 | [0.05722897166, 0.06417562406] | 0.002677462204 | pass | true |
| 9 | 256x60_s11 | 24 (2024) | ihtShare | 0 [0, 0.01857132673] | 0 [0, 0.007677479394] | 0 | 0 | 0 | 0.009285663364 | [0, 0.009285663364] | 0 | pass | true |
| 9 | 256x60_s11 | 25 (2025) | population | 405373 [400281, 406789] | 370161 [355541, 390459] | -35212 | -8.686320993 | 4053.73 | 4053.73 | [401319.27, 406789] | -31158.27 | fail | false |
| 9 | 256x60_s11 | 25 (2025) | approval | 76.91201236 [76.26400544, 78.00487489] | 76.51863018 [75.62420224, 77.24408694] | -0.3933821897 | -0.5114704162 | 0 | 0.8704347247 | [76.26400544, 77.78244709] | 0.2546247372 | pass | true |
| 9 | 256x60_s11 | 25 (2025) | air | 0.06291292617 [0.05815019197, 0.06688977435] | 0.061759906 [0.05468431684, 0.06645370827] | -0.001153020172 | -1.832723801 | 0 | 0.004369791191 | [0.05854313498, 0.06688977435] | 0.003216771018 | pass | true |
| 9 | 256x60_s11 | 25 (2025) | ihtShare | 0 [0, 0.01857662412] | 0 [0, 0.007676713968] | 0 | 0 | 0 | 0.009288312059 | [0, 0.009288312059] | 0 | pass | true |
| 9 | 256x60_s11 | 26 (2026) | population | 431452 [426244, 432624] | 395020 [380315, 416931] | -36432 | -8.44404476 | 4314.52 | 4314.52 | [427137.48, 432624] | -32117.48 | fail | false |
| 9 | 256x60_s11 | 26 (2026) | approval | 77.53477369 [76.56468277, 78.24462532] | 76.96931472 [75.63920089, 77.90332122] | -0.5654589756 | -0.7292972543 | 0 | 0.8399712784 | [76.69480242, 78.24462532] | 0.2745123028 | pass | true |
| 9 | 256x60_s11 | 26 (2026) | air | 0.0614080896 [0.05641094525, 0.06705069123] | 0.06254250183 [0.05929645545, 0.0711592513] | 0.00113441223 | 1.847333532 | 0 | 0.00531987299 | [0.05641094525, 0.06672796259] | 0.004185460759 | pass | true |
| 9 | 256x60_s11 | 26 (2026) | ihtShare | 0 [0, 0.01844518178] | 0 [0, 0.007676458859] | 0 | 0 | 0 | 0.009222590888 | [0, 0.009222590888] | 0 | pass | true |
| 9 | 256x60_s11 | 27 (2027) | population | 459324 [454626, 460015] | 421716 [405212, 443932] | -37608 | -8.18768451 | 4593.24 | 4593.24 | [454730.76, 460015] | -33014.76 | fail | false |
| 9 | 256x60_s11 | 27 (2027) | approval | 77.59106086 [76.51653564, 78.80673236] | 77.07957755 [76.10813268, 78.24338813] | -0.5114833075 | -0.6592039106 | 0 | 1.145098362 | [76.51653564, 78.73615922] | 0.5630419145 | pass | true |
| 9 | 256x60_s11 | 27 (2027) | air | 0.06311390777 [0.05717494501, 0.06960806194] | 0.06127897366 [0.05876013161, 0.07134673668] | -0.001834934118 | -2.907337198 | 0 | 0.006216558465 | [0.05717494501, 0.06933046624] | 0.004104028646 | pass | true |
| 9 | 256x60_s11 | 27 (2027) | ihtShare | 0 [0, 0.01840819093] | 0 [0, 0.007674928567] | 0 | 0 | 0 | 0.009204095466 | [0, 0.009204095466] | 0 | pass | true |
| 9 | 256x60_s11 | 28 (2028) | population | 488133 [484568, 489945] | 449068 [432786, 472021] | -39065 | -8.002941821 | 4881.33 | 4881.33 | [484568, 489945] | -35500 | fail | false |
| 9 | 256x60_s11 | 28 (2028) | approval | 78.00395902 [77.09107632, 80.15943041] | 77.43850279 [76.74886167, 78.17921067] | -0.565456227 | -0.7249070869 | 0 | 1.534177044 | [77.09107632, 79.53813606] | 0.3474264682 | pass | true |
| 9 | 256x60_s11 | 28 (2028) | air | 0.06297985664 [0.05838485406, 0.07163948255] | 0.06332065728 [0.05922628232, 0.07084441326] | 0.0003408006413 | 0.5411264164 | 0 | 0.006627314243 | [0.05838485406, 0.06960717089] | 0.004935803221 | pass | true |
| 9 | 256x60_s11 | 28 (2028) | ihtShare | 0 [0, 0.01840468873] | 0 [0, 0.007668558908] | 0 | 0 | 0 | 0.009202344364 | [0, 0.009202344364] | 0 | pass | true |
| 9 | 256x60_s11 | 29 (2029) | population | 518809 [515169, 520829] | 478054 [461060, 501010] | -40755 | -7.855492098 | 5188.09 | 5188.09 | [515169, 520829] | -37115 | fail | false |
| 9 | 256x60_s11 | 29 (2029) | approval | 80.26676226 [78.81777571, 81.60092264] | 77.60725126 [76.55716565, 78.62310261] | -2.659510997 | -3.313340319 | 0 | 1.391573466 | [78.87518879, 81.60092264] | -1.267937531 | fail | true |
| 9 | 256x60_s11 | 29 (2029) | air | 0.06534412086 [0.0614472908, 0.07501475024] | 0.06570976622 [0.06184069746, 0.06877621614] | 0.0003656453593 | 0.5595688709 | 0 | 0.006783729724 | [0.0614472908, 0.07212785058] | 0.004262475419 | pass | true |
| 9 | 256x60_s11 | 29 (2029) | ihtShare | 0 [0, 0.01852915829] | 0 [0, 0.007611202636] | 0 | 0 | 0 | 0.009264579144 | [0, 0.009264579144] | 0 | pass | true |
| 9 | 256x60_s11 | 30 (2030) | population | 549130 [545987, 551504] | 508043 [490400, 531451] | -41087 | -7.482199115 | 5491.3 | 5491.3 | [545987, 551504] | -37944 | fail | false |
| 9 | 256x60_s11 | 30 (2030) | approval | 81.44040119 [79.23201317, 81.86017011] | 77.96311083 [77.29374033, 80.19548441] | -3.477290362 | -4.269736287 | 0 | 1.314078473 | [80.12632272, 81.86017011] | -2.163211889 | fail | false |
| 9 | 256x60_s11 | 30 (2030) | air | 0.06974128388 [0.06287188925, 0.07690397234] | 0.06738778978 [0.06462287454, 0.07286180164] | -0.002353494098 | -3.374606786 | 0 | 0.007016041545 | [0.06287188925, 0.07675732542] | 0.004515900532 | pass | true |
| 9 | 256x60_s11 | 30 (2030) | ihtShare | 0 [0, 0.01851851852] | 0 [0, 0.007140207715] | 0 | 0 | 0 | 0.009259259259 | [0, 0.009259259259] | 0 | pass | true |
| 9 | 256x60_s11 | 31 (2031) | population | 580247 [577395, 583309] | 539847 [520584, 562400] | -40400 | -6.962552155 | 5802.47 | 5802.47 | [577395, 583309] | -37548 | fail | false |
| 9 | 256x60_s11 | 31 (2031) | approval | 81.86067262 [80.9234805, 82.37237321] | 79.71651949 [77.97306131, 81.45640992] | -2.144153122 | -2.619271322 | 0 | 0.7244463534 | [81.13622626, 82.37237321] | -1.419706768 | fail | false |
| 9 | 256x60_s11 | 31 (2031) | air | 0.07449274782 [0.06750458358, 0.0834208008] | 0.07159613034 [0.06735404389, 0.07480608421] | -0.002896617486 | -3.888455683 | 0 | 0.00795810861 | [0.06750458358, 0.08245085643] | 0.004091546755 | pass | true |
| 9 | 256x60_s11 | 31 (2031) | ihtShare | 0 [0, 0.01791406791] | 0 [0, 0.007098518837] | 0 | 0 | 0 | 0.008957033957 | [0, 0.008957033957] | 0 | pass | true |
| 9 | 256x60_s11 | 32 (2032) | population | 613277 [608730, 615409] | 570929 [551496, 593284] | -42348 | -6.905199445 | 6132.77 | 6132.77 | [608730, 615409] | -37801 | fail | false |
| 9 | 256x60_s11 | 32 (2032) | approval | 82.08038268 [81.53994577, 82.81754599] | 81.07658138 [79.12943793, 81.976905] | -1.003801301 | -1.2229491 | 0 | 0.6388001119 | [81.53994577, 82.71918279] | -0.4633643874 | fail | true |
| 9 | 256x60_s11 | 32 (2032) | air | 0.07751288646 [0.0712081238, 0.08589828281] | 0.07550049257 [0.07063795761, 0.07999098815] | -0.002012393881 | -2.596205577 | 0 | 0.007345079508 | [0.0712081238, 0.08485796596] | 0.004292368777 | pass | true |
| 9 | 256x60_s11 | 32 (2032) | ihtShare | 0 [0, 0.01742568949] | 0 [0, 0.006970218159] | 0 | 0 | 0 | 0.008712844744 | [0, 0.008712844744] | 0 | pass | true |
| 9 | 256x60_s11 | 33 (2033) | population | 645069 [641046, 648681] | 603203 [582890, 625356] | -41866 | -6.490158417 | 6450.69 | 6450.69 | [641046, 648681] | -37843 | fail | false |
| 9 | 256x60_s11 | 33 (2033) | approval | 82.36191775 [81.4447746, 83.29492193] | 81.72114244 [79.87445047, 82.51037373] | -0.6407753096 | -0.7779995016 | 0 | 0.9250736675 | [81.4447746, 83.28699142] | 0.2763678446 | pass | true |
| 9 | 256x60_s11 | 33 (2033) | air | 0.08373253689 [0.07432911253, 0.09083149239] | 0.07777220033 [0.07602352484, 0.08258659964] | -0.00596033656 | -7.118304045 | 0 | 0.00825118993 | [0.07548134696, 0.09083149239] | 0.002290853369 | pass | true |
| 9 | 256x60_s11 | 33 (2033) | ihtShare | 0 [0, 0.0135083954] | 0 [0, 0.006738819686] | 0 | 0 | 0 | 0.006754197702 | [0, 0.006754197702] | 0 | pass | true |
| 9 | 256x60_s11 | 34 (2034) | population | 678240 [671270, 681039] | 634852 [614389, 657308] | -43388 | -6.397145553 | 6782.4 | 6782.4 | [671457.6, 681039] | -36605.6 | fail | false |
| 9 | 256x60_s11 | 34 (2034) | approval | 82.48275178 [81.61488495, 82.96944983] | 82.06885687 [81.21337311, 83.09718764] | -0.4138949164 | -0.5017957178 | 0 | 0.6772824408 | [81.80546934, 82.96944983] | 0.2633875244 | pass | true |
| 9 | 256x60_s11 | 34 (2034) | air | 0.08674672979 [0.07677897971, 0.1017339747] | 0.08463124565 [0.07977047858, 0.09219568958] | -0.002115484138 | -2.438690361 | 0 | 0.01247749747 | [0.07677897971, 0.09922422726] | 0.007852265937 | pass | true |
| 9 | 256x60_s11 | 34 (2034) | ihtShare | 0 [0, 0.009776039815] | 0 [0, 0.002119752237] | 0 | 0 | 0 | 0.004888019908 | [0, 0.004888019908] | 0 | pass | true |
| 9 | 256x60_s11 | 35 (2035) | population | 711356 [705812, 714537] | 667812 [647549, 690961] | -43544 | -6.121266989 | 7113.56 | 7113.56 | [705812, 714537] | -38000 | fail | false |
| 9 | 256x60_s11 | 35 (2035) | approval | 82.52937431 [81.2325811, 82.89214726] | 82.39201611 [81.35413637, 82.96510758] | -0.1373581977 | -0.1664355254 | 0 | 0.8297830817 | [81.69959122, 82.89214726] | 0.500131156 | pass | true |
| 9 | 256x60_s11 | 35 (2035) | air | 0.09383457071 [0.08387349383, 0.1001168765] | 0.08751076251 [0.08429105412, 0.09331197982] | -0.006323808201 | -6.739315961 | 0 | 0.008121691311 | [0.0857128794, 0.1001168765] | 0.00179788311 | pass | true |
| 9 | 256x60_s11 | 35 (2035) | ihtShare | 0 [0, 0.009150877193] | 0 [0, 0.002006776127] | 0 | 0 | 0 | 0.004575438596 | [0, 0.004575438596] | 0 | pass | true |
| 9 | 256x60_s11 | 36 (2036) | population | 744626 [738362, 749055] | 701131 [679945, 724078] | -43495 | -5.841187388 | 7446.26 | 7446.26 | [738362, 749055] | -37231 | fail | false |
| 9 | 256x60_s11 | 36 (2036) | approval | 82.58301146 [81.85118079, 83.80687834] | 82.31504022 [81.75529892, 83.11437325] | -0.2679712418 | -0.3244871276 | 0 | 0.9778487743 | [81.85118079, 83.56086024] | 0.4638594277 | pass | true |
| 9 | 256x60_s11 | 36 (2036) | air | 0.1008104819 [0.0902128351, 0.1074883004] | 0.0934854205 [0.09024419248, 0.0990169568] | -0.007325061373 | -7.26617038 | 0 | 0.008637732657 | [0.09217274921, 0.1074883004] | 0.001312671284 | pass | true |
| 9 | 256x60_s11 | 36 (2036) | ihtShare | 0 [0, 0.004346566213] | 0 [0, 0] | 0 | 0 | 0 | 0.002173283106 | [0, 0.002173283106] | 0 | pass | true |
| 9 | 256x60_s11 | 37 (2037) | population | 778119 [773730, 782802] | 732614 [713331, 757658] | -45505 | -5.848077222 | 7781.19 | 7781.19 | [773730, 782802] | -41116 | fail | false |
| 9 | 256x60_s11 | 37 (2037) | approval | 82.64875723 [82.04106939, 83.14376412] | 82.39366048 [81.17131857, 83.71896494] | -0.2550967469 | -0.3086516427 | 0 | 0.5513473674 | [82.09740986, 83.14376412] | 0.2962506205 | pass | true |
| 9 | 256x60_s11 | 37 (2037) | air | 0.1034456881 [0.09309862573, 0.1137852842] | 0.1001026267 [0.09481648331, 0.1060205888] | -0.003343061312 | -3.231706777 | 0 | 0.01034332922 | [0.09310235883, 0.1137852842] | 0.007000267906 | pass | true |
| 9 | 256x60_s11 | 37 (2037) | ihtShare | 0 [0, 0.004135960295] | 0 [0, 0] | 0 | 0 | 0 | 0.002067980147 | [0, 0.002067980147] | 0 | pass | true |
| 9 | 256x60_s11 | 38 (2038) | population | 813825 [807517, 817770] | 767204 [747658, 791635] | -46621 | -5.728627162 | 8138.25 | 8138.25 | [807517, 817770] | -40313 | fail | false |
| 9 | 256x60_s11 | 38 (2038) | approval | 82.24960982 [81.4223369, 82.95403764] | 82.37043938 [80.70163295, 83.14037682] | 0.120829565 | 0.1469059431 | 0 | 0.7658503678 | [81.48375945, 82.95403764] | 0.5835982589 | pass | true |
| 9 | 256x60_s11 | 38 (2038) | air | 0.1088269496 [0.09753072958, 0.1192796154] | 0.1040808942 [0.1013021498, 0.1109144865] | -0.004746055353 | -4.361102991 | 0 | 0.0108744429 | [0.09795250668, 0.1192796154] | 0.006128387548 | pass | true |
| 9 | 256x60_s11 | 38 (2038) | ihtShare | 0 [0, 0.004097851732] | 0 [0, 0] | 0 | 0 | 0 | 0.002048925866 | [0, 0.002048925866] | 0 | pass | true |
| 9 | 256x60_s11 | 39 (2039) | population | 845902 [841049, 853196] | 800416 [780955, 827538] | -45486 | -5.377218638 | 8459.02 | 8459.02 | [841049, 853196] | -40633 | fail | false |
| 9 | 256x60_s11 | 39 (2039) | approval | 82.56106021 [81.55621448, 83.17982484] | 81.62889492 [80.69557156, 82.58776582] | -0.932165291 | -1.129061677 | 0 | 0.8118051828 | [81.74925503, 83.17982484] | -0.1203601082 | fail | true |
| 9 | 256x60_s11 | 39 (2039) | air | 0.1172818654 [0.1039987849, 0.1260569594] | 0.1126968765 [0.1066867548, 0.1162234633] | -0.004584988932 | -3.909375858 | 0 | 0.01102908723 | [0.1062527782, 0.1260569594] | 0.006444098296 | pass | true |
| 9 | 256x60_s11 | 39 (2039) | ihtShare | 0 [0, 0.004111329828] | 0 [0, 0] | 0 | 0 | 0 | 0.002055664914 | [0, 0.002055664914] | 0 | pass | true |
| 9 | 256x60_s11 | 40 (2040) | population | 883512 [878323, 889836] | 834909 [816309, 862908] | -48603 | -5.501113737 | 8835.12 | 8835.12 | [878323, 889836] | -43414 | fail | false |
| 9 | 256x60_s11 | 40 (2040) | approval | 82.92211563 [81.94548392, 83.25791323] | 81.59294319 [81.2279754, 82.62486347] | -1.329172442 | -1.602916703 | 0 | 0.6562146561 | [82.26590097, 83.25791323] | -0.6729577858 | fail | false |
| 9 | 256x60_s11 | 40 (2040) | air | 0.1192250227 [0.1063159767, 0.1298870237] | 0.1176669114 [0.1092145641, 0.1245948012] | -0.001558111312 | -1.306866023 | 0 | 0.01178552348 | [0.1074394992, 0.1298870237] | 0.01022741216 | pass | true |
| 9 | 256x60_s11 | 40 (2040) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 41 (2041) | population | 914777 [913253, 927072] | 872331 [851991, 898943] | -42446 | -4.640037955 | 9147.77 | 9147.77 | [913253, 923924.77] | -40922 | fail | false |
| 9 | 256x60_s11 | 41 (2041) | approval | 82.30204422 [81.13102109, 82.88199613] | 82.31382633 [81.40240936, 82.96064381] | 0.01178211756 | 0.01431570463 | 0 | 0.8754875202 | [81.4265567, 82.88199613] | 0.5681697966 | pass | true |
| 9 | 256x60_s11 | 41 (2041) | air | 0.1241339084 [0.1114274818, 0.1426966907] | 0.1213239386 [0.1141992671, 0.1322755688] | -0.002809969793 | -2.263660131 | 0 | 0.01563460444 | [0.1114274818, 0.1397685128] | 0.009896456773 | pass | true |
| 9 | 256x60_s11 | 41 (2041) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 42 (2042) | population | 955849 [947049, 962805] | 907818 [885588, 935729] | -48031 | -5.024956871 | 9558.49 | 9558.49 | [947049, 962805] | -39231 | fail | false |
| 9 | 256x60_s11 | 42 (2042) | approval | 82.1685555 [81.58360699, 82.85594897] | 82.15740914 [81.74930947, 82.74840079] | -0.01114635839 | -0.01356523591 | 0 | 0.6361709929 | [81.58360699, 82.80472649] | 0.5738021479 | pass | true |
| 9 | 256x60_s11 | 42 (2042) | air | 0.1287609642 [0.115737144, 0.1445750507] | 0.127466011 [0.1218615336, 0.1360454769] | -0.001294953133 | -1.005703197 | 0 | 0.01441895338 | [0.115737144, 0.1431799176] | 0.01172886708 | pass | true |
| 9 | 256x60_s11 | 42 (2042) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 43 (2043) | population | 993905 [981631, 999561] | 945232 [922914, 970769] | -48673 | -4.897148118 | 9939.05 | 9939.05 | [983965.95, 999561] | -38733.95 | fail | false |
| 9 | 256x60_s11 | 43 (2043) | approval | 82.00465632 [81.00547299, 82.46245239] | 82.17982924 [81.12532066, 82.67805323] | 0.1751729219 | 0.2136133845 | 0 | 0.7284896982 | [81.27616662, 82.46245239] | 0.2826231418 | pass | true |
| 9 | 256x60_s11 | 43 (2043) | air | 0.1323431422 [0.1168478751, 0.1466114374] | 0.1309049131 [0.1226224776, 0.1397630379] | -0.001438229161 | -1.086742491 | 0 | 0.01488178115 | [0.1174613611, 0.1466114374] | 0.01344355198 | pass | true |
| 9 | 256x60_s11 | 43 (2043) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 44 (2044) | population | 1031139 [1017766, 1038005] | 978657 [958138, 1009297] | -52482 | -5.089711474 | 10311.39 | 10311.39 | [1020827.61, 1038005] | -42170.61 | fail | false |
| 9 | 256x60_s11 | 44 (2044) | approval | 81.67388548 [80.85613817, 82.3516541] | 82.20218285 [80.84789651, 82.86986629] | 0.5282973684 | 0.6468375605 | 0 | 0.747757968 | [80.92612751, 82.3516541] | 0.1494712534 | pass | true |
| 9 | 256x60_s11 | 44 (2044) | air | 0.1390369719 [0.127841465, 0.1533044999] | 0.1343551157 [0.1273787916, 0.1397535028] | -0.004681856204 | -3.36734621 | 0 | 0.01273151745 | [0.127841465, 0.1517684893] | 0.006513650651 | pass | true |
| 9 | 256x60_s11 | 44 (2044) | ihtShare | 0 [0, 0] | 0 [0, 0] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 45 (2045) | population | 1069790 [1055287, 1076009] | 1014968 [994838, 1045852] | -54822 | -5.124557156 | 10697.9 | 10697.9 | [1059092.1, 1076009] | -44124.1 | fail | false |
| 9 | 256x60_s11 | 45 (2045) | approval | 81.36202709 [80.19805909, 82.47122756] | 81.50654338 [80.64804865, 82.36079561] | 0.144516289 | 0.1776212985 | 0 | 1.136584232 | [80.22544286, 82.47122756] | 0.9646841767 | pass | true |
| 9 | 256x60_s11 | 45 (2045) | air | 0.1432531656 [0.1333436385, 0.1582652729] | 0.1396452284 [0.1338942476, 0.1460786031] | -0.003607937264 | -2.518574196 | 0 | 0.01246081718 | [0.1333436385, 0.1557139828] | 0.006301589861 | pass | true |
| 9 | 256x60_s11 | 45 (2045) | ihtShare | 0 [0, 0] | 0 [0, 0.01242842213] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 46 (2046) | population | 1109236 [1094324, 1115154] | 1056630 [1030351, 1079727] | -52606 | -4.742543516 | 11092.36 | 11092.36 | [1098143.64, 1115154] | -41513.64 | fail | false |
| 9 | 256x60_s11 | 46 (2046) | approval | 81.15689888 [80.38641199, 81.55480341] | 81.06094937 [80.28047535, 82.15073015] | -0.09594950724 | -0.118227173 | 0 | 0.5841957135 | [80.57270316, 81.55480341] | 0.4882462062 | pass | true |
| 9 | 256x60_s11 | 46 (2046) | air | 0.1519717894 [0.1357195976, 0.1599063541] | 0.144806118 [0.1373714661, 0.147418287] | -0.00716567134 | -4.715132571 | 0 | 0.01209337828 | [0.1398784111, 0.1599063541] | 0.004927706936 | pass | true |
| 9 | 256x60_s11 | 46 (2046) | ihtShare | 0 [0, 0] | 0 [0, 0.02273938533] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 47 (2047) | population | 1147038 [1132339, 1152325] | 1092633 [1072294, 1117525] | -54405 | -4.743086105 | 11470.38 | 11470.38 | [1135567.62, 1152325] | -42934.62 | fail | false |
| 9 | 256x60_s11 | 47 (2047) | approval | 80.61678777 [79.54124608, 81.87627023] | 81.21925959 [79.80469557, 81.49533153] | 0.6024718249 | 0.7473279966 | 0 | 1.167512076 | [79.54124608, 81.78429985] | 0.5650402512 | pass | true |
| 9 | 256x60_s11 | 47 (2047) | air | 0.1571084706 [0.1384097742, 0.1691387619] | 0.1494094799 [0.141799927, 0.1546846279] | -0.007698990675 | -4.900430032 | 0 | 0.01536449385 | [0.1417439767, 0.1691387619] | 0.007665503177 | pass | true |
| 9 | 256x60_s11 | 47 (2047) | ihtShare | 0 [0, 0] | 0 [0, 0.03418634033] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 48 (2048) | population | 1186645 [1169316, 1190815] | 1131814 [1107154, 1154533] | -54831 | -4.620674254 | 11866.45 | 11866.45 | [1174778.55, 1190815] | -42964.55 | fail | false |
| 9 | 256x60_s11 | 48 (2048) | approval | 81.30027825 [79.77912608, 81.82341419] | 80.6347039 [79.63566392, 81.62662912] | -0.6655743529 | -0.8186618388 | 0 | 1.022144052 | [80.2781342, 81.82341419] | 0.3565696992 | pass | true |
| 9 | 256x60_s11 | 48 (2048) | air | 0.1539436622 [0.1401538809, 0.1718086539] | 0.152145379 [0.1382834524, 0.1580500036] | -0.001798283176 | -1.16814369 | 0 | 0.0158273865 | [0.1401538809, 0.1697710487] | 0.01199149813 | pass | true |
| 9 | 256x60_s11 | 48 (2048) | ihtShare | 0 [0, 0] | 0 [0, 0.05331081896] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 49 (2049) | population | 1230333 [1209924, 1233587] | 1170273 [1145695, 1194916] | -60060 | -4.881605224 | 12303.33 | 12303.33 | [1218029.67, 1233587] | -47756.67 | fail | false |
| 9 | 256x60_s11 | 49 (2049) | approval | 80.53417522 [79.83050167, 81.4235582] | 80.64222179 [79.57704177, 81.23195362] | 0.1080465679 | 0.1341623821 | 0 | 0.7965282667 | [79.83050167, 81.33070348] | 0.6884816988 | pass | true |
| 9 | 256x60_s11 | 49 (2049) | air | 0.1552666702 [0.1444448796, 0.173847097] | 0.1556214836 [0.1425714845, 0.1588374594] | 0.0003548133825 | 0.228518704 | 0 | 0.01470110872 | [0.1444448796, 0.169967779] | 0.01117660404 | pass | true |
| 9 | 256x60_s11 | 49 (2049) | ihtShare | 0 [0, 0] | 0 [0, 0.05684687652] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 50 (2050) | population | 1266953 [1254073, 1276465] | 1206863 [1187658, 1237372] | -60090 | -4.742875229 | 12669.53 | 12669.53 | [1254283.47, 1276465] | -47420.47 | fail | false |
| 9 | 256x60_s11 | 50 (2050) | approval | 80.82217177 [79.83074281, 81.32143553] | 80.71892883 [80.08563754, 81.89020439] | -0.1032429413 | -0.127740865 | 0 | 0.745346363 | [80.07682541, 81.32143553] | 0.6025067036 | pass | true |
| 9 | 256x60_s11 | 50 (2050) | air | 0.1632612259 [0.1406264164, 0.1742082937] | 0.1552154771 [0.14100933, 0.1638457838] | -0.008045748711 | -4.928144248 | 0 | 0.01679093868 | [0.1464702872, 0.1742082937] | 0.008745189971 | pass | true |
| 9 | 256x60_s11 | 50 (2050) | ihtShare | 0 [0, 0] | 0 [0, 0.06768889881] | 0 | 0 | 0 | 0 | [0, 0] | 0 | pass | true |
| 9 | 256x60_s11 | 51 (2051) | population | 1310276 [1295571, 1317330] | 1251985 [1201219, 1277641] | -58291 | -4.448757361 | 13102.76 | 13102.76 | [1297173.24, 1317330] | -45188.24 | fail | false |
| 9 | 256x60_s11 | 51 (2051) | approval | 80.42179852 [79.66337622, 80.89282769] | 80.89730142 [79.68278455, 81.48178976] | 0.4755029036 | 0.5912612157 | 0 | 0.6147257344 | [79.80707278, 80.89282769] | -0.004473728903 | fail | true |
| 9 | 256x60_s11 | 51 (2051) | air | 0.1614402073 [0.1464726793, 0.1751268429] | 0.1620198069 [0.1441335073, 0.1655375552] | 0.0005795995638 | 0.3590180993 | 0 | 0.01432708183 | [0.1471131255, 0.1751268429] | 0.01310703602 | pass | true |
| 9 | 256x60_s11 | 51 (2051) | ihtShare | 0 [0, 0.01001936682] | 0 [0, 0.07401259949] | 0 | 0 | 0 | 0.005009683412 | [0, 0.005009683412] | 0 | pass | true |
| 9 | 256x60_s11 | 52 (2052) | population | 1353432 [1335822, 1358146] | 1291903 [1216389, 1321482] | -61529 | -4.546146389 | 13534.32 | 13534.32 | [1339897.68, 1358146] | -47994.68 | fail | false |
| 9 | 256x60_s11 | 52 (2052) | approval | 80.53233881 [79.59390783, 80.72519232] | 80.52580911 [79.77294453, 81.55628244] | -0.006529704079 | -0.008108176387 | 0 | 0.5656422459 | [79.96669656, 80.72519232] | 0.1993832133 | pass | true |
| 9 | 256x60_s11 | 52 (2052) | air | 0.1638558121 [0.1438624046, 0.1808752239] | 0.1625080917 [0.1489940825, 0.1722871756] | -0.001347720457 | -0.8225039073 | 0 | 0.01850640963 | [0.1453494025, 0.1808752239] | 0.01715868918 | pass | true |
| 9 | 256x60_s11 | 52 (2052) | ihtShare | 0.005202820997 [0, 0.01252123456] | 0 [0, 0.08120938615] | -0.005202820997 | -100 | 0 | 0.006260617282 | [0, 0.01146343828] | 0 | pass | true |
| 9 | 256x60_s11 | 53 (2053) | population | 1391300 [1372356, 1404494] | 1334456 [1217398, 1364958] | -56844 | -4.085675268 | 13913 | 16069 | [1375231, 1404494] | -40775 | fail | false |
| 9 | 256x60_s11 | 53 (2053) | approval | 80.81411087 [79.31384766, 81.18726939] | 80.16445492 [79.40682253, 80.56688263] | -0.6496559439 | -0.8038892428 | 0 | 0.9367108666 | [79.8774, 81.18726939] | 0.2870549227 | pass | true |
| 9 | 256x60_s11 | 53 (2053) | air | 0.1616330195 [0.1428250091, 0.1826576173] | 0.1625194937 [0.1428539779, 0.1706168643] | 0.0008864742169 | 0.5484487142 | 0 | 0.01991630411 | [0.1428250091, 0.1815493236] | 0.0190298299 | pass | true |
| 9 | 256x60_s11 | 53 (2053) | ihtShare | 0.01610534701 [0, 0.025] | 0.00176356179 [0, 0.09264062421] | -0.01434178522 | -89.04983675 | 0 | 0.0125 | [0.003605347014, 0.025] | -0.001841785223 | fail | true |
| 9 | 256x60_s11 | 54 (2054) | population | 1410655 [1388950, 1450423] | 1368175 [1226920, 1406993] | -42480 | -3.01136706 | 14106.55 | 30736.5 | [1388950, 1441391.5] | -20775 | fail | true |
| 9 | 256x60_s11 | 54 (2054) | approval | 80.42361043 [79.70134958, 81.51072777] | 79.89415134 [79.27108596, 80.9362708] | -0.5294590838 | -0.6583378699 | 0 | 0.9046890918 | [79.70134958, 81.32829952] | 0.1928017594 | pass | true |
| 9 | 256x60_s11 | 54 (2054) | air | 0.1640567885 [0.1433599574, 0.1808285073] | 0.1634266798 [0.147062217, 0.1694265447] | -0.0006301086839 | -0.3840796164 | 0 | 0.01873427495 | [0.1453225135, 0.1808285073] | 0.01740182746 | pass | true |
| 9 | 256x60_s11 | 54 (2054) | ihtShare | 0.02567348687 [0, 0.03162642268] | 0.01114565668 [0, 0.1022132939] | -0.01452783019 | -56.5868994 | 0 | 0.01581321134 | [0.009860275525, 0.03162642268] | 0.001285381155 | pass | true |
| 9 | 256x60_s11 | 55 (2055) | population | 1428499 [1386414, 1468215] | 1381428 [1225951, 1436055] | -47071 | -3.295137063 | 14284.99 | 40900.5 | [1387598.5, 1468215] | -6170.5 | fail | true |
| 9 | 256x60_s11 | 55 (2055) | approval | 80.74035446 [79.9308202, 81.71725752] | 79.8924593 [79.21678525, 81.27355081] | -0.8478951558 | -1.050150401 | 0 | 0.8932186614 | [79.9308202, 81.63357312] | -0.03836089319 | fail | true |
| 9 | 256x60_s11 | 55 (2055) | air | 0.165500896 [0.1448856511, 0.1840435431] | 0.1627324087 [0.1466252411, 0.171488278] | -0.002768487329 | -1.672792955 | 0 | 0.01957894595 | [0.14592195, 0.1840435431] | 0.01681045862 | pass | true |
| 9 | 256x60_s11 | 55 (2055) | ihtShare | 0.02858932898 [0, 0.04062968787] | 0.01929487241 [0, 0.1180151349] | -0.00929445657 | -32.51022987 | 0 | 0.02031484393 | [0.008274485051, 0.04062968787] | 0.01102038736 | pass | true |
| 9 | 256x60_s11 | 56 (2056) | population | 1444001 [1400344, 1478360] | 1398899 [1236771, 1445888] | -45102 | -3.123405039 | 14440.01 | 39008 | [1404993, 1478360] | -6094 | fail | true |
| 9 | 256x60_s11 | 56 (2056) | approval | 80.37563131 [80.11060148, 80.92261892] | 80.11515404 [79.30924045, 81.03534565] | -0.2604772651 | -0.3240749227 | 0 | 0.4060087196 | [80.11060148, 80.78164003] | 0.004552561147 | pass | true |
| 9 | 256x60_s11 | 56 (2056) | air | 0.1638482235 [0.1447515442, 0.1794281601] | 0.1667237491 [0.1459777422, 0.1720514777] | 0.002875525558 | 1.75499343 | 0 | 0.01733830792 | [0.1465099156, 0.1794281601] | 0.01270441099 | pass | true |
| 9 | 256x60_s11 | 56 (2056) | ihtShare | 0.04127067702 [0, 0.05686618079] | 0.02966020757 [0, 0.1288274532] | -0.01161046945 | -28.13249089 | 0 | 0.0284330904 | [0.01283758663, 0.05686618079] | 0.01682262094 | pass | true |
| 9 | 256x60_s11 | 57 (2057) | population | 1456317 [1403945, 1487877] | 1411981 [1261215, 1456925] | -44336 | -3.044392121 | 14563.17 | 41966 | [1414351, 1487877] | -2370 | fail | true |
| 9 | 256x60_s11 | 57 (2057) | approval | 80.32917658 [79.07665525, 81.11718024] | 80.26915051 [78.74372224, 80.65700486] | -0.06002606873 | -0.07472511394 | 0 | 1.020262495 | [79.30891409, 81.11718024] | 0.8480297256 | pass | true |
| 9 | 256x60_s11 | 57 (2057) | air | 0.1686174775 [0.1459097469, 0.1865505337] | 0.1642332156 [0.1436090334, 0.1702506606] | -0.004384261922 | -2.600123064 | 0 | 0.02032039338 | [0.1482970841, 0.1865505337] | 0.01593613145 | pass | true |
| 9 | 256x60_s11 | 57 (2057) | ihtShare | 0.04896346982 [0, 0.0863655154] | 0.03848652479 [0, 0.1374310253] | -0.01047694502 | -21.39747257 | 0 | 0.0431827577 | [0.005780712119, 0.0863655154] | 0.03270581268 | pass | true |
| 9 | 256x60_s11 | 58 (2058) | population | 1462768 [1414561, 1491615] | 1419563 [1263833, 1469306] | -43205 | -2.953646785 | 14627.68 | 38527 | [1424241, 1491615] | -4678 | fail | true |
| 9 | 256x60_s11 | 58 (2058) | approval | 80.21296639 [79.51884343, 80.86356599] | 80.06723779 [78.10998851, 81.10967373] | -0.1457286022 | -0.1816771137 | 0 | 0.6723612796 | [79.54060511, 80.86356599] | 0.5266326775 | pass | true |
| 9 | 256x60_s11 | 58 (2058) | air | 0.1686960201 [0.1424713535, 0.1822657263] | 0.1674984503 [0.1420376789, 0.1748627555] | -0.001197569791 | -0.7098980701 | 0 | 0.01989718637 | [0.1487988337, 0.1822657263] | 0.01476727598 | pass | true |
| 9 | 256x60_s11 | 58 (2058) | ihtShare | 0.05092646351 [0, 0.09898710137] | 0.04492406351 [0, 0.1483255116] | -0.006002400006 | -11.7864065 | 0 | 0.04949355068 | [0.001432912829, 0.09898710137] | 0.04349115068 | pass | true |
| 9 | 256x60_s11 | 59 (2059) | population | 1482680 [1416617, 1504263] | 1424104 [1269752, 1480780] | -58576 | -3.950683897 | 14826.8 | 43823 | [1438857, 1504263] | -14753 | fail | true |
| 9 | 256x60_s11 | 59 (2059) | approval | 80.10278542 [79.69065754, 80.82700816] | 80.02559904 [79.04074098, 80.77079714] | -0.07718638129 | -0.09635917263 | 0 | 0.5681753098 | [79.69065754, 80.67096073] | 0.3349415001 | pass | true |
| 9 | 256x60_s11 | 59 (2059) | air | 0.1626696819 [0.1473044973, 0.1829738232] | 0.1694845824 [0.1396811971, 0.1766184017] | 0.006814900439 | 4.189410319 | 0 | 0.01783466296 | [0.1473044973, 0.1805043449] | 0.01101976252 | pass | true |
| 9 | 256x60_s11 | 59 (2059) | ihtShare | 0.07086746718 [0, 0.1009583673] | 0.05913673209 [0, 0.1485972794] | -0.01173073508 | -16.55306102 | 0 | 0.05047918364 | [0.02038828353, 0.1009583673] | 0.03874844856 | pass | true |
| 9 | 256x60_s11 | 60 (2060) | population | 1483518 [1427340, 1511108] | 1433346 [1276729, 1503722] | -50172 | -3.381960987 | 14835.18 | 41884 | [1441634, 1511108] | -8288 | fail | true |
| 9 | 256x60_s11 | 60 (2060) | approval | 80.44119872 [79.13716727, 81.35669456] | 80.08316611 [79.26737799, 81.15688928] | -0.3580326172 | -0.4450861286 | 0 | 1.109763647 | [79.33143508, 81.35669456] | 0.7517310294 | pass | true |
| 9 | 256x60_s11 | 60 (2060) | air | 0.1707497937 [0.1474850575, 0.1905127344] | 0.1697226611 [0.1407599336, 0.1739877498] | -0.001027132545 | -0.6015424809 | 0 | 0.02151383845 | [0.1492359552, 0.1905127344] | 0.02048670591 | pass | true |
| 9 | 256x60_s11 | 60 (2060) | ihtShare | 0.08191000329 [0, 0.105790072] | 0.07395224912 [0, 0.1492415482] | -0.007957754172 | -9.715240939 | 0 | 0.052895036 | [0.02901496729, 0.105790072] | 0.03183782288 | pass | true |

## Systematic shifts at row endpoints

The short row contributes year 15, and the two long rows year 60. A same-direction delta beyond one quarter of each dev band on all three rows is reported as a real shift requiring investigation.

| Stage | Metric | Common shift | Direction | Endpoint evidence: lane minus dev; quarter dev band |
|---:|---|---|---|---|
| 5 | population | false | none | 128x15_s7: 3791; 744; 256x60_s7: 84852; 33478.25; 256x60_s11: -50172; 18965.25 |
| 5 | approval | false | none | 128x15_s7: -1.191898996; 0.1625502414; 256x60_s7: -0.9551743827; 0.2004021014; 256x60_s11: -0.3580326172; 0.5548818233 |
| 5 | air | false | none | 128x15_s7: 0.001513804287; 0.001402402349; 256x60_s7: 0.01055517029; 0.006226507074; 256x60_s11: -0.002703401962; 0.008769134278 |
| 5 | ihtShare | false | none | 128x15_s7: 0; 0; 256x60_s7: -0.1261467211; 0.008806309258; 256x60_s11: -0.006601351436; 0.02581287662 |
| 9 | population | false | none | 128x15_s7: 3541; 1481.5; 256x60_s7: 77633; 50218.75; 256x60_s11: -50172; 20942 |
| 9 | approval | false | none | 128x15_s7: -0.7329803945; 0.6817705449; 256x60_s7: -0.5110570391; 0.5894400724; 256x60_s11: -0.3580326172; 0.5548818233 |
| 9 | air | false | none | 128x15_s7: -0.0006934462219; 0.001402402349; 256x60_s7: 0.008131595788; 0.006933975595; 256x60_s11: -0.001027132545; 0.01075691923 |
| 9 | ihtShare | false | none | 128x15_s7: 0; 0.000832066401; 256x60_s7: -0.1040254683; 0.02256179477; 256x60_s11: -0.007957754172; 0.026447518 |

## Annual medians and min–max bands at determining stages

The table includes the final base-comparison stage for every row plus the matched determining stage for each neglect comparison. A retained five-member variant includes its five-member attentive and dev references, so every target can be audited without mixing stages. Raw member paths and commands are listed in the evidence section.

| Members | Source / strategy | Row | Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT fraction median [min, max] | Funds median [min, max] |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 9 | dev attentive | 128x15_s7 | 10 (2010) | 100141 [96401, 101380] | 70.85188531 [69.04017356, 72.44259047] | 0.07249853617 [0.06917694603, 0.0744802871] | 0 [0, 0] | 74057 [64517, 74678] |
| 9 | dev attentive | 128x15_s7 | 11 (2011) | 116914 [113300, 118282] | 73.47090005 [72.92696927, 75.22527722] | 0.074557472 [0.07347336417, 0.07641983898] | 0 [0, 0] | 87155 [73895, 90394] |
| 9 | dev attentive | 128x15_s7 | 12 (2012) | 134932 [131160, 136360] | 75.29595627 [75.01476029, 76.99547539] | 0.07219251076 [0.07080482714, 0.07374932448] | 0 [0, 0] | 103092 [85334, 115060] |
| 9 | dev attentive | 128x15_s7 | 13 (2013) | 153902 [149266, 154998] | 76.93078279 [76.32924201, 78.13889513] | 0.07877140413 [0.07657169713, 0.08011750603] | 0 [0, 0.007137883008] | 120801 [107393, 128275] |
| 9 | dev attentive | 128x15_s7 | 14 (2014) | 172301 [168028, 173724] | 78.56568623 [77.61503346, 79.40495126] | 0.08538606651 [0.08332830457, 0.08724739085] | 0 [0, 0.003328539141] | 132621 [111771, 156159] |
| 9 | dev attentive | 128x15_s7 | 15 (2015) | 191588 [187528, 193454] | 80.9060989 [78.82921769, 81.55629987] | 0.09287306661 [0.09088359244, 0.09649320183] | 0 [0, 0.003328265604] | 170447 [145192, 208987] |
| 9 | T043 attentive | 128x15_s7 | 10 (2010) | 102165 [102092, 103294] | 71.33999781 [69.83795833, 71.80107469] | 0.07402969375 [0.07285792937, 0.07562182856] | 0 [0, 0] | 64996 [64722, 76357] |
| 9 | T043 attentive | 128x15_s7 | 11 (2011) | 119615 [118396, 120191] | 73.39940656 [71.00021258, 73.78944156] | 0.0760101892 [0.0718841149, 0.07731134325] | 0 [0, 0] | 86831 [83121, 91172] |
| 9 | T043 attentive | 128x15_s7 | 12 (2012) | 137855 [136410, 138467] | 74.76036377 [74.70784549, 75.32003238] | 0.07219713044 [0.07005374158, 0.07527040826] | 0 [0, 0] | 102652 [88815, 106352] |
| 9 | T043 attentive | 128x15_s7 | 13 (2013) | 155852 [154833, 157039] | 76.47527223 [76.27625402, 76.93464947] | 0.07841978535 [0.07476398504, 0.08068026598] | 0 [0, 0.01031102813] | 119851 [99911, 129053] |
| 9 | T043 attentive | 128x15_s7 | 14 (2014) | 175308 [174385, 177225] | 77.71170729 [77.26052208, 78.52780918] | 0.08408397143 [0.08159387748, 0.08846843246] | 0 [0, 0.0103062302] | 132322 [120770, 154229] |
| 9 | T043 attentive | 128x15_s7 | 15 (2015) | 195129 [193968, 196477] | 80.17311851 [78.86648005, 81.00064779] | 0.09217962039 [0.08927761041, 0.0951341412] | 0 [0, 0.01043030277] | 160499 [150860, 167804] |
| 9 | dev attentive | 256x60_s7 | 10 (2010) | 99145 [96440, 99363] | 63.85190454 [62.17693823, 64.77944446] | 0.07043823962 [0.06817482578, 0.08026279463] | 0 [0, 0] | 42371 [26643, 51649] |
| 9 | dev attentive | 256x60_s7 | 11 (2011) | 112884 [109928, 113636] | 62.11639746 [61.1707493, 63.22293323] | 0.06948792381 [0.05869429512, 0.08134973498] | 0 [0, 0.017683709] | 69040 [60182, 76628] |
| 9 | dev attentive | 256x60_s7 | 12 (2012) | 129086 [126172, 130667] | 62.57990824 [61.05141453, 68.09720923] | 0.05572988735 [0.05356245451, 0.05905572116] | 0 [0, 0.01585102482] | 86781 [81539, 94892] |
| 9 | dev attentive | 256x60_s7 | 13 (2013) | 145600 [143285, 147798] | 64.75590584 [62.28396953, 70.66533059] | 0.05574792928 [0.05208979383, 0.06027168235] | 0 [0, 0.01411850768] | 98690 [87209, 105438] |
| 9 | dev attentive | 256x60_s7 | 14 (2014) | 162743 [160481, 164908] | 66.18562745 [63.60599158, 70.42877756] | 0.05746915865 [0.05047842086, 0.06011290272] | 0 [0, 0.007912753294] | 112450 [102596, 122624] |
| 9 | dev attentive | 256x60_s7 | 15 (2015) | 181682 [179070, 184286] | 69.00507629 [64.57202938, 71.44771849] | 0.05632347203 [0.04940233449, 0.06048279489] | 0 [0, 0.007292235536] | 130814 [127985, 141308] |
| 9 | dev attentive | 256x60_s7 | 16 (2016) | 200727 [198438, 203611] | 69.99510355 [66.07328521, 71.47326263] | 0.05513854761 [0.0497432232, 0.06191505325] | 0 [0, 0.007048594939] | 132108 [122459, 148924] |
| 9 | dev attentive | 256x60_s7 | 17 (2017) | 220398 [217756, 222690] | 69.54731213 [67.33822717, 71.7247463] | 0.05562548409 [0.05213029692, 0.06452047476] | 0 [0, 0.006989992302] | 160591 [142508, 163997] |
| 9 | dev attentive | 256x60_s7 | 18 (2018) | 241134 [238379, 242772] | 69.99607389 [67.19431641, 71.33412958] | 0.05833127499 [0.05267313326, 0.06562311307] | 0 [0, 0.00677731257] | 181873 [154560, 194102] |
| 9 | dev attentive | 256x60_s7 | 19 (2019) | 262375 [259752, 264696] | 71.17290726 [67.22560029, 72.5038928] | 0.05636567485 [0.05227635304, 0.06839823207] | 0 [0, 0.004477344636] | 194624 [168594, 208210] |
| 9 | dev attentive | 256x60_s7 | 20 (2020) | 284938 [281431, 287103] | 72.13716937 [70.04594404, 73.42254239] | 0.05538108481 [0.05169701906, 0.05982058148] | 0 [0, 0.004442059446] | 234291 [204537, 255398] |
| 9 | dev attentive | 256x60_s7 | 21 (2021) | 309055 [305041, 310742] | 73.05870927 [72.41128196, 76.68464971] | 0.05552578707 [0.05104770164, 0.06183595995] | 0 [0, 0.004414089296] | 250400 [234637, 261976] |
| 9 | dev attentive | 256x60_s7 | 22 (2022) | 332098 [327623, 333926] | 75.43106353 [72.31779543, 76.88638891] | 0.05560508237 [0.04997855337, 0.06439143228] | 0 [0, 0.00438950103] | 321712 [237551, 339841] |
| 9 | dev attentive | 256x60_s7 | 23 (2023) | 356659 [351550, 357912] | 76.22880941 [73.46037825, 77.29952853] | 0.05910142504 [0.05073665229, 0.06570402656] | 0 [0, 0] | 321595 [272214, 664889] |
| 9 | dev attentive | 256x60_s7 | 24 (2024) | 380531 [376917, 382300] | 76.61324853 [73.9988384, 77.95795167] | 0.0612263226 [0.05297240487, 0.06946386082] | 0 [0, 0] | 599245 [358398, 1069410] |
| 9 | dev attentive | 256x60_s7 | 25 (2025) | 406143 [402631, 407893] | 76.84744866 [73.90021836, 78.21330535] | 0.06116826006 [0.05712679361, 0.06971361134] | 0 [0, 0] | 929733 [440582, 1531668] |
| 9 | dev attentive | 256x60_s7 | 26 (2026) | 433030 [429660, 434886] | 76.50599368 [74.14812095, 77.96432494] | 0.05885411157 [0.05765442376, 0.07120974509] | 0 [0, 0] | 1374669 [607747, 2098006] |
| 9 | dev attentive | 256x60_s7 | 27 (2027) | 461632 [458481, 463349] | 77.76357147 [75.66957497, 78.84031149] | 0.0618420766 [0.05795504928, 0.06949044687] | 0 [0, 0] | 1818890 [990654, 2760282] |
| 9 | dev attentive | 256x60_s7 | 28 (2028) | 491442 [486939, 492668] | 77.89095846 [75.92416392, 78.73043325] | 0.06446007732 [0.0580580144, 0.0738836985] | 0 [0, 0] | 2440250 [1469227, 2925269] |
| 9 | dev attentive | 256x60_s7 | 29 (2029) | 522372 [516424, 523222] | 78.66518728 [75.94676826, 80.00888883] | 0.067121767 [0.06251881772, 0.07900248932] | 0 [0, 0] | 2883283 [1768544, 3056612] |
| 9 | dev attentive | 256x60_s7 | 30 (2030) | 553169 [547698, 554269] | 80.04681872 [77.06515207, 81.0494783] | 0.07034633728 [0.0657542974, 0.08066902746] | 0 [0, 0] | 3400247 [2300710, 3472531] |
| 9 | dev attentive | 256x60_s7 | 31 (2031) | 584845 [578264, 586165] | 81.18954523 [77.22447043, 81.34260413] | 0.07449752974 [0.07138797056, 0.08641448016] | 0 [0, 0] | 3670182 [2919571, 3849671] |
| 9 | dev attentive | 256x60_s7 | 32 (2032) | 616271 [609732, 617587] | 81.8707558 [78.11353675, 82.20568232] | 0.08071848532 [0.07623496412, 0.09215309722] | 0 [0, 0] | 3969154 [3605385, 4067577] |
| 9 | dev attentive | 256x60_s7 | 33 (2033) | 649366 [642446, 650402] | 82.02128594 [79.8108193, 82.77562095] | 0.08297738522 [0.08007267484, 0.09681951461] | 0 [0, 0] | 4221845 [3919920, 4405751] |
| 9 | dev attentive | 256x60_s7 | 34 (2034) | 681383 [674866, 682905] | 81.87624095 [79.96953811, 82.72161931] | 0.08894611552 [0.08541193814, 0.1010780601] | 0 [0, 0] | 4536952 [4254946, 4655266] |
| 9 | dev attentive | 256x60_s7 | 35 (2035) | 715266 [707692, 716674] | 82.32127653 [79.82443739, 82.74602122] | 0.09408836462 [0.08887255036, 0.1070792466] | 0 [0, 0] | 4939942 [4636220, 5025393] |
| 9 | dev attentive | 256x60_s7 | 36 (2036) | 747267 [740445, 749944] | 81.68252893 [80.05807507, 82.24079331] | 0.09857667571 [0.09655970828, 0.1127969766] | 0 [0, 0] | 5379794 [4991995, 5494391] |
| 9 | dev attentive | 256x60_s7 | 37 (2037) | 781483 [773598, 784083] | 81.70508489 [79.34904833, 82.10804793] | 0.1111848672 [0.1003523775, 0.1223969888] | 0 [0, 0] | 5796999 [5290716, 5965661] |
| 9 | dev attentive | 256x60_s7 | 38 (2038) | 816400 [808253, 819015] | 81.33656726 [79.56535669, 82.10776851] | 0.1137574554 [0.1046508963, 0.1328408683] | 0 [0, 0] | 6280322 [5610573, 6496932] |
| 9 | dev attentive | 256x60_s7 | 39 (2039) | 849116 [844325, 853580] | 81.14146947 [80.61492243, 82.10791996] | 0.117955218 [0.1105337442, 0.1389095822] | 0 [0, 0] | 6785965 [5978985, 7026577] |
| 9 | dev attentive | 256x60_s7 | 40 (2040) | 885781 [878794, 890501] | 81.9362789 [80.30807525, 82.77316574] | 0.1233978845 [0.1160728093, 0.139513872] | 0 [0, 0] | 7045688 [6385428, 7380337] |
| 9 | dev attentive | 256x60_s7 | 41 (2041) | 922651 [913777, 928329] | 81.5173743 [80.76867789, 82.68507816] | 0.1253183917 [0.1196793107, 0.1433797784] | 0 [0, 0] | 7389842 [6844546, 7686531] |
| 9 | dev attentive | 256x60_s7 | 42 (2042) | 954296 [948309, 964043] | 81.31818496 [80.25457551, 82.51772479] | 0.1315819697 [0.1260065345, 0.1476719558] | 0 [0, 0] | 7703730 [7361488, 8054442] |
| 9 | dev attentive | 256x60_s7 | 43 (2043) | 990452 [986884, 1001176] | 81.41846199 [79.84456931, 82.58274162] | 0.1363692754 [0.1303388481, 0.1552976909] | 0 [0, 0] | 7954439 [7870948, 8597524] |
| 9 | dev attentive | 256x60_s7 | 44 (2044) | 1029252 [1021771, 1041125] | 81.07316961 [79.71627546, 81.60598447] | 0.1405887458 [0.1387190142, 0.1589794896] | 0 [0, 0.002702015386] | 8393651 [8221580, 9292449] |
| 9 | dev attentive | 256x60_s7 | 45 (2045) | 1066213 [1055686, 1079331] | 80.76391805 [79.310177, 81.18818587] | 0.1456996772 [0.1424804543, 0.1605866295] | 0 [0, 0.01075417812] | 8730004 [8725138, 9972715] |
| 9 | dev attentive | 256x60_s7 | 46 (2046) | 1106293 [1092663, 1118481] | 80.54085542 [79.0075829, 81.00050684] | 0.1500675306 [0.144261355, 0.1664440982] | 0 [0, 0.02938043341] | 9262304 [9096525, 10675884] |
| 9 | dev attentive | 256x60_s7 | 47 (2047) | 1144132 [1127604, 1152537] | 79.99850837 [78.95311956, 81.05888527] | 0.1499989357 [0.1434832025, 0.1677293132] | 0 [0, 0.0351572007] | 9776999 [9419262, 11395191] |
| 9 | dev attentive | 256x60_s7 | 48 (2048) | 1186078 [1167763, 1189173] | 80.45866684 [77.94694039, 80.8686423] | 0.155345503 [0.1477530266, 0.1727237] | 0 [0, 0.05093371286] | 10180120 [9763121, 12132905] |
| 9 | dev attentive | 256x60_s7 | 49 (2049) | 1225463 [1185004, 1235776] | 80.56109889 [78.80766758, 80.95111054] | 0.1565685665 [0.1473500515, 0.1696897742] | 0 [0, 0.06220635087] | 10608104 [10107626, 12906332] |
| 9 | dev attentive | 256x60_s7 | 50 (2050) | 1265741 [1202458, 1272989] | 80.31895548 [78.99120522, 80.84473736] | 0.1594034463 [0.1545329508, 0.1770923645] | 0 [0, 0.07324135582] | 11039626 [10426197, 13645964] |
| 9 | dev attentive | 256x60_s7 | 51 (2051) | 1310245 [1243720, 1315846] | 79.67800859 [78.27383883, 80.7534328] | 0.1641497153 [0.1526035944, 0.1787988062] | 0.01085069444 [0, 0.07822800446] | 11421235 [10731681, 14354466] |
| 9 | dev attentive | 256x60_s7 | 52 (2052) | 1342501 [1259287, 1355405] | 79.77321215 [78.30443511, 80.63697471] | 0.1606372863 [0.1533680434, 0.1778936906] | 0.02565309911 [0, 0.09115856049] | 11818888 [11029117, 15131835] |
| 9 | dev attentive | 256x60_s7 | 53 (2053) | 1361273 [1266114, 1397353] | 79.53620354 [77.67852788, 80.75484701] | 0.1640372879 [0.1553335117, 0.1746259797] | 0.03539789825 [0, 0.1019341449] | 12220993 [11305006, 15905784] |
| 9 | dev attentive | 256x60_s7 | 54 (2054) | 1389189 [1282793, 1434433] | 79.90877555 [78.67552942, 81.01134176] | 0.1641298778 [0.1526786937, 0.1829939663] | 0.04693832437 [0.001336031985, 0.1018399496] | 12660670 [11605219, 16723062] |
| 9 | dev attentive | 256x60_s7 | 55 (2055) | 1401036 [1291560, 1463953] | 79.81138752 [77.45035609, 81.11460045] | 0.1682199265 [0.1566320876, 0.1757489784] | 0.05061165101 [0.01837909655, 0.1169417494] | 13194127 [11957760, 17596513] |
| 9 | dev attentive | 256x60_s7 | 56 (2056) | 1419186 [1304234, 1479068] | 80.0662775 [77.58031873, 81.02231108] | 0.1680693696 [0.1542054697, 0.1861106634] | 0.06514895278 [0.03016699587, 0.1247583189] | 13766735 [12346118, 18517931] |
| 9 | dev attentive | 256x60_s7 | 57 (2057) | 1418230 [1322291, 1487910] | 80.25815761 [77.71226593, 80.94654418] | 0.1708420565 [0.1537251827, 0.1816357056] | 0.07402317233 [0.03886621156, 0.1301338446] | 14374276 [12771605, 19454163] |
| 9 | dev attentive | 256x60_s7 | 58 (2058) | 1442416 [1335743, 1521883] | 80.01480223 [78.34044281, 80.92687902] | 0.1680511547 [0.1538286579, 0.1870111466] | 0.08953625103 [0.04037183441, 0.1358433543] | 15009259 [13241820, 20403512] |
| 9 | dev attentive | 256x60_s7 | 59 (2059) | 1447648 [1344677, 1537176] | 79.88367089 [77.41282113, 80.66228883] | 0.169665794 [0.1561095287, 0.1851632801] | 0.09739762725 [0.04440216472, 0.136353087] | 15670344 [13680976, 20861965] |
| 9 | dev attentive | 256x60_s7 | 60 (2060) | 1461087 [1341715, 1542590] | 80.16455676 [78.18364944, 80.54140973] | 0.1688953657 [0.155473291, 0.1832091934] | 0.1148219322 [0.04737672551, 0.1376239046] | 16348805 [14078118, 21369469] |
| 9 | T043 attentive | 256x60_s7 | 10 (2010) | 98127 [97083, 99539] | 63.48732348 [61.93684433, 64.10195343] | 0.0812159745 [0.0712630056, 0.08477644047] | 0 [0, 0] | 42448 [29590, 60281] |
| 9 | T043 attentive | 256x60_s7 | 11 (2011) | 112065 [110666, 113619] | 61.40390008 [58.25466701, 62.99313654] | 0.0656760141 [0.06476713863, 0.07431033476] | 0 [0, 0] | 68241 [59934, 78309] |
| 9 | T043 attentive | 256x60_s7 | 12 (2012) | 128682 [127008, 130538] | 63.90477768 [59.97664103, 65.17028946] | 0.05803879589 [0.0577824806, 0.06107057729] | 0 [0, 0] | 86307 [78206, 90526] |
| 9 | T043 attentive | 256x60_s7 | 13 (2013) | 145359 [143353, 146121] | 66.28616827 [63.4040757, 68.1113973] | 0.0573327975 [0.05429337049, 0.0663630095] | 0 [0, 0] | 96536 [87259, 105088] |
| 9 | T043 attentive | 256x60_s7 | 14 (2014) | 162387 [160699, 163260] | 67.90068315 [64.61503371, 69.16602264] | 0.05575635025 [0.05156644214, 0.05900704131] | 0 [0, 0] | 115619 [105590, 121590] |
| 9 | T043 attentive | 256x60_s7 | 15 (2015) | 181527 [178050, 182544] | 69.30217723 [66.02420327, 70.97182444] | 0.05466021243 [0.04969213884, 0.06258974207] | 0 [0, 0] | 134516 [120616, 137302] |
| 9 | T043 attentive | 256x60_s7 | 16 (2016) | 200813 [199049, 201278] | 70.22464945 [69.43802512, 71.03458549] | 0.05335896939 [0.04833384408, 0.0668598072] | 0 [0, 0] | 138842 [128443, 146276] |
| 9 | T043 attentive | 256x60_s7 | 17 (2017) | 220439 [218763, 221363] | 70.37562724 [68.51753085, 71.74542036] | 0.05680637527 [0.05347644474, 0.07153543278] | 0 [0, 0] | 152802 [135781, 172099] |
| 9 | T043 attentive | 256x60_s7 | 18 (2018) | 240650 [238720, 242106] | 70.97879344 [69.93229161, 71.9476675] | 0.05769391453 [0.05268529103, 0.07001623067] | 0 [0, 0] | 175964 [154128, 185690] |
| 9 | T043 attentive | 256x60_s7 | 19 (2019) | 261866 [259949, 263592] | 71.26686555 [69.676158, 73.20204502] | 0.05653416353 [0.05391067373, 0.07240561834] | 0 [0, 0] | 197124 [174095, 226843] |
| 9 | T043 attentive | 256x60_s7 | 20 (2020) | 283834 [282528, 286247] | 72.52625836 [70.68257986, 75.55877174] | 0.05616703063 [0.05410334041, 0.06488859057] | 0 [0, 0] | 227733 [191952, 272719] |
| 9 | T043 attentive | 256x60_s7 | 21 (2021) | 307394 [305182, 309496] | 75.50661998 [71.73225999, 76.03979255] | 0.056179247 [0.05337427525, 0.06519120505] | 0 [0, 0] | 264549 [198104, 304668] |
| 9 | T043 attentive | 256x60_s7 | 22 (2022) | 331025 [328735, 333260] | 76.20536969 [73.25486299, 76.73955076] | 0.05616944977 [0.05333955458, 0.07034325687] | 0 [0, 0] | 293713 [261521, 359758] |
| 9 | T043 attentive | 256x60_s7 | 23 (2023) | 354525 [352771, 357183] | 76.28633531 [74.67693969, 76.91262335] | 0.05907922483 [0.0553436937, 0.0685831555] | 0 [0, 0] | 378529 [283680, 699908] |
| 9 | T043 attentive | 256x60_s7 | 24 (2024) | 379761 [377458, 382088] | 76.70334212 [74.58899391, 77.19303131] | 0.06039914745 [0.05592590297, 0.07193949282] | 0 [0, 0] | 643094 [247876, 1092225] |
| 9 | T043 attentive | 256x60_s7 | 25 (2025) | 405386 [402861, 407883] | 76.71023634 [75.68099612, 77.79501676] | 0.06187902972 [0.05581161946, 0.0752616073] | 0 [0, 0] | 999803 [297862, 1489498] |
| 9 | T043 attentive | 256x60_s7 | 26 (2026) | 432490 [429210, 433634] | 76.35187048 [75.17352526, 78.16073289] | 0.05980993724 [0.05590806637, 0.07590682845] | 0 [0, 0] | 1443061 [536940, 2042238] |
| 9 | T043 attentive | 256x60_s7 | 27 (2027) | 460455 [457619, 462278] | 77.79345213 [75.4158011, 78.3693627] | 0.06119148115 [0.05901099682, 0.07421834766] | 0 [0, 0] | 1831890 [764415, 2668639] |
| 9 | T043 attentive | 256x60_s7 | 28 (2028) | 489680 [487636, 491439] | 78.58506036 [76.41813666, 79.94004104] | 0.06302071434 [0.05896400109, 0.07317412605] | 0 [0, 0] | 2436257 [1129635, 2945169] |
| 9 | T043 attentive | 256x60_s7 | 29 (2029) | 520153 [517602, 521658] | 79.11010665 [76.97839075, 80.34852721] | 0.06586735567 [0.0641281697, 0.0777527512] | 0 [0, 0] | 2848051 [1359201, 3239256] |
| 9 | T043 attentive | 256x60_s7 | 30 (2030) | 550694 [548099, 552779] | 80.30249877 [77.37045313, 81.20790727] | 0.06789094232 [0.0656010041, 0.08071070711] | 0 [0, 0] | 3434613 [1885949, 3586254] |
| 9 | T043 attentive | 256x60_s7 | 31 (2031) | 582430 [578650, 584664] | 81.13662844 [77.80669756, 82.36534491] | 0.07319812417 [0.07042194085, 0.08451686655] | 0 [0, 0] | 3775299 [2460807, 3846873] |
| 9 | T043 attentive | 256x60_s7 | 32 (2032) | 615266 [609885, 616229] | 81.92800324 [78.45823792, 82.80999058] | 0.0779171377 [0.0739645298, 0.09307730484] | 0 [0, 0] | 4094757 [3152168, 4139169] |
| 9 | T043 attentive | 256x60_s7 | 33 (2033) | 646977 [642169, 649154] | 82.47027327 [78.63682061, 82.88854155] | 0.08204804199 [0.07751474242, 0.09583884968] | 0 [0, 0] | 4344021 [3832834, 4484973] |
| 9 | T043 attentive | 256x60_s7 | 34 (2034) | 679375 [674783, 681394] | 82.49659043 [80.0832585, 82.68520553] | 0.08445102224 [0.08186788369, 0.09921836231] | 0 [0, 0] | 4676842 [4125175, 4755683] |
| 9 | T043 attentive | 256x60_s7 | 35 (2035) | 712843 [707407, 714997] | 82.35093184 [80.58498936, 82.89335091] | 0.09190053114 [0.08613195169, 0.1034766406] | 0 [0, 0] | 5040099 [4513802, 5165799] |
| 9 | T043 attentive | 256x60_s7 | 36 (2036) | 746460 [740322, 748103] | 82.33645604 [80.0374354, 83.18729568] | 0.09544427497 [0.09412768384, 0.1097881479] | 0 [0, 0] | 5455860 [4943910, 5517985] |
| 9 | T043 attentive | 256x60_s7 | 37 (2037) | 780908 [774438, 782881] | 81.71716688 [79.70328391, 83.20647531] | 0.100077575 [0.09283242611, 0.1157831844] | 0 [0, 0] | 5802915 [5286928, 5989348] |
| 9 | T043 attentive | 256x60_s7 | 38 (2038) | 814193 [809560, 816376] | 81.74401908 [79.46814896, 82.63812136] | 0.107200509 [0.09955635406, 0.1235571232] | 0 [0, 0] | 6237502 [5614212, 6505651] |
| 9 | T043 attentive | 256x60_s7 | 39 (2039) | 850209 [844434, 851600] | 81.70715217 [80.19098906, 82.99140437] | 0.1129205541 [0.1039877987, 0.1297694006] | 0 [0, 0] | 6727154 [5977639, 6932654] |
| 9 | T043 attentive | 256x60_s7 | 40 (2040) | 884168 [879723, 890344] | 82.23667738 [80.40428009, 82.65435251] | 0.1198265627 [0.1129057906, 0.1316073533] | 0 [0, 0] | 7019624 [6329089, 7350437] |
| 9 | T043 attentive | 256x60_s7 | 41 (2041) | 919200 [915457, 928087] | 81.9582051 [79.92894148, 82.79712622] | 0.1209156226 [0.1152230486, 0.1353697644] | 0 [0, 0] | 7386130 [6694126, 7706906] |
| 9 | T043 attentive | 256x60_s7 | 42 (2042) | 955357 [952824, 962039] | 81.77414831 [80.31156707, 82.44955927] | 0.1275682027 [0.1221592887, 0.1373640027] | 0 [0, 0] | 7827443 [7074466, 8039201] |
| 9 | T043 attentive | 256x60_s7 | 43 (2043) | 992415 [987716, 996966] | 81.97720227 [80.25430009, 82.1888187] | 0.1318297107 [0.1214167864, 0.1481096096] | 0 [0, 0] | 8280625 [7405541, 8363336] |
| 9 | T043 attentive | 256x60_s7 | 44 (2044) | 1031239 [1026033, 1037326] | 81.76894436 [79.75966659, 82.27506752] | 0.1398026557 [0.1308152791, 0.1485247141] | 0 [0, 0] | 8642961 [7856222, 8718084] |
| 9 | T043 attentive | 256x60_s7 | 45 (2045) | 1070693 [1063463, 1075424] | 81.3275523 [79.74389855, 81.75874687] | 0.1424959769 [0.1328903228, 0.1535622085] | 0 [0, 0] | 9039927 [8353026, 9230521] |
| 9 | T043 attentive | 256x60_s7 | 46 (2046) | 1110161 [1104066, 1117252] | 80.89641466 [79.55890956, 81.64041059] | 0.1456592696 [0.1360778964, 0.1577448372] | 0 [0, 0.001092384519] | 9533957 [8901002, 9811156] |
| 9 | T043 attentive | 256x60_s7 | 47 (2047) | 1154164 [1139064, 1157332] | 81.51245335 [79.09997117, 82.45888751] | 0.1526874038 [0.1349442867, 0.1569693028] | 0 [0, 0.007557080073] | 9996532 [9475284, 10338598] |
| 9 | T043 attentive | 256x60_s7 | 48 (2048) | 1190985 [1173843, 1198219] | 80.74960344 [79.51187485, 81.94307751] | 0.1506166526 [0.1461418506, 0.1638523872] | 0 [0, 0.02534947782] | 10492382 [10081393, 10875181] |
| 9 | T043 attentive | 256x60_s7 | 49 (2049) | 1231930 [1212992, 1240385] | 81.18524873 [78.81260193, 82.00716525] | 0.1547410827 [0.143035178, 0.1686145954] | 0 [0, 0.03771644524] | 10993854 [10709668, 11421270] |
| 9 | T043 attentive | 256x60_s7 | 50 (2050) | 1272249 [1233960, 1275132] | 80.6827045 [79.00755102, 81.25761567] | 0.1584230689 [0.1482095966, 0.1701371491] | 0 [0, 0.04643851022] | 11511460 [11182036, 12117563] |
| 9 | T043 attentive | 256x60_s7 | 51 (2051) | 1315814 [1254556, 1316938] | 80.27536667 [78.90160132, 81.02544092] | 0.1570688485 [0.1508572693, 0.1697007942] | 0 [0, 0.06292707316] | 12044994 [11583295, 12824771] |
| 9 | T043 attentive | 256x60_s7 | 52 (2052) | 1353336 [1293036, 1362826] | 79.44555421 [78.7081903, 80.82172327] | 0.1668986033 [0.1494987318, 0.1690965258] | 0 [0, 0.07759211753] | 12608629 [11960281, 13615540] |
| 9 | T043 attentive | 256x60_s7 | 53 (2053) | 1399697 [1308156, 1402755] | 80.11565783 [78.77508017, 80.9302989] | 0.1682943956 [0.1547237432, 0.1726942165] | 0 [0, 0.08205895602] | 13134374 [12343772, 14425368] |
| 9 | T043 attentive | 256x60_s7 | 54 (2054) | 1439702 [1328857, 1446231] | 80.19536719 [78.68544133, 81.7114331] | 0.167821452 [0.1497758374, 0.1802763786] | 0 [0, 0.08776923877] | 13645553 [12746034, 15266584] |
| 9 | T043 attentive | 256x60_s7 | 55 (2055) | 1470088 [1343542, 1489981] | 79.99140795 [77.85850437, 80.82995111] | 0.1695433761 [0.1554591002, 0.1770087157] | 0 [0, 0.09681059614] | 14184426 [13156806, 16070398] |
| 9 | T043 attentive | 256x60_s7 | 56 (2056) | 1509841 [1343413, 1530828] | 79.96302025 [78.79211077, 80.94983648] | 0.1734333041 [0.1496605233, 0.1767352835] | 0.004243355386 [0, 0.1046654673] | 14733175 [13483877, 16914764] |
| 9 | T043 attentive | 256x60_s7 | 57 (2057) | 1515651 [1356368, 1542033] | 79.5141486 [78.36958363, 80.98997651] | 0.1762804499 [0.1527122522, 0.1827941754] | 0.009927564016 [0, 0.1143976398] | 15283979 [13848654, 17742525] |
| 9 | T043 attentive | 256x60_s7 | 58 (2058) | 1530344 [1361197, 1564809] | 79.92231028 [78.94574872, 81.49147915] | 0.1749357233 [0.1508446015, 0.1778912508] | 0.0107318199 [0, 0.1186644995] | 15786039 [14249606, 18584717] |
| 9 | T043 attentive | 256x60_s7 | 59 (2059) | 1537000 [1378408, 1579563] | 79.83410366 [78.52377686, 81.18270151] | 0.175391458 [0.1562470977, 0.1817474826] | 0.01075494906 [0, 0.1260860633] | 16236705 [14553312, 19436400] |
| 9 | T043 attentive | 256x60_s7 | 60 (2060) | 1538720 [1387670, 1595956] | 79.65349972 [79.22911343, 80.76077082] | 0.1770269615 [0.1562825978, 0.1810752813] | 0.01079646392 [0, 0.1305509815] | 16719627 [15001266, 20327575] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 10 (2010) | 98944 [97841, 99663] | 62.64346554 [58.16743378, 63.68224084] | 0.0782467994 [0.06847153388, 0.08404341459] | 0 [0, 0.01854699212] | 59785 [26240, 67186] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 11 (2011) | 112722 [111808, 113312] | 57.61524538 [55.46062352, 62.10888979] | 0.06601014597 [0.05940625438, 0.08242798967] | 0 [0, 0.01723829939] | 74149 [46484, 77219] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 12 (2012) | 128784 [128242, 129841] | 60.7900308 [56.75292195, 62.79637754] | 0.05913615008 [0.05615613823, 0.06263020942] | 0 [0, 0.01512936994] | 85759 [77261, 92799] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 13 (2013) | 145161 [143611, 145715] | 60.40603375 [57.60489589, 62.59252627] | 0.0593637308 [0.05483072236, 0.06353615155] | 0 [0, 0.01383055757] | 97793 [80781, 104387] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 14 (2014) | 162436 [160149, 163437] | 60.71883995 [55.42746003, 64.41019711] | 0.0562296385 [0.05227065422, 0.06115986331] | 0 [0, 0.01299770225] | 114829 [102331, 121690] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 15 (2015) | 181655 [180621, 182676] | 63.58870014 [59.68552307, 68.81842287] | 0.05503237632 [0.04995620347, 0.05906600762] | 0 [0, 0.009945481579] | 133667 [130380, 139089] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 16 (2016) | 200879 [199720, 202186] | 66.11426419 [59.76272363, 69.49920764] | 0.05703449612 [0.05228716499, 0.06841119929] | 0 [0, 0.009771141049] | 140229 [125789, 153168] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 17 (2017) | 220822 [219075, 221981] | 63.79569581 [59.63324739, 70.21901677] | 0.05795165629 [0.05322678225, 0.06760183194] | 0 [0, 0.007424775303] | 161661 [139930, 174804] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 18 (2018) | 241795 [239558, 243068] | 64.00567319 [62.47098645, 69.39918571] | 0.0580888955 [0.05321060997, 0.05967163078] | 0 [0, 0.007401128101] | 188146 [150482, 190201] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 19 (2019) | 263035 [260864, 263823] | 65.21679817 [65.01575049, 71.04282468] | 0.0564868627 [0.05244021063, 0.06637425535] | 0 [0, 0.007062325817] | 201620 [169904, 220393] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 20 (2020) | 285059 [284066, 286580] | 70.84524807 [65.46505568, 73.16277986] | 0.0581230122 [0.05285441962, 0.05887754652] | 0 [0, 0.006972488642] | 235289 [207783, 267368] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 21 (2021) | 308055 [306878, 310507] | 73.57345404 [69.14300391, 75.82748548] | 0.05767979898 [0.05101115932, 0.06002089302] | 0 [0, 0.006302667317] | 260596 [208713, 301712] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 22 (2022) | 332216 [329919, 334164] | 73.71813772 [66.78092423, 76.43754648] | 0.05697649313 [0.05254175588, 0.06295465691] | 0 [0, 0.00629302552] | 269984 [235941, 362793] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 23 (2023) | 355974 [352935, 358090] | 73.92344341 [70.93098625, 77.03762093] | 0.05942013652 [0.0542587486, 0.06566915021] | 0 [0, 0.006259563222] | 458570 [313760, 518049] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 24 (2024) | 380745 [378764, 383578] | 74.19876336 [69.49997722, 75.91772128] | 0.06185711187 [0.05662964785, 0.06781014024] | 0 [0, 0.00632867376] | 773889 [300778, 797424] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 25 (2025) | 406540 [404312, 408452] | 73.06554146 [69.22106956, 74.82907837] | 0.06273194975 [0.05827586425, 0.07089853965] | 0 [0, 0.006225004347] | 1093669 [360452, 1173120] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 26 (2026) | 432746 [431334, 434301] | 71.2399501 [70.16482667, 77.30597771] | 0.06123362935 [0.05645256452, 0.07076176893] | 0 [0, 0.006225220839] | 1536435 [471366, 1643365] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 27 (2027) | 460583 [459352, 462693] | 74.1907226 [69.83271585, 76.54699305] | 0.06276903215 [0.05724219698, 0.0684118521] | 0 [0, 0.006296528213] | 1945952 [791194, 2108621] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 28 (2028) | 490165 [488294, 493102] | 74.51574566 [72.70967115, 77.51907946] | 0.06480844548 [0.05879262085, 0.07412709204] | 0 [0, 0.006227603243] | 2523058 [1207524, 2759703] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 29 (2029) | 520686 [518617, 523115] | 76.61153045 [71.31215355, 77.69095955] | 0.06805762534 [0.06270176954, 0.07512426487] | 0 [0, 0.006242589105] | 2917480 [1415423, 3163880] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 30 (2030) | 551549 [548989, 554426] | 76.1181591 [72.5725045, 79.15822774] | 0.06977800811 [0.06594087155, 0.07966472487] | 0 [0, 0.006234327111] | 3431666 [1909277, 3561864] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 31 (2031) | 583254 [580842, 586407] | 79.77519175 [74.32843976, 81.46442361] | 0.07674449932 [0.06916658306, 0.08372228554] | 0 [0, 0.00589883012] | 3744704 [2479569, 3912145] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 32 (2032) | 616052 [612533, 618168] | 81.08748092 [77.7281449, 82.77504548] | 0.07929059626 [0.07149547218, 0.0877698885] | 0 [0, 0.005586416847] | 4058347 [3136236, 4322641] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 33 (2033) | 648509 [644331, 650879] | 81.47153179 [77.11095501, 83.58359914] | 0.08530328652 [0.07775920415, 0.09309872983] | 0 [0, 0.005498089647] | 4426868 [3853356, 4582363] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 34 (2034) | 681196 [676918, 684465] | 80.74452824 [76.07324798, 82.29916243] | 0.08935827734 [0.07931729392, 0.09692918367] | 0 [0, 0.001778776389] | 4672031 [4192095, 4924821] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 35 (2035) | 714005 [709625, 718367] | 80.4575311 [76.42432021, 83.80577768] | 0.09533579208 [0.08472132099, 0.1005333566] | 0 [0, 0] | 5004898 [4547357, 5203246] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 36 (2036) | 747374 [742640, 752597] | 78.96872569 [76.15882774, 83.68663648] | 0.1020012453 [0.08943077367, 0.109007262] | 0 [0, 0] | 5455382 [4964534, 5504058] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 37 (2037) | 780978 [776722, 786436] | 79.1638253 [78.65177988, 81.55548019] | 0.1106704847 [0.09719205044, 0.1165947329] | 0 [0, 0] | 5818189 [5372988, 5873931] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 38 (2038) | 816543 [811394, 820951] | 80.65221723 [78.72307915, 82.40847594] | 0.1162253705 [0.09631111997, 0.1234966985] | 0 [0, 0] | 6205112 [5818823, 6352207] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 39 (2039) | 849991 [846485, 858617] | 80.49629551 [77.09577138, 83.25979978] | 0.1213858272 [0.09853783832, 0.1304527536] | 0 [0, 0] | 6607080 [6206550, 6876106] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 40 (2040) | 887972 [882657, 894881] | 79.31104971 [75.23376533, 80.71637261] | 0.1256648319 [0.1092885994, 0.1324223375] | 0 [0, 0] | 7105538 [6557718, 7346888] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 41 (2041) | 920287 [917513, 930461] | 78.89995636 [75.11137099, 82.01841672] | 0.1296482505 [0.1099984955, 0.1326907459] | 0 [0, 0] | 7576188 [6936051, 7961334] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 42 (2042) | 956398 [949860, 962717] | 79.36397481 [73.9895997, 81.22258368] | 0.1336397169 [0.1175200913, 0.1421697746] | 0 [0, 0] | 8161024 [7390945, 8632613] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 43 (2043) | 996729 [988746, 1001610] | 78.55447925 [74.23325481, 82.17494406] | 0.1404678948 [0.1201010686, 0.1460460906] | 0 [0, 0.001393211556] | 8663029 [7878715, 9293461] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 44 (2044) | 1035610 [1025812, 1038369] | 78.25019482 [74.858857, 80.65936388] | 0.1448849194 [0.1273901356, 0.1516183176] | 0 [0, 0.001611506638] | 9259698 [8196742, 9865128] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 45 (2045) | 1071832 [1061678, 1079863] | 77.07128279 [74.66916279, 79.83353766] | 0.1507671098 [0.1369702171, 0.1563582672] | 0 [0, 0.02023555267] | 9642232 [8644577, 10608614] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 46 (2046) | 1107548 [1095859, 1117064] | 77.129786 [73.72891055, 81.26068544] | 0.1596830634 [0.137042077, 0.1633592803] | 0 [0, 0.03052553731] | 9976853 [9104991, 11356404] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 47 (2047) | 1148220 [1127887, 1153875] | 76.56471519 [73.82787451, 80.54048582] | 0.1591677253 [0.1384428316, 0.1664797253] | 0 [0, 0.04284283842] | 10275315 [9578541, 12003254] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 48 (2048) | 1188106 [1171059, 1198097] | 75.67935228 [73.84210138, 80.00006056] | 0.1545444691 [0.1439003755, 0.1668973008] | 0 [0, 0.06029948842] | 10640032 [10079880, 12316109] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 49 (2049) | 1226997 [1190578, 1235182] | 75.75271478 [74.0555475, 81.19918899] | 0.1624886927 [0.1459622605, 0.1684404394] | 0 [0, 0.07529963155] | 10977755 [10568556, 12667488] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 50 (2050) | 1270538 [1198301, 1278216] | 77.39089524 [73.76856667, 81.52010717] | 0.1655369713 [0.1512966986, 0.1717236832] | 0 [0, 0.1031608103] | 11329411 [11029373, 13377862] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 51 (2051) | 1313500 [1218421, 1316356] | 76.81643592 [73.3401222, 80.84691478] | 0.1609480495 [0.1495615297, 0.1756925541] | 0.009070114371 [0, 0.1130602736] | 11565822 [11431697, 14093726] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 52 (2052) | 1351499 [1223823, 1358347] | 75.13397699 [73.42158244, 80.61078031] | 0.1649122499 [0.1523883796, 0.174878876] | 0.01400873198 [0, 0.1243365991] | 11969849 [11718591, 14847307] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 53 (2053) | 1373973 [1239726, 1396602] | 76.71446605 [73.95715862, 78.44669666] | 0.1646244959 [0.156123407, 0.1780729275] | 0.0230382358 [0, 0.1344108007] | 12421244 [11956305, 15650552] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 54 (2054) | 1412816 [1246935, 1444486] | 75.37202243 [74.30513496, 80.32006207] | 0.1637656167 [0.1514208832, 0.1815790032] | 0.0374908244 [0, 0.1390810935] | 12897178 [12185720, 16516453] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 55 (2055) | 1426902 [1273212, 1467728] | 74.69012995 [73.58669641, 76.50626407] | 0.1696024486 [0.1504847214, 0.1838640239] | 0.0454236551 [0, 0.1455275789] | 13404140 [12413067, 17362467] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 56 (2056) | 1437060 [1274311, 1488147] | 74.47622942 [74.02582988, 77.37813564] | 0.1651860887 [0.1582938762, 0.1853732551] | 0.0523495813 [0, 0.165277022] | 13931625 [12690035, 18238784] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 57 (2057) | 1435129 [1278564, 1507293] | 74.99047531 [72.99100258, 77.263006] | 0.169139844 [0.1605990482, 0.1830208433] | 0.05006027379 [0, 0.1702180192] | 14467941 [13003679, 19174172] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 58 (2058) | 1445175 [1286386, 1517063] | 75.05569452 [73.59501792, 76.43853048] | 0.1679416602 [0.1650132916, 0.1871915517] | 0.05974088292 [0, 0.1809637982] | 15051485 [13314529, 20105446] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 59 (2059) | 1453929 [1298243, 1535683] | 74.68686896 [73.30277971, 78.32215892] | 0.1678679864 [0.1600786012, 0.1898855318] | 0.0661573851 [0, 0.1875893289] | 15652846 [13636191, 21094433] |
| 9 | dev neglect (LG-06 off) | 256x60_s7 | 60 (2060) | 1462529 [1301953, 1556045] | 76.02505783 [73.75743331, 77.89402421] | 0.1684831629 [0.1576806286, 0.1887180512] | 0.07403951376 [0, 0.1844486913] | 16105301 [14005628, 22108807] |
| 9 | T043 neglect | 256x60_s7 | 10 (2010) | 97221 [94241, 98241] | 61.18693401 [58.73044674, 63.07076511] | 0.09028201455 [0.07589707882, 0.09378907438] | 0 [0, 0.01889113002] | 43798 [33575, 65963] |
| 9 | T043 neglect | 256x60_s7 | 11 (2011) | 110806 [108387, 112067] | 57.56072471 [55.94052245, 63.37085912] | 0.07349945906 [0.06891597949, 0.08779376866] | 0 [0, 0.01780553743] | 59463 [51929, 76773] |
| 9 | T043 neglect | 256x60_s7 | 12 (2012) | 126814 [123945, 128522] | 59.08006902 [56.49976799, 65.23163814] | 0.06541435346 [0.05975675854, 0.06711687264] | 0 [0, 0.01593066447] | 86543 [73853, 92325] |
| 9 | T043 neglect | 256x60_s7 | 13 (2013) | 142944 [139622, 145267] | 59.69876131 [58.23610818, 66.13967746] | 0.06279556002 [0.05906937357, 0.07533644162] | 0 [0, 0.01449493053] | 98393 [94626, 102704] |
| 9 | T043 neglect | 256x60_s7 | 14 (2014) | 160639 [156845, 162517] | 62.22284645 [58.36375961, 67.01884824] | 0.05957824229 [0.05805471345, 0.06647473447] | 0 [0, 0.01371638406] | 110223 [101433, 116734] |
| 9 | T043 neglect | 256x60_s7 | 15 (2015) | 180326 [175698, 181712] | 67.46100393 [57.99664628, 69.77978081] | 0.05826086576 [0.05638073997, 0.06475184306] | 0 [0, 0.01272065576] | 130139 [124079, 136191] |
| 9 | T043 neglect | 256x60_s7 | 16 (2016) | 200362 [194579, 201926] | 68.7433542 [61.02844126, 71.33346055] | 0.05791141098 [0.05423514142, 0.0704807208] | 0 [0, 0.01220230306] | 136700 [121343, 145699] |
| 9 | T043 neglect | 256x60_s7 | 17 (2017) | 219866 [213068, 221418] | 65.80445174 [59.69475851, 70.92501432] | 0.06135883588 [0.05827085814, 0.07022254292] | 0 [0, 0.01211885551] | 159536 [127777, 167626] |
| 9 | T043 neglect | 256x60_s7 | 18 (2018) | 239877 [232835, 241893] | 68.39192916 [62.19782152, 69.68941464] | 0.06110620208 [0.05774455637, 0.07504433203] | 0 [0, 0.01209494858] | 178871 [149551, 183757] |
| 9 | T043 neglect | 256x60_s7 | 19 (2019) | 261310 [253680, 263660] | 68.73915666 [60.85732609, 73.41802142] | 0.05890348786 [0.05655961373, 0.06414371003] | 0 [0, 0.01238861837] | 200002 [167889, 209243] |
| 9 | T043 neglect | 256x60_s7 | 20 (2020) | 283281 [276524, 285935] | 71.78778805 [65.07856761, 73.62459121] | 0.05790971906 [0.05604371597, 0.0650339547] | 0 [0, 0.01224396008] | 226822 [184349, 248250] |
| 9 | T043 neglect | 256x60_s7 | 21 (2021) | 307793 [299716, 308923] | 71.55768007 [67.61376162, 75.09246572] | 0.05805230691 [0.05598688261, 0.06524118793] | 0 [0, 0.01218147099] | 249211 [215421, 302395] |
| 9 | T043 neglect | 256x60_s7 | 22 (2022) | 331130 [322023, 332678] | 72.42982301 [70.45782937, 75.34877889] | 0.05860858905 [0.05731783808, 0.06615519941] | 0 [0, 0.0121766603] | 284550 [243733, 364234] |
| 9 | T043 neglect | 256x60_s7 | 23 (2023) | 354433 [346287, 356797] | 74.54955457 [69.63032368, 76.88739439] | 0.05934742025 [0.05893478772, 0.06984309095] | 0 [0, 0.0121890957] | 363365 [254186, 668027] |
| 9 | T043 neglect | 256x60_s7 | 24 (2024) | 379271 [370574, 380976] | 74.20958766 [69.9018491, 76.42701233] | 0.06324115035 [0.06150497052, 0.07310893368] | 0 [0, 0.01217305478] | 677092 [391602, 1021138] |
| 9 | T043 neglect | 256x60_s7 | 25 (2025) | 404351 [396295, 407122] | 73.09524644 [68.28620705, 75.78001837] | 0.06480573148 [0.06286500377, 0.07558934024] | 0 [0, 0.01216345048] | 1044335 [625599, 1440456] |
| 9 | T043 neglect | 256x60_s7 | 26 (2026) | 430324 [421961, 433168] | 72.29704444 [69.53607948, 77.85680401] | 0.06766168433 [0.06138138396, 0.07653103642] | 0 [0, 0.01216705031] | 1496568 [923619, 1953846] |
| 9 | T043 neglect | 256x60_s7 | 27 (2027) | 458073 [449946, 461295] | 72.97491032 [70.59368988, 76.51947632] | 0.06461290624 [0.06366115042, 0.07671013904] | 0 [0, 0.01217706105] | 1914849 [1163862, 2577354] |
| 9 | T043 neglect | 256x60_s7 | 28 (2028) | 486949 [478863, 490703] | 75.2250257 [72.63992374, 76.8366683] | 0.06528432195 [0.0630399628, 0.07933493515] | 0 [0, 0.01216825073] | 2549441 [1542866, 2944185] |
| 9 | T043 neglect | 256x60_s7 | 29 (2029) | 517259 [509265, 520446] | 77.39853156 [72.5196523, 80.36921236] | 0.06755985979 [0.06567264428, 0.07640189088] | 0 [0, 0.01193702413] | 2863934 [1825994, 3172564] |
| 9 | T043 neglect | 256x60_s7 | 30 (2030) | 548035 [540329, 550816] | 75.78438483 [73.91558257, 80.32236258] | 0.07002044834 [0.06901174026, 0.08014983444] | 0 [0, 0.01155419542] | 3256667 [2344799, 3543046] |
| 9 | T043 neglect | 256x60_s7 | 31 (2031) | 580071 [571155, 582347] | 78.85505852 [76.79013365, 81.74852707] | 0.07378900641 [0.0701614662, 0.08466061682] | 0 [0, 0.01097021528] | 3642325 [2932811, 3805485] |
| 9 | T043 neglect | 256x60_s7 | 32 (2032) | 611278 [602750, 614228] | 78.14782013 [74.69541975, 80.75166529] | 0.07788639199 [0.07531692591, 0.08729933398] | 0 [0, 0.00998246324] | 3959719 [3398314, 4036298] |
| 9 | T043 neglect | 256x60_s7 | 33 (2033) | 643391 [634827, 646317] | 79.18382191 [75.36206692, 81.28281835] | 0.08365675775 [0.07949627123, 0.09543122252] | 0 [0, 0.005596495227] | 4270736 [3730318, 4396463] |
| 9 | T043 neglect | 256x60_s7 | 34 (2034) | 676389 [667013, 678289] | 79.10551221 [75.97593877, 81.32304973] | 0.08749672503 [0.08466655831, 0.09905775358] | 0 [0, 0] | 4575308 [4114863, 4717470] |
| 9 | T043 neglect | 256x60_s7 | 35 (2035) | 708626 [698749, 711259] | 80.18725974 [77.34474686, 81.79421111] | 0.09452426794 [0.09205192476, 0.1017252751] | 0 [0, 0] | 4847825 [4545439, 5127716] |
| 9 | T043 neglect | 256x60_s7 | 36 (2036) | 742621 [732235, 744598] | 78.83777647 [78.0509757, 82.43813518] | 0.0988818983 [0.09291271176, 0.1073091512] | 0 [0, 0] | 5189414 [4903851, 5617299] |
| 9 | T043 neglect | 256x60_s7 | 37 (2037) | 776424 [766279, 779547] | 78.41757834 [76.78330745, 82.03840915] | 0.1050045441 [0.09978266604, 0.1155676451] | 0 [0, 0] | 5480564 [5108726, 6075198] |
| 9 | T043 neglect | 256x60_s7 | 38 (2038) | 812962 [799765, 813562] | 79.05190168 [73.49637289, 80.34698788] | 0.1108259951 [0.1032960121, 0.1205690776] | 0 [0, 0] | 5897594 [5401633, 6608170] |
| 9 | T043 neglect | 256x60_s7 | 39 (2039) | 847302 [834705, 850505] | 78.95536003 [75.14702837, 81.38294495] | 0.1121377754 [0.1051917226, 0.1233904381] | 0 [0, 0] | 6349091 [5712848, 7067727] |
| 9 | T043 neglect | 256x60_s7 | 40 (2040) | 882075 [869318, 883677] | 78.58361083 [76.09163676, 82.16125963] | 0.122010555 [0.1142965818, 0.1314199634] | 0 [0, 0] | 6832273 [6000608, 7306544] |
| 9 | T043 neglect | 256x60_s7 | 41 (2041) | 917375 [903988, 923331] | 76.94997068 [73.82283055, 82.98812006] | 0.1227982697 [0.1134185751, 0.1346195393] | 0 [0, 0] | 7319475 [6314924, 7618526] |
| 9 | T043 neglect | 256x60_s7 | 42 (2042) | 953227 [939116, 958148] | 75.76638246 [74.63856542, 82.26265811] | 0.1294650365 [0.121707765, 0.1397477836] | 0 [0, 0] | 7815025 [6664466, 7978326] |
| 9 | T043 neglect | 256x60_s7 | 43 (2043) | 988127 [975823, 993450] | 75.14226829 [73.8361747, 77.87191991] | 0.1329287245 [0.1290569411, 0.1417057965] | 0 [0, 0] | 8095064 [6968459, 8486863] |
| 9 | T043 neglect | 256x60_s7 | 44 (2044) | 1025639 [1015385, 1033686] | 76.87751869 [73.91853243, 79.99306244] | 0.1391441133 [0.1269742727, 0.1502257628] | 0 [0, 0] | 8535341 [7351617, 9144986] |
| 9 | T043 neglect | 256x60_s7 | 45 (2045) | 1062811 [1056407, 1071471] | 75.2694257 [74.02756905, 78.71946558] | 0.1435198366 [0.1336160128, 0.1537393571] | 0 [0, 0] | 8899368 [7719002, 9823549] |
| 9 | T043 neglect | 256x60_s7 | 46 (2046) | 1101584 [1094463, 1110819] | 74.69880201 [73.76038347, 77.11681695] | 0.1481066984 [0.1381090677, 0.1570429613] | 0 [0, 0] | 9316277 [8120988, 10558602] |
| 9 | T043 neglect | 256x60_s7 | 47 (2047) | 1140423 [1129645, 1148663] | 74.07420733 [73.27180992, 75.48073651] | 0.1543934291 [0.1440818394, 0.1587461925] | 0 [0, 0.003170643878] | 9696550 [8516134, 11297735] |
| 9 | T043 neglect | 256x60_s7 | 48 (2048) | 1178551 [1166091, 1187572] | 74.33188694 [73.05348246, 78.0776505] | 0.1554647754 [0.1435019383, 0.1632200086] | 0 [0, 0.01079099723] | 10201276 [8950263, 12048129] |
| 9 | T043 neglect | 256x60_s7 | 49 (2049) | 1217505 [1205085, 1227549] | 74.19882051 [73.25283918, 76.24914593] | 0.1574057684 [0.1485656983, 0.1649948325] | 0 [0, 0.02405716882] | 10811441 [9388359, 12807414] |
| 9 | T043 neglect | 256x60_s7 | 50 (2050) | 1262894 [1231336, 1267447] | 74.15548116 [72.18592798, 75.4285198] | 0.1601930101 [0.1551889683, 0.1665574891] | 0 [0, 0.04179135528] | 11320142 [9842769, 13565173] |
| 9 | T043 neglect | 256x60_s7 | 51 (2051) | 1306699 [1242757, 1308522] | 74.07424479 [73.10102285, 76.90169088] | 0.1598987905 [0.1527083836, 0.1650918768] | 0 [0, 0.04947002032] | 11745404 [10289402, 14299994] |
| 9 | T043 neglect | 256x60_s7 | 52 (2052) | 1344752 [1254431, 1350750] | 74.20810574 [72.38009092, 79.47695012] | 0.1614046886 [0.1560050501, 0.1723271033] | 0.01058632703 [0, 0.05901709762] | 12212441 [10704318, 15061827] |
| 9 | T043 neglect | 256x60_s7 | 53 (2053) | 1384319 [1271744, 1393338] | 74.12932617 [72.286631, 77.16932862] | 0.1644284096 [0.150052028, 0.1711506607] | 0.02021457543 [0, 0.06933963671] | 12666421 [11131645, 15813453] |
| 9 | T043 neglect | 256x60_s7 | 54 (2054) | 1405205 [1283140, 1419040] | 74.06697173 [72.23164416, 74.33904643] | 0.1657339679 [0.1558961862, 0.1726654912] | 0.03521030027 [0, 0.08124731277] | 13162852 [11566085, 16638268] |
| 9 | T043 neglect | 256x60_s7 | 55 (2055) | 1412346 [1303427, 1458854] | 74.0548475 [72.45454018, 74.45276919] | 0.1653023784 [0.1527903638, 0.1763286473] | 0.04357652692 [0, 0.09066178582] | 13672974 [12043872, 17457753] |
| 9 | T043 neglect | 256x60_s7 | 56 (2056) | 1427267 [1315444, 1487318] | 74.17469156 [73.43597743, 75.87610238] | 0.1645807081 [0.1497950003, 0.1792143651] | 0.05150310602 [0, 0.1104902157] | 14175242 [12548499, 18314574] |
| 9 | T043 neglect | 256x60_s7 | 57 (2057) | 1435932 [1322979, 1514836] | 73.63991382 [72.11554174, 74.34593717] | 0.1669428146 [0.1612673323, 0.1862522908] | 0.06061646129 [0, 0.1177878422] | 14500309 [13075393, 19188277] |
| 9 | T043 neglect | 256x60_s7 | 58 (2058) | 1435941 [1331904, 1538836] | 73.97795046 [71.99297083, 77.06443067] | 0.1659703226 [0.1596332133, 0.176724906] | 0.0705554469 [0, 0.123829807] | 14801713 [13615056, 20080118] |
| 9 | T043 neglect | 256x60_s7 | 59 (2059) | 1448933 [1338804, 1559541] | 73.70109274 [72.21114106, 77.64714812] | 0.1645432937 [0.1589623343, 0.1795385614] | 0.0799324873 [0, 0.1381459896] | 15138825 [14174871, 20955531] |
| 9 | T043 neglect | 256x60_s7 | 60 (2060) | 1450850 [1332759, 1570050] | 73.68034795 [72.18645989, 76.99236984] | 0.1669306271 [0.1614972846, 0.1841221367] | 0.09390050672 [0, 0.1503316232] | 15678152 [14658609, 21838712] |
| 9 | dev attentive | 256x60_s11 | 10 (2010) | 96965 [95898, 97480] | 64.51316532 [61.86675442, 65.07270714] | 0.0654003938 [0.05668998517, 0.07417035988] | 0 [0, 0.02515298993] | 38008 [27919, 64833] |
| 9 | dev attentive | 256x60_s11 | 11 (2011) | 111116 [110004, 111424] | 62.9393458 [61.80972824, 64.04202902] | 0.05930619274 [0.05107261594, 0.06455950736] | 0 [0, 0.0223819917] | 67058 [54169, 72471] |
| 9 | dev attentive | 256x60_s11 | 12 (2012) | 126617 [125426, 127871] | 63.03162844 [61.63120715, 65.24691981] | 0.05227064013 [0.04821362898, 0.05629496671] | 0 [0, 0.02062415197] | 85764 [80636, 92088] |
| 9 | dev attentive | 256x60_s11 | 13 (2013) | 143996 [141572, 145099] | 63.77372029 [62.40833624, 65.62723822] | 0.05050261419 [0.04779384543, 0.0555974715] | 0 [0, 0.01948824755] | 102478 [88127, 105816] |
| 9 | dev attentive | 256x60_s11 | 14 (2014) | 162461 [158959, 163214] | 68.72181555 [64.00144302, 70.23553025] | 0.05354769839 [0.04624352531, 0.05734784314] | 0 [0, 0.01916605706] | 110428 [90432, 118515] |
| 9 | dev attentive | 256x60_s11 | 15 (2015) | 181549 [178036, 182428] | 69.99040013 [66.2917547, 71.14672034] | 0.05146711125 [0.04574636654, 0.05654868993] | 0 [0, 0.01881205994] | 133265 [130439, 136967] |
| 9 | dev attentive | 256x60_s11 | 16 (2016) | 201032 [198458, 202147] | 70.95870622 [70.40255001, 72.31156213] | 0.05243901975 [0.04415267073, 0.0565367467] | 0 [0, 0.01864394696] | 138533 [125668, 149763] |
| 9 | dev attentive | 256x60_s11 | 17 (2017) | 220235 [217287, 221560] | 71.2136114 [70.17472352, 72.37161013] | 0.05730607325 [0.05038313857, 0.06288494318] | 0 [0, 0.01869225556] | 169189 [137106, 176403] |
| 9 | dev attentive | 256x60_s11 | 18 (2018) | 240111 [237922, 242097] | 71.75804674 [70.81756667, 73.15318316] | 0.0545566195 [0.05012809731, 0.06082287841] | 0 [0, 0.0187645479] | 183191 [154360, 188639] |
| 9 | dev attentive | 256x60_s11 | 19 (2019) | 261751 [258901, 264481] | 72.79350929 [72.03169892, 74.5682546] | 0.05288659298 [0.05040153134, 0.05605219931] | 0 [0, 0.01857826626] | 203788 [168062, 231609] |
| 9 | dev attentive | 256x60_s11 | 20 (2020) | 284274 [280865, 287234] | 73.80951549 [72.99639975, 76.71686571] | 0.05237887456 [0.04962951098, 0.05571692536] | 0 [0, 0.01852379595] | 221230 [198850, 301614] |
| 9 | dev attentive | 256x60_s11 | 21 (2021) | 307076 [303929, 310168] | 76.55271753 [75.18406494, 77.75408367] | 0.05228719116 [0.04970068355, 0.05720274841] | 0 [0, 0.01858775772] | 266087 [204744, 334021] |
| 9 | dev attentive | 256x60_s11 | 22 (2022) | 331227 [327213, 333566] | 77.20945433 [76.04791206, 77.48900359] | 0.05457376169 [0.05017630248, 0.05841344147] | 0 [0, 0.01857585139] | 357683 [269413, 393488] |
| 9 | dev attentive | 256x60_s11 | 23 (2023) | 354705 [350807, 357155] | 77.29391853 [76.28875672, 77.93360708] | 0.05773817249 [0.05498658602, 0.06238534093] | 0 [0, 0.01859437894] | 476492 [308155, 713774] |
| 9 | dev attentive | 256x60_s11 | 24 (2024) | 379628 [375350, 381880] | 76.81842666 [76.46037695, 78.16919561] | 0.05995732376 [0.05722897166, 0.06566557226] | 0 [0, 0.01857132673] | 821008 [594360, 1124265] |
| 9 | dev attentive | 256x60_s11 | 25 (2025) | 405373 [400281, 406789] | 76.91201236 [76.26400544, 78.00487489] | 0.06291292617 [0.05815019197, 0.06688977435] | 0 [0, 0.01857662412] | 1244820 [902296, 1569954] |
| 9 | dev attentive | 256x60_s11 | 26 (2026) | 431452 [426244, 432624] | 77.53477369 [76.56468277, 78.24462532] | 0.0614080896 [0.05641094525, 0.06705069123] | 0 [0, 0.01844518178] | 1680013 [1309626, 2100883] |
| 9 | dev attentive | 256x60_s11 | 27 (2027) | 459324 [454626, 460015] | 77.59106086 [76.51653564, 78.80673236] | 0.06311390777 [0.05717494501, 0.06960806194] | 0 [0, 0.01840819093] | 2227773 [1804380, 2689425] |
| 9 | dev attentive | 256x60_s11 | 28 (2028) | 488133 [484568, 489945] | 78.00395902 [77.09107632, 80.15943041] | 0.06297985664 [0.05838485406, 0.07163948255] | 0 [0, 0.01840468873] | 2756573 [2244698, 2957885] |
| 9 | dev attentive | 256x60_s11 | 29 (2029) | 518809 [515169, 520829] | 80.26676226 [78.81777571, 81.60092264] | 0.06534412086 [0.0614472908, 0.07501475024] | 0 [0, 0.01852915829] | 2966249 [2640915, 3072822] |
| 9 | dev attentive | 256x60_s11 | 30 (2030) | 549130 [545987, 551504] | 81.44040119 [79.23201317, 81.86017011] | 0.06974128388 [0.06287188925, 0.07690397234] | 0 [0, 0.01851851852] | 3246439 [2971634, 3472856] |
| 9 | dev attentive | 256x60_s11 | 31 (2031) | 580247 [577395, 583309] | 81.86067262 [80.9234805, 82.37237321] | 0.07449274782 [0.06750458358, 0.0834208008] | 0 [0, 0.01791406791] | 3549363 [3172140, 3771250] |
| 9 | dev attentive | 256x60_s11 | 32 (2032) | 613277 [608730, 615409] | 82.08038268 [81.53994577, 82.81754599] | 0.07751288646 [0.0712081238, 0.08589828281] | 0 [0, 0.01742568949] | 3790838 [3406729, 4029002] |
| 9 | dev attentive | 256x60_s11 | 33 (2033) | 645069 [641046, 648681] | 82.36191775 [81.4447746, 83.29492193] | 0.08373253689 [0.07432911253, 0.09083149239] | 0 [0, 0.0135083954] | 4084698 [3715844, 4280047] |
| 9 | dev attentive | 256x60_s11 | 34 (2034) | 678240 [671270, 681039] | 82.48275178 [81.61488495, 82.96944983] | 0.08674672979 [0.07677897971, 0.1017339747] | 0 [0, 0.009776039815] | 4480286 [4107017, 4616285] |
| 9 | dev attentive | 256x60_s11 | 35 (2035) | 711356 [705812, 714537] | 82.52937431 [81.2325811, 82.89214726] | 0.09383457071 [0.08387349383, 0.1001168765] | 0 [0, 0.009150877193] | 4870205 [4544326, 5033704] |
| 9 | dev attentive | 256x60_s11 | 36 (2036) | 744626 [738362, 749055] | 82.58301146 [81.85118079, 83.80687834] | 0.1008104819 [0.0902128351, 0.1074883004] | 0 [0, 0.004346566213] | 5306015 [4922672, 5490944] |
| 9 | dev attentive | 256x60_s11 | 37 (2037) | 778119 [773730, 782802] | 82.64875723 [82.04106939, 83.14376412] | 0.1034456881 [0.09309862573, 0.1137852842] | 0 [0, 0.004135960295] | 5654823 [5196252, 6001301] |
| 9 | dev attentive | 256x60_s11 | 38 (2038) | 813825 [807517, 817770] | 82.24960982 [81.4223369, 82.95403764] | 0.1088269496 [0.09753072958, 0.1192796154] | 0 [0, 0.004097851732] | 5884291 [5505634, 6393761] |
| 9 | dev attentive | 256x60_s11 | 39 (2039) | 845902 [841049, 853196] | 82.56106021 [81.55621448, 83.17982484] | 0.1172818654 [0.1039987849, 0.1260569594] | 0 [0, 0.004111329828] | 6112238 [5808683, 6768071] |
| 9 | dev attentive | 256x60_s11 | 40 (2040) | 883512 [878323, 889836] | 82.92211563 [81.94548392, 83.25791323] | 0.1192250227 [0.1063159767, 0.1298870237] | 0 [0, 0] | 6414471 [6152429, 7345912] |
| 9 | dev attentive | 256x60_s11 | 41 (2041) | 914777 [913253, 927072] | 82.30204422 [81.13102109, 82.88199613] | 0.1241339084 [0.1114274818, 0.1426966907] | 0 [0, 0] | 6704447 [6548207, 7949616] |
| 9 | dev attentive | 256x60_s11 | 42 (2042) | 955849 [947049, 962805] | 82.1685555 [81.58360699, 82.85594897] | 0.1287609642 [0.115737144, 0.1445750507] | 0 [0, 0] | 7100105 [6983085, 8410469] |
| 9 | dev attentive | 256x60_s11 | 43 (2043) | 993905 [981631, 999561] | 82.00465632 [81.00547299, 82.46245239] | 0.1323431422 [0.1168478751, 0.1466114374] | 0 [0, 0] | 7514338 [7389209, 8636589] |
| 9 | dev attentive | 256x60_s11 | 44 (2044) | 1031139 [1017766, 1038005] | 81.67388548 [80.85613817, 82.3516541] | 0.1390369719 [0.127841465, 0.1533044999] | 0 [0, 0] | 8001817 [7833541, 8989118] |
| 9 | dev attentive | 256x60_s11 | 45 (2045) | 1069790 [1055287, 1076009] | 81.36202709 [80.19805909, 82.47122756] | 0.1432531656 [0.1333436385, 0.1582652729] | 0 [0, 0] | 8507837 [8266064, 9304880] |
| 9 | dev attentive | 256x60_s11 | 46 (2046) | 1109236 [1094324, 1115154] | 81.15689888 [80.38641199, 81.55480341] | 0.1519717894 [0.1357195976, 0.1599063541] | 0 [0, 0] | 9042759 [8742386, 9648293] |
| 9 | dev attentive | 256x60_s11 | 47 (2047) | 1147038 [1132339, 1152325] | 80.61678777 [79.54124608, 81.87627023] | 0.1571084706 [0.1384097742, 0.1691387619] | 0 [0, 0] | 9555408 [9210307, 9993204] |
| 9 | dev attentive | 256x60_s11 | 48 (2048) | 1186645 [1169316, 1190815] | 81.30027825 [79.77912608, 81.82341419] | 0.1539436622 [0.1401538809, 0.1718086539] | 0 [0, 0] | 9993095 [9692855, 10379593] |
| 9 | dev attentive | 256x60_s11 | 49 (2049) | 1230333 [1209924, 1233587] | 80.53417522 [79.83050167, 81.4235582] | 0.1552666702 [0.1444448796, 0.173847097] | 0 [0, 0] | 10484040 [10187215, 10757000] |
| 9 | dev attentive | 256x60_s11 | 50 (2050) | 1266953 [1254073, 1276465] | 80.82217177 [79.83074281, 81.32143553] | 0.1632612259 [0.1406264164, 0.1742082937] | 0 [0, 0] | 10927327 [10665374, 11236727] |
| 9 | dev attentive | 256x60_s11 | 51 (2051) | 1310276 [1295571, 1317330] | 80.42179852 [79.66337622, 80.89282769] | 0.1614402073 [0.1464726793, 0.1751268429] | 0 [0, 0.01001936682] | 11343174 [11060561, 11729023] |
| 9 | dev attentive | 256x60_s11 | 52 (2052) | 1353432 [1335822, 1358146] | 80.53233881 [79.59390783, 80.72519232] | 0.1638558121 [0.1438624046, 0.1808752239] | 0.005202820997 [0, 0.01252123456] | 11738398 [11428427, 12226556] |
| 9 | dev attentive | 256x60_s11 | 53 (2053) | 1391300 [1372356, 1404494] | 80.81411087 [79.31384766, 81.18726939] | 0.1616330195 [0.1428250091, 0.1826576173] | 0.01610534701 [0, 0.025] | 12233339 [11771694, 12752917] |
| 9 | dev attentive | 256x60_s11 | 54 (2054) | 1410655 [1388950, 1450423] | 80.42361043 [79.70134958, 81.51072777] | 0.1640567885 [0.1433599574, 0.1808285073] | 0.02567348687 [0, 0.03162642268] | 12758952 [12131215, 13334195] |
| 9 | dev attentive | 256x60_s11 | 55 (2055) | 1428499 [1386414, 1468215] | 80.74035446 [79.9308202, 81.71725752] | 0.165500896 [0.1448856511, 0.1840435431] | 0.02858932898 [0, 0.04062968787] | 13278437 [12509588, 13954462] |
| 9 | dev attentive | 256x60_s11 | 56 (2056) | 1444001 [1400344, 1478360] | 80.37563131 [80.11060148, 80.92261892] | 0.1638482235 [0.1447515442, 0.1794281601] | 0.04127067702 [0, 0.05686618079] | 13804516 [12922715, 14587716] |
| 9 | dev attentive | 256x60_s11 | 57 (2057) | 1456317 [1403945, 1487877] | 80.32917658 [79.07665525, 81.11718024] | 0.1686174775 [0.1459097469, 0.1865505337] | 0.04896346982 [0, 0.0863655154] | 14357197 [13341360, 15252986] |
| 9 | dev attentive | 256x60_s11 | 58 (2058) | 1462768 [1414561, 1491615] | 80.21296639 [79.51884343, 80.86356599] | 0.1686960201 [0.1424713535, 0.1822657263] | 0.05092646351 [0, 0.09898710137] | 14921944 [13770775, 15956600] |
| 9 | dev attentive | 256x60_s11 | 59 (2059) | 1482680 [1416617, 1504263] | 80.10278542 [79.69065754, 80.82700816] | 0.1626696819 [0.1473044973, 0.1829738232] | 0.07086746718 [0, 0.1009583673] | 15515611 [14255061, 16694398] |
| 9 | dev attentive | 256x60_s11 | 60 (2060) | 1483518 [1427340, 1511108] | 80.44119872 [79.13716727, 81.35669456] | 0.1707497937 [0.1474850575, 0.1905127344] | 0.08191000329 [0, 0.105790072] | 16119047 [14770707, 17447223] |
| 9 | T043 attentive | 256x60_s11 | 10 (2010) | 79929 [73197, 90844] | 66.42366854 [64.77362703, 67.89609742] | 0.07346188306 [0.05058129813, 0.08853611852] | 0 [0, 0.01809324983] | 32057 [23183, 55892] |
| 9 | T043 attentive | 256x60_s11 | 11 (2011) | 93158 [85871, 104820] | 65.19282809 [63.47133916, 67.30272763] | 0.07589041027 [0.07004441449, 0.08315196793] | 0 [0, 0.01805562069] | 46730 [24160, 62840] |
| 9 | T043 attentive | 256x60_s11 | 12 (2012) | 107177 [99547, 119061] | 65.02467143 [63.25756716, 66.09097244] | 0.06704833301 [0.06047673394, 0.08366835406] | 0 [0, 0.01645613131] | 64248 [53648, 76614] |
| 9 | T043 attentive | 256x60_s11 | 13 (2013) | 123229 [114295, 136136] | 65.82680555 [62.22394942, 68.38007727] | 0.06050994398 [0.05650831432, 0.06796541906] | 0 [0, 0.01476598041] | 81157 [73736, 91673] |
| 9 | T043 attentive | 256x60_s11 | 14 (2014) | 139741 [130213, 152641] | 67.72351457 [63.98322749, 70.35934329] | 0.05720197518 [0.05479344984, 0.06242301784] | 0 [0, 0.01346978969] | 97384 [84521, 102854] |
| 9 | T043 attentive | 256x60_s11 | 15 (2015) | 157082 [146745, 170157] | 69.22667991 [67.23956321, 70.71241139] | 0.0544430911 [0.05188795729, 0.06290392611] | 0 [0, 0.009601660828] | 107233 [88510, 120586] |
| 9 | T043 attentive | 256x60_s11 | 16 (2016) | 175715 [164801, 190071] | 70.5217926 [68.9983573, 71.39629174] | 0.0527191022 [0.04953061855, 0.05990230422] | 0 [0, 0.006345909773] | 131047 [120874, 136788] |
| 9 | T043 attentive | 256x60_s11 | 17 (2017) | 194160 [184076, 208931] | 70.72769277 [69.75289685, 72.02765926] | 0.05356722923 [0.04922323546, 0.06240115762] | 0 [0, 0.003812779385] | 142175 [133288, 153313] |
| 9 | T043 attentive | 256x60_s11 | 18 (2018) | 212620 [203383, 229426] | 70.93731682 [70.46719615, 71.89436158] | 0.05845593826 [0.04832550689, 0.06566940013] | 0 [0, 0.008579068558] | 150268 [133058, 165138] |
| 9 | T043 attentive | 256x60_s11 | 19 (2019) | 232634 [221847, 250554] | 70.93337428 [70.25878054, 71.61320278] | 0.06042655485 [0.05288262118, 0.06866569924] | 0 [0, 0.007990038394] | 176506 [142619, 183020] |
| 9 | T043 attentive | 256x60_s11 | 20 (2020) | 254154 [242068, 271736] | 71.71414678 [69.29284151, 72.47206807] | 0.05733593596 [0.05254433949, 0.06208409998] | 0 [0, 0.007786954323] | 172316 [154507, 210701] |
| 9 | T043 attentive | 256x60_s11 | 21 (2021) | 276069 [263589, 295273] | 72.82749147 [71.87396896, 74.7582549] | 0.05600744262 [0.05270669591, 0.06104371017] | 0 [0, 0.007665250863] | 215849 [194182, 236618] |
| 9 | T043 attentive | 256x60_s11 | 22 (2022) | 299194 [285844, 319012] | 75.50395855 [71.1393607, 76.65411749] | 0.05606904668 [0.05241974297, 0.0601705106] | 0 [0, 0.007676713968] | 255527 [198232, 273018] |
| 9 | T043 attentive | 256x60_s11 | 23 (2023) | 322372 [308860, 342452] | 75.36561497 [71.14522612, 77.43685901] | 0.05522259997 [0.0525231064, 0.05993555661] | 0 [0, 0.007673653789] | 288584 [216154, 335763] |
| 9 | T043 attentive | 256x60_s11 | 24 (2024) | 345744 [332178, 365631] | 76.15589594 [75.05702805, 77.19242143] | 0.05990643386 [0.05269337846, 0.06599871564] | 0 [0, 0.007677479394] | 348843 [265989, 470975] |
| 9 | T043 attentive | 256x60_s11 | 25 (2025) | 370161 [355541, 390459] | 76.51863018 [75.62420224, 77.24408694] | 0.061759906 [0.05468431684, 0.06645370827] | 0 [0, 0.007676713968] | 549037 [334829, 812237] |
| 9 | T043 attentive | 256x60_s11 | 26 (2026) | 395020 [380315, 416931] | 76.96931472 [75.63920089, 77.90332122] | 0.06254250183 [0.05929645545, 0.0711592513] | 0 [0, 0.007676458859] | 866930 [450518, 1231632] |
| 9 | T043 attentive | 256x60_s11 | 27 (2027) | 421716 [405212, 443932] | 77.07957755 [76.10813268, 78.24338813] | 0.06127897366 [0.05876013161, 0.07134673668] | 0 [0, 0.007674928567] | 1276274 [802943, 1751077] |
| 9 | T043 attentive | 256x60_s11 | 28 (2028) | 449068 [432786, 472021] | 77.43850279 [76.74886167, 78.17921067] | 0.06332065728 [0.05922628232, 0.07084441326] | 0 [0, 0.007668558908] | 1778354 [1205491, 2350363] |
| 9 | T043 attentive | 256x60_s11 | 29 (2029) | 478054 [461060, 501010] | 77.60725126 [76.55716565, 78.62310261] | 0.06570976622 [0.06184069746, 0.06877621614] | 0 [0, 0.007611202636] | 2237081 [1465038, 2874947] |
| 9 | T043 attentive | 256x60_s11 | 30 (2030) | 508043 [490400, 531451] | 77.96311083 [77.29374033, 80.19548441] | 0.06738778978 [0.06462287454, 0.07286180164] | 0 [0, 0.007140207715] | 2854358 [1957959, 3248994] |
| 9 | T043 attentive | 256x60_s11 | 31 (2031) | 539847 [520584, 562400] | 79.71651949 [77.97306131, 81.45640992] | 0.07159613034 [0.06735404389, 0.07480608421] | 0 [0, 0.007098518837] | 3216410 [2515998, 3517451] |
| 9 | T043 attentive | 256x60_s11 | 32 (2032) | 570929 [551496, 593284] | 81.07658138 [79.12943793, 81.976905] | 0.07550049257 [0.07063795761, 0.07999098815] | 0 [0, 0.006970218159] | 3602145 [3187125, 3890234] |
| 9 | T043 attentive | 256x60_s11 | 33 (2033) | 603203 [582890, 625356] | 81.72114244 [79.87445047, 82.51037373] | 0.07777220033 [0.07602352484, 0.08258659964] | 0 [0, 0.006738819686] | 3934644 [3555942, 4279782] |
| 9 | T043 attentive | 256x60_s11 | 34 (2034) | 634852 [614389, 657308] | 82.06885687 [81.21337311, 83.09718764] | 0.08463124565 [0.07977047858, 0.09219568958] | 0 [0, 0.002119752237] | 4167541 [3901622, 4507830] |
| 9 | T043 attentive | 256x60_s11 | 35 (2035) | 667812 [647549, 690961] | 82.39201611 [81.35413637, 82.96510758] | 0.08751076251 [0.08429105412, 0.09331197982] | 0 [0, 0.002006776127] | 4502032 [4194330, 4803760] |
| 9 | T043 attentive | 256x60_s11 | 36 (2036) | 701131 [679945, 724078] | 82.31504022 [81.75529892, 83.11437325] | 0.0934854205 [0.09024419248, 0.0990169568] | 0 [0, 0] | 4896545 [4545889, 5148487] |
| 9 | T043 attentive | 256x60_s11 | 37 (2037) | 732614 [713331, 757658] | 82.39366048 [81.17131857, 83.71896494] | 0.1001026267 [0.09481648331, 0.1060205888] | 0 [0, 0] | 5319691 [4822469, 5531020] |
| 9 | T043 attentive | 256x60_s11 | 38 (2038) | 767204 [747658, 791635] | 82.37043938 [80.70163295, 83.14037682] | 0.1040808942 [0.1013021498, 0.1109144865] | 0 [0, 0] | 5778493 [5077732, 5977980] |
| 9 | T043 attentive | 256x60_s11 | 39 (2039) | 800416 [780955, 827538] | 81.62889492 [80.69557156, 82.58776582] | 0.1126968765 [0.1066867548, 0.1162234633] | 0 [0, 0] | 6301537 [5400755, 6476763] |
| 9 | T043 attentive | 256x60_s11 | 40 (2040) | 834909 [816309, 862908] | 81.59294319 [81.2279754, 82.62486347] | 0.1176669114 [0.1092145641, 0.1245948012] | 0 [0, 0] | 6650018 [5779100, 6991178] |
| 9 | T043 attentive | 256x60_s11 | 41 (2041) | 872331 [851991, 898943] | 82.31382633 [81.40240936, 82.96064381] | 0.1213239386 [0.1141992671, 0.1322755688] | 0 [0, 0] | 7055049 [6123109, 7502096] |
| 9 | T043 attentive | 256x60_s11 | 42 (2042) | 907818 [885588, 935729] | 82.15740914 [81.74930947, 82.74840079] | 0.127466011 [0.1218615336, 0.1360454769] | 0 [0, 0] | 7358790 [6538030, 8100423] |
| 9 | T043 attentive | 256x60_s11 | 43 (2043) | 945232 [922914, 970769] | 82.17982924 [81.12532066, 82.67805323] | 0.1309049131 [0.1226224776, 0.1397630379] | 0 [0, 0] | 7781367 [6995097, 8609017] |
| 9 | T043 attentive | 256x60_s11 | 44 (2044) | 978657 [958138, 1009297] | 82.20218285 [80.84789651, 82.86986629] | 0.1343551157 [0.1273787916, 0.1397535028] | 0 [0, 0] | 8136570 [7473998, 8776714] |
| 9 | T043 attentive | 256x60_s11 | 45 (2045) | 1014968 [994838, 1045852] | 81.50654338 [80.64804865, 82.36079561] | 0.1396452284 [0.1338942476, 0.1460786031] | 0 [0, 0.01242842213] | 8497056 [7962610, 9084172] |
| 9 | T043 attentive | 256x60_s11 | 46 (2046) | 1056630 [1030351, 1079727] | 81.06094937 [80.28047535, 82.15073015] | 0.144806118 [0.1373714661, 0.147418287] | 0 [0, 0.02273938533] | 8854847 [8339428, 9384358] |
| 9 | T043 attentive | 256x60_s11 | 47 (2047) | 1092633 [1072294, 1117525] | 81.21925959 [79.80469557, 81.49533153] | 0.1494094799 [0.141799927, 0.1546846279] | 0 [0, 0.03418634033] | 9211285 [8835751, 9934928] |
| 9 | T043 attentive | 256x60_s11 | 48 (2048) | 1131814 [1107154, 1154533] | 80.6347039 [79.63566392, 81.62662912] | 0.152145379 [0.1382834524, 0.1580500036] | 0 [0, 0.05331081896] | 9627511 [9316158, 10606505] |
| 9 | T043 attentive | 256x60_s11 | 49 (2049) | 1170273 [1145695, 1194916] | 80.64222179 [79.57704177, 81.23195362] | 0.1556214836 [0.1425714845, 0.1588374594] | 0 [0, 0.05684687652] | 10117949 [9733810, 11347203] |
| 9 | T043 attentive | 256x60_s11 | 50 (2050) | 1206863 [1187658, 1237372] | 80.71892883 [80.08563754, 81.89020439] | 0.1552154771 [0.14100933, 0.1638457838] | 0 [0, 0.06768889881] | 10638520 [10153229, 12120441] |
| 9 | T043 attentive | 256x60_s11 | 51 (2051) | 1251985 [1201219, 1277641] | 80.89730142 [79.68278455, 81.48178976] | 0.1620198069 [0.1441335073, 0.1655375552] | 0 [0, 0.07401259949] | 11051475 [10570515, 12889424] |
| 9 | T043 attentive | 256x60_s11 | 52 (2052) | 1291903 [1216389, 1321482] | 80.52580911 [79.77294453, 81.55628244] | 0.1625080917 [0.1489940825, 0.1722871756] | 0 [0, 0.08120938615] | 11482939 [10938572, 13695879] |
| 9 | T043 attentive | 256x60_s11 | 53 (2053) | 1334456 [1217398, 1364958] | 80.16445492 [79.40682253, 80.56688263] | 0.1625194937 [0.1428539779, 0.1706168643] | 0.00176356179 [0, 0.09264062421] | 12015776 [11280430, 14514456] |
| 9 | T043 attentive | 256x60_s11 | 54 (2054) | 1368175 [1226920, 1406993] | 79.89415134 [79.27108596, 80.9362708] | 0.1634266798 [0.147062217, 0.1694265447] | 0.01114565668 [0, 0.1022132939] | 12378573 [11631271, 15351670] |
| 9 | T043 attentive | 256x60_s11 | 55 (2055) | 1381428 [1225951, 1436055] | 79.8924593 [79.21678525, 81.27355081] | 0.1627324087 [0.1466252411, 0.171488278] | 0.01929487241 [0, 0.1180151349] | 12751534 [11980933, 16172865] |
| 9 | T043 attentive | 256x60_s11 | 56 (2056) | 1398899 [1236771, 1445888] | 80.11515404 [79.30924045, 81.03534565] | 0.1667237491 [0.1459777422, 0.1720514777] | 0.02966020757 [0, 0.1288274532] | 13134116 [12345876, 17020915] |
| 9 | T043 attentive | 256x60_s11 | 57 (2057) | 1411981 [1261215, 1456925] | 80.26915051 [78.74372224, 80.65700486] | 0.1642332156 [0.1436090334, 0.1702506606] | 0.03848652479 [0, 0.1374310253] | 13517765 [12713727, 17706075] |
| 9 | T043 attentive | 256x60_s11 | 58 (2058) | 1419563 [1263833, 1469306] | 80.06723779 [78.10998851, 81.10967373] | 0.1674984503 [0.1420376789, 0.1748627555] | 0.04492406351 [0, 0.1483255116] | 13913460 [13076136, 18112077] |
| 9 | T043 attentive | 256x60_s11 | 59 (2059) | 1424104 [1269752, 1480780] | 80.02559904 [79.04074098, 80.77079714] | 0.1694845824 [0.1396811971, 0.1766184017] | 0.05913673209 [0, 0.1485972794] | 14317092 [13450685, 18552510] |
| 9 | T043 attentive | 256x60_s11 | 60 (2060) | 1433346 [1276729, 1503722] | 80.08316611 [79.26737799, 81.15688928] | 0.1697226611 [0.1407599336, 0.1739877498] | 0.07395224912 [0, 0.1492415482] | 14715421 [13848164, 19008552] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 10 (2010) | 94684 [93959, 96347] | 60.67508696 [59.0808137, 64.69067878] | 0.06369271813 [0.05727235622, 0.07283764257] | 0.00858769261 [0, 0.01630354232] | 58434 [27804, 65392] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 11 (2011) | 108715 [107952, 110681] | 62.32212688 [55.35884191, 64.22112567] | 0.05543104289 [0.05071984156, 0.06123490927] | 0.007460686204 [0, 0.01635338346] | 62652 [45896, 70407] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 12 (2012) | 124376 [123072, 126599] | 59.95710053 [59.14845426, 62.88310332] | 0.05162644906 [0.04899517678, 0.05432440253] | 0.003715650647 [0, 0.01539187103] | 80511 [74132, 89601] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 13 (2013) | 140752 [138940, 143318] | 58.63962016 [55.40797919, 61.21743214] | 0.05195326794 [0.04986095669, 0.0535849444] | 0.003457972336 [0, 0.01402891755] | 95355 [84524, 101591] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 14 (2014) | 157201 [156154, 160779] | 60.04132294 [57.50486823, 63.8086781] | 0.04951759318 [0.04796955823, 0.05901127078] | 0 [0, 0.01306032097] | 112062 [94964, 116503] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 15 (2015) | 176039 [174363, 179181] | 61.2038884 [59.04746708, 65.32521929] | 0.05144338702 [0.0468196508, 0.05810112084] | 0 [0, 0.01296242354] | 129570 [118415, 132824] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 16 (2016) | 196057 [194032, 198699] | 66.68696523 [59.75018126, 68.66469785] | 0.0516787195 [0.04617457004, 0.05692370962] | 0 [0, 0.01263441814] | 138113 [106734, 142809] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 17 (2017) | 215783 [213118, 218728] | 67.70143111 [60.51581114, 70.84105943] | 0.05537574346 [0.04909904724, 0.06101927288] | 0 [0, 0.01240299335] | 148840 [136406, 163144] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 18 (2018) | 235878 [234490, 239185] | 67.23833413 [63.00769324, 70.55995873] | 0.0565308436 [0.04879489278, 0.06162311751] | 0 [0, 0.01233253178] | 169004 [146588, 187200] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 19 (2019) | 257369 [255654, 260616] | 69.09572967 [63.48549941, 72.44737873] | 0.0531185468 [0.04806193485, 0.0603465846] | 0 [0, 0.01226469885] | 185354 [165818, 216125] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 20 (2020) | 279146 [278190, 282413] | 70.54603473 [64.14270221, 75.65441874] | 0.05244147567 [0.04844274447, 0.05851179315] | 0 [0, 0.01225515158] | 221459 [175773, 243525] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 21 (2021) | 302341 [300252, 305135] | 71.11751528 [64.66488473, 74.95404746] | 0.05304685578 [0.04857920826, 0.0579267131] | 0 [0, 0.01230383351] | 245665 [204946, 302913] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 22 (2022) | 325873 [324494, 328696] | 73.84416735 [69.68033929, 77.46487109] | 0.05461698286 [0.05043765312, 0.0580388661] | 0 [0, 0.01227368278] | 308814 [218418, 336937] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 23 (2023) | 349522 [347747, 352490] | 75.10919018 [72.95071082, 77.79748748] | 0.05785973442 [0.05393925108, 0.06315760624] | 0 [0, 0.01228409515] | 320230 [228713, 576697] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 24 (2024) | 373936 [371653, 377070] | 74.55776981 [72.72250346, 77.45311469] | 0.06157849052 [0.05689351518, 0.06456999554] | 0 [0, 0.01221622722] | 505120 [270599, 920970] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 25 (2025) | 398724 [396581, 402686] | 72.55835057 [68.05309724, 74.82365408] | 0.06424373927 [0.05931523971, 0.06987393018] | 0 [0, 0.01228659675] | 843730 [530647, 1321690] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 26 (2026) | 425172 [422511, 429080] | 72.83755276 [70.96266204, 75.18848699] | 0.06293297912 [0.05645354318, 0.06950377852] | 0 [0, 0.01214327018] | 1252842 [861073, 1819870] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 27 (2027) | 452394 [450504, 456147] | 74.29288854 [70.43908879, 76.68316103] | 0.06415308727 [0.05802799596, 0.06737038223] | 0 [0, 0.01208746435] | 1731625 [1163673, 2404032] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 28 (2028) | 481659 [478992, 485224] | 74.89844072 [70.90088317, 78.50915746] | 0.06364511885 [0.05830328191, 0.06884919095] | 0 [0, 0.01217266776] | 2216840 [1681445, 2939528] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 29 (2029) | 511547 [510070, 515513] | 74.71593589 [69.68270295, 79.7369004] | 0.06753295866 [0.060121506, 0.07289255697] | 0 [0, 0.01169286735] | 2640330 [1995733, 2894886] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 30 (2030) | 542437 [540591, 546436] | 75.84133007 [73.54484626, 80.56293141] | 0.06902708444 [0.06423253067, 0.07528329462] | 0 [0, 0.01164219649] | 3055256 [2596732, 3359813] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 31 (2031) | 574126 [571350, 577660] | 79.7410792 [74.12788719, 80.75587265] | 0.07410046341 [0.06751928909, 0.07942737787] | 0 [0, 0.01117146978] | 3541120 [3148440, 3718754] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 32 (2032) | 605226 [602608, 608956] | 79.25292055 [73.48558816, 82.34168216] | 0.07963152479 [0.07093974741, 0.08466575514] | 0 [0, 0.01104972376] | 3779656 [3395428, 4015570] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 33 (2033) | 637704 [634704, 640441] | 76.98255056 [73.2542644, 82.17544902] | 0.0840972432 [0.07235788396, 0.08808058274] | 0 [0, 0.01044341722] | 4108312 [3673295, 4380148] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 34 (2034) | 670234 [666882, 672569] | 78.64594721 [73.99014272, 80.55144427] | 0.09078568617 [0.07626021548, 0.09905242409] | 0 [0, 0.004414708382] | 4474322 [4020294, 4662492] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 35 (2035) | 703146 [701336, 705788] | 79.29909866 [75.38994586, 80.39605131] | 0.09580895967 [0.07926161554, 0.1011410963] | 0 [0, 0.002030559927] | 4799065 [4430589, 4947308] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 36 (2036) | 736011 [735236, 740103] | 79.49849184 [74.86564653, 81.39371155] | 0.1024519196 [0.0843597219, 0.1103671145] | 0 [0, 0.001872037915] | 5174914 [4907959, 5292234] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 37 (2037) | 770876 [766868, 774754] | 79.6190765 [74.72679715, 80.93641123] | 0.1085835511 [0.08880643526, 0.1133911567] | 0 [0, 0.001845912458] | 5584929 [5296966, 5677825] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 38 (2038) | 804395 [802067, 809389] | 77.2769977 [74.16025098, 80.23531344] | 0.1129716171 [0.09400466916, 0.1181165461] | 0 [0, 0.00175852551] | 6013958 [5510705, 6138409] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 39 (2039) | 838476 [835615, 845174] | 77.05450109 [75.03996587, 81.07511281] | 0.1193562434 [0.1003347622, 0.1292186267] | 0 [0, 0.001738059094] | 6475232 [5773989, 6616214] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 40 (2040) | 874655 [870631, 880399] | 78.77176133 [74.37965357, 81.64051544] | 0.1200773364 [0.1019764386, 0.131722223] | 0 [0, 0.001618255561] | 6976943 [6044170, 7184505] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 41 (2041) | 909403 [905344, 913390] | 75.65233107 [73.63533053, 80.45337922] | 0.1263781385 [0.1130121592, 0.1327214482] | 0 [0, 0.00147473593] | 7291111 [6393933, 7778516] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 42 (2042) | 944583 [943131, 947412] | 76.61830369 [73.2182616, 80.9563038] | 0.1317072874 [0.119372724, 0.1404970369] | 0 [0, 0.001331026221] | 7619450 [6793395, 8156291] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 43 (2043) | 980454 [976539, 985042] | 76.70622408 [72.73321718, 81.05462316] | 0.1378393241 [0.1203345014, 0.1475667305] | 0 [0, 0.001216415528] | 7978937 [7100329, 8710173] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 44 (2044) | 1018148 [1016319, 1023975] | 74.99783183 [72.87497432, 79.19858978] | 0.1392219311 [0.1208073142, 0.1450851807] | 0 [0, 0.001613287624] | 8295610 [7513732, 9397290] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 45 (2045) | 1055402 [1052181, 1058377] | 74.59018532 [72.67450618, 80.30945231] | 0.1501550686 [0.1279165357, 0.154164705] | 0 [0, 0.01443189369] | 8805567 [7919484, 10076466] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 46 (2046) | 1092559 [1088962, 1099023] | 74.25346989 [72.01331241, 75.78620979] | 0.1532477251 [0.1229408177, 0.1584142537] | 0 [0, 0.02133030308] | 9172527 [8340615, 10780684] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 47 (2047) | 1130739 [1125956, 1137610] | 74.57691934 [72.86535973, 77.81337312] | 0.1534623915 [0.1345276217, 0.1599067495] | 0 [0, 0.02782959289] | 9556581 [8807452, 11509396] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 48 (2048) | 1173165 [1162357, 1176771] | 75.14701118 [72.38740857, 79.75272581] | 0.1563751662 [0.1379682619, 0.1642426128] | 0 [0, 0.03782307379] | 9911345 [9243007, 12257767] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 49 (2049) | 1212110 [1197374, 1218831] | 74.29696923 [72.77952248, 78.85394122] | 0.1611749541 [0.1348171011, 0.167430701] | 0 [0, 0.0435910535] | 10290630 [9724899, 13027798] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 50 (2050) | 1255374 [1222314, 1260450] | 74.15623768 [73.33886085, 79.91529533] | 0.1623982173 [0.1418875315, 0.1708313706] | 0.0008378241397 [0, 0.04584872642] | 10695479 [10211641, 13827247] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 51 (2051) | 1295984 [1227999, 1302733] | 73.90495181 [72.4971295, 78.45429743] | 0.1665544873 [0.1385845708, 0.1674743729] | 0.006457329776 [0, 0.06149153208] | 11090315 [10685670, 14564185] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 52 (2052) | 1334266 [1238368, 1343713] | 73.45018239 [71.38630819, 76.82549247] | 0.1664846703 [0.1362217683, 0.1711820929] | 0.02000074249 [0, 0.07485332202] | 11553535 [10988611, 15327992] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 53 (2053) | 1372354 [1265504, 1381858] | 73.66396648 [71.34675157, 78.1769813] | 0.1664051955 [0.1412140363, 0.1737688037] | 0.03219057539 [0, 0.1023355071] | 12012589 [11251357, 16131428] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 54 (2054) | 1381440 [1284063, 1419916] | 73.75434024 [71.88752494, 76.47180441] | 0.1676913242 [0.1389223887, 0.1743071393] | 0.04068816527 [0, 0.1141474306] | 12518121 [11565083, 16983061] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 55 (2055) | 1402383 [1285348, 1443652] | 74.38044754 [71.9585464, 75.50593298] | 0.1675971137 [0.1449887, 0.1750312371] | 0.05181811268 [0.01396491789, 0.1258187736] | 13027540 [11916811, 17829578] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 56 (2056) | 1412728 [1295760, 1458532] | 74.19031887 [72.23965868, 75.94439892] | 0.1673100187 [0.142433766, 0.1793910934] | 0.0566651908 [0.01388242517, 0.1289334429] | 13570869 [12283789, 18752753] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 57 (2057) | 1424220 [1311483, 1470278] | 73.93676138 [72.34200267, 74.95599483] | 0.1684485339 [0.1444341984, 0.1792741326] | 0.06616225237 [0.01388102827, 0.1313939931] | 14120788 [12661904, 19699412] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 58 (2058) | 1435361 [1318045, 1482544] | 74.16576019 [72.19793659, 77.13170626] | 0.1672247444 [0.1437879674, 0.1759440537] | 0.08511286417 [0.01392835145, 0.144356589] | 14568032 [13053620, 20651616] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 59 (2059) | 1445000 [1324289, 1482802] | 73.7673309 [73.41015368, 76.85382227] | 0.169637101 [0.1498684915, 0.1794492048] | 0.1021635177 [0.01383986993, 0.1553555299] | 15048118 [13470653, 21656984] |
| 9 | dev neglect (LG-06 off) | 256x60_s11 | 60 (2060) | 1455512 [1348839, 1496612] | 74.3485019 [72.62980872, 78.55316574] | 0.166475417 [0.1490928092, 0.1734176721] | 0.1146809089 [0.01389896901, 0.1661093544] | 15537793 [13890690, 22645806] |
| 9 | T043 neglect | 256x60_s11 | 10 (2010) | 95872 [88150, 96746] | 61.48931346 [58.83172815, 63.56278767] | 0.07682872822 [0.07230449038, 0.09125319874] | 0 [0, 0] | 56682 [26604, 65710] |
| 9 | T043 neglect | 256x60_s11 | 11 (2011) | 110213 [101775, 110814] | 60.82330638 [55.64763282, 63.72505134] | 0.06627109651 [0.06303211739, 0.08052000444] | 0 [0, 0.01647790794] | 71075 [56977, 77905] |
| 9 | T043 neglect | 256x60_s11 | 12 (2012) | 126732 [116554, 127254] | 64.19535728 [56.1246322, 68.01197293] | 0.06142366498 [0.05767067627, 0.06715041709] | 0 [0, 0.01474007458] | 85754 [76983, 91640] |
| 9 | T043 neglect | 256x60_s11 | 13 (2013) | 142943 [133414, 143972] | 62.46287053 [60.48769146, 68.06831063] | 0.0571571148 [0.05374352991, 0.06719343108] | 0 [0, 0.01356696464] | 99892 [87140, 103795] |
| 9 | T043 neglect | 256x60_s11 | 14 (2014) | 160449 [148454, 161580] | 65.36387984 [59.40277111, 68.24298551] | 0.05575290272 [0.05233937168, 0.06877114057] | 0 [0, 0.01239669421] | 110836 [95224, 121420] |
| 9 | T043 neglect | 256x60_s11 | 15 (2015) | 178786 [165556, 180642] | 66.6581594 [60.63674846, 71.56654913] | 0.05325665596 [0.05079674663, 0.06652142307] | 0 [0, 0.01136559325] | 130427 [115307, 136866] |
| 9 | T043 neglect | 256x60_s11 | 16 (2016) | 197757 [186196, 200578] | 70.27163528 [67.08079143, 71.8880032] | 0.052613637 [0.04864105557, 0.07748307939] | 0 [0, 0.01077962749] | 140184 [108681, 156561] |
| 9 | T043 neglect | 256x60_s11 | 17 (2017) | 217170 [205991, 221369] | 67.18385144 [64.34069806, 70.86089671] | 0.05729239947 [0.05436164583, 0.07560395515] | 0 [0, 0.00233794517] | 153471 [138511, 168395] |
| 9 | T043 neglect | 256x60_s11 | 18 (2018) | 237146 [226578, 242054] | 68.46433355 [65.41864693, 71.93600512] | 0.0562686634 [0.05389481253, 0.07030999248] | 0 [0, 0.002281963113] | 164824 [153793, 209730] |
| 9 | T043 neglect | 256x60_s11 | 19 (2019) | 258279 [247786, 263941] | 68.92906422 [63.64389548, 74.36255646] | 0.05531323029 [0.05260524215, 0.07176200099] | 0 [0, 0.002312468322] | 197271 [171606, 245197] |
| 9 | T043 neglect | 256x60_s11 | 20 (2020) | 280912 [270008, 287520] | 71.20335074 [65.28715159, 74.21675684] | 0.05543552285 [0.0514421125, 0.06790762269] | 0 [0, 0.002286680867] | 219113 [182824, 283546] |
| 9 | T043 neglect | 256x60_s11 | 21 (2021) | 304341 [293425, 310869] | 71.79477746 [66.94889365, 73.43514743] | 0.057620763 [0.05118624132, 0.06885597777] | 0 [0, 0.00228067983] | 276846 [227620, 342636] |
| 9 | T043 neglect | 256x60_s11 | 22 (2022) | 327059 [316762, 333957] | 72.90759452 [68.97316284, 76.785758] | 0.0589313286 [0.05414091457, 0.06988474202] | 0 [0, 0.002273789129] | 294265 [219242, 570488] |
| 9 | T043 neglect | 256x60_s11 | 23 (2023) | 350724 [341085, 358081] | 71.71997415 [69.67590262, 77.1072491] | 0.0605509081 [0.05755901728, 0.0709314419] | 0 [0, 0.002273789129] | 364002 [240335, 873000] |
| 9 | T043 neglect | 256x60_s11 | 24 (2024) | 375519 [365473, 381542] | 73.65501113 [70.41157303, 76.27268732] | 0.06362649342 [0.05800310423, 0.07548501593] | 0 [0, 0.002274781091] | 662727 [257659, 1278618] |
| 9 | T043 neglect | 256x60_s11 | 25 (2025) | 400653 [389718, 406760] | 72.35319311 [69.68584629, 74.795305] | 0.065248155 [0.05712650875, 0.07544502383] | 0 [0, 0.002273293473] | 1042719 [311256, 1755915] |
| 9 | T043 neglect | 256x60_s11 | 26 (2026) | 426797 [415050, 432478] | 71.33201182 [69.62649497, 76.48190464] | 0.06464305513 [0.05862327566, 0.07859621169] | 0 [0, 0.002272939565] | 1495613 [578547, 2315759] |
| 9 | T043 neglect | 256x60_s11 | 27 (2027) | 454024 [440256, 459083] | 72.85437548 [70.75593176, 77.45595272] | 0.06697734628 [0.06082559698, 0.07929913619] | 0 [0, 0.002273647491] | 2029526 [813498, 2819889] |
| 9 | T043 neglect | 256x60_s11 | 28 (2028) | 484050 [467998, 486514] | 74.9690208 [71.37524059, 78.7230139] | 0.06751277188 [0.06141928049, 0.07839053093] | 0 [0, 0.00227421415] | 2517315 [1198557, 2908658] |
| 9 | T043 neglect | 256x60_s11 | 29 (2029) | 514624 [495899, 517363] | 75.04717383 [71.55640998, 78.78849548] | 0.06937058328 [0.06437082633, 0.07870644484] | 0 [0, 0.00225538357] | 2756673 [1674734, 2897424] |
| 9 | T043 neglect | 256x60_s11 | 30 (2030) | 545561 [525726, 548820] | 75.92535525 [71.63434651, 82.55893481] | 0.07175086062 [0.0668842488, 0.07750998442] | 0 [0, 0.002225813337] | 2983733 [1964983, 3172847] |
| 9 | T043 neglect | 256x60_s11 | 31 (2031) | 576139 [556521, 580095] | 77.05363892 [75.0998858, 79.42894474] | 0.07529987733 [0.0715832287, 0.08259331625] | 0 [0, 0.002147816877] | 3272675 [2554613, 3629635] |
| 9 | T043 neglect | 256x60_s11 | 32 (2032) | 607644 [587897, 611773] | 76.5624163 [75.14794901, 81.58004953] | 0.08067594922 [0.07549126331, 0.08732786878] | 0 [0, 0.002044073587] | 3560117 [3204144, 4030242] |
| 9 | T043 neglect | 256x60_s11 | 33 (2033) | 639039 [619000, 642971] | 76.45861234 [74.25762608, 82.36719768] | 0.08544741035 [0.07664525787, 0.09032573485] | 0 [0, 0.001933826062] | 3912424 [3759479, 4324097] |
| 9 | T043 neglect | 256x60_s11 | 34 (2034) | 670900 [651884, 675918] | 79.04775505 [74.1038094, 80.73810697] | 0.09039502708 [0.08166859481, 0.09531538647] | 0 [0, 0.001855194545] | 4321732 [4118611, 4608520] |
| 9 | T043 neglect | 256x60_s11 | 35 (2035) | 702549 [684283, 708765] | 80.58586314 [75.95509797, 81.36660851] | 0.09359355454 [0.08522372214, 0.1027372313] | 0 [0, 0.001701931923] | 4661622 [4554466, 4962743] |
| 9 | T043 neglect | 256x60_s11 | 36 (2036) | 735949 [717809, 741576] | 79.70203543 [74.57032902, 81.64903508] | 0.1007033435 [0.0962716893, 0.1114164671] | 0 [0, 0.001585261354] | 4970701 [4844182, 5367222] |
| 9 | T043 neglect | 256x60_s11 | 37 (2037) | 769154 [751566, 776221] | 80.73316129 [74.2730454, 83.04771231] | 0.1059261615 [0.09776133785, 0.1163323882] | 0 [0, 0] | 5206158 [5087125, 5815354] |
| 9 | T043 neglect | 256x60_s11 | 38 (2038) | 803062 [785884, 808559] | 79.10655739 [75.92864654, 81.71947202] | 0.1114499286 [0.1065884498, 0.1164358727] | 0 [0, 0] | 5539748 [5419975, 6315888] |
| 9 | T043 neglect | 256x60_s11 | 39 (2039) | 836817 [819443, 842805] | 79.03952606 [74.42239667, 80.77893984] | 0.1180403327 [0.1112852554, 0.1239903092] | 0 [0, 0] | 5893265 [5722171, 6867820] |
| 9 | T043 neglect | 256x60_s11 | 40 (2040) | 874000 [854912, 878503] | 77.94357504 [76.65975137, 81.0034639] | 0.1210293665 [0.116397881, 0.1295032154] | 0 [0, 0] | 6332342 [6084040, 7216130] |
| 9 | T043 neglect | 256x60_s11 | 41 (2041) | 906466 [890151, 913095] | 77.8442454 [75.30298631, 81.27598119] | 0.1302841842 [0.1219289937, 0.130992394] | 0 [0, 0] | 6796166 [6481325, 7530480] |
| 9 | T043 neglect | 256x60_s11 | 42 (2042) | 945941 [926637, 950764] | 76.61975737 [74.15393093, 81.47160964] | 0.1280396465 [0.1223900892, 0.141791123] | 0 [0, 0] | 7293136 [6955128, 8176818] |
| 9 | T043 neglect | 256x60_s11 | 43 (2043) | 979258 [961483, 985843] | 78.43495484 [75.11794876, 79.46131387] | 0.1381819908 [0.1325624189, 0.1429938528] | 0 [0, 0] | 7832611 [7457812, 8875181] |
| 9 | T043 neglect | 256x60_s11 | 44 (2044) | 1017692 [996707, 1023527] | 75.62991849 [74.44492919, 79.5304715] | 0.1416985677 [0.138674237, 0.1463400077] | 0 [0, 0] | 8368616 [7921032, 9140067] |
| 9 | T043 neglect | 256x60_s11 | 45 (2045) | 1055543 [1037834, 1067398] | 75.30936004 [74.01414088, 81.55451091] | 0.1408404472 [0.1367228362, 0.1555483052] | 0 [0, 0] | 8717011 [8486954, 9283786] |
| 9 | T043 neglect | 256x60_s11 | 46 (2046) | 1095516 [1074469, 1107768] | 77.08464669 [73.67551177, 80.53707273] | 0.1471994346 [0.1420369291, 0.157912867] | 0 [0, 0] | 9208865 [9090925, 9556459] |
| 9 | T043 neglect | 256x60_s11 | 47 (2047) | 1130576 [1113873, 1146080] | 74.52565576 [73.1983184, 79.78431726] | 0.1503196975 [0.1432513235, 0.1630511877] | 0 [0, 0] | 9748329 [9538341, 9869142] |
| 9 | T043 neglect | 256x60_s11 | 48 (2048) | 1170664 [1152623, 1188001] | 77.78599047 [73.52239056, 80.13859806] | 0.1569729346 [0.1481463747, 0.1614955849] | 0 [0, 0.002306670496] | 10198256 [9982602, 10479949] |
| 9 | T043 neglect | 256x60_s11 | 49 (2049) | 1209364 [1190676, 1227266] | 75.35156392 [73.6641719, 78.17536483] | 0.1601455312 [0.1485795935, 0.1679175999] | 0 [0, 0.002532086143] | 10711809 [10426580, 11120517] |
| 9 | T043 neglect | 256x60_s11 | 50 (2050) | 1247676 [1231498, 1268939] | 75.25782522 [73.74399301, 77.32359431] | 0.1634204235 [0.1532923044, 0.1677500125] | 0 [0, 0.006298958934] | 11247156 [10745131, 11849541] |
| 9 | T043 neglect | 256x60_s11 | 51 (2051) | 1291520 [1264249, 1301921] | 73.99456194 [72.00534171, 78.27665893] | 0.1609805578 [0.1572648363, 0.1699135235] | 0 [0, 0.0294602254] | 11751336 [11070263, 12593173] |
| 9 | T043 neglect | 256x60_s11 | 52 (2052) | 1330191 [1304078, 1347251] | 73.7905945 [71.84584783, 78.56739814] | 0.1663501169 [0.1547549786, 0.1722500981] | 0 [0, 0.03411866169] | 12224516 [11357928, 13355014] |
| 9 | T043 neglect | 256x60_s11 | 53 (2053) | 1375909 [1322687, 1396013] | 73.51606603 [73.04850068, 76.73516803] | 0.1648353907 [0.1618948327, 0.1753449299] | 0 [0, 0.04261822559] | 12728861 [11644774, 14159538] |
| 9 | T043 neglect | 256x60_s11 | 54 (2054) | 1403716 [1341214, 1426612] | 73.80258436 [73.18181849, 76.65051021] | 0.1682873397 [0.1542521183, 0.1738975538] | 0.004750938777 [0, 0.05051593671] | 13249765 [11989343, 14993928] |
| 9 | T043 neglect | 256x60_s11 | 55 (2055) | 1434979 [1368293, 1442563] | 73.73772783 [71.79247223, 79.29399853] | 0.169986417 [0.1649184668, 0.1749574405] | 0.01019199346 [0, 0.05854358608] | 13778905 [12348363, 15839182] |
| 9 | T043 neglect | 256x60_s11 | 56 (2056) | 1449432 [1392786, 1476687] | 73.86499087 [71.72673881, 79.46861753] | 0.1691862077 [0.1627795179, 0.1799443168] | 0.01781185608 [0, 0.05912553098] | 14299033 [12716335, 16752516] |
| 9 | T043 neglect | 256x60_s11 | 57 (2057) | 1460803 [1404798, 1494514] | 74.17253878 [71.70002779, 76.82046996] | 0.1685935312 [0.1656936478, 0.1775129549] | 0.03382016037 [0, 0.06335907558] | 14835399 [13120828, 17671428] |
| 9 | T043 neglect | 256x60_s11 | 58 (2058) | 1474625 [1400031, 1510419] | 73.89031777 [71.75942735, 75.24408468] | 0.1712058768 [0.1661494535, 0.1758239425] | 0.03224417136 [0, 0.06983185519] | 15393069 [13536714, 18563026] |
| 9 | T043 neglect | 256x60_s11 | 59 (2059) | 1477017 [1406118, 1521607] | 73.75172947 [73.57681838, 78.49358639] | 0.1753298447 [0.1663016832, 0.1795916494] | 0.03182527301 [0, 0.08361839605] | 15938936 [13999147, 19454501] |
| 9 | T043 neglect | 256x60_s11 | 60 (2060) | 1489349 [1428037, 1536884] | 73.73727761 [72.00033187, 76.66566735] | 0.1754203245 [0.1660339841, 0.1831799278] | 0.03200333289 [0, 0.0798805699] | 16517336 [14479958, 20390053] |

## Approval-gap diagnostics

The gate compares the year-60 difference of ensemble medians (neglect minus attentive). The arithmetic mean of yearly ensemble-median gaps from year 10 is reported below as requested by NOTE-048; that mean is not a gate.

| Stage | Row | LG-06-on gap at y60 | LG-06-off gap at y60 | On threshold (off + 0.5pp) | On mean annual gap y10–60 | Off mean annual gap y10–60 |
|---:|---|---:|---:|---:|---:|---:|
| 5 | 256x60_s7 | -5.134255465 | -4.180999367 | -3.680999367 | -4.678444583 | -2.852559857 |
| 5 | 256x60_s11 | -6.545606048 | -6.092696823 | -5.592696823 | -3.791651849 | -5.071045286 |
| 9 | 256x60_s7 | -5.973151767 | -4.139498922 | -3.639498922 | -4.38004243 | -3.272508747 |
| 9 | 256x60_s11 | -6.345888498 | -6.092696823 | -5.592696823 | -3.991945374 | -5.00315304 |

## Not judged by these ensembles

- **Tourism 0.7–1.3 from year 15:** annual `tourists` and `attr` do not contain the tourism-jobs/legacy-jobs denominator or the trailing twelve-month ratio used by the lane. The lane’s monthly telemetry probe is required; no approval or visitor proxy is substituted.
- **Failed incidents ≤5% from year 10 (attentive base):** default-profile annual rows contain no incidents/failures window. `failedIncidents` is emitted only for the newcomer profile, which is not this campaign. The lane’s emergency-window probe is required.
- Save/load scar persistence, old saves, exact/packet-host unit tests, B2 integration, UI wording and Prestige scars need the lane’s existing tests/probes and browser checks. No browser or real-GPU check runs here.

## Evidence and exact commands

- 5 members; 128x15_s7; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/dev/base/128x15_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 5 members; 128x15_s7; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T043/base/128x15_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 5 members; 256x60_s7; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/dev/base/256x60_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 5 members; 256x60_s7; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T043/base/256x60_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 5 members; 256x60_s7; devNeglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/dev/neglect/256x60_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 5 members; 256x60_s7; neglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T043/neglect/256x60_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 5 members; 256x60_s11; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/dev/base/256x60_s11_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 5 members; 256x60_s11; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T043/base/256x60_s11_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 5 members; 256x60_s11; devNeglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/dev/neglect/256x60_s11_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 5 members; 256x60_s11; neglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T043/neglect/256x60_s11_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 9 members; 128x15_s7; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base/128x15_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 9 members; 128x15_s7; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base/128x15_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 9 members; 256x60_s7; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base/256x60_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 9 members; 256x60_s7; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base/256x60_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 9 members; 256x60_s7; devNeglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect/256x60_s7_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 9 members; 256x60_s7; neglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect/256x60_s7_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 9 members; 256x60_s11; dev: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base/256x60_s11_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 9 members; 256x60_s11; base: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base/256x60_s11_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.
- 9 members; 256x60_s11; devNeglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect/256x60_s11_ensemble.summary.json`; commit `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`.
- 9 members; 256x60_s11; neglect: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect/256x60_s11_ensemble.summary.json`; commit `414e491e08b847e425323d67b79ed4aeedfa97a9`; simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; src tree `2cea4318b231d7ee8ac4ac82c5d4cc4f109dfc6b`.

The pre-existing dev five-member ensembles were recorded at commit `805d7d4`. New dev-neglect and ±§200 observations use an exact private snapshot of that same commit, with the same simbot/src/dependency/observer identity. The first five members are imported without changing the source commit identity. This report independently verifies that all imported annual observations, state hashes and five-member statistics are unchanged; no current-commit alias is used.

- 128x15_s7: `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` → `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; 75 member-year records and all yearly median/band statistics identical.
- 256x60_s7: `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` → `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; 300 member-year records and all yearly median/band statistics identical.
- 256x60_s11: `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` → `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`; 300 member-year records and all yearly median/band statistics identical.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T043m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T043/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --neglect
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/neglect --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --neglect
```


Each ensemble summary records every member’s exact quiet-gated child command, raw output path, signed amount and timing. The campaign command manifest/log records the outer `--jobs 4` commands. This report is generated by:

```powershell
node --experimental-strip-types "C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\t043Judge.mjs" "C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-lanes\T043.manifest.json"
```
