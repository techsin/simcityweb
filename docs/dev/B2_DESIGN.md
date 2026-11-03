# B2 design: split the infra steps, recalibrate `cost()`

- **Plan rows:** WASM_PLAN B2 (and its table of the largest steps); WORKER_DESIGN §6 S3 (PI-5b).
- **Base:** `41ae570` = the dev branch + the exact J-fixes + LG-01 + the guide copy + B1 (`5bb5467`). B1's 128 × 15 seed-7 2015 reference is 196,101.
- **Branch:** `b2-step-split` (local only).
- **Inputs:** the three mapping reports (traffic, services + emergency, crime + pollution + utilities) and their data under `scratchpad/b2work/map-*`. Every number below is from those reports unless it says otherwise.
- **Status:** design, with the design reviews' changes. G1 (`G1-core-traffic`) is built: §15 lists what it changed against this text and which review items it applied. G2 (`G2-services-nimby`) is built: §16, and the "as built" notes in §4. G3 (`G3-crime-pollution`) is built: §17, and the "as built" notes in §5 and §6. G4 (`G4-utilities-emergency-recalibration`) is built: §18, and the "as built" notes in §7 and §8. The build order is §10, in four groups: `G1-core-traffic`, `G2-services-nimby`, `G3-crime-pollution`, `G4-utilities-emergency-recalibration`.

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
- Two budgets (params.ts), in warm estimated ms per piece (design review 2, item 1):
  - `INFRA_PIECE_MS = 0.3` for loops measured at 10× their warm cost or less in every window: traffic's road and transit searches, transit seeds, inbound, shop and freight; services tiers, nimby and foot.
  - `INFRA_PIECE_COLD_MS = 0.13` for every Building loop and every stage that runs once per pass or less often: all of crime, pollution, utilities and emergency response; services prep, stops, access, shopB and finish; traffic prep, prepTransit, transit options, park & ride, roundMatch, the pool, commute end, parking, final, final2 and the graph rebuild. The split crime prototype ran its pieces at p99 ~20× and up to 37× their warm cost in the first 200 days after a load; at 0.13 such a piece stays near 3–5 ms cold.
  - Both are interim sizes until the Building-shape fix (§13 item 4, §14 item 4) is decided and re-measured.
- **The rule** (review 2, item 1a): every piece is at most 3 ms at its loop's measured p99 cold factor and at most 5 ms at its max, with the factors measured on split code in the §12 windows. Each group checks it per loop for its own pieces. This replaces "G1 may retune `INFRA_PIECE_MS` once".
- `pieceUnits(usPerUnit, min = 1, budgetMs = INFRA_PIECE_MS)` (scheduler.ts) returns `max(min, floor(budgetMs × 1000 × pieceScale / usPerUnit))`. `pieceBudgetUs(budgetMs)` is the same budget in µs, for weighted plans (`BuildingSnapshot.plan`). Every chunk size (buildings, origins, rows, settled nodes, tier work units, events) comes from them.
- Both are pure functions of constants and the test scale (no clock, no mode), so a piece and `cost()` compute the same chunk size from the same cursor. Nothing has to be stored for `cost()`.
- `setPieceScale(s)` is a test-only hook: `1e9` gives one piece per stage, `1e-9` gives one unit per piece. It is module state, so tests use the scoped `withPieceScale(s, fn)` (try / finally) and seed their random scales (review 1, O5).
- Exceptions to the budget, each bounded in cold ms (review 2, item 5):
  - one call of a shared kernel (`blur.ts`, `saturate`, the police `needOf`): where it can exceed 3 ms cold it is split by rows or columns, which is exact for separable passes (review 2, item 3d; G2 / G3);
  - publish pieces: their content is computed in ordinary pieces into private buffers, and the publish piece only swaps or `.set()`s (review 2, item 5a). Its estimate counts the copy;
  - the edit-only lazy caches that other code also calls synchronously. Traffic runs `refreshAttach` in its own piece (the first piece of prep and of prepTransit) when it is dirty. When another task's query triggers it first, it runs inside that task's piece (about 0.3 ms at 256²); G2 / G3 add its cost to the estimates of the pieces that can trigger it (review 2, item 5e). As built (G2): services runs it in a piece of its own instead, right before prep's building chunks and before the stop disks, while `TrafficSystem.attachRefreshMs(st)` reports it pending (`stopAttached(-1)` refreshes; the refresh is a pure function of the state, so its time does not change any result). Emergency `syncStations` (G4).
- **Loops whose cold cost is extreme** (the stop disks 37×, shopB's bilinear output 25×, finish's legacy combos 27×) use the cold budget from the start, not after a failed gate run.
- **Services as built (G2):** the tier engine's steps use half `INFRA_PIECE_MS`; every other services loop uses half `INFRA_PIECE_COLD_MS`, like traffic's once-per-cycle loops — NIMBY and foot included (listed above at `INFRA_PIECE_MS`): they run once per pass, NIMBY every second pass, so they stay cold the longest. The stop disks use a quarter of `INFRA_PIECE_COLD_MS`. A once-per-pass cell loop also takes at most the cells of a cold floor, `INFRA_CELL_SIZING_US = 0.004` µs per cell (params.ts; about 16,000 cells per piece), however cheap it is warm: on their first executions after a load these loops ran at about 0.1 µs per cell, 25–70× their warm cost. A once-per-pass Building loop likewise takes at most `INFRA_BLD_SIZING_US = 0.2` µs per building (about 325 buildings per piece): prep's chunks, the stop list, the access seeds and homes, shopB's block sums, the EQ / HQ fallback, the police scan and job sites ran at 1–8 µs per building on first executions and after Building-shape deopts. The tier engine's final row items (a slot's clamp and stats) run alone in their step under the same floor. Pure native fills and copies use `INFRA_PIECE_MS`. The estimates carry one absolute scale, `SV_EST` (traffic's `TR_EST` pattern), and §16 gives the cold measurements.
- **Crime and pollution as built (G3):** pollution's building loops use half `INFRA_PIECE_COLD_MS` and its cell work (the field programs, the landfill scan, the road checksum, the allocation, the BFS queues) a quarter; every crime loop uses a quarter (both passes run once every 12 / 20 days, so every loop is a once-per-pass loop, crime's the rarest), with G2's cold cell and Building floors. At half the budget, the first passes after a load ran crime's mix and building chunks at 3–4.6 ms and pollution's cell programs at 2–5 ms (150–300 ns per cell, 30–70× warm). The building stages walk the pass snapshot in the chunks of one plan per pass: crime's at the Building floor + 63 ns per footprint cell, pollution's (shared by its five building stages and the route scatter) at the floor + 41 ns per footprint cell (stageA's, the costliest per cell). The cell and blur work of a pollution stage is a small *field program* (§6 as built): ops that run in row or unit ranges, a piece continuing across ops while its sizing fits the budget. Crime's and pollution's estimates carry their own absolute scales, `CR_EST` and `PL_EST`.
- **Traffic as built (G1, measured at dense1m):** its searches use `INFRA_PIECE_MS`; every other traffic loop uses half `INFRA_PIECE_COLD_MS`. Those loops run once per cycle (or once per matching round), so they stay cold for the first 10–15 cycles after a load: 10–37× their warm cost in days 0–80, and the matching's accept loop about 45× on its first executions. Traffic's estimates also carry one absolute scale, `TR_EST`: the TC table sets the relative costs, and so the chunk sizes; `TR_EST` makes the estimate honest warm ms without moving a chunk (§15).

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
- **Flags.** Computed per chunk into a desired-value array (or a list of the buildings whose bit changes, with the new bits), applied in one piece in snapshot order with `setFlagQuiet`. The `changed` list comes out in today's order. One rule for every task (review 2, item 5d): the applying piece has its own coefficient and a cold measurement, and is chunked only if it exceeds 3 ms cold.
- **Events.** Emitted after all the state they announce is published, in today's order. They may be spread over consecutive pieces (`pieceUnits(0.4 µs per event)`).
- **Exceptions.** A few states already pass through intermediate states between steps today, and B2 leaves them as they are:
  - the services per-facility records written by each tier step (as built, G2: and their stale-record clear at the pass end, by id ranges; a record of a facility the pass did not process can stay readable until its range runs, and `facilityLoadOf` already drops removed and re-tiered buildings itself);
  - `transitCov` between the transit slot, `S_STOPS` and `S_FOOT`;
  - the emergency response layers between `resp3` and the `resp4` chunks;
  - the inspector-only per-id arrays `airById` and the garbage `served` / `reach` stamps (as built, G3: also `prodById` / `reasonById`, which only `garbageInfo` reads, written by the building chunks in place);
  - pollution's `garbageSummary()`, written by three states (garbSrc, garbRoute, garbApply) as pre-B2: in each state, in its publish piece.
- **Why this is not an exactness rule.** In an uninterrupted pass nothing reads in between. The rule keeps interrupted passes sane: no half-zero `st.commute` for a day, no `transportUseFactor` reading a depot list without its stops, no `waterQualityAt` on half-summed supplies. The P&R hint tests check it at every step (§11.4).
- **The audit.** Each group lists, per system, every public query, the fields it reads, and the piece that publishes each field. Write the list as a comment above the system's state machine, and copy it into the group report.
  - Traffic: the methods under `// public queries` and `// WP7b queries`, from `routeInfo` to `stopsNear`, plus `parkingSummary`, `nodeTimes` and `getSampleRoutes`.
  - Services: `layerOf`, `facilityLoadOf`, `unservedClusters`, `needRaster`.
  - Utilities: `gridInfo`, `waterInfo`, `waterQualityAt`, `plantLoad`, `producerInfo`.
  - Pollution: `garbageInfo`, `landfillInfo`, `incineratorShare`, `garbageSummary`, `roadlessGarbage`, `emissionOf`.
  - Emergency: everything dispatch reads.
  - Per-cycle arrays a query reads are external even when they look internal. For example, `garageInfo` reads prep's `gN` / `gBid`, prepTransit's `gStop` / `gWalk` / `gSpaces` / `gState`, and parking's `parkD` / `parkBoxD` / `parkBoxS`.
  - Between prep's scan end (which publishes `gN` / `gBid`) and prepTransit's publish piece, `garageInfo` pairs the new `gBid` with the old `gStop` / `gState`. Today's prep-to-prepTransit window does the same, so it stays (review 1, O12).

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
- **Saved data that changes within one step today changes within one piece** (review 1, R4). Traffic: `st.traffic` and `st.congestion` (final's publish piece), the building flags (final2's publish piece), `stats`, and `systemData.infraTransport` (the cycle's last piece; `parkingQ` is quantised into a new buffer on recompute cycles, never in place inside the live save). Services (G2): each saved coverage layer (`policeCov`, `fireCov`, `healthCov`, `eduCov`, `parkCov`) in its publish piece, `transitCov` in the three states that wrote it pre-B2, and `stats.needs` with `stats.eq` / `hq` in finish's last piece. G3: the brownfield `st.soil` / `st.landfillFill` writes, collected in scan order and applied in one piece (`GS_END`); every saved layer of crime and pollution (`crime`, `garbage`, `landfillFill`, `soil`, `airPollution`, `noise`, `waterPollution`) built in a private buffer (or, `landfillFill`, written in one piece) and published by one `.set()`; the flags and `stats` in their publish pieces. G4: the Powered / Watered flags, staged per chunk and applied in one piece.
- Two pre-existing reload leaks stay as they are, because fixing them would change save / load behaviour (review 1, O10): pollution's `ground` is not reset on a same-size `replaceState`, and the scheduler's credit, carry and `lastDay` survive `replaceState`.

**R10. JIT hygiene.**
- Each piece is its own method with one main loop. The dispatcher is a thin `switch`. The mapping found that TurboFan takes 15–46 ms to compile today's big step functions, and they deoptimise on never-executed code after the loop.
- No allocation per piece: scratch grows once. Today's per-call `new Float32Array` in `shopLand` and the closures built per call become fields.
- The services tier engine gets per-facility typed arrays (strength, tier + 1, id, powered-flag, op, cap) built in prep. Then `allocSeats`, `reportDemand`, `splatUnion` and `record` never read a `Building`. This targets the 277–340 'wrong map' deopts the mapping found in `allocSeats`. As built (G2): the value arrays are not built (review 2, optional item 5), and `powById` keeps its pre-B2 read at the tier step. Two smaller changes took their place (§16): the per-facility scratch of the current slot (`facStart`, `facEnd`, `facSig`, `facSeat`) is typed and grown once — pre-B2's JS arrays, emptied per slot and filled in seat order, made `allocSeats` deoptimise on an out-of-bounds store and run unoptimised for whole tier steps — and each tier function reads a facility's `id` / `flags` once, at its top. Later in G2: the seat-order comparator reads a typed copy of the ids instead of the Buildings, and the footprint max's max and fill loops are separate functions (§16.2).

**R11. Determinism.**
- Chunk sizes are constants derived from coefficients.
- `cost()` is a pure, O(1) or O(log n) function of the current state: cursor, chunk plan, sizes. It never runs a loop over buildings or cells.
- A piece's estimate never depends on the clock.

**R12. What changes by design in interrupted passes.**
- Inputs are read when each piece runs, not when today's step ran: other layers, building fields, `plantLoad`, `commuteOf`, `stopAttached`, funding.
- The snapshot membership rules of R4 apply.
- Traffic decides a graph rebuild once per cycle, at its first PH_PREP piece (review 1, R3). An edit after that piece waits for the next cycle; today a second rebuild step in the same PH_PREP could catch it. This moves the bot and can lengthen emergency's graph-stale window by up to one cycle.
- All of this is deterministic within the version and only affects passes that other work interleaves with: the headless schedule and live mode.

## 2. Scheduler and shared helpers

### 2.1 `scheduler.ts`

- **Urgent loop.** Today it runs up to 8 urgent steps per scheduler run.
  - New: each urgent step re-scans for the first urgent and due task (registration order), as today's loop does, and runs it while `used + c ≤ cap`. The cap is shared by all urgent tasks of the run, so utilities' urgent steps and services' can follow each other on the same day (review 1, O2). The first urgent step always runs.
  - Headless, `used` is the estimated spend and `cap = INFRA_URGENT_BUDGET = 24` est-ms. That is about the real time of today's 8 urgent steps at dense1m (services tier steps of about 2.8 ms). A full utilities pass (about 8 honest ms) still finishes in one day, and a services urgent pass (35–50 honest ms) keeps B1's 2–3 days at dense1m.
  - Live, `used` is real time and `cap = INFRA_URGENT_FRAME_MS = 6` (2 × `INFRA_FRAME_BUDGET_MS`). Today the live urgent loop has no time check at all: 8 steps of 3–5 ms is a 24–40 ms frame.
  - Step guard: 256.
  - Without this change, B2's finer services pieces would break `servicesTrigger`'s `LATENCY_DAYS = 2` on the 32² city: about 25 pieces against 8 per day.
- **Normal loop.** The guard goes from 64 to 256 (`STEP_GUARD`). Nothing else changes: fairness by estimated credit, budget admission, renormalisation.
- **New exports:** `pieceUnits()`, `pieceBudgetUs()`, `setPieceScale()`, `withPieceScale()`, `currentPieceScale()`, `STEP_GUARD`. `flush()` returns whether every task went idle, so tests at tiny piece scales can assert completion (review 1, O9).
- The headless urgent cap lets one `tickDay` run about 24 ms of real urgent work at dense1m. A worker host that drives the headless path should yield between urgent steps (review 1, O11; W1).
- `sizeFactors()` stays for compatibility.
- The `InfraTask` doc comment changes to: "estimated warm wall ms of the next step on the B2 calibration box".

### 2.2 `params.ts`

- New, with doc comments:
  - `INFRA_PIECE_MS = 0.3` and `INFRA_PIECE_COLD_MS = 0.13` (R2);
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
- As built (G1): `roadSearch()`, `transitSearch()` and `accumulate()` stay exactly as they are. The run classes repeat their loop bodies, so every other caller (garage reach, emergency, services, the WASM ports) keeps today's code and the module `bq`. The b2Pieces core tests prove the classes equal to the functions (random chunks, other searches between the chunks), and `roadTransitSearchSim` shadow-compares them at completion.
- Also new: `accumulateRange(S, acc, k0, k1, onSink)`, which accumulates backward settle-order ranges and is exact for any cut, and `SearchK.refreshAltBegin` / `refreshAltRange`, the P&R car-leg refresh by settle-order ranges.
- **Why resuming is exact.**
  - The Dial bucket width is at most the minimum edge cost (`Q`, `QT`), and every push from bucket b goes to a bucket greater than b.
  - So bucket b's list is fixed while it drains.
  - Resuming at (b, the next entry) replays the identical pop sequence: `dist`, `src`, `next`, `hops`, `order`, `done` and `settled` come out identical.
  - The inputs are fixed while a search runs: `nodeTime` and `rampT` are written only in prep, `truckTime` in freight's first piece, and `tnet` in prepTransit. The graph cannot rebuild mid-cycle.

### 2.5 `graph.ts`: resumable graph builds

- `RoadGraph` and `GridGraph` get piecewise builders (§3, PH_PREP rebuild): numbering by row ranges, attributes and edges by node ranges, components by an outer cursor plus a private DFS stack.
- `GridGraph` gets a typed-mask variant: rail is `net === Rail || flags & CROSSING`, subway is `sub !== 0`, computed inline from a snapshot. That replaces the per-cell closure. The mapping measured this alone cutting rail and subway from about 1 ms to about 0.2 ms.
- As built (G1): `GraphBuildRun` builds road, rail and subway in stages 0–9 into private buffers, from grid copies taken in `begin()`. `publish()` copies them into the live `RoadGraph` / `GridGraph` objects with `build()`'s growth policy (`max(n, 16) + (n >> 3)`), tails and `version++`, so the graphs are byte-identical to a `build()` at the copy. `RoadGraph.build` / `GridGraph.build` stay unchanged for every synchronous caller (`rebuildGraphs`, emergency).

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
| **Why exact** | The graphs are a pure function of the three grids. The copy is taken at RB0, and nothing changes it before RBP, so the result is byte-identical to `rebuildGraphs()` at that moment. A DFS resumed from the saved stack visits nodes in the same order, so the component ids are identical. An edit after RB0 sets `graphDirty` again and the next cycle rebuilds. Today a second rebuild step in the same PH_PREP would catch it, so this is a by-design change of interrupted mode (R12). |
| **Sub-states (review 1, R3)** | `rbStage` is decided once, at the cycle's first PH_PREP piece: 0 → 1 (rebuild pieces) when `graphDirty || road.N !== size`, else → 2 (prep pieces). A `graphDirty` set later waits for the next cycle. The prep pieces never rebuild synchronously; the whole-state `prep()` keeps its synchronous rebuild for the tests that call it after `replaceState`. A synchronous `rebuildGraphs()` (findPath's idle rebuild, tests) uses `RoadGraph.build` / `GridGraph.build`, never the cycle's builder, and cancels an unfinished `GraphBuildRun`; the cycle then goes on with the freshly built graphs. `rbStage`, `sub` and every cycle cursor are reset at the cycle end and at the top of `init()` (`endCycle()`). |
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
| **Pieces** | (as built, review 1 R1 and O1)<br>**F0:** `alpha`, `iter++` and the ramp weight `ra = max(RAMP_MSA_MIN, 1 / iter)`, exactly where today computes them (after the increment).<br>**F1..:** the road MSA blend by node ranges (private volumes); the rail blend and a back copy of `rampVolCell`; the ramp MSA by node ranges on the back copy; the back `traffic` / `congestion` fills.<br>**F2..:** the road writes by node ranges, then the rail-rider writes, into the back layers; `subwayRiders` into a back buffer.<br>**F4..:** smoothed stop loads by stop ranges into back Maps: `stLoadPrev`, `stPrPrev` and the `stopWalkers` / `stopNear` / `stopRide` / `stopReach` reports.<br>**F5 (publish):** `st.traffic.set`, `st.congestion.set` (saved data: one piece, R9), swap `rampVolCell`, `subwayRiders` and the six stop Maps; stats + `transitFleet`. F5 does not touch `iter`. |

### Final2 (PH_FINAL2)

| | |
|---|---|
| **Today** | Warm 3.2–3.8 / 7.3–9.7; cold 17.2 / 28.1. Parts: origins 2.2–2.8, save 0.75, jobs 0.45–0.6, events 0.4–0.6, routes 0.15. |
| **Pieces** | **G0:** copy the per-id front arrays it writes (`accessById`, `commuteById`, `reachedById`, `carlessById`, `carlessMinById`, `modeById`, `jobFillById`, `carsById`, `customersById`) into back buffers; `commuteNext.fill(0)`; `cutIdsNext.clear()`.<br>**G1..:** origin ranges, about 1,300 each, about 10 pieces. Smoothing reads the front and writes the back; the commute footprint goes into `commuteNext`; the desired NoJobs / Congested bits into `oFlag`.<br>**GJ..:** job-site ranges, plus customers (on recompute cycles) and the connection report into `crNext`.<br>**GP (publish):** swap the per-id buffers; `st.commute.set(commuteNext)`; swap `cutIds`; apply the flags in today's order (origins, then job sites) to build `changed`; `connLast = crNext`.<br>**GE..:** `buildingChanged` for `changed`, in batches.<br>**GS1:** the save precompute: ramp-cell scan, price arrays and, on recompute cycles, `parkingQ` quantised into a new buffer (today's `saveTransport` re-quantises `prev.parkingQ` in place inside the live `systemData.infraTransport`, which would put the new raster into the old save; review 1, R4b).<br>**GS2:** `buildSampleRoutes` (two pieces), the `serviceRoutes` filter, `cycles++`, the `saveTransport` assembly with the new `parkingQ`, `layerUpdated('traffic')`. |
| **Why exact** | Each id is written at most once per cycle: origins and job sites are disjoint buildings. So reading the previous value from the front and writing the back equals today's read-then-write in place. Flags get the same values in the same order, and the events come in the same order. `RESULT_SMOOTH` reads `this.cycles`, which changes only in GS2. `saveTransport` stays the cycle's last write. In flush mode no earlier task becomes due from these events (utilities ignores `buildingChanged`). |
| **External** | `workerAccess`, `commuteOf`, `jobFill`, `routeInfo`, `st.commute` and the flags all change in GP. No reader ever sees a half-zero commute layer. |

## 4. Services and NIMBY (`services.ts`, `nimby.ts`, `catchments.ts`, `transit.ts`, `facilities.ts`; G2)

**General.**
- `S_*` and `P_*` ids are unchanged. `tierSlot`, `tierPhase`, `cursor` and `workLeft` keep their meaning.
- New fields: `sub` and the per-state cursors.
- Services' pass snapshot is taken in prep and serves prep, stops, accSeed, the accLand footprints, shopB and the EQ / HQ fallback.
- "hot" figures in this section are the services mapping's forced-pass medians, which matched the late headless window.

**As built (G2; the tables below are the design, these are the differences; §16 has the measurements):**
- **Budgets and estimates.** R2 "Services as built". Every piece kind has an `SC` coefficient (µs per unit); its chunk is `pieceUnits(SC.x, 1, budget)` — for a once-per-pass cell loop at most `pieceUnits(INFRA_CELL_SIZING_US, 1, budget)` cells — and its estimate `SV_EST × (SC.piece + units × SC.x)`. Row loops take `floor(cells / N)` rows, at least one.
- **Prep.** PR0a's hashes run by ranges: the corridor hash, then `hashBytes` of the network and of the water (each a sequential hash carried in a field). The first piece consumes the pass inputs (R5) and calls `ensure`; the NIMBY decision follows the corridor hash, the reach invalidation (`checkNetwork`) the water hash, in the pre-B2 order. Then the setup, the back need rasters (native fills), traffic's pending attachment refresh in a piece of its own (review 2 item 5e), the snapshot (the per-id arrays are sized there, so every snapshot id fits), its chunk plan in pieces, the building chunks, the provider slots (the police need as a resumable run, review 2 item 5b: the monthly scan in chunks over the pass list, installed with the list's `nextBuildingId`, the job sites, the cell pass; then the sum by ranges), the road count by ranges, the publish, the work estimate by facility ranges.
- **Tiers.** The re-weighted units as designed, plus per-cell units for the final items (clamp 0.11, stats 0.11, publish 0.02, foot 0.22 per lot cell); `seatOrder` counts as an item (n log2 n). The step's budget is half `INFRA_PIECE_MS`. A lot item takes as many lots as the step has room for, at least one, and at most S_FOOT's lots per piece (`SC.foot` per lot cell at the cold budget, about 3,900 lot cells; its max and fill loops are separate functions, §16.2); a row item (clamp, stats) runs alone in its step, at most the cold floor's rows. **A fresh reach is a resumable item** (the design ran it as one item, alone when over the budget): catchments `ReachRun`, on its own engine, repeats reachRaw's loop bodies; its Dial drain stops between queue entries (`U_REACH_POP` = 4.5 units each: 0.39 entries per reached cell, 0.10 warm µs per entry at dense1m) and a disk between rows (`U_REACH_DISK` = 1.4 per cell visited), so a piece holds about 1,350 queue entries. The item is held across tier steps (`reachPh`, the facility's cursor advances when it completes); its pool copy, cache entry, record and union splat run in its last piece, or first in the next step when they do not fit. R10's per-facility arrays are not built (R10 as built).
- **Stops.** The compose writes into a byte copy of `transitCov` (cells without stop coverage keep their exact bits; pre-B2 left them untouched), published by `.set()`; traffic's attachment refresh, when pending, has a piece of its own before the disks.
- **NIMBY.** A building chunk ends once its estimate (per building + per kernel touch) reaches the budget; landfill row pairs likewise (pairs without landfill are free); corridor ranges start and end on multiples of 4. Each run owns its scratch: the services instance one, `rebuildNimby` one per state.
- **Foot.** On a byte copy of `transitCov`, by lots, published by `.set()` (review 2 item 5a).
- **Finish.** The legacy combos by rows into private buffers, then their publish piece (review 2 item 5a); the per-tier stats by rows; the stale records by id ranges (R7 exceptions); the EQ / HQ fallback by snapshot chunks; `stats.needs` is written in the last piece with `stats.eq` / `hq` (R9).

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

**As built (G3).**
- **Sources:** `CS_START` (`lastRun`, `raw.fill(0)`, `ctx = context()` stored, `arrest = 0`), `CS_SNAP` (the snapshot take and the plan's start: one `buildingList` + copy), `CS_PLAN` (the plan in building ranges), `CS_BLD` chunks (today's body; a CRIME_SPILL venue is collected before the `built < 1` skip, so the venue list is the pre-B2 second walk's), `CS_SPILL` (the venue splats and the emergency boosts), `CS_CLAMP` by cell ranges, whose last piece calls `addArrestPotential`.
- **Spread:** `SP_COPY` (`tmp.set(raw)`), `SP_BLUR`: blur3's six box passes by rows (`boxHRows`, `BoxVRun`), not one per piece — review 2 item 3d: a single kernel call runs at up to 22× cold in days 0–20; `SP_MIX` by rows into the private `next` (`next[i] = L[i] + (t − L[i]) × α`, the same double expression and Float32 store as pre-B2's `L[i] += …`); `SP_PUB`: `st.crime.set(next)` (review 2 item 5a).
- **Flags:** the chunks push a candidate (2 × snapshot index + the wanted bit) for each building whose bit flips; `CF_PUB` applies them in order (the pre-B2 `changed` list); the events in batches of `pieceUnits(0.4 µs)`, each for a building still in `st.buildings` (R4).

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

**As built (G3).**
- **Field programs.** The cell and blur work of a stage is a list of field ops built in the stage's first piece (its own piece; the conditions — the `used` classes, the dirty flags, the wind, α — are read there, once per stage): `fill` / `copy` (one native call), `down` (blurDown's downsample by fine rows, `downsampleRows`), `blur` (blur3 by rows of its six half passes, `Blur3Run`), `acc` (the near-air accumulation by coarse rows), `up` (upsampleAdd by fine rows, `upsampleAddRows`), `sat` (saturate by rows, `saturateRange`), `boxH` / `boxV` (`boxHRows`, `BoxVRun`), and the stage loops (srcCells' cell loop, the tree field and count, `noiseBuffer` by rows, the water cleaning, the diffusion's init / sweep / copy / write-back by water-cell ranges, land, banks, the garbage leftovers, the soil stock). A piece runs ops in order from the cursor, each over a range of its units, while the piece's sizing (the ops' coefficients with the cold cell floor) fits the budget, at least one unit; `cost()` walks the same ranges without running them. Pre-B2's whole-call kernels and `saturate` are the same per-row operations (rows are independent; blur3's and the chamfer-like passes are sequential by rows), so rows in order give their results exactly.
- **garbSrc:** `GS_START` (the pass values), `GS_SNAP` (the pass snapshot + `ensureIds`), `GS_PLAN`, `GS_BLD` chunks, `GS_LF0` / `GS_LF` (the scan by cell ranges into the private `lfRegionNext` and region lists — `landfillInfo` reads them, so they are swapped in at the end — with the brownfield soil values and the fill resets collected), `GS_END` (publish: the stock writes, labels and regions, `lfOrder`, `roadless` (built privately), caps, `summary.producedT`).
- **garbRoute:** `GR_START` (stamps, the seed signature), `GR_SUM` (the road checksum by cell ranges), `GR_CHECK` (the signature check, BFS start), `GR_BFS` (queue chunks), `GR_BLD` (perimeter distances), `GR_SORT`, `GR_SCAT` (the scatter in snapshot chunks), `GR_ALLOC` (the allocation by order ranges: `left`, `collected`, `overCap` as doubles), `GR_PUB`.
- **garbApply:** `GA_START` (`gNext.set(st.garbage)`), `GA_BLD` chunks (piles on `gNext`, candidates), `GA_LF` (the landfill fill — `st.landfillFill`, saved — and display, one piece), `GA_LEFT` (a program), `GA_PUB` (`st.garbage.set(gNext)`, the flags, summary, stats), `GA_EV` (events, then `garbageNews`).
- **srcBld:** the nine clears as a program of native fills, the setup piece (`stats.sewageTreated` there, as pre-B2 at the stage start), chunks, the end (park signature, emergency spills).
- **srcCells:** the cell loop (a program), traffic's pending attachment refresh in a piece of its own (`attachRefreshMs` > 0; review 2 item 5e, as G2), freight rail + the used flags + the landfill emission (one piece), then the tree cover and park buffer as one program; the tree cover is built in the private `treeNext` and published by `.set()` at the program's end, before airFar and noise read it.
- **airNear / airFar / noise:** one program each; airFar's and noise's saturate run on private copies (`airNext`, `noiseNext`) published by one `.set()` (review 2 item 3d: airFar's single saturate call ran at 22× cold).
- **water:** a program (blurPair, `wNext.set(st.waterPollution)`, the cleaning, the ground saturate), then the water list: when invalid, `ensureWaterList` in pieces (numbering, the cell lists, the bank seeds, the bank BFS) into private buffers, installed at its end exactly as the whole build; the stage keeps references to the list it built or found valid (review 1 R5), and an invalidation during the build (an epoch counter) leaves the list invalid for the next pass. Then the diffusion program on `wNext`, published by one `.set()`.
- **flags:** the soil stock as a program on the private `soilNext` (copy, rows, publish) when `dt > 0`, the chunks (candidates with the two wanted bits), the publish, the events.
- **Whole-stage methods.** `garbageSources`, `garbageRoutes`, `garbageApply`, `stageA`, `stageCells`, `stageAirNear`, `stageAir`, `stageNoise`, `stageB` and `stageFlags` run their state's pieces in one go outside a pass (`perf.test` calls `stageA` / `stageB`), taking a snapshot when no pass holds one.

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

**As built (G4).**
- `sub` numbers the pieces of the whole pass (25 sub-states inside the six `U_*` states); `stepName` is `<state>.<piece>`, e.g. `power.sum#12`. One snapshot per pass with one chunk plan (the cold Building floor + 20 ns per footprint cell) for all six building stages; every piece at half `INFRA_PIECE_COLD_MS`, with the cold cell floor for the cell loops.
- UU0 is `S_START` (ensure, the effects, the plant efficiency and prepareUses' per-pass values; the dirty flags and the `added` / `removed` swap, R5). The jobs check (`detectJobsUnknown`) moved into the snapshot piece, where the day's first `buildingList` rebuild falls (a pure function of the buildings). The sea mask is taken unconditionally (pre-B2 took it at the first working water producer; a pure, checksummed cache), in pieces: the checksum by cell ranges and, after a water edit, the rebuild (`terrainMasks.SeaMaskRun`, 18.2). The treatment prefix scan runs by building ranges of half the Building floor (it reads a DefInfo and two fields), not by plan chunks.
- The publish pieces are the last piece of their loop: the uses' last chunk swaps the producers, posts the nuclear news and runs `patchPower`; a label's last piece swaps the labels; the sums' last chunk `.set()`s the per-component sums (and, for water, the per-id networks `bWComp` and the intake pollution) from private buffers and runs the rest of pre-B2's sums step; the zoned loop's last piece `.set()`s `st.powered` / `st.watered` from private layers. `.set()` of the `[0, nc)` range rather than a swap keeps the arrays' tails (beyond `nc`) exactly as pre-B2, so the frozen-original comparison holds field by field.
- Finish: the building chunks collect the candidates (snapshot index and the wanted bits of each building whose Powered / Watered bit flips) and run the cooling-water result and the cut tally (both read only state that the pass does not change between the chunk and the apply); one piece applies the flags (review 1 R4d); the events follow in batches, their last piece posts the news and `layerUpdated`.
- U_WATER's mid-pass relabel check runs at its first piece (as pre-B2's step); `dirtyWater` is consumed at the first piece of a water label (R5), so an edit during the label relabels again at U_WATER.
- The chunk sizes have their own constants (`US`, `UT_PLAN_*`), apart from the estimate coefficients (`UT`, `UT_EST`).

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

**As built (G4).**
- Every piece at a quarter of `INFRA_PIECE_COLD_MS` (the 90-day sequence is the rarest of the split passes), with the cold floors. `respSub` / `respCur` are the piece state; `respStep` 0–4 and `p.resp` are pre-B2's. `stepName` is `resp<k>.<piece>`.
- ES0 is split (review 2 item 5c): while `respStep < 0`, `respSub` runs the start — a moved traffic graph's signature by node ranges (`sigRange`, cached by graph object and version: `ensureGraph` reads the cache instead of hashing again; a pure function of the graph's content, which only a build or publish changes, and both bump the version), then `ensureGraph` + the station scan when `stDirty` (a snapshot, building chunks, then `installStations` — refreshStations' second half; a synchronous refresh by dispatch in between makes the scan moot, a station event after its start leaves `stDirty` set, `stEv`), then the siren times by node ranges into a private `tmN` (`sirenTimes`; published with `Persist.siren` in one piece; a refresh by dispatch in between ends it, an epoch or traffic update restarts it), whose last piece also runs the resets and the `respTm` copy. Every piece with `respStep ≥ 0` checks the graph first: a moved graph's signature in pieces, then the epoch check (a restart resets every cursor).
- A search: its start (seeds, `ChunkedSearch.start`), settle chunks (`emUnits(0.05 µs)`, about 650 nodes), the slack pass by node ranges. The land fill by rows (the RESP_NONE fills in its first piece); the building fills by chunks of the live list (`respBCur`), as pre-B2.
- The chunk sizes have their own constants (`ES`), apart from the estimate coefficients (`EM`, `EM_EST`). The pre-B2 `EMERG_SEARCH_CHUNK`, `EMERG_FILL_CHUNK` and `EMERG_*_COST` stay in params.ts for the frozen original and the bench tool (`tools/bench/roadTransitSearch/secondary.ts`).

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
| cold (from load: days 0–20, 20–80, 80–220) | reported, not gated | reported, not gated |

The gate is the warm window, pooled and per task (review 2, item 4). A perfect warm model scores a pooled −0.23 to −0.35 in the cold window at any piece size, because the cold factor belongs to the stage, not to the piece size; the cold windows are reported only. The lead should say which window the plan's ±30 % refers to: its "3–5.5× too low" was measured in the first 90 days after a load.

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
- **Gate:** the traffic part of §12 on dense1m: traffic steps p99 ≤ 3 and max ≤ 5 in the windows from load (days 0–20, 20–80, 80–220), and traffic's median error within ±30 % warm. §15 has G1's numbers.

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
| `tests/infra/perf.test.ts` | P0-8 stays (estimate ≤ 3.0); add "every piece estimate ≤ 1.0 on the stress city" (G1: traffic's); P0-15 re-baselined in G1 to ≤ 0.985 and re-checked in G4 | G1: finer pieces fill the day budget closer (B 0.869, G1 0.961 at the provisional 5.3) |
| `tests/infra/emergency.test.ts` 'runs on traffic's road graph' and 'emergency perf' (G1) | count `GraphBuildRun.publish` as a traffic build next to `RoadGraph.build` | traffic's rebuild runs in pieces and publishes into its graphs |
| `tests/sim/employment.test.ts` 'with neighbour connections' (G1) | compare the filled jobs with the mean arriving workers of two consecutive assignments | the arriving workers alternate by a few % between assignments (the inbound pass is recomputed every 2nd one); the moved schedule put the check on the other parity |
| `tests/infra/emergencyBot.test.ts` 'normal play keeps its prompts' (G1) | seed 7 → 2 | the bot's schedule moved by design; seed 7's town raises no prompt in 4 years any more (seeds 1, 2, 4–7: 0, 4, 2, 2, 1, 0) |
| `tests/sim/exact/j10.test.ts` | atomic passes compared at pass ends, B2 fields excluded by name, edits between passes (G4) | it traces per-step costs and boundaries (review 1, R7a) |
| `tests/sim/servicesTrigger.test.ts` 'urgent change after prep' | step while `stepIdx === S_PREP` instead of one step (G2) | prep is several pieces (review 1, R7b) |
| `tests/infra/catchments.test.ts` 'bulldozed mid-pass' | step until prep is done (G2) | review 1, R7c |
| `tests/wasm/servicesTierEngine.test.ts` §2–§4 (G2) | the engine is installed into the frozen pre-B2 class (`tests/sim/exact/servicesOriginal.ts`), which replaces the live `ServicesSystem` in those sections' `createSystems()` | the port mirrors the pre-B2 pass structure; the B2 pieces equal the frozen class at every pass end (§11.6 as built) |
| `tests/infra/perf.test.ts` P0-8 (G2) | services' largest piece estimate ≤ 1.0, like traffic's | every services piece is estimated at about one budget |
| `tests/infra/environment2.test.ts` 'appear between steps' (G3) | the step guard covers a whole pass (4,000 pieces), and the pass must end | a pass is many pieces |
| `tests/infra/perf.test.ts` P0-8 / P0-15 (G3) | crime's and pollution's largest piece estimates ≤ 1.0; P0-15 re-baselined to ≤ 0.99 (0.985 with G3's pieces) | the finer pieces fill a day to within a few hundredths of a ms; G4 re-checks it |
| `tests/wasm/fieldPasses.test.ts` live sections, `tests/wasm/blurSim.test.ts` (G3) | the frozen pre-B2 `PollutionSystem` (and, in blurSim, `CrimeSystem`) replaces the live one (`tests/sim/exact/pollutionOriginal.ts`, `crimeOriginal.ts`) | the field-pass overrides and the wasm blur bindings cover the pre-B2 stage methods and whole-call kernels; the B2 pieces equal the frozen classes at every pass end |
| `tests/infra/emergencyBot.test.ts` EM-1 normal play (G2) | the invariants are checked on the first of seeds 2, 4, 5, 6, 1, 3, 8 whose 4-year town raises at least two prompts (G1 had moved it from seed 7 to seed 2) | the bot's schedule follows the estimates; G2's tier pieces left seed 2 with one prompt |
| `tests/infra/emergencyBot.test.ts` EM-1 normal play (G3) | the towns run 5 years instead of 4 (seed 2: 3 prompts) | G3's pieces left every seed 1–16 at 0 or 1 prompt in 4 years |
| `tests/sim/exact/j10.test.ts` (G4) | the city-days test compares at day ends (every utilities pass ends within its day on these tiny cities) with the B2 fields excluded by name, the scheduler fields that follow the estimates excluded (credit, carry, estMs, estSpent, lastDayCost), and the step trace kept at the state transitions (day, due, urgent, state) without the estimates; the edge test runs whole passes between its edits | review 1 R7a: one step is one piece; the trace's per-step costs are recalibrated by design |
| `tests/infra/emergency.test.ts` 'emergency perf' (G4) | the `respCost` loop covers every sub-state (`respStep` −1…4 × `respSub` 0…3); every response piece ≤ 0.5 estimated ms | §8 |
| `tests/infra/perf.test.ts` P0-8 / P0-15 (G4) | utilities' largest piece estimate ≤ 1.0; P0-15 re-baselined to ≤ 1.02 (0.996 at the budget 5.3, 0.994 at the final 4.6) | the step guard no longer ends a day before its budget is spent (§18) |

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

**As built (G2): no skip needed for services.** Review 1 (R6) suggested frozen originals as the alternative, and they also keep these sections running:
- `tests/sim/exact/servicesOriginal.ts` is services.ts at 41ae570, frozen. In the live-instance sections it replaces the live `ServicesSystem` in `createSystems()`, and the engine is installed into it. All 18 tests run and pass (the fixture section needs `SIM_FIXTURES`; §16).
- `tests/infra/b2PiecesServices.test.ts` proves the B2 pieces equal to the frozen class at every pass end, so the chain WASM port = frozen pre-B2 class = B2 holds.
- `tests/wasm/fieldPasses.test.ts` §5 'whole city' still passes, but its NIMBY swap (a `vi.mock` of `rebuildNimby` / `nimbyCost`) no longer reaches the services pass, which runs its own `NimbyRun`. Its live-module section still compares `rebuildNimby` with the port. G3 can keep the pollution sections the same way, with a frozen pollution class.

**As built (G3): no skip for pollution either.** `tests/sim/exact/pollutionOriginal.ts` and `crimeOriginal.ts` are pollution.ts and crime.ts at 41ae570, frozen. `fieldPasses.test.ts`'s 'PollutionSystem: every step of 4 passes' and §5 'whole city' run the frozen `PollutionSystem` in place of the live one and install the field passes into it; `blurSim.test.ts` runs the frozen pollution and crime systems (the wasm blur bindings cover the whole-call kernels, which the split passes no longer call). `tests/infra/b2PiecesEnv.test.ts` proves the split passes equal to the frozen classes at every pass end. The bench tools that install the field passes into a live `PollutionSystem` (`tools/bench/fieldPasses/insitu.ts`, `capture.ts`, outside B2's files) need the frozen class too: on the split pass their overrides are never called.
- The bench tools that install the services engine into a live `ServicesSystem` (`tools/bench/servicesTierEngine*`, outside B2's files) need the frozen class too: the engine's `tierWork` override expects its own `prep`, which the split pass no longer calls, so an install into the live system fails at its first tier step.

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
- **Latency gate** (review 2, item 3). dense1m headless, one continuous window from load (`--warm 0 --days 220`), reported as days 0–20, 20–80 (the lead's profile setting `--warm 20 --days 60`) and 80–220:
  - per-step wall ms over all steps of all tasks: p99 ≤ 3 and max ≤ 5, the median over W's runs and the worst run;
  - at least 5 runs per side;
  - plus an edit and disaster scenario: road cut, road restore, bulldoze, earthquake and meteor at days 30, 60, 90, 120 and 150 (`b2work/design-review/tools/editmap.ts`);
  - if the lead exempts days 0–20 (or 0–80), say so here with the step lengths W1 will see in those days.
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
4. §13 item 4: the Building-shape exact fix outside B2's files. Review 2 (item 2) asks to decide it before the piece sizes are calibrated: it is the main cause of the cold tail (the day-148 `variant` Double wave), and the piece sizes, coefficients and bot hashes depend on it. G1 is built with R2's interim sizes.
5. The piece sizes: R2's per-loop rule replaces a one-time retune of `INFRA_PIECE_MS`.

## 15. G1 as built (`G1-core-traffic`, Oct 28)

**Commits** (branch `b2-step-split`): `78b49f6` core, `9876102` traffic in pieces, `2a4cb3f` the remaining long pieces and the refit, `ddb0d22` three test adaptations (§11.5), then this document. `npx tsc --noEmit` clean; the full `npx vitest run`: 135 files passed, 1 skipped (1,363 tests passed, 18 skipped), no unhandled errors.

### 15.1 Review items applied

| item | where |
|---|---|
| R1 (final: `iter++` / ramp weight / rail blend) | §3 Final as built: F0 computes `alpha`, `iter++` and `ra` exactly where pre-B2 does; F5 never touches `iter` |
| R2 (`transportB` half-built while `refreshAttach` can run) | the scan fills a private `transportScan`, installed at the scan end; `markT` / `dropT` update both while a scan is open |
| R3 (PH_PREP sub-states) | `rbStage` decided once per cycle; no synchronous rebuild in the prep pieces; `rebuildGraphs()` cancels an unfinished `GraphBuildRun`; `endCycle()` resets every cursor at the cycle end and at the top of `init()`; the R12 entry |
| R4 (saved data in one piece) | `st.traffic` / `st.congestion` in final's publish piece; flags in final2's publish piece; `parkingQ` quantised into a new buffer; the transport save built privately and installed by the cycle's last piece; the R9 rule |
| R6 (proof against today's code) | `passdigest --mode atomic` B vs W on dense1m, bot256 and three synthetic cities generated with B's code (15.3) |
| R8 (other code of the same city between pieces) | b2Pieces "R8": `findPath`, `garageReach` / `garageInfo`, `stopsNear`, `routeInfo`, `stopLoad`, `workerAccess`, `stopAttached` / `freightRailCells` with the attachment forced dirty, `connectionReport`, `getSampleRoutes` after every piece; same digests as without them |
| O1 (stop reports) | the six stop maps are built as back maps and swapped in final's publish piece |
| O2 (urgent loop) | each urgent step re-scans for the first urgent and due task under one shared cap |
| O3 (`cost()` side-effect free) | `stepCost` reads cursors and sizes only; the first piece of a stage takes snapshots and plans |
| O4 (mode invariance) | b2Pieces "O4": the stepName sequence and the digests are identical with frames active and headless |
| O5, O6, O9 | `withPieceScale` (try / finally), seeded random scales; the harness digests JS arrays, objects, Maps and Sets; `flush()` returns whether it drained |
| O12 | recorded in R7 |
| review 2, item 1 (cold piece sizes) | two budgets in params.ts; traffic's own sizing on top (R2 "Traffic as built") |
| review 2, item 3 (windows from load) | G1 measured `--warm 0 --days 220` and reports days 0–20, 20–80, 80–220 (15.4) |
| review 2, item 4 (cost error on the warm window) | §9.5; G1's numbers in 15.4 |
| review 2, item 5 (over-budget pieces) | publish pieces only swap or `.set()`; `refreshAttach` in its own traffic piece; flags from candidate lists; the candidate sort, the CSR, the snapshot plan and the clusters are no longer indivisible (15.2) |

Not applied in G1: review 2 item 2 (the Building-shape fix is outside B2's files; §14 item 4), and the G2–G4 items (R5, R7's tests, O7, O8, O10, O11).

### 15.2 Deviations from §2–§3, and why

- **Module search functions unchanged** (§2.4). `roadSearch`, `transitSearch` and `accumulate` keep their code for every other caller; the run classes repeat the loop bodies and are tested against them.
- **`GraphBuildRun` is separate from `build()`** (§2.5). `RoadGraph.build` / `GridGraph.build` stay for the synchronous callers.
- **The candidate sort is split** (§3 Round match said "one call"): scan + max, histograms, and per radix pass the prefix sums and the scatter by key ranges. One call took up to 8.4 ms cold.
- **More indivisible items split**: the snapshot's chunk plan (`BuildingSnapshot.planBegin` / `planRun`), the job clusters, the transfer CSR (three pieces), the inbound fills and search start, the per-cycle origin arrays, the freight truck times, the transport save (built in final2 piece 11, installed by its last piece).
- **One method per piece kind** (R10). The first build kept each sub-state's loop inside its dispatcher's `switch`; every sub-state is now its own method.
- **Traffic's budgets and `TR_EST`** (R2 "Traffic as built"). Its once-per-cycle loops at half `INFRA_PIECE_COLD_MS`; its estimates scaled by one calibrated constant, so a recalibration never moves a chunk.
- **P0-15 re-baselined in G1** (§11.5): the finer pieces fill the day budget closer; G4 re-checks it.

### 15.3 Exactness evidence

- `tests/sim/exact/traffic.test.ts`: the frozen original against W at every phase transition, at production, tiny (one unit per piece) and small piece scales, across edits, reloads and several cycles.
- `tests/infra/b2Pieces.test.ts` (20 tests): the core kernels in random chunks equal their whole-call originals; three traffic cities give identical cities and traffic fields at every cycle end in one go, at the production size and in tiny / random pieces across network and building edits; R8, R7 / R4, R9, O4; two cities stepped interleaved equal their solo runs; every piece estimate within its budget.
- `passdigest --mode atomic`, B vs W, digests at days 30 and 100: dense1m, bot256, and three cities generated with B's code (`transit96_s7`, `transit48_s11`: transit, garages, rail, a freight station, a depot; `linetown5`: park & ride and the overflow). All identical.

### 15.4 Measurements (dense1m, headless, wall clock)

Tool: `b2work/G1-core-traffic/cpumapT.ts` (cpumap with traffic labelled by `stepName` in W and by all 16 phase ids in B), `--noinputs`. Each run under the timing lock (`timed.py`), B and W interleaved in pairs; pairs with other processes above 0.4 cores were dropped (three pairs over all rounds, one of the final W's). From load (`--warm 0 --days 220`): B 12 runs, W 5 runs. Warm (`--warm 300 --days 120`): B 8 runs, W 3 runs. Per run, the p99 and the max of the traffic steps; the tables give the median over runs, and the worst run's max in brackets. W is `2a4cb3f`.

**Traffic steps, all phases** (ms):

| window | B p99 | B max | W p99 | W max | W max, worst run |
|---|---|---|---|---|---|
| days 0–20 | 26.1 | 26.1 | 2.02 | 3.36 | 4.97 |
| days 20–80 (the lead's window) | 22.0 | 22.0 | 1.50 | 3.13 | 4.68 |
| days 80–220 | 16.4 | 19.7 | 0.44 | 3.13 | 4.01 |
| warm, days 300–420 | 5.47 | 5.47 | 1.00 | 4.01 | 4.38 |

W's p99 ranged 1.96–2.29, 1.29–1.77, 0.41–0.45 and 0.95–1.02 over its runs; no W traffic step exceeded 5 ms in any run. The W steps above 3 ms are first executions in days 0–20 (`prep.scanBegin` on day 2: `buildingList` + the snapshot copy, one call; `inbound.0`), single cold pieces on days 33–69, the deterministic Building-shape wave on days 143–148 (`prep.scan#21`, `parking.1`: review 2 item 2, outside B2), and pieces with a GC pause of 1–3.7 ms inside.

**Cost error of traffic** (median of estimate / measured − 1): warm +0.01 (−0.05…+0.01; B −0.43); days 80–220 +0.07 (B −0.46); days 20–80 −0.19 (B −0.58); days 0–20 −0.62 (B −0.89).

**Pieces and cadence.** About 590 traffic pieces per cycle at dense1m (B: about 20 steps); in the warm window 2,234 pieces in 120 days (B 97). Per 120 warm days: traffic 4 cycles (B 5), services 4 passes (B 3), pollution 10 (B 6), crime 6 (6), utilities 34 (22). Real infra step ms per day: W 6.25, B 4.40 — the provisional budget 5.3 with only traffic honest gives the other tasks more real time; G4 sets the final budget (§9.4).

**The bot** (128 × 15, seed 7, `tools/balance-json.ts`, one run each): 2015 population W 193,525, B 196,101 (−1.3 %; B matches B1's reference); approval 81.6 (82.5); funds 174,714 (164,779); EQ 103.2 (107.6); `totalMsPerDay` 6.73 (4.49: the provisional budget, see above). The results move by design through the schedule; G4 records the new hashes with the final budget.

**Per phase, before (B) and after (W)** (median over runs of each run's p99 / max; worst run's max in brackets):

| days 0–20 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 2 | 23.76 | 23.76 [38.15] | 107 | 2.17 | 3.36 [4.36] |
| prepTransit | 2 | 12.80 | 12.80 [24.91] | 35 | 1.87 | 1.87 [3.42] |
| transit | 2 | 18.08 | 18.08 [26.13] | 14 | 2.27 | 2.27 [2.28] |
| transit2 | 2 | 10.97 | 10.97 [19.17] | 65 | 0.71 | 0.71 [4.18] |
| roundSearch | 5 | 2.38 | 2.38 [5.40] | 32 | 0.68 | 0.68 [0.95] |
| roundMatch | 4 | 24.63 | 24.63 [37.05] | 161 | 2.01 | 2.73 [3.61] |
| commute | 2 | 13.81 | 13.81 [21.05] | 50 | 1.99 | 1.99 [2.17] |
| inbound | 1 | 2.68 | 2.68 [4.78] | 1 | 2.38 | 2.38 [4.97] |
| shop | 1 | 0.06 | 0.06 [0.09] | 1 | 0.68 | 0.68 [0.89] |
| freight | 1 | 0.05 | 0.05 [0.14] | 1 | 0.06 | 0.06 [0.09] |
| final | 1 | 7.36 | 7.36 [10.24] | 19 | 1.50 | 1.50 [3.37] |
| final2 | 1 | 16.01 | 16.01 [23.40] | 51 | 1.10 | 1.10 [1.89] |
| **all traffic** | 24 | 26.12 | 26.12 [38.15] | 537 | 2.02 | 3.36 [4.97] |

| days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 2 | 17.62 | 17.62 [26.14] | 321 | 0.70 | 1.16 [4.20] |
| prepTransit | 2 | 8.82 | 8.82 [12.96] | 105 | 1.42 | 1.67 [4.68] |
| transit | 2 | 3.46 | 3.46 [4.74] | 42 | 1.06 | 1.06 [1.18] |
| transit2 | 2 | 3.84 | 3.84 [5.25] | 169 | 0.50 | 0.70 [0.80] |
| roundSearch | 10 | 2.14 | 2.14 [2.71] | 64 | 0.85 | 0.85 [4.14] |
| roundMatch | 11 | 7.66 | 7.66 [12.63] | 321 | 1.34 | 3.09 [4.38] |
| commute | 4 | 6.61 | 6.61 [13.32] | 100 | 1.56 | 2.06 [2.60] |
| inbound | 2 | 3.06 | 3.06 [3.51] | 17 | 2.10 | 2.10 [4.17] |
| shop | 2 | 6.85 | 6.85 [10.47] | 21 | 1.16 | 1.16 [1.40] |
| freight | 2 | 3.82 | 3.82 [6.27] | 24 | 0.62 | 0.62 [0.85] |
| parking | 1 | 11.38 | 11.38 [14.92] | 45 | 2.08 | 2.08 [3.11] |
| final | 2 | 5.79 | 5.79 [7.13] | 38 | 2.06 | 2.06 [2.86] |
| final2 | 2 | 21.99 | 21.99 [30.61] | 104 | 1.39 | 1.83 [2.33] |
| **all traffic** | 44 | 21.99 | 21.99 [30.61] | 1371 | 1.50 | 3.13 [4.68] |

| days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 6 | 19.72 | 19.72 [25.66] | 535 | 0.42 | 2.97 [4.01] |
| prepTransit | 6 | 4.42 | 4.42 [7.19] | 175 | 0.28 | 0.33 [1.34] |
| transit | 6 | 4.45 | 4.45 [5.45] | 70 | 0.52 | 0.52 [0.66] |
| transit2 | 6 | 4.72 | 4.72 [5.94] | 351 | 0.13 | 0.19 [0.24] |
| roundSearch | 24 | 2.52 | 2.52 [4.44] | 186 | 0.50 | 0.55 [0.64] |
| roundMatch | 23 | 3.26 | 3.26 [13.86] | 923 | 0.21 | 0.36 [0.39] |
| commute | 12 | 2.01 | 2.01 [2.71] | 250 | 0.20 | 0.41 [1.54] |
| inbound | 6 | 2.06 | 2.06 [2.80] | 50 | 0.46 | 0.46 [0.68] |
| shop | 6 | 2.28 | 2.28 [3.57] | 62 | 0.71 | 0.71 [0.80] |
| freight | 6 | 1.96 | 1.96 [3.85] | 71 | 0.45 | 0.45 [0.49] |
| parking | 3 | 4.26 | 4.26 [15.34] | 132 | 0.21 | 0.24 [3.63] |
| final | 6 | 1.27 | 1.27 [2.40] | 95 | 0.45 | 0.45 [0.70] |
| final2 | 6 | 15.75 | 15.75 [21.48] | 257 | 1.43 | 1.65 [2.31] |
| **all traffic** | 116 | 16.37 | 19.72 [25.66] | 3157 | 0.44 | 3.13 [4.01] |

| days 0–120 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 5 | 5.47 | 5.47 [6.49] | 391 | 0.31 | 0.37 [0.53] |
| prepTransit | 5 | 2.48 | 2.48 [2.61] | 105 | 0.19 | 0.20 [0.28] |
| transit | 5 | 4.46 | 4.46 [4.75] | 42 | 0.64 | 0.64 [1.82] |
| transit2 | 5 | 4.92 | 4.92 [5.74] | 225 | 0.13 | 0.16 [0.18] |
| roundSearch | 20 | 2.36 | 2.36 [6.76] | 128 | 0.54 | 0.64 [0.65] |
| roundMatch | 20 | 3.33 | 3.33 [3.79] | 651 | 1.00 | 1.58 [4.01] |
| commute | 10 | 2.26 | 2.26 [2.67] | 200 | 1.41 | 2.31 [4.38] |
| inbound | 5 | 1.46 | 1.46 [2.42] | 34 | 2.03 | 2.03 [3.37] |
| shop | 5 | 2.08 | 2.08 [3.35] | 42 | 0.50 | 0.50 [0.56] |
| freight | 5 | 1.65 | 1.65 [2.61] | 48 | 0.43 | 0.43 [0.56] |
| parking | 2 | 1.86 | 1.86 [2.99] | 88 | 0.12 | 0.12 [0.14] |
| final | 5 | 1.23 | 1.23 [1.34] | 76 | 1.29 | 1.29 [1.41] |
| final2 | 5 | 3.15 | 3.15 [4.03] | 204 | 0.55 | 0.82 [1.69] |
| **all traffic** | 97 | 5.47 | 5.47 [6.76] | 2234 | 1.00 | 4.01 [4.38] |

**The largest indivisible traffic items** (review 2, item 5f), max ms in these runs (days 0–20 / 20–80 / 80–220): the inbound fills or search start (`inbound.0`: 4.97 / 4.17 / 0.24), the snapshot take (`prep.scanBegin`: one `buildingList` + copy, 4.36 / 1.09 / 1.43), the transit search start (`S.reset` + seeds: 2.28 / 0.55 / 0.38), the round-search start (0.95 / 1.06 / 0.16), the save build (`final2.11`: 0.72 / 1.58 / 1.85), `refreshAttach` (prepTransit's attach piece, most cycles because growth's terrain edits mark it: 0.09 / 0.35 / 0.13). The graph rebuild's publish is edit-only and did not run.

### 15.5 Notes for G2–G4

- **Harness.** `tests/infra/b2Harness.ts` (`digest`, `stateDigest`, `fieldsDigest`, `diffDigests`, `taskOf`, `withPieceScale`) and the traffic part of `tests/infra/b2Pieces.test.ts` are the pattern: one go (scale 1e9) = production = tiny / random pieces at every pass end across edits; queries between pieces (R8); outputs per piece (R7); a mid-pass save (R9); frames active vs headless (O4); two cities interleaved.
- **Tools** (in `scratchpad/b2work/G1-core-traffic/`): `passdigest2.ts` (passdigest with digests at several days in one run), `cpumapT.ts` (cpumap with split-task labels for traffic), `genfx.ts` (synthetic fixtures from B's code), `anT.py` / `anL.py` / `anTable.py` (windows, per-label error and per-phase tables). Under contention, one `timed.py` call per interleaved B / W pair halves the lock waits.
- **Cold factors decide the sizes.** A loop that runs once per pass stays cold for many passes: 10–37× its warm cost in days 0–80, about 45× on its first executions, and deopt waves (the day-148 Building wave) hit 0.05 ms pieces at 3–4 ms. Size such loops for that, then calibrate.
- **Warm costs move with the chunk size.** In one run each, prep's node-time loop measured 52 ns per node in 13,000-node chunks and 5 ns per node in 2,000-node chunks (days 80–220). Choose the sizes first, calibrate after, and keep the absolute scale of the estimates separate from the chunking (traffic's `TR_EST`), so the final calibration does not move a chunk.
- **One method per piece kind** (R10) is cheap to keep from the start; splitting the dispatchers later was a mechanical move of each `case` body.

## 16. G2 as built (`G2-services-nimby`, Oct 28 – Nov 3)

**Commits** (branch `b2-step-split`, on G1's `7599eb8`): `11e2267` the kernels (`RoadTimeRun`, `RoadDistRun`, `transitCoverageRange`, `NimbyRun`, the police need run, `TrafficSystem.attachRefreshMs`), `a8ebea0` every services state in pieces with the cost model per piece and the test adaptations of §11.5, `2270de9` one method per piece kind (R10), `0faa81a` the cold cell floor and smaller tier steps, `8d1736b` the cost fit, `a168442` the cold Building floor and the typed tier scratch, `817e677` the resumable fresh reach and the footprint-max pieces, `d76ca80` the seat-order comparator, then this document. `npx tsc --noEmit` clean; the full `npx vitest run` at `803c7bc` (one worker, low priority: the timing lock was taken by other workers for hours): 136 files passed, 1 skipped (1,381 tests passed, 18 skipped), no unhandled errors. The first full run, at `d76ca80`, failed only `emergencyBot` EM-1 normal play (the bot's town moved; `803c7bc` adapts the test, §11.5).

### 16.1 Review items applied

| item | where |
|---|---|
| R4 / R9 (saved data in one piece) | each saved coverage layer (`policeCov`, `fireCov`, `healthCov`, `eduCov`, `parkCov`) changes in its publish piece (`layer.set(finBuf)`, the combos from private buffers); `transitCov` in the three states that wrote it pre-B2 (the transit slot's publish, stops' and foot's publish from byte copies); `stats.needs` with `stats.eq` / `hq` in finish's last piece. b2PiecesServices "R9": a save taken in the middle of a pass loads idle, and loads the same twice |
| R5 (inputs at the stage start) | prep's first piece consumes `dirtyUrgent`, `dirty`, `accessDirty`, `nimbyDirty` and the pass inputs; an urgent change arriving after it stays pending for the next pass (`servicesTrigger`) |
| R6 (proof against today's code) | `tests/sim/exact/servicesOriginal.ts` (services.ts at 41ae570, frozen): b2PiecesServices compares every original field at every pass end; `passdigest --mode atomic` B vs W on dense1m, bot256, dense1m without WP1, and three services cities generated with B's code, each with and without WP1 (16.3) |
| R7 (the three tests) | `servicesTrigger` and `catchments` 'bulldozed mid-pass' step until prep is done (§11.5); b2PiecesServices "R7": every external output changes in at most one piece per state visit (`transitCov` in its three states) |
| R8 (other code of the same city between pieces) | b2PiecesServices "R8": after every piece, traffic `findPath`, `stopsNear`, `stopAttached` / `freightRailCells` with the attachment forced dirty, `routeInfo`; `facilityReport`; services `needRaster` / `unservedClusters`; utilities `waterQualityAt` / `gridInfo`; an emergency `probe`; a facility reach preview (`reachRaw`): same digests as without them |
| O3 (`cost()` side-effect free) | `stepCost` reads cursors and sizes only; the snapshot and its plan are taken by prep's pieces |
| O4 (mode invariance) | b2PiecesServices "O4": the stepName sequence and the digests are identical with frames active and headless |
| O7 | moot: R10's per-facility arrays are not built (16.2) |
| O8 (explicit pass start) | `stepIdx < 0` resets every cursor (`resetPieces`) before the first piece, as at the pass end and in `init()`; a direct `stepIdx = -1` or a `compute()` in mid-pass starts clean |
| review 2, item 1 (cold sizes) | R2 "Services as built": half `INFRA_PIECE_COLD_MS` for every once-per-pass loop, the cold cell and Building floors, the tier steps at half `INFRA_PIECE_MS` with their row items alone, the stop disks at a quarter of the cold budget |
| review 2, item 3 (windows from load; edits) | measured `--warm 0 --days 220`, reported per window (16.4), and the edit and disaster scenario (16.4) |
| review 2, item 4 (warm cost error) | `SV_EST` and the fixed costs fitted on dense1m warm; checked on dense1m and bot256 (16.4) |
| review 2, item 5a (publish pieces) | the combos, the stop compose, the foot and the tier layers are computed into private buffers and published by `.set()`; the need rasters and the providers' rasters by swaps; NIMBY by `.set()` |
| review 2, item 5b (police need) | `PoliceNeedRun`: the monthly scan in chunks over the pass list (installed at its end with the list's `nextBuildingId`), the job sites, the cell pass |
| review 2, item 5e (lazy caches) | traffic's attachment refresh runs in a services piece of its own (`attachRefreshMs` > 0), before prep's building chunks and before the stop disks |
| review 2, item 5f (largest indivisible items) | 16.4; the tier engine's largest item, one fresh reach, is no longer indivisible (16.2) |

Not applied: R1–R3 (traffic, G1), R5's pollution part and R7a (G3 / G4), O10 / O11 (no services part), review 2 item 2 (the Building-shape fix is outside B2's files; §14 item 4).

### 16.2 Deviations from §4, and why

- **R10's per-facility value arrays are not built** (review 2's optional item), so `powById` keeps its pre-B2 read at the tier step and O7 is moot. Two smaller changes met the targets instead: the per-facility scratch of the current slot (`facStart`, `facEnd`, `facSig`, `facSeat`) is typed and grown once — pre-B2's JS arrays, emptied per slot and filled in seat order, made `allocSeats` deoptimise on an out-of-bounds store on day 25 and run unoptimised for five tier steps (up to 8.4 ms) — and `reachOf`, `splatUnion` and `allocSeats` read a facility's `id` / `flags` once, at their top (`reachOf` deoptimised about 1,500 times in 40 days on a later read of `b.id`).
- **NIMBY and foot use half `INFRA_PIECE_COLD_MS`** (§4 listed them at `INFRA_PIECE_MS`): NIMBY runs every second pass and stays cold the longest.
- **The tier steps' budget is half `INFRA_PIECE_MS`, and a final row item (clamp, stats) runs alone.** At `INFRA_PIECE_MS` the first scheduled passes after a load ran tier steps of 2–4.4 ms.
- **Cold floors, `INFRA_CELL_SIZING_US` and `INFRA_BLD_SIZING_US`** (new, params.ts). The once-per-pass cell loops ran at about 0.1 µs per cell in the first passes after a load (25–70× warm), and the once-per-pass Building loops at 1–8 µs per building on first executions and after Building-shape deopts, so their pieces hold at most about 16,000 cells or 325 buildings however cheap they are warm. Sizes only: the estimates keep the loops' coefficients. The police scan and job sites use the Building floor too.
- **Traffic's attachment refresh in a services piece of its own** (R2 offered "add its cost to the estimates"): `attachRefreshMs(st)` reports it pending, and services calls `stopAttached(-1)` in its own piece before its first reader. The refresh is a pure function of the state, so results do not move.
- **A fresh reach is a resumable item** (§4 S_TIERS c: "a single item over the budget runs alone"; review 2 item 5f listed it as the tier engine's largest indivisible item). Warm, dense1m's largest fresh reach is a hospital's (8,700 cells, about 0.3 ms), but the search kernel stays cold between passes, because cached reaches never call it: in the edit scenario at `a168442`, the fresh reaches after an edit (a road cut invalidates every road reach) ran as single `tiers.search` steps of 1.4–3.2 ms and once 5.1 ms. Catchments `ReachRun` repeats reachRaw's loop bodies on its own engine (other code calls reachRaw between the pieces: a facility preview, the inspector, another city); its Dial drain stops between queue entries, a disk between rows. The bucket being drained is detached before it drains (as in `RoadDistRun`), so the cells, their order and their weights equal reachRaw's for any cut. The services item is held across tier steps; its pool copy, cache entry, record and union splat run in its last piece, in pre-B2's order. `U_REACH_POP` = 4.5 units per queue entry (dense1m's 2,428 facilities: 0.39 entries per reached cell, 0.10 warm µs per entry), about 1,350 entries per piece. The split bounds the largest reach, not the cold factor: at `817e677` the reach pieces after an edit still ran at 1.4–2.3 ms (about 10–17× their warm 0.135 ms) and once at 4.3 ms, within R2's rule (3 ms at the p99 factor, 5 ms at the max); halving `U_REACH_POP`'s pieces is the next step if G4's edit gate needs it.
- **The tier footprint max: its max and fill loops are separate functions (R10), and a piece holds at most S_FOOT's lots** (`SC.foot` per lot cell at the cold budget, about 3,900 lot cells; it was the cold cell floor's ~12,000). The first call of a load's second pass (police, day 31 after the load) ran at 2–3 ms in about half the runs at `a168442` and at 10.2 ms once (1 of 5 runs), for a slot's few thousand lot cells: a `--trace-deopt` run showed `lotMaxRange` deoptimising ten times in the first pass, in its OSR code, on the fill loop that had never run when the max loop was compiled. With the loops split (the fill a native `fill`) that step's max over 5 runs is 0.89 ms. The cap does not bind at dense1m (a slot's whole footprint max is still one piece; the step count is unchanged): it bounds cities with more lot cells. (`817e677`'s message credits the cap; the split is what removed the slow calls.)
- **The seat-order sort reads typed ids** (R10's per-facility arrays in miniature). Its comparator read `list[a].id` from Buildings of many maps: one tier item of 0.9–2.7 ms on every pass day at dense1m (play and green, 500–900 facilities, about 10,000 comparisons), the slowest tier step of each pass from a load. It now reads a typed copy of the ids: every comparison returns the same value, so the order is identical.
- **The stale-record clear runs by id ranges at the pass end** (an R7 exception, recorded there).
- **The WASM tier engine sections run against the frozen class** (§11.6 as built) instead of being skipped.
- **The catchments perf test compares the tier steps** (§10 G2's fallback): with honest units the whole cached pass is 0.64 of the fresh one, because it also holds the fixed costs and the states the cache does not touch, and the second pass is the one that rebuilds NIMBY. The tier steps: 0.41. The whole pass is still asserted below 0.75.
- **A separate test file**, `tests/infra/b2PiecesServices.test.ts`, on the G1 harness, instead of extending `b2Pieces.test.ts`.
- **`facilities.ts` is also touched by B3** (the month-boundary work): the police need run only adds a class and splits `monthlyScan` into parts; a merge keeps both.

### 16.3 Exactness evidence

- `tests/infra/b2PiecesServices.test.ts` (18 tests): the kernels in random chunks equal their whole-call originals (`roadTimeMulti`, `roadDistMulti`, `reachRaw` for walk, drive and disk reaches with other reaches between the pieces, `computeTransitCoverage`, `rebuildNimby` and the frozen pre-J4 rebuild, `policeNeed` with its per-state lists); three services cities (48 with infra only, 64 with every system, 96) give identical cities and services fields at every pass end in one go, at the production size and in tiny / random pieces across network, building and funding edits; production and random pieces equal the frozen original in every original field; R8, R7, R9, O4; two cities stepped interleaved equal their solo runs; every piece estimate within its budget.
- `tests/sim/exact/nimby.test.ts`: piecewise and whole rebuilds against `nimbyOriginal`. `tests/wasm/servicesTierEngine.test.ts`: 18 of 18 against the frozen class.
- `passdigest --mode atomic`, B vs W at `d76ca80`, digests at days 30 and 100: dense1m, bot256, dense1m without WP1 (day 30), and `services96_s7`, `services128_s11`, `services64_s5` (generated with B's code; every service kind, transit, landfills, prestige and campus buildings), each with and without WP1. All 15 checkpoints identical (every part and layer digest; `pdcmp.py`). The step counts differ by design: at dense1m by day 30, services 40 steps in B and 1,842 in W, traffic 292 and 8,785.

### 16.4 Measurements (dense1m, headless, wall clock)

Tool: `b2work/G2-services-nimby/cpumapS.ts` (G1's cpumap with services labelled by `stepName` in W and by state in B), `--noinputs`. Every pair in one timing-lock hold (`timed.py`: other processes averaged 0.026 cores), B and W interleaved, B first on odd pairs. From load (`--warm 0 --days 220`): 5 runs per side. Warm (`--warm 300 --days 120`): 3 per side, on dense1m and on bot256. The edit and disaster scenario (`editmapS.ts`, review 2 item 3c): 3 per side. Per run, the p99 and the max of the services steps; the tables give the median over runs, and the worst run's max in brackets. W is `817e677`. The seat-order fix (`d76ca80`) came after this measurement; it changes one item's speed, no boundary (16.2). The previous G2 measurement (`a168442`, same protocol) had worst runs of 3.42, 10.17 and 3.90 ms from load (the day-31 footprint max, 16.2), 4.39 ms warm (a GC pause) and 5.14 ms in the edit scenario (a road cut's fresh reaches). The all-task p99 and max of these runs are still pre-B2's: crime, pollution, utilities and emergency are G3 / G4.

**Services steps, all states** (ms; W `817e677`):

| window | B p99 | B max | W p99 | W max | W max, worst run | W max without GC, worst run | W steps > 3 / > 5 ms (all runs) |
|---|---|---|---|---|---|---|---|
| days 0–20 | 34.88 | 34.88 | 1.43 | 2.39 | 2.90 | 2.55 | 0 / 0 |
| days 20–80 | 28.96 | 28.96 | 0.65 | 2.71 | 3.12 | 2.73 | 1 / 0 |
| days 80–220 | 13.97 | 13.97 | 0.38 | 3.54 | 3.96 | 3.19 | 4 / 0 |
| warm, days 300–420 | 7.08 | 7.08 | 0.36 | 0.61 | 2.26 | 2.18 | 0 / 0 |
| bot256 warm, days 300–420 | 5.68 | 5.68 | 0.47 | 1.83 | 3.28 | 3.28 | 1 / 0 |

W p99 ranges over its runs: days 0–20 1.36–1.63; days 20–80 0.63–0.79; days 80–220 0.36–0.40; warm, days 300–420 0.35–0.37; bot256 warm, days 300–420 0.44–0.49.

**Cost error of services** (median of estimate / measured − 1, per run; median, range, and B): days 0–20 −0.21 (−0.59…−0.19; B −0.57); days 20–80 −0.22 (−0.28…−0.12; B −0.37); days 80–220 −0.05 (−0.19…−0.01; B −0.18); warm, days 300–420 −0.01 (−0.03…+0.03; B −0.16); bot256 warm, days 300–420 −0.01 (−0.12…+0.07; B −0.04).

**Busy-time-weighted p99 of W** (review 2's optional item: the step length below which 99 % of the services step time falls; median over runs): days 0–20 2.39, 20–80 2.31, 80–220 2.16, warm 0.47, bot256 warm 1.71 ms. It sits near the max, because 1 % of a window's services time is one or two steps.

**Piece estimates.** The largest services piece estimate in every W run is 0.278 ms (`prep.attach`, traffic's pending attachment refresh, estimated by `attachRefreshMs`), every other piece below it (`INFRA_PIECE_MS` is 0.3).

**The edit and disaster scenario** (dense1m, `--warm 30 --gap 30`: a road cut, its restore, a bulldoze, an earthquake and a meteor 30 days apart; the services steps of the 10 days from each edit, most of them urgent):

| edit (10 days) | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| bld | 15 | 15.98 | 15.98 [23.40] | 676 | 0.38 | 1.51 [1.62] |
| meteor | 11 | 6.08 | 6.08 [12.25] | 1408 | 0.32 | 1.05 [1.62] |
| quake | - | - | - | 1086 | 0.38 | 3.69 [4.33] |
| road | 27 | 26.90 | 26.90 [37.31] | 1145 | 1.28 | 2.69 [4.55] |
| unroad | 6 | 11.62 | 11.62 [13.24] | 410 | 0.43 | 1.59 [2.34] |

W's longest steps in these windows: 4.55 ms `accSearch.run` (road + 4 d), 4.33 ms `tiers.search` (quake + 3 d), 3.69 ms `tiers.seatOrder` (quake + 3 d), 2.69 ms `stops.disks` (road + 1 d), 2.63 ms `stops.disks` (road + 1 d), 2.34 ms `tiers.search` (unroad + 1 d).

**Pieces and cadence** (medians over runs; the headless schedule spends `INFRA_DAY_BUDGET` estimated ms a day): from load (220 days): services 12 passes in W (7 in B) in 8921 pieces (114 steps), 3.30 real ms a day (2.47); traffic 7 cycles (9), crime 10 passes (10), pollution 16 (10), utilities 67 (41); all infra steps 11.03 real ms a day (9.65), 6.36 estimated (3.68); warm (120 days): services 4 passes in W (3 in B) in 3074 pieces (42 steps), 1.44 real ms a day (0.83); traffic 3 cycles (5), crime 6 passes (6), pollution 9 (6), utilities 36 (22); all infra steps 6.30 real ms a day (3.98), 5.51 estimated (3.31).

Services runs more passes in W: its estimates are honest, so the day budget buys more of it, and the real infra ms a day grew with them and with G1's traffic. G4 sets the final budget (§9.4).

**Per state, before (B) and after (W)** (median over runs of each run's p99 / max; worst run's max in brackets):

| days 0–20 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 1 | 34.88 | 34.88 [49.27] | 193 | 1.30 | 1.64 [1.81] |
| tiers | 9 | 12.60 | 12.60 [14.11] | 265 | 1.81 | 2.39 [2.90] |
| stops | 1 | 11.26 | 11.26 [11.94] | 114 | 1.25 | 1.42 [1.92] |
| foot | 1 | 0.30 | 0.30 [0.38] | 9 | 0.07 | 0.07 [0.11] |
| finish | 1 | 15.27 | 15.27 [22.33] | 51 | 0.20 | 0.20 [1.82] |
| **all services** | 13 | 34.88 | 34.88 [49.27] | 632 | 1.43 | 2.39 [2.90] |

| days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 3 | 28.96 | 28.96 [36.90] | 597 | 0.48 | 1.51 [2.56] |
| tiers | 27 | 11.25 | 11.25 [16.81] | 1064 | 0.56 | 2.15 [2.73] |
| stops | 3 | 12.01 | 12.01 [17.71] | 456 | 0.96 | 1.71 [1.87] |
| nimby | 2 | 10.95 | 10.95 [16.65] | 98 | 0.81 | 0.81 [3.12] |
| accSeed | 1 | 9.12 | 9.12 [9.91] | 108 | 0.39 | 0.53 [0.55] |
| accSearch | 1 | 10.80 | 10.80 [11.37] | 76 | 0.96 | 0.96 [1.30] |
| accLand | 1 | 14.42 | 14.42 [16.25] | 168 | 0.20 | 0.76 [1.19] |
| shopA | 1 | 6.10 | 6.10 [6.85] | 28 | 0.73 | 0.73 [1.08] |
| shopB | 1 | 15.81 | 15.81 [18.91] | 198 | 0.46 | 0.71 [2.34] |
| foot | 3 | 0.56 | 0.56 [2.41] | 36 | 0.12 | 0.12 [0.17] |
| finish | 3 | 13.97 | 13.97 [27.36] | 204 | 0.16 | 0.40 [0.82] |
| **all services** | 46 | 28.96 | 28.96 [36.90] | 3033 | 0.65 | 2.71 [3.12] |

| days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 3 | 11.50 | 11.50 [13.97] | 1106 | 0.28 | 1.42 [3.96] |
| tiers | 27 | 4.94 | 4.94 [6.61] | 1870 | 0.48 | 2.13 [3.54] |
| stops | 3 | 2.45 | 2.45 [6.66] | 798 | 0.09 | 0.21 [0.46] |
| nimby | 1 | 1.97 | 1.97 [3.35] | 196 | 0.18 | 0.22 [2.16] |
| accSeed | 3 | 9.77 | 9.77 [10.08] | 162 | 0.42 | 0.54 [3.74] |
| accSearch | 3 | 2.22 | 2.22 [11.82] | 113 | 0.10 | 0.17 [0.24] |
| accLand | 3 | 2.89 | 2.89 [16.25] | 252 | 0.14 | 0.21 [1.63] |
| shopA | 3 | 1.88 | 1.88 [6.63] | 42 | 0.31 | 0.31 [0.39] |
| shopB | 3 | 8.73 | 8.73 [19.03] | 297 | 0.13 | 0.18 [0.19] |
| foot | 3 | 0.40 | 0.40 [2.58] | 63 | 0.14 | 0.14 [0.25] |
| finish | 3 | 1.95 | 1.95 [2.06] | 357 | 0.13 | 0.24 [0.49] |
| **all services** | 55 | 13.97 | 13.97 [19.03] | 5256 | 0.38 | 3.54 [3.96] |

| warm, days 300–420 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 3 | 6.23 | 6.23 [9.16] | 622 | 0.16 | 0.28 [0.36] |
| tiers | 19 | 3.87 | 3.87 [4.81] | 1072 | 0.41 | 0.57 [2.18] |
| stops | 2 | 2.11 | 2.11 [3.62] | 458 | 0.08 | 0.14 [0.15] |
| nimby | 1 | 2.10 | 2.10 [5.13] | 98 | 0.23 | 0.23 [2.26] |
| accSeed | 2 | 2.15 | 2.15 [2.97] | 110 | 0.11 | 0.15 [0.15] |
| accSearch | 2 | 1.50 | 1.50 [2.18] | 76 | 0.15 | 0.15 [0.61] |
| accLand | 2 | 2.25 | 2.25 [5.35] | 170 | 0.10 | 0.19 [0.27] |
| shopA | 2 | 1.04 | 1.04 [1.40] | 28 | 0.10 | 0.10 [0.11] |
| shopB | 3 | 4.39 | 4.39 [7.08] | 200 | 0.10 | 0.16 [0.24] |
| foot | 3 | 0.41 | 0.41 [0.59] | 36 | 0.10 | 0.10 [0.11] |
| finish | 3 | 2.95 | 2.95 [3.12] | 204 | 0.09 | 0.11 [0.12] |
| **all services** | 42 | 7.08 | 7.08 [9.16] | 3074 | 0.36 | 0.61 [2.26] |

| bot256 warm | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| prep | 3 | 5.68 | 5.68 [5.92] | 966 | 0.17 | 0.51 [1.49] |
| tiers | 20 | 3.43 | 3.43 [4.04] | 1050 | 0.65 | 1.01 [3.28] |
| stops | 4 | 0.65 | 0.65 [0.82] | 338 | 0.09 | 0.18 [0.23] |
| nimby | 2 | 2.46 | 2.46 [5.54] | 120 | 0.11 | 0.12 [0.17] |
| accSeed | 4 | 1.28 | 1.28 [1.80] | 108 | 0.07 | 0.07 [0.10] |
| accSearch | 4 | 0.93 | 0.93 [0.98] | 66 | 0.14 | 0.14 [0.25] |
| accLand | 4 | 2.79 | 2.79 [3.13] | 198 | 0.11 | 1.12 [1.83] |
| shopA | 4 | 0.45 | 0.45 [0.49] | 21 | 0.20 | 0.20 [0.24] |
| shopB | 4 | 2.29 | 2.29 [4.20] | 318 | 0.12 | 0.16 [0.48] |
| foot | 3 | 0.00 | 0.00 [0.00] | 8 | 0.15 | 0.15 [0.22] |
| finish | 3 | 1.93 | 1.93 [2.28] | 384 | 0.11 | 0.15 [0.16] |
| **all services** | 55 | 5.68 | 5.68 [5.92] | 3577 | 0.47 | 1.83 [3.28] |

**The largest items** (review 2 item 5f; the max over all W runs of each piece kind, steps that overlap a GC pause left out; `tiers.seatOrder` is the seat-order sort, the last `tiers.search` step of a shared slot):

| label | 0-20 | 20-80 | 80-220 |
|---|---|---|---|
| prep.bld | 0.55 | 0.65 | 3.19 |
| tiers.search | 1.81 | 2.73 | 0.88 |
| tiers.alloc | 2.55 | 2.16 | 0.90 |
| tiers.seatOrder | 2.43 | 2.31 | 2.30 |
| shopB.out | 0.00 | 1.91 | 0.15 |
| stops.compose | 1.28 | 1.87 | 0.13 |
| accSeed.bld | 0.00 | 0.55 | 1.83 |
| finish.combo | 1.82 | 0.26 | 0.24 |
| prep.netHash | 1.81 | 0.16 | 0.09 |
| prep.attach | 1.77 | 1.78 | 1.05 |
| stops.disks | 1.42 | 1.75 | 0.21 |
| stops.collectB | 1.49 | 0.10 | 0.10 |

**The bot** (128 × 15, seed 7, `tools/balance-json.ts`, W): 2015 population 193,577, approval 79.2, totalMsPerDay 6.00. B1's reference is 196,101; G1 (`2a4cb3f`) gave 193,525. The results move by design through the schedule (the headless schedule follows the estimates); G4 records the new hashes.

### 16.5 Notes for G3–G4

- **Size once-per-pass loops by a cold floor, not by their warm cost.** The cheapest loops (a native-like pass over C cells at 1–2 ns per cell warm) were the worst cold offenders: their pieces were sized at tens of thousands of cells and ran interpreted. `INFRA_CELL_SIZING_US` caps the cells per piece; crime, pollution and utilities can reuse it.
- **Keep sizing and estimate apart.** Fixed costs and the absolute scale (`SV_EST`) never enter a chunk size, so the fit moved no boundary and the cold measurements stayed valid.
- **Cached results keep kernels cold.** A kernel that runs only on a cache miss (the reach search) is cold exactly when an edit invalidates the caches: split it like a once-per-pass loop, not like the hot items around it.
- **Frozen originals** (`servicesOriginal.ts`) keep the WASM sections and the bench tools running; pollution can do the same for the field-pass sections.
- **Tools** (in `scratchpad/b2work/G2-services-nimby/`): `cpumapS.ts` (cpumap with services labelled by `stepName`), `passdigestS.ts` (`--infra`: without WP1), `genfxS.ts` (synthetic services fixtures from B's code), `editmapS.ts` (the edit and disaster scenario), `anS.py` / `anTableS.py` / `anEd.py` / `anFit.py` / `calS.py` (windows, tables, edits, per-label error, the fixed-cost model), `catchPerf.ts` (the stress city's per-label estimates, fresh vs cached).

## 17. G3 as built (`G3-crime-pollution`, Nov 3)

**Commits** (branch `b2-step-split`, on G2's `91a0436`): `0c3b32c` the kernels (`Blur3Run`, `downsampleRows`, `upsampleAddRows` in blur.ts), `7452227` every crime and pollution state in pieces with the cost model per piece, the frozen originals and `tests/infra/b2PiecesEnv.test.ts`, `74307eb` four test adaptations (§11.5), `7972d25` the cost refit, `2fc45f0` the smaller cold pieces (crime's loops and pollution's cell work at a quarter of `INFRA_PIECE_COLD_MS`, the field programs' loops as functions of their own), `bd7695a` the EM-1 adaptation, then this document. `npx tsc --noEmit` clean; the full `npx vitest run` at `bd7695a` (3 workers, under the timing lock): 137 files passed, 1 skipped (1,397 tests passed, 18 skipped), no unhandled errors. The run before at `2fc45f0` failed only EM-1 normal play (the bot towns moved; `bd7695a` adapts it, §11.5)

### 17.1 Review items applied

| item | where |
|---|---|
| review 1 R4 (saved data in one piece) | `st.crime` (SP_PUB), `st.garbage` (GA_PUB), `st.soil` (the brownfield writes at GS_END, the stock's publish in FL_SOIL), `st.landfillFill` (the resets at GS_END, the fill in GA_LF), `st.airPollution` / `st.noise` / `st.waterPollution` (their programs' last `.set()`), `treeCover` (derived, the tree program's `.set()`): each built in a private buffer (or written in one piece) and published once per state; the flags and `stats` in publish pieces. The brownfield `st.soil` / `st.landfillFill` writes of the landfill scan are collected in scan order and applied at GS_END (R4c). b2PiecesEnv "R7" checks every one at every production piece, "R9" a mid-pass save |
| review 1 R5 (the water list in mid-diffusion) | the list is (re)built only in the water stage's list sub-state, in pieces, into private buffers installed at its end; the stage keeps references to the list it built or found valid; an invalidation during the build (an epoch counter) leaves the list invalid for the next pass. b2PiecesEnv "R5": a terrain change in the diffusion keeps the stage's list, the next pass rebuilds it |
| review 1 R6 (proof against today's code) | `tests/sim/exact/crimeOriginal.ts`, `pollutionOriginal.ts` (41ae570, frozen): b2PiecesEnv compares every original field at every pass end, at production and random piece sizes, across network, building, landfill, tree, park, terrain and funding edits; `passdigest --mode atomic` B vs W on dense1m, bot256 and three env cities generated with B's code (a river, a lake, a landfill with a road and one without, every garbage / emitter / spill kind, trees, parks, building states), each with and without WP1 (17.3) |
| review 1 R8 (other code of the same city between pieces) | b2PiecesEnv "R8": after every piece, traffic `findPath` and `stopAttached` / `freightRailCells` with the attachment forced dirty; pollution `garbageInfo`, `emissionOf`, `incineratorShare`, `landfillInfo`, `garbageSummary`, `roadlessGarbage`; crime `termsOf`; utilities `waterQualityAt` / `gridInfo`; services `needRaster`; an emergency `probe`; another city's `blur3` / `upsampleAdd` (the blur module's scratch and tables): same digests as without them |
| review 1 O3, O4, O5, O6, O8 | `stepCost` reads cursors and sizes only (a field program: O(its ops)); b2PiecesEnv "O4" (the stepName sequence and the digests with frames active and headless); `withPieceScale`, seeded random scales; the G1 harness digests; `stepIdx < 0` resets every cursor (`resetPieces`) before the first piece in both systems (crime treated 0 and −1 alike pre-B2) |
| review 1 O10 | pollution's `ground` is still not reset on a same-size `replaceState` (`ensureCells` reallocates on a size change only, as pre-B2) |
| review 2 item 1 (cold sizes) | R2 "Crime and pollution as built": half `INFRA_PIECE_COLD_MS`, the cold cell and Building floors, one chunk plan per pass |
| review 2 item 3 (windows from load; edits) | measured `--warm 0 --days 220` per window and the edit and disaster scenario (17.4) |
| review 2 item 3d (kernels by rows) | blur3, blurDown's downsample, upsampleAdd, saturate and `noiseBuffer` run by rows (field programs); airFar's saturate is several pieces |
| review 2 item 4 (warm cost error) | the refit of the coefficients that size no piece (`7972d25`), checked warm on dense1m and bot256 (17.4) |
| review 2 item 5a (publish pieces) | crime's mix in row pieces into `next`, published by `.set()`; every pollution layer likewise |
| review 2 item 5d (flags) | crime, garbApply and flags push candidates (the buildings whose bits flip, with the wanted bits) in their chunks; the publish piece applies them in snapshot order (pre-B2's `changed` list) |
| review 2 item 5e (lazy caches) | traffic's pending attachment refresh runs in a pollution piece of its own (srcCells, before `freightRailCells`), as G2 |
| review 2 item 5f (largest indivisible items) | 17.4 |

Not applied: R1–R3 (traffic, G1), R7a (utilities' j10 test, G4), O1 / O2 / O7 / O9 / O11 / O12 (no crime or pollution part), review 2 item 2 (the Building-shape fix is outside B2's files; §14 item 4).

### 17.2 Deviations from §5–§6, and why

- **Kernels by rows, not one call per piece** (§5 SP1..SP6, §6 AN / AF / NO / WA): a single kernel call ran at up to 22× cold (review 2 item 3d), so blur3, the downsample, upsampleAdd, saturate and `noiseBuffer` run in row ranges. `Blur3Run` keeps a `BoxVRun` of its own; `upsampleAddRows` rebuilds the module's interpolation tables when other code changed them (a pure cache).
- **Field programs** (§6 as built): the cell and blur work of a stage is a list of ops run in row / unit ranges, a piece continuing across ops while its sizing fits; one mechanism for ten stages instead of a sub-state per call. Each program is built in a piece of its own (the stage's conditions are read there, once per stage).
- **The landfill scan's labels and regions are built privately** and swapped in at GS_END (§6 said "the landfill-scan setup" only): `landfillInfo` reads them between pieces (R7). `roadless` likewise.
- **The water list is built in pieces** (§6 WA4 "ensureWaterList when invalid"): it runs on most passes of a growing city (terrain levelling), O(C) with JS-array bank lists.
- **airFar's and noise's saturate and the soil stock run on private copies** published by `.set()` (§6 had the saturate as the publish piece, FL0 as one piece): split by rows, a saved layer must still change once.
- **One snapshot plan per pollution pass for all its building stages** (and the route scatter), at the Building floor + stageA's 41 ns per footprint cell; crime's at the floor + 63 ns. The estimates use each stage's own coefficients.
- **Candidate lists for flags** (R7 "a desired-value array or a list of the buildings whose bit changes"): the list.
- **R7 exceptions added:** `prodById` / `reasonById` (only `garbageInfo` reads them) written in place by the building chunks, like `airById`; `garbageSummary()` written by three states, as pre-B2.
- **The WASM sections and blurSim run against the frozen classes** (§11.6 as built) instead of being skipped.

### 17.3 Exactness evidence

- `tests/infra/b2PiecesEnv.test.ts` (16 tests): `Blur3Run`, `downsampleRows`, `upsampleAddRows` in random row ranges equal blur3, blurDown's downsample and upsampleAdd, with other blurs and upsamplings (other keys of the module tables) between the pieces; three env cities (48 infra only, 64 every system, 96 infra only) give identical cities and crime / pollution fields at every pass end in one go, at the production size and in tiny / random pieces, across network, landfill (dezoned and built-over cells: the brownfield and fill-reset paths), tree, park, terrain (the water list), building, fire and funding edits; production and random pieces equal the frozen originals in every original field; the edits reach every branch (brownfield, fill reset, a BFS rerun, a water-list rebuild, the tree program, the spill venues); R8, R7, R9, O4, two cities interleaved, review 1 R5, every piece estimate within budget.
- `tests/wasm/fieldPasses.test.ts` (the field-pass port against the frozen pollution class) and `tests/wasm/blurSim.test.ts` (the wasm blur against JS on the frozen pollution and crime passes): pass.
- `passdigest --mode atomic`, B vs W, digests at days 30 and 100 (G3's `passdigestE.ts`: G2's digests + the pollution internals — per-id garbage arrays, shares, regions, the water list, ground water, the noise buffer, tree belts, the source fields — and crime's raw field): dense1m, bot256, and `env96_s7`, `env128_s11`, `env64_s5` (`envCity`, generated with B's code), each with and without WP1. All 16 checkpoints identical, at `7452227` and again at `2fc45f0` (dense1m, env128). The step counts differ by design: at dense1m by day 100, crime 15 steps in B and 2,221 pieces in W, pollution 80 and 6,728.

### 17.4 Measurements (dense1m, headless, wall clock)

Tool: `b2work/G3-crime-pollution/cpumapE.ts` (G2's cpumap: crime and pollution labelled by `stepName` in W and by state in B), `--noinputs`; `editmapE.ts` (G2's edit and disaster scenario). One timing-lock hold (`timed.py`; other processes averaged 0.055 cores, peak 2.16), B and W interleaved, B first on odd pairs: from load (`--warm 0 --days 220`) 5 runs per side; warm (`--warm 300 --days 120`) 3 per side on dense1m and on bot256; the edit scenario 3 per side. Per run, the p99 and the max of the task's steps; the tables give the median over runs, and the worst run's max in brackets. W is `2fc45f0`. (A first formal hold at `7972d25`, half the cold budget for every loop, had crime's mix at 3–4 ms and its building chunks at up to 4.6 ms on the first two passes, and pollution's cell programs at 2–5 ms on the first pass, in a hold with other processes at 0.27 cores: `2fc45f0` quartered those budgets.)

**Crime and pollution steps, all states** (ms):

| window | task | B p99 | B max | W p99 | W max | W max, worst run | W max without GC, worst run | W steps > 3 / > 5 ms (all runs) |
|---|---|---|---|---|---|---|---|---|
| days 0–20 | crime | 15.05 | 15.05 | 0.47 | 1.26 | 4.45 | 4.45 | 1 / 0 |
| days 0–20 | pollution | 18.12 | 18.12 | 0.45 | 1.28 | 2.04 | 2.04 | 0 / 0 |
| days 20–80 | crime | 18.40 | 18.40 | 0.21 | 1.00 | 1.47 | 1.19 | 0 / 0 |
| days 20–80 | pollution | 11.86 | 11.86 | 0.36 | 1.81 | 3.58 | 3.20 | 2 / 0 |
| days 80–220 | crime | 16.75 | 16.75 | 0.16 | 1.30 | 2.04 | 0.49 | 0 / 0 |
| days 80–220 | pollution | 17.89 | 17.89 | 0.17 | 2.16 | 2.50 | 2.11 | 0 / 0 |
| warm, days 300–420 | crime | 3.83 | 3.83 | 0.05 | 0.31 | 0.50 | 0.50 | 0 / 0 |
| warm, days 300–420 | pollution | 5.14 | 5.14 | 0.08 | 1.28 | 2.09 | 1.28 | 0 / 0 |
| bot256 warm | crime | 3.57 | 3.57 | 0.06 | 0.31 | 0.31 | 0.31 | 0 / 0 |
| bot256 warm | pollution | 10.34 | 10.34 | 0.09 | 1.83 | 1.87 | 1.44 | 0 / 0 |

W p99 ranges over its runs: crime 0.26–0.49, 0.19–0.28, 0.15–0.21, warm 0.04–0.06, bot256 0.05–0.07; pollution 0.44–0.60, 0.27–0.38, 0.15–0.18, warm 0.07–0.08, bot256 0.07–0.09. No W crime or pollution step exceeded 5 ms in any run; the three above 3 ms are a crime building chunk of the first pass after the load (day 18, 4.45 ms, one run) and two single pollution pieces in days 20–80 (airFar's coarse blur 3.20 ms, a stageA chunk 3.58 ms with a GC pause in it). The all-task p99 of W's runs is 1.97, 1.15 and 0.50 ms per window (B 32.8, 29.5, 18.0); its max (13.0, 14.4, 11.1 ms) is utilities' (G4).

**Cost error** (median of estimate / measured − 1, per run; median, range, and B): crime warm −0.03 (−0.14…+0.07; B +0.16), bot256 warm −0.21 (−0.22…−0.10; B +0.02), days 0–20 −0.84, 20–80 −0.39, 80–220 −0.10 (B −0.87, −0.48, +0.06); pollution warm −0.12 (−0.15…−0.09; B +0.16), bot256 warm −0.22 (−0.22…−0.08; B −0.09), days 0–20 −0.83, 20–80 −0.20, 80–220 −0.13 (B −0.85, −0.34, +0.06). The warm gate (±30 %, per task) holds on both fixtures; the cold windows are reported only (§9.5).

**Busy-time-weighted p99 of W** (median over runs): crime 1.26, 1.00, 1.30 ms per window from load, 0.30 warm, 0.27 bot256; pollution 1.28, 1.81, 1.98, 0.50, 1.81.

**The edit and disaster scenario** (dense1m, `--warm 30 --gap 30`; the steps of the 10 days from each edit):

| edit (10 days) | crime B steps | B p99 | B max | W steps | W p99 | W max | pollution B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bld | – | – | – | – | – | – | 6 | 20.69 | 20.69 [22.92] | 518 | 0.07 | 0.32 [1.33] |
| meteor | – | – | – | – | – | – | 5 | 5.08 | 5.08 [5.48] | 594 | 0.18 | 0.62 [1.58] |
| quake | 3 | 3.01 | 3.01 [3.53] | 378 | 0.12 | 0.51 [1.98] | 4 | 3.85 | 3.85 [4.67] | 9 | 0.21 | 0.21 [0.35] |
| road | – | – | – | – | – | – | 4 | 11.56 | 11.56 [12.85] | 716 | 0.44 | 1.32 [1.33] |
| unroad | 3 | 4.62 | 4.62 [5.54] | 444 | 0.12 | 0.20 [0.35] | 4 | 3.04 | 3.04 [4.35] | 767 | 0.09 | 0.31 [0.34] |

(– : no pass of the task in that edit's 10 days.) W's longest steps there: 1.98 ms `spread.blur` (crime, quake + 9 d), 1.58 ms `garbSrc` (meteor + 7 d), 1.33 ms `noise` (bld + 5 d) and `garbApply` (road + 7 d).

**Pieces and cadence** (medians over runs): from load (220 days) crime 10 passes in W (10 in B) in 4,443 pieces (30 steps), 0.49 real ms a day (B 0.52; by window 0.41–1.07, B 0.43–0.88); pollution 17 passes in W (11 in B) in 14,297 pieces (109 steps), 2.06 ms a day (B 1.59; by window 1.69–3.17, B 1.16–3.32). Warm (120 days): crime 6 passes (6), 0.28 real ms a day (0.25); pollution 10 passes (6), 1.41 real ms a day (0.74). At dense1m a crime pass is about 445 pieces and a pollution pass about 840. Pollution runs its full cadence (its 12-day period) in W: its estimates are honest, so the day budget buys it; per pass W spends about 17 real ms (B about 15 ms in 10 steps). G4 sets the final budget (§9.4).

**Per state, before (B) and after (W)** (median over runs of each run's p99 / max; worst run's max in brackets):

| crime, days 0–20 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| sources | 1 | 15.05 | 15.05 [18.24] | 196 | 0.38 | 1.20 [4.45] |
| spread | 1 | 1.64 | 1.64 [3.08] | 68 | 0.56 | 0.56 [1.74] |
| flags | – | – | – | 168 | 0.06 | 0.09 [1.61] |
| pollution, days 0–20 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| garbSrc | 1 | 8.44 | 8.44 [9.67] | 93 | 1.14 | 1.14 [1.60] |
| garbRoute | 1 | 9.40 | 9.40 [12.37] | 168 | 0.45 | 0.49 [0.55] |
| garbApply | 1 | 9.01 | 9.01 [10.64] | 90 | 0.19 | 0.19 [1.20] |
| srcBld | 1 | 18.12 | 18.12 [24.06] | 88 | 1.23 | 1.23 [2.04] |
| srcCells | 1 | 8.07 | 8.07 [10.37] | 20 | 0.74 | 0.74 [1.23] |
| airNear | 1 | 6.47 | 6.47 [11.89] | 68 | 0.17 | 0.17 [0.26] |
| airFar | 1 | 7.26 | 7.26 [8.62] | 49 | 0.06 | 0.06 [0.13] |
| noise | – | – | – | 86 | 0.09 | 0.09 [0.21] |
| water | – | – | – | 90 | 0.26 | 0.26 [0.33] |
| flags | – | – | – | 89 | 0.42 | 0.42 [0.95] |
| crime, days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| sources | 2 | 18.40 | 18.40 [25.19] | 392 | 0.26 | 0.89 [1.47] |
| spread | 2 | 3.05 | 3.05 [4.33] | 136 | 0.07 | 0.09 [0.16] |
| flags | 3 | 4.54 | 4.54 [5.58] | 372 | 0.11 | 0.29 [1.19] |
| pollution, days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| garbSrc | 3 | 5.88 | 5.88 [8.25] | 465 | 0.30 | 0.44 [1.81] |
| garbRoute | 3 | 4.52 | 4.52 [14.11] | 840 | 0.15 | 0.21 [1.52] |
| garbApply | 3 | 9.94 | 9.94 [14.28] | 450 | 0.15 | 0.18 [1.11] |
| srcBld | 3 | 2.45 | 2.45 [26.43] | 440 | 0.57 | 1.41 [3.58] |
| srcCells | 3 | 6.50 | 6.50 [11.11] | 100 | 0.49 | 0.49 [0.72] |
| airNear | 3 | 3.00 | 3.00 [5.66] | 340 | 0.09 | 0.13 [0.17] |
| airFar | 2 | 1.51 | 1.51 [2.66] | 245 | 0.11 | 0.24 [3.20] |
| noise | 3 | 8.19 | 8.19 [9.58] | 406 | 0.10 | 0.21 [1.75] |
| water | 3 | 7.28 | 7.28 [8.01] | 360 | 0.08 | 0.97 [2.14] |
| flags | 3 | 10.10 | 10.10 [11.86] | 356 | 0.12 | 0.19 [2.86] |
| crime, days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| sources | 7 | 16.75 | 16.75 [23.97] | 1375 | 0.19 | 1.30 [2.04] |
| spread | 7 | 2.30 | 2.30 [2.44] | 476 | 0.07 | 0.10 [0.24] |
| flags | 7 | 3.53 | 3.53 [5.41] | 1260 | 0.06 | 0.22 [0.33] |
| pollution, days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| garbSrc | 7 | 5.52 | 5.52 [5.96] | 1023 | 0.17 | 1.53 [2.31] |
| garbRoute | 7 | 8.54 | 8.54 [11.18] | 1848 | 0.07 | 0.26 [2.11] |
| garbApply | 7 | 8.58 | 8.58 [10.08] | 990 | 0.14 | 1.10 [2.16] |
| srcBld | 7 | 17.89 | 17.89 [19.67] | 968 | 0.34 | 1.53 [2.50] |
| srcCells | 7 | 0.94 | 0.94 [1.13] | 220 | 0.10 | 0.18 [0.35] |
| airNear | 7 | 3.01 | 3.01 [3.81] | 748 | 0.08 | 0.15 [0.23] |
| airFar | 8 | 2.22 | 2.22 [2.74] | 539 | 0.09 | 0.25 [1.75] |
| noise | 8 | 3.85 | 3.85 [4.59] | 970 | 0.09 | 0.36 [1.38] |
| water | 8 | 3.27 | 3.27 [3.74] | 1080 | 0.08 | 0.23 [0.31] |
| flags | 7 | 9.00 | 9.00 [14.41] | 1068 | 0.12 | 0.29 [1.31] |

| crime, warm, days 300–420 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| sources | 6 | 3.83 | 3.83 [12.54] | 1181 | 0.06 | 0.31 [0.50] |
| spread | 6 | 2.20 | 2.20 [2.33] | 408 | 0.06 | 0.07 [0.08] |
| flags | 6 | 0.59 | 0.59 [0.63] | 1079 | 0.02 | 0.05 [0.07] |
| pollution, warm, days 300–420 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| garbSrc | 6 | 1.05 | 1.05 [2.86] | 931 | 0.15 | 0.41 [0.50] |
| garbRoute | 6 | 1.17 | 1.17 [1.30] | 1682 | 0.04 | 0.10 [0.10] |
| garbApply | 6 | 1.11 | 1.11 [1.25] | 901 | 0.05 | 0.08 [0.18] |
| srcBld | 6 | 3.30 | 3.30 [18.28] | 881 | 0.07 | 0.10 [2.09] |
| srcCells | 6 | 0.68 | 0.68 [0.98] | 200 | 0.09 | 0.10 [0.13] |
| airNear | 6 | 2.64 | 2.64 [2.92] | 680 | 0.08 | 0.22 [0.32] |
| airFar | 6 | 2.15 | 2.15 [2.43] | 490 | 0.09 | 0.13 [0.38] |
| noise | 6 | 4.02 | 4.02 [5.14] | 860 | 0.08 | 0.20 [0.34] |
| water | 7 | 3.13 | 3.13 [3.20] | 900 | 0.08 | 0.15 [0.36] |
| flags | 6 | 1.26 | 1.26 [1.38] | 863 | 0.06 | 0.28 [1.28] |

| crime, bot256 warm | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| sources | 6 | 2.75 | 2.75 [3.57] | 948 | 0.06 | 0.28 [0.31] |
| spread | 6 | 1.71 | 1.71 [2.46] | 408 | 0.07 | 0.11 [0.31] |
| flags | 6 | 0.62 | 0.62 [3.70] | 858 | 0.02 | 0.13 [0.16] |
| pollution, bot256 warm | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| garbSrc | 7 | 1.18 | 1.18 [1.52] | 740 | 0.18 | 1.44 [1.87] |
| garbRoute | 6 | 0.98 | 0.98 [1.33] | 1310 | 0.05 | 0.17 [0.22] |
| garbApply | 6 | 10.34 | 10.34 [12.69] | 699 | 0.06 | 0.19 [1.83] |
| srcBld | 6 | 2.54 | 2.54 [2.67] | 630 | 0.07 | 0.13 [0.18] |
| srcCells | 6 | 1.67 | 1.67 [2.95] | 428 | 0.12 | 0.18 [0.18] |
| airNear | 7 | 1.68 | 1.68 [2.75] | 612 | 0.08 | 0.16 [0.16] |
| airFar | 7 | 1.41 | 1.41 [2.38] | 441 | 0.09 | 0.10 [1.16] |
| noise | 7 | 3.40 | 3.40 [4.37] | 1046 | 0.08 | 0.53 [0.69] |
| water | 7 | 2.36 | 2.36 [3.68] | 1251 | 0.07 | 0.14 [0.29] |
| flags | 7 | 1.41 | 1.41 [1.71] | 713 | 0.14 | 0.26 [0.29] |

**The largest items** (review 2 item 5f; the max over all W runs of each piece kind from load, steps that overlap a GC pause left out):

| label | 0–20 | 20–80 | 80–220 |
|---|---|---|---|
| crime `sources.bld` | 4.45 | 0.89 | 0.49 |
| crime `spread.blur` | 1.74 | 0.14 | 0.12 |
| pollution `srcBld.bld` | 2.04 | 2.13 | 0.86 |
| pollution `airFar.blur` | 0.03 | 3.20 | 0.12 |
| pollution `flags.events` | 0.14 | 2.86 | 0.14 |
| pollution `water.up` | 0.07 | 2.14 | 0.24 |
| pollution `garbRoute.scat` | 0.06 | 1.18 | 2.11 |
| pollution `garbApply.left` | 0.06 | 0.09 | 1.97 |
| pollution `garbSrc.start` (the day's first `buildingList` rebuild) | 1.60 | 0.60 | 0.44 |
| pollution `garbSrc.plan` | 1.41 | 0.13 | 0.33 |
| pollution `srcCells.cells` | 1.23 | 0.72 | 0.35 |

The indivisible items stay small (all W runs, no GC): the snapshot take (`sources.snap` / `garbSrc.snap`, one `buildingList` + copy) at most 0.70 ms, traffic's attachment refresh in its own pollution piece (`srcCells.attach`) 0.18 ms (1.5 ms in the first formal hold, under load), the publish pieces (`garbSrc.end`, `garbApply.publish`, `flags.publish`) at most 0.16 ms, the landfill fill + display (`garbApply.lf`) 0.06 ms at dense1m; the water-list rebuild pieces at most 0.10 ms.

**The bot** (128 × 15, seed 7, `tools/balance-json.ts`, W `2fc45f0`): 2015 population 194,947, approval 80.5, `totalMsPerDay` 7.10. B1's reference is 196,101; G1 gave 193,525, G2 193,577. The results move by design through the schedule (the headless schedule follows the estimates); G4 records the new hashes.

### 17.5 Notes for G4

- **The field-program pattern** (pollution) fits any stage whose work is a fixed sequence of cell loops and kernel calls: ops with a unit count and a µs per unit, a piece running ops while its sizing fits, `cost()` walking the same ranges. Utilities' fills, labels and result writes could reuse it.
- **A quarter of `INFRA_PIECE_COLD_MS` for the rarest passes.** Crime (every 20 days) and pollution's cell work ran their first passes after a load at 150–300 ns per cell: at half the cold budget their pieces reached 3–5 ms. Utilities' passes are frequent (every few days); emergency response's 90-day period is rarer than crime's.
- **Keep sizing and estimate apart** (as G2): the chunk plans have their own constants (`CR_PLAN_*`, `PLAN_*`), so the refit moved no boundary; check it by the atomic passdigest's step counts.
- **The frozen originals** (`crimeOriginal.ts`, `pollutionOriginal.ts`) keep the WASM field-pass sections and blurSim running; the bench tools that install field passes into a live `PollutionSystem` (`tools/bench/fieldPasses/insitu.ts`, `capture.ts`) need them too.
- **Tools** (in `scratchpad/b2work/G3-crime-pollution/`): `cpumapE.ts`, `editmapE.ts` (G2's, rebundled), `passdigestE.ts` (+ the pollution / crime internals), `genfxE.ts` (env cities from B's code), `anE.py` (windows, tables, cost error, busy p99, cadence, per label), `formal2.sh` (the formal hold).

## 18. G4 as built (`G4-utilities-emergency-recalibration`, Nov 3)

**Commits** (branch `b2-step-split`, on G3's `e5a1e81`): `618f15c` utilities in pieces (the frozen `utilitiesOriginal.ts`, the j10 adaptation), `a34b5d2` the emergency response in pieces (the frozen `emergencyOriginal.ts`, the `respCost` loop over the sub-states), `dc6b826` `tests/infra/b2PiecesInfra.test.ts` and `tests/infra/infraCity.ts`, `ee298e9` the chunk sizes apart from the estimates, the warm refit, the treatment scan by building ranges, `be73ef4` the step guard 256 → 4096, the final day budget (5.3), P0-15, `99690b9` the bot's new hashes (the `b2` rows) with this document's first G4 sections, `0f51b6d` a second utilities refit and `1983efe` its revert (18.2), `0bd0337` / `d409f1a` this document's measurements and the report, `d8fd0b9` the sea mask in pieces and `180f8a6` its rebuild's cold sizing (18.2; found by the locked edit scenario), `d8f4669` the `b2` rows re-recorded at `180f8a6`, `09b55fd` the labels sized for cold code, `2d2940a` the final day budget 4.6 (18.5), `2db4097` the `b2` rows at the final code, then this document. `npx tsc --noEmit` clean; the full `npx vitest run` at the final code (`2d2940a`; 2 workers, low priority, outside the timing lock: the lock queue held other workers' runs for most of the afternoon): 139 files passed, 1 skipped (1,429 tests passed, 18 skipped), no unhandled errors (at `be73ef4`: 138 files, 1,418 tests).

### 18.1 Review items applied

| item | where |
|---|---|
| review 1 R4d (the Powered / Watered flags in one piece) | the finish's chunks collect candidates (snapshot index + the wanted bits); one piece applies them in snapshot order; the cooling-water result and the cut tally run in the chunks (§7 as built) |
| review 1 R6 (proof against today's code) | `tests/sim/exact/utilitiesOriginal.ts`, `emergencyOriginal.ts` (41ae570, frozen): b2PiecesInfra compares every original field at every pass / sequence end, at production and random piece sizes, across network, building, bridge, plopped, power-line, zone, funding, occupancy, plant, station and traffic edits, also with a road edit right before U_WATER (pre-B2's mid-pass water relabel) and a graph change in the middle of a sequence (the epoch restart); `passdigest --mode atomic` B vs W on dense1m, bot256 and five cities generated with B's code (`util96_s7_island`, `util128_s11_short`, `util64_s5_ok`, `emerg128_s7`, `emerg96_s11`), each with and without WP1 (18.3) |
| review 1 R7a (j10) | §11.5: compared at day ends (= pass ends on its tiny cities) and at state transitions; the edge test edits between whole passes |
| review 1 R8 (other code of the same city between pieces) | b2PiecesInfra "R8": utilities `gridInfo`, `waterInfo`, `waterQualityAt`, `plantLoad`, `producerInfo`, traffic `findPath` and `stopAttached` / `freightRailCells` with the attachment forced dirty, pollution `garbageInfo` / `incineratorShare`, services `needRaster`, an emergency `probe` after every utilities piece; emergency `probe` (dispatch searches, which run the lazy station / graph / siren refreshes themselves), `stationList`, traffic `findPath` after every response piece: same results as without them |
| review 1 R9 | utilities: a save in the middle of a pass holds no pass state, loads idle, loads the same twice; emergency: the saved key set is unchanged mid-sequence, a load starts idle (`p.resp` as pre-B2) |
| review 1 O3, O4, O5, O8, O9 | `stepCost` / `respCost` read cursors and sizes only (O(1)); utilities "O4" (the piece sequence and the digests with frames active and headless); `withPieceScale`, seeded random scales; `stepIdx < 0` resets every utilities cursor, `init()` and the epoch restart reset every response cursor (`resetRespPieces`); the test passes assert their end |
| review 2 item 1 (cold sizes) | utilities at half `INFRA_PIECE_COLD_MS`, the response sequence at a quarter, both with the cold cell and Building floors; the code that runs rarely (a full relabel, the sea mask's rebuild) sized for its interpreted speed (18.2) |
| review 2 item 3 (windows from load; edits) | measured `--warm 0 --days 220` per window and the edit and disaster scenario (18.4) |
| review 2 item 4 (warm cost error) | the warm refit (`ee298e9`); the cost error per task on the warm windows (18.4) |
| review 2 item 5c (ES0) | the start in pieces: the moved graph's signature by node ranges (cached for `ensureGraph`), the station scan, the siren times into a private buffer (§8 as built) |
| review 2 item 5d (flags) | the apply piece has its own coefficient (`UT.apply`) and was measured (18.4); not chunked |
| review 2 item 5f (largest items) | 18.4 |
| review 2 optional (derive `STEP_GUARD`) | 4096 (18.2) |

Not applied: R1–R5 (traffic / services / pollution, G1–G3), O10 / O11 (no utilities or emergency part), review 2 item 2 (the Building-shape fix is outside B2's files; §14 item 4).

### 18.2 Deviations from §7–§9, and why

- **`STEP_GUARD` 256 → 4096** (§2.1 said 256). At 256, the ~470 pieces of a dense1m utilities pass ended 72 of 100 days after ~3 of the 5.3 estimated ms (the guard, not the budget, decided the day), and an urgent pass needed two days. 4096 pieces of the smallest estimate are above a day's budget, so the budgets bind.
- **`INFRA_DAY_BUDGET` 4.6, `INFRA_DAY_CARRY` 0.87, `CREDIT_FLOOR` 5.75** (§9.4 item 2 asked for W's real infra ms per day to match B's; G1's provisional values were 5.3 / 1.0 / 6.5). The match needs about 3.0–3.2 with B2's estimates, and at 3.2 the services pass, the largest, ran 0–1 times in 120 days (B: 3). G4 first kept 5.3, the only value that kept every task at B's cadence; but the balance's `totalMsPerDay` then ran +2.5 to +3.4 over B on seed 7 in three side-by-side measurements, two above the gate's +3. Under one timing-lock hold (B and W at 5.3 / 4.6 / 4.2 side by side) 4.6 gave +1.42 with every seed-7 gate passed, 4.2 +1.04 with the population at 0.84 × B1 (a fail). At 4.6 every task runs at B's cadence or above per 360 days but dense1m's traffic, 10 cycles instead of 13: the slower traffic §9.4 item 4 expected (18.5). The carry and the floor scale with the budget (× 1.44 of pre-B2's 0.6 / 4).
- **The labels are sized for cold code** (`09b55fd`: `US.label` 0.007 → 0.035 µs per unit, ~1,860 units per piece). Every hold showed a full relabel's first pieces (days 24 and 48 after a load) at 1.3–2.4 ms, 20–30 × their estimate, until the JIT caught up after five or six pieces; the estimate stays the warm one.
- **ES0's last part is folded into the siren times' last piece**, and the moved graph's signature is cached by graph object and version instead of being an `ensureGraph` sub-step; `ensureGraph`, `refreshStations` and `ensureTimes` keep their synchronous code for dispatch.
- **The sea mask runs in pieces of its own, taken unconditionally** (`terrainMasks.SeaMaskRun`, `d8fd0b9` / `180f8a6`; `terrainMasks.ts` is outside §7's file list), and the jobs check sits in the snapshot piece (a pure early-exit function; §7 as built). The locked edit scenario showed `uses.sea` at 12.2–12.6 ms after the meteor: the water layer changed, the masks' checksum missed and terrainMasks rebuilt them (the distance BFS, the water components) in one call. SeaMaskRun runs `build()`'s loops in its order: the checksum by cell ranges against the cache (a hit returns the cached mask, as `masks()`), on a miss a private copy of the water layer (one piece), the shore scan (fused with the copy's checksum), the depth BFS, the all-water fix-up, the components and the sea marking, then the result goes into the cache as `build()` would put it (unless another caller replaced the entry meanwhile). With nothing in between it returns exactly `seaMask(st)` and leaves the same cache; a water edit between two pieces of a rebuild gives the masks of the water at the copy, and the next pass's checksum misses. The checksum keeps the cell floor (it runs every pass); the rebuild runs once per water edit, cold (interpreted at first: 0.03–0.09 µs per unit at dense1m, a 16k-cell scan piece took 1.5 ms), so it has its own size (`US.seaBuild` 0.05 µs per unit, ~1,300 units per piece) and estimate (0.03 µs per unit, the copy 0.003 µs per cell).
- **The treatment prefix scan runs by building ranges** at half the Building floor (it reads a DefInfo and two fields), not by plan chunks; at a quarter its first pieces after a load ran at ~3 µs per building (4.1 ms).
- **Sums are published by `.set()` of `[0, nc)`, not by a swap**, so the arrays' tails stay exactly pre-B2's (the frozen-original comparison is field by field).
- **The pre-B2 `EMERG_*` chunk and cost params stay** in params.ts for the frozen original and the search bench.
- **A separate test file**, `tests/infra/b2PiecesInfra.test.ts`, on the G1 harness. j10 keeps its own frozen utilities (614609f, J10's reference); b2PiecesInfra uses `utilitiesOriginal.ts` (41ae570).
- **The second utilities refit was reverted** (`0f51b6d`, reverted in `1983efe`). It divided the building chunks' coefficients by 1.18 to centre dense1m (+0.39) and bot256 (−0.02); the bot's 256 × 60 seed-7 run then fell to 0.887 × B1 in 2007 (the gate is ≥ 0.9; min funds 4,333, y15 174,576, y60 1,441,916), while `be73ef4`'s coefficients pass every balance gate. The bot's chaos (a schedule change moves it by ±10 %), but the reverted refit is not used. The recorded b2 rows and the gates are those of the final code (`2d2940a`: the sea mask's pieces, the labels' cold size and the day budget moved the schedule again after the refit; 18.6).

### 18.3 Exactness evidence

- `tests/infra/b2PiecesInfra.test.ts` (21 tests): utilities passes (util cities 48 without a short grid, 64 with short main grids, 96 with a short island grid; infra only and every system) in one go = production = tiny / random pieces at every pass end; production and random pieces = the frozen original in every original field, also with the mid-pass water relabel; the edits reach every branch (both labels, the relabel of a soft pass, both brownouts, the results without one, the mid-pass water relabel, flag flips); R8, R7, R9, O4, two cities interleaved, piece estimates within budget. The emergency response likewise (emergency cities 64 and 96): one go = pieces = the frozen original, also with a graph change mid-sequence; every branch (signature pieces, the epoch restart, the same graph rebuilt, the station scan, the siren times, every state); R8, R7 / R9, estimates.
- `tests/infra/seaMaskRun.test.ts` (11 tests): SeaMaskRun = `seaMask` (the sea mask, the shore cells, the depth, the sea cell count and the cache entry) at piece sizes 1 to 10⁹ and random ones, on generated coast / islands / river / lakes terrains and synthetic water layers (none, all water, noise, a sea and a lake); the cache hit; a water edit after a rebuild and in the middle of one; another caller's rebuild in the middle of one. b2PiecesInfra adds water edits before every pass (against the frozen original, at random piece sizes), the rebuild branch and its pieces' estimates.
- `tests/sim/exact/j10.test.ts`: the split UtilitiesSystem against J10's frozen one over 10,240 city-days with edits, loads and new cities, and 32 edge cities (sparse ids, > 256 grids, special floats) pass by pass.
- `passdigest --mode atomic` (`b2work/G4-utilities-emergency-recalibration/passdigestG4.ts`: G3's digests + the utilities internals — labels, sums, per-id results, producers, loads, the cut tally — and the response internals — slacks, siren times, stations, the graph signature), B vs W at `dc6b826`, at `0f51b6d`, at `d8fd0b9`, at `180f8a6` and at the final `2d2940a` (`runs/pd6`; the atomic mode flushes every pass, so it does not depend on the estimates), digests at days 30 and 100: dense1m, bot256 and the five synthetic cities, each with and without WP1. All 24 checkpoints identical every time. The step counts differ by design: at dense1m by day 100, utilities 154 steps in B and 24,116 pieces in W, emergency 6 and 252.

### 18.4 Measurements (dense1m, headless, wall clock)

Tools: `b2work/G4-utilities-emergency-recalibration/cpumapG4.ts` (G3's cpumap; utilities and the emergency response labelled by `stepName` in W, by state in B), `--noinputs`; `editmapG4.ts` (the edit and disaster scenario: a road cut, its restore, a bulldoze, an earthquake and a meteor, 30 days apart from day 30 after the load; it records no GC); `anG4.py`, `docG4.py`, `cadG4.py`. **Hold 6, at the final code (`2d2940a`)**: one timing-lock hold (`timedG4.py` polling the lock every 1 s; 123 s; other processes averaged 0.10 cores, peak 0.58), B and W interleaved, B first on odd pairs: from load (`--warm 0 --days 220`) 3 runs per side, the edit scenario 2 per side, warm (`--warm 300 --days 120`) 2 per side on dense1m and bot256 (`runs/h6`). Per run, the p99 and the max of the task's steps; the median over runs, the worst run's max in brackets. Holds 1 and 3–5 measured the intermediate commits the same way (`runs/h1`, `h3`–`h5`); hold 1 (`be73ef4`, 3 runs per side) gave W utilities p99 0.27 / 0.14 / 0.12 ms and max 1.05 / 2.11 / 1.54 ms per window from load (worst runs 3.97 / 4.34 / 2.23), the emergency response p99 0.51 / 0.19 and max 0.55 / 0.27.

**Utilities, the emergency response and all tasks** (ms; B = before, W = after):

| window | task | B p99 | B max [worst run] | W p99 | W max [worst run] | W max without GC, worst run | W steps > 3 / > 5 ms (all runs) |
|---|---|---|---|---|---|---|---|
| days 0–20 | utilities | 12.16 | 12.16 [12.48] | 0.26 | 2.03 [10.01] | 10.01 | 1 / 1 |
| days 0–20 | all tasks | 47.13 | 47.13 [47.41] | 1.00 | 3.46 [10.01] | 10.01 | 12 / 4 |
| days 20–80 | utilities | 10.24 | 10.24 [13.55] | 0.24 | 4.13 [5.10] | 5.10 | 3 / 1 |
| days 20–80 | emergency | 8.36 | 8.36 [13.40] | 0.52 | 2.68 [2.77] | 0.94 | 0 / 0 |
| days 20–80 | all tasks | 27.79 | 29.78 [34.44] | 0.54 | 4.79 [5.10] | 5.10 | 8 / 1 |
| days 80–220 | utilities | 12.62 | 12.62 [19.04] | 0.07 | 1.41 [2.41] | 2.41 | 0 / 0 |
| days 80–220 | emergency | 9.24 | 9.24 [13.20] | 0.15 | 0.18 [0.20] | 0.20 | 0 / 0 |
| days 80–220 | all tasks | 16.47 | 26.84 [30.70] | 0.25 | 5.66 [6.13] | 2.68 | 5 / 2 |
| edit scenario | utilities | 13.80 | 13.80 [16.21] | 0.18 | 1.79 [2.26] | (no GC record) | 0 / 0 |
| edit scenario | emergency | 10.95 | 10.95 [11.37] | 0.41 | 3.76 [5.71] | (no GC record) | 1 / 1 |
| edit scenario | all tasks | 23.48 | 28.64 [29.00] | 0.41 | 5.15 [5.89] | (no GC record) | 7 / 2 |
| warm dense1m | utilities | 2.56 | 2.56 [3.12] | 0.05 | 1.66 [2.64] | 0.68 | 0 / 0 |
| warm dense1m | emergency | 1.39 | 1.39 [1.47] | 0.11 | 0.26 [0.38] | 0.38 | 0 / 0 |
| warm dense1m | all tasks | 10.49 | 15.26 [25.01] | 0.18 | 2.64 [2.64] | 2.63 | 0 / 0 |
| warm bot256 | utilities | 4.18 | 4.18 [5.05] | 0.12 | 1.00 [1.48] | 0.51 | 0 / 0 |
| warm bot256 | emergency | 1.55 | 1.55 [1.60] | 0.11 | 0.99 [1.88] | 1.88 | 0 / 0 |
| warm bot256 | all tasks | 4.12 | 6.68 [8.31] | 0.21 | 3.00 [3.19] | 3.19 | 1 / 0 |

(No response sequence falls in days 0–20: the first one after the load is on day ~75, `p.resp`.) Per run, the all-task max without GC from load is 3.46, 10.01, 3.41 ms (days 0–20), 4.10, 5.10, 4.79 (20–80) and 2.41, 1.63, 2.68 (80–220); the busy-time-weighted p99 (review 2's optional metric: the step length below which 99 % of the infra time falls) 3.35, 10.01, 2.82 / 4.10, 3.29, 3.35 / 1.89, 2.17, 2.68 ms (B 31.7–47.4 / 22.7–34.4 / 19.7–30.7).

**W's G4 steps above 3 ms** (hold 6, all runs):
- `water.bld#62` 10.01 ms, day 11 of run 2, no GC: inside a 50 ms stretch in which three pollution `srcBld.bld` pieces also ran 5.0–8.5 ms (they take ≤ 0.6 ms in the other runs; that day's infra time was 65 ms against 24 in run 1). A stall of the process, not the piece's work.
- `uses.bld` 4.10 ms (day 23, run 1) and 5.10 / 2.96 ms (day 22, run 2), no GC: the Building-shape deopt wave around day 21 (review 2 item 2: the field-constness flips of the first growth writes). Two runs of holds 3–5 had `uses.bld` at 2.1–2.7 ms on day 21. The fix is outside B2's files (§14 item 4).
- `water.sum#15` 4.13 ms with a 3.8 ms GC pause inside.
- The response's first `resp3.rows` piece of one edit-scenario sequence, 5.71 ms (17 days after the road restore; the sequence's other rows pieces took 0.4–0.5 ms; editmap records no GC). From load, `resp3.rows` reached 2.68–2.77 ms with a GC pause inside and 0.59 ms without.

**Per state, before (B) and after (W)** (hold 6; median over runs of each run's p99 / max; worst run's max in brackets):

| utilities, days 0–20 | B steps | B p99 | B max | W steps | W p99 | W max |
|---|---|---|---|---|---|---|
| uses | 5 | 10.83 | 10.83 [12.48] | 713 | 0.38 | 1.15 [2.22] |
| power | 4 | 9.79 | 9.79 [10.30] | 978 | 0.12 | 2.03 [2.21] |
| water | 4 | 11.84 | 11.84 [12.16] | 1292 | 0.12 | 0.73 [10.01] |
| utilities, days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
| uses | 10 | 7.39 | 7.39 [7.86] | 1428 | 0.29 | 4.10 [5.10] |
| label | 3 | 9.36 | 9.36 [13.55] | 204 | 0.35 | 0.57 [0.60] |
| power | 11 | 2.60 | 2.60 [10.37] | 1960 | 0.08 | 0.42 [0.78] |
| water | 11 | 10.24 | 10.24 [13.49] | 3052 | 0.07 | 0.44 [4.13] |
| utilities, days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
| uses | 26 | 10.51 | 10.51 [11.76] | 3774 | 0.21 | 0.70 [1.05] |
| label | 5 | 1.60 | 1.60 [1.98] | 340 | 0.05 | 0.09 [0.12] |
| power | 26 | 8.67 | 8.67 [9.62] | 5180 | 0.06 | 0.22 [0.34] |
| water | 26 | 12.62 | 12.62 [19.04] | 7659 | 0.06 | 1.41 [2.41] |
| emergency.response, days 20–80 | B steps | B p99 | B max | W steps | W p99 | W max |
| resp0 | 1 | 5.44 | 5.44 [6.34] | 41 | 0.40 | 0.40 [0.49] |
| resp1 | 1 | 2.34 | 2.34 [2.34] | 40 | 0.41 | 0.41 [0.59] |
| resp2 | 1 | 2.47 | 2.47 [3.71] | 40 | 0.35 | 0.35 [0.50] |
| resp3 | 1 | 8.36 | 8.36 [13.40] | 24 | 2.68 | 2.68 [2.77] |
| resp4 | 1 | 7.71 | 7.71 [9.83] | 107 | 0.32 | 0.33 [0.94] |
| emergency.response, days 80–220 | B steps | B p99 | B max | W steps | W p99 | W max |
| resp0 | 1 | 1.87 | 1.87 [5.04] | 41 | 0.08 | 0.08 [0.08] |
| resp1 | 1 | 1.43 | 1.43 [2.29] | 40 | 0.11 | 0.11 [0.13] |
| resp2 | 1 | 1.29 | 1.29 [1.81] | 40 | 0.13 | 0.13 [0.14] |
| resp3 | 1 | 9.24 | 9.24 [13.20] | 24 | 0.07 | 0.07 [0.10] |
| resp4 | 3 | 1.25 | 1.25 [1.35] | 107 | 0.16 | 0.18 [0.20] |

(The days 20–80 resp3 row is one 24-piece state per run: its p99 is its max, 2.68–2.77 ms with a GC pause inside.)

**The edit scenario** (the max after each edit, worst run, W [B]): utilities road cut 1.39 [16.21], restore 0.70 [13.19], bulldoze 2.26 [2.68], quake 0.44 [1.92], meteor 0.75 [13.43]; the emergency response restore 5.71 [10.52] (the `resp3.rows` piece above), bulldoze – [11.37], quake 0.34 [–]; all tasks 3.58 [28.37], 5.71 [19.77], 2.54 [29.00], 1.94 [25.83], 5.89 [28.28] (W's top: traffic `inbound.0` 5.89 and 4.40 ms five days after the meteor, `resp3.rows` 5.71, pollution `srcBld.bld` 3.58, crime `sources.bld` 3.50, traffic `commute.end10` 3.45). The meteor's sea-mask rebuild, 12.2–12.6 ms in one piece in hold 4, now runs as 195 pieces of at most 0.38 ms (`uses.sea`).

**The largest items** (review 2 item 5f; hold 6, the max over the W runs from load of each piece kind, GC-overlapping steps left out; days 0–20 / 20–80 / 80–220): `water.bld` 10.01 (the stall above) / 0.35 / 0.22, `uses.bld` 2.22 / 5.10 / 1.05, `water.sum` 0.67 / 0.21 / 2.41, `power.zoned` 2.21 / 0.42 / 0.34, `power.bld` 2.03 / 0.78 / 0.22, `uses.scan` (the treatment scan, now half the pieces) 1.15 / 0.13 / 0.44, `uses.snap` (one `buildingList` + its copy, indivisible) 1.13 / 0.51 / 0.42, `power.cells` 0.87 / 0.26 / 0.21, `uses.plan` 0.76 / 0.20 / 0.48, `water.flags` 0.73 / 0.31 / 0.35, `uses.sea` (the masks' checksum) 0.67 / 0.43 / 0.11, `label.plabel` – / 0.60 / 0.12 (holds 1–5 at the warm label size: 1.3–5.1 ms on days 24 and 48), the flags' publish (`water.apply`) at most 0.04 warm; emergency `resp4.bld` 0.94 / 0.20, `resp*.slack` 0.59 / 0.05, `resp3.rows` 0.59 / 0.10, `resp*.start` 0.35 / 0.14, `resp*.run` 0.17 / 0.13, `resp0.stations` 0.08 / 0.03. The station scan and the siren times did not run inside a response piece in these windows (dailyWork refreshes them first); the b2PiecesInfra estimate test bounds them.

**Cost error** (median of estimate / measured − 1 per run; median and range over runs). Warm, at the final code (hold 6, 2 runs per fixture): dense1m pooled over every task **+0.14** (+0.12…+0.15), bot256 **−0.06** (−0.08…−0.05); per task, dense1m / bot256: utilities +0.42 / −0.06, emergency +0.24 / +0.17, traffic +0.04 / +0.17, pollution −0.06 / −0.12, services −0.01 / 0.00, crime +0.01 / −0.13 (B: pooled −0.00 / −0.05; traffic −0.39 / −0.06, crime +0.33 / −0.02). From load (hold 6): pooled −0.18, +0.01, +0.11 per window (B −0.75, −0.35, −0.21); utilities +0.17, +0.29, +0.39 (B −0.32, −0.09, +0.11); emergency −0.18 (days 20–80), +0.08 (80–220) (B −0.75, −0.26). At the refit (`be73ef4`, hold 2) the warm values were +0.13 / −0.02 pooled, utilities +0.39 / −0.02; before it (hold 1) utilities +0.69 / +0.15, emergency −0.12 / +0.12. Utilities on dense1m is the one per-task median outside ±30 % warm: its building chunks run at 3–10 µs warm there (timer and per-piece noise of the same size; two holds differed by ±30 % per label), and the centring refit that fixed it (`0f51b6d`, chunks / 1.18) moved the chaotic bot below the 0.9 population gate in one year, so it was reverted (18.2).

**Cadence at the final code** (hold 6, `cadG4.py`; passes per 120 warm days, deterministic; real infra ms per day, median of 2 runs): dense1m B 4.22 ms / day, traffic 5 cycles, services 3, utilities 21, pollution 6, crime 6, emergency 1; W 5.30 ms / day (1.26 × B), 3, 3, 30, 10, 6, 1. bot256 B 3.90, 7, 3, 16, 7, 6, 1; W 5.61 (1.44 ×), 7, 6, 27, 9, 6, 1. From load (220 days, 3 runs): B 9.47, W 10.09 ms / day (1.07 ×). The per-360-day counts are in 18.5.

### 18.5 The day budget and the cadence (§9.4)

Tool: `cadG4.py` over the cpumap summaries and step logs (real infra ms per day = the sum of the measured step times over
the days; the pass counts are deterministic headless, the real times need the timing lock).

**The search** (at `be73ef4`'s estimates). Hold 1 (budget 5.3, other processes 0.08 cores): B and W, 3 runs each; hold 2
(budget 5.3, 4.2 and 3.2 with the carry and the credit floor scaled as 0.6 / 4 × budget / 3.2): W 2 runs per budget and
fixture, B one (other processes 0.38 cores: noisier). Warm windows (`--warm 300 --days 120`); passes per 120 days,
medians over runs.

| fixture, side | real infra ms / day | est ms / day | traffic cycles | services | utilities | pollution | crime | emergency |
|---|---|---|---|---|---|---|---|---|
| dense1m B (hold 1 / hold 2) | 4.76 / 4.23 | 3.31 | 5 | 3 | 21 | 6 | 6 | 1 |
| dense1m W 5.3 (hold 1 / hold 2) | 8.04 / 7.97 | 5.91 / 5.72 | 5 | 5 / 4 | 30 / 36 | 10 | 6 | 1 |
| dense1m W 4.2 | 5.31 | 4.71 | 3 | 4 | 25 | 9 | 6 | 1 |
| dense1m W 3.2 | 3.73 | 3.42 | 3 | 1 | 24 | 9 | 6 | 1 |
| bot256 B (hold 1 / hold 2) | 4.02 / 4.59 | 3.33 | 7 | 3 | 16 | 7 | 6 | 1 |
| bot256 W 5.3 (hold 1 / hold 2) | 6.60 / 6.06 | 5.42 / 5.55 | 9 / 8 | 6 / 7 | 33 / 31 | 10 | 6 | 1 |
| bot256 W 4.2 | 5.60 | 4.50 | 7 | 5 | 24 | 9 | 6 | 1 |
| bot256 W 3.2 | 3.93 | 3.27 | 6 | 0 | 22 | 7 | 6 | 1 |

- **Why W needs more real time for the same cadence.** Per pass W costs about B's (utilities 4.5 vs 4.6 ms, pollution
  16.6 vs 16 ms, services 57 vs 44 ms), but a dense1m traffic cycle costs about 70 ms against B's 41: G1's pieces. And
  the estimates are per-piece medians: summed, W's real time is 1.36 × its estimates at dense1m and 1.22 × at bot256
  (traffic 2.0 ×: its cold tail), so the real-time match of §9.4 item 2 needs a budget of about 3.0–3.2. At 3.2 the
  services pass (the largest, ~60 estimated ms at dense1m) runs 0–1 times in 120 days.

**The choice** (at `09b55fd`, the final pieces). The balance's `totalMsPerDay` on seed 7 at 5.3 ran +2.65 (`be73ef4`),
+3.24 (`d8fd0b9`), +3.36 (`180f8a6`; all three B and W side by side outside the lock) and +3.39 (`180f8a6`, the same
under the timing lock) over B: at or over the gate's +3. One timing-lock hold then ran 256 × 60 seed 7 for B and W at
5.3, 4.6 and 4.2 side by side (four processes; other processes 0.02 cores):

| budget (carry, floor) | `totalMsPerDay` W − B (B 10.42) | pop year 15 / 60 | lowest W / B ratio | approval from y30 | EQ y30 | lowest funds | |
|---|---|---|---|---|---|---|---|
| 5.3 (1.0, 6.5) | +2.46 | 178,834 / 1,525,902 | 0.937 | 79.8 | 120.9 | 6,236 | passes this time |
| **4.6 (0.87, 5.75)** | **+1.42** | 184,844 / 1,552,965 | 1.001 | 79.7 | 121.6 | 9,185 | passes |
| 4.2 (0.79, 5.25) | +1.04 | 181,201 / 1,283,089 | **0.838** | 78.4 | 119.9 | 3,885 | fails (population) |

Passes per 360 days (`--warm 300 --days 360`, one run each: the counts are deterministic; the real ms per day of these
runs, two at a time outside the lock, are indicative only):

| fixture, side | traffic cycles | services | utilities | pollution | crime | emergency | real infra ms / day |
|---|---|---|---|---|---|---|---|
| dense1m B | 13 | 8 | 56 | 16 | 18 | 4 | 4.73 |
| dense1m W 5.3 | 13 | 14 | 106 | 30 | 18 | 4 | 7.86 |
| dense1m W **4.6** | **10** | 11 | 86 | 29 | 18 | 4 | 7.22 |
| bot256 B | 21 | 19 | 47 | 19 | 18 | 4 | 5.74 |
| bot256 W 5.3 | 26 | 22 | 92 | 29 | 17 | 4 | 7.93 |
| bot256 W **4.6** | 23 | 19 | 81 | 28 | 18 | 6 | 6.59 |

- **The final values: 4.6 / 0.87 / 5.75** (× 1.44 of pre-B2's 3.2 / 0.6 / 4; `2d2940a`). Every task runs at B's
  cadence or above but dense1m's traffic: 36 days per cycle instead of 28, the slower traffic §9.4 item 4 expected (34
  instead of 25.7) — honest fairness hands out equal real time, and traffic's pieces cost more real time per cycle than
  B's steps (about 70 against 41 ms at dense1m). Utilities and pollution still run about 1.5–1.9 × as often as in B
  (their passes end within a day, so the next one comes sooner; pollution keeps its 12-day period). `INFRA_TASK_WEIGHT`
  was not needed (no balance failure from a cadence shift, 18.6).
- **P0-15** (the stress city's utilisation): 0.996 at 5.3 with the new step guard, 0.994 at 4.6; re-baselined to ≤ 1.02
  (§11.5).

### 18.6 The balance procedure and the bot (SIM_DEPTH_SPEC)

Tool: `b2work/G4-utilities-emergency-recalibration/balanceG4.ts` (tools/balance-json.ts + the bot printout's tourists
column, B1's tourism check), bundled in B (41ae570, B1's code) and in W (the final `2d2940a`); B and W side by side. The
rows are deterministic (B reproduces every b1 row: 256 × 60 s7 2015 183,671, s11 181,028, 128 × 15 s7 2015 196,101, and
B1's five extra 128 seeds); `totalMsPerDay` is only comparable B against W of the same session. Seed 7 is the run of
the timing-lock hold that chose the budget (18.5; four processes side by side, the same code as `2d2940a`); seed 11 and
the 128 × 15 runs ran B and W side by side outside the lock (nice 19, load 5–7). `balcmp.py` gives the gates. The bot is
chaotic (any schedule change moves it): during G4 seed 7's lowest ratio went 0.983 (`be73ef4`), 0.964 (`d8fd0b9` /
`180f8a6`), 1.001 (final); seed 11's 0.938, 0.889, 0.955.

| gate (256 × 60 seed 7 unless named) | B (b1) | W (b2, `2d2940a`) | |
|---|---|---|---|
| pop at year 15 ≥ 150k | 183,671 | 184,844 | pass |
| pop at year 60 ≥ 950k | 1,527,090 | 1,552,965 | pass |
| lowest W / B pop ratio ≥ 0.9 | — | 1.001 (2008) | pass |
| lowest approval from year 30 ≥ 50 | 79.5 | 79.7 | pass |
| EQ ≥ 100 by year 30 | 121.6 (first 2017) | 121.6 (first 2019) | pass |
| lowest funds ≥ 0 | 6,994 | 9,185 | pass |
| tourism jobs within ±30 % | — | single years 0.46–1.44 (9 of 55 outside: 2006–07, 2010–12, 2015–18), geometric mean 0.877; across six 128 × 15 seeds the year-15 ratio's geometric mean is **1.062** (0.59–1.40) | pass, judged as B1 did (the bot's chaos) |
| mean `totalMsPerDay` ≤ baseline + 3 | 10.42 | 11.84 (**+1.42**; the worst single year +3.97), under the timing lock | pass |
| seed 11: pop y15 / y60, lowest ratio, approval, EQ y30, funds, tourism, ms / day | 181,028 / 1,504,571; 80.0; 118.8; 8,031; —; 10.00 | 185,176 / 1,531,494; 0.955 (2001); 79.2; 121.8; 7,775; 0.78–1.64 (3 of 55 outside, mean 0.990); 11.66 (+1.66) | pass (informative) |
| 128 × 15 seed 7: pop 2015, lowest ratio, funds, ms / day | 196,101; —; 7,955; 4.81 | **191,840**; 0.919 (2006), 0.978 at 2015; 6,156; 5.94 (+1.13) | informative |

Six 128 × 15 seeds, year 15 (B → W): population 192,879 → 195,651, 194,974 → 194,950, 195,940 → 195,673, 196,955 →
194,005, 193,637 → 195,723, 196,101 → 191,840 (geometric mean 0.998); approval 79–82 → 78–82; EQ 100–108 → 100–105
(seed 3 99.8 at year 15); tourists 1.33, 1.08, 1.40, 1.07, 1.13, 0.59 (geometric mean 1.062). Seed 7's 128 × 15 run
is the low one (its tourists 0.34–0.60 × B in every year) while its 256 × 60 run and the other seeds sit around 1.

**The new bot hashes**: `tests/sim/fixtures/balance-baseline.json` gets a `b2` key in each of the three runs (W's rows
at `2d2940a`), `reference = 'b2'`, a note; the older rows are untouched. **The new 128 × 15 seed-7 2015 population is
191,840** (B1's 196,101; G3 194,947, G2 193,577, G1 193,525). The results move by design through the schedule: the
headless schedule follows the estimates, the pieces and the budget.

### 18.7 Notes for the gates role and the lead

- **Other groups' pieces above 5 ms** (one run each, no GC overlap unless named): traffic `final2.11` 34.1 ms (hold 3,
  day 44), `roundSearch.search` 12.5 and `roundMatch.flows` 8.8 (hold 5, day 7), `transit2.origins` 8.5 (hold 1, day
  51), `commute.pool*` 5.1–6.6, `roundMatch.sort2` 5.1–6.2; services `tiers.alloc` 16.2 (hold 3, day 58),
  `accSeed.bld` 6.8 and `tiers.search` 6.4 (the edit scenario, hold 5); pollution `garbApply.left.left` 7.1 (hold 5, day
  10); in hold 6 (the final code) traffic `inbound.0` 5.89 ms five days after the meteor (the edit scenario, no GC
  record). They set the all-task max; G4's own tasks stay within the bounds of 18.4.
- **G4's remaining long items** (18.4): `uses.bld` on days 21–23 after a load, the Building-shape deopt wave (review 2
  item 2): 4.10 and 5.10 ms in two of hold 6's three runs at the final code, 2.1–2.7 ms in two runs of holds 3–5, no GC.
  Smaller utilities chunks would at best shorten it in proportion, and would move the bot again; the shape fix (§14 item 4)
  removes it. The snapshot take (`uses.snap`: one `buildingList` + its copy, indivisible) reached 4.57 ms once, the day
  after the road cut (hold 4; otherwise ≤ 2.3 ms). The response's first `resp3.rows` piece of a sequence: 5.71 ms once
  (hold 6's edit scenario, no GC record), otherwise ≤ 0.6 ms without GC. Single pieces of 3.7–10 ms whose kind normally
  takes 0.05–0.4 ms (`uses.sea` day 18, `uses.scan` day 0, `resp1.run` day 167 in holds 4–5; `water.bld` day 11 in
  hold 6, inside a stretch where pollution's pieces ran 10–15 × slower too) appear in one run each with no GC overlap:
  process stalls, JIT tier-up or page faults, not their work.
- **The day budget** (18.5): 4.6, not 5.3; `totalMsPerDay` of the same code moved by ±0.5 ms between sessions (+2.46 to
  +3.39 at 5.3), so 5.3 sat on the gate. A lower budget needs services' pass to get cheaper first (or
  `INFRA_TASK_WEIGHT`): at 4.2 the bot's seed 7 fell to 0.84 × B1.
- **The timing lock** was held by other workers' QA soaks and full test runs for most of the afternoon (waits of 1–40
  min per acquisition). Holds 3–6, the budget hold and the locked balance took it (`timedG4.py` polling every 1–5 s);
  the remaining balance runs and the full vitest ran outside it (B and W side by side, nice 19).
- **Tools** (in `scratchpad/b2work/G4-utilities-emergency-recalibration/`): `cpumapG4.ts`, `editmapG4.ts` (G3's, +
  `stepName` labels for every split task), `passdigestG4.ts` (+ the utilities / response internals), `genfxG4.ts` (the
  utilities / emergency cities from B's code), `balanceG4.ts` (balance-json + tourists; `bundle-dir.mjs` bundles it),
  `anG4.py`, `anEditG4.py`, `docG4.py` (18.4's tables), `cadG4.py`, `balcmp.py`, `timedG4.py`; the holds `hold1.sh` …
  `hold6.sh`, `budget.sh`, `holdbal5.sh`, the unlocked runs `balfree*.sh`, `bal6.sh`, `pd*.sh`.
