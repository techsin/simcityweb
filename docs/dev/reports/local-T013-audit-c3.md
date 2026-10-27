# local-T013-audit-c3: adversarial audit of 822fa5a..5a16942 (close-out c3)

**Base: `5a16942`** (the dev-branch commit with close-out fix round 2). Diff audited: `822fa5a..5a16942`.

**Reviewer.** An independent Claude sub-agent with a fresh context and only the T013 auditor brief, read-only, in a
detached worktree at the base. Machine: Windows 10, RTX 5070 Ti (ANGLE D3D11, driver 32.0.16.1047), Chromium
141.0.7390.37 headless with hardware acceleration, node 22.12. Below is its final answer verbatim, then the
machine-readable block. Nothing was fixed (T013 is review-only).

**Counts: 0 blocker, 0 major, 3 minor.**

**Screenshots in git** (`docs/dev/reports/local-T013/`, re-encoded as JPEG). The logs, scripts, heap snapshots and other
shots stay in the scratch folder named below.
- `audit-1366-stack-after-budget-close.jpg`: item 2. At 1366x650, after Budget closes, the stack is back to 3 full + 2
  compact + pill.
- `audit-1280-save-chip-under-advisors.jpg`: item 7. The save chip sits below the Advisors panel at 1280x720.
- `audit-1280-old-9948964-save-playing.jpg`: the save written by 9948964, playing in the browser (Jun 2009, 90,301
  residents).

---

T013 close-out c3: adversarial audit of the diff 822fa5a..5a16942

I worked read-only in the worktree C:\Users\techsin\Desktop\projects\simcityweb-T013a (detached at 5a16942). I edited no tracked files and made no git changes. Everything I produced is under C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\audit\ (logs\, out\, shots\, scripts\); that folder is called AUDIT below.

Environment:
- Windows 10, node 22.12.
- Chromium 141.0.7390.37 headless (Playwright 1.56, launched with --enable-gpu --ignore-gpu-blocklist --use-angle=default).
- GPU as WebGL reports it: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)". The driver is 32.0.16.1047 per the machine notes; WebGL does not expose the version.

Clean-up: I stopped my vite on port 5302 (nothing listens there now), and every browser I started closed itself. The 9 Playwright chromium processes still running (root PID 20368, started 08:08:59 local, before my first launch at 08:18) are not mine, so I left them alone.

## Summary

### Gates (all pass)

- **tsc --noEmit:** exit 0 (TypeScript 7.0.2). Log: AUDIT\logs\tsc.log.
- **Full vitest** (SIM_FIXTURES and SIM_SNAP set as instructed): 121 files passed, 1 failed, 1 skipped; 1091 tests passed, 1 failed, 6 skipped. Logs: AUDIT\logs\vitest_full.log and vitest_verbose.log.
  - The only failure is the expected Windows CRLF hash check, tests/wasm/binary.test.ts "was built from the current Rust sources". T012 has not landed.
  - Skipped tests:
    - 3 are gated by BALANCE.
    - 3 are "profiler fixtures (1M-population captures): none found". They read bench capture files under node_modules/.cache/sim-bench, not SIM_FIXTURES, and those files do not exist in this worktree.
  - The SIM_FIXTURES tests did run: trafficCore, roadTransitSearch and servicesTierEngine.
- **Bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --save-years 15 --save-prefix …`:** the READY file reads population 194432 for 2015 (2,814 buildings). Files: AUDIT\out\b15_y15.READY and AUDIT\logs\bot.log.
- **Recovery suite:** tests/save/recoveryCodec.test.ts plus recovery.test.ts, 21/21. Log: AUDIT\logs\recovery.log.
- **Old saves, in node with the current code** (load, run 45 days, reload and check the same 45 days are identical, export-bundle round trip, 3 more days): 0 failures. Log: AUDIT\logs\loadOld.log. Script: AUDIT\scripts\loadOld.mts.
  - Files covered:
    - the CITIES small_s7_y10 city and region files;
    - vet_s7_y21 region;
    - vet_s7_y43 city;
    - a save written by commit 9948964 with its own save code, city and region files.
  - How the 9948964 save was made: in AUDIT\old9948964 (`git archive`, with node_modules as a junction), AUDIT\scripts\writeOld.mts ran that commit's own SimBot for 9 years, turned disasters on until 2 incidents were live, then saved with that commit's saveRegion, saveCity, exportRegion and packFile. Result: 84,777 residents, day 3247.
- **Old saves, in the browser:**
  - The 9948964 region file imports through Load Region and plays: days 3261 → 3320, then 3335 → 3395 after an exit and re-enter.
  - vet_s7_y43 plays and grows from 991,315 to 1,000,051 residents.
  - 0 page errors in both.

### EM-3 (EmergencyBanner layout reads, steady state)

Method: getters wrapped by an init script (offset*, client*, scroll*, getBoundingClientRect, getClientRects, getComputedStyle), with a read attributed to the banner when its stack contains EmergencyBanner. Each phase is 5 s, about 30 UI ticks, on vet_s7_y21 at 1366x650, 1280x720 and 1920x1080. Logs: AUDIT\logs\em3b_*.log.

EmergencyBanner made **0 reads in every phase at all three sizes**:
- no banners, flyout closed;
- no banners, flyout open;
- 6 quake banners, flyout closed;
- 6 quake banners, flyout open;
- 6 quake banners, Budget open;
- after dismissing every banner, flyout closed and open.

An earlier run (AUDIT\logs\em3_1366.log) did show dock() reads while running at speed 3 with the flyout open. In that run banners were appearing and disappearing, so it was not steady state.

### Leak probes

Browser probe: AUDIT\scripts\leakProbe.mjs. It counts objects with CDP queryObjects after 3 forced GCs, takes heap snapshots, and drives everything with real mouse and keyboard input. Each cycle does:
- 6 inspector clicks, opening Why?;
- the panels m, g, j, n, y, p, F1, Rewards, Emergencies and Settings;
- all 26 data views;
- all 10 toolbar families with every tab, plus card picks;
- zone, road, bulldoze and de-zone drags, and the power, subway and terrain tools;
- 3 fires, with Send nearest, Choose station and dismiss on the banners;
- Ctrl+S, then exit through the pause menu.

Results:
- **small_s7_y10, 3 cycles, 1280x720 (logs\small3.log):** at exit +20 s every cycle has 0 CityScene, CityState, Simulation, TrafficSystem, EmergencySystem, EmergencyBanner, Toolbar, TopBar, InfoPanel, PanelManager, ToolController, WorldView and MiniMap, and 0 ResizeObserver, MutationObserver and AbortController. Canvases and WebGL2 contexts are 3 and 1 (the region screen's baseline). Window and document listeners are 30 and 4 every time. Heap is 43.9, 44.5 and 45.2 MB.
- **vet_s7_y21 (304k), 3 cycles, 1366x650 (logs\big3.log):** the same zeros. Heap is 44.9, 45.0 and 45.4 MB.
- **vet_s7_y43 (991k), 2 cycles, 1920x1080, and the 9948964 save, 2 cycles:** the same zeros.
- **Final heap snapshots** (out\small3_final.heapsnapshot, out\big3_final.heapsnapshot): 0 objects of every city class. The only WebGLRenderer is the region view's; the only LodProxyBuilder is the page-wide singleton, with no BuildingRenderer.
- **Node side:** the c2 retention tests (breakdownRetention, inspectorRetention, uiSoundsRetention, thumbsRetention, thumbsPendingRetention) pass in the full run.
- **Module-level sweep** (grep of all of src plus the retainer paths above): it found 3 more candidates, filed below as findings 1 and 3 and the dom.ts note.

### The fix report's items

1. **MAJOR, exit keeps the city alive: CONFIRMED.**
   - Browser: 0 of everything after exit, including after Why? clicks, at three sizes and four cities (above).
   - Heap snapshots: clean.
   - Code: desirability.ts and landValue.ts now use `WeakMap<EconRuntime,…>`. uiSounds keeps `held` and `hovered` as WeakRefs. Toolbar and InfoPanel `thumbInto` hold only a WeakRef to the card.
   - Caveat: when Send nearest was clicked just before exit, the whole city was sometimes still alive at +2 s and gone a second later (finding 1).
2. **Stale heights after a centre panel: CONFIRMED at 1366x650** (logs\hb_plain.log, hb_budget.log). I also tried a harder variant: banners first appearing beside an open Budget panel. After Budget closes, the stack is identical to the never-docked layout (3 full + 2 compact + pill, left 507, width 352), and a second Budget open and close keeps it. The per-width heights show 440 and 370 entries. I did not repeat this at 1280 or 1920.
3. **Long press lost its click: CONFIRMED, with a caveat** (logs\it_1280.log, it_1366.log, it2_1366.log).
   - 1280x720, flyout open: a 2.7 s held press on Send nearest dispatched the unit, and the stack stayed frozen in every sample.
   - At both sizes, a press dragged 300 px off and released did nothing.
   - 1366x650: the held press was dropped by the settle guard (`ignored: true`, settleUntil was 286 ms in the future when pressed). This is the guard working as designed, not a lost click from re-docking:
     - The first flyout open blocks the main thread for 1,333 ms. That is a long task measured with PerformanceObserver, from the thumbnail renderer's setup (logs\lt_1366.log).
     - The stack re-docked right after that task, 1,372 ms after the flyout click (logs\mm_1366.log), so a press made 1.5 s after opening landed in the moved banner's settle window.
     - A plain click right after dispatched.
4. **Settle guard dropped presses on banners that had not moved: CONFIRMED** at 1366 and 1280. Dismissing the 3rd banner, then immediately pressing Send nearest on the top one, gave "uncovered" → "dispatched/1".
5. **Pill over a centred panel with every banner dismissed: CONFIRMED by code review and the passing unit test only.** In my runs, dismissed quake alerts never left a pill, so the pill-only state never occurred in the browser (c2 also only reproduced it at 1366). The pillOnly branch in dock() is sound. moreShown is set after dock() in tick(), so the pill docks one UI tick late, which is harmless.
6. **Shake while paused / plop moved: CONFIRMED for the camera.** Paused under a fresh M-quake, 7 samples 0.5 s apart were identical (camera 1259.673, 1081.979, 2580.327) at 1366 and 1280. The plop half is confirmed by quakeShakePlop.test and code review only:
   - previewHolds compares a fresh ToolPointer against the last refresh's.
   - Pointer moves are coalesced per frame, so a click within the same frame as a move re-picks (its clientX differs). That is correct.
7. **Save chip under tall right panels: CONFIRMED.** Advisors ends at y 488 with the chip at 492–511 (1280x720), and at 418 with the chip at 422 (1366x650).
8. **Disposed thumbnail renderers: CONFIRMED.** After every exit there are 1 WebGL2 context and 3 canvases, the region baseline, and the snapshot has 1 WebGLRenderer.
   - Code: three.js removes its dispose listeners on view.dispose() and mat.dispose(), and the GL buffers it frees belong to the thumbnail renderer's own WebGLAttributes.
   - The building material has no textures, so no texture listener pins the renderer.

Polish:
- Imported region thumbnail: CONFIRMED in the browser. The Load Region list shows a data:image/jpeg for the bot-made region files, which carry no preview.
- Pill text and dispatchBlocked: confirmed by code review and the passing unit tests only. dispatchOptions caches its ETA search per incident, so calling it per row per update is cheap.

## Findings

All three are minor. There is no blocker and no major.

### 1. Exited city still alive for about 1–3 s after exit when a banner action ran just before

- **Severity:** minor
- **Area:** game/render teardown
- **Evidence:**
  - In the cycles where Send nearest or Choose station was clicked shortly before exit, the counts at exit +2 s show the whole city alive. With dispatch clicked: CityScene 1 and CityState 1 (small3 c1, big3 c3), or every city class at 1 (tr c3).
  - The counts at +3 s and +20 s show 0. A heap snapshot taken about 1 s after the +2 s count already has 0 (logs\tr.log, out\tr_c3_plus2.heapsnapshot), so the holder could not be captured.
  - Cycles without a dispatch show 0 at +2 s.
  - The sweep found a matching unreleased holder: the page-wide LOD proxy builder (src/render/city/buildings/lodBuilder.ts:207, `let shared`, with `jobs` and `queue` at 44-45). It keeps each queued job's callback `(g) => { if (!this.disposed) this.installProxy(geom, g); }` (BuildingRenderer.ts:1134). That closes over the BuildingRenderer and its CityState until the workers reply. BuildingRenderer.dispose does not cancel its requests. A pending timer or camera animation started by the dispatch is the other candidate.
  - It is bounded and self-clearing, and it is not part of this diff. It does mean "0 after exit at +2 s" is not always true, and if a worker never answered the city would stay alive for good.
- **Suggested fix:** let BuildingRenderer.dispose withdraw its callbacks from the shared builder: a `cancel(owner)` that drops the owner's done callbacks and its unposted queue entries. Re-run the +2 s count with a dispatch just before exit, and take the snapshot in the same task as the count to name the holder.
- **Files:** src/render/city/buildings/lodBuilder.ts, src/render/city/buildings/BuildingRenderer.ts, src/game/CityScene.ts

### 2. The settle guard's "slot" ignores height changes of banners above, though its doc comment says size changes count

- **Severity:** minor
- **Area:** ui
- **Evidence:**
  - EmergencyBanner.layout() (about lines 1091-1121) builds `slot = above + '|' + (comp ? 'c' : 'f') + (cap ? 'x' : '')`, where `above` lists the shown banners' ids and their full/compact flag only.
  - markMoved's doc comment (about line 690) says a banner is guarded when "a banner above them went, moved or changed its size".
  - A full banner above can still grow or shrink when its note line ("Both fire trucks … are busy") or its ETA wrapping changes. The banners below then shift without being marked moved, and applyDock only marks on a dock-key change.
  - Not reproduced in the browser. The likely effect is a press landing about one text line off within a banner, so a different banner's button is unlikely.
- **Suggested fix:** either drop "changed its size" from the comment, or add each shown banner's last measured height (already known in dock() from offsetHeight on RO-driven docks, so no extra layout read) to the `above` signature.
- **Files:** src/ui/EmergencyBanner.ts

### 3. Fallback 3D path keeps each disposed fallback WebGLRenderer and its GL context alive (the item 8 mechanism, not covered by the c2 sweep)

- **Severity:** minor
- **Area:** game (fallback view)
- **Evidence:**
  - src/game/fallback/FallbackObjectsView.ts:233 draws `new THREE.Mesh(a.getModelGeometry(def.model, b.variant), a.getBuildingMaterial())`, using the shared registry geometry and the module-level `_shared` material (src/assets/materials.ts:906, src/assets/registry.ts:18).
  - three.js r186 hangs onGeometryDispose and onMaterialDispose closures over the renderer on those shared objects.
  - FallbackObjectsView.dispose (:350-353) removes the group from the scene without disposing those meshes, and FallbackWorldView.dispose (:114) only runs its cleanup list. So the listeners stay, and every fallback session leaves its renderer and context behind for good.
  - This path is used only when WorldView fails to start (CityScene.ts:465-472), so I did not run it. The evidence is static only, and I found no strong path from that renderer to the CityState.
- **Suggested fix:** draw the fallback building meshes the way thumbs.ts now does: a per-view `viewOf(geometry)` plus a per-view clone of the building material, disposed in FallbackObjectsView.dispose. Also call `renderer.forceContextLoss()` in FallbackWorldView.dispose.
- **Files:** src/game/fallback/FallbackObjectsView.ts, src/game/fallback/FallbackWorldView.ts, src/ui/thumbs.ts (pattern)

## Notes (not findings)

- **Probe pitfall for future leak runs:** a Playwright locator or getByText `.click()` on city HUD elements kept the whole exited city alive. It is held through traced handles of listeners on the city's DOM, while no strong JS path from the GC roots exists. So did my early `DOMDebugger.getEventListeners` call made without an `objectGroup`.
  - With the same exit done as a coordinate click, everything was collected (logs\bis3_none.log against bis4.log).
  - Use page.mouse at coordinates read with evaluate, and pass an objectGroup on every CDP call that returns objects.
- **First toolbar flyout open in a session:** a 1,333 ms main-thread long task (thumbnail renderer and shader setup). Re-opening after the 15 s idle dispose costs 52 ms, and cached opens cost nothing. It delays the stack's re-dock, which is what caught the 1366 long press in item 3.
- **Per-width height cache (EmergencyBanner `hts`):** widths never measured fall back to 150/64, and eviction is first-in-first-out at 4 entries, so the 440 entry can be dropped after a resize with a panel open. I could not make this produce a stuck-compact stack; the real heights at 1366 are 139 full and 62 compact. Keeping the default-width entry when evicting would remove the risk.
- **src/ui/dom.ts:126:** a slider's document pointerdown listener stays registered if the slider is still focused at teardown. In practice, exiting goes through a pause-menu click that moves focus, and the listener removes itself on the next press.
- **Unchanged behaviour:** a quake started while paused still gets render-world's own 3 s start shake (CityScene.ts:383). Only feedShake is gated, and it fades out.
- **Not re-checked:** I did not re-run the new tests against the pre-fix code.

---

```json
{
  "summary": "Audit of 822fa5a..5a16942 on RTX 5070 Ti / D3D11 / Chromium 141 / Windows 10: all gates pass (tsc clean; vitest only the known Windows-CRLF binary.test failure; bot 128x15 s7 = 194,432; recovery 21/21; old saves incl. one written by 9948964 load and play in node and browser). EM-3: 0 EmergencyBanner layout reads in steady state at 3 sizes. Leak probes: 0 city objects after exit across 4 cities and 3 sizes. All 8 fix items confirmed (5 and the plop half of 6 by code review + unit tests only). 0 blocker, 0 major, 3 minor.",
  "findings": [
    {
      "title": "Exited city still alive for about 1-3 s after exit when a banner action ran just before",
      "severity": "minor",
      "area": "game/render teardown",
      "evidence": "Counts at exit +2 s show CityScene/CityState (sometimes every city class) at 1 in cycles with Send nearest / Choose station clicked just before exit; 0 at +3 s and +20 s; cycles without dispatch show 0 at +2 s. Candidate holder: the page-wide LOD proxy builder keeps queued done-callbacks closing over BuildingRenderer (lodBuilder.ts:207, 44-45; BuildingRenderer.ts:1134) and dispose does not cancel them. Not part of this diff; bounded and self-clearing.",
      "suggestedFix": "Add cancel(owner) to the shared LOD builder, called from BuildingRenderer.dispose, dropping the owner's callbacks and unposted queue entries; re-run the +2 s count with a snapshot in the same task.",
      "files": ["src/render/city/buildings/lodBuilder.ts", "src/render/city/buildings/BuildingRenderer.ts", "src/game/CityScene.ts"]
    },
    {
      "title": "Settle-guard slot ignores height changes of banners above, contrary to its doc comment",
      "severity": "minor",
      "area": "ui",
      "evidence": "EmergencyBanner.layout() slot = above + '|' + comp/cap flags, where above holds only ids and full/compact; markMoved's comment says size changes count. A full banner's note/ETA line can change height and shift those below without a mark. Not reproduced in the browser.",
      "suggestedFix": "Drop 'changed its size' from the comment, or add each shown banner's last measured height (already read in dock()) to the above signature.",
      "files": ["src/ui/EmergencyBanner.ts"]
    },
    {
      "title": "Fallback 3D path keeps each disposed fallback WebGLRenderer and GL context alive",
      "severity": "minor",
      "area": "game (fallback view)",
      "evidence": "FallbackObjectsView.ts:233 meshes use the shared registry geometry and module-level building material; three.js r186 attaches dispose listeners closing over the renderer; FallbackObjectsView.dispose (:350-353) and FallbackWorldView.dispose (:114) do not dispose them. Static evidence only; path runs only when WorldView fails to start.",
      "suggestedFix": "Use per-view geometry views and a per-view material clone as thumbs.ts does, disposed in FallbackObjectsView.dispose; call renderer.forceContextLoss() in FallbackWorldView.dispose.",
      "files": ["src/game/fallback/FallbackObjectsView.ts", "src/game/fallback/FallbackWorldView.ts", "src/ui/thumbs.ts"]
    }
  ]
}
```
