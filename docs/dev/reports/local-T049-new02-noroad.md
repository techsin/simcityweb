# T049: no-road model tint in the Emergency view

## QA round 2: paused road edits and selection glow

Based on `f7600b2` with dev / T040's hook merged. The desktop worker reported the original NEW-02 GPU acceptance
lines passing except these two findings. Both fixes below are uncommitted; no commit, push, merge or `.done` file.

### Findings and fixes

1. **Stale mask after a paused road edit.** Hover read the mirrored network immediately, but models waited for the
   next emergency raster delivery. `src/render/city/CityObjectsView.ts` now invalidates the selected Emergency
   overlay revision in the existing `networkChanged` listener. This is an import plus two lines; no new listener,
   simulation read or state write. The existing sweep coalesces revisions and reads buildings through
   `overlayReadout` inside T040's shared 2 ms budget. No per-building work runs in the network event handler.
2. **Hover/selection washed the red out.** `src/render/city/buildings/BuildingRenderer.ts` changes only the selection
   glow's color in `patchNoRoad`: red `(1.0, 0.3, 0.3)` when the model's noRoad lookup is set, otherwise the original
   `(0.25, 0.6, 1.0)`. Selection pulse and multiplication remain unchanged. The main model, proxy and LOD fade inherit
   the patch; shared prop/vehicle/ghost materials are untouched. The building shader cache key advances to v2.

`tests/render/buildingNoRoad.test.ts` adds three actual CityObjectsView / TerrainRenderer event regressions, one per
responder. Each builds then removes the neighboring road with no simulation advance, no response-raster change,
no layer event and no view switch; it verifies hover and model agree after budgeted frames. They also assert that
the event itself performs no per-building refresh. These three cases failed before the handler fix and pass after it.
`tests/render/buildingNoRoadSelection.test.ts` adds three composed-shader tests: numeric red selection/deselection
on full/fade programs, exact original selection arithmetic for accessible/off models, and unchanged shared shaders.

This round changes only those two source files, the existing no-road test, the new selection test and this report.
CityObjectsView's minimal hunk is explicitly authorized by the QA request. **No infra or cloud-held-file hunk or
request. No changes to T040's hook, drain, clear or dispose.** No RNG, balance, save or simulation changes.

### QA-round verification

TypeScript passed through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

Each file below ran separately and sequentially with the established native-config/thread launch (no config edit):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---|
| `tests/render/buildingNoRoad.test.ts` | 19 passed |
| `tests/render/buildingNoRoadSelection.test.ts` | 3 passed |
| `tests/render/buildingWork.test.ts` | 12 passed |
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/infra/overlays.test.ts` | 22 passed |
| `tests/render/overlaysCrisp.test.ts` | 5 passed |
| `tests/render/overlayReadiness.test.ts` | 2 passed |
| `tests/render/garbageView.test.ts` | 1 passed |
| `tests/worker/hygiene.test.ts` | 18 passed |

**139 passed across 10 files; no failures or skips.** The merged base includes T040's compatibility-fixture fix,
so the earlier historical round-2 blocker is resolved. `git diff --check` and UTF-8/no-BOM checks pass.

The 128x15 seed-7 Medium / plains bot also passed, exit 0: **[61124, 93804, 37971] = 192,899 in 2015**. Exact run:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T049/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Output: assigned scratch directory's `simbot-128-y15-s7-qa-round2-native.log`. This reuses the earlier Node TypeScript
fallback because tsx is still absent locally. The prescribed command remains:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

No new plan/code mismatch. The change preserves the helper's existing response semantics and keeps model/hover on
the same readout. No full suite, separate Hard/256x60 bot, two-process hash probe or browser was run. Numeric shader
tests verify the expression, not rendered pixels. New GPU screenshots and actual paused host interaction remain
for the desktop worker; the earlier GPU results are worker-reported, not rerun here.

Desktop recheck checklist:

- [ ] Paused local, loopback and worker hosts: add/remove the adjacent road; hover and model agree after budgeted
  render frames without advancing a simulation day. Repeat Fire/Police/Medical.
- [ ] HIGH and LOW, at 300 m and 700 m: hovering or inspector-selecting the roadless Obelisk keeps it visibly red,
  including a proxy/fade; leaving hover or selection restores its normal unselected red.
- [ ] Fixed-camera A/B: road-access buildings retain their existing hover/selection and off-overlay appearance;
  no misleading amber ring. Full suite and GPU/frame-cost gates remain with the lead.

## Round 2: T040 BudgetedWork integration

Based on the worker's merged `f6d9ce1`, including T040 hook `6bf60ee` and committed round 1 (`e6378e3`;
infra metadata is apart in `6b282da`). The round-2 changes are uncommitted. The migration and tint tests pass,
but the requirement that T040's unchanged `buildingWork.test.ts` pass is blocked by two fixture assumptions below.

### Round-2 changes by file

- `src/render/city/buildings/BuildingRenderer.ts`: register `noRoadBudgetWork` from a field initializer beside
  the no-road fields. `pending()` only checks the refresh iterator; `step()` advances one bounded unit through
  `nextNoRoad()`. The work's `clear()` owns the original mask fill/upload flag, iterator and revision reset.
  When T040 sets `disposed` before clearing works, the same callback releases the texture, shared uniform reference
  and building-only material. Removed the lane's obsolete `noRoadFirst` scheduler flag.
- Restored `drainBuilds()`, `clear()` and `dispose()` to **byte-identical method text from `6bf60ee`**. Also checked
  byte identity of `addBudgetedWork`, `stepBudgetedWork` and `drainBudgetedWork`; no hook code changed. All other
  source hunks remain as round 1, including model/proxy/fade shaders and readout wiring. T040 supplies alternation,
  the single 2 ms deadline, work round-robin and lifecycle calls.
- `tests/render/buildingNoRoad.test.ts`: added one regression that checks actual work registration and spies the
  hook's pending/step calls. With queued geometry and 0.75 ms units, its first frame is build/mask/build = 2.25 ms;
  later frames drain both queues under the same deadline and preserve the model masks. Existing 15 tests unchanged.
- Updated this report. **No round-2 infra, outside-named-source, cloud-held-file or T040-test hunks.** The existing
  round-1 infra hunk remains committed separately for B2; no new request for a cloud-held source file.

### Round-2 checks

TypeScript ran through the quiet gate and passed:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

All eight requested test files ran separately, sequentially, through the same quiet-gated native-config/thread
command recorded under round 1 (the known default-config `spawn EPERM` workaround; no config edits):

| Test file | Round-2 result |
|---|---|
| `tests/render/buildingNoRoad.test.ts` | 16 passed |
| `tests/render/buildingWork.test.ts` | 9 passed, **2 failed** |
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/infra/overlays.test.ts` | 22 passed |
| `tests/render/overlaysCrisp.test.ts` | 5 passed |
| `tests/render/overlayReadiness.test.ts` | 2 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing W1.2 import-graph case skipped |

Total: **128 passed, 2 failed, 1 skipped**. `git diff --check` and UTF-8/no-BOM checks pass. Neither T040 test file
was edited. No full suite or browser/GPU process was run.

Both failures are the parameterized `preserves build order, frame counts and clock checks with no registered work`
cases (0.65 / 3.25 ms), at `tests/render/buildingWork.test.ts:112`. Their empty-drain assertion expects zero new
clock reads; it observes one. Required field registration means `budgetedWorks.length` is 1 even while no-road work
is idle. T040's unchanged `drainBuilds()` therefore selects `drainBudgetedWork()`, which reads the deadline before
calling `pending()`. Our cheap `pending()` cannot change that earlier clock read. All nine actual hook scheduling
and lifecycle tests, the new integration regression, and T040's geometry-budget tests pass.

**Request for the T040 owner / lead:** isolate the genuinely unregistered path in those two compatibility fixtures
(their `run()` helper), temporarily excluding automatic lane registrations and restoring them before teardown.
That makes the stated fixture condition true after lanes adopt the mandatory hook. The alternative would require
changing T040's hook contract. Neither is permitted by this round's unchanged-hook/unchanged-test instructions,
so no workaround was added and the gate is explicitly left failing. This is the round's plan/code mismatch; the
hook otherwise expresses every no-road ordering and priority requirement.

The bot reran through the quiet gate using the already-established Node TypeScript fallback (`tsx` remains absent
from the offline cache):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T049/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Exit 0; Medium / plains; 2015 residents **[61124, 93804, 37971] = 192,899**, identical. Output is the assigned
scratch directory's `simbot-128-y15-s7-round2-native.log`. No balance/RNG/simulation/readout changes in round 2;
no separate Hard, 256x60 or two-process hash run. The prescribed tsx command and expected numbers remain recorded
under round 1 below.

Left for the lead: resolve the two T040 fixture failures, then full Vitest; real shader compilation, screenshots,
GPU/frame cost and old-save playability. Browser acceptance checklist remains:

- [ ] Roadless Obelisk red on its model in Emergency · Fire at 300 m and 700 m, including proxies and LOD fades.
- [ ] Road-connected buildings unchanged in fixed-camera A/B screenshots at both distances, LOW/HIGH and day/night.
- [ ] No misleading amber ring around the roadless lot and its auto-dispatch neighbors.
- [ ] Switching views/responders, paused delivery, road edits and old-save load/reset leave no stale tint; geometry
  and mask refresh keep progressing during growth/disaster bursts within the shared frame budget.

## Round 1 report (historical)

Implemented on `local/T049-new02-noroad`, based on T040 at `8ff4fd0`. Changes are uncommitted; no push,
merge, branch change or `.done` file. No browser, full-suite run or GPU timing run was started.

## Changes by file

- `src/render/city/buildings/BuildingRenderer.ts`: a nearest-filtered, one-byte-per-cell footprint lookup makes
  buildings whose Emergency readout reason is `noRoad` red. A building-only material inherits the existing city
  shader, applies the red after overlay desaturation, and adds a small steady red emission. Full geometry, proxies
  and both LOD fade levels sample the same mask at the instance origin. The shared prop/vehicle and ghost materials,
  instance colors, flag alpha and existing terrain palette/filtering are unchanged. Main and fade draws bind the
  current lookup and current city material scalars immediately before their existing draw hooks.
- `src/render/world/overlays.ts`: a small per-state WeakMap carries the terrain's selected overlay, variant,
  readiness and refresh revision to buildings. Existing ramp, legend and raster functions keep their behavior.
- **Outside the task's named source files:** `src/render/world/TerrainRenderer.ts` has only an import and small
  selection/update/reset/dispose hooks publishing that view state. Its existing readiness and dirty-raster path
  supplies paused deliveries and response invalidation. No CityScene, CityObjectsView, host or worker wiring changes.
- **Infra / outside the task's named source files:** `src/sim/infra/overlays.ts` has two isolated hunks:
  `OverlayReadout.reason?: EmergencyReach['why']`, and `reason: 'noRoad'` on the two existing no-road return objects
  in `overlayReadout`. Existing text/tone/sub and all response calculations are unchanged. This is display metadata,
  not a new systemData/save key or a simulation/balance change. These hunks can be separated for the B2 rebase.
- `tests/render/buildingNoRoad.test.ts`: 15 new cases for all responders, noRoad versus connected far/near/auto and
  noStation, footprint-best response, nearest sampling, 300/700 m lookup and unchanged instance flags/colors,
  off/readiness, actual terrain paused delivery/reset, removal/id reuse and queued visual swaps, main/proxy/fade
  shaders, draw-time material sync, revision fairness and the shared work budget.
- This report is the task-named documentation file. Scratch-only bot logs and a TypeScript extension resolver are
  in the assigned T049 scratch directory.

## T040 budget and lifecycle

There is no new per-frame scan over the city. Frame/view checks are constant time. A refresh uses a live Map
iterator, retaining its place while newer revisions coalesce; the next sweep catches the latest revision. Individual
mask reads alternate with queued geometry entries inside the existing `BUILD_BUDGET_MS = 2` deadline. At least one
pending work entry is admitted and an indivisible entry can overshoot, as with T040. Alternation prevents a constant
stream of expensive geometry from starving old roadless buildings. With Emergency off, T040's geometry admission,
wave priorities and ordering are unchanged. With Emergency open, mask entries share that time with geometry.

New builds update their mask inside `build`; actual frees clear the old drawn footprint, while a queued change keeps
its old drawn mask until its swap. Removal/id reuse cannot leave a red ghost. Switching view/variant or losing
readiness disables and clears the old mask; clear/reset/rebuild/dispose release refresh work and texture state.
`flushLod` also settles mask work synchronously for captures. No new draw call, RNG draw, save format, state mutation
or listener was added. Medium/Hard balance and old-save continuation behavior are expected unchanged.

## Verification

`npx tsc --noEmit` and `git diff --check` pass. Each test file ran separately and sequentially through the quiet
gate. The prescribed default `npx vitest` launch failed at config loading with `spawn EPERM`. T040's successful
native-config/thread launch was reused without changing repository config:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---|
| `tests/render/buildingNoRoad.test.ts` | 15 passed |
| `tests/render/buildingBudget.test.ts` | 22 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/infra/overlays.test.ts` | 22 passed |
| `tests/render/overlaysCrisp.test.ts` | 5 passed |
| `tests/render/overlayReadiness.test.ts` | 2 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Total: **118 passed, 1 skipped**. The existing skipped hygiene case is the W1.2 simWorker import-graph gate.
Fake-clock budget tests
charge 0.65/3.25 ms mask entries and sustained 3.25 ms geometry arrivals; they prove scheduling bounds and progress,
not real-machine timing. Shader tests inspect the actual composed shader sources and uniforms without a GPU.

### Bot gate

The prescribed command could not start because `tsx` is absent from the offline npm cache (`ENOTCACHED`):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

The unchanged bot then completed, exit 0, using Node's TypeScript transformer and a scratch-only resolver, following
T040's precedent:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T049/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Medium / plains, seed 7, 128 tiles, 15 years: residents **[61124, 93804, 37971] = 192,899 in 2015**, identical to the
required gate. Output: assigned scratch directory's `simbot-128-y15-s7-native.log`; failed prescribed launch:
`simbot-128-y15-s7-tsx.log`. No balance change is intended. No 256x60, separate Hard bot or two-process yearly-hash
probe was needed or run. The exact prescribed tsx command can be rerun when tsx is available; expected numbers are
the same. The render-only task's required population gate is verified by the fallback run.

## Plan/code differences and handoff

- `overlayReadout` originally exposed only human text/tone/sub, not the named `noRoad` reason. The minimal infra
  metadata hunk lets this task read `overlayReadout` without parsing translated/player-facing text.
- BuildingRenderer had no selected Emergency variant or refresh input. The terrain already owns both, so the small
  extra-file hooks share them through the named overlay module. No cloud-held file change is requested.
- The queue task's push/`.done` instruction is superseded by the session's explicit uncommitted/no-push/no-`.done`
  rule. No other plan/design mismatch was found.
- Full Vitest, actual shader compilation/rendering, screenshot A/B, GPU/frame cost and manual old-save playability
  remain for the lead. No claim of pixel identity or real-GPU budget compliance is made from Node tests.

Browser acceptance checklist:

- [ ] Emergency · Fire: a roadless 1x1 Obelisk is visibly red on the model at 300 m and 700 m; verify hover still says
  "Unreachable — no road beside it". Repeat LOW/HIGH and during a proxy transition.
- [ ] Paused, fixed-camera before/after A/B screenshots: buildings with roads are unchanged at both distances,
  including connected buildings in the same red "too far" band; check day/night lighting and LOD fades.
- [ ] A/B screenshots around the Obelisk and auto-dispatch neighbors show no misleading amber ring. The existing
  whole-cell terrain categories and genuine "Just out of reach" band remain correct.
- [ ] Add/remove a road and wait for the response refresh; tint and hover agree. Switch Fire/Police/Medical, another
  data view and None; late paused data delivery and an old-save load/reset show no stale tint.
- [ ] During growth/disaster bursts, existing roadless models eventually tint while geometry keeps building; check
  actual frame/GPU cost alongside T040's pending real-GPU run.
