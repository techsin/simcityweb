# T052 / FEEL-17: review round 1 fixes

Based on WIP `7bfa72b`, branch `local/T052-feel17-garbage`. Review fixes are uncommitted. No commits, pushes or `.done` files were made.

All four review requests are addressed. The real-sim test now clears every prop by **day +56** after connecting a landfill to a saturated district. Targeted tests and TypeScript pass. Revised real-GPU QA and the full suite remain for the lead.

## Changes by file

- `src/render/city/props/PropRenderer.ts`:
  - Clearing gets its own deterministic **8–20 day** ramp; buildup remains **30–60 days**. Together with the nominal maximum 36-day flag lag, this leaves four days before the 60-day deadline.
  - Each lot caches four prop poses and matrices. Camera movement and ramp/count changes never resample terrain or compose matrices. Building geometry changes and nearby terrain/network edits invalidate poses.
  - Lots use the existing culler tile ids. Tight cached prop bounds reject whole tiles by the 900 m distance and actual camera frustum, rather than the culler's shadow-expanded visibility mask. Interior tiles bypass per-lot camera work; boundary tiles check per-prop membership. Camera orientation and projection changes are included.
  - Buffers repack only when visible membership or a visible pose/count changes. Small pans with unchanged membership upload nothing. Only visible instances determine capacity; `addUpdateRange` covers `n*16` matrix floats and `n` variant floats. Both variants still share one mesh/material and one additional draw, with 28 submitted triangles per instance.
  - Road frontage uses the first road-adjacent edge in stable +Z, +X, -Z, -X order, falling back to `rot`. Reads only mirrored `RoadSurface.state.network`; rail does not count as a road.
  - Same-state rebuilds preserve buildup and still-clearing lots. A weak session cache containing episode scalars/building snapshots preserves them when recreating the view for the same CityState object. Fresh save/load or a new replica state retains the mature fallback. No serialized keys or simulation writes. Disposal releases the renderer's session reference and owned graphics resources.
- `src/render/city/CityObjectsView.ts`: small integration hunks pass the actual camera and state identity, and invalidate only lots near the existing terrain/network event rectangles. No new listeners, host requests or App wiring.
- `tests/render/garbage.test.ts`: updates clearing expectations to 8–20 days and verifies that day changes do not resample terrain.
- `tests/render/garbageCollection.test.ts` (new): real Simulation/PollutionSystem path with **48 homes**, a **360-day outage**, a saturated garbage layer and a newly road-connected landfill. Renderer receives copied building-event records. Garbage decays to .65 and .4225 on the first two pollution passes while flags remain; all 48 flags clear on **day +36**. Props are monotonic after connection, **all gone by +56**, and therefore >=90% gone by +60.
- `tests/render/garbageCulling.test.ts` (new): **16 cases** covering 2,041 mostly hidden lots, tight tile/prop culling, camera turns, exact distance-boundary changes, used upload ranges, unchanged membership reuse, terrain caching/rect invalidation, all four road edges, multiple roads, rail fallback and same/new-session episodes.
- This report replaces the initial report with current behavior/results. **No new outside-task source hunks, no `src/sim/infra/*` hunks and no cloud-held edits or requests.** Assets, manifest and the manifest test from the WIP commit are unchanged this round.

## Checks

Every compiler/test command and the short node timing probe used the quiet gate, serially. No browser, full vitest suite or GPU benchmarks were run here.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` through quiet gate | Pass |
| `git diff --check` | Pass |
| `tests/render/garbage.test.ts` | 18 passed |
| `tests/render/garbageCulling.test.ts` | 16 passed |
| `tests/render/garbageCollection.test.ts` | 1 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/render/lod.test.ts` | 35 passed |
| `tests/render/exitRetention.test.ts` | 5 passed |
| Total targeted | **104 passed, 1 existing skip** |

Test invocation below was run separately for each file in the table (native config loading/thread pool avoid the sandbox's default `spawn EPERM`):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/render/garbage.test.ts --maxWorkers=1 --configLoader native --pool=threads
```

The worker reported the WIP full suite green: **217 files / 2,162 tests**, and bot **192,899**. The full suite must be rerun after these review changes. No simulation/balance code or RNG draws changed. Medium/Hard paths and save format are unchanged; separate full-state hash checks were not run.

## Node repack measurements

Short CPU diagnostic, Node **22.12.0**, quiet-gated, no WebGL. Uniform 1x1 lots on a 32 m grid; the same 512-cell culler/tile dimensions; 300 m camera distance, 52-degree tilt, FOV45, 16:9. Cached mature lots, 400 warm-up frames, then 1,000 samples per scenario. Timing includes `updateGarbage`, including its camera matrix update, but excludes setup of the input camera pose. Results are synthetic node CPU measurements, not browser/GPU results.

| Lots | Submitted instances median (min–max) | Repack median / p95 | Stable small-pan median / p95 | Median upload per repack |
| --- | --- | --- | --- | --- |
| 8,600 | 442 (428–458) | **0.0343 / 0.0617 ms** | 0.0138 / 0.0250 ms | **30,056 bytes** |
| 20,000 | 420 (407–427) | **0.0335 / 0.0611 ms** | 0.0154 / 0.0242 ms | **28,560 bytes** |

Both used **512-instance** capacity. Camera movement made **zero terrain calls**. Each stable small-pan scenario made **zero uploads** in 1,000 frames. The wide pan changed membership and repacked 998/1,000 and 1,000/1,000 frames respectively. Still-camera median: .0004 / .0005 ms. One-time episode/pose-cache construction cost 38.2 / 52.5 ms, with exactly four terrain samples per lot (34,400 / 80,000). Rectangle invalidation scans the lot index on edits, outside the moving-camera path.

Scratch evidence: `garbage-repack.mts`, `garbage-repack.json` and `resolve-types.mjs` in the lane's supplied scratch directory. Exact probe command:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T052/scratch/resolve-types.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T052/scratch/garbage-repack.mts
```

## Bot gate

The preferred command remains:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

As in the initial round, tsx is unavailable in the offline cache; no dependencies were changed. The review round reruns the same bot through Node's TypeScript transform and the scratch extension resolver:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T052/scratch/resolve-types.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

Observed result, exit 0: residents `[61124, 93804, 37971]` = **192,899** in 2015, exactly the required baseline. Output is lane scratch `bot128_s7_y15_review1.txt`. No 256x60 bot run is needed for these renderer-only fixes; GPU acceptance can use the existing bot256_s7_y20/y60 or 287k fixtures.

## Plan/design fit and remaining browser checklist

The latest review explicitly authorizes shorter clearing, replacing the original equal buildup/clearing duration. The former connection-deadline conflict is resolved by the 8–20 day clear ramp; its full real-sim path is tested. The Worker design needs no new key or query: flags, event-time day, network and terrain are already mirrored. No cloud-held file requests.

Prior WIP real-GPU QA passed **717/717 lots at 300 m**, strict 900 m cut, +1 draw and +0.08–1.79% triangles on the natural saves, old saves and loopback. Its saturated stress case exceeded the triangle budget and its collection deadline failed; these were the reasons for this revision. Revised browser/GPU results are not yet verified.

- [ ] Repeat short and long landfill-outage curves: >=90% of props gone by connection +60 days; record flag and prop-clear dates. Test predicts all gone by +56 at nominal maximum lag.
- [ ] At 300 m, >=90% NoGarbage lot coverage; both variants, all road edges, plopped buildings with mismatched `rot`, slopes and thin lots. Capture screenshots.
- [ ] Stress 8,600/20,000 flagged lots: compare visible/submitted counts and uploads, slow pan inside stable membership, orbit in place, then pan across frustum/tile/distance boundaries. No popping; no terrain sampling on camera movement.
- [ ] Same camera/quality on 287k or existing bot256 fixtures, including a saturated outage: +1 main draw and <=5% extra triangles; verify no instances >=900 m on low/high/ultra. Node tests do not establish the GPU percentage.
- [ ] Rebuild while building up and while clearing; dispose/recreate with the same state; fresh save/load mature fallback; demolition and reversal during clearing; no stale props. Check loopback replica path.
- [ ] Full vitest after review changes; preferred tsx bot when available. No browser/full-suite or GPU results are claimed for this revision.
