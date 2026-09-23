# Amendments to `docs/SIM_DEPTH_SPEC.md` (completeness critic)

These amendments are based on the spec, `docs/SIM_FACTOR_AUDIT.json` and a read of the current code. Numbering is `P0-n`, `P0b-n`, `WPk-n`. P1 is required; P2 is optional polish.

## Code facts the spec missed (all verified)

- **F1. Swapped road tables.** The `infra/params.ts` tables `NET_CAPACITY`, `NET_TIME`, `CONNECTION_JOBS` and `CONNECTION_WORKERS` are commented as `[None, Street, Road, OneWay, Avenue, Highway, Rail]`. But `core/types.ts` has `Avenue = 3` and `OneWay = 4`. As a result:
  - Avenues get 1,600 PCU and 0.085 min/cell; one-way roads get 2,600 PCU and 0.075 min.
  - Avenue neighbour connections give 2,000 jobs and one-way connections give 5,000.
  - `tuning.ts` and `VehicleRenderer.SPEED` index these correctly.
- **F2. Ferry terminals do nothing real.** `transit.collectStops` only collects Bus, Subway and Train, so a ferry terminal only splats a fake transit coverage (radius 12, strength 0.5).
  - The parking garage (radius 4, strength 0.2) and the bus depot (radius 30, strength 0.25) are the same: coverage splats with no effect on trips.
- **F3. The jail only toggles a rule.** Its only effect is `services.prep`: `policeMul = 0.75` when pop > 25k and there is no jail. It also has a land-value splat and a weak radius-64 police coverage. The courthouse is also just a radius-64 strength-0.1 police coverage.
- **F4. Fire dispatch ignores the truck.**
  - `fire.ts` picks the nearest station by Manhattan distance ≤ 2.2 × radius.
  - The put-out day comes from `fireCov` thresholds, not from when a truck arrives. There is no fleet limit.
  - The route is an unweighted BFS (`traffic.findPath`), pushed as kind `'service'`. `VehicleRenderer` then picks a random model from police / ambulance / fire truck / garbage truck.
- **F5. Test constraint.** `tests/infra/environment.test.ts` requires two things: an uncovered fire is Burnt within 10 days, and a covered fire is out within 10 days.
- **F6. Why unemployment disagrees with traffic.**
  - Sim-core fills `b.jobs = capacity × occ × jf`, with `occ = demandFactor × (0.8 + 0.2·health)` (plus the power/water factors). So businesses under-hire.
  - Traffic matches workers against full `jobSlots = b.capacity`.
  - `population.ts` ignores `systemData.regionJobs` / `regionWorkers`, which traffic does use.
  - `TRAFFIC_ACCESS_WEIGHT = 0`.
  - Result: `acc = 1.0` while unemployment is 12–21%.
- **F7. Ordinances.**
  - `tourism_promotion` only sets `demand.CS 1.08` and `add.tourism 4`. The second key only feeds the old cap-relief tourism number.
  - `nuclear_free_zone` blocks new nuclear plants, but an existing plant keeps running.
- **F8. Region data unused.** `systemData.region` (`RegionContext`) is written by `src/region/regionEffects.ts` and read by nothing.
- **F9. Every typed-array field of `CityState` is saved.** The ~20 new Float32 layers would add ≈ 5 MB to each 256² save.
- **F10. Time scale.** `SECONDS_PER_DAY = [∞, 0.5, 0.2, 0.05]`, so at 1× a fire that burns for 6 days lasts 3 real seconds.
- **F11. Useful existing APIs.**
  - `TrafficSystem.nodeTime` is private, but `search.ts roadSearch` is exported.
  - `AudioEngine.getSfxOutput()` exists. `AudioEngine.ts` is currently being modified by the soundtrack team.
  - `RNG` has a get/set `state`.
  - `render/city/effects/Disasters.ts` already draws a generic smoke column for unknown kinds such as `'riot'`.
- **F12. Contradictions in the spec itself.**
  - §0 says "raise `INFRA_DAY_BUDGET` by at most 0.4", but WP2 and WP3 alone add about 0.95 ms/day of scheduler work.
  - WP6 is told to record baselines "before merging any WP", but WP6 runs after WP1–WP4.
  - `CARLESS` is defined in WP1 but nothing consumes it.

---

## PHASE 0: additions to the contract commit (still behaviour-neutral)

**P0-1. `CityState.ts` flags and fields**
- `BF.Incident = 1 << 16` (WP8) and `BF.Understaffed = 1 << 17` (WP7).
- Optional `Building.hire?: number` (0..1, WP1).

**P0-2. New Float32 layers**
- `respFire`, `respPolice`, `respMedical` (WP8): slack in minutes, ≥ 0 means auto-dispatch reaches the cell; −99 means no station.
- `parking` (WP7): pressure 0..1.

**P0-3. `CityStats` additions (all defaulted in `defaultStats()`)**
```ts
export type IncidentKind = 'fire'|'industrial'|'spill'|'crime'|'riot'|'medical'|'collapse'|'prisonRiot';
export type Responder = 'fire'|'police'|'medical';
export interface EmergencyMonth { count: Record<IncidentKind, number>; auto: number; manual: number; late: number; failed: number;
  responseMin: Record<Responder, number>; responses: Record<Responder, number>;
  deaths: number; injured: number; rescued: number; buildingsLost: number; damage: number; arrests: number; riotDays: number }
export interface EmergencyStats { month: EmergencyMonth; lastMonth: EmergencyMonth; year: EmergencyMonth; active: number; manualActive: number; medScore: number /*default 1*/ }
export interface JusticeStats { inmates: number; beds: number; holding: number; arrestsMonth: number; releasesMonth: number; occupancy: number; overflow: number; policeMul: number; crimeMul: number }
export interface TransitFleetStats { buses: number; busesNeeded: number; parkRide: number; parkRideSpaces: number; ferryRiders: number; ferryLinks: number }
stats.emergency: EmergencyStats; stats.justice: JusticeStats; stats.transitFleet: TransitFleetStats
export function emptyEmergencyMonth(): EmergencyMonth
```
- `NeedTier` gains `'police'` (written by WP7).

**P0-4. `HistorySeries` additions (WP5 writes):** `incidents`, `responseMin`, `emergencyDeaths`, `jailOccupancy`, `busLoad`, `parkRide`.

**P0-5. `Overlay` enum:** append `Emergency = 24` and `Parking = 25`.

**P0-6. `Simulation.ts`**
- Add event `emergency: EmergencyEvent` to `CityEvents`:
  ```ts
  { type: 'new'|'queued'|'dispatched'|'arrived'|'escalated'|'resolved'|'failed'|'uncovered'; id; kind: IncidentKind; x; z;
    major: boolean; manualPossible: boolean; reason?: 'noStation'|'outOfRange'|'busy'; etaMin?: number }
  ```
- Add `liveSlowdown = 1`. In `update()` use `spd = SECONDS_PER_DAY[s] × (s === 1 ? liveSlowdown : 1)`.
- Add `get dayFraction(): number`, computed as `acc / spd` and clamped to 0..1.
- Add `simTime(): number = state.day + dayFraction`.

**P0-7. `TrafficSystem`:** add `get nodeTimes(): Float32Array` (a read-only view of `nodeTime`) and `get graphVersion(): number`. This lets WP8 run `roadSearch` without editing `traffic.ts` concurrently.

**P0-8. `InfraScheduler`:** record `readonly maxStepMs: Map<string, number>` in `exec()`. `tests/infra/perf.test.ts` adds two checks:
- every registered task's estimated `cost()` is ≤ 3.0 (deterministic);
- the logged measured maximum is ≤ 6 ms (CI slack).

**P0-9. Services step size (known issue #5, moved here from WP2).**
- `services.ts`: `WORK_PER_STEP` 240000 → **120000**. The measured 4.7 ms at 240k scales to about 2.35 ms.
- Change the estimate to `0.1 + 2.3·min(1, workLeft/WORK_PER_STEP)`.
- This changes step boundaries only, not the layer formulas.

**P0-10. Stub modules (final signatures)**
- `infra/facilities.ts` (WP7):
  ```ts
  interface FacilityLine { key: string; label: string; value: string; ratio?: number; status?: 'ok'|'warn'|'bad'; hint?: string }
  interface FacilityReport { title: string; role: string; lines: FacilityLine[]; warnings: string[] }
  facilityReport(sim, id): FacilityReport | null    // stub: null
  facilityOpFactor(st, b): number                   // stub: 1
  facilityUseFactor(st, b): number                  // stub: 1
  ```
- `infra/justice.ts` (WP7):
  - `justiceFactors(st): { policeMul; crimeMul }`. The stub reproduces the legacy rule exactly: `policeMul = 0.75` if pop > 25k and there is no functional jail, else 1; `crimeMul = 1`.
  - `addArrestPotential(st, v)`: stub is a no-op.
  - `class JusticeSystem` named `'justice'`: stub is a no-op.
- `infra/emergency.ts` (WP8):
  - Types `EmergencyPollutionSource { x, z, air, water, radius }` and `CrimeBoost { x, z, radius, amount }`.
  - `emergencyPollution(sim)` and `emergencyCrimeBoosts(sim)`: stubs return `[]`.
  - `emergencyOf(sim)`.
  - `class EmergencySystem` named `'emergency'`: stub is a no-op.
  - `responseAt(sim, cell, r): { slackMin: number; covered: boolean } | null`: stub returns null.

**P0-11. `systems/infra.ts`:** register the stubs in this order: utilities → traffic → pollution → services → crime → fire → **emergency** → disasters → **justice**. After this, no package needs to edit this file.

**P0-12. `ordinances.ts` (lead edits two existing entries; the new keys are inert until consumed)**
- `tourism_promotion` += `'tourism.draw': 1.2` (WP4 consumes it).
- `nuclear_free_zone` += `'power.nuclear': 0` (WP3 consumes it). Update `effectText` to "…shuts down existing nuclear plants".

**P0-13. `serialize.ts`: add a `DERIVED_LAYERS` set that is neither written nor restored.**
- Layers: `eduElemCov`, `eduHighCov`, `eduCollegeCov`, `playCov`, `greenCov`, `shopAccess`, `stigma`, `prestige`, `campus`, `accessCommute`, `treeCover`, `visitors`, `respFire`, `respPolice`, `respMedical`, `parking`.
- Their owners must recompute them synchronously in `init()`. WP4 is amended accordingly; `parking` is neutral at 0.
- Stocks (`soil`, `landfillFill`) stay persisted.
- Test: a save of a 256² city grows by ≤ 1 MB compared with before this spec.

**P0-14. Section markers**
- `params.ts`: §EMERGENCY (WP8) and §FACILITIES (WP7).
- `tuning.ts`: §REGION (WP4). The existing "workforce / employment" section is assigned to WP1.

**P0-15. Budget rule (replaces "raise by at most 0.4").**
- Phase 0 adds a probe that logs scheduler utilisation (Σ estimated cost/day ÷ `INFRA_DAY_BUDGET`) on `stressCity(256)`.
- Each WP may raise `INFRA_DAY_BUDGET` by its own share: WP2 +0.25, WP3 +0.15, WP7 +0.3, WP8 +0.15. The maximum is 3.45.
- Utilisation must stay ≤ 85%, and bot `totalMsPerDay` must stay ≤ baseline + 3.

## PHASE 0b (lead, right after Phase 0; intentionally changes numbers)

**P0b-1. Fix F1.** Reorder `NET_CAPACITY`, `NET_TIME`, `CONNECTION_JOBS` and `CONNECTION_WORKERS` to follow the enum (Avenue 2,600 PCU / 0.075 min; OneWay 1,600 / 0.085; connections Avenue 5,000 / 4,000, OneWay 2,000 / 1,500).
- Test `tests/infra/netTables.test.ts`: `CAP[Avenue] > CAP[OneWay] > CAP[Road]`, and `TIME[Highway] < TIME[Avenue] < TIME[OneWay] < TIME[Road] < TIME[Street]`.

**P0b-2. Baselines move here from WP6 step 1.** Record the balance baselines (256 × 60 years, seeds 7 and 11; 128 × 15) into `tests/sim/fixtures/balance-baseline.json` after P0b-1.

---

## WP1 amendments (demographics / sim-core)

**WP1-1. One employment ledger (fixes F6 and known issue #5-a).**
- (a) In `occupancy()`, C, I and civic buildings get `b.hire = demandFactor × (0.8 + 0.2·health) × (powered ? 1 : 0.25) × (water ok ? 1 : 0.5)`. This is the old `occ` without `jf`.
- (b) `common.jobSlots`, one line: C/I returns `b.capacity × (b.hire ?? 1)`; civic returns `civicJobs × (b.hire ?? 1)`.
- (c) When traffic has assessed a building (`jobFill ≥ 0`), `b.jobs → slots × min(1, traffic.jobFill(b))`. Set `TRAFFIC_JOBFILL_WEIGHT = 1`. The analytic `jf` remains only as a fallback.
- (d) When traffic is present, employment comes from traffic:
  - `employed = EMA_0.3( Σ_R pop·workerShare(b)·clamp(workerAccess(b), 0, 1) )`. This already includes regional jobs (connection sites).
  - `unemployment = 1 − employed/W`.
  - Without traffic, the current formula stays but `regional` uses `systemData.regionJobs` when it is a number.
  - Remove `TRAFFIC_ACCESS_WEIGHT`.
- (e) Add `hire` to `BUILDING_FIELDS` as Float32.
- Tests (`tests/sim/employment.test.ts`, on the `tests/infra/cityGen` city after 6 traffic cycles):
  - `|unemployment − (1 − Σ pop·wf·acc / W)| < 0.01`.
  - `Σ jobs(C, I, civic)` is within 3% of matched local workers + inbound (WP1 adds a `traffic.inboundTotal` getter in the same hunk as the `oW` line).
  - With 2× job capacity, unemployment < 3%. With jobs = 0.5 × workers and no connections, unemployment is within 0.45–0.55.
  - A `sd.region` job bonus lowers unemployment.

**WP1-2. HQ from emergency medicine.** `HQ_target *= (0.85 + 0.15·stats.emergency.medScore)`. The default is 1, so this is neutral until WP8.

**WP1-3. Per-network tap water.** Watered R buildings with `waterQualityAt(sim, cell) < 0.6` get health −0.04 × (0.6 − q)/0.6, and `needsOf` adds a `'water'` NeedReport ("Unsafe tap water"). `waterQualityAt` comes from WP3-5; fall back to `stats.tapWater`.

**WP1-4. Car-less share.** Export `carlessShare(b) = CARLESS_EFF[w − 1] × (0.5 + yad + srs)` with `CARLESS_EFF = [0.2, 0.05, 0]`. WP7 consumes it, which gives `CARLESS` a real use.

## WP2 amendments (catchments)

**WP2-1. Police and fire through the tier engine.** Add tiers `police` and `fire` (drive metric, def radius/strength, layers `policeCov` / `fireCov`) with `capacity = Infinity` and a pluggable `needOf`, which is neutral. WP7 later adds the police capacities and need raster in `facilities.ts` tables, not in `services.ts` logic. `facilityLoad` works for these tiers too (utilisation 0 until WP7).

**WP2-2. Staffing hook.** `op_f *= facilityOpFactor(st, b)` (Phase 0 stub; WP7 implements staffing).

**WP2-3. Jail rule via justice.** Replace the `hasJail` / `policeMul` block in `prep` with `justiceFactors(st).policeMul`. The stub keeps the legacy result.

**WP2-4. Tier table additions.**
- `civ_cemetery`: green, walk radius 4, strength 0.4, capacity 1,500 (quiet space for seniors).
- `civ_courthouse`: remove from police coverage (WP7 moves its effect into justice). Until WP7 lands, keep the coverage entry.

**WP2-5. Leave to WP7.** Do not rewrite the descriptions of `civ_bus_depot`, `tr_parking_garage`, `tr_ferry_terminal`, `civ_jail`, `civ_courthouse` or the airports/seaport; WP7 owns those lines. `WORK_PER_STEP` is already handled in P0-9.

## WP3 amendments (environment / utilities / crime)

**WP3-1. Nuclear-free zone.** `utilities`: nuclear output × `ordinanceEffect('power.nuclear')`. Send news once: "Nuclear plant shut down by ordinance (−1,600 MW)".

**WP3-2. Emergency hooks.**
- `pollution.ts` adds `emergencyPollution(sim)` sources, splatted like plopped emitters.
- Burning buildings (from `getFire(sim).fires`) add air 0.25 at radius 2.
- `crime.ts` splats `emergencyCrimeBoosts(sim)` into `raw`, capped at 1.

**WP3-3. Justice hooks in `crime.ts`.**
- Multiply raw crime by `justiceFactors(st).crimeMul`.
- The police term uses `policeCov × fx.policeEffect × justiceFactors(st).policeMul`, replacing the multiply in services if WP2 kept it.
- In `rawStep`, call `addArrestPotential(st, Σ_b c_b·occ_b·min(1, police_b·policeEff))`.

**WP3-4. Freight rail noise (P1 instead of P2).** Guarded read of `traffic.freightRailCells?.()` (WP7 implements it) adding +0.12 noise. Skip if undefined.

**WP3-5. Per-network water quality.** Export `waterQualityAt(sim, cell): number`, the supply-weighted pump quality of that water network component with treatment applied (0..1, 1 = clean). `stats.tapWater` stays as the city mean.

**WP3-6 (P2). Water tower storage.** Buffer = 3 × daily output, discharged during a shortage before brownout ordering.

## WP4 amendments (tourism / region / approval)

**WP4-1. Regional demand (known issue #4).** `demand.ts` reads `st.systemData.region` (`RegionContext`); new tuning §REGION.
- Edge factor per founded neighbour:
  - `edgeF(n) = max EDGE_CONN[c.type]` over `st.neighborConnections` with `c.edge === n.edge` and the along-edge coordinate (x for n/s, z for e/w) inside `[n.from, n.to)`.
  - `EDGE_CONN`: Street .3, Road .5, OneWay .5, Avenue .7, Highway 1, Rail .8. With no connection, 0.1.
- Terms:
  - `R_w += RG_R·Σ max(0, n.jobs − n.workers)·edgeF·JOB_MIX_AVG[w] / rt.workforceRatio`, with `RG_R = 0.3` (matches `ADJ_SHARE`).
  - C/I targets `+= RG_CI·Σ max(0, n.workers − n.jobs)·edgeF`, split CS .25 / CO .25 / I .5 by the current shares, with `RG_CI = 0.3`.
  - `CS_w += RG_CS·CS_PER_RES_w·Σ_r (n.pop·wealthMix_r)·CUSTOMER_MIX[r][w]·edgeF`, with `RG_CS = 0.08`, capped at 0.5 × the local CS target.
  - `iTotal *= 1 + 0.25·min(1, region.population / 2e6)` (a larger regional market).
  - Caps: `+ edgeF·adjacentPopulation × {R: .1, C: .05, I: .05}`.
- Store `econData.regionTerms = { R: [3], CS: [3], CO, I, market, capR, capC, capI }` for the WP5 demand explanation.
- Tests (`tests/sim/region.test.ts`):
  - An isolated city gives bit-identical demand.
  - A north neighbour with 50k jobs / 10k workers and a highway on the north edge raises R by ≥ 10%; a street only gives ≤ 4%; no connection gives ≤ 2%.
  - A bedroom neighbour raises C/I.
  - The terms sum to the delta.

**WP4-2. Tourism promotion.** Venue draw × `ordinanceEffect('tourism.draw')`, still capped by capacity. The new `demandContext` no longer reads `add.tourism`; the key stays inert. This fixes the no-effect half of F7.

**WP4-3. Relief follows use.** Cap relief and `FREIGHT_BOOST` per building × `facilityUseFactor(st, b)` (Phase 0 stub; WP7 implements it).

**WP4-4. Approval: replace the fires term** with `−min(8, 1.2·failed + 0.4·late + 0.3·deaths + 0.1·riotDays)`, read from `stats.emergency.lastMonth`. Add justice: `−3·stats.justice.overflow`. Both go into `data.approvalTerms`.

**WP4-5.** `visitors` is computed in `init()` as well as monthly (required by P0-13).

## WP5 amendments (feedback; runs after WP8, alongside WP7)

- **WP5-1. Overlays.**
  - `Emergency` with variants Fire / Police / Medical, read from `resp*`. Legend: "Auto-dispatch" (slack ≥ 0), "Slow" (−3..0), "Manual dispatch needed" (< −3), "No station". This makes the overlay predict exactly which incidents are auto-dispatched.
  - `Parking` shows `parking` pressure.
  - The Traffic overlay gets a "Trucks" variant.
- **WP5-2. Inspector.**
  - Render `facilityReport` generically: label/value rows, a bar when `ratio` is set, status chips, warnings.
  - The building / lot inspector shows "Fire response: auto, 2.1 min" (or "manual only") from `responseAt`, and "Unsafe tap water".
  - WP5 does not hand-code per-facility strings.
- **WP5-3. Graphs and stats.**
  - New graphs: "Emergencies" (incidents, response minutes per responder, deaths) and "Transit" (bus load, park & ride).
  - `StatsPanel` adds jail occupancy, bus fleet, park & ride, and incidents this month.
- **WP5-4. Advisors.**
  - `jailOvercrowded` (overflow > 0.2): "criminals released early (+{x}% crime)".
  - `busFleetShort` (busesNeeded > 1.15 × buses): with depot location.
  - `parkingPressure` (a C block with pressure > 0.6): "build a parking garage next to a stop".
  - `noFireResponse` (≥ 15% of residents with `respFire` slack < 0): location from `uncoveredHotspots`.
  - `slowAmbulances` (medScore < 0.8).
  - `riotRisk` (approval < 40 and avgCrime > 0.4).
  - `regionOpportunity` (a neighbour with a job surplus > 20k and edgeF < 0.5): "connect a highway on the {edge} edge".
- **WP5-5.** The RCI tooltip lists `regionTerms`. The Toolbar tooltip shows fleet size ("2 fire trucks"), beds, seats, spaces and buses. PlopTool shows transit stops within 5 cells for a garage and reachable partner terminals for a ferry.
- **WP5-6.** Confirmation dialog for `nuclear_free_zone` when a nuclear plant exists.
- **WP5-7.** WP5 does not edit WP8's files (`EmergencyBanner`, `EmergenciesPanel`, `DispatchTool`, `emergency.css`).

## WP6 amendments (split in two)

- **WP6-1. Split.**
  - **WP6a** runs alongside WP5 and WP7: new terms, land value, growth, bot rules.
  - **WP6b** runs after WP7 merges: the final tuning and acceptance run.
  - Baselines already come from P0b-2.
- **WP6-2. Parking desirability terms** (neutral at 0): `PARKING` weight −0.12 for CS$ / CS$$, −0.15 for CS$$$, −0.08 for CO$$ / CO$$$. For I desirability, use `traffic.freightAccess(b)` when ≥ 0, otherwise `rt.coarseFreight`.
- **WP6-3. Bot rules.**
  - For each uncovered major incident, call `emergencyOf(sim).dispatchBest(sim, id)` to emulate an attentive player.
  - Flag `--neglect` skips this, to measure failure outcomes.
  - Build a jail when `justice.overflow > 0.25`, a bus depot when `busesNeeded > 1.1 × buses`, and a fire station or clinic at `uncoveredHotspots(sim, r)[0]` when that responder's uncovered residents exceed 10%.
  - Parking garage is P2.
- **WP6-4. Acceptance additions** (256, seed 7):
  - `|unemployment − (1 − accWeighted)| ≤ 0.02` every year.
  - Auto-dispatched share ≥ 85% of incidents from year 10.
  - Failed ≤ 5%.
  - `justice.overflow ≤ 0.2` from year 20.
  - Bot police coverage at homes within ±0.05 of baseline.

---

## WP7: Facility completeness (full design; runs after WP1–WP4 and WP8 merge)

**Owned files**
- New: `src/sim/infra/facilities.ts` (tables, `facilityReport`, op and use factors), `infra/justice.ts`, `infra/parking.ts`, `infra/ferry.ts`.
- Modify:
  - `services.ts`: police tier tables and need raster; skip generic coverage for the depot, garage, unlinked ferries and unattached stations.
  - `traffic.ts`: bus fleet waits, park & ride, parking penalty, car-less, ramps, trucks, ferry stops, public getters, `freightRailCells()`, patrol model hints.
  - `transit.ts`: Ferry mode in `collectStops`, bus service factors.
  - `search.ts`: ferry node block, ramp array.
  - `catalog.ts`: honest descriptions; remove the fake `coverage` of the garage and depot.
  - `params.ts` §FACILITIES.
- WP7 does not edit UI, desirability, demand or `simbot` files; it relies on the hooks listed above.

**WP7-1. Police capacity**
- Need per cell: `(res + 0.5·jobs)·(0.5 + st.crime)`, in crime-weighted people.
- `POLICE_CAP`: kiosk 6,000; station 30,000; HQ 110,000.
- Calibrate so bot coverage at homes stays within ±0.05 of baseline.
- Fills `stats.needs.police`.
- Report: "Patrol load 18,400 / 30,000 (61%) · cars 2 (1 out) · arrests 14/mo".

**WP7-2. Justice (`justice.ts`, monthly)**
- Arrests: `arrests = ARREST_K·arrestPotential + emergency.lastMonth.arrests`, with `ARREST_K = 0.004`.
- Jail share: `sentenced = arrests × smoothstep(5k, 40k, pop)`.
- Stock: `inmates += sentenced − inmates/SENTENCE_MONTHS` (12).
- Capacity: `beds = Σ JAIL_BEDS` (civ_jail 2,500) × funding; `holding` = kiosk 5, station 25, HQ 100 per month.
- `overflow = max(0, 12·sentenced − beds − holding) / max(1, 12·sentenced)`.
- Factors: `policeMul = (1 − 0.3·overflow) × (courthouse ? 1.08 : 1)`; `crimeMul = 1 + 0.15·overflow`.
- Continuity check: 60k with no jail gives overflow ≈ 0.7 and policeMul ≈ 0.79 (the legacy rule was 0.75); 25k gives ≈ 0.87.
- Occupancy > 1.2 for 3 months: 25% chance per month of `emergency.spawn('prisonRiot')`.
- Writes `stats.justice` and `systemData.justice { inmates }`.
- Report: "Inmates 1,640 / 2,500 (66%) · arrests 140/mo · releases 137/mo". City line: "Jail 82% full".

**WP7-3. Staffing (`facilityOpFactor`)**
- `staff = b.jobs / def.jobs` (1 if `def.jobs = 0`); `op = 0.6 + 0.4·staff`.
- `BF.Understaffed` when staff < 0.6, with a report hint ("workers can't reach it").

**WP7-4. Health and schools display**
- Hospitals: "Beds x / y" using `capacity / 200` patient-equivalents per bed. Clinics: "Patients x / y". Both add "seniors in catchment", the ambulances from WP8, and an overcrowding warning at utilisation > 1.15.
- Schools: "Pupils 1,234 / 1,500", with an unreached count from WP2.

**WP7-5. Bus fleet**
- Fleet: `MINIBUS_FLEET = 8` with no depot; each depot `40 × min(1.25, funding)`.
- Stops are assigned to the nearest depot by a multi-source road BFS (range 90 cells). The BFS reruns on graph rebuild or depot change.
- `busesNeeded = Σ stop riders / 500`.
- Service ratio `ρ = fleet/needed`, clamped to [0.35, 1.25]; bus base wait `/= ρ` in `prepTransit`.
- Early game has ρ ≥ 1, so this is neutral.
- Reports:
  - Depot: "Buses 34 / 40 · 57 stops · 18,600 riders/day".
  - Stop: "Riders 420/day · wait 6 min · North Depot".
  - No depot: "Minibus service only (8 buses)".

**WP7-6. Stations must be connected.** A subway or train station with `stAttC = 0` gives no `transitCov` and shows a "Not connected" warning. `traffic` exposes `stopAttached(id)` and `stopLoad(id)`.

**WP7-7. Parking pressure (`parking.ts`, every second traffic cycle)**
- Demand D per cell: car arrivals at job sites plus 0.5 × car shopping trips, splatted on the footprint. Accumulate `jCarIn` in `roundMatch`.
- Supply S per cell: by zone density 60 / 30 / 10 cars/day, civic 20, plus 900 per garage within walk radius 6.
- `parking = smoothstep(1.0, 2.5, blur3(D) / blur3(S))`.
- Car time of pieces matched to a site `+= 5 min × parking(site)`.

**WP7-8. Park & ride**
- A garage works as park & ride when a transit stop is within 5 cells (+ half footprint).
- Search: one reverse road search per second cycle, seeded at garage entries with label `1.5 + walk + wait + distT(stop)`, limit 40 min.
- Each origin gets its best option (`oPrT`, `oPrG`, `oPrJob`), used in the logit wherever `oTrT` is used. Car leg distance ≤ 12 min.
- The car leg is accumulated on the park & ride forest; riders join the transit forest at the garage's stop.
- Garage crowding: penalty `6·max(0, load/900 − 0.9)·10` minutes next cycle.
- Car-less workers (WP1-4) pay +12 min on the car and park & ride options (taxi / lift).
- Report: "Park & ride 612 / 900 · 612 commuters switched · relieves parking for 14 blocks". Warning without a stop: "No transit stop within 5 tiles".
- `stats.transitFleet.parkRide`.

**WP7-9. Ferries (`ferry.ts`)**
- `collectStops` adds Ferry mode.
- Links: water BFS from each terminal's front water cells within the same water component, ≤ 140 cells, to its 3 nearest partners. Recomputed on terminal or terrain change only.
- `TransitNet` gains `nFerry`; `total = nR + nRail + nSub + nFerry`. In `transitSearch`, nodes ≥ `nR + nRail + nSub` have no grid adjacency, only transfers.
- Edges: road-attached stop ↔ ferry node costs walk + 6 min wait; ferry i ↔ j costs cells × 0.05 min.
- Crowding capacity 3,000 riders/day.
- An unlinked terminal gives no `transitCov` and has no tourism visits (WP4 `op_f × linked`).
- Report: "Routes: Harbor Terminal (9 min) · riders 1,200/day".

**WP7-10. Highways**
- Ramp time `RAMP_BY_NET[t] × min(8, 1 + 0.15·(v/2400)^4)` on the non-highway cell (Road 0.45, Avenue 0.25, OneWay 0.35). Implemented as a per-node ramp array passed to `roadSearch`.
- Trucks: time × 1.15 on non-highway cells, computed in the freight search (trucks prefer highways).
- `traffic.freightRailCells()` lists cells on freight train routes.
- Reports: "Interchange load 84%" on ramps via query; highway cells show volume and trucks.

**WP7-11. Airports and seaport (`facilityUseFactor`)**
- Airport passengers/day: `0.012·pop^0.95` + WP4 overnight visitors. Capacity: small 3,000, large 25,000.
- Seaport use: trucks reaching the port sink divided by 3,000/day.
- `use factor = 0.6 + 0.4·smoothstep(0, 0.5, use)`, applied to cap relief and freight boost (WP4-3) and to income.
- Reports: "Passengers 11,200 / 25,000/day", "Throughput 1,900 trucks/day".

**WP7-12. Patrol model hints.** Patrol routes carry a model hint (police → `car_police`, garbage → `garbage_truck`). `SampleRoute.model?`; a one-line `VehicleRenderer` read of the hint.

**WP7-13. Catalog honesty.** Rewrite the descriptions of the depot, garage, ferry, jail, courthouse, airports and seaport. Remove the fake coverage from the garage and depot (the auto-overlay moves to Transit via WP5).

**WP7-14 (P2).** Stadium event days (visits × 5 every 7th day through WP4's `tourismTrips` hook). Airport flight-path noise line (12 cells beyond each runway end, 0.35).

**Every facility has an owner and a checked effect**
| Facilities | What makes them work |
|---|---|
| Power plants | load (WP3) |
| Water facilities | quality (WP3) |
| Landfill, recycling, incinerator | fill, diversion, burn (WP3) |
| Police | capacity (WP7) + cars (WP8) |
| Jail, courthouse | justice (WP7) |
| Fire | prevention coverage (WP2) + trucks (WP8) |
| Clinics, hospitals | patients and beds (WP2 + WP7) + ambulances (WP8) |
| Schools, library, museum | seats (WP2) |
| Parks | play/green capacity (WP2) + attraction (WP4) |
| Civic and landmarks | prestige, approval, tourism (WP2, WP4) |
| Rewards | stigma, crime spill, pollution, campus (WP2, WP3) |
| Bus stop, depot | fleet (WP7) |
| Subway, train | connected + ridership (WP7) |
| Garage | park & ride + parking relief (WP7) |
| Ferry | links (WP7) |
| Airport, seaport | use (WP7) |
| Highway, rail | ramps, noise, stigma, freight (WP2, WP3, WP7) |

**Tests**
- `tests/infra/facilities.test.ts`: a matrix over every non-hidden ploppable def.
  - Place it with road, power and water, run 60 days.
  - `facilityReport` has ≥ 1 line, and the def's declared effect metric changes (a table maps def → metric: layer, stat or trips).
  - This is the "every facility genuinely works" gate.
- `tests/infra/justice.test.ts`: 60k city with no jail gives overflow ≥ 0.5 and policeMul ≤ 0.85; adding a jail gives overflow 0 within 3 months and avgCrime ≥ 5% lower; inmates ≈ 12 × arrests ±20% after 2 years.
- `tests/infra/transitFacilities.test.ts`:
  - No depot at 60k riders gives wait ≥ 1.7× base; a depot brings it to ≤ 1.25×; a stop beyond 90 cells is unaffected.
  - A garage beside a subway stop gives park & ride > 0, cars into the downtown block drop ≥ 10% and parking pressure drops; a garage without a stop gives 0.
  - Ferries across a lake with no bridge carry trips; terminals on different water bodies are not linked.
  - A saturated single interchange raises commute; a second interchange lowers average commute by ≥ 5%; an avenue ramp beats a road ramp.
  - An unused seaport gives factor 0.6.
  - Perf: every step ≤ 3 ms estimated, added ≤ 0.7 ms/day.

**Per-day cost (≈ 0.7 ms/day worst case)**
| Work | Cadence | ms/day |
|---|---|---|
| Police tier | 15 d | ≈ 0.13 |
| Parking raster | every 2nd cycle | 0.15 |
| Park & ride search | every 2nd cycle, only with garages | 0.3 |
| Ramp and truck arrays | per cycle | 0.08 |
| Depot and ferry BFS | on change | ≈ 0.02 |
| Justice | monthly | ≈ 0 |

---

## WP8: Emergency dispatch (full design; runs in parallel with WP1–WP4 after Phase 0)

**Owned files**
- New: `src/sim/infra/emergency.ts`, `src/game/tools/DispatchTool.ts`, `src/ui/EmergencyBanner.ts`, `src/ui/panels/EmergenciesPanel.ts`, `src/ui/emergency.css`, `src/render/city/vehicles/EmergencyVehicles.ts`, `src/audio/sirens.ts`.
- Exclusive: `fire.ts`, `disasters.ts`.
- `params.ts` §EMERGENCY.
- Targeted edits: see the shared-file table below.

**WP8-1. Time model (fixes F10 while keeping F5 passing)**
- `EMERG_DAYS_PER_MIN = 1.0` sim day per game-minute of siren driving.
- Siren link time: `t0·(1 + 0.3·(bpr − 1))`, read from `nodeTimes`.
- **LIVE mode.** While `manualActive > 0` and the policy is `'live'`, the UI sets `sim.speed = 1` and `sim.liveSlowdown = settings.emergencyLiveSlowmo` (default 3, which is 1.5 s/day; 1 gives pure 1×).
  - A far manual dispatch of about 8 min takes 8 days, about 12 s of real time.
  - Headless results are unaffected; only real-time pacing changes.

**WP8-2. Fleets**
- `FLEET` table (lives in `emergency.ts`, no catalog edit):
  - fire station 2 trucks, fire HQ 5;
  - police kiosk 1 car, station 2, HQ 6;
  - clinic 1 ambulance, hospital 3, medical center 6.
- Effective units: 0 if funding factor < 0.25, else `max(1, round(units·min(1.2, f)))`.
- Unpowered station: turnout +0.5 day.
- Each station's auto range: `RANGE_s = covRadius × ROAD_RADIUS_FACTOR × NET_TIME[Road] × 1.25` minutes. Examples: fire station 3.9, fire HQ 6.2, clinic 2.6, hospital 5.85.

**WP8-3. Response layers (scheduler task `'emergency.response'`)**
- Per responder: a forward multi-source `roadSearch` from stations with seed label `RMAX − RANGE_s` (`RMAX = 12`), then a land fill-in step.
- `resp*[c] = RMAX − dist`, so slack ≥ 0 exactly when some station reaches the cell within its own range.
- 3 search steps + 1 fill step, each ≤ 2.2 ms. Period 30 days; dirty on station or network change (within 3 days); also computed in `init()`.
- Exports `responseAt(sim, cell, r)` and `uncoveredHotspots(sim, r, n)` (coarse 8×8 blocks × residents).

**WP8-4. Incident generation (deterministic; own RNG, state saved)**
- Monthly: build cumulative weight arrays over candidate buildings, O(buildings).
- Daily: Poisson draw per kind with λ/30; pick the building by binary search.
- Rates:
  - **Fire:** `fire.ts` ignition, with risk × (1 + 1.5·garbage).
  - **Medical:** 1/20,000 per resident-month × (0.6 + 2.7·seniorShare), seniors from `cohortShares`. 20% are major (mass casualty, 3–8 injured).
  - **Crime spree:** 1/12,000 per occupant-month × min(1, ((crime − 0.3)/0.4)²). 25% are major.
  - **Industrial accident:** I-D 1/100k per job-month, I-M 1/200k, I-HT 1/800k; thermal plants and the incinerator 0.01/month × (1.5 − min(1.2, utilities funding)).
  - **Spill:** I-D 1/400k per job-month; toxic dump 0.03/month; seaport 0.01; freight station 0.005; congested (> 1) highway cells 2e-7 per truck-cell-day.
  - **Riot** (pop ≥ 20k): p/month = 0.2·smoothstep(40, 20, approval)·smoothstep(0.4, 0.65, avgCrime), placed at the worst crime × occupants block.
  - **Prison riot:** from WP7.
  - **Collapse:** from disasters.
- Major kinds: fire, industrial, spill, riot, collapse, prisonRiot, plus major medical and major crime.

**WP8-5. Dispatch (at most 4 searches per day; the rest queue for the next day)**
- Reverse `roadSearch` seeded at the incident's perimeter road nodes, limit `RMAX`.
- Auto if a station of the needed type has a free unit and `t ≤ RANGE_s`; pick the minimum t.
- Path: follow `S.next` from the station node. Store per-cell cumulative time.
- All units busy but one returns before the grace ends: state `'queued'`.
- Otherwise `'uncovered'` with reason `busy` / `outOfRange` / `noStation`, and `manualPossible` = any station of the type with a free unit within 60 min.
- Minor uncovered incidents are auto-sent from the nearest free unit at any range (worse outcome, no alert).
- Units needed:
  - fire: 1 + floor(burning/3); industrial and collapse: fire 1 + medical 1; spill: fire 1;
  - crime: police 1; riot: police 2 + floor(r/3); prison riot: police 3; medical: medical 1.
- After on-scene work, vehicles drive back along the same path and are busy until they return.
- Medical: after 1 day on scene, a clinic ambulance drives to the nearest hospital first.

**WP8-6. Outcomes (grace G and deadline in days)**
| Kind | Rule |
|---|---|
| Fire | Legacy burn-down at 6 days when no unit is on scene (keeps F5). Spread stays at legacy `FIRE_SPREAD_P`, × 0.2 while a unit is on scene, × 1.3 if not watered. Each unit-day on scene removes 1/(1.5·√area·(watered ? 1 : 1.6)) of heat. Neighbour fires within 3 cells join the cluster incident. Loss § = def cost, or capacity × 40. |
| Medical | survival = 0.97 − 0.67·smoothstep(5, 16, D) − 0.1 if the nearest hospital's utilisation > 1.15. Deadline 16. |
| Crime | G 5, deadline 20. Resolved: 1–4 arrests. Failed: CrimeBoost radius 4, 0.15 for 90 days. |
| Riot | radius r = min(7, 2 + 0.3·D). Per day inside r: health −0.03 and 2% ignition per building (cap 2/day). CrimeBoost 0.3 over r + 2 while active, then 0.15 for 60 days. `riotDays++`. 3 days on scene. 10–40 arrests. Deadline 30. |
| Industrial | Ignites a fire if unanswered after 3 days. |
| Spill | Pollution source (water 0.6, air 0.3, radius 4) while active. 4 days on scene. Deadline 30. |
| Collapse | G 5, deadline 15; deaths grow with delay. |
| Prison riot | Deadline 20. Failed: 30% of inmates escape and crime +10% for 90 days. |

- `medScore`: 12-month EMA of `D ≤ G ? 1 : max(0, 1 − (D − G)/11)` over medical incidents.
- All outcomes accumulate into `stats.emergency`. Monthly roll: `month` → `lastMonth`, plus a year sum.

**WP8-7. `fire.ts` rewrite (keeps the public API)**
- Keep `fires`, `ignite`, `extinguish`, `firesThisMonth` and `riskBoost`.
- Every ignition goes to `emergencyOf(sim)?.onFire(sim, b, spread)`. If the emergency system is absent, the legacy path stays.
- `putOut` is driven by emergency resolution. Drop the random service route.
- `infraFires` save entries gain `incidentId`.
- Keep the `disaster` fire events and the `'disaster'` news kind.

**WP8-8. `disasters.ts` hooks**
- Earthquake: destroyed buildings with occupants spawn `collapse` (max 12).
- Tornado: `medical` incidents along the path (max 6).
- Meteor: 3 `medical` near the crater.
- Public `spawn(sim, kind, x, z, opts)` for sandbox and tests.

**WP8-9. Persistence.** `systemData.emergency = { v: 1, nextId, rng, incidents[], vehicles[] }` as plain arrays. Paths are `number[]` of at most 400 cells; times rounded to 0.01.

**WP8-10. Exports**
```ts
EmergencySystem: incidents(); vehicles(); stationFleet(id): { type; total; free; out } | null;
  dispatchOptions(sim, incidentId): { stationId; name; responder; free; etaMin; etaDays }[];  // full-map search, cached 3 days
  dispatch(sim, incidentId, stationId, units = 1): { ok; reason?; etaMin? };
  dispatchBest(sim, incidentId);
  spawn(...); report(sim, x, z); stats(); onFire(...)
FLEET, INCIDENT_LABEL, INCIDENT_COLOR, emergencyOf, responseAt, uncoveredHotspots, emergencyPollution, emergencyCrimeBoosts
```

**WP8-11. User interface**
- **`EmergencyBanner`:**
  - Shows at most 3 banners. Major incidents only by default; setting `'all'`. 15-day cooldown per kind; no alerts below pop 1,000 except fires.
  - Each banner: kind colour and icon, title, place (the building def name and x,z), reason ("All 2 trucks of Fire Station #3 are busy"), and a countdown to the deadline.
  - Buttons: **Jump**, **Send nearest (ETA 6.3 min)**, **Choose station…** (opens the `DispatchTool`), and dismiss.
  - Speed policy on `uncovered` with `manualPossible`:
    - `'live'`: remember the previous speed if it was > 1, set speed 1 and apply `liveSlowdown`.
    - `'pause'`: set speed 0.
    - `'ignore'`: no speed change.
  - When `manualActive` returns to 0, restore the previous speed if the player did not change it, and show a toast.
  - The policy is a pure function `speedPolicy()` so it can be tested.
- **`DispatchTool`:** highlights stations of the right type with free units and a tooltip showing the ETA; previews the path; click sends 1 unit, shift-click sends all free units; Esc cancels.
- **`EmergenciesPanel`** (id `'emergencies'`), with three tabs:
  - Active: kind, state, units, ETA, severity, jump and dispatch.
  - Fleet: per station free/total and funding.
  - Statistics: this month and 12 months — counts by kind, auto/manual/late/failed, average response per responder, deaths, injured, buildings lost, damage §, arrests.
- **`EmergencyVehicles`:** one InstancedMesh per model (`fire_truck`, `car_police`, `ambulance`) plus alternating red/blue light quads at 3 Hz. Incident beacon ring at the site. At most 48 vehicles. Positions come from `getEmergencyVehicles()` and `simTime()`.
- **`sirens.ts`:** 3 voices through `audio.getSfxOutput()` — wail for fire, yelp for police, hi-lo for ambulance. Gain by camera distance, pan by screen x, silent when paused. `AudioEngine.ts` is not edited.

**WP8-12. Shared-file edits (re-read the file first; small hunks only)**
| File | Edit |
|---|---|
| `CityScene.ts` | 3 hunks: create the banner and register the panel; pass `getEmergencyVehicles` / `simTime` into the objects context; feed sirens in the ~2 Hz ambience tick |
| `CityObjectsView.ts` | 4 hunks: construct, update, `setState`, dispose |
| `toolCatalog.ts` | 1 hunk: `dispatch` spec and `findToolSpec` |
| `settings.ts` | `emergencyUncovered: 'live'\|'pause'\|'ignore'` (default `'live'`), `emergencyAlerts: 'major'\|'all'` (default `'major'`), `emergencyLiveSlowmo` (default 3) |
| `SettingsPanel.ts` | 3 rows |
| `TopBar.ts` | emergencies button with badge; "LIVE" badge in the speed group |

**WP8-13. Tests**
- `tests/infra/emergency.test.ts`:
  - A covered fire is auto-dispatched the same day; the path runs from the station perimeter to the site; it resolves; `auto = 1`; `responseMin > 0`.
  - `environment.test.ts` still passes unchanged.
  - No station gives `uncovered` with `noStation`; the building is Burnt by day 6; `failed = 1`.
  - Two trucks and three fires in range: the third gets `busy`; a manual `dispatch` from a far station succeeds; ETA is monotonic in distance; dispatching from a busy or unreachable station returns `ok: false` with a reason.
  - Medical survival falls with delay. A district with 3× seniors gets ≥ 2× medical incidents over 5 seeded years.
  - Riots occur only when approval < 35 and crime > 0.45; 2 police units resolve them; an unresolved riot raises crime and lowers health.
  - `resp*` slack ≥ 0 exactly where auto-dispatch happens (200 random cells).
  - A save and load mid-response gives the identical outcome log; two runs with the same seed give identical logs.
  - Perf: on the stress city over 5 years, average ≤ 0.3 ms/day, maximum day ≤ 3 ms.
- `tests/game/emergencyPolicy.test.ts`: `speedPolicy` restores speed; alert queue limit and cooldown.

**WP8-14. Per-day cost.** Response layers 0.22 ms/day, generation 0.02, dispatch searches ≤ 0.05, vehicles ≈ 0: about **0.3 ms/day**.

---

## Coordination

**Shared-hunk ownership in phase 1** (Phase 0 → P0b → WP1 ∥ WP2 ∥ WP3 ∥ WP4 ∥ WP8)
| File | Who edits what |
|---|---|
| `traffic.ts` | WP1: the `oW` line + `inboundTotal` getter. WP8 edits nothing (uses P0-7). |
| `common.ts` | WP1: `jobSlots`. WP2: `DefInfo`. |
| `params.ts` | Sections as assigned: §CATCHMENTS (WP2), §POLLUTION / §UTILITIES / §CRIME (WP3), §EMERGENCY (WP8), §FACILITIES (WP7). |
| `tuning.ts` | Employment section: WP1. §REGION: WP4. |
| `ordinances.ts` | WP3 only, after P0-12. |
| `crime.ts`, `pollution.ts`, `utilities.ts` | WP3, calling WP7/WP8 stubs. |
| `fire.ts`, `disasters.ts`, `emergency.ts` | WP8. |
| `systems/infra.ts` | Phase 0 only. |

**Phase 2** (WP5 ∥ WP6a ∥ WP7) touches disjoint files: UI / desirability, growth, bot / services, traffic, transit, search, catalog. WP6b runs last.

**Merge order:** P0 → P0b → WP3 → WP2 → WP1 → WP4 → WP8 → WP7 → WP6a → WP5 → WP6b. WP5 and WP6a can merge earlier behind the stubs.

**Updated added cost (ms/day)**
| WP1 | WP2 | WP3 | WP4 | WP5 | WP6 | WP7 | WP8 | Total |
|---|---|---|---|---|---|---|---|---|
| 0.14 | 0.75 | 0.30 | 0.06 | 0.02 | 0.48 | 0.70 | 0.30 | ≈ 2.75 worst case, ≈ 2.2 typical (cap 3.0) |

**Check of the player's factors (source → spread → who is affected → effect → feedback)**
- **Water:** WP3 supply and quality → WP1 health, needs and HQ → WP4 approval → WP8 slower firefighting without water → WP5 overlay and chips.
- **Electricity:** WP3 load, priority, nuclear ordinance → WP2 power gating → WP8 plant accidents.
- **Noise:** WP3 per network, freight rail via WP7, construction, buffers → WP1 sleep → WP6 desirability → WP4 approval.
- **Smoke:** WP3 per source plus fires and spills from WP8.
- **Garbage:** WP3 truck range, fill, smell → WP8 fire risk.
- **Attraction:** WP4, with WP7 ferry, airport and stadium use.
- **Land value:** WP6, including riot crime from WP8 and stigma from WP2.
- **Demographic proximity:** WP1 + WP2 (police tier included); car-less residents to transit is now real via WP1-4 and WP7-8.
- **Regional play:** WP4-1 plus WP1-1(d).