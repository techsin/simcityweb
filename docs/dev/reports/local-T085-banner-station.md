# T085 — emergency banner station and first-lesson timing

Branch: `local/T085-banner-station`; task base: `d83f0d0`. Changes are uncommitted.

## Changes per file

- `src/ui/EmergencyBanner.ts`: the out-of-range note uses the existing city-bound `dispatchOptions` watch. It and the Send button choose the first missing responder in `INCIDENT_RESPONDERS` order, then the first free, finite-ETA option for that responder, matching `dispatchBest`. Until options arrive, or when no eligible option remains, the note shows the incident status without a stale station name. Busy and no-station explanations retain their existing text.
- `src/ui/EmergencyBanner.ts`: E1a stays unseen while its card is loading. It is recorded after a visible render of delivered options, including a no-free-unit result, or an explicit Send, Got it, Emergency view, service-tab or dismiss action. Automatic incident completion, card removal, Tips-off acknowledgement, reset and city exit do not consume a loading lesson. Send retains the existing pending-card and dispatch-acknowledgement timing. `markTeachingSeen` remains the single seen-flag write/persistence function and is idempotent, keeping the GuideProfile merge local.
- `tests/game/emergencyBannerStation.test.ts` (new): 10 cases. Local and loopback regressions compare the unchanged straight-line simulation note with road options, displayed note, button title and dispatched station; also cover fleet changes, a road shortcut, delayed/empty replies, busy/no-station explanations and primary-before-support responder order. The fixture's straight-line-nearest station needs 18.5 minutes by road; the station Send nearest selects needs 7 minutes. Both exceed the fresh fire's six-minute window, exercising the fallback.
- `tests/game/emergencyTeachingSeen.test.ts` (new): 14 cases covering loading and delivered/empty options, incident resolution/invalidation/removal, abort and late replies, profile remount, New Year visibility, explicit actions, Tips off, pending Send acknowledgement and E1b's independent prevention text/Fire tab.
- `docs/dev/reports/local-T085-banner-station.md`: this report.

No `src/sim/infra/*` hunks. No worker-protocol hunks. No source hunks outside the named file. No RNG, dispatch, balance, save-schema or mirrored-state changes.

## Validation

- `npx tsc --noEmit`: passed, including both new test files.
- `git diff --check`: passed. Final worktree scope is the banner, the two new tests and this report.
- All 12 focused Vitest files listed below were attempted separately through quietrun, one process at a time. Every invocation exited 1 before test collection: Vite's Windows path initialization (`externalize-deps` → `optimizeSafeRealPathSync` → `exec("net use")`) fails with `spawn EPERM` in this sandbox. No passing test result is claimed. The summary and representative startup output are in `vitest-gates.log` in the designated scratch directory. A native-config-loader attempt also stopped before collection because this Node cannot directly load `vite.config.ts` (`ERR_UNKNOWN_FILE_EXTENSION`); no tooling files were changed.
- A short `npx tsx -e` fixture probe could not start because `tsx` is absent from the available npm cache (`ENOTCACHED`, offline registry access). Fixture ETA assertions remain unverified at runtime.
- No browser, full Vitest suite, bot, bench, commit, push, merge or `.done` write was run.

The required focused test files are:

- `tests/game/emergencyBannerStation.test.ts`
- `tests/game/emergencyTeachingSeen.test.ts`
- `tests/game/emergencyBanner.test.ts`
- `tests/game/emergencyTeaching.test.ts`
- `tests/game/emergencyTeachingToasts.test.ts`
- `tests/game/emergencyPolicy.test.ts`
- `tests/game/emergencyOutcomePolicy.test.ts`
- `tests/game/emergencyOutcomes.test.ts`
- `tests/game/emergencyLive.test.ts`
- `tests/worker/emergencyTeachingHost.test.ts`
- `tests/worker/emergencyTeachingWorker.test.ts`
- `tests/worker/hygiene.test.ts`

Run each file separately, one process at a time, using:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1
```

## Gates left for the lead

The full suite, the focused runtime tests blocked above, bot and real-GPU checks remain with the lead. The bot command is:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Capture its output in the task's designated scratch directory. Keep the default profile and all optional strategy flags off. Required 2015 residents: **[61,124, 93,804, 37,971], total 192,899**. These are the acceptance values, not a new measurement. The implementation changes no simulation or worker code; Medium/Hard bit identity and old-save continuation are expected from that scope, but no two-process hashes or save/load runtime checks were performed. No 256-tile or 60-year runs are needed for this item.

## Plan/code fit and cloud requests

The existing `dispatchOptions` query/watch already carries dispatchBest's ordered road ETAs and station names, so the optional EmergencyView/protocol addition is unnecessary. The sim's straight-line fallback stays intact. The existing button selected globally by ETA across missing responders; the small adjacent UI selection change is necessary to name what `dispatchBest` sends for multi-responder incidents too. No other plan/code mismatch was found.

Cloud-held file requests: **none**. T037a only needs to reconcile the existing `markTeachingSeen` persistence function with GuideProfile; the seen timing now calls that same function after rendering or explicit action.

## Browser checklist

Repeat on the default host, `?simworker=loopback`, and `?simworker=1`:

- [ ] In `vet_s7_y21`, inspect the too-far fire: the note, Send nearest tooltip/ETA and dispatched truck name the same road-selected station (#21 in NOTE-073), while Choose station still works.
- [ ] While options are delayed, no straight-line station name appears; after arrival or a fleet/road change, note and Send nearest update together. Busy/no-road explanations remain readable.
- [ ] With a fresh profile and a savable uncovered major fire, pause once and show E1a; loading alone leaves its profile flag unset. Deliver options and confirm the station/ETA, enabled Send and seen flag.
- [ ] End the incident or exit the city before options arrive; a later city still offers E1a. Hide the loading card during New Year; arriving options consume it only after the card becomes visible again.
- [ ] Before options arrive, Got it, Emergency view and banner dismiss record seen and close/acknowledge correctly. Send records the action and retains the current card until the dispatch acknowledgement. Repeat actions do not reopen it.
- [ ] A too-far fire still shows E1b; its Fire tab opens the right service. A second uncovered fire follows ordinary behavior, and the LIVE explainer appears once.
- [ ] At a folded stack/narrow layout, the card stays operable in its fallback; Tips off, city exit and reload leave no stuck pause or retained listener. Old saves without teaching flags load and continue.

## Round 2 (NOTE-081): the click rule

Base `bf316ca` (round 1 committed). Changes are uncommitted.

### The rule now

A press on a banner's button, or on the "N more" pill, is ignored only when it **began before** that banner (or the pill) appeared or last moved under the pointer. A press that begins once the banner is in the page counts at once: there is no time window and no frame to wait for.

- **Appeared or moved** is what `markMoved` already tracked: a banner added, re-ordered, shown or folded, switched between full and compact, moved by the banners above it, or the stack re-docked. FH-08's card and failure note appearing in a banner that keeps its place now count too. The mark is the time of the change itself (`movedAt`). Before, it was open until the second frame and then lasted 350 ms more.
- **The press began** at its pointerdown's own event time, when that time is on `performance.now()`'s clock: not after the time the pointerdown is handled, and less than `PRESS_LAG_MAX` (1000 ms) before it. Otherwise the time it is handled counts. So a press made while the main thread was busy adding the banner is ignored, although its pointerdown is delivered after the banner is in the page.
- **A click on a control its press did not begin on** is ignored when that control's banner appeared or moved after the press began: a banner sliding in under a held finger, or a reflow under a pressed pointer. For this the window now notes every pointerdown, also those off the stack.
- **The control a press began on** still gets its click, whatever its banner did after the press began (close-out c2's capture rule, unchanged).
- **Keyboard**: a click with `detail` 0 (Enter or Space on the focused button) skips all of this.
- **A click with no press on record** (a tool that sends only `click`) is never ignored.
- **Touch**: the ignored control and the press record are kept until the click or the next press. Before, an ignored press was forgotten at its release (`setTimeout 0`), which a tap's click can outlive.

An ignored press still flashes its banner, and its click plays the denied sound.

### Changes per file

- `src/ui/EmergencyBanner.ts`:
  - `SETTLE_MS` is gone; `PRESS_LAG_MAX` (exported, 1000 ms) and `pressTime()` are new.
  - `BannerEl.settleUntil` and `settleGen` became `movedAt`; `moreSettleUntil` and `moreSettleGen` became `moreMovedAt`.
  - `markMoved` stamps the time of the change and no longer uses `requestAnimationFrame`.
  - `unsettled` became `movedSince(ctl, at)`.
  - The stack's `pointerdown` handler records the press (`began`: its control and when it began) and decides by `movedSince`.
  - The stack's `click` handler returns at once for `detail` 0, drops a click whose press began off its control before the control's banner appeared or moved, and consumes the press record.
  - A window `pointerdown` capture listener (`pressBegan`) notes presses that begin off the stack. It is removed on exit with the others.
  - The release handler no longer forgets the ignored control.
  - Two one-line hunks in FH-08's functions: `markMoved([b], false)` where `renderTeaching` adds the card and where `showFailureTeaching` adds the failure note. Their buttons appear inside a banner that may not move itself.
  - Comments updated where they described the old window (constants, fields, constructor, `markMoved`, `dock`).
- `tests/game/emergencyBannerClick.test.ts` (new): 13 cases, listed below.
- `tests/game/emergencyBanner.test.ts`: the tests that pinned the old window, listed below.
- `docs/dev/reports/local-T085-banner-station.md`: this section.

No hunk outside the named file and tests. No `src/sim/**`, `src/worker/**` or CSS change. Round 1's station note and E1a timing are untouched.

### Tests

New, `tests/game/emergencyBannerClick.test.ts`. Events are delivered in the browser's order (window capture, stack capture, the control's own listeners) on a fake clock, and `requestAnimationFrame` never calls back.

1. a press that began before the banner appeared sends nothing: pointerdown on the map, the banner slides in under it, pointerup and click on its Send nearest
2. a press that begins 30 ms after the banner appeared sends with one click — so does one in the millisecond it appears
3. a press that began before the banner appeared, its pointerdown handled after the long task that added it, is ignored; a pointerdown time of another clock is not believed
4. a reflow that moves another banner's button under a pressed pointer sends nothing; the control the press began on still clicks
5. keyboard activation works at once: Enter / Space on the focused button is a click without a press — also while a pointer press from before the banner is still held
6. touch: a tap sends once although its click is a later task than its release; a finger down since before the banner sends nothing; an ignored tap stays ignored
7. touch: a tap that lands beside the button, its click moved onto it by the browser, sends when the banner was in place — not when the tap began before the banner
8. FH-08: the first-lesson card appearing in a banner already in place counts as its buttons appearing; then one click on its Send nearest sends and closes it
9. FH-08 / round 1: a dropped click on a loading card is no action — E1a stays unseen; the keyboard's Got it acts at once
10. FH-08: the folded-stack fallback card stays operable — a press on its Send nearest sends with one click; unfolded, the card is back in its banner and takes a press at once
11. FH-08: the failure note appearing in a banner counts as its button appearing
12. a click that follows no press of its own (a tool that sends only the click) is never ignored, whatever was pressed before it
13. exit: the window keeps none of the banner's listeners, the press listener included

Existing tests updated, all in `tests/game/emergencyBanner.test.ts`. Each asserted that a press right after a move is ignored, which is the rule NOTE-081 retires. In each, that press is now one that began before the move (still ignored), followed by one that begins after it (counts at once). No other assertion changed.

- `c1 …` (renamed `c1 / NOTE-081: a press that began before a flyout re-docked the stack is ignored — …; one that begins after the move sends at once`). It had three ignored presses: before the move's first frame, after one frame, and 349 ms after the second. It then sent at 351 ms. The pill part changed the same way.
- `c4 / EM-3: an upper banner resizing from 150 to %i guards only the banners below it …` (two cases). It read `settleGen`; it now reads `movedAt`.
- `c2 (audit c2 #2): the settle guard holds only the banners that moved …`. The flash and the denied sound are still asserted.
- `c2: with the capture a drag off the pressed control still cancels it; …`. Only the clock value changed, because the `SETTLE_MS` import is gone.
- The `press()` helper takes an optional time at which the press began. The file's header comment and its import line changed with it.

### Validation

All run here through quietrun, one process at a time.

- `npx tsc --noEmit`: passed.
- `tests/game/emergencyBannerStation.test.ts` 10, `emergencyTeachingSeen.test.ts` 14, `emergencyBannerClick.test.ts` 13, `emergencyBanner.test.ts` 38: 75 passed.
- `tests/game/emergencyLive.test.ts` 10, `emergencyOutcomePolicy.test.ts` 1, `emergencyOutcomes.test.ts` 24, `emergencyPolicy.test.ts` 35, `emergencyTeaching.test.ts` 35, `emergencyTeachingToasts.test.ts` 12: 117 passed.
- `tests/worker/emergencyTeachingHost.test.ts` 11, `emergencyTeachingWorker.test.ts` 1: passed.
- `tests/worker/hygiene.test.ts`: 18 passed when run alone, twice. Run in one invocation with the two worker files it timed out twice at the default 5 s, on different scan cases each time (`W0.2` once; `W0.4` and `NOTE-041` the second time), with about 50 node processes on the machine. No assertion failed. Alone, its scans took 2.3 to 4.8 s each, so that file sits close to its timeout under load. The timeouts are load, not this change.
- Extra, not asked: `emergenciesPanelBusy`, `emergenciesPanelWaiting`, `panelsMisc`, `uiStacking`: 26 passed.
- Mutation checks. Each of these 14 changes to `EmergencyBanner.ts` failed at least one test in the two banner files, and the file was restored byte for byte after each:
  - the 350 ms window back (13 tests failed);
  - the mark waiting two frames again (14);
  - no click-time check (8);
  - no window press listener (4);
  - no keyboard return (1);
  - the ignored press forgotten at its release (1, the touch case);
  - moves after the press also dropping the pressed control's click (1);
  - the handling time instead of the event's time (9);
  - any event time believed (1);
  - every click off its press's control dropped (1, the tap moved onto the button);
  - the press record not consumed (1);
  - no mark for the card (2);
  - no mark for the failure note (1);
  - no mark for the pill (1).
- Not run: the full vitest suite, the bot, any browser. The change is UI and tests only, so the 128x15 seed-7 bot (192,899) is expected unchanged and stays with the lead's gate.

### What the rule no longer covers, and choices for the lead

1. **Presses that begin after a move but were aimed at the layout before it.** These now count. Close-out c1's playtest case is the example: opening Civic re-docks the stack, and a press aimed at banner 0's Jump lands on banner 1's. That press is ignored only when it began before the re-dock. This follows from "must dispatch at once, however soon". The other side of it: rapid triage (audit c2 #2) no longer loses clicks.
   - T017's playtest (`local-T017-playtest-c4.md`, "A banner that just moved under the pointer") pressed 80–270 ms after a slide and found 7 of 7 guarded. Re-run, those presses now dispatch the banner that slid in.
   - `docs/dev/qa-W0.4-livepolicy.md` line 63 still tells the tester to allow 350 ms after a layout move before clicking. That wait is no longer needed. I left the file alone, as the task does not name it.
   - If the reaction window should stay for reflows only (another banner's button sliding under a resting pointer) and go for new banners, that is a different rule from the note's. It needs your call.
2. **Appeared means put in the page, not painted.** A press that begins in the frame or two between the two counts. The old stamp waited for the second frame. I did not keep that wait, because two frames take up to 33 ms at 60 Hz and longer when frames are slow or not painted, so "30 ms after it appears" could still be ignored. If you want the paint wait back, `markMoved` is the one place to change.
3. **`PRESS_LAG_MAX` = 1000 ms** is my choice. It bounds how old a pointerdown's own time may be and still be believed. A foreign clock then costs at most a one-second window after a move, never a dead banner.
4. **Not tracked, as before:** changes inside a banner that keeps its place (its Send button hiding once help is on the way, a note wrapping), and the pill appearing for a dismissed alert. The folded-stack fallback card sits outside the stack and is not guarded.
5. **One known false ignore.** A touch tap that begins beside a button, and that the browser moves onto it, is dropped when its banner is marked between the tap's start and its click. A banner below a new one is marked once more when the new one's height is first measured.

Requests for cloud-held files: none.

### Plan against code: Send nearest is disabled while its options load (packet hosts)

This is not the click rule, but it gives the same symptom, and the 350 ms window used to hide it.

- On `?simworker=loopback` and `?simworker=1` a new banner's Send nearest reads "Loading…" and is disabled until its dispatch options have arrived and a UI tick has shown them. `PacketWatch.value` is `undefined` until the worker's reply, and the banner refreshes its button only on UI ticks (every 160 ms, `CityScene`). So the button stays disabled for the reply's round trip plus up to one UI tick after the banner appears.
- A click in that time does nothing. The browser sends no click to a disabled button, so there is no flash and no denied sound.
- On the default host the options are read at once (`LocalWatch.value` runs the query), and the button is enabled from the banner's first render.
- FH-08's card has the same state for its own Send nearest ("Loading dispatch options…").
- A player cannot click that fast; a driver can. For the checklist's first item, click once the button reads "Send nearest".
- I changed nothing here. FH-08's and round 1's tests pin the disabled loading state. If a click in that state should dispatch, there are two ways: refresh the button when the reply arrives instead of at the next UI tick, or let Send nearest act while its options load (the host picks the unit itself). That needs your call.
- Checked with a node probe on the real hosts (a temporary test, deleted after the run). Local host: the banner's first render has Send nearest enabled. Loopback: the banner appears reading "Loading…" and disabled, stays so through the next host frame and its drain, and reads "Send nearest" after the next UI tick. Not measured in a browser, and not probed on `?simworker=1`.

### Not verified

- No browser was run (lane rule). The new tests encode these assumptions about browsers, which the checklist below should confirm:
  - a mouse's click goes to the element that held the pointer or to the common ancestor of press and release, so a mouse press that began off a button never clicks it;
  - a tap's click is delivered after its release, in a later task, and may go to the element under the finger at that moment;
  - a keyboard click has `detail` 0;
  - `event.timeStamp` of a pointerdown is on `performance.now()`'s clock in current browsers.
- The three hosts, real-GPU behaviour, the full suite and the bot.

### Browser checklist

Repeat on the default host, `?simworker=loopback` and `?simworker=1`. In the default host the banner is added inside the frame that runs the sim tick, which is where a pointerdown's own time matters. In the worker hosts a short message task adds it.

- [ ] **One real click right after the pause.** Set Settings → "Uncovered emergencies" to Pause, or use a fresh profile whose first uncovered major fire pauses for FH-08's card. As soon as the game pauses for a new banner, click Send nearest once, as fast as the driver allows, and also 30 ms after the banner's element appears. The unit goes with that one click: the dispatch toast shows, the banner says help is on the way, there is no flash ring and no denied sound. Five new banners, five of five. On the two packet hosts, click once the button reads "Send nearest": until its options arrive it reads "Loading…" and is disabled (see "Plan against code").
- [ ] The same on the first-lesson card's own Send nearest, once its text names the station.
- [ ] **A click in flight.** With no build tool selected, hold the mouse button on the map where the banner's Send nearest will be, let the banner slide in under the pointer, then release. Nothing is dispatched and the incident still waits. With a mouse the browser gives that click to the map, so the banner does not flash. With touch (device emulation or a touch screen) the tap's click may land on the banner: it flashes, the denied sound plays, nothing is sent. Then one click on Send nearest dispatches.
- [ ] **A reflow under a pressed pointer.** With three or more banners, press and hold Send nearest (or Jump) on a lower banner while a banner above it leaves, then release without moving the pointer. The click acts on the banner that was pressed. The banner that moved under the pointer is not dispatched.
- [ ] **Keyboard.** Focus a new banner's Send nearest and press Enter or Space as it appears: dispatched at once.
- [ ] **Rapid triage.** With several banners, click Send nearest on each about 300 ms apart while the banners above resolve and the rest move up. Every click aimed at the button now under the pointer counts.
- [ ] **Close-out c1's case, for the record.** Open Civic so the stack re-docks. A press that begins after the re-dock acts on the banner now under the pointer (choice 1 above).
- [ ] **EM-4 and c2 still hold.** A press on Send nearest that closes the flyout still clicks, with no re-dock until the release. A press dragged off the button and released does nothing. A press released on its button after the banner moved away still sends.
- [ ] **FH-08 and round 1.** The card's Send nearest, Emergency view and Got it, E1b's tab and the failure note's tab each work with one click. The folded-stack fallback card stays operable at a narrow layout with a centred panel. E1a stays unseen while the card shows "Loading dispatch options…" and nobody acted. The note names the station Send nearest sends.
- [ ] Exit to region and enter a city again: the banners work, and no listener of the old city remains.

## After the dev merge (T047's Follow, FEEL-09)

Dev `080676d` is merged into `8171cd3`; the merge is left uncommitted. One file conflicted, `src/ui/EmergencyBanner.ts`, in two hunks, both against T047: the Follow button, its "Following …" chip, and the banner kept while its unit can be followed. The bot reference is now dev's after B2: residents [ 61828, 95515, 40772 ] = 198,115, where the sections above say 192,899.

### The conflict

- **The import from `sim/infra/emergency`.** Round 1 added `RESPONDER_LABEL`; T047 added `type EmergencyDispatchEvent`. Both are kept.
- **`addBanner`: Dismiss and the banner's record.**
  - Dismiss forgets the follow candidate (T047) and counts as the player's action for E1a (round 1's `acknowledgeTeaching(inc.id, true)`).
  - The record carries T047's `follow` button and round 2's `movedAt: 0`. T047's `settleUntil: 0, settleGen: 0` went with the settle window.
- Git merged the rest. Compared with each side, the merged file holds exactly the other side's changes, apart from that record line.

### What the Follow button needed

- **T047's code and the old settle state.** It set that state in one place, the record above, and read it nowhere. Nothing in it relies on a press being ignored for 350 ms after a move:
  - the Follow click has its own guard: the button hides while the camera follows, and a second click restarts nothing;
  - the chip re-docks the stack through `dockDirty`, and a re-dock marks the banners it moved, as for any other cause;
  - a banner kept for Follow leaves the stack like any other.
- **Already under the rule.** Follow is a `button` in its banner, so the stack's handlers treat it as they treat Jump and Send nearest. A press that began before its banner appeared or moved is ignored, with the flash and the denied sound. A press that begins after counts at once. A keyboard click (`detail` 0) skips the check.
- **One hunk: the button appearing.** Follow appears in a banner that keeps its place, when the reply to the player's dispatch arrives. After Send nearest it lands where Send nearest or Choose station… was. `refreshFollowButton` now calls `markMoved([b], false)` each time the button goes from hidden to shown, as round 2 does for FH-08's card and failure note. So a press that began before the button appeared is ignored, and one that begins after it follows at once.
  - Without the hunk, a finger that was down on Send nearest when the reply arrived started Follow when it lifted (test 2 below).
  - On the default host the 'dispatched' event comes inside the Send nearest click, so the button is marked within that click. The next press begins later and counts.
  - On the packet hosts the button comes with the reply.
  - The button is marked again each time it comes back after the camera lets go.
- The comment on `PRESS_LAG_MAX` names Follow next to FH-08's card.

### Tests

- `tests/game/emergencyBannerClick.test.ts`: 8 new cases in a second block, "NOTE-081 after the dev merge (T047, FEEL-09): the Follow button under the click rule". The harness's `mount` takes an optional `follow`: with 'local' the 'dispatched' event comes inside the command, with 'packet' the test delivers it by `reply`. The 13 cases of round 2 are unchanged.
  1. Follow appearing in a banner already in place counts as its button appearing: a press from before follows nothing, one that begins after it follows with one click — again when the camera lets go and the button is back
  2. touch, a double tap on Send nearest: the second tap's finger is down on it when the reply puts Follow in that button's place — its click follows nothing and sends nothing twice
  3. a press that began before Follow appeared, its pointerdown handled after the task that showed it, is ignored; one begun 1 ms after it appeared follows at once
  4. on the default host Follow is there before the Send nearest click is over: that click still sends, and the next press follows at once; so does a click with no press of its own
  5. keyboard: Enter / Space on the focused Follow button follows at once — also while a pointer press from before is held, and after a press on it was ignored
  6. the Dispatch tool's own press: its dispatch adds the banner, Follow on it, under the finger still down — that press's click follows nothing, the next press does
  7. following: the chip takes its row and the stack goes compact — a press that began before that move is ignored, one that begins after it clicks at once; the same when the camera lets go
  8. after a support-only dispatch the row keeps Send nearest and Choose station… beside Follow: Send nearest and Follow each take a press at once
- **No dev test pinned the 350 ms window for Follow, so none was changed.** T047's `emergencyFollowBanner.test.ts` clicks through the stand-in DOM's `click()`, which runs the button's own listeners and not the stack's; `emergencyFollowScene.test.ts` tests the scene's wiring. Both pass with every assertion as dev has it.
- Mutation checks on the merged `EmergencyBanner.ts`, restored byte for byte after each. Every new case fails under at least one:
  - no mark when Follow appears: tests 1, 2, 3 and 5 fail;
  - a mark for its first appearance only: test 1 fails;
  - a 350 ms window after each mark, as before round 2: tests 1 to 4 and 6 to 8 fail, with 9 of round 2's;
  - no click-time check: tests 1, 2 and 6 fail, with 8 of round 2's;
  - the time a pointerdown is handled instead of its own: tests 3, 5 and 7 fail, with 5 of round 2's;
  - no keyboard return: test 5 fails, with round 2's keyboard case.
- A probe on the real local and loopback hosts (a temporary test, deleted after the run; its output is in the scratchpad folder `T085merge`):
  - local: Follow is shown and marked inside the Send nearest click; loopback: after it, with the reply;
  - on both, a press begun 3 ms before the button appeared is ignored with the flash and the denied sound, and one begun 1 ms after it follows;
  - the chip reads "Following Fire truck from Fire #2", the station round 1's note names and Send nearest sent.

### Validation

All run here on the merged tree, through quietrun, one process at a time.

- `npx tsc --noEmit`: passed.
- The lane's files: `emergencyBanner.test.ts` 38, `emergencyBannerClick.test.ts` 21, `emergencyBannerStation.test.ts` 10, `emergencyTeachingSeen.test.ts` 14: passed.
- T047's: `emergencyFollowBanner.test.ts` 23, `emergencyFollowScene.test.ts` 7, `tests/render/cameraFollow.test.ts` 24, `emergencyFollowPosition.test.ts` 7, `emergencyDrawnMotion.test.ts` 5, `emergencyTurnClearance.test.ts` 24, `tests/infra/emergencyFollowDispatch.test.ts` 9: passed.
- The other `tests/game/emergency*` files: `emergencyLive` 10, `emergencyOutcomePolicy` 1, `emergencyOutcomes` 24, `emergencyPolicy` 35, `emergencyTeaching` 35, `emergencyTeachingToasts` 12, `emergenciesPanelBusy` 2, `emergenciesPanelWaiting` 1: passed. `uiStacking.test.ts` 13, `panelsMisc.test.ts` 10, `cityDisposeCanvas.test.ts` 2: passed.
- `tests/worker/emergencyTeachingHost.test.ts` 11, `emergencyTeachingWorker.test.ts` 1, `emergencyReads.test.ts` 2, `dispatchCause.test.ts` 5: passed.
- `tests/worker/hygiene.test.ts`: 18 passed when run alone (slowest scan 3.6 s). The run before it, started right after the worker files, timed out on two scans at the default 5 s (7.4 s and 5.1 s) with other lanes' processes on the machine. No assertion failed. This is the load round 2 reports above.
- The bot, `SIMBOT_LOG=1 npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`: **residents [ 61828, 95515, 40772 ] = 198,115**, dev's reference. The lane changes no sim code.
- Not run: the full vitest suite and any browser.

### Choices and requests for the lead

1. **The mark is the banner's**, as for FH-08's card. So a press on that banner's other buttons that began before Follow appeared is ignored too.
   - After Send nearest that is right for Choose station…, which moved into Send nearest's place.
   - Jump and Dismiss did not move, and neither does Send nearest in the four-button row. A press on them is ignored only when it began before Follow appeared and is handled after it.
   - A mark for the Follow button alone would spare them. `movedSince` is the place for it.
2. **Not tracked, as in round 2's list (item 4): shifts inside a banner.** With Follow in the row, Send nearest hiding moves Choose station… and Follow to the left. A four-button row may wrap; the banners below it are marked once the taller banner is measured.
3. **A double click on Send nearest in a compact banner** lands its second click on Follow, which appeared in that place, and the camera follows. The second press begins after the button appeared, so the rule lets it through. Dev did the same before this merge, because the banner does not move. Guarding it needs a time window on a new button, which NOTE-081 retired.
4. **Request for a file T028b owns:** `tools/qa-worker/driver.mjs:190` reads `b.settleUntil`, which is gone. Its comparison with `undefined` is false, so `banner()` no longer waits and clicks as soon as the button is enabled, which the new rule allows. The line should read `if (!b) return null;`. I did not edit it.

### Recheck list (browser, the three hosts)

No wait is needed before any click below. A script that waited for `settleUntil`, or for 350 ms after a move, can drop the wait.

- [ ] **Round 2's checklist above, all ten items.** What Follow changes in them:
  - after the one real click on Send nearest, the banner also shows Follow, and it stays in the stack while the unit drives;
  - in rapid triage a dispatched banner moves below the waiting ones at the next UI tick, with its Follow button.
- [ ] **Follow, one real click.** Click Send nearest, then click Follow once as soon as it is visible, and also 30 ms after. The camera goes to the unit, the chip reads "Following <unit> from <station> · N min", the button hides, and there is no flash ring and no denied sound. Five dispatches, five of five. On the default host Follow is there when the Send nearest click returns; on the two packet hosts it comes with the reply.
- [ ] The chip's station is the one the note named and Send nearest sent (round 1).
- [ ] **A press from before the button.** On a packet host with touch emulation and a compact banner, tap Send nearest twice so that the second finger is still down when the reply arrives. Nothing follows and nothing is sent twice; the banner flashes and the denied sound plays. Then one tap on Follow follows.
- [ ] **Keyboard.** Tab to Follow and press Enter or Space as it appears: the camera follows at once.
- [ ] **The Dispatch tool.** Choose station…, then click a station. Follow appears on the banner, or the banner appears for an incident that had none. One click on Follow follows. With touch, the tap that sent the unit does not also start Follow when the new banner appears under the finger.
- [ ] **The four-button row.** Industrial accident, ambulance sent by the player, fire truck missing: Jump, Send nearest, Choose station… and Follow. The row may wrap at 440 px. Each button takes one click, nothing overlaps, and the banners below take a press that begins after they moved down.
- [ ] **The chip and the stack.** At 1280x720 with several banners, click Follow: at the next UI tick the stack may go compact for the chip's row. A press that begins after that move acts at once. Release Follow by a drag, the wheel, W/A/S/D, the banner's Jump and the minimap: the chip goes in the same frame, Follow is back, and one click follows again.
- [ ] **Choice 3, for the record.** Double-click Send nearest in a compact banner and note where the second click lands. By the rule it starts Follow. In a full banner it lands on Choose station…, as before T047.
- [ ] **FH-08 with Follow** (T047's Desktop QA 5b). Fresh profile, tips on: the card's Send nearest sends, Follow appears in the row above the card, E1a is seen as round 1 says, and one click on Follow follows.
- [ ] **T047's Desktop QA list** in `local-T047-feel09-follow.md`, lines 1 to 8, with real clicks and no waits before them.
- [ ] Exit to region while following, then enter a city again: no chip, the camera is free, the banners work, and no listener of the old city remains.
