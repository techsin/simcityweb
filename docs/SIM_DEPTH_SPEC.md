# Metropolis: Simulation Factor Implementation Spec (demographics, proximity, pollution, attraction, utilities, feedback)

Read-only audit. No repo files were modified. The only files written are probe scripts in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/audit/specperf{,2,3,4}.ts` (bundled to `.mjs`).

**Measured baselines** (256² stress city: 19.5k buildings, 36k road cells, ~650k residents; best of several runs; current tree including the perf agent's WIP edits):
- `ServicesSystem.compute` with about 850 service buildings converted in memory (90 elementary, 33 high school, 5 college, 60 clinic, 25 hospital, 560 parks, 80 police/fire): **22.7 ms per pass**. The largest single step is **4.7 ms**, which is over the 3 ms step target; `WORK_PER_STEP = 240000` is too high. At `SERVICES_PERIOD = 15` this is about 1.5 ms/day.
- `PollutionSystem.compute`: **9.7 ms per pass** (about 0.8 ms/day at `POLL_PERIOD = 12`).
- A multi-source BFS over all 36k road cells: **1.9 ms**.
- Desirability band: **0.72 ms/day**. Land-value band: **0.64 ms/day**.

---

## 0. Principles and global budget

- **Layer ownership stays as documented in CityState.ts.** Every new per-cell layer has exactly one writer package.
- **All new per-cell work is typed-array code** run as InfraScheduler steps (infra) or daily row bands and monthly hooks (economy).
- **New tunables go in dedicated sections:** `economy/tuning.ts` (§DEMOGRAPHICS, §TOURISM, §MIGRATION, §APPROVAL, §DESIRABILITY, §LAND VALUE, §GROWTH) and `infra/params.ts` (§CATCHMENTS, §POLLUTION, §UTILITIES, §CRIME). Phase 0 adds the empty section markers so that parallel edits never touch the same hunk.
- **Balance-neutral calibration rule.** Every new mechanism is calibrated so that at the *reference cohort mix* (kids 0.13, teens 0.07, young adults 0.10, adults 0.55, seniors 0.15) and typical coverage it reproduces the old totals: school seats = old "residents served" × cohort share, workforce ≈ 0.55, and weight sums unchanged. Spatial differences then emerge without moving the city-wide equilibrium.

### Added per-day cost (256², 20k buildings, ~1M pop)

| WP | New work | Cadence | Added ms/day |
|---|---|---|---|
| WP1 | Per-building cohort, workforce and education update inside the existing occupancy slice (~5k buildings/day); cohort and coarse aggregation every 4 days | daily slice | ≤ 0.12 |
| WP2 | Tier engine (+15% of the measured 22.7 ms pass); NIMBY rasters ~2 ms; 2 access searches ~2–3 ms each every 30 d; extra finish work ~2 ms | 15 d / 30 d | ≈ 0.65 |
| WP3 | Tree blur, plume shift, bank coupling, soil, garbage truck-range BFS (~1.9 ms), per-network noise base | 12 d | ≈ 0.30 |
| WP4 | Venue loop, visitor splat, attractiveness | monthly | ≈ 0.05 |
| WP5 | History and advisors | monthly | ≈ 0.02 |
| WP6 | About 15 more terms in the desirability band, about 8 more in the land-value band | daily band | ≈ 0.45 |
| **Total** | | | **≈ 1.6 ms/day** (cap 3.0) |

Hard rules:
- Every scheduler step stays ≤ 3 ms. Lower `services.ts` `WORK_PER_STEP` to 150000.
- Every new step reports `cost()` so the headless `INFRA_DAY_BUDGET` stays honest. Raise it by at most 0.4.

---

## PHASE 0: Contract commit (lead, before fan-out)

This commit is behaviour-neutral: it compiles, every test passes, and no numbers change.

### `src/sim/CityState.ts`
- **BF flags:**
  - `Noisy: 1 << 14` (written by WP3)
  - `NeedsUnmet: 1 << 15` (written by WP1)
- **Optional `Building` fields** (written by WP1; undefined means "derive from profile"):
  - `kids?`, `teens?`, `yad?`, `srs?`: cohort shares 0..1. Adults = 1 − the sum.
  - `wf?`: workforce share of residents.
  - `edu?`: education attainment of the adult residents, 0..1.
- **New `Float32Array(C)` layers, zero-initialised:**
  - WP2: `eduElemCov`, `eduHighCov`, `eduCollegeCov`, `playCov`, `greenCov`, `shopAccess`, `stigma`, `prestige`, `campus`, and `accessCommute` (minutes; 0 = unknown).
  - WP3: `treeCover`, `soil`, `landfillFill`.
  - WP4: `visitors`.
- **`CityStats` additions:**
  ```ts
  cohorts: [number, number, number, number, number];   // kids 0-11, teens 12-17, young adults 18-24, adults 25-64, seniors 65+ (WP1)
  cohortsByWealth: number[];                           // 15 = wealth*5 + cohort (WP1)
  workforceRatio: number;                              // WP1
  needs: Record<NeedTier, NeedStat>;                   // WP2 writes
  avgNoise: number; avgAir: number; avgWaterPollution: number; sewageTreated: number; tapWater: number;  // WP3 (tapWater: 1 = clean)
  landfillFill: number; garbageRecycled: number;       // WP3
  tourists: number; attractiveness: number; attractByWealth: [number, number, number]; hotelRooms: number; // WP4
  export interface NeedStat { need: number; served: number; capacity: number; unreached: number; overcrowded: number }
  export type NeedTier = 'elementary' | 'high' | 'college' | 'health' | 'play' | 'green';
  ```
- **`HistorySeries` additions** (all `number[]`, written by WP5): `kids`, `teens`, `youngAdults`, `adults`, `seniors`, `unemployment`, `commute`, `noise`, `air`, `waterPoll`, `garbageLoad`, `powerMargin`, `waterMargin`, `tourists`, `attractiveness`, `enrolElem`, `enrolHigh`, `enrolCollege`, `healthServed`.
- **Factor the constructor defaults into `export function defaultStats(): CityStats` and `emptyHistory(): HistorySeries`.**

### `src/save/serialize.ts`
- `deserializeCity` currently replaces `stats` and `history` wholesale with the saved object, so new fields would be `undefined` on old saves. After restoring `data`:
  - `st.stats = { ...defaultStats(), ...saved }`
  - Pad every missing history key with zeros up to `h.t.length`.

### `src/sim/catalogTypes.ts`
```ts
export type ServiceTier = 'elementary' | 'high' | 'college' | 'library' | 'clinic' | 'hospital' | 'play' | 'green';
export type ReachMetric = 'walk' | 'drive' | 'euclid';
coverage?: { kind; radius; strength; capacity?; tier?: ServiceTier; metric?: ReachMetric };
stigma?: { amount: number; radius: number };    // NIMBY, 0..1 at source
prestige?: { amount: number; radius: number };  // YIMBY for wealthy / high-end C
campus?: { amount: number; radius: number };    // offices / high-tech
household?: 'house' | 'apartment' | 'tower';    // optional override (default derived by model/stage)
```

### `src/core/types.ts` `Overlay` enum
Append: `Parks = 17`, `Commute = 18`, `Shops = 19`, `Demographics = 20`, `Tourism = 21`, `Nimby = 22`, `Soil = 23`.

### New `src/sim/explain.ts`
```ts
export interface FactorTerm { id: string; label: string; value: number; detail?: string }
```

### Stub modules
Each stub has its final signature and returns legacy or neutral values:
- `economy/demographics.ts` (WP1)
- `infra/catchments.ts` (WP2)
- `economy/tourism.ts` (WP4)
- Stub exports `conditionBreakdown` (population.ts), `approvalBreakdown` (approval.ts), `desirabilityBreakdown` / `landValueBreakdown` / `growthLimits` (desirability/landValue/growth) returning `[]` or neutral values. Full signatures are in each WP below.

### `EconRuntime` and `EconData`
- **`EconRuntime`:**
  - `workforceRatio = WORKFORCE_RATIO`
  - `coarsePopW: Float32Array[3]` (residents per coarse block by wealth, blurred)
  - `coarseSkill: Float32Array` (population-weighted `b.edu` per block, blurred)
  - `coarseKids: Float32Array`
- **`EconData`** (defaulted with `??=` in `econData()`):
  - `tourists`, `attractiveness`, `attractByWealth: number[3]`
  - `approvalTerms: Record<string, number>`, `attractTerms: Record<string, number>`
  - `hotelShortage`, `migration: number[3]`

---

## A. WP1: Demographics core and needs (sim-core / economy)

**Files:**
- New: `src/sim/economy/demographics.ts`
- Modify:
  - `src/sim/economy/population.ts`
  - `src/save/serialize.ts` (add Float32 `BUILDING_FIELDS` columns `kids`, `teens`, `yad`, `srs`, `wf`, `edu`, and add them to `KNOWN_BUILDING_KEYS`)
  - `tuning.ts` §DEMOGRAPHICS
  - `infra/params.ts`: `WORKER_SHARE = WORKFORCE_RATIO` (import it; one source of truth)
  - `src/sim/infra/traffic.ts`: one line, after the perf agent lands: `this.oW[oN] = b.pop * workerShare(b)`.
- **EQ/HQ moves here.** WP2 deletes the EQ/HQ block in `services.finish`.

### Model
Cohort shares are stored per residential building and derived from four things:
1. The household form (profile).
2. The wealth tier.
3. A life-cycle curve over building age.
4. An amenity "pull". Needs met locally attract that cohort.

Shares drift slowly as people turn over. City totals are pop-weighted sums.

### Constants (tuning.ts §DEMOGRAPHICS)
```ts
COHORT_BASE = [0.13, 0.07, 0.10, 0.55, 0.15]                // reference mix (normalisation)
HOUSEHOLD_PROFILE = { house:[.18,.09,.06,.50,.17], apartment:[.12,.06,.14,.54,.14], tower:[.08,.04,.14,.58,.16] }
HOUSEHOLD_BY_MODEL: house = shack,cottage,townhouse_row,suburban,ranch,villa,mansion,rowhouses;
  apartment = walkup,tenement,apartment,courtyard,condo,projects; tower = highrise_slab,tower,twin_towers,luxury_tower,supertall;
  fallback by stage: ≤3 house, 4-5 apartment, ≥6 tower
COHORT_WEALTH_MUL = [[1.15,1,1.25,1,.85],[1,1,1,1,1],[.9,1.05,.6,1,1.3]]     // R$, R$$, R$$$
LIFE_DAMP = { house:1, apartment:.5, tower:.3 }             // A = building age in years, ss = smoothstep
LIFE(A): kids 1.35-.7ss(8,30)+.3ss(35,55); teens 1.1-.4ss(15,35)+.2ss(40,60); yad 1; adults 1;
         seniors .55+.95ss(10,35)-.3ss(40,60)        (each: 1 + (mul-1)*LIFE_DAMP[form])
PULL: kids,teens *(.7+.6*famScore); yad *(.7+.6*studScore); seniors *(.8+.4*senScore)*(.85+.3*min(1,HQ/150))
famScore  = clamp(.45*elem + .2*high + .2*play + .15*(1-crime) - .1*max(0,noise-.3))
studScore = clamp(.6*college + .2*transitCov + .2*shopAccess)
senScore  = clamp(.45*healthCov + .2*green + .2*shopAccess + .15*(1-noise))
COHORT_VAR = 0.15            // per-building variation: *(1 + VAR*(2*hash2(b.id,101+c)-1))
TURNOVER_PER_YEAR = 0.12     // shares move toward target at (TURNOVER + max(0,Δpop)/pop) per update
PART_ADULT = [.84,.86,.82]; COLLEGE_WILL = [.35,.55,.75]; CARLESS = [.45,.15,.03]
EDU_TAU_YEARS = 6; EQ_FLOOR = 20; EQ_SPAN_STOCK = 130
NEED_OK = 0.6; NEEDS_PENALTY_MAX = 0.12; NOISE_SLEEP = 0.2; WATER_BONUS_LOW = 0.03
```

### Per-building update
Runs in the existing `occupancy()` slice, where each growable is visited every `OCC_PERIOD = 4` days. Call `updateDemographics(st, b, def, i, OCC_PERIOD)`:
- **Target shares:** `t = normalize(PROFILE[form] ⊙ WEALTH_MUL[w] ⊙ LIFE(A) ⊙ PULL ⊙ VAR)`.
  - A new building is seeded with `t`.
  - Otherwise `share += (t − share) · min(1, (TURNOVER/360 + max(0, Δpop)/max(1, pop)) · dt)`.
  - The pull terms read `eduElemCov`, `eduHighCov`, `eduCollegeCov`, `playCov`, `greenCov`, `healthCov`, `shopAccess`, `transitCov`, `crime` and `noise` at cell `i`. Before WP2 lands these are zero, so PULL is clamped to a minimum of 0.7.
- **Workforce share:**
  `wf = adults·PART_ADULT[w]·(.94 + .06·min(1, HQ/100)) + yad·(.7·(1 − study) + .25·study) + teens·.06 + seniors·.10`,
  with `study = eduCollegeCov·COLLEGE_WILL[w]`.
  - Checks: reference mix → 0.54; house → 0.48; tower → 0.58.
- **Education stock:** `target = .12 + .35·elem + .33·high + .20·college`, and
  `edu += (target − edu)·dt/(360·EDU_TAU)`.
  - Newcomers blend toward the city mean: `edu = (edu·pop₀ + avgEdu·Δpop)/pop₁`.
  - A closed school therefore fades over years, not in one pass.

### Needs, distances and effects

| Cohort | Need | Layer (WP2) | Metric, reach | Capacity unit | When unmet |
|---|---|---|---|---|---|
| Kids 0–11 | Elementary school | `eduElemCov` | Walk, 20×1.3 road cells (~20 min); highways block | Pupils (1,500/school) | Family pull ↓, health −≤0.06, EQ ↓, approval, advisor |
| Kids / teens | Playground, sports | `playCov` | Walk 5–12 | Kids + 0.7·teens | Family pull ↓, youth crime ↑ (WP3) |
| Teens 12–17 | High school | `eduHighCov` | Drive (bus), 32×1.3 | Pupils (2,100) | EQ ↓, youth crime ↑, health −≤0.04 |
| Young adults 18–24 | University; library / research partial | `eduCollegeCov` | Drive 60×1.3; library walk 24 | Students (6,000; library 3,000 at 0.35) | Student pull ↓, EQ ↓, study share ↓ (more workers), office/high-tech skill ↓ |
| Adults 25–64 | Jobs within commute | traffic `workerAccess`, `accessCommute` | Minutes | Jobs | Existing job-access penalty, unemployment |
| Seniors 65+ | Clinic / hospital | `healthCov` | Clinic walk 16, hospital drive 36 | Patient-equivalents (senior × 3.5) | HQ ↓, senior pull ↓, health −≤0.05 |
| Seniors | Quiet (noise < 0.35), gardens, walkable shops | `noise`, `greenCov`, `shopAccess` | Walk ≤ 10 cells | Visitors / shop ratio | Senior pull ↓, sleep penalty |
| R$ and car-less (yad, seniors) | Transit | `transitCov` | Stops walk 5–14 | – | R$ health −≤0.03 |
| Families | Low crime, low noise | crime, noise | – | – | Desirability multipliers (WP6) |

- **`needsPenalty(st, b, i)`:**
  `min(NEEDS_PENALTY_MAX, Σ_k NEED_W[k][w]·(share_cohort(k)/base)·max(0, NEED_OK − access_k)/NEED_OK)`.

  | Need | R$ | R$$ | R$$$ |
  |---|---|---|---|
  | elementary | .03 | .05 | .06 |
  | high | .02 | .03 | .04 |
  | college | .005 | .01 | .015 |
  | health (seniors) | .03 | .04 | .05 |
  | play | .01 | .015 | .02 |
  | green | .005 | .01 | .02 |
  | shops | .02 | .015 | .01 |
  | transit (car-less) | .03 | .01 | 0 |
  | quiet (seniors; gap = max(0, noise − .35)/.4) | .01 | .015 | .02 |

- **Changes to `population.ts`:**
  - Health target −= `needsPenalty` + `NOISE_SLEEP·max(0, st.noise − .5)`.
  - Low-density buildings that are watered get +`WATER_BONUS_LOW`.
  - `needWater && !watered` now counts as unhappy (fixes the audit gap).
  - Set `BF.NeedsUnmet` when a kids, teens or seniors need has gap ≥ 0.5 affecting ≥ 3 people.
- **`aggregateDemographics`:** every `OCC_PERIOD` days inside the daily aggregate, using the same loop as `coarsePop`.
  - Writes `stats.cohorts`, `cohortsByWealth`, `workforce = Σ pop·wf`, `workforceRatio`.
  - Writes `rt.workforceRatio` (EMA 0.1, clamped [0.46, 0.62]), `rt.coarsePopW`, `rt.coarseSkill`, `rt.coarseKids`.
  - Emits `layerUpdated('demographics')` every 30 days.
- **EQ/HQ** (new `monthly` hook in the population system):
  - `EQ = clamp(EQ_FLOOR + EQ_SPAN_STOCK·popAvg(b.edu), 0, 150)`. Elementary + high school at full coverage gives ≈ 124; adding college gives 150.
  - `HQ_target = (30 + 120·patientAccess)·(1 − .35·air − .15·noise − .25·(1 − tapWater))`, with a lag of `HQ_TAU_YEARS` (4). `patientAccess` = pop-weighted `healthCov` weighted by patients (seniors × 3.5).
  - Gameplay effects of HQ: senior share (PULL), workforce participation, attractiveness (WP4), approval (WP4).
- **Households (optional, P2):** `stats.households` = cohort counts divided by household size (house 2.8, apartment 2.1, tower 1.8), split into families / singles / couples / retirees.

### Exports
```ts
type Cohort = 0|1|2|3|4; COHORT_LABELS; type HouseholdForm = 'house'|'apartment'|'tower';
householdForm(def?: BuildingDef, zone?: Zone): HouseholdForm
profileShares(form: HouseholdForm, wealth: number, out?: Float32Array): Float32Array   // normalised, used by WP6 for empty lots
cohortShares(b: Building, out?: Float32Array): Float32Array     // fields or profile fallback
workerShare(b: Building): number                                 // b.wf ?? WORKFORCE_RATIO
waterRequired(st: CityState, b: Building): boolean
familyScoreAt / seniorScoreAt / studentScoreAt(st: CityState, i: number): number
type NeedKind = 'elementary'|'high'|'college'|'health'|'play'|'green'|'shops'|'jobs'|'transit'|'quiet'
interface NeedReport { cohort: Cohort | -1; kind: NeedKind; label: string; people: number; access: number; met: boolean; providerId?: number }
needsOf(st, b): NeedReport[];  needsPenalty(st, b, i): number;  updateDemographics(st, b, def, i, dtDays): void
// population.ts
conditionBreakdown(st, b): { terms: FactorTerm[]; target: number; abandonInDays: number | null }
```
`demand.ts` (WP4) replaces `WORKFORCE_RATIO` with `rt.workforceRatio`.

### Cost
≤ 0.12 ms/day: about 60 flops × 5k buildings/day, plus aggregation every 4 days.

### Tests (`tests/sim/demographics.test.ts`, plus an extension of `tests/save/serialize.test.ts`)
- Profiles sum to 1.
- Workforce share at the reference mix is 0.55 ± 0.02.
- A new house has kids > 0.16. After 30 simulated years, seniors are higher than at year 0. With schools present, kids are higher than without.
- `stats.workforce` equals Σ pop × wf within 1%.
- EQ with full elementary + high coverage reaches ≥ 110 by year 20; with no schools EQ ≤ 45. Two years after closing all schools EQ is still ≥ 80% of before.
- The needs penalty is capped. A house without a school is penalised; a senior tower without a school is not.
- The six fields survive a save/load round trip.
- An old save without the fields loads and derives them.

### Balance
- Demand uses the *actual* workforce ratio, which keeps the jobs-to-workers equilibrium. Towers (0.58) mean more workers per resident in a metropolis. Houses (0.48) mean more residents per job early on.
- Penalty is capped at 0.12, and the pull floor is 0.7.
- EQ is recalibrated so the bot reaches ≥ 100 by year 30. The `CO3_FRAC` and `IHT_EQ_START` curves are unchanged.

---

## B. WP2: Catchments and proximity engine, NIMBY / YIMBY (sim-infra + catalog)

**Files:**
- New: `src/sim/infra/catchments.ts` (reach kernels, tier engine, access fields, public API) and `src/sim/infra/nimby.ts` (`stigma`, `prestige`, `campus` rasters).
- Modify:
  - `services.ts`: delegate education, health and park kinds to tiers; power gating; remove EQ/HQ; step list; `WORK_PER_STEP` 150k.
  - `infra/common.ts`: `DefInfo` gains `tier`, `metric`, `stigma*`, `prestige*`, `campus*`.
  - `catalog.ts`, which WP2 owns exclusively: tier, metric and seat capacities; stigma / prestige / campus fields; honest descriptions.
  - `params.ts` §CATCHMENTS.
- Start after the perf agent's `services.ts` changes merge.

### Tiers

| Def | Tier → layer | Metric | Radius | Strength | Capacity |
|---|---|---|---|---|---|
| `civ_elementary_school` | elementary → `eduElemCov` | walk | 20 | 1.0 | 1,500 pupils |
| `civ_high_school` | high → `eduHighCov` | drive | 32 | 1.0 | 2,100 |
| `civ_college` | college → `eduCollegeCov` | drive | 60 | 1.0 | 6,000 |
| `rw_research_center` | college | drive | 50 | 0.35 | 10,000 |
| `civ_library` | library → `eduCollegeCov` | walk | 24 | 0.35 | 3,000 |
| `civ_museum` | library | drive | 40 | 0.25 | 8,000 |
| `lm_observatory` | library | drive | 30 | 0.2 | 5,000 |
| `civ_clinic` | clinic → `healthCov` | walk | 16 | 0.85 | 8,000 patient-eq |
| `civ_hospital` | hospital | drive | 36 | 1.0 | 40,000 |
| `civ_medical_center` | hospital | drive | 56 | 1.0 | 120,000 |
| `park_playground` / `park_basketball` / `park_tennis` | play | walk | 6 | .9 / .8 / .6 | 700 / 500 / 600 |
| `park_soccer` / `park_baseball` | play | walk | 10 / 12 | .9 | 1,500 / 2,000 |
| `park_stadium` / `park_amusement` | play | drive | 24 | .6 / .7 | 80,000 |
| `park_small` / `park_plaza` / `park_garden` / `park_large` | green | walk | 6 / 7 / 8 / 14 | .7 / .6 / .9 / 1.0 | 2,500 / 4,000 / 5,000 / 20,000 |
| `park_marina` / `park_golf` | green | euclid | 10 / 16 | .7 / .8 | 6,000 / 4,000 |
| `park_zoo` | green | drive | 30 | .9 | 60,000 |
| Parks without a coverage def | green | walk | 3 + size | 0.7 | 2,000 |

Seat numbers equal the old residents-served capacity × the reference cohort share, so total capacity is balance-neutral.

### Demand rasters
Built in services prep from `cohortShares(b)` × `b.pop / area`, for R buildings with pop > 0 (~1 ms per pass):

| Tier | Need per cell |
|---|---|
| elementary | kids |
| high | teens |
| college / library | yad·COLLEGE_WILL[w] + 0.05·adults |
| health | pop·(.6k + .5t + .5y + .9a + 3.5s)/1.183 (normalised so the reference mix equals pop) |
| play | kids + .7·teens |
| green | pop·(.8 + 1.2·seniorShare)/.98 |

### Capacity sharing
Enhanced two-step floating catchment with competition weights. One reach search per facility per pass:
```
reach(f, metric, R·ROAD_RADIUS_FACTOR) → (i, w_fi)   falloff: full to 35 % R, smoothstep to 0 (existing falloff())
D_f   = Σ_i need(i)·w_fi / max(1, Wprev(i))           // each cell's demand split among the facilities reaching it (Wprev = Σ_f w from last pass; 1 on first pass)
op_f  = fundingFactor · ordinance(edu|health.effect) · (powered ? 1 : UNPOWERED_SERVICE_EFF=0.3) · (health & needs water & !watered ? 0.6 : 1)
r_f   = min(1, S_f·op_f / max(1, D_f));  util_f = D_f / (S_f·op_f)
cov(i) = 1 − (1 − cov(i))·(1 − min(1, w_fi·r_f·strength_f));  Wnext(i) += w_fi
stats.needs[tier] = { need Σneed, served Σneed·cov, capacity ΣS·op, unreached Σneed where Wnext = 0, overcrowded #(util > 1.15) }
```
- Seats are conserved: served ≤ capacity. Two adjacent schools each count half the children (no double counting).
- Keep per facility `utilById`, `demandById`, `servedById` and `tierById` (Float32/Int8 by building id).
- **Legacy layers,** for untouched consumers:
  - `parkCov = 1 − (1 − play)(1 − green)`
  - `eduCov = clamp(.45·elem + .35·high + .20·college)` (semantics change documented; it no longer saturates)
  - `healthCov` keeps its meaning.
- **Power gating** applies to every service kind, including police and fire (fixes "unpowered school gives 1.00").

### Reach kernels
`reachCells(st, bx, bz, bw, bd, radius, metric, scratch): n` fills `scratch.idx` / `scratch.w`.
- **walk:** Dial bucket queue over road cells with integer quarter-cell costs `WALK_COST = [0, 4, 4, 5, 4, 0, 0]` indexed by Network (Street, Road, Avenue 5, OneWay; Highway and Rail impassable, so a highway is a pedestrian barrier). Bridges and tunnels pass.
- **drive:** `DRIVE_COST = [0, 5, 4, 3, 4, 2, 0]` plus `RAMP_COST = 2` on highway ↔ non-highway transitions.
- **euclid:** the existing disk.
- Seeds are road cells on the footprint perimeter. Splat 3×3 with neighbours at `fall[cost + 4]`. Near field of 3 cells, as today.
- The circular bucket queue (size 8) makes the search O(n).

### Access fields
Own scheduler steps in the services pass; recomputed every `ACCESS_PERIOD = 30` days or on `networkChanged`.
- **`accessCommute`** (minutes, every cell). Fixes the "commute only on R footprints" bug.
  - Multi-source Dijkstra (reuse `infra/heap.ts` MinHeap) over road cells with edge weight `NET_TIME[n]` minutes.
  - Seeds: frontage road cells of R buildings (key = `traffic.commuteOf(id)`, or `st.commute` on the footprint), and of job sites with ≥ 20 slots (key = `CAR_OVERHEAD + 2`).
  - Land cells take the minimum over adjacent road cells + 0.3, then 3 chamfer sweeps (+0.3 per cell).
  - Unreached cells get `1.5 × avgCommute`. R footprints keep their own `st.commute`.
  - Offices next to offices therefore score short commutes, which gives an agglomeration effect.
- **`shopAccess`** (0..1).
  - One drive-metric Dial from the frontage of CS buildings (cap 40 cells): `score = 1 − smoothstep(6, 40, cost/4)`.
  - Supply ratio `ratio = min(1, blurred CS job capacity per coarse block × RES_PER_CS_JOB (9) / (blurred coarsePop + 1))`.
  - `shopAccess = score·(.35 + .65·ratio)`.

### NIMBY / YIMBY rasters (`nimby.ts`)
Rebuilt in one step per services pass (~2 ms). Splat with the same 35%-plateau smoothstep falloff, sum, then saturate with `1 − exp(−x)`. Only functional buildings count (not burnt or abandoned), which fixes burnt buildings still counting.

**Stigma (amount, radius):**

| Source | Stigma |
|---|---|
| Coal | .55 r12 |
| Oil | .45 r10 |
| Gas | .25 r8 |
| Nuclear | .5 r14 |
| Wind | .05 r3 |
| Solar | .03 r2 |
| Hydro | .05 r4 |
| Incinerator | .4 r10 |
| Recycling | .15 r5 |
| Water treatment | .15 r5 |
| Desalination | .1 r4 |
| Landfill (per 2×2 block) | .35 r6 × (.4 + .6·use) |
| Toxic dump | .95 r22 |
| Jail | .55 r10 |
| Military base | .35 r12 |
| Missile range | .45 r16 |
| Airport small / large | .25 r12 / .3 r16 |
| Seaport | .2 r10 |
| Freight station | .12 r6 |
| Bus depot | .08 r3 |
| Cemetery | .06 r3 |
| Casino | .15 r6 |
| I-D growables | .12 r4 |
| I-M growables | .05 r3 |
| Highway cells | .18 r3 (bridge / elevated .25; tunnel 0) |
| Rail cells | .06 r2 |

Power plants are additionally scaled by `(.5 + .5·plantLoad)` when WP3's `plantLoad` is available.

**Prestige:**

| Source | Prestige |
|---|---|
| Landmarks | .25–.6 (lighthouse .25; clock / obelisk .3; arch / observatory / ferris wheel .35; cathedral / castle / pyramid .45; spire .5; opera / twin spires .6; radius = LV splat radius) |
| City hall | .35 r14 |
| Mayor's house | .3 r8 |
| Courthouse | .2 r8 |
| Museum | .3 r12 |
| Golf | .5 r16 |
| Marina | .35 r10 |
| Garden | .2 r8 |
| Medical center | .15 r10 |
| Convention center | .2 r10 |
| CS$$$ / CO$$$ at stage ≥ 6 | .05 r4 |

**Campus:** college 1.0 r18; research center 1.0 r24; medical center .5 r14; observatory .3 r10; library .2 r6.

### Services step list
prep (need rasters, station lists by tier) → police → fire → elementary → high → college + library → health → play → green → transit → NIMBY → access commute → access shops → finish A (footprint max for layers 1–7) → finish B (layers 8–14, legacy combos, `stats.needs`, `unservedClusters` from coarse 8×8 blocks: Σ need·(1 − cov) where cov < 0.3, top 5).

Emits `layerUpdated('services')` and then `layerUpdated('catchments')`.

### Exports
```ts
tierLayer(st: CityState, tier: NeedTier): Float32Array
interface FacilityLoad { tier: ServiceTier; needTier: NeedTier; capacity: number; demand: number; utilization: number; served: number; operating: number; powered: boolean; radius: number; metric: ReachMetric }
facilityLoad(sim: Simulation, buildingId: number): FacilityLoad | null
unservedClusters(sim: Simulation, tier: NeedTier, max = 5): { x: number; z: number; people: number }[]
reachCells(st, bx, bz, bw, bd, radius, metric, scratch): number
```

### Cost
+7.5 ms per 15-day pass and +5 ms per 30 days, about **0.65 ms/day** (baseline pass measured at 22.7 ms). Every step ≤ 3 ms.

### Tests (`tests/infra/catchments.test.ts`)
- **Conservation:** served ≤ 1.05 × capacity for random layouts.
- **Capacity:** 1 school (1,500 seats) + 3,000 kids gives ≈ 0.5 coverage in the plateau. Two overlapping schools give ≈ 1.0, and served ≤ 3,000.
- **Tiers are separate:** a university alone gives `eduElemCov = 0`.
- **Walk metric:** a highway or an unbridged river blocks a playground or elementary catchment.
- **Drive metric:** an avenue reaches farther than streets.
- **`accessCommute`** is > 0 and increases with distance for empty lots and C/I cells.
- **Stigma:** coal stigma is 0 at its radius; a burnt plant contributes 0.
- **`facilityLoad`:** utilization > 1 when overcrowded.
- **Power:** an unpowered school operates at 0.3.
- **Perf:** on `stressCity(256)` with 850 stations, the pass ≤ 35 ms total and the maximum step ≤ 3 ms.

### Balance
- Seats are neutral at the reference mix. Downtown towers need fewer seats; suburbs need more.
- Coverage no longer saturates (the old home-average eduCov was 0.97), so the average desirability contribution drops. WP6 re-biases.
- Parks now have capacity, so a 1M city needs large parks. The bot does this (WP6).

---

## C and E. WP3: Environment and utilities completeness (sim-infra)

**Files:** `pollution.ts` (also fix its stale header), `utilities.ts`, `crime.ts`, `blur.ts` if needed, `economy/ordinances.ts` (WP3 owns new ordinances), `params.ts` §POLLUTION / §UTILITIES / §CRIME, new `infra/wind.ts`, new `infra/terrainMasks.ts` (`seaMask`, shore cells; also used by WP4). Start after the perf agent lands.

### C1. Smoke (air) per source
- **Plant activity follows load.** Power plants use `act = .25 + .75·plantLoad`. `UtilitiesSystem.plantLoad(id)` = component demand / supply clamped to 1, stored per plant id.
- **Incinerator** burns `min(12000·fund·power, remaining garbage)`. Its air activity = `.2 + .8·burnShare`, and its power output = `60·burnShare` (utilities reads the previous pass).
- **Residential heating:** air per resident `0.00015 × [1.3, 1, .8][w] × (.6 + .8·winter(month))`.
- **Commercial:** 0.0002 air per CS job.
- **Construction** (`BF.Constructing`): air .1 r2 and noise .25 r3.
- **Tunnels** (netFlags bit 1): traffic air × 0.3, noise × 0.05. Bridges: noise × 1.25.
- **Ordinance `clean_power_act`** (key `pollution.air.power` 0.6): cost §0.004 per resident, plant upkeep +15%.

### C2. Wind
`windVector(st) → { x, z, deg, strength }`:
- Prevailing heading θ₀ = `hash(seed)`.
- Daily heading θ = θ₀ + 0.6·sin(2π·day/360) + 0.25·sin(0.21·day), about ±40°.
- `WIND_DRIFT_PREVAIL = 2.5` cells × strength (0.7–1.0).
- Plume: average of two shifted copies (0.5·d and 1·d).

This makes "keep it downwind" meaningful. WP5 uses the vector for render smoke and a wind arrow in the legend.

### C3. Water
- **Bank coupling:** after diffusion, land cells within 2 cells take `max(ground, .6 × water-body pollution)`, using the precomputed `waterNb` list.
- **Pumps** read `max(ground, adjacent water body)`. Output × `(1 − .6·p)`, with the existing 0.35 × loss when a treatment plant exists.
- **`seaMask`:** water components touching the map edge with size > 2% of cells.
  - Sea pumps get no +50% bonus and output × 0.6 (brackish).
  - A desalination plant not adjacent to sea produces × 0.2.
- **`stats.sewageTreated`** = the existing treated share (now exposed).
- **`stats.tapWater`** = `1 − supply-weighted pump pollution × (1 − .7·treated)`. WP1 uses it for HQ; WP4 for approval.
- **Ordinance `sewage_mandate`** (`pollution.sewage` 0.6, §0.003 per resident).
- Optional P2: downhill-biased diffusion on river cells using heights.

### C4. Noise
- **Per trip by network:** `NOISE_PER_TRIP_NET = [0, .00022, .0003, .00034, .0003, .00045, 0]` (the highway trip is now the loudest).
- **Base intensity independent of volume:** `NET_BASE_NOISE = [0, 0, .01, .03, .02, .12, .05 (rail)]`, via `intensityToSource`.
- **Congestion:** noise × `(1 − .25·clamp(cong − 1, 0, 1))`.
- **Level crossings** (netFlags 0x20): +0.1.
- **Freight trains:** +0.12 on rail cells used by freight routes, if traffic exposes `freightRailCells()` (P2; coordinate with the traffic owner).
- **Nightlife:** CS$$ / CS$$$ in ComHigh, noise .08 r2 × activity.
- **Buffers,** applied after saturation:
  - `treeCover` = blurred `st.trees / 4` (radius 2), a published layer.
  - `noise ×= 1 − .25·treeCover − .15·parkCell`.
  - `air ×= 1 − .12·treeCover`.
- **Flags and stats:** `BF.Noisy` on R buildings when noise > `NOISY_THRESHOLD = 0.5`; `stats.avgNoise` (resident-weighted); `stats.avgAir` and `stats.avgWaterPollution` separately.
- **`BF.Polluted`** is set only on R and C buildings (not factories or plants).
- **Ordinance `quiet_zones`** (`pollution.noise` 0.85 for C/I and construction, `pollution.noise.traffic` 0.9).

### C5. Garbage
- **Truck range:** a building is collected only if it is road-reachable from a facility within `GARBAGE_TRUCK_RANGE = 90` road cells. The distance-limited BFS always runs (~1.9 ms). This fixes road-isolated districts being served.
- **Build-up:** `g += 0.1·dtMonths·(.6 + .4·min(1, p/area/.3))`, so any building flags within 3–6 months (fixes the "cottage takes over a year" gap).
- **Landfill stock:** `landfillFill[i] += dumped_t_cell / LANDFILL_CELL_STOCK` (36,000 t, about 10 years at 300 t/month). Full cells give no capacity. `stats.landfillFill` = mean over landfill cells.
- **Landfill emission:** `LF_INT·(.25 + .75·use)/sqrt(max(1, regionCells/16))`. This fixes the 10×10 empty landfill being worse than a coal plant.
- **Recycling diverts** `min(cap·fund·power, .35·produced)` before collection → `stats.garbageRecycled`. WP4 adds §0.5/t income.
- **Facilities** need power (capacity × 0.3 when unpowered) and a road on the perimeter.
- **Uncollected piles** emit smell (air .15 × level, r1) and raise crime +0.08 × level.
- `st.garbage` now holds only uncollected piles; landfill fill level is in `landfillFill`.

### C6. Trees
`treeCover` feeds the absorption above. WP6 adds land-value and desirability terms. This makes the tree tool text and the two advisor lines true.

### C7. Soil / brownfields (P2)
- `soil += .015·dtMonths·max(0, ground source)` (industry, landfill, toxic dump).
- Decay `soil ×= (1 − .002·dtMonths)` (half-life ~29 years); ordinance `brownfield_cleanup` (`soil.decay` × 5).
- Soil feeds groundwater with +0.3 × soil.

### E. Utilities gaps
- **Thermal plants** (category power with `waterUse > 0`): output × 0.5 when unwatered.
- **Wind turbine:** output × `(.6 + .8·smoothstep(10, 60, height − local mean))`.
- **Solar:** × season (.8–1.15) × climate (desert 1.2, alpine .85).
- **Brownout priority:** critical loads (health, pumps, treatment, police, fire) are served first, then BFS order.
- **Water-shortage news** with a 30-day cooldown.
- **Parks** without `powerUse` draw 0 MW (fixes the 0.2 MW fallback).
- **Out of scope** (task #20 dispatch owner): `fire.ts` should read `BF.Watered` for extinguish speed and `st.garbage` for ignition risk.

### Crime (`crime.ts`)
- **Youth component:** `c += min(.15, .08·(teens/.07)·(1 − eduHighCov)·(1 − .6·playCov))`. Teens come from `cohortShares`.
- **Youth curfew** changes to key `crime.youth` 0.5 (it was city-wide `crime.rate` 0.9).
- **Local unemployment:** for R, `.5·(.5·cityUnemp + .5·(1 − workerAccess_b))`.
- **Spillover table** `CRIME_SPILL`: casino .2 r8, jail .06 r6, stadium .05 r8; CS$$$ in ComHigh +.02.

### Exports
```ts
UtilitiesSystem.plantLoad(id: number): number;              // -1 unknown
windVector(st: CityState): { x: number; z: number; deg: number; strength: number }
PollutionSystem.garbageInfo(id): { producedT: number; collected: boolean; level: number; reason?: 'capacity' | 'range' } | null
PollutionSystem.landfillInfo(x, z): { cells: number; fill: number; capacityT: number; usedT: number } | null
PollutionSystem.incineratorShare(id): number
seaMask(st): Uint8Array; shoreCells(st): Int32Array          // terrainMasks.ts, cached per terrainChanged
```

### Cost
About +3.5 ms per 12-day pass (baseline 9.7 ms), roughly **0.3 ms/day**.

### Tests (`tests/infra/environment2.test.ts`)
- A coal plant at 0 load emits ≤ 35% of its full-load air.
- Incinerator MW is proportional to tons burned.
- Averaged over a year, the downwind cell at 12 cells has ≥ 1.5× the upwind value.
- Tree density 4 reduces noise and air by ≥ 10%.
- An empty highway has adjacent noise ≥ 0.15; a highway trip is louder than a street trip; tunnel noise ≈ 0.
- A road-isolated district flags `NoGarbage` within 90 days despite surplus capacity.
- A landfill fills, and capacity drops when full. A 10×10 landfill at 1% use gives next-door air ≤ 0.5.
- A polluted river raises bank land and cuts pump output. Desalination away from the sea ≤ 20%.
- The noise ordinance reduces noise. The youth component falls when a high school opens.

### Balance
- Highway noise rises. WP6 keeps the R noise weights and the bot plants tree buffers.
- Truck range and landfill fill force landfill planning. The bot expands landfills by fill level.
- Civic power gating: the bot always powers civic buildings.

---

## D. WP4: Attraction, tourism, migration and approval (sim-core / economy)

**Files:**
- New: `src/sim/economy/tourism.ts` (the `ATTRACTIONS` and `HOTEL_ROOMS_PER_JOB` tables live here, so no catalog edits are needed).
- Modify: `demand.ts`, `approval.ts`, `budget.ts`, `systems/economy.ts` (order: landValue, desirability, population, **tourism**, demand, growth, budget, …), `runtime.ts` (beyond Phase 0 if needed), `tuning.ts` §TOURISM / §MIGRATION / §APPROVAL.

### Attraction table
`ATTRACTIONS` maps def id → `{ kind, draw (visitors/day at A = 60), capacity (visitors/day) }`:

| Venue | Draw / capacity |
|---|---|
| Lighthouse | 400 / 1,500 |
| Clock tower | 600 / 2,500 |
| Obelisk | 700 / 3,000 |
| Arch | 900 / 4,000 |
| Observatory | 700 / 3,000 |
| Cathedral | 1,500 / 6,000 |
| Castle | 1,800 / 7,000 |
| Pyramid | 2,000 / 8,000 |
| Ferris wheel | 2,500 / 9,000 |
| Opera | 2,500 / 8,000 |
| Spire | 3,500 / 12,000 |
| Twin spires | 5,000 / 20,000 |
| Museum | 900 / 4,000 |
| Convention center | 2,500 / 6,000 |
| City hall | 200 / 1,000 |
| Zoo | 3,000 / 10,000 |
| Stadium | 5,000 / 40,000 |
| Amusement park | 4,500 / 15,000 |
| Golf | 400 / 1,200 |
| Marina | 500 / 2,000 |
| Large park | 250 / 2,000 |
| Garden | 150 / 800 |
| Plaza | 100 / 800 |
| Casino | 3,000 / 10,000 |
| Airport small / large | 1,200 / 5,000 and 6,000 / 30,000 |
| Seaport | 300 / 2,000 |
| Train station | 150 / 1,000 |
| Ferry | 150 / 800 |

- **Beaches** are natural attractions. Shore cells qualify when they are land, border a water component of ≥ 200 cells, have slope < 3, are within 6 cells of a road, and have water pollution < 0.25. Each gives `2·(1 − 2.5·wp)`, capped at 6,000.
- **Historic buildings:** 3 × stage visitors each, capped at 3,000.

### Visits, hotels, tourism jobs and income
- **Visits:** `V_f = min(cap_f, draw_f·(A/60)^1.3·access_f·op_f·sizeF)`.
  - `access_f = min(1.2, .35 + .65·rt.coarseFreight[block] + .1·transitCov)`
  - `op_f = functional·(powered or no powerUse)·min(1.1, funding)`
  - `sizeF = .4 + .6·smoothstep(0, 150k, pop)`
- **Hotels:** rooms = Σ jobs of `com_motel`, `com_hotel` and `com_hotel_tower` × 1.5. Overnight visitors = `T·(.3 + .25·[large airport] + .1·[small airport])`. When overnight > rooms: `T_eff = T − .8·(overnight − rooms)` and `data.hotelShortage` is set (WP6 weights hotel defs in growth).
- **Tourism jobs:** `data.tourism = T_eff·CS_JOBS_PER_VISITOR (0.35)`. This fixes the dead field. The old tourism = 0.05 × C-relief is replaced; the `add.tourism` ordinance is kept. Split CS$ / CS$$ / CS$$$ 25 / 45 / 30.
- **Venue income:** `income·(.35 + .65·V/cap)·(A/60)^.3`.
- **New income lines:** `tourism` = `T_eff·0.25·(avg CS tax / 9)` §/month; recycling = §0.5/t.
- **`st.visitors`:** `1 − exp(−Σ splat(V_f/1000, r = 6 + 4·sqrt(V_f/1000)))`, computed monthly.
- **Cap relief** from `demandContext` now also requires power and funding.

### Attractiveness (0..100)
```
S_culture = 1 − exp(−Σ landmark/culture visits / 4000)
S_parks   = resident parkCov
S_safety  = 1 − 1.6·avgCrime
S_clean   = 1 − 1.4·avgPollution
S_quiet   = 1 − 1.2·avgNoise
S_services = need-weighted (elementary + high + health served/need)
S_jobs    = 1 − 2.5·max(0, unemp − .05)
S_connect = min(1, .1·connections + .3·large airport + .1·small airport + .1·train station + .1·seaport)
A = 100·(.18c + .14p + .14s + .14cl + .10q + .10sv + .10j + .10cn)
```
Per-wealth weight vectors:
- R$: jobs .25, services .2, culture .08.
- R$$$: culture/prestige .25, safety .2, clean .2.

Results go to `stats.attractiveness`, `attractByWealth`, and `data.attractTerms`.

### Migration
- `m_w = clamp(1 + .25·(A_w − 55)/45, .88, 1.12)` multiplies the **whole** R_w target (not just `R_BASE`).
- R$$ / R$$$ × `(1 − .08·(kids + teens unreached)/(kids + teens))`.
- Retirees: +250·(.5 + HQ/150)·(.5 + green) added to the base of R$$ / R$$$.
- Students: +0.5·Σ college seats, split 60 / 40 over R$ / R$$.
- These compose multiplicatively with the region effects (`systemData.region*`, task #22) and do not replace them.

### Approval: new resident-weighted terms (monthly)

| Term | Formula |
|---|---|
| Noise | −12·resNoise |
| Tap water | −12·(1 − tapWater) |
| Garbage | −20·share of homes with NoGarbage |
| Outages | −25·unpowered share − 12·share unwatered while needing water |
| Unmet needs | −12·(kids + teens unreached)/(kids + teens) − 8·seniors health-unmet share |
| Attractions | +min(4, tourists/15,000) |
| HQ | ±4·(hq − 80)/70 |
| Fires | −1.5 × `firesThisMonth` (cap −6) |
| Active disaster | −5 |

The base is re-fitted from 58 to about 62 so the bot stays within ±3 points of its baseline. Terms are stored in `data.approvalTerms`.

### Exports
```ts
interface AttractionDef { kind: 'landmark'|'culture'|'sport'|'entertainment'|'nature'|'business'|'transport'; draw: number; capacity: number }
ATTRACTIONS; tourismSystem(rt: EconRuntime): SimSystem
venueVisits(st, id): { visits: number; capacity: number } | null
attractivenessBreakdown(st): FactorTerm[];  approvalBreakdown(st): FactorTerm[]
tourismTrips(st): { buildingId: number; tripsPerDay: number }[]   // P2 hook for a traffic VISIT phase (traffic owner)
```

### Cost
About 1.5 ms per month (shore cells cached), under **0.05 ms/day**.

### Tests (`tests/sim/tourism.test.ts`, `tests/sim/approval.test.ts`)
- `econData.tourism` > 0 with a landmark.
- Visits are capped by capacity; an unpowered or burnt venue gets 0.
- A hotel shortage caps visitors.
- A synthetic 200k city with an airport, spires, convention center, stadium, zoo and 5 landmarks gets new tourism jobs within 0.7–1.3× the old formula.
- A rises with parks and landmarks, and falls with crime and pollution.
- The R target is monotone in A and bounded at ±12%.
- The approval breakdown sums to `approvalRaw` within 0.01; noise, garbage and outage terms are negative.
- Venue income scales with visits.

---

## F. WP5: Player feedback (render-world, ui-game, plus advisors and history)

**Files:** `src/sim/infra/overlays.ts`, `src/render/world/overlays.ts`, `src/render/world/TerrainRenderer.ts` (variant plumbing), `src/render/city/effects/Effects.ts` (`uWind` from `windVector`), `src/game/context.ts` (`overlayVariant`), `src/game/CityScene.ts` (register the panel), `src/game/toolCatalog.ts` (truthful tree text), `src/game/tools/QueryTool.ts`, `src/game/tools/PlopTool.ts`, `src/ui/**` (overlays.ts, InfoPanel, DataViewsPanel, GraphsPanel, StatsPanel, AdvisorsPanel, TopBar, Toolbar tooltip, new `panels/DemographicsPanel.ts`, `format.ts` with `signedPct`), `src/sim/economy/advisors.ts`, `src/sim/economy/history.ts`.

### Overlays
Signature becomes `overlayLayer(st, o, variant = -1)`, with `export const OVERLAY_VARIANTS: Partial<Record<Overlay, string[]>>`.

| Overlay | Variants / data |
|---|---|
| Desirability | Each of the 12 DevTypes (default R$$), plus "Families" / "Seniors" / "Students" appeal from `familyScoreAt` etc. The label shows the variant. Fixes the render-average vs hover-R$$ mismatch; the dead averaging code is removed. |
| Education | All (`eduCov`), Elementary, High school, University |
| Parks | All, Play & sports, Gardens & parks |
| Commute | `accessCommute`, scale 3 × avg, "bad" palette |
| Shops | `shopAccess` |
| Demographics | Children / teens / young adults / seniors / workforce share / wealth (raster built on demand from buildings) |
| Tourism | `visitors` |
| Nimby | Diverging: `prestige − stigma` |
| Soil | `soil` |
| Garbage | Uncollected piles / landfill fill |
| Air | Wind arrow in the legend; threshold labels (e.g. "Polluted ≥ 45%") |

- `computeOverlayValues(state, o, out, variant)` supports the new layers.
- `OVERLAYS[o].layers` include `catchments`, `tourism` and `demographics`.
- PlopTool auto-overlays: parks → Parks; schools → Education with the tier variant; garbage facilities → Garbage; air emitters → Air; noise emitters → Noise. Radius ghost preview is P2.

### Inspector (`InfoPanel.ts`)
- **Building "Why?" section** (collapsible):
  - Desirability factor bars: top 8 by |value| from `desirabilityBreakdown`, with a note when the value was clamped.
  - Condition breakdown from `conditionBreakdown`, including "Abandons in N days".
  - Growth limits from `growthLimits` (desirability / population / zone stage).
- **Residents:** needs list from `needsOf`, e.g. "Children 34: Elementary ✓ Oak Elementary (92% full)" or "Teens 12: ✗ no high school in reach"; a 5-bar mini pyramid.
- **New environment rows:** noise, water pollution, garbage level and why (from `garbageInfo`: collected / capacity / out of truck range), play and green, school tiers.
- **Civic buildings:** `facilityLoad` (capacity, demand, utilization bar, served, unpowered warning); venue visits and income; plant load; landfill fill.
- **Lots:** all coverages, noise and garbage.
- The "No water" chip is shown only when `waterRequired(st, b)`.

### Demographics panel
- **KPIs:** population, workforce (ratio), EQ, HQ, attractiveness.
- **Age pyramid:** 5 bars stacked by wealth (from `cohortsByWealth`).
- **Enrolment per tier:** need vs capacity vs served, and unreached with a "Show me" button that focuses `unservedClusters[0]`.
- **Health:** patients vs beds, seniors unreached.
- **Recreation:** play and green served.
- **Trend sparklines** from history.
- **Tourism:** tourists, hotel rooms, top venues (visits / capacity).

### Graphs, stats and top bar
- **New graphs:** Demographics (stacked), Enrolment %, Utilities margins and garbage load, Environment (air / water / noise as separate series), Tourism and attractiveness, Jobs (unemployment, commute).
- **Bug fix:** the RCI graph formatter uses `signedPct` (±×100). `compact()` currently shows 0 / ±1 only.
- **StatsPanel:** split pollution into air and water; add noise, tourism, attractiveness and workforce.
- **TopBar:** approval tooltip with `approvalBreakdown`.
- **Toolbar tooltip:** tier and capacity units, stigma / prestige, attraction draw, `powerUse` / `waterUse`.

### Advisors (`advisors.ts`)
Keep the existing cooldown and streak scheme. Locations come from `unservedClusters`.

| Id | Condition | Message |
|---|---|---|
| `noElementary` | kids unreached ≥ max(300, 5%) | "{n} children have no elementary school within walking distance — build one near here." |
| `schoolOvercrowded` | any school utilization ≥ 1.3 | "{name} is at {u}% capacity." |
| `noHigh` | teens unreached | |
| `noCollege` | college unlocked and young adults unserved | |
| `seniorsHealth` | seniors unreached ≥ 500 | |
| `hospitalOvercrowded` | | |
| `playgrounds` | ≥ 30% of kids have play < 0.2 | |
| `noise` | ≥ 10% of homes Noisy | Plant trees / reroute |
| `sewage` | treated < 0.5 and pop > 20k | |
| `tapWater` | tapWater < 0.7 | |
| `landfillFull` | fill > 0.8 | |
| `garbageRange` | | |
| `hotelsFull` | | |
| Tourism good news | | |
| `lowAttractiveness` | | |

Also: remove or keep the "plant trees" advice now that trees work.

### History (`history.ts`)
Record the new series. `ensureSeries(h)` pads old saves.

### Cost
Sim ≈ 0.02 ms/day. Overlay variants cost O(C) (~0.3 ms) when refreshed.

### Tests (pure functions only)
- `tests/infra/overlays.test.ts`: variant data and labels.
- `tests/sim/history.test.ts`: padding.
- `tests/sim/advisors.test.ts`: `noElementary` / `schoolOvercrowded` / `sewage` fire on synthetic `stats.needs` with coordinates, and respect cooldowns.
- `signedPct` unit test.

---

## WP6: Desirability, land value and growth integration, balance bot, end-to-end (sim-core / tools)

**Files:** `desirability.ts`, `landValue.ts`, `growth.ts`, `tuning.ts` §DESIRABILITY / §LAND VALUE / §GROWTH, `tools/simbot.ts`, `tests/sim/desirability.test.ts`, `tests/sim/balance.test.ts` (slow; tagged), `tests/sim/fixtures/balance-baseline.json`.

### New desirability terms (NT 17 → 32)
| Index | Term | Source |
|---|---|---|
| 17 | ELEM | `eduElemCov` |
| 18 | HIGH | `eduHighCov` |
| 19 | COLLEGE | `eduCollegeCov` |
| 20 | PLAY | `playCov` |
| 21 | GREEN | `greenCov` |
| 22 | SHOPS | `shopAccess` |
| 23 | STIGMA | `stigma` |
| 24 | PRESTIGE | `prestige` |
| 25 | CAMPUS | `campus` |
| 26 | VISITORS | `visitors` |
| 27 | SKILL | `rt.coarseSkill` |
| 28 | TREES | `treeCover` |
| 29 | SOIL | `soil` |
| 30 | RENT | smoothstep(.45, .85, LV) |
| 31 | WEALTHY | `coarseWealth` |

- **Commute term** reads `accessCommute` and is rescaled to the city:
  - `g = clamp(.8·avgCommute, 4, 12)`, `bad = clamp(3·avgCommute, g + 10, 80)`, `T = .5 − smoothstep(g, bad, cm)`.
  - This fixes saturation: every home currently scores 0.5 at a 7-minute average.
- **CS `popNear`** is wealth-matched: `Σ_r coarsePopW[r]·CUSTOMER_MIX[r][tier] / POP_NEAR_FULL_W`, with `POP_NEAR_FULL_W = [2600, 2600, 1600]`.
- **Weights:** R edu / park move to the tier terms. CO / I-HT edu → SKILL + CAMPUS. Totals are kept at the reference mix.

| DevType | New weights |
|---|---|
| R$ | elem .06, high .04, college .03, play .05, green .07, shops .12, stigma −.15, trees .04, soil −.2, rent −.5 |
| R$$ | elem .12, high .09, college .04, play .09, green .15, shops .10, stigma −.3, prestige .05, trees .06, soil −.3, rent −.1, wealthy .03 |
| R$$$ | elem .14, high .12, college .05, play .08, green .28, shops .06, stigma −.5, prestige .2, trees .08, soil −.4, wealthy .15 |
| CS$ / CS$$ / CS$$$ | visitors .08 / .2 / .25; stigma −.05 / −.1 / −.2; prestige 0 / .03 / .15; CS$ rent −.2; CS$$$ wealthy .1 |
| CO$$ / CO$$$ | skill .15 / .25, campus .08 / .12, stigma −.1 / −.2, prestige .05 / .15 |
| I-Ag | soil −.5 |
| I-D | rent −.15 |
| I-M | skill .05 |
| I-HT | skill .25, campus .25, stigma −.2, trees .03, soil −.2 |

- **Cohort weighting,** static and zero runtime cost. At module init, precompute `WTZ[density][dev][term] = w·Σ_c s_c·M[c][t] / Σ_c base_c·M[c][t]`, where `s` = `profileShares(form(density), wealth(dev))` and density 1/2/3 maps to house / apartment / tower. The band selects by zone density.

  | Term | kids | teens | yad | adults | seniors |
  |---|---|---|---|---|---|
  | ELEM | 6 | 1 | .2 | .6 | .1 |
  | HIGH | 1.5 | 6 | .3 | .6 | .1 |
  | COLLEGE | .3 | 1.5 | 6 | .5 | .2 |
  | PLAY | 5 | 3 | .5 | .6 | .4 |
  | GREEN | 1 | 1 | .8 | 1 | 2.5 |
  | HEALTH | 1.2 | .8 | .6 | .8 | 3.5 |
  | NOISE | 1.2 | .8 | .5 | 1 | 2.2 |
  | SHOPS | .8 | .8 | 1.5 | 1 | 2 |
  | TRANSIT | .3 | 1.5 | 3 | .8 | 1.8 |
  | CRIME | 1.5 | 1.2 | .8 | 1 | 1.2 |

  Example: a low-density R$$ lot weights ELEM 1.23× base and a tower lot 0.75×.

### Land value
Recompute v as:
```
v = base + view + waterfront_i·(1 − .8·waterPollution_i) + lvEffectAt (functional-gated)
  + .025 police + .02 fire + .03 health + .03 elem + .02 high + .015 college     (sum .14, as before)
  + .04 play + .08 green                                                          (sum .12, as before)
  + .07 transit                                                                   (was .04; transit-oriented development)
  + .14·(commuteScore − .5)  (accessCommute, rescaled)
  + .10 wealth + .10 prestige − .10 stigma + .04 treeCover − .20 soil + .05 historic
  − air / water / garbage / crime / noise as before
```
- Split `rt.lvWaterfront` out of `lvStatic`.
- Re-splat a plopped building when Burnt / Abandoned flips, so burnt landmarks lose their bonus.
- Park splats are scaled by parks funding.
- Stats are computed on the first pass too.

### Growth
- **`pickDev`** weight becomes `(des − GROW_MIN + .05)^PICK_DES_EXP · allow^PICK_ALLOW_EXP`. The defaults 1 / 0.5 reproduce today's behaviour. The target values 2 / 0.4 let the rich outbid R$ on premium land, together with the RENT term; they ship only if the bot passes.
- **Hotels:** hotel defs get weight × (1 + min(3, hotelShortage / rooms of the def)).
- **Same-stage wealth swap (gentrification):** allowed when `des_new − des_old ≥ .25`, `demand_new > .1`, capacity ≥ 0.6 × old, and age ≥ 240.
- **Filtering down:** R$$$ with `des < −.1` for 180 days → R$$ of the same stage.
- `growthLimits` is exported.

### Exports
```ts
desirabilityBreakdown(st, rt, dev, i): { terms: FactorTerm[]; raw: number; value: number }
landValueBreakdown(st, rt, i): FactorTerm[]
growthLimits(st, i, dev): { desStage: number; popStage: number; zoneStage: number; rejected: boolean; reason?: string }
```

### Bot (`tools/simbot.ts`)
- **Replace `ensureServices`** with `ensureNeeds()`. For each tier in [elementary, high, health, college, play, green]:
  - If `stats.needs[t].unreached > max(200, 3%)`, place at `unservedClusters(sim, t)[0]`.
  - Else if served/need < 0.9 and a facility's utilization > 1.1, place near the most overloaded facility.
  - Def choice: clinic when the cluster has < 12k patients, else hospital; `park_small` below 3k, else `park_large`; playground, else soccer.
  - At most 3 placements per month, and service upkeep ≤ 45% of income.
  - Police and fire keep their coverage rules.
- **Also:**
  - Expand the landfill when `landfillFill > .7` or `NoGarbage` > 2%; build an incinerator when landfill space is short.
  - Build a treatment plant when `sewageTreated < .8` and pop > 20k.
  - Plant tree buffers between highways and R blocks when Noisy > 5%.
  - Build the college when unlocked.
- **New report columns:** kids%, sen%, enrolE%, enrolH%, tourists, attr.

### Cost
About +0.45 ms/day (desirability measured at 0.72 ms/day and land value at 0.64 ms/day today).

### Tests
- `desirabilityBreakdown` sums to the stored desirability (before clamp) on 200 random cells.
- A low-density R$$ lot gains ≥ 1.5× more from an elementary school than a high-density lot.
- R$ desirability at LV .9 is at least 0.3 below R$ at LV .5, all else equal.
- A cell at 2× the average commute scores lower than one at the average.
- A burnt landmark gives 0 land-value splat.
- **Slow balance test:** bot on a 128 map for 15 years with pop ≥ 0.9 × baseline; elementary served/need ≥ 0.85 from year 10; kids unreached < 5%.

### Balance procedure (WP6 owns it)
1. **Before merging any WP,** record baselines for 256 map × 60 years (seeds 7 and 11) and 128 × 15 into `fixtures/balance-baseline.json`. Run the bot with `npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet`; tsx is not installed locally, so rolldown-bundle then node works.
2. **Acceptance on 256, seed 7:**
   - pop ≥ 150k at year 15 and ≥ 950k at year 60, and ≥ 0.9 × baseline.
   - Approval ≥ 50 from year 30; funds ≥ 0.
   - EQ ≥ 100 by year 30.
   - Tourism jobs within ±30% of the old formula.
   - `totalMsPerDay` ≤ baseline + 3.
3. **Tuning order:**
   1. R and C biases after the commute rescale (expect about +0.08 on R).
   2. `MIG_NEUTRAL`.
   3. `NEEDS_PENALTY_MAX`.
   4. `PART_ADULT`.
   5. `EQ_SPAN_STOCK`.
   6. Seats.
   7. `PICK_*` exponents (last; otherwise revert to 1 / 0.5).

---

## Merge order and coordination

1. **Phase 0 (lead).** Then WP1, WP4, WP5 and WP6 start immediately against the stubs. WP2 and WP3 start once the perf agent's traffic / utilities / pollution / services work has merged.
2. **Merge order:** WP3 → WP2 → WP1 → WP4 → WP6 (balance pass) → WP5. WP5 can merge earlier behind stubs.
3. **Shared hunks:**
   - `traffic.ts`: one line, WP1.
   - `services.ts`: EQ/HQ block deletion, WP2. If WP1 merges first, WP1 carries this hunk.
   - `tuning.ts` / `params.ts`: section markers only.
   - `catalog.ts`: WP2 only. WP4 keeps venue and hotel data in `tourism.ts`; WP1 keeps household forms in `demographics.ts`.
4. **Adjacent roadmap tasks:**
   - #19 facility completeness builds on WP2's tier engine and must not fork `services.ts`.
   - #20 dispatch owns `fire.ts` and should read `BF.Watered` and `st.garbage`.
   - #22 region: WP4's migration multiplies the region effects.
   - #25 perf pass: the services step reaches 4.7 ms today, over the 3 ms target.

## Audit bugs folded into the packages

| Bug | Package |
|---|---|
| `econData.tourism` is never written | WP4 |
| Desirability overlay shows R$$ while the render averages all types | WP5 |
| RCI graph shows 0 / ±1 | WP5 |
| Trees have no effect | WP3, WP6, WP5 |
| "No water" chip on buildings that don't need water | WP5 via WP1 `waterRequired` |
| Commute layer written only on R footprints | WP2 `accessCommute`, WP6 |
| Landfill emits regardless of use | WP3 |
| Plants pollute at zero load; incinerator gives MW without garbage | WP3 |
| Civic buildings work unpowered | WP2, WP3 |
| Burnt / unfunded landmarks keep land value and cap relief | WP6, WP4 |
| `WORKFORCE_RATIO` and `WORKER_SHARE` duplicated | WP1 |
| Polluted flag on factories | WP3 |
| Stale `pollution.ts` header | WP3 |
| Missing history series | WP5 |
| Water shortage never makes a building unhappy | WP1 |