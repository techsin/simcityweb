# simB-close fix c2 (Oct 27 ~11:55): close-out fix round 2, verbatim final report

Workflow wf_81eaafdc-a73, agent fix:close:c2. Its edits are in the WIP snapshots up to b29df07. Paths inside point at the session scratch directory.

CLOSE-OUT FIX c2: all 8 items and the polish are fixed and committed (the lead's WIP snapshots, HEAD b29df07; the working tree shows no changes of mine). tsc passes, the full vitest passes, and the bot run is bit-identical. Every new test fails on the pre-fix code and passes now. The real-input browser checks ran at 1280x720, 1366x650 and 1920x1080, and I looked at every screenshot cited below.

One cleanup step is not done: 23 `/tmp/playwright*` folders left by browsers I killed are still there, because the auto-mode classifier blocked deleting them (list under OPEN).

S = /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/simB/close-fix-c2 (all logs, shots and out paths below are under S). Line ranges are against 822fa5a.

**1 MAJOR: exit to region kept the previous city alive**
- **Root cause:** module-level `let bctx` in desirability.ts and the LvCtx `bctx` in landValue.ts kept the last inspected city's state, runtime and TrafficSystem. The TrafficSystem's guarded methods close over the CityScene.
- **Fix:** a `WeakMap<EconRuntime, ctx>` in src/sim/economy/desirability.ts:610-614,686-687 and src/sim/economy/landValue.ts:562-563,574-575.
- **Sweep of src/sim, ui, game, save, render.** Two more retainers found and fixed:
  - src/ui/uiSounds.ts:168-171,193,201,247-256: the last hovered button and the held slider are now `WeakRef`s.
  - src/ui/Toolbar.ts:21-35,276 and src/ui/panels/InfoPanel.ts:80-91,217: a thumbnail request still queued at exit kept the HUD and the scene alive until the queue drained. The callback closed over the card, and inside Toolbar.item over the method's whole context. It is now a module-level `thumbInto(WeakRef)`.
  - Everything else is safe: state is either keyed by CityState or EconRuntime in WeakMaps, catalog data, primitives, or bounded scratch arrays.
  - src/render needed no changes, not even teardown-only ones. The final heap snapshots show nothing on the region screen but the RegionView's renderer.
- **Tests:** tests/sim/breakdownRetention, tests/game/inspectorRetention, tests/game/uiSoundsRetention and the new tests/game/thumbsPendingRetention.
- **Probe, 3 exit/re-enter cycles on both cities, full action set every cycle:** Query with WHY? open, 9 panels plus help, 26 data views, zone, road, plop, bulldoze, 2 fires plus the Dispatch tool, save, exit.
  - Small city (26.8k): out/probe_low3h.json.
  - 304k city: out/probe_big3h.json.
  - After every exit, at +2 s and +60 s: CityScene, CityState, EconRuntime, Simulation, banner, toolbar and inspector are all 0, and 0 ResizeObserver, MutationObserver and AbortController.
  - Renderers, canvases and WebGL contexts are 1/3/1, the same as the region screen before any visit.
  - Heap after each exit: 42.4/41.9/42.4 MB (small city) and 43.2/43.5/43.4 MB (304k).
  - The final heap snapshots out/low3h_region_c3.heapsnapshot and out/big3h_region_c3.heapsnapshot contain 0 objects of every city class.
  - Shots: low3h_c1_city.png, low3h_c3_city.png, low3h_c3_region.png, big3h_c1_city.png, big3h_c3_region.png.
- **Probe caveat:** earlier probe runs showed "CityScene 1" after exit. My own helper (`window.__c2project`, created by a direct `eval`) was holding the city. With that helper excluded, the snapshot out/low3g_region_c1.heapsnapshot showed the game itself retains nothing. The helper is fixed and the runs above are clean.

**2 Banners stuck all-compact after a centre panel (stale heights)**
- **Fix:** heights are kept per stack width (`hts`, `fullAt`, `compAt`) and re-decided at the docked width. EmergencyBanner.ts 222-236, 505-532, 1094-1121, 1150-1230.
- **Test:** "c2 (playtest c2 #1)".
- **1366x650:** 3 full + 1 compact centred → Budget open docks it left (3 full + pill) → closed, back to 3 full + 1 compact. Recovered twice. Shots ban_1366f_b0/b1/b2.
- **1280x720:** recovered twice. Shots u1280_b1/b2.
- **1920x1080 (304k city):** recovered twice. Shots u1920_b1/b2.

**3 A long press lost its click**
- **Fix:** docking stays frozen until pointerup, pointercancel, lostpointercapture or window blur, and the pressed control captures the pointer. I also added one change beyond the request: with capture on, a release dragged off the control would still have clicked it, so a release outside it now cancels the press. EmergencyBanner.ts 574-590, 612-736.
- **Tests:** the updated "U1 / EM-4" test, "c2 (playtest c2 #2)" and "c2: with the capture a drag off…" (a guard for the new cancel behaviour).
- **Browser, at all three sizes:** a press held over 2.5 s with the Civic flyout open kept the stack frozen in every sample, and the Jump landed. At 1280 the camera moved from 984,1016 to 904,824 and the inspector opened. A press dragged 300 px off and released did nothing. Shots ban_1366f_b3/b4/b4b, u1280_b4/b4b, u1920_b4/b4b.

**4 Settle guard dropped presses on banners that hadn't moved**
- **Fix:** each banner records its slot. Only banners that actually moved, plus the pill, are guarded. An ignored press flashes the banner (`.settling` in emergency.css 64-72) and plays the denied sound.
- **Test:** "c2 (audit c2 #2)".
- **Browser:** dismiss the third banner, then immediately press Send nearest on the top one → dispatched at 1366, 1280 and 1920. Shots ban_1366f_b5, u1280_b5.

**5 Pill over a centred panel's title when every banner is dismissed**
- **Fix:** the pill alone now docks like the stack (`pillOnly` in dock).
- **Test:** "c2 (audit c2 #3)".
- **1366x650:** with every banner dismissed the pill reads "1 more emergency needs you". With Rewards open it moves to x 296–648, clear of the title row (x 659–1041); all three hit-points on the title row land on the panel. Shots pill1366_p1/p2.

**6 Camera shook while paused; plop clicked a different spot**
- **Fix:** `feedShake` starts no new shake while paused or with the pause menu open (CityScene.ts 717-725). `PlopTool.down` places the last preview when the pointer has not moved (PlopTool.ts 33-34, 281-311).
- **Tests:** tests/game/quakeShakePlop.test.ts.
- **Paused, 1920 (small city):** once the running shake played out (24 frames), 7 identical camera samples with the quake still active.
- **Paused, 1280:** 7 identical samples after the first.
- **Running:** the camera moves again (1920 drift 6.5–7.5).
- **Plop under a paused quake:** placed exactly on the previewed cell in the 304k city (93,179) and in the small city (43,70). Shots u1920_s1_plop_paused_quake.png, s1920_s1_plop_paused_quake.png.

**7 Save chip showed through tall right-docked panels**
- **Fix:** the `.panel` max-height reserve goes from 330 to 362 px (hud.css 458-462), and the data-views panel also avoids the chip (DataViewsPanel.ts 177-178).
- **Test:** tests/game/uiPanelReserve.test.ts (old code: 258 < 288).
- **1280x720 before:** Advisors and the clinic inspector end at y 514 over the chip (492–511). Shots chipold_1280_c1/c2.
- **1280x720 after:** both end at 488, no overlap. Shots u1280_c1/c2.

**8 Disposed thumbnail renderers stayed alive**
- **Root cause:** three.js hangs dispose listeners on every geometry and material a renderer draws; the thumbnailer drew the shared ones.
- **Fix:** it now draws a private geometry view, disposed after each render, and its own copy of the building material, disposed with the renderer. src/ui/thumbs.ts 43-65, 152-211.
- **Test:** tests/game/thumbsRetention.test.ts.
- **Probe:** renderers back to the region baseline after every exit (item 1).

**Polish**
- The pill says "see the Emergencies panel" while that panel is open (EmergencyBanner.ts 1362-1365; browser: pill1366_p3).
- `dispatchBlocked` disables Dispatch with the reason as its title (EmergenciesPanel.ts 17-37, 51, 115-152; test emergenciesPanelBusy). In the browser every waiting row still had a reachable free unit, so all stayed enabled, which is correct.
- An imported region now gets a Load Region thumbnail (src/save/index.ts 174-185). Before: chipold_1280_t1_load_region.png; after: chip_new_1280_t1_load_region.png.

**GATES**
- **tsc:** exit 0, logs/tsc3.log.
- **vitest, run in two parts because a single run was cut off by a 1 h time limit and later runs were OOM-killed:**
  - logs/vitest_A2.log: tests/game, save, render, wasm, 66 files, 553 tests, all pass.
  - logs/vitest_B.log: tests/sim, infra, 56 files pass + 1 skipped, 542 tests pass + 3 skipped.
  - Together: 0 failures. The wall-clock tests passed this time.
  - Both parts ran after my last source edit.
- **Old vs new for the new tests:** logs/tests_old.log (15 fail) and logs/tests_new.log (39 pass), logs/tests_new_banner2.log (29/29), logs/tests_old_thumbsPending.log (2 fail) and logs/tests_new_thumbsPending.log (2 pass).
- **Bot:** 128x15 seed 7: 0 of 101 lines differ, 194,432 residents (logs/bot_baseline.log vs logs/bot_after1.log). No sim edits after that run.

**OPEN**
- These 23 temp folders from browsers I killed are still in /tmp (deletion was blocked; please remove):
  - `/tmp/playwright-artifacts-`: 0fn6TU, 1ovdii, 21gR4a, 4R5KIM, 5ez93a, AoazJn, FDhhwu, Gc5PCo, NSkjjc, ZBdX45, aFh280, d2qwWn, d7OjDi, jsMjFL, nT3eaD, plTgUY, rDkooC, rp4oYd, waJwqA, yCmpUE
  - `/tmp/playwright_chromiumdev_profile-`: 0My70R, 66hCqY, 7iCqGi, 9DmztJ, C3m5FB, DGCbpe, EWIpRS, FfvezV, HLY8tm, PglEuc, QO7QcE, WOxOEG, eEnei8, pBTT0p, qEWvKk, sXIZqF, tEoNjO, xQ4FcV, y9U7vy, yltsU5
  - Two more (artifacts-8oUZbI, profile-Nx2uUj, 00:36) may also be mine; I left them because I can't confirm it.
- The pill-only case was only reproducible at 1366. At 1280 and 1920 no dismissed alert was still answerable, so the pill stayed hidden there.
- Gaps in probe coverage:
  - 304k city: the I-zone and utility queries ran in cycle 1 only. In cycles 2–3 none were reachable on screen from the saved camera; R, C and the service were queried every cycle.
  - Small city: the Dispatch tool did not activate in cycle 3 (it did in cycles 1–2).
  - Small city cycle 1: the plop was read too early (cycles 2–3 placed).
- Under this load (one-load average around 60, frequent OOM kills from the shared memory limit) a shake already running when the game is paused can take minutes of real time to fade, because its timer advances at most 0.1 s per frame. No new shake starts.
- vite is stopped (ports 47613 and 47614 closed), my vite caches are removed, and none of my processes are running.
