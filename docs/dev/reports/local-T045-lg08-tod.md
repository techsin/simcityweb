# T045 — LG-08 transit-oriented development

Base `fb1531f`; branch `local/T045-lg08-tod`. The user committed the original implementation as WIP `731fffa`.
The recovery changes described below — one approval assignment, the expanded test cases and this report — remain
uncommitted. This lane has not committed, pushed, merged or written a `.done` file.

**The specified 15-minute implementation is not acceptance-green.** Recovery restores the population floor,
the 128×15 resident counts and the timing gate. Transit still costs only 0.0427106% of the 2040 population and
6.47981% in 2060; station-area mean stage is 1.07158× the city average; the skip-transit commute term remains zero.
The completed threshold-8/−0.25 proposal activates commute pressure and passes the 2060 transit-loss gate, but still
misses the 2040 loss/stage gates and costs 1.2448% versus the retained-15 recovery base. The one −0.125-coefficient
sensitivity trial failed the base-population floor and is rejected. Completed growth counters identify residential
allowance/capacity filters and commercial footprint rejection; they do not support a blanket late empty-growth
starvation claim. Production remains at 15/−0.25 plus grace.

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
- `src/sim/economy/tuning.ts`: `TOD` constants beside downtown tuning; `APPROVAL.commuteStart = 15`, retaining
  the existing −0.25-per-minute coefficient. These three files are unchanged from WIP `731fffa` during recovery.
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
- This report is the requested artifact. Diagnostic launchers, immutable bundles, source snapshots and output
  remain in the user-designated scratch folder.

**Infra hunks: none. No B2 hold. No cloud-held edits.** No new persisted keys/settings and no added RNG calls. Old saves
reconstruct the derived station mask. The station rules and commute threshold intentionally change balance on all
difficulties; this report does not claim Medium/Hard state identity after an intentional balance change.

## Recovery evidence

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

## Current gate matrix

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

## Completed threshold-8 proposal, original coefficient

This is a scratch-only proposal: full TOD, existing 2k→8k grace, start **8 minutes**, coefficient **−0.25**.
Production remains at start 15. Eight is the nearest whole-minute start below the recovered skip-transit 2030
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
1.2448% versus the recovered start-15 base. There is **no validated zero-movement solution**. Neither trial changes
production. The actual growth-counter run is complete, as reported above.

## Validation and remaining checks

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

## Reproduction and actual bot commands

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
4. The plan's historical 1.547M row is stale. Current b3 flags-off reference is 1,513,835; fresh pre-edit
   same-strategy dev subway result is 1,491,542. Both comparisons are stated above.
5. **GUIDE/cloud-held request:** `src/ui/inspectorModel.ts`, `growthRows`: add “Stage 5 max: not a tower site — a
   subway or train station within 6 tiles allows towers here” as a dedicated row when the downtown cap binds;
   the generic string path skips text of 80+ characters. When `stationTower` is true, attribute eligibility to
   the station. Existing inspection queries carry the boolean; no Worker row is requested.
6. **GUIDE request:** `src/ui/panels/StatsPanel.ts`, its update near `commuteModes(s.commuteByMode)`: add “Riders
   save N minutes compared with driving” using mirrored `ctx.state.stats.commuteByMode.transitSaved`. Existing
   `statsModel.commuteModes` already supplies equivalent `modeNote` text. Keep negative savings truthful as slower
   trips. No new counter or Worker query is needed. No UI/cloud-held file was changed here.

## Decisions for the lead

- **Commute start and coefficient:** keep the specified production 15/−0.25 plus grace, or authorize a measured
  proposal. Recovered skip commute is below 8.46 minutes in 2030, so starts 15, 10 and 9.5 do not meet the
  non-zero gate on that path. The paired start-8/−0.25 alternative meets it and its base is within 1% of fresh dev,
  but it costs 1.2448% versus the recovered base. The single start-8/−0.125 sensitivity trial failed the base floor
  and is rejected; it has no skip run. No validated zero-movement solution exists, and further weaker-slope trials
  are not proposed as a way to select a favorable seeded outcome.
- **Population-loss targets:** current production misses both 4%/10%; start 8/−0.25 passes 2060 but still misses
  2040 at 1.306238%. Decide whether these targets or the allowed transit mechanism should change; do not silently
  strengthen radius, appeal or unrelated balance to manufacture a pass.
- **Stage target and denominator:** current production reaches 1.07158×; the completed proposal reaches
  1.13964×. Thirteen of 73 nearby buildings are CS$ with no tower definition, while the largest actual conversion
  gap is R$. Actual counters identify residential demand/allowance/capacity filtering before tower selection and
  mainly commercial physical-fit failures afterwards. There is no station tower quota to remove: permission is
  already granted, and original downtown rights remain. Changing catalog content, demand, growth budgets or fit
  balance would go beyond the stated TOD constants and requires an explicit design decision. Distinguish the
  existing all-growable denominator from any proposed eligible-type denominator.
- **Completion gates and owner work:** full Vitest/browser checks remain, as do GUIDE's two display requests
  and Grand Central's future definition. Keep the unresolved acceptance status visible; no `.done` is written.

## Browser checklist for the lead

- [ ] Connect two subway stations, or a passenger train station to another station/the map edge. High-density lots
  within 6 centre-cell tiles become tower sites, subject to population, desirability, demand and utilities.
- [ ] A lone/disconnected station, bus stop or freight station creates no tower sites. Cutting the line, removing
  its partner, or burning/abandoning a station removes eligibility; rebuilding restores it.
- [ ] R$$, CO$$ and CO$$$ Why? views show “Near a station” at +4 points. Other types and overlapping catchments
  receive no extra bonus.
- [ ] Above the new-town grace range, a resident-weighted commute over 15 minutes shows a negative monthly
  approval term. A hamlet's term fades over 2k→8k sampled residents; an empty city costs zero. Genuine cut-off
  journeys remain penalized, including when the reported traffic average is zero.
- [ ] Save/load an existing city; station effects reconstruct and play continues in local and Worker modes.
- [ ] After GUIDE's owner changes, verify the station/downtown inspector hint and Transit minutes-saved line.
- [ ] After LG-02 supplies Grand Central's connected definition, verify its 8-tile radius.
- [ ] Inspect station-area skyline variety/concentration and rerun unresolved numerical gates after the lead's
  design decision. Browser inspection alone does not establish the 1.5× stage gate.
