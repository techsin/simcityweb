# render2-final revise:seasons-final:v2 (Oct 27 ~16:05): verbatim final report

Workflow wf_08a5eb98-993 (resumed after the session restart). Paths inside point at the session scratch directory.

**seasons-final revise v2: all four items are fixed and committed by you (5447e80, 8bfd6b5, c2c7940); one gate-2 check, the GPU cost of the new crowns, still needs the desktop.**

Labels used below: R1 is the tree before revise v2 (fa13c85 render), R2 is 5447e80, R3 is the final live code (8bfd6b5 + c2c7940). Scratch root, written `…/` below: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/seasons-final/`.

On HEAD 76cf22a: `npx tsc --noEmit` is clean and `npx vitest run tests/render tests/game` passes (51 files, 376 tests). The working tree is clean and those three commits hold only my files: TreeRenderer.ts, ringEdge.test.ts and seasons.test.ts. fallbackTrees.ts and propLod.ts are unchanged.

## 1. [minor] Pale far copses at 200–340 m: fixed (8bfd6b5)
**What changed (TreeRenderer.ts):**
- **Own height band:** next to an edge, the far blocks' round crown now has its own camera-height band (`ringShapeHeight = 440`). It is whole up to about 300 m, half open at about 345 m and almost back to the cone by about 380 m. Before, it was whole only up to 185 m and gone by 240 m.
- **Wider reach:** the crown reaches further from the edge (`RING_CROWN_FAR = 1.2` × lodDistance), so the NW-corner case 700 m in also gets crowns.
- **Switch unchanged:** the near/far switch keeps its old formula, so the near/far split of trees is the same on the CPU and in the shaders.
- **Shader and CPU:** the shader gets a new `ringEdgeDist` helper. The CPU picks the crown geometry per sector and tests a crown block's bounds from the tree foot. The single far-ring mesh is not used while any visible block draws crowns.
- **Why not your elevation-angle idea:** it would have put the 15-triangle crown on edge sectors in default and ULTRA views as well. F itself switches to cones at about 380 m, which the height band matches.
- **Tests:** a new ringEdge test covers 170–500 m at 600, 700 and 900 m in. No tree is cut or drawn twice, the uniforms are right, every tree the shader opens uses the crown geometry, and only cones are drawn above the band. The cell-cull test gained a 300 m pose.

**Evidence (all sheets looked at), darkest-15 % luma of the far band:**

| View (HIGH) | F | R1 | R3 |
|---|---|---|---|
| W edge 600 m in, 220 m | 115.4 | 119.3 | 114.2 |
| W edge 600 m in, 300 m | 111.5 | 115.6 | 110.2 |
| W edge 600 m in, 380 m | 111.9 | 112.0 | 111.7 |
| NW corner 700 m in, 300 m | 99.1 | 102.4 | 94.7 |
| ULTRA NW corner, 300 m | 94.6 | 98.5 | 93.2 |

- Sheets: `…/cmp/a3_Wb_h220_F_R1_R3f_top2x.png`, `a3_Wb_h300_F_R1_R3f_top2x.png`, `a3_Wb_h340_F_R1_R3f_top2x.png`, `a3_NWb_h300_F_R1_R3f_top2x.png`, `a5m_Wb_h300_F_R1_R3f_top2x.png`, `a5u_NWb_h300_R1_R3f_top2x.png`.
- **Rise flight** (`…/cmp/a3_rise_sheet_F_R1_R3f.png`): R3 follows F, with no pop. The worst frame-to-frame jump is 1.19 for F, 1.20 for R1 and 1.20 for R3.
- **No side effects elsewhere:** at HIGH and ULTRA, 39 of 42 regression shots are byte-identical to R1. Only the intended 240–300 m edge views differ.
- **Triangles** (main pass, vs R1):
  - Edge views at 300 and 380 m: +2.9 % / +3.5 % at HIGH, +2.7 % / +3.2 % at ULTRA.
  - MEDIUM edge views at 220 / 300 / 380 m: +6.0 / +2.5 / +3.1 %.
  - Every other still view is identical at all four qualities, and LOW is identical.
- Tables: `…/out/table_art_luma.txt`, `…/out/table_K1_stills.txt`.

## 2. [minor] Ring CPU at far views: fixed (5447e80)
The cost was not the ring bookkeeping: that pass measured 6–9 µs per call when warm. It was the per-draw work of about 18 far-block and 12 edge-band meshes. Far views now draw the far ring as one mesh (ring plus band draws 30–31 → 13 per frame), and the per-frame searches start from the last frame's answer.

Warm pages, browsers relaunched for each block of rows:

| | ULTRA (12 rows, load 6–25) | HIGH (8 rows, load 9–19) |
|---|---|---|
| Ring cost on the far orbit, R3 | +61 µs/frame [−30..+112] | +64 [−283..+174] |
| Ring cost on the far orbit, R1 | +346 [+23..+540] | +251 [+89..+436] |
| R3 / V1, far orbit | 0.943 [0.906–1.021] | 0.994 [0.922–1.046] (R1/V1 1.056) |
| R3 / R1, pooled moving | 0.999 [0.972–1.015] | 0.994 [0.963–1.023] |
| A/A (ring off on both builds), pooled | 1.027 | 0.989 |

The target of about 0.15 ms at the ULTRA far orbit is met. The single mesh submits slightly more triangles, all culled in the vertex shader: +0.9–1.1 % on the far orbit and +0.4 % on cuts. Tables: `…/out/table_WU3_ultra.txt`, `table_WH3_high.txt`.

## 3. [minor] Edge triangle counts: record updated, no change needed
- **Edge still views vs c024** (= R1): HIGH low / t18 / t25 edge views 1.470 / 1.330 / 1.218; ULTRA 1.532 / 1.400 / 1.267.
- **Far still view vs c024:** 1.040 HIGH, 1.041 ULTRA (from the single mesh).
- **Moving segments:** main triangles R3/R1 +0.3 %. With perf v2's R1 sums that gives about 0.967 (HIGH) and 0.976 (ULTRA) vs c024.

## 4. ui-page HIGH fresh first zoom-in, tree share: both steps done
- **Step 2 (5447e80):** the load's warm-up draws every hidden ring and band mesh once, inside `loadWarm.queue`. No WorldView change was needed.
- **Step 1 (c2c7940):** `warmRingPass` runs 300 ring passes over synthetic views at load, then the real view's pass. A test checks that the ring state afterwards matches a build without the warm-up. It costs about 24 ms on a quiet machine; load-frame CPU went 426 → 444 ms; nothing at LOW.
  - The measured build differs from the committed code only in names. Shots from the committed code are byte-identical to the measured build.
  - Ring-pass CPU on the first zoom-out and far orbit, with vs without the warm-up:
    - **ui page (8 reps):** 0.65 [0.60–0.91] and 0.65 [0.36–0.96]; zoom-out 4.9 → 2.9 ms, back to R1's level.
    - **Bench page (8 reps):** 0.59 [0.51–1.35] and 0.72 [0.42–0.89].
    - Segment totals change by 0.97–0.99, inside noise.
- **First zoom-in tree cost (CPU):** 3.7–4.4 ms vs base 0.7 ms, of which the ring pass is 1.9 ms. That is about 1 % of the segment.

**Fresh town HIGH bench vs a284b80** (final code, 8 reps, load 1.4–1.9, A/A 0.99–1.02):

| Segment | R3 / base |
|---|---|
| Street | 0.891 [0.743–0.957] |
| Zoom-out | 0.975 [0.914–1.029] |
| Far orbit | 1.031 [0.898–1.129], inconclusive |

Two more readings:
- **Ring cost:** on vs off in the same build, the ring adds 8.1 % [5.8–13.5] to the first zoom-out and 2.5 % to the far orbit.
- **Long frames:** none over 16.7 ms in any segment across 72 fresh bench loads. Tables: `…/out/table_FUH3_uihigh.txt`, `table_FBH4_townhigh.txt`, `table_FBR_ring.txt`.

## Open
- **GPU cost of the new crowns (gate 2) needs the desktop real-GPU check.** The GPU stand-in could not be measured here: A/A was 0.4–2.2x at load 19–29, so I stopped it. Please include the bench views edgeh220/300/380 at MEDIUM, HIGH and ULTRA, plus the far view.
- **Fresh HIGH far orbit was 1.18 vs base at load 6–8** (base A/A 1.09, so inconclusive), with R1 the same at 1.15. At quiet load it was 1.03. The ring is only a small part of it, so the rest is HIGH far-view render work outside my lane.
- **Scattered single long frames on the ui page:** base 0, R1 6, R3 3, R3 with the warm-up 11, over 8 loads each. Four of the last were in zoom or cut segments (17, 18, 40 and 64 ms). They sit mid-segment, never at load, and the bench pages show none. This looks like the known GC/UI pattern, but I could not attribute it without per-frame phase capture.
- **Art polish only:** at about 320–380 m camera height, still views show half-open dark caps on short trunks (`…/cmp/a3_NWb_h340_h380_F_R1_R3f_4x.png`). At MEDIUM, the W edge at 240–300 m now shows crowns where F has cones.
- **Base not re-calibrated:** I used your Oct 27 bases (fresh a284b80, warm be48061). Warm pages were compared to R1 and V1; R3/V1 is about 1.00 pooled.

COORD.md is updated; I need nothing from the fresh-load lane. My servers, browsers and chains are stopped and my vite cache and raw poller dumps are removed. Tools and raw data remain in the scratch dir; resume notes are in `…/notes/STATE.md`.
