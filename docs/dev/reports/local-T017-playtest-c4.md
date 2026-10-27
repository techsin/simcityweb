# local-T017-playtest-c4: close-out check 4, the playtester (T017)

Base **`d8256fc`** (fix round 4 merged). The playtester ran as a fresh sub-agent at maximum effort, read-only, in its
own worktree. It used real mouse and keyboard input on this machine's GPU. Its final answer follows verbatim; its JSON
block is at the end.

The answer cites its screenshots by their scratch paths. Six of them are in `local-T017/` as JPEGs:
- `big_c2_q_growable2.jpg`: the inspector with WHY? open after exit and re-entry;
- `b1024x600_panel_Budget_open.jpg`: at 1024x600 the banner stack folds into the pill above Budget;
- `b1024x600_dismissed_Demographics.jpg` and `b1280x720_dismissed_Help.jpg`: finding 1, the pill over a centred
  panel's content;
- `nogl2_stopped.jpg`: finding 2, the region loader that never ends without WebGL2;
- `r8_recover_offer.jpg`: the recovery offer after the browser tree was killed.

**Counts: 0 blocker, 0 major, 2 minor.**

---

# T017 close-out check 4: independent real-input playtest (PLAYTESTER)

**Base: `d8256fc`** (detached worktree `C:\Users\techsin\Desktop\projects\simcityweb-T017p`, read-only). At the end `git status` was clean and HEAD was still d8256fc.

**Verdict: 0 blocker, 0 major, 2 minor.**
- Every fix-round-4 and fix-round-2 item holds under real input.
- After every exit, 0 CityScene and 0 CityState at +2 s and +20 s:
  - big city (vet_s7_y21), 3 cycles;
  - imported small city (small_s7_y10), 3 cycles;
  - freshly founded city, 3 cycles;
  - the fallback-view city, 2 cycles;
  - dispatch-then-exit, 2 runs.
- `tools/leakprobe` passes in all four modes.
- Every panel, tab, slider, stepper, toggle, segmented control, tool family, minimap control, top-bar segment, toast and banner button I exercised works:
  - after entering a city;
  - after exit and re-entry;
  - in a second and a third city.
- Both minors are about placement or a pre-existing path, not regressions of this round:
  1. the "N more emergencies" pill can sit over a centred panel's content;
  2. a browser without WebGL2 hangs on "Rendering the region…".

## Setup
- **Machine:** Windows 10 Education 19045, node 22.12, Playwright 1.56.
- **Browser:** Chromium 141.0.7390.37 (HeadlessChrome/141), `--headless=new --enable-gpu --ignore-gpu-blocklist --use-angle=default`.
  - One long-running instance on CDP port 9441 with its own profile.
  - Each step was a separate `connectOverCDP` connection.
- **GPU** (CDP `SystemInfo.getInfo`):
  - NVIDIA GeForce RTX 5070 Ti, driver 32.0.16.1047;
  - WebGL2 renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)";
  - gpu_compositing, webgl2 and rasterization enabled.
- **Server:** vite on 127.0.0.1:5401, started from the worktree.
- **Input:** real `page.mouse` / `page.keyboard` at coordinates only.
  - Positions and state were read with `page.evaluate` as plain values.
  - No Playwright locators or element handles on the city's DOM.
  - Panel content was reached by real mouse-wheel scrolling.
- **Counts:** taken from a raw CDP websocket after the Playwright connection had closed.
  - `HeapProfiler.collectGarbage` ×3.
  - `Runtime.queryObjects` with an objectGroup on every call (released) for: CityScene, CityState, EmergencyBanner, Toolbar, InfoPanel, WebGLRenderer (three's prototype), HTMLCanvasElement, WebGL2RenderingContext, ResizeObserver and AbortController.
  - `Runtime.getHeapUsage`, plus heap snapshots where noted.
- **Declared test setups (`page.evaluate`):**
  - `config.disasters = true` on the imported cities. Every quake and meteor was then triggered with the real Terrain > Disasters tool.
  - Removed the saved Budget panel position that my own drag check had stored, so Budget opens at its default centred place.
  - Item 5 only: aborted the `WorldView.ts` and `CityObjectsView.ts` module requests with `page.route`.
- I looked at every screenshot I cite.
- All raw counts are in `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\logs\measure.log`.

## Item by item

### (1) Exit-to-region leak, and the ~150 signal-bound listener sites

**What each cycle did** (`sweep.js`, every control verified by its effect on game state):
- Speed buttons and Space.
- Query a growable R, C and I building; WHY? toggled three times and left open.
- Query a service and a utility building; Focus brings the camera to the building.
- Inspector close (×).
- All 10 top-bar panels with every tab:
  - Budget: tax stepper, slider drag and arrow keys, the Services funding stepper, panel drag;
  - Graphs: list, range control and canvas hover;
  - Advisors "Show me", Ordinances toggle, Rewards "Place";
  - Help's guide button; Onboarding minimise, expand and dismiss;
  - Settings: nav, segmented control, toggle, slider and music shuffle.
- Top-bar segments: funds, population, approval, the RCI popover, city menu, Menu and Resume.
- Panel hotkeys m/g/j/n/y/p/o.
- All 26 data views, plus a variant chip, the underground toggle and the legend chip's ×.
- 7 toolbar families with every tab, and the hover tooltip.
- Tools:
  - zone and de-zone;
  - road, power line and subway;
  - terrain raise with its brush slider;
  - plant trees;
  - park plop (preview equals placement);
  - the tool chip's Done button;
  - bulldoze and query.
- Minimap rotate, collapse and click; news ticker; save chip.
- Banners: Jump, Choose station, Send nearest, × and the pill, after a real quake burst.
- Then Save & exit.

**Functional results**

| City | Result |
|---|---|
| Big y21 | c2 65/65 and c3 65/65 (c1 had 2 harness aiming misses, fixed) |
| Small y10 | Every panel, data-view, flyout, query and banner check passes. In this dense city my aim found no free land for road, power line, subway, terrain and trees. |
| Founded city | Those tools pass 4/4 with exact aim (`fresh_c2`, `fresh_c3`). Ordinances are all locked below 500 residents, which is correct. The quake burst hit open land, and with no working station no incident is bannered. |

Extras, founded city: 9/9.
- The pause menu's Settings and Help items.
- Ctrl+S.
- Inspector Demolish → confirm dialog → Cancel, and Esc: the plant is kept and no pause menu opens behind.
- Make historic on and off.
- A meteor toast's click (camera goes to the cell) and its ×.
- Emergencies row jump.
- Emergencies row Dispatch is disabled with its reason "The city has no fire station" (the c2 polish item).

**Counts** (CityScene / CityState after Save & exit; heap at +20 s)

| City | +2 s | +20 s | Heap at +20 s |
|---|---|---|---|
| Big y21 (region baseline 0/0, 22.1 MB) | 0/0 in all 3 cycles | 0/0 in all 3 cycles | 42.1 / 46.4 / 47.9 MB |
| Small y10, one page session (baseline 27.3 MB) | 0/0 in all 3 cycles | 0/0 in all 3 cycles | 53.1 / 47.8 / 50.5 MB |
| Founded city | 0/0 in all 3 cycles | 0/0 in all 3 cycles | 41.8 / 41.3 / 42.7 MB |

- Renderers / GL2 contexts / canvases were back to the region's 1 / 1 / 3 at +20 s every time.
  - Big c1 had 2 / 2 / 4 at +2 s: the thumbnail renderer was still waiting for its 15 s idle dispose.
- The final heap snapshots (big c3, small r3, founded c2 and c3) hold:
  - no CityScene, CityState, EmergencyBanner, Toasts or BuildingRenderer instance;
  - exactly 1 WebGLRenderer.
- The heap is flat within a few MB. A control run shows part of the drift is my own harness: 10 bare Playwright connections on the region screen add 1.6 MB.

**Dispatch right before exit:** Choose station, then Send nearest, then Save & exit 0.4–0.5 s later.
- 0/0 at +2 s and at +20 s in both runs.
- One run still had CityScene 1 (with CityState 0) at +0.3 s; it was gone by +2 s.

**tools/leakprobe** (`--port 5411 --census`, small_s7_y10, 3 cycles): all 4 modes PASS with [[0,0],[0,0],[0,0]] — fresh, persistent, fresh --hostile and persistent --hostile.

### (2) Banners vs flyouts and centred panels
Each size used a fresh import of y21 and a real quake plus meteors (and a short real-time run). Dispatchable banners: 21 / 9 / 13 / 11 at the four sizes.

**At every size (1024x600, 1280x720, 1366x650, 1920x1080):**
- Every flyout and every tab: no banner or pill over it, its top is hit-testable, and the stack returns to its base layout after closing.
- Budget, Rewards and Statistics opened and closed: no banner or pill over a header or a body, and the base layout comes back after each.
- Press-holds of 0.3, 1.2, 2.5 and 4 s on Jump while the Civic flyout closes: 4/4 landed at every size (camera moved and the inspector opened).
- Dismiss everything, then open Budget, Graphs, Demographics, Settings, Help and Rewards: no title is covered, and the title row is hit-testable.

**Per size:**
- **1024x600:** with Budget at its default centred place, the stack folds into the counted pill "21 more emergencies — open Emergencies" above the panel. 0 banners sit on it, and its tax slider takes the press (fix round 4, minor 5).
- **1280x720:** with Budget open, 1 compact banner and the pill sit above it.
- **1366x650:** with Budget open, 3 full banners dock beside it and the pill goes to the left.
- **1920x1080:** with Budget open, the banners dock beside it.
- **Finding 1 (1024x600 and 1280x720):** with every banner dismissed, the pill sits over the body of some centred panels.
  - 1024x600: Demographics' headline stat cards and Help's section headings.
  - 1280x720: Help's section headings.

**Rapid triage:**
- On banners that did not move, presses about 330 ms apart: 3/3 at 1024, 1280 and 1366, and 9/9 at 1920 (3 runs).
- Pressing the same slot repeatedly ignores every other press, with a flash. Each time, a banner was just promoted into that slot, so this is the settle guard by design (SETTLE_MS 350).

**A banner that just moved under the pointer:**
- Guarded at 1024 and 1280.
- At 1366, one press in the scripted test dispatched the banner that had slid in. Controlled repro, reading the banner under the pointer right before each press:
  - paused: 7/7 guarded for presses 80–270 ms after the slide; the only dispatch came at +586 ms, past the 350 ms settle window;
  - running: 5/5 guarded, plus 1 ambiguous case (flash shown; most likely an automatic dispatch by the sim).

**Fix-round-2 polish:**
- The pill reads "… — see the Emergencies panel" while that panel is open.
- Save chip at 1280x720: Advisors, Statistics, Ordinances and Rewards end at y 488; the chip spans 492–511.

### (3) Paused quake
- **Paused, then a quake:** the camera takes 5 positions in the first ~2 s, then holds 1 position for 10 s. The first 2 s are the render world's built-in start shake, which c2 and c3 also noted.
- **Running, then a quake, then Pause:** still within 0.5 s, then 1 position for 12 s.
- **Plops under the paused quake:** 3 park plops; previewed cell and rotation equal the placement each time (3/3).

### (4) Toolbar and inspector thumbnails
- 3 rounds, each with every flyout and tab plus 6 new building types' 120 px hero thumbnails, followed by a 20 s idle.
- After each idle: WebGLRenderer 2 → 1, WebGL2 contexts 2 → 1, canvases 4 → 3. Nothing piles up.
- The new LUT dispose does not change how the city renders. With the time of day fixed, the frames before and after the dispose differ by 0.95/255 on average, against a 0.76–1.5 noise baseline, and luma is unchanged.

### (5) Fallback 3D view
- I failed the WorldView and CityObjectsView module loads in the real game (declared setup). The city ran on FallbackWorldView and FallbackObjectsView, with the dev badge "DEV · stand-in world view, city objects", and the inspector worked.
- 2 cycles: WebGLRenderer 2 / GL2 2 inside the city; after Save & exit, 0/0 cities and 1 / 1 / 3 (region level) at +2 s and +20 s.
- Without WebGL2 the fallback is not reachable at all: see finding 2.

### (6) Regression loop
1. **Found:** Main menu → New Region → Found City "Southhollow Hills" (128 tiles, medium, disasters on).
2. **Build** (real drags): a road to the south edge, streets, R/C/I zones, a coal plant, and 2 water pumps with road stubs. The city reached 1,033 residents by day 418.
3. **Collapse:** disasters burned the coal plant twice; it had no fire coverage, and the Safety toasts had warned about it. The population fell to 0. This is design, as c3 also noted.
4. **Revive** (real input): a §60,000 loan from Budget > Loans, bulldozed the rubble, rebuilt the plant → 395 residents.
5. **New Year:**
   - the toast "🎆 Happy New Year 2028! … 472 residents";
   - the full cinematic show at New Year 2055 (fireworks, the "Happy New Year 2055!" flash, the toast "… 371 residents · ▼ 6.1% vs 2054").
6. **Save → reload → Continue:** pause menu > Save city, then reload.
   - No recovery offer.
   - Continue read "Southhollow Hills · Greenvale Valley · 395 residents".
   - Day, population, funds, building count, next building id, zoning and network all identical.
7. **Crash recovery:**
   - Before the crash: took a §20,000 loan, bulldozed a lot, and the periodic recovery snapshot was written.
   - `taskkill /F /T` on my Chromium tree, then a restart on the same profile.
   - Offer: "Recover unsaved progress?" (Aug 27 2054 · 395 residents · §8,562, against a last save of Jul 18 2054).
   - Recover: funds §8,562 and 2 loans as before, every pre-crash building present, the bulldozed lot still empty (one new growable 2 days later).
   - Population read 371 right after and was back at 395 within about 20 game days.
8. **Unplanned recovery:** my vite restart reloaded the page mid-city; Recover restored that state too.

**Errors:** 0 page errors in all runs. Console warnings were only three's ANGLE shader-compile warnings (X4122), and in item 5 the expected module-load warnings.

**Graphics revision 2:** I noticed nothing unusual. Render visuals are out of scope and not counted.

## Findings
1. **[minor] With every banner dismissed, the "N more emergencies" pill can sit over a centred panel's content.**
   - At 1024x600 it covers Demographics' headline stat values and Help's section headings; at 1280x720, Help's headings. Titles and tabs stay clear, so the brief's criterion passes.
   - The pill-only branch places the pill "below the header rows" when there is no room beside or above the panel. That is the same family as c3's minor 5, which round 4 fixed only for the banners.
2. **[minor, pre-existing; not in this round's diff] A browser without WebGL2 hangs forever on "Rendering the region…" after a region is opened, with no message.**
   - The city's fallback and null-view paths are never reached.
   - `App.showRegion` awaits `RegionScreen` with no failure path.

## Notes (not filed)
- **Transient after dispatch:** one dispatch-then-exit still had CityScene 1 (CityState 0) at +0.3 s; 0 at +2 s, within the requirement.
- **Harness-only retention:** the leakprobe hostile modes keep a detached inspector panel (285–552 nodes, no listeners) and the city's WebGL canvas per exit, while 0 cities are alive. That is the harness's own memory, as round 4 reported.
- **Region-side retention:** the Load Region dialog's detached `modal-back` tree (27 nodes, 9 listeners) is kept in every leakprobe mode. It is region UI, out of scope as in the round 4 report.
- **Snapshot name counts:** counts by name for MutationObserver and HTMLCanvasElement grow by about 6 per cycle. They are per-isolated-world builtins of each Playwright connection; the main-world `queryObjects` counts stay at 0 and 3.
- **Hold offset:** the 1 px Jump offset during holds is the pressed-button style.
- **Recovery transient:** after a lean recovery snapshot, the population reads about 6% low for roughly 20 game days, then recovers.
- **New Year wording (cosmetic, pre-existing):** after the founded city's population had fallen to 0, the 2028 toast said "its first year" for a 28-year-old city.
- **Time of day:** the clock keeps moving while paused (16:42 → 17:25 between two shots).
- **My side effects in my own profile:** the onboarding card was permanently dismissed by my check, and the Budget position was cleared again. Settings were restored.

## Most telling screenshots
1. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\big_c2_q_growable2.png` — inspector with WHY? open after exit and re-entry.
2. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\big_c2_banners.png` — banners and the dispatch toast after re-entry.
3. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\b1024x600_panel_Budget_open.png` — at 1024x600 the stack folds into the pill above Budget.
4. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\b1024x600_dismissed_Demographics.png` — finding 1.
5. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\b1280x720_dismissed_Help.png` — finding 1.
6. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\pill_with_emergencies_open.png` — the pill reads "see the Emergencies panel".
7. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\q_C_plop_paused_quake.png` — plop under the paused quake.
8. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\lut_C_after_idle_dispose.png` — the city renders normally after the thumbnail renderer's dispose.
9. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\fb_c1_after_input.png` — the fallback view.
10. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\nogl2_stopped.png` — finding 2.
11. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\r3_new_year.png` — the 2028 New Year toast.
12. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\fresh_c1_banners.png` — the New Year 2055 show.
13. `C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\playtest\shots\r8_recover_offer.png` — the recovery offer after killing the browser tree.

## Clean-up
- **vite:** two background vite runs on 5401 were stopped by the 2 h background-task limit. The third, started detached (pid 34940), was stopped with `taskkill /F /T`.
- **Chromium:**
  - pid 26204 was killed for the crash test;
  - its replacement, pid 36700, was stopped, and its orphaned children then exited.
- **leakprobe:** stopped its own vite (5411) and Chromium (6411).
- **Ports:** 5401, 9441, 5411 and 6411 are free.
- **Leftovers:** no chrome or node process with my profile, my ports or my worktree remains.
- **Worktree:** clean at d8256fc.

```json
{
  "summary": "Real-input playtest of d8256fc on RTX 5070 Ti (driver 32.0.16.1047, ANGLE D3D11) / Chromium 141.0.7390.37 headless / Windows 10: 0 blocker, 0 major, 2 minor. Exit leak fixed: 0 CityScene/CityState at +2 s and +20 s after every exit of the big y21 city (3 cycles), the small y10 city (3), a freshly founded city (3), the fallback-view city (2) and dispatch-then-exit (2); heap flat; final heap snapshots clean; tools/leakprobe passes in all 4 modes. Every panel, tab, slider, stepper, toggle, segmented control, tool family, minimap control, toast and banner button works after entering, after exit and re-entry, and in second and third cities. Banners at 1024x600 / 1280x720 / 1366x650 / 1920x1080 with real quake bursts (9-21 dispatchable): no flyout, header or Budget-body overlap (1024 Budget folds into the pill), holds 0.3-4 s land, rapid triage loses no press on banners that did not move, the moved-banner guard holds within its 350 ms window, no title covered. Paused quake, thumbnails (2 -> 1 renderers after every idle; the LUT dispose leaves the city's rendering unchanged), fallback teardown and the regression loop (found, build, 1,033 residents, New Year, save/reload/Continue identical, crash recovery) all hold. Minors: the pill-only placement covers a centred panel's content (not its title) at 1024x600 and 1280x720; a no-WebGL2 browser hangs at 'Rendering the region...' (pre-existing).",
  "findings": [
    {
      "title": "With every banner dismissed, the 'N more emergencies' pill sits over a centred panel's content at 1024x600 (Demographics headline stats, Help headings) and 1280x720 (Help headings)",
      "severity": "minor",
      "area": "ui (EmergencyBanner docking, pill-only placement)",
      "evidence": "Real quake burst on vet_s7_y21, every banner dismissed with x, then centred panels opened from the top bar. C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\logs\\b1024c.log: 'DISMISS+Demographics ... pill [336,142,688,169] head {t:57,b:96}' and 'PILL OVER PANEL Demographics [stat-card \"Population283,013...\", sc-v \"283,013\", stat-card \"Workforce141k...\", \"EducationEQ 101...\"]'; 'PILL OVER PANEL Help [sec-title \"Simulation\", sec-title \"Tools\" ...]'. C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\logs\\b1280c.log: 'PILL OVER PANEL Help'. Screenshots C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\shots\\b1024x600_dismissed_Demographics.png (the pill covers the Population/Workforce/Education/Health values) and C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\shots\\b1280x720_dismissed_Help.png (it covers the column headings). Title rows and tabs stay clear and hit-testable, so the brief's 'not over the title' check passes. Settings/Budget/Graphs place the pill beside or above. Code: the pill-only branch and c4's fold (singlePlace -> dockBanners beside the panels, else 'below their header rows') put it on the panel body when the panel starts at the top. The same spot is used by the c4 fold with live banners (inferred from the code; not captured).",
      "suggestedFix": "In dock(), when a centred panel leaves no room beside or above for the pill, place it below the panel (above the stack bottom / toolbar) or in the free strip at the screen bottom, never over the panel body; or show the count as a badge on the top-bar Emergencies button. Add uiStacking cases for 1024x600 with Demographics and Help, and 1280x720 with Help (pill-only and with live banners).",
      "files": ["src/ui/EmergencyBanner.ts", "tests/game/uiStacking.test.ts"]
    },
    {
      "title": "Without WebGL2 the game hangs forever on 'Rendering the region...' after a region is opened; no message, and the city's fallback/null views are never reached (pre-existing, not part of this round's diff)",
      "severity": "minor",
      "area": "app / region screen (main.ts showRegion)",
      "evidence": "A separate Chromium 141 launched with --disable-webgl2 (WebGL1 still available): the title screen works; Load Region -> Import small_s7_y10 -> Open stays on the loader 'Rendering the region...' at about 85% for 60 s and more. Log C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\logs\\nowebgl2.log ('NOWEBGL2 browser contexts {webgl2:false, webgl:true}', 'timeout: region screen', console 'THREE.WebGLRenderer: A WebGL context could not be created ... Error creating WebGL context'). Screenshot C:\\Users\\techsin\\AppData\\Local\\Temp\\claude\\C--Users-techsin-Desktop-projects-simcityweb\\aa362639-df94-5668-b880-d90605d049a2\\scratchpad\\t017\\playtest\\shots\\nogl2_stopped.png. App.showRegion (src/main.ts about l.369-406) builds RegionScreen and awaits regionScreen.ready with no failure path. src/region and src/main.ts are unchanged in this round.",
      "suggestedFix": "In App.showRegion wrap new RegionScreen(...) and 'await regionScreen.ready' in try/catch with a timeout; on failure hide the loader and show an explanatory screen ('WebGL 2 is not available in this browser') with a way back to the title. Optionally check WebGL2 once on the title screen.",
      "files": ["src/main.ts", "src/region (RegionScreen module)"]
    }
  ]
}
```
