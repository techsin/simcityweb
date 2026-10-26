FINAL ANSWER: seasons-final, revision 1 (three verifier minors)

I fixed all three minors in my own files (TreeRenderer.ts, fallbackTrees.ts, tests/render). Everything is now committed by the lead. HEAD is fa13c85, the working tree is clean, and my live files are byte-identical to my test snapshot. On the live HEAD, `npx tsc --noEmit` is clean and `npx vitest run tests/render tests/game` passes: 40 files, 338 tests (re-run after fa13c85). Two things don't fully close. The GPU stand-in cannot prove "≤ +5% per edge view", and the ringLow crown adds triangles per tree even though total ring triangles fell. Both are covered under item 2.

All scratch files are under `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/seasons-final/r1/` (written below as `…/r1/`). Version labels: C0 = the previous round (d3e2b6e), G = the revision committed in 883d10e, ed19954 and ba6a0ff, H = G plus far-block cell culling (fa13c85), 02464a3 = the GPU/triangle reference, F = c87d8c8.

## 1. ringLow crowns ("spinning tops")

**What changed**
- **`fallbackTrees.ts`:** the ringLow mini crown is now a 3-sided barrel crown: apex 1.0, two rings of radius 0.55 at heights 0.80 and 0.47, lower apex `RING_LOW_APEX` 0.15 → 0.28. It sits on a thin 3-sided bark trunk (radius 0.09, tip at 0.6).
  - It has 15 triangles / 12 vertices (was 6 / 8).
  - The upper fan reuses `top`'s normals, so at low-camera weight 0 it matches `top` exactly. The lower half uses round-crown normals (`ringLowNormal`).
  - New exports: `RING_LOW_*`, `MICRO_WAIST_*`.
- **`TreeRenderer.ts`, `RING_LOW_VERT` (low-camera path only):**
  - At weight 0, every crown vertex folds radially onto the micro waist circle and the trunk folds into its centre.
  - The crown opens fully by weight 0.4 (`RING_LOW_FULL`, smoothstep).
  - Normals blend into the round crown's, including the foliage shading's object normal.
  - Tint `RING_LOW_TINT` 0.72 → 0.80.
  - LOW quality and high cameras are unchanged.

**Before/after evidence (all looked at)**
- `…/r1/cmp/t25_F_C0_G13_copse_4x.png`: June edge_t25 copse at 4×. F shows round crowns on trunks, C0 shows pale lit kites over dark spikes, G shows round dark crowns on trunks.
- `…/r1/cmp/elowE_F_G16_G13_hz.png` (e3 E_low horizon, F / G at switch 1.6 / G at 1.3).
- `…/r1/cmp/tro_t25_F_C0_G13_top.png`, `…/r1/cmp/tro_el_F_G16_G13_hz_2x.png`, `…/r1/cmp/t25_F_G16_G13_top.png`.
- Edge flights, no pop while the crown opens: `…/r1/cmp/fl_s2_C_G.png`, `…/r1/cmp/fl_s5_C_G_a.png`.

Luma at the far copses (darkest 15% / mean):

| version | t25 copse | t25 top | e3 left | e3 right-far | tropical top |
|---|---|---|---|---|---|
| F | 90.4/121.2 | 110.6/133.9 | 128.9/150.2 | 144.7/165.7 | 112.8/138.0 |
| C0 | 93.5/120.2 | 113.9/134.6 | 132.2/151.1 | 146.9/166.9 | 112.2/137.7 |
| G, switch 1.3 | 84.2/113.1 | 102.4/131.2 | 126.9/148.3 | 143.7/165.3 | 101.7/134.7 |

G's crowns are slightly darker than F's and now have F's shape.

## 2. Edge GPU

**What changed (`TreeRenderer.ts`)**
- `ringLowSwitch` 1.6 → 1.3. In the G 1.6 vs 1.3 shots the copses look the same, and luma moves by at most 1.1.
- Near pairs are culled by the bounds of the prefix they actually submit (`ringNearBox`, a box every 32 slots).
- Far blocks:
  - For high cameras, the box test starts at the micro waist (`ringMicroTopY`).
  - The 30 m slack in the inner-distance test is gone.
  - New in H: each block keeps a 4×4 grid of its trees' bounds (`ringCellBox`), tested only for low cameras near an edge. HIGH edge_t25 far-block instances drop 3749 → 2018.
- Default views no longer submit any ring work (2411 far-block instances → 0).
- New test in ringEdge.test.ts checks that a culled far block has no tree inside the view.

**Deterministic counts** (town page, June, day; files `…/r1/perf/out/K2.jsonl`, `…/r1/perf/out/K3.jsonl`, `…/r1/perf/out/rc2_H3.json`):

| view | ring vertex work, thousands (C0→G→H) | ring draw calls / ktris / instances (C0 → G → H) | main-pass tris ÷ 02464a3 (C0→G→H) |
|---|---|---|---|
| HIGH edgelow | 195→76→76 | 12/70/4107 → 8/48/2694 → same | 1.549→1.461→1.461 |
| HIGH edget18 | 186→82→82 | 13/71/4744 → 9/59/3402 → same | 1.477→1.423→1.420 |
| HIGH edget25 | 156→72→51 | 13/62/4888 → 10/65/4061 → 6/39/2330 | 1.352→1.366→1.288 |
| ULTRA edgelow | 275→94→94 | 12/96/5035 → 8/55/2910 → same | 1.678→1.484→1.496 |
| ULTRA edget18 | 260→145→145 | 13/96/5634 → 10/80/4163 → same | 1.630→1.570→1.576 |
| ULTRA edget25 | 201→103→85 | 14/80/5760 → 10/76/4436 → 7/54/2970 | 1.434→1.412→1.354 |
| LOW, all views | no ring | — | 1.000–1.016 (unchanged from C0) |

**GPU stand-in** (GPU-process CPU per drawn frame, 2 browsers × 2 reps per version, load 17–31; file `…/r1/perf/out/G3.jsonl`). The noise between two identical browsers (A/A, median |log|) was 4.0% HIGH and 4.5% ULTRA.

| view | G ÷ 02464a3 | C0 ÷ 02464a3 (same run) |
|---|---|---|
| HIGH edgelow | 1.065 | 1.066 |
| HIGH edget18 | 1.045 | 1.059 |
| HIGH edget25 | 1.000 | 1.070 |
| HIGH default | 0.933 | 0.923 |
| ULTRA edgelow | 1.079 | 1.047 |
| ULTRA edget18 | 1.064 | 1.092 |
| ULTRA edget25 | 1.090 | 1.054 |
| ULTRA default | 0.920 | 0.927 |

LOW pooled: G 0.951 [0.934–0.967], C0 0.932.

**Where the remaining excess comes from** (final G, 2 browsers × 3 reps, A/A 3.3–6.2%; file `…/r1/perf/out/A1.jsonl`):
- Hiding only the ring meshes: HIGH 0.972 [0.950–1.000], ULTRA 0.983 [0.971–0.999]. So the ring meshes are 2–3% of these views.
- Turning off the ring and the edge band together: 0.917 HIGH, 0.918 ULTRA. So the band is about 5–6%.

**H vs G visually (looked at):** `…/r1/cmp/H_Gf_t25_top.png` with `…/r1/cmp/H_Gf_t25_diff.png`, `…/r1/cmp/H_Gf_t25U_diff.png`, `…/r1/cmp/H_Gf_tro_diff.png`, `…/r1/cmp/H_G_edgelow_sbs.png`, `…/r1/cmp/H_G_jan_t25_top.png`. Top-crop differences are 0.01–0.07 mean, ≤0.07% of pixels >24. The only differences are traffic and edge-row sway.

**Verdict.** Ring work is 2–3× lower than C0 and ring triangles are 17–43% lower in every edge view. Even so, three views still read +6.4% to +9.0% on the stand-in, as C0 did. That noise level cannot certify ≤ +5% per view. What is left is mostly the accepted edge band, not the ring.

## 3. ui page CPU

**What changed**
- `ringViewSame`: the per-frame ring pass returns immediately when nothing it depends on has changed. Its key covers camera position and matrices, LOD, camera height, fade heights, the switch, the shape flag and `ringVer` (which every ring step bumps).
- During fast pans the culling from item 2 means far fewer meshes are submitted. Far blocks per frame on street fast: HIGH 17.8 → 1.7 (G) → 1.1 (H), ULTRA 18.9 → 2.0 → 1.5. Near meshes: 3.0 → 1.1.

**Evidence**
- ui page, warm (base / C0 / G, 2 browsers per version, 4 reps, load 26–41, A/A ±27% per row; files `…/r1/perf/out/D3_G.jsonl`, `…/r1/perf/out/D3_C0.jsonl`):
  - All moving rows, G ÷ base: 0.808 [0.79–0.84], 0 of 4 reps above base. HIGH 0.810, ULTRA 0.829, still frames 0.560.
  - C0 ÷ base 0.789; G ÷ C0 1.016 [0.96–1.07].
  - The street-fast row alone reads 1.21 HIGH / 1.35 ULTRA (C0 1.08 / 1.36). That is inside the row noise.
- Town edge views, warm (file `…/r1/perf/out/W1_n.jsonl`): G ÷ base 0.777 [0.72–0.80], 0 of 16 rows above base, A/A ±24%.
- Cost of the new cell test, G vs H interleaved:
  - In-page probe (files `…/r1/perf/out/rq_*.jsonl`) cannot separate them: tree update summed over rows is 0.971 vs 1.069 ms on the ui page and 1.241 vs 1.158 ms on the town page, with A/A per row of 0.3–4.7×.
  - Node bench, 8 alternating runs (files `…/r1/bench/rvb2_*.json`): per ring-pass call H ÷ G is 1.02–1.12 by minimum. Paths that never run the cell test read 1.04–1.07, which is the noise floor. So the cell test costs at most about 1 µs per call.

## Addendum v2 (contingent): ui HIGH fresh first zoom-in

I measured this but did not change code. Fresh ui page HIGH, 4 fresh pages per side (file `…/r1/perf/out/V1.jsonl`):

| segment | base | 02464a3 | H | H with ring+band off |
|---|---|---|---|---|
| zoom-in, main-thread sum (ms) | 199.6 | 322.4 | 256.9 | 210.8 |
| zoom-in, TreeRenderer (ms) | 3.9 | 4.0 | 8.9 (ring pass 4.2) | 2.0 |
| street-settle frames >16.7 ms | 0/80 | 3/80 | 0/80 | 1/80 |
| street-settle frame 0 (ms) | 9.5–15.6 | 14.5–21.7 | 12.5–14.7 | 11.2–19.4 |

- Ring and band together add about 46 ms to the fresh first zoom-in. TreeRenderer accounts for about 7 ms of that; roughly 39 ms is drawing the ring and band meshes for the first time.
- The ring pass is cold for its first ~290 calls in Node: 260–390 µs each, against 5–8 µs warm.
- Every long frame H showed had at most 0.5 ms of tree work. The ring-off side and 02464a3 show the same sporadic long frames, so there is no new long frame from my lane against 02464a3 (gate 3).

**Plan if verify v2 flags it:**
1. Warm the ring pass at load time with a burst of synthetic poses, then reset `ringViewKey` and restore `ringPreload`.
2. Have the fresh-load lane's load-time warm render also draw the ring and band meshes. That
