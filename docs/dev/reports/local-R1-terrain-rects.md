# T021 report: Worker plan step R1, TerrainRenderer dirty rects (desktop, real GPU)

**Verdict: done.**
- Exact in node.
- On the GPU, the four terrain cell textures are bit-identical to dev after 48 scripted edits.
- The per-event refill falls from 0.34-0.50 ms to a median of 0.010 ms.
- One edge-terraform frame in 48 reaches 0.165-0.170 ms, against the 0.15 ms target (details below).
- tsc, the full vitest and the bot are green.

Branch `local/R1-terrain-rects`:
- the change is `c6818fd`, Codex-written on Oct 27 and reviewed by the worker;
- dev `fb1531f` is merged in (`af62daf`, no conflicts).

## Environment

- Windows 10 Education 10.0.19045; Ryzen 7 9800X3D (8c/16t); 61.6 GB RAM.
- NVIDIA GeForce RTX 5070 Ti, driver 610.47. Chromium: Playwright 1.56.1's chromium-1234, HeadlessChrome/141.0.7390.37,
  real GPU through `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)`, with
  cross-origin isolation (5 µs `performance.now()`). Node 22.12.0.
- Trees: base = dev `fb1531f`; branch = `af62daf` (dev merged into `c6818fd`).
- City: the veteran's year-43 256 save (`vet_s7_y43`; 991,343 residents, 11,495 buildings), the sim held at speed 0,
  the art harness's manual frame clock.

## What changed (`src/render/world/TerrainRenderer.ts`, plus the two fallback fixes NOTE-017 asked for)

- `markCells(r)` and `onTerrainChanged(r)` grow one pending union rect per texture group: zone + light, and trees.
  The rect is padded by one cell and clamped to the map; empty and wholly outside rects are ignored.
- `update()` refills only the union and uploads only its rows, with `Texture.addUpdateRange`. three r186 decodes
  ranges with a component stride of 4 even for `RedFormat`, so the Red textures (light, trees) take their ranges in
  texel × 4 units, the same as the RGBA8UI zone texture.
- Above half the rows, a texture takes one full upload instead.
- A range not yet consumed by three (`onUpdate`) is merged into the next one, never narrowed. A pending full upload
  stays full.
- The exits refresh only when the union touches the two outer rings of cells.
- Every other path uploads the textures in full:
  - full refills: `rebuildAll`, `reset`, quality switches (`setQuality`), climate changes;
  - first uploads;
  - context loss and restore (a listener on the canvas);
  - texture disposal.
- `src/game/fallback/FallbackActions.ts`, as NOTE-017 asked:
  - `plantTrees` counts and checks the price before it writes, so a refused planting writes nothing, and a paid one
    emits `treesChanged`;
  - terraform emits `terrainChanged` with the one-cell ring that `computeWater` rewrites.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Full vitest with the shared fixtures | **218 files passed, 1 skipped; 2,160 tests passed, 7 skipped; 0 failing** (244 s) |
| The bot, 128x15 seed 7, with the action log | **identical to dev: residents [ 61124, 93804, 37971 ] = 192,899**; every year row and every logged action equal, apart from the two timing columns |
| `tests/render/terrainRects.test.ts` (14) | ranges for RGBA and Red textures; clamping; retained ranges per texture; the full-upload threshold; exits on all four edges; full refills and first uploads; context restore and disposal; exactness after every tool action and randomized batches with water and edge edits; fallback actions; meteor, quake and removals; reset with a stale rect pending; the tornado lag; the two fallback fixes |
| `tests/render/terrainGrowth.test.ts` (1) | 60 years of a 128 bot city with disasters on: after every `update()`, the zone, light, tree and exit arrays equal a full recompute (cells under an active tornado are compared after its end event, NOTE-017) |

## Real-GPU timing (quiet slot, 18:54 UTC)

Setup:
- 8 rounds of six scripted events at sites chosen by one deterministic scan: plop, zone a 4x4 block, a 6-cell road,
  3x3 trees, a 6-cell power line, and a terrain raise at the map's west edge;
- ABBA order (base low, branch low, branch high, base high);
- "cell refills" is R1's scope: `updateZones` + `updateTrees` + `updateExits` in the event frame, with nested calls
  counted once. Uploads are the four cell textures' `texSubImage2D`/`texImage2D` calls in that frame.

| event | LOW refills, base → branch (median; max) | HIGH refills, base → branch (median; max) | uploads per event frame, base → branch |
|---|---|---|---|
| plop | 0.365 → **0.010** (1.380 → 0.070) | 0.393 → **0.012** (1.230 → 0.055) | 4 calls, 394,240 B → 15 calls, 150 B |
| zone | 0.355 → **0.010** (0.525 → 0.015) | 0.502 → **0.010** (0.670 → 0.015) | 4, 394,240 B → 18, 216 B |
| road | 0.343 → **0.005** (0.585 → 0.010) | 0.492 → **0.010** (0.590 → 0.015) | 4, 394,240 B → 9, 144 B |
| trees | 0.340 → **0.010** (0.545 → 0.015) | 0.372 → **0.005** (0.820 → 0.010) | 4, 394,240 B → 15, 150 B |
| power | 0.348 → **0.010** (0.375 → 0.010) | 0.403 → **0.010** (0.630 → 0.010) | 4, 394,240 B → 9, 144 B |
| edge | 0.337 → **0.037** (0.350 → 0.170) | 0.473 → **0.037** (0.795 → 0.120) | 4, 394,240 B → 28, 1,402 B |

- **Over all 48 event frames per quality, branch:** p50 0.010 ms, p90 0.040 ms; max 0.170 (LOW) and 0.120 (HIGH).
  Idle frames do no terrain work and no uploads on either side.
- **The 0.15 ms target holds at p50 and p90, and in 47 of 48 frames.** The exception is the second edge terraform
  (`terraform('raise', 2, 48, 2, 1)`): 0.170 ms at LOW in the quiet slot, 0.165 ms in a replicate run.
  - Its rect touches the outer rings, so the exits refresh too; the other seven edge frames take 0.03-0.13 ms.
  - Same site in both runs: content, not warm-up.
  - Base pays 0.34-0.47 ms for the same frame.
  - If the lead wants every frame under 0.15 ms, `updateExits` can refresh only the edges the union touches (a small
    follow-up in the same file).
- `update()` in total also includes work outside R1's scope:
  - the terrain chunks' geometry after a height edit: about 17 ms in both trees for the edge raise;
  - the plop frame's other work: about 1.2 ms in both.
  R1 removes the texture refill from these frames; the chunk rebuild is unchanged.
- Full tables: `docs/dev/reports/local-R1/timing-tables.md`.

## Pixel identity

The plain screenshot comparison cannot decide this on this harness:
- The art harness's manual clock steps rAF time, but `performance.now()` stays real.
- How many real-time frames run before the manual clock starts differs from run to run.
- So time-driven animation differs between any two runs of the same tree: vehicles, crowds, foliage sway, rooftop
  and plaza details, junction details.
- An A/A pair (base vs base) differs by 7,267 / 1,288 / 3,123 pixels at LOW (sites / edge / map). With the dynamic
  layers hidden (vehicles, headlights, smoke, flames, emergency vehicles, fireworks, disasters), the A/A still differs
  by 4.9k-30k pixels. Base vs branch stays at the same level.
- `local-R1/diff_aa_low_sites.jpg`: an A/A diff, in red over a darkened frame. The differences are scattered dots
  over animated content, not blocks around the edited sites.
- One pair did match exactly: the branch's LOW run and the second base LOW run are **0 pixels apart** in all three
  poses.

So the check that decides is the **GPU texture readback**.
- **Method:**
  - after the 48 scripted edits and two more frames, each of the four cell textures (zone RGBA8UI, light R8, trees R8,
    exits R8) is attached to a framebuffer and read back with `readPixels` (`RGBA_INTEGER`/`UNSIGNED_INT` for the
    integer zone texture);
  - each readback is compared with the renderer's CPU array, and hashed (FNV-1a) for base vs branch;
  - `local-R1/gpu-texture-readback.json`.
- **Result:**

| quality | texture | GPU texels differing from the CPU array, base / branch | GPU hash, base = branch |
|---|---|---|---|
| LOW and HIGH | zone 256x256 | 0 / 0 | `b5c88593` = `b5c88593` |
| LOW and HIGH | light 256x256 | 0 / 0 | `689f5bfa` = `689f5bfa` |
| LOW and HIGH | trees 256x256 | 0 / 0 | `879d3b3c` = `879d3b3c` |
| LOW and HIGH | exits 256x4 | 0 / 0 | `11a02905` = `11a02905` |

- **What it shows:**
  - every range upload landed: the GPU equals the CPU arrays;
  - the textures the terrain shader samples are bit-identical to dev's after the same edits;
  - together with the node tests (CPU arrays equal a full recompute after every event, and over 60 years of growth),
    the terrain renders exactly what dev renders, apart from the documented tornado lag.

## Writer audit at `af62daf` (refreshed for today's tree)

A read-only Codex lane re-ran the Oct 27 audit on the merged tree. It covered every writer of zone, the building
index, network, netFlags, trees, water and power lines in src/sim, src/game (with fallback), src/save and, new since
Oct 27, src/worker.
- **Every runtime writer is followed by an event whose rect covers the write**, on the emitter the renderer listens
  to. That is `sim.events` under LocalSimHost and `replica.events` in loopback. It includes the replica's primary-patch
  application and building-footprint replay; the recorder's per-layer unions cover the patch bounds.
- **No rect is too small.** The fallback terraform's ring and the refused planting are fixed (NOTE-017).
- **The one documented lag**, unchanged (NOTE-017/NOTE-022):
  - a moving tornado's tree damage reaches the texture at its end event (`disasters.ts:336`, a radius-42 square);
  - `treesDamaged` (`disasters.ts:331`) is sim-neutral, and WorldView ignores it by decision;
  - the 3D trees behave the same.
- **One finding outside R1, for T034 (NOTE-041 item 2): the loopback resync's state handoff is still missing.**
  - `worker/replica.ts:132-135` adopts a fresh state on a later Ready or resync.
  - `reset` reaches WorldView, but `WorldView.ts:388` rebuilds with its old state object.
  - So after a forced resync, every renderer keeps reading the detached old rasters.
  - The audit's suggested fix: a `getState` option in `WorldViewOptions` (`WorldView.ts:34`), passed from
    `CityScene.ts:475` as `() => this.sim.state`, plus `modules.ts:36`.
  - That is T034's wiring (WorkerSimHost and loopback resyncs). R1 does not touch it.

Table (paths under `src/`):

| writer file:line | writes | following event and rect | status |
|---|---|---|---|
| `sim/actions.ts:257,275` | zone/dezone | `zoneChanged` 260/280, clipped input rect | OK |
| `sim/actions.ts:412,418-430` | network, netFlags, zone, trees | `networkChanged` 435, zone/tree events 436-437, path bounds | OK |
| `sim/actions.ts:478-480` | power lines, zone, trees | events 484-486, path bounds | OK |
| `sim/actions.ts:596-599` | bulldoze: network, netFlags, lines, trees | events 607-609, clipped rect; removals cover whole lots | OK |
| `sim/actions.ts:671-672` | plop: zone/tree clearing | `buildingAdded` (687), zone/tree events 691-692, lot footprint | OK |
| `sim/actions.ts:758,764-766` | terraform: water (`computeWater`), trees, zone, lines | events 770-773, rect 757 matches the recompute | OK |
| `sim/actions.ts:800` | trees | `treesChanged` 804, clipped rect | OK |
| `sim/economy/buildings.ts:17,32` | building index add/remove | `buildingAdded` 21 / `buildingRemoved` 42, whole footprint | OK |
| `sim/economy/growth.ts:570` | trees | placement 604 + `treesChanged` 606, grown footprint | OK |
| `sim/infra/common.ts:513` | building index removal | `buildingRemoved` 517, whole footprint | OK |
| `sim/infra/disasters.ts:321` | tornado trees | `treesDamaged` 331 (ignored by WorldView), `treesChanged` 336 at the end | DOCUMENTED LAG |
| `sim/infra/disasters.ts:407,414-416` | meteor: water, network, netFlags, lines, trees | events 435-438, clipped crater rect | OK |
| `game/fallback/FallbackActions.ts:60,75,119-121,129,145,185-188,200,243-245` | zone, network, trees, flags, lines, index | the matching events, input or path bounds, whole footprints | OK |
| `game/fallback/FallbackActions.ts:288` | water (terraform) | `terrainChanged` 290 with the recompute ring | OK (fixed) |
| `game/fallback/FallbackActions.ts:308` | trees | `treesChanged` 311; refusal (302) and preview (303) before any write | OK (fixed) |
| `worker/protocol.ts:236` via `worker/replica.ts:161` | primary layer patches | replica re-fires the original rects (`replica.ts:170,267,274`) | OK |
| `worker/replica.ts:281` | building index replay | `buildingAdded`/`buildingRemoved` 274, whole footprint | OK |
| `worker/replica.ts:132-135` (a later Ready/resync) | replaces the state | `reset` → `WorldView.ts:388` keeps the old state | MISSING (T034's handoff) |
| CityState / terrainGen / serialize / recoveryCodec / bundleCodec / the first replica adoption | all layers | fresh state, then a full construction | INIT-ONLY |

## Evidence

All files are under `docs/dev/reports/local-R1/`:
- `timing-tables.md`;
- `gpu-texture-readback.json`;
- `branch_high_sites.jpg`, `branch_low_edge.jpg` (the edited west edge, with the exit ribbon);
- `diff_aa_low_sites.jpg`, the A/A noise.

The harness, kept in the worker's scratch:
- `r1browser.mjs` (Oct 27's T021 harness, plus the GPU readback and an optional dynamic-layer hide);
- `r1tables.mjs`, `pixdiff.mjs`, `r1run.sh`.

## What came from Codex

Written by Codex on Oct 27:
- the TerrainRenderer change, the two fallback fixes and both test files (`c6818fd`);
- the audit refresh (read-only, Nov 3).

The worker did the rest:
- the review;
- the dev merge;
- the gates;
- the real-GPU timing;
- the readback method and runs;
- this report.

## Cloud carry-over (Nov 3)

The desktop is unavailable (NOTE-044), so the cloud verified this lane. The branch is `cloud/r1`, from
`local/R1-terrain-rects` @ `255239b`.
- Dev `821a8d6` was already merged in (`a0bd25a`). This run was interrupted once (a container restart) and resumed;
  by then dev had moved to `50a6b29`, merged at `90f153f` with no conflicts.
- Since the desktop's audit tree `af62daf`, dev changed render files (`Fireworks.ts`, `CityObjectsView.ts`,
  `render/world/overlays.ts`), src/ui, and in src/game only `NewYear.ts`, `CityScene.ts` and `context.ts` (T036 step
  3's toast budget). None of them writes a layer R1 reads; nothing changed in src/sim, src/save, src/worker or
  src/core.
- NOTE-048 accepts the second edge frame (0.165-0.170 ms) as a minor and calls a follow-up optional. The follow-up
  was contained, so this lane takes it (item 8 below).

### Gap list (written before any work)

Required by T021, WORKER_DESIGN §6 row R1 and NOTE-013/017/021/022/046, compared with what the branch held:

| # | required | state on `255239b` | cloud action |
|---|---|---|---|
| 1 | Union rects per texture group, padded by one and clamped; refill and upload only the union; Red ranges in texel × 4; a full upload above half the rows; exits only near the edge; full paths clear the pending ranges; first upload and context restore stay full | done (`c6818fd`, Codex-written, desktop-reviewed) | re-review line by line against three r186's `WebGLTextures.updateTexture` |
| 2 | NOTE-017: the fallback `plantTrees` writes only after the price check and emits `treesChanged`; the fallback terraform emits the water ring | done | re-review; revert each fix and check that its test fails |
| 3 | Writer audit with file:line | done at `af62daf` | re-sweep the writers on the merged tree; check the cited lines |
| 4 | tsc clean; full vitest passes | green on the desktop | rerun here |
| 5 | Node exactness test: every tool action, plus 60 years of a 128 bot city with disasters on | present (`terrainRects`, `terrainGrowth`) | rerun; mutation-test that the tests catch rect bugs |
| 6 | Test that the ranges cover exactly the union's rows, for RGBA and Red | present | mutation-test |
| 7 | Bot identical to dev (`[ 61124, 93804, 37971 ]`) | identical on the desktop | rerun here, against a clean export of dev |
| 8 | Real-GPU timing ≤ 0.15 ms per event frame, ≥ 8 reps, with a Chrome trace for the upload | median 0.010 ms; **47 of 48 frames**. One edge frame took 0.165-0.170 ms. Uploads were counted and timed by wrapping `texSubImage2D`, not with a Chrome trace | real GPU: a remaining item. Check the edge frame's CPU cost here, and take the desktop's suggested `updateExits` follow-up if it is contained |
| 9 | Pixel-identical LOW and HIGH screenshots of base and branch (paused, fixed camera): 0 pixels, or explain each difference | not 0. The A/A noise came from time-driven animation and was explained; a GPU texture readback was bit-identical; one LOW pair was 0 px | rerun here on SwiftShader with a frozen page clock, plus the texture readback |
| 10 | Report, small JPEGs, `.done` line | present | add this section and a cloud `.done` line |

### What the cloud did

**1. The code review (gap items 1, 2), line by line against three r186.**
- `WebGLTextures.updateTexture` (r186, `WebGLTextures.js:797`) decodes every range with `componentStride = 4` and
  uploads one row per range with `UNPACK_ROW_LENGTH` = the width. `uploadCells` gives each row of the union as
  `((z * N + x0) * 4, (x1 - x0) * 4)`, which is right for the RGBA8UI zone texture (4 bytes per texel) and for the two
  R8 textures (three divides by 4 again). Each range stays inside its row, so three's in-place merge never joins rows.
- **First upload and storage re-creation.** three applies the ranges even when it allocates fresh storage
  (`allocateMemory`, `WebGLTextures.js:948-1020`), so a partial first upload would leave garbage. The lane covers
  every way storage is (re)created: the constructor's full refill stores `null` (a full upload) until three's
  `onUpdate` clears it; a pending full upload is never narrowed; texture `dispose` and the canvas's context loss and
  restore queue full uploads; the exit texture (N × 4) always uploads whole.
- `markCells` pads by one, clamps, and ignores empty and wholly outside rects; full refills (`rebuildAll`, `reset`,
  `setQuality`, the climate path) clear the pending rects first. The quality switch keeps the one WebGLRenderer
  (`WorldView.ts:251` creates it once), so it needs no restore.
- The fallback hunks: `plantTrees` counts, checks the price, then writes and emits `treesChanged`; the preview and
  both refusals write nothing. The terraform emits the ring that `computeWater` rewrites.
- Two notes, no change: `reset()` and the constructor refill the cells twice (`applyClimate` and `rebuildAll` both
  call `rebuildCells`), about 0.7 ms per load, never per frame. The context-lost listener is redundant with the
  restored one (mutant M6b below), and harmless.

**2. The `updateExits` follow-up (gap item 8), `888ba62`.** The desktop's one frame over 0.15 ms (the second edge
terraform, 0.165-0.170 ms) ran the whole-edge exit scan, which allocated four tuples per edge cell.
`updateExits(r)` now recomputes only the edge rows whose two outer rings the padded union touches, with no
allocations; a full refill still scans all four; the N × 4 texture still uploads whole. Node, 256 map, the cell
refill of one edge raise (`r1work/bench/edgeBench.mts`, 2,000 reps, three runs each):

| | `255239b` (median, p90) | `888ba62` (median, p90) |
|---|---|---|
| edge raise rect (0..5, 45..51), `markCells` + `update()` | 0.025-0.027, 0.051-0.053 ms | **0.003-0.004**, 0.005-0.029 ms |
| `updateExits` alone (all four rows) | 0.022-0.028 ms | **0.003** ms |
| interior rect (100..106) | 0.002-0.003 ms | 0.002-0.003 ms |
| a whole-map rect (what dev refills on every event frame) | 0.72-0.73 ms | 0.67-0.68 ms |

In node the change removes about 85 % of an edge frame's refill (median 0.025 → 0.004 ms), so the desktop's
0.165-0.170 ms frame should fall well under 0.15 ms. That is a projection: the real-GPU rerun is a remaining item.

**3. Mutation testing (gap items 5, 6, and "each new test must fail with its fix reverted").** Each mutant was applied
alone on the merged tree, and `tests/render/terrainRects.test.ts` was run (`r1work/mutate3.mjs`, `mutate4.mjs`;
results in `mutations3.json`, `mutations4.json`):

| mutant | failing tests |
|---|---|
| R0: TerrainRenderer.ts reverted to dev | 9 |
| R1: TerrainRenderer.ts at `255239b` (the whole-edge exit scan) | 1 (the exit-row selection) |
| F0: FallbackActions.ts reverted to dev | 2 (the refused planting; the water ring) |
| F1: the fallback terraform emits the bare edit rect | 1 |
| M1 no union (the last rect wins) | 5 |
| M2 no one-cell padding | 7 |
| M3 Red ranges in texel units (not × 4) | 3 |
| M4 an unconsumed range is replaced, not merged | 5 |
| M5 exits only on full refills | 3 |
| M6 no context-restored listener | 1 |
| M6b no context-lost listener | **0: equivalent** (the restored listener alone queues the full uploads; a test checks a restore without a loss) |
| M7 no half-rows threshold | 1 |
| M8 `setQuality` without a full refill | 1 |
| M9 no texture-dispose listener | 1 |
| M10 `onTerrainChanged` does not mark the cells | 2 |
| M11 a full refill keeps a stale pending rect | 1 |
| M12 the first upload is not tracked as full | 5 |
| M13 the climate path without a full refill | 1 |
| X1 the +z row's inward neighbour off by a row | 2 |
| X2 a highway joins a street | 1 |
| X5 the tunnel flag ignored | 2 |
| X3, X4, X6, X7: one edge row selected one ring late (+x, -z, -x, +z) | 1 each, **after `5d14db0`** |
| X8-X11: one edge row selected one ring early | 1 each, **after `5d14db0`** |

Before `5d14db0`, the row-selection test checked the third ring on +x only: the -x, -z and +z "late" mutants (which
drop the one-cell guard against an emitter off by one) and every "early" mutant passed. The test now checks the
third and fourth ring on every edge, alone and inside a union that refreshes another edge. The code is unchanged.

**4. The writer audit (gap item 3), re-swept on the merged tree.** A grep for every write to zone, building, network,
netFlags, trees, water and powerLines (indexed stores, `fill`, `set`, `copyWithin`, `computeWater`) in src/sim,
src/game, src/save, src/worker and src/core finds exactly the writers in the desktop's table, at the same lines
(`sim/actions.ts` 257, 275, 412-430, 478-480, 596-599, 671-672, 758, 764-766, 800; `economy/buildings.ts` 17, 32;
`economy/growth.ts` 570; `infra/common.ts` 513; `infra/disasters.ts` 321, 407, 414-416; `FallbackActions.ts` 60, 75,
119-121, 129, 145, 185-188, 200, 243-245, 288, 308; `worker/protocol.ts` 236 via `replica.ts` 161; `replica.ts` 281;
init-only `save/serialize.ts` 351-353 and `terrainGen.ts`). Since `af62daf` no file in src/sim, src/save, src/worker
or src/core changed, and dev's src/game hunks (NewYear's toast budget) write no layer. The audit stands as written,
including the open T034 item (the loopback resync's state handoff, `WorldView.ts:388`), which NOTE-048 routes to
T034.

### Resumed Nov 9: the gap list at the resume (written before the remaining work)

The lead's session and every cloud workflow stopped at the shared usage limit on Nov 4 (the handoff,
`docs/dev/handoff/2026-11-04/README.md`, chain desk1 at its finish step). The worktree was intact: `cloud/r1` @
`23d845b`, the same head as the handoff's `bundles/cloud_r1.bundle`, with nothing uncommitted. `local/R1-terrain-rects`
has not moved since `255239b`. Dev had moved 93 commits to `87c7c9c` (T052, T034 with T034b, T040, T053, NOTE-053 …
059), merged at `7139bec` with no conflicts: dev changed none of R1's files.

| # | required | state at the resume | action |
|---|---|---|---|
| 11 | Gates on the tree that merges: tsc, the full vitest, the bot identical to dev's | green at `90f153f` (dev `50a6b29`); not run on dev `87c7c9c` | rerun all three on `7139bec`, the bot against a clean export of `87c7c9c` |
| 12 | The writer audit holds on the merged tree | re-swept at `90f153f` | re-sweep dev's new src/sim, src/worker and src/game hunks (T034's real Web Worker host, T053, the disasters `live` mode) |
| 13 | NOTE-048: the cloud checks the resync rebuild (`WorldView.ts:388` kept the old state) when T034 lands, and fixes it in a follow-up if it is still open | open in the audit table | check dev's T034 merge |
| 14 | Browser checks | the Nov 3-4 SwiftShader attempts were cut short (below); NOTE-059 then cancelled R1's SwiftShader re-check: desktop lanes verified on the real GPU get no cloud browser check | none here; review the desktop's evidence images and numbers instead (task: "look at the evidence images") |
| 15 | Each new test fails with its fix reverted | done at `90f153f` (mutation table, item 3) | check that nothing the mutants touch changed in the merge |
| 16 | The real-GPU gate items left open: every frame ≤ 0.15 ms after `888ba62`; a Chrome trace for the uploads (the desktop wrapped `texSubImage2D`); the trees row has 7 reps, not ≥ 8 | open | real GPU only: remaining items, not blockers |
| 17 | The report's final section and the `.done` line | WIP | finish them |
