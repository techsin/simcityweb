# T040 report: R2, BuildingRenderer's geometry work at 2 ms a frame (desktop, real GPU)

**Verdict: done.** Every T040 gate passes, on the real GPU in a quiet slot and in the suite. Live adds and visual
changes now queue and build within a 2 ms budget a frame (at least one entry), so a burst no longer lands in one frame.
After the queue drains, every building's instances are identical to dev's.

Branch `local/T040-r2-buildings`:
- `52a5063` the lane; `0b6e2b1` review round 1; `23c68ea` review round 2; `8ff4fd0` dev `50a6b29` merged in;
- `6bf60ee` round 3: `BudgetedWork`, one hook for later lanes' work in the same budget (T049, T050 and T051 register
  their queues from their own fields; NOTE-054 agreed it); `8ce2f1d` its test fix (lanes register works, so the
  no-work case empties the registry itself, and a new case shows idle registered works keep the build order).

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest with the fixtures (`8ce2f1d`) | **222 files passed, 2 skipped; 2,231 tests passed, 11 skipped; 0 failing** |
| 128×15 s7 bot with the action log | **identical to dev:** residents [ 61124, 93804, 37971 ] = 192,899 |
| Node tests | after the drain the instance buffers equal the synchronous path's (adds, changes, removes, id reuse, remove-before-build); no frame builds longer than the budget plus one entry; the queue drains without starving under a steady stream (`buildingBudget`, 22 tests; `buildingWork`, 12) |

## Real GPU: dev against T040

Quiet slot, 3-4 November, 01:05-02:13 UTC, 62 valid runs: dev `683d02b` against T040 `8ce2f1d`, each run with a fresh
Vite and a fresh browser, ABBA by rep. RTX 5070 Ti, ANGLE D3D11, Chromium 141 headless, cross-origin isolated
(5 µs timers). Harness and tables: scratchpad `qa/T040perf/` (`run_full.sh`, `full1/tables.md`).

**1. BuildingRenderer work per frame at ultra** (ms; per-run values, then the median over runs, worst in brackets):

| City | Tree | Runs | p50 | p99 | max |
|---|---|---|---|---|---|
| bot256_s7_y60 (652k) | dev | 5 | 0.010 | 0.740 (0.790) | 26.60 (29.73) |
| bot256_s7_y60 | T040 | 5 | 0.015 | 0.775 (0.800) | **12.79** (28.21) |
| dense1m_s7 (1.1M) | dev | 8 | 0.015 | 0.738 (0.860) | 3.12 (4.18) |
| dense1m_s7 | T040 | 8 | 0.018 | 0.800 (0.855) | 3.17 (3.83) |

The queue costs +0.04-0.06 ms at p99 and halves bot256's median worst frame. **The worst frame left is one
indivisible build** of about 27 ms (`bmax` 26-29 ms in both trees, at sim days 22,500-23,100 of the bot256 city). On dev
it lands in the building event; on T040 in the drain, which by design admits at least one entry. The queue moves it off
the event frame but cannot split it; it is in docs/dev/POLISH_BACKLOG.md. The other worst frames (9-15 ms at the
window's first frame, `nev` 118) are a non-build entry point, present in both trees.

**2. Bursts with the sim held** (dense1m, HIGH; medians over 8 runs, worst in brackets):

| Scenario | dev: burst frame ms | T040: burst frame ms | T040 frames to drain | frames > 16.7 ms, dev → T040 | T040 drain over budget |
|---|---|---|---|---|---|
| 200 buildings regrow, cold geometry | 16.12 (20.97) | **2.77** (4.45) | 7 (8) | 1 → **0** | 0 |
| 200 regrow, warm geometry | 2.66 (3.88) | 2.27 (2.35) | 1 (1) | 0 → 0 | 0 |
| churn: 1,500 changes, then 4 × 500 | 7.25-7.68 (10.15) | **3.88-4.03** (4.45) | 5 (10) | 0 → 0 | 0 |
| churn at LOW | 11.03 (11.51) | **4.06** (4.08) | 7 (7) | 0 → 0 | 0 |
| bulldoze 200 | 0.53-0.54 | 0.60 | 0 | 0 → 0 | 0 |

Total work rises because it is spread (cold regrow 16.1 → 21.6 ms over 7 frames; churn 14.5 → 21.4 ms), and no drain
in any run went over its budget (2 ms plus its longest single build plus 0.25 ms).

**3. AC2 at ultra** (p99 ≤ 33 ms, p99 ≤ paused p99 + 4 ms, no frame over 100 ms after the first 10 s):
- bot256: dev 5/5, T040 5/5.
- dense1m: dev 8/8, T040 7/8. The failing run (r5, 01:48 UTC) had its **paused** window at 33.3 ms too, where every
  other paused window in both trees read 16.67 ms: the machine was disturbed while it ran. **Rerun** right after
  (two ABBA pairs, 02:25-02:36 UTC, `ac2rerun1/`): dev 2/2, T040 2/2, every paused window 16.67 ms.

**4. Identity after the queue drains** (per building, the multiset of its instances: geometry key, matrix to 1e-4,
colour and flags, visibility, shadow mask, culling tile): **0 differing buildings in all 18 T040 snapshots** (pre-burst,
after bulldoze and regrow, after churn; rounded and exact; the renderer's own per-building state too), 17,154
buildings each, no orphan instances; A/A inside each tree is 0 as well. Screenshots are kept for visual sanity only,
since time-driven animation differs between any two runs.

**NOTE-054, the hook costs nothing when no work is registered:** T040 just before the hook (`8ff4fd0`) against T040
with it and nothing registered (`6bf60ee`, with `8ce2f1d`'s tests), 6 ABBA reps of every burst (`hookab1/`): burst frames
within ±0.3 ms and total drain time +0.6 to +2.0 % (cold regrow 20.16 → 20.36 ms, churn 20.54 → 20.78 ms), inside the
runs' own spread.

The lane's own round notes follow.

## The lane's notes (rounds 1-2)

Branch `local/T040-r2-buildings`, now at merged base `b89dfd0`: WIPs `52a5063` / `0b6e2b1` plus dev `821a8d6`,
including T038's incremental fireworks index. The round-2 review fixes are uncommitted; no push or `.done` file.
Read POLISH_PLAN ownership sections 7.2-7.4 and D13,
WORKER_DESIGN section 6 / R2, WASM_PLAN AC2,
BuildingRenderer and its LOD helpers, and the consuming CityObjectsView paths before implementation.

## Files and queue design

- `src/render/city/buildings/BuildingRenderer.ts`: queue live adds and visual-key changes by `BInst` identity.
  Repeated changes replace `bi.b` in place. A new add waits without instances or a visual (`li = -1`). A pending
  change keeps its old instances, dense-list slot, key, visual, LOD state, animation and fade until its budgeted
  swap. The swap frees and rebuilds in the same call without removing its list slot or emitting a null visual.
  Only removal sends `onVisual(null, id)`; it immediately frees any drawn pending change. Id reuse cancels the
  old object, and removal of an unbuilt add does not call batch removal. A small placement snapshot protects the
  drawn construction progress and lot proportions from mutations to the latest building record while waiting.
- `tests/render/buildingBudget.test.ts`: 22 Node cases covering buffer equivalence, budget/progress, fairness,
  priority, continuous drawing through a pending change, callbacks, exact old-instance frees and allocator
  accounting, pending removal/id reuse, old placement, completion/burnt pops, proxy wakes and synchronous paths.
  The new round-2 case compares exact ordering with the previous Map/tuple comparator across full and shorter waves.
- `tests/render/fireworks.test.ts`: the existing wiring test now drives renderer frames between events and visual
  reads. It compares the incremental index with the full scan before/after queued add, change-before-first-build,
  drawn pending change and automatic visual swap, while retaining visual-only/removal/reset/rebuild/dispose checks.
- `src/render/city/effects/Fireworks.ts`: only the requested `LaunchSiteIndex.update` comment changes. It describes
  nullable queued-add visuals, retained pending-change visuals and catch-up through `onVisual -> visualChanged`.
- This report is the task-named documentation file. No infra or shared-source hunks, and no CityObjectsView wiring
  changes. The two fireworks-file hunks extend the original T040 ownership under the explicit round-2 request;
  the previously cloud-held Fireworks file has only that comment edit. `lodBuilder.ts` and its message format are unchanged.

`BUILD_BUDGET_MS = 2` sits next to `POP_TIME`. `update()` checks `performance.now()` between entries and always
admits at least one entry if work is pending. An indivisible building can overshoot the deadline; a burst cannot
run every build in its event handler. Existing animations advance before queue work, so the first drawn frame
gets the full pop duration even after a long wait. A changed entry continues drawing its old animation until the
swap; construction completion starts `POP_TIME * 0.7` then, and a burnt replacement never pops. Old-model LOD
evaluations, fades and arriving proxies remain valid during the wait; freeing the old instances invalidates
their proxy-wake markers at the swap.

Priority preparation is bounded: take at most the 256 oldest pending entries, put drawn-and-changed entries in
view first, new adds in view next, then out-of-view work; flat distance to the view's ground target breaks ties.
A visible pending change therefore outranks a new off-screen add (and a new visible add) within the same wave.
Changed entries use the old drawn visual's position and bounds, not a potentially moved latest record. It uses the existing
`warmTarget` camera-axis/ground projection, and the live matrices of the camera retained by `updateLod`; no caller
or camera API changes are needed. The first frame before any LOD camera is known uses insertion order. Priority
is within each wave. Later arrivals cannot overtake the unfinished wave, so off-screen work cannot starve under
a steady stream of near-camera events. The cap avoids sorting a whole city-scale queue in one frame. Deadline
checks include priority preparation, including a check after preparing a later wave in the same frame.

Round 2 removes the per-wave Map, per-entry tuple allocations and Map lookups in the sort comparator. Priority
keys use reusable `Uint8Array` ranks and `Float64Array` distances; a reused index array sorts by rank, distance,
then insertion index. Double precision and stable ties match the former comparator exactly. Two reusable entry
arrays transfer the sorted references; temporary references are cleared before returning. The target vector is
also reused. Wave size, admission order, budgets, geometry and visual callbacks are unchanged. No new timing
claim is made for this optimization; the reference-order test covers 256-, 44- and 17-entry waves and all ranks/ties.

`pendingBuilds` exposes the remaining queue size for capture/timing harnesses. `count` counts built entries:
pending changes remain counted, while undrawn adds do not inflate building or proxy statistics. No simulation, host, save schema, balance,
or RNG changes were made.

## Synchronous paths retained

- `add(b, false)` remains the explicit bulk path used by `rebuildAll()` and existing render fixtures. The live
  CityObjectsView event subscription calls `add(b, true)`. A live burnt add still queues even though rubble has no pop.
- `rebuildAll()` clears pending work and immediately builds the current state's buildings. CityObjectsView's
  constructor/load, reset, and state replacement already call it: the city is complete for initial rendering,
  shader warm-up and LOD proxy prefetch.
- Quality switches drain pending geometry synchronously and retain the existing synchronous rubble-kit rebuild
  and full LOD evaluation. The twig-strip quality path still uses `rebuildAll()` / `flushLod()` and preserves the
  previous proxy level of queued entries as well as drawn entries, so its hysteresis band is unchanged.
- `flushLod()` now also drains geometry before settling proxies and levels, preserving its capture/benchmark
  contract. Captures must also let pop animations finish if they want a settled picture.
- Terrain edits still synchronously rebuild foundations of already built entries with no pending change. Queued
  entries keep waiting and read the latest heights at the swap. Initial rubble-kit shadow setup also skips a pending
  change, so it cannot accidentally rebuild the latest state outside the queue. Construction-progress-only changes still update placement immediately
  for a built construction site. Neither path creates a second queued entry.

## Every inst/list reader

`inst` registers both queued and built entries; `list` and all flat LOD arrays contain built entries, including
drawn entries with a pending change. Only new pending adds have no drawn state.

| Reader | What a queued entry does |
|---|---|
| `count`, `pendingBuilds` | Counts pending changes as drawn and pending; new adds only as pending. |
| `getVisual`, `visuals` | Returns/yields the old visual for a pending change; returns null / omits an unbuilt add. |
| CityObjectsView `pickRay`, hover/query picking | Continues receiving the old visual for pending changes; no invisible box for an unbuilt add. Live sim changes preserve the lot footprint (see caveat below). |
| CityObjectsView `setSelected`, Previews selection | Pending changes keep their old selection mesh and can be selected normally; unbuilt adds wait for build. |
| `onVisual` / `BuildingVisual`, Effects `onBuilding`, selected preview callback | A change emits only the new visual once at its swap. There is no null callback or emitter teardown during the wait. An unbuilt add announces nothing; removal of a drawn entry emits null. |
| CityObjectsView fireworks `visualOf` / T038 `LaunchSiteIndex` | Building events update the index with current building fields and an old/null visual. The index matches the full scan in that state; `onVisual -> visualChanged` updates it when the queued build/swap runs. Fireworks runtime logic and CityObjectsView wiring are unchanged. |
| `add`, duplicate-id add, `remove`, `clear`, `rebuildAll` | Operates on object identity, cancels pending work, skips resources/list slots never allocated; clear/rebuild also releases wave references. |
| `changed` | Replaces queued `b` and retains queue position and the old drawn state. With no pending rebuild, progress-only changes still update placement. |
| `setSelected` | Updates color/LOD of the old drawn visual. Skips `li < 0`; build reads the selection. |
| `terrainChanged` | Skips pending changes and unbuilt adds; their eventual swap/build reads current terrain. |
| Rebuild prefetch scoring, `resolveProxies`, `flushLod` | Only iterates built geometries. Flush first builds pending entries. |
| `updateLod`, `scan`, `deferOut`, `deferSlice`, `catchUp`, `lodEval` / `lodSet` | Evaluates the old geometry and flat arrays of pending changes normally. New adds have no list slot. A swap retains its slot and proxy count; build adjusts the count if its new model cannot keep the old level. |
| `lodQueue` | Ignores unbuilt entries. Build queues the first real evaluation without a fade. |
| `installProxy`, `lodWaiting`, `wakeWaiting` | Keeps old-model waits/wakes valid while a change is pending; skips unbuilt/gone entries. Actual free/swap invalidates waiting and `wakeGeom`, so stale wakes cannot affect the replacement. |
| `warmLod`, `warmSave`, `warmRestore`, `warmProxy`, `kitShadows` | Warm-up sees the old built state of pending changes. Initial kit setup skips rebuilding pending changes; synchronous quality/load paths settle geometry. |
| Quality `keepLod` | Snapshots proxy levels from all `inst` entries before the synchronous twig rebuild, including drawn pending changes. |
| `animating`, `update` / `place` | Pending changes keep animating the old placement snapshot; latest progress/dimensions cannot reshape it early. New adds have no membership. Completion starts its pop at swap; burnt/removal clears membership. |
| `fades`, fade distance/color/progress and layer synchronization | Pending changes keep their old fade and can change LOD normally. Actual swap/removal frees its fade. First new-model LOD evaluation stays instant (`fresh`). |
| Queue ordering/draining | Uses drawn visual bounds for changes and latest fields for undrawn adds; cancelled object references are skipped even when the id has been reused. |

## Verification

The worker reports WIP `52a5063` passed TypeScript, the full suite (217 files, 2,159 tests), and the bot (192,899),
and merged base `b89dfd0` passed TypeScript. For round 2, all seven targeted files below and TypeScript were rerun in this worktree, sequentially
through the quiet gate. No browser, full-suite rerun, benchmark, commit or other worktree was used. TypeScript
and `git diff --check` are clean. Exact TypeScript command:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

The original lane run encountered `spawn EPERM` in the default config/fork launch, and `--configLoader runner`
failed on a CommonJS dependency. The native-config/thread-pool launch that succeeded then was reused for this
revision, without changing repository config. Each test file ran separately through the gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---|
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/fireworks.test.ts` | 12 passed, 2 skipped (large SIM_FIXTURES files unavailable) |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/render/rubbleKitLow.test.ts` | 2 passed |
| `tests/render/cutShadows.test.ts` | 2 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Round-2 total: **102 passed, 3 skipped**. Only `fireworks.test.ts` imports `tests/render/fireworksHarness` under
`tests/`; all its harness-based cases ran except the two optional large-fixture identity cases. No bench was run.
The three requested core render files (`fireworks`, `lod`, `buildingBudget`) all pass. The round-1 total was
89 passed, 1 skipped. Its seven new cases verify old main/site/foundation instances, key,
visual and list-slot identity across every waiting frame; one atomic swap with exactly one positive callback;
exact old-instance frees including rubble pieces; active instance counts and the ordered allocator free-list
equal to the manual former synchronous free/build path after draining; immediate pending removal; safe id reuse
in an active wave; stable old placement under mutable latest fields; burnt no-pop; and drawn-visible priority.
Prior tests now expect old LOD/proxy wakes to remain valid during a pending change and null callbacks only on
removal. The completion pop still starts at `POP_TIME * 0.7` at the swap.

The queue tests use a deterministic clock and charge actual `build` calls controlled entry costs (0.65 ms and
3.25 ms). They verify each update builds at least one entry, stays within 2 ms plus one entry, drains, and does
not starve old work under continuing near-camera additions. These are scheduling tests, not real-machine timings.

Buffer equivalence compares exact active geometry attribute bytes, normalized indices, matrices, colors,
visibility, visuals, materials and LOD levels, by building id and role (main/site/foundation/rubble pieces).
The dedicated changed-entry allocator test also compares raw active-instance flags and the ordered free-list
with a synchronous swap baseline after draining. Across arbitrary add/remove priority sequences, raw allocation
indices and unused buffer slots can differ: priority changes allocation order and coalescing
avoids allocating intermediate states. Pixel identity still requires the GPU screenshot gate below.

### Bot (prior verification, unchanged expectation)

No bot was rerun for the round-1 or round-2 render-only revisions. The worker confirmed the required WIP result above;
the original local run below also matched it. Expected residents remain **[61124, 93804, 37971] = 192,899**.

The prescribed command was attempted:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

It could not start because `tsx` is unavailable in the offline npm cache (`ENOTCACHED`). An equivalent run of
the unchanged bot completed using Node 22's TypeScript transformer and a scratch-only extension resolver:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T040/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Exit 0; Medium / plains; 2015 residents **[61124, 93804, 37971] = 192,899**, matching the task exactly.
Full output: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T040/scratch/simbot-128-y15-s7-native.log`.
No 256x60 bot, separate Hard run, or two-process yearly hash probe was run; no balance change is expected.

## Worker GPU smoke and remaining timing handoff

*(Cloud note, Nov 3: this section and the browser checklist below date from round 2. The "pending" tables are
superseded by "Real GPU: dev against T040" at the top. See "Cloud carry-over (Nov 3)" at the end.)*

The worker supplied these smoke results on the merged trees before the round-2 edits. They were not rerun locally:

| Smoke check | Worker-reported result |
|---|---|
| Settled renderer identity | 0 differing buildings in every harness scenario after the queue drains |
| Cold 200-building regrow | Before: 19.15 ms in one frame; queued path: at most 3.30 ms per frame |

These are smoke results, not the >=8-repetition p50/p99/max tables, AC2's five-run frame gate, or pixel-diff
screenshot pairs. The allocation optimization's timing still needs measurement in the worker's quiet slot.

The following tables are placeholders for the worker's quiet-slot runs, not results. Building work's 2 ms
deadline permits one indivisible build to overshoot; existing per-frame LOD evaluation, animations, proxy replies
and synchronous paths remain separate costs. Only real-GPU measurements can establish AC2.

| BuildingRenderer per-frame work, ultra | Reps per arm | Before p50 / p99 / max | After p50 / p99 / max |
|---|---|---|---|
| Dense 256 city growth | >= 8 | pending | pending |
| 200-building bulldoze and regrow | >= 8 | pending | pending |

| AC2 frame time, ultra | Runs per arm | Before p99 / paused p99 / max after 10 s | After p99 / paused p99 / max after 10 s |
|---|---|---|---|
| `bot256_y60` | 5 | pending | pending |
| `dense1m` | 5 | pending | pending |

Each AC2 arm needs p99 <= 33 ms and <= paused p99 + 4 ms, with no frame > 100 ms after the first 10 s.

| Paused, fixed-camera screenshot pair | Before | After | Pixel diff |
|---|---|---|---|
| LOW, queue/proxies/animations settled | pending | pending | pending; must be zero |
| HIGH, queue/proxies/animations settled | pending | pending | pending; must be zero |

## Plan/code observations and remaining checks

- Proxies already have a worker pool. This change budgets on-main-thread building allocation/geometry, kit,
  foundation and site work; it does not change LOD worker messages or the separate LOD fallback budget.
- Explicit synchronous bulk adds, terrain rebuilds and capture flushes existed in the code. They are retained;
  priority is within bounded FIFO waves to combine view preference with fairness and bounded preparation.
- The original task's "queued building is not drawn yet" now applies to new adds. The review explicitly requires
  an already drawn pending change to retain its old visual until its atomic swap; it never sends a null change
  callback. Pending drawn changes remain pickable/selectable and counted in LOD statistics.
- Picking caveat: `CityObjectsView.pickRay` combines `getVisual` with the live simulation's lot grid/footprint.
  Current simulation change events preserve lot placement and size, so they continue picking the old drawn
  building. Synthetic relocation/footprint changes would require that consumer to retain old lot candidates and
  pick bounds until the swap; that API extension was not added to this renderer-only fix.
- Raw global buffer-slot equality would conflict with prioritized allocation and skipped intermediate builds.
  The new equivalence tests compare the active bytes that draw each building. GPU pixel equality is outstanding.
- No cloud-held file requests or infra hunks are needed. The explicit round-2 request authorizes the Fireworks
  comment and existing fireworks test outside the original building-helper ownership; those are the only such hunks.
- The revised full Vitest suite is left to the lead as requested; the worker's full-suite result is for WIP
  `52a5063`. Real-GPU timing, screenshots, browser playability and old-save continuation were not verified here.
  No new bot or separate Hard run was made for this revision; no balance, simulation or RNG code changed.
- The two skipped fireworks fixture-identity cases still need `SIM_FIXTURES` containing `bot256_s7_y60.metropolis`
  and `dense1m_s7.metropolis`. The normal `fireworksHarness` stand-in cases and actual CityObjectsView wiring case passed.

Browser checklist:

- [ ] Ultra dense 256 growth and 200-building bulldoze/regrow: collect >= 8 before/after reps and p50/p99/max
  BuildingRenderer work; observe visible-first pop-in and eventual off-screen completion. Include a disaster burst.
- [ ] `bot256_y60` and `dense1m`: 5 before/after runs each, including paused baselines; verify both p99 limits and
  the >100 ms rule after 10 s.
- [ ] LOW and HIGH: paused fixed camera, wait for `pendingBuilds === 0`, pop/fades complete and proxies settled;
  capture before/after pairs and require zero differing pixels.
- [ ] During abandonment/fire/completion/disaster waves, already drawn buildings remain visible and pickable with
  their old selection/effects until each swap; no blank frame or null emitter teardown. Visible changes are
  prioritized before new adds in the same wave. New adds stay undrawn until built; pending removal/id reuse leaves no ghost.
- [ ] Start a fireworks show with queued adds and pending changes: launch sites catch up at visual swaps without
  manual refresh; repeat after reset and quality switches, with LOW/HIGH screenshot pairs.
- [ ] Load/reset an existing city and switch LOW/HIGH with work pending: buildings and rubble/foundations settle
  synchronously; continue an old save; confirm construction and completion pops start at actual build time.

## Cloud carry-over (Nov 3)

The desktop is unavailable (NOTE-044), so the cloud re-checked this lane on `cloud/t040`. The branch starts from
`local/T040-r2-buildings` (`5b0f7de`) and merges dev `63c8f58`. This step only verifies the lane; it adds no new
feature work. The real-GPU timing, AC2 and identity runs above are the desktop's (RTX 5070 Ti). They cannot be re-run
here: WebGL in this container runs on SwiftShader, and this step starts no browser. The merge step runs the full vitest
and the bot on the merged tree.

### Gap list (written before the work)

Sources:
- the task file;
- NOTE-045, NOTE-046, NOTE-054 and NOTE-057 (the NOTEs that name T040), and NOTE-044;
- WORKER_DESIGN §6 row R2 in full, with its acceptance "AC2 on R1";
- WASM_PLAN §7.9 AC2;
- the report above;
- the diff against dev.

| # | Required | State found | Cloud action |
|---|---|---|---|
| 1 | A per-frame queue keyed by the `BInst` object. The latest state wins, and a remove before the build cancels it | done (`buildQueue: Set<BInst>`; `changed()` of a queued entry only replaces `bi.b`) | re-test; mutation-check the cancel path |
| 2 | `update()` builds until a 2 ms budget runs out: a constant next to `POP_TIME`, timed with `performance.now()`, at least one entry a frame | done (`BUILD_BUDGET_MS = 2`, `drainBuilds`) | re-test; mutation-check the deadline |
| 3 | Entries in view or nearest the target go first. The pop starts at the build | done (bounded 256-entry waves: frustum rank, then flat distance to `warmTarget`; animations advance before the drain) | re-test; mutation-check the priority |
| 4 | rebuildAll, load or reset, and a quality switch stay synchronous; say which paths and why | done ("Synchronous paths retained") | re-read against the code: `update()` drains all when `lodPixels` changed (it runs before `updateLod` in CityObjectsView); `flushLod` and `rebuildAll` (via `add(b, false)`) also drain all |
| 5 | A remove of an unbuilt entry frees nothing; a change of a queued entry updates it in place | done (`unbuild` returns early for `li < 0`) | re-test |
| 6 | Every reader of inst/list sees a consistent state, and the report lists each one | done (the table above) | check against the merged CityObjectsView (dev's T052 garbage hooks read no BuildingRenderer state) |
| 7 | Identical after the drain: in node, the instance buffers equal the synchronous path's; on the real GPU, pixel-identical screenshots (paused, fixed camera, LOW and HIGH) | node equivalence at LOW (11 px) and HIGH (9 px) done. **On the GPU the desktop compared per-building instances instead of pixels** (0 differing buildings in 18 snapshots of 17,154) | judge the substitution (decision 1) |
| 8 | Node gates: equal buffers after the drain; no frame longer than the budget plus one entry; the queue drains without starving | done: `buildingBudget` (22 tests), `buildingWork` (12), `fireworks` (+1 extended case) | run them; each must fail with its fix reverted |
| 9 | Real GPU: per-frame work, ≥ 8 reps, p50/p99/max, on the dense 256 city at ultra and on a 200-building bulldoze and regrow | done (dense1m 8 runs; bursts 8 runs; bot256 5 runs as an extra) | desktop-only; check the tables for consistency |
| 10 | Real GPU: AC2 at ultra on bot256_y60 and dense1m, 5 runs each, before and after | done: bot256 5/5 both trees; dense1m dev 8/8, T040 7/8 plus a 2/2 rerun | desktop-only; judge the disturbed run (decision 3) |
| 11 | NOTE-054: with nothing registered, the hook costs nothing; show the drain time against the tree before the hook | done (`hookab1/`, 6 ABBA reps: +0.6 to +2.0 % total drain, burst frames ±0.3 ms) | check it structurally in the code (decision 4) |
| 12 | `owns`: Fireworks.ts and MiniMap.ts untouched | a 2-line doc-comment hunk in `Fireworks.ts` (`LaunchSiteIndex.update`); MiniMap untouched | judge it (decision 5) |
| 13 | tsc, the full vitest, the bot identical (192,899) | green on the desktop at `8ce2f1d` (222 files / 2,231 tests; bot 192,899) | tsc here on the merged tree; the merge step runs the full vitest and the bot |
| 14 | No src/sim, src/worker, src/game or save change | to confirm from the diff | confirm |
| 15 | Merge dev | dev was 17 commits ahead (T052, NOTE-053 to NOTE-058) | merge; resolve any conflicts keeping both sides |
| 16 | WIP saved mid-edit: `52a5063`, `0b6e2b1` and `23c68ea` are `wip`; there is a stash snapshot `local/T040-r2-buildings-snap` (`3637220`) | to verify | compare the snapshot with the head, and read the final code line by line |
| 17 | Report and done marker | present; the round-2 notes still carry "pending" placeholder tables and an unticked checklist | add a pointer line and this section; append a done-marker line |

### What the cloud did

- **Merged dev `63c8f58`** in `5d8defe`. It merged cleanly: no file is changed on both sides.
- **tsc** (`npx tsc --noEmit`, under the cpu semaphore) on the merged tree: exit 0, no output. `git diff --check`
  against dev is clean.
- **The diff against dev** touches only `src/render/city/buildings/BuildingRenderer.ts` (+230/-31), a doc comment in
  `src/render/city/effects/Fireworks.ts`, three test files under `tests/render/`, and docs. No file under src/sim,
  src/worker, src/game or src/save changes, and no save format changes. The bot cannot change.
- **The WIP snapshot** (`local/T040-r2-buildings-snap`, `3637220`, saved at 20:50 UTC): its src and tests are
  byte-identical to `23c68ea` (review round 2). Nothing in it was lost. Rounds 3 (`6bf60ee`, the hook) and `8ce2f1d`
  (its test fix) came after it, and `5b0f7de` changes docs only.
- **I read the final BuildingRenderer hunks line by line.** Nothing needed fixing:
  - `add` and `remove`. They work by object identity, and `unbuild` swap-removes the list slot and the flat LOD
    arrays exactly as before.
  - `buildNow`. The completion pop (`POP_TIME * 0.7`) fires on the same condition as before: the old key was
    constructing, and the new state is neither constructing nor burnt.
  - `orderBuilds`. It uses reusable typed arrays and a stable sort by (rank, distance, index).
  - `drainBuilds` and the hook's `drainBudgetedWork`. Both check the deadline after any wave preparation.
  - The `pose` snapshot in `place()`. It reads only `w`, `d`, `rot` and `built`, which tsc enforces through `Pick`,
    and `built` follows the latest record unless a rebuild waits.
  - `wakeGeom`. `freeInstances` invalidates it, and `build` always calls `lodQueue`, so a skipped stale wake loses no
    evaluation.
  - The `terrainChanged` and `kitShadows` skips.
  - `setSelected`, `lodQueue` and the quality `keepLod` over `inst`.
  - `clear` and `dispose`, which empty the queue, the wave and every registered work.
- **The readers (gap 6).** In src, `BuildingRenderer` is constructed only by CityObjectsView. Its only callers of
  `add`, `changed`, `remove`, `update`, `updateLod`, `getVisual` and `count` are the event handlers, `pickRay`,
  `setSelected`, the fireworks `visualOf` and `stats()`. `visuals()` has no caller outside the tests. The handlers dev
  added for T052 (`garbageBuildingChanged`) read the building record, not the renderer. `tests/render/garbageView.test.ts`
  (dev's, 1 test) drives a real CityObjectsView on the merged tree and passes.
- **The hook's consumers.** `local/T049-new02-noroad`, `local/T050-feel14-weight` and `local/T051-feel15-smoke` each
  register a work with `private x = this.addBudgetedWork({...})` from a field, as designed, and each contains `8ce2f1d`.
  This step makes no code change to BuildingRenderer, so their T040 commits stay current.
- **The lane's tests** (`npx vitest run --configLoader runner --maxWorkers=2`, under the cpu semaphore):
  `buildingBudget`, `buildingWork` and `fireworks`, 3 files, **46 passed, 2 skipped**, 6.1 s. The 2 skips are T038's
  `SIM_FIXTURES` fireworks identity cases. They drive a `LaunchSiteIndex` rig without a BuildingRenderer, so T040 does
  not reach them.
- **Mutation checks (each test must fail with its fix reverted).** Each mutation below was applied alone to
  `BuildingRenderer.ts` in a throwaway detached worktree (`co/t040-revert`, removed afterwards). The three lane files
  were run, and the source was restored each time. Every mutation fails tests:

| Mutation | Fails |
|---|---|
| M0: dev's `BuildingRenderer.ts` (the whole fix reverted) | 35 of 46: every `buildingBudget` and `buildingWork` case, plus the extended fireworks wiring case |
| M1: no deadline (`BUILD_BUDGET_MS = 1e9`) | 18: both budget-bound cases, LOW/HIGH buffer equivalence, the wave/starvation case, the old-instance-per-frame cases, and the hook's deadline, alternation and fairness cases |
| M2: no cancel check in the no-work drain | 3: stale entries across id reuse in a partially built wave, and both no-registered-work order cases |
| M3: no view priority (insertion order) | 3: visible before off-screen, the stable reference order across waves, and drawn-visible changes first |
| M4: the hook without build/work alternation | 6: alternation, the shared deadline, no starvation, drain-all, deadline recheck, clear and fairness reset |

  One note on test strength, not a defect: under M2, "skips an old drawn pending change after its id is reused inside
  an active wave" still passes. Its `remove` empties the queue, which already resets the wave. The partially built wave
  case covers the cancel path.
- **The evidence.** The raw harness, tables and screenshots (`qa/T040perf/`: `full1/`, `ac2rerun1/`, `hookab1/`) stayed
  in the desktop's scratchpad and are not in the repository, so only the report's tables could be checked. They agree
  with each other:
  - the cold regrow's total of 21.6 ms over 7 frames is about 3.1 ms a frame, which is 2 ms plus the overshoot of
    one entry;
  - every drain stayed within its stated bound;
  - the 17,154 buildings per identity snapshot is dense1m's count in docs/dev/TEST_CITIES.md;
  - the worst frame of about 27 ms appears on both trees and is in POLISH_BACKLOG.
- **No browser was started.** The step says not to, and the desktop ran every browser and GPU check.

### Gates

| Gate | Result |
|---|---|
| tsc (merged tree `5d8defe`) | clean (exit 0) |
| The lane's test files, 3 | 46 passed, 2 skipped (T038's fixture cases, not reached by T040) |
| Dev's CityObjectsView test on the merged tree (`garbageView`) | 1 passed |
| Mutations | 5 applied, 5 caught (35 / 18 / 3 / 3 / 6 failing tests) |
| Full vitest | at the merge step (desktop at `8ce2f1d`: 222 files / 2,231 tests passed) |
| Bot 128×15 s7 | at the merge step. No src/sim, src/worker, src/game or src/save change, so the expected value is identical: 192,899 (desktop: identical) |
| Real-GPU timing, AC2, identity after the drain | the desktop's runs above; not re-runnable here |

### Decisions

1. **Pixel-identical screenshots were replaced by per-building instance identity.** I accept the substitution. The gate
   as written cannot be met: two runs of the same tree differ in pixels, because time-driven animation keeps running
   while paused.
   - The desktop compared everything the batch draws for each building: the geometry key, the matrix to 1e-4, colour
     and flags, visibility, the shadow mask and the culling tile. 0 buildings differ in all 18 snapshots of 17,154,
     the A/A inside each tree is also 0, and no instance is orphaned.
   - The node test compares the active attribute bytes at both LOW and HIGH.
   - The only thing neither covers is draw order inside the batch. Priority changes the allocation order, and that
     can show only on coplanar faces.
   - If the lead still wants literal LOW/HIGH pairs, they can run on SwiftShader as a function check, but an A/A pair
     will not be zero there either.
2. **AC2 was measured on the desktop's RTX 5070 Ti, not on reference machine R1** (a 4-core laptop with an integrated
   GPU). The task file defines T040's gate as the worker's real GPU, and that gate passes. "AC2 on R1" itself stays
   open, and W1.4's acceptance repeats it. T040 does not claim it.
3. **AC2's one dense1m miss is accepted as machine disturbance.** The run's own paused window read 33.3 ms, against
   16.67 ms in every other paused window of either tree. The rerun right after passed 2/2 on both trees, and dev passed
   8/8.
4. **NOTE-054's hook costs nothing when no work is registered.** I accept the measured +0.6 to +2.0 %.
   - With an empty registry, the only added work is one `budgetedWorks.length` test per frame in `drainBuilds`, plus
     a loop over an empty array in `clear` and `dispose`.
   - The same T040 code measured 21.6 ms (`full1`) and 20.36 ms (`hookab1`) of total cold-regrow drain in two
     sessions. That 6 % session-to-session spread is larger than the hook's difference.
5. **The Fireworks.ts hunk is accepted**, although `owns` excludes the file. It is a doc comment only, on
   `LaunchSiteIndex.update`. T038 is already in dev, so nothing conflicts.
6. **The indivisible ~27 ms build is outside T040's scope.** R2's text quotes a maximum of 14.8 ms, an older figure.
   The build exists on both trees, the queue moves it off the event frame by design, and it is in POLISH_BACKLOG.
7. **The browser checklist in the round-2 notes is not a task gate.** It was the lane's own list, not the task file's
   (disaster bursts, fireworks with queued work, load/reset with pending work). Node tests cover each behaviour, and
   this step runs no browser. Nothing is left for the desktop beyond decision 1, if the lead asks for it.
8. **No code change**, so the branches built on `8ce2f1d` (T049, T050 and T051) stay valid (NOTE-057).
