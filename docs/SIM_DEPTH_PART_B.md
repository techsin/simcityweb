# Sim depth PART B contract — WP7a ∥ WP7b ∥ WP5 ∥ WP6a, then WP6b

Lead survey 2026-09-28 on 400387e (sim = part A 0825695) + the §8 glue edits. Read with docs/SIM_DEPTH_SPEC.md,
docs/SIM_DEPTH_AMENDMENTS.md (the WP5-n / WP6-n / WP7-n items quoted here are part of this contract) and
docs/SIM_DEPTH_CONTRACT.md; this file wins where they disagree. [A] = open part-A item; [QA] / [art] / [perf] = routed.

## 1. The integrated tree (read from the code)
- `npx tsc --noEmit` clean; `npx vitest run` 45 files / 339 tests green (98 s, default timeout). Numbers: §6.
- All 13 part-A review mustFix items are in the code with tests: WP3 sea edge share, brownout in its own steps, bot
  garbage planner; WP2 sequential seat filling (+ monotonicity tests), transit reset; WP1 old-save EQ seeding (+
  serialize regression); WP4 serviceGaps / gapMax, venue road rule; WP8 fire persist, failed medical call scores 0,
  node search budget, no burn-down before the first truck, traffic's road graph.
- Accepted part-A deviations (now the spec): WP1 needs penalty ramps 5k → 60k residents, never abandons alone, 64-day
  cohort cadence; WP2 sequential seat filling, NIMBY every 2nd pass; WP3 garbage build-up 0.14/month, youth curfew keeps
  −10 % city crime, no water-tower storage (WP3-6, P2); WP4 migration neutral rises with size, CS_JOBS_PER_VISITOR 0.5,
  approval gaps capped at −10; WP8 fire grace 4 days, medical centre 6 ambulances, "manual" = can arrive in time.
- APIs to build on (never re-implement them):
  - demographics.ts: cohortShares, profileShares, householdForm, workerShare, carlessShare, waterRequired, family /
    senior / studentScoreAt, needsOf (incl. 'water'), needsPenalty, needsExpectation, tapWaterAt; population.ts
    conditionBreakdown (real); stats.cohorts / cohortsByWealth / workforceRatio are written.
  - catchments.ts: tierLayer, facilityLoad(sim, id) → {capacity, demand, utilization, served, seated, operating, powered,
    radius, metric}, unservedClusters(sim, tier, max), registerTierProvider(tier, {needOf, capacityOf, shared});
    ServicesSystem.needRaster / policeMul / policeFx; nimby.ts nimbyAt. stats.needs.* is written for every tier
    (police / fire: need = residents, capacity 0 = capacity-free).
  - WP3: UtilitiesSystem.plantLoad / producerInfo, waterQualityAt(sim, cell); PollutionSystem.garbageInfo / landfillInfo /
    incineratorShare / garbageSummary / emissionOf; windVector / windFromLabel; seaMask / shoreCells / waterNear;
    CrimeSystem.termsOf. Hooks already waiting for WP7: pollution reads traffic.freightRailCells?(), tourism reads
    traffic.stopAttached?(id), crime.ts applies justiceFactors().crimeMul and calls addArrestPotential.
  - WP4: ATTRACTIONS, venueOp / venueIssue / venueVisits, attractivenessBreakdown, tourismSummary, tourismTrips,
    approvalBreakdown, residentSurvey, serviceGaps, capHints, regionInputs, econData.regionTerms, income keys 'tourism'
    / 'recycling'. WP8: emergencyOf(sim) {dispatch, dispatchBest, spawn(sim, kind, x, z, opts), stationFleet(id),
    stationList(), incidents(), stats()}, responseAt(sim, cell, r), uncoveredHotspots(sim, r, n), FLEET, resp* layers.
- Still stubs: facilityReport (null), facilityOpFactor / facilityUseFactor (1), justice.ts (legacy 0.75 jail rule),
  desirabilityBreakdown (no terms; desirability is still the 17-term phase-0 model), landValueBreakdown ([]),
  growthLimits (legacy), overlayLayer for Overlay 17–25 (null), the 25 new history series (zero-padded), stats.justice /
  transitFleet, st.parking, BF.Understaffed. The UI reads only approvalBreakdown, capHints and WP8's own views.
- Bot (seed 7, deterministic): 128×15 = 186,346 (1.18× phase0; approval 65, EQ 99). 256×60 stays at or above phase0 up
  to 627k in 2034, then stalls at 636–653k (2040 0.82×, 2060 652,568 = 0.66×; approval 60 vs 66, EQ 122 vs 147 by design):
  from 2029 ensureWater wants a treatment plant each month but placeUtility always fails (1 free block, funds 1.4M),
  so supply stays at ~234k kL/day and demand passes it in 2035; since WP1 dry dense homes are unhappy (correct — the
  phase0 bot also ran dry after 2040, unpunished): abandoned growables 32 → 4,269 (2045), R demand → 0. The bot builds
  no jail (policeMul 0.75 for 60 years), no playground (play capacity 0), few colleges (9 % served); unemployment is 0.
- Player path regressed [QA "growth ~42 % below HEAD"]: the demo-ui town (leadtown.ts: demo builder, river map, no
  landfill) stalls at ~1.9k from day 360 vs 5.0k on phase0 (−62 % at day 1,440): WP3's uncollected piles (st.garbage,
  +0.14/month) now meet the phase-0 garbage weights (desirability R −0.3 / −0.4 / −0.6, land value −0.25) — day 360 R
  desirability 0.16 / −0.16 / −0.69 vs 0.33 / 0.12 / −0.35, health 0.38 vs 0.60, NoGarbage on 222 of 254 homes vs 9 —
  only WP3's periodic news explains it (from 1,000 residents); the advisor rule needs pop > 2,000 and stays silent.

## 2. Rules for every part-B package
- Ownership (§3) is exhaustive: files not listed for you are read-only; in a shared file touch only the named hunk,
  re-read it right before each edit and use small targeted Edit replacements (QA/UI, render-perf, art and soundtrack
  teams are active in src/ui, src/game, src/render, src/audio; the WASM team in src/wasm, wasm/, tools/build-wasm.mjs,
  package.json). No git state changes, no new npm deps. Need a change in someone else's file? One line in your report.
  Per-def data goes in your own tables keyed by def id (catalogTypes.ts and common.ts are read-only).
- The four packages share one working tree and run concurrently: keep `npx tsc --noEmit` clean after every edit batch;
  hand off only with the full `npx vitest run` green (at load > 50 add --testTimeout=120000: the 5 s default then times
  out ~20 slow tests). §4 signatures are frozen — extend with optional fields only.
- src/sim/** stays headless (no DOM / three.js); per-cell work in typed arrays; every scheduler step ≤ 3.0 ms estimated
  and measured (bundled node run, not vitest) with an honest cost(); added ms/day within your §6 budget.
- Determinism: no Math.random / Date.now in the sim; no new sim.rng draws on existing paths (one extra draw moves the
  chaotic bot's year-60 population by ±15 %); take variety from position hashes, e.g. ((x·73856093) ^ (z·19349663)) >>> 0.
- Saves: persistent state in st.systemData.<yourKey> (structured-clone, defaults when absent); derived layers recomputed
  in init(); Building fields via Math.fround; old saves load (tests/save/* green); round-trip test for what you persist.
- Fun > realism: every new effect has a reader — WP7a / WP7b a facilityReport line or warning with a fix hint, WP6a a
  FactorTerm, WP5 renders them. No hidden multiplier may cost the player without a visible cause.
- Bot / perf: tsx is missing — `node_modules/.bin/rolldown <driver>.ts --platform node --format esm --dir <out>`, then
  node (driver names must not contain "simbot"). Drivers to copy from scratchpad/simB/lead/snap2/tools/: leadrun
  (bot + yearly stats), leadsync (two bots in lock-step for a fair A/B), leaddiag, leadperf / leadcost (stress city,
  scheduler cost vs CPU), leadtown / leadtick (demo-ui town growth / tick cost), leadwater. The box is shared (load 12–90
  in this survey): A/B in one session vs the pre-change snapshot or phase0 (`git archive a284b80`); compare ratios only.
- Browser checks run against a snapshot (tar or cp -r — rsync is not installed); look at every screenshot you take.
- Hand-off report: files (hunks), tests, tsc + full vitest, bot 128×15 / 256×40 s7 A/B (pop, approval, EQ, ms/day),
  added ms/day and max estimated step, what the player now sees, open items for WP6b.

## 3. File ownership
| Files / hunks | Owner |
|---|---|
| infra/facilities.ts, infra/justice.ts; params.ts §FACILITIES and the "WP7a share" term of INFRA_DAY_BUDGET | WP7a |
| catalog.ts entries of the 64 non-transport ploppables (categories power, water, garbage, police, fire, health, education, civic, park, landmark, reward) and of tr_airport_small, tr_airport_large, tr_seaport | WP7a |
| traffic.ts `interface SampleRoute` (add `model?: string`) and `private patrolRoutes()` only; the one line of VehicleRenderer.ts that reads `model` (render-perf file) | WP7a |
| tests/infra/facilities.test.ts, tests/infra/justice.test.ts; the facility-stub and justice-legacy assertions of tests/sim/phase0Contract.test.ts | WP7a |
| infra/transportFacilities.ts (lead stub, §4), new infra/parking.ts and infra/ferry.ts, infra/transit.ts, infra/search.ts, traffic.ts (all but WP7a's two hunks) | WP7b |
| services.ts transit slot only: the `inf.cov === 5` (SLOT_TRANSIT) branch of the facility collection in prep and `finishTransit()` | WP7b |
| params.ts traffic tables (NET_CAPACITY, NET_TIME, CONNECTION_JOBS, CONNECTION_WORKERS, RAMP_PENALTY), §TRANSPORT, the "WP7b share" term | WP7b |
| catalog.ts entries of tr_bus_stop, civ_bus_depot, tr_subway_station, tr_train_station, tr_freight_station, tr_parking_garage, tr_ferry_terminal | WP7b |
| tests/infra/transitFacilities.test.ts, tests/infra/netTables.test.ts | WP7b |
| infra/overlays.ts, render/world/overlays.ts, TerrainRenderer.ts (overlay-variant plumbing), Effects.ts (uWind hunk), game/context.ts, game/modules.ts (optional Api fields), CityScene.ts (panel registration / wiring hunks), toolCatalog.ts, QueryTool.ts, PlopTool.ts | WP5 |
| src/ui/** except WP8's EmergencyBanner.ts, panels/EmergenciesPanel.ts, emergency.css and the soundtrack's MusicPlayer.ts, musicPlayer.css, uiSounds.ts; new panels/DemographicsPanel.ts; format.ts signedPct | WP5 |
| economy/advisors.ts (keep the QA rules and headline bag), economy/history.ts; actions.ts `setOrdinance` (pass `{ confirm }`) | WP5 |
| tests/infra/overlays.test.ts, tests/sim/history.test.ts, tests/sim/advisors.test.ts; the overlay / history assertions of phase0Contract.test.ts | WP5 |
| economy/desirability.ts, landValue.ts, growth.ts, connections.ts, population.ts; tuning.ts except §APPROVAL, §TOURISM, §MIGRATION, §REGION, §DEMOGRAPHICS, §EMPLOYMENT; tools/simbot.ts; actions.ts the plopped Building literal (~L588); tourism.ts monthly scan (perf only) | WP6a |
| tests/sim/desirability.test.ts, tests/sim/growth.test.ts, tests/sim/botRules.test.ts | WP6a |
| tests/sim/balance.test.ts, tests/sim/fixtures/balance-baseline.json (add a `partB` set; keep `phase0`) | WP6b |

Read-only in part B: CityState.ts, Simulation.ts, serialize.ts, systems/*, catalogTypes.ts, common.ts, demographics.ts,
catchments.ts, nimby.ts, services.ts (but the transit slot), utilities.ts, pollution.ts, crime.ts, emergency.ts, fire.ts,
disasters.ts, tourism.ts (but WP6a's perf hunk), approval.ts, demand.ts, budget.ts, runtime.ts, ordinances.ts, rewards.ts
and the tuning.ts sections listed above (part-A constants are WP6b's to tune).

## 4. Interfaces (final; stubs exist today)
```ts
// WP7a  facilities.ts / justice.ts (Phase-0 signatures kept)
facilityReport(sim, buildingId): FacilityReport | null  // non-null for every plopped building of a non-hidden
  // ploppable def: title = def.name, role, >= 1 FacilityLine {key, label, value, ratio?, status?, hint?}, warnings[];
  // appends transportFacilityReport(sim, b) lines / warnings (and uses its role when WP7a has none)
facilityOpFactor(st, b): number   // 0.6 + 0.4·staff, staff = min(1, b.jobs / def.jobs) in 0.05 steps; 1 if no jobs
facilityUseFactor(st, b): number  // airports / seaport 0.6 + 0.4·smoothstep(0, 0.5, use) (monthly cache); others 1
facilityDefFacts(defId): FacilityLine[]  // static tooltip facts (units, fleet, beds, seats ...) + transportDefFacts
justiceFactors(st): { policeMul, crimeMul }; addArrestPotential(st, v); JusticeSystem.monthly → stats.justice,
  systemData.justice, BF.Understaffed (set / cleared, buildingChanged on flips)
registerTierProvider('police', { needOf, capacityOf, shared: true })  // at module load → stats.needs.police
// WP7b  infra/transportFacilities.ts (lead stub) + TrafficSystem getters
transportFacilityReport(sim, b): { role?: string; lines: FacilityLine[]; warnings: string[] } | null
transportDefFacts(defId): FacilityLine[]          // buses, spaces, routes ... of the 7 transit defs
freightSinkTrucks(sim, buildingId): number        // trucks/day into a seaport / freight station; -1 = unknown
truckVolumeOf(st): Float32Array | null            // trucks/day per road cell, last cycle (Traffic "Trucks" variant)
TRANSPORT_EFFECT_METRICS: Record<defId, (sim) => number>   // matrix-test metric of each transit def
TrafficSystem.stopAttached(id): boolean; stopLoad(id): { riders: number; waitMin: number; depotId: number } | null;
  freightRailCells(): ArrayLike<number>           // cell indices on freight train routes
stats.transitFleet {buses, busesNeeded, parkRide, parkRideSpaces, ferryRiders, ferryLinks}; st.parking 0..1 (derived)
// WP6a  economy (stub signatures kept; rt may be null — the UI passes
//        sim.getSystem<{ rt: EconRuntime }>('economy.population')?.rt ?? null)
desirabilityBreakdown(st, rt, dev, i): { terms: FactorTerm[]; raw: number; value: number }  // Σ terms = raw; value = stored
landValueBreakdown(st, rt, i): FactorTerm[]                                  // Σ terms = stored land value ± 0.005
growthLimits(st, i, dev): { desStage; popStage; zoneStage; rejected; reason? } // may add optional fields
// WP5   overlays.ts
overlayLayer(st, o, variant = -1); OVERLAY_VARIANTS: Partial<Record<Overlay, string[]>>
computeOverlayValues(state, o, out, variant = -1)
```
Consumers must accept stub output (null / [] / -1 / 0) without errors and show "—" or hide the row.

## 5. Packages
### WP7a — Civic facilities (≤ 0.15 ms/day; INFRA_DAY_BUDGET share ≤ +0.1)
- facilityReport + facilityDefFacts for all 74 non-hidden ploppables (list read from CATALOG; transit defs take their
  lines from WP7b's hooks): schools / library / museum / college / observatory / research "Pupils 1,234 / 1,500",
  unreached, utilisation bar; clinic "Patients x / y", hospital "Beds x / y" (capacity / 200), seniors in catchment,
  ambulances (stationFleet), warning > 1.15 (WP7-4); police "Patrol load 18,400 / 30,000 (61 %) · cars 2 (1 out) · arrests
  14/mo"; jail / courthouse lines + "Jail 82 % full"; fire trucks, responses; power producerInfo; water output, quality;
  landfill / incinerator / recycling (WP3 getters); parks visitors + venueVisits; landmarks / rewards / civic prestige,
  stigma, visits, income, crime spill, pollution; airport / seaport use; a staffing line for every def with jobs.
- WP7-1 police capacity via registerTierProvider (need (res + 0.5·jobs)·(0.5 + crime); kiosk 6k, station 30k, HQ 110k);
  calibrate so bot police coverage at homes stays within ±0.05 of the pre-WP7a tree.
- WP7-2 justice exactly as amended (continuity: 60k without jail → overflow ≈ 0.7, policeMul ≈ 0.79); prison riots via
  emergencyOf(sim).spawn(sim, 'prisonRiot', x, z, { buildingId }). [A] courthouse: drop its police coverage (WP2-4) and
  apply ×1.08 in justice; jail: drop its r64 police coverage (F3), beds only.
- WP7-3 staffing (0.05 steps: unrounded staff flips the seat-filling order between passes, WP2 note); WP7-11 use (airport
  passengers 0.012·pop^0.95 + overnight visitors vs small 3k / large 25k; seaport freightSinkTrucks / 3,000; -1 → 1;
  demand / budget already apply it to cap relief, freight boost, income); WP7-12 patrol model hints; WP7-13 honest text
  for every civic / utility def, [A] incl. "up to 60 MW, by tons burned" (incinerator) and "output halves without
  cooling water" (thermal plants).
- Accept: the facilities matrix (every non-hidden ploppable placed with road / power / water in a small populated city,
  60 days: report non-null with title and ≥ 1 line; its effect metric — a civic table in the test, TRANSPORT_EFFECT_METRICS
  for transit defs, report-only while empty — differs from the same city without it); the WP7 justice tests; staffing
  (no reachable workers → Understaffed, op 0.6, lower coverage, then recovery); two stations beat one overloaded station;
  unused seaport → 0.6 once trucks ≥ 0; bot home police coverage ±0.05 (128×15, 256×20); every step ≤ 3.0 estimated.

### WP7b — Transport facilities (≤ 0.55 ms/day; share ≤ +0.2)
- [A] F1 / P0b-1 never landed: reorder NET_CAPACITY, NET_TIME, CONNECTION_JOBS, CONNECTION_WORKERS to the Network enum
  (Avenue = 3: 2,600 PCU, 0.075 min, connections 5,000 / 4,000; OneWay = 4: 1,600, 0.085, 2,000 / 1,500) and add
  netTables.test.ts; land it first and report the bot delta (128×15, 256×40).
- WP7-5 bus fleet + depots; WP7-6 connected stations (stopAttached / stopLoad; an unattached subway / train station gives no
  transitCov and a warning; [A] tourism already zeroes its visits); WP7-7 parking.ts (st.parking); WP7-8 park & ride ([A]
  consumes carlessShare, WP1-4); WP7-9 ferry.ts; WP7-10 ramps, trucks, freightRailCells ([A] pollution's guarded WP3-4
  hook), freightSinkTrucks, truckVolumeOf; stats.transitFleet; WP7-13 honest text for the 7 transit defs and [A] no fake
  coverage for garage / depot (F2). WP7-14 (P2) only inside the budget.
- Accept: the transitFacilities tests listed under WP7; netTables; report lines + effect metrics for the 7 transit defs;
  traffic's max estimated step ≤ 3.0 (today 3.12 under the perf test's EST_CAP 3.25 exception — at least do not raise
  it); the park & ride search runs only when a garage exists; every new step ≤ 3.0 estimated.

### WP5 — Player feedback (sim ≤ 0.03 ms/day; an overlay raster ≤ 1 ms per refresh on 256², only while shown)
- Spec §F + WP5-1…7 against the §4 stubs. Overlays: every Overlay value shows data with a legend — Parks (all / play /
  green), Commute, Shops, Demographics (children, teens, young adults, seniors, workforce, wealth; raster from buildings
  on demand), Tourism [A], Nimby (prestige − stigma), Soil, Emergency (Fire / Police / Medical from resp*: Auto ≥ 0,
  Slow −3..0, Manual < −3, No station), Parking, Education tiers [A: eduCov tops out at 0.45 with elementary only],
  Desirability (12 DevTypes + Families / Seniors / Students; fixes the render-average vs hover mismatch), Garbage (piles /
  fill), Air with a wind arrow, Traffic + Trucks.
- Inspector "Why?": desirabilityBreakdown top 8 (+ clamp note), conditionBreakdown (+ "Abandons in N days"),
  growthLimits; residents needsOf + 5-bar pyramid; noise / water / garbage rows with the garbageInfo reason incl. noRoad
  [A]; "Fire response: auto, 2.1 min / manual only" (responseAt); "Unsafe tap water"; chips Noisy [A], NeedsUnmet (info
  while needsExpectation = 0) [A], Understaffed, Incident; "No water" only when waterRequired; producerInfo /
  landfillInfo / termsOf rows [A]; facilityReport rendered generically (rows, ratio bar, status chip, hint, warnings).
- Demographics panel (spec); graphs incl. Emergencies and Transit, the RCI signedPct fix; StatsPanel additions (WP5-3);
  RCI tooltip regionTerms and budget lines 'tourism' / 'recycling' [A]; Toolbar / PlopTool tooltips from facilityDefFacts,
  auto-overlays, garage / ferry previews (WP5-5); advisors = spec table + WP5-4, located via unservedClusters /
  uncoveredHotspots; history writes all 25 new series; the nuclear_free_zone confirm dialog through setOrdinance
  `{ confirm }` (WP5-6) [A]; WP5-7 (WP8's files stay WP8's). [QA] the garbage advisor speaks from 300 residents when
  ≥ 20 % of homes lack pickup (today pop > 2,000) and src/ui/demo.ts zones a landfill; [perf] advisors.monthly is 1.4 ms
  (max 18) on the 1.9k demo town — spread the map-scanning rules over the month's days (deterministic day offsets).
- Accept: overlays.test (every Overlay × variant: data length, label, palette), history.test (padding + new series),
  advisors.test (noElementary / schoolOvercrowded / sewage / busFleetShort / noFireResponse fire on synthetic stats with
  coordinates, respect cooldowns), signedPct; screenshots you looked at: each overlay + legend, Why? on an R lot, a shop,
  a school and a jail, the demographics panel, new graphs, an advisor toast, the nuclear confirm; no console errors.

### WP6a — Integration (≤ 0.5 ms/day)
- Spec WP6: desirability terms 17 → 32 with its weights table, cohort weighting (WTZ), commute rescale, wealth-matched
  CS popNear; WP6-2 PARKING (CS$ / CS$$ −0.12, CS$$$ −0.15, CO −0.08; neutral at 0) and I freight from
  traffic.freightAccess(b) ≥ 0 else coarseFreight; the land value formula, lvWaterfront split, re-splat on Burnt /
  Abandoned flips, park splats × parks funding; growth pickDev exponents (2 / 0.4 only if the bot passes), hotel weight,
  gentrification, filtering down; real desirabilityBreakdown / landValueBreakdown / growthLimits (§4); keep
  conditionBreakdown summing to the condition target whenever you change a condition term.
- Bot: ensureNeeds (spec WP6) incl. playgrounds and colleges; dispatchBest on uncovered major incidents (`--neglect`
  skips it); a jail when justice.overflow > 0.25; a depot when busesNeeded > 1.1 × buses; fire station / clinic at
  uncoveredHotspots(sim, r)[0] above 10 % uncovered; landfill / incinerator, treatment plant (sewageTreated < 0.8), tree
  buffers (Noisy > 5 %); [A] the power trap (WP4 note) and edgeOnly placement of services / utilities (WP3 note).
- [QA] growth regression (§1): (a) re-weight the desirability / land-value garbage terms for pile semantics and fade the
  garbage penalties in with town size (like approval's 2k → 20k): a town without a landfill must be told, not strangled —
  the demo-ui town reaches ≥ 0.9 × phase0 (leadtown.ts on both trees); (b) the bot keeps water (then power, garbage)
  ahead of demand: reserve utility land as blocks fill, upgrade pumps to treatment plants in place (8 pumps = 40k kL,
  one plant 50k), shore sites / desalination once unlocked.
- [QA item 7] population.ts occupancy() plopped loop: `b.age += 1;` as its first statement. [art] the actions.ts
  plopped literal: variant = hash(x, z) % MANIFEST_BY_ID[def.model].variants; growth keeps its one rng variant draw, then
  steps to the next variant while a building within 6 cells has the same def + variant; skyline: stage ≥ 6 growth weighted
  by distance to the commercial core (a §GROWTH knob and a 'Downtown' FactorTerm); deep blocks: lots anchored on a
  frontage cell may extend inward so interior zoned cells fill (frontage rule kept). [A] connections.ts: a one-cell road
  stub at the map edge must not count as a neighbour connection. Optional [A]: declare the seven WP1 fields undefined in
  the growth.ts / actions.ts Building literals (stable object shape). [perf] live frames spike on month ticks: on the
  demo town a month-tick day costs 3.4× a normal day (median CPU 6.7 vs 2.0 ms), mostly economy.tourism.monthly 2.2 ms and
  advisors 1.4 ms (WP5) — make tourism's monthly scan incremental; target month-tick / normal median ≤ 2.
  Not part B: seasons (render only) and the R-medium model mix (manifest + catalog models, art team).
- Accept: the spec WP6 tests; plopped aging; 6 plazas get ≥ 2 variants; no same def + variant within 6 cells in a grown
  128 city; interior-cell infill and the stage ≥ 6 distance-to-core share improve on the phase0 tree; bot 128×15 ≥ 0.9 ×
  158,374; 256×60 s7 without a year after 2020 with water or power demand > supply and pop(2060) ≥ 1.15 × pop(2040).

## 6. Budgets and measured numbers
- Part A, A/B in one session (CPU ms/day; phase0 = `git archive a284b80`, same driver): 128×15 s7 run concurrently 7.85
  vs 4.20 (×1.87): headless infra scheduler 4.77 vs 2.54, economy.population +0.98 (WP1), emergency +0.17 (WP8), fire
  +0.09, tourism +0.06, advisors +0.03. 256×60 s7 in lock-step (the two bots wait for each other every year): ×1.64 over
  2001–2038 (1.42–1.97 per year, 1.65 in 2027–38 although that city is smaller) — part A alone is over the §7 gate.
- stressCity(256) + 853 facilities, infra only: utilisation 0.864 of INFRA_DAY_BUDGET 3.15; largest estimated step
  traffic 3.12 (perf test exception 3.25), services 2.66, crime / pollution 2.20, utilities 1.91, emergency.response 1.60.
  Real step CPU per estimated ms (leadcost, same session) is 1.65× phase0's (5.52 vs 3.35): services 8.2 vs 2.1,
  emergency.response 7.8 (new), pollution 4.8 vs 2.9, crime 3.1 vs 2.1, traffic 6.8 vs 6.3, utilities 2.9 vs 2.8 — the
  part-A cost() estimates are optimistic, so a headless day does ~2× phase0's infra work. A full services pass takes
  ~45–60 headless days on this city (every task always due), so headless tests must not expect a 2-day refresh.
  Calibrate every new or changed step with leadcost: its CPU per estimated ms within ±25 % of the utilities task's in the
  same run (utilities still matches phase0: 2.9 vs 2.8), so budgets stay honest on any machine load.
- Accepted part-A re-budgets: WP1 0.5 ms/day (spec 0.12), WP8 0.6 (spec 0.3), WP2 services 0.62 estimated.
- Part-B added cost (ms/day, A/B on stressCity(256) + 853 facilities and on the 256×40 bot): WP7a ≤ 0.15, WP7b ≤ 0.55,
  WP5 ≤ 0.03 (+ ≤ 1 ms per overlay refresh, render side), WP6a ≤ 0.5. INFRA_DAY_BUDGET: raise it only by the estimated
  work you add, WP7a ≤ +0.1, WP7b ≤ +0.2 (3.45 max); stress-city utilisation stays ≤ 0.88.

## 7. WP6b — final balance (alone, after WP7a, WP7b, WP5 and WP6a hand off; may tune any sim file)
- Spec gates, 256 × 60 seed 7: pop ≥ 150k at year 15 and ≥ 950k at year 60 (≥ 0.9 × 985,244 follows); approval ≥ 50 from
  year 30; funds ≥ 0 every year; EQ ≥ 100 by year 30; tourism jobs within ±30 % of the old formula; mean totalMsPerDay
  ≤ phase0 + 3 ms, i.e. a lock-step ratio vs phase0 ≤ 1.50 (5.99 → 8.99).
- WP6-4: |unemployment − (1 − accWeighted)| ≤ 0.02 every year; auto-dispatched ≥ 85 % of incidents from year 10; failed ≤
  5 %; justice.overflow ≤ 0.2 from year 20; home police coverage within ±0.05 of phase0 (same driver, same seed).
- Lead additions: 128×15 s7 ≥ 0.9 × 158,374; 256×60 seed 11 ≥ 0.9 × 932,955; no year after 2020 with water or power
  demand > supply or > 3 % of growables abandoned; the demo-ui town (leadtown.ts, river, 1,440 days) ≥ 0.9 × the phase0
  tree; every task's max estimated step ≤ 3.0 (drop traffic's 3.25 exception); stress-city utilisation ≤ 0.88.
- Order: part A alone already misses the ms gate (§6), so first make every task's cost() honest (leadcost: CPU per
  estimated ms within ±25 % of the utilities task's), re-measure, then tune in the spec's order (R / C biases after the
  commute rescale → MIG_NEUTRAL → NEEDS_PENALTY_MAX → PART_ADULT → EQ_SPAN_STOCK → seats → PICK_* last; APPROVAL.base last).
- Deliver tests/sim/balance.test.ts (only with BALANCE=1: the 128×15 gate), a `partB` set in balance-baseline.json (keep
  phase0) and a yearly table (pop, approval, EQ, HQ, funds, unemployment, commute, ms/day, incidents auto / failed,
  overflow) for seeds 7 and 11.

## 8. Lead glue edits in this survey
- params.ts: §FACILITIES split into §FACILITIES (WP7a) / §TRANSPORT (WP7b); INFRA_DAY_BUDGET gains the two `+ 0` share
  terms (WP7a, WP7b; value unchanged). Stubs: infra/transportFacilities.ts and facilityDefFacts (§4). Neutral; tsc clean.

## Critic amendments (completeness critic, 2026-09-28)

I checked this contract against four sources: the player's requests, SIM_DEPTH_SPEC §F and WP6, SIM_DEPTH_AMENDMENTS WP5–WP7, and the code (24f8609 plus the §8 stubs). The numbers marked "probe" come from a bundled bot driver run on a snapshot of this tree (`scratchpad/simB/critic/snap/tools/criticprobe.ts`). Its 128×15 s7 run reproduces 186,346 exactly. Every item names its owner; [lead] marks a glue decision. Where an item disagrees with an earlier section of this file, the item wins. The functions named below are additions to §4: `transportUseFactor`, `roadCellReport`, `stopsNear`, `ferryPartnersFor`, `ferryLinks`, `advisorIssues`, and `overlayValue`'s new variant parameter. §4's frozen signatures stay unchanged.

### All part-B packages
1. **Unowned files that part-B work must touch.** Exactly these hunks are assigned:
   - `tests/infra/perf.test.ts`, the `EST_CAP` line: WP7b lowers traffic's 3.25 to the value it reaches. WP6b then deletes the exception and adds a stress-city `utilisation ≤ 0.88` assertion (today it is only logged).
   - `src/game/ActionsProxy.ts` `setOrdinance`, and the `CityActionsApi.setOrdinance` declaration in actions.ts (~L79): WP5. The proxy forwards two arguments, so WP5-6's `{ confirm }` would be dropped silently. `FallbackActions` compiles unchanged.
   - `src/ui/EmergencyBanner.ts` `speedPolicy()`, the `src/game/settings.ts` defaults and `tests/game/emergencyPolicy.test.ts`: WP5, for item 27. WP8 is not active in part B.
   - `services.ts` `init()`: one `subwayChanged → this.dirty = true` subscription, owned by WP7b (item 17).
   - `params.ts` `INFRA_DAY_BUDGET`: WP7a's and WP7b's `+ 0 /* … share … */` terms sit on the same source line. Each package re-reads that line and edits only its own term, using the term's unique comment as the Edit anchor.
   - Tests nobody owns that a contracted mechanic legitimately moves: metro, traffic, matching, integration, economy, emergency, grownCity.
     - A package may change a numeric threshold in these tests, with one report line per change.
     - It may never change a direction-of-change or invariant assertion.
     - `environment.test.ts` L151 (`overlayLayer(st, Overlay.Transit).data === st.transitCov`) stays as it is: the default variant of every existing overlay remains the direct layer.
2. **Determinism covers every existing random stream, not only `sim.rng`.** That includes:
   - `TrafficSystem.rand()`: DEST_NOISE in prep, sample routes, patrols.
   - The fire, emergency and disaster RNGs.
   - `CityActions.plantTrees`, which draws `sim.rng` once per cell.

   Rules that follow:
   - WP7a's `patrolRoutes` keeps its exact `rand()` call count; the model hint is a pure function of the station's def.
   - New visual routes (ferries, park & ride) use hashes.
   - The prison-riot roll (25 % a month) is `hash(jailId, monthIndex) < 0.25`.
3. **Save/load.** Every derived value the first post-load day reads is either persisted or recomputed identically in `init()`:
   - use factors;
   - city fill for staffing (item 7);
   - bus service ratio ρ;
   - ferry links;
   - `st.parking`, computed in traffic's warm cycle;
   - arrest potential;
   - WP6a timers.

   Report the post-load divergence of `tests/save/grownCity.test.ts` before and after your package; it must not grow.
4. **Month-tick budget.** All new monthly work counts toward the [perf] target of month-tick / normal median ≤ 2 on the demo town (leadtick): WP7a's justice, staffing flags and use factors; WP5's history and advisors; WP6a's timers. Spread per-building monthly loops over the month with deterministic id-hash day offsets. Each package reports its monthly ms.
5. **Concurrent landing.**
   - Each package runs its bot A/B against a snapshot of the tree minus its own files, so work the others have landed is in both arms.
   - WP7b's F1 reorder lands first and is in every later snapshot.
   - WP6a's gates are measured again once WP7a and WP7b have handed off. WP6b owns the final numbers.
6. **[lead, optional] Split for throughput.**
   - WP6a holds roughly three packages of work. If agents are available, split out a WP6c (bot) that owns `tools/simbot.ts` and `tests/sim/botRules.test.ts`: every "Bot:" bullet, [QA] (b), and items 38–39. WP6a keeps the economy files, and both share WP6a's gates.
   - WP5 splits cleanly in two:
     - WP5a, the data views: `infra/overlays.ts`, `render/world/overlays.ts`, TerrainRenderer, Effects, `context.ts`, DataViewsPanel, `ui/overlays.ts`, QueryTool.
     - WP5b: inspector, panels, graphs, advisors, history, Toolbar / PlopTool, `setOrdinance` wiring.

### WP7a — civic facilities
7. **Staffing measures reachability, not labour supply or power.**
   - `staff = min(1, b.jobs / (def.jobs × (b.hire ?? 1)))`, which is traffic's job fill.
   - Power and water shortages are already priced in twice: in `hire` (× 0.25 / × 0.5) and in UNPOWERED_SERVICE_EFF / UNWATERED_HEALTH_EFF. They must not count a third time, and must not raise Understaffed.
   - Unknown staffing counts as full: `facilityOpFactor` returns 1 while the economy population system is not running. That covers infra-only sims and most infra tests, where `place()` leaves `b.jobs = 0`; `environment.test`'s "police near > 0.9" would otherwise fail at op 0.6. JusticeSystem.init records whether `economy.population` exists (a WeakMap keyed by state). `facilityUseFactor` likewise returns 1 when its cache has no entry.
   - Labour-short cities: unemployment is 0 in every bot year at both 128 and 256, and in that case all employers fill proportionally. So use `staffRel = min(1, fill / max(0.5, cityFill))` in 0.05 steps, where cityFill is the job-weighted fill of C / I sites, and `op = 0.6 + 0.4·staffRel`.
   - BF.Understaffed and its hint appear only when staffRel < 0.6 or the lot has no road. Hint texts: "Workers can't reach it" or "No road access — build a road beside it".
   - A city-wide shortage is info only: "All employers are 82 % staffed — the city needs more workers".
   - Probe:
     - 128×15, year 15: 12 of 110 tier facilities have no road (staff 0; bot placement, item 38). The road-connected ones fill 0.98, but only 0.85 in years 4–5.
     - 256 s7: road-connected tier facilities average 0.84–0.95 in years 6–25, with 24–65 % below 0.9. 11–13 % of all tier facilities have no road (62 of 465 in 2025).
     - Once the 256 bot's water runs short (2035), the raw ratio b.jobs / def.jobs puts 28 % of tier facilities below 0.6, against 18 % hire-adjusted (2036). The raw ratio would report a water shortage as understaffing; by 2037 the gap is 30 % against 18 %.
   - Tests:
     - An unpowered school gets no Understaffed flag, and op comes from power only.
     - With jobs = 2 × workers, reachable facilities have op ≥ 0.95.
     - A facility on an isolated road is Understaffed at op 0.6 and recovers once connected.
8. **Staffing only reaches the tier engine.** Utilities, garbage and WP8's fleets are read-only and ignore it. Report text must say what it affects:
   - tier facilities: "Staff 24 / 30 — service at 92 %";
   - every other def with jobs: "Jobs filled 36 / 90", as employment info with no effect claim.

   BF.Understaffed is set only on tier facilities.
9. **Justice semantics that WP7-2 left open:**
   - `addArrestPotential(st, v)` reports the level from the latest crime raw pass.
     - Justice stores it in `systemData.justice.potential`. crime.init runs before justice.init, and justice.init must not reset the stored value.
     - Justice uses it as the monthly rate. Crime passes are at least 20 days apart, so summing them would double some months.
   - Holding cells are beds, not "per month": kiosk 5, station 25, HQ 100, × police funding.
   - Inmate stock: `inmates += sentenced − inmates / 12`, capped at (beds + holding) × 1.3.
   - `occupancy = inmates / max(1, beds + holding)`.
   - `overflow = max(0, 12·sentenced − beds − holding) / max(1, 12·sentenced)`, as amended.
   - `systemData.justice.inmates` stays a number: WP8's failed prison riot multiplies it by 0.7.
   - `justiceFactors(st)` is a pure read of the persisted `stats.justice`, so services and crime see the saved factors right after a load.
10. **No unfixable justice penalty.** The prison unlocks at 15k. Below that, a city with at least one police station must have overflow ≤ 0.05, because holding cells cover it; add a test. Keep the amended continuity: 60k without a jail gives overflow ≈ 0.7 and policeMul ≈ 0.79.
11. **Police calibration also gates the spread, not only the ±0.05 mean.**
   - Home police coverage p10 and resident-weighted crime must stay within ±10 % of the pre-WP7a tree (128×15 and 256×20, s7).
   - Probe today: at 128×15 year 15, mean 0.74 and p10 0.51. On the 256 map from 2023 to 2036, mean 0.52–0.69, with p10 0 in most years.
   - `needOf` splats its jobs raster in O(buildings + C) and costs ≤ 0.2 ms measured on stressCity(256). Services' S_PREP cost estimate is not WP7a's hunk. [lead: or grant WP7a that one term.]
12. **Connectivity enters `facilityUseFactor`.**
   - demand.ts and budget.ts already multiply cap relief, freight boost and facility income by this factor.
   - Yet today the transit defs keep their benefits when not connected:
     - an unattached train station keeps R 2,000 / C 2,000 of cap relief;
     - an unlinked ferry keeps R 2,000 / C 1,000 (tourism zeroes only their visits);
     - a freight station with no rail link keeps I 15,000 plus its 0.05 freight boost.
   - For the 7 transit defs, `facilityUseFactor` returns WP7b's new `transportUseFactor(st, b)` hook in transportFacilities.ts: −1 means not a transport def, 0 means not connected.
   - Use factors are computed in `JusticeSystem.monthly`, because it is WP7a's only system and `systems/infra.ts` is read-only. They are cached per building id and persisted in `systemData.justice.use`.
13. **Airport and seaport use calibration.**
   - Seaport use comes from `freightSinkTrucks` as redefined in item 18: trucks within 30 min of the port, not only trucks that pick it as their nearest sink. Otherwise a port next to a highway edge sits idle at factor 0.6 whatever the player does.
   - Report on the bot at years 15, 30 and 40: airport and seaport use factors, and C / I cap-binding months compared with the pre-WP7a tree (at most +20 %).
   - A small airport under WP7-11 sits at factor ≈ 0.61 at its 12k unlock and ≈ 0.9 at 100k: passengers/day = 0.012·pop^0.95 + overnight, i.e. 90 + 70 at 12k and 674 + 365 at 100k (probe overnight values).
   - The bot builds its first airport only at about 385k on 256 (probe; use 2.2 there, and 0.75 for the large airport at 540k–640k). So only players who build early see the ~60 % relief, and the report must show "Passengers x / 3,000".
14. **Report lines must use data that exists.** WP8 keeps no per-station history of responses or arrests. Build the lines from:
   - `stationFleet` (units, free, out);
   - `vehicles()` filtered by `stationId`, for units on a call now;
   - a per-station tally of vehicle ids first seen this month, which needs a daily hook in JusticeSystem. Otherwise drop "responses".
   - For police, "arrests 14 / mo" = city arrests × the station's share of served patrol need, labelled "≈ in its patrol area".
15. **The matrix test must be causal.**
   - Build the small city once, serialize it, and load it per def.
   - Read each metric at the facility: its catchment layer, its own report or stat, `stats.justice`, `stats.transitFleet`, or its budget line.
   - Never read a city-wide chaotic total such as population or funds; with a chaotic sim those differ after any change.
   - Controls:
     - two runs without the facility are bit-identical;
     - a burnt copy of the facility has no effect.
   - The map needs a sea edge for desalination, seaport, lighthouse, marina, ferry and hydro.
   - Take the def list from the catalog without the test defs. `registerTestDefs()` pushes the non-hidden `t_*` defs into CATALOG, and `ploppables()` would include them.
   - Unlock through milestones or sandbox; set the timeout to 300 s.
16. **Patrols.** Health buildings are in `patrolIds`, and random ambulance patrols contradict WP8's real ambulances. `patrolRoutes` still walks them, so the `rand()` draws stay the same (item 2), but it does not push their routes. Police patrols get `car_police`, garbage patrols `garbage_truck`.

### WP7b — transport facilities
17. **Transit coverage must mean service.**
   - The attached rule applies to every stop type. Today a bus stop off the road still splats r6 × 0.5.
   - A subway or train station counts only if its network component holds at least 2 stations of its mode. A train station may count a rail neighbour connection instead.
     - Today a lone station on a stub tunnel gives r9 × 0.8 transitCov.
     - That transitCov feeds desirability and, under WP6a, land value +0.07.
   - For ferries, `stopAttached(id)` means "linked to at least one partner", because tourism.ts reads it.
   - Add the `subwayChanged` dirty line (item 1). Today a new tunnel doesn't refresh transitCov until the periodic pass: 15 days live, about 50 days headless.
18. **Freight sinks must be connected.**
   - A freight station counts as a freight sink, gets cap relief (via item 12) and appears in `freightRailCells()` only when its rail reaches a rail neighbour connection or a seaport. Check this with a rail BFS on graph rebuild. Otherwise the station warns "No rail link to the region".
   - `freightSinkTrucks` = industry trucks within 30 min of the sink: one extra reverse freight search seeded at the sink, limit 30 min, every second cycle, in its own phase. It does not count only trucks that choose the sink as nearest.
   - WP6a's `computeFreightAccess` applies the same gate (item 34).
19. **Parking calibration: the largest balance risk in part B.**
   - Probe of the WP7-7 formula on the current bot, which has no transit and no garages. Supply 60 / 30 / 10 by zone density, civic 20; demand = car arrivals on job footprints without the shopping term, so this is a lower bound.
     - 128×15: 48 % of built C cells are above 0.6, and job-weighted pressure is 0.62 at 186k.
     - 256 s7: 19 % in 2023, 55 % in 2032 and 61 % in 2034.
   - Add WP6-2's penalties (CS −0.12 … −0.15, CO −0.08) and "+5 min × parking" on car commutes, and this becomes a city-wide penalty. The bot cannot answer it, and neither can a player before garages unlock at 15k.
   - Garage supply = 900 cars/day in total, spread over walk radius 6 with a normalised kernel — not 900 per cell.
   - Calibrate the supply, not the penalty, to these targets:
     - bot 128×15 and 256×40 without garages: job-weighted parking ≤ 0.3, and at most 15 % of C cells above 0.6;
     - the stress-city metro variant lowers downtown pressure by at least 30 %;
     - a garage beside a stop lowers its block by at least 0.2.
   - Emit `layerUpdated('parking')`.
20. **F1 side effects to report with the reorder.**
   - NET_TIME and NET_CAPACITY also feed:
     - graph.ts (t0, cap);
     - search.ts `MIN_ROAD_T` (the bucket width);
     - services' accessCommute (`NET_TIME_Q`);
     - emergency.ts `MIN_T` and ETAs, so WP8's tests must stay green.
   - In the bot, every 4th grid line is an avenue, and so is the trunk until 12k people.
   - `RAMP_PENALTY` keeps 0.35, because emergency.ts, services.ts and search.ts read it. WP7-10's congestion-dependent ramp is an extra per-node time inside traffic's own searches.
   - The car-less +12 min (WP7-8) applies with or without garages, so it goes into the same bot-delta report.
21. **New work gets its own traffic phases.**
   - Park & ride search and the parking raster become new PH_* phases with their own `cost()`. They are never folded into PH_TRANSIT (3.2 base) or PH_FINAL2.
   - Measure the added ms/day on stressCity(256) plus 40 garages beside stops, 6 ferry terminals and 2 depots. The stress city has none of these today, and park & ride is the largest line (0.3 ms/day).
22. **APIs WP5 needs; WP5 may not re-implement them.**
   - `roadCellReport(sim, cell): FacilityLine[]` (interchange load, trucks/day, bus riders on the cell). Without it the highway mechanics of WP7-10 are invisible.
   - `stopsNear(sim, x, z, w, d, r = 5)`, for the garage preview.
   - `ferryPartnersFor(sim, x, z, w, d, rot)` returning partner and minutes, for the ferry preview.
   - Document that road-flag bus stops (netFlags bit 4) are legacy: no tool creates them, and they get no report.
23. **Ferries carry riders but nothing moves on the water.** RouteKind has no 'ferry', and VehicleRenderer (render-perf team) draws none. Expose `ferryLinks(): { a; b; cells }[]` and route "[render] ferry boats on ferry links" to the render team.
24. **No balance gate exercises WP7-5 … WP7-9.** The bot builds no stops, subway, depot, garage or ferry. So calibrate these on the stress-city metro variant and on a scripted transit town in transitFacilities.test.ts. The bot rule is item 38 (c).

### WP5 — player feedback
25. **Missing readers.**
   - Render `landValueBreakdown`: the "Land value" row expands into its terms on lots and buildings.
   - Render `growthLimits`' new fields and `CrimeSystem.termsOf`.
   - Label `stats.needs.police` as "patrol load", not people.
26. **Hover reads the same value as the render.**
   - Add `overlayValue(st, o, x, z, variant = −1)`; §4 lists only overlayLayer and computeOverlayValues. The QueryTool readout uses the same variant and derived raster as the terrain.
   - Derived rasters are cached per (overlay, variant) and rebuilt only on their layerUpdated event, never per call, because `overlayValue` runs on every hover move. This covers:
     - Demographics;
     - Emergency;
     - the Families / Seniors / Students appeal variants;
     - water quality.
   - Categorical readouts, for example: "Auto-dispatch · 2.1 min to spare", "Out of reach by 1.8 min — you dispatch", "No station".
   - The appeal variants call `familyScoreAt` and friends once per cell, and each call reads 10 layers. Hoist them into one typed-array loop to stay within the 1 ms raster target.
27. **LIVE reaction time: WP8's open note, which no one owns.**
   - At the default slow-motion of 3 (1.5 s per day), a fire whose best manual ETA leaves 2 days of slack gives the player 3 seconds.
   - Fix in `speedPolicy`: when the most urgent alerted incident's real window ((time left − bestEta) × seconds per day) is under 8 s, 'live' pauses until the player dispatches, then continues live.
   - Add an emergencyPolicy.test case.
28. **Emergency legend.**
   - Only slack ≥ 0 is auto-covered, so −3..0 reads "Just out of reach — you dispatch", not "Slow".
   - Map slack continuously, clamped to −12 … +12, so bilinear filtering only blends neighbouring categories; −99 gets its own colour.
   - Keep Police / Fire / Health coverage distinct from Emergency response: rename them "Patrol coverage", "Fire prevention" and "Care access", or show response as a second variant of each.
29. **Water overlay: add a "Tap water quality" variant**, from `waterQualityAt` per network. Unsafe tap water now costs health and approval, but no view shows where.
30. **Inspector layout.**
   - Default view: chips, occupancy, one "Main problem" line (the largest negative condition or desirability term, with its fix hint) and at most 6 key rows.
   - Collapsible sections for Why?, Residents, Facility and Environment. They remember their state (loadPref) and show at most 8 bars each.
   - De-duplicate chips and facility warnings (for example "Unpowered" and "runs at 30 %").
   - Rebuild the panel at most once per real second, and skip collapsed sections. Its signature changes every 5 sim days, which at ultra speed is 4 full DOM rebuilds (breakdowns, needs, report) per second.
31. **One advisor per problem.**
   - `noFire` (fireCov < 0.2) and `noFireResponse` merge into one fire advisor: the response gap first, prevention second.
   - `noPolice` splits by cause, unreached versus overloaded, using `stats.needs.police` and `facilityLoad`.
   - One garbage rule replaces three: the capacity-only `garbage` rule, WP3's periodic garbage news and the [QA] rule. It carries the `garbageInfo` reason (capacity / range / noRoad) and a location, and says from which size penalties apply (item 35).
   - Export `advisorIssues(st)`: the full, unthrottled list of current issues per advisor, computed monthly. AdvisorsPanel's `assess()` reads it, so a problem held back by ADVICE_PER_MONTH = 2 still shows there, with "Show me".
32. **History definitions** (graphs must match the StatsPanel):

    | Series | Definition |
    |---|---|
    | commute | avgCommute |
    | noise / air / waterPoll | avgNoise / avgAir / avgWaterPollution |
    | garbageLoad | produced / max(1, capacity) |
    | powerMargin / waterMargin | (supply − demand) / max(1, demand), clamped −1..1 |
    | enrol* / healthServed | served / need (0 without need) |
    | incidents | Σ lastMonth.count |
    | responseMin | Σ lastMonth.responseMin / Σ responses |
    | emergencyDeaths | lastMonth.deaths |
    | jailOccupancy | justice.occupancy |
    | busLoad | busesNeeded / max(1, buses) |
    | parkRide | transitFleet.parkRide |

    HISTORY_KEYS holds one `responseMin`, so WP5-3's "response minutes per responder" graph shows the mean. The per-responder split stays in WP8's EmergenciesPanel.
33. **Tests to add.**
   - `overlayValue` equals the rendered raster at 100 random cells, for every Overlay × variant.
   - A pure inspector model (report / breakdown → rows), tested with stub outputs (null, [], −1) and with full outputs.

### WP6a — integration
34. **Breakdowns must be exact.**
   - `landValueBreakdown` cannot sum to the stored value, because land value is blended with its neighbours (LV.spatial) and smoothed over time (LV.temporal).
     - Return the raw terms plus explicit 'clamp' and 'smoothing' terms (smoothing = stored − Σ raw).
     - Test: Σ = stored ± 0.005. In a steady state (2 × LV_REFRESH_DAYS without edits), |smoothing| ≤ 0.05 on 90 % of cells.
   - `desirabilityBreakdown` shares one term function with the band; the formula must not exist twice.
   - The inspector shows value = stored and marks "updating" when |clamp(raw) − stored| > 0.02.
   - `computeFreightAccess` skips freight stations and seaports whose use factor is 0 (item 18).
35. **The garbage fade covers every WP6a consumer:** the desirability and land-value garbage terms, and population.ts PENALTY_NO_GARBAGE.
   - `conditionBreakdown` shows the faded value with the note "fades in from 2k to 20k residents".
   - WP3's pile smell (GARBAGE_SMELL) and pile crime (CRIME_GARBAGE) are read-only for WP6a. If they keep leadtown below 0.9 × phase0, report it and WP6b fades them.
36. **RENT must not abandon existing R$ homes.**
   - The problem: the condition target is 0.5 + 0.5 × desirability, and the R$ RENT term is −0.5 × smoothstep(.45, .85, LV). When the player raises land value (say, a park next door), existing R$ homes turn unhappy and are abandoned instead of gentrified.
   - The fix: leave RENT out of the condition target, or cap it at −0.1 there, and let the same-stage wealth swap handle the change.
   - Test: raising LV from 0.5 to 0.9 around an R$ block produces swaps, and the abandoned count is unchanged after 2 years.
   - Anti-oscillation: a swapped building cannot swap back for 5 years.
   - Swap and filtering-down timers live in `systemData.growth`, keyed by building id and pruned on removal, because CityState and serialize are read-only.
37. **'Downtown' is a growth weight, not a desirability term.**
   - It appears under `growthLimits` as an optional field, never in `desirabilityBreakdown` (Σ terms = raw).
   - Commercial core = the job-weighted centroid of CS / CO jobs over coarse blocks, recomputed monthly in rt.
   - The skyline weight is a §GROWTH knob on the distance to that core, normalised by map size.
38. **Bot** (or WP6c, item 6):
   - (a) **Stale data.** Key need-driven placements to completed services passes (count `layerUpdated('catchments')`) and track pending placements per cluster. A headless 256 pass takes about 45–60 days (§6), so a monthly rule places twice at the same cluster.
   - (b) **Road access.** Use `edgeOnly` for every service and utility. Probe: at 128×15 year 15, 12 of 110 tier facilities have no road.
   - (c) **Transit.** The bot builds none today.
     - Bus stops every ~8 cells along avenues through R / C blocks from 20k people.
     - A depot when busesNeeded > 1.1 × buses; without stops this rule is dead code.
     - A garage beside a stop for any C block with parking > 0.6, once garages unlock.
     - Optional: one downtown subway line from 150k people.
   - (d) **Jails.** Place them in I / U blocks, never within 12 cells of R$$$ (stigma 0.55 r10, crime spill).
   - (e) **Police.** Besides the coverage rule, add a station next to any station whose utilisation exceeds 1.1 (WP7-1 capacity).
39. **Acceptance additions.**
   - Carry the spec's WP6 slow-balance gates explicitly: on 128×15 s7, elementary served/need ≥ 0.85 from year 10, and kids unreached < 5 %. The current bot has 0.61 served and 29 % unreached at year 15, with play served 0 and college 0.08; these gates sit in no one's list today.
   - Abandoned growables ≤ 3 %, and no more than pre-WP6a + 1 pp, on 128×15 and 256×40.
   - Report the mean desirability per DevType before and after, at years 5 and 15.
   - Report as numbers: interior-cell infill ≥ 1.5 × phase0's share, and the stage ≥ 6 core share.
   - The PARKING terms stay 0 until WP7b's calibration (item 19) lands.

### WP6b — final balance
40. **Honest `cost()` trades headless CPU for staleness.** After the cost fix, report the days per full pass of services, pollution, crime and emergency.response on the 256 bot. If a pass exceeds 60 days, give it budget (within stress-city utilisation ≤ 0.88) or cut its work. Otherwise the bot plays on coverage months old, while a live player's refreshes within days.
41. **Gate "rewards correct choices".** On 128×15 s7, compare each right choice with its wrong one. The right choice must improve the named metric and must not end with more than 5 % less population (the chaos margin):
   - no schools: EQ and R$$ share fall;
   - no landfill: growth falls;
   - `--neglect`: failed incidents rise and approval falls;
   - no jail: overflow and crime rise;
   - transit on: commute and parking fall.
42. **Orphans WP6b takes:**
   - fading WP3's pile smell and crime, if item 35 needs it;
   - the Clean Power Act's "+15 % plant upkeep" (budget.ts; WP3 note);
   - a capHints issue text "not connected" for use factor 0 (demand.ts; today it reads "little used");
   - the perf.test exception (item 1).
