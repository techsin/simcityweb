# T045 — LG-08 transit-oriented development

Branch `local/T045-lg08-tod`; current merged base is `683d02b` via merge `b5577e5`. The user committed the original
implementation as WIP `731fffa`, the recovery as `6e62a61`, and round 3 as `ed20c0a`; `7fbb0f4` isolates the backlog
line. Round-4 test/report changes remain uncommitted; no `.done` file is written. Historical evidence against
`fb1531f` is retained below and is not the fresh gate matrix.

**The implementation fails NOTE-048's annual base-population rule on all three rows.** All nine fresh bot cases
are complete. Peak annual population drift is **+1.34464%** on 128×15 s7, **+1.92675%** on 256×60 s7 and
**−12.29426%** on 256×60 s11; the shared A/A envelopes are zero. The amended transit-loss, station tower-share
and commute-activation gates pass, as does the same-strategy year-60 subway floor. Approval of start 8/−0.25 did
not waive the annual rule. The approved constants remain fixed; no compensating growth or weaker cost is added.

## Round 4: old-save difficulty regression

**Old saves adopt LG-08's current commute rule when the simulation initializes.** There is no new load-only grace
or grandfathered threshold. The existing resident-population grace still applies to commute on every difficulty;
Easy's crime and emergency fades remain separate difficulty rules. The base-row/fork-noise question stays with
the lead under NOTE-052; this round changes no production code or balance.

The failing fixture has one occupied R$$ home with **5,000 residents** and explicitly disables the traffic layer.
Its survey therefore uses **`COMMUTE_FALLBACK = 25` minutes**, rather than a measured commute cell:

```text
resident-weighted commute = 25 × 5000 / 5000 = 25 minutes
population grace = smoothstep(2000, 8000, 5000) = 0.5
commute term = −0.25 × max(0, 25 − 8) × 0.5 = −4.25 × 0.5 = −2.125
```

`deserializeCity` alone preserves the historical saved `commute: 0`. Constructing `Simulation` calls
`approvalSystem.init`, which surveys the loaded home and recomputes raw terms immediately using the current
constants. The fixture is a resumed city (day 45 with saved terms), so initialization keeps its saved approval
EMA **42.25**. At day 60, after the first 15 simulated days, and each following month, approval moves toward the
new raw total by `approval += (raw − approval) × APPROVAL.ema`, currently **0.3**. Immediate raw-term adoption does
not mean an immediate jump in the displayed approval. No save migration, new setting or additional grace is added.

`tests/sim/difficultyRules.test.ts` retains the historical fixture and derives only the expected commute term
from `APPROVAL`, `COMMUTE_FALLBACK`, the fixture's resident count and the existing grace constants. It does not
hard-code −2.125. New assertions pin the saved zero term, fallback survey and negative term after initialization.
The full term-object equality, exact raw sum, saved EMA, three monthly EMA updates, income, saved configuration /
disasters and untouched serialized payload checks remain. Both hunks stay entirely inside the old-save test
block; local dynamic imports avoid a separate import hunk, leaving T042's lines 62–80 untouched.

Round-4 checks ran one process at a time; every test and bot command passed through the quiet gate:

| Test file | Passed | Existing skipped |
|---|---:|---:|
| `tests/sim/difficultyRules.test.ts` | 32, including all eight old-save cases | 0 |
| `tests/sim/transitDevelopment.test.ts` | 19 | 0 |
| `tests/game/transitInspector.test.ts` | 2 | 0 |
| `tests/game/inspectorModel.test.ts` | 11 | 0 |
| `tests/game/inspectorNotes.test.ts` | 10 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |

**91 passed, one existing W1.2 skip, zero failures.** `npx tsc --noEmit` passes. The fresh 128×15 s7 bot remains
**193,844**, residents **[66507, 90953, 36384]**. Its final normalized state hash is unchanged from round 3:
`dc0ca8e04309ea12a4d4c26f09a549dd14d5c467a39411e347a604e5510e92ba`.
The fresh capture contains the same 84 production modules, aggregate SHA256
`5e8c06796d9c95ae27133c60e44354cd11fd026fd0bd561fb0ee6549031aa884`, as the previous measured capture.
The 256×60 rows below were not rerun for this test-only correction and remain the prior evidence.

Actual commands, using the absolute `$taskRoot`, `$taskScratch` and `$taskQuiet` values defined below:

```powershell
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/difficultyRules.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-difficulty-rules-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitDevelopment.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-transit-development-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/transitInspector.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-transit-inspector-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorModel.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-inspector-model-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorNotes.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-inspector-notes-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/worker/hygiene.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-worker-hygiene-vitest.json"
npx tsc --noEmit
node "$taskScratch/round2-launch.mjs" --capture --name production --revision round4-oldsave --source-commit 7fbb0f437560f1cc6644aa422ad9ac07cd1c2ebc --expect-commute-start 8
node $taskQuiet node "$taskScratch/round2-launch.mjs" --name production --revision round4-oldsave --size 128 --years 15 --seed 7 --out "$taskScratch/round2/round4-oldsave/production/s7-128-base.json"
```

The last command's ordinary CLI equivalent is
`node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7`.
As before, tsx is unavailable here; the actual launcher uses the unchanged SimBot entry points with local
Rolldown. No infra or Worker hunk, cloud-held file change or new owner request is needed for round 4. Full Vitest
and browser checks remain with the lead. In the browser, verify that loading an old city shows current raw
commute pressure with the existing population grace, preserves the saved approval initially, and moves the EMA
on the following month ticks. Earlier owner requests and the broader browser checklist remain below.

## Round 2: approved criteria and fresh evidence

NOTE-048 also introduces the shared SIM A/A rule. All three flags-off rows — 128×15 s7 and 256×60 s7/s11 — must
be compared with fresh dev in every year from year 10, within the maximum of the item's tolerance, 1% and that
row's A/A envelope. Population, mean air at homes, approval and I-HT share are retained in the annual evidence.
The report must investigate a same-direction shift above half the tolerance across all three rows, even if each
row is individually inside its band. Final lane gates must be remeasured after B2 and T041 merge, using the shared
envelope for that exact dev base.

NOTE-048 approves start **8 minutes at −0.25**, retaining the existing new-town grace. Its 2040 loss target changes
from 4% to **1%** because most individual bot commutes then are below 8.5 minutes: the sanctioned station/tower,
+0.04 appeal and commute mechanisms cannot reach 4% without strengthening unrelated balance and moving other
lanes' bases. The amended 1% is above the original roughly 0.7% loss. Radius, appeal, catalog, demand, growth
budget and lot fit remain unchanged. The 2060 loss target remains 10%; the skyline gate becomes tower share
≥2×city, with the tower-capable-type mean stage diagnostic only.

The authoritative fresh probe makes **no attachment/growth query during simulated days**. Monthly and annual
observations read existing fields; the stage census runs only after the final day. Its normalized serialized-state
hashes immediately before and after the final census are equal. Those hashes establish no immediate persisted
mutation; final-only placement also ensures that cache changes cannot affect this run's later scheduling.

| Fresh run, base `683d02b` | Population 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Production, flags off | 554,269 | 889,302 | 1,278,055 | 1,520,331 | [425890, 734632, 359809] | 5.54806 |
| Fresh dev, flags off | 550,399 | 885,236 | 1,265,741 | 1,513,835 | [412608, 738176, 363051] | 5.05394 |
| Production 8/−0.25, `--subway` | 554,789 | 888,952 | 1,268,558 | 1,483,601 | [414550, 716757, 352294] | 5.374398148 |
| Fresh dev, `--subway` | 551,849 | 885,499 | 1,271,081 | 1,491,542 | [416853, 724509, 350180] | 5.583472222 |
| Production `--subway --skip transit` | 554,373 | 877,353 | 1,156,617 | 1,179,555 | [289184, 592462, 297909] | 5.231388889 |

| Fresh flags-off row | Dev final population | Production final population | Endpoint drift | Signed largest annual drift | First year outside ±1% | Outside / checked years | Result |
|---|---:|---:|---:|---|---:|---:|---|
| 128×15 s7 | 192,899 | 193,844 | +0.48989% | +1.34464% in 2012 | 2012 | 1 / 6 | **FAIL** |
| 256×60 s7 | 1,513,835 | 1,520,331 | +0.42911% | +1.92675% in 2010 | 2010 | 13 / 51 | **FAIL** |
| 256×60 s11 | 1,427,340 | 1,261,054 | −11.65006% | −12.29426% in 2052 | 2010 | 18 / 51 | **FAIL** |

| Flags-off s11 | 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Production | 552,068 | 885,597 | 1,182,415 | 1,261,054 | [357957, 602952, 300145] | 5.11593 |
| Fresh dev | 551,235 | 888,193 | 1,272,103 | 1,427,340 | [388629, 696075, 342636] | 4.29514 |

Production subway artifact: `round2/final8neutral/production/s7-256-subway.json`; final SHA256
`ea62f775b9c26f8e2bf022a2655192cd3567d411751534a18188b4d4e3411b61`. Its complete final hash equals the separate
milestone-observer run, which also ended at 1,483,601. The earlier approved historical threshold-8 calibration
ended at 1,503,592 with a different observer schedule; those values must not be mixed into a fresh paired
population or timing comparison.
The fresh dev subway final hash is `61ddc095373a49b89e2854c6fa520ed14c5325ab9df2916d71cdaef9324c26fe`.
Production is **−0.5324%** versus this fresh same-strategy dev endpoint, passing the original year-60 population
floor. That endpoint result does not establish compliance with the separate annual flags-off rule, which fails
as shown above. The s11 flags-off final residents are production **[357957, 602952, 300145]** versus dev
**[388629, 696075, 342636]**. Its production/dev final hashes are respectively
`c32d49be830de57cfaeb9981e218b7393adb9e5c6e370f44c8339c3ac7353113` and
`1f002f447e8f1eb822b2478f5204cf4f6edf86765ce948f991f608b9a89ed7eb`.
The fresh skip-transit hash is `18d3320a3540c3d4820204f33bd15d62e9c192c63ff55d922194512588491625`, exactly equal
to the historical threshold-8 skip run. All three fresh completed transit/dev/skip runs have identical normalized
hashes before and after their final census.
The fresh dev flags-off s7 final hash is `e44ee52a8dcb4942b542a6feee1dc462789556c06c30a891f17752f0bf570ac6`,
matching this lane's historical flags-off dev hash. The fresh 128×15 pair ends at production
**[66507, 90953, 36384] = 193,844** versus dev **[61124, 93804, 37971] = 192,899**. The artifacts are
`round2/final8neutral/production/s7-128-base.json` and `dev/s7-128-base.json`; their hashes are respectively
`dc0ca8e04309ea12a4d4c26f09a549dd14d5c467a39411e347a604e5510e92ba` and
`fff071b3ed431644dda2f66fdfd32723afb162410f97e1b7723d026a3469f254`. The latter matches this lane's historical
128 dev digest. These are this lane's hash encoding; no equality with T062's separately encoded digests is claimed.
The completed production flags-off s7 artifact is `round2/final8neutral/production/s7-256-base.json`, hash
`3312f6e931392147ab4ed05dddaa4885bf9d8cda7270167c943c7eb322b9b04d`.

| Amended acceptance line | Fresh measurement/status |
|---|---|
| Transit loss ≥1% in 2040 | **(888,952 − 877,353) / 888,952 = 1.304794860% — PASS** |
| Transit loss ≥10% in 2060 | **(1,483,601 − 1,179,555) / 1,483,601 = 20.493785054% — PASS** |
| Subway year-60 population ≥0.99×dev | **0.994676× — PASS** |
| Shared annual flags-off base rule | all three rows exceed the measured ±1% band — **FAIL** |
| System ms/day rises by ≤3 | **−0.209074074 ms/day — PASS** in fresh same-strategy headless observation; strict G-MS same-city timing remains separate |
| Near-centre stage-6+ share ≥2×city in 2060 | **(45/130) / (661/8,925) = 4.673862446× — PASS** |
| Tower-capable DevType mean stage, diagnostic only | **near 4.851851852; city 4.136494433** |
| Skip-transit commute term non-zero from 2030 | **31/31 annual and 361/361 monthly checkpoints negative; 0 zeros — PASS** |
| Report the 128×15 seed-7 movement | **193,844**, residents **[66507, 90953, 36384]**: **+945 (+0.48989%)** versus dev |

The share census counts each catalog growable once, including lower-stage buildings whose DevType lacks a tower
definition. Distance is centre-to-centre Euclidean ≤6 from functional, connected train/subway stations. The
separate diagnostic mean includes every growable of a DevType with at least one stage-6+ catalog definition,
regardless of its present stage or density. These denominators implement NOTE-048 rather than silently changing
the population counted by the share gate.
Fresh dev's corresponding census is **4/72** near stations and **668/8,787** citywide. These are comparison
observations; the amended acceptance gate applies to the production station-area concentration.

### Annual base evidence and systematic shift

The following diagnostics accompany the failed population gate. Peak values are the largest **absolute** annual
production-minus-dev difference from 2010 onward; endpoint values retain their sign. Air uses `stats.avgAir`,
approval uses points, and I-HT share differences use percentage points with agriculture excluded.

| Flags-off row | Peak / endpoint population drift | Peak / endpoint air difference | Peak / endpoint approval difference | Peak / endpoint I-HT share difference |
|---|---|---|---|---|
| 128×15 s7 | 1.34464% / +0.48989% | 0.00260 / −0.00260 | 2.66124 / −2.66124 | 0 / 0 pp |
| 256×60 s7 | 1.92675% / +0.42911% | 0.01728 / −0.00753 | 5.09422 / −1.10389 | 3.21824 / −3.11594 pp |
| 256×60 s11 | 12.29426% / −11.65006% | 0.01695 / +0.00922 | 5.96307 / −4.46600 | 8.62901 / +5.52220 pp |

The three endpoints do not all move in one direction. The shared-year check nevertheless triggers in **every
year 2010–2013**: all three population shifts are positive and exceed half the 1% band. This requires investigation
under NOTE-048 and is not dismissed because the endpoints later differ in sign.

| Shared year | 128×15 s7 drift | 256×60 s7 drift | 256×60 s11 drift | All three >+0.5% |
|---|---:|---:|---:|---|
| 2010 | +0.64174% | +1.92675% | +1.18704% | yes |
| 2011 | +0.72823% | +1.89994% | +1.20351% | yes |
| 2012 | +1.34464% | +1.25653% | +2.08577% | yes |
| 2013 | +0.51526% | +1.27272% | +1.28754% | yes |

All six flags-off final censuses have **zero connected passenger stations**. The default bot's subway and late
venue placement are opt-in; station permission/appeal is inactive on these rows. The changed commute threshold
is active: in 2010 the production commute terms are **−0.18985 / −0.08310 / −0.19348** for the three rows, while
all dev terms are zero. At the 128-row peak in 2012, both terms are zero, showing why a later population difference
cannot be read as a linear response to that checkpoint's term. At s11's 2052 trough, production survey commute is
**12.46019** versus dev **11.28720**, with commute terms **−1.11505 / 0**. Approval changes demand/allowance and
subsequent existing seeded choices; no added RNG calls or default-bot strategy changes explain away the failure.

Full annual values, raw jobs by type, population extrema, monthly counts and provenance are retained in scratch
`round2/final8neutral/report/summary.json`, `summary.md` and `annualcomparison.csv`. The CSV contains all **108**
year-pairs (6 + 51 + 51); it is the full-precision evidence behind the rounded tables here. No A/A slack applies.

### Fresh annual skip-transit commute evidence

All **361/361** monthly checkpoints from January 2030 through the closing January 2060 snapshot are negative,
with no zeros. In 2030 the sliced survey ranges **8.92400–9.17003** and the term **−0.29251 to −0.23100**;
the full 2030–2060 monthly term range is **−1.17279 to −0.23100**. The annual values below are direct checkpoint
means, not the distribution of individual journeys cited in NOTE-048's 2040 amendment.

| Year | Traffic average, minutes | Resident survey, minutes | Commute term |
|---|---:|---:|---:|
| 2030 | 8.86915 | 8.93755 | −0.23439 |
| 2031 | 9.06154 | 9.06257 | −0.26564 |
| 2032 | 9.51407 | 9.44068 | −0.36017 |
| 2033 | 9.54403 | 9.59690 | −0.39922 |
| 2034 | 9.71681 | 9.80049 | −0.45012 |
| 2035 | 9.85049 | 9.79488 | −0.44872 |
| 2036 | 10.07024 | 10.30990 | −0.57748 |
| 2037 | 10.43037 | 10.41203 | −0.60301 |
| 2038 | 10.56797 | 10.72205 | −0.68051 |
| 2039 | 11.22998 | 11.12310 | −0.78077 |
| 2040 | 11.19289 | 11.00891 | −0.75223 |
| 2041 | 11.11249 | 11.03152 | −0.75788 |
| 2042 | 11.32530 | 11.31196 | −0.82799 |
| 2043 | 11.67747 | 11.77671 | −0.94418 |
| 2044 | 11.65460 | 11.66356 | −0.91589 |
| 2045 | 10.54526 | 11.55051 | −0.88763 |
| 2046 | 11.93421 | 11.95902 | −0.98975 |
| 2047 | 10.68276 | 11.58656 | −0.89664 |
| 2048 | 11.86320 | 12.32366 | −1.08091 |
| 2049 | 12.03264 | 11.78573 | −0.94643 |
| 2050 | 11.49752 | 11.29888 | −0.82472 |
| 2051 | 12.08231 | 11.61008 | −0.90252 |
| 2052 | 11.54023 | 11.75200 | −0.93800 |
| 2053 | 12.41964 | 12.08745 | −1.02186 |
| 2054 | 12.52481 | 11.75668 | −0.93917 |
| 2055 | 11.42366 | 11.54539 | −0.88635 |
| 2056 | 11.96097 | 12.25782 | −1.06446 |
| 2057 | 12.22024 | 12.36277 | −1.09069 |
| 2058 | 11.63509 | 11.88032 | −0.97008 |
| 2059 | 11.93211 | 12.07860 | −1.01965 |
| 2060 | 12.03599 | 12.34299 | −1.08575 |

### Why the historical calibration is separate

All **84 imported production modules are byte-identical** between the historical approved start-8 capture and
the fresh start-8 capture (`source-comparison.json` in scratch). The sim/core/save/bot and asset/manifest git diffs
from `6e62a61` to current HEAD are also empty. The diagnostic call schedule changed: the historical probe queried
station/growth state every year from 2020, while the first round-2 probe used milestones; the authoritative fresh
probe uses only a final census.

A pre-existing query/scheduler dependency explains why a cache read can affect future simulation work without an
immediate CityState write. `TrafficSystem.stopAttached` calls `refreshAttach`, which clears `attachDirty`.
`TrafficSystem.stepCost` adds `0.3 × size² / 65536` estimated milliseconds to PREP while that flag is dirty. The
headless scheduler uses this estimate for budget admission, priority credit and next-day carry. An external query
can therefore remove 0.3 estimated ms at size 256 (0.075 at 128) before scheduling. Terrain, transport and network
edits set the flag again. This is a verified source-level mechanism; an exact first-divergence replay has not been
performed. The identical fresh milestone/final-only outcome is recorded, without claiming all query schedules
are neutral or attributing the historical difference to newly added RNG calls.

**B2/cloud request, no local infra hunk:** in `src/sim/infra/traffic.ts`, `stopAttached`/`refreshAttach`/`stepCost`,
separate attachment-query cache freshness from estimated scheduler work accounting. In
`src/sim/infra/scheduler.ts`, preserve budget/credit/carry choices when a read-only attachment query occurs.
Add a paired replay with identical edits and different query frequencies, checking subsequent state and scheduled
work. A matching immediate serialized hash alone cannot detect this runtime-cache dependency. This lane changes
neither file.

The historical **1.2448%** threshold-8 cost relative to the recovered start-15 control remains the explicit evidence
approved in NOTE-048. It is not a newly measured cost against the fresh 1,483,601 result: no fresh final-only
start-15 counterfactual has yet been run. The historical rejected −0.125 sensitivity trial is retained below;
there is no new tuning sweep.

### Fresh commands and outstanding verification

The absolute `$taskRoot`, `$taskScratch` and `$taskQuiet` variables are defined in the historical command section
below. These are all **nine completed** authoritative commands; every bot process ran sequentially through the
quiet gate:

```powershell
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round2/final8neutral/production/s7-256-subway.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round2/final8neutral/dev/s7-256-subway.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round2/final8neutral/production/s7-256-skip-transit.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --out "$taskScratch/round2/final8neutral/production/s7-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 7 --out "$taskScratch/round2/final8neutral/dev/s7-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 128 --years 15 --seed 7 --out "$taskScratch/round2/final8neutral/production/s7-128-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 128 --years 15 --seed 7 --out "$taskScratch/round2/final8neutral/dev/s7-128-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 11 --out "$taskScratch/round2/final8neutral/production/s11-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 11 --out "$taskScratch/round2/final8neutral/dev/s11-256-base.json"
```

Fresh dev is captured from an archive of `683d02b`; production is an immutable capture of the worktree. Neither
uses a temporary production switch or changes another worktree. `npx tsx` remains unavailable in this environment;
the launcher bundles unchanged SimBot entry points with installed rolldown. Each capture records all 84 imported
source files, their hashes, bundle hash, source archive/PAX commit or worktree base, and simulation options.
The equivalent ordinary simbot arguments below apply to **both source captures** for each paired base/subway
configuration; skip transit applies to production only. They are equivalences, not executed tsx commands or a
request to switch this worktree:

```powershell
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 11 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --subway
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --subway --skip transit
```

Round-2 `npx tsc --noEmit` passes. Ordinary Vitest config loading failed with `spawn EPERM`, but the installed
native loader and thread pool resolve that startup issue. Each file below was run separately through the quiet
gate: **59 passed, 1 pre-existing skip, 0 failures across five files**.

| Test file | Passed | Existing skipped |
|---|---:|---:|
| `tests/sim/transitDevelopment.test.ts` | 19 | 0 |
| `tests/game/transitInspector.test.ts` | 2 | 0 |
| `tests/game/inspectorModel.test.ts` | 11 | 0 |
| `tests/game/inspectorNotes.test.ts` | 10 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |

The existing hygiene skip is **“worker migration hygiene gates W1.2: simWorker import graph excludes bundle.ts,
save/index.ts and recoveryLs.ts”**; T045 does not add or hide a skipped case.

Actual commands:

```powershell
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitDevelopment.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/transit-development-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/transitInspector.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/transit-inspector-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorModel.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/inspector-model-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorNotes.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/inspector-notes-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/worker/hygiene.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/worker-hygiene-vitest.json"
```

The filesystem audit (`round2/final8neutral/final-audit.json`) passes: all 84 current production modules still
match the capture byte-for-byte; all nine runs have the expected options/day counts, one final census and equal
before/after-census state hashes; all changed files/new tests are valid UTF-8 without BOM. No full suite, browser
or GPU run is performed here. G-STEP estimated-step, G-AB abandonment and strict same-city G-MS checks remain for
the lead; evolving-city bot CPU alone does not establish them. The earlier scratch assertion adapters also passed
19 sim + 2 inspector cases, but the real Vitest results above supersede that fallback for validation.

The completed [shared A/A report at T062 commit
`3833c8d2379d3350663e624fe30be7867c559310`](https://github.com/techsin/simcityweb/blob/3833c8d2379d3350663e624fe30be7867c559310/docs/dev/reports/sim-aa-envelope.md)
is now available from both cached T062 refs and has been read in full. It measures underlying commit
`0df76bce1a663ee44957cf47cfecdb8b18eed187`, a queue-only commit atop `9fcc2ec`; its task's `683d02b` label was stale.
A read-only git diff from `683d02b` to that underlying commit is empty across `src/sim`, `src/core`, `src/assets`
and `tools/simbot.ts`, proving compatibility of the simulation sources used for this comparison.

| Shared A/A row | Population envelope | Air envelope | Approval envelope | I-HT share envelope | Base final population |
|---|---:|---:|---:|---:|---:|
| 128×15 s7 | 0 | 0 | 0 | 0 | 192,899 |
| 256×60 s7 | 0 | 0 | 0 | 0 | 1,513,835 |
| 256×60 s11 | 0 | 0 | 0 | 0 | 1,427,340 |

All twelve absolute and relative envelopes are **exactly zero** over completed years 10 onward. The nudged run
has exactly §1 more funds in every annual observation, so the perturbation was applied. This measured +§1 result
does not estimate the noise of a larger perturbation. The current population band is therefore **±1% in every
year from year 10**, and the zero envelope supplies no variant-target forgiveness. Final envelopes/gates still
require remeasurement on the post-T041 base.

For compatibility with the shared report, I-HT share is `jobsByDev[11] / sum(jobsByDev[9..11])`, excluding
agriculture, or zero with no such industrial jobs. The fresh probe retains raw `jobsByDev`; its convenience
`ihtShare` field includes agriculture. The comparison reader recomputes the canonical share from those raw job
arrays and does not use the convenience field; no simulation rerun was needed for this diagnostic correction.

## Changes and ownership

- `src/sim/economy/growth.ts`: connected passenger stations create tower lots within an inclusive Euclidean radius
  of 6 cells from `centerCell`. Existing downtown/hash eligibility remains. `stationLotMask` is the pure geometry
  function; `stationTowerLots` caches its result by traffic identity/graph version and station/network edits.
  Discovery uses existing `TRAFFIC_OF_STATE`, `stopAttached`, `infoOf` and `isFunctional`; unrelated growable
  updates do not rebuild the mask. `GrowthLimits.stationTower` exposes eligibility through existing inspection
  queries. An 8-cell Grand Central hook uses model `lm_grand_central`.
- `src/sim/economy/desirability.ts`: the shared mask adds exactly +0.04 to R$$, CO$$ and CO$$$ before clamping,
  for zoned and unzoned evaluation. The breakdown registers `station` / “Near a station”. Overlaps do not stack;
  other DevTypes retain their weights. The existing 33 weighted inputs remain, with the flat bonus as an auxiliary
  input.
- `src/sim/economy/tuning.ts`: `TOD` constants beside downtown tuning; NOTE-048's approved
  `APPROVAL.commuteStart = 8`, retaining the existing −0.25-per-minute coefficient. Recovery previously used 15;
  radius/appeal and the other constants are unchanged.
- **Outside the task's named production files:** `src/sim/economy/approval.ts`, `approvalSystem`'s update. The WIP
  replaced the literal threshold with `APPROVAL.commuteStart` and made an empty resident survey cost zero. Recovery
  adds one assignment, `T.commute *= fadeIn`, immediately after the existing surveyed-resident 2k→8k smoothstep.
  This applies existing new-town grace to commute approval and leaves measured values, including genuine cut-off
  journeys, intact. It is not a difficulty-specific rule.
- `tests/sim/transitDevelopment.test.ts`: **19 cases** covering exact radii, edge clipping and union, train partners
  and map-edge links, subway attachment and immediate cuts, station completion/burn/abandonment/removal,
  same-centre mode changes, cache reuse, excluded modes/missing traffic, save reconstruction, query/RNG side effects,
  tower caps, all affected DevTypes, pre-clamp appeal, Medium/Hard commute grace, the resident-weighted threshold
  and genuine measured 25/120-minute journeys.
- **Inspector hunk, newly authorized by NOTE-048:** `src/ui/inspectorModel.ts`, `growthRows`, now belongs to T045;
  its isolated hint change and `tests/game/transitInspector.test.ts` are complete. The test covers the packet-host
  fresh-query path as well as the row text; no new query or Worker field is introduced. Retained-watch invalidation
  after a remote command while paused is a separate pre-existing Worker limitation, requested below.
- `docs/dev/POLISH_BACKLOG.md`: a CONTENT/SIM follow-up for the R$ station-area permission/realization gap,
  without changing catalog, demand, allowance or fit mechanics in LG-08. Grand Central remains LG-02.
- This report is the requested artifact. Diagnostic launchers, immutable bundles, source snapshots and output
  remain in the user-designated scratch folder.

**Infra hunks: none. No B2 hunk hold; the query/scheduler request above is for its owner.** The inspector hunk is
explicitly reassigned by NOTE-048; no other cloud-held file is changed. No new persisted keys/settings or added RNG calls. Old saves
reconstruct the derived station mask. The station rules and commute threshold intentionally change balance on all
difficulties; this report does not claim Medium/Hard state identity after an intentional balance change.

## Historical Round 1 recovery evidence

Everything from this section through the historical command log records the earlier `fb1531f` calibration with
yearly stage queries. “Current” in those historical tables means the then-current start-15 recovery, not the
approved round-2 production threshold. These results explain the approved decision and rejected alternative;
the fresh matrix above governs the current gates.

Three independent ablations kept the other two features off. Every run is 256×60, seed 7, with `--subway`.
Station masks remain available even when station tower eligibility is disabled.

| Variant | Tower rule | Appeal bonus | Commute start | Population 2030 | 2040 | 2050 | 2060 |
|---|---|---|---|---:|---:|---:|---:|
| Towers only | on | 0 | 30 | 552,882 | 891,848 | 1,278,198 | 1,499,585 |
| Desirability only | off | +0.04 | 30 | 551,265 | 885,867 | 1,265,205 | 1,501,196 |
| Commute only, no grace | off | 0 | 15 | 554,560 | 888,432 | 1,272,993 | 1,402,785 |
| TOD-only control | on | +0.04 | 30 | 551,497 | 885,026 | 1,271,437 | 1,522,545 |
| Current: full TOD plus grace | on | +0.04 | 15 | 551,497 | 885,026 | 1,271,437 | 1,522,545 |

The original full WIP without recovery grace ended at **1,387,188**. The independent ablations isolate the early
commute-approval change before attributing that late loss to tower eligibility or appeal.

The residential target factor in `demand.ts:285` is `1 + APPROVAL_R * (approval - 50) / 50`, with
`APPROVAL_R = 0.06`. A small approval change therefore has a small direct target effect. It can nevertheless
change subsequent growth demand, allowance and candidate eligibility, and lead existing seeded choices down a
different path. The observed late ablation loss is not a linear population response to two early approval terms.
There are no added RNG calls; this does not promise the same sequence of existing calls after branching changes.

The no-grace commute-only run records exactly two negative observations in its first 36 monthly observations:

| Day | Current residents | Traffic average, minutes | Sliced resident-survey commute | Commute term |
|---|---:|---:|---:|---:|
| 30 | 82 | 31.86877 | 25 | −2.5 |
| 60 | 438 | 11.94665 | 19.56633 | −1.14158 |

Unmeasured occupied homes contribute the existing 25-minute fallback to the resident survey. Its monthly slices
also differ from a fresh current-population sample: at day 30 there are 23 measured and 59 unmeasured residents;
at day 60, 266 measured and 172 unmeasured. Displayed population is not the exact sliced survey weight.
Recovery retains real measured commutes and changes only the population grace applied to approval. The recovered
transit and skip-transit runs record no negative term in their first 36 monthly observations.

Full TOD with the 15-minute threshold plus grace and the old-30-minute TOD-only control finish with the same
normalized serialized-city SHA256:

`53326669e4da0222f38e4c5b6b12e2908f7db9e4449aadc0ccff26bc2aa7a353`

The digest uses `serializeCity(copy: true)`, `savedAt = 0`, sorted object keys and tagged raw typed-array bytes,
in separate simulation processes. This establishes equality of their persisted final city; it does not claim that
every intermediate state was hashed or that either final city equals dev's full saved state.

## Historical Round 1 gate matrix

These are fresh runs of the current 15-minute-plus-grace implementation. The flags-off run also matches the
recorded b3 population counts; no fresh dev flags-off full-state comparison was performed.

| Run | Population 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Default, flags off | 550,399 | 885,236 | 1,265,741 | 1,513,835 | [412608, 738176, 363051] | not used for timing comparison |
| `--subway` | 551,497 | 885,026 | 1,271,437 | 1,522,545 | [413270, 744567, 364708] | 6.05245 |
| `--subway --skip transit` | 554,294 | 884,648 | 1,256,629 | 1,423,887 | [413630, 677412, 332845] | 6.79074 |

The fresh pre-edit dev `--subway` reference is **1,491,542** in 2060, residents
**[416853, 724509, 350180]**, at **5.52227 system CPU ms/day**. The recovered transit run is **+2.07859%** against
that same-strategy population reference.

| Acceptance line | Current measurement | Result |
|---|---|---|
| Skip transit costs ≥4% of people in 2040 | (885,026 − 884,648) / 885,026 = **0.0427106%** | FAIL |
| Skip transit costs ≥10% in 2060 | (1,522,545 − 1,423,887) / 1,522,545 = **6.47981%** | FAIL |
| Base year-60 population ≥0.99×dev | **1.0207859×** fresh dev `--subway`; also above b3 flags-off floor 1,498,697 | PASS |
| Mean system ms/day rises by ≤3 | **+0.53019 ms/day** against fresh same-strategy dev | PASS, single-run headless observation |
| Near-station mean stage ≥1.5×city | **4.34247 / 4.0524 = 1.07158×** in 2060 | FAIL |
| Skip-transit commute term non-zero from 2030 | **0 in every recorded monthly checkpoint**, 2030 through the closing January 2060 snapshot | FAIL |
| Report the 128×15 seed-7 change | **[61124, 93804, 37971] = 192,899**, exactly the supplied resident counts | Restored |

The restored 128×15 artifact is `round1-candidate-fade15/final-128x15-s7.json` (digest prefix `fff071…`). Matching
resident counts do not establish full saved-state identity with dev. The fresh flags-off 256×60 final digest is
`e44ee52a8dcb4942b542a6feee1dc462789556c06c30a891f17752f0bf570ac6`; the recovered skip-transit digest is
`2759287d0add0eb63c742fe7783476f91cee329217808284502ea279f092e741`.

### Skyline checkpoints

Each catalog growable is counted once. Acceptance distance is Euclidean ≤6 between station and building
`centerCell`, using functional, attached train/subway stations. Actual growth eligibility is evaluated at
`lotCell`, the front-middle cell, so both interpretations are recorded.

| Year | Connected stations | City mean stage | Mean within 6 centre-cell tiles | Ratio | Near buildings | Near stage 6+ |
|---|---:|---:|---:|---:|---:|---:|
| 2030 | 10 | 3.10386 | 3.50588 | 1.12952× | 85 | 1 |
| 2040 | 10 | 3.51262 | 3.65060 | 1.03928× | 83 | 3 |
| 2050 | 10 | 3.93423 | 4.00000 | 1.01672× | 75 | 9 |
| 2060 | 10 | 4.05240 | 4.34247 | 1.07158× | 73 | 23 |

At 2060 all 73 near-centre lots are high density. Their stage-1…8 histogram is **[0, 0, 26, 21, 3, 21, 2, 0]**;
the city's is **[21, 105, 1923, 4868, 1195, 596, 90, 0]**. Derived growth limits permit stage ≥6 on **62/73** near
lots, including **52** with an effective stage-8 cap. **65** near buildings have front cells newly opened by the
station rule relative to the original downtown hash. This is permission, not proof of sufficient demand,
banked growth allowance, catalog capacity gain or a fitting footprint. The front-mask ratio is **1.06604×**;
the functional-only centre-distance ratio is **1.07131×**, so these counting choices do not resolve the miss.

The recovered bot's frozen subway route has 10 connected stations, versus 25 in the original full WIP. Early
approval changes can therefore change subsequent route/layout choices without added RNG calls. Its station mask
covers **684 cells**, with **321** high-density cells in 2030 and **319** in 2060, a small part of the 256×256 map.
The completed actual rejection counters below distinguish permission from selection and fit. Counter timing is
excluded from acceptance timing.

The 2060 near-centre breakdown also shows why a permissive stage cap overstates realizable tower opportunity:

| DevType | Near buildings | Actual stage 6+ | Effective cap ≥6 | First catalog tower: stage / capacity |
|---|---:|---:|---:|---|
| R$ | 35 | 5 | 35 | 6 / 800 |
| R$$ | 4 | 1 | 2 | 6 / 1,100 |
| R$$$ | 11 | 8 | 9 | 6 / 1,300 |
| CS$ | 13 | 0 | 7 | none |
| CS$$ | 2 | 1 | 1 | 6 / 700 |
| CS$$$ | 1 | 1 | 1 | 7 / 1,200 |
| CO$$ | 3 | 3 | 3 | 6 / 1,400 |
| CO$$$ | 4 | 4 | 4 | 6 / 1,600 |

There is no industry in this near-station sample. All catalog towers require high density; CS$, I-A, I-D and I-M
have no stage-6+ definitions at all, while CS$$$ first gets one at stage 7. In particular, 13/73 near buildings are
CS$ shops, all actually stage 3. All seven offices are stage 6. R$ has the largest permission/realization gap: all
35 permit stage ≥6, but only five have reached it. The late counters show why selection, rather than R$ geometry
once selected, is the main measured restriction. No local tower quota was added: station-mask eligibility returns
true while retaining every original downtown tower right. The actual tower fraction is **23/73 = 31.50685%** near
stations versus **686/8,798 = 7.79723%** citywide, an observed concentration despite the mean-stage gate miss.

### Actual growth selection and rejection counters

A separate immutable diagnostic injected scalar counters into the existing growth branches, without extra RNG
calls, repeated geometry calls or extra candidate walks. “Near” below means the existing station mask at the
actual front `lotCell`. Early redevelopment guards occur before that existing coordinate calculation and are not
silently assigned to the near subset. The denominators differ: **front attempts** are calls surviving those early
guards; **catalog definitions** are entries visited in the existing candidate loop; **selected definitions** can
have several attempted origins; **origins** are individual positions checked. These quantities must not be added
as if they were the same attempts.

| Near-front redevelopment period | Front attempts | No DevType picked | Stage blocks | Tower definitions selected | Selected definitions exhausted | Tower successes |
|---|---:|---:|---:|---:|---:|---:|
| 2021–2030 | 2,784 | 692 | 219 | 54 | 53 | 1 |
| 2031–2040 | 3,922 | 1,003 | 298 | 247 | 245 | 2 |
| 2041–2050 | 3,602 | 559 | 411 | 418 | 411 | 7 |
| 2051–2060 | 3,465 | 1,098 | 386 | 445 | 431 | 14 |

Tower catalog filters count stage-6+ definitions, using the original first-failing precedence: stage range,
maximum affordable capacity (`capMax`), then minimum capacity gain (`capMin`). They include repeated visits across
different actual front attempts; accepted definitions are not automatically selected or fitted.

| Period | Tower definitions considered | Rejected stage | Rejected `capMax` | Rejected minimum gain | Accepted definitions |
|---|---:|---:|---:|---:|---:|
| 2021–2030 | 4,471 | 614 | 3,789 | 13 | 55 |
| 2031–2040 | 6,369 | 745 | 5,355 | 22 | 247 |
| 2041–2050 | 6,318 | 584 | 5,240 | 76 | 418 |
| 2051–2060 | 4,392 | 701 | 3,105 | 141 | 445 |

In 2051–2060, the 445 selected near-front tower redevelopments tried **1,459 origins**: **986** first failed the
combined zone/network/water/power-line cell check, **414** met an occupant of the same or higher stage, **45**
failed aggregate replacement-capacity gain, and **14** succeeded. Those counts sum to 1,459; no other origin
failure reason occurred in this late subset.

Residential totals combine new growth and redevelopment. The no-allowance/eligible columns count **DevType visits
inside the existing picker**, while `capMax` counts **catalog definitions**, and selected/success counts **tower picks**.

| Near-front R checks, 2051–2060 | Picker: no allowance | Picker: eligible | Tower definitions rejected `capMax` | Tower picks | Tower successes |
|---|---:|---:|---:|---:|---:|
| R$ | 1,700 | 727 | 791 | 5 | 5 |
| R$$ | 1,689 | 738 | 1,233 | 0 | 0 |
| R$$$ | 1,802 | 602 | 826 | 6 | 5 |

R$$$ also recorded 23 low-desirability picker visits. All five selected late R$ towers fitted; none was lost to
physical fit. Its measured bottleneck is demand/allowance and the affordability filter before selection. Most of
the aggregate selected-tower fit failures are commercial. This does not make the global bank a single pool: each
DevType has its own demand and allowance.

Across the whole city in 2051–2060, capacity spending was **52,991 new / 367,905 redevelopment**, or **87.41%**
redevelopment. Near stations it was **592 new / 10,438 redevelopment**, or **94.6328%** redevelopment. These are
growth capacity units, not resident counts. The measurements do **not** support the blanket claim that empty-lot
growth starves late upgrades; they show the actual residential filters and the separate commercial fit problem.

The counter run finishes at **1,522,545**, residents **[413270, 744567, 364708]**, with the same normalized final
hash `53326669e4da0222f38e4c5b6b12e2908f7db9e4449aadc0ccff26bc2aa7a353` in a **third independent process**.
That observed state equality validates the counter run against the retained candidate. All **721 recorded
snapshots** over the full run have commute term **0**; maximum sliced survey commute is the early fallback **25**,
suppressed by grace. This closes the earlier 2003–2029 monthly-capture gap. Counter CPU is excluded from timing.
Evidence: `growth-counters/fade15-final/run.json`, `summary.txt` and `compact.json` in scratch; the capture metadata
also records exact source anchors and source hashes.

### Annual skip-transit commute evidence

Each cell is **traffic average / sliced resident survey / commute approval term**. “WIP” is committed WIP
`731fffa` without recovery grace; “current” is the recovered 15-minute implementation. These are the 31 annual
checkpoints from `round1-v2/recovery-evidence.md`.

| Year | WIP skip transit | Current skip transit |
|---|---|---|
| 2030 | 9.58274 / 9.55266 / 0 | 8.30046 / 8.32415 / 0 |
| 2031 | 9.67434 / 9.86951 / 0 | 8.50779 / 8.50023 / 0 |
| 2032 | 9.96565 / 9.94948 / 0 | 8.52211 / 8.58234 / 0 |
| 2033 | 10.16574 / 10.18616 / 0 | 8.82044 / 8.77349 / 0 |
| 2034 | 10.09806 / 10.34868 / 0 | 8.92894 / 8.87295 / 0 |
| 2035 | 10.53658 / 10.65852 / 0 | 9.01438 / 9.12921 / 0 |
| 2036 | 10.86632 / 10.76637 / 0 | 9.64267 / 9.45629 / 0 |
| 2037 | 11.00435 / 11.21214 / 0 | 9.80186 / 9.66361 / 0 |
| 2038 | 11.45847 / 11.34403 / 0 | 9.84718 / 9.91127 / 0 |
| 2039 | 12.06874 / 11.64853 / 0 | 10.08736 / 10.23392 / 0 |
| 2040 | 11.80291 / 11.75828 / 0 | 9.95576 / 10.23703 / 0 |
| 2041 | 11.09028 / 11.50815 / 0 | 10.38936 / 10.48988 / 0 |
| 2042 | 12.04907 / 12.48725 / 0 | 10.85845 / 10.80302 / 0 |
| 2043 | 12.61813 / 12.03988 / 0 | 10.91336 / 10.80204 / 0 |
| 2044 | 11.52735 / 11.99935 / 0 | 11.21985 / 11.07096 / 0 |
| 2045 | 12.38589 / 12.79783 / 0 | 10.75310 / 10.91522 / 0 |
| 2046 | 12.02578 / 12.47173 / 0 | 10.81247 / 10.98004 / 0 |
| 2047 | 13.05907 / 13.22955 / 0 | 11.00142 / 10.86369 / 0 |
| 2048 | 12.13244 / 12.53491 / 0 | 10.05002 / 10.25241 / 0 |
| 2049 | 12.46930 / 12.77898 / 0 | 10.25823 / 10.32766 / 0 |
| 2050 | 11.58954 / 12.20817 / 0 | 10.76139 / 10.43124 / 0 |
| 2051 | 12.33552 / 12.38225 / 0 | 10.47866 / 10.52334 / 0 |
| 2052 | 12.20557 / 12.69638 / 0 | 10.74671 / 10.88333 / 0 |
| 2053 | 13.74807 / 12.44525 / 0 | 10.65566 / 10.83331 / 0 |
| 2054 | 12.13921 / 12.19036 / 0 | 11.02603 / 11.44005 / 0 |
| 2055 | 12.15988 / 12.25002 / 0 | 10.96008 / 11.08160 / 0 |
| 2056 | 12.61830 / 12.57523 / 0 | 10.74649 / 11.01107 / 0 |
| 2057 | 12.43510 / 12.91544 / 0 | 10.52463 / 10.84697 / 0 |
| 2058 | 13.06632 / 13.12875 / 0 | 11.15800 / 11.29923 / 0 |
| 2059 | 12.95618 / 13.17855 / 0 | 10.73989 / 10.77699 / 0 |
| 2060 | 12.26061 / 12.31903 / 0 | 10.53620 / 11.00728 / 0 |

Monthly capture confirms zero terms at all **361** recorded current skip-transit checkpoints from January 2030
through January 2060. In 2030 the resident survey ranges **8.32415–8.45724** minutes; the transit run's annual
2030 survey is **10.17102**, higher than skip transit. Threshold 15 cannot activate on these values. Thresholds
10 and 9.5 would not activate the recovered 2030 skip-transit case either.

## Historical threshold-8 proposal, original coefficient

This was a scratch-only proposal, subsequently approved by NOTE-048: full TOD, existing 2k→8k grace, start
**8 minutes**, coefficient **−0.25**. Production was then at start 15. Eight is the nearest whole-minute start below the recovered skip-transit 2030
survey mean 8.32415; this is not a claim of a globally minimal balance change.

| Year | Proposal `--subway` population | Proposal skip population | Skip commute approval term |
|---|---:|---:|---:|
| 2030 | 554,789 | 554,373 | −0.234386659 |
| 2040 | 888,965 | 877,353 | −0.752228578 |
| 2050 | 1,272,635 | 1,156,617 | −0.824719416 |
| 2060 | 1,503,592 | 1,179,555 | −1.085747221 |

Final transit residents are **[418450, 729932, 355210]**; skip residents are **[289184, 592462, 297909]**.
The transit result is **+0.807889%** versus fresh dev subway, but **−1.2448%** versus the retained-15 recovery
base 1,522,545: it is not literally neutral. Its system CPU is **7.51023 ms/day**, about **+1.98796** versus fresh
dev, within the +3 headless limit in this observation. Skip CPU is **6.64227 ms/day**.

| Acceptance line | Threshold 8 / coefficient −0.25 | Result |
|---|---|---|
| 2040 transit population loss ≥4% | (888,965 − 877,353) / 888,965 = **1.306238%** | FAIL |
| 2060 transit population loss ≥10% | (1,503,592 − 1,179,555) / 1,503,592 = **21.55086%** | PASS |
| Base ≥0.99×fresh dev subway | 1,503,592 versus 1,491,542 reference; also above b3 floor 1,498,697 | PASS |
| Commute term non-zero from 2030 | All **31/31 annual** and **361/361 monthly** skip checkpoints negative | PASS |
| Mean stage near stations ≥1.5×city | **1.139642798×** in 2060 | FAIL |

All 12 proposal-skip monthly terms in 2030 are negative, ranging **−0.29251 to −0.231**; the resident survey ranges
**8.92400–9.17003** minutes. Across January 2030 through the closing January 2060 snapshot, all 361 recorded terms
are negative, with no zeros; the recorded range is **−1.17279 to −0.231**. The complete 31-row annual proposal-skip
traffic/survey/term table and monthly-per-year counts are retained in
[the full proposal evidence](/C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/round1-proposal-start8/proposal-evidence.md).

Final normalized hashes:

- Transit: `3d46e23dd34aaa1a41333eb136dd79130df23417483c8404138d4affcb68958e`.
- Skip: `18d3320a3540c3d4820204f33bd15d62e9c192c63ff55d922194512588491625`.

### Rejected half-coefficient sensitivity trial

Because the original coefficient costs 1.2448% versus the recovered base, one shallower-coefficient trial was
measured: **start 8, coefficient −0.125, same TOD and grace**, frozen revision `proposal-start8-half`.

| Year | Transit population | Commute approval term |
|---|---:|---:|
| 2030 | 553,239 | −0.285322744 |
| 2040 | 889,064 | −0.469522523 |
| 2050 | 1,178,326 | −0.574341725 |
| 2060 | 1,259,756 | −0.478701956 |

Final residents are **[351213, 604283, 304260]**. The normalized final hash is
`0265e25d5d5d628d1633d857a8bfc509e7d28ab0c85eeb648cfd6b39841268e8`.
This trial **fails the primary base-population floor**: 1,259,756 is below the required 1,476,627 versus fresh dev
subway (**−15.540025%** versus dev), and also below the b3 flags-off floor. It is **rejected**, not a recommended proposal. No half-coefficient
skip-transit run was performed because the base already failed. No additional weaker-coefficient sweep is being
used to chase another seeded path.

The paired start-8/−0.25 rows remain the measured alternative: their base is within 1% of fresh dev, but they cost
1.2448% versus the recovered start-15 base. There was **no validated zero-movement solution**. NOTE-048 approved
the original-coefficient proposal and its stated cost; the half-coefficient trial remains rejected. The historical
growth-counter run is complete above.

## Historical validation and remaining checks

- `npx tsc --noEmit`: passed after the recovery change.
- `git diff --check`: passed. The four production files match the frozen tested candidate after line-ending
  normalization; all six reviewed source/test/report files are valid UTF-8 without a BOM. Evidence:
  `recovery-file-verification.json` in scratch.
- Quiet-gated `npx vitest run tests/sim/transitDevelopment.test.ts --maxWorkers=1`: startup failed with
  **`spawn EPERM`** during Vite configuration loading (`externalize-deps` / `optimizeSafeRealPathSync`). No Vitest
  cases executed; this is not a passing Vitest result.
- The scratch-only installed-rolldown plus `node:assert/strict` runner executed the same 19 synchronous cases:
  **19 passed, 0 failed**. Evidence: `tod-focused-probe.log` / `tod-focused-probe.json`.
- Full Vitest, existing-file regression tests and browser/GPU checks remain for the lead. No full suite or browser
  was run by this lane. Relevant individual regressions include `tests/sim/growth.test.ts`,
  `tests/sim/desirability.test.ts`, `tests/sim/approval.test.ts`, `tests/infra/transitFacilities.test.ts`,
  `tests/worker/hygiene.test.ts`, `tests/worker/querySideEffects.test.ts` and inspector/replica suites.
- Timings are single-run headless system CPU observations, using existing bot timers divided by simulated days,
  excluding bot actions and diagnostic callbacks. They do not establish browser/GPU timing.
- Final-state hashes and query/RNG tests were checked; no two-process every-year Medium/Hard replay comparison
  is claimed. The counter-only diagnostic completed with matching final state and all-month commute capture;
  the half-coefficient trial failed and was stopped before a skip-transit run.

## Historical reproduction and actual bot commands

All bot runs were sequential and quiet-gated. `npx tsx` is unavailable (`ENOTCACHED`, restricted network), so installed
rolldown bundled unchanged `SimBot`, `parseArgs`, `botSystems` and diagnostics into immutable scratch Node ESM.
The pre-edit dev bundle captured production before edits. Ablations changed exact source anchors only in scratch;
there are no production environment switches. Candidate captures record original/transformed source hashes and
single-match counts. Final candidate artifacts match the production recovery assignment.

These PowerShell task variables shorten the actual commands. Paths are absolute; no PowerShell file rewrites are
used:

```powershell
$taskRoot = 'C:/Users/techsin/Desktop/projects/simcityweb-T045'
$taskScratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch'
$taskQuiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
Set-Location -LiteralPath $taskRoot

# Fresh pre-edit dev, same subway strategy.
node $taskQuiet node "$taskScratch/tod-gates-dev.mjs" --size 256 --years 60 --seed 7 --subway --out "$taskScratch/dev-subway-256x60-s7.json"

# Three independent ablations, then the old-threshold TOD control.
node $taskQuiet node "$taskScratch/round1-launch.mjs" --variant towers-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1/towers-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --variant desir-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1/desir-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision v2 --variant commute-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-v2/commute-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision v2 --variant tod-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-v2/tod-only-256x60-s7-subway.json"

# Current 15-minute threshold plus existing new-town grace: all completed.
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-candidate-fade15/final-subway-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round1-candidate-fade15/final-skip-transit-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --out "$taskScratch/round1-candidate-fade15/final-base-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 128 --years 15 --seed 7 --out "$taskScratch/round1-candidate-fade15/final-128x15-s7.json"
```

The ordinary CLI equivalents for the four final configurations, once tsx is available, are:

```powershell
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --subway
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --subway --skip transit
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7
```

Completed final evidence is summarized in `round1-v2/recovery-evidence.md`, with original small summaries in
`round1/tod-parts-summary.txt` and `round1-v2/commute-summary.txt`. WIP `tod-final-*` outputs are superseded by
`round1-candidate-fade15/final-*`; they are not recovery gate results.

The completed threshold-8/−0.25 proposal used these quiet-gated commands against its immutable frozen-source
capture. They measure a proposal and do not change production:

```powershell
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8 --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-proposal-start8/proposal-subway-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8 --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round1-proposal-start8/proposal-skip-transit-256x60-s7.json"
```

The single rejected half-coefficient sensitivity trial used:

```powershell
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8-half --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-proposal-start8-half/proposal-subway-256x60-s7.json"
```

Completed counter-only diagnostic command, excluded from timing:

```powershell
node $taskQuiet node "$taskScratch/growth-counter-launch.mjs" --variant wip-fade-15 --tag fade15-final --size 256 --years 60 --seed 7 --subway --out "$taskScratch/growth-counters/fade15-final/run.json"
```

## Plan/code differences and owner requests

1. `APPROVAL.commute` was the −0.25 coefficient; the threshold was a literal `30` in `approval.ts`. The minimal
   outside-owned-file assignment implements the requested threshold. The additional recovery line reuses existing
   population grace because a hamlet's fallback-heavy monthly survey otherwise changes the subsequent bot path.
   It does not replace genuine measured journeys with the traffic average.
2. `TrafficSystem.graphVersion` covers the road graph. Station addition/removal/completion and immediate tunnel
   edits can change `stopAttached` without changing it. The cache must also listen to station/network edits.
3. Grand Central has an asset but no simulation catalog/reward definition with passenger attachment roles.
   **CONTENT/SIM request:** its final LG-02 definition should use model `lm_grand_central` and the intended
   train/subway connectivity semantics. The 8-tile hook exists; real Grand Central connectivity remains unverified.
4. Historical plan/b3 rows are context only. Current acceptance uses fresh `683d02b` pairs and NOTE-048's shared
   annual/A/A rule, followed by final remeasurement after B2/T041. The 2040 threshold is now 1%, and the 2060
   stage-6+ share threshold is 2×city. NOTE-048's reason for the 2040 amendment is that most individual 2040 bot
   commutes are below 8.5 minutes; this is not a claim that a newly measured population mean is below 8.5.
5. **Inspector ownership reassigned:** NOTE-048 authorizes T045's isolated `src/ui/inspectorModel.ts`,
   `growthRows` hunk. The long downtown-cap hint needs a dedicated row because the generic path skips text of
   80+ characters. Station eligibility is already carried by the inspection query; no Worker row is requested.
6. **GUIDE request:** `src/ui/panels/StatsPanel.ts`, its update near `commuteModes(s.commuteByMode)`: add “Riders
   save N minutes compared with driving” using mirrored `ctx.state.stats.commuteByMode.transitSaved`. Existing
   `statsModel.commuteModes` already supplies equivalent `modeNote` text. Keep negative savings truthful as slower
   trips. No new counter or Worker query is needed. NOTE-048 defers this Stats line to PB-COMMUTE; it is not
   implemented by T045. The inspector exception above does not transfer other UI ownership.
7. **B2/cloud request:** the attachment query/scheduler dependency is detailed in the round-2 section. This lane
   makes no infra changes and requests owner-side query-frequency replay coverage.
8. **Worker/cloud request:** in `src/worker/queries.ts`, `watchSignature`'s early inspector branch returns
   `inspectSignature(...)` without the command epoch. A retained inspector watch can therefore stay stale while
   paused after a remote transport edit, although a fresh packet-host query returns the correct eligibility/hint.
   The minimal proposed owner change is
   ``return `${inspectSignature(sim, args as InspectBuildingArgs | InspectCellArgs)}:${commands}`;``
   in that branch, preserving the existing 1 Hz cap. Add a packet-watch regression that retains the inspector,
   cuts/reconnects the station line via a remote command while paused, and observes the updated hint. This is an
   existing signature change beyond additive query-entry authorization, so T045 does not edit Worker files.

## Decisions for the lead

- **Approved amendments:** NOTE-048 settles start 8/−0.25 with existing grace, 2040 loss ≥1%, and the stage-6+
  share ≥2×city. Keep radius/appeal and unrelated balance fixed. The historical 1.2448% cost and rejected −0.125
  sensitivity remain visible; no fresh start-15 paired cost is claimed.
- **Acceptance is FAIL under the shared annual rule:** all nine bot cases are complete, and all three flags-off
  rows fail the measured ±1% annual band. Peak drifts are +1.34464%, +1.92675% and −12.29426%; s11 ends
  −11.65006%. Zero A/A envelopes do not excuse the misses. All three rows also shift upward by >0.5% in each
  shared year 2010–2013. The lead must resolve this conflict with the approved start-8 mechanism; its historical
  endpoint approval does not waive the annual rule. T045 keeps the specified cost and makes no compensating
  residential growth, free approval, default-bot strategy or other balance change. Final merge gates/envelopes
  must still be remeasured after B2/T041 on that exact base.
- **Permission/realization follow-up:** the requested CONTENT/SIM backlog entry is present. No local quota exists
  to remove: near-station permission already retains all original downtown rights. Catalog, demand, growth
  allowance or footprint changes require their own later balance lane; historical counters are evidence, not
  authority to extend LG-08's scope.
- **Owner work and remaining checks:** route the concrete attachment-query/scheduler request to B2, keep the
  Stats line with PB-COMMUTE and Grand Central with LG-02, and run the remaining full Vitest/browser/GPU checks.
  Route retained-inspector watch invalidation to the Worker owner. The inspector payload/text hunk is isolated
  and authorized here; retained-watch reactivity is not claimed to pass. No `.done` is written.

## Browser checklist for the lead

- [ ] Connect two subway stations, or a passenger train station to another station/the map edge. High-density lots
  within 6 centre-cell tiles become tower sites, subject to population, desirability, demand and utilities.
- [ ] A lone/disconnected station, bus stop or freight station creates no tower sites. Cutting the line, removing
  its partner, or burning/abandoning a station removes eligibility; rebuilding restores it.
- [ ] R$$, CO$$ and CO$$$ Why? views show “Near a station” at +4 points. Other types and overlapping catchments
  receive no extra bonus.
- [ ] Above the new-town grace range, a resident-weighted commute over 8 minutes shows a negative monthly
  approval term. A hamlet's term fades over 2k→8k sampled residents; an empty city costs zero. Genuine cut-off
  journeys remain penalized, including when the reported traffic average is zero.
- [ ] Save/load an existing city; station effects reconstruct and play continues in local and Worker modes.
- [ ] Verify the isolated station/downtown inspector hint. Check the Transit minutes-saved line after PB-COMMUTE.
- [ ] Keep an inspector open while paused; remotely cut/reconnect the station line and verify the hint updates
  within the existing watch cap after the Worker owner fixes command-epoch invalidation. A fresh query alone
  does not pass this retained-watch check.
- [ ] After LG-02 supplies Grand Central's connected definition, verify its 8-tile radius.
- [ ] Inspect station-area skyline variety/concentration. Browser inspection alone does not establish NOTE-048's
  numerical stage-6+ share gate; use the final census and fresh paired bot evidence.
