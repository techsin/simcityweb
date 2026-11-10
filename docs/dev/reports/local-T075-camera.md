# T075 camera

## FEEL-07 — spotlight camera

Implemented shared ShowCamera travel (New Year now delegates its camera hooks), input cancellation, four-second idle and held-input gates, reduced-motion/setting/LIVE/New-Year gates, captions and a 2 s approach / 4 s 25° orbit / 2.5 s return. Saves during a show retain the player's view. No sim/RNG changes.

Plan/code difference: CONTENT's `systemData.firsts` and first-event refs have not landed. The UI consumes optional positioned `news.ref.first` (`stage:6`, `stage:7`, `stage:8`, `unique:<defId>`, `neighbor`); it never invents or writes persistent firsts. Across-save once-only acceptance awaits these owner hooks:

- CONTENT/SIM: extend `src/sim/CityState.ts::NewsItem.ref` with optional `first?: string`. Record optional `systemData.firsts` keys in `rewardsSystem.init` and completed-building listeners (`built >= 1`), silently initializing existing cities, and emit positioned first news once.
- SIM/CONTENT: in `src/sim/actions.ts::plop` and `afterNetworkChange`, guard the existing unique-opening / neighbor news with the persistent record and attach the first ref; preserve ordinary news behavior and RNG draws.
- Cloud: append optional `firsts` to `src/worker/protocol.ts::SYSTEM_KEYS`. Generic news ref transport already works. No worker file edited.

Tests added: `tests/game/showCamera.test.ts` (29 passing tests: travel, exact return, input/idle/drag, priority/settings/motion gates, abort, ref deduplication, shared-camera ownership and rebound New Year cancellation). `npx tsc --noEmit` passes. Final gate inventory is below.

## FEEL-27 — founding fly-in

New cities descend from exactly 3× the landing distance over 2.5 real seconds, with the founded-month/mayor title. Input skips to the landing; reduced motion skips the animation. Saved-camera placement still uses CameraMemory unchanged. CameraController has one isolated new method, `setShowView`, so presentation travel can start above the normal zoom ceiling without changing player zoom behavior.

Tests added: `foundingCamera.test.ts` (7 passing tests: real controller, 3×/2.5 s/exact landing/input/title/save during skip); existing `cameraStart.test.ts` (3 passing) covers stored cameras. TypeScript passes.

**NOTE-065 request 1: done in this lane in Round 2.** The minimal `src/main.ts` contract/city-open hunk makes `cameraLanded` optional and plays the chime on landing, with immediate fallback for older scenes and the placeholder. It checks the captured city and scene identities, the existing scene abort signal (optional `ctx` contract), and the container's attachment before playing. City readiness and region entry remain independent of the landing promise. See Round 2 gates below.

## FEEL-24 — photo mode

H toggles the 200 ms HUD fade and a separate photo bar (time scrubber, host pause/resume, current-view PNG capture capped at 4096 px, Exit). Escape exits. HUD elements, tools, overlays and panel positions stay mounted; HUD input is inert and building gestures are ended/intercepted while left-drag camera pan remains available. Exit restores the prior focus/inert/class state and the clock's unmodified progression (or fixed hour), without persisting photo time into settings.

`tests/game/photoMode.test.ts`: 17 passing tests for restoration, fixed/auto clock, pause commands, pointer handling, capture size/name/failures and lifecycle. Capture timing on a real GPU remains a browser gate.

## FH-25 — rebindable keys

Added a profile key editor under Settings → Camera & controls. It captures physical codes in a focused text input, warns about conflicts (including Bulldoze → X against De-zone), blocks Apply until conflicts are resolved, and supports clear/reset. The existing profile settings schema persists the overrides. Default character shortcuts and physical camera keys retain FH-19 behavior; rebound camera primaries retain arrow/numpad alternatives. The existing contextual R pair remains intentional and explained in the editor; the rotate action can be rebound separately.

Tools, panels, speed/pause/save/help/photo, camera movement and Plop rotation consume the same bindings. Help refreshes key labels only when bindings change. Camera rebinding clears held keys. New Year cancellation checks the live rebound camera keys. Existing fixed Escape, brush-size and pointer gestures remain as before.

Tests added: `keyBindings.test.ts` (8 passing model/editor/profile/conflict tests) and `keyBindingsIntegration.test.ts` (6 passing real routing/camera/Plop/Help tests). TypeScript passes; existing `cameraControls.test.ts` (65) and worker `hygiene.test.ts` (18) pass.

Small outside-named file hunks in Round 1: `src/game/tools/PlopTool.ts` (rotate matcher and live hints; §7.3's WORLD exception), `src/ui/Modals.ts` (Help key labels/cache, photo/recenter rows). No infra hunks. Round 2 adds only the `src/main.ts` hunk explicitly authorized by NOTE-065.

## Round 1 files and gates

| File | Change |
| --- | --- |
| `src/game/ShowCamera.ts` | Shared travel, ownership generations, idle/input tracking and first-event adapter. |
| `src/game/NewYear.ts` | Camera hooks delegate to ShowCamera; pacing, clock, calendar and fireworks logic retain their behavior. |
| `src/game/cameraStart.ts` | Founding travel/title and landing snapshot. Existing stored-camera functions retain their behavior. |
| `src/game/CityScene.ts` | Camera/photo/input wiring, landing promise, presentation-safe camera saves and graphics-loss exit from photo mode. |
| `src/render/world/CameraController.ts` | New presentation-view and binding methods, small key canonicalization hunk. No moved/refactored controller code. |
| `src/ui/PhotoBar.ts`, `src/ui/fx.css` | Photo controls, bounded PNG download, clock/HUD restoration, 200 ms fade. |
| `src/game/bindings.ts`, `src/game/toolCatalog.ts` | Profile binding model/conflicts and binding-aware cycle/panel lookup helpers. |
| `src/ui/panels/KeyBindingsPanel.ts`, `src/ui/panels/SettingsPanel.ts` | Binding editor, its Settings button and Camera moments toggle. |
| `src/game/tools/PlopTool.ts` **outside named files** | Contextual rotation and truthful key hints only. |
| `src/ui/Modals.ts` **outside named files** | Live Help keys only, including photo and recenter. |
| Five new `tests/game/*` files | `showCamera`, `foundingCamera`, `photoMode`, `keyBindings`, `keyBindingsIntegration`. |

`npx tsc --noEmit` and `git diff --check` pass. **27 focused files / 359 tests pass**, including the worker hygiene gate. Four `pacingProbe.test.ts` cases are skipped because `PACING_SAVE` is unset. No existing test files changed. The earlier Plop fixture failures (fixtures without settings) were fixed with a default-binding fallback; their reruns all pass.

The default Vite config bundler and Vitest fork pool encountered `spawn EPERM`. Native TS config loading plus the thread pool succeeds. Each test used the quiet gate, sequentially, with this sandbox-compatible invocation:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool=threads
```

Passing files (all under `tests/`):

```text
game/showCamera.test.ts (29)
game/foundingCamera.test.ts (7)
game/photoMode.test.ts (17)
game/keyBindings.test.ts (8)
game/keyBindingsIntegration.test.ts (6)
game/cameraControls.test.ts (65)
game/cameraStart.test.ts (3)
game/newyear.test.ts (11)
game/newYearPacing.test.ts (19)
game/graphicsRestore.test.ts (10)
game/graphicsFirstRun.test.ts (21)
game/citySaves.test.ts (7)
game/cityDisposeCanvas.test.ts (2)
game/quakeShakePlop.test.ts (3)
game/budgetPreview.test.ts (10)
game/pendingHover.test.ts (4)
game/queryReads.test.ts (18)
game/toolsPreview.test.ts (10)
game/upkeepReads.test.ts (21)
game/toastBudget.test.ts (10)
game/rankFireworks.test.ts (14)
game/ruinState.test.ts (2)
game/uiRuins.test.ts (11)
game/uiCardTip.test.ts (2)
game/settingsSchema.test.ts (19)
audio/ambience.test.ts (12)
worker/hygiene.test.ts (18)
```

Machine-readable results: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T075/scratch/focused-gates.json`.

The full suite, bot and real-GPU/browser gates are left to the lead as requested. No sim, balance, RNG, save codec or worker source changed; Medium/Hard bit identity is expected, not measured here. Baseline bot command, with all strategy flags left off:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty medium
```

Expected unchanged 2015 residents: **[61,124, 93,804, 37,971] = 192,899**. No 256×60 run is needed by these items. Two-process Medium/Hard hashes were not run.

## Round 2 — NOTE-065 landing chime

Request 1 is complete. `src/main.ts` has two isolated hunks: the optional `CitySceneLike.cameraLanded`/abort-signal contract and the city-open chime continuation. Landing or input skip plays `cityReady` once; scenes without the promise keep the immediate fallback. City/scene replacement, exit, direct disposal and a detached container suppress the stale chime. Readiness, entered flags, load-time reporting and region entry retain their timing. No infra, worker, save or simulation files changed.

New `tests/game/cityReady.test.ts` executes the actual App entry tails, following the existing source-execution test approach because `main.ts` auto-boots and App is private. Its 12 cases cover delayed landing, immediate legacy/placeholder fallback, city/scene replacement, exit, disposal, detachment, replacement while the loader hides, rejected landing and both region-entry paths.

`npx tsc --noEmit` and `git diff --check` pass. **6 focused files / 83 tests pass**, run sequentially through the quiet gate with the native-loader/thread-pool invocation above:

| Test | Passed |
| --- | ---: |
| `tests/game/cityReady.test.ts` | 12 |
| `tests/game/playLoadTime.test.ts` | 1 |
| `tests/game/graphicsFirstRun.test.ts` | 21 |
| `tests/game/settingsSchema.test.ts` | 19 |
| `tests/audio/ambience.test.ts` | 12 |
| `tests/worker/hygiene.test.ts` | 18 |

Round 2 leaves all changes uncommitted. Request 2 is queued as **T077 after W1.3 and T061 merge**; `NewYear.ts` is unchanged. The full suite, baseline bot command/numbers above and real-GPU/browser checks remain with the lead. Round 2 adds no simulation/RNG changes, so the expected bot residents remain 192,899; this was not rerun here. Browser checks: fresh-city landing/skip gives one chime; exiting/replacing before landing stays silent; saved/legacy/placeholder entry retains its immediate chime; region entry retains `regionEnter`.

## Pending owner integration and verification limits

- FEEL-07's first-event UI is ready, but normal gameplay cannot trigger it until the CONTENT/SIM first-record/ref hooks above land. Once-only persistence across save/load is therefore **not verified or claimed**. Old cities with no firsts record need an explicit owner initialization policy; demolished historical firsts cannot be inferred from current buildings alone.
- **NOTE-065 request 1 completed here:** `src/main.ts::CitySceneLike` and the city-open chime continuation are implemented and tested in Round 2. This is no longer a cloud request.
- **NOTE-065 request 2 queued as T077:** `docs/WORKER_DESIGN.md` §3.6 specifies `host.liveYear` for New Year batch detection; `src/game/NewYear.ts::onYear` still uses `frames === 0 || day - lastFrameDay > 8`. T077 handles this after W1.3 and T061 merge. Round 2 leaves `NewYear.ts` and its batch detection untouched.
- Capture speed and real HUD layout were not measured. Existing `src/render/world/WorldView.ts::capture` restores postprocessing size/camera aspect/shadow state and disposes its render target only on success. Request to the render owner: wrap the mutated capture/render/readback section in `try/finally` so a failed photo readback restores those values and disposes the target too. That pre-existing failure path was not edited in T075.

## Browser checklist for the lead

- [ ] FEEL-07, after first hooks land: first stage 6, 7 and 8, each unique opening, and the first neighbor connection each spotlight once; save/reload and repeat without a second show.
- [ ] FEEL-07: four seconds idle, no held drag/key, no LIVE emergency/New Year/photo/pause/dialog; Camera moments off and reduced motion suppress the spotlight. Arrive by 2.5 s, orbit 25°, return by 9 s within 1 m/1%; Escape, camera input, tool/UI input and touch return control within one frame.
- [ ] FEEL-27: fresh city starts at least 3× out, title has full founding month/year and mayor, landing in 2.5–3 s; any input skips; reduced motion skips. Verify cityReady plays once at landing/skip, and a city exited/replaced before landing stays silent. Saved/legacy scenes and the placeholder retain their immediate chime; returning to the region retains regionEnter.
- [ ] FEEL-27: saved cities open at the stored view. Save during founding/spotlight/New Year and reload to the intended player/landing view, including Ctrl+S during fly-in skip.
- [ ] FEEL-24: H hides HUD in 200 ms; camera and scrubber work; pause uses the host; Capture downloads a current-view PNG within 1 s, correct city/date filename, neither dimension above 4096. Test narrow/720p screens.
- [ ] FEEL-24: H/Exit/Escape restore panel positions, tool/overlay selection, keyboard focus, HUD input and auto/fixed clock; graphics reset while photographing reveals the recovery dialog.
- [ ] FH-25: Settings editor is reachable/scrollable; Bulldoze → X warns about De-zone and disables Apply; resolve conflict, Apply, reopen/reload profile, and verify Help and Plop hints show the new key; Reset restores defaults.
- [ ] FH-25: rebound camera controls work, old primaries stop, arrow/numpad aliases work, New Year cancels on the rebound camera key; capture input never triggers a tool/camera move. Confirm default AZERTY/Dvorak behavior from FH-19.

## QA round 2 — the real-GPU QA's B1–B14 (on a750f64)

Source: the lead's `qa.md` for T075 (FEEL-07, FEEL-27, FEEL-24, FH-25 on the real GPU). Everything below is uncommitted on
`local/T075-camera`. No sim, balance, RNG, save codec or worker file changed; `src/main.ts` and `src/game/settings.ts` are
not touched in this round (the fly-in's new start uses the call main.ts already makes, `scene.reportLoadTime`, right after
`await ld.hide()`).

### What each bug got

| Bug | Fix | Where |
| --- | --- | --- |
| **B1** (P1) the click that ends a spotlight reached the tool | The press that ends a spotlight or the fly-in is consumed on the window's capture phase (`preventDefault` + `stopImmediatePropagation`; the listeners are no longer passive), so `ToolController`, `CameraController` and the HUD never get it. Its release, and the click that follows the release within 500 ms, go with it; the next gesture is the player's. Touch: the same (its `pointerdown`). | `ShowCamera.onPointerDown / onPointerUp`, the `click` listener |
| **B8** (P3) the key that skips a show did its normal job | A key that ends a show (Escape, Space, a hotkey, H) is consumed with its auto-repeats and its release (Space clicks a focused button on release). `CityScene` registers its own key listener after the show camera's, so the pause menu, the pause key or a tool never run for that press. Chords (Ctrl+S still saves), bare modifiers and keys typed into a text box end the show too but keep their job. The browser's and the system's own keys (a function key the game has no action on: F5, F11, F12; volume and media keys; Print Screen) are no input to the game: the show plays on and they pass. | `ShowCamera.onKeyDown`, the `keyup` listener, `bindings.isBoundCode` |
| **B2** (P2) a show ended early left the camera at the show | Whatever ends a show that is not a camera move puts the saved view back in the same event (a snap, the exact view): the skip press or key, the wheel over the HUD, the window losing focus, and every gate that closes mid-show with no input at all (LIVE, the pause menu, a dialog, photo mode, New Year, the setting, reduced motion, a hidden tab). Camera input takes the camera where it is and is not consumed: a camera key (live bindings; not in a chord or a form control, the controller's own rule), the wheel on the map, a middle or right press on the map. A bare pointer move no longer ends a show (see Choices). An element's blur is no longer taken for the window's (the capture listener saw both). | `ShowCamera` listeners and `cancel(restore)`; `FirstCameraMoments.frame / stop(restore)`; `CityScene.onKey` (photo entry restores a running show) |
| **B3** (P2, regression against dev) the New Year camera ended on a mouse move, a HUD click or Escape | New Year begins its session with `cameraOnly` rules, dev's `listenForUser` exactly: a press, a wheel step or a touch on the renderer's canvas, or a camera key, hands the camera over where it is; nothing is consumed; pointer moves, releases, HUD presses, Escape, other keys and blur do nothing (Escape opens the pause menu and the show runs on, as on dev). A New Year session also begins while a key or a HUD pointer is held, as on dev (its own `pointerHeld` on the canvas is unchanged). The lane's own "New Year camera switched off mid-show" now restores the view instead of leaving the camera at the skyline. | `NewYear.camStart`, `NewYear.updateCamera` (two hook lines); `ShowRules.cameraOnly` |
| **B4** (P2) the fly-in was over before the city was on screen | `FoundingFlyIn` holds: built in `placeInitialCamera`, it puts the camera at 3× at once (the first frame behind the fading loading screen is the high view, never the landing) and waits without a session. `CityScene.reportLoadTime` releases it; the next frame begins the session, shows the title card and starts the 2.5 s. The loop's camera step is clamped to 0.1 s (a stalled frame is not skipped through). A page without the app (the demo page) starts it after 1.5 s of frames. Input under the loading screen is not a skip, and what it moved is put back; a key or button held at the release, or a menu / dialog / photo mode open then, lands at once; so does a lost graphics context (the rebuilt view opens on the landing, not on the held high view). The chime rules are main.ts' own, unchanged: one chime at the landing or the skip, silence on exit / replacement before it, at once for saved, legacy and placeholder entries, `regionEnter` as before. | `cameraStart.ts FoundingFlyIn` (`hold`, `release()`, `FLY_HOLD_MAX_S`, `busy`), `CityScene.placeInitialCamera / reportLoadTime / loop` |
| **B5** (P2) Resume on the photo bar gave Normal, or nothing | Pause remembers the speed it stops; Resume is `host.setSpeed(thatSpeed, 'keyboard')`, never `host.resume()` (that answers the pause menu's own pause). Entered on a paused game, Resume starts the scene's last running speed, else Normal. The button's label follows `host.speed` every frame. SimCore is not edited. | `PhotoBar.enter / frame` |
| **B6** (P2) the picture kept tool decorations | Entering draws the plain city at the renderers: the Query hover box and the inspector's selection box off, the build grid off, the data view off (a tool's automatic one too; `world.setOverlay`, `objects.setOverlayMode`), the subway view off. The HUD's own state (`ctx.overlay`, the selected tool) is untouched; leaving draws each again from it (`ctx.setOverlay(ctx.overlay, ctx.overlayVariant)`, the grid by the setting and the tool, the subway view with the subway tool, the inspector's building), and `tools.refresh()` brings the tool's own hover back with its next move. The neighbour-city labels fade with the HUD (a CSS sibling rule: main.ts mounts them beside the scene). | `PhotoBar.plain`, `QueryTool.clearHover`, `fx.css` |
| **B7** (P2) the conflict line and Apply were below the fold | The status line, Reset and Apply are a footer of the panel's shell (`.panel-foot`), outside the scrolling list. Both rows of a conflict are marked: a red key box, `aria-invalid`, and "Same key as De-zone" under the action's name. The footer lists two conflicts and counts the rest, and shows "N changes not applied yet." Closing with unapplied changes no longer drops them: see Choices. | `KeyBindingsPanel` |
| **B9** (P3) a click on the photo bar closed an open flyout | While photo mode is on, a `pointerdown` inside the scene stops at the scene: the toolbar's and the RCI popover's document-level "click outside" listeners do not see it (the bar, and right / middle drags on the map). | `PhotoBar.enter` |
| **B10** (P3) the spotlight queue | The idle rule also asks for 4 s since the last show ended (any show: a spotlight, the New Year camera, the fly-in). A first that arrives while Camera moments is off or motion is reduced is not kept, and switching the setting off empties the queue (see Choices). | `ShowCamera.idle / lastEnd`, `FirstCameraMoments` |
| **B11** (P3) hints outside Help kept the default keys | The toolbar's key badges, the flyout's "Hotkeys", the cards' key chips, the tool tips ("Hotkey X", "J rotates while placing"), the chip's rotate hint and the pause menu's Save / Help keys show the bound key, follow a rebinding at once and go when an action has no key. The top bar's titles are the cloud's file: see Requests. | `Toolbar.ts`, `Modals.ts PauseMenu`, `toolCatalog.hotkeyLabel`, `bindings.keyHint / titleWithKey` |
| **B12** (P3) keys the table did not know | `[`, `]`, Enter and numpad Enter are reserved (the brush size, the dialogs' answer): the key box refuses them with the reason, a stored one is "reserved or unsupported". The scene uses a stored table only through `sanitizeBindings`: unknown actions, reserved / unsupported codes and entries in conflict with another action fall back to their defaults (`photo: "Escape"` no longer binds). Ctrl / Cmd + S and F1 stay prevented wherever Save and Help are bound, also in photo mode. | `bindings.validBindingCode / sanitizeBindings`, `CityScene` constructor and `keepFromBrowser` |
| **B13** (P3) capture at the 4096 cap, no "capturing" state | The click shows "Capturing…" and locks the button; the capture runs after the next painted frame (an animation frame, then a task). The PNG is handed to the browser as a `blob:` link instead of a multi-megabyte `data:` link (the `data:` link stays as the fallback). The render and its readback are still one synchronous call: see Requests. | `PhotoBar` capture handler, `capture()`, `pngBlob` |
| **B14** (P3) cosmetics | The photo bar is centred between both edges (`left: 50%` halved the width it may take: it wrapped below 1,270 px). The title card is as wide as its text and above the top-left HUD column (z-index 52). The fly-in lands on the exact start view (1,126.4 m), and saves its rounded copy. A spotlight, and the fly-in in flight, hold the tools' hover (the tip goes at the start, the tools read the pointer again at the end). The editor's intro says what Clear does to an action's alternative keys. A year's burst, and a fireworks-only show, now play in photo mode (see "Not fixed"). | `fx.css`, `cameraStart.ts`, `CityScene.loop`, `FirstCameraMoments`, `KeyBindingsPanel` |

### Files

| File | Change |
| --- | --- |
| `src/game/ShowCamera.ts` | `ShowRules` per session (`cameraOnly`, `canvas`, `cameraKey`, `gameKey`); capture listeners that consume the ending press / key with its release, repeats and click; restore on every non-camera end; the window's own blur only; `idle` waits 4 s after a show; `readView` exported; the Command key's release clears the held keys (see "One fix beyond qa.md"). `FirstCameraMoments`: gates restore, unwanted firsts dropped, `playing`, the tip and the tools' hover around a show. |
| `src/game/NewYear.ts` | Two hook lines in `camStart` / `updateCamera` (B3). Pacing, clock, calendar, fireworks and batch detection untouched. |
| `src/game/cameraStart.ts` | `FoundingFlyIn`: `FlyInOptions` (`rules`, `hold`, `inPlace`, `busy`), `release()`, `land()`, the hold with its 1.5 s fallback, strict ownership of its session, the exact landing, the title card's place. |
| `src/game/CityScene.ts` (shared; small hunks) | Constructor: `sanitizeBindings`, the photo bar's hooks, the key panel kept in a field. `placeInitialCamera`: the fly-in's options. `loop`: the tools' hover held during a flight, the photo / New Year condition, the clamped camera step. `reportLoadTime`: releases the fly-in. `onContextLost`: lands a fly-in that is still held (one line). `onKey`: photo entry, `keepFromBrowser` (new method). `exitToRegion`: `keyPanel.leave()`. |
| `src/ui/PhotoBar.ts`, `src/ui/fx.css` | B5, B6, B9, B13, the Blob link, `PhotoHooks`; the neighbour labels and the bar's centring. |
| `src/game/bindings.ts`, `src/game/toolCatalog.ts` | Reserved keys, `keyHint`, `titleWithKey`, `isBoundCode`, `changedBindings`, `sanitizeBindings`; `hotkeyLabel` (the cycle table is now one constant used by both). |
| `src/ui/panels/KeyBindingsPanel.ts` | The footer, the marked rows, the count of unapplied changes, closing, `leave()`. |
| `src/ui/panels/SettingsPanel.ts` | The Camera moments row's text only: "a key, a click or the wheel returns control" (it said "any input"). |
| `src/ui/Toolbar.ts` **outside the lane's named files** (the QA brief names it) | B11 only: the badges (`syncKeys`), the flyout head, the cards' keys, the tips, the chip's rotate hint. `specTipFooter` takes the bindings as an optional second argument. |
| `src/ui/Modals.ts` **outside named files** | B11 only: the pause menu's Save and Help keys. |
| `src/game/tools/QueryTool.ts` **outside named files** | B6 only: `clearHover()` (new method; `leave()` is as it was). |
| Tests | `showCamera`, `foundingCamera`, `photoMode`, `keyBindings`, `keyBindingsIntegration` extended; `cityReady` unchanged. No other test file changed. |

Not edited: `src/main.ts`, `src/game/settings.ts`, `src/worker/**` (SimCore), `src/ui/TopBar.ts`, `ToolController.ts`, `NeighborLabels.ts`, any renderer file, `src/sim/**`.

### Choices

- **B2, the mouse-move rule: a bare pointer move does not end a spotlight (or the fly-in).** FEEL-07 (`docs/POLISH_PLAN.md`) says "Any input ends it" and, under Acceptance, "Input returns control within a frame"; it names no pointer move. Every input that carries a command does that, inside its own event: a key, a click, a wheel step, a drag, a touch. A pointer move carries none. Ending on it made the show unwatchable with a hand resting on a mouse, it is what stranded the view in B2 and B3, and under B4 it would skip the founding fly-in for every player whose hand is still on the mouse after "Found City". A pointer move still counts as activity for the idle rule: no show starts within 4 s of one. This changes QA's A2 cases "mouse move in the approach / orbit / return": the show now plays on.
- **The first key press or click during a spotlight or the fly-in only ends it** (B1 / B8 as briefed), HUD clicks included: a click on a HUD button during a show ends the show and the button does not act; the second click does. Camera input is the exception (it takes the camera, unconsumed), and so are chords, bare modifiers and text-box keys (they end the show at the saved view and keep their job). If HUD clicks should pass through instead, it is one branch in `ShowCamera.onPointerDown`.
- **Restore is a snap**, not a 0.3 s glide: the exact saved view in the same event, nothing still moving after the input.
- **B3: dev's rule for New Year, to the letter**, Escape included (it is not a camera cancel on dev).
- **B4: the hold ends at the load report, with a 1.5 s fallback** counted in clamped frame time, so it cannot fire before the app's own call (480 ms of timer after the first frame). The clamp (0.1 s a frame) applies to the spotlight as well: below 10 fps both shows run slower than real time, like every other animation on the loop's step.
- **B7: closing keeps a draft that can be applied** (it is applied, with the toast "Your 2 key changes are saved for this profile."). Only a draft with a conflict asks: "Discard key changes?" with "Keep editing" as the dialog's cancel, so Escape, also a held one, goes back to the editor with the draft. "Save & exit" keeps an appliable draft and drops one in conflict without the question (nothing waits for its answer there). The cost of keeping: whatever the draft holds is applied on closing, a "Reset defaults" clicked by mistake included; the footer's count before and the toast after are what tell the player. A question on every close with changes is the alternative, at one more click each time.
- **B10: drop, do not keep, while the player has the moments off.** The plan gates the spotlight on the setting and on motion; a first that happens then is not owed later (switching the setting on played an 8 s old first). Firsts that only have to wait (LIVE, New Year, a menu, the player busy) stay queued, as the plan's "when it may play" implies. The gap between two shows is the plan's own 4 s.
- **B12: the stored table is validated where it is used** (the scene), not in `settings.ts`: its schema test round-trips unknown ids (`'zone:1'`) and `bulldoze: 'KeyX'` through `loadSettings`, and the rules say existing tests stay green. The raw table stays in storage until the next settings save writes the clean one.
- **B13: the Blob link** is beyond the brief's wording; QA's own numbers put most of the 4096 px time after "Captured" into the download of a `data:` link (0.9–1.2 s), which a `blob:` link does not have. Timing is the lead's.

### One fix beyond qa.md

- **macOS: a key pressed with Command stayed "held" for good.** macOS delivers no `keyup` for a key that is released while Command is down, so after one Cmd+S the show camera's set of held keys kept "S": the idle rule never passed again, and no spotlight began until the window had lost focus once (round 1 has the same set; under B3 the New Year show no longer asks it). The Command key's own release now clears the set; a key that is really still down repeats and counts again. One line in `ShowCamera`'s `keyup` listener, with a test. Found by reading, not by QA: the QA machine is Windows, so this one needs a Mac to confirm.

### Not fixed, with the reason

- **B11, the top bar's titles** ("Pause (Space)", "Budget (M)", "Help & shortcuts (F1)" …): `src/ui/TopBar.ts` is the cloud's. Request below.
- **B14, a full cinematic New Year show inside photo mode** still ends (it takes the clock and the camera the photographer holds). The year's burst and a fireworks-only show now play. Turning the cinematic one into fireworks at the photographer's hour needs a `celebrate` path that neither takes the clock nor counts a second full show for FEEL-02a's pacing: `NewYear.celebrate`, outside the show hooks this lane may touch.
- **B6, two tools' own markers stay in the picture**: the Dispatch tool's incident / station cells (it repaints them only when its options change, so clearing them would lose them after leaving) and a Disaster tool's target cell. Neither tool has a `leave()` that clears them.
- **B13, the capture itself** is still one synchronous call (`WorldView.capture`: render, readback, flip, `toDataURL`). Request below.

### Requests

- **Cloud, `src/ui/TopBar.ts` (B11).** Build the titles with `titleWithKey(label, actionId, ctx.settings.keyBindings)` from `src/game/bindings.ts` (added here: "Budget (M)", or "Budget" while the action has no key) and set them again on `ctx.ui.on('settings', …)`, as `Toolbar.syncKeys` does: `buildLeft` `speeds` (`pause`, `speed1`, `speed2`, `speed3`), `buildCenter` `funds` (`budget`), `pop` (`stats`), `apprSeg` (`advisors`), `buildRight` `btns` (`budget`, `graphs`, `stats`, `demographics`, `advisors`, `ordinances`) and `help` (`help`). "City menu (Esc)" and "Menu (Esc)" stay: Escape is not rebindable.
- **Render owner, `src/render/world/WorldView.ts::capture` (B13).** An asynchronous variant for the photo (`canvas.toBlob`, or `OffscreenCanvas.convertToBlob`), so the PNG encoding of a 4096 px picture leaves the main thread; together with the `try / finally` request above.
- **Sim owner, FEEL-07's persistent firsts:** unchanged, as written under "FEEL-07" above.

### Tests

`npx tsc --noEmit` and `git diff --check` pass. Each file ran in its own process through the quiet gate (`node quietrun.mjs npx vitest run <file> --maxWorkers=1 --reporter=verbose`, the default pool: no sandbox here), on the final tree. Counts: `scratchpad/lanes/T075/scratch/qa2/gates.json`; every test by name with its result: `scratchpad/lanes/T075/scratch/qa2/out/<file>.log`.

| Test file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `tests/game/showCamera.test.ts` | 82 | 0 | 0 |
| `tests/game/foundingCamera.test.ts` | 21 | 0 | 0 |
| `tests/game/photoMode.test.ts` | 31 | 0 | 0 |
| `tests/game/keyBindings.test.ts` | 23 | 0 | 0 |
| `tests/game/keyBindingsIntegration.test.ts` | 17 | 0 | 0 |
| `tests/game/cityReady.test.ts` | 12 | 0 | 0 |
| `tests/game/newyear.test.ts` | 11 | 0 | 0 |
| `tests/game/newYearPacing.test.ts` | 19 | 0 | 0 |
| `tests/game/pacingProbe.test.ts` | 0 | 0 | 4 |
| `tests/game/rankFireworks.test.ts` | 14 | 0 | 0 |
| `tests/game/uiCardTip.test.ts` | 2 | 0 | 0 |
| `tests/game/budgetPreview.test.ts` | 10 | 0 | 0 |
| `tests/game/upkeepReads.test.ts` | 21 | 0 | 0 |
| `tests/game/thumbsPendingRetention.test.ts` | 2 | 0 | 0 |
| `tests/game/ruinState.test.ts` | 2 | 0 | 0 |
| `tests/game/uiRuins.test.ts` | 11 | 0 | 0 |
| `tests/game/cityDisposeCanvas.test.ts` | 2 | 0 | 0 |
| `tests/game/queryReads.test.ts` | 18 | 0 | 0 |
| `tests/game/uiCutSettle.test.ts` | 4 | 0 | 0 |
| `tests/game/uiNetworkCutSettle.test.ts` | 4 | 0 | 0 |
| `tests/game/cameraControls.test.ts` | 65 | 0 | 0 |
| `tests/game/cameraStart.test.ts` | 3 | 0 | 0 |
| `tests/render/ringEdge.test.ts` | 9 | 0 | 0 |
| `tests/game/pendingTools.test.ts` | 6 | 0 | 0 |
| `tests/game/graphicsRestore.test.ts` | 10 | 0 | 0 |
| `tests/game/graphicsFirstRun.test.ts` | 21 | 0 | 0 |
| `tests/game/citySaves.test.ts` | 7 | 0 | 0 |
| `tests/game/quakeShakePlop.test.ts` | 3 | 0 | 0 |
| `tests/game/toastBudget.test.ts` | 10 | 0 | 0 |
| `tests/audio/ambience.test.ts` | 12 | 0 | 0 |
| `tests/game/settingsSchema.test.ts` | 19 | 0 | 0 |
| `tests/game/playLoadTime.test.ts` | 1 | 0 | 0 |
| `tests/game/panelsLayout.test.ts` | 12 | 0 | 0 |
| `tests/game/toolsPreview.test.ts` | 10 | 0 | 0 |
| `tests/game/pendingHover.test.ts` | 4 | 0 | 0 |
| `tests/worker/hygiene.test.ts` | 18 | 0 | 0 |
| **36 files** | **516** | **0** | **4** |

The four skips are `pacingProbe`'s (`PACING_SAVE` unset), as in round 1. In the pass over all 36 files the hygiene file's W0.2 scan ("speed writers live only in src/worker or src/sim") once ran past its 5 s limit (8 s; the file took 370 s in that pass against 15–21 s otherwise, while other lanes' processes held the machine); run again alone it passed 18 of 18, and the table has that run. The lines this round adds contain no `.speed =`, `getSystem(` or `emergencyOf(`. Every test named below was checked against the verbose logs of this pass (`check-names.mjs`: 80 names, all passing).

New or changed tests, by name (all pass):

- `tests/game/showCamera.test.ts`
  - "%s takes the camera where it is, and the camera gets the event" (4: a camera key, the wheel on the map, a right press on the map, a middle press on the map)
  - "%s ends the show at the saved view and does nothing else" (6: Escape, a hotkey, Space, a left press on the map, a press on the HUD, a right press on the HUD)
  - "%s ends the show at the saved view and keeps its own job" (8: a chord, a camera key in a chord, a bare modifier, a key typed into a text box, a camera key typed into a text box, the wheel over the HUD, a touch, the window losing focus)
  - "%s is the browser's or the system's key: the show plays on, the key passes and is not counted as held" (6: F5, F11, F12, AudioVolumeUp, MediaPlayPause, PrintScreen)
  - "a function key the game has an action on (F1, Help) skips like any other key"
  - "a camera key pressed on a slider moves no camera (the controller ignores it there): the view comes back"
  - "the key that ends a show takes its repeats and its release with it (QA B8)"
  - "another key going down, or the window losing focus, ends the wait for a swallowed release"
  - "%s does not end a show, and counts as activity only" (7: pointermove, pointerup, pointercancel, keyup, touchend, touchcancel, click)
  - "the press that ends a show takes its release and its click with it, and nothing after them (QA B1)"
  - "an element losing focus is not the window losing it: the show plays on, and a swallowed press stays swallowed"
  - "a click that comes late, after a cancelled press or after a new press is not swallowed"
  - "New Year rules: %s leaves the show running and passes untouched" (9: a pointer move, a press on the HUD, a release, Escape, a hotkey, a key release, the wheel over the HUD, a touch on the HUD, the window losing focus)
  - "New Year rules: %s hands the camera over where it is, and the event goes on" (6: a press on the map, a right press on the map, the wheel on the map, a touch on the map, a camera key, a camera key in a chord)
  - "New Year rules: the show begins although a key or a pointer on the HUD is held, as in the base game"
  - "the Command key going up ends the keys pressed with it: macOS sends those no release, and Cmd+S blocked every later show"
  - "is idle again only four seconds after a show ended (QA B10)"
  - "while %s forbids travel no show starts, and one that is running gives the player's view back" (5: setting, motion, live, busy, hidden; it replaces the round-1 test that expected the camera to stay)
  - "Escape ends the spotlight at the player's view within the event, and the next first waits for idle" (changed: the view comes back, the key is consumed)
  - "a bare pointer move does not end a spotlight; a camera key hands the camera over where it is (QA B2)"
  - "a click on the map during a spotlight never reaches the tool (QA B1)"
  - "holds the hover while it plays: the tip goes at the start, and the tools read the pointer again at the end (QA B14)"
  - "leaves four seconds between two queued firsts (QA B10)"
  - "switching Camera moments off drops what was waiting: switching it on plays no old first (QA B10)"
  - "the New Year show keeps the base game's pointer rule: only input on the city hands the camera over" (a real `NewYearCelebration` on the shared camera: a pointer move, a HUD press, a release, Escape, M and blur leave it running; a press on the canvas hands the camera over, unconsumed)
  - "switching the New Year camera off mid-show gives the player's view back"
  - (removed: "%s returns control synchronously without moving back against the player", 11 cases: it asserted B2's stranding for every event type)
- `tests/game/foundingCamera.test.ts`
  - "held: the high view and no session until release(); then the full 2.5 s, the title card and one landing"
  - "input under the loading screen is not a skip, and what it moved is put back at the release"
  - "a page without the app (nobody releases it) starts by itself after 1.5 s of frames"
  - "a pointer or key held at the release lands at once (the player is already at the controls)"
  - "a menu, a dialog or photo mode opened under the loading screen: the camera lands at the release, without the travel"
  - "another show that has the camera when the travel would start, or takes it in flight, keeps it"
  - "land() puts a held or a flying camera on the landing at once, with its one landing"
  - "a lost graphics context lands a fly-in that is still held, before the scene stores the camera for the rebuilt view" (`CityScene.prototype.onContextLost`)
  - "inPlace: lands on the exact view the camera had, and saves its rounded copy (QA B14: 1,126 m for 1,126.4 m)"
  - "a bare pointer move does not; a click on the map does, and the tool never gets it"
  - "Escape and Space skip without reaching the game (no pause menu, no unpause); W lands and pans from there"
  - "a 2.5 s first render and the 480 ms fade leave it at 3×; the load report starts it; it lands 2.5 to 3 s later" (the scene's shipped rAF callback, a real `CameraController` and fly-in, `CityScene.prototype.reportLoadTime`)
  - "a stalled frame moves the fly-in by a tenth of a second at most"
  - "ends a celebration that holds the clock, and lets fireworks alone (a year's burst) play" (the same rAF callback in photo mode, QA B14)
- `tests/game/photoMode.test.ts`
  - "Resume returns to the speed the bar paused from (%i), through setSpeed and never host.resume" (3: Normal, Fast, Ultra; it replaces "pauses and resumes through the host")
  - "entered on a paused game, Resume starts the scene's last running speed (Normal when it knows none)"
  - "the button follows the speed when it changes under the bar (an emergency pause, a late acknowledgement)"
  - "keeps every press in photo mode below the document, and lets them through again after leaving"
  - "captures %s×%s at %s×%s with the player view and a city/date filename" (3; changed: the PNG's bytes behind a `blob:` link)
  - "falls back to the data: link where Blob links are not available"
  - "says "Capturing…" and locks the button before the capture starts, then reports it"
  - "a capture still waiting for its frame does not run after leaving"
  - "the grid, the data view and the selection box leave the renderers on entering, and come back from the HUD's state"
  - "with no data view, no inspector and no tool nothing is switched on when leaving"
  - "the grid stays off for a player who switched it off, and the subway view comes back with the subway tool"
  - "a renderer without one of the calls (a stand-in view) does not stop photo mode"
  - "the Query tool drops its hover box for the photo and applies its pick again with the next move" (the real `QueryTool`)
  - "turns the capture's data: link into the same bytes as a PNG blob"
- `tests/game/keyBindings.test.ts`
  - "reserves Enter and the brush keys with Escape, Tab and the modifiers"
  - "a stored table is used only as far as the model allows it"
  - "gives badges and titles the live key, and none for an action without one (QA B11)"
  - "knows which keys carry an action in this profile, alternatives included"
  - "names the actions a draft changes against the applied table"
  - "keeps the conflict line, Reset and Apply in a footer outside the scrolling list"
  - "marks both rows of a conflict, and clears the marks when it is resolved"
  - "lists two conflicts in the footer and counts the rest"
  - "refuses Enter and the brush keys in a key box, with the reason"
  - "closing with changes that can be applied keeps them, and says so"
  - "closing an untouched or an applied panel does nothing"
  - "closing with a conflict asks: "Keep editing" (also Escape, the cancel of the dialog) reopens the editor with the draft" (the real `confirmDialog`)
  - ""Discard" drops the draft: nothing is applied, and the next open shows the applied keys"
  - "leaving the city: a draft in conflict goes without its question, one that can be applied is kept by the close"
  - "a city that is gone asks and applies nothing"
- `tests/game/keyBindingsIntegration.test.ts`
  - "entering photo mode ends a celebration that holds the clock, and leaves fireworks alone (QA B14)"
  - "keeps Ctrl+S and F1 from the browser wherever Save and Help are bound"
  - "leaves F1 to the camera when a camera action is bound to it, and keeps Ctrl+S out of the browser in photo mode"
  - "the scene uses a stored table only as far as the binding model allows it (QA B12)"
  - "Escape during a show ends it at the player's view and opens no pause menu; the next Escape does" (the real `ShowCamera` and `CityScene.prototype.onKey` on one window, registered in the scene's order)
  - "Space, a tool key and H only end the show; Ctrl+S still saves"
  - "CityScene registers its key listener after the show camera's (capture listeners run in that order)"
  - "a catalog hotkey shows the key its action is on now"
  - "a tool card's tip names the bound hotkey and the bound rotate key"
  - "the toolbar badges show the bound keys, follow a rebinding and go when an action has no key" (the real `Toolbar`)
  - "the pause menu shows the bound Save and Help keys" (the real `PauseMenu`)
  - (changed: "routes rebound pause, speed, save, help and photo actions through the existing paths" also expects a running show restored on photo entry)

Mutation check (`scratchpad/lanes/T075/scratch/qa2/mutate.mjs`, its log `mutate3.log`): 37 single edits to the sources, one at a time on the final tree, each with its test file run through the quiet gate, the source put back and the hashes of all 18 changed source and test files compared afterwards (unchanged). All 37 were caught by at least one failing test: the press not consumed; the click after it not swallowed; a skip not restoring; a gate not restoring; a pointer move ending a show; an element's blur counted as the window's; the release of a swallowed key passing; a camera key on a slider keeping the camera at the show; New Year ending on a HUD press, taking the default rules, or waiting for held keys like the other shows; Escape not consumed; no gap after a show; firsts kept while the setting is off; the camera step not clamped; the load report not releasing the fly-in; the scene not holding the fly-in; a busy player still getting the travel; the fly-in landing over another show; the hover not held in flight; Resume through `host.resume`; the data view staying in the picture; the hover box not coming back exactly; the inspector's box not put back; presses reaching the document; no "Capturing" state; the footer staying in the scroller; closing dropping the draft; a conflict draft applied on close; brackets bindable; Ctrl+S falling through when rebound; the scene using the stored table as it comes; the toolbar badge keeping the default key; the Command key's release leaving its keys held; a lost context leaving a held fly-in at the high view; the browser's own keys ending a show; the fly-in starting under another show.

### The bot

Through the quiet gate, on the final sources (it started after the round's last source edit; `SIMBOT_LOG=1` in the environment), exit 0, "done in 25.3s":

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
residents [ 61124, 93804, 37971 ] jobs 0,0,0,7724,9346,3943,26668,15990,100,10864,10174,0 caps 334132,277911,138748,66369,65869,35465,117716,83790,6004,31276,41537,28722
```

61,124 + 93,804 + 37,971 = **192,899**, the baseline. (Expected: no file under `src/sim/**` or `src/worker/**` changed.) Its full output: `scratchpad/lanes/T075/scratch/qa2/bot.log`.

### Not verified here (no browser, no GPU)

- Everything that depends on the real DOM's event order: that a press consumed on the window's capture phase reaches no canvas listener (the unit tests show `preventDefault` and `stopImmediatePropagation` on it, and the swallowed release and click); focus after a prevented `pointerdown`; a touch's late click; Space on a focused HUD button.
- The CSS: the key panel's footer at 1280×720, the photo bar in one row, the neighbour labels' sibling rule, the title card's place.
- The fly-in on a cold browser, and the capture's time at the 4096 px cap with the Blob link (both are timing lines of the lead's script).
- A HUD click that ends a show is swallowed, but the app's generic click sound may still play for it: `installUiSounds` is installed by main.ts before any scene, so its capture listener runs before the show camera's.
- With a brush tool active, `=` and `-` are the brush size, not the zoom: pressed during a spotlight they count as camera keys (the camera is left where it is) although the tool takes them.
- The Command-key fix (no Mac here): that a spotlight still begins after a Cmd+S, four idle seconds later.

### Browser recheck (short)

- [ ] B1 / B8: bulldozer selected, a spotlight playing (and the fly-in): a click on the map demolishes nothing and the view is back; the second click works. Escape ends a show and opens no pause menu; Space does not unpause a new city during the fly-in.
- [ ] B2: LIVE beginning mid-spotlight returns the view with no input. A mouse move leaves the show playing. W, the wheel and a right drag on the map take the camera where it is. H ends the show; the second H opens photo mode at the player's view.
- [ ] B3: the six rows of qa.md's New Year table match the base (mouse move, Budget click, Escape, M: show runs, view back; W, wheel, map click: camera handed over).
- [ ] B4: first city of a cold browser: the fly-in is on screen from 3× for 2.5–3 s after the loading screen is gone, with the title card; one chime at the landing; a click skips with one chime; a saved city chimes as the loading screen goes.
- [ ] B5: Fast, Pause, Resume gives Fast (three hosts); also after the pause menu was opened on a paused game.
- [ ] B6: no hover box in the PNG; the grid, the tool's overlay, a data view and the neighbour labels are gone in photo mode and back exactly after H, Exit and Escape.
- [ ] B7: at 1280×720 the conflict line and Apply are on screen; both X rows are red; closing with a clean draft applies it with a toast; closing with a conflict asks.
- [ ] B9 / B13 / B14: a click on the bar keeps an open flyout; "Capturing…" shows before a 4096 px capture; the bar is one row at 1280 px; the title card is clear of the Getting started card; the fly-in lands at 1,126.4 m; a year's burst plays in photo mode.
- [ ] B10: two queued firsts are at least 4 s apart; switching Camera moments on plays no old first.
- [ ] B11 / B12: toolbar badges, tips and the pause menu follow a rebinding (the top bar's titles wait for the cloud); `[`, `]` and Enter are refused; Ctrl+S and F1 open nothing of the browser's after Save and Help were rebound; a stored `photo: "Escape"` does nothing.
