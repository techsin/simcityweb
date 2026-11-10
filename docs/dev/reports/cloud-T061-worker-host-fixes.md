# T061: the loopback and worker host fixes the desktop's round-2 lanes found

Branch `cloud/t061` (worktree `scratchpad/co/t061`), a new lane from dev `086152a` (T034 with T034b merged, `5c40d77`).
Task: docs/dev/queue/T061-worker-host-fixes.md, items 1-7. NOTEs that name it: NOTE-049 (T048's requests), NOTE-054
(T051's plant loads, item 5), NOTE-055 (FH-08's `policy.teaching`, item 6), NOTE-057 (the merge order), NOTE-058 (T036
step 4's B9, item 7); NOTE-044 (the cloud carry-over). The lead's brief adds T034b's three review findings: F1 (the
speed override's shadowing), F2 (the crash dialog under the city HUD) and F3 (qa-worker does not gate the protector
control's `observable`).

## Cloud carry-over (Nov 3)

### Gap list (what was required, against what dev held when this lane started)

Sources: the task file, the NOTEs above, WORKER_DESIGN §3.5 (the main-thread sim clock), the T048 report's requests
(`cloud/t048`, docs/dev/reports/local-T048-feel10-outcomes.md), the T047 report's N2 (`local/T047-feel09-follow`), the
T034b section of docs/dev/reports/local-W1.2-worker.md (B4) and its review logs (`co-review/t034b-logs`: the nested
speed experiment and the crash dialog's stacking probe). No desktop branch exists for this lane: nothing was saved
mid-edit.

| # | required | state on dev `086152a` | left for this lane |
|---|---|---|---|
| 1 | speedChanged order: a handler that re-reads `host.speed` inside a packet's `speedChanged` reads the new speed, on both packet hosts; one test for both | WorkerSimHost reads the packet's clock speed while a packet is applied (T034b's `packetSpeed` override); PacketSimHost (so LoopbackSimHost) still moves its mirror only in the clock hook, after the log replay | **do it** in PacketSimHost for both hosts; one test over both hosts |
| F1 | the override shadows a speed command the page posts while a packet is applied | latent in WorkerSimHost (`packetSpeed` stays set while a handler posts setSpeed); the reviewer's nested experiment reproduced it | **fix it, with a test** |
| 2 | the clock at day boundaries: no stop-then-leap, monotonic, never more than one packet interval ahead; a vehicle steps evenly across 3 day boundaries on the loopback (within 1.5x the median step) | `simTime()` caps at `day + 0.999` until the next day's packet; shared by WorkerSimHost | **do it**, with the test |
| 3 | `Cause.dispatchIncidentId` through SimHost, LocalSimHost.act, PacketSimHost and the replica; tests on the local and packet hosts | not present (Cause is `{ seq, tag }`) | **do it** |
| 4 | WorldView rebuilds from the new state after a resync | **done by T034**: CityScene passes `getState: () => this.sim.state` (CityScene.ts:491), WorldView's `reset` handler calls `setState(this.getState?.() ?? this.state)` (WorldView.ts:393), tests/worker/worldResync.test.ts | verify, mark done |
| 5 | forward `utilities.plantLoad(id)` on both packet hosts to the replica's id→load map | T051 (the stream, the recorder, the replica map, `UtilitiesView.plantLoad`) is **not in dev** (`local/T051-feel15-smoke`, wave 1 after T040) | blocked on T051: decide |
| 6 | `policy.teaching` on the worker host | T036 step 5 (the `teaching` field, its getter in PacketSimHost) is **not in dev** (`cloud/t036s5`, in its own chain) | blocked on T036s5: find the worker host's gap and decide |
| 7 | save errors keep their name (and message) through the reply, on both packet hosts; a quota failure on the loopback opens the same dialog as on the local host | `ProtocolInbox` replies `{ ok: false, error: errorText(e) }` (protocolInbox.ts:143, :162); `PacketSimHost.settle` rejects `new Error(reply.error)` (LoopbackSimHost.ts:463, :471). The guided quota dialog (`isQuotaError`: `name === 'QuotaExceededError'`) is T036 step 4's, **not in dev** | **do it**; the dialog check stands in as a name check, the dialog itself goes to the Desktop QA |
| F2 | the crash dialog top-most over the city HUD, with a stacking test | the dialog's backdrop is the region screen's `.modal-back` (z 40, meta.css); the city HUD's layers reach z 95 (`.hud-tl` 50, `.emg-banners` 55, toasts 60, `.err-stack` 80, tips 90 and 95): the reviewer clicked the toolbar through the open dialog | **do it** |
| F3 | qa-worker fails the run when the protector control is not `observable` | logged as a NOTE; the protector steps then check only that the probe was made | **do it** |
| G | gates: tsc, the full vitest, the worker hygiene test, the bot identical to dev (`residents [ 61124, 93804, 37971 ]`); the browser checks go to the desktop (NOTE-059) | — | run them; the Desktop QA list |

### What this lane did

Commits on `cloud/t061`: `7775b55` (items 1, 2, 3, 7 and F1), `4cd4e3c` (F2), `9cf66ca` (F3), `6f6a983` and its revert
`d932aaa` (item 6, below), `259e0bf` (dev `2320c45` merged in: T040 and the Nov 4 handoff, no shared file), `825d1df`
(dev `87c7c9c` merged in: T053, no shared file), and this report with the done line.

**The resumed run (Nov 9).** The first run stopped at the shared usage limit on Nov 4, at 04:08 UTC, just after it
queued its gates: `scratchpad/t061-gates/` holds an empty vitest log and no bot result, so no gate had run. The resumed
run:
- read the Nov 4 handoff (docs/dev/handoff/2026-11-04/README.md). It lists this lane as chain worker3 at its finish
  step. There is no WIP patch and no bundle for `cloud/t061`, and the worktree held only this report uncommitted, so
  nothing was lost;
- re-read the task file, NOTE-044, -049, -054, -055, -057, -058 and -059 against the lane's diff. The code, the tests and
  the mutation results above stand. Dev's T053 touched none of the lane's files;
- merged dev (`825d1df`, clean), re-ran the trial merges and the W1.3 merged tree (below), then ran every gate on
  `825d1df`.

1. **Item 1, the speedChanged order** (`replica.ts`, `LoopbackSimHost.ts`, `WorkerSimHost.ts`).
   - The replica calls a new `speed` hook for each `speedChanged` of a packet's log, just before it emits it.
     PacketSimHost's `rebaseSpeed` then sets the mirror to that entry's speed, and re-applies any setSpeed / resume of the
     page's that is newer than the commands acked so far. This is per entry, not per packet, so a handler sees the speed
     the authority had at that point of its log, as on the local host. The clock hook after the log is unchanged.
   - Both packet hosts share it. WorkerSimHost's `packetSpeed` / `speedSeq` override (T034b's B4) is removed, as its own
     comment asked once T061 landed.
   - **F1** goes with it. The override returned the packet's speed for the whole packet, so a `setSpeed` posted by a
     handler inside the packet read back as the packet's speed: the reviewer's nested experiment read `[0,0],[0,0]` where
     `[0,0],[2,2]` was due. The optimistic write now sets the mirror itself, and nothing overrides it.
   - Test: `tests/worker/workerSpeed.test.ts` runs three cases on both hosts, the loopback and the real worker
     (worker_threads):
     - the urgent pause reads `[{ event: 0, speed: 0 }]`;
     - with a newer `setSpeed(2)` held back on its way, it reads `[{ 2, 2 }, { 0, 2 }]`;
     - **F1**: a `setSpeed(2)` posted inside the pause's handler reads 2 in its own optimistic event and right after the
       call, and still reads 2 after the packet and after the authority's own `speedChanged(2)`.
2. **Item 2, the clock at day boundaries** (`PacketSimHost.simTime`, shared by WorkerSimHost).
   - **The cause.** The old prediction stopped at `day + 0.999` until the next day's packet arrived. That packet comes
     late by the day's own work: on the worker's thread, or on the loopback's microtask after the frame was drawn. So
     every vehicle stopped, then leapt.
   - **The prediction** runs on past the day's end. It is capped at `CLOCK_LEAD_MS` (500 ms) of sim time past the last
     packet's time (at most one day). It does not run past a day's end that the authority holds at (`frac` 1: the New
     Year hold, maxDaysPerFrame), or that the page itself asked to hold at (`holdCalendar(true)`, NOTE-041).
   - **What is shown** advances at the real rate. It is nudged towards the prediction over about 250 ms, and the nudge
     never changes a frame's step by more than a quarter. It never goes back. A gap larger than the lead is taken at
     once: a resync starts from the adopted clock. The facade's `dayFraction` is clamped to 0..1.
   - Test: `tests/worker/packetClock.test.ts`, on the loopback with a fake clock, modelled as the browser runs it: a frame
     posts its tick, draws, then the tick runs. The day's packet reaches the page 40 ms late (about a 1M city's day,
     WASM_PLAN M3), and the packets behind it wait for it.
     - At LIVE, an ambulance's per-frame step across 4 day boundaries (288 frames) is **1.115x the median at most and
       0.748x at least**. The old code gives **4.0x and 0** (a full stop, then the leap). The gate is within 1.5x.
     - With the transport stopped, the clock runs on to the last packet's time plus one day at 1x (the old cap stopped at
       0.999 of the day), and no further. It never goes back. Once packets resume, it is within a tenth of a day of the
       authority.
     - With the page's hold, it stays in its day before the authority's held packet arrives, and moves on after the
       release.
     - After a resync, it starts at the adopted `day + frac`.
3. **Item 3, `Cause.dispatchIncidentId`** (`SimHost.ts`: the Cause type, `dispatchIncidentOf`, `LocalSimHost.act`;
   `replica.ts`: the cause hook; PacketSimHost, which reads the unacknowledged command from `edits`).
   - Test: `tests/worker/dispatchCause.test.ts`, on the local, loopback and worker hosts.
   - A clinic beside the home answers a major medical incident by itself (`answered` 1, one ambulance short). The
     player's `dispatchBest` and a further `dispatch` from a far clinic both name the incident in the cause, with their
     seqs and tag. `answered` stays 1.
   - A `triggerDisaster` fire, which the city answers inside the command, names none.
4. **Item 4, the resync rebuild:** verified as done by T034 (the gap list's row 4; tests/worker/worldResync.test.ts
   passes in the gates). Nothing to change. The fallback views (FallbackWorldView / FallbackObjectsView) still miss a
   resync, as T034's decision 9 says. That is outside item 4.
5. **Item 5, plant loads on the packet hosts:** **not done.** It is blocked on T051, which is not in dev. See the
   decisions.
6. **Item 6, `policy.teaching` on the worker host:** WorkerSimHost has no gap of its own. The getter T036 step 5 adds
   is in PacketSimHost's policy object (LoopbackSimHost.ts), which WorkerSimHost inherits.
   - The worker's real gap was its recorder: simWorker.ts listed the view's fields and would drop `teaching` from every
     packet.
   - `cloud/t036s5` already fixes that line itself (`5d515bd`, with tests/worker/emergencyTeachingWorker.test.ts on the
     real worker).
   - This lane's generic version (`6f6a983`) conflicted with it on the same two lines, so `d932aaa` reverts it. See the
     decisions.
7. **Item 7, save errors keep their name** (`protocol.ts`: `errorName` on failed `saved` / `snapped` replies,
   `errorName()` and `replyError()`; `protocolInbox.ts` fills it; `PacketSimHost.settle` rebuilds the Error with it).
   - On the worker host with persistence 'main', main's own put already rejected with the browser's error. The
     worker-side replies (and W1.3's 'worker-idb') go through the shared path.
   - Test: `tests/worker/saveErrorName.test.ts`.
     - A store full of `cities` (a `QuotaExceededError` DOMException) makes the local, loopback and worker hosts reject
       the save with an Error named `QuotaExceededError`, with the same message. That is T036 step 4's `isQuotaError`,
       which opens the guided dialog.
     - A full `recovery` store gives the loopback's snapshot the same name.
     - `errorName` / `replyError` carry a name only where there is one.
8. **F2, the crash dialog's z-order** (`dialogs.ts` `openSimCrashDialog` adds `.modal-top`; `meta.css`
   `.modal-back.modal-top { z-index: 100 }`).
   - The region screen's modal backdrop is z 40. The city HUD's layers go up to 95: `.hud-tl` 50, `.emg-banners` 55,
     toasts and insight 60, the save pill 70, `.err-stack` 80, tips 90 and 95.
   - Test: `tests/game/crashDialogStacking.test.ts`. It opens the dialog in the fake DOM and checks the class. It then
     checks that no z-index in src/ui/*.css, in meta.css's other rules, or in the inline styles of src/game and src/ui
     reaches the crash dialog's (32 layers scanned, the highest 95). The HUD's own modal (60) and the region modal (40)
     are below it.
9. **F3, qa-worker's protector control** (`tools/qa-worker-control.mjs` with its `.d.mts`; qa-worker.mjs uses it).
   - "a detach of a buffer with two views deoptimizes the probe" was a logged NOTE. It is now a `check`, so a control
     that is not observable FAILs the run (exit 1).
   - Test: `tests/worker/qaWorkerControl.test.ts`.

**Each new test fails with its fix reverted** (scripts and logs in `scratchpad/t061-mut/`):

| mutation | result |
|---|---|
| M1: no speed hook in the replica | 4 of 6 workerSpeed cases fail (the pause case and F1, on both hosts) |
| M2: WorkerSimHost's override restored (dev's file) | the worker's F1 case fails |
| M3: the old `simTime` | the even-steps case (4.0x, min 0) and the run-on case (stopped at day + 0.999) fail |
| M3b: no hold cap | the hold case fails (after the hold case was made to start mid-day; before, it passed by chance) |
| M3c: adopt resets to the day start | the resync case fails |
| M3d: no nudge clamp (snap to each packet) | the even-steps case fails |
| M4 / M4b: no incident in the replica's cause / in LocalSimHost.act | the loopback and worker / local cases fail |
| M5 / M5b / M5c: plain Error in settle / no errorName in the inbox / plain Error for a snapshot | the save case / the save case / the snapshot case fail |
| M6 / M6b: no `.modal-top` / `z-index: 60` | the stacking case fails |
| M7: the observable verdict always ok | the control case fails |
| M8 (item 6's helper, before its revert) | its unit case failed; moot after `d932aaa` |

**Trial merges** (`git merge-tree`, then throwaway worktrees for the three nearest lanes, removed afterwards):

- `cloud/t061` merges cleanly with each of `cloud/w13`, `cloud/t036s5`, `local/T051-feel15-smoke`, `cloud/t048`,
  `cloud/t036s4`, `cloud/t053`, `cloud/r1`, `cloud/b2m`, `cloud/t037b`, `cloud/t054`, `cloud/t058`, `cloud/t059`,
  `cloud/t057` and `cloud/t060feel01`. Before `d932aaa`, t036s5 conflicted in simWorker.ts and T051 in recorder.ts.
- In the merged trees:
  - **t061 + t036s5**: tsc clean. FH-08's emergencyTeachingHost (loopback), emergencyTeachingWorker (the real worker),
    emergencyTeaching, emergencyTeachingToasts and emergencyPolicy pass, with this lane's tests: 8 files, 109 tests.
  - **t061 + t048**: tsc clean. FEEL-10's emergencyDuckHold, emergencyStings, emergencyLive, emergencyOutcomePolicy and
    emergencyOutcomes pass, with gameSounds, emergencyBanner, workerSpeed and dispatchCause: 9 files, 103 tests.
  - **t061 + w13**: tsc clean. W1.3's workerRecovery, hosts, workerTransport and recovery pass, with saveErrorName,
    packetClock, workerSpeed and hygiene: 8 files, 91 passed, 1 skipped.
- **Re-run on Nov 9**, with the lane at `825d1df` (dev `87c7c9c` merged in), against every `cloud/*` and `origin/local/*`
  branch:
  - **No branch conflicts with the lane in a file where it does not already conflict with dev.** Each branch's conflict
    set against `cloud/t061` equals its set against dev.
  - `cloud/t036s5` (Notifications.ts), `cloud/t037b` (advisors.ts, Notifications.ts) and `cloud/t048` / `local/T048`
    (GameSounds.ts) now conflict with dev itself. Those conflicts come from T053's hunks, which the carry-over log
    already names for those merges, and are not this lane's files.
  - `cloud/w13` (`d04432b`, it merged dev today), `local/T051-feel15-smoke`, `local/T062-sim-aa-envelope-snap`,
    `cloud/b2m`, `cloud/r1`, `cloud/t054`, `cloud/t059`, `cloud/t057` and `cloud/t060feel01` merge cleanly.
  - **t061 + w13 `d04432b`**, in a throwaway worktree that was removed afterwards: tsc clean. workerRecovery, hosts,
    recovery, workerTransport, saveErrorName, packetClock, workerSpeed, dispatchCause and hygiene pass: 9 files, 96
    passed, 1 skipped (`scratchpad/t061-gates2/trial-w13.log`).

### Gates

All on `cloud/t061` at `825d1df` (dev `87c7c9c` merged in), Nov 9-10. Logs are in `scratchpad/t061-gates2/`.

| gate | result |
|---|---|
| tsc (`npx tsc --noEmit`, sem cpu 2) | clean, exit 0, 16 s (`tsc.log`) |
| the lane's tests, item 4's and the worker hygiene test (workerSpeed, packetClock, dispatchCause, saveErrorName, crashDialogStacking, qaWorkerControl, worldResync, hygiene) | 8 files, 39 tests passed (`lane.log`) |
| the full vitest (timing lock, with the bench fixtures) | **242 files passed, 2 skipped; 2,407 tests passed, 7 skipped, 0 failed**, 399 s (`vitest.log`) |
| the bot, 128×15 seed 7, lane | `residents [ 61124, 93804, 37971 ]`, 193k (192,899) in 2015 (`bot-lane.log`) |
| the bot, dev `87c7c9c` from a clean export (`co/t061-devbase`) | `residents [ 61124, 93804, 37971 ]` (`bot-dev.log`). **Identical**: the two logs differ only in the timing columns (econms, totalms, `done in`, ms/day) |
| the task's qa-worker browser gates (item 2's even steps at three boundaries, item 1's duck on the same tick) | moved to the Desktop QA list below (NOTE-059, NOTE-061). Their unit stand-ins are packetClock (item 2) and workerSpeed (item 1), both in the full vitest |
| T034b's F3 gate (qa-worker fails on a protector control that is not observable) | qaWorkerControl.test.ts, in the full vitest. qa-worker itself is Desktop QA item 5 |

**Dev moved during the gates** to `1c2019c`: T058 merged (`0b9bd9d`), plus NOTE-060 and NOTE-061. T058 also edits
`src/region/ui/dialogs.ts` (F2's file), in openSettings, far from F2's hunk. The lane was not merged again, so the
gates above stay on one commit. Instead, a throwaway worktree of `cloud/t061` with `1c2019c` merged in (clean, removed
afterwards) was checked: tsc clean. crashDialogStacking, T058's graphicsFirstRun, graphicsRecommended, graphicsRestore,
notificationsQuestion and playLoadTime, and the lane's tests with worldResync and hygiene pass: 13 files, 81 tests
(`trial-dev.log`). NOTE-060 and NOTE-061 name T061 only for its Desktop QA on the desktop. They add no code item.

### Decisions

1. **Item 5 (plant loads) is left for after T051.**
   - The task forwards `utilities.plantLoad(id)` to "the replica's id→load map". NOTE-054 has T051 add that map,
     `UtilitiesView.plantLoad`, the protocol's utilities stream and the recorder's publishing. None of that is in dev
     (`local/T051-feel15-smoke`, wave 1 after T040).
   - Writing the forwarding against a map that does not exist would mean copying T051's unmerged hunks into this lane,
     which NOTE-057 rules out, or casting to an interface T051 may still change in its review.
   - **The follow-up, once T051 is in dev**, a small lane or at T051's merge:
     - add `plantLoad: (id: number) => this.replica.plantLoad(id),` to PacketSimHost's `utilities` object
       (LoopbackSimHost.ts, beside `waterQualityAt`). WorkerSimHost inherits it.
     - T051's comment on `UtilitiesView.plantLoad?` ("Optional until T061 adds packet-host forwarding") then goes.
     - The test: on the loopback, a plant's load reaches `host.utilities.plantLoad(id)` after a utilities pass, and reads
       null after a resync's adopt until the next stream.
   - Until then, NOTE-054 stands: T051's plants show "unavailable" on the packet hosts, and that is not a T051 failure.
2. **Item 6 stays with `cloud/t036s5`.**
   - The lead asked T061 to check WorkerSimHost and resolve any conflict (NOTE-055). WorkerSimHost needs no getter of its
     own: the policy view is PacketSimHost's.
   - The worker-side gap (simWorker.ts's field list) is fixed on `cloud/t036s5` (`5d515bd`, with a real-worker test).
     This lane's generic copy of the view (`6f6a983`) touched the same two lines and conflicted, so it was reverted
     (`d932aaa`).
   - With the revert, t036s5 merges cleanly over T061, and its teaching tests pass in the merged tree (above).
3. **"One packet interval" reads as WORKER_DESIGN §3.5's 0.5 s.**
   - The clock may run at most `CLOCK_LEAD_MS` = 500 ms of sim time past the last packet's time, and never more than a
     day.
   - The recorder's heartbeat is 250 ms. But a day's packet comes late by the day's work (40 ms modelled; more in a
     month-day unit) after up to 266 ms of heartbeat, and §3.5 itself says the predictor extrapolates over up to
     0.25-0.5 s.
   - With a 250 ms lead the clock would still stop now and then at a late day packet. The lead is one constant if the
     owner wants it tighter.
   - While the authority keeps up, the shown clock trails it (it predicts from the receipt time). The lead only matters
     when the authority stops or falls behind.
4. **The page's own calendar hold caps the clock at its day** (`holdCalendar(true)` until `holdCalendar(false)`). This
   keeps the NOTE-041 countdown's midnight. Without it, the clock could run up to the lead past midnight before the
   authority's held packet arrived.
5. **Speed changes rescale the authority's day fraction.** On the local host, `dayFraction = acc / secondsPerDay`, so
   when LIVE engages (spd x3) the fraction drops to a third and the local clock jumps back.
   - The packet hosts never go back. They now hold for at most the lead, then run at 0.75x until they meet the authority
     (the old code held about 0.5 s at 1x).
   - The jump on the local host is the sim clock's, beside T047's B3 (the pause snap-back), and outside this lane: noted
     for its owner.
6. **Item 7 carries the error's name, not a DOMException.** Main rebuilds an `Error` whose `name` is the worker's.
   T036 step 4's `isQuotaError` reads only the name. On the worker host with persistence 'main', main's own put already
   rejected with the browser's DOMException.
7. **Item 1 moves the mirror at each logged speedChanged, not once per packet** (T034b moved it once per packet, to the
   final clock).
   - In a packet with two speed changes, each handler reads the speed of its own entry, as on the local host.
   - A newer pending speed command of the page's still wins, as in T034b's second case.
8. **F3's verdict lives in `tools/qa-worker-control.mjs`**, so a unit test can read it without a browser. qa-worker.mjs
   imports it.
9. **No browser run on the cloud** (NOTE-059, NOTE-061). No check here decided a merge-blocking question. The browser
   checks are the Desktop QA list below.

### Desktop QA (NOTE-059 and NOTE-061, on the real GPU)

Run it on `cloud/t061` once the lane reaches QA (NOTE-061), or on dev at the merge commit once it lands (NOTE-059).
Push the result into this report on a `local/qa-t061` branch, and message the lead "QA t061: PASS" or "QA t061: FAIL"
with the findings and the screenshot paths.

Pages are served by `npm run dev` (or the production build, `npx vite preview`). `window.__metropolis.city.host` is the
host qa-worker reads. Each item says which hosts it covers: the default host (no flag), `?simworker=loopback`, and
`?simworker=1`.

1. **Item 2: emergency vehicles move evenly across day boundaries at LIVE** (`?simworker=loopback` and
   `?simworker=1`; the default host for reference).
   - **Steps:**
     1. Open `/?quickstart=1&simworker=loopback`. Build a road with a fire station at one end and homes about 40 cells
        down it (out of the station's range).
     2. Set Settings, Emergencies, uncovered to LIVE. Start a fire on a home (the Disasters tool).
     3. When the banner shows LIVE, press Send nearest, and keep the camera on the truck at street zoom.
     4. Paste in the console:
        `const h=window.__metropolis.city.host,d=[];let p=h.simTime(),n=0;(function f(){const t=h.simTime();d.push(t-p);p=t;if(++n<600)requestAnimationFrame(f);else{const s=[...d].sort((a,b)=>a-b),m=s[300];console.log('max/med',s.at(-1)/m,'min/med',s[1]/m)}})()`
     5. Take a screenshot at each of three successive date changes in the top bar.
     6. Repeat the whole item on `/?quickstart=1&simworker=1`.
   - **Expected:**
     - The truck never stops at a date change, then jumps.
     - The console prints max/med ≤ 1.5 and min/med ≥ 0.67 on both packet hosts.
     - The screenshots (3 per host) show the truck moving between them, with no visible hitch.
2. **Item 1: a pause at LIVE engages the duck on the same tick on both packet hosts.** This needs T048 (FEEL-10's LIVE
   duck) in dev. Before that, run only the console part.
   - **Steps:**
     1. Use item 1's city on `?simworker=loopback`, with Settings, Emergencies, uncovered set to Pause, and music on.
     2. Paste `window.__metropolis.city.host.events.on('speedChanged',(s)=>console.log('speedChanged',s,'host.speed',window.__metropolis.city.host.speed))`.
     3. Start a fire out of range: the city pauses by itself.
     4. Repeat on `?simworker=1`.
   - **Expected:**
     - The console line shows the same number twice (`speedChanged 0 host.speed 0`) on both hosts.
     - With T048 in dev, the LIVE duck (the music dip) and the banner change in the same frame as the pause, not a tick
       later.
3. **Item 7: a quota failure on the loopback opens the guided quota dialog.** This needs T036 step 4 (StorageDialog) in
   dev. Before that, check that the error's name is `QuotaExceededError` in the console.
   - **Steps:**
     1. In DevTools, Application, Storage, tick "Simulate custom storage quota" and set it a little above the current
        usage.
     2. Open a city on `?simworker=loopback`, build until a save would grow past the quota, and press Ctrl+S.
     3. Repeat on the default host and on `?simworker=1`.
   - **Expected:** the "Storage full" dialog with Export, Manage storage, Retry and Close, the same on all three hosts.
     It must not be the generic "City could not be saved" dialog.
4. **F2: the crash dialog stacks above the city HUD** (`?simworker=1`).
   - **Steps:**
     1. Open `/?quickstart=1&simworker=1`, open a toolbar flyout, and let a toast and an emergency banner show if you can.
     2. In DevTools, Sources, Threads, select the `sim` worker and pause it. After 10 visible seconds the watchdog opens
        "The simulation stopped". qa-worker's crash step (`node tools/qa-worker.mjs`, shot `06-crash-dialog.png`) also
        shows it.
     3. Click the toolbar, the top bar and the minimap where the dialog's backdrop covers them.
   - **Expected:**
     - The backdrop dims and blurs the whole HUD, with nothing of the HUD drawn over it.
     - The clicks do nothing: no flyout opens and no tool changes.
     - The dialog's three buttons work.
5. **F3: qa-worker's protector control** (Chromium on the desktop).
   - **Steps:** run `node tools/qa-worker.mjs --port 5561` once.
   - **Expected:**
     - `PASS control: a detach of a buffer with two views deoptimizes the probe (the worker's probe is evidence)`.
     - The run's pass count includes that step.
     - If the line reads FAIL, the run exits 1. This is the new gate: do not read the protector steps as evidence then.
6. **Item 3** (with T048 in dev): on `?simworker=loopback` and `=1`, send an extra unit to a fire the city already
   answered by itself (Dispatch tool, from a far station). Expected: when it resolves, FEEL-10's outcome sting plays for
   the player's reinforcement, as it does on the default host.
