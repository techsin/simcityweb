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
