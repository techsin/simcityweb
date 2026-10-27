# local-T003-gpu-smoke: real-GPU smoke test (Direct3D 11 through ANGLE)

Local worker, base `6023549` on `claude/beautiful-johnson-u2jqoz`. No source changes. Evidence is in
`docs/dev/reports/local-T003-gpu-smoke/` (small); the raw output (75 + 30 + 30 runs, 270 screenshots, 4K PNGs) stays outside git.

## Setup

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 5070 Ti (PCI 0x2C05), 16 GB, driver 32.0.16.1047 (NVIDIA 610.47); a 4K 160 Hz monitor is attached |
| Renderer string | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)`, the same headless and headed |
| Reference | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader ...))`, same browser build |
| Browser | Chromium 141.0.7390.37 (bundled with Playwright 1.56.1), headless, viewport 1920×1080 and 3840×2160, DPR 1 |
| CPU / OS | Ryzen 7 9800X3D, 62 GB; Windows 10 Education 19045 |
| Launch args | GPU: `--enable-gpu --ignore-gpu-blocklist --use-angle=default`; reference: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` |
| Scenes | `demo-city.html?q=<q>&hud=0`; `demo-ui.html?town=1&quality=<q>`; `demo-world.html?quality=<q>&hud=0`; game `index.html?quickstart=1&size=small&seed=7` (new small city); game with the simbot city (`--size 256 --years 21 --seed 7`, 304,083 residents, 9,223 buildings) imported through `importRegion` + `continueInCity` (the same code path as Load Region → Import file… → Play) |
| Controls | Camera through `cameraController.setView` (street = 70 m at 28° tilt, default = the page's start view, far = 95 % of max distance); hour through `applySettings({autoTime:false, fixedHour})` / `timeOfDay`; month through `state.day` + `trees.setMonth` + `terrain.setMonth`. The game sim is paused (speed 0). Quality set by URL or by `metropolis.settings`. |
| Run times (UTC, Oct 27) | Screenshots + 60 Hz interval timing: 02:08–03:54 (75 runs, one fresh browser each, sequential). Per-frame GPU/CPU timing: 04:01–04:31 (30 runs). Render bursts: 04:32–04:36 (30 runs). LOD probe: about 04:50. |

The harness is in `local-T003-gpu-smoke/harness/` (`run.mjs` does one config per browser; `matrix*.sh` run the sets; `montage.mjs` builds the
contact sheets and the GPU-vs-SwiftShader diff scores).

## Findings

No blockers. No GPU-only visual defects. No shader compile or link errors, no `WebGL: INVALID_*`, no NaN warnings, and no context loss
of the city's own canvas in any scene, quality or resolution.

### MINOR-1 (performance headroom): far zoom on a large city at 4K draws 3–4× more triangles than at 1080p, mostly in the shadow pass
- **Evidence:** `harness/run.mjs lodprobe`, 304k city, ULTRA. I sampled `renderer.info` every 500 ms for 8 s after each view change. Values
  alternate between frames with and without a shadow-map update.

  | View | 1080p | 4K |
  |---|---|---|
  | Default | 2.66M tris / 115 calls (5.84M / 197 on shadow frames) | identical |
  | Far | 2.55M / 261 (5.5M / 463 on shadow frames) | **8.4M / 320 (20.9M / 578 on shadow frames)** |

  HIGH at 4K far: 17.7M tris / 488 calls on a shadow frame. The shadow pass adds about 12.5M triangles per update at 4K far, against
  about 3M at 1080p, although the shadow map's resolution does not depend on the screen. So the shadow casters appear to reuse the main
  camera's screen-resolution-dependent LOD.
- **Cost:** wall time per `render()`, from 10 back-to-back renders between GPU syncs, median of 5:

  | View | LOW | HIGH | ULTRA |
  |---|---|---|---|
  | Far, 4K | 7.1 ms | 13.1 ms | 15.2 ms |
  | Far, 1080p | 5.5 ms | 5.5 ms | 5.9 ms |
  | Default, 4K | 4.1 ms | 6.6 ms | 7.0 ms |

  The GPU timer on the scripted camera sequence agrees: at 4K ULTRA, p95 14.7 ms, p99 17.0 ms, and 16 frames over 16.7 ms of GPU time,
  all during the zoom-out/zoom-in.
- **Impact:** on this RTX 5070 Ti no frame was dropped. Every 60 Hz rAF interval stayed ≤ 16.8 ms. But ULTRA has
  `dynamicResolution:false`, so a mid-range GPU at 1440p/4K ULTRA (or HIGH, where dynamic resolution only reacts after sustained slow
  frames) will very likely miss frames at far zoom over a big city. That is projected, not measured here.
- **Suggested fix:** choose shadow-caster LOD from the shadow camera (texel size) rather than the main view, or force the coarsest LOD
  and skip small casters in the shadow pass beyond some distance. Alternatively, cap the main-view far-ring LOD bias by distance, not
  pixels. Re-measure with `node harness/run.mjs gpu game300k ultra 3840 2160 <out> lodprobe,burst`.

### MINOR-2: water shader early return trips the D3D compiler warning X4000 "potentially uninitialized variable (f_waterGround)"
- **Evidence:** in every GPU run (60/60) at every quality, logged as a `THREE.WebGLProgram: Program Info Log` warning. It never appears
  on SwiftShader.
- **Cause:** `waterGround()` (`src/render/world/WaterRenderer.ts:53`) returns from inside an `if` that samples `uHeightTex`, then
  samples `uOuterTex` outside it. FXC flattens this and warns. Sampling with implicit derivatives inside non-uniform control flow can
  also give wrong mip selection along the map edge on some drivers. No visible artefact on this NVIDIA card: the water and coast in the
  coast shots match SwiftShader.
- **Suggested fix:** compute both UVs, sample both textures unconditionally (or with `texture2DLod(..., 0.0)`), and pick the result
  with `mix`/`step`, keeping a single return.

### MINOR-3 (info): three.js `FXAAShader` trips X3595 "gradient instruction used in a loop with varying iteration" and X4000 (f_ApplyFXAA)
- **Evidence:** at LOW only (10/10 LOW runs), because LOW is the quality that uses FXAA (`src/render/world/PostFX.ts:446`, stock
  `three/examples/jsm/shaders/FXAAShader.js`).
- **Impact:** its input is a render target without mipmaps, so derivatives have no effect in practice. LOW screenshots match
  SwiftShader.
- **Suggested fix (optional):** copy the shader and use `textureLod(..., 0.0)` in the edge-search loop to silence it. Not worth doing
  on its own.

### INFO (not defects)
- **X4122 precision warnings** ("sum of 0.996094 and … cannot be represented accurately"): the constants are 255/256 from three.js's
  RGBA depth-packing chunk. Harmless; seen in every GPU run.
- **`webglcontextlost` in every game run that goes through the title screen:** it is `menu-bg-canvas`, detached, i.e. the
  `forceContextLoss()` in `MenuBackground` dispose (`src/region/render/MenuBackground.ts:310`). Intended. The city canvas's context
  stays alive (checked with `isContextLost()`).
- **Largest GPU-vs-SwiftShader pixel differences** (`gpu_vs_swiftshader_diff.json`) are all night shots of the cities. They come from a
  different lit-window pattern and traffic between runs, not from rasterisation. Other differences: the demo-ui town has more
  construction progress on SwiftShader because it loads more slowly before the sim is paused, and fresh cities get random names. Day
  shots of the same content agree to normal precision: mean abs diff 1–8 / 255, worst 30×30 block ≤ 30. **Tooling suggestion:** a seed
  or freeze for window lights and traffic would make GPU-vs-reference diffs exact.
- **Not GPU-specific, for the art lane:** at far zoom the 304k city reads as a bright white grid of lot and road outlines over the green
  (`pair_game300k_ultra.png`, top right). It looks the same on SwiftShader.

### Checked and clean
I looked at every screenshot: 90 GPU at 1080p, each next to its SwiftShader twin, plus 90 GPU at 4K.
- No missing or black meshes, shadow acne, peter-panning or z-fighting.
- No flicker between the 120-frame settle and the shot.
- No wrong colours, water or sky artefacts, or fog banding.
- January is bare and brown, June is green, night is lit, across all five scenes.
- 4K adds detail without new aliasing.

Spot checks at full resolution (e.g. `game300k_ultra_1920_gpu_street_day_jun`): clean shadow edges on houses, trees and lamp posts.

## Frame timing

**How to read it:**
- **Intervals** are rAF-to-rAF in a 60 Hz headless browser: 30 s idle at the default view (June 14:00), then a scripted 20 s camera
  sequence. The sequence is 0–5 s pan of 40 % of max distance, 5–10 s zoom-out to far, 10–15 s zoom-in to street, 15–20 s 360° orbit
  back out.
- **(>18, >34)** counts intervals over 16.7 ms (with 1.3 ms vsync jitter allowed) and over 33 ms.
- **rAF CPU** is the main-thread time spent in all `requestAnimationFrame` callbacks per frame. It covers the app's whole per-frame
  work: sim tick (paused here), objects, `WorldView.update` and `render`.
- **GPU timer** is `EXT_disjoint_timer_query_webgl2` around `WorldView.render()`.
- **Render burst** is the per-`render()` wall time from synced bursts. It is the trustworthy GPU+driver cost per view.
- **† means the timer column is not trustworthy for that row.** On demo-city and demo-world the timer reads 14–16 ms at both 1080p and
  4K, while bursts show 1.7–3.6 ms. The query brackets an idle wait on those pages. The game pages' timer agrees with the bursts.
- **Dynamic resolution never lowered the render scale** (minimum 1.0 in every run).

The **uncapped** run (`--disable-gpu-vsync --disable-frame-rate-limit`) was discarded. Chrome then fires rAF at about 600 fps without
backpressure and stalls about 450 ms whenever its queue fills, headless and headed alike, so its intervals do not measure frame cost.

| Scene | Q | Res | Idle intervals p50/p99/max ms (>18, >34) | Camera intervals p50/p99/max ms (>18, >34) | Idle rAF CPU p50/p99 | Camera rAF CPU p50/p99 | Idle GPU timer p50/p95/p99 | Camera GPU timer p50/p95/p99 (>16.7) | Render burst street/default/far ms | Idle tris / calls |
|---|---|---|---|---|---|---|---|---|---|---|
| demo-city | LOW | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.7/1.2 | 0.8/1.3 | 1/3.13/16.37 † | 0.94/16.04/17.22 (32) † | 0.66/1.04/1.51 | 0.57M / 57 |
| demo-city | HIGH | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.2/1.9 | 1.2/2 | 14.95/17.44/18.33 † | 14.4/17.64/18.76 (202) † | 0.81/1.83/2.39 | 1.68M / 177 |
| demo-city | ULTRA | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.3/2 | 1.3/2.2 | 15.87/17.67/18.55 † | 14.9/17.58/18.7 (205) † | 0.98/1.92/3.03 | 1.80M / 196 |
| demo-city | LOW | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.7/1.2 | 0.8/1.5 | 2.14/2.57/16.37 † | 2.05/15.11/16.9 (17) † | 1.82/2.22/3.19 | 0.57M / 57 |
| demo-city | HIGH | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.2/2 | 1.2/2.2 | 14.84/18.12/19.16 † | 14.23/17.98/19.62 (224) † | 2.27/4.13/5.08 | 1.68M / 177 |
| demo-city | ULTRA | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.3/2.3 | 1.2/2 | 16.1/18.55/19.67 † | 14.46/17.93/19.51 (239) † | 3.73/4.52/5.84 | 1.80M / 196 |
| demo-ui town | LOW | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/1 | 0.6/1.2 | 2.11/3.51/4.03 | 0.64/3.17/4.05 (0) | 0.66/0.8/0.89 | 0.42M / 42 |
| demo-ui town | HIGH | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.9/1.6 | 0.9/1.7 | 3.31/4.49/5.13 | 1.58/4.19/4.76 (0) | 0.89/1.6/1.41 | 1.44M / 153 |
| demo-ui town | ULTRA | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.1/1.9 | 1/1.8 | 3.56/4.67/5.07 | 2.16/4.51/5.15 (0) | 0.84/2.24/1.61 | 2.12M / 238 |
| demo-ui town | LOW | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/1 | 0.6/1.1 | 1.86/3.77/4.55 | 1.35/3.44/4.28 (0) | 1.23/1.49/1.63 | 0.42M / 42 |
| demo-ui town | HIGH | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.9/1.5 | 0.9/1.6 | 4.66/5.7/6.25 | 2.96/5.5/6.14 (0) | 1.73/3.5/2.6 | 1.44M / 153 |
| demo-ui town | ULTRA | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.1/1.8 | 0.9/1.7 | 5.2/6.31/6.65 | 3.65/6.18/6.68 (0) | 2.8/4.24/3.01 | 2.13M / 239 |
| demo-world | LOW | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/0.7 | 0.5/0.9 | 0.94/1.17/2.59 † | 0.81/1.18/16.7 (13) † | 0.66/1.07/0.96 | 0.78M / 51 |
| demo-world | HIGH | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.6/1.1 | 0.7/1.3 | 15.76/18.28/19.82 † | 14.8/18.68/20.13 (325) † | 0.82/2.56/1.71 | 1.82M / 135 |
| demo-world | ULTRA | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.8/1.3 | 0.8/1.4 | 14.18/17.41/19.7 † | 14/17.05/18.43 (93) † | 0.87/3.59/2.07 | 2.66M / 250 |
| demo-world | LOW | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/0.8 | 0.5/0.9 | 1.64/1.86/13.25 † | 1.46/1.84/15.86 (6) † | 1.04/1.79/1.78 | 0.78M / 51 |
| demo-world | HIGH | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/1.1 | 0.7/1.3 | 15.79/18.39/20.03 † | 14.93/18.88/19.95 (319) † | 1.61/4.46/2.9 | 1.82M / 135 |
| demo-world | ULTRA | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.7/1.3 | 0.7/1.4 | 6.78/17.64/18.81 † | 14.63/18.28/19.99 (273) † | 2.63/5.74/3.54 | 2.66M / 250 |
| game, new small city | LOW | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/0.9 | 0.5/0.9 | 1.11/2.7/3.66 | 0.64/1.5/3.26 (0) | 1.24/1.16/0.61 | 0.94M / 45 |
| game, new small city | HIGH | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.6/1.3 | 0.8/1.4 | 2.16/2.78/4.79 | 1.23/3.44/5 (0) | 1.77/2.22/0.97 | 1.73M / 119 |
| game, new small city | ULTRA | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.7/1.4 | 0.8/1.5 | 2.02/3.1/4.51 | 1.47/3.97/5.16 (0) | 1.71/2.07/1.09 | 1.60M / 126 |
| game, new small city | LOW | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.5/0.9 | 0.5/1 | 1.9/2.02/2.63 | 1.39/2.23/3.19 (0) | 2/1.96/1.36 | 0.94M / 45 |
| game, new small city | HIGH | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.6/1.2 | 0.8/1.4 | 4.24/5.89/6.69 | 3.12/5.58/6.86 (0) | 2.81/4.3/2.28 | 1.74M / 119 |
| game, new small city | ULTRA | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.6/1.3 | 0.8/1.5 | 4.31/6.06/6.8 | 3.6/5.75/7.18 (0) | 4.07/4.43/2.89 | 1.60M / 126 |
| game, 304k city | LOW | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.9/1.6 | 1/1.9 | 4.71/5.76/6.5 | 3.86/7.99/9.45 (0) | 0.67/3.1/5.49 | 3.05M / 97 |
| game, 304k city | HIGH | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.3/2.4 | 1.5/2.7 | 6.26/7.89/8.64 | 4.91/9.6/11.31 (0) | 0.73/4.22/5.53 | 4.07M / 137 |
| game, 304k city | ULTRA | 1080p | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.6/2.6 | 1.7/3.1 | 6.85/8.56/8.99 | 5.14/9.74/11.39 (0) | 1.02/4.68/5.92 | 4.27M / 156 |
| game, 304k city | LOW | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 0.9/1.6 | 1/1.7 | 5.1/6.26/6.74 | 4.26/8.31/9.92 (0) | 1.81/4.08/7.09 | 3.13M / 97 |
| game, 304k city | HIGH | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.4/2.2 | 1.6/2.7 | 8.05/9.15/9.87 | 6.16/13.18/14.82 (0) | 2.21/6.64/13.08 | 4.08M / 137 |
| game, 304k city | ULTRA | 4K | 16.7/16.8/16.8 (0, 0) | 16.7/16.8/16.8 (0, 0) | 1.5/2.3 | 1.7/2.6 | 8.54/10.1/10.54 | 6.52/14.7/16.98 (16) | 3.66/7.04/15.19 | 4.27M / 156 |

**Summary:**
- **Frames:** at 60 Hz on this GPU, no scene, quality or resolution drops a frame. 0 intervals over 18 ms in 60 one-minute runs,
  including the 304k city at ULTRA 4K.
- **Main thread:** at most 3.1 ms at p99 (304k city, ULTRA, camera moving).
- **Most expensive case:** the 304k city at far zoom at 4K HIGH/ULTRA, 13–15 ms per render (MINOR-1).
- **Load times** (navigation to ready, GPU): demo pages 1–2.5 s; game new city 2.7 s; 304k city import 5.9–7.3 s. SwiftShader 9–12 s
  for the 304k city.

## Evidence files (`docs/dev/reports/local-T003-gpu-smoke/`)
- `pair_city_high.png`, `pair_game300k_ultra.png`, `pair_world_ultra.png`: GPU (rows 1, 3) over SwiftShader (rows 2, 4); street, default,
  far by day in June, default by night in June, default by day in January, street by night in January.
- `4k_game300k_ultra.png`: the six views at 4K on the GPU.
- `frame_timing_60hz.json`, `render_burst_ms.json`, `shot_meta.json` (per-shot triangles, draw calls, render scale, load times, log
  counts), `gpu_vs_swiftshader_diff.json`.
- `harness/`: the scripts used, with my local paths.

Codex was not used for this task.
