# T049: no-road model tint in the Emergency view

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
