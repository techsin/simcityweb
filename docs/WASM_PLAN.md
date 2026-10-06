# WebAssembly decision and million-population performance plan

- **Date:** 2026-10-06.
- **Tree at writing:** `dfdc77c`.
- **Status:** decided. Integration starts after sim-depth part B lands (task #35).
- **Evidence:** the 1M sim profile, the toolchain report, the architect's memory model and worker plan, and six independent A/B reviews of the ports. All kernel numbers were measured on frozen copies of `24f8609`; some ports were also checked against `caac91e` and `ccf0396`.
- **Supersedes:**
  - the "Conclusion" paragraph of `wasm/README.md` (port whole hot systems, with their layers in wasm memory);
  - the architect's recommendation to keep CityState layers resident in wasm memory.

The player asked whether the game uses WebAssembly and, if A/B tests show it helps, to rely on it heavily. Today nothing in the game uses WebAssembly or Web Workers: the whole simulation runs as TypeScript on the main thread. At 1.12M residents it cannot keep up at ultra speed.

Since then we built a Rust → wasm32 toolchain, ported six kernels, and had every port re-measured by an independent reviewer. This document records the results, the decision, and the plan for integrating it.

## 0. Decision

1. **WebAssembly does not win broadly, so we will not rely heavily on it.**
   - Every port is correct on the sim's domain: bit-identical in 10k–49k randomized differential cases per port, and in 120–365-day city runs.
   - Most kernels are faster on their own: 1.2–1.5× on graph searches and gathers, 3–5× on blur stencils.
   - But against the best exact JS, with V8's ArrayBuffer-detaching protector intact on both sides, the systems that contain them gain at most 1.3×, and the whole simulated day at most 11 %. Several ports made the day slower.
   - Free JS fixes are worth as much or more.
2. **Smoothness comes from a Web Worker, not from WebAssembly.** Moving the Simulation into a dedicated worker (W1) takes all sim work off the main thread. Today at ultra that work is 31–35 ms of CPU per simulated day, with p99 frames of 95 ms, 73–105 ms month boundaries and single steps of up to 67 ms. W1 is the first and largest item.
3. **The sim's JS isolate must never detach an ArrayBuffer.**
   - One detach permanently slows every typed-array access in that isolate. It can come from a `postMessage` transfer list, a wasm `memory.grow`, or node's web streams.
   - Keeping the protector intact is worth 1.04–1.06× on the whole day in Chromium, 1.05–1.16× in node, and 1.04–1.13× on the traffic and services passes.
   - It costs nothing, and it beats most ports.
4. **JS fixes land regardless (§6).**
   - The exact ones: desirability and land value 1.9–2.2×, population aggregate 1.38×, NIMBY 1.24–1.37×, services 1.07–1.14×, the traffic radix sort, and the allocation fixes.
   - Then the cadence fixes: the services dirty trigger, step splitting, and spreading the month boundary. The services trigger alone is projected to save more than every WASM port combined.
5. **Verdicts per kernel (§3):**
   - **Adopt blur.** It runs staged, in a pre-sized memory, behind an A/B gate.
   - **Park the traffic core.** It is the only port whose old-code numbers clear the bar in the Chromium worker. It mirrors code that has since doubled in size, so it is re-ported only if the gate in §7.10 shows the need.
   - **Reject the services tier engine, the standalone road/transit search and the emergency searches.**
   - **Use the JS fixes instead** of the pollution field passes, the desirability/land-value bands and the population aggregate.
6. **Use more cores before more WebAssembly.** After W1, the next throughput lever is parallel helper workers for the services tiers and the traffic searches (W2).

## 1. How to read the numbers

- **Machine and method.**
  - The machine has 4 cores, shared with other agents (load average 5–120).
  - Every figure is CPU time: process or thread CPU in node; ThreadTime or schedstat in Chromium. Thread clocks are coarse here (about 1–4 ms ticks), so results are aggregated over many calls or use per-process CPU.
  - Arms run interleaved, in rotating order, after JIT warm-up, with ≥ 31 pairs. Results are the median of paired ratios with a 95 % bootstrap CI.
- **Baselines.**
  - "Original" is the code at `24f8609`.
  - "Fair JS" is the porter's restructured JS for the same algorithm.
  - "Best JS" (or "improved JS") is the reviewer's further exact optimisation.
  - A port has to beat the best exact JS, not the original.
- **Staged and resident.** Staged copies inputs and outputs through wasm memory on every call; the copies are included in the timing. Resident keeps the arrays in wasm memory (zero copy).
- **Cadences.**
  - Design cadence is `advanceDay()` plus `schedulerOf(sim).flush(sim)` every day, so every infrastructure pass runs when it is due.
  - Ultra is the live game at speed 3: 0.05 s per day, 20 days/s. At this speed the scheduler starves passes.
- **The porters' bias.** Most porters measured their JS baselines in isolates whose protector was already invalidated, either by wasm `memory.grow` or by loading fixtures through `unpackFile`, whose undici streams detach buffers in node. That inflated their speed-ups. This plan uses only the independent numbers, measured with the protector intact.

  | kernel | porter's claim | independent, protector intact |
  |---|---|---|
  | road search | 1.70–1.83× | 1.35–1.45× |
  | desirability | 3.2–4.2× | 2.0–2.3× |
  | pollution field pass | 1.99× | 1.42× |
  | population SoA loop | 1.78× | 1.33× |
- **Two absolute scales.** Ratios agree between the two; absolute ms differ by about 1.7–2×. The estimates in §4 use the A/B scale. Treat any absolute ms as ±15 %.

  | source | design-cadence day at 1.12M | conditions |
  |---|---|---|
  | profiler | 102–136 ms | fixture loaded through `unpackFile` (protector invalidated), load 31–89, per-hook instrumentation |
  | A/B harnesses | 52–62 ms | fixtures loaded with zlib, one isolate per arm, load 11–47 |

## 2. Where the time goes at one million

The fixture is `dense1m_s7`: 1,118,755 residents, 17,154 buildings, 23,141 road cells and a 30,084-node transit network.

- **Ultra today.**
  - The sim costs 31–35 ms of CPU per simulated day: systems 15.9–17.8 ms, scheduler 14.9–16.8 ms. That is 0.62–0.70 s of main-thread CPU per real second.
  - The emulated loop reaches only 16.0 of the 20 days/s.
  - In the real browser, `sim.update` took 33.1 ms per simulated day.
- **The scheduler starves the infrastructure.**
  - It hides 70–100 ms/day of work this way. In 90 ultra days, traffic completed 3–4 of its 45 designed cycles, and services 1–2 passes.
  - 79–82 % of steps exceed the 3 ms target (median 5.1 ms, max 67 ms).
  - The cost model is 3–5.5× too low at the median.
- **Frames (ultra emulation, load 33).**
  - Sim CPU per frame: p50 13.1 ms, p95 37.6, p99 94.8, max 104.
  - A month boundary costs 73–105 ms; the year boundary 69–100 ms.
  - In the browser, `sim.update` is 65 % of main-thread time.
  - The worst browser frame was 299 ms: 111 ms of sim, 68 ms of render, and 120 ms for a minimap repaint plus a 57 ms major GC.
- **Shares of sim CPU (%).**

  | kernel | ultra today | design cadence |
  |---|---|---|
  | population + demographics | 23–24 | 8.8 |
  | services catchments | 4.6–6.4 | 29.1 |
  | traffic core | 7.9–8.8 | 19.8 |
  | road / transit search | 3.7–5.0 | 13.2 |
  | desirability + land value | 8.2–9.1 | 2.1 |
  | utilities | 6.5–7.2 | 5.4 |
  | fire scan | 5.9–7.5 | 1.9 |
  | emergency | 5.5–7.1 | 2.4 |
  | monthly economy | 5.0–6.3 | 1.2 |
  | pollution fields | 3.8–4.0 | 3.9 |
  | blur | 3.1–3.3 | 1.3 |
  | crime | 2.7–3.2 | 0.7 |
  | growth | 2.2–3.1 | 0.9 |
  | GC | 5.7–7.0 | 3.7 |

- **Object-heavy logic.** About 60 % of today's sim time is game logic over Building objects, catalog lookups and Maps. WebAssembly cannot speed that up unless buildings first move into typed arrays.
- **Allocation.** The sim allocates 6.1–6.5 MB per simulated day, about 125 MB/s at ultra. Main-thread GC takes 2.0–2.6 ms/day, and major pauses in the browser reach 57 ms.

## 3. Verdicts per kernel

The reviews' adoption bar: the containing system, measured in situ, at ≥ 1.25× against fair JS, with the protector intact on both sides, plus a measurable gain on the whole day. "Whole day" means `dense1m` (1.12M) at design cadence unless noted.

| kernel | verdict | kernel speed-up | containing system | whole day | free alternative |
|---|---|---|---|---|---|
| blur (`blur.rs`) | **adopt**, staged (gate in PI-6) | crime `blur3`: 2.95× [2.85, 3.00] vs the same loops in JS; 4.66× [4.49, 4.87] vs today's JS, copies included | blur calls of one pollution + crime pass: 2.77× [2.69, 2.86] | unresolved: 1.007× [0.85, 1.32] on the old, growing binary; expected +0.5–2 % | restructured JS (J8): 1.81× [1.78, 1.86] |
| trafficCore (`traffic.rs`) | **park** (gate in §7.10) | rounds 1.23–1.37×, transit 1.15–1.28×; logit 0.79× (slower) | cycle vs fair JS: 1.186× [1.172, 1.203] node, 1.286× [1.254, 1.322] Chromium worker. Vs improved JS: 1.19× / 1.29× | node 1.11× [1.03, 1.20]; Chromium worker 1.08× [1.04, 1.20]. That is 3.4–7 ms/day | protector intact: 1.11–1.12× on the cycle; JS radix sort (J2) |
| servicesTierEngine (`catch.rs`) | **reject** | tier engine 1.25–1.27×; alloc 1.28× | services vs fair JS: 1.204× [1.176, 1.240] node, 1.224× [1.194, 1.286] Chromium, 1.098× on bot256. Vs improved JS: 1.125× [1.053, 1.179] node, 1.19× Chromium | 1.081× [1.050, 1.119] vs fair JS; 1.051× [1.000, 1.089] vs improved JS | improved JS (J3): 1.07–1.14×; protector: 1.11–1.13×; dirty trigger (B1) |
| roadTransitSearch (`search.rs`) | **reject** standalone; stays only inside the parked traffic core | 1.33–1.45× vs best JS, pre-sized memory | traffic cycle vs fair JS, pre-sized: 1.11× [1.04, 1.19] dense1m, 1.18× [1.12, 1.24] stress1m. Growing binary: 1.01–1.10× | headless day: pre-sized 1.009× [0.959, 1.083]; growing 0.974× [0.898, 0.992] (slower) | protector intact: 1.08–1.11× on the cycle |
| desirabilityLandValueBands (`econ.rs`) | **JS fix** | resident SIMD: 1.7–3.0× vs fair JS; 1.09–1.96× vs best JS | both economy systems vs best JS: resident 1.07× [1.03, 1.11] node, 1.17× [1.14, 1.21] Chromium; staged 0.78–0.88× (slower) | headless day: 0.95–0.99× (no change) | J5: 1.90× [1.86, 2.02] node, 2.22× [2.11, 2.36] Chromium vs original |
| fieldPasses (`fields.rs`) | **JS fix** | pass 1.33–1.42× node, 1.51–1.62× Chromium; NIMBY 1.63–1.76×; `cells` 0.82× in node (slower) | pollution system 1.05–1.14× (pre-sized); NIMBY rebuild 1.26–1.57× | pre-sized 0.97–1.04×; growing 0.91–0.95× (slower) | J4 NIMBY: 1.24–1.37×. After it, WASM is 1.01× (node) and 1.05× [0.98, 1.08] (Chromium) on the day |
| populationAggregateProbe (`popagg.rs`) | **JS fix** | vs the JS fix: 0.70× node, 0.61–0.64× Chromium. Gathering objects into wasm memory costs more than the loop | aggregate region: 0.84× [0.72, 0.98] | headless day: 0.91× [0.88, 0.94] (slower) | J6: region 1.38× [1.16, 1.64]; whole day 1.05× [1.02, 1.09] |
| emergency chunked / dispatch searches | **reject** | equivalence-tested only | a few 1–2 ms calls per pass | cannot matter | – |

### blur

- **What it is.** A port of `src/sim/infra/blur.ts`, which is unchanged since `24f8609`. It is bit-identical: the sim with WASM blur produces identical cities after 132 days.
- **What it saves.**
  - Blur is 3.1–3.3 % of today's ultra sim and about 1.3 % at design cadence.
  - At 1M, WASM saves about 0.6–0.8 ms per simulated day against today's JS, but only 0.2–0.35 ms against J8.
  - It is not a lever for the million-population goal.
- **Why adopt it anyway.** It is almost free to keep:
  - It is a module-level drop-in: two import lines, no overrides of private methods.
  - It runs staged, so there are no resident layers.
  - It uses only `+ − × ÷` on f32 and f64, so it is bit-identical on every engine by construction.
  - Its source has been stable for 87 commits.
  - Its pipeline is proven in vitest, bundled node, the Vite dev server and production build, and workers.
- **Open measurement.** The only whole-day A/B ran on the old binary, which grew memory at init and so lost the protector. That run could not resolve a 1–3 % difference.

### trafficCore

- **Correctness.** Correct and robust: 12k random cities, 669k state comparisons and 30 injected traps, with 0 failures.
- **Speed.**
  - WebAssembly really is faster here: the reviewer's extra JS optimisation recovers only 1.02×.
  - About half the gain comes from the search port alone. The rest of the roughly 1,200-line numeric port adds 1.10–1.16× on the cycle and 1.03× [1.01, 1.09] on the day.
- **Why park it instead of rejecting it.**
  - Measured on the old code, it would pass the §7.10 bar in the Chromium worker.
  - It mirrors `traffic.ts` at 1,820 lines. The file is now 4,123 lines (+2,416 / −113: bus fleets, park & ride, ferries, highway ramps, trucks), and `search.ts` grew from 290 to 539 lines. A re-port would be about twice the size.
  - The need has to be shown after the worker and the free fixes (G0).

### servicesTierEngine

- **Correctness.** Correct: 880 random cities, 7,483 pass comparisons and 60,409 traced steps, with 0 mismatches.
- **Speed.** It is below the bar against fair JS, and further below it against the reviewer's improved JS.
- **Costs.**
  - It overrides 9 private `ServicesSystem` methods.
  - It holds 37–52 MiB of wasm memory at 1M, so `dispose()` is mandatory.
  - It hard-codes V8's `Math.hypot`, which is untested on SpiderMonkey and JavaScriptCore.
  - It mirrors `services.ts` at `24f8609` + `233ea41`. That file has changed since (police tier, `7f1ece1`).

### roadTransitSearch

- **Correctness.** Bit-identical: 24k adversarial cases, a 120-day shadow run at 1M, and a 15-year bot game.
- **Why it can't matter.** `search.ts` is only 30–46 % of a traffic cycle, and 2–4 % of a headless day.
- **Measurements.**
  - With the binary that grew memory, the whole sim got slower.
  - The porter's 1.70–1.83× came from the protector bias.
- **Hazard.** Local aliases such as `const dist = S.dist` go stale after any memory growth.

### desirabilityLandValueBands

- **Speed.** The JS fix gets almost everything. WASM adds 0.07–0.16 ms/day, and only when every layer is resident.
- **Hazard.** Resident mode cannot roll back after a trap: a band is applied twice.
- **Staleness.** The port mirrors code that WP6a (`10fb0ab`) rewrote: `desirability.ts` grew from 201 to 702 lines, `landValue.ts` from 229 to 607.

### fieldPasses

- **Why the gain is small.** The ported loops are 12–20 % of a pollution pass, and NIMBY is about 5 % of services.
- **Measurements.** With the shipped growing binary, the whole day got 5–9 % slower.
- **Hazard.** NIMBY buffers leak for every CityState unless they are released explicitly.

### populationAggregateProbe

- **Speed.**
  - Without a building struct-of-arrays, WASM loses everywhere.
  - With one (about 30 files to change), WASM would save 0.03–0.15 ms/day.
- **Bugs found.** Two binding bugs: `DefIndex.of` returns wrong results for fractional ids, and rt grids longer than cw² are not handled. Both are outside the sim's domain and moot unless the port is revived.

### Not ported, by design

These stay in JS (§6) and move into the worker:

- population and demographics
- fire
- emergency dispatch
- the monthly economy
- the utilities object loops
- crime sources
- growth

## 4. Should much more of the sim move into Rust? No.

### 4.1 What each step buys at 1.12M

The table gives CPU ms per simulated day at design cadence, on the A/B scale.

| step | central | range | basis |
|---|---|---|---|
| A. Today: main thread, protector invalidated | 64 | 60–68 | B × 1.05–1.14, the measured protector effect on the whole day in node (1.04–1.06× in Chromium) |
| B. Today's JS in a worker, protector intact | 57 | 53–62 | measured "original" arms in three harnesses: 54.2, 62.0, 52.7 |
| C. B + exact JS fixes (§6) | 51 | 47–56 | sum of the measured savings, about 6 ms/day (below) |
| D. C + cadence fixes, mainly the services dirty trigger | 40 | 32–48 (projection) | full services passes every 4–15 days instead of every 2: −8 to −15 ms/day. Measured in PI-5 |
| E. D + every WASM port at its measured gain | 35 | 27–43 | traffic core −3.7; services, resident, −0.3 to −1.5 (passes are rarer in D); blur −0.2; fields −0.2; econ bands −0.1 |
| F. Hypothetical: the whole sim in Rust, buildings as struct-of-arrays | 32 | 25–40 | D ÷ 1.2–1.3, the best whole-system ratios measured |

- **Row C savings:** traffic −1.4, services −2.4, NIMBY −0.3, desirability + land value −0.6, population −0.4, JS blur −0.45, fire list −0.3.
- **Row F cost:** porting about 31.6k lines of `src/sim` plus a building struct-of-arrays migration, and writing every sim-depth change twice until the JS is retired.

**How to read the table.**
- The worker and the free fixes (A → D) are worth about 20–30 ms/day.
- All WASM ports together (D → E) are worth about 5 ms/day, or 12 % of what remains. Most of that is the traffic core, which would have to be re-ported against code twice its old size.
- A whole-sim Rust rewrite (D → F) is worth about 8 ms/day, for months of work.

**At ultra**, the scheduler caps infrastructure CPU, so faster kernels do not lower ms/day; they buy freshness.
- Assume the worker gets 45 ms per simulated day (0.9 core at 20 days/s) and the daily systems take about 10.5–12 ms/day.
- At the A/B scale, rows B, C and D then reach about 75 %, 85 % and 100 % of design freshness. At the profiler's scale they reach about 30 %, 35 % and 50 %.
- Row E adds about 15–20 %.
- Traffic also needs B5: `TRAFFIC_MIN_CYCLE_MS` = 1000 caps it at one cycle per real second, which is one cycle per 20 sim days at ultra.

**On the main thread.** It pays all of today's sim cost: 33.1 ms per day inside `sim.update` in the browser. With W1 the target is ≤ 1 ms per day. No WASM configuration reduces main-thread time while the sim stays on the main thread.

### 4.2 Why WASM gains so little here

- **The hot code is bound by memory latency.**
  - In V8's TurboFan, bucket-queue Dijkstra, pool gathers and seat filling over typed arrays already compile to near-native loads. WebAssembly only removes bounds checks and tagging: 1.2–1.5×.
  - SIMD gives 0.96–1.01× on these kernels. Only the stencil and band kernels (blur, field passes, desirability bands) vectorise, at 1.12–1.4×.
- **Amdahl's law.**
  - Search, traffic and services together (kernels K1+K2+K3 in the profile) are 62 % of the design-cadence work.
  - At their measured 1.19–1.29×, the whole day gains 1.11–1.16× at best.
  - The profile had hoped for 2–3× on those kernels, which would have given 1.4–1.6× overall.
- **Transcendental functions.** `exp` and `log` must be imports of the engine's own `Math`, so that results stay bit-identical on every engine. As a result the logit pass runs at 0.79× in WebAssembly.
- **Objects.**
  - About 60 % of today's time reads Building objects, catalog definitions and Maps.
  - Gathering them into wasm memory costs more than the loop itself: the population probe ran at 0.61–0.70×.
  - A struct-of-arrays migration would speed up the JS too, leaving WebAssembly only 1.16–1.33× (node) on loops worth 0.2–0.3 ms/day.
- **Costs that JS does not have.**
  - Per-call copies: 6–8 % on search outputs. Staged desirability is slower than JS.
  - Memory growth detaches aliases, and costs the whole isolate its protector.
  - In-place resident writes cannot be rolled back after a trap.
  - Every ported system has two implementations. During the evaluation, `traffic.ts` grew from 1,820 to 4,123 lines, and every port went stale within days.

We revisit this only through the gate in §7.10.

## 5. Off the main thread: the Web Worker plan

### 5.1 W1: SimHost and the sim worker

**Files.**
- New files: `src/worker/{protocol.ts, simWorker.ts, SimHost.ts, replica.ts, rpc.ts}`.
- `SimHost.ts` holds two hosts:
  - `LocalSimHost`: today's behaviour, also the fallback;
  - `WorkerSimHost`: the sim in the worker.
- `CityScene` talks only to a SimHost.
- The worker is created the same way as `lodWorker`: `new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: 'sim' })`.

**Worker side.**
- The worker owns the authoritative CityState, the systems, CityActions, the scheduler and the kernels.
- Workers have no `localStorage`, so the page sends its effective `simwasm` flag in the init message. The worker then calls `initSimWasmBrowser({ flag })`.
- A MessageChannel self-post loop calls `sim.update(dt)` every ~16 ms with the real `dt`. `setTimeout` would get clamped.
- Actions and RPCs are handled between ticks, in arrival order.

**Worker → main, per tick (1–2 days at ultra):**
- day, speed, stats, budget, news and emergency events;
- building diffs as packed records: about 18 changed and 1 added per day at 1M, under 2 KB/day;
- cell diffs (rect + bytes) for network, zones, terrain, trees, subway and power lines;
- on `layerUpdated`, only the layer groups the main thread consumes (the overlay shown, the minimap, renderer inputs). Typical sizes: traffic 0.8 MB, services up to 3.6 MB, desirability 3.1 MB;
- sample routes on traffic updates;
- vehicle paths on dispatch.

**Change from the worker plan: no transfer lists out of the sim worker.**
- Transferring a buffer detaches it in the worker's isolate, which costs the whole sim 4–16 %.
- So layers travel as structured-clone copies. That adds one memcpy on the main thread: about 2–8 ms per real second at 10–40 MB/s.
- Transfers from main to worker are fine: they detach only on the main thread.

**Main → worker:**
- actions `{id, op, args}`, answered with the `ActionResult`;
- speed changes;
- save: the worker replies with `serializeCity(st, {copy: true})`;
- load: the main thread reads and gunzips the file, then sends the bundle bytes. No streams run in the sim isolate;
- inspector RPCs, answered within one tick (panels refresh at ~6 Hz anyway): `facilityLoad`, `facilityReport`, `roadCellReport`, the desirability / land-value / condition breakdowns, `needsOf`, `emergencyReachAt`, route info, `garbageInfo`.

**Previews.** Tool previews (`preview = true`, on every mouse move) run on the replica, with the same CityActions code over a Simulation shell that has no systems. Hover feedback needs no round trip, and the authoritative result always comes from the worker.

**Replica.** The replica is a real CityState plus an `Emitter<CityEvents>` that re-fires the same events as diffs are applied. WorldView, CityObjectsView, MiniMap and the panels read it exactly as they read the live state today. This UI code moves from synchronous sim calls to replica reads or RPC:
- `InfoPanel` (15 sim imports) and `inspectorModel`;
- `PlopTool` (`stopsNear`, `ferryPartnersFor`), `QueryTool` and `DispatchTool`;
- `EmergencyBanner`;
- `render/world/overlays.ts`;
- `CityScene`: `attachOverlays`, `windVector`, and the emergency system used for sirens.

**Recovery snapshots.** Today `save/recovery.ts` writes them synchronously on `beforeunload`, `pagehide` and tab hide. With the worker:
- The worker sends a full serialized snapshot on request: every 30 s while the city is dirty, and on `visibilitychange` → hidden.
- At unload, the main thread serializes the replica (CityState, buildings and plain data as of the last tick), using the system data from the newest worker snapshot, and writes the delta as it does today. Recomputed layers that the replica does not track are left out, as in today's lean snapshots.
- At most one tick of primary data and 30 s of system data can be lost.

**Scheduler.**
- W1 keeps today's frame-mode semantics: `INFRA_FRAME_BUDGET_MS` = 3 per tick, and `TRAFFIC_MIN_CYCLE_MS` = 1000.
- Variant **W1b** lets the scheduler use up to 12 ms of each 16 ms tick, since the worker has no render to protect. This needs a budget setter in `scheduler.ts`.

### 5.2 W2: parallel infrastructure helpers (multi-core, no SharedArrayBuffer)

- **Services.** The tier slots are independent: they read the need rasters, and each one owns its own layer and pool. Shard them over 2–3 helper workers; each worker keeps the reach caches and pools of its slots.
- **Traffic.** The transit search and the shop, freight and inbound searches depend only on prep's node times, so they can run while the matching rounds run.
- **Data.** Inputs go by copy, about 2 MB per services pass. No transfer lists in either direction: the helpers are sim isolates too.
- **Determinism.**
  - Results merge at the pass's completion step.
  - Each sharded pass must read a snapshot taken at a fixed step, so the results are identical to the single-threaded pass.
  - Deterministic (headless) runs use the single-threaded path, or an async driver that is tested to be identical.
- **Expected on ≥ 4 cores** (estimated from step costs, still to be measured):
  - services critical path: 63 → about 25–30 ms;
  - traffic cycle: about 65 → 45 ms.

### 5.3 W3 (optional)

W3 means SharedArrayBuffer display layers, or wasm threads. Build it only if copies or helper overhead show up in the A/B. It needs COOP/COEP headers:
- The Vite dev/preview headers are verified.
- GitHub Pages needs a cross-origin-isolation service worker.
- Google Fonts must be self-hosted, or the page must use `COEP: credentialless`.

### 5.4 A/B testing: yes, in-game and in harnesses

The worker ships behind `?simworker=0|1`, with LocalSimHost kept. The A/B is a 2×2 factorial: host (main thread or worker) × kernels (js or auto), plus W1b and W2 arms.

**1. Node, CPU-exact** (`tools/bench/worker/host.bench.ts`)
- The main thread runs a fixed 6 ms CPU "render" per 16.67 ms tick. It hosts the sim either inline or in a `worker_thread`, using the real protocol and replica.
- Measure:
  - main-thread CPU per tick, aggregated over many ticks;
  - event-loop delay with `monitorEventLoopDelay`: p50, p99, max;
  - days/s at ultra;
  - passes per 60 days, per task;
  - worker CPU in ms/day.
- Fixtures: `dense1m` and `bot256_y60`, re-grown on the final sim. Run 20 warm-up days, then 60 measured days.
- Run ≥ 30 times per arm, interleaved in rotating order. Report medians of the paired ratios with bootstrap CIs, and the load average of each run.

**2. Browser, real frames** (Playwright Chromium from `/opt/pw-browsers`, flags `--use-angle=swiftshader --enable-unsafe-swiftshader`, production build)
- Use a fresh context per run and rotate the arms; ≥ 30 runs.
- Primary page: null views plus a synthetic 6 ms busy render per rAF. SwiftShader limits the real renderer to 0.17 fps, so its frame times mean nothing here.
- Secondary run: a smoke test with the real renderer at quality low, 480×270.
- CDP tracing gives:
  - main-thread busy ms per frame: p50, p95, p99, max;
  - the share of frames over 16.7 ms and over 33 ms;
  - long tasks ≥ 50 ms;
  - GC;
  - rAF intervals;
  - worker CPU.
- In-page counters give:
  - days/s and passes per 60 days;
  - action latency: a scripted plop, zone or bulldoze every 3 sim days, from post until the replica has applied it (p50 / p95);
  - bytes/s and apply ms/day.
- The protector probe (`--js-flags=--allow-natives-syntax`) runs in every arm.

**3. Reference machine:** 5 runs per arm, with the real renderer and the in-game perf overlay (`?fps=1`).

### 5.5 Acceptance for W1 and W2

**Accept W1** and make it the default when all of these hold with the 6 ms synthetic render:
- main-thread p99 ≤ 20 ms and max ≤ 33 ms (today, from the sim alone: p99 95 ms, max 104);
- no long task attributable to the sim;
- ≥ 19.5 of 20 days/s at ultra;
- action latency p95 ≤ 50 ms;
- apply cost ≤ 1 ms per sim day;
- bit-identical cities from both hosts in deterministic mode;
- the protector intact in the worker.

**Accept W2** when the services and traffic critical-path CPU drops ≥ 1.5×, with bit-identical results.

**Expected effect at 1.12M.**
- All sim frame spikes leave the main thread: p99 95 ms, months 73–105 ms, years 69–100 ms, steps up to 67 ms.
- So does the sim's GC: 2.0–2.6 ms/day, with major pauses up to 57 ms.
- Render-side spikes stay: the minimap repaint, LOD builds and the fireworks setup. Those are the render items in §6.

## 6. JS fixes that land regardless

### Exact fixes

These are bit-identical to the code they replace.

| id | fix | files | measured effect |
|---|---|---|---|
| J0 | Drop the transfer list at `lodBuilder.ts:82`; the arrays are already `slice()` copies. This restores the main-thread protector for LocalSimHost and the render code. Verify it with the probe in Chromium | `src/render/city/buildings/lodBuilder.ts` | whole day 1.04–1.06× in Chromium; traffic cycle 1.04–1.12× |
| J1 | Isolate hygiene in every sim isolate: no transfer lists out of it, no `ArrayBuffer.prototype.transfer`, no web streams (`DecompressionStream`, `Blob.stream`, `Response` bodies in node), no wasm `memory.grow` after init | `src/worker/**`, plus a CI test | whole day 1.04–1.06× in Chromium, 1.05–1.16× in node; services 1.11–1.13×; traffic cycle 1.11–1.12× |
| J2 | Traffic: JS radix sort of the match keys, precomputed stop x / z, reused scratch (the fair core). Optionally, the road-search tweaks (fairx) | `traffic.ts`, `search.ts` | sort 3.35–3.7× (1.06–1.38 ms → 0.32–0.37 ms per round-0 sort); cycle, original → fair: 1.065× pooled in node (1.03–1.14× per run), 1.03× in Chromium; fairx adds 1.02× |
| J3 | Services: the fair engine's algorithm (typed cache records, cached reaches read in place), a fused `finalizeTier` clamp and sum, a lookup table for the transit disks, and reuse of the per-pass Map and entry objects | `services.ts`, `catchments.ts` | services 1.07–1.14× (19.8 → 17.45 ms/day at design cadence); 0.49 MB/day less garbage |
| J4 | NIMBY: skip landfill row pairs with `Uint8Array.indexOf`, and scan the corridor class map 4 cells at a time through `Uint32` views | `nimby.ts` | kernel 1.25–1.28× in node, 1.15–1.25× in Chromium; rebuild 1.24–1.37× vs today |
| J5 | Desirability: generate code per zone dev list (f32 weights as literals, only the needed terms). Land value: split the pass, and stop accumulating into closure variables. Re-derive both for the 33-term WP6a code | `desirability.ts`, `landValue.ts` | both systems 1.90× in node, 2.22× in Chromium (measured on the `24f8609` code) |
| J6 | Population aggregate: a per-id def index (B0); optionally the per-id def + block cache (B2). Reset it with the runtime on load or new city | `population.ts` | region 1.38× [1.16, 1.64]; population system 1.13×; whole day 1.05× [1.02, 1.09] |
| J7 | Fire: maintain the list of 17k buildings on add and remove, keeping its order, instead of rebuilding it daily | `fire.ts`, `common.ts` | 0.40 ms/day [0.37, 0.43]; 0.58 MB/day, about 10 % of all allocation |
| J8 | Blur: the restructured loops of `tools/bench/blurJsOpt.ts` become the JS implementation (and the WASM fallback) | `blur.ts` | `blur3` 1.81× [1.78, 1.86] |
| J9 | Allocation sites (MB/day): approval `residentSurvey` 0.33, population aggregate 0.27, `updateEqHq` 0.25, fire daily 0.25, `roundMatch` 0.21, desirability band 0.17, `commuteEnd` 0.15, crime `buildingTerms` 0.15 | various | target < 3 MB/day, down from 6.1–6.5; GC costs 2.0–2.6 ms/day today |
| J10 | Cache `infoOf` per building id (12.8k string-keyed lookups/day). Hoist `waterQualityAt` (3.5k calls/day) and the per-building def lookups | `population.ts`, `demographics.ts`, `utilities.ts` | not measured separately |
| J11 | Utilities: merge `prepareUses`, the power sums and results, and the water sums and results into one pass over a typed per-building record, keeping the summation order | `utilities.ts` | not measured; utilities are 5.4–7.2 % of sim time |

### Behaviour-changing fixes

These are deterministic within a version. Each goes through the balance procedure in `docs/SIM_DEPTH_SPEC.md`.

| id | fix | files | effect |
|---|---|---|---|
| B1 | Services dirty trigger. Today any `buildingChanged` on a coverage-relevant building forces a full pass within `SERVICES_DIRTY_DAYS` = 2, instead of every `SERVICES_PERIOD` = 15. That includes traffic's Congested flag flips. Instead, mark dirty only when coverage-relevant state changes (def, power, functional, staffing), and add a live-mode real-time cap like traffic's | `services.ts` | projected −8 to −15 ms/day at 1M, design cadence. At ultra, the current trigger would cost 10 passes/s × 63 ms = 630 ms/s. The largest single throughput item |
| B2 | Scheduler: split steps to ≤ 3 ms at 17k buildings, and recalibrate `cost()`, which is 3–5.5× too low at the median and up to 20× | `scheduler.ts` and each task | removes the 5–67 ms steps and makes headless budgets honest. Changes headless step boundaries |
| B3 | Spread the month-boundary work over the month's days, with deterministic offsets. Today: tourism 18–28 ms, EQ/HQ 12–18, advisors 14, budget 7–10, emergency 2.7 | `tourism.ts`, `population.ts`, `advisors.ts`, `budget.ts` | month frame 73–105 ms → < 20 ms on the main-thread host; a smoother worker |
| B4 | Fire: sample ignitions by total risk (an alias table) instead of testing every building | `fire.ts` | most of fire's 2.0–2.8 ms/day. Changes the RNG draws |
| B5 | `TRAFFIC_MIN_CYCLE_MS` in the worker host: allow 250–500 ms when the CPU budget holds. Live mode only | `params.ts` or a host option | traffic every 5–10 days at ultra, instead of every 20–30 |

For B2, the largest steps to split:

| step | ms |
|---|---|
| traffic transit | 32–67 |
| crime sources | 18–46 |
| services prep | 39 |
| services shopB | 35 |
| NIMBY | 27 |
| traffic final2 | 17–26 |
| traffic commute | 10–25 |
| pollution sources | 12–25 |
| utilities water | 6–21 |
| emergency response | 8–18 |

### Render side

These are not sim fixes; they are for the render owner.
- Throttle `MiniMap.paintBase` in `src/ui/MiniMap.ts`; one repaint caused a 120 ms frame.
- Batch the render-side LOD work on `buildingAdded`: 2 ms per building, max 14.8 ms.
- Stop `collectLaunchSites` in `src/render/city/effects/Fireworks.ts` from walking every building at the year boundary.

## 7. Integration plan (after sim-depth part B)

### 7.1 Preconditions

- Part B is merged and its reviews are closed. The performance work starts from a tagged commit.
- Each `src/sim` file has one owner at a time. The fixes are small PRs, each reviewed by that file's part-B owner.
- No porting work continues against code that is still changing.

### 7.2 Order

| step | what | needs | files | gate to continue |
|---|---|---|---|---|
| PI-0 (now) | Freeze the ports; keep the harnesses and evidence. Copy the summary JSONs out of the scratch dir, together with the reviewers' improved-JS sources that J2–J6 start from (`myjs*.ts`, `jsopt.ts`, `fairopt.ts`). Touch nothing in `src/**` | – | `tools/bench/baselines/` (new) | – |
| PI-1 | Baseline on the final sim: re-grow `dense1m` (`tools/bench/sim-profile/fixtures/dense1m.ts`), `bot256` seed 7 at year 60 (about 1.4M since WP6a) and the stress fixture. Run the profile matrix: ultra, headless and design cadence, in node and Chromium | part B merged | `tools/bench/baselines/` | baseline JSON committed |
| PI-2 | J0, plus the J1 CI test | PI-1 | `lodBuilder.ts`; `tests/perf/protector.test.ts` (new) | probe intact in Chromium after a 10-minute session |
| PI-3 | W1 worker host | PI-1 | `src/worker/**` (new), `CityScene.ts`, tools, panels, `main.ts`, `src/save/**`, `region/settings.ts` | W1 acceptance (§5.5), then default on |
| PI-4 | Exact JS fixes J2–J11, one PR each | PI-1 | sim files | bit-identical over 120 days on both fixtures and the bot's 15-year hashes; the containing system is not slower |
| PI-5 | Behaviour fixes, one at a time: B1 → B2 → B3 → B5 → B4 | PI-4 (B5 also needs PI-3) | sim files | balance procedure, plus an A/B of freshness and CPU |
| PI-6 | WASM blur on; binary trimmed to blur; the other ports archived | PI-1, J8 | the imports in `pollution.ts` and `crime.ts`, `wasm/**`, `src/wasm/**`, `tests/wasm/**`, `tools/bench/**`, `wasm/README.md` | blur gate (below) |
| PI-7 | W2 helpers | PI-3, B1 and B2 (they change the pass structure) | `src/worker/**`; task hooks in `services.ts` and `traffic.ts` | W2 acceptance |
| PI-8 | Gate review for re-porting the traffic core (§7.10) | PI-7 | – | the gate |
| PI-9 | W3 (optional) | PI-7 | Vite config, hosting | only if copies or helpers show up in the A/B |

PI-2, PI-3 and PI-4 touch disjoint files and can run in parallel. PI-6 changes two import lines in `pollution.ts` and `crime.ts`, which PI-4 also edits (J9), so it lands between PI-4 PRs.

**PI-6 details.**
- Point the blur imports in `pollution.ts` and `crime.ts` at `src/wasm/kernels/blur.ts`.
- Rebuild the binary with only the blur module: about 24 KB (8 KB brotli), instead of 169 KB (56 KB brotli).
- Size its initial memory to blur's staging needs on a 256² map, about 8 MiB. It never grows.
- Tag the commit that still has all the ports as `wasm-ports-24f8609`. Then remove the parked and rejected ports from main: their bindings in `src/wasm/kernels` and `src/wasm/js`, their Rust modules, their `tests/wasm` suites and their benches. J-fixes that are still open take their reference code (the fair JS in `src/wasm/js`) from the tag.
- Move the protector probe from `tools/bench/trafficCore/protector.ts` to `tools/bench/protector.ts`.
- Update `wasm/README.md`.

**Blur gate.** Measure in situ in node and in a Chromium dedicated worker, against J8, with the protector intact in both arms. All of these must hold:
- bit-identical results;
- the summed CPU of the blur calls ≥ 1.5× lower;
- the whole day not slower: CI lower bound ≥ 0.99;
- 0 memory grows.

If the gate passes, the default becomes `auto` in both hosts. Otherwise blur stays on `js`, and the toolchain stays in the repo for the §7.10 gate.

### 7.3 File ownership

| area | files | owner |
|---|---|---|
| worker host, protocol, replica, RPC | `src/worker/**` (new) | perf integrator |
| scene and tool wiring | `src/game/CityScene.ts`, `src/game/tools/{PlopTool,QueryTool,DispatchTool}.ts` | ui-game owner, with the perf integrator |
| panels and overlays | `src/ui/panels/InfoPanel.ts`, `src/ui/inspectorModel.ts`, `src/ui/EmergencyBanner.ts`, `src/ui/overlays.ts`, `src/render/world/overlays.ts` | ui-game and render owners |
| app, save, settings | `src/main.ts`, `src/save/{bundle,recovery,index}.ts`, `src/region/settings.ts`, `src/region/ui/dialogs.ts` | meta owner |
| sim fixes J2–J11 and B1–B5 | `src/sim/**` | the part-B owner of each file; the perf integrator writes the patch and the A/B |
| WASM | `wasm/**`, `src/wasm/**`, `tests/wasm/**`, `tools/build-wasm.mjs` | perf integrator |
| benches and baselines | `tools/bench/**` (`sim-profile/` stays with its author), `tools/bench/worker/**`, `tools/bench/baselines/**` | perf integrator |
| tests | `tests/worker/**`, `tests/perf/**` (new) | perf integrator |
| render items | `lodBuilder.ts` (J0), `MiniMap.ts`, LOD batching, `Fireworks.ts` | render owner |
| bot | `tools/simbot.ts`: record the host and `simWasmStatus()` in its JSON; run the balance procedure for B1–B5 | balance owner (WP6) |

### 7.4 Loader init points

- **Worker host.** In `src/worker/simWorker.ts`, on the init message and before the city is deserialized: `await initSimWasmBrowser({ flag })`.
  - Until it resolves, kernels run in JS, with identical results.
  - Production never calls `heap.reserve()` beyond the loader's own 4 MiB, and never adopts layers into wasm memory.
- **LocalSimHost.** In `LocalSimHost.start()`, which absorbs `CityScene.loadSim()`, before `createSystems()`. Not in `main.ts`: the title and region screens don't need it.
- **Bot, vitest, benches.** Nothing to call.
  - Node initialises the kernels synchronously, looking in `$SIM_WASM_PATH`, next to the module, then in `<cwd>/src/wasm/`.
  - `SIM_WASM=js|wasm|auto` selects the path.
- **Pages.** `demo-ui.html` goes through CityScene, like the game. `demo-city.html` renders only and needs nothing.
- **Dev builds** assert at every month boundary that `memory.buffer.byteLength` still equals the initial size.

### 7.5 Flags, fallback and settings

**Flags.** Neither flag changes results in deterministic mode.

| flag | sources | values and precedence |
|---|---|---|
| host | `?simworker=`, `localStorage 'metropolis.simworker'`, `AppSettings.simThread` | `auto`, `0` or `1` (setting: `'auto'` or `'main'`). The URL beats storage, and storage beats the setting. `auto` means the worker, when module workers are available |
| kernels | `?simwasm=`, `localStorage 'metropolis.simwasm'` (both exist already), `AppSettings.simKernels` (new) | `auto`, `js` or `wasm`, optionally per kernel (`kernel:pref`); setting: `'auto'` or `'js'`. The URL wins. The page passes the effective flag to the worker in its init message |

**Settings.** Settings → Performance (advanced) gets two choices: "Simulation thread: Automatic / Main thread" and "Simulation kernels: Automatic / JavaScript only". Both act as kill switches.

**Perf overlay** (`?fps=1`). It shows the host, the kernel mode, `simWasmStatus().state`, days/s, worker ms/day, passes per 60 days, apply ms/day and bytes/s.

**Fallback chain:**
- No module Worker, or the worker fails to start: use LocalSimHost and show one toast.
- The worker crashes mid-game: show the error overlay, offer the recovery snapshot or the autosave, and restart in a new worker.
- No WebAssembly, no SIMD, a bad binary, or a trap: JS kernels. This is the loader's existing behaviour, reported in `simWasmStatus()`.
- Forcing `wasm` throws when wasm is unavailable, so an A/B run never measures JS by accident.

### 7.6 Determinism rules

- **D1. Deterministic mode is the contract.** It means headless `advanceDay` / `runDays` (the bot, tests and harnesses), with scripted actions applied at day boundaries. The same version, save and actions must give bit-identical results across all of these:
  - every host: LocalSimHost, WorkerSimHost, node `worker_threads`;
  - every kernel preference: js, auto, per kernel, toggled mid-run;
  - node 22 and Chromium (V8 12.4 and 14.x);
  - any save and load at a day boundary.

  "Bit-identical" means the same sha256 of `serializeCity({copy: true})` and the same per-system digests.
- **D2. Live mode is not reproducible.** It uses real-time budgets. Compare distributions there, never cities.
- **D3. Randomness stays in JS.** Kernels take values as inputs, and the sim never calls `Math.random`.
- **D4. Kernel arithmetic follows the float rules in `wasm/README.md`.**
  - f64 in JS evaluation order, rounding to f32 exactly where JS stores;
  - no FMA, no reassociation, no fast-math, no relaxed SIMD;
  - JS integer semantics.

  Kernels never re-implement an engine-dependent function (`Math.exp`, `log`, `pow`, `hypot`); they import the engine's own. The services port's hard-coded V8 `hypot` must go before any revival.
- **D5. Kernel caches are never saved.** After a load, both paths start cold. A kernel must reproduce the JS path's cold-start work estimates, because the scheduler's step boundaries depend on them.
- **D6. Production kernels run staged.** A trap or a full heap reruns that call in JS from unchanged inputs. In-place (resident) kernels are not allowed until a re-port proves exact rollback.
- **D7. Both hosts apply actions at the same point:** between ticks, in the order they were posted, through the same code path. The `ActionResult` always comes from the authoritative CityActions.
- **D8. Fixes and the save format.** Exact fixes are bit-identical to the code they replace. Behaviour fixes are deterministic within the new version and pass the balance procedure. Neither may need a save-format change.

### 7.7 Save compatibility

- **S1.** No save-format change: `CITY_SAVE_FORMAT` stays as it is. No wasm, worker or host state is ever saved.
- **S2.** Saves are interchangeable across hosts and kernel modes. Saving in one, loading in the other and continuing for 60 days must give the same result as continuing in place (deterministic mode).
- **S3.** The worker serializes with `serializeCity(st, {copy: true})` and posts without a transfer list. Serializing a live wasm view would clone the whole memory. The main thread gzips the result (`packFile`) and writes it to IndexedDB.
- **S4.** Loading: the main thread runs `unpackFile` and sends the decoded bundle to the worker. A main → worker transfer is allowed here.
- **S5.** Recovery snapshots work with the worker host (§5.1). The recovery tests run against both hosts.
- **S6.** Saves from earlier builds load and continue. They continue bit-identically after the exact fixes, and within the balance tolerances after the behaviour fixes.

### 7.8 Tests

**Kept:**
- `tests/wasm/{blur,blurSim,heap,binary}.test.ts`;
- `node tools/build-wasm.mjs --check`, wherever cargo exists.

**Archived with the ports in PI-6:**
- the roadTransitSearch, roadTransitSearchSim, servicesTierEngine, trafficCore, desirabilityLandValueBands, fieldPasses and populationAggregateProbe suites;
- their `*Original.ts` files and scenario helpers.

**New:**
- `tests/perf/protector.test.ts`. It spawns node with `--trace-protector-invalidation` and the natives probe, then runs 60 headless days of a 128² city (generated, or loaded with zlib and `decodeBundle`), with WASM blur on. It fails on `Invalidating protector cell ArrayBufferDetaching`, or on any growth of wasm memory.
- `tests/worker/protocol.test.ts`: a round trip of every message type, the packed building records and the cell diffs.
- `tests/worker/replica.test.ts`: applies 120 days of the diff stream. At every tick boundary, every replica field, building and consumed layer must equal the authoritative state.
- `tests/worker/hosts.test.ts`: LocalSimHost against WorkerSimHost (node `worker_threads`, real protocol) in deterministic mode, with scripted plop, zone, bulldoze, road and budget actions for 120 days. The hashes must be equal. It also saves in one host and loads in the other.
- `tests/worker/recovery.test.ts`.
- One exactness test per J-fix. The pre-fix code is kept as a frozen, test-only copy, like `tests/wasm/*Original.ts`.

**Browser smoke.** Extend `tools/bench/browser-check.mjs` to the production build with the worker host. It checks that:
- wasm loads in the worker;
- there are no console errors;
- actions round-trip;
- save and load work.

### 7.9 Acceptance criteria for the million-population work (task #35)

**Fixtures:** `dense1m_s7` and `bot256_s7_y60`, both re-grown on the final sim, with about 1.1M and 1.4M residents.

**Machines:**
- **The CI box:** 4 cores, under load. Use CPU-time metrics and the synthetic render.
- **Reference machine R1:**
  - 4 cores / 8 threads, 2019–2021 laptop class (for example Core i5-10210U, Ryzen 5 4500U or Apple M1);
  - 8 GB of RAM, integrated GPU;
  - Chrome stable, 1920×1080, default quality.

| # | criterion |
|---|---|
| AC1 | **Main-thread smoothness on the CI box** (Playwright, 6 ms synthetic render, ultra, 90 days including a month and a year boundary, ≥ 30 runs). Main-thread busy time per frame: p99 ≤ 20 ms, max ≤ 33 ms. 0 long tasks ≥ 50 ms attributable to the sim. Sim-related main-thread work (applying diffs and re-firing events) ≤ 1 ms per sim day |
| AC2 | **The real game on R1** (real renderer, 5 runs per fixture), at ultra. p99 frame ≤ 33 ms, and ≤ the paused city's p99 + 4 ms. No frame over 100 ms after the first 10 s. This depends on the render items in §6 |
| AC3 | **Throughput.** ≥ 19.5 days/s sustained at ultra for 90 days, on both fixtures, on the CI box and on R1 |
| AC4 | **Infrastructure freshness at ultra** (live mode, worker), per 60 sim days. Traffic: ≥ 10 cycles (today 2–3; design 30). Services: every pass that is due under the fixed trigger, and at least one per 6 days. Utilities, pollution and crime: ≥ 90 % of design cadence. At speed 2, every task runs at design cadence |
| AC5 | **Sim CPU.** Worker CPU at ultra on R1 ≤ 45 ms per sim day (≤ 0.9 core). Daily systems ≤ 12 ms per sim day at 1.1M on R1 (today 15.9–17.8 on the CI box). In the node harness, the design-cadence whole day ≤ 0.75 × the PI-1 baseline, paired, with the protector intact in both arms. That is expected to be about 40 ms/day, where today's code measures 53–62 |
| AC6 | **Determinism.** D1 holds for 120 days on both fixtures, and for the bot's 15-year run (yearly hashes). The J-fixes are bit-identical to their predecessors. The B-fixes pass the balance procedure, including `totalMsPerDay` ≤ baseline + 3; it should fall |
| AC7 | **Saves.** S1–S6 hold, with tests |
| AC8 | **Hygiene and robustness.** The protector is intact in the sim isolate after a 30-minute R1 session, and in CI. Wasm memory never grows after init. Every fallback keeps the game playable, with identical deterministic results: no Worker, a worker crash, no WebAssembly or no SIMD, a corrupt binary, a trap |

### 7.10 The WASM re-port gate

A port is revived only if every condition below holds after PI-7. The traffic core is the only expected candidate. The services engine and the other rejected ports would also have to pass G3, which their measurements say they would not.

- **G0. Need.** In the worker profile at 1.1M / 1.4M on the final code, the system is ≥ 25 % of worker CPU at the AC4 cadence, and AC4 or AC5 is missed.
- **G1. Prototype first.** Port the hottest phase against the final code, in at most one week, with the A/B registered in advance. Stop if it misses G3.
- **G2. Equivalence.** Bit-identical against the live JS:
  - ≥ 10k randomized and adversarial differential cases;
  - 120-day city hashes on both fixtures;
  - shadow mode with 0 mismatches.
- **G3. Speed, against the best exact JS** (not the original, and not a weaker "fair" JS):
  - In the Chromium worker, the players' engine: the containing system in situ ≥ 1.25× median, with the CI lower bound ≥ 1.15×.
  - In node, where the bot and tests run: ≥ 1.10×.
  - The whole day at design cadence in the Chromium worker: ≥ 1.05×, with the CI lower bound above 1.00.
  - All arms with the protector intact (checked with the probe), in separate isolates, with pre-sized memory and 0 grows. CPU time, interleaved, ≥ 31 pairs, and the rules in §7.11.
- **G4. Memory.**
  - It fits the pre-sized memory with ≥ 25 % headroom, at 1.5M on a 256² map, counting every adopted kernel.
  - It calls `dispose()` explicitly on unload. No cleanup may rely on FinalizationRegistry alone.
- **G5. Engineering.**
  - It hooks public, documented system interfaces; it does not override private methods.
  - Engine-dependent math is imported (D4).
  - The owning team accepts co-ownership: every PR to the JS system updates the kernel or switches it off. A shadow test in CI enforces this.
- **G6. Rollback.** There is a kill switch per kernel (`?simwasm=kernel:js`), and the trap path is exact (D6).

If a re-port is approved, the architect's memory model applies:
- one `WebAssembly.Memory` per sim isolate, pre-sized at city load for everything it will ever hold;
- kernel state addressed by offsets, never by long-lived views;
- no growth while systems hold views;
- everything freed on unload or `replaceState`;
- never `structuredClone` or `postMessage` a view of wasm memory.

### 7.11 Rules for every A/B in this plan

- **Clock.** Measure CPU time, never single wall-clock runs.
- **Ordering.** Interleave the arms ABAB in rotating order, after warming up both sides (TurboFan for JS; Liftoff then TurboFan for wasm).
- **Statistics.** ≥ 30 repetitions. Report the median, the min and a 95 % bootstrap CI of the paired ratio, plus the load average during the run.
- **Isolates.** One isolate per arm, with the protector state checked in each arm.
  - In node, load fixtures with zlib and `decodeBundle`, never `unpackFile`.
  - Wasm memory is pre-sized, and the run has 0 grows.
- **Data movement.** Include the cost of moving data in and out of wasm memory.
- **Baseline and scope.** Compare against the best exact JS, and report the containing system and the whole day, not just the kernel.

## 8. Risks

| # | risk | mitigation |
|---|---|---|
| 1 | W1 is bigger than it looks: the UI calls 15+ sim functions synchronously (InfoPanel, inspector, tools, overlays) | The replica covers state reads and RPC covers the rest. Migrate panel by panel. LocalSimHost stays as the fallback, and W1 ships behind `?simworker` |
| 2 | The replica diverges: a missed diff type makes the UI show stale state. The sim itself stays correct | A 120-day replica test; a monthly checksum in dev builds; authoritative ActionResults |
| 3 | Recovery snapshots lose more progress with the worker | Snapshots every 30 s and on hide, plus the replica's primary data at unload. The recovery tests run against both hosts |
| 4 | Someone reintroduces a detach in a sim isolate (a transfer list, a stream, `memory.grow`, `ArrayBuffer.transfer`), silently losing 4–16 % | The CI protector test, a review checklist, and a probe warning in dev builds |
| 5 | Behaviour fixes shift the balance | Land them one at a time, with the balance procedure and the baseline JSON |
| 6 | Part-B churn invalidates fixes in flight | Start after part B. One owner per file. Re-derive every fix on the final code |
| 7 | Measurement noise on the shared 4-core box | The rules in §7.11. Confirm on R1 before making anything the default |
| 8 | Messaging cost at ultra: 10–40 MB/s of layer copies | Send only the layer groups the main thread consumes, at most 4 Hz per group, coalesced. Move to W3 SharedArrayBuffer if the cost exceeds 2 ms/s |
| 9 | Workers are unavailable or blocked (old browsers, CSP) | The LocalSimHost fallback; the perf overlay shows which host runs |
| 10 | Cross-engine determinism: Firefox and WebKit are not installed here, so they are untested | Only blur ships, and it uses only `+ − × ÷`. JS's own `Math` differences between engines already exist. Add Firefox and WebKit Playwright runs when they are available |
| 11 | Binary or loader regressions (a stale binary, no SIMD) | `binary.test.ts` and `--check`. The JS fallback stays correct, and the overlay shows the status |
| 12 | Memory footprint: the replica, plus wasm memory per sim isolate, plus helpers | Size the wasm memory to blur's needs (about 8 MiB) instead of 64 MiB. Untouched pages cost nothing. Measure the heap on R1 |
| 13 | W2 merges read live, mid-pass state and diverge | Snapshot inputs at a fixed step. Deterministic mode uses the single-thread path. An identity test |
| 14 | Stale ports get adopted by accident, or left to rot | Archive tag and removal in PI-6. Revival only through §7.10 |
| 15 | The §4 projections for the cadence fixes are wrong | Measure them in PI-5 before AC4 and AC5 are signed off. W2 is the next lever |
| 16 | Render-side spikes remain: the minimap (120 ms), LOD builds, fireworks, a 57 ms major GC | The render items in §6. AC2 isolates the sim's own contribution |

## 9. What we will not do

- Port object-heavy systems, or move buildings to struct-of-arrays, for WebAssembly's sake.
- Keep CityState layers in wasm memory (`adoptLayers`), or run resident kernels in production.
- Ship a second, non-SIMD binary, use relaxed SIMD, or use wasm threads or SharedArrayBuffer (COOP/COEP) in W1.
- Port code that part B is still changing.
- Grow wasm memory, or call `reserve()`, after init.

## 10. Evidence index

**In the repo:**
- `wasm/README.md`: the toolchain, the memory model, and measured tables.
- `tools/bench/**`:
  - the blur, memory and sim benches;
  - `roadTransitSearch/`, `servicesTierEngine*`, `trafficCore/` (including `protector.ts`), `fieldPasses/`, `desirabilityLandValueBands/`, `populationAggregateProbe/`;
  - `sim-profile/`, with the fixture generators.
- `tests/wasm/**` and `src/wasm/**`.

**In the session scratch dir**, `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/`. This is not in the repo: copy what PI-1 needs into `tools/bench/baselines/` before it is cleaned.
- `profile/`: fixtures, per-kernel tables, CPU and heap profiles, the browser trace.
- `toolchain/`: `blur-full.json`, `memory-full.json`, `browser-prod-ab*.json`.
- `architect/`: the calibration harness and `out/cal{1,2}.json`.
- The six reviews: `ab-servicesTierEngine/r2/`, `ab-roadTransitSearch/`, `ab-trafficCore/r2/`, `ab-desirabilityLandValueBands/`, `ab-fieldPasses/`, `ab-populationAggregateProbe/`. Each holds its harness sources, `out/*.json` and logs.

**Fixtures** (in `profile/fixtures/` of the scratch dir):
- `dense1m_s7.metropolis`: 1.12M residents;
- `bot256_s7_y{20..60}.metropolis`: 653k at year 60, before WP6a;
- `stress1m_testdefs_s7.metropolis`: 1.03M, for infrastructure-only benchmarks.
