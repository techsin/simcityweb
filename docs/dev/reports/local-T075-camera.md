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
