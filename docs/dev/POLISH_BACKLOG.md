# Polish backlog (lead)

Polish ideas and minor findings that independent verifiers raised but that were not fixed in their round.
They feed the polish & fun pass (docs/POLISH_PLAN.md). Items that a later round fixes are marked **[fixed …]**.

> Note: on Oct 26 the session container was reset and the scratch copy of this file was lost. The entries from
> rounds r3/r4 (playtest, veteran, newplayer r3; render art/perf r4; render-handoff; playtest r4) could not be
> recovered. The polish rounds run their own playtests and will rediscover anything that still matters.
> Everything below was recovered from the session transcript. This file now lives in the repo so it survives resets.

## From render2-final art verify v1 (Oct 21 07:4x) — PASS, 1 minor
- [art minor, TreeRenderer RING_LOW_VERT lw>0 path] far outer-ring copses past ringLowSwitch (~1.3-1.45 km at HIGH, camera <240 m near a map edge) read as pale "spinning tops"/kites without trunks vs F's round crowns. Fix idea: RING_LOW_APEX 0.15 -> ~0.35, smooth outward normals or RING_LOW_TINT on lit upper faces; optional 1-2 tri trunk stub or ringLowSwitch 1.6 -> 1.8-2.0 x lodDistance if edge tri budget allows. Re-shoot e3 E_low + tro/jun t25 vs F. Evidence render2/final/artrev-v1/cmpv/e3_E_low_band_R_1x.png.
- [perf note from art reviewer — check against perfrev-v1] LOW dense city: first 11 frames after the street cut draw 1.71-2.09 M tris (C) vs 1.41-1.59 M (N) because bulk wake swaps 192/frame (N: 512); occluded buildings stay on full models until ~frame 22. Logs render2/final/artrev-v1/logs/ffc2_{C,N}_low.log. If perfrev-v1 does not raise it: consider a higher cap for occluded/off-frustum swaps only (they are invisible, so no pop) during the load window.

## From render2-final perf verify v1 (Oct 21 ~08:50) — FAIL (3 fresh-load majors → revise v1); minors not sent to fresh-load
- [perf minor, other] load-to-ready main-thread CPU +14-25% vs 02464a3 (LOW town 2.74 vs 2.17 s; dense LOW 4.43 vs 3.86 s); heap +5-6 MB (town 46 vs 41 MB). Not gated; revisit in million-pop perf / final polish (shorter loads feel better).
- [perf minor, other] fresh pages: occasional 17-80 ms GC/JIT-looking frames with no render work inside (LOW town 5/64 vs base 2/64; ui pan frames 17-25 ms 4/12). Trace GC on a fresh page; cut garbage retained from the load.
- [perf minor, other] HIGH far orbit after far fast pan: main pass +9% tris over 02464a3 (GPU lower) — no action.
- (seasons-final minors ride along in revise v1: edge-view GPU +5-7.5% vs 02464a3 → ringLowSwitch 1.6→1.3-1.4; ui HIGH street fast pan 1.08-1.19x from ring → cache ring view state across fast pans.)

## From sim close-out fix c1 (Oct 21 ~12:20) — left open (for #28 final leak check / polish)
- [leak, small] src/ui/thumbs.ts toolbar thumbnail renderer: each 15 s idle cleanup leaves its renderer + canvas reachable via three dispose listeners on the shared building material + registry geometries it drew (7 extra renderers after a UI session; GPU already freed). Fix: dispose drawn registry geometries + shared building material before renderer.dispose().
- [leak, bounded] quality change mid-session: dropped tree variants' registry geometries keep that renderer's listener until a later city disposes them.
- [guard] any NEW module-level shared GPU object must be added to the release functions (releaseCityMaterials / releaseRoadMaterial / releaseTreeGeometries / releaseSharedTextures); tests/render/exitRetention.test.ts only guards the current set — consider a generic CDP queryObjects check in the final soak.
- [minor] Previews.dispose builds the pylon model once at exit if the city never built one (cheap; could guard with a has-check).
- Evidence: simB/close-fix-c1/{shots,logs,out} (heap snapshots ~100 MB — delete after sim-depth B closes).

## From sim close-out playtest c2 (Oct 21 ~15:00) — no blocker/major; 4 minors (+ polish notes)
- [ui minor] EmergencyBanner: at 1366x650 the stack stays all-compact (no pill, loses place line/busy reason/Choose station) after a centre panel (Budget) is opened and closed — dock() caches fullH only at the width it was measured; applyDock never re-measures. Fix: store fullW with fullH/compH and treat a width mismatch as unknown, or clear the cache when the docked width changes. (src/ui/EmergencyBanner.ts dock() l.1068-1102, applyDock l.1148-1168; logs simB/close-playtest-c2/logs/p19_1366.log)
- [ui minor] EmergencyBanner: a press held > PRESS_HOLD_MS (1.5 s) while a flyout is open loses the click at 1366x650 (re-dock moves the button). Fix: freeze dock until pointerup/pointercancel/lostpointercapture/blur, or setPointerCapture on the pressed button.
- [game minor] CityScene.feedShake keeps shaking the camera while paused during a quake (never checks sim.speed); a plop preview and its click can then pick different cells ("Blocked by a road or rail"). Fix: skip/fade shake while sim.speed===0 or the pause menu is open; optionally PlopTool.down() commits the last previewed placement when the pointer has not moved.
- [ui minor] minimap "Unsaved changes"/"Saved" chip shows through the bottom of tall right-docked panels at 1280x720 (z 20 under panel layer 30, translucent glass). Fix: hide/shift chip while a panel overlaps, opaque panel bottom, or clamp right-dock height above the minimap.
- polish: pill says "open Emergencies" while that panel is already open; Emergencies rows keep an enabled Dispatch button when every truck is busy (known); imported region has no thumbnail in Load Region.

## From sim close-out audit c2 (Oct 21 ~15:00) — 1 major (→ fix c2) + 2 minors (optional in fix c2; else polish)
- [ui minor] EmergencyBanner settle guard is global and silent: presses on banners that did not move are dropped (rapid triage every 300 ms loses every other click). Fix: guard only banners whose own slot changed (layout() knows positions); feedback (denied sound / settling flash) when a press is ignored.
- [ui minor, pre-existing] with every banner dismissed, the "N more emergencies need you" pill is never docked (dock() returns early when banners.size===0) and covers a centred panel's title row. Fix: dock the pill-only case too; add a uiStacking test.
- [sim note] roadless jail/courthouse/bus depot/train station/airport get no road warning because the sim runs them without a road (operating factor 1.00) — review in polish (should they need road access?).
## From the local worker's real-GPU smoke test T003 (Oct 27, RTX 5070 Ti, ANGLE/D3D11) — no blockers, no GPU-only defects
Report: docs/dev/reports/local-T003-gpu-smoke.md. 60 Hz held everywhere (0 frames > 18 ms in 60 runs, incl. the 304k city at ULTRA 4K).
- [render perf, MINOR-1 — schedule after render round 2 closes] Far zoom on a big city at 4K draws 3–4× the triangles of 1080p, mostly in
  the shadow pass (304k city ULTRA far: 8.4M tris main / 20.9M on shadow frames at 4K vs 2.55M / 5.5M at 1080p; 13–15 ms per render at
  4K HIGH/ULTRA far). Shadow casters seem to reuse the main view's screen-resolution-dependent LOD; ULTRA has dynamicResolution off.
  Fix: pick shadow-caster LOD from the shadow camera (texel size) or force coarse LOD / skip small casters beyond a distance; re-measure
  with the T003 harness (lodprobe, burst). Matters for mid-range GPUs at 1440p/4K.
- [render, MINOR-2] WaterRenderer.ts:53 waterGround(): early return inside an if that samples uHeightTex, then uOuterTex outside it →
  D3D FXC warning X4000 in every GPU run, and implicit-derivative sampling in non-uniform control flow can pick wrong mips at the map
  edge on some drivers. Fix: sample both unconditionally (or texture2DLod(...,0.0)) and select with mix/step; one return.
- [render, MINOR-3, optional] three.js FXAAShader (LOW only) trips X3595/X4000; harmless (no mips on its input). Copy the shader with
  textureLod in the edge-search loop only if touching PostFX anyway.
- [art] At far zoom the 304k city reads as a bright white grid of lot and road outlines over the green (same on SwiftShader):
  pair_game300k_ultra.png top right. Review the far-zoom lot-outline / road-edge brightness in the art polish round.
- [tooling] Seed or freeze window lights and traffic for exact GPU-vs-reference diffs (night shots differ by lit-window pattern).
- [tooling] `tools/makeFixtures.mjs` snap step fails on Windows (local worker, T005): GNU tar cannot take `C:\` paths,
  bsdtar needs `-f -`, and `symlinkSync` needs developer mode. Fix: stream `git archive` into tar through stdin with
  forward-slash relative paths, and link `node_modules` with a `'junction'` symlink on win32.
- [tooling] `tools/bench/sim-profile/profile.ts` needs `process.threadCpuUsage` (missing in Node 22.12, present in 22.22), and on
  Windows `process.cpuUsage` ticks at 15.6 ms. Add a portable fallback (long-window CPU chunks; `hrtime` per frame,
  labelled wall-clock) instead of the worker's preloaded shim.
- [tooling] Windows worker (T005): `botgrow.ts` logs the population of every save after the run ends, so all saves print
  the last one (the files are right: 281,718 / 884,197 / 1,368,806 at years 20 / 40 / 60); `analyze.mjs` and
  `heapanalyze.mjs` build a wrong default source-map path on Windows (`C:\C:\…`; `--map` works around it); the
  `captures` target fails under `core.autocrlf=true` ("anchor … not found" in `populationAggregateProbe.bench.mjs`): add a
  `.gitattributes` with `* text=auto eol=lf` or normalise CRLF in the bench's anchor search.

- **Tornado tree damage shows live (WORLD, render-only; from R1's writer audit, Oct 27).** Today the tornado lowers trees every step, but the renderer hears about it only at the tornado's end (one `treesChanged` over its whole path), so the 3D trees and the forest tint vanish in one block afterwards. A render-side hook on the `disaster` tornado events (they carry x, z and `active`) can mark the funnel's disc dirty for `TerrainRenderer.markCells` and `TreeRenderer.onCellsChanged` on every frame while a tornado is active. No sim change: `pollution.ts` listens to `treesChanged`, so a per-step sim event would move the bot.
