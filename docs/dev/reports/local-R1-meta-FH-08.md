# T036s5 / FH-08 — first emergency teaching

Desktop implementation on `local/T036s5-fh08`, initially based on `821a8d6`, committed as WIP `d6d5421`, then
review-round-1 fix `e5a234d` and round-2 integration `a3cd741`. The owner verified round 2 with tsc, the full Vitest
suite (223 files / 2,257 tests), and the unchanged bot. **Round 3 below is uncommitted.**
No `.done` file was changed, following the explicit instruction not to write done markers.

## Review round 3 — GPU QA corrections

Read the complete supplied `scratchpad/qa/FH08/qa.md`: `vet_s7_y21`, 304k residents, default LocalSimHost and
`?simworker=loopback`, zero console errors. Previous QA lines 1–3 and 6–7 passed; line 4 was partial and line 5
failed. The six corrections are kept in small policy/teaching/queue hunks for the pending FEEL-10 merge.

1. **B1 — `src/game/emergencyPolicy.ts`; `tests/game/emergencyPolicy.test.ts`.** One selector condition now requires
   `!alert.wasPossible` for E1b. A savable alert that later lapses cannot consume E1b; the new test then supplies a
   never-savable alert and verifies E1b is still available. Existing E1b fixtures now correctly say never savable.
2. **B2 — `src/ui/EmergencyBanner.ts`; `tests/game/emergencyTeaching.test.ts`.** `rememberTeachingResponse` retains
   the first waiting fire's `deadline - start`, including while options are still loading. `teachFailure` passes
   that window to `firstFailureReason`. A spreading-fire regression extends the deadline/cluster lifetime to
   13 minutes but still reports the observed 5.2-minute building window alongside the real 6.9-minute ETA.
3. **B3 — `src/ui/EmergencyBanner.ts`; both emergencyTeaching test files.** The banner retains its E3 lesson;
   `removeBanner` hands it to separate `queueFailureTeaching` exactly once. The shared budget/deferral queue supplies
   a fresh 12,000 ms lifetime and Fire/Police/Health-tab action after actual display. Tests cover the handoff,
   New Year/budget deferral, exact visible lifetime and service action. FEEL-02a's toast-budget tests are unchanged.
4. **B4 — `src/ui/EmergencyBanner.ts`; `src/ui/Notifications.ts` (minimal shared-queue hunk outside the original named
   files); both emergencyTeaching test files.** Optional `isRelevant` / `onDrop` options check a toast when it can
   actually display or merge. E2 requires the current policy's LIVE, host speed 1 and slowdown greater than 1.
   A stale E2 drops without `onShow`, seen consumption or budget usage, and clears its pending guard so the next
   slowdown can teach. Tests cover New Year, budget delay, merge rejection and subsequent retry.
5. **N3 — `src/ui/EmergencyBanner.ts`; `tests/game/emergencyTeaching.test.ts`.** E3 adds timing without repeating
   the existing “No fire truck was sent in time” outcome. Industrial teaching states its dispatch-window timing
   without repeating the plant-fire outcome. Every E3 toast names the incident and place (for example, “Fire at
   Harbor Refinery”), including after New Year and after banner removal.
6. **N4 — `src/ui/EmergencyBanner.ts`; `tests/game/emergencyTeaching.test.ts`.** E3 eligibility requires an existing
   incident banner at failure. A non-alerted medical failure leaves E3 unseen; a later bannered fire can teach it.
   A lesson already captured from a qualifying banner can still appear after that banner expires during New Year.

No `src/sim/infra/*` hunks. No worker, TopBar, NewYear, App-wiring, CSS or other production-file edits in round 3.
The only production hunk outside the original owned files is Notifications' additive relevance/drop contract
(four interface lines and two guarded checks), expressly needed for B4's actual-display check. No RNG draws,
balance changes, save/systemData changes or dependencies. This report is the only documentation change.

Round-3 checks:

- **Passed:** quiet-gated `npx tsc --noEmit`; `git diff --check`; protected-file and unchanged toast-budget-test
  diff review. All changes remain uncommitted.
- **Passed direct source probes:** the new `fh08-round3-probe.mjs` imports the production policy, Banner and shared
  Toasts. It verifies all six corrections, including a 70-second show, cached spreading-fire numbers, 12 seconds
  after actual E3 display, service action, and stale E2 rejection/retry. The existing `fh08-host-probe.mjs` also
  passes on actual LocalSimHost and packet loopback hosts after the policy change. These are diagnostics, not a
  substitute for Vitest or real-GPU QA.
- **Blocked before test execution:** all eight targeted files were attempted one at a time through the quiet gate.
  Every command failed loading `vite.config.ts` with `spawn EPERM` in Vite's optional Windows `net use` real-path
  subprocess. This sandbox still cannot start Vitest; no targeted-test pass is claimed for round 3.
- **Left to the owner:** targeted/full Vitest rerun, hygiene execution, unchanged toast-budget execution and GPU
  checks below. No browser, full suite, bot, Hard digest, GPU timing or old-save continuation run here.

Exact targeted commands (run from this worktree):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyTeaching.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyPolicy.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyBanner.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/policy.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/emergencyTeachingHost.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/toastBudget.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyTeachingToasts.test.ts --maxWorkers=1
```

The new diagnostic command (loader and probe remain only in the supplied scratch folder):

```text
node --no-warnings --experimental-transform-types --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-host-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-round3-probe.mjs
```

The diagnostic stubs CSS loading and DOM/timers only; it imports the changed production methods without changing
repository code or dependencies. The earlier host-probe command is recorded in round 2 below.

Bot acceptance remains **`[61124, 93804, 37971]` = 192,899 residents in 2015**, already verified by the owner at
`a3cd741`. Round 3 does not rerun it: teaching defaults remain off and no simulation/balance code changed. The
standard rerun, if desired, is:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Plan-versus-code and pending cloud requests:

- FH-08 E3 says “the first failed incident” and gives a non-spreading-fire example. Round-3 N4 narrows this to the
  first failure with a banner, preserving the lesson for an incident the player was alerted to; the plan does not
  explicitly require consuming E3 on an unbannered failure. B2 uses the original building window rather than the
  eventual spreading cluster's lifetime. B3 adds reading time without changing the core's 2.5-second banner expiry.
- **Pending B5, lead-owned:** in `src/worker/LoopbackSimHost.ts`, the constructor's `this.policy` view at lines
  206–207 needs `get teaching() { return host.replica.policy.teaching; }`. The replica/subscription already carry
  teaching, but the public getter does not. This protected file was read only and remains untouched.
- **Pending TopBar split:** the extracted LIVE pill title in `src/ui/topbar/**` still needs: “Within station range
  never slows. Outside it, LIVE slows your dispatch; your speed returns when help arrives. Settings → Gameplay.”
- FEEL-10 / T048 merge remains for the owner. New banner work stays in teaching methods and retained teaching data;
  no outcome-system refactor or merge was attempted.

Real-GPU browser checklist, fresh profile, Medium / Disasters on or debug spawn, on default and packet hosts:

- [ ] QA line 1: E1a pauses; correct loading/station/ETA copy; Send nearest dispatches and closes the card.
- [ ] QA line 2: a never-savable fire shows E1b and its Fire-tab/Emergency-view actions.
- [ ] QA line 3: an actual LIVE slowdown displays E2 once. A queued episode that ends during New Year displays
      nothing afterward, leaves E2 unseen, and the next actual slowdown teaches it once.
- [ ] QA line 4: a spreading fire retains its first building's window (for example 5.2 min vs ETA 6.9), states the
      failure outcome once, and names its place in the deferred/continuation toast. On banner expiry the same E3
      explanation remains readable for at least 12 seconds with a working Fire-tab action.
- [ ] QA line 5: a second initially-savable fire that lapses behaves under T029's normal rules and never opens or
      consumes E1b. A later never-savable fire can still teach E1b.
- [ ] QA line 6: no teaching card/explanation/toast during any part of New Year; relevant deferred lessons display
      once afterward with original numbers, service actions and full toast reading time.
- [ ] QA line 7 / N4: Tips/seen flags/loading transitions still work; an early unbannered medical failure in a town
      below 1,000 leaves E3 for the next bannered failure. City exit cancels queued lessons.

## Review round 2 — protocol activation and New Year

Read NOTE-048 in full, including “FH-08's request” and “A standing rule for src/worker/**”. The protocol work is
isolated in the following small hunks for a separate eventual commit; no commit was made here.

| File | Round-2 change |
| --- | --- |
| `src/worker/protocol.ts` | Type-only import; three optional SimSettings fields `teachFirst`, `teachTooFar`, `teachingAck`; optional `PolicyState.teaching`. No protocol version or command change. |
| `src/worker/SimHost.ts` | One optional readonly teaching field in PolicySnapshot. |
| `src/worker/SimCore.ts` | LivePolicy owns the existing EmergencyTeachingPolicy, passes its episode to speedPolicy, exposes it locally, publishes episode-only changes and absence, resets/disposes it. Default settings remain unarmed. |
| `src/worker/loopbackCore.ts` **(minimal hunk outside the original named files)** | Two-line recorder projection update: copy optional teaching from LivePolicy to packets. The field stays absent when inactive, preserving the default packet shape. Without this, the recorder would discard the newly typed field. |
| `src/ui/EmergencyBanner.ts` | Retains full subscribed policy snapshots because the protected packet policy getter list omits additive fields; ticks and acknowledgements use that snapshot. Existing `loadPref` firsts now reach the active host policy through setSettings. New Year methods defer initial cards/seen flags, hide existing lessons, queue E2 through the shared budget, and retain event-time E3 evidence until the show ends. Toast seen flags are saved on actual display, with pending guards against duplicates. |
| `src/game/context.ts` **(minimal hunk outside the original named files)** | Optional `newYearBusy()` accessor and the shared ToastOptions type for the existing toast method. |
| `src/game/CityScene.ts` **(two isolated lines outside the original named files)** | Supplies `newYearBusy: () => this.newYear?.busy ?? false`; updates `newyear-busy` on the UI root after newYear.frame and before rendering. Both existing toast forwarding lines are unchanged. |
| `src/ui/Notifications.ts` **(necessary shared-queue hunk outside the original named files)** | Additive `deferWhile`, `onShow`, `teaching` options. The existing queue waits while deferred even past its normal 50 s deadline, lets eligible ordinary news proceed, and marks teaching toasts for visibility suppression. Existing toast-budget rules are retained when no deferral is supplied. |
| `src/ui/emergency.css` | Separate New Year visibility selectors for teaching cards, fallback, outcome explanation and marked teaching toasts. |
| `tests/worker/emergencyTeachingHost.test.ts` (new) | Local and packet settings/episode/ack tests, absent-flags-off/default packet shape, E1a/E1b independence, dispatch clearing, and real Banner → profile prefs → actual host → card acknowledgement → new-city seen-state tests on both hosts. |
| `tests/game/emergencyTeaching.test.ts` | New Year card/fallback/explanation suppression, delayed seen consumption, queued E2/E3, preserved event-time numbers after the banner disappears, abort guards, and the packet getter/subscription distinction. |
| `tests/game/emergencyTeachingToasts.test.ts` (new) | Actual shared Toasts queue with fake time: long-show deferral, show beginning during budget delay, ordinary news progress, deduplication, display callbacks/marker and abort cleanup. |
| This report | Current implementation, limits, gates and remaining handoff. |

No infra hunks. No edits to `WorkerSimHost.ts`, `LoopbackSimHost.ts`, `protocolInbox.ts`, NewYear.ts, TopBar,
App wiring, save/journal/recovery paths, or the existing `toastBudget.test.ts`. No new RNG draws, systemData keys,
simulation rules, balance changes or dependencies. The worker additions are optional and additive.

Round-2 gates:

- **Passed:** quiet-gated `npx tsc --noEmit`, including the final real-host/profile integration fixtures;
  `git diff --check`; source review of protected-file and unchanged toast-budget-test diffs.
- **Passed direct host probe:** actual LocalSimHost and clone-only LoopbackSimHost, settled incidents, settings
  arming, E1a pause, seen-flag update retaining the hold, matching acknowledgement resuming LIVE, independent E1b,
  and teaching present in recorded packets and replica policy.
- **Passed direct Toasts probe:** actual shared queue, ordinary-news progress while teaching waits, no teaching
  display through a simulated 70-second show, one actual-display callback afterward, DOM marker and abort cleanup.
- **Vitest did not execute:** all eight targeted files below were attempted separately through the quiet gate with
  `--maxWorkers=1`. Every one failed loading Vite config with `spawn EPERM` in the optional Windows `net use`
  path probe. This is the same sandbox startup restriction as earlier rounds; no test pass is claimed.

```text
tests/game/emergencyTeaching.test.ts
tests/game/emergencyPolicy.test.ts
tests/game/emergencyBanner.test.ts
tests/worker/policy.test.ts
tests/worker/emergencyTeachingHost.test.ts
tests/worker/hygiene.test.ts
tests/game/toastBudget.test.ts
tests/game/emergencyTeachingToasts.test.ts
```

Each test used the same full quiet-run prefix recorded in round 1. The additional command lines were:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/emergencyTeachingHost.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/toastBudget.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyTeachingToasts.test.ts --maxWorkers=1
```

The direct probes and their loader are in the supplied scratch directory (`fh08-host-probe.mjs`,
`fh08-toast-probe.mjs`, `fh08-host-loader.mjs`). The native loader resolves extensionless TypeScript/index imports
and maps the two existing Vite lazy-module declarations to explicit imports in memory; it changes no repository
source or host/transport behavior. These probes do not substitute for Vitest, hygiene or browser checks. Commands:

```text
node --no-warnings --experimental-transform-types --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-host-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-host-probe.mjs
node --no-warnings --experimental-transform-types --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-host-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-toast-probe.mjs
```

The owner verified `e5a234d` with tsc, **219 files / 2,202 tests** and the bot at **192,899**. No bot rerun was
requested or performed in round 2; the exact standard/native bot command lines remain in the original checks below.
Expected residents remain `[61124, 93804, 37971]`, total 192,899 in 2015. No browser, full suite, GPU timing,
Hard digest or old-save continuation gate was run here.

Plan-versus-code and remaining handoff:

- The optional protocol is now active, superseding original requests 1–4 below. `loopbackCore.ts` needed the
  documented two-line projection in addition to protocol/SimHost/SimCore. The protected packet getter list stays
  unchanged; the banner uses the complete subscribed snapshot, with a regression test.
- The existing `NewYearCelebration.busy` covers the whole show and lingering fireworks. The context accessor and
  two CityScene lines replace the original request for a new NewYear event; **no NewYear.ts edit is needed**.
- E2/E3 use FEEL-02a's shared budget and action queue. `onShow` preserves a first tip until it is displayed rather
  than silently consuming it when queued. A deferred lesson does not block ordinary eligible news.
- **Still for the cloud:** the LIVE pill title in the extracted `src/ui/topbar/**` component after the TopBar split.
  Intended text: “Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when
  help arrives. Settings → Gameplay.” No TopBar hunk was written.
- The future GuideProfile migration remains with T037a; this base still uses its working loadPref firsts and Tips
  setting. No new profile/schema workaround was added.
- FEEL-10 has not been merged by this lane. Banner changes stay in named teaching functions and snapshot handling;
  resolve its EmergencyBanner conflict after the owner merges the updated dev, without changing other branches.

Additional real-GPU browser checks for the owner:

- [ ] Fresh profile on both local and actual worker host: E1a pauses, shows actual station/ETA, and Send nearest
      dispatches and closes the card. Got it acknowledges once. A new city respects the profile's seen flags.
- [ ] E1b still leaves speed alone; the next uncovered fire and the T029 busy/cooldown rules behave normally.
- [ ] Start a full New Year show or burst with an E1 card/folded fallback or E3 explanation visible: it hides before
      paint through the last lingering firework and returns only if still relevant.
- [ ] An E1 first arriving during a show creates no card or seen flag until the full busy state ends.
- [ ] E2/E3 queued before or during a show never appear during it, including a show longer than 50 seconds, and
      each appears once afterward subject to the shared budget. E3 retains its original ETA and event-day duration.
- [ ] Ordinary budgeted news keeps FEEL-02a's gap/rate/maximum-wait behavior; leaving the city cancels queued tips.

## Review round 1 — loading dispatch options

The worker's full-suite run found one failure: the E1a card said “No free unit can go right now” before its dispatch
options query had answered. This was a presentation bug, not a bad test expectation.

- `src/ui/EmergencyBanner.ts`, `renderTeaching()`: an undefined options value now displays “Loading dispatch
  options…”. Send nearest stays disabled. Only a delivered answer with no usable primary unit displays “No free
  unit can go right now.” A usable answer names the actual station and ETA and enables Send.
- `tests/game/emergencyTeaching.test.ts`: extends the existing loading regression through undefined → empty answer
  → usable unit, retaining the same card. Checks the message and disabled state at each transition.
- This report records the review correction and reruns. No infra hunks, hunks outside the named source/test files,
  cloud-held edits, new dependencies, simulation changes or RNG draws.

`npx tsc --noEmit` passed after this correction. All six targeted commands below were run one at a time through the
quiet gate with `--maxWorkers=1`; each failed before test execution with `spawn EPERM` while Vite loaded the config
(`externalize-deps` → `windowsSafeRealPathSync` → the Windows `net use` subprocess):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyTeaching.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyPolicy.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyBanner.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/policy.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/infra/emergency.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1
```

An additional quiet-gated attempt on `emergencyTeaching.test.ts` with `--configLoader runner` also failed at config
startup: `ReferenceError: require is not defined` in `picomatch/index.js`. No repo or dependency configuration was
changed to bypass either failure. The owner must rerun the targeted tests; this round does not claim a Vitest pass.
The full suite remains reserved for the owner.

The owner verified WIP `d6d5421` at `[61124, 93804, 37971]` = **192,899** residents in 2015. No bot rerun was needed
for this text-only correction; the original exact bot commands and evidence remain below. No new plan-versus-code
differences or cloud requests; the existing integration requests remain open. No browser was run.

Additional browser check for this correction:

- [ ] With delayed dispatch options, E1a shows the loading line and disabled Send nearest.
- [ ] A delivered answer without a usable unit changes the line to “No free unit can go right now”, keeping Send disabled.
- [ ] A usable answer updates the same card with its station/ETA and enables Send nearest.

## Changes by file

| File | Change |
| --- | --- |
| `src/game/emergencyPolicy.ts` | `EmergencyTeachingPolicy` selects and latches one E1a and one E1b from settled major alerts. Profile arming, acknowledgement and recording a seen tip are separate. Optional argument 9 of `speedPolicy` adds the E1a pause, releases it into LIVE follow, respects manual speed changes and preserves normal later episodes. E1b leaves speed alone. |
| `src/ui/EmergencyBanner.ts` | Renders the optional authoritative episode from `host.policy`; stores four independent flags in `loadPref('emergencyTeaching', …)`; sends arming/acknowledgement through `host.act('setSettings', …)`. Adds primary-responder station/ETA copy, service/view actions, async dispatch acknowledgement, once-only LIVE toast and first-failure explanation. Dispatch uses its host tag and gesture. Event subscriptions use `host.events` and the city lifetime. |
| `src/ui/emergency.css` | Separate teaching selectors. The card stays readable in compact banners; if all banners fold, the same card moves into a scrollable foreground fallback so its pause always has visible controls. |
| `tests/game/emergencyPolicy.test.ts` | Adds both variants, one-shot selection/pause, acknowledgement, dispatch/removal/reset, urgency interaction, manual speed override, policy changes and the first lesson during a normal trigger cooldown. |
| `tests/game/emergencyTeaching.test.ts` (new) | Mock worker-host presentation tests: actual station and ETA, independent profile flags, delayed/failed/supporting dispatch acknowledgements, stale episodes, loading options, folded-card fallback, E2 once across remounts, measured E3, replay-time clock lag, chosen-station ETA, industrial primary responder, Tips off and city abort. The fixture explicitly stages the missing worker episode. |
| This report | Changes, gate results and cloud handoff. |

No `src/sim/infra/*` hunks. No other source files changed. `EmergenciesPanel.ts`, settings, TopBar, NewYear,
Notifications, App wiring and `src/worker/**` are untouched. There are no new systemData keys or RNG draws.

E3 retains the free primary unit's observed dispatch-options ETA while waiting. Once a primary unit was sent,
`Incident.etaMin` and `answered` take precedence, so choosing another station cannot attribute its trip to the nearest
station. Industrial ambulance support is never described as a fire truck. Failure duration uses the mirrored event
day (`ctx.state.day`), because `host.simTime()` still describes the previous clock during worker event replay.
The existing outcome note remains unchanged; the explanation and prevention action get their own line.
For an unbannered failure, the explanation is a toast. Local host terminal events can use a retained EmergencyView
incident reference; worker replay already exposes final incident data during the event.

## Checks

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed after the implementation and new fixtures. |
| `git diff --check` / UTF-8 | Passed; all six changed/new repository files are valid UTF-8 without a BOM. |
| Short native Node TypeScript policy probe | Passed against actual source imports: first pause, repeat callback, dispatch into slowed LIVE, restoration, no delayed normal trigger, E1b unchanged speed, seen-versus-ack latch, one-shot guard and 30,000 ms constant. This is not a Vitest or worker transport pass. |
| `tests/game/emergencyPolicy.test.ts` | Attempted through the quiet gate. Vite config startup failed with `spawn EPERM` in `externalize-deps` / `windowsSafeRealPathSync`; no tests executed. |
| `tests/game/emergencyTeaching.test.ts` | Attempted through the quiet gate with `--configLoader native` after the normal loader failure. Startup failed with `ERR_UNKNOWN_FILE_EXTENSION` for `vite.config.ts`; no tests executed. |
| `tests/worker/hygiene.test.ts` | Attempted through the quiet gate. Same Vite `spawn EPERM`; no tests executed. |
| Full Vitest / existing banner and worker policy suites | Left to the owner. Full-suite execution was explicitly prohibited. The sandbox startup restriction also prevents local targeted regression execution. |
| 128 × 15, seed 7 bot | Native Node fallback completed with residents `[61124, 93804, 37971]` = **192,899** in 2015, matching the required baseline. See exact commands and log below. |
| Browser / real GPU | Not run, as instructed. Worker transport integration must land first. |

The first typecheck found an overlay string instead of `Overlay.Emergency` and missing required event fields in new
fixtures; these were corrected. An initial diagnostic using the legacy TypeScript transpile API could not run because
TypeScript 7 does not expose that API here; the successful policy probe used Node 22's native TypeScript transform.

Targeted commands attempted (one process at a time):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyPolicy.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/emergencyTeaching.test.ts --maxWorkers=1 --configLoader native
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1
```

The requested bot command could not start: offline npm reported `ENOTCACHED` for `tsx`. Its output is
`scratch/fh08-simbot128x15-s7.log` under the supplied T036s5 scratch directory:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

The alternative uses a scratch-only loader, `fh08-native-typescript.mjs`, which resolves extensionless relative
imports to the existing `.ts` source. It changes no source, flags, simulation rules or bot actions. Exact successful
command (stdout/stderr redirected to `scratch/fh08-simbot128x15-s7-native-clean.log`):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s5/scratch/fh08-native-typescript.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

The first native run also completed with the same residents, but PowerShell treated Node's experimental-feature
warnings on stderr as an error. The clean run suppresses those advisory warnings and explicitly propagates the child
exit code. No balance change is intended. The owner may rerun the standard `npx tsx` command when tsx is available;
its acceptance numbers remain `[61124, 93804, 37971]`, total 192,899. No 256 × 60 runs are needed for this item.
Hard bit identity, old-save continuation and two-process hashes were not independently exercised here.

## Exact cloud requests

1. **`src/worker/protocol.ts`, `SimSettings` and `PolicyState`:** carry the optional fields exported by
   `EmergencyTeachingSettings`: `teachFirst?: boolean`, `teachTooFar?: boolean`, `teachingAck?: number`; add
   `teaching?: EmergencyTeaching` to `PolicyState`. Undefined arming flags mean off. `teachFirst` arms E1a;
   `teachTooFar` independently arms E1b. The second flag is necessary for the two separate profile firsts.
   Acknowledgement uses the existing settings command, not a new mutation API.
2. **`src/worker/SimHost.ts`, `PolicySnapshot`:** add readonly optional `teaching` with `{ id, variant: 'E1a' | 'E1b' }`.
3. **`src/worker/SimCore.ts`, `LivePolicy`:** create an `EmergencyTeachingPolicy`; expose `teaching` in `view`;
   call its `reset()` in `boot()` before publishing a reset; in `apply()` call
   `teaching.update(this.settings, this.alerts, incidents)` after settled alert selection and pass that result as
   argument 9 to `speedPolicy`. Keep the existing trigger cooldown expression. The optional first lesson can start
   its own episode, while later calls still require the normal trigger. `publish()` must include `teaching.episode`
   when present and compare its id/variant in the no-change guard, including a change to absent. Clear open teaching
   on disposal. Preserve the existing busy retirement and 30 s cooldown accounting.
4. **`src/worker/LoopbackSimHost.ts`, `PacketSimHost` constructor's policy view:** add the explicit getter
   `get teaching() { return host.replica.policy.teaching; }`, alongside alerts/live/toast/warn. Packet policy copying
   already uses the policy shape; verify optional teaching survives recorder → packet → replica, including clearing.
5. **`src/ui/TopBar.ts`, `TopBar.buildLeft()`'s `.live-pill` creation (or its extracted split component):** update
   the title to explain the first slowdown and restoration, e.g.
   “Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when help arrives.
   Settings → Gameplay.” Keep the current badge visibility and speed controls. No TopBar edit was made here.
6. **`src/game/NewYear.ts`, `NewYearCelebration` constructor deps / `busy` state, and `src/game/CityScene.ts`'s NewYear
   construction:** expose a city-bound show-busy notification covering the entire show, including completion,
   cancellation and abort. Connect it through the context/UI-event contract so FH-08 can defer cards/toasts and
   teaching arming until the show ends. The current `.newyear-countdown` covers only part of the show and is not a
   suitable signal. This needs coordination with the cloud's FEEL-02a / Notifications work.

After 1–4 land, replace the local optional `TeachingSnapshot` extension with the shared snapshot type and verify
the existing structurally widened settings payload is accepted by both local and worker hosts. The current tests
are explicit presentation/pure-policy tests, not evidence that these cloud changes already exist.

## Plan versus this base

- FH-08 names `teachFirst`; §7.6 calls it `teachFirstEmergency`, and neither exists in the merged worker contract.
  This lane exports `teachFirst` plus independent E1b arming and acknowledgement as above.
- T037a's GuideProfile and “Tips you've seen” infrastructure are absent (`src/ui/guide/` contains only `copy.ts`).
  This lane uses the existing `loadPref`/`savePref` per-profile storage and the currently working `GameSettings.tips`.
  On the T037a merge, migrate the four flags into that profile and use its Tips on/off source; register the E1–E3
  entries in Help. No new settings schema or onboarding edit was made here.
- Full-show New Year suppression has no host/context signal on this base and remains an explicit integration
  request above. The desktop implementation does not claim §4.1's “nothing shows during New Year” check passed.
- PB-ACCIDENT's primary responder and ignition send window, PB-AMBER's real manual reachability and stopped
  post-loss countdown, PB-COOLDOWN's settled prompt coverage, PB-GRACE and T029 are used as merged; no infra edits.
- The first failure is not necessarily a fire. Text and service actions use the real primary responder. Clinic
  prevention copy avoids claiming its walk catchment radius is an ambulance road radius.
- If a failure was never bannered, E3 uses the existing toast API; that API has no action-button argument. Bannered
  failures get the service-tab button. No Notifications change was made.
- The foreground fallback is restricted to a teaching card whose ordinary banner has folded. It may cover an open
  panel because no ordinary banner-sized gap remains; normal banner docking is unchanged.

## Browser checklist for the owner (real GPU, worker)

After the worker hookup, use a fresh profile, Medium city and Disasters on or a debug spawn. A savable uncovered
fire needs a reachable free truck beyond automatic coverage; a city with no reachable unit does not raise today's
dispatch alert.

- [ ] Uncovered savable major fire pauses once and shows E1a with the actual place, primary station, ETA and
      “Auto-dispatch” label.
- [ ] Send nearest leaves the primary incident dispatched and closes the card after acknowledgement; its truck
      remains LIVE-followed and the player's speed returns after arrival. A failed send leaves the card open.
- [ ] A too-far major fire shows E1b, leaves speed alone and opens Fire tab / Emergency view correctly.
- [ ] A second savable uncovered fire has today's normal policy, urgency behavior and 30 s unpaused cooldown;
      busy in-range incidents never banner, teach, slow or pause.
- [ ] The LIVE explainer appears exactly once, including repeated snapshots and entering another city. Paused LIVE
      and plain 1× do not consume it.
- [ ] The first failure explains measured ETA and duration; test a chosen farther station and an industrial
      ambulance-only response. No post-loss countdown. The second failure gets the normal outcome.
- [ ] Got it, Emergency view and service actions acknowledge once. Tips off releases an open lesson. Closing a
      city with a pending dispatch produces no late card, toast or listener effects.
- [ ] At 1280 × 720 and 1024 × 600 with overlapping panels / toolbar flyouts, the folded-card fallback remains
      readable, scrollable and actionable; normal docking returns after the card closes.
- [ ] Per-profile seen flags survive reload and city changes, and old saves still continue normally.
- [ ] Once the NewYear integration request lands, no teaching card or toast appears during any part of the show.

Remaining owner gates: full Vitest, the targeted suites (including existing `tests/game/emergencyBanner.test.ts`
and `tests/worker/policy.test.ts`), hygiene, actual worker transport tests for the new fields and the browser list.
