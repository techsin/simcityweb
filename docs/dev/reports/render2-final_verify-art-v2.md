# render2-final verify:art:v2 (Oct 27 ~10:50) — PASS, 1 findings

Verbatim structured result of the art verifier (workflow wf_e99805b4-834).

**pass:** True

## Summary

Verdict: pass. No blocker or major. One minor (seasons-final): the 200-340 m remainder of the v1 pale-far-copse minor, which predates revise v1 (V1 identical).

**What was reviewed.** The HEAD tree in the real CityScene. HEAD is 2705509; src/render is identical to the snapshot I rendered (f065b1f, render files = fa13c85); only docs/sim/ui and CityScene.feedShake changed after it. Compared against F c87d8c8 and V1 c30fca4; N 4b3d074 was not needed.

**Setup.** Three entry points:
- rv.html: the real CityScene on saved cities (town edge city; 128 city with 1837 buildings; dense 256 demo; ui town).
- The real load path: index.html → import into IndexedDB → reload → title → Continue.
- demo-city.html.

Rendering ran on SwiftShader through my own vite servers on ports 9711-9714. Settings:
- Manual 16.67 ms rAF clock.
- Fixed date, hour, climate and quality; render scale 1.
- Canvas captured right after each frame.

I found two things that made the first fresh-load runs non-comparable: dynamic resolution and the sim's day boundaries both run on real time. I re-ran with dynamic resolution off from the load's first frame, the sim held during the load, and settles padded to 60 frames.

Every image cited was looked at; crops at 2-10x; stats are mean abs diff, px>8 / px>24, mean / darkest-15 % luma and frame-to-frame diffs. Load average was 23-80 on 4 cores (mostly 40-65). One HIGH flight was OOM-killed and re-run.

**Seasons.**
- **Ring audit.** An in-page port of ringEdge.test.ts audit() ran on the real scene: 638 poses per run, 5 runs (June HIGH, June ULTRA, Jan MEDIUM, tropical HIGH, Jan HIGH). Poses cover all six flights, 160 random low edge/corner poses at 25-240 m and 150-1000 m in, and 60 high/default/far poses. No tree the view shows was left out (one ULTRA case at 5.3 km was a false positive: its drawn shape is outside the frustum). None was drawn twice. The cache re-derive differed only at the load's preload pose, as intended.
- **Edge stills.** e1: 20 June HIGH views covering N/E/S/W, NW/SE corners and along-edge, 25-240 m, 300-900 m in. e2: Oct, Jan and tropical × 6 views, F/V1/C. e3/e4: MEDIUM/ULTRA × 6. e5: 170-380 m bracket. e1b.
- **Result at ≤170 m.** C's far copses are round dark crowns on trunks to the horizon, as F, in every season. Example: E_e300_h25 right band darkest-15 % F 117.3 / V1 120.3 / C 116.5. No holes, doubled rows or pale spinning tops.
- **Flights.** HIGH rise, inward, edge and corner orbit, plus MEDIUM rise, inward, edge and orbit. In every flight the worst frame-to-frame jump (vs neighbouring frames) matches V1 (1.02-1.26, all camera motion). No pop at the crown opening or the 1.3 switch.
- **Fast street pan.** ui page, HIGH, 46 frames with a per-frame audit: 0 trees cut and 0 cache differences. The end state equals a forced re-derive, and all 18 captured frames are byte-identical to V1.
- **Default views** match V1. Views that show the horizon still submit 530-875 far-block instances (V1: 11.4k), with the same draw calls and triangles as V1.

**Fresh load.**
- **LOW and HIGH on the real load path:** byte-identical to V1 on every captured frame (49 + 3 rest shots each), covering frames f1-f8, the first zoom-out (633 → 3000 m), the first zoom-in (→ 90 m), street frames and the LOW↔HIGH switches. No flash, no missing or wrong-LOD building, props and cars as V1.
- **MEDIUM cross-fades** (slow 0.7 %/frame zoom on the real load path, up to 79 concurrent fades). On all 144 audited frames per side, the buildings drawing their empty stand-in equal the running fades; none stuck. 41 of 54 frames are identical to V1; the rest differ by ≤ 0.003 % of pixels (one house's dither phase).
- **Demo pages** (dense 256 HIGH/LOW, 128 MEDIUM): the whole city from the first frame; differences vs V1 are cars only.
- **Re-enter** (exit to region, then Play the same tile): the warm-up runs again and there is no flash.

**Regression sweep.** 62 cameras C vs V1:
- 128 city: default, street, far, edge defaults, street at the edge; dusk, night, dawn; Jan, Apr, Oct, Nov.
- Desert, tropical and alpine; LOW, MEDIUM and ULTRA.
- ui town; dense 256 HIGH/LOW.

17 are byte-identical. The rest differ only by the animation clock (cars, police light bars, the riot beacon pulse, rooftop shading speckle; padded dense re-runs were identical) plus the intended round far crowns. About 150 C-vs-V1 still pairs in all.

**Not checked.** Real GPU. F at MEDIUM/ULTRA (dropped for load). Mouse/wheel input and camera damping (the camera was set directly). Dynamic-resolution behaviour (turned off for determinism). V1's re-entered scene (its exit to the region timed out in the harness).

**Cleanup.** No git or source changes. Servers, browsers and runners are stopped and the vite caches removed.

Evidence is in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/artrev-v2/: notes_v2.txt, cmp/, shots/, data/rlHIGH2_cmp.txt, tools/.

## Findings

### 1. [minor] lane seasons-final

**Issue.** The v1 pale-far-copse minor is only partly fixed. Below about 185 m camera height, far ring copses near a map edge or corner now read like F in every season: round dark crowns on trunks. From about 200 m to about 340 m they still draw as small pale light-green cones floating over dark forest stains (at about 200 m they are half-open flat light caps), where F shows dark round crowns on trunks. At 380 m F switches to cones as well. The look is identical to V1 from 220-240 m up, so this predates revise v1 and is not a regression. The hand-over is eased, with no pop.

**Evidence.**

e5 height bracket (town.bin, June, HIGH, 1280x720, F / V1 / C, crop darkest-15 % luma). W edge 600 m in: 170 m 115.0 / 114.7 / 110.7 (fixed: C darker than F); 200 m 110.0 / 114.5 / 112.8; 220 m 107.8 / 114.5 / 114.6; 240 m 106.0 / 113.7 / 113.7; 300 m 104.0 / 110.6 / 110.6; 380 m 108.7 / 108.9 / 108.9. NW corner 700 m in: 200 m 74.2 / 77.7 / 77.7; 300 m 73.4 / 79.3 / 79.3. V1 vs C px>24 is 0.000 % from 240 m up and 0.008 % at 220 m. Sheets, all looked at: cmp/e5_Wb_e600_h220_FV1C_2x.png, cmp/e5_Wb_e600_h300_FV1C_2x.png, cmp/e5_NWb_e700_h300_FV1C_2x.png (clearest: F a full copse of dark round crowns, V1 = C a field of pale cones), cmp/e1_W_e600_h240_far_FV1C_3x.png. The same look at MEDIUM and ULTRA W_e600_h240 (V1 == C): cmp/e3_med_W_e600_h240_top_V1C_3x.png, cmp/e4_ultra_W_e600_h240_top_V1C_3x.png. Rise flights cmp/fl3_rise_V1C_band.png (HIGH) and fl2 (MEDIUM) show the eased change to this look by about 215 m; worst frame-to-frame jump vs neighbouring frames 1.26 at HIGH and 1.20 at MEDIUM, the same as V1. For contrast, the fixed low-camera case: cmp/e5_Wb_e600_h170_FV1C_2x.png. All paths are under /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/artrev-v2/.

**Fix.** Open the far blocks' ringLow crown (and its 0.8 tint) by the view elevation onto each tree, not only by the camera-height fade. In RING_LOW_VERT use _lw = max(1 - uRingP.y, 1 - smoothstep(0.26, 0.34, (cameraPosition.y - p.y) / distance(cameraPosition, p))) * ringEdgeNear(p), which opens the crown below about 15-20 deg at any camera height, and drop the uRingP.y < 1 gate for the shape. Keep the switch weight lw = (1 - fv) * ne as it is, so the ringLowSwitch near/far partition stays unchanged on the CPU and in the shaders. Wherever this shape weight can be > 0, the CPU far-block box test (ringMicroTopY, i.e. from the waist up, for high cameras) and ringCellBox must use the tree's foot, or the opened crowns get culled at the bottom of the view. A simpler alternative is a separate, higher height band for the crown shape near the edge (for example 110-400 m instead of 110-240 m). Cost: edge sectors' far trees draw ringLow's 15 triangles instead of top's 3.
