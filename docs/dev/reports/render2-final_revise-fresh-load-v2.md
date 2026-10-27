# render2-final revise:fresh-load:v2 (Oct 27 ~16:00): verbatim final report

Workflow wf_08a5eb98-993 (resumed after the session restart). Paths inside point at the session scratch directory.

Two of my items are fixed in the live tree: the cut-sequence shadow passes, and part of the LOW edge-view triangles. The rest are measured and documented. My only changes are commit `567b9f7` (your WIP snapshot), unchanged since.

**Live tree and checks:** HEAD is `c2c7940` and `git status` is clean. My lines are in three files:
- `/home/user/simcityweb/src/render/city/buildings/BuildingRenderer.ts` (+114/−22)
- `/home/user/simcityweb/tests/render/cutShadows.test.ts` (new)
- `/home/user/simcityweb/tests/render/rubbleKitLow.test.ts` (new)

No other file is touched: no changes to `WorldView.ts`, `Shadows.ts`, `batch.ts`, `VehicleRenderer.ts`, the `lod*` files, `PropRenderer.ts`, `src/ui` or `src/game`. On `c2c7940`, which includes the seasons `TreeRenderer` change, `npx tsc --noEmit` is clean and `npx vitest run tests/render tests/game` passes (49 files, 362 tests).

**Method and bases:**
- Interleaved A/B with a fresh browser per side per rep, 8 reps, medians with 90% bootstrap CI, and A/A from duplicate labels.
- Bench pages run with `nodraw`; main-thread CPU comes from schedstat.
- I turned off GPU-process pinning (`GPU_PIN=-1`, as the verifier does): with it, the first zoom-out read head/base about 1.3.
- Calibration (warm town LOW, 4 rows, load 19) reproduced neither target. V1/a284b80 was 0.938 [0.910–0.990] and V1/be48061 0.633 [0.630–0.679], against 0.740 ± 0.05.
- So I used your decision: warm pages against be48061, fresh pages and the real path against a284b80, both shown where measured. Table: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/warm_town_low_calibration.txt`

## 1. [minor] Dense city LOW warm cut sequence (extra shadow pass) — fixed

**What changed, in `BuildingRenderer.ts`:**
- **Downgrades no longer re-render shadows.** A pure LOD downgrade (onto the far level, nothing back to full detail) now keeps `shadowCasters.version`. A cut's catch-up therefore no longer causes a second shadow render two frames after the cut. Upgrades still re-render.
- **The cut finishes in its own frame.** `lodCatchMin` goes from 3000 to 6000, so a far cut's 4.2k–4.9k swaps finish in the cut frame. With 3000, 300–1600 swaps waited: the cut frame drew those buildings at full detail (shadow pass up to 1.54M triangles), and they popped to proxies over the next two frames.

**Before/after, deterministic counts per run** (warm bench cut sequence: far, street, default, far+180, 5 frames each):

| Scene | Before (head) | After (fix) | c024 |
|---|---|---|---|
| city LOW | 5–6 shadow renders, 3.14–4.67M shadow tris, 30.37–31.14M main | 4 renders, 2.25M, 30.24M (3 of 3 runs identical) | 4 renders, 2.38M, 30.56M |
| city LOW, far cut | 879–890k (one run 1541k), then a 765k re-render | one 765k render | 807k |
| city HIGH | 14 renders, 21.75–23.67M shadow, 39.77–40.83M main | 14 renders, 20.96M, 39.34M | 14 renders, 21.40M, 39.09M |
| town LOW | 4, 1.50M, 14.89M | unchanged | 4, 1.54M, 14.90M |

Table: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/cuts_shadow_counts.txt`

**CPU, warm city LOW, fix vs head** (2 browsers per side, 4 rows):
- Cut sequence 0.946 [0.924–0.980]; pooled moving 0.970 [0.967–0.993]; A/A fix 0.987, head 0.956.
- The cut frame is 6.5 vs 5.8 ms median (max 9.4); the frame after it is 2.4 vs 3.6 ms.
- No frame over 16.7 ms in any warm cut (city LOW, town LOW, city HIGH, either side).
- Tables: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/warm_city_low_fix_vs_head.txt` and `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/long_frames_fresh_and_cuts.txt`

**Screenshots, looked at:** `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/cmp/cut1_head_vs_fix_f0_f2.png`
- Panels: head's cut frame, head two frames later, fix's cut frame, and a ×6 difference.
- Head's cut frame differs from its own frame 2 in 0.47% of pixels (more than 8 grey levels, max 137): the buildings popping.
- Fix's cut frame differs from its frame 2 in 0.03%; head and fix are identical at frame 2.
- Stats: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/cut_frames_image_diff.txt`

**Tests:** `cutShadows.test.ts` checks that a downgrade keeps the version and an upgrade moves it. It also checks that a cut of up to `lodCatchMin` downgrades finishes in the cut frame under a mocked slow clock, while 3000 leaves it behind.

## 2. [minor] LOW edge still views +5.4–6.4% main-pass triangles vs c024 — partly fixed, the rest needs your call

**Diagnosis:**
- The whole buildings excess is the rubble kit: burnt multi-cell lots, art since `eec7db3` (Oct 6) and part of the F reference.
- At the lowest edge view, two burnt 4×4 lots draw 62 pieces (8.4k triangles); c024 drew two stretched heaps (0.38k). Other buildings draw the same 6602 triangles on both.
- Culling or LOD can't remove it. The pieces are in view at 50–160 px, and their proxies look wrong at that size: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/cmp/edget25_full_vs_proxy.png` (looked at).
- Vehicles: 600 cars on both sides. The remaining ~0.8% is which cars happen to be in view, not a regression.
- Table: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/edge_buildings_by_class.txt`

**What changed, in `BuildingRenderer.ts`, LOW only** (where the kit casts no shadow):
- Burnt lots are built from lighter heap pieces with the same layout.
- Each heap drops its down-facing triangles that lie entirely under the debris bed (back faces under an opaque bed).
- Each ash spill drops its core ring.
- Everything above 8 cm, the wall stubs, the car and all proxies are unchanged. A preset switch rebuilds the burnt lots.
- Kit triangles fall 11.7% (18,758 → 16,566 over six test lots): `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/rubble_kit_census_final_L1.txt`

**Before/after, main-pass triangles vs c024:**

| Town LOW view | Before | After |
|---|---|---|
| edgelow | 1.065 | 1.058 |
| edget18 | 1.055 | 1.049 |
| edget25 | 1.051 | 1.046 |

- Street, default and far views are unchanged.
- HIGH is unchanged (fix/head 1.0000).
- Table: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/stills_low_high_vs_c024.txt`

**Screenshots, looked at:** `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/cmp/rub_close_L0_L1_diff.png` and `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/cmp/rub_vclose2_L0_L1.png`.
- At the very close view: mean difference 0.16 grey levels, 0.57% of pixels differ by more than 8 levels, max 48. The only change is faint tone inside the ash spills around the piles.
- At the close view the mean difference is at most 0.09.

**Not used:**
- Halving the debris blocks (−30% kit triangles) is visibly sparser at 120 m: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/cmp/rub_mid_L0_L2.png`
- A buried-geometry cull would save only ~2–3%.

**Tests:** `rubbleKitLow.test.ts` checks that the layout is the same and that triangles above 8 cm are identical. It also checks that no down-facing triangle sits under the bed and that the proxies are identical. The lighter/full ratio must be between 0.8 and 0.92, and a LOW→HIGH→LOW switch must keep instance counts.

**Decision for you:** edgelow is still +5.8% (the kit about +5.0%, car sampling about +0.8%). Getting under +5% needs either a visible LOW-only art change (such as the halved blocks, with art review) or accepting the kit as F art at LOW.

## 3. [minor] Gate 3: real-path frame 2 at 68–83 ms — measured, option built, not adopted

**Final tree,** real path (main menu → Continue, LOW, no audio):
- Frame 2 median is 23.7 / 24.2 ms at load ~15 (6 reps per label) and 38.9 / 61.3 ms at load 10–17 (3 reps).
- It splits into the scene callback (5–15 ms), worker proxy replies (0–23 ms), and other main-thread work from the menu-to-city switch (10–63 ms: DOM, style, GC, timers).

**Option:** queue worker replies and install them at the start of the next LOD update (at least 8 and at most 2 ms per frame, all of them in the load frame).
- Patch: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/patch/J_inbox_drain_BuildingRenderer.diff`
- Its test: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/patch/proxyInstall.test.ts`
- **Gain:** frame 2 drops to 10.1 / 16.6 ms. Frames over 33.3 ms in frames 2–30 go from 3 to 0 (12 loads each); frames over 16.7 ms stay at 10 vs 10.
- **Cost on the real path:** the first zoom-out reads 1.036 [0.983–1.081] in pairs and 1.041 [1.020–1.073] in version means (A/A 1.017 / 1.001).
- **Cost on the fresh bench city:**
  - fresh-load veil-fade frames (frames 2–30) over 16.7 ms rise to 9 in 8 loads, against 7 in 16 (fix) and 9 in 16 (head);
  - one multi-frame burst appears (street pan frames 12–21 at 17–35 ms);
  - pooled first motions run about 0.8% higher.
- Tables: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/real_path_low_noaudio_inboxJ_FGJ.txt`, `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/real_path_low_noaudio_inbox_FGI.txt`, `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/fresh_city_low_fix_vs_head_FCL4.txt`

**Verdict:** mixed, so not adopted. The remaining part of frame 2 is in the other lane: start the music director after the veil fade, and the UI work of the menu-to-city switch.

## 4. [minor] Load cost (not gated) — unchanged, as you accepted

- **Dense city LOW** (load 3): load main-thread CPU 3.3–3.4 s vs a284b80's 2.6 s. First frame 514–526 ms vs 160–166 ms. 51 vs 26 shader programs; ready at 7.6–7.9 s vs 4.4 s.
- **Town LOW:** 2.0 s vs 1.45 s; first frame 365–390 ms vs 120–131 ms.
- This revision doesn't change it (fix ≈ head).
- Spreading the warm-up over several frames would need `CityScene` (`src/game`) to hold the ready signal and the veil until the slices finish, which is the other lane's file. Not done.

## 5. [minor] Isolated long-frame bursts (city zoom-out frames 82–88) — not reproduced

- **Final tree, 80 fresh bench loads** (5 runs × 16, 10 moving segments): only 4 single frames over 16.7 ms.
  - town zoom-in frame 7 at 35.8 ms;
  - city far-orbit frames 2/3 at 38.4 / 30.6 ms;
  - city pan frame 48 at 31.1 ms.
- Head had a 24.7 ms frame in the same rep as the far-orbit pair, so that rep was machine noise.
- a284b80 had 7 such frames in 8 loads and 19 in 16, mostly its first street frame (17–29 ms, shader compiles that our warm-up removes).
- The only multi-frame burst I saw was in the inbox option from item 3.
- Table: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/long_frames_fresh_and_cuts.txt`

## 6. [major, other lane] ui page HIGH fresh first zoom-in / zoom-out / far orbit above a284b80 — for the record, no `src/ui` edits

**UI part, for the sim/UI team.** The frame loop in `/home/user/simcityweb/src/game/CityScene.ts:609` runs UI work every frame or at a fixed rate even when nothing changed. The verifier's trace of the first zoom-out shows style/layout/paint 124 vs 84 ms and timers 28 vs 7 ms. Pointers and suggested fixes, matching STATUS "Planned fixes":
- `/home/user/simcityweb/src/ui/MiniMap.ts:185` redraws the whole minimap every 0.1 s even with a still camera. Redraw the view rectangle only when its corners move by a minimap pixel, on a small overlay instead of re-blitting the base map.
- `/home/user/simcityweb/src/ui/Notifications.ts:113` writes the ticker's `style.transform` every frame, including the same value when it isn't scrolling. Drive it with a CSS animation, or skip unchanged writes.
- The ~6 Hz top bar and panel ticks, and `/home/user/simcityweb/src/ui/TopBar.ts:87`: compare values before writing, and pause non-essential panel ticks while the camera moves.
- The timers in `/home/user/simcityweb/src/ui/MusicPlayer.ts:183` and `:387`: fold them into the frame tick. Also pool WebAudio one-shot nodes and start the music director after the veil fade.

**Render part:**
- **Ring:** the seasons lane's ring warm-up, now in `c2c7940`, cuts ring-pass CPU on the fresh first zoom-out and far orbit by 30–40% (their numbers).
- **Rest of the HIGH far-view cost: not attempted** (your "only if cheap").
  - Profiles of the warm town HIGH zoom-out show no hotspot in my files: batch build 13–22 ms, pushGroups 5–15 ms, vehicle posing 4–10 ms, out of 470–710 ms of JavaScript per run.
  - Two profiles of the same build differ by 1.5×.
  - V1 had the same cost, and the warm page passes against be48061.

## 7. [major, other lane] Real path LOW first pan ~+10% vs a284b80 — for the record

- The excess is outside the scene callback (UI); the fix is the same as item 6.
- On the render-only bench page the first pan is below a284b80: town LOW 0.951 [0.871–1.022], city LOW 0.896 [0.857–0.947].
- I didn't re-run the real path against a284b80; my real-path runs compared head with the inbox options only.

## Gate 1, fresh pages vs a284b80 (final tree, 8 reps, with A/A)

- **Town LOW** (load 17.5): pooled 0.949 [0.907–0.994] in pairs, 0.930 [0.900–1.001] in version means; A/A base 1.032, fix 0.959. Every segment is below 1 (zoom-out 0.967, zoom-in 0.956). `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/fresh_town_low_vs_a284b80_FTL4.txt`
- **City LOW** (load 3): pooled 0.910 [0.872–0.935] / 0.910 [0.882–0.940]; A/A base 1.030, fix 1.032. `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/fresh_city_low_vs_a284b80_FCL5.txt`

**Worth rechecking in v3 at low load:** street pan 1.025 [0.983–1.050] and street fast pan 1.035 [0.997–1.071] are inconclusive under the rule. The base A/A for the fast pan is 1.091.
- An earlier run at load 17.7, with no base A/A, read the fast pan at 1.130 [1.051–1.286]: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/fresh_city_low_vs_a284b80_FCL3.txt`
- It isn't from this revision (fix/head 0.987 on that segment).
- On those pans fix's own frame-callback JavaScript is below base; the small excess runs outside the callback.

**This revision vs head:**
- Fresh town LOW 1.010 [0.969–1.053] / 1.001 [0.991–1.024] (A/A head 0.980, fix 1.040): `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/fresh-load/tables/fresh_town_low_fix_vs_head_FTL5.txt`
- Fresh city LOW 1.013 / 1.017 (A/A head 0.976, fix 1.030).
- Warm town LOW 1.015 [1.004–1.025], within noise (A/A fix 1.022, load 21).
- Warm city HIGH 0.980 [0.954–1.068] (5 rows, no A/A).
- Warm town LOW against be48061 is 0.662 [0.635–0.693] (0 of 4 rows above); against a284b80 it is 0.970 [0.947–0.992].

## Cleanup and coordination

- All my vite servers, chains and browsers are stopped, and my vite cache is removed. Nothing of mine is running; the seasons lane's runs are untouched.
- `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/COORD.md` has my final note; I need nothing from the seasons lane.
- My snapshot holds the unadopted inbox option, scratch only.
