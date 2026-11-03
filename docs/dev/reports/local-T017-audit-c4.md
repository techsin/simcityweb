# local-T017-audit-c4: close-out check 4, the auditor (T017)

Base **`d8256fc`** (fix round 4 merged). The auditor ran as a fresh sub-agent at maximum effort, read-only, in its own
worktree. Its final answer follows verbatim; its JSON block is at the end. Two of its screenshots are in
`local-T017/` (the EM-3 steady state with Budget open at 1024x600 and 1366x650).

**Counts: 0 blocker, 0 major, 2 minor.**

---

# T017 close-out check 4: AUDITOR report

**Base: `d8256fc`** (d8256fce812307ccd73edd781231cadfecd08cfb). I audited `git diff 5a16942 d8256fc` for src/ui, src/game, src/sim, src/save, src/main.ts, the teardown hunks in src/render (BuildingRenderer's request owner and `cancel(this)`; lodBuilder), tools/leakprobe and tests.

I worked read-only in C:\Users\techsin\Desktop\projects\simcityweb-T017a: no edits, no commits, and `git status` is clean at the end. Everything I produced is under **AUDIT** = C:\Users\techsin\AppData\Local\Temp\claude\C--Users-techsin-Desktop-projects-simcityweb\aa362639-df94-5668-b880-d90605d049a2\scratchpad\t017\audit (logs\, out\, scripts\, shots\).

**Environment:**
- Windows 10, node 22.12, TypeScript 7.0.2, vitest 5.0.1.
- Chromium 141.0.7390.37 headless (Playwright 1.56), flags --enable-gpu --ignore-gpu-blocklist --use-angle=default.
- WebGL renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)". The driver is 32.0.16.1047 per the machine notes; WebGL does not expose it.

**Counts: 0 blocker, 0 major, 2 minor.** The main one: c4's own slider cleanup keeps every slider alive until exit, so the DOM grows for as long as the Budget panel stays open (finding 1).

## Summary

### Gates (all pass)

**tsc --noEmit:** exit 0 (logs\tsc.log).

**Full vitest, run twice (default and verbose reporter), with SIM_FIXTURES and SIM_SNAP set:**
- 126 files passed, 1 skipped; 1115 tests passed, 6 skipped, 0 failed. Exit 0, and no "Unhandled" line in either run.
- Skipped tests: 3 are gated by BALANCE, and 3 are "profiler fixtures (1M-population captures): none found".
- The SIM_FIXTURES tests ran: trafficCore, roadTransitSearch and servicesTierEngine (on bot256_s7_y60).
- **CRLF:** tests/wasm/binary.test.ts passes here (4/4). This fresh worktree is all LF (`git ls-files --eol`). The main checkout, made before T012, still has all 16 wasm/ files as CRLF in its working tree and would fail there, so a fresh checkout does fix it.
- Logs: logs\vitest_full.log, logs\vitest_verbose.log.

**Bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` (with SIMBOT_LOG=1 and --save-years 15):**
- 2015: 194,432 residents, 2,814 buildings.
- All 1,201 non-timing lines are identical to the same run at 5a16942. That covers the yearly table, the budget dump and the full action log; only the ms columns differ.
- Logs: logs\bot_new.log, logs\bot_base.log.

**Recovery codec suite** (recoveryCodec.test.ts + recovery.test.ts): 21/21 (logs\recovery.log).

**Old saves in node** (scripts\loadOld.mts; logs\loadOld_new.log, logs\loadOld_base.log), 10 files:
- the CITIES small_s7_y10, vet_s7_y21 and vet_s7_y43, each as city and region file;
- check 3's old9948964 save;
- my own 9948964 save, made with `git archive 9948964` and that commit's own SimBot (seed 11, 8 years) and its saveRegion / saveCity / exportRegion / packFile: 77,200 residents, 3 live incidents (scripts\writeOld.mts).

For every file:
- It loads and runs 45 days.
- The serialized-state sha256 after 45 days is the same on a second load (deterministic).
- It is the same again when the 45 days run with 27,000 interleaved desirability / land-value breakdown calls, so inspecting does not perturb the sim.
- It is identical to the hash the 5a16942 code gives for the same file.
- serialize → gzip → deserialize round-trips to the same bytes.

**Old saves in the browser:**
- My 9948964 region file imports through Load Region and plays 2 full cycles (77,483 → 85,610 residents).
- vet_s7_y43 plays at 1920x1080 (991,403 → 1,003,521).
- 0 page errors in both.

**tools/leakprobe, all four modes, 3 cycles each on small_s7_y10 (ports 5412 / 6412):** fresh, persistent, fresh hostile and persistent hostile all PASS with [0,0] every cycle.
- The census in the hostile modes: the harness-held `div.ins-sec` (12–22 nodes) and the closing inspector panel (286–371 nodes) are detached with 0 listeners.
- **Positive control:** the same gate against 5a16942 (a scratch copy with a private vite cache) fails, fresh hostile 1/1/1 and persistent hostile 1/2/3 (heap 54 → 78 MB).
- Logs: logs\leakprobe.log, logs\leakprobe_base.log, out\lp_*.json, out\lpbase_*.json.

**My own browser leak probe** (scripts\probe.mjs), method:
- Input is coordinate mouse and keyboard only; no locators.
- Counts: CDP queryObjects on 28 classes, with an objectGroup on every call and the group released; discardConsoleEntries and 3 GCs before each count.
- 17 WeakRefs made before the exit: scene, state, sim, ctx, signal, root, canvas, uiRoot, info, toasts, banner, toolbar, topBar, minimap, world, objects, panels.
- Console calls are swallowed into strings, so no object reaches the inspector's console storage.
- A detached-DOM census with listener counts.

What each cycle does:
- 6 inspector clicks: 4 growables and 2 services or utilities, WHY? opened 4 times, and Focus.
- All 9 top-bar panels and Help, with every tab.
- Budget: drags on Taxes and Services sliders, stepper presses.
- All 26 data views; all 10 toolbar families with every tab and a card each.
- Zone, road, bulldoze and de-zone drags; power and subway; the terrain brush and its slider.
- A quake, then Choose station and dismiss on the banners; Ctrl+S.
- **A Send nearest right before the exit**, with the "Fire truck dispatched" toast still up; then Save & exit through the pause menu.

Results:
- Cities: small ×3 at 1280x720; the 304k city ×3 at 1366x650; my 9948964 save ×2; the 991k city ×1 at 1920x1080.
- In the city, every class counts 1. That is the probe's positive control.
- At exit +2 s and +20 s: all 23 city classes are 0 and all 17 WeakRefs are cleared.
- Canvases and WebGL2 contexts are back to 3 / 1 (the region baseline); window / document listeners are 32 / 4 every cycle; 0 page errors.
- Logs: logs\small3.log, logs\big3.log, logs\old9948964_browser.log, logs\y43_browser.log. Heap snapshots: out\small3_final.heapsnapshot, out\big3_final.heapsnapshot.

**Hostile, PIN=all:** every node of the city DOM, its canvas and its WebGL2 context were held from window across the exit (small ×2, 304k ×1).
- Every city class is 0 at +2 s, and the scene / state / sim / ctx / signal WeakRefs are cleared.
- The pinned `mp-scene` tree (764 and 1,461 nodes) has 0 listeners.
- After I released the pins, everything is freed (logs\pinall_*.log).

**Races** (scripts\races.mjs): exit the moment the HUD exists; exit during the first thumbnail burst; a double click on Save & exit; exit during the New Year show (busy). All are 0 at +2 s and +10 s, with 0 errors.

**Node WeakRef + gc** (scripts\auditWeak.test.ts, real timers, run in scratch copies of both trees):

| Probe | c4 | base |
|---|---|---|
| A: toast up at exit | ctx and Toasts freed right after the abort | both kept by the 12 s timer |
| B: LOD job posted to a worker that never answers | payload kept until `cancel(owner)`, freed after | no cancel() |
| C: breakdowns | state, sim, runtime freed | same |
| D: detached inspector, WHY? open, all 188 nodes held across the abort | ctx, panel, sim, state freed | all kept |

**Module-level sweep** of every top-level `let` and mutable Map / Set / array / object in src: nothing can pin a city.
- They are typed scratch arrays, primitives and catalog caches; WeakMaps keyed by CityState, EconRuntime or Simulation; and shared three.js materials and textures, whose renderer listeners WorldView / BuildingRenderer.dispose drop.
- The shared LOD builder now has `cancel(owner)`. The thumbnail singleton holds a WeakRef. The recovery base is cleared at exit.

**Static listener scan** (scripts\listenerScan.cjs, which extracts each full call): sites with no signal in src/ui and src/game went from 144 at the base to 25.
- The remaining 25 are: abort hooks on the signal itself; EmergencyBanner's window listeners (removed in its abort hook); uiSounds (page-level by design); CityScene's window / document listeners (removed through `offs`); the fallback camera (removed in its dispose).
- No `.onX =` property handlers.

**EM-3, steady state** (game paused with quake banners up; scripts\em3.mjs): 0 EmergencyBanner layout reads, and 0 reads in total, in every phase at 1024x600, 1280x720 and 1366x650.
- Phases: banners only; Budget open; Budget closed; flyout open; flyout closed.
- The dock never flipped between folded and unfolded (logs\em3q_*.log).

**UI-tick CPU** (all uiTick handlers; 304k city, 8–9 banners plus the inspector with WHY?): no measurable cost from the new code.
- c4: 1.55 and 1.42 ms mean per tick at speed 1, 1.08 and 0.97 ms paused.
- base: 1.39 ms at speed 1, 0.99 ms paused.

### Fix round 4, item by item

1. **Major (hardened): CONFIRMED,** with finding 1 as a side effect.
   - Binding to the city signal: the census shows 0 listeners on detached city trees, PIN=all frees the city, and node D frees it.
   - The guard wrappers and null views: confirmed by code, by the cityDisposeCanvas asserts, and by PIN=all.
   - `abort('dispose')`: DOMException count is 0 after every exit, and nothing reads `signal.reason` or uses fetch / throwIfAborted with the city signal.
   - Per-call breakdown contexts: lvCtx reuses the shared per-runtime LvExtra, so there is no forced historic rebuild per call; termCtx allocates two small coarse arrays per call; the bot is identical.
   - The gate works: 4/4 on c4, and the base fails both hostile modes. See finding 2 for one gap.
   - **No listener that must outlive the city is bound to its signal.** The region and title screens use src/region/ui helpers and an unbound MusicPlayer; uiSounds is page-level.
   - In the browser after 2 exits (logs\regionAfterExit.log): the region music pill works (Next track changes the track; the track-list popover opens and Esc closes it). The region Settings dialog works (Mute all toggles `audio.muted`; Esc closes it). Re-entering worked in every cycle.
   - Double aborts are guarded. loadSim / initViews re-check `disposed` after each await, so the 2 s now-playing watcher interval can't register late. Timers left after an exit are ≤ 1.8 s and reach only detached DOM.
2. **Minor 1: CONFIRMED.**
   - Toasts: node A; and 12 browser exits made right after a dispatch, all 0 at +2 s.
   - `cancel(owner)`: node B. The render hunks are sound (deleting from a Map while iterating is safe, posted jobs stay to fill the cache, unposted jobs are dequeued).
3. **Minor 2: CONFIRMED** by code review, the passing lane-E unit tests, and 0 EM-3 reads. I did not reproduce a note wrap in the browser.
4. **Minor 3: CONFIRMED in the browser** (demo-ui.html?fallback=all): WebGLRenderer 1 → 0 after `scene.dispose()` on c4; 1 → 1 on the base (logs\m3_*.log).
5. **Minor 4: CONFIRMED in the browser:** every flyout, a 17 s idle, 6 inspections plus every flyout again, another 17 s idle. WebGLRenderer on c4: 1 → 2 → 1 → 2 → 1. On the base: 1 → 2 → 2 → 3 → 3 (logs\m4_*.log).
6. **Minor 5: CONFIRMED in the browser,** steady state with real clicks:

   | Size | Budget open | Budget closed |
   |---|---|---|
   | 1024x600 | everything folded into "9 more emergencies need you — open Emergencies" at y 56; panel top is 110 | 7 compact + pill |
   | 1280x720 | 1 compact banner + pill above the panel (pill y 112, panel top 170) | 3 full + 2 compact + pill |
   | 1366x650 | 8 compact banners beside the panel | 3 full + 1 compact + pill |

   Nothing over the panel at any size. Screenshots: shots\em3_q1024_budget.jpg, shots\em3_q1366_budget.jpg.

## Findings

### 1. slider()'s abort cleanup keeps every slider, and its detached panel subtree, alive for the whole city session; the Budget panel piles up DOM while it is open (a regression against 5a16942)

- **Severity:** minor
- **Area:** ui (src/ui/dom.ts `slider`; BudgetPanel; BrushTool)
- **Evidence:**
  - **How Chromium 141 behaves** (blank page; scripts\signalSemantics.mjs, logs\signalSemantics.log): with 5,000 elements whose listeners are bound to a live AbortSignal, 0 of 10 sampled elements survive GC. With c4's pattern from dom.ts:132–133, `signal.addEventListener('abort', () => { delete el.__paint }, { once: true })`, 10 of 10 stay alive until the abort.
  - **In the game** (scripts\growth.mjs): small_s7_y10 at 1280x720, Budget opened by click on Taxes, speed 3. I set "uncovered emergencies: keep going" as a declared setup, so both trees cover day 3602 → about 5206 (about 53 game months in 75 s).

    | | c4 | base |
    |---|---|---|
    | range inputs | 46 → 841 | 16 (flat) |
    | buttons | 124 → 1,713 | flat |
    | abort listeners on ctx.signal | 49 → 844 | 3 |
    | DOM nodes | 1,717 → 16,063 | about 1,180 (flat) |
    | JS event listeners | 693 → 9,429 | about 350 |

    On c4 the growth stays after Budget closes. With the inspector open (WHY?, sections rebuilding), c4 is flat (nodes 833 → 972, about 200 listeners): the ~150 other signal-bound listeners are fine, and the cause is only `slider()`.
  - **Size** (scripts\growthBytes.mjs, heap snapshots including Blink nodes): after 40.5 game months, c4 holds 645 range inputs (each with a shadow root), 2,864 spans, 1,290 buttons, 3,522 text nodes and about 7,300 listener objects. That is about 1.9 MB of Blink self size: roughly 48 KB per game month, or about 2 MB per real minute at speed 3 with Budget open.
  - Each Budget open or tab switch also leaves one Taxes subtree (15 sliders, about 270 nodes) or one Services subtree (about 8 sliders). Each terrain-brush selection leaves 2 sliders.
  - Everything is released at exit: the post-exit snapshots are 159.75 MB on c4 and 159.07 MB on the base, and range inputs go back to 2.
  - The node tests can't see this: tests/game/fakeDom.ts implements `signal` with abort listeners that hold every element, unlike Chromium.
- **Suggested fix:** drop the per-element abort hook.
  - Make paint independent of `opts`, for example a module-level `paintFill(el)` that reads el.min / el.max / el.value (h() already sets them as attributes), used by setSlider and BrushTool instead of the `__paint` expando.
  - Or build paint in its own function scope, `makePaint(el, min, max)`, so its context never holds the callbacks.
  - Either way nothing on the element reaches the city, and no abort listener is needed.
  - Add a browser check, for example in tools/leakprobe: keep Budget open for N months and assert the HTMLInputElement count stays flat.
- **Files:** src/ui/dom.ts (slider ~94–136, setSlider ~173–180), src/ui/panels/BudgetPanel.ts (renderTab / renderTaxes / renderServices), src/game/tools/BrushTool.ts (options; `__paint` at 125), src/ui/panels/SettingsPanel.ts, tests/game/fakeDom.ts

### 2. tools/leakprobe has no in-city positive control, so a broken count would pass

- **Severity:** minor
- **Area:** tooling (tools/leakprobe)
- **Evidence:**
  - `counts()` runs only after the exit (leakprobe.mjs:106–130), and the pass condition is CityScene === 0 && CityState === 0 (:311).
  - The prototype comes from `import('/src/game/CityScene.ts')` in the page. If that ever resolves to a different module instance from the app's, every count reads 0 and the gate passes vacuously. That would happen after an HMR re-import gives the app's copy a `?t=` URL, or after a moved file or a renamed export.
  - Today it works: its hostile modes fail on 5a16942 (1/1/1 and 1/2/3), and my probe counts 1 in the city.
  - It also never discards console entries before the GC. A city object logged or thrown at exit would then be pinned by the inspector's console storage, which gives a false FAIL (the safe side).
- **Suggested fix:** count once in the city, after Play and before the cycle, and fail the run unless CityScene and CityState are 1 there. Call Runtime.discardConsoleEntries before each GC.
- **Files:** tools/leakprobe/leakprobe.mjs, tools/leakprobe/README.md

## Notes (not findings)

- **Settle guard (minor 2):** heights come from dock()'s ResizeObserver-driven measurement, so a note that wraps is guarded from the next UI tick on. When a first measured height replaces the 150 / 64 default, the banners below are marked moved once more (one extra 350 ms window). Inherent and harmless.
- **Region heap per exit:** grows 0.1–1.1 MB with 0 city objects (44.4 → 45.1 → 45.2 MB; 44.9 → 46.0 → 46.5 MB). This is region-side, as the c4 report says. In leakprobe's persistent mode the heap also grows 1–2 MB per cycle from the per-step CDP connections (the harness); fresh mode is flat.
- **Pre-existing, same on the base:** continuing the live sim 3 more days differs from save → reload → 3 days (303 serialized paths differ on small_s7_y10). The runtime's warm state is not serialized. Loading the same file twice is deterministic.
- **Double click on Save & exit:** the second click is blocked by `.modal-back.closing { pointer-events: none }`. One extra non-WebGL canvas stayed until the next visit. Bounded, and the exit flow is not in this diff.
- **Render (out of scope):** ANGLE D3D11 shader-compiler warnings appear in the console (X4122 precision; X4000 "potentially uninitialized variable (f_waterGround)").
- **vitest's 27 MaxListenersExceededWarning lines** come from fakeDom's signal model (a node AbortSignal with more than 10 abort listeners). Test noise.
- **Per-tick layout reads by other components** with no banners up (CursorTip, WorldView, CityObjectsView, Notifications): pre-existing, not EM-3, not in this diff.
- **Not done:** a browser repro of a banner note wrapping (minor 2).

## Cleanup

- I stopped my vite on 5402 (pid 47496) and my base-tree vite on 5412 (pid 41196); leakprobe stopped its own servers.
- 5402, 5412, 9442 and 6412 are not listening.
- No leakprobe / 6412 / 9442 Chromium is left, and every Playwright browser I launched has closed. The one still running (pid 26204 under parent 20368, started 12:01 local) predates my first launch and is not mine.
- I removed the node_modules junctions in my scratch tree copies. The worktree is clean at d8256fc.

```json
{
  "summary": "Audit of 5a16942..d8256fc (base d8256fc) on RTX 5070 Ti / ANGLE D3D11 / Chromium 141.0.7390.37 headless / Windows 10. Gates pass: tsc clean; full vitest 1115 passed / 6 skipped / 0 failed, no unhandled errors, binary.test passes (fresh LF checkout); 128x15 seed-7 bot identical to 5a16942 incl. action log, 194,432; recovery 21/21; 10 old save files incl. a fresh 9948964-written one load, continue deterministically, hash-identical to the base code, inspection-invariant, round-trip exact; browser plays the 9948964 save and the 991k city; tools/leakprobe 4/4 modes PASS (base fails hostile 1/1/1 and 1/2/3). Own probes: 0 city objects and all WeakRefs cleared at +2 s/+20 s after full action cycles in 4 cities incl. exit right after a dispatch, with every city DOM node pinned, and in 4 exit races; EM-3 0 reads in steady state at 3 sizes; UI-tick CPU unchanged. All fix-round-4 items confirmed (minors 3/4/5 in the browser against the base). 0 blocker, 0 major, 2 minor.",
  "findings": [
    {
      "title": "slider()'s abort cleanup keeps every slider and its detached subtree alive for the city session; the Budget panel piles up DOM while open (regression vs 5a16942)",
      "severity": "minor",
      "area": "ui (src/ui/dom.ts slider; BudgetPanel; BrushTool)",
      "evidence": "Chromium 141: listeners bound to a live signal don't retain discarded elements (0/10), but signal.addEventListener('abort', () => ...el...) as in dom.ts:132-133 retains 10/10 until abort. In game, Budget (Taxes) open at speed 3 over the same ~53 game months: c4 range inputs 46->841, buttons 124->1713, abort listeners on ctx.signal 49->844, DOM nodes 1717->16063, JS listeners 693->9429, kept after close; base flat (16 inputs, ~1180 nodes, ~350 listeners); inspector-open run flat. After 40.5 months ~1.9 MB Blink self size (~48 KB per game month, ~2 MB per real minute at speed 3), plus one subtree per Budget open or tab switch and 2 sliders per brush selection; all freed at exit. The fake DOM's signal model retains elements too, so node tests can't see it.",
      "suggestedFix": "Remove the per-element abort hook: make paint independent of opts (a module-level paintFill(el) reading el.min/max/value, used by setSlider and BrushTool instead of __paint; or makePaint(el, min, max) in its own scope). Add a browser check that HTMLInputElement stays flat with Budget open for N months.",
      "files": ["src/ui/dom.ts", "src/ui/panels/BudgetPanel.ts", "src/game/tools/BrushTool.ts", "src/ui/panels/SettingsPanel.ts", "tests/game/fakeDom.ts"]
    },
    {
      "title": "tools/leakprobe has no in-city positive control, so a broken count would pass",
      "severity": "minor",
      "area": "tooling (tools/leakprobe)",
      "evidence": "counts() runs only after exit and passes on CityScene==0 && CityState==0 (leakprobe.mjs:106-130, 311). The prototype comes from import('/src/game/CityScene.ts'); if that resolves to another module instance (an HMR ?t= copy, a moved or renamed module), every count is 0 and the gate passes vacuously. It works today (base fails hostile 1/1/1, 1/2/3). It also doesn't call Runtime.discardConsoleEntries before the GC (false-FAIL risk only).",
      "suggestedFix": "Count once in the city after Play and fail unless CityScene and CityState are 1; discard console entries before each GC.",
      "files": ["tools/leakprobe/leakprobe.mjs", "tools/leakprobe/README.md"]
    }
  ]
}
```
