# B2 design: split the infra steps, recalibrate `cost()`

- **Plan rows:** WASM_PLAN B2 (and its table of the largest steps); WORKER_DESIGN §6 S3 (PI-5b).
- **Base:** `41ae570` = the dev branch + the exact J-fixes + LG-01 + the guide copy + B1 (`5bb5467`). B1's 128 × 15 seed-7 2015 reference is 196,101.
- **Branch:** `b2-step-split` (local only).
- **Inputs:** the three mapping reports (traffic, services + emergency, crime + pollution + utilities) and their data under `scratchpad/b2work/map-*`. Every number below is from those reports unless it says otherwise.
- **Status:** design. The build order is §10, in four groups: `G1-core-traffic`, `G2-services-nimby`, `G3-crime-pollution`, `G4-utilities-emergency-recalibration`.

## 0. Summary

**Goal and acceptance.**
- The plan's acceptance, unchanged:
  - `maxStepMs` p99 ≤ 3 ms and max ≤ 5 ms at dense1m;
  - the median cost-model error within ±30 %;
  - the balance procedure passes;
  - new bot hashes are recorded.
- §12 fixes how each number is measured.
- The latency gate is the lead's profile window: dense1m, headless, `--warm 20 --days 60`, wall clock per step. In that window many of today's steps run in cold or deoptimised code, at up to 5–15× their warm cost. The pieces are sized for that window, not for warm code.

**Approach.**
1. **Pieces inside today's states.** Every state id stays the same: traffic `phase`, services / pollution / utilities / crime `stepIdx`, emergency `respStep`. A state's work becomes a sequence of *pieces*, and one scheduler step runs exactly one piece. A per-state cursor (`sub` plus the loop cursors) lives in fields. Profile labels, the tests that step by state, and `phaseMs` keep working.
2. **One budget.** `INFRA_PIECE_MS = 0.3` warm estimated ms per piece. Chunk sizes come from it and from the cost coefficients (`pieceUnits()`), so they are deterministic constants; no clock is read. A piece cut below one call of a shared kernel (`blur.ts`, `saturate`, a provider callback) is impossible, so such a piece is one call of at most about 1 ms. A *publish piece* (§1 R7) may reach 2 × the budget.
3. **Exact by construction.** Loop bodies stay as they are. Loop-carried locals become fields of the same JS type. Snapshots, RNG order and event order are kept. A pass that runs uninterrupted computes bit-identical results to today's code. The proof is by digest: `passdigest --mode atomic` B vs W on both fixtures, plus a vitest suite that runs every pass in one go and in tiny pieces (§11).
4. **Honest `cost()`.** Each piece is estimated as `a + Σ coef × units` from the piece's own work counts. The coefficients are warm, in-schedule wall-clock ms on this 4-core box (§9).
5. **The scheduler.**
   - The urgent loop gets an estimated-ms budget headless and a real-time cap live, instead of 8 steps.
   - The step guard goes from 64 to 256.
   - `INFRA_DAY_BUDGET`, `INFRA_DAY_CARRY` and `CREDIT_FLOOR` are scaled by about 1.65, so the real infra time per day stays at today's 5–6 ms at dense1m. G1 sets provisional values; G4 measures and fixes them (§9.4).
6. **Results change by design only through the schedule.** The headless schedule follows the estimates, so the bot moves; G4 records the new hashes. Interrupted passes read their inputs over more days (R12).

**Pieces at dense1m (estimates).**

| task | steps per pass today | largest step today, cold window (ms) | B2 pieces per pass |
|---|---|---|---|
| traffic | about 20 | final2 28.1, prep 23.9, prepTransit 13.4, commute.end 12.6 | about 150–175 |
| services | 13–19 | prep 34.1, finish 20.1, accLand 18.8, shopB 16.3, nimby 15.0, tiers 14.4 | about 150–200 (of which about 110 tier steps) |
| crime | 3 | sources 21.6 | about 25 |
| pollution | 10 | srcBld 24.6, garbSrc 12.6, garbApply 11.8 | about 50 |
| utilities | 4–6 | water 14.7, power 11.6, label 10.8 | about 25 |
| emergency.response | 6 | resp0 7.6, resp3 10.1 | about 27 |

At 0.3 ms per piece, dense1m runs about 20 steps per day (about 1,200 in the 60-day window). Each step costs the scheduler a few µs.

## 1. Rules for every split

Terms used below:
- A **state** is one of today's step ids.
- A **stage** is the work of one state in one pass.
- A **piece** is what one scheduler step runs.
- The **pass snapshot** is the building list a pass walks (R4).
- A **publish piece** is the piece that makes a stage's external outputs visible (R7).

**R1. Pieces inside today's states.**
- Keep every state id and transition. Add `sub` (the piece index inside the current visit of a state) and the stage's cursors as fields.
- `step()` runs one piece. It moves to the next state only when the stage reports completion; otherwise it stays in the same state.
- Every method that today runs a whole state keeps its name and its whole-state semantics, as a loop over its pieces: traffic `prep`, `prepTransit`, `transit`, `originTransit`, `roundSearch`, `roundMatch`, `poolRemaining`, `commuteEnd`, `inbound`, `shopping`, `freight`, `freightSinks`, `parkingRaster`, `finalize`, `finalize2`, `rebuildGraphs`; pollution `stageA`, `stageB` and the other stage methods; services `prep`, `finishTransit`, `footprints`, `finish`, `accessCommuteSeeds`, `accessCommuteLand`, `shopLand`; nimby `rebuildNimby`; crime's three step methods; utilities' and emergency's step methods.
  - Tests call these by name (`tests/sim/exact/traffic.test.ts`, `tests/infra/perf.test.ts`).
  - They are also the "one go" reference of the exactness suite.
  - `compute()`, `runCycleSync()` and init's synchronous passes loop over the pieces.
- Each system exposes `get stepName(): string`, for example `'prep.scan#3'`. Only tools read it; `b2work/tools/cpumap.ts` already does.

**R2. Piece size.**
- `INFRA_PIECE_MS = 0.3` (params.ts) is the warm estimated ms of one piece.
- `pieceUnits(msPerUnit, min = 1)` (scheduler.ts) returns `max(min, floor(INFRA_PIECE_MS × pieceScale / msPerUnit))`. Every chunk size (buildings, origins, rows, settled nodes, tier work units, events) comes from it.
- A stage computes its chunk sizes once, in its first piece, and stores them. `cost()` reads the stored values and never recomputes them.
- `setPieceScale(s)` is a test-only hook: `1e9` gives one piece per stage, `1e-9` gives one unit per piece. It is module state, so a test must reset it in `afterEach`.
- Exceptions to the budget:
  - one call of a shared kernel (`blur.ts`, `saturate`, the police `needOf`), at most about 1 ms warm at 256²;
  - publish pieces, at most 2 × `INFRA_PIECE_MS`;
  - the edit-only lazy caches that other code also calls synchronously: traffic `refreshAttach`, emergency `syncStations`.
- **Loops whose cold cost is extreme get half the budget.** Some float-heavy cell loops measured more than 15× their warm cost without TurboFan: the stop disks 37×, shopB's bilinear output 25×, finish's legacy combos 27×. Size their chunks with `pieceUnits(2 × coef)` if their first gate run shows cold pieces over 3 ms.
- G1 may retune `INFRA_PIECE_MS` once after its first gate run (§10). It is one constant.

**R3. Same statements, same order.**
- Loop bodies are moved, not rewritten. A piece runs a contiguous range of today's loop in today's order.
- Loop-carried locals become fields of the same type:
  - a JS double stays a double, in a number field or a `Float64Array` (for example services' 7 need sums, crime's `arrest`, utilities' `supplyTot`);
  - Float32 accumulators stay Float32.
- Values computed once per stage today stay computed once, in the stage's first piece, and are stored for the stage. Examples:
  - crime `ctx = context()`;
  - roundMatch `carPcu`, `trBonus` and `ovOn = gPrN > 0 && ovAnyRoom()`;
  - pollution `fxB`, `fx3B`;
  - utilities `eff`, `nuclearMul`, `season`, the sea mask;
  - services `fx`, `policeMul`, `avgCommute` for accLand.
- Recomputing one of these per piece is the typical way to break exactness; review for it.

**R4. One building snapshot per pass.**
- Each task's pass takes one snapshot of `buildingList(st)` (a slice) at its first building stage. Every building stage of that pass walks it with a cursor. The snapshot is released at the pass end.
- `common.ts` gets a `BuildingSnapshot` helper:
  - `take(st)`;
  - a footprint prefix sum (`F`, the cells of `w × d`), built once per snapshot;
  - `plan(aUs, bUsPerCell)`, which cuts the snapshot into chunks of at most `INFRA_PIECE_MS` of `a·B + b·F` and returns the boundaries;
  - `range(k)`, plus the `B` and `F` of chunk k for `cost()`;
  - `release()`.
- Emergency `resp4` keeps today's live list with `respBCur`.
- **Why it is exact.** In an uninterrupted pass (flush, `compute`, init) no building is added or removed and the day does not change, so `buildingList` returns the same sequence at every one of today's steps. The snapshot is exactly that sequence.
- Interrupted passes change by design:
  - a building removed mid-pass still counts for that pass;
  - a building added mid-pass waits for the next pass.
- **Per-id arrays.** Every piece that indexes per-id arrays calls the system's `ensureIds` / `ensureIdFloat` as today's steps do (`environment2` 'buildings that appear between the steps of a pass').
- **Events.** Before an event is emitted for a snapshot building, check `st.buildings.get(b.id) === b`. In an uninterrupted pass this never skips anything.

**R5. Inputs are consumed at the stage start.**
- A stage reads its dirty flags and event-fed lists, and clears them, in its first piece. Events that arrive mid-pass mark the next pass. That is today's behaviour for an event that arrives between two steps; it must not become "lost because the clear came at the stage end".
- The inputs this covers:
  - services: `dirtyUrgent`, `dirty`, `accessDirty`, `nimbyDirty`;
  - utilities: `dirtyFull`, `soft`, and the `added` / `removed` lists, swapped into pass-local arrays in the first piece;
  - traffic: `graphDirty`, cleared in the first rebuild piece;
  - pollution: `routeDirty`, `treesDirty`, `parkDirty`, each cleared in the piece that uses it, as today;
  - emergency: `respDirty`.

**R6. RNG.**
- Every `rand()` call stays in its piece and in today's order:
  - traffic `jNoise` (prep's last piece, in `j` order, before any other draw of the cycle);
  - the route sampling of `roundFlows`, inbound, shop and freight;
  - `buildSampleRoutes` and `patrolRoutes`.
- No piece adds or moves a draw.

**R7. Publication: external outputs change once per stage.**
- External outputs are anything another system, a query or the UI reads between steps:
  - layers;
  - per-id results;
  - building flags;
  - `stats`;
  - stop, garage and depot reports;
  - need rasters;
  - graphs;
  - component and supply arrays;
  - producer maps;
  - the transport save.
- Today each of them changes within one step. B2 keeps that. Each one becomes visible in **one** piece per stage, at the same pass-relative point as today. Either it is written inside one piece, or it is built in private scratch and published by `.set()` or a buffer swap in the publish piece.
- **Flags.** Computed per chunk into a desired-value array, applied in the publish piece in snapshot order with `setFlagQuiet`. The `changed` list comes out in today's order.
- **Events.** Emitted after all the state they announce is published, in today's order. They may be spread over consecutive pieces (`pieceUnits(0.4 µs per event)`).
- **Exceptions.** A few states already pass through intermediate states between steps today, and B2 leaves them as they are:
  - the services per-facility records written by each tier step;
  - `transitCov` between the transit slot, `S_STOPS` and `S_FOOT`;
  - the emergency response layers between `resp3` and the `resp4` chunks;
  - the inspector-only per-id arrays `airById` and the garbage `served` / `reach` stamps.
- **Why this is not an exactness rule.** In an uninterrupted pass nothing reads in between. The rule keeps interrupted passes sane: no half-zero `st.commute` for a day, no `transportUseFactor` reading a depot list without its stops, no `waterQualityAt` on half-summed supplies. The P&R hint tests check it at every step (§11.4).
- **The audit.** Each group lists, per system, every public query, the fields it reads, and the piece that publishes each field. Write the list as a comment above the system's state machine, and copy it into the group report.
  - Traffic: the methods under `// public queries` and `// WP7b queries`, from `routeInfo` to `stopsNear`, plus `parkingSummary`, `nodeTimes` and `getSampleRoutes`.
  - Services: `layerOf`, `facilityLoadOf`, `unservedClusters`, `needRaster`.
  - Utilities: `gridInfo`, `waterInfo`, `waterQualityAt`, `plantLoad`, `producerInfo`.
  - Pollution: `garbageInfo`, `landfillInfo`, `incineratorShare`, `garbageSummary`, `roadlessGarbage`, `emissionOf`.
  - Emergency: everything dispatch reads.
  - Per-cycle arrays a query reads are external even when they look internal. For example, `garageInfo` reads prep's `gN` / `gBid`, prepTransit's `gStop` / `gWalk` / `gSpaces` / `gState`, and parking's `parkD` / `parkBoxD` / `parkBoxS`.

**R8. No shared module-level scratch across pieces.**
- Module-level scratch used inside one call stays: blur's `colSum` and upsample tables, catchments' `eng` used by `reachRaw`, `scratchInt` inside one `build()`.
- Anything a stage keeps across pieces is private:
  - **search.ts:** the module `bq`. `garageReach` and other systems run `roadSearch` between steps.
  - **catchments.ts:** `eng.enode` / `enext` and `lhead`.
  - **graph.ts:** `scratchInt`. Emergency's own graph build uses it.
  - **nimby.ts:** the module `scratch`. Two Simulations in one process (tests, region previews) would clobber each other; it moves into a `WeakMap<CityState, NimbyRun>`.
  - **Traffic Search objects:** `findPath` gets its own BFS scratch (`SP`), because fire dispatch calls it between steps. `SB` keeps its role as the inbound / shop / freight / sinks search, so the frozen-original test needs no remapping.
- A resumable search must not cache `S.dist` and the other typed arrays across calls. `WasmSearch` re-points them when wasm memory grows (`tests/wasm/roadTransitSearchSim.test.ts`).

**R9. Save and load exactly as today.**
- No new saved field. Every cursor, snapshot and scratch field is reset in `init()` (so in `replaceState` too) and at each pass start.
- A save never holds a pass in progress. The one exception is emergency's `p.resp = [respLast, pending]`, as today: `pending = 2` while `respStep ≥ 0`, written by `saveResp()` after every piece.
- Traffic keeps `saveTransport()` and `cycles++` in the cycle's last piece. `runCycleSync` still loops until `phase < 0`.

**R10. JIT hygiene.**
- Each piece is its own method with one main loop. The dispatcher is a thin `switch`. The mapping found that TurboFan takes 15–46 ms to compile today's big step functions, and they deoptimise on never-executed code after the loop.
- No allocation per piece: scratch grows once. Today's per-call `new Float32Array` in `shopLand` and the closures built per call become fields.
- The services tier engine gets per-facility typed arrays (strength, tier + 1, id, powered-flag, op, cap) built in prep. Then `allocSeats`, `reportDemand`, `splatUnion` and `record` never read a `Building`. This targets the 277–340 'wrong map' deopts the mapping found in `allocSeats`.

**R11. Determinism.**
- Chunk sizes are constants derived from coefficients.
- `cost()` is a pure, O(1) or O(log n) function of the current state: cursor, chunk plan, sizes. It never runs a loop over buildings or cells.
- A piece's estimate never depends on the clock.

**R12. What changes by design in interrupted passes.**
- Inputs are read when each piece runs, not when today's step ran: other layers, building fields, `plantLoad`, `commuteOf`, `stopAttached`, funding.
- The snapshot membership rules of R4 apply.
- All of this is deterministic within the version and only affects passes that other work interleaves with: the headless schedule and live mode.

## 2. Scheduler and shared helpers

### 2.1 `scheduler.ts`

- **Urgent loop.** Today it runs up to 8 urgent steps per scheduler run.
  - New: steps of the first urgent and due task (registration order, as today) run while `used + c ≤ cap`; the first one always runs.
  - Headless, `used` is the estimated spend and `cap = INFRA_URGENT_BUDGET = 24` est-ms. That is about the real time of today's 8 urgent steps at dense1m (services tier steps of about 2.8 ms). A full utilities pass (about 8 honest ms) still finishes in one day, and a services urgent pass (35–50 honest ms) keeps B1's 2–3 days at dense1m.
  - Live, `used` is real time and `cap = INFRA_URGENT_FRAME_MS = 6` (2 × `INFRA_FRAME_BUDGET_MS`). Today the live urgent loop has no time check at all: 8 steps of 3–5 ms is a 24–40 ms frame.
  - Step guard: 256.
  - Without this change, B2's finer services pieces would break `servicesTrigger`'s `LATENCY_DAYS = 2` on the 32² city: about 25 pieces against 8 per day.
- **Normal loop.** The guard goes from 64 to 256 (`STEP_GUARD`). Nothing else changes: fairness by estimated credit, budget admission, renormalisation.
- **New exports:** `pieceUnits()`, `setPieceScale()`.
- `sizeFactors()` stays for compatibility.
- The `InfraTask` doc comment changes to: "estimated warm wall ms of the next step on the B2 calibration box".

### 2.2 `params.ts`

- New, with doc comments:
  - `INFRA_PIECE_MS = 0.3`;
  - `INFRA_URGENT_BUDGET = 24`;
  - `INFRA_URGENT_FRAME_MS = 6`.
- `INFRA_DAY_BUDGET`, `INFRA_DAY_CARRY` and `CREDIT_FLOOR`:
  - G1 sets provisional values 5.3 / 1.0 / 6.5 (today 3.2 / 0.6 / 4). `CREDIT_FLOOR` moves from scheduler.ts to params.ts.
  - G4 measures and sets the final values (§9.4).
  - Why G1 already scales them: with only traffic honest, the stress-city utilisation gate P0-15 (≤ 0.89) could fail at 3.2. Scaled, utilisation drops during G1–G3, and G4 re-checks it.
- **Emergency.** `EMERG_SEARCH_CHUNK` and `EMERG_FILL_CHUNK` become derived chunk sizes. `EMERG_*_COST` become per-unit coefficients (§8).

### 2.3 `common.ts`: `BuildingSnapshot`

As specified in R4. Its prefix-sum pass and its slice cost about 0.05 ms at 17k buildings, once per pass.

### 2.4 `search.ts`: resumable searches

- **`RoadSearchRun` and `TransitSearchRun`.**
  - Each has a private `BucketQueue`.
  - `start(...)` is today's prologue: `S.reset`, `graphVersion`, seeding.
  - `run(maxSettled): boolean` is today's bucket loop. It resumes from the saved `(b, e, cnt)`, checks the budget before it takes an entry (exactly like `SearchK.run`), and sets `S.settled` at the end.
- `roadSearch()` and `transitSearch()` keep their signatures and become `start` + `run(Infinity)` on a module instance bound to the module `bq`. Behaviour, memory and results for every other caller are identical, and the same code serves both paths.
- **Why resuming is exact.**
  - The Dial bucket width is at most the minimum edge cost (`Q`, `QT`), and every push from bucket b goes to a bucket greater than b.
  - So bucket b's list is fixed while it drains.
  - Resuming at (b, the next entry) replays the identical pop sequence: `dist`, `src`, `next`, `hops`, `order`, `done` and `settled` come out identical.
  - The inputs are fixed while a search runs: `nodeTime` and `rampT` are written only in prep, `truckTime` in freight's first piece, and `tnet` in prepTransit. The graph cannot rebuild mid-cycle.

### 2.5 `graph.ts`: resumable graph builds

- `RoadGraph` and `GridGraph` get piecewise builders (§3, PH_PREP rebuild): numbering by row ranges, attributes and edges by node ranges, components by an outer cursor plus a private DFS stack.
- `GridGraph` gets a typed-mask variant: rail is `net === Rail || flags & CROSSING`, subway is `sub !== 0`, computed inline from a snapshot. That replaces the per-cell closure. The mapping measured this alone cutting rail and subway from about 1 ms to about 0.2 ms.
- `build()` stays as the loop over the pieces.

### 2.6 `transit.ts`

- **`StopCollector`, a resumable `collectStops`.**
  - `begin(out)`, then building chunks over the snapshot (pushes in list order), then cell row ranges (the bus-stop flag, pushes in index order), then `end()` sets `n`.
  - The push order is today's, so the stop list is identical.
  - `collectStops()` stays as the loop.
- **`computeTransitCoverage`** gets a range variant over `[s0, s1)` with the same skips and the same in-place stop-order accumulation. `out.fill(0)` happens only for the first range.

## 3. Traffic (`traffic.ts`; G1)

**General.**
- Phase ids and `NEXT_PHASE` are unchanged. New `sub` field. `commuteStage`, `prStage` and `ovStage` stay as they are.
- `phaseMs` is reset only at the cycle's first piece (the first rebuild piece, or the first prep piece). It accumulates over pieces.
- Searches:
  - `SA`: the rounds (`RoadSearchRun runA`).
  - `ST`: transit (`TransitSearchRun runT`).
  - `SB`: inbound, shop, freight and sinks (`runB`).
  - `SPK` and the overflow `SearchK`s: P&R, already resumable.
  - `SR`: `garageReach`.
  - `SP`: new, the `findPath` BFS scratch.
- `stepCost()` returns the next piece's estimate (§9.2).

**Size key (dense1m):**

| n | C | B | oN | jN (jB) | qN | sN | fN | S | T |
|---|---|---|---|---|---|---|---|---|---|
| 23,141 | 65,536 | 17,154 | 12,338 | 2,867 (2,811) | 2,751 | 1,085 | 673 | 3,086 | 30,084 |

Timings in this section are dense1m: "warm" is the median, then p99 or max; "cold" is the 60-day window.

### Rebuild (PH_PREP while `graphDirty || road.N !== size`)

Edit-only, so the static gate does not run it.

| | |
|---|---|
| **Today** | One step. Warm 2.6–4.1 ms (road 1.9, rail 0.9, subway 1.1). First execution 11–27 ms. |
| **Pieces** | **RB0:** copy `network`, `netFlags` and `subway` into private arrays (3 × C bytes); set `graphDirty = false`.<br>**RB-num:** road node numbering by row ranges into the scratch graph `roadNext`.<br>**RB-attr:** `cellOf` / `type` / `t0` / `cap` by node ranges.<br>**RB-edge:** `fwd` / `rev` by node ranges.<br>**RB-comp:** components (outer cursor `s`, `nc`, private stack + `sp`).<br>**Rail and subway:** the same pieces on `railNext` / `subNext` with mask predicates.<br>**RBP (publish):** swap the typed arrays and scalars of `roadNext` / `railNext` / `subNext` into `this.road` / `rail` / `subway`, without replacing the objects (emergency holds the `RoadGraph` object and checks `version`); `version++` each; `iter = iterLoad`, `iterLoad = 0`; `rebuiltInCycle = true`. |
| **Cursor state** | `rbStage`, `rbCur`, `rbN`, `rbNc`, `rbStack` / `rbSp`, the three grid copies, the three scratch graphs. Memory: one extra graph set, about 1 MB at 256². |
| **Why exact** | The graphs are a pure function of the three grids. The copy is taken at RB0, and nothing changes it before RBP, so the result is byte-identical to `rebuildGraphs()` at that moment. A DFS resumed from the saved stack visits nodes in the same order, so the component ids are identical. An edit after RB0 sets `graphDirty` again and the next cycle rebuilds; today an edit after the rebuild step waits for the next cycle too. |
| **External** | The graphs are published in RBP only. Until then `findPath`, emergency, `stopsNear` and `garageReach` see the old graph. `findPath`'s idle rebuild (`phase < 0`) is unchanged. |
| **Target** | About 10 pieces of at most 0.3 ms. |

### Prep (PH_PREP)

| | |
|---|---|
| **Today** | Warm 3.2–4.2 / 6.8; cold 15.0 / 23.9. Parts: scan 2.9–3.3, node times 0.35–0.4, clusters 0.15, origin init 0.13. |
| **Pieces** | **P0:** `refreshAttach` when `attachDirty` (edit-only lazy cache, 0.3–1.2 ms, exception R2); `fx`, `jobsUnknown`, the per-id `ensure*`, `lastState`.<br>**P1:** BPR node times + `volNew` fill. `nodeTime` is written in this one piece because `nodeTimes` is read by other systems; about 0.4 ms is allowed as a publish piece, and above 2 × the budget it is double-buffered.<br>**P2:** ramp minutes, `rampNew` / `prAcc` / `railNew` / `subNew` fills.<br>**P3:** scan begin. Snapshot + plan; array growth to `snapshot.length + 16` (= today's `buildings.size + 16`); `conns = findNeighborConnections(st)`; reset of `entN`, the `oN..gN` counters and the `patrolIds`, `stationIds`, `sinkIds`, `sinkK`, `depotB`, `transportB` lists; `transportFor`.<br>**P4..Pk:** scan chunks (weighted `a·B + b·F`), about 12.<br>**Pz1:** scan end (`gN`, `jB`, `jObj` / `sObj` lengths), the connections loop, `oN..kN`, `workers` / `citySlots`, the `jPark` tail, `placeRegional`.<br>**Pz2:** growth and fills of the per-cycle arrays, the origin init loop, `candKey` / `candNode`.<br>**Pz3:** `jNoise` / `jAsg` / `jPrice` (`rand()` in `j` order), `propFactor`, `jCapP`, `buildClusters`, the round and trip resets, `sfRecompute`, the `jTimeSum` / `jInbound` / `jCar` / `sLoad` / `sCar` fills, `pendingRoutes`, `prRiders`, `prStage`. |
| **Cursor state** | Snapshot + chunk plan, `scanCur`, the scan counters (`scanO..scanG` and `entN` as fields; `this.oN..gN` are assigned in Pz1, as today after the loop), `workers`, `citySlots`. |
| **Why exact** | Same loop body over the same sequence, with counters carried in fields. The only `rand()` draws are the `jNoise` draws in Pz3, in `j` order, before any other draw of the cycle. |
| **External** | Only the garage arrays: `garageInfo` reads `gN` / `gBid`. The scan writes garages into back arrays (`gBid` / `gEntS` / `gEntC`), which Pz1 swaps in together with `gN`. Outside traffic, no query reads the other `o*` / `j*` / `s*` / `f*` / `k*` cycle arrays. Check it in the audit (R7). |
| **Target** | About 18 pieces of at most 0.3 ms (P0 aside). |

### PrepTransit (PH_PREP2)

| | |
|---|---|
| **Today** | Warm 1.8–2.1 / 3.3; cold 6.6 / 13.4. Parts: stops 0.6–0.8, transfers 0.5, attach 0.3, CSR 0.2, wait 0.16. |
| **Pieces** | **T0:** `refreshAttach`; `StopCollector.begin(stopsNext)`, a second `StopList`.<br>**T1..:** collector chunks (buildings, then cell rows).<br>**T2:** ferry nodes; `collectDepots` into `depotsNext`. The depot BFS (on road or depot changes only) goes in its own pieces when it runs.<br>**T3 (publish):** swap `stops` ↔ `stopsNext` and `depots` ↔ `depotsNext`; `stIdxById`; per-stop attach nodes, depot pools and riders, rho per depot, `minibus`, waits, stop bins; then the garages' stops (`gStop`, `gWalk`, `gSpaces`, `gState`, …, `gPrN`, `prKeyNow`; `gN` is small). About 0.6 ms, allowed as a publish piece.<br>**T4..:** transfers by stop ranges (`trFrom` / `trTo` / `trCost` become fields).<br>**T5:** ferry links, CSR, bus times, `tnet`, `tAcc`. |
| **Cursor state** | The collector, `stopsNext`, `depotsNext`, `trCur`, the transfer arrays. |
| **Why exact** | The stop list is collected in the same order into a second list and switched in at T3. T3–T5 consume it in today's order. The garages' part uses the bins and waits as today; it only reads `nearStops` and the per-stop arrays, not the transfers, so running it before them changes nothing. The `busNeed` smoothing runs once, in T3. `tnet` is read only by the transit search, which starts after T5. |
| **External** | Everything `stopLoad`, `depotInfo`, `depotFleet`, `minibusInfo`, `stopsNear`, `garageInfo` and `transportUseFactor` read changes in T3. Facilities' monthly `transportUseFactor` scan never sees a depot list without its stops, and `garageInfo` never pairs a new stop list with old stop indices. |

### Transit (PH_TRANSIT)

| | |
|---|---|
| **Today** | Warm 2.6–3.2 / 5.8 (search 2.4 + seeds 0.8). |
| **Pieces** | **TS0..:** seeds by job-site ranges (`seeds` grows in `j` order; the `nearStops` scratch is consumed per site).<br>**TS1:** `runT.start`.<br>**TS2..:** `runT.run(pieceUnits(0.085 µs))`, about 3,500 nodes each, about 9 chunks.<br>Without stops: one piece (today's reset + the no-stop `originTransit` path). |
| **Why exact** | §2.4. |

### Transit2 (PH_TRANSIT2, `originTransit`)

| | |
|---|---|
| **Today** | Warm 3.05–3.5 / 9.8; cold 3.4 / 4.8. |
| **Pieces** | **O0:** the fills (`rideMemo`, `stWalk`, `stNearW` / `BoardW` / `BoardT` / `ElseW`).<br>**O1..:** origin ranges (`pieceUnits(0.084 + 0.0052·ρ µs)`, ρ = stops per 1,000 cells), about 14.<br>**Oz:** the `acc` / `tAcc` fills. |
| **Why exact** | The per-origin writes are independent. The per-stop sums accumulate in origin order. `rideMemo` memoises a pure function of the fixed forest. |

### ParkRide (PH_PARKRIDE, `gN > 0` only) and PH_PROVER

No fixture has P&R garages.
- The garages stage and `SPK.start` become separate pieces.
- `PR_CHUNK_STATES` becomes `pieceUnits(0.23 µs)`, about 1,300 states. The synthetic measurement was 0.16–0.22 µs per state.
- `refreshAlt` runs in chunks over `order` (parents settle before children, so a cursor gives the same `alt`).
- `prOptions` runs by origin ranges.
- `OV_CHUNK_STATES` becomes `pieceUnits(0.2 µs)`, and `OV_CHUNK` (records) becomes `pieceUnits(per-record cost)`.
- `SearchK.run` is already resumable; the records are re-decided in record order. Calibrate on `lineTown` / `prTown` and `trafficmap --mode prk`.

### Round search (PH_RSEARCH)

| | |
|---|---|
| **Today** | Warm 1.3–1.6 / 3.4; stress1m 2.5. |
| **Pieces** | **RS0:** seeds + `runA.start`.<br>**RS1..:** `runA.run(pieceUnits(0.08 µs))`, about 3,750 nodes, about 7 chunks.<br>`SA` persists until the next cycle, as today. |

### Round match (PH_RMATCH)

| | |
|---|---|
| **Today** | Warm 1.3–2.0 / 5.0–6.1; cold 2.3 / 8.1. Parts: accept 0.6, sort 0.3, candidates 0.2, flows 0.26, keys 0.11. |
| **Pieces** | **M0:** candidates (`nc`, `maxD`, `noRoad`).<br>**M1:** packed keys (`M`, `q`).<br>**M2:** `sortCandidates` (one call) and, in round 0, the proposals.<br>**M3..:** the accept loop in chunks of `pieceUnits(0.068 µs)` (about 4,400), with `carPcu`, `trBonus` and `ovOn` computed once at the first chunk.<br>**M4:** `transitOnly` + `nextRound` (+ `ovBegin` and PH_PROVER).<br>**M5:** `roundFlows` (accumulate + commit + at most 10 sampled routes). |
| **Cursor state** | `nc`, `M`, `q`, `maxD`, `noRoad`, `accCur`, `accepted`, `carRound`, `carPcu`, `trBonus`, `ovOn`, `rmNext`; `routeCand` / `routeW` are already fields, with their `ovRouteCand` aliasing guard. |
| **Why exact** | Same candidate order: only roundMatch and the pool touch `candKey` / `candNode`, and the sorted view is not touched between pieces. Capacity and P&R room are consumed in the same order. `ovOn` is fixed before the loop consumes room. The `rand()` draws stay in M5. The frozen-original 'matching' test runs the whole `roundMatch()`. |

### Commute (PH_COMMUTE)

**Stage 0, pool:**
- **C0:** the U / O / avg loops.
- **C1..:** the `poolRemaining` main loop by origin ranges.
- **C2:** the sites.
- **C3:** the pooled car flows (accumulate + commit), or `ovBegin`.

**Stage 1:**
- `ovLegs`: `commitK` of one forest per piece; the order walk is chunked by cursor when it is over budget. The walk is backward and exact.
- End pieces:
  - **E1 (publish):** `poolCars`, prices, the per-site distribution, P&R `commitK`, garage reports and prices, `snapReach`. `garageInfo` / `garageReach` read these, and the P&R hint tests check them at every step.
  - **E2:** transit accumulate (one `accumulate()` call, about 0.3 ms).
  - **E3:** transit rider flows by order ranges into `busCellNext`, then swap (`cellBusRiders` is external); ferry riders.
  - **E4:** `markCutOff`.
  - **E5..:** per-origin results by ranges (trip sums are doubles in fields).
  - **E6:** cut-off minutes + the by-mode sums (`byMode`).

**Why exact:** the same sections touch disjoint state in today's order.

### Inbound, shop, freight (PH_INBOUND / SHOP / FREIGHT) and sinks (PH_SINKS)

**On recompute cycles:**
- **S0:** seeds + `runB.start`. Freight first runs its truck times, O(n), in its own piece.
- **S1..:** `runB.run` chunks.
- **Post pieces:**
  - inbound: desire + apply, then accumulate + commit + routes;
  - shop: per-origin trips by ranges, then accumulate + commit, then routes;
  - freight: sources, then accumulate + commit + the `truckCell` fill into `truckCellNext` + swap + routes.

`freightById`, `sinkTrucksById`, `connInbound`, `customers` and `truckCell` each change in one post piece.

**On cached cycles:** one piece each (0.05–0.15 ms), as today.

**Sinks:** the same pattern, one sink's search in chunks + its post piece.

**Why exact:** §2.4. The route-sampling draws stay in the post pieces in today's order.

### Parking (PH_PARKING)

| | |
|---|---|
| **Today** | Warm 1.75–1.8 / 3.5–3.8; cold 9.7 / 10.3. |
| **Pieces** | **K1..:** demand footprints by job-site ranges.<br>**K2:** `baseSupply` by rows.<br>**K3:** the non-P&R garages.<br>**K4:** `boxD`.<br>**K5:** the P&R reserves (box of S, `garageShortage`, reserve update, P&R supply).<br>**K6:** `boxS`.<br>**K7..:** the `parkPrev` copy + `parkingFromBoxes` by rows into `parkingNext` (the summary into a local).<br>**K8 (publish):** `st.parking.set(parkingNext)`; swap the back set of `parkD` / `parkBoxD` / `parkBoxS` / `garageFree` in; `parkingSummary`; `layerUpdated`. |
| **Why exact** | The stage works on a back set of its arrays, with the same operations in the same order. `st.parking` and the arrays `garageInfo`'s relief reads change once, in K8. Memory: about 0.8 MB for the back set at 256². |

### Final (PH_FINAL)

| | |
|---|---|
| **Today** | Warm 1.0 / 2.0; cold 3.2 / 9.4. |
| **Pieces** | **F1..:** MSA blend + ramp MSA by node ranges (private volumes).<br>**F2 (publish):** the `traffic` / `congestion` fill and write. O(C) fill + O(n) write, about 0.25 ms, in one piece.<br>**F3:** rail and subway riders.<br>**F4..:** smoothed stop loads by stop ranges into `stLoadNext` (a Map), then swap.<br>**F5:** stats + `transitFleet` + `iter++`. |

### Final2 (PH_FINAL2)

| | |
|---|---|
| **Today** | Warm 3.2–3.8 / 7.3–9.7; cold 17.2 / 28.1. Parts: origins 2.2–2.8, save 0.75, jobs 0.45–0.6, events 0.4–0.6, routes 0.15. |
| **Pieces** | **G0:** copy the per-id front arrays it writes (`accessById`, `commuteById`, `reachedById`, `carlessById`, `carlessMinById`, `modeById`, `jobFillById`, `carsById`, `customersById`) into back buffers; `commuteNext.fill(0)`; `cutIdsNext.clear()`.<br>**G1..:** origin ranges, about 1,300 each, about 10 pieces. Smoothing reads the front and writes the back; the commute footprint goes into `commuteNext`; the desired NoJobs / Congested bits into `oFlag`.<br>**GJ..:** job-site ranges, plus customers (on recompute cycles) and the connection report into `crNext`.<br>**GP (publish):** swap the per-id buffers; `st.commute.set(commuteNext)`; swap `cutIds`; apply the flags in today's order (origins, then job sites) to build `changed`; `connLast = crNext`.<br>**GE..:** `buildingChanged` for `changed`, in batches.<br>**GS1:** the save precompute (ramp-cell scan, `parkingQ` on recompute cycles, price arrays).<br>**GS2:** `buildSampleRoutes`, the `serviceRoutes` filter, `cycles++`, the `saveTransport` assembly, `layerUpdated('traffic')`. |
| **Why exact** | Each id is written at most once per cycle: origins and job sites are disjoint buildings. So reading the previous value from the front and writing the back equals today's read-then-write in place. Flags get the same values in the same order, and the events come in the same order. `RESULT_SMOOTH` reads `this.cycles`, which changes only in GS2. `saveTransport` stays the cycle's last write. In flush mode no earlier task becomes due from these events (utilities ignores `buildingChanged`). |
| **External** | `workerAccess`, `commuteOf`, `jobFill`, `routeInfo`, `st.commute` and the flags all change in GP. No reader ever sees a half-zero commute layer. |

## 4. Services and NIMBY (`services.ts`, `nimby.ts`, `catchments.ts`, `transit.ts`, `facilities.ts`; G2)

**General.**
- `S_*` and `P_*` ids are unchanged. `tierSlot`, `tierPhase`, `cursor` and `workLeft` keep their meaning.
- New fields: `sub` and the per-state cursors.
- Services' pass snapshot is taken in prep and serves prep, stops, accSeed, the accLand footprints, shopB and the EQ / HQ fallback.
- "hot" figures in this section are the services mapping's forced-pass medians, which matched the late headless window.

### S_PREP

| | |
|---|---|
| **Today** | Hot 6.0 / p99 20.8; early median 19.1 / max 34.1. |
| **Pieces** | **PR0a (consume):** `lastState`, `lastRun`, `lastPassMs`; `passUrgent = dirtyUrgent`; `dirtyUrgent = dirty = false`; `doAccess`; `nimbyAge`; `corridorHash` + `doNimby`; `ensure`; `checkNetwork`.<br>**PR0b:** zero the back need rasters; reset the lists; `fx`, justice, funding; the id arrays; `passNo`.<br>**PR1:** snapshot + plan.<br>**PR2..:** building chunks with today's body; the 7 sums in a `Float64Array` (`needAcc`); `nCs` and `multiCells` as fields; `observeBuilding(reset)`.<br>**PR3:** `needSum`, `nCsSeeds`, the shared flags.<br>**PR4..:** provider rasters, one provider per piece. Police `needOf` is about 0.5–1.0 ms (exception R2), or split into its jobs loop and its cell pass by rows in `facilities.ts`, keeping `needOf` = both. Then `provSum`.<br>**PR5 (publish):** swap `need` ↔ `needBack` and `provNeed` ↔ `provNeedBack`; road count.<br>**PR6..:** the work estimate by facility ranges (re-weighted units); tier init. |
| **Why exact** | Same statements in the same order. The float32 rasters accumulate in building and footprint order. The sums are the same doubles. The facility lists keep their order, so the seat order is unchanged. `needOf` reads the new `res` (`needBack[0]`), as today it reads the just-filled `need[0]`. |
| **External** | `needRaster()` (advisors' fire need, `facilities.ts`, placement) changes once, in PR5. Memory: +7 rasters (1.8 MB at 256²) + one police raster. |

### S_TIERS

- **Today:** hot 2.82 / 7.22 / 9.80 per step; real schedule p99 52–90 ns per unit.
- **(a) Re-weight the units** so that every phase costs about 24.6 ns per unit hot:
  - `P_INIT` 0.1 C → 0.035 C;
  - `P_REPORT` 0.25 / entry + 8 → 0.45 / entry + 14;
  - `P_FINAL` × 1.1;
  - `U_SEARCH` 3.6 → 1.75 (Euclid 1.8 → 0.9).
  - The prep work estimate uses the same units.
- **(b)** `WORK_PER_STEP = pieceUnits(0.0246 µs)`, about 12,000 units. dense1m then runs about 110 tier steps per cached pass.
- **(c) Test the budget before an item**, using its known units:
  - a cached reach: its size × (`U_COPY` + per-entry);
  - a fresh reach: `workOf`;
  - alloc: (s1 − s0) · 2 · `U_ENTRY` + 8;
  - report;
  - the final items.
  - A single item over the budget runs alone.
- **(d) `P_FINAL` becomes items:**
  - clamp `cov` into `finBuf` by rows;
  - the stats by rows over `finBuf` (pre-footprint values, as today), with need / served / unreached in fields;
  - capacity / overcrowded + `tierStats`;
  - `footprintMax` on `finBuf` by multi ranges;
  - publish: `layer.set(finBuf)`, the cache swap, the next slot.
  - The transit slot does only clamp + publish.
  - Today the stats read the layer before `footprintMax` and the published layer is after it. Both are kept, and no reader ever sees a tier layer without its lot max.
- **(e) R10's per-facility typed arrays.** The values are captured in prep. Today `powById` reads `Powered` at the tier step: the same value uninterrupted, a prep-time value interrupted.
- **Why exact:** a step stops only between items. `A`, `cov`, `seat`, the pool and `curEnt` persist as today. The units only move boundaries.

### S_STOPS

- **Today:** hot 2.06 / 3.91; early 4.45 / 17.2.
- **Pieces:**
  - **ST0..:** `StopCollector` over the snapshot (a services-owned collector and list).
  - **ST1:** funding captured; `tmp.fill(0)`.
  - **ST2..:** disks by stop ranges (the range variant, about 600 disks per piece); `active(s)` is evaluated per stop.
  - **ST3..:** compose by rows into `tmp`: `tmp[i] = t > 0 ? 1 − (1 − T[i])(1 − min(1, t)) : T[i]`, today's expression.
  - **ST4 (publish):** `transitCov.set(tmp)`.
- **Why exact:** the disks accumulate in stop order. The compose is per cell with the same float operations. `tmp` is next overwritten by accLand.

### S_NIMBY (`nimby.ts`)

- **Today:** hot 2.33 / 7.27; early 8.42 / 15.0.
- **`NimbyRun`, per `CityState`:** scratch `stig` / `line` / `pres` / `camp`, three back rasters, cursors, `touches`.
- **Pieces:**
  - **N0:** the four fills, the `plantLoad` function, the snapshot (the services pass snapshot).
  - **N1..:** building chunks (about 0.08 µs per building + 6 ns per kernel touch).
  - **N2:** landfill row pairs (z cursor, `lfNext`).
  - **N3..:** corridor cells by index ranges. Boundaries fall on multiples of 4, so the word-skip runs exactly as today.
  - **N4..:** the 1 − exp(−x) pass by rows into the back rasters.
  - **N5 (publish):** `stigma` / `prestige` / `campus` `.set()` + `costEst.set(...)`.
- `rebuildNimby(sim)` and `nimbyCost(sim)` keep today's semantics and formula: a whole rebuild, and the estimate from the last rebuild's touches. The J4 exact test and the WASM nimby test use them. The scheduler uses the run's per-piece costs.
- **Why exact:** the `splatAdd` sums run in building order; the landfill row order is kept; `splatMax` is order-free; the final pass is per cell; the touches add up to the same count.

### S_ACC_SEED

- **Pieces:** **AS0:** `idist.fill(-1)`. **AS1..:** building chunks, about 0.11 µs per building.
- **Why exact:** the result is a min per frontage cell, so it is order-independent.

### S_ACC_SEARCH (`catchments.ts`)

- New `RoadTimeRun`, a resumable `roadTimeMulti`:
  - private `head` / `enode` / `enext`;
  - state `cur`, `e`, `pending`, `settled`;
  - `start` = today's seed scan over C;
  - `run(pieceUnits(0.053 µs))`, about 5,600 cells.
- `roadTimeMulti()` = `start` + `run(∞)`.
- **Why exact:** costs are integers ≥ 1 and `head[cur]` is cleared before the drain, so a bucket's list is fixed while it drains, and resuming at the saved entry is exact.
- **Interrupted mode:** the search reads the live network, like today's three access steps.

### S_ACC_LAND

- **Pieces:**
  - **AL0..:** the init by rows.
  - **AL1..:** chamfer forward rows.
  - **AL2..:** chamfer backward rows, descending.
  - **AL3..:** the output by rows into `accNext` (`avgCommute` captured at AL3's first piece).
  - **AL4..:** the home footprints over the snapshot into `accNext`.
  - **AL5 (publish):** `accessCommute.set(accNext)`.
- **Why exact:** each chamfer sweep only reads rows it has already finished, so it resumes at row boundaries with identical operations.

### S_SHOP_A

- `RoadDistRun`, a resumable `roadDistMulti` (8 circular buckets): **SA0** start; **SA1..** chunks of `pieceUnits(0.038 µs)`.

### S_SHOP_B

- **Pieces:**
  - **SB0..:** init + chamfer forward rows.
  - **SB1..:** backward rows.
  - **SB2..:** block sums (`pop` by rows; `cs` over the snapshot). `cs` and `pop` become fields; today they are allocated per call.
  - **SB3:** `box3` × 2, the ratio, the LUT, the column taps.
  - **SB4..:** the bilinear output by rows into `shopNext`.
  - **SB5 (publish):** `shopAccess.set(shopNext)`.

### S_FOOT

- One piece of about 0.38 ms (a publish piece): the transit footprint max.

### S_FINISH

- **Pieces:**
  - **FI0 (publish):** the legacy combos, `eduCov` / `parkCov`, about 0.27 ms.
  - **FI1..:** one tier with facilities per piece (served / unreached in fields, cell order).
  - **FI2:** `stats.needs` + the stale records.
  - **FI3..:** the EQ / HQ fallback over the snapshot (it breaks early once WP1's `b.edu` is present).
  - **FI4:** `dtDays`, `lastEqDay`, EQ / HQ, `donePasses`, the events, `stepIdx = -1`, `firstPass` / `passUrgent` reset.

**Memory for services + NIMBY:** need rasters 1.8 MB + `finBuf`, `accNext`, `shopNext`, the NIMBY back rasters (about 1.3 MB) + the two private queues (about 2.6 MB) ≈ 6 MB at 256².

## 5. Crime (`crime.ts`; G3)

`stepIdx` 0, 1, 2 are unchanged. There is no dirty input (the period is 20 days).

| state | today (dense1m) | pieces | why exact |
|---|---|---|---|
| 0 sources | acc 13.7 med / 21.6 max; warm 2.83 | **CS0:** `lastRun`, `raw.fill(0)`, `ctx = context()` (stored), `arrest = 0`, the pass snapshot + plan (weights 5 ns·B + 63 ns·F).<br>**CS1..:** chunks with today's body; the CRIME_SPILL venues found on the way go into a list, in list order.<br>**CS2:** the venue splats from the list.<br>**CS3:** emergency boosts, the clamp over C, `addArrestPotential`. | `ctx` is computed once at the pass start, as today. `arrest` is one running double in list order. The `raw` writes are in list order. The spill splats come after all chunks, in list order. Collecting the venues during the chunks only drops the second walk; the splat order is unchanged. The map-other prototype's digests were identical at chunk sizes 97 and 4,096. |
| 1 spread | acc 1.59 / 4.37; warm 1.27 | **SP0:** `tmp.set(raw)`.<br>**SP1..SP6:** the six `boxH` / `boxV` calls of `blur3`, one per piece (about 0.15 ms each).<br>**SP7 (publish):** the mix into `st.crime` (about 0.37 ms). | The same calls in the same order on crime-private buffers. `colSum` is reset per call. |
| 2 flags | acc 1.22 / 5.36 | **CF0..:** chunks: `c`, the weighted sums (doubles in fields), the desired Crime bit.<br>**CF1 (publish):** apply the flags in order → `changed`; `avgCrime`.<br>**CF2..:** the events, batched; `layerUpdated('crime')`; the pass end. | Sums in list order. Flags get the same values in the same order; events likewise. |

## 6. Pollution (`pollution.ts`; G3)

`S_*` 0–9 are unchanged. `stepIdx ≥ 0` for the whole pass, so `daily()`'s tree-cover refresh never touches `tmp` / `tmp2` mid-pass.

| state | today (dense1m: acc med / max; warm) | pieces | why exact; external |
|---|---|---|---|
| 0 garbSrc | 3.46 / 12.6; 0.95 | **GS0:** the pass start (`ensureCells` / `Ids`, `dtMonths`, `lastRun`, `fxB` / `fx3B` / `jobsUnknownB` / `dtMonthsB`, funding, `util`, `nSeeds = 0`, the facility list resets, `roadless`; produced / caps / `treatCap` as double fields); the pass snapshot.<br>**GS1..:** building chunks.<br>**GS2:** the landfill-scan setup (`lab.fill(-1)`, region arrays, `lfCellCap`, `track`).<br>**GS3..:** the landfill scan by cell ranges. One region's flood fill and its seed rollback always run inside one piece.<br>**GS4:** the tail (`lfOrder`, `nReg`, `lfPrevValid`, caps, summary, `treatCapB`). | Building order and float sums are kept. Region ids follow the scan order; cells labelled ahead of the cursor are skipped exactly as today (`lab ≥ 0`). The brownfield `soil` and `landfillFill` writes are rare per-cell stock writes, in place as today. |
| 1 garbRoute | 1.10 / 6.83; 0.90 | **GR0:** stamps + seed signature.<br>**GR1..:** road checksum by cell ranges (the mod sum in a field).<br>**GR2:** signature check → BFS start (`rd.fill(255)`, seeds).<br>**GR3..:** `truckBfs` by queue chunks (`qh` / `qt` as fields).<br>**GR4..:** per-building perimeter distance, bucket counts, `reach`, `reachProd`.<br>**GR5:** the counting sort.<br>**GR6 (publish):** allocation, incinerator shares (`incShare`, read by utilities), region use, summary, stats. | The checksum is a sequential mod sum in index order; the BFS is in queue order; the allocation is nearest-first over the same order. |
| 2 garbApply | 6.75 / 11.8; 0.82 | **GA0:** `gNext.set(st.garbage)`.<br>**GA1..:** building chunks (reasons, piles on `gNext`, the desired NoGarbage bit, the out-of-range sums and first position in fields).<br>**GA2:** landfill fill + display. `st.landfillFill` (a saved stock) is written in this one piece.<br>**GA3..:** leftover decay by cell ranges on `gNext`.<br>**GA4 (publish):** `st.garbage.set(gNext)`, the flags in order, summary, stats.<br>**GA5..:** events; `garbageNews`. | Each cell is updated from its own value. Order-dependent sums and the first position are kept by the cursor. Crime's sources read `st.garbage` only after GA4. |
| 3 srcBld (stageA) | 2.90 / 24.6; 1.95 | **SB0:** the 9 clears (about 0.3 ms) + setup (`stats.sewageTreated` as today at the stage start, `sewageMul`, heat, the sources, `used.fill(0)`, `parkSig = 0`).<br>**SB1..:** building chunks (41 ns·F).<br>**SB2:** the `parkSig` compare, `parkDirty`, emergency spills. | The footprint adds into the class grids keep list order. `used` is an OR. `parkSig` is an order-dependent hash carried in a field. |
| 4 srcCells | 0.69 / 5.29; 0.52 | **SC0..:** the cell loop by ranges (`anyA` / `anyN` / `anyW` as OR fields).<br>**SC1:** freight rail, the used flags, landfill cells.<br>**SC2..:** when `treesDirty \|\| firstPass`: the `t` fill, `boxAverage` → `st.treeCover` (one call), `boxAverage` → `treeNear`, the count.<br>**SC3:** when `parkDirty \|\| firstPass`: `boxAverage` → `parkBuf`. | Per-cell adds are independent; the same calls run. Each dirty flag is cleared in its own piece, as today. |
| 5 airNear | 2.36 / 3.56; 1.51 | **AN0:** `field.fill`, `acc.fill`, class-0 `blurDown` + accumulate.<br>**AN1:** class 1.<br>**AN2, AN3:** the two `upsampleAdd` calls. | The same calls in the same order on private buffers. The upsample tables are a pure cache. |
| 6 airFar | 1.30 / 2.29; 1.17 | **AF0..AF2:** the plume (`blurDown` f = 4, then the two `upsampleAdd`) when `used[2]`.<br>**AF3 (publish):** `saturate` → `st.airPollution`. | Same calls. |
| 7 noise | 3.26 / 6.91; 1.96 | **NO0:** the `treeNear` check + `blurPair` class 0 (`fill` + `blurDownAdd`).<br>**NO1:** class 1.<br>**NO2..:** `noiseBuffer` by row ranges.<br>**NO3 (publish):** `saturate` → `st.noise`. | `noiseBuffer` reads only the finished private field; it is per cell. |
| 8 water (stageB) | 2.97 / 10.1; 1.67 | **WA0, WA1:** `blurPair` class 0 and class 1.<br>**WA2:** `wNext.set(L)` + the cleaning loop.<br>**WA3:** ground `saturate` (private).<br>**WA4:** `ensureWaterList` when invalid.<br>**WA5..:** diffusion by (sweep, q range): `cur` is fixed during a sweep, `nxt` is written, then copied.<br>**WA6:** land + banks on `wNext`.<br>**WA7 (publish):** `st.waterPollution.set(wNext)`. | The synchronous sweeps cut exactly between and inside sweeps. If `terrainChanged` invalidates the list mid-pass (interrupted mode only), WA5 rebuilds it first. Utilities' intake reads only the published layer. |
| 9 flags | 1.87 / 10.3; 1.00 | **FL0:** the soil stock over C when `dt > 0` (a saved stock, in one piece).<br>**FL1..:** building chunks (the weighted sums as doubles; the desired Polluted / Noisy bits).<br>**FL2 (publish):** the flags in order, `stats.avg*`.<br>**FL3..:** the events; `layerUpdated('pollution')`. | Sums in list order; flags and events in today's order. |

## 7. Utilities (`utilities.ts`; G4)

- `U_*` 0–5 are unchanged; the `environment2` "brownout in its own step" test still sees `stepIdx` 3.
- `passFull` is decided at the pass start, as today. The `urgent()` semantics are unchanged.
- Utilities is registered first, so in flush mode nothing ever runs inside its pass.

**U_USES:**
- **UU0 (consume):**
  - `ensure`, `readEffects`, `plantEfficiency`, `producersNext.clear()`, `nuclearMul`, season, climate, the pollution reference;
  - `if (passFull) dirtyFull = false`;
  - `soft = false`;
  - swap `added` / `removed` into pass-local arrays;
  - the pass snapshot.
- **UU1:** the sea mask when there is a water producer. It is a pure function of the water grid: computing it before the loop changes nothing.
- **UU2..:** the treatment prefix scan in chunks. It exits early; `infos` keeps the prefix.
- **UU3..:** the uses chunks (24 ns·B + 17 ns·F). Plant and critical pushes go in list order; `nPlants`, `nCrit` and `nuclearLost` are fields.
- **UU4 (publish):** swap `producers` ↔ `producersNext` (`producerInfo` is read by pollution and the UI); nuclear news; `patchPower` with the pass-local lists; the next state.

**U_LABEL:**
- `labelPower` becomes resumable into `pCompNext`: outer cursor `s`, `nc`, and a BFS on `this.queue` with `qh` / `qt` as fields.
- Publish: swap `pComp` ↔ `pCompNext`, `nPComp`, `growPower`, `lastFull`.
- Then `labelWater` the same way into `wCompNext` (consume `dirtyWater` at its first piece).
- Today's short window, from the label to the sums, in which `gridInfo` pairs new labels with old sums, is unchanged.

**U_POWER:**
- **UP0:** fill `cSupplyN` / `cDemandN`.
- **UP1..:** the sums chunks (`supplyTot` / `demandTot` as doubles in fields).
- **UP2 (publish):** `okComp`, `anyShort`, the plant loads (`loadById`, `producers.load`), `stats.powerSupply` / `Demand`, stamp, swap the sum arrays.
- No short grid:
  - **UR0:** cells → `poweredNext`.
  - **UR1..:** building results (`bPow` + footprints into `poweredNext`).
  - **UR2:** zoned cells, reading `poweredNext`.
  - **UR3 (publish):** `st.powered.set(poweredNext)`.
- Short grid: **UP3:** the critical loads → U_BROWN.

**U_BROWN:**
- **UB0:** cells → `poweredNext`; seeds from the plants of short grids; the `exhausted` fill.
- **UB1..:** BFS chunks (`pieceUnits(0.027 µs)` queue cells; `visit` stamps; `served` stamps).
- Then UR1–UR3 with `brownout = true`.

**U_WATER:**
- **UW0:** the mid-pass water relabel when `dirtyWater`, resumable as above.
- **UW1:** fill the next buffers; snapshot.
- **UW2..:** sums chunks (`bComp`, the seeds in order).
- **UW3 (publish):** `okW`, `anyShort`, stats, stamp, `tapQuality`, swap. `waterQualityAt` (read by population) never sees half-summed supplies.
- No short network: the results pieces → `st.watered.set()`, then finish.

**U_WATER_BROWN:**
- Cells + seeds (`perimeterRoadCells` in seed order).
- BFS chunks (70–99 ns per queue cell, about 3,500 per piece).
- Results; finish.

**Finish:**
- **FN0 (publish):** the flags loop over the snapshot (`setFlagQuiet` Powered / Watered, `watSeen`, `tallyCut`), about 0.3–0.5 ms. At larger sizes it is chunked; the flags are its output, so the events still follow.
- **FN1..:** the events, batched (a restore pass emits 7.3k).
- **FN2:** the cut news, the shortage and blackout news, `layerUpdated('utilities')`, `stepIdx = -1`, `lastServe`.

**Why exact:**
- Sums, pushes, flags, tallies (`cut.at` = the first largest building) and events keep list order.
- The `producers` Map keeps insertion order.
- The BFS queues run in the same order on utilities-private buffers.

**Memory:** two `Int32Array(C)` + two `Uint8Array(C)` + the small component arrays ≈ 0.7 MB.

## 8. Emergency response (`emergency.ts`; G4)

`respStep` 0–4 are unchanged; `p.resp` and `saveResp()` after every piece are as today.
- **Every piece with `respStep ≥ 0`** first runs today's `ensureGraph` epoch check. A new graph restarts the sequence, as today.
- **Start (`respStep < 0`):**
  - **ES0:** `syncStations` (the lazy station refresh shared with dispatch, exception R2); `ensureTimes`; the resets (`respVer`, `respDirty`, `respNetOnly`, `csActive`, `respBCur`, `respZ`); the `respTm` copy.
  - Then `respStep = 0`. Its estimate covers `graphSig` (5n) when the graph version moved, and `refreshStations` (B) when `stDirty`.
- **respStep 0, 1, 2:**
  - first piece: seeds + `cs.start` (O(n));
  - chunks of `pieceUnits(0.05 µs)`, about 6,000 nodes (replacing `EMERG_SEARCH_CHUNK` 24,000), about 4 per responder;
  - the finishing chunk + the O(n) slack pass (0.06 ms).
- **respStep 3:** row ranges (`pieceUnits(0.0113 µs per cell)` / N rows, about 100 rows); the RESP_NONE fills in the first piece; the cursor `respZ` is reset at the sequence start and on an epoch restart.
- **respStep 4:** `EMERG_FILL_CHUNK` = `pieceUnits(0.14 µs)`, about 2,100 buildings, over today's live list with `respBCur`.
- **Why exact:** `ChunkedSearch` already resumes exactly. Each cell and each building is written once from the frozen slacks.
- **Tests:** extend `emergency.test.ts`'s `respCost` loop to the new sub-states. The `p.resp` 'save + load mid-response' test is unchanged.

## 9. The cost model

### 9.1 Form and units

Each piece's estimate is `est = a + Σ_k coef_k × u_k`.
- `u_k` are the piece's own work counts, known before it runs:
  - C (cells, or the cells of the piece's rows);
  - B (buildings in the chunk);
  - F (their footprint cells, from the prefix sum);
  - n (road nodes); k (states settled in the chunk, `min(budget, n − settled)`);
  - oN, jB, qN, S, T, nc;
  - E (events);
  - Q (queue cells);
  - tier work units;
  - plus the condition flags (`used` classes, dirty flags, short grid).
- `a` is the per-piece overhead, about 0.01–0.02 ms (fit).
- Coefficients are in µs per unit. Their meaning is **warm wall-clock ms on this 4-core box in the headless schedule** (interleaved, late window). The estimates cannot see JIT state; calibrating them to cold runs would overstate the steady state 2–5×.
- They live as named constants next to each task's step code, with a comment giving the fit date and fixtures.

### 9.2 Start coefficients (µs per unit; each group refits its own)

Traffic coefficients are from `trafficfit.py`, multiplied by about 1.2 (warm headless against trcycles, measured at dense1m). Services, emergency, crime, pollution and utilities coefficients are from the in-schedule fits of their mappers.

**Traffic.**
- Searches:
  - road Dial: 0.080 per settled node (+ 0.01 ms per chunk);
  - transit: 0.085 per settled node;
  - transit seeds: about 0.34 per job site;
  - accumulate 0.0065 and commit 0.0062 per node.
- Prep:
  - scan: 0.20 per building (or about 0.12·B + 0.03·F; fit);
  - node times + ramps + fills: 0.017 per node;
  - origin init 0.015 per origin;
  - `jNoise` + caps 0.017 per site; clusters 0.055 per site.
- Graph build: road 0.010 per cell + 0.072 per node; rail and subway (mask) about 0.003 per cell.
- Matching:
  - candidates 0.020 per origin;
  - keys 0.012, radix sort 0.032 and accept 0.068 per candidate;
  - `nextRound` 0.003 per origin;
  - pool main 0.096 per candidate; pool U / O / avg 0.014 per origin + 0.012 per cluster.
- Commute end:
  - prices 0.042 per cluster; distribution 0.018 per site;
  - `snapReach` 0.029 per origin;
  - transit accumulate and flows 0.010 each per transit node;
  - cut 0.003, per-origin 0.019 and by-mode 0.012 per origin.
- Transit2: 0.084 + 0.0052·ρ per origin.
- Stops (per stop): attach 0.12; waits 0.06; transfers 0.21; stop loads 0.28. `collectStops`: 0.043 per building + 0.002 per cell.
- Post-search parts:
  - inbound desire + apply 0.036 per job site;
  - shop origins 0.038 per origin;
  - freight sources 0.059 per source;
  - truck times 0.0037 per node.
- Parking:
  - box filter 0.0066 per cell each;
  - `baseSupply` 0.005 per cell;
  - `parkingFromBoxes` 0.011 per cell;
  - demand footprints 0.12 per job site.
- Final: MSA 0.0043, ramp MSA 0.0049 and write 0.0076 per node; layer fills 0.0007 per cell.
- Final2:
  - origins 0.23 per origin; job sites 0.17 per site;
  - events 0.4 per event;
  - `saveTransport` 0.02 per node (+ 0.003 per cell on recompute cycles);
  - routes 0.016 per origin.
- P&R: K-label 0.23 per state; overflow 0.2 per state; `refreshAlt` 0.02 per state.

**Services.**
- Tiers: 0.0246 per re-weighted unit + 0.03 ms per step.
- Prep:
  - setup about 0.009 per cell;
  - buildings about 0.12 per building + 0.09 per home footprint cell (fit);
  - police need about 0.011 per cell;
  - work estimate 0.15 per facility;
  - road count 0.0012 per cell.
- Stops: `collectStops` 0.012 per building + 0.0088 per cell; disks 0.51 each; compose 0.0024 per cell.
- NIMBY: 0.08 per building + 0.006 per touch; fills + final about 0.02 per cell.
- Access:
  - accSeed 0.11 per building;
  - accSearch 0.053 per settled cell (+ 0.22 ms start);
  - accLand chamfer 0.009 per cell per sweep, init and output 0.002 per cell, home footprints 0.035 per footprint cell;
  - shopA 0.038 per settled cell.
- ShopB: chamfer as accLand; blocks 0.009 per cell; output 0.008 per cell.
- Foot: 0.0168 per multi-footprint cell.
- Finish: combos 0.0041 per cell; per tier 0.0026 per cell; rest 0.1 ms + 0.004 per id.

**Emergency.**
- Search: 0.05 ms + 0.050 per settled node; slack 0.0026 per node.
- `resp3`: 0.14 ms + 0.0113 per cell.
- `resp4`: 0.05 ms + 0.14 per building.

**Crime** (ns per unit):
- sources: 5·B + 63·F per chunk; begin 0.10 ms + 0.6·C + 1.5·B;
- spill: 12·B + 4·F + 1.4·C;
- spread: 20.3·C in total (blur 14.0, mix 5.7, copy 0.6);
- flags: 31·B + 4.5·F + 400·E.

**Pollution** (ns per unit; `u` are the `used` flags):
- garbSrc: 0.08 ms + 12·B + 7·F + 6.0·C;
- garbRoute: 1.85·C + 21·F, + 14·Q when the BFS reruns;
- garbApply: 20·B + 11.6·F + 2.9·C + 30 per landfill cell + 400·E;
- srcBld: 0.08 ms + 4.5·C + 41·F;
- srcCells: 7.6·C, + 12.4·C with trees, + 4.8·C with the park buffer, + 0.17 ms with freight rail;
- airNear: 0.6·C + 7.8·C·u0 + 5.7·C·u1 + 10.3·C·(u0 | u1);
- airFar: 11.8·C·u2 + 6.8·C;
- noise: 11.5·C·u5 + 5.5·C·u6 + 11.8·C + 31 per walked cell;
- water: 11.5·C·u3 + 5.5·C·u4 + 8.0·C, + 6.0·C on a list rebuild, + 8 × nW × 8 for the diffusion;
- flags: 3.2·C (when `dt > 0`) + 26·F + 400·E.

**Utilities** (ns per unit):
- uses: 0.08 ms + 16 per prefix-scanned building + 24·B + 17·F;
- label: 13.7·C (power) + 4.0·C (water when dirty);
- power: 15·B + 3·F; results + 5.1·C + 5.9·B + 7.9·F;
- brownout: 5.5·C + 27·Q + 12·F;
- water: 12·B + 9·F; results + 4.2·C + 4.4·B + 8.5·F; finish + 14.5·B + 400·E;
- waterBrownout: 6.3·C + (70–99)·Q + (20–26)·F + 400·E.

A stage total is the sum of its pieces' estimates. A piece's estimate covers exactly the slice of today's work it runs.

### 9.3 Calibration (each group for its pieces; G4 for all)

1. **Labels.** Each system's `stepName` gives piece-level labels. `b2work/tools/cpumap.ts` already reads it; `stepmap.ts` and `trafficmap.ts` label by state.
2. **Runs.** Headless `--warm 300 --days 120` (warm, in-schedule) on dense1m, bot256, stress1m, vet_s7_y21, vet_s7_y43 and small_s7_y10.
   - 3 runs each, under the timing lock and the idle gate (`tgate.py` / `timed.py`).
   - Drop runs with `otherCoresAvg > 0.4`.
   - Use `--noinputs` with cpumap; the per-day census inflates step costs 5–25 %.
3. **Fit.** One designated unit per part. NNLS on relative error, pooled over the cities.
4. **Validate.** The median of (est / measured − 1) per task and pooled must be within ±20 % in the warm runs (a margin for the ±30 % gate) on dense1m and on bot256. Report the cold window too.
5. **Chunk sizes follow from the coefficients.** A refit moves step boundaries, and so the bot. That is by design.

### 9.4 The budget (G4)

1. **Measure B's real infra ms per day.** The sum over tasks of `scheduler.spentMs` divided by days, headless, late window (`--warm 300 --days 120`), dense1m and bot256, 3 runs each. Expected: dense1m 5.9–6.5, bot256 4.9–6.0.
2. **Set `INFRA_DAY_BUDGET`** so that W's real infra ms per day matches B's within ±5 % (the geometric mean of the two fixtures). With honest estimates that is about B's real ms per day: about 5.3–5.6.
3. **Set the others:** `INFRA_DAY_CARRY` ≈ 1.0 and `CREDIT_FLOOR` ≈ 6.5 (today's values × the same factor).
4. **Report per-task cadence, B vs W:** traffic cycles, services, pollution and crime passes, and emergency sequences per 360 days, at both fixtures.
   - Expected at dense1m: traffic slower (about 34 days per cycle instead of 25.7), pollution faster (its 12-day period instead of 20), services within about 6 %. Honest fairness now hands out equal *real* time.
5. **Re-check P0-15** (stress-city utilisation ≤ 0.89). If it fails with honest estimates, re-baseline the gate with the measured value and the reason. The gate's comment gives the million-population phase ownership of the scheduler budget.
6. **Then the balance runs (§12).** If the balance fails because of a cadence shift (identified by the cadence table), the fallback is a per-task weight in the scheduler's admission and credit, `INFRA_TASK_WEIGHT` in params.ts, default 1. It restores today's real-time share for the task concerned. This is a balance knob, used only on that evidence.

### 9.5 The cost-error metric

`err = est / measured_wall − 1` per executed step. Report:
- the pooled median over all steps of all tasks;
- the median per task;
- the median per state label.

| window | pooled median | per-task medians |
|---|---|---|
| warm (`--warm 300 --days 120`) | gate: within ±30 % | gate: within ±30 % |
| cold (`--warm 20 --days 60`) | gate: within ±30 % | reported, not gated |

A perfect warm model scores a pooled −0.26 in today's cold window (map-other). With small pieces most cold-window steps are warm, so the pooled cold median should land well inside the band. A deterministic estimate cannot follow JIT state per state label, so the per-label medians in the cold window are reported only.

## 10. Build order

Each group finishes with:
- `npx tsc --noEmit` clean;
- the full vitest suite green, with the adaptations of §11.5;
- `passdigest --mode atomic` W vs B identical on dense1m and bot256 at 30 and 100 days;
- its pieces' estimates at most `INFRA_PIECE_MS` at dense1m, except the exceptions of R2 (publish pieces at most 2 ×, kernel calls at most about 1 ms, the edit-only lazy caches), printed by a test or a tool;
- its tasks' steps within the gate on the cold and warm windows, measured per task;
- its commits in W.

G2 and G3 touch files disjoint from G1's traffic work, except one addition each to `transit.ts` and to `params.ts`. They can start once G1's first commit (the core) has landed.

**G1-core-traffic**
- **Core commit:**
  - `scheduler.ts`: the urgent budget and live cap, `STEP_GUARD`, `pieceUnits` / `setPieceScale`;
  - `params.ts`: `INFRA_PIECE_MS`, `INFRA_URGENT_*`, the provisional budget / carry / credit floor;
  - `common.ts`: `BuildingSnapshot`;
  - `search.ts`: the resumable runs;
  - `graph.ts`: the piecewise builders;
  - `transit.ts`: `StopCollector`;
  - the exactness harness `tests/infra/b2Pieces.test.ts` (§11.1), with the helpers the other groups reuse.
- **Then `traffic.ts`:** §3 in full, with the cost model.
- **Tests:**
  - `tests/sim/exact/traffic.test.ts` 'cities' compares at every phase transition and at cycle ends instead of after every step, and drops the per-step `stepCost` equality (recalibrated by design);
  - `tests/wasm/roadTransitSearchSim.test.ts`: count only the module functions still called (`roadSearch`, `accumulate`), and shadow-compare the resumable runs at completion against `orig.roadSearch` / `orig.transitSearch`;
  - `parkRideOverflow` stays as it is: hints at every step.
- **Gate:** the traffic part of §12 on dense1m: traffic steps p99 ≤ 3 and max ≤ 5 in the cold window, and traffic's median error within ±30 % warm.

**G2-services-nimby**
- **Files:** `services.ts` (§4), `nimby.ts` (`NimbyRun`; `rebuildNimby` / `nimbyCost` kept), `catchments.ts` (`RoadTimeRun`, `RoadDistRun`), `transit.ts` (the coverage range variant), `facilities.ts` (optional: split `policeNeed`).
- **Tests:**
  - `servicesTrigger` (`LATENCY_DAYS = 2` must hold through the urgent budget; update the step-count comment);
  - `catchments.test.ts` (max estimate ≤ 3 stays; recheck `cached.est < 0.6 × fresh.est` with honest units, and if it fails, compare the tier-step estimates, where the reach cache acts);
  - `tests/sim/exact/nimby.test.ts` (piecewise and whole rebuild against `nimbyOriginal`);
  - the WASM services tier engine sections (§11.6).

**G3-crime-pollution**
- **Files:** `crime.ts` (§5), `pollution.ts` (§6).
- **Tests:**
  - `environment2` (raise the step guard 20 → 400 in the "appear between steps" test);
  - `perf.test` (`stageA` / `stageB` stay whole-stage methods);
  - the WASM field-pass sections (§11.6).

**G4-utilities-emergency-recalibration**
- **Files:** `utilities.ts` (§7), `emergency.ts` (§8); the final scheduler constants (§9.4); P0-15 re-check; `INFRA_TASK_WEIGHT` only if needed.
- **The full acceptance (§12):**
  - latency and cost error on both windows;
  - the balance procedure;
  - new bot hashes: a `b2` key in `tests/sim/fixtures/balance-baseline.json` for the three runs, `reference = 'b2'`, old rows untouched;
  - the new 128 × 15 seed-7 2015 population.
- **The report:** `docs/dev/reports/local-B2-step-split.md`.
- **Tests:** `environment2` ('brownout in its own step' stays as it is), `emergency.test.ts` (`respCost` loop), `perf.test` P0-15.

## 11. Tests

### 11.1 Whole-pass exactness: one go against many small steps

**New file `tests/infra/b2Pieces.test.ts`, built in G1 and extended by each group.**
- **Setup:** two identical cities per task.
  - Traffic: a `stressCity(96)` with transit added the way `smallCity` in `tests/sim/exact/traffic.test.ts` does it (the generator's subway row 97 is off a 96² map), plus a `lineTown` P&R garage row, so that P&R, overflow and sinks run.
  - Services: `servicesCity(96)` (tests/wasm/servicesCity.ts).
  - Pollution: a city built like `testCity` in `tests/wasm/fieldPasses.test.ts` (a local function there, so move it to a shared helper): a water body + landfill.
  - Utilities: a short power grid and a short water network.
  - Emergency: three station types.
- **Arm A** runs each pass with `setPieceScale(1e9)`, one piece per stage. That is the "one go".
- **Arm B** runs each pass in many small steps: scale `1e-9` (one unit per piece) for the small cities, plus random scales per pass.
- **Atomic mode:** `tickDay` / `tickFrame` are switched off and each pass is driven by `task.step()` until done, with nothing in between. Run 3–6 passes, with a network edit and a building edit between passes (rebuild path, carried state).
- **After every pass, compare digests of:**
  - every `CityState` typed array;
  - `stats` (JSON);
  - building flags and the fields the tasks write;
  - every typed-array and Map field of the system (reflection; new scratch excluded by name);
  - the emitted event sequence (type + id);
  - traffic's `rngState`;
  - `systemData.infraTransport` and `systemData.emergency`.
- **Also:** production scale against `1e9`.
- **Running time:** under about 60 s per task on the shared box.

**The gate against today's code: `b2work/tools/passdigest.ts --mode atomic`.**
- In each tree (B, W), every pass runs uninterrupted.
- It compares the sha256 of `serializeCity`, a digest per top-level key, every `CityState` typed array, `stats.needs`, the services per-facility arrays and the emergency node slacks.
- Fixtures: dense1m and bot256, 30 and 100 days. Every digest must be identical, B vs W.
- Run per group and in G4. The step counts in its output show how much finer W is.

**Frozen originals.** `tests/sim/exact/traffic.test.ts` (`TrafficSystemOriginal`) at phase ends, and `nimby.test.ts` (`nimbyOriginal`).

### 11.2 Determinism

- Two headless runs of the same seed give identical digests: `passdigest --mode headless`, twice, in W, on both fixtures, 120 days.
- **New test: two cities interleaved in one process.** A step, B step, ... each equals its solo run. This catches shared module-level scratch (R8, nimby).
- Keep: `servicesTrigger` "identical at different clock speeds" and `emergency.test` "two runs with the same seed".

### 11.3 Save and load as today

Keep these, unchanged:
- `tests/save/serializePhase0.test.ts`: derived layers are not saved, stocks are;
- `tests/infra/emergency.test.ts` 'save + load mid-response': `p.resp` pending = 2 and the same scheduler work;
- `tests/infra/transitFacilities.test.ts` 'WP7b save / load' (about l. 1030–1085);
- `tests/sim/exact/traffic.test.ts` 'cities' reload.

New: save in the middle of every task's pass, with tiny pieces so that every task is mid-pass. Then:
- (a) the saved key set (top level and `systemData`) equals the key set of a save taken between passes. No B2 field is saved.
- (b) After `deserializeCity` + a new `Simulation`, every task is idle (`phase` / `stepIdx` / `respStep` < 0, except emergency's saved schedule) and every B2 cursor is at its reset value.
- (c) Loading the same save twice gives identical cities after 30 days.

### 11.4 Consistency between pieces (R7)

- Keep the `parkRideOverflow` hint tests at every step.
- **New (interrupted, with tiny pieces):** after every piece of every task, check that:
  - `st.commute`, `accessCommute`, `shopAccess`, `parking`, `powered`, `watered`, `garbage`, `waterPollution` and the NIMBY layers each equal either their value before the stage or after it;
  - `needRaster()` changes only at the swap;
  - `depotInfo(id).stops` is never 0 for a depot that had stops before and after;
  - `waterQualityAt` changes only at UW3.

### 11.5 Existing tests that change

| test | change | why |
|---|---|---|
| `tests/sim/exact/traffic.test.ts` 'cities' | compare at phase transitions and at cycle ends; drop the per-step `stepCost` equality | the boundaries and the estimates change by design; the phase results must still match the frozen original |
| `tests/wasm/roadTransitSearchSim.test.ts` | count only the module functions still called; shadow the resumable runs at completion | traffic's searches are resumable classes now |
| `tests/sim/servicesTrigger.test.ts` | comment only (the urgent budget replaces the 8 steps) | — |
| `tests/infra/catchments.test.ts` | recheck the cached / fresh estimate ratio with honest units | the units are re-weighted |
| `tests/infra/environment2.test.ts` | step guard 20 → 400 in the "appear between steps" test | there are more steps per pass |
| `tests/infra/emergency.test.ts` | extend the `respCost` loop to the sub-states | new sub-states |
| `tests/infra/perf.test.ts` | P0-8 stays (estimate ≤ 3.0); add "every piece estimate ≤ 1.0 on the stress city"; P0-15 re-checked in G4 | — |

### 11.6 The WASM ports: a decision for the lead

**The problem.**
- Three frozen ports override live sim internals by instance method and mirror today's constants and step boundaries:
  - the services tier engine (`src/wasm/kernels/services.ts` overrides `prep`, `tierWork`, `finishTransit`, `footprints`, `finish`, `accessCommuteLand` and `shopLand`, mirrors `WORK_PER_STEP` / `U_*`, and asserts identical step boundaries);
  - the pollution field passes (`installFieldPasses` overrides the stage methods);
  - the traffic driver, which the tests run only against the frozen 24f8609 tree.
- B2 changes those internals by design, and `src/wasm/**` is outside B2's file scope. These sections would break:
  - `tests/wasm/servicesTierEngine.test.ts` §2–§4 (the live-instance sections);
  - `tests/wasm/fieldPasses.test.ts`: 'PollutionSystem: every step of 4 passes identical' (hard-coded 10 steps per pass) and §5 'whole city';
  - `roadTransitSearchSim`, which G1 adapts (§11.5).

**The proposal.**
- G2 and G3 mark exactly the live-instance sections `describe.skip`, with the reason: "pinned to the pre-B2 pass structure; the frozen port mirrors services.ts / pollution.ts at 24f8609; archived by WASM_PLAN PI-6".
- The kernel-level sections stay. So does the nimby live-module test, because `rebuildNimby` / `nimbyCost` keep their semantics.
- This is PI-6's archive, done early for two ports. **It needs the lead's OK.**
- The alternative is PI-6 before B2.

## 12. Acceptance protocol (gates role, G4)

- **Trees.** B = `b2base` (41ae570, read-only) and W = `b2`. Bundle the step tools against each tree:

  ```
  node b2work/tools/stepmap-bundle.mjs <tree> b2work/tools/cpumap.ts b2work/tools/build/<tree>/cpumap.js
  ```

  Keep 'profile' in the output name of any tool other gates must see. `profile.ts` (bundled with `tools/bench/sim-profile/bundle.mjs profile`) cross-checks `maxStepMsWall`.
- **Labels.** `profile.ts` labels steps by state. It keys traffic's 'rebuild' on `graphDirty`, which B2 clears at RB0, so the later rebuild pieces show as 'prep' there. Use the `stepName`-based tools for per-piece labels.
- **Timing discipline.**
  - Take the timing lock before every timing run; check `pgrep` and the load average; release the lock right after the run, also on failure. Hold it at most about 15 minutes.
  - At least 3 runs per side, interleaved B / W. Report the median and the range.
  - Use wall clock (`performance.now`).
- **Latency gate.** dense1m headless `--warm 20 --days 60` (the lead's profile setting):
  - per-step wall ms over all steps of all tasks: p99 ≤ 3 and max ≤ 5 (the median over W's runs).
  - Also report the warm window (`--warm 300 --days 120`) and bot256.
  - Flag steps that overlap a GC pause of ≥ 1 ms (`--gcmarks`) and report the max without them. The mapping measured GC pauses of 5.2–6.3 ms inside steps, a floor for "max ≤ 5" that B2 does not control. **The lead decides whether the max gate counts those steps.**
- **Cost error.** §9.5, from the same runs.
- **Cadence.** §9.4 item 4.
- **Exactness and determinism.** §11.1 and §11.2.
- **Balance.** SIM_DEPTH_SPEC "Balance procedure".
  - Runs: 256 × 60 seeds 7 and 11 and 128 × 15 seed 7 (`npx tsx tools/balance-json.ts <size> <years> <seed> <out.json>`), in B and in W side by side.
  - B's rows (B1) are the baseline. The lead's pre-B1 runs in `scratchpad/balance/base/` are for reference only.
  - Acceptance on 256 seed 7:
    - pop ≥ 150k at year 15 and ≥ 950k at year 60, and ≥ 0.9 × baseline;
    - approval ≥ 50 from year 30;
    - funds ≥ 0;
    - EQ ≥ 100 by year 30;
    - tourism jobs within ±30 %, judged as B1's report did: with more 128 × 15 seeds and their geometric mean if single years swing;
    - `totalMsPerDay` ≤ baseline + 3.
  - Record the `b2` rows and the 128 × 15 seed-7 2015 population.

## 13. Risks

1. **An exactness slip while turning locals into fields.** For example `ovOn` recomputed per chunk, a double accumulated as Float32, a stage reading a live list instead of the snapshot, or a value computed in a later piece than today. Mitigations:
   - the atomic digests per group on both 1M fixtures;
   - the tiny-piece vitest suite;
   - the frozen-original traffic and nimby tests at phase ends;
   - review against R3 and R5.
2. **Shared scratch across pieces.** This is silent and only shows when other code runs between pieces: `bq`, `eng` / `lhead`, `scratchInt`, nimby's `scratch`, `findPath`'s use of `SB`. Mitigations: R8; the interleaved-cities test; `parkRideOverflow` (which calls the hint between every step).
3. **Partial visibility in interrupted passes** (R7). Mitigations: the publish pieces; §11.4.
4. **The cold window may still miss p99 ≤ 3.** In the crime prototype, 0.16–0.25 ms pieces still ran at 2.1–2.6 ms cold, with a crime p99 of 4.2 in the acceptance window, and deopt passes reached 3.9 ms per piece. The mapping traced most deopt waves to Building objects in two hidden classes (restored vs `growth.ts` `create()`). Mitigations:
   - R10 (small methods; no `Building` reads in the tier engine);
   - `INFRA_PIECE_MS` can go lower;
   - **outside B2's scope, the lead's decision:** an exact Building-shape fix (one construction path in `serialize.ts` restore, `growth.ts` and `actions.ts`, with the same field representations). Recommended if `--trace-deopt` shows the cold-window outliers are 'wrong map' deopts.
5. **GC pauses (5–6 ms) set a floor for max ≤ 5.** Mitigations: no allocation per piece; report GC-overlapping steps (§12).
6. **Balance.** Honest fairness moves real time from traffic to pollution at dense1m; the budget scaling keeps the total. Mitigations: the cadence table; `INFRA_TASK_WEIGHT` as the documented fallback; the B1-style multi-seed tourism check.
7. **Latency of urgent passes.** The urgent budget keeps B1's days-to-apply. Live, urgent work is capped at 6 ms per frame instead of unbounded, so an edit's feedback can take a few more frames. It never stalls a frame for 24–40 ms.
8. **The WASM test sections** (§11.6). This needs the lead's call.
9. **Memory.** Double buffers, scratch graphs and private queues add about 8–10 MB per 256² city, well inside WORKER_DESIGN's 150 MB.
10. **Overhead.** About 150–200 pieces per traffic cycle or services pass. The per-piece overhead is about 5–20 µs, so +3–8 % infra time is expected. `totalMsPerDay ≤ baseline + 3` checks it.
11. **Unmeasured at scale.** No fixture has P&R garages or water cells (the diffusion). Calibrate on the synthetic towns, and accept wider error there.
12. **Test churn.** Tests restructured to compare at phase ends must not lose strength. Comparing at every phase transition (not only at cycle ends) keeps the frozen-original check strong.
13. **Edit-only lazy work stays above the budget** after edits (exception R2): `refreshAttach` 0.3–1.2 ms and `syncStations` O(B). `findPath`'s idle synchronous rebuild (fire dispatch, between cycles) is not a scheduler step and is out of scope. Note it for W1's latency work.

## 14. Decisions for the lead

1. §11.6: skip the live-instance WASM sections (PI-6 early), or do PI-6 first.
2. §12: whether "max ≤ 5" counts steps that overlap a GC pause.
3. §9.4: scale `INFRA_DAY_BUDGET` to keep today's real infra time per day (proposed), or keep 3.2 and accept about half today's cadence.
4. §13 item 4: the Building-shape exact fix outside B2's files, if the cold window needs it.
5. `INFRA_PIECE_MS = 0.3`: G1 may retune it once after its first gate run.
