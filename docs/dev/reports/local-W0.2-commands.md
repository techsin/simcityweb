# local-W0.2-commands: commands, cause tags and gestures (T020)

Branch `local/W0.2-commands`, base `3a0a2ab`.

## Review and gates (the local worker)

**The liveSlowdown scope question is settled (NOTE-019, option a).**
- S1's liveSlowdown-writer rule stays skipped in W0.2, renamed "W0.4: …".
- EmergencyBanner's two liveSlowdown writes move with LivePolicy in W0.4, and W0.4's checklist gets them.
- Its speed writes (the policy's slow-down, pause and restore) already go through `host.setSpeed`, so the W0.2 speed
  rule is on and passes.

**Fixed in review** (Codex could not run vitest in its sandbox, so none of its tests had run):
- **`tests/game/dispatchCommands.test.ts`:** both cases failed. A major medical call needs 2 ambulances and the test's
  clinic has 1, so the tool correctly stayed on the call.
  - The town now has two one-ambulance test clinics.
  - The first case: the tool stays on the call after its own first dispatch, then finishes exactly once after the
    second.
  - The second case: another issuer's `dispatchBest` covers the call, and the tool moves on at once.
- **`tests/worker/hygiene.test.ts`:** the speed rule matched `.speed` writes by name, so it flagged VehicleRenderer's
  per-vehicle `tr.speed`. That one write is now exempt, and the exemption must keep matching exactly one write.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **135 files passed, 1 skipped; 1,175 tests passed, 11 skipped, 0 failed**; no unhandled errors |
| Hygiene | W0.2 speed rule on and passing; W0.4 liveSlowdown rule skipped (NOTE-019); later rules skipped |
| 128 × 15 seed-7 bot | identical to `bd93687` (every non-timing field, 15 years); **194,432** in 2015 |
| Old saves load and continue | 6 of 6, every number identical to `bd93687` |
| Browser QA (every op once) and the leak probe | **No W0.2 regression.** Every op and every speed writer worked in the real game. The leak probe passes, fresh and fresh `--hostile`, with 0/0 on every cycle. Two checklist items were NOT RUN, and some used declared fixtures (below) |

### Browser QA

A fresh sub-agent at maximum effort ran it.

**Setup:**
- Chromium 141.0.7390.37, headless, on the real GPU (ANGLE D3D11, RTX 5070 Ti), with the vite dev server on this tree.
- Real mouse and keyboard input at computed coordinates.
- Recorded: every `host.act` (op, args, tag, gesture, prediction), the sounds, the toasts, `speedChanged` with
  `host.cause`, the `emergency` events and the `tool` UI event.
- Cities:
  - `small_s7_y10`, imported through the UI: 128², 101,857 residents, disasters off;
  - two newly founded 64² cities: a medium one for onboarding, and a Sandbox + Disasters one for the disaster tool
    and the nuclear-free zone.

**Every W0.2 op: PASS.** For each, the preview, the funds change, the command's arguments and tag, the sounds and the
toasts matched.
- `zone` and `dezone`.
- `bulldoze`: the tool, Inspector Demolish, and the Clock Tower's confirm and cancel.
- `buildNetwork`: a road; an avenue with the Shift flip; Esc and chorded right-click cancels; the route-through-lots
  dialog, where nothing is sent before the confirmation.
- `buildPowerLine` and `buildSubway`.
- `plop`: twice in a row, a unique building, a blocked site, and a click without moving after the preview.
- `terraform`: four held modes, plus a wholly ineffective stroke (one error sound on release, no toast).
- `plantTrees`, `setTax` and `setFunding`.
- `setHistoric`, on and off, including after reopening.
- `setOrdinance`: the nuclear-free zone's dialog with the game running at ultra. The switch stays steady, Cancel
  restores it, and "Enact anyway" enacts it.
- `takeLoan`: a success, and a refusal of an offer gone stale through real play.
- `repayLoan`: one of two loans, a repay across a month boundary, and the stale-row guard.
- `setSpeed` (every UI writer) and `resume`.
- `dispatch` and `dispatchBest`, with fixture incidents.
- `triggerDisaster`.
- `setCamera`, including a renderer held back for 9 s.

**Speed writers and lifecycle: PASS.**
- The writers: initial, onboarding, keyboard, TopBar, the pause menu (Resume, Esc, backdrop, Settings, Help),
  visibility, error, exit and emergency (LIVE, urgent pause, completion, restore, industrial, burst).
- Brush gestures stop cleanly in every case: another button held, pointercancel (real touch), window blur, a tool
  switch, and a city switch with a confirmation open.
- After exit, the retained controls are silent, and the old host throws "Simulation host is disposed".

**Leaks and console:**
- `tools/leakprobe` on this tree, fresh and fresh `--hostile`, 3 cycles each: both PASS `[[0,0],[0,0],[0,0]]`.
- The `cityDisposeCanvas` and `cityTeardown` suites: 6/6.
- No console or page errors, apart from the 9 that the error-overlay fixture produced on purpose.

**Declared fixtures, synthetic events and host-path calls:**
- Incidents spawned with `EmergencySystem.spawn`: the imported city has disasters off and no uncovered incident on
  demand.
- The error overlay, through a forced failure of a guarded system.
- The stale-loan guard, by changing `monthsLeft`.
- `visibilitychange` and window blur, dispatched by script: headless Chromium never hides or blurs a page.
- The earthquake burst through `host.act('triggerDisaster')`, and the city switch with a confirmation open through
  `ctx.exitToRegion`.

**NOT RUN:**
- "Command reply pending": it cannot happen on `LocalSimHost`, where `done` is already resolved and the continuation
  runs in the same task. The unit tests cover it.
- The unreachable-station refusal. The busy-station refusal was tested.

**A pre-existing bug, not in the W0.2 diff:** from the second report of the same error key, the error card's repeat
counter reads "NaN×" (`local-W0.2/s4-speed-03-error-card.jpg`). `ErrorOverlay.report` parses "1×" with `Number(…)`
(`src/ui/Modals.ts:267`, identical on `3a0a2ab`).

**Two observations, the same on the base:**
- Exiting with a confirmation open plays `dialogClose` on the scene being disposed.
- Switching tools mid-stroke keeps the held button painting with the new brush, because `ToolController.select` leaves
  `leftDown` set.

More screenshots in `local-W0.2/`: the dispatch hover with the LIVE pill (`s6a-live-dispatch-02-dispatch-hover.jpg`)
and the nuclear-free-zone confirmation (`s7-sandbox-01-nfz-confirm.jpg`).

The original Codex report follows; its "not done" status is superseded by the section above.

## Changes by file

| File | Change |
|---|---|
| `src/worker/SimHost.ts` | Typed W0.2 commands/tickets, synchronous exact LocalSimHost predictions, scoped/nested cause tags, gestures and read-only preview entry point. The stable compatibility actions delegate mutations back through `act`. Initial speed uses the seam. |
| `src/worker/SimCore.ts` | Authoritative command switch; guarded loan repayment; idempotent historic sets; core-owned pre-pause speed and resume; dispatch, disaster and camera handlers. Existing simulation/action implementations are reused. |
| `src/game/CityScene.ts` | Error, keyboard, visibility and exit speed writes use the host; camera memory receives the host. |
| `src/ui/TopBar.ts` | Speed buttons call `host.setSpeed`. |
| `src/ui/Modals.ts` | Pause calls `host.setSpeed(0, 'pause')`; Resume calls `host.resume('pause')` instead of storing/restoring a UI speed. |
| `src/ui/Onboarding.ts` | Play calls `host.setSpeed(1, 'onboarding')`. |
| `src/game/cameraStart.ts` | CameraMemory stores via `act('setCamera')`; null/loading-view checks remain. |
| `src/game/tools/Tool.ts` | `Tool.commit` and the shared inspector helper deliver exact feedback immediately, provisional feedback on acknowledgement, and corrections/failures once per gesture. Late feedback checks `ctx.signal`. |
| `src/game/tools/ToolController.ts` | Begins/ends pointer gestures, including cancellation, blur, tool switches, canvas replacement and disposal. |
| `src/game/tools/ZoneTool.ts` | Zone/dezone/bulldoze commits use the shared helper; previews remain read-only. Confirmation continuation checks city disposal. |
| `src/game/tools/NetworkTool.ts` | Network/power/subway commits use the helper, retaining sound intensity and confirmation behavior. |
| `src/game/tools/PlopTool.ts` | Shared commit feedback; unique tools deselect on exact success or successful acknowledgement, without deselecting a newer tool. |
| `src/game/tools/BrushTool.ts` | Each application is a commit; soft sounds use predictions, stroke totals use acknowledgements, release waits for settlement. No per-application error toasts. |
| `src/game/tools/DispatchTool.ts` | Awaits tagged dispatch tickets. Its emergency listener checks `host.cause?.tag === this` instead of a synchronous `sending` flag. |
| `src/game/tools/DisasterTool.ts` | Predicts an empty fire site's refusal; otherwise awaits the host disaster command and preserves refusal feedback/tool selection. |
| `src/ui/EmergencyBanner.ts` | Speed changes use the host; Send nearest awaits `dispatchBest`. Equivalent pure-policy return avoids the hygiene scanner's property-name-only match on `out.speed`. Two slowdown assignments remain blocked. |
| `src/ui/panels/BudgetPanel.ts` | Tax/funding commands; loans await results, with buttons disabled during the request and repayment guards captured from the rendered row. W0.6 catch fallbacks remain. |
| `src/ui/panels/ListPanels.ts` | Ordinance commands/confirmation await results, keep the requested toggle pending across refreshes, then accept or roll back. |
| `src/ui/panels/InfoPanel.ts` | Explicit historic sets replace the toggle and raw-bit fallback. Demolition uses shared commit feedback and closes only after a successful acknowledgement for the same target. |
| `tests/worker/hygiene.test.ts` | Both named W0.2 writer rules switched from `it.skip` to `it`. Later-step rules remain skipped. |
| `tests/worker/commands.test.ts` | Command/action parity, preview purity, historic/ordinance behavior, loan guards, pause/resume, disasters and nested/throwing cause scopes. |
| `tests/game/toolCommands.test.ts` | Exact/provisional feedback, one correction per gesture, brush settlement/failure and post-disposal silence. |
| `tests/game/dispatchCommands.test.ts` | Real LocalSimHost/emergency integration: own tagged dispatch waits for feedback; another issuer's dispatch still advances the tool synchronously. |
| `tests/game/panelCommands.test.ts` | Deferred loan/ordinance outcomes, captured stale-row guard, pending toggle, rejected acknowledgement and abort handling. |
| `tests/game/cameraStart.test.ts` | Existing camera-memory regressions use LocalSimHost for stores. |
| `tests/game/quakeShakePlop.test.ts` | Existing stationary-preview placement regressions commit through LocalSimHost. |
| `tests/game/emergencyBanner.test.ts` | Existing policy/banner fixture supplies the host command surface; the immediate toast assertion now awaits dispatch feedback. |
| `tests/game/uiCutSettle.test.ts`, `tests/game/uiNetworkCutSettle.test.ts` | Confirmation fixtures include the city's signal. |
| `docs/dev/qa-W0.2-commands.md` | Manual checklist covering all 21 W0.2 operations, all speed writers, gestures, dispatch ownership and teardown. |

`src/sim/**`, `src/save/**`, `src/render/**`, `context.ts`, module wiring and settings were not edited. The guard
holder, `abort('dispose')`, null-view replacement and existing listener signals are intact. New asynchronous UI
continuations check the city's signal before feedback or further mutation.

## Mutation inventory

Line numbers on the left refer to **base `3a0a2ab`**, not the edited files. `Tool.commit` calls below all reach
`host.act(op, args, {gesture})`. Existing hover/risk checks continue to pass `true` to the read-only action path.

| Before | Host entry point now |
|---|---|
| `src/worker/SimHost.ts:56` initial `sim.speed` assignment | `setSpeed(initialSpeed, 'initial')` → `act('setSpeed', …)` |
| `src/game/CityScene.ts:169` ErrorOverlay pause | `host.setSpeed(0, 'error')` |
| `src/game/CityScene.ts:791` Space | `host.setSpeed(nextSpeed, 'keyboard')` |
| `src/game/CityScene.ts:798` 1/2/3 | `host.setSpeed(Number(k), 'keyboard')` |
| `src/game/CityScene.ts:837` hidden-tab pause | `host.setSpeed(0, 'visibility')` |
| `src/game/CityScene.ts:840` visible-tab restore | `host.setSpeed(hiddenPausedFrom, 'visibility')` |
| `src/game/CityScene.ts:875` exit pause | `host.setSpeed(0, 'exit')` |
| `src/ui/TopBar.ts:155` speed buttons | `host.setSpeed(s, 'topbar')` |
| `src/ui/Modals.ts:22` Pause | `host.setSpeed(0, 'pause')` |
| `src/ui/Modals.ts:67` Resume, formerly using `prevSpeed` from line 21 | `host.resume('pause')` → `act('resume', …)` |
| `src/ui/Onboarding.ts:127` Play | `host.setSpeed(1, 'onboarding')` |
| `src/game/tools/ZoneTool.ts:83`, mutation through `run(rect, false)` at line 260: zone | `Tool.commit('zone', [rect, zone], feedback)` |
| Same sites: dezone | `Tool.commit('dezone', [rect], feedback)` |
| Same sites: bulldoze | `Tool.commit('bulldoze', [rect], feedback)` |
| `src/game/tools/NetworkTool.ts:59`, mutation through `run(path, false)` at line 197: network | `Tool.commit('buildNetwork', [path, type], feedback)` |
| Same sites: power lines | `Tool.commit('buildPowerLine', [path], feedback)` |
| Same sites: subway | `Tool.commit('buildSubway', [path], feedback)` |
| `src/game/tools/PlopTool.ts:290` | `Tool.commit('plop', [defId, x, z, rot], feedback)` |
| `src/game/tools/BrushTool.ts:39`, mutation through `apply(p, false)` at line 87 | `Tool.commit('plantTrees', [rect], feedback)` |
| `src/game/tools/BrushTool.ts:42`, mutation through line 87 | `Tool.commit('terraform', [kind, cx, cz, radius, strength], feedback)` |
| `src/game/tools/DispatchTool.ts:332` | `await host.act('dispatch', [incidentId, stationId, n], {tag: this}).done` |
| `src/game/tools/DisasterTool.ts:39` | `await host.act('triggerDisaster', [kind, x, z]).done` |
| `src/ui/EmergencyBanner.ts:919` LIVE speed | `host.setSpeed(step.speed, 'emergency')` |
| `src/ui/EmergencyBanner.ts:971` Send nearest | `await host.act('dispatchBest', [id]).done` |
| `src/ui/panels/BudgetPanel.ts:165` | `host.act('setTax', [dev, value])` |
| `src/ui/panels/BudgetPanel.ts:224` | `host.act('setFunding', [service, value])` |
| `src/ui/panels/BudgetPanel.ts:320` | `await host.act('repayLoan', [index, {principal, monthsLeft}]).done` |
| `src/ui/panels/BudgetPanel.ts:359` | `await host.act('takeLoan', [amount]).done` |
| `src/ui/panels/ListPanels.ts:121` | `await host.act('setOrdinance', [id, enabled]).done` |
| `src/ui/panels/ListPanels.ts:137` confirmed enactment | `await host.act('setOrdinance', [id, true, {confirm: true}]).done` |
| `src/ui/panels/InfoPanel.ts:669` toggle and line 671 raw-bit fallback | `host.act('setHistoric', [buildingId, !historic])`; fallback removed |
| `src/ui/panels/InfoPanel.ts:691` demolition | `commitAction(ctx, panel, 'bulldoze', [rect], feedback)` → `host.act` |
| `src/game/cameraStart.ts:169`, called by `CityScene.ts:519` | `host.act('setCamera', [camera])` |

The stable actions compatibility wrapper additionally routes all non-preview calls through the matching host op,
including translating legacy `toggleHistoric` into `setHistoric` and capturing the current loan guard for legacy
`repayLoan`. Authoritative writes now occur in `SimCore.applyCommand` or the existing action implementation.

Not moved:

- `EmergencyBanner.ts:752` reset slowdown and `:920` policy slowdown (edited lines 751 and 919): the reported blocker.
- `BudgetPanel.ts:168` tax fallback and `:226` funding fallback: explicitly scheduled for deletion in W0.6's row.
- `EmergencyBanner.ts:161` was a pure result-object assignment, not a simulation mutation. It is now an equivalent
  object return so the existing broad speed-writer scanner can distinguish the permitted code without exemptions.

## Design/code differences and step boundaries

1. **LIVE slowdown ownership:** the blocker above. Adding a temporary `setLiveSlowdown` op or moving LivePolicy now
   would change the specified step. No unapproved substitute was introduced. Both hygiene rules are enabled, so
   this disagreement is visible as a failing gate rather than hidden with a skip or scanner exception.
2. **LIVE event timing:** the design describes policy running synchronously inside `uncovered`. Current
   EmergencyBanner deliberately queues a microtask/next-UI-tick flush (EM-1), after a disaster burst has assigned
   units. This timing is preserved. W0.4 needs to reconcile its wording with that tested behavior.
3. **Later commands and facade:** `dismissAlert`/`setSettings` need W0.4's policy ownership. Debug operations and the
   restricted `SimFacade` also belong to later steps. W0.1's real `Simulation` compatibility surface remains;
   this change does not claim to intercept external harness assignments to `scene.sim.speed`.
4. **Budget fallbacks:** W0.2's “every mutation” wording overlaps two explicitly retained W0.6 fallbacks. Their
   normal command paths moved, but their existing catch writes remain as the W0.6 row specifies.
5. **Local lifecycle:** the stable actions proxy and pre-boot FallbackActions remain for lazy loading. The new
   `LocalActions` wrapper is contained in SimHost, within the permitted files; no ActionsProxy/fallback file changed.
   Preview calls still work through `ctx.actions` with `preview=true`; `host.preview` is read-only as specified.

No change was made to simulation stepping, system order, RNG use, save codecs, renderer code or policy timing.
Local `predicted` is the actual synchronous result, `exact` is always true and `done` resolves that result.

## Verification and handoff

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed after the source and test changes. |
| `git diff --check` | Passed. |
| Restricted-directory diff | Empty for `src/sim`, `src/save`, `src/render`. |
| `npx vitest run tests/worker/localSimHost.test.ts --maxWorkers=1` | Could not start: Vite config `externalize-deps`, `spawn EPERM` in `windowsSafeRealPathSync`/`optimizeSafeRealPathSync`. No test ran. |
| `npx vitest run tests/worker/commands.test.ts --maxWorkers=1` | Same startup `spawn EPERM`; no test ran. |
| W0.2 speed hygiene | Enabled; source search finds only SimCore writers. Runtime AST test not executed. |
| W0.2 liveSlowdown hygiene | Enabled; known two EmergencyBanner violations, pending design direction. |
| Full suite, 128 × 15 seed-7 bot, old-save continuation, browser QA/teardown | Not run here; lead environment required. **194,432 in 2015 is the required baseline, not a verified result for this diff.** |

New test files (written and typechecked, not executed):

- `tests/worker/commands.test.ts`: `LocalSimHost commands` (map action/state/RNG parity; read-only previews;
  historic/ordinance validation; stale loan/month/index guards; pause/resume; disaster outcomes; nested cause cleanup).
- `tests/game/toolCommands.test.ts`: `Tool.commit and gestures` (immediate exact feedback, provisional recovery,
  once-per-gesture failure, mixed/failed brush strokes, post-disposal silence).
- `tests/game/dispatchCommands.test.ts`: `DispatchTool command causes` (own versus another issuer's dispatch).
- `tests/game/panelCommands.test.ts`: `panel commands` (rendered loan guard, deferred loan/ordinance replies, rejection/abort).

Run each with `npx vitest run <file> --maxWorkers=1`. Also run the affected existing suites:

- `tests/worker/hygiene.test.ts`, `tests/worker/localSimHost.test.ts`, `tests/worker/simCore.test.ts`.
- `tests/game/cameraStart.test.ts`, `tests/game/quakeShakePlop.test.ts`, `tests/game/toolsPreview.test.ts`.
- `tests/game/uiCutSettle.test.ts`, `tests/game/uiNetworkCutSettle.test.ts`.
- `tests/game/emergencyBanner.test.ts`, `tests/game/emergencyPolicy.test.ts`, `tests/game/dispatchBusy.test.ts`.
- `tests/game/cityDisposeCanvas.test.ts`, `tests/game/cityTeardown.test.ts`.

Manual script: [W0.2 command QA](../qa-W0.2-commands.md). Resolve the slowdown scope conflict, pass the hygiene
gates and run the lead's remaining verification before marking the step **DONE**.
