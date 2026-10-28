# local-W0.4-livepolicy: LivePolicy in SimCore (T020)

## Review and gates (the local worker)

**The policy's logic is unchanged.** I compared the new `src/game/emergencyPolicy.ts` with the base's EmergencyBanner:
- `speedPolicy`, `AlertQueue` and `followingDispatch` moved verbatim (text-identical).
- `sendDays`, `unbanneredPrompt`, `pendingCount` and `urgentSeconds` were private banner methods. They are now pure
  functions with the same logic, taking the incidents, alerts, dismissals and time as arguments.
  - `pendingCount` walks the incident list instead of the banner map, which counts the same for every live incident.
  - It returns `bad` instead of setting `episodeBad`; the caller ORs it in.
- The new episode check for a finished incident (`lost > 0 || deaths > 0`) is exactly the base's "`lossText` is not
  empty".
- EM-1's microtask flush is kept.
- The policy now ticks on every host frame instead of the UI's tick. `publish()` emits only when the alerts or the LIVE
  flag change, so the banner does not re-render per frame.

**Fixed in review.** W1.1a's `tests/worker/replicaLive.test.ts` failed on the grown fixture: its 120-day loop ended
about 115 days short of its tick cap.
- Cause: LivePolicy now runs in SimCore, so the test's fires and tornado put the sim into LIVE mode.
- Every packet was still exact.
- The suite checks the replica at a fixed cadence, so it now sets `emergencyUncovered: 'ignore'`, as the benches do.

**A note for W1.1b and W1.2:** W1.1a's protocol bench must set the same on any tree with W0.4. Its quiet-slot run
uses W1.1a's own tree, without W0.4.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full) | **150 files passed, 1 skipped; 1,537 tests passed, 10 skipped** |
| `tests/game/emergencyPolicy.test.ts` (unchanged) and the new same-day test | pass |
| Hygiene | the W0.4 liveSlowdown rule is on and passes; the "W0.3b" rule stays skipped (NOTE-028) |
| The pill (check 4's playtest minor) | the six new `uiStacking` cases pass: Demographics and Help at 1024x600, Help at 1280x720, each pill-only and with live banners |
| 128 × 15 seed-7 bot | **196,101** in 2015 |
| Old saves load and continue | 6 of 6, every number identical to `2ba03fa` |
| Browser QA (an uncovered fire at ultra, dismissals, settings, the pill at both sizes), the leak probe | **pending**: browser runs wait until T014's speed reviewer is done with the machine |

The original Codex report follows. Its "uncommitted" status is superseded by the section above.

Branch `local/W0.4-livepolicy`, base `2ba03fa`. Implementation complete, changes uncommitted. Runtime gates and manual
browser QA remain for the lead: Vitest cannot start in this sandbox. No claim of a green runtime suite or bot run.

## Changes by file

| File | Change |
|---|---|
| `src/game/emergencyPolicy.ts` (new) | Extracts the pure speed policy, state/types/constants, AlertQueue and primary-responder follow logic. Adds the extracted send-window, pending-count, unbannered-prompt and urgency calculations without DOM dependencies or system lookups. |
| `src/worker/SimCore.ts` | A separate W0.4 LivePolicy block owns selection, dismissed ids, burst queue, load/reset scan, episode state, both slowdown writes, speed changes and alert expiry. Attaches after systems/actions, ticks while paused too, and publishes plain snapshots. Handles `setSettings`/`dismissAlert`; dispatch commands re-evaluate their resulting episode. Core disposal aborts the policy lifetime and queued work. |
| `src/worker/SimHost.ts` | Separate W0.4 command/interface blocks add typed `setSettings`, `dismissAlert` and a read-only `policy` view with signal-bound subscriptions. Reuses W1.1a's `SimSettings`/`PolicyState` types; command execution, causes and gestures are retained. |
| `src/ui/EmergencyBanner.ts` | Renders policy alerts/LIVE/one-shot feedback. Forwards initial and changed simulation settings and dismissals through tagged host commands. Retains outcome text, incident references, stable controls, dispatch feedback, press holds and settle guards. Re-exports existing pure-policy names. Pill docking excludes whole panel bodies, searches below/beside panels, permits wrapping into narrow free strips, and checks pills beneath live rows too. A newly visible pill docks before painting. |
| `tests/worker/policy.test.ts` (new) | Same-day/core timing, EM-1 burst invalidation, host-tick fallback, dismissals, copied settings and mode changes, boot/reset, terminal loss/linger, abort/dispose, and a real LocalSimHost fire/dispatch/pause-resume integration. |
| `tests/game/emergencyBanner.test.ts` | Existing simulation/DOM harness uses the extracted policy owner and a real UI emitter; city lifetimes abort after each test. Adds command/feedback/subscription checks. Strengthens the old Budget pill assertion from header clearance to full-body clearance. |
| `tests/game/uiStacking.test.ts` | All six requested cases: 1024 × 600 Demographics/Help and 1280 × 720 Help, each pill-only and with live banners. Calls the actual docking branches with layout fixtures, then repeats with a taller wrapped pill. Also tests a below-panel strip and no safe strip. |
| `tests/worker/hygiene.test.ts` | Enables S1's `W0.4: liveSlowdown writers live only in src/worker or src/sim`. No new exception. |
| `docs/dev/qa-W0.4-livepolicy.md` | Manual uncovered-fire/ultra, urgent pause, dispatch, follow completion/restore, settings/dismissals/load/teardown, and pill geometry checks. |
| `docs/dev/reports/local-W0.4-livepolicy.md` | This handoff and verification limits. |

No changes to `src/sim/**`, `src/save/**`, CityScene, context, settings, rendering, protocol/recorder/replica/loopbackCore
or other lanes' implementation files. LocalSimHost remains the only host. The guard holder, city's
`abort('dispose')`, null views, command causes and gesture paths remain intact. New UI subscriptions use `ctx.signal`;
core subscriptions use its city-host lifetime signal, aborted by the existing CityScene → host.dispose path.

## Moved sites

Left-hand lines are from **base `2ba03fa`**. Policy-internal writes now belong to the authoritative owner, as §3.3
requires; they do not post a command back to their own host.

| Before | Now |
|---|---|
| `EmergencyBanner.ts:66`, `:78`, `:113`, `:172` (constants, LiveState, speedPolicy, AlertQueue) | `src/game/emergencyPolicy.ts`; invoked by `SimCore.LivePolicy`, re-exported from the original module for compatibility. |
| `EmergencyBanner.ts:471` (`followingDispatch`, FOLLOW constants) | `emergencyPolicy.ts`, used by the owner for following/expiry. |
| `EmergencyBanner.ts:536`–`:553` (queue, episode, dismissed, scan and incoming state) | `SimCore.LivePolicy`; the banner retains only presentation state. |
| `EmergencyBanner.ts:744`, **`:751`** (reset and reset slowdown) | `LivePolicy.boot()` owns `sim.liveSlowdown = 1`, clears policy state and re-scans; the banner reset only removes DOM. |
| `EmergencyBanner.ts:760` (load rescan) | `LivePolicy.boot/rescan`, after system init; no UI required. |
| `EmergencyBanner.ts:776` (sendDays) | Headless `sendDays` helper called by LivePolicy. The UI uses the same helper solely for ordering/count presentation. |
| `EmergencyBanner.ts:793`, `:821` (incoming events and EM-1 flush) | `LivePolicy.onEvent/flush`; subscription tied to host lifetime, microtask checks abort. UI's emergency listener keeps outcome/option invalidation only. |
| `EmergencyBanner.ts:844`, `:910`, `:912`, `:1340` (settings reads for selection/speed/follow) | Banner construction and `ctx.ui`'s settings event → `host.act('setSettings', [SimSettings], {tag: banner})` → the owner's copied settings. |
| `EmergencyBanner.ts:860`, `:866`, `:891` (unbannered prompts, pending, urgency) | `emergencyPolicy.ts`, evaluated in LivePolicy with authoritative incidents/options and `simTime()`. |
| `EmergencyBanner.ts:908`, **`:918`** (policy and its `host.setSpeed`) | `LivePolicy.apply()` applies the pure result directly to authoritative `sim.speed`; UI now reads `host.policy.live`. |
| **`EmergencyBanner.ts:919`** (policy slowdown) | `LivePolicy.apply()` owns `sim.liveSlowdown = step.liveSlowdown`. |
| `EmergencyBanner.ts:920`–`:924` (toast and LIVE class) | `host.policy` subscription → banner `renderPolicy`; only new published feedback plays/shows, while regular UI refreshes are silent. |
| `EmergencyBanner.ts:949`, `:1000` (dismiss button/local dismissed set) | `host.act('dismissAlert', [id], {tag: banner})` → owner dismissal and neutral episode handling; removal follows `host.policy.alerts`. |
| `EmergencyBanner.ts:1007`, `:1335` (queue removal and 2.5/4-second expiry) | Owner tick retires policy alerts; UI retains its 250 ms removal animation and terminal outcome rendering. |
| `EmergencyBanner.ts:1027`, `:1339` (display clock) | `host.simTime()` in refresh/tick; authoritative calculations stay in the core. |

`EmergencyBanner.ts:972`'s `await host.act('dispatchBest', [id]).done` is retained. DispatchTool's cause-tag command
and listener, all Tool.commit sites, and every other W0.2 mutation path are unchanged.

## Design/code differences and boundaries

1. **EM-1, not synchronous inside `uncovered`.** The design's §0/§3.3 description predates the tested burst flush.
   LivePolicy records ids inside `uncovered`, then offers alerts and applies speed/slowdown in a microtask after all
   synchronous dispatch assignments. If the microtask has not run yet, the next host tick flushes it. This replaces
   the old next-UI-tick fallback while preserving the settled-burst rule and moving periodic evaluation from 6 Hz to
   host ticks, including paused ticks. It prevents a transient free unit from forcing an unwanted urgent pause.
2. **Same-day gate versus per-day worker pacing.** The new same-day test raises a major fire during one day, verifies
   no inline slowdown, then verifies speed 1 / slowdown 3 on that same day after the microtask, before another
   `advanceDay`. The next tick does not consume ultra's remaining time as extra days. A separate regression explicitly
   retains the existing local multi-day `Simulation.update` behavior: its cached seconds-per-day can finish up to four
   days before the microtask. §3.1/§5.3's stronger “remaining days of the tick are dropped” needs W1.2's day units/API
   split, forbidden by this lane's file scope. O7's explicit scheduler/disaster live-mode flag also remains W1.2.
3. **The policy module did not exist.** It is created from the current banner implementation, not an older design
   snapshot. Real short-window fires commonly urgently pause immediately; the exact 1/3 same-day assertion uses a
   declared long-window fire fixture. A separate real-host test covers the ordinary urgent fire and dispatch to LIVE.
4. **Settings wiring without a CityScene edit.** The scene already emits initial/current settings through its UI
   emitter. The banner forwards just the three SimSettings fields at construction and on that event; SimCore copies
   the command value, never retains `ctx.settings`, and can run without the banner. No settings listeners/readers are
   installed in the worker's DOM-free graph. The core attaches after the existing split lazy boot, as W0.1 reported.
5. **PolicyView delivery.** W1.1a already defines the plain PolicyState shape but has no host policy subscription API.
   W0.4 adds a local, read-only view with abort-bound change subscriptions over that shape. Warning/toast effects are
   consumed on publication, not on every UI tick; regular rendering can reread the latest snapshot safely. The
   recorder/replica/loopback implementation is unchanged, so packet wiring is not claimed here.
6. **Views/queries remain in their own lanes.** Banner incident/vehicle/dispatch-option reads still use the existing
   emergency system surface. Only the policy decisions have moved; migrating those display reads to EmergencyView
   and dispatchOptions watches requires W0.3/W0.5. `emergencyPolicy.ts` adds no `getSystem`/`emergencyOf` reach-in.
7. **Pill fallback.** Full-panel rectangles replace header-only avoidance for the pill. If neither below nor beside
   fits at normal width, the pill wraps in a narrower free strip, with conservative height allowance and subsequent
   measured layout. If manually dragged panels occupy every possible strip, it hides until space returns rather
   than covering content; the top-bar Emergencies control remains available. No CSS/z-index change.

## Tests and verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed with source and all new/updated tests. |
| `git diff --check` | Passed. |
| `npx vitest run tests/game/emergencyPolicy.test.ts --maxWorkers=1` | **Could not start**: Vite `externalize-deps`, `spawn EPERM` in `optimizeSafeRealPathSync` / `windowsSafeRealPathSync`. No test executed. No sandbox workaround or escalation attempted. |
| W0.4 slowdown hygiene | Enabled; source inspection finds both writes only in SimCore. Runtime AST gate not executed. W0.2 speed rule remains enabled. Later rules remain skipped. |
| Restricted implementation files | No edits to sim/save, CityScene, renderer or W1.1a files. |
| Full suite, old saves, bot, screenshot comparisons, browser QA and leak probe | Not run here; lead runs required. **196,101 in 2015** (59,288 / 95,301 / 41,512) is the required seed-7 B1 reference, not a verified result. |

Run each focused suite separately with `npx vitest run <file> --maxWorkers=1`:

- `tests/game/emergencyPolicy.test.ts`: unchanged `speedPolicy`, incident-state text, `AlertQueue` and primary-dispatch
  follow tests keep importing the banner's re-exports.
- `tests/worker/policy.test.ts`: ten new `LivePolicy in SimCore` tests, including the named same-day and local pacing
  cases, EM-1, settings/dismissals/load/reset/outcome/lifetime, and the real LocalSimHost dispatch/pause-resume test.
- `tests/game/emergencyBanner.test.ts`: existing F2/P1/P2/P6, EM-1/2/3/4/5, flyout/press/settle/teardown/docking cases,
  plus `W0.4: renders host policy feedback once and forwards settings and dismissal commands until the city aborts`.
- `tests/game/uiStacking.test.ts`: existing CSS stacking checks, six requested panel/viewport/mode regressions and
  two free-strip cases.
- `tests/worker/hygiene.test.ts`, `tests/worker/simCore.test.ts`, `tests/worker/localSimHost.test.ts`,
  `tests/worker/commands.test.ts`, `tests/game/dispatchCommands.test.ts`, `tests/game/cityDisposeCanvas.test.ts`,
  `tests/game/cityTeardown.test.ts` for host/command/lifecycle regression coverage.

Manual script: [qa-W0.4-livepolicy.md](../qa-W0.4-livepolicy.md). The implementation is ready for review; the runtime
acceptance gates remain unverified.
