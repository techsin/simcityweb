# render2-final verify:perf:v2 (Oct 27 ~08:30) — FAIL: 2 majors (lane "other": UI per-frame cost on fresh pages vs a284b80), 12 minors

Verbatim structured result of the perf verifier (workflow wf_e99805b4-834). Its tables, tools and running notes are in
`docs/dev/reports/render2-final_verify-perf-v2/` (paths inside them point at the old scratch directory; the compiled
`tools/poll` binary is left out, build it from `tools/poll.c`).

**pass:** False

## Summary

PERF verifier v2, render round 2 final. Verdict: pass=false, because two majors remain against a284b80, both in lane "other". Both are on pages that include each version's whole UI:
1. The fresh ui page at HIGH. The first zoom-in, zoom-out and far orbit are 1.09-1.14x base. This is v1 major (b)'s ui part, still not fixed. It is better than N, and at or below be48061 on the one rep measured.
2. The real load path at LOW, first pan, without audio: 1.10-1.11x base. The part that is clearly shown is UI work outside the scene's frame callback.

The render lanes' own work passes on the render-only bench pages:
- v1 major (a) is fixed: the fresh LOW town first zoom-out is at or below base (0.976 / 0.932); V1 was 1.039 on the same harness.
- v1 major (b), LOW part, is fixed: first zoom-in 0.851.
- v1 major (c) is fixed: the bench-page frame 2 is about 11 ms, and on the real load path new has fewer long frames per load than c024.
- The dense-city regressions vs V1 are gone.
- Allocations are 3.6-5x lower than any other version.
The remaining render-lane items are minors: ring CPU at high-camera far views (seasons-final), and cut-sequence shadow passes and LOW edge-view triangles (fresh-load; both also in V1).

**What I measured**
- Sides: HEAD f065b1f (its src/render equals fa13c85). The live HEAD is now 37e53f8, with identical src/render and src/assets; only a CityScene quake-shake guard changed.
- References: a284b80, be48061, 535655d, c024 (02464a3), V1 (c30fca4) and N (4b3d074).
- Machine: 4 cores shared with other agents. Load average 38-75, mostly 55-70.
- CPU: schedstat per thread, plus a C poller at 400-500 µs for per-frame data.
- No-draw mode: GL draws and blits are skipped, everything else runs. Measured draw encoding cost is 0.04-0.08 µs per draw.
- Fresh pages: a new browser per side per rep, sides rotated, 8 reps with A/A copies.
- Warm pages: rows interleaved, two browsers per version.
- Statistics: medians with 90% bootstrap CIs, and the lead's rule for fresh-page majors.

**Base calibration** (V1/base, warm pooled moving; targets town 0.740 and dense city 0.675, ±0.05)

| base | town LOW | town HIGH | town ULTRA | city LOW | city HIGH |
|---|---|---|---|---|---|
| a284b80 | 0.905 [0.896-0.909], 0.908, 0.954 [0.951-0.993] | 0.986, 1.096 [1.081-1.116], 1.031 | 1.144 | 0.825 [0.809-0.842] | - |
| 535655d | - | - | - | 0.591 | - |
| be48061 | 0.676 [0.662-0.697], 0.726 [0.721-0.729] | 0.799, 0.816 | 0.867 | 0.554 [0.530-0.562] | 0.608 [0.582-0.635] |
| a284b80 + be48061 assets | 0.925 | - | - | - | - |

- a39c560 was not tried: it sits between 535655d and be48061, which behave alike.
- **Fresh-page check:** v1's fresh LOW town base costs (zoom-out 163 ms, zoom-in 79 ms) match a284b80 (155 / 84 ms), not be48061 (305 / 151 ms).
- On the same harness, V1/a284b80 on fresh pages (FTLv, 6 reps) is: first zoom-out 1.039 [0.971-1.150], version means 1.022. v1 measured 1.059 [1.03-1.09]. On zoom-in I get 0.841 where v1 had 1.057.
- Against be48061, V1 would come out at about 0.5-0.7 on fresh pages. That cannot match v1's 1.06.
- v1 used the t_plains town save, which was lost in the reset. My town is a SimBot 128 plains city at year 8 with 2953 buildings, so the scene differs.
- **No single commit reproduces both v1 numbers.** be48061 reproduces the warm town ratio; a284b80 reproduces v1's fresh results.
- **Decision:** warm pages are gated on be48061, with a284b80 as a cross-check. Fresh pages and the real load path are gated on a284b80, with be48061 shown where measured. If the lead uses be48061 everywhere, both majors pass: ui 0.94 (1 rep); real path every segment ≤ base (5 reps).

**Gate 1, fresh pages vs a284b80** (pairs / version means, 8 reps)

| page | result |
|---|---|
| Town LOW bench (48 loads) | Pooled 0.923 [0.878-0.960] / 0.952. Street 0.763, zoom-out 0.976, far orbit 0.916, zoom-in 0.851, cuts 0.972. vs be48061 0.662, vs c024 0.676. |
| City LOW bench | Pooled 0.918 [0.808-0.961]. Zoom-in 0.817, far orbit 0.769. vs V1: pooled 0.994, zoom-in 0.920, far orbit 0.986, cuts 1.128 [0.963-1.280]. |
| City HIGH bench | Street-settle 0.762 [0.718-0.893]. Pooled 1.031 / 0.985. Street pan 1.177 / 1.114 (A/A 1.085, so inconclusive). |
| ui HIGH (40 loads) | Pooled 1.077 [1.032-1.170] / 1.079 [1.050-1.111]. Major. vs N 0.911. |
| Real path LOW, audio on (40 loads) | Zoom-out 1.065 [1.013-1.111] / 1.062 [1.020-1.104]. Zoom-in 1.046 / 1.057. vs c024 0.78-0.98. |
| Real path LOW, no audio (32 loads) | Zoom-out 1.068 / 1.069. Pan 1.109 [1.076-1.162] / 1.099 (major). Render parts 0.94-1.18 and inconclusive. Scene callback equal in traces. |
| Real path LOW vs be48061, no audio (5 reps) | Every segment 0.78-1.00. |
| Real path HIGH (4 reps, no base A/A) | Far orbit 1.167 / 1.171. vs c024 0.66-1.01. |

**Gate 1, warm pages** (pooled moving; be48061 is the gating base)

| page | vs be48061 | vs a284b80 | vs V1 |
|---|---|---|---|
| town LOW | 0.706-0.711 | 0.942 | 0.974 |
| town HIGH | 0.79-0.81 | 0.99-1.16 | 0.980 [0.963-0.996] |
| town ULTRA | 0.854 | 1.153 | 1.020 |
| city LOW | 0.577 | 0.853 | - |
| city HIGH | 0.603 | 0.946 | - |
| city ULTRA | 0.714 | 1.015 | - |
| ui LOW | 0.967 | 1.029 | - |
| ui HIGH | 0.922 | 1.030 | - |
| ui ULTRA | 0.900 | 1.018 | - |

- Warm A/A was 0.95-1.05 for most runs.
- I excluded the first ui LOW run, where the poller was read truncated: the stop() call waited at most 3 s while the poller wrote a 47 MB file. I fixed this and reran it.

**Ring cost** (same build, ring on vs off, warm)
- HIGH: far orbit +0.30 ms/frame, edge pan +0.38, edge turn +0.53.
- ULTRA: far orbit +0.38 ms/frame, where V1 had about 0; edge turn +0.20, where V1 had +0.55.
- With the ring off, the HIGH zoom-out is still 1.24x a284b80. V1 has the same.

**Gate 2** (counts; GPU stand-in not measurable at this load, A/A |log| 0.4-3.2)
- LOW still views vs c024: town 0.996-1.003, edge views 1.054-1.064 (equal to V1), city 0.968-0.999.
- LOW moving per-page sums vs c024: main tris 0.92-0.93, total tris 0.77-0.79, calls 0.81-0.85.
- HIGH/ULTRA non-edge still views: +2.3-3.1% vs c024 (equal to V1).
- HIGH/ULTRA ring edge views: +22-54% vs c024, and 0.84-1.02 vs V1.
- HIGH/ULTRA per-page moving main tris: 0.936-0.973 vs c024.
- Cuts: town at or below c024; dense city LOW +5-7% total (V1 pattern); HIGH cuts 1.02-1.05 main.

**Gate 3**
- Real path LOW, frames 2-30 per load: over 16.7 ms new 2.3 vs c024 4.6; over 33.3 ms 0.94 vs 2.0.
- Real path HIGH: over 16.7 ms 2.6 vs 8.0.
- Bench first frames: new has no more long frames than c024.
- Warm pages: 0-3 isolated frames of 17-24 ms per 1350-3000 frames, for every side.
- Real-path frame 2 is 68-83 ms, the same backlog c024 has (82 ms).

**Allocations** (KB per frame, warm town)

| quality | new | a284b80 | be48061 | c024 |
|---|---|---|---|---|
| LOW | 21 | 76 | 80 | 96 |
| HIGH | 31 | 162 | 285 | 139 |

**Load cost (not gated)**
- Real path frame 1: 337-412 ms vs c024 195-218.
- Load main CPU: 3.16 vs 2.92 s.
- Heap: 264 vs 228 MB.

**Files** (all under /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/render2/final/perfrev-v2)
- Tables: tables/*.txt (rebuild with tools/report2.sh)
- Raw data: out/*.jsonl
- Running notes: STATE.txt
- Drivers: tools/fresh.mjs, game.mjs, warm.mjs, uipage.mjs, stills.mjs, tridiag.mjs; bench pages in tools/benchsrc

**Cleanup.** All my chains, drivers, browsers and vite servers on ports 9741-9748 are stopped, and ps shows none of mine. I removed vitecache and the poller .bin files. I changed no source files and no git state. During the run the memory cgroup OOM-killed two chrome renderers with oom_score_adj 800; none of my runs errored, so they appear to have been other agents'. I cut my parallelism after that.

## Findings

### 1. [major] lane other

**Issue.** The first zoom-in, zoom-out and far orbit on a fresh ui page at HIGH still cost more main-thread CPU than the a284b80 base. The lead's major rule is met: the lower 90% CI bound is above 1.02 for both pairs and version means, and A/A is within 5%. This is v1 major (b), ui part, and it is not fixed against a284b80. It is better than round 4 (N), and against be48061 it is at or below base on the one rep measured. Most of the zoom-in excess runs outside the scene's frame callback, in UI DOM work and timers. For the zoom-out and far orbit, the larger share is HIGH far-view render work that V1 already had (the ring plus a non-ring HIGH zoom-out cost), and the rest is UI.

**Evidence.**

FUH: 8 reps x 5 labels (base A/B, new A/B, N), 40 loads, load 57-58. new/a284b80, pairs / version means:
- zoom-in 1.092 [1.040-1.186] (12/16) / 1.095 [1.043-1.135] (7/8)
- zoom-out 1.136 [1.056-1.225] (12/16) / 1.137 [1.096-1.176] (8/8)
- far orbit 1.129 [1.028-1.206] / 1.097 [1.042-1.164]
- pooled moving 1.077 [1.032-1.170] / 1.079 [1.050-1.111]
- A/A: base 0.981-0.984, new 0.970-1.035.
Other references:
- vs N (4b3d074): zoom-in 0.924, zoom-out 0.893, pooled 0.911.
- vs be48061 (FUHb, 1 rep only, stopped to save memory): zoom-in 0.938, zoom-out 0.948, pooled 0.940.
Phase split (29 loads with per-phase poller CPU):
- Render part (world.update + objects.update + world.render + worker messages): zoom-out 1.210 [1.073-1.342] / 1.241, far orbit 1.242 / 1.266. A/A new is 0.88 / 0.78, so inconclusive. Zoom-in 1.083 [0.80-1.27] / 0.974.
- Outside the scene callback: zoom-out 1.101, far orbit 1.097 [1.045-1.163], zoom-in 1.140 [1.099-1.264].
Warm ui HIGH: 1.030 [0.983-1.076] vs a284b80, 0.922 vs be48061.
Attributing the render share on bench pages:
- Warm town HIGH zoom-out is 1.18-1.24x and far orbit 1.25-1.30x a284b80. V1 is the same (1.16-1.17 / 1.30-1.32).
- Same build, ring on vs off: the ring adds +0.30 ms/frame on the far orbit and +0.08 ms/frame on the zoom-out.
- With the ring off, the HIGH zoom-out is still 1.24x a284b80.
Tables: tables/fresh_ui_high_vs_a284b80.txt, fresh_ui_high_phase_split.txt, fresh_ui_high_vs_be48061_1rep.txt.

**Fix.** UI (sim/UI team): cut per-frame DOM work while the camera moves. On the real load path's first zoom-out (no audio, one trace each), the scene callback is the same as a284b80's (306 vs 309 ms). Blink lifecycle work (style, layout, paint, layerize) is 124 vs 84 ms and timers are 28 vs 7 ms. Suggested changes: throttle HUD, minimap and label updates during camera motion (10 Hz or less), avoid layout reads in per-frame handlers, and keep animated HUD parts on their own compositor layers. For the render share, see the ring minor and the warm HIGH minor. If the lead decides fresh pages should also be gated on be48061, this finding passes (1 rep: 0.94).

### 2. [major] lane other

**Issue.** On the real game load path (main menu -> Continue, LOW, WebAudio disabled), the first default-distance pan costs about 10% more main-thread CPU than a284b80, and the excess is shown under the lead's rule. The part that is clearly shown runs outside the scene's frame callback (UI). The render part is also up but inconclusive (A/A 7.7%). On the render-only bench page the same first pan is below base, and against be48061 on the same real path it is 0.78.

**Evidence.**

FGLnb: base A/B vs new A/B, 8 reps, 32 loads, load about 60.
- pan pairs 1.109 [1.076-1.162] (13/16), version means 1.099 [1.048-1.151] (8/8); A/A base 0.992, new 1.021.
- Phase split: outside the scene callback 1.140 [1.103-1.199] / 1.160 [1.046-1.209] (A/A 1.027 / 0.974).
- Render part 1.182 [1.040-1.328] / 1.114 [1.006-1.215], A/A new 1.077. Medians per 60 frames: world.render +8 ms, world.update +3, objects.update +2.
- With audio (FGL, 8 reps): 1.118 [0.981-1.250] / 1.081 [1.010-1.201], A/A new 0.872, so inconclusive.
- Bench page first pan (FTL, 8 reps): 0.932 [0.728-1.030].
- Real path vs be48061 (FGLnb2, no audio, 5 reps): 0.781 [0.735-0.807]. Render part 0.499, outside part 1.089 (UI still +9% vs be48061).
Tables: game_low_noaudio_vs_a284b80.txt, game_low_noaudio_phase_split.txt, game_low_noaudio_vs_be48061.txt, game_low_noaudio_vs_be48061_phase.txt.

**Fix.** Same UI work as the ui-page major: the app's per-frame DOM and timer cost has grown since a284b80, and is still +5-11% vs be48061. Nothing for the render lanes on the bench page. To settle the real-path render part, rerun FGLnb when load is under 30.

### 3. [minor] lane other

**Issue.** Real path, first zoom-out and first zoom-in (the real-path part of v1 majors (a) and (b)): the point estimates are above a284b80, but the rule is not met, so this is inconclusive. The excess sits outside the render code: UI lifecycle, timers, and with audio on, the music director and WebAudio node-finish tasks. On the render-only bench page the v1 majors are fixed: LOW town first zoom-out at or below base (V1 was 1.04 on the same harness), first zoom-in 0.85.

**Evidence.**

Zoom-out:
- With audio (FGL, 8 reps, 40 loads, load 54-56): 1.065 [1.013-1.111] / 1.062 [1.020-1.104], A/A 1.046 / 0.954. Scene callback 1.048 [0.975-1.138].
- No audio (FGLnb): 1.068 [1.010-1.108] / 1.069 [1.016-1.122], A/A 0.949 / 0.984. Render part 1.056 [0.865-1.146] / 0.989, outside 1.157 [1.006-1.234].
Zoom-in:
- With audio: 1.046 [1.012-1.112] / 1.057 [1.038-1.109], A/A new 0.871.
- No audio: 1.039 [0.997-1.081] / 1.043 [1.011-1.080].
Zoom-out window traces (1 load each):
- With audio: 2604 WebAudio RequestToDeleteHandlersOnMainThread tasks and 1680 audio_scheduled_source_handler Finish tasks. director.ts:262 timer 87 vs 20 ms, ambience.ts 23 vs 12 ms. 13.7k vs 3.5k top-level tasks.
- These timers scale with wall time, and a 90-frame zoom-out takes 30-67 s at this load.
- No audio: scene callback 306 vs 309 ms.
Bench page (FTL, 8 reps): first zoom-out 0.976 [0.895-1.078] / 0.932 [0.872-1.222], first zoom-in 0.851 [0.770-0.891] / 0.847.
V1 vs a284b80 on the same harness (FTLv, 6 reps): zoom-out 1.039 [0.971-1.150] / 1.022.
Real path vs be48061 (no audio): zoom-out 0.809, zoom-in 0.885.

**Fix.** Nothing for the render lanes. UI/audio: same as the ui-page major. Pooling and reusing WebAudio one-shot nodes would remove thousands of node-finish main-thread tasks per minute.

### 4. [minor] lane seasons-final

**Issue.** Ring CPU has moved to high-camera far views. With a moving camera at ULTRA, the ring now adds about 0.38 ms/frame on the far orbit, where it cost nothing in V1. As a result the ULTRA far orbit is 3-12% above V1, while edge turns and edge flights got cheaper than V1. Draw work on the far orbit is identical to V1, so the extra cost is CPU-side ring bookkeeping.

**Evidence.**

Warm town, same build with the ring on vs ring=0 (TreeRenderer.ringWidth = 0 + applyRingOn), 2 rows each.
- ULTRA, new: far orbit +15.6% (177.4 vs 154.6 ms per 60 frames, +0.38 ms/f), edge pan +12.5% (+0.28), edge turn +6.9% (+0.20), zoom-out +2.9%; pooled +7.2%.
- ULTRA, V1: far orbit -0.5%, edge turn +21.7% (+0.55 ms/f); pooled +5.6%.
- HIGH, new: far orbit +15% (+0.30 ms/f), edge pan +20% (+0.38), edge turn +25% (+0.53), cuts +8%, zoom-out +3%.
new vs V1:
- With the ring: ULTRA far orbit 1.026 (RO2) and 1.121 [1.097-1.313] (3/3 rows, WM_town_ultra).
- Without the ring: 0.888.
- Far-orbit main tris 1.000 and calls 0.999 vs V1.
- Edge segments improved: HIGH edge fast 0.805, edge turn 0.898, edge pan 1.037; ULTRA edge turn 0.98.
vs be48061: far orbit 0.60 (HIGH) / 0.91 (ULTRA).
Tables: ring_*.txt, warm_WM_town_ultra_vs_V1.txt.

**Fix.** In updateRingView, skip the per-frame near-pair prefix boxes and far-block or cell tests for a high camera that sees the whole ring. Alternatively, reuse last frame's result until the camera crosses a sector or cell boundary or turns past a threshold. Rebuild ringPrefixBounds only when a near pair's depth order or content changes. Target: the ULTRA far-orbit ring cost back to roughly the 0.15 ms range.

### 5. [minor] lane other

**Issue.** Warm HIGH and ULTRA pages are above a284b80, but well below the calibrated base be48061. V1 has the same excess, so it is not from this round. Single far-view and ring segments at HIGH/ULTRA are 1.1-1.46x a284b80, which exceeds the lead's ~1.12x ring allowance if a284b80 is taken as the warm base.

**Evidence.**

Pooled moving, new/a284b80:
- town HIGH: 0.990 (WT, 4 rows), 1.104 (WM, 3), 1.011 [0.988-1.033] (WR, 2), 1.160 (RO, 2)
- town ULTRA 1.153 [1.091-1.166]; city ULTRA 1.015 [0.991-1.040]
- ui LOW 1.029 [1.014-1.044], ui HIGH 1.030 [0.983-1.076], ui ULTRA 1.018 [0.980-1.056]
- at or below base: town LOW 0.942 [0.929-0.955], city LOW 0.853, city HIGH 0.946.
V1/a284b80: town HIGH 0.986 / 1.096 / 1.031, ULTRA 1.144.
Segments at HIGH/ULTRA vs a284b80: zoom-out 1.18-1.24, far orbit 1.11-1.46, edge pan 1.10-1.18, edge turn 0.96-1.40.
vs be48061 (gating base for warm pages): town 0.71 / 0.79-0.81 / 0.85, city 0.58 / 0.60 / 0.71, ui 0.97 / 0.92 / 0.90.
new vs V1: town LOW 0.974, HIGH 0.980 [0.963-0.996], ULTRA 1.020 [0.981-1.032].
No frame over 16.7 ms on any warm town or city segment beyond 0-3 isolated 17-24 ms frames per 1350-3000 frames, the same for every side.

**Fix.** Lead decision on the warm base. a284b80 fails the warm calibration on this town (V1/base 0.91-0.95 LOW, 0.99-1.10 HIGH, city 0.825, vs targets 0.740 / 0.675); be48061 meets it for the town. If a284b80 is intended, the targets are the HIGH zoom-out work (still 1.24x a284b80 with the ring off; V1 has it too) and the ring's far-view CPU (previous minor).

### 6. [minor] lane other

**Issue.** Fresh dense city at HIGH, first street pan: both estimates are above a284b80, but new's A/A is 8.5%, so by the rule it is inconclusive. It is the closest result to a major on the render-only bench pages. The street-settle before it is well below base.

**Evidence.**

FCH: 8 reps, 40 loads, load 57-58.
- streetpan pairs 1.177 [1.023-1.197] (11/16), version means 1.114 [1.028-1.198] (7/8); A/A base 0.983, new 1.085.
- farorbit 1.096 [0.963-1.183] / 1.045 [1.003-1.157]; pooled moving 1.031 [0.971-1.063] / 0.985.
- street-settle 0.762 [0.718-0.893] (v1 had 0.867); vs c024 pooled 0.795.
- Warm city HIGH streetpan 1.072 (2/2 rows) vs a284b80; the whole warm page is 0.60 vs be48061.
- In-page world.update wall time: 25 vs 6-9 ms per 60 frames. Draw calls are 0.45x and main tris 0.58x of a284b80's.
- The V8 profile at this load was dominated by native/idle time, so the cost could not be attributed further.

**Fix.** Rerun FCH streetpan at lower load. If it persists, profile WorldView.update (tree chunk LOD, shadow refit) during street-level pans at HIGH in the dense city.

### 7. [minor] lane fresh-load

**Issue.** LOW edge still views submit 5.4-6.4% more main-pass triangles than c024. The extra is buildings and vehicles at the map edge. The count is identical in V1, so it predates this round, but it is a LOW triangle difference vs c024 on 3 still views.

**Evidence.**

stills.mjs, town, deterministic counts, pass 2.
- LOW edgelow 150k vs 141k (1.064), edget18 196k vs 186k (1.055), edget25 218k vs 207k (1.054).
- LOW street 1.000, default 1.003, far 0.996 (calls 55 vs 66).
- Per object (tridiag): buildings 15.1k vs 7.0k at edgelow and 42.3k vs 32.3k at edget25; vehicles +0.7-0.9k. new == V1 exactly.
- LOW moving per-page sums are below c024: town warm main tris 0.926, all tris 0.773, calls 0.851; city 0.920 / 0.794 / 0.807.
- City LOW still views 0.968-0.999.

**Fix.** Check the building batch's culling and LOD selection when the camera stands at the map edge looking outward. Per-instance culling in partly visible edge tiles, or LOD by true distance, should bring the edgelow buildings back to roughly c024's 7k triangles.

### 8. [minor] lane fresh-load

**Issue.** In the dense city at LOW, the warm cut sequence is 5.0-6.7% above c024 in total triangles (shadow triangles +55-69%). In some runs a cut renders a second shadow pass (frame 2 or 17), and the first cut's shadow pass has 1.43M instead of 0.77M triangles. V1 shows the same run-dependent pattern, and the fresh dense city (new vs V1) is equal.

**Evidence.**

WC_city_low and WCv_city_low (warm, 1 row each), cuts:
- c024: 255 shadow calls, 2.38M shadow tris.
- new: 245-251 calls, 3.68-4.01M.
- V1: 175 calls, 2.25M in that run.
- Totals new/c024 1.049-1.067; main tris 1.011-1.021.
cutprobe per frame (shadow calls / tris):
- new run 1: 70/765k, 6/128k, 29/607k, 70/876k plus an extra 70/752k at frame 17.
- new run 2 and V1 run 1: 70/1426k at frame 0 plus an extra 70/765k at frame 2.
- V1 run 2: no extra pass.
- c024: 109/807k, 6/133k, 29/644k, 111/795k.
Town LOW cuts are at or below c024 (main 0.999, all 0.996). Fresh city LOW new vs V1: cuts tris 1.008.

**Fix.** Make the cut's shadow refit deterministic: no second shadow render within a few frames of a cut unless the receiver actually changed. Apply the same caster culling to the first cut's shadow pass as to the later cuts.

### 9. [minor] lane fresh-load

**Issue.** Gate 3 on the real load path passes: per load, new has fewer frames over 16.7 and 33.3 ms than c024. But frame 2 after viewsReady is not the 11 ms the lane reported. It is 68-83 ms, like c024's 82 ms. The scene's own work in frame 2 is 2-12 ms; the rest is backlog behind a 337-412 ms load frame.

**Evidence.**

FGL (LOW, with audio, 8 reps), frame 2 median: new 83 / new2 68 ms, c024 82, a284b80 19-20.
Frames 2-30 per load, new vs c024 vs a284b80:
- over 16.7 ms: 2.3 vs 4.6 vs 2.1
- over 33.3 ms: 0.94 vs 2.0 vs 0.69.
FGH (HIGH, 4 reps): over 16.7 ms 2.6 vs 8.0 per load, over 33.3 ms 0.9 vs 3.0.
No audio:
- FGLna: new 4 long frames in 4 loads vs c024 27 in 5.
- FGLnb: frame 2 new 21-31 ms, a284b80 15-20.
Frame-2 parts (scene loop / worker messages / other): e.g. 7/16/136, 12/19/131, 8/0/230. Traces show LOD proxy worker replies, the director.ts timers, incremental marking plus MajorGC ReduceMemory, and about 5.6k tiny tasks.
Bench page frame 2: town 11.2-11.5 ms, city LOW 14.7-15.2 ms (V1: 114-121 ms), so the v1 warm-up frame is gone.

**Fix.** Optional: time-slice the LOD proxy installs that land after the load frame, and start the music director only after the veil fade, so frame 2 on the real path is close to the scene's own 2-12 ms.

### 10. [minor] lane other

**Issue.** I could not measure the GPU stand-in (GPU-process CPU of a drawn frame) at load 55-75. Two identical browsers differ 1.5-3x per drawn frame. So the gate 2 GPU checks are not verified: LOW 'no GPU regression vs c024' and the HIGH/ULTRA GPU-process sums. Triangle and call counts are reported instead.

**Evidence.**

GT_low: c024 A/B vs new A/B, 6 views, 3 rows x 4 drawn frames.
- A/A |log|: 0.38-1.02 using the per-cell minimum, 0.70-3.2 using the median.
- Pooled new/c024 0.997 [0.711-1.118] (min) / 0.778 [0.257-1.586] (median).
gputhreads.mjs: light LOW frames cost about 8-12 ms, almost all on the GPU main thread. But runs of consecutive frames cost about 8 s each, with all 4 SwiftShader workers busy for 25-90 s of wall time (spin under contention). The drawn-sequence driver (warm4.mjs / bench3) was dropped for the same reason.

**Fix.** Rerun the GPU stand-in on a quiet machine (load under 30) or a real GPU: tools/warm.mjs gpu mode with the town at LOW/HIGH/ULTRA and c024 A/B vs new A/B, using the per-cell minimum.

### 11. [minor] lane seasons-final

**Issue.** For the record (accepted ring art): at HIGH/ULTRA, edge still views and fast edge flights submit far more main-pass triangles than c024, which has no ring. Against V1 this round reduced them, except HIGH edget25 (+2.3%, the 15-triangle ringLow crown) and edge turn (+1%). Per-page moving sums stay within +5% of c024.

**Evidence.**

Still views, main tris new/c024:
- HIGH: street/default/far 1.024-1.028 (= V1); edgelow 1.475, edget18 1.330, edget25 1.221.
- ULTRA: non-edge 1.023-1.031; edge 1.27-1.54.
- new/V1 edge views: HIGH 0.898 / 0.927 / 1.023, ULTRA 0.841 / 0.877 / 0.921.
Warm moving, main / all tris vs c024:
- edge fast: HIGH 1.452 / 1.338, ULTRA 1.580 / 1.423
- edge pan: HIGH 1.301 / 0.994, ULTRA 1.369 / 1.035
- edge turn: HIGH 1.114 / 0.862, ULTRA 1.124 / 0.857
- cuts: HIGH 1.026 / 1.017, ULTRA 1.028 / 1.019; city HIGH 1.045 / 1.067 (fresh 1.054 / 1.085)
- per-page moving main tris 0.964 (HIGH), 0.973 (ULTRA), 0.936 (city HIGH).
new/V1 moving: HIGH edge fast 0.909, edge pan 0.926, edge turn 1.011; ULTRA edge pan 0.878, edge turn 0.990; per-page sums 0.996 / 0.989.

**Fix.** None required if the ring stays accepted. The lead's +7% HIGH / +12% ULTRA limits for fast edge flights can only be met against V1, not c024. GPU-process sums still need the quiet-machine rerun.

### 12. [minor] lane fresh-load

**Issue.** Load cost (reported, not gated): the warm-up now runs inside the load frame. That makes frame 1 roughly 1.8-2x c024's and 2.5-3x a284b80's. The heap is larger and load main-thread CPU is slightly up vs c024.

**Evidence.**

Real path, frame 1:
- LOW (FGL): new 337-384 ms vs c024 195, a284b80 125-128
- HIGH (FGH): new 387-412 vs c024 218, a284b80 144.
Real path, LOW, main CPU from click to 40 frames after viewsReady: 3.16 s vs c024 2.92 vs a284b80 2.26. Heap 264 vs 228 vs 196 MB.
Bench first frame:
- town LOW: 416-443 ms vs c024 182, a284b80 120-123
- city HIGH: 663-732 vs 476 vs 205-216
- city LOW: 617-618 vs V1 439.
Bench heap after GC: town 265-269 vs 229 vs 182-185 MB; city HIGH 483-485 vs 427 vs 401-425; city LOW 492-515 vs V1 476.
Bench load main CPU: town 1.86-1.92 vs 1.64 vs 1.30-1.33 s.
Wall time to ready at load 60: town 69-73 s vs c024 62; city HIGH 88-90 vs 69. Shader programs: 50-58 vs 46-56.

**Fix.** Not gated. If load time matters, split the loadWarmUp queue across the frames behind the opaque veil instead of running it all in frame 1.

### 13. [minor] lane fresh-load

**Issue.** Isolated long-frame bursts in single fresh loads of new, each seen once in 16 loads; c024 has more long frames overall. The worst is a 7-frame burst (30-193 ms) late in the first dense-city LOW zoom-out. V1 had none in 8 loads, and c024 was not on that page.

**Evidence.**

- FCL r6 new zoomout, frames 82-88: 74, 30, 51, 31, 124, 101, 193 ms.
- FTL r1 new pan f44: 113 ms. FTL r7 new zoomout f2: 23 ms (c024 had 0 zoom long frames in 8 loads).
- FCH r6 new2 zoomout: up to 218 ms. Over its 8 loads FCH c024 had about 30 frames over 16.7 ms (street f0 30-40 ms every load, cuts, zoomout) vs new/new2 12 in 16 loads.
- Fresh first 30 frames over 33.3 ms: town new 9 in 16 loads vs c024 6 in 8; city HIGH new 2 in 16 vs c024 3 in 8.

**Fix.** If it recurs on a quiet machine, trace FCL zoomout frames 80-90: likely a burst of LOD proxy installs or a major GC.
