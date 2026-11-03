**T044 / LG-07 — round 3: approved changes measured; base gate still fails**

Worktree `simcityweb-T044`, branch `local/T044-lg07-industry`, supplied HEAD `d0d6b456e05a6f97f775e0c69e4c02e66a8f3fec` (dev `683d02b` merged by the lead). Changes remain **uncommitted**. No commit, push, merge, `.done`, baseline rewrite, browser or GPU run was made.

The high-tech floor is removed. Specified retooling, I-D EQ penalty and soil costs remain. The approved clean-only bot correction passes the 128 population/air targets and the scripted high-tech probe. Year-60 approval is +1.188 against its paired base. **Acceptance remains incomplete:** the shared A/A envelopes are zero, leaving four failed base population years on 256 s7 and nine on s11. Clean 256 s7 is also 3.0762% below fixed dev, just outside 3%. I stopped balance tuning; see **decisions for the lead**.

**Changes per file / ownership**

- `src/sim/economy/demand.ts`: removes the added high-tech floor; restores native `(EQ - 70) / 200`, capped at 0.45. Retains the saved deterministic 12-month ramp, 50% I-M / 25% I-HT strictly above EQ 70, receiving-sector modifiers, labour reservation treatment and read-only strategy accessor.
- `src/sim/economy/tuning.ts`: removes `RETOOL_IHT_SHARE`, `RETOOL_IHT_EQ0` and `RETOOL_IHT_EQ1`; corrects the mix comment. Required retooling constants and CO$$$ soil coefficient remain unchanged.
- `tools/simbot.ts` — **outside original named files, explicitly approved in round 3**: only `skips('dirty')` substitutes gas for coal, counts frontage belonging to complete usable industrial lots, and prefers viable vacant campus sites. Investment gates, demand thresholds, nuclear choice and default strategy remain.
- `tools/industryProbe.ts` — **new tool explicitly requested in round 3**: loads y43, chooses one deterministic vacant 6×6 site near an operating elementary/high school or college, zones through `CityActions`, then runs all systems for 720 days. Reports monthly conditions and contained/intersecting filled jobs. No services, quality, demand, money or jobs are injected.
- `tests/sim/industryRetooling.test.ts`: replaces the floor assertion with the native EQ-110 20% target and zero retooling when dirty room exists.
- New `tests/sim/botCleanIndustry.test.ts`: eight cases for clean-only power/zoning, full footprints, utilities, frontage, slope, site preference, investment failure and RNG isolation.
- New `tests/sim/industryProbe.test.ts`: four cases for deterministic read-only planning, frontage utilities, occupied/unserved/distant rejection and library/museum rejection.
- `docs/dev/reports/local-T044-lg07-industry.md`: this handoff.
- **Infra hunks: none. Cloud-held edits: none.** Committed WIP changes to `desirability.ts` and `ordinances.ts` are retained without new hunks this round.

**1. Base first — shared envelope does not excuse the drift**

Read NOTE-048's LG-07 decisions and SIM rule in full. The requested `git fetch origin local/T062-sim-aa-envelope` failed because the sandbox cannot write the shared worktree `FETCH_HEAD` outside T044. Once the shared local ref advanced, I read the complete report with `git show local/T062-sim-aa-envelope:docs/dev/reports/sim-aa-envelope.md` at **`3833c8d2379d3350663e624fe30be7867c559310`**.

T062 measured six processes on underlying dev `9fcc2ec`, task commit `0df76bc`. All three configurations have **zero** population, home-air, approval and I-HT-share envelopes under the prescribed +§1 day-1 perturbation. Funds remain exactly §1 higher: the perturbation occurred. `git diff 683d02b 9fcc2ec -- src/sim src/core tools/simbot.ts` is empty. T062's base populations match this worktree's b3 fixture. The current population band is therefore **±1%**, with no variant slack. This is the pre-T041 envelope; final merge gates require T041's new base/envelope.

Every annual population row from year 10 was compared:

| Configuration | Fixed-dev final | No-floor final | Endpoint drift | Worst drift, years 10+ | Mean signed drift, years 10+ | Failed years |
|---|---:|---:|---:|---:|---:|---:|
|128×15 s7|192,899|191,937|−0.498707%|−0.498707% (2015)|−0.138928%|0|
|256×60 s7|1,513,835|1,497,089|−1.106197%|−1.290713% (2058)|−0.004828%|4|
|256×60 s11|1,427,340|1,394,907|−2.272269%|−3.898052% (2054)|−0.568515%|9|

128 s7 residents are **[60,544, 94,177, 37,216]**, versus dev **[61,124, 93,804, 37,971]**. These changes follow LG-07's balance mechanics, not a difficulty-mode change.

| Seed | Year | Fixed dev | No floor | Drift |
|---|---:|---:|---:|---:|
|7|2053|1,392,709|1,378,570|−1.015216%|
|7|2058|1,488,790|1,469,574|−1.290713%|
|7|2059|1,504,810|1,486,032|−1.247865%|
|7|2060|1,513,835|1,497,089|−1.106197%|
|11|2052|1,354,608|1,333,883|−1.529963%|
|11|2053|1,372,356|1,331,686|−2.963517%|
|11|2054|1,388,950|1,334,808|−3.898052%|
|11|2055|1,386,414|1,347,246|−2.825130%|
|11|2056|1,400,344|1,357,297|−3.074030%|
|11|2057|1,403,945|1,373,139|−2.194246%|
|11|2058|1,414,561|1,377,115|−2.647182%|
|11|2059|1,416,617|1,396,126|−1.446474%|
|11|2060|1,427,340|1,394,907|−2.272269%|

The systematic-shift screen does **not** trigger under endpoints or mean signed drift: the 128 configuration never exceeds half its 1% tolerance. This does not excuse the failed 256 configurations. I do not call these failures measured A/A noise.

Round-2 scratch switches isolated the s7 interaction before this round. Historical attribution measurements:

|256 s7 switch|Year-60 population|Worst yearly drift|Strict-1% failed years|
|---|---:|---:|---:|
|WIP, all four parts|1,505,488|−1.6477%|4|
|All four off: dev control|1,513,835|0%|0|
|Retooling off, including reservation correction|1,505,488|−1.6477%|4|
|New CO$$$ soil weight off|1,505,488|−1.6477%|4|
|Added floor off, required costs retained|1,497,089|−1.2907%|4|
|Required I-D EQ penalty off, floor retained|1,469,170|−2.9505%|8|

Retooling/floor/EQ/soil switches were scratch-only, separate per part. Floor removal is the only accepted production correction. All three current base runs have zero converted targets throughout every recorded full-year cohort. The s7 ablations do not prove attribution of s11's larger drift; no new s11 component-ablation series was run after the shared gate failed. Removing the required penalty is not a valid fix and previously worsened s7. No residential compensation or weakened cost was added.

**Default-bot identity**

The original HEAD bot was frozen in a scratch control bundle using the same current no-floor simulation. Separate processes with the revised bot reproduce **every recorded annual field**, RNG state and layout digest for all three §8.0 configurations:

|Configuration|Annual rows identical|SHA256 of identical annual JSON series|
|---|---:|---|
|128×15 s7|15/15|`ac65084277e1d0fd6b33c6812ea31da439abd9de5e82cd7e5f9886353096d422`|
|256×60 s7|60/60|`72c736c0630a6c882b17003bd7f278c630b56076c320837a573bf99b254edff8`|
|256×60 s11|60/60|`433c12b18c29ebbb887ce3828d1597629ca5dbf744616e6eafe9e1378fd3c5e6`|

The layout digest hashes zones, networks, building IDs, utilities, powerlines, soil, air/water pollution, land value, all desirability layers and building records. It is **not** a canonical hash of every CityState/systemData field. These controls show that the bot correction stays out of default runs; they do not claim LG-07 itself leaves dev's state identical.

**2. Clean-only population, placement and air**

Gas's nominal catalog economics, before operating/load/funding modifiers:

|Plant|Capital / output|Capital per MW|Monthly upkeep / output|Upkeep per MW-month|
|---|---:|---:|---:|---:|
|Coal|§25,000 / 400 MW|§62.50|§700 / 400 MW|§1.75|
|Gas|§22,000 / 250 MW|§88.00|§650 / 250 MW|§2.60|

Gas costs **40.8% more capital/MW** and **48.57% more nominal upkeep/MW**. The clean bot keeps spending gates and nuclear selection; it receives no subsidy.

|128×15 metric|Seed 7|Seed 11|
|---|---:|---:|
|Paired base population|191,937|194,346|
|Clean population|154,544|158,878|
|Clean / paired base|0.805180867|0.817500746|
|Margin above 0.80× paired base|+994.4 people|+3,401.2 people|
|Clean / fixed-dev s7|**0.801165377**|no fixed 128 s11 fixture|
|Margin above fixed-dev 0.80× s7|**+224.8 people / +0.116538 percentage points**|—|
|Paired base mean home air|0.057498336302|0.050367936556|
|Clean mean home air|0.041032895028|0.041105469076|
|Paired improvement|**28.636379%**|**18.389611%**|
|Margin above 15%|+13.636379 points|+3.389611 points|
|Absolute air margin below 0.85× base|0.007840690829|0.001707276997|

Both population and cleaner-air direction hold on the second seed without envelope slack. Against unchanged-dev s7 mean air **0.057220800467** (round-2 all-off replay, core source unchanged), clean is **28.290246%** cleaner, also a strict pass. This is exactly LD15a's metric: the arithmetic mean of the **15 annual resident-weighted `stats.avgAir` samples at homes**, not endpoint or map/source pollution. The current balance assertion is labelled `no dirty industry: air over the run` inside the large balance test; it is not separately selectable.

Clean s7 residents are **[40,791, 76,869, 36,884]**. An independent repeat reproduces all annual measurements, RNG states and layout digests exactly; its added read-only room observation changes no recorded result.

Retooled demand is still only partly placed. At year 15, refused dirty target is **21,545.826**; converted additions are **10,507.701 I-M** and **5,253.851 I-HT** (target jobs, not tagged employment):

|Sector|Raw target|Soft-capped target|Working capacity|Filled jobs|Growth demandAbs|
|---|---:|---:|---:|---:|---:|
|I-M|35,208|31,270|13,090|12,267|170.144|
|I-HT|16,146|15,713|6,040|5,544|90.358|

There is no IndMed. IndHigh permits I-M and now covers **1,712 cells**, versus the previous WIP clean run's 1,128. However, its **67 serviced vacant frontage cells contain zero complete usable industrial lots** at year 15. The new counter finds positive room in 2001–2013 and zero in 2014–2015; the remaining frontage is fragmented. Labour also limits placement: headroom **1,119**, scale **0.021**; new-lot capacity limits approximately **204.17 I-M / 108.43 I-HT**, below a 400-job factory or 520-job campus. No growth allowance or bank rule changed.

Year-15 clean s7 has **three gas plants and no coal**. I-HT emits zero direct air; I-M still emits **127.229 source units** across 192 lots. Source sums are not home exposure. The old late-coal problem is removed, while traffic, manufacturing and spatial exposure remain. These diagnose the combined correction; no isolated gas-versus-planner causal ablation was run.

**256×60 s7** clean population is **1,467,267**:

- Versus paired no-floor base 1,497,089: **0.980080009×**, a **1.991999% loss**, within 3% by **15,090.67 people / 1.008001 points**.
- Versus fixed §8.0 dev 1,513,835: **0.969238391×**, a **3.076161% loss**, missing 3% by **1,152.95 people / 0.076161 points**. Zero A/A cannot excuse this miss. This stricter fixed-reference result prevents an unconditional pass.

No 256 clean s11 run was added after the base failures were established. The required other-seed direction for the 128 targets was measured above; no A/A-excused pass is claimed.

**3. High-tech mechanism — demand and real placement**

“Demand” here is **positive incremental `demandAbs` capacity demand**, after existing capacity, labour throttling and EMA, which growth consumes. Industrial denominators below are **I-D + I-M + I-HT**, excluding farms, consistent with T062's job-share convention. Raw observation JSON also retains the older ratios including agriculture; those are slightly lower and still exceed 25% on every qualifying s7 row.

Under this definition, gate (a) passes: base first reaches EQ 110 in **2024**, at **28.288494%** positive I-HT demand, the minimum of its qualifying rows through 2040. It reaches **40.743792%** in 2040. Clean first qualifies in **2021** at **25.54%** (rounded); all its qualifying rows through 2040 exceed 25%. No normalized demand bars were summed or divided.

Raw/capped targets answer a different question:

|Base year|EQ|Raw I-HT target share|Capped target share|Positive incremental share|
|---|---:|---:|---:|---:|
|2024|110.6643|20.332210%|21.154435%|28.288494%|
|2030|120.5021|25.250918%|26.579470%|34.243015%|
|2040|129.9499|31.059332%|30.538926%|40.743792%|
|2060|132.0797|32.141170%|31.072324%|42.495037%|

If the lead intends **total raw/capped targets** as gate (a), early qualifying rows fail: native share is only 20% at EQ 110 and reaches 25% at EQ 120 before modifiers. I have not recreated the rejected floor to hide that interpretation difference. The placement probe independently proves the mechanism works.

Every qualifying s7 year follows. Jobs are filled I-HT jobs / share of I-D+I-M+I-HT jobs. Dashes mean EQ is below 110. Realised bot shares are reported, not gated.

|Year|Base EQ|Base positive demand %|Base I-HT jobs / share|Clean EQ|Clean positive demand %|Clean I-HT jobs / share|
|---|---:|---:|---:|---:|---:|---:|
|2021|—|—|—|110.08|25.54|2,456 / 14.86%|
|2022|—|—|—|112.30|26.55|2,459 / 14.88%|
|2023|—|—|—|114.45|26.55|2,457 / 14.85%|
|2024|110.66|28.29|0 / 0.00%|116.20|27.30|2,458 / 14.85%|
|2025|112.74|29.47|0 / 0.00%|117.71|27.94|2,461 / 14.87%|
|2026|114.42|30.88|0 / 0.00%|119.00|28.47|2,465 / 14.89%|
|2027|115.93|32.14|0 / 0.00%|120.06|28.64|2,454 / 14.86%|
|2028|117.28|33.01|0 / 0.00%|120.90|28.77|2,452 / 14.83%|
|2029|118.74|34.20|0 / 0.00%|121.64|29.61|2,453 / 14.83%|
|2030|120.50|34.24|0 / 0.00%|122.41|29.84|2,444 / 14.76%|
|2031|122.24|34.71|0 / 0.00%|123.14|30.53|2,444 / 14.77%|
|2032|123.76|35.24|0 / 0.00%|123.99|30.78|2,367 / 14.39%|
|2033|125.03|35.81|0 / 0.00%|124.81|30.97|2,365 / 14.36%|
|2034|126.12|36.24|0 / 0.00%|125.58|31.11|2,365 / 14.38%|
|2035|127.01|36.59|0 / 0.00%|126.27|31.24|2,284 / 13.98%|
|2036|127.78|36.69|0 / 0.00%|126.86|31.81|1,773 / 10.03%|
|2037|128.46|38.03|0 / 0.00%|127.33|32.10|1,642 / 8.34%|
|2038|129.09|38.96|0 / 0.00%|127.77|31.73|3,122 / 13.83%|
|2039|129.60|39.85|0 / 0.00%|128.19|32.03|5,455 / 20.76%|
|2040|129.95|40.74|0 / 0.00%|128.73|31.64|8,208 / 26.67%|
|2041|130.19|41.19|0 / 0.00%|129.24|31.70|8,964 / 25.77%|
|2042|130.30|41.97|0 / 0.00%|129.64|31.48|11,173 / 27.75%|
|2043|130.34|42.76|0 / 0.00%|129.89|31.09|13,594 / 29.71%|
|2044|130.30|43.59|0 / 0.00%|130.00|30.50|16,443 / 31.94%|
|2045|130.44|43.98|0 / 0.00%|130.06|29.96|19,204 / 33.43%|
|2046|130.66|43.68|0 / 0.00%|130.19|30.41|22,058 / 34.52%|
|2047|130.85|43.33|0 / 0.00%|130.41|29.97|25,024 / 35.51%|
|2048|130.92|42.99|0 / 0.00%|130.61|29.44|27,959 / 36.49%|
|2049|130.92|42.12|0 / 0.00%|130.76|28.89|31,601 / 37.58%|
|2050|130.90|41.67|607 / 0.59%|130.86|29.42|31,669 / 35.65%|
|2051|130.96|42.20|1,156 / 1.10%|130.94|30.07|30,849 / 33.07%|
|2052|131.10|42.40|1,104 / 1.02%|130.97|31.70|29,635 / 30.40%|
|2053|131.27|42.21|2,345 / 2.11%|131.01|32.36|28,490 / 28.12%|
|2054|131.49|42.12|3,035 / 2.68%|131.12|32.77|27,717 / 26.33%|
|2055|131.71|42.08|3,861 / 3.34%|131.29|33.12|28,622 / 25.89%|
|2056|131.90|42.06|4,927 / 4.16%|131.40|33.09|30,016 / 25.91%|
|2057|131.97|42.16|5,943 / 4.86%|131.48|32.76|32,905 / 26.77%|
|2058|132.01|42.20|6,374 / 5.12%|131.53|32.59|35,764 / 27.76%|
|2059|132.05|42.44|7,321 / 5.70%|131.62|32.25|38,785 / 28.67%|
|2060|132.08|42.50|8,251 / 6.27%|131.73|32.17|40,732 / 28.66%|

Default-bot zoning remains the realised-job blocker: its I-HT bar is **0.0251** in 2024 and **0.1462** in 2040, below unchanged **>0.35** IndHigh threshold. The floor is gone; native demand is available. The clean bot first exceeds 25% realised jobs in 2040. Base s11 ends with 12.26% including farms, also diagnostic rather than gated.

**Scripted y43 gate (b): pass**

- Input: supplied veteran `vet_s7_y43.city.metropolis`, SHA256 **`9fb89f999b3a9c327bc2e82d72928542f75e11898d8a6ec1f63c9d41a2ab2cf7`**. Size 256, seed 7, day **15,480**, year 2043, saved population **991,493**, EQ **129.303754**.
- One selection before any simulated outcome: rectangle **[95,101) × [230,236)**, near operating elementary school #24796, centre distance **8.2765 tiles**, 1,500 seats, staffed 40/40. Existing roads provide two complete six-cell fronts. Selected perimeter is isolated from other IndHigh.
- Real zone action: **36 cells**, **§720**, no demolition or zoning RNG draw. No extra road, utility, school, money or demand action. Existing frontage utilities satisfy normal lot rules; each tile need not independently hold coverage.
- Advance **24 months / 720 days**, through day **16,200**, using `createSystems()` without bot automation.
- Final filled jobs: **2,252 / 2,252 I-HT = 100%**, both wholly contained and all-intersecting. **Zero crossing jobs**. Capacity 2,340, none unfinished. Margin above gate **+75 percentage points**.
- Actual campuses: stage 4 **496/520 jobs**, stage 6 **1,066/1,100**, stage 5 **690/720**. No job injection or stage forcing. Tool passed again after its final RNG-check edit.

**4. Approval — endpoint retained; mean benefit changes**

Paired 256 s7 approval is **80.084679 base / 81.272708 clean** in 2060: **+1.188028**, exceeding `1 − 0` by **0.188028 points**. This paired comparison follows the preceding review's supplied +0.49 calculation. Current run-mean gain is **+0.721926**, versus the previous floor/old-bot experiment's +2.106110. These are different combined scenarios, not isolated component effects.

Fixed-dev audit: T062's 2060 approval is **80.357424696**. Clean minus that is **+0.915283128**, short of +1 by **0.084716872** with zero slack. The reference distinction remains explicit below.

The scratch observer captures monthly terms and applies the existing 0.3 EMA separately. Contributions reconstruct both gains within 3×10⁻¹⁴. No formula or approval bonus changed:

|Clean minus paired base term|Run mean|Year-60 smoothed contribution|
|---|---:|---:|
|tax|+0.202566|+0.750000|
|services|−0.856463|−1.555450|
|pollution|+0.646942|+0.851555|
|crime|−0.058106|−0.318252|
|unemployment|+0.015808|+0.023774|
|parks|+0.146859|−0.028640|
|ordinances|−0.035200|0|
|civic|−0.002965|0|
|noise|+0.437333|+0.705480|
|garbage|+0.011307|−0.007824|
|needs|+0.122663|−0.010943|
|tap water|+0.033576|−0.003278|
|tourism|+0.010502|0|
|headquarters|+0.107023|+0.111918|
|emergencies|−0.075921|+0.476512|
|justice|+0.016002|+0.193175|
|**Total**|**+0.721926**|**+1.188028**|

Services absorb much of the environmental gain; crime is also negative. Unemployment helps little because both endpoints are below approval's 8% excess-unemployment threshold: **7.7049% base / 7.3595% clean**. Endpoint home air is now better (**0.143284 clean / 0.177407 base**), unlike the preceding experiment. Pollution, noise, ordinary tax-path and emergency differences outweigh the service loss. These are accounting contributions, not gas/planner causal ablations.

**decisions for the lead**

|Retained choice / reference|Measured result under zero A/A|Decision / remaining issue|
|---|---|---|
|Remove floor; retain specified costs and ratios|128 base passes; 256 s7 worst −1.290713%, s11 worst −3.898052%; 13 failed years|Current ±1% base gate fails. No permitted compensation was inserted. A different approved mechanic change or explicit gate decision is needed; this does not prove every possible implementation fails.|
|Approved clean-only power and full-lot/site planning|128 s7 0.801165× fixed dev; air 28.290246% cleaner fixed / 28.636379% paired; other seed direction holds|128 targets pass strictly; gas has the measured higher cost/MW.|
|256 clean population against fixed §8.0 dev|0.969238×; 3% target short by 1,152.95 people / 0.076161 points|Fixed-reference miss; zero envelope supplies no slack. Paired comparison passes at −1.991999%.|
|I-HT positive incremental demand and real block|Minimum qualifying base demand 28.288494%; probe 100% I-HT|Mechanism passes under demandAbs. Raw/capped interpretation fails early qualifying rows; do not silently reinstate a floor.|
|Approval against paired candidate base, as +0.49 was calculated|+1.188028|Strict paired pass. Fixed-dev +0.915283 misses by 0.084717; keep intended reference explicit.|

I stopped tuning when T062 established zero slack. An all-gates-passing result has **not** been established. Post-T041 remeasurement remains required, not permission to re-record the present baseline.

**Tests and remaining gates**

All Vitest and bot/probe commands used the quiet gate. Simulations ran one at a time.

|Check|Result|
|---|---|
|`npx tsc --noEmit`|Pass after final source edits|
|`tests/sim/industryRetooling.test.ts`|7 passed|
|`tests/sim/industryCosts.test.ts`|4 passed|
|`tests/sim/desirability.test.ts`|20 passed|
|`tests/sim/botCleanIndustry.test.ts`|8 passed|
|`tests/sim/industryProbe.test.ts`|4 passed|
|`tests/sim/botLongGame.test.ts`|28 passed|
|`tests/worker/hygiene.test.ts`|17 passed, 1 skipped with isolated `--testTimeout=30000` rerun; initial run had two 5-second source-scan timeouts, no assertion violation reported|
|Standard-config quiet-gated `industryCosts.test.ts`|Cannot start: Vite externalize-deps `optimizeSafeRealPathSync`, **spawn EPERM**|
|LD15a air assertion inputs|Strict pass: 0.041032895028 < 0.057498336302; complete balance file not run|
|EQ|128 base ≥100 in 2015, clean in 2014 on both seeds. 256 base ≥100 in 2020 s7 / 2018 s11; clean s7 in 2016|
|Employment ledger|Maximum `abs(unemp − (1 − accW))` over seven distinct series: **0.012093190 < 0.02**|
|Default bot excluded from correction|15+60+60 annual fields, RNG and layout digests identical to original-bot/no-floor controls|
|Old-save continuation|Veteran y43 loads and advances 720 days; optional/mid-ramp save cases are in retooling tests|
|Full Vitest / complete balance file|Left for lead, as instructed|
|Canonical full-state two-process hashes / separate Hard runs|Not verified; layout/annual hashes have the limits described above|

Successful test form, run separately for each named file, with no repository config change. Scratch config sets `resolve.preserveSymlinks: true`:

```powershell
$t044Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$t044Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch'
node $t044Quiet npx vitest run tests/sim/industryRetooling.test.ts --config "$t044Scratch/r2-vitest.config.mjs" --configLoader native --pool threads --maxWorkers=1
```

**Bot commands / artifacts**

`tsx` is absent. Local Rolldown bundled `r3-gates.ts`, importing `SimBot`, `botSystems` and `parseArgs`. Control transforms replace only the bot with captured HEAD source; both bundles use current no-floor simulation. The passive approval callback adds no simulation writes or RNG draws. Source hashes are in `r3-control-sources.json` / `r3-final-sources.json`.

Exact simbot-equivalent commands from this worktree, using the prefix above:

```powershell
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 11 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 11 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
```

Actual commands (output arguments write UTF-8 JSON directly):

```powershell
node "$t044Scratch/r3-build.mjs" control
node "$t044Scratch/r3-build.mjs" final
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 128 --years 15 --seed 7 --quiet "$t044Scratch/r3-control-128-s7.json"
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 256 --years 60 --seed 7 --quiet "$t044Scratch/r3-control-256-s7.json"
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 256 --years 60 --seed 11 --quiet "$t044Scratch/r3-control-256-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --quiet "$t044Scratch/r3-final-128-s7.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-128-s7-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 11 --quiet "$t044Scratch/r3-final-128-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 11 --skip dirty --quiet "$t044Scratch/r3-final-128-s11-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 7 --quiet "$t044Scratch/r3-final-256-s7.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-256-s7-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 11 --quiet "$t044Scratch/r3-final-256-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-128-s7-clean-repeat.json"
```

Control build requires captured `r3-control-simbot.ts`; its frozen bundle remains intact. Final bundle was rebuilt once to add only read-only clean-room observations. First clean runs lack that extra field; repeat comparison excludes only that observation.

Probe command, successful twice including after final edits:

```powershell
node node_modules/rolldown/bin/cli.mjs tools/industryProbe.ts --platform node --format esm --dir "$t044Scratch/r3-probe" --entry-file-names industryProbe.mjs
node $t044Quiet node "$t044Scratch/r3-probe/industryProbe.mjs" --city C:/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t013/cities/vet_s7_y43.city.metropolis --out "$t044Scratch/r3-probe-result.json"
```

With tsx available: `node $t044Quiet npx tsx tools/industryProbe.ts --city <y43.city.metropolis> --out <scratch/result.json>`. Optional `--site 95,230` replays the measured rectangle. No new 43-year bot save was needed.

All artifacts are in designated T044 scratch. `r3-summary.json` contains full annual dev comparisons, failed years, gate ratios, EMA contributions, demand/job tables and probe summary. `r3-final-*.json` / `r3-control-*.json` retain full precision. `r3-analyze.mjs` regenerates the summary; `r3-details.mjs` emits placement/approval/yearly-share diagnostics. Historical `r2-*.json`, `r2-allcommands.txt`, `r2-build.mjs` and `r2-summary.json` remain unchanged.

**Plan versus code / exact cloud requests**

- NOTE-048 replaces the realised-bot HT gate and amends base/approval rules. T062's zero envelope leaves strict gates; failed LG-07 rows do not establish a larger A/A envelope.
- Current b3 references are 192,899 / 1,513,835 / 1,427,340, not older plan examples. No fixture was re-recorded. Post-T041 remeasurement remains required.
- Existing `st.soil`, I-D accumulation, persistence after demolition, residential costs and Brownfield Cleanup's 5× decay already implement most soil behavior. Retained WIP adds CO$$$'s missing weight; no duplicate map, save schema or infra hunk was needed.
- Production retooling's dirty-room heuristic still reads vacant IndMed frontage/redevelopment opportunity, not exhaustive full-footprint packing. Approved bot correction checks complete prospective clean lots separately. Do not present frontage totals as buildable-factory counts.
- Optional `systemData.economy.industry` remains mirrored through existing economy state. `industrialStrategy(ctx.state)` returns a copy without initializing the replica. Its `dirtyShare` includes farms as documented; this report's HT tables follow T062's three-sector denominator.
- **GUIDE / `src/ui/TopBar.ts`, `buildRciPop()` and `update()` (or split RCI equivalent):** add retooled I-M/I-HT from `industrialStrategy(ctx.state)`. Label current demand-target additions, not filled jobs; hide missing optional data. This explains the strategy without promising employment.
- **GUIDE / `src/ui/panels/StatsPanel.ts`, `build()` and `update()`:** add Industrial strategy with converted target jobs, dirty-job share with denominator clear, and resident-weighted home air from the same accessor. New listeners use `ctx.signal`; reads stay through `ctx.host`/`ctx.state`, mutations through `host.act`.
- No new request for Worker, App wiring, infra, save, region or other cloud-held code. No UI hunk made.

**Not verified / left for the lead**

The all-gates result is **not achieved**. Resolve measured base/fixed-reference failures before sign-off. Full standard-config Vitest, complete balance file, canonical full-state two-process hashes, separate Hard runs, GPU/frame timings, Worker packet/frame costs and browser behavior were not checked. Required post-T041 dev merge and fresh shared envelope remain external follow-up; current zero envelopes must not be reused for that base. No clean 256 s11 result or s11 per-component attribution is claimed.

Browser acceptance checklist (all unchecked; GUIDE rows need its follow-up):

- [ ] With no usable IndMed room, verify 12-month ramp and gradual unwind when room returns; I-HT off at EQ 70 and on above it.
- [ ] Enable Clean Air Act and Industrial Pollution Controls separately/together; check conversion, costs and text without double counting/taxing.
- [ ] Inspect I-D at EQ 90/95/110: penalties 0 / −0.015 / −0.06, matching layer and explanation.
- [ ] Demolish an old dirty lot, rezone R/CO$$$ and observe persistent soil costs; Brownfield Cleanup accelerates gradual recovery.
- [ ] Compare RCI/Stats additions, dirty share and home air to host-mirrored values; open/close overlays and load an old save without the optional key.
- [ ] Save/load mid-ramp without instant reset/conversion; inspect ordinance/RCI text at 720p.
- [ ] On y43, replay the 6×6 site near the elementary school and inspect staffed campuses after 24 months; distinguish demand targets from filled jobs.
