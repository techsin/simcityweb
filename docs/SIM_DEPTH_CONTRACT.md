Phase 0 is in: the new state fields, types, stub modules, system registrations, section markers and tests are all in the tree, `npx tsc --noEmit` is clean, and all 116 tests pass (18 of them new). It is bit-identical to the old code except for one change, P0-9 (services step size). That change shifts when scheduler steps land, and the bot is chaotic enough that year-60 population moves by −9% (seed 11) and +15% (seed 7). With P0-9 reverted, the 128×15 bot run matches the pre-change run exactly. So the baseline file holds two sets: `preSpec` and `phase0`, and packages should compare against `phase0`. P0b (road-table reorder and re-recording the baselines) is not done yet.

## Status
- **Tests:** under the default 5 s per-test timeout, 2–4 tests time out on this shared box (load 20–25). An untouched copy of HEAD times out on the same tests, so the machine is the cause. Run with `npx vitest run --testTimeout=30000`, which passes 17/17 files and 116/116 tests.
- **Bot runs:** baselines were recorded before any change (seeds 7 and 11 at 256×60, plus 128×15), then again after Phase 0.
- **Save/load:** old saves load. Missing stats get their defaults filled in (nested objects too), missing history series are zero-padded to `t.length`, and missing optional building fields stay undefined.

## Contract by file
**src/sim/CityState.ts**
- New flags: `BF.Noisy=1<<14` (WP3), `NeedsUnmet=1<<15` (WP1), `Incident=1<<16` (WP8), `Understaffed=1<<17` (WP7).
- New optional `Building` fields: `kids? teens? yad? srs? wf? edu? hire?`. They are saved as Float32 (NaN means undefined), so write them with `Math.fround(v)` to keep save/load exact.
- New zero-filled Float32 layers:
  - WP2: `eduElemCov eduHighCov eduCollegeCov playCov greenCov shopAccess stigma prestige campus accessCommute`
  - WP3: `treeCover soil landfillFill`
  - WP4: `visitors`
  - WP8: `respFire respPolice respMedical`. `RESP_NONE=-99` is exported; the layers stay 0 until WP8 writes them.
  - WP7: `parking`
- Types:
  - `NeedTier = 'elementary'|'high'|'college'|'health'|'play'|'green'|'police'|'fire'`, plus `NEED_TIERS`. I added `'fire'` so `FacilityLoad.needTier` is valid for fire stations.
  - `NeedStat {need, served, capacity, unreached, overcrowded}`.
  - `IncidentKind`/`INCIDENT_KINDS`, `Responder`/`RESPONDERS`, `EmergencyMonth`, `emptyEmergencyMonth()`, `EmergencyStats`, `JusticeStats`, `TransitFleetStats`, all as in P0-3.
- New `CityStats` fields: `cohorts[5]`, `cohortsByWealth[15]`, `workforceRatio`, `needs`, `avgNoise`, `avgAir`, `avgWaterPollution`, `sewageTreated`, `tapWater`, `landfillFill`, `garbageRecycled`, `tourists`, `attractiveness`, `attractByWealth[3]`, `hotelRooms`, `emergency`, `justice`, `transitFleet`.
- `defaultStats()` defaults: `workforceRatio=WORKFORCE_RATIO`, `tapWater=1`, `sewageTreated=0`, `medScore=1`, `justice.policeMul=crimeMul=1`.
- History: 25 new series (the spec list plus `incidents responseMin emergencyDeaths jailOccupancy busLoad parkRide`), with `HISTORY_KEYS`, `emptyHistory()` and `padHistory(h)`. `recordHistory` now calls `padHistory` after pushing, so WP5 must push its values before that call.

**src/core/types.ts** — Overlay values appended: `Parks=17 Commute=18 Shops=19 Demographics=20 Tourism=21 Nimby=22 Soil=23 Emergency=24 Parking=25`. `render/world/overlays.ts` got placeholder `OVERLAYS` entries; WP5 owns the real ones.

**src/sim/catalogTypes.ts**
- `ServiceTier` includes `'police'|'fire'`.
- New types `ReachMetric = 'walk'|'drive'|'euclid'` and `AreaEffect {amount, radius}`.
- `coverage` gains optional `tier` and `metric`; defs gain optional `stigma`, `prestige`, `campus` (AreaEffect) and `household`.

**src/sim/explain.ts** — `FactorTerm {id, label, value, detail?}`, plus helpers `sumTerms` and `topTerms(terms, n)`.

**src/sim/Simulation.ts**
- New event `emergency: EmergencyEvent`, exactly as in P0-6.
- New `liveSlowdown = 1`. It applies only at speed 1 through `secondsPerDay()`; headless `advanceDay` and `runDays` are unaffected.
- New `get dayFraction` (0..1, 0 when paused) and `simTime()`.

**src/save/serialize.ts**
- `DERIVED_LAYERS` (the 16 layers in P0-13) are neither written nor restored. Their owner system must recompute them synchronously in `init()`.
- `OPTIONAL_BUILDING_FIELDS` are saved as `buildings.opt` Float32 columns, written only when some building sets the field.
- `upgradeStatsAndHistory(st)` fills missing stats and pads missing history on load.
- WP1 does not need to edit this file.

**src/sim/economy/runtime.ts**
- `EconData` gains `tourists`, `attractiveness`, `attractByWealth[3]`, `approvalTerms`, `attractTerms`, `hotelShortage`, `migration=[1,1,1]` (all defaulted with `??=`) and optional `regionTerms?: RegionTerms {R[], CS[], CO, I, market, capR, capC, capI}`.
- `EconRuntime` gains `workforceRatio`, `coarsePopW[3]`, `coarseSkill` and `coarseKids`, allocated in `reset()`.

**Shared-file edits**
- `infra/traffic.ts`: `get nodeTimes(): Float32Array` (view of the first `road.n` nodes) and `get graphVersion()` (equals `road.version`).
- `infra/scheduler.ts`:
  - New counters: `maxStepMs`, `estMs`, `headlessDays`, `estSpent`.
  - New helpers: `schedulerUtilisation(s)`, `resetSchedulerStats(s)`.
- `infra/services.ts` (P0-9): `WORK_PER_STEP=120000`, step estimate `0.1+2.3·min(1, workLeft/WORK_PER_STEP)`.
- `economy/ordinances.ts`: `tourism_promotion` gains `'tourism.draw':1.2`; `nuclear_free_zone` gains `'power.nuclear':0`, and its effectText now mentions shutting down existing plants. Both keys do nothing until WP4 and WP3 read them.
- `systems/infra.ts`: order is utilities → traffic → pollution → services → crime → fire → **emergency** → disasters → **justice**.
- `systems/economy.ts`: the **tourism** stub is registered after population and before demand, so WP4 does not need to touch the system list.

## Stubs (final signatures; what each package fills in)
- **WP1 `economy/demographics.ts`**
  - Types: `Cohort`, `COHORT_LABELS`, `HouseholdForm`, `NeedKind` (includes `'water'` for WP1-3), `NeedReport`.
  - `householdForm(def?, zone?)`: currently only the def override and the stage/zone fallback; WP1 adds the per-model table.
  - `profileShares(form, wealth, out?)` and `cohortShares(b, out?)`: stubs return `COHORT_BASE` (cohortShares uses the building's fields when set).
  - Final as written: `workerShare(b)` (= `b.wf ?? 0.55`), `carlessShare(b)`, `waterRequired(st, b)` (legacy rule).
  - `familyScoreAt`, `seniorScoreAt`, `studentScoreAt` return 0.5; `needsOf` returns []; `needsPenalty` returns 0; `updateDemographics(st, b, def, i, dt)` does nothing.
  - `population.ts` gets `conditionBreakdown(st, b)`, returning `{terms: [], target: b.health, abandonInDays: null}`.
  - `tuning.ts` §DEMOGRAPHICS now holds `COHORT_BASE`.
- **WP2 `infra/catchments.ts`**: `TIER_NEED`, `tierLayer(st, tier)` (maps to the new layers, or to `healthCov`/`policeCov`/`fireCov`), `FacilityLoad`, `facilityLoad(sim, id)` → null, `unservedClusters(sim, tier, max=5)` → [], `ReachScratch {idx, w}`, `newReachScratch(n)`, `reachCells(st, bx, bz, bw, bd, radius, metric, scratch)` → 0.
- **WP2 `infra/nimby.ts`**: `rebuildNimby(sim)` (no-op), `nimbyCost(sim)` → 0, `nimbyAt(st, i)`.
- **WP4 `economy/tourism.ts`**
  - Tourism module: `AttractionDef`, `ATTRACTIONS = {}`, `tourismSystem(rt)` (named `economy.tourism`, no hooks), `venueVisits` → null, `attractivenessBreakdown` → [], `tourismTrips` → [].
  - `approval.ts` gets `approvalBreakdown(st)` → [].
- **WP6 breakdowns**
  - `desirabilityBreakdown(st, rt, dev, i)` returns `{terms: [], raw: stored, value: stored}`.
  - `landValueBreakdown(st, rt, i)` returns [].
  - `growthLimits(st, i, dev)` returns `{desStage, popStage, zoneStage, rejected, reason?}` computed from the legacy rules.
- **WP3**: `infra/utilities.ts` gets `waterQualityAt(sim, cell)`, which returns `stats.tapWater` for now.
- **WP7 `infra/facilities.ts`**: `FacilityLine`, `FacilityReport`, `facilityReport(sim, id)` → null, `facilityOpFactor(st, b)` → 1, `facilityUseFactor(st, b)` → 1.
- **WP7 `infra/justice.ts`**: `justiceFactors(st)` reproduces the legacy rule exactly (policeMul 0.75 when pop > 25k and there is no functional jail; crimeMul 1). `addArrestPotential` is a no-op. The `JusticeSystem` stub (`'justice'`) only copies the two factors into `stats.justice`.
- **WP8 `infra/emergency.ts`**
  - Types: `Incident`, `IncidentState`, `UncoveredReason`, `EmergencyVehicle` (with `path`, `times`, `legStart`), `EmergencyVehicleModel`, `StationFleet`, `DispatchOption`, `DispatchResult`, `SpawnOptions`, `EmergencyPollutionSource`, `CrimeBoost`.
  - Tables: `FLEET` (filled with the WP8-2 numbers), `INCIDENT_LABEL`, `INCIDENT_COLOR`.
  - `EmergencySystem` (`'emergency'`): `active` is false; `onFire(sim, b, spread)` returns false, which means "use the legacy fire path" (WP8's `fire.ts` should use that).
  - Other `EmergencySystem` methods: `incidents()`, `vehicles()`, `stationFleet(id)`, `dispatchOptions(sim, id)`, `dispatch(sim, id, stationId, units=1)`, `dispatchBest(sim, id)`, `spawn(sim, kind, x, z, opts?)` (returns -1 in the stub), `report(sim, x, z)`, and `stats(sim)`, which takes `sim`.
  - Module helpers: `emergencyOf`, `emergencyVehicles`, `responseAt` (→ null), `uncoveredHotspots(sim, r, n=5)` (→ []), `emergencyPollution` (→ []), `emergencyCrimeBoosts` (→ []).

## Section markers (append only inside your own)
- `tuning.ts`:
  - §EMPLOYMENT (existing workforce/employment header) — WP1
  - §GROWTH, §LAND VALUE, §DESIRABILITY anchor lines at the end of the existing sections — WP6
  - §APPROVAL — WP4
  - new §DEMOGRAPHICS — WP1
  - new §TOURISM, §MIGRATION, §REGION — WP4
- `params.ts` (at the end of the file, each with a start and an end marker): §CATCHMENTS (WP2), §POLLUTION, §UTILITIES, §CRIME (WP3), §EMERGENCY (WP8), §FACILITIES (WP7).

## Baselines (`tests/sim/fixtures/balance-baseline.json`)
Columns: year, pop, funds, approval, eq, unemployment, commute, totalMsPerDay, econMsPerDay, access, jobs, buildings. The `phase0` rows are the reference:

| Run | Year 15 | Year 30 | Year 60 | Mean ms/day |
|---|---|---|---|---|
| 256×60 seed 7 | 151k, approval 58, EQ 107 | 507k, approval 73, EQ 140 | 985k, approval 66, unemployment 12.2%, commute 7.3 | 5.99 |
| 256×60 seed 11 | 187k | 563k | 933k, approval 63, unemployment 14.1% | 6.02 |
| 128×15 seed 7 | 158k, approval 64, EQ 100 | – | – | 2.47 |

For comparison, `preSpec` year 60 was 854k (seed 7) and 1,024k (seed 11). The ms/day figures were measured under load and are noisy (about ±20%).

## Known issues for the packages
- **Oversized scheduler steps already exist.** On the stress city the estimated step costs are pollution 4.51, traffic 3.18 and crime 3.17, all over the 3.0 target. The perf test caps them at those values (pollution 4.6, traffic and crime 3.25) as a regression guard; WP3 should split its steps and lower the caps. The "measured step ≤ 6 ms" check runs only with `PERF_STRICT=1`, because measured steps spike to 10–230 ms on this shared machine.
- **Scheduler utilisation is already 92%** of `INFRA_DAY_BUDGET` 2.6 on the stress city, and it is the same with or without P0-9 (every task gets about 0.53 estimated ms per day). The P0-15 target of ≤ 85% therefore cannot hold until the budget is raised under the per-package shares.
- **`CARLESS_EFF` currently lives inside `demographics.ts`.** WP1 can move it into §DEMOGRAPHICS.

## How to run
- Typecheck: `npx tsc --noEmit`
- Tests: `npx vitest run --testTimeout=30000`
- Perf log: `npx vitest run tests/infra/perf.test.ts --reporter=verbose --silent=false` prints a "scheduler (P0-8/P0-15)" line with utilisation, maximum estimated and measured step, and estimated ms/day per task.
- Bot, with tsx: `npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet`
- Bot, without tsx (tsx is not installed here): `node_modules/.bin/rolldown tools/balance-json.ts --platform node --format esm --dir <dir> && node <dir>/balance-json.js <size> <years> <seed> <out.json>` writes the yearly rows as JSON. That driver's file name must not contain "simbot", or it also starts simbot's own command-line run.

## Files
New:
- /home/user/simcityweb/src/sim/explain.ts
- /home/user/simcityweb/src/sim/economy/demographics.ts
- /home/user/simcityweb/src/sim/economy/tourism.ts
- /home/user/simcityweb/src/sim/infra/catchments.ts
- /home/user/simcityweb/src/sim/infra/nimby.ts
- /home/user/simcityweb/src/sim/infra/facilities.ts
- /home/user/simcityweb/src/sim/infra/justice.ts
- /home/user/simcityweb/src/sim/infra/emergency.ts
- /home/user/simcityweb/tools/balance-json.ts
- /home/user/simcityweb/tests/sim/phase0Contract.test.ts
- /home/user/simcityweb/tests/save/serializePhase0.test.ts
- /home/user/simcityweb/tests/sim/fixtures/balance-baseline.json

Edited: CityState.ts, Simulation.ts, catalogTypes.ts, core/types.ts, save/serialize.ts, economy/{runtime,tuning,ordinances,history,population,approval,desirability,landValue,growth}.ts, infra/{params,scheduler,services,traffic,utilities}.ts, systems/{infra,economy}.ts, render/world/overlays.ts, tests/infra/perf.test.ts.