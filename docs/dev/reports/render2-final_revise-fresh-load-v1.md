I fixed the warm-up frame in the veil fade (item 3): frame 2 is back to about 11 ms. The first zoom-out (item 1) is now within A/A noise of base but not shown to be at or below it. The first zoom-in (item 2) is near base in the LOW town but still about 1.2× base at ui HIGH. One regression is open: the dense-city first zoom-in and far orbit cost more than before the round, though both stay below base.

**Setup for all CPU numbers:** main-thread CPU (schedstat) per segment, a fresh browser per side per rep, sides rotated, paired ratios with 90% bootstrap CI. Load average was 15–40 throughout because other lanes were running. Sides: base = 02464a3, O = live d3e2b6e (before this round), Z/Zf = final. The final is what is in the live tree; the lead committed it as c64dba9 and ed19954.

## Item 3 — warm-up frame during the veil fade: fixed
**What changed**
- `src/render/world/Shadows.ts`: new `loadWarm { open, queue }`.
- `src/render/city/common/batch.ts`: a batch's first view pass queues its warm-up sweep instead of running it in its 2nd frame. The old frame counting (WARM_AFTER/WARM_WINDOW) is removed, and a disposed batch's queued entry does nothing.
- `src/render/city/vehicles/VehicleRenderer.ts`: the vehicle warm-up is queued from the first update that has vehicles (the load frame). After it runs, a zero-time step puts the cars back in the view's pose. WARM_WAIT is removed; disposed guard added.
- `src/render/world/WorldView.ts`: the constructor opens the queue. `render()` runs it right after the first frame's render, while the veil is still opaque (`loadWarmUp`). `dispose()` closes it. `warmStats` records timings.

**Evidence** — ff page (real CityScene loop), LOW, 6 reps per side, median CPU ms:

| | base | c024 | N | O (before) | new |
|---|---|---|---|---|---|
| frame 1 | 150 | 246 | 271 | 263 | 458 |
| frame 2 | 13.2 | 11.9 | 19.8 | **126.9** [102–167] | **11.2** [5.7–14.9] |
| frames 3–10 | 35 | 47 | 38 | 35 | 27 |
| frames 1–30 | 247 | 355 | 375 | 461 | 536 |
| frames >16.7 ms per load | 1 | 1 | 2 | 2 | **1** |

- Frame 2 wall time dropped from 468 ms to 25 ms. No frame from frame 3 on exceeds 16.7 ms on any side (c024 had one in total).
- **Added load main-thread time:** frame 1 grows by 196 ms (behind the opaque veil), frame 2 shrinks by 116 ms, so frames 1–30 net about +75 ms.
- Total main CPU from navigation to ready is unchanged: 3.42 and 3.62 s vs O 3.59 s (8 reps), 3.33 vs 3.34 s (6 reps), dense city 4.55 vs 4.66 s.

## Item 1 — first zoom-out, LOW town: within A/A noise, not shown at or below base
**What changed**
- `WorldView.warmView` (lead-approved): after the queue, 4 hidden renders plus one at the real pose, into a 4×4 HalfFloat target with no shadow-map render. Poses: 1500 m/60°, 4000 m/85°, 4000 m/85° turned 90°, 800 m/50°. Camera, near/far, render target, shadow flags and renderer stats are all restored. Cost: 40–56 ms wall in the town, 350–470 ms in the dense city.
- `BuildingRenderer.ts`: the LOD warm-up now runs on real loads (it used to log "skipped: N proxies pending" every time). Models whose proxy is still being built use their empty cross-fade stand-in (`warmProxy`); nothing is requested and everything is restored. Log now reads "ran: 2696 buildings, 93 set back, 1764 stand-in proxies".
- `PropRenderer.ts`: the props warm-up sweep now runs the prop LOD switch for each pose and restores every prop and tile state.
- texSubImage2D coalescing was not done: the uploads go to separate per-pass and per-buffer textures, which can't be merged.

**Final run** — 8 reps, two browsers each for base and new:

| first zoom-out | ratio [90% CI] |
|---|---|
| new / base | 0.971 [0.89–1.12] |
| two-browser average new / base | **1.051** [0.97–1.18] |
| A/A: base2 / base | 0.894 |
| A/A: new2 / new | 0.972 |
| O (before) / base | 1.124 |

**Pooled with the 6-rep run** (22 pairs): new/base **1.053** [0.98–1.11], O/base 1.174 [1.06–1.28], A/A 0.931 [0.86–1.02].
- The knock-out run (6 reps) could not separate the parts: the full set against each one removed was 0.99–1.03.
- Within each page, first/second zoom-out ratio: base 1.58, O 1.52, new 1.31. So less of the cost is first-encounter now; what is left is mostly the same in base.
- Per the lead's rule, I stopped here and added nothing more.

**Other first-motion segments, pooled vs base:** street-settle 0.866 (O 0.934), far orbit 0.909, zoom-in 1.020 (O 1.171), pan 1.060 (O 1.053; A/A 1.005).

**Second pass in the same page** (warm), new/O: zoom-out 0.969, far orbit 0.966, zoom-in 1.003, street 0.973 — not worse.

**No visible change, and LOW GPU unchanged**
- I looked at the first 6 frames after viewsReady for O, a second O browser, and new (`Z_f1`, `O_f2`, `Z_f2` and the diff images `d_OZ_f1`, `d_OZ_f6`). Files: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/r1/shots/ff1/{O,O2,Z}_f1..f6.png`, with diffs `d_OZ_f*.png` and `d_OO2_f*.png` in the same folder.
- Frame 1: O vs O2 identical, O vs new 0.16% of pixels. The difference is only car positions: the car warm-up now runs after frame 1 is drawn, and frame 1 is under the opaque veil.
- Frames 2–5: O vs new 0.75–1.2%, inside the O vs O2 spread of 0.9–1.8%. Frame 6: 0.15%, cars only.
- LOW still views (street/default/far): draw calls identical (60/58/76), shadow triangles identical, main triangles −0.04 to −0.06% (car positions), LOD counts identical.

## Item 2 — first zoom-in
**What changed:** the LOD and props sweeps above now also run the swap-back path. I made no change to the per-building geometry swap: it already patches draw ranges in place, and LOD plus swaps cost about 6 ms per 60-frame zoom-in in the town.

**Bug found and fixed (in the live tree):** a stand-in made by the warm-up before its proxy arrived kept the model's old culling sphere once the proxy widened it. At medium quality and up, every cross-fade swap then rebuilt the pass lists instead of patching draw ranges. The fix in `installProxy` re-shares the stand-in's sphere. LOW has no cross-fades, so the LOW results above are unaffected.

**Results**
- **LOW town:** pooled new/base 1.020 [0.99–1.14], O/base 1.171. Final run two-browser average 1.068 [0.99–1.17], A/A 1.086.
- **ui HIGH, before the fix** (6 reps): new/O 1.31 [1.04–1.48].
- **ui HIGH, after the fix** (4 reps, load about 35): fixed/base 1.232 [1.12–1.33], O/base 1.51, fixed/O 0.905 [0.68–1.10], fixed/unfixed 0.917, A/A 1.10. ui HIGH is still about 1.2× base; the verifier had the pre-round version at 1.16× base too.

## Open
- **Dense city LOW:** new vs O over 11 pairs: first zoom-in **1.161** [1.10–1.35] (worse in 10 of 11), far orbit 1.277 (7 of 11). Still below base: zoom-in 0.775, far orbit 0.853, all moving segments 0.871. The knock-outs (4 reps) didn't isolate a cause; the queue-only variant looked similar. This needs quieter, longer runs.
- **Rep counts and noise:** ui HIGH has only 4–6 reps, short of the 8 asked. Same-code A/A at that load swings 10–30%.
- **ui HIGH zoom-in excess:** the tree share at HIGH is TreeRenderer, which belongs to the seasons lane; I didn't touch it.
- **Wall-time stalls:** the no-draw-load runs show multi-second wall-time stalls at a fixed point in every version, including base. They are GPU-process stalls (likely SwiftShader compiling on first real draws) and don't count in main-thread CPU.

## tsc, tests and live tree
- **Snapshot:** tsc clean; `npx vitest run tests/render tests/game` → 40 files, 334 tests passed.
- **Live tree after the fix:** tsc clean; same suite → 40 files, 337 passed. An earlier run under load 24 had two 5 s timeouts in unrelated files (`demolishRisk`, `exitRetention`); they passed 16/16 on re-run.
- **New tests in `tests/render/freshLoad.test.ts`:** the stand-in LOD warm-up restores everything and requests nothing; the props warm-up restores everything; the queue works once in the load frame and never after, and a disposed batch's entry does nothing; the stand-in sphere test fails without the fix.
- **Live tree:** my 7 files are in c64dba9 and the fix is in ed19954 (both committed by the lead). Live matches my final snapshot. All 42 close-out c1 teardown lines are present, the `grep -c "close-out c1"` counts are unchanged, no dispose() lines were removed, and I didn't edit TreeRenderer.ts or fallbackTrees.ts.
- **Cleanup:** no browsers, vite servers or chains of mine are left running; I removed my vite cache.

Files are in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/r1/`:
- `patch/freshload_r1.patch` (main change) and `patch/freshload_r1_fix.patch` (stand-in fix)
- `out/` (A1, A2, A3, FF1, C1–C3, U1, U2, K1 data) and `logs/`
