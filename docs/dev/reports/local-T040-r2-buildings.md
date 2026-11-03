# T040: BuildingRenderer geometry budget

Branch `local/T040-r2-buildings`, based on `fb1531f` plus the task commit. Changes are uncommitted; no push or
`.done` file. Read POLISH_PLAN ownership sections 7.2-7.4 and D13, WORKER_DESIGN section 6 / R2, WASM_PLAN AC2,
BuildingRenderer and its LOD helpers, and the consuming CityObjectsView paths before implementation.

## Files and queue design

- `src/render/city/buildings/BuildingRenderer.ts`: queue live adds and visual-key changes by `BInst` identity.
  Repeated changes replace `bi.b` in place. Removing or replacing an id cancels the old object. Queued entries own
  no batch instances and have `li = -1` and no visual. Existing geometry, fades, animation membership and visual
  effects are detached when a drawn entry is queued. Removal of an unbuilt entry does not call batch removal.
- `tests/render/buildingBudget.test.ts`: 14 Node cases, including exact active-buffer equivalence at LOW/HIGH,
  cancellation before and after a priority wave starts, id reuse, budget/progress, steady arrivals, priority,
  readers/callbacks, pop timing, completion, reentrant callbacks, stale proxy wakes, synchronous paths and retained
  queued LOD hysteresis across a twig-quality rebuild.
- This report is the task-named documentation file. No other source files changed. No infra hunks, no hunks in
  shared files, and no cloud-held files changed. `lodBuilder.ts` and its message format are unchanged.

`BUILD_BUDGET_MS = 2` sits next to `POP_TIME`. `update()` checks `performance.now()` between entries and always
admits at least one entry if work is pending. An indivisible building can overshoot the deadline; a burst cannot
run every build in its event handler. Existing animations advance before queue work, so the first drawn frame
gets the full pop duration even after a long wait. Construction completion also starts its pop when built.

Priority preparation is bounded: take at most the 256 oldest pending entries, sort that finite wave by estimated
lot-sphere intersection with the view frustum, then flat distance to the view's ground target. It uses the existing
`warmTarget` camera-axis/ground projection, and the live matrices of the camera retained by `updateLod`; no caller
or camera API changes are needed. The first frame before any LOD camera is known uses insertion order. Priority
is within each wave. Later arrivals cannot overtake the unfinished wave, so off-screen work cannot starve under
a steady stream of near-camera events. The cap avoids sorting a whole city-scale queue in one frame. Deadline
checks include priority preparation, including a check after preparing a later wave in the same frame.

`pendingBuilds` exposes the remaining queue size for capture/timing harnesses. `count` counts built entries, so
queued entries do not inflate rendered-building or proxy statistics. No simulation, host, save schema, balance,
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
- Terrain edits still synchronously rebuild foundations of already built entries. Already queued entries wait
  and read the latest heights when built. Construction-progress-only changes still update placement immediately
  for a built construction site. Neither path creates a second queued entry.

## Every inst/list reader

`inst` registers both queued and built entries; `list` and all flat LOD arrays contain only built entries.

| Reader | What a queued entry does |
|---|---|
| `count`, `pendingBuilds` | Counts zero drawn buildings and one pending build. |
| `getVisual`, `visuals` | Returns null / omits it. |
| CityObjectsView `pickRay`, hover/query picking | `getVisual` is null, so no invisible building hit box. |
| CityObjectsView `setSelected`, Previews selection | No selection mesh until built; `selected` is retained. |
| `onVisual` / `BuildingVisual`, Effects `onBuilding`, selected preview callback | No positive callback before build. A formerly built entry sends null when detached, removing emitters/selection; its built callback restores them. |
| CityObjectsView fireworks `visualOf` | Receives null while queued, as for any missing visual. Fireworks code is unchanged. |
| `add`, duplicate-id add, `remove`, `clear`, `rebuildAll` | Operates on object identity, cancels pending work, skips resources/list slots never allocated; clear/rebuild also releases wave references. |
| `changed` | Replaces queued `b` and retains queue position. Only built entries can take the progress-only `place` path. |
| `setSelected` | Records selection, skips color/LOD work for `li < 0`; build reads the selection. |
| `terrainChanged` | Skips unbuilt entries; their eventual build reads current terrain. |
| Rebuild prefetch scoring, `resolveProxies`, `flushLod` | Only iterates built geometries. Flush first builds pending entries. |
| `updateLod`, `scan`, `deferOut`, `deferSlice`, `catchUp`, `lodEval` / `lodSet` | Dense built-only list: no placeholder positions, invalid geometry ids or queued LOD counts. Prior LOD state survives detachment, is uncounted while absent, and is counted again on build. |
| `lodQueue` | Ignores unbuilt entries. Build queues the first real evaluation without a fade. |
| `installProxy`, `lodWaiting`, `wakeWaiting` | Skips unbuilt/gone entries. `wakeGeom` invalidates wakes from an earlier build, including a stale reference to the same `BInst` after it is rebuilt. |
| `warmLod`, `warmSave`, `warmRestore`, `warmProxy`, `kitShadows` | Operates only on built list entries; synchronous quality/load paths settle pending geometry. |
| Quality `keepLod` | Snapshots retained proxy levels from all `inst` entries, including queued entries, before the synchronous twig rebuild. These retained levels do not count as drawn while queued. |
| `animating`, `update` / `place` | Queued entries have no animation membership. Build starts/resumes the pop; removal clears membership. |
| `fades`, fade distance/color/progress and layer synchronization | Detachment frees any prior fade; a queued entry cannot start or advance one. First built LOD evaluation stays instant (`fresh`). |
| Queue ordering/draining | Reads the latest building fields, not an unallocated visual; cancelled object references are skipped even when the id has been reused. |

## Verification

All commands ran in this worktree, sequentially. No browser, full test suite, benchmark, commit or other worktree
was used. `npx tsc --noEmit` and `git diff --check` are clean.

The prescribed default Vitest launch failed before tests with `spawn EPERM` (Vite config loading; native config
then also exposed the blocked fork pool). `--configLoader runner` failed on a CommonJS dependency. Native config
plus the thread pool succeeded, without changing any repository config. Each file ran separately through the gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---|
| `tests/render/buildingBudget.test.ts` | 14 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/render/rubbleKitLow.test.ts` | 2 passed |
| `tests/render/cutShadows.test.ts` | 2 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

The queue tests use a deterministic clock and charge actual `build` calls controlled entry costs (0.65 ms and
3.25 ms). They verify each update builds at least one entry, stays within 2 ms plus one entry, drains, and does
not starve old work under continuing near-camera additions. These are scheduling tests, not real-machine timings.

Buffer equivalence compares exact active geometry attribute bytes, normalized indices, matrices, colors,
visibility, visuals, materials and LOD levels, by building id and role (main/site/foundation/rubble pieces).
Raw allocation indices and unused buffer slots can differ: priority changes allocation order and coalescing
avoids allocating intermediate states. Pixel identity still requires the GPU screenshot gate below.

### Bot

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

## Real-GPU handoff (unmeasured)

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
- Raw global buffer-slot equality would conflict with prioritized allocation and skipped intermediate builds.
  The new equivalence tests compare the active bytes that draw each building. GPU pixel equality is outstanding.
- No cloud-held file requests or infra hunks are needed. No changes outside the task-named source/test/report paths.
- The full Vitest suite is left to the lead as requested. Real-GPU timing, screenshots, browser playability and
  old-save continuation were not verified here. The normal `npx tsx` launcher remains an environment check for the lead.

Browser checklist:

- [ ] Ultra dense 256 growth and 200-building bulldoze/regrow: collect >= 8 before/after reps and p50/p99/max
  BuildingRenderer work; observe visible-first pop-in and eventual off-screen completion. Include a disaster burst.
- [ ] `bot256_y60` and `dense1m`: 5 before/after runs each, including paused baselines; verify both p99 limits and
  the >100 ms rule after 10 s.
- [ ] LOW and HIGH: paused fixed camera, wait for `pendingBuilds === 0`, pop/fades complete and proxies settled;
  capture before/after pairs and require zero differing pixels.
- [ ] During the queue wait, picking/hover and selection show no invisible building box, outline or emitter;
  selected entries acquire their outline when built, and remove-before-build / id reuse leaves no ghost.
- [ ] Load/reset an existing city and switch LOW/HIGH with work pending: buildings and rubble/foundations settle
  synchronously; continue an old save; confirm construction and completion pops start at actual build time.
