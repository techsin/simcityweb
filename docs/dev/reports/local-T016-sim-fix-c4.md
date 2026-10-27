# local-T016-sim-fix-c4: close-out fix round 4 on the desktop

Branch `local/T016-sim-fix-c4`, base **`5a16942`** (the commit check 3 reviewed).

Machine: Windows 10, RTX 5070 Ti (ANGLE D3D11, driver 32.0.16.1047), Chromium 141.0.7390.37 headless with hardware
acceleration, node 22.12.

## Results at a glance

| Item | Root cause | Status |
|---|---|---|
| **Major: exit keeps the city alive after a growable inspection** | The trigger is the T013 playtest harness: Playwright's `locator.getAttribute()` on the inspector's WHY? header keeps that node alive after exit. The route into the city was the ~90 listeners never removed from the city's DOM. With real input the game freed the city already. | **Fixed (hardened).** Every city-lifetime listener now goes with the city's AbortSignal. The playtester's own harness, replayed by the new gate, no longer keeps the city: base fails it, c4 passes. |
| Minor 1: city alive 1–3 s after exit when a dispatch ran just before | A **toast's expiry timer** (7 s; 12 s for disasters) held `Toasts` → `ctx` → the scene. The LOD builder named in the audit was not it, though its `cancel(owner)` is in as well. | **Fixed:** 0 at +2 s after a dispatch-then-exit (was 1). |
| Minor 2: settle guard ignores height changes above | The slot signature had ids and full / compact only. | **Fixed:** the cached heights are in the signature (no layout read). |
| Minor 3: fallback view keeps its renderer | It drew the shared registry geometry and building material. | **Fixed:** per-view geometry views and material clone, LUT and context released. 1 → 0 renderers in the browser. |
| Minor 4: thumbnail renderers pile up | three's module-level DFG LUT kept each idle-disposed renderer. | **Fixed:** 2 → 1 after idle, and 1 after a second burst (was 3). |
| Minor 5: stack over a centred Budget at 1024x600 | No placement rule for "no room beside or above". | **Fixed:** the stack folds into the counted pill above the panel. 1280 and 1366 are unchanged. |

**Gates:**
- `tsc` clean.
- vitest 1,105 passed and 6 skipped. The 1 failure is the Windows CRLF hash in `tests/wasm/binary.test.ts`: the base
  predates T012's `.gitattributes`.
- The 128 × 15 seed-7 bot is identical to the base with its full action log (194,432 in 2015).
- Old saves: 6 / 6 load, continue and reload identically.
- The new browser gate `tools/leakprobe` passes in all four modes, 3 cycles each.

## The major

### What check 3 saw, and the tie-break

The playtest counted one more live city per exit after a single growable inspection. The audit counted none, with
growables inspected too (WHY? opened 4–5 times per cycle).

The tie-break ran the playtester's minimal sequence in a freshly launched browser with coordinate input only. Two runs
of 3 cycles each, one discarding the console entries and one keeping them, both had **0 CityScene / CityState** at +2
and +20 s.

### Narrowing it down

I ran the playtester's own scripts on its own setup: one long-running Chromium with a persistent profile, every step a
separate Playwright `connectOverCDP` session.

| Run on the base | Cities after exit |
|---|---|
| its cycle: a growable queried, then its WHY? locator calls (`count`, `getAttribute('aria-expanded')`, `boundingBox`) | **1** |
| the same with `NOWHY=1` (the WHY? locator calls skipped) | 0 |
| inspector opened by coordinates; a **new isolated world** (raw CDP `Page.createIsolatedWorld`) reads the WHY? header's attribute | 0 |
| the same, but a single Playwright **`locator.count()`** on the header | 0 |
| a single **`locator.getAttribute('aria-expanded')`** | **1** |
| a single **`locator.boundingBox()`** | 0 |
| a single `page.locator('.panel .ins-sec-h').count()` | 0 |

The game frees the city on every path a player has.

The retaining operation is Playwright's `getAttribute` on a node of the city's inspector. The holder is Playwright's
utility world in the page. Isolated worlds as such are not the cause: a fresh isolated world touching the same node did
not retain it. A browser extension or DevTools could still hold such a node the same way.

Once that one node (`div.ins-sec`, 12 nodes) is held, the whole detached city DOM came with it. Its listeners closed
over their components, the components' `ctx`, and so the scene and the CityState. The heap-snapshot evidence in the
playtest (the "(Traced handles)" roots, the AbortSignal DOMException, the 4 ResizeObservers, the detached `mp-scene`)
is this graph.

**The Blink-side owner, named:** the node is held by Playwright's injected utility-world script after
`locator.getAttribute()`. It is not the game, and not V8's console storage (it leaks with the console discarded too). It
is not an isolated-world wrapper by itself either.

### The fix: no path from the city's DOM to the city

The listener census below counts the listeners left on the detached city trees after an exit (CDP
`DOM.getDetachedDomNodes` + `DOMDebugger.getEventListeners`).

| | base `5a16942` | c4 |
|---|---|---|
| detached `mp-scene` tree | 69 listeners (Toolbar, TopBar, Onboarding, MiniMap, Notifications, CityScene) | gone (collected) |
| detached inspector panel | 10 (InfoPanel, Panel) | gone |
| banners / pill | 4 (EmergencyBanner) | gone |
| the node the harness holds (`div.ins-sec`) | 1 | **0** |
| detached trees after 3 hostile cycles | 28; heap 55 → 67 → 79 MB | 6; heap 43 → 45 → 46.5 MB |

What changed:

**(b) Every listener the scene and its HUD register goes with the city's AbortSignal (`ctx.signal`).**
- About 150 call sites across 22 files (Codex lane S): Toolbar, TopBar, MiniMap, Notifications, Onboarding, Panel,
  InfoPanel, every panel (Budget, Graphs, Data views, Demographics, Emergencies, Advisors, Lists, Settings), Modals
  (ErrorOverlay), NewYear, the tools, and EmergencyBanner's own (lane E).
- `src/ui/dom.ts` helpers take the signal: `h()` gets a `signal` attribute, and `slider` / `toggle` / `segmented` /
  `stepButtons` an optional `signal`. The slider's `__paint` expando, which closes over the callbacks, is deleted on
  abort.
- Page-level listeners stay unbound on purpose: `uiSounds`, and the region / title music players. SettingsPanel passes
  the city signal to its own MusicPlayer.
- CityScene: its root `pointerleave`, the dev badge, ErrorOverlay's and NewYear's listeners take the signal
  (`CityScene.ts` 178, 292, 329, 594).

**(b) The guarded systems stop closing over the scene.**
- The wrappers report through `guard`, which dispose clears (`CityScene.ts` 155, 602, 376).
- The scene keeps neither view after dispose: both are swapped for the null views (`CityScene.ts` 402).
- `sim` / `ctx` are not nulled. Component timers (toasts, settle flashes) may still read `ctx` once after exit, and a
  thrown TypeError there would be a new page error. Instead nothing outside reaches the scene any more.

**(c) `this.abort.abort('dispose')`: a plain reason** (`CityScene.ts` 375). A bare `abort()` makes a DOMException whose
captured stack holds `dispose()`'s receiver, the scene, for as long as the signal lives. That DOMException is the one the
playtest's snapshot showed.

**(a) The desirability and land-value breakdown contexts are built per call** (`desirability.ts` 684, `landValue.ts`
574). The WeakMap from c2 was not a leak (a WeakMap value that references its own key is collectable), but nothing now
outlives the call.

**(d) The browser gate, `tools/leakprobe/leakprobe.mjs` + README.**
- It queries one growable, presses Esc, Saves & exits, then counts CityScene / CityState at +3 s for 3 cycles.
- `--mode fresh`: one Playwright-launched browser per run. `--mode persistent`: one Chromium kept for the run with its
  own profile, each step a separate CDP connection.
- Coordinate input only, with an `objectGroup` on every CDP call.
- `--hostile` replays the T013 playtest cycle step for step. `--census` lists the listeners left on detached trees.
- The script runs and kills its own vite and refuses a busy port. An earlier version of this gate was fooled by a stale
  server from another tree.

| `tools/leakprobe` on small_s7_y10, 3 cycles | base `5a16942` | c4 (`c6cd81c`) |
|---|---|---|
| fresh | PASS 0/0/0 | **PASS 0/0/0** |
| persistent | PASS 0/0/0 | **PASS 0/0/0** |
| fresh, hostile | FAIL 1/1/1 | **PASS 0/0/0** |
| persistent, hostile | FAIL 1/2/3 | **PASS 0/0/0** |

The audit's full-cycle probe on c4 covers inspector with WHY?, every panel, 26 data views, every tool family, fires
with Send nearest and Choose station, Ctrl+S, then exit:
- small_s7_y10, 3 cycles at 1280x720: 0 at +20 s every cycle, 0 page errors;
- vet_s7_y21 (304k), 2 cycles at 1366x650, quake: 0 CityScene / CityState at +2 s and at +20 s in both cycles (a quake with Send nearest and Choose station just before each exit), 0 page errors.

**Left open (major):**
- Nothing in the game.
- A harness that drives the city with Playwright locators still keeps a small detached subtree alive (12 nodes, no
  listeners) until the page navigates. That is the harness's own memory, not the city.
- Future probes should keep using coordinates (the README says so).

## Minors

### 1. City alive 1–3 s after exit when a dispatch ran just before

- **Root cause.** The audit suspected the shared LOD builder. A heap snapshot 0.3 s after a dispatch-then-exit named
  the real holder: `DOMTimer → kill → Toasts → ctx → CityScene`. The dispatch posts a toast ("Fire truck dispatched"),
  and its expiry timer (7 s; 12 s for a disaster) kept the component and the whole city until it fired.
- **Fix.** `Toasts` keeps its pending timers and clears them when the city signal aborts (`Notifications.ts` 145, 149,
  213).
- **Also done, as the audit suggested.** `LodProxyBuilder.cancel(owner)` drops a disposed renderer's waiting
  callbacks and unposted jobs (`lodBuilder.ts` 184). BuildingRenderer passes itself as the owner and cancels in
  `dispose` (two one-line hunks, below). Without it a worker that never answered would have kept the city for good.
- **Evidence.** Quake + Send nearest + Choose station, then exit, 2 cycles: CityScene / CityState **0 at +2 s** (the
  same run on c4 before the toast fix: 1 at +0.3 s and at +2 s).
- **Tests.** `tests/game/cityTeardown.test.ts`: the toast timers are cleared by the abort (fails without the fix:
  "expected 2 to be 0"), and `cancel(owner)`.

### 2. The settle guard's slot ignores height changes of banners above

- **Fix.** Each shown banner's cached height (full / compact, per stack width, as `dock()` measures it) is part of the
  `above` signature (`EmergencyBanner.ts` 1120). No new layout read: EM-3 stays at 0 forced layouts in steady state.
- **Tests (lane E).** A banner whose upper neighbour grows from 150 to 190 / shrinks to 110 px marks only the banners
  below it as moved.

### 3. The fallback 3D view keeps its renderer and GL context

- **Fix (lane F).**
  - `FallbackObjectsView` draws per-view geometry views over the registry buffers and a patched material clone, and
    frees everything it drew in `dispose`. `viewOf` now lives once, in `src/game/geometryView.ts`, for the thumbnails
    and the fallback.
  - `FallbackWorldView.dispose` reads three's DFG LUT before the material disposes, disposes the renderer and the LUT,
    and forces the context loss (`FallbackWorldView.ts` 550–551).
- **Evidence (browser, the demo page with `?fallback=all`).** WebGLRenderer 1 → **0** after `dispose()`. A
  WebGL2RenderingContext wrapper stays with its canvas element, which the demo page itself keeps; the context is
  force-lost.
- **Test.** `tests/game/fallbackRetention.test.ts` (3 tests: listeners released, the renderer collectable, an exit
  before the first draw).

### 4. Thumbnail renderers survive their 15 s idle dispose

- **Fix.** `ThumbRenderer.scheduleDispose` reads three's DFG LUT from its material's program uniforms before the
  disposes and disposes it after the renderer (`thumbs.ts` 138, 146), as `WorldView.dispose` does.
- **Evidence (browser, 1280x720, every toolbar flyout).** WebGLRenderer 2 → **1** after the idle, and **1** again after
  a second burst and idle. Check 3 had 2, then 3.
- **Test.** `tests/game/thumbsRetention.test.ts` now models the module-level LUT and runs two idle cycles. It fails
  without the fix: the LUT keeps the renderer's listener.

### 5. At 1024x600 the stack covered a centred Budget panel's body

- **Fix (lane E).** When even one compact row would overlap a centred panel, `dock()` folds every banner into the
  counted pill and places the pill clear of the panel's title (`EmergencyBanner.ts` 1242). The other placements are
  unchanged.
- **Evidence (real input, quake on vet_s7_y21; screenshots below).**

| Size | Budget open | Budget closed |
|---|---|---|
| 1024x600 | the pill "8 more emergencies — open Emergencies" above the panel; 0 banners over its body or header | back to 8 compact |
| 1280x720 | 1 compact + the pill above the panel; 0 over it | 3 full + 2 compact + pill |
| 1366x650 | 8 compact docked beside the panel; 0 over it | 3 full + pill |

- **Tests.** uiStacking / EmergencyBanner cases for 1024x600 with Budget open, plus the unchanged 1280 / 1366 / 1920
  layouts (41 tests pass).
- A Send nearest press at each size dispatched: "Fire truck dispatched — ETA 5.4 min" in the 1280 shot.

## Hunks in src/render (teardown only)

- `src/render/city/buildings/BuildingRenderer.ts`, two one-line hunks:
  - line 1134: `pb.request(…, urgent, this)` (the owner argument);
  - line 2467: `this.proxies?.cancel(this);` in `dispose()`.
- `src/render/city/buildings/lodBuilder.ts`: `request()` records the owner of each callback, plus `cancel(owner)` (the
  queue / jobs bookkeeping only; nothing drawn changes).

Nothing else in src/render.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (SIM_FIXTURES, SIM_SNAP) | 1,105 passed, 6 skipped; 1 failed: `tests/wasm/binary.test.ts` (CRLF; the base predates T012) |
| 128 × 15 seed 7 bot | identical to `5a16942` including the `SIMBOT_LOG=1` action log (1,202 lines); 194,432 in 2015 |
| old saves (the CITIES cities, a save written by 9948964) | 6 / 6 load, run 45 days, reload identically, export round trip |
| a failing-then-passing test per item | toasts, the LUT (thumbnails), the fallback, the banner height / docking; a detached inspector holds 0 listeners after the abort; LOD cancel |
| browser gate `tools/leakprobe` | 4 / 4 modes PASS on c4; base fails both hostile modes |
| real input at 1024x600, 1280x720, 1366x650 | the table above; screenshots below (each one looked at) |

**Screenshots in git** (`docs/dev/reports/local-T016/`, JPEG):
- `1024-budget-open-stack-folded-into-pill.jpg`;
- `1280-budget-open-stack-above.jpg`;
- `1366-budget-open-stack-beside.jpg`;
- `1366-budget-closed-stack-restored.jpg`.

## Notes

- **Residual growth.** The heap on the region screen grows about 1 MB per exit in both trees, with 0 cities alive.
  It comes from region-side caches and the Load Region dialog's detached tree, region UI outside this round's scope.
- **A trap for future probes.** A vite left from another tree on the probe's port made one batch of my runs measure
  the base instead of c4. The gate now refuses a busy port and kills its own server by pid.

## Who wrote what

- **Codex** (max effort, one lane per file set):
  - lane S: the signal binding across `src/ui/**` and `src/game/**`, and the dom.ts API;
  - lane E: EmergencyBanner's listeners and minors 2 and 5 with their tests;
  - lane F: the fallback view (minor 3) with its test.
- **Me (Claude):**
  - the investigation: the tie-break, the harness bisect, the isolated-world and per-call experiments, the census, and
    the heap snapshot that found the toast timer;
  - the CityScene teardown (a–c), the toast fix, the LOD `cancel(owner)` and the thumbnail LUT;
  - the gate and its README, the shared `viewOf`, the fake-DOM signal support and `cityTeardown.test.ts`;
  - every review, gate and browser run.
