# local-T013-playtest-c3: independent real-input playtest of 5a16942 (close-out c3)

**Base: `5a16942`** (the dev-branch commit with close-out fix round 2).

**Reviewer.** An independent Claude sub-agent with a fresh context and only the T013 playtester brief, read-only, in a
detached worktree at the base. Machine: Windows 10, RTX 5070 Ti (ANGLE D3D11, driver 32.0.16.1047), Chromium
141.0.7390.37 headless with hardware acceleration, node 22.12. Below is its final answer verbatim, then the
machine-readable block. Nothing was fixed (T013 is review-only).

**Counts: 0 blocker, 1 major, 2 minor.**

**Note from the worker: the two reviewers disagree on the exit leak.**
- **The audit** (`local-T013-audit-c3.md`) confirmed c2 item 1. Its probe:
  - ran 3 cycles each on small_s7_y10 and vet_s7_y21, plus 2 on vet_s7_y43 and 2 on the 9948964 save, at three window
    sizes;
  - per cycle, made 6 inspector clicks on the map with Why? opened 4–5 times (Why? is shown only for growable buildings
    and zoned lots), then panels, data views, tools, fires and Ctrl+S, then exit;
  - found 0 CityScene / CityState at exit +3 s and +20 s, and clean heap snapshots;
  - used a freshly launched browser for each run and coordinate clicks.
- **This playtest** measured 1 city kept alive per exit after a single growable query. It used one long-running
  Chromium with a persistent profile, with Playwright attached over CDP and the page reloaded before each run. It ruled
  out several harness effects (see finding 1).
- **Both** are headless, hardware-accelerated Chromium 141 on the same machine. The auditor also found that a Playwright
  *locator* click on city HUD elements alone kept an exited city alive through traced handles (its "probe pitfall"
  note). The playtester's retained graph is also reached only through traced-handle roots.
- **Next:** I am running a tie-break repro (the playtester's minimal sequence in a freshly launched browser, coordinate
  input only) and will send the result to the lead as a follow-up. Until then, finding 1 stands as the playtester filed
  it.

**Screenshots in git** (`docs/dev/reports/local-T013/`, re-encoded as JPEG). The logs, scripts, heap snapshots and other
shots stay in the scratch folder named below.
- `playtest-1280-growable-inspector-why-leak-trigger.jpg`: the growable inspection (Why? open) that triggers finding 1.
- `playtest-1024-stack-over-budget-body.jpg`: finding 3. At 1024x600 the stack covers the Budget panel's tax rows.
- `playtest-1366-stack-docked-beside-budget.jpg`: item 2. At 1366x650 the stack docks beside the centred Budget panel.
- `playtest-1280-crash-recovery-offer.jpg`: item 7. The recovery offer after the browser tree was killed.

---

## T013 close-out c3: independent real-input playtest (PLAYTESTER)

**Base:** worktree C:\Users\techsin\Desktop\projects\simcityweb-T013p, detached at 5a16942, read-only. `git status` was clean at the end.

**Setup:**
- Browser: Chromium 141.0.7390.37 (HeadlessChrome/141), headless with hardware acceleration (`--enable-gpu --ignore-gpu-blocklist --use-angle=default`).
- WebGL renderer string: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)". Driver: 32.0.16.1047 per the machine notes (nvidia-smi reports 610.47). Windows 10, node 22.12.
- Server: vite on 127.0.0.1:5301.
- Driving: each step was a Playwright script attached over CDP to one long-running Chromium. All input was real `page.mouse` / `page.keyboard`.
- `page.evaluate` was used only to read state, plus two declared setups:
  - `config.disasters = true` on the y21 save.
  - Read-only raycasts (`pickBuilding` / `pickCell`) to find where to click. The decisive leak run repeats the clicks from saved screen positions without them.
- Retention was measured from a separate raw-CDP websocket (no Playwright session attached): `HeapProfiler.collectGarbage` ×3, then `Runtime.queryObjects` on the CityScene, CityState, EmergencyBanner, Toolbar, InfoPanel, WebGLRenderer, HTMLCanvasElement, WebGL2RenderingContext and ResizeObserver prototypes, then the object group released, plus `Runtime.getHeapUsage`. Heap snapshots were taken where noted.
- I looked at every screenshot cited.
- **S** = C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest (shots\, logs\, out\; all measurements are in S\logs\measure.log).

**Clean-up:** my Chromium (all instances) and vite are stopped. Ports 5301, 9341 and 9342 are closed, and no Chromium using my profile is left.

### Summary
**Verdict: 1 MAJOR, 2 MINOR, no BLOCKER.** Everything else I re-checked holds.

**MAJOR: the exit-to-region leak (c2 item 1) is not fixed.**
- Repro: query one growable building, then Save & exit to region. The whole previous city stays alive: CityScene, CityState, HUD, its WebGLRenderer, canvases and WebGL context. It accumulates by one city per visit.
- Big city y21: 3 CityScenes on the region screen after 3 cycles, heap 23.8 MB at the region baseline vs 74.9 MB after cycle 1 and 104.9 MB after cycle 2.
- Imported small city y10: 1/2/3 CityScenes, heap 66.5 / 78.3 / 86.6 MB against a 31.1 MB region baseline.
- Freshly founded city: 1/2/3 CityScenes, heap 45 / 50 / 54.5 MB.
- It also leaks:
  - with WHY? collapsed;
  - when the exit click is made from a separate CDP connection;
  - with no `page.evaluate` at all in the session;
  - under SwiftShader.
- No leak with no actions, with panels/data views only, or after querying only a power plant.

**What holds (re-checked as a player):**
- c2 items 2–7.
- Polish: the pill text, the Load Region thumbnail for an imported region, and the Dispatch rows (all enabled, correctly).
- The full regression loop.

**MINOR:**
- Toolbar/inspector thumbnail renderers survive their 15 s idle dispose and pile up within a city session (c2 item 8 is only partly fixed).
- At 1024x600 a centred Budget panel gets the emergency stack drawn over its body and tax sliders.

### Item by item
**(1) Exit-to-region leak.** The cycle was:
- Query a growable (R, C and I), service and utility building with WHY? open.
- Open all 10 top-bar panels including Help and Settings, and all 26 data views.
- Use zone, de-zone, road, power line, subway, terraform, a Parks plop, bulldoze and query.
- Then Save & exit.

The cycle ran 3× on y21, 3× on y10 and 3× on a city I founded myself. The previous city is never freed (finding 1).

**(2) Banners vs flyouts and panels.** Set-up: real quake plus meteor strikes, 9–12 incidents that can still be dispatched.

- **Flyouts and tabs:** at 1280x720, 1366x650, 1920x1080 and 1024x600, every flyout and every tab was opened by real clicks. No banner or pill overlapped the flyout, the flyout top was always hit-testable, and closing it restored the base stack (PROBLEMS [] in S\logs\b1280.log, S\logs\b1366.log, S\logs\b1920.log, S\logs\b1024.log).
- **Centre panels:** Budget, Rewards and Statistics opened and closed at every size; the stack returned to its base layout every time. At 1366x650: base 3 full + 1 compact + pill → Budget 8 compact docked left (S\shots\b1366x650_panel_Budget_open.png) → closed, back to 3 full + 1 compact + pill.
- **Press-holds:** 0.3, 1.2, 2.5 and 4 s holds on Jump while the Civic flyout closes all landed at all 4 sizes: camera moved and the inspector opened (S\shots\b1366x650_hold_4000.png).
- **Rapid triage** on banners that did not move (Send nearest about every 340 ms): 3/3 at 1280, 1366 and 1024; 2/3 then 3/3 and 3/3 at 1920 (note 1 below).
- **Banner that moved under the pointer:** a second press, made right after dispatching banner 0 on the banner that slid under the pointer, was ignored. It flashed `.settling` and dispatched nothing (S\logs\b1280.log "MOVED 0 … settling flash 1 … dispatched? false"; S\shots\b1280x720_moved_0.png).
- **Pill vs centred panel:** dismiss every banner, then open a centred panel. At 1366 the pill "12 more emergencies need you" moved to x 296–648 beside the centred Rewards panel; the title row is clear and hit-testable (S\shots\p1366b_2_inspector_rewards.png). At 1024 it was clear as well.

**(3) Paused quake.**
- Camera: after the quake's built-in 3 s shake, 10 of 14 one-second camera samples were identical while paused (S\logs\s19.log).
- Ruined Missile Test Range, while paused under an active quake:
  - Rewards → Show ruins opened its inspector ("In ruins … Clear rubble").
  - Bulldozing cost §180.
  - Rebuild preview (12,3, rot 3, ok) → placed at (12,3, rot 3), toast "Missile Test Range opens in Botville!" (S\shots\074_range_preview_paused_quake.png, S\shots\075_range_rebuilt.png).
- The range was already ruined in the save (the S3 import case), so I did not need a new meteor on it.

**(4) Minimap save chip at 1280x720.** Advisors, Statistics, Ordinances, Rewards, Emergencies and the High School inspector end at y 488, data views at 483; the chip spans y 492–511, so 0 overlaps (S\logs\s20.log, S\shots\080_chip_inspector_High_School.png).

**(5) Toolbar thumbnails after 15 s idle:** fails (finding 2).

**(6) Polish:**
- The pill reads "… — see the Emergencies panel" while that panel is open.
- The imported region shows a thumbnail in Load Region (S\shots\010_vet_s7_y21_loadregion.png).
- All Dispatch rows were enabled, which is correct: a free unit was always reachable.

**(7) Regression loop:**
- **Found and grow:** main menu → New Region → Found City "Bluehaven" (128 tile). With real drags I built a road to the north edge (got the "New neighbor connection" toast), streets, R/C/I zones, a coal plant and 2 pumps. Onboarding went to 4/5 and the city grew to 1,010 residents.
- **New Year:** the toast "HAPPY NEW YEAR 2001! Bluehaven celebrates with 1,007 residents · its first year." (S\shots\106_new_year.png).
- **Save → reload → Continue:** pause-menu Save city, then reload. No recovery offer appeared. Continue showed "Bluehaven · 1,010 residents · just now". Only the day differed, by +6, because a loaded city starts at 1x and I sampled 3 s later (S\logs\s25.log).
- **Crash recovery:**
  - Bulldozed a cottage (§23).
  - A periodic recovery snapshot was written 12 s later.
  - Ran `taskkill /F /T` on the browser tree and restarted Chromium on the same profile.
  - "Recover unsaved progress?" (Feb 6, 2002 vs last save Jan 1, 2002) → Recover: same day (+1 at 1x), same funds, the house stays gone (S\shots\117_recover_offer.png, S\logs\s27.log).
- **Errors:** no page errors or console errors in any logged run.

### Notes (not filed)
1. In the first 1920x1080 triage run, 1 of 3 presses on a banner that had not moved was dropped; it was dispatched by a later press. My guess is that the banner changed size after a shared station's dispatch. It did not reproduce in 2 reruns (6/6).
2. A paused game resumed at 1x after a banner was dismissed. I traced this to the designed 'live' urgent pause ("resumes live once dispatched", EmergencyBanner.ts speedPolicy) and did not file it.
3. Disasters are on by default in a new city. My first test city (Ironminster), left alone at 3x for 15 years, lost its coal plant to ruins and fell to 0 residents. The game's warnings were clear, so I treat it as design, not a bug.

### Findings
```json
[
 {
  "title": "Exit to region still keeps the whole previous city alive after inspecting one growable building (accumulates one city per visit)",
  "severity": "major",
  "area": "game/ui (exit teardown, inspector)",
  "evidence": "All measurements in S\\logs\\measure.log (S = C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t013\\playtest). Full cycles (query growable/service/utility with WHY?, every panel, 26 data views, every tool family, Save & exit): big y21 region screen big_region_base CityScene 0 / 23.8 MB -> big_region_c1 CityScene 1, WebGLRenderer 2, canvases 7, WebGL2 2, 74.9 MB (still 1 at +60 s and +180 s: big_region_c3_60s/_180s) -> big_region_c2 CityScene 2, 104.9 MB. Small y10: small_region_base 0 / 31.1 MB -> c1/c2/c3 = 1/2/3 CityScenes, WebGLRenderer 2/3/4, 66.5/78.3/86.6 MB. Founded city Bluehaven: fresh_region_c1..c3 = 1/2/3 CityScenes, 45/50/54.5 MB. Bisect (page reloaded before each run): no actions -> 0 (min_none, bis_none_snap); panels only -> 0 (bis_p_45s); power-plant query only -> 0 (min_power); ONE growable query (Townhouses) then exit -> 1 (min_growable:1), also with WHY? collapsed (why_close) and open (why_open). Harness ruled out: clicks from saved screen positions with no page.evaluate in the session (pure_region = 1; S\\shots\\pure_q4_power.png); exit made from a separate CDP connection (split_region = 1); V8 inspector console storage holds only 2 debug entries (consoleprobe); moving or clicking on the region screen does not release it (ptr_after_click). Not GPU-specific: under SwiftShader, ss_region_q = 1. Heap snapshots S\\out\\big_region_c1_60s.heapsnapshot, S\\out\\bisq_all2_snap.heapsnapshot, S\\out\\leakq_internals.heapsnapshot (exposeInternals): an ephemeron-correct BFS from the snapshot roots finds no strong JS or C++ path to CityScene or CityState (S\\logs\\retainers_c1.log). The whole dead graph (1.25M nodes, about 228 MB self including array-buffer data) is reached only via '(Traced handles)' wrapper roots (S\\logs\\unreach_q.log, S\\logs\\tracedroots_c1.log, S\\logs\\boundary_q.log). It contains a DOMException (an AbortSignal reason whose CallSiteInfo holds the CityScene), the AbortController/Signal, 4 ResizeObservers, 1 MutationObserver, 1 <img>, 2 PointerEvents and the city's WebGL2 context. Calling disconnect() on every live ResizeObserver/MutationObserver via CDP did not free it. DOM.getDetachedDomNodes lists one detached 'mp-scene' tree per leaked city. Screens: S\\shots\\small_c1_q1_growable_2.png (inspector with WHY?), S\\shots\\small_c3_region.png (region after the 3rd exit; 3 cities alive).",
  "suggestedFix": "The trigger is the growable-only inspector path (InfoPanel growable section: desirabilityBreakdown / landValueBreakdown, whose TermCtx/LvCtx hold st, rt and the TrafficSystem; the TrafficSystem's guarded methods close over the CityScene). The c2 WeakMap<EconRuntime, ctx> does not free the city in this browser build. (1) Don't cache those contexts across calls: allocate per call, or clear c.st, c.rt and c.traffic after fillRow/lvRow (desirability.ts ~l.686, landValue.ts ~l.574). (2) Break the scene cycle in CityScene.dispose: replace the guardSystem wrappers' captured scene with a disposed flag and null scene fields, so a retained system cannot reach the HUD and renderer. (3) Find the Blink-side owner in headed Chrome DevTools (Memory > heap snapshot, retainers with weak/internal shown, plus the Detached elements view) with this exact repro: Load y10 -> Play -> Query one house -> Esc -> Save & exit -> GC. (4) Add a browser-level gate (Playwright + CDP queryObjects) to the exit probe: query one growable, exit, assert CityScene == 0. The vitest WeakRef tests (breakdownRetention, inspectorRetention) evidently do not reproduce what the browser does.",
  "files": "src/sim/economy/desirability.ts (termCtx/bctxOf ~l.244-274, 610-687), src/sim/economy/landValue.ts (~l.562-575), src/ui/panels/InfoPanel.ts (growable section, hero thumbnail l.213-220), src/game/CityScene.ts (guardSystem ~l.587-605, dispose ~l.360-400), tests/game/inspectorRetention.test.ts"
 },
 {
  "title": "Disposed thumbnail renderers stay alive after the 15 s idle and pile up within a city session (c2 item 8 only partly fixed)",
  "severity": "minor",
  "area": "ui (thumbs) / render",
  "evidence": "In the y21 city I opened every flyout and every tab (S\\logs\\s08.log; thumbnails rendered, e.g. S\\shots\\050_civic_flyout_thumbs.png), then waited idle. thumbs.renderer is null after the idle dispose (S\\logs read by thumbstate.js: renderer:false, queue 0), but measure thumbs_t20 / thumbs_t50 still count WebGLRenderer 2, WebGL2RenderingContext 2, canvases 4 (the city alone is 1/1/3). Querying 6 new building types (new 120x120 hero thumbnails) and idling 22 s gives thumbs_after_2nd_idle = WebGLRenderer 3, WebGL2 3, canvases 5. One more renderer per thumbnail burst. Retainer path (S\\out\\thumbs_snap.heapsnapshot, S\\logs\\retainers_thumbs.log): WebGLRenderer closure context 'lut' (three's module-level DFG lookup DataTexture) -> _listeners.dispose -> onTextureDispose -> info.programs -> WebGLProgram.getUniforms -> the disposed thumbnail WebGLRenderer. Bounded per city (the c1 teardown releases the LUT at exit) and its GPU context is force-lost, but the JS objects and the canvas accumulate in long sessions.",
  "suggestedFix": "In ThumbRenderer.scheduleDispose (src/ui/thumbs.ts ~l.148-162), after renderer.dispose() also release the shared DFG LUT listener the same way the c1 city teardown does (call that release function, or dispose the shared LUT texture so three re-uploads it for the next renderer). Alternatively keep one thumbnail renderer alive for the session instead of re-creating it after every idle. Extend tests/game/thumbsRetention.test.ts to two idle cycles.",
  "files": "src/ui/thumbs.ts, src/render/world/textures.ts (releaseSharedTextures from c1), tests/game/thumbsRetention.test.ts"
 },
 {
  "title": "At 1024x600 the emergency stack is drawn over a centred Budget panel's body (tax sliders and summary covered)",
  "severity": "minor",
  "area": "ui (EmergencyBanner docking)",
  "evidence": "S\\logs\\b1024.log: 'PANEL Budget 2/0full/pill panel Budget [259,110,995,458] pill [336,309,688,335]'. S\\shots\\b1024x600_panel_Budget_open.png: 2 compact banners and the pill sit at x 336-688, y 197-335 on top of the Budget panel. They cover the Treasury/Income tiles and the Residential 'All' / R$ / R$$ slider rows, so the player cannot reach those sliders while emergencies are up. The panel header stays clear, so EM-2 as written passes. At 1366x650 the same stack docks left beside the panel instead (S\\shots\\b1366x650_panel_Budget_open.png), and at 1280x720 it sits above the panel (S\\shots\\b1280x720_panel_Budget_open.png).",
  "suggestedFix": "In dock(), when neither side column nor the space above a centred panel can hold even one compact row, fold the whole stack into the pill (keep its count), or place it below the panel, rather than over the panel's interactive body. Add a uiStacking case for 1024x600 with Budget open.",
  "files": "src/ui/EmergencyBanner.ts (dock()/applyDock placement), tests/game/uiStacking.test.ts"
 }
]
```

### Most telling screenshots
1. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\small_c1_q1_growable_2.png: the growable inspection (WHY? open) that triggers the leak.
2. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\small_c3_region.png: region after the 3rd exit; 3 CityScenes still alive (S\logs\measure.log small_region_c3).
3. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\b1366x650_panel_Budget_open.png: 1366x650, stack docked left of the centred Budget panel (it returns to full + pill on close).
4. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\b1024x600_panel_Budget_open.png: 1024x600, stack drawn over the Budget body and sliders (minor finding).
5. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\p1366b_2_inspector_rewards.png: with every banner dismissed, the pill sits beside the centred Rewards panel, title row clear.
6. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\074_range_preview_paused_quake.png: rebuilding the ruined Missile Test Range under a paused quake; preview and placement agree.
7. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\106_new_year.png: New Year 2001 toast in the founded city (1,007 residents).
8. C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t013\playtest\shots\117_recover_offer.png: recovery offer after killing the browser tree; Recover restored day, funds and the bulldozed house.

---

```json
{
  "summary": "Playtest of 5a16942 with real mouse/keyboard input on RTX 5070 Ti / D3D11 / Chromium 141 / Windows 10: 1 major, 2 minor, 0 blocker. c2 items 2-7, the polish items (pill text, Load Region thumbnail, Dispatch rows) and the full regression loop (found and grow a city past 1,000, New Year, save -> reload -> Continue, crash recovery after killing the browser) hold. Major: in this harness, exiting to the region keeps the whole previous city alive after a single growable-building inspection, one more city per visit (the audit's probe, in freshly launched browsers, saw 0; a tie-break repro follows). Minor: disposed thumbnail renderers accumulate within a city session; at 1024x600 the emergency stack covers a centred Budget panel's body.",
  "findings": [
    {
      "title": "Exit to region still keeps the whole previous city alive after inspecting one growable building (accumulates one city per visit)",
      "severity": "major",
      "area": "game/ui (exit teardown, inspector)",
      "evidence": "measure.log: y21 region 1 / 2 / 3 CityScenes after 1 / 2 / 3 exits (74.9 / 104.9 MB vs 23.8 MB baseline), y10 66.5 / 78.3 / 86.6 MB vs 31.1 MB, a founded city 45 / 50 / 54.5 MB; still 1 at +60 s and +180 s. Bisect: no actions, panels only or a power-plant query -> 0; one growable query (Why? open or closed) -> 1. Reproduced with no page.evaluate, with the exit from a separate CDP connection and under SwiftShader. Heap snapshots: no strong JS / C++ path; the dead graph is reached only via '(Traced handles)' roots and contains an AbortSignal's DOMException reason whose CallSiteInfo holds the CityScene, the AbortController, 4 ResizeObservers, 1 MutationObserver, 1 <img>, 2 PointerEvents and the WebGL2 context; one detached 'mp-scene' tree per leaked city.",
      "suggestedFix": "Do not cache the desirability / land-value breakdown contexts across calls (or clear st / rt / traffic after use); break the scene cycle in CityScene.dispose (guardSystem wrappers drop the scene); find the Blink-side owner in headed DevTools with: Load y10 -> Play -> Query one house -> Esc -> Save & exit -> GC; add a browser-level exit gate (query one growable, exit, CityScene == 0).",
      "files": ["src/sim/economy/desirability.ts", "src/sim/economy/landValue.ts", "src/ui/panels/InfoPanel.ts", "src/game/CityScene.ts", "tests/game/inspectorRetention.test.ts"]
    },
    {
      "title": "Disposed thumbnail renderers stay alive after the 15 s idle and pile up within a city session (c2 item 8 only partly fixed)",
      "severity": "minor",
      "area": "ui (thumbs) / render",
      "evidence": "After the idle dispose (renderer null, queue 0) the counts stay at WebGLRenderer 2 / WebGL2 2 / canvases 4 (city alone 1 / 1 / 3); a second thumbnail burst plus idle gives 3 / 3 / 5. Retainer: three's module-level DFG LUT DataTexture -> dispose listener -> onTextureDispose -> info.programs -> the disposed thumbnail WebGLRenderer. Bounded per city (released at exit); GPU context force-lost.",
      "suggestedFix": "After renderer.dispose() in ThumbRenderer.scheduleDispose, release the shared DFG LUT listener as the c1 city teardown does (or dispose the shared LUT), or keep one thumbnail renderer for the session; extend thumbsRetention.test.ts to two idle cycles.",
      "files": ["src/ui/thumbs.ts", "src/render/world/textures.ts", "tests/game/thumbsRetention.test.ts"]
    },
    {
      "title": "At 1024x600 the emergency stack is drawn over a centred Budget panel's body (tax sliders and summary covered)",
      "severity": "minor",
      "area": "ui (EmergencyBanner docking)",
      "evidence": "b1024.log: Budget panel [259,110,995,458], pill [336,309,688,335]; 2 compact banners and the pill cover the Treasury / Income tiles and the Residential All / R$ / R$$ slider rows (b1024x600_panel_Budget_open.png). The header stays clear (EM-2 as written passes). 1366x650 docks the stack beside the panel; 1280x720 above it.",
      "suggestedFix": "When neither a side column nor the space above a centred panel holds one compact row, fold the stack into the pill (keeping its count) or place it below the panel; add a uiStacking case for 1024x600 with Budget open.",
      "files": ["src/ui/EmergencyBanner.ts", "tests/game/uiStacking.test.ts"]
    }
  ]
}
```
