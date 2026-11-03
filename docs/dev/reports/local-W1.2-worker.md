# local-W1.2-worker — T034, the simulation worker side

## Cloud carry-over (Nov 3)

Branch `cloud/t034` (worktree `scratchpad/co/t034`), from `local/W1.2-worker` (`ceff394`), with dev `98f4cf2` (T033
merged) merged in (`26d2a57`). Read: the task file; NOTE-032, 035, 037, 038, 039, 040, 041 and 044 (the NOTEs that
name T034); WORKER_DESIGN §2.10, §3.1, §4.1-§4.5, §5.4, §6 row W1.2 with its acceptance, R11, R14, R16, O6, O7; the
T033 report's T034 hand-off (its decision 2); this report; the diff against dev.

### Gap list (required versus done, before this carry-over)

| # | Required (source) | State on `local/W1.2-worker` |
|---|---|---|
| G1 | Dev merged after T033 lands (NOTE-044's chain) | **Missing.** One conflict, `PacketSimHost.reply`: T034's `settle()` seam against T033's journal calls and its "no caller waits" rule. Beyond the conflict, T033's journal mirror binds in every packet host with persistence and localStorage, so it would bind in `WorkerSimHost` too, and its journal-only unload write replaces the snapshot that W1.2's `SnapshotMirror` keeps in localStorage (R14: no journal in W1.2). |
| G2 | §6 W1.2, NOTE-044: the App runs the worker behind `?simworker=1` | **Missing.** The App always runs the local host (CityScene picks loopback for `?simworker=loopback`). |
| G3 | §4.1 step 5: the CityScene is built from the ready host | **Missing.** CityScene builds its own host from a `CityState`. |
| G4 | §4.1 step 1: the worker is pre-spawned on the region screen | **Missing.** `browserSimWorker()` exists; nothing calls it. |
| G5 | §4.1 step 4, R11: a boot failure falls back to `LocalSimHost` with one toast; the loading screen shows the boot phase | **Missing** (the host's `onBoot` / `onCrash` hooks have no caller). |
| G6 | §4.4: a crash in play writes recovery as a crash and offers restart from autosave, recover, continue on the main thread | **Missing** (no UI); the host wrote `why: 'exit'` (SnapshotWhy had no `'crash'`; T033 added it). |
| G7 | O6, R14: main reads the record without deserializing it in worker mode | **Missing** on the App path (`loadCity`). |
| G8 | §6 acceptance: `qa-worker.mjs` green without the journal check, the freeze test included; the browser checks of a real worker city (play, save, load, the crash path) | **Missing.** `tools/qa-worker.mjs` does not exist; no browser run. |
| G9 | Vite bundles the worker (`new URL('./simWorker.ts')`) and its wasm URL | **Not verified** (browser only). |
| G10 | §6 acceptance: the worker's protector intact after 10 minutes; latency measured | **Not run.** |
| G11 | Gates: tsc, the full vitest, hosts.test, S1's protector on the real worker path, the bot | tsc, `tests/worker`, the protector and the bot ran on the desktop; **the full vitest never ran**; all of them must be re-run after G1. |
| G12 | The desktop's mid-edit save (`bddba48`) | Four lines in `WorkerSimHost` (`isDisposed`, the closed check after the lazy modules load): read line by line, correct, kept. |
| G13 | NOTE-039 (NaN in `exactDigest`), NOTE-041 items 1 and 2, NOTE-040 (which WorkerSimHost stays) | Done: canonical NaN came with T032's review (`998c6e5`); the worker's `holdCalendar` handler (`71866c4`); WorldView's resync rebuild (`9382870`); T032's host stays (above). |
| G14 | The report says exactly what changed in `scheduler.ts`, for B2 (NOTE-044) | **Partial**: prose only. |


### What the carry-over did

Commits on `cloud/t034`: `26d2a57` (dev merged in), `4860e35` (the App wiring, the crash dialog, the R14 test,
`tools/qa-worker.mjs`), `1aa1c49` (crash ordering, qa on low quality), `77db22e` (the watchdog and main-thread stalls),
`6b9dbfb` (the crash indicator, qa's recover path), and the report commits.

| Gap | Change |
|---|---|
| G1 | `PacketSimHost.reply` keeps T034's `protected settle(reply, wait)` seam with T033's journal calls inside it, and `wait` is now `Settle \| undefined` (T033: a reply updates recovery state whether or not a caller waits). `WorkerSimHost` stores a worker save or snapshot even with no waiter, and passes `journal: false` (also dropped from its options type): W1.2 has no journal (R14), the worker replays none at boot, and the journal's unload write would replace the snapshot that `SnapshotMirror` keeps. T039 (W1.3) brings the journal to the worker. |
| G2, G3, G7 | `src/main.ts`: behind `?simworker=1`, `playCity` boots `loadWorkerSimHost` on the stored record (read, not deserialized) and `startNewCity` boots it on the record it just saved (then drops main's recovery base, O6); `enterCity` takes the booted host and builds the CityScene from it (its `state` is the replica). `CityScene` takes `host?: WorkerSimHost`: the worker boots paused, and the scene applies its own initial-speed rule to it as a `setSpeed(…, 'initial')` command (a new city stays paused, a saved one runs). The scene's `ErrorOverlay` becomes the booted host's error sink (`ErrorSink` in main.ts: the console until the scene exists). `WorkerSimHost.start()` returns its `ready`. |
| G4 | The region screen pre-spawns the next city's worker (`browserSimWorker()`, loaded with the WorkerSimHost chunk) once it is shown; the city takes it, and the title screen terminates an unused one. Quickstart and Continue from the title spawn at entry. |
| G5 | The loading screen shows the worker's boot phases. Any boot failure (a script error, messageerror, a version mismatch, a fatal message, 20 s without progress) falls back to the main thread with one toast ("The simulation worker could not start: the city runs on the main thread."); a missing record keeps the local path's own message. |
| G6 | A crash during play (`onCrash(…, false)`) opens `openSimCrashDialog` (src/region/ui/dialogs.ts, not closable): **Restart from autosave** (a new worker on the save), **Recover unsaved progress** (only when a snapshot exists: `restoreRecoverySnapshot`, then a new worker), **Continue on the main thread** (the local host on the save, for the rest of the visit). The host writes its recovery first, now with `why: 'crash'`. A crash that comes while the city is still being entered waits for `enterCity` to finish; the App skips its save and snapshot paths for a crashed city. |
| G8, G9 | `tools/qa-worker.mjs` (§5.4): production build plus `vite preview` (or `--dev`), one Chromium on SwiftShader, quality low; boot, tools, play, latency, verify, save, hidden-tab save, reload and Continue, freeze, crash and restart, recover, watchdog and main thread, fallback, console. Runs below. |
| G11 | All re-run (below). |
| G14 | Below, "scheduler.ts for B2". |

**A bug the browser found** (`77db22e`): the first real worker city took the crash path while the worker was alive.
SwiftShader's main thread runs long tasks (10.8 s and 21.8 s, logged by qa-worker's long-task observer: blocking GPU
readbacks while the scene starts). Such a task holds back the worker's queued packets as well as the page's 250 ms
poll, and the poll that ran first after it counted the whole stall as worker silence ("The simulation worker stopped
responding", `qa-dev1`). R11 counts visible, unfrozen time; a page that is not running is not evidence against the
worker. `WorkerLiveness.poll` now gives no verdict on the poll after a gap of more than `STALL_MS` (1 s, four poll
intervals): the packets queued behind the stall are read first, and a silent worker is caught at the next poll on
time. The watchdog test gained both cases and fails without the change.

**New and changed tests** (each fails with its fix reverted, checked here):
- hosts.test, `with localStorage, the unload write keeps the worker's last snapshot and no journal; a crash writes it
  as such`: fails with `journal: false` removed (the slot becomes T033's journal-only marker) and with `'exit'`
  instead of `'crash'`.
- workerTransport.test, `counts visible, unfrozen time only (the watchdog)`: the stall cases (no verdict on the poll
  after a 30 s stall; the next poll on time is one); fails without the change ("the poll right after a 30 s stall:
  expected true to be false").

### scheduler.ts for B2 (NOTE-044: T034 makes `run()` a generator)

Exactly what `src/sim/infra/scheduler.ts` gains against dev, and nothing else changes:
1. O7: a public field `live: boolean | undefined`; `framesActive` is `this.live ?? nowMs() - this.lastFrameMs < 750`.
2. A public field `hostDriven = false`. `tickFrame` still stamps `lastFrameMs`, then returns without running steps when
   `hostDriven` is set (the worker sets it).
3. `beginFrame(sim)` (ends any frame in progress, then opens `steps(sim, INFRA_FRAME_BUDGET_MS, true, true)`),
   `stepOnce()` (one step; false once the frame's selection is done) and `endFrame()` (`return()`s the open
   generator), over a private `frameSteps: Generator<void, number> | null`.
4. `run(sim, budget, realTime)`'s body moved unchanged into a private generator `*steps(sim, budget, realTime,
   yielding = false)`; `run` drains it in a loop and returns its value, so local and headless runs do exactly what
   they did. Inside `steps`, `const t0` became `let t0`, and both selection loops (urgent-first, then least-served)
   `yield` after each step they run; with `yielding`, the time between the yield and the resume (the worker's
   commands and other units) is added to `t0`, so it is not charged to the frame budget. The renormalisation after
   the loops is unchanged.
For B2's rebase: keep B2's piece budgets and resumable steps, put the same `yield` (with the `t0` adjustment) after
every step B2's loops run, and keep `run()` a full drain. `Simulation.ts` gains `frameHooks`, `accumulate`, `stepDay`
and `capFrame` (`update()` calls the first two); `disasters.ts` gains the same `live` field in `daily()`.

### Gates (cloud, Nov 3; 4-core container, heavy commands under the shared lock)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, after each merge and on the final tree |
| Full vitest (`SIM_FIXTURES`, `SIM_SNAP` set: the grown-fixture cases run), on `0514a67` (dev `44f39b1` merged in) | **207 files passed, 1 skipped; 2,077 tests passed, 3 skipped**; 474 s. It includes the task's gates: hosts.test (Local vs Loopback vs Worker under worker_threads, 120 deterministic days equal at 30, 60, 120; save in one host and load in another, 60 more days equal; persistence main), S1's protector on the production worker loop (tests/perf/protector.test.ts), workerTransport, worldResync, hygiene's W1.2 graph gate, T033's recovery suite |
| The W1.2 worker files alone, after the merge (hygiene, hosts, workerTransport, worldResync, recovery, loopbackHost, holdCalendar) | 7 files, 80 passed, 25 s |
| The bot, 128 x 15, seed 7, lane against a clean export of dev | **identical** apart from the timing (the ms columns and the "done in" line): `residents [ 59288, 95301, 41512 ]`, 196k in 2015, every year row equal. Twice: on `6b9dbfb` against dev `98f4cf2`, and on `0514a67` against dev `44f39b1` |
| New tests fail with their fix reverted | 3 of 3: `journal: false` removed; `'crash'` back to `'exit'`; the stall rule removed |
| §6 acceptance, `tools/qa-worker.mjs` on the production build (Playwright Chromium, SwiftShader, quality low, small city) | **20 of 20 passed** (log `docs/dev/reports/local-W1.2/qa-worker-prod.txt`), below |

### Browser check: a real worker city (`node tools/qa-worker.mjs`, production build)

The worker is its own 794 KB chunk (`simWorker-*.js`, 269 KB gzipped; an IIFE that Vite runs as a module worker, so no
`worker.format` is needed) and carries the kernels' wasm URL; the kernels were not switched on (`?simwasm` unset), so
wasm in the worker is not exercised here. Each step through the App, the real tools and the keyboard:
- **boot**: quickstart reaches `__ready` on a worker host in 9.0 s; the new city starts paused (speed 0).
- **tools**: a road drag and a zone drag on the canvas (pointer events through ToolController) are acked: 17 road
  cells and 28 zoned cells in the replica, no pending edit (`qa-prod-02-tools.jpg`).
- **play**: speed 3 by keyboard, day 0 to 41.
- **latency** (post to ack applied, 40 `setTax`, measured, not gated): p50 0.7 ms, p95 4.9 ms, p99 5.0 ms (`qa-prod1`);
  p50 0.6, p95 7.6, p99 11.6 ms in dev mode.
- **verify**: paused, the worker's exact digest equals the replica's, twice.
- **save**: Ctrl+S, "City saved", the App reads the city clean (`qa-prod-03-saved.jpg`).
- **hidden**: with no rAF and the tab hidden, a save replies in 13 ms (acks outside ticks).
- **load**: a reload to the title and Continue: a new worker on the saved record (O6: main never deserialized it), day
  41, the road and the zone, running at speed 1, and it continues to day 62 (`qa-prod-04-loaded.jpg`, the loading
  screen fading out over the loaded city).
- **freeze** (R16): `Page.setWebLifecycleState` frozen for 15 s, then active: no crash path, and the days resume with
  the first frame after resume (1.5 s later on SwiftShader; decision 6).
- **crash**: an invalid tick posted to the worker is a fatal there: the crash dialog; Restart from autosave boots a
  new worker on the save (day 41, the edits of the save).
- **recover**: an edit after the save (tax 13.5), a worker snapshot stored by main in IndexedDB, a fatal: the dialog
  offers Recover unsaved progress (buttons read from the DOM: Continue on the main thread, Recover unsaved progress,
  Restart from autosave); Recover restores the snapshot and a new worker has tax 13.5 (`qa-prod-07d-recovered.jpg`:
  the "Recovered …" toast over the reloading city).
- **watchdog**: the worker terminated behind the host's back: the dialog after 10.0 visible seconds
  (`qa-prod-07b-watchdog-dialog.jpg`); Continue on the main thread runs the save on a local host.
- **fallback**: a worker script that throws on load (the page's `Worker` swapped for that script): the city boots on
  the main thread, with exactly one toast (`qa-prod-09-fallback.jpg`).
- **console**: no console errors in the normal steps (the crash steps log their own, expected).

Not visible in the screenshots, though the checks read the DOM: the fatal's crash dialog is still fading in on the
slow SwiftShader frames when `06-crash-dialog` and `07c-crash-dialog-recoverable` are taken (the error card shows,
the dialog does not); the watchdog's dialog shows fully (`07b`). The first dev-mode run, before the stall fix, is
`qa-worker-dev-before-stall-fix.txt` (the false crash, the dialog in `qa-dev1/02-tools.png`). Full screenshots and logs
of every run: `scratchpad/t034work/qa-{dev1,dev2,prod1,prod2}/` (`prod1` stopped at the reload: a 30 s navigation
timeout, raised in `796d1b9`).

### Left open

- *(Done in the fix round: qa-worker run B, below.)* WASM_PLAN §7.8's worker-mode browser check with the kernels on
  (`?simworker=1&simwasm=…`).
- *(Done in the fix round, decision 11 for the protector.)* The protector probe in the browser and the 10-minute run
  (decision 7); the held-brush check of §5.4.
- Real-GPU timings: the freeze test's 1 s, boot time, FPS with the worker (SwiftShader here).
- T039 (W1.3): the worker's own IndexedDB, the journal and its boot replay; worker mode then drops `journal: false`.

### Decisions (conservative readings, for the lead)

1. **No journal in worker mode** (`journal: false`): R14 has none in W1.2, T039 (W1.3) owns the journal, its binding and
   the worker's boot replay, and with T033's mirror bound here its journal-only unload write replaced the worker's
   snapshot in localStorage (the new hosts.test case). Worker mode keeps W1.2's snapshot-only recovery (up to 30 s of
   edits can be lost, as §6 says for this dev flag).
2. *(Superseded in the fix round: the region screen prefetches the chunk and the App passes `scriptLoaded`; decision
   10.)* **No hello deadline in the browser**: the App passes no `scriptLoaded`. The region screen's spawn is the prefetch,
   and the page cannot see a module worker's download finish without a second fetch; the design forbids a deadline
   while the script may still be downloading. A script error still fails fast, and the 20 s boot deadline runs from
   the worker's hello.
3. **The worker boots paused** and the scene applies its own initial-speed rule as a `setSpeed(…, 'initial')` command
   (only the Ready says whether the city is new): a new city stays paused, a saved one runs (qa: speed 0, then 1).
4. **"Continue on the main thread" holds for the rest of the visit** (no second crash loop); a reload returns to the
   worker. The crash choices skip the recovery prompt (the player already chose); "Restart from autosave" leaves a
   crash snapshot in place until the next save clears it, as an unsaved exit does.
5. *(Tightened in the fix round: a stall now counts as `STALL_MS` at most.)* **The watchdog's stall rule** (`STALL_MS` = 1 s, above). A worker that is really silent is still caught at the
   first poll on time after a stall; a main thread stalled for good keeps the verdict waiting, which is the page's
   problem, not the worker's.
6. **The freeze test's 1 s** is real-GPU wall time: on SwiftShader a frame takes seconds and days come with frames,
   so qa-worker gates "no crash path, and the days resume" and reports the time to the first day with the frames.
7. *(Superseded in the fix round: the worker's probe and the 10-minute runs, below.)* **Not run here**: the protector probe in the browser (both isolates) and its 10-minute run. The page's own
   protector is invalidated by lodBuilder's transfer list today (tools/bench/trafficCore/protector.ts says so), and a
   worker-side probe needs a dev-only hook in simWorker. S1's tests/perf/protector.test.ts runs the production worker
   loop under worker_threads (60 days, both kernel modes, both negative controls). The latency is measured, not gated
   (§6). qa-worker's held-brush check (§5.4) is not written.
8. **Dev moved during the lane** (T029 merged, `44f39b1`): merged clean (`0514a67`); both bots re-run on it. Dev moved
   again at the end (`5b12abe`, T037d merged); `git merge-tree` shows it merges cleanly with this branch, and it is left
   to the merge step, which gates the merged tree, rather than chasing dev with another full round here.
9. **Left as the desktop listed it**: FallbackWorldView and FallbackObjectsView still rebuild from their first state on a
   `'reset'` (the degraded views miss a resync); NOTE-041 item 2 names WorldView only.
10. *(Fix round.)* **The hello deadline waits for the prefetch 60 s at most** (`PREFETCH_WAIT_MS` in main.ts). §4.1 starts
    the 10 s hello timeout when the prefetch has completed or the city is entered, whichever is later, and a download
    that stalls without an error event never completes. So the deadline starts 60 s after entry at the latest: such a
    city falls back to the main thread about 70 s after entry instead of showing the loading screen for good. 60 s is my
    choice (a slow connection's worker chunk, 269 KB gzipped, should be in by then); the lead may prefer another figure.
11. *(Fix round.)* **Risk 7 in Chromium 153: there is no ArrayBufferDetaching protector to keep intact.** In Playwright's
    Chromium 153.0.8010.12 (V8 15.3), a detach deoptimizes no TurboFan typed-array loop, in fresh classic and module
    workers and on the page, and V8 traces no invalidation of it, while a protector this V8 does have (ArraySpecies) is
    traced on the right thread and deoptimizes the TurboFan code that depends on it (`local-W1.2/protector-chromium153.txt`;
    node 22's V8 shows both effects for both protectors). So the probe of §5.4 reads intact whatever the worker does, and
    "the worker's protector intact after 10 min" cannot be observed in this browser as written. The conservative reading:
    qa-worker runs the probe's positive and negative controls first (its `control` step, every run) and gates the
    worker's probe only where a detach deoptimizes it, so it gates on a V8 that has the protector (an older Chrome, or
    the desktop's if it differs) with no change; here it checks that the worker isolate made its probe (natives syntax,
    the dev flag and TurboFan code reached it) and logs a NOTE. What still holds here: the 10-minute soaks in both kernel
    modes, the wasm heap that never grew (the one detach the worker could cause by itself), and S1's node test with the
    protector, the production worker loop under worker_threads. Whether the J0 work (keeping the page's protector)
    still pays on this V8, where every typed-array access may carry the check, is a real-GPU timing question for the lead.

### Fix round after the review (Nov 3)

Commits: `7cc9705` (the fixes), `91db55f` and `9c4438a` (dev `5b12abe` and `48991d7` merged in: T037d, T036 step 2, B3;
one conflict, `main.ts`: dev's FH-21 `t0` and FEEL-05 founding day beside the worker boot), `9844af5` and `22339b4` (the
probe in Chromium 153, below), `a8f3521`, `ffa2fa4`, `83a1636` and `e47f273` (qa-worker), and this report's commit. A correction to
`9844af5`'s message: `%GetOptimizationStatus` 41 is TurboFan code in Chromium 153's V8 (its bit layout differs from node
22's, where TurboFan reads 81), not Maglev; `22339b4` reads the tier with `%ActiveTierIsTurbofan`.

| Finding | Severity | Change | Evidence |
|---|---|---|---|
| W1.2 acceptance: the worker's protector intact after 10 min (§5.4, risk 7) | major | `src/worker/protectorProbe.ts`: simWorker makes the probe first thing at boot when `init.flags.dev` is set (before the city is deserialized and before the wasm loader), reads it once per frame (sticky), and answers `debug.verify` (§2.2's debug op, acked in the command sequence) with it, the worker's wasm state and its digest: `WorkerSimHost.debugVerify()`. `&simdev=1` turns `flags.dev` on in a production build. qa-worker launches Chromium with `--js-flags=--allow-natives-syntax` and checks the probe after boot, after the freeze, after `--soak-min`, and in the founded city of the region step, with `?simwasm` unset and `=wasm`. Since `22339b4` the browser worker makes the probe when the bundle is evaluated (simWorker.ts imports protectorProbe.ts first), before every other module and the init. **Chromium 153's V8 has no ArrayBufferDetaching protector** (decision 11), so qa-worker first runs the probe's controls and gates the probe only where a detach deoptimizes it | Chromium 153: a detach deoptimizes the TurboFan probe loop in no isolate (fresh classic and module workers, the page) and V8 traces no invalidation, while ArraySpecies is traced on the worker thread and deoptimizes the code that depends on it (`local-W1.2/protector-chromium153.txt`; node 22 shows both). qa-worker's `control` step repeats it in every run. Both runs below: the worker made its probe after boot, after the freeze, after **10 minutes** at speed 3 and in the founded city (NOTE: not evidence in this V8); the soak alive and advancing; with `=wasm`, blur on wasm in the worker and its heap never grown, at boot and after the soak. S1's node test (V8 with the protector) passes in the full vitest |
| G4: a pre-spawned port that queued an error before the host listened | minor | `WorkerLink.start()` listens after the boot assigned the link (and stops if a queued item closed it); the init is posted only if the boot is still running | workerTransport `a pre-spawned port that queued a failure delivers it inside listen()`: a script error, a wrong-version hello, a fatal after hello; each rejects with HostCrashed, calls `onCrash(…, true)` once, terminates the port and posts nothing. Fails on the old code with the reviewer's `ReferenceError: Cannot access 'link' before initialization`. In the browser: qa-worker's `region fallback` step (a worker that fails to load while the region screen shows) |
| G6: a crash between `bootWorker` and the CityScene | minor | `enterCity` builds no scene on a host that closed meanwhile (it sets the city's host and lets the deferred crash dialog decide), and a crash while the scene starts (`start()`, `waitForScene`) is logged instead of thrown as a load error; the dialog then opens at the end of `enterCity` on `crashed` or `isDisposed` | code path only: the window is a paint and a chunk import, not reproduced in the browser (as the reviewer found) |
| G7 / O6: main kept the generated CityState of a new city | minor | `startNewCity` passes the worker's replica to `enterCity` and drops its own state, as `playCity` does | qa-worker `region`: `sceneOnReplica: true` (the scene's `opts.state` is the host's replica), not dirty, "Saved" |
| R11: no hello deadline, no prefetch | minor | `src/worker/simWorkerUrl.ts` (Vite's `?worker&url`: the same single worker chunk) gives the page the worker's URL; the region screen prefetches it (`<link rel=prefetch>`, or a fetch into a Blob where prefetch is unsupported), then spawns the worker from it. `bootWorker` passes `scriptLoaded`: the prefetch's end, which is never before entry; quickstart and Continue start the prefetch with the spawn. A download that stalls without an error starts the hello deadline 60 s after entry at the latest (decision 10) | qa-worker `region`: the prefetch link and exactly one worker on the region screen, the same worker for the founded city |
| qa-worker against §5.4 | minor | Every tool op through the real tools (road, zone, power line, a park plopped where the tool's own preview is ok, dezone, bulldoze, trees, the held level brush, which must end on one release sound, no error sound and no toast); size 256 by default; the crash dialog's screenshot waits until its fade-in animations have finished; the region screen's prefetch, pre-spawn and Found City; a pre-spawned worker that fails to load; the protector checks above; `--simwasm` | runs below |
| Host-driven scheduler mode untested | minor | `tests/infra/schedulerHostDriven.test.ts`: 12 frames of run() against a `beginFrame` / `stepOnce` drain on the same tasks (step order and credits equal frame by frame, the budget binding); the same with 5 ms between every two steps; `endFrame` abandons a frame | with `if (yielding) t0 += nowMs() - pause` turned into a no-op, the second case fails (`frame 0: expected [ 'edit', 'edit', 'edit' ] to deeply equal [ …, 'traffic' ]`) |
| The watchdog's stall rule | minor | `WorkerLiveness.advance` counts at most `STALL_MS` of any gap, so after a stall the page needs (nearly) the full timeout of on-time silence again, not one ping's round trip | the watchdog test: a 30 s stall, then 8.5 s of on-time polls give no verdict and the next does (1 s of the stall counted); fails on the old code (`expected 250 to be null`). The boot-timeout and R11 ping tests now move their clocks in steps the 250 ms polls see as on time |
| The done marker; two crash surfaces | minor | the `.done` marker names what stays open; `WorkerSimHost.crash` reports the crash to the error sink only when no `onCrash` takes it, so the App's crash dialog is the one surface | workerTransport `a fatal message from the worker after ready takes the crash path`: no `host` report with `onCrash`, one without. qa-worker `crash`: no `.err-card` under the dialog, and the dialog itself fully shown in the screenshot now (`local-W1.2/qa-fixround-a-06-crash-dialog.jpg`) |

#### Gates of the fix round

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean (`22339b4` and after) |
| Full vitest (`SIM_FIXTURES`, `SIM_SNAP` set), on `83a1636` (the code of `22339b4`; the later commits change `tools/qa-worker.mjs` only) | **220 files passed, 1 skipped; 2,174 tests passed, 3 skipped**; 508 s. It includes S1's protector test on the production worker loop (node's V8, which has the protector) and the new tests above |
| The worker, probe and scheduler files alone (workerTransport, recovery, schedulerHostDriven, perf/protector, hygiene) | 5 files, 66 passed, 25 s |
| A new test fails with its fix reverted (rerun here) | schedulerHostDriven, with `if (yielding) t0 += nowMs() - pause` turned into a no-op: `frame 0: expected [ 'edit', 'edit', 'edit' ] to deeply equal [ 'edit', 'edit', 'edit', 'traffic' ]` |
| The bot, 128 x 15, seed 7, on `9844af5` with `22339b4`'s probe change in the working tree (the sim, worker host and save code of the final tree: the later commits change the probe's comments and `tools/qa-worker.mjs`) | `residents [ 61124, 93804, 37971 ]` = 192,899, dev's reference since B3 (NOTE-045) |
| qa-worker run A: production build, size 256, quality low, `--soak-min 10`, `?simwasm` unset (`qa-worker-fixround-a.txt`) | **35 of 37**; both FAILs were the harness's own (fixed in `ffa2fa4`, passed in run B): the park's plop was acked ok (§152, at 104,127) but counted under `defId`, a field buildings do not have (`def`); the held brush reached flat (27 applications in 102 s, the 28th refused, one release sound, no error sound) and the one toast was the music player's "Now playing" |
| qa-worker run B: the same with `--simwasm wasm`, on `83a1636`'s harness (`qa-worker-fixround-b.txt`) | **39 of 39 passed**, the park, the held brush and the two wasm checks included |

**Run A, step by step** (Chromium 153.0.8010.12, SwiftShader; main-thread long tasks up to 40 s, the watchdog read none
of them as a dead worker):
- **control**: the technique works (ArraySpecies traced on the worker thread, its TurboFan user deoptimized); a detach
  deoptimizes the probe: no, so the worker's probe is not evidence here (decision 11).
- **boot**: quickstart on a worker host in 9.0 s, paused; the worker made its probe (`01-boot`).
- **tools** (`02-tools`): road (41 cells), zone (180), power line (33), dezone (180 to 162), bulldoze (41 to 38), trees
  (127,773 to 127,855), each acked with nothing pending; the park and the held brush as above.
- **play, verify, save, hidden, load**: day 90 to 131 at speed 3; the worker's digest equals the replica's, twice;
  Ctrl+S, "City saved"; a hidden tab's save replies in 124 ms; Continue boots a new worker on the save (day 131, the edits),
  running at speed 1, to day 152 (`03-saved`, `04-loaded`).
- **latency** (post to ack applied, 40 `setTax`, not gated): p50 0.6 ms, p95 2.9 ms, p99 3.1 ms.
- **freeze**: 15 s frozen, then no crash path and the days resume (first day 466 ms after resume, with the first frame).
- **soak**: 10 minutes at speed 3, day 217 to 479, the page heap steady at 141 MB, alive throughout
  (`qa-fixround-a-05b-after-soak.jpg`).
- **crash**: the fatal's dialog fully shown, no error card under it (`qa-fixround-a-06-crash-dialog.jpg`); Restart from
  autosave on a new worker. **recover**: the dialog offers the snapshot; Recover restores tax 13.5 on a new worker.
- **watchdog**: the dialog after 14.3 s (10 visible seconds of on-time silence, the stalls counted as 1 s each); Continue
  on the main thread runs the save on a local host. **fallback**: the main thread and one toast.
- **region**: the region screen has the prefetch link and exactly one worker (`qa-fixround-a-10-region-prespawned.jpg`);
  Found City boots on that worker (still one), paused, "Saved", not dirty, the scene's state the replica; it runs
  (`qa-fixround-a-11-region-founded.jpg`). **region fallback**: a pre-spawned worker that failed to load: the founded city
  on the main thread, one toast, no page error.
- **console**: no errors in normal play.

**Run B** (`--simwasm wasm`; the app the same build, the harness with `ffa2fa4`'s two fixes and `83a1636`), where it
differs from run A:
- **boot**: quickstart in 7.0 s; the kernels load in the worker through the browser loader (simWasm.ts: fetch, then instantiateStreaming or its arrayBuffer() fallback):
  `state: ready`, blur on wasm, a 64 MiB heap, `grows: 0` (WASM_PLAN §7.8's worker mode).
- **tools**: all nine, the park counted (0 to 1, acked §152 at 104,127, "no road access" as its warning) and the held
  level brush flat after 27 applications in 171 s, one release sound, no error sound, no toast.
- **latency** p50 0.6 ms, p95 4.2 ms, p99 4.4 ms; a hidden tab's save in 143 ms; the freeze's first day 167 ms after resume.
- **soak**: 10 minutes at speed 3, day 212 to 557, the page heap steady at 141 MB; after it the worker made its probe, and
  the kernels still on wasm with the heap never grown (`qa-fixround-b-05b-after-soak.jpg`).
- **watchdog**: 12.8 s (`qa-fixround-b-07b-watchdog-dialog.jpg`); **recover**: "Recovered Glengate (Aug 5, 2001)" on a new
  worker with tax 13.5 (`qa-fixround-b-07d-recovered.jpg`); crash, fallback, region and region fallback as in run A.

Every screenshot of both runs is in `scratchpad/t034work/qa-r3a/` and `qa-r3b/`; I looked at each. In both runs the
crash-dialog screenshots waited out the 30 s settle limit (the modal's finished `pop` animation, fill `both`, stays in
`getAnimations()`), and each shows the dialog fully drawn. `e47f273` fixes that wait; it has not run in the browser.

**Not covered by the runs**: the G6 window (a crash between the worker's Ready and the scene: code path only); real-GPU
numbers (SwiftShader: function, not timings).

## The rebuild on T032's code (the local worker)

Branch `local/W1.2-worker`, committed locally, no `.done`. I pushed nothing; a usage-limit snapshot (`bddba48`, not
mine) committed the work in progress and pushed the branch at 03:22, and I continued on top of it. The Codex first
pass (`784fe59`, below) and the final W0-complete were already in. Merged in, in this order:
- dev `fc52893` (`45d7fe1`). The brief named `4953806`; dev had since gained T010's landmarks and two docs commits.
  Clean merge.
- `local/W1.1b-loopback` `aa60c0a` (`346f69d`). One conflict, hygiene.test: both gates kept, T032's worker-safe
  inbox graph and T034's simWorker graph, switched on.
- dev `e0d7f32` (`a4545b9`), at the coordinator's request mid-task: T031 (HostActions, `holdCalendar`), T036 step 1,
  T037c. One conflict, LoopbackSimHost.ts: T031's side throughout (HostActions loads lazily).

T032's review decided the question (major 5): its `PacketSimHost` and `ProtocolInbox` stay, and T034 is one
implementation on them. So the worker path now runs the code the lag, replicaSafe, querySideEffects and loopback
suites test, and hosts.test tests the transport.

### What was deleted, what stayed

| File | Now |
|---|---|
| `src/worker/WorkerSimHost.ts` (532 → 314 lines) | `WorkerSimHost extends PacketSimHost`: a real Ready (`initialIsReady = true`), `connect()` to the port, the worker's messages to `receive()`. **Deleted:** its own R1 path (the action facade, `predict()`, the optimistic writes), `RemoteWatch`, the request and reply bookkeeping, the per-packet epochs, the `settled` acks in Ready. **Kept and rebuilt (T034's own):** `bootWorkerSimHost` (init, hello and `PROTOCOL_VERSION`, boot phases to `onBoot`, 20 s of visible time between them), a `WorkerLink` (the port, the R11 watchdog, the page lifecycle resets, ping once per visible second, 10 s without a packet is a crash), fail-fast on `onerror` / `messageerror` / `fatal` (`HostCrashed`, `onCrash(error, duringBoot)`), persistence 'main', `loadWorkerSimHost` (reads the record, never deserializes it), the pre-spawned `browserSimWorker`, `runDays` for deterministic mode. HostActions and the optimistic CityActions load lazily while the worker boots, as T031's loopback loads them in `start()`; a host that closed meanwhile is not handed over. |
| `src/worker/simWorker.ts` (308 → 291) | Hosts SimCore, the ChangeRecorder and ProtocolInbox. **Deleted:** its own inbox, watch cache, error throttle, command and Ack bookkeeping, the persistence barrier, the `run` / `ran` messages. **Kept:** the loop (one frame-hook pass, one scheduler step or one day per task, a MessageChannel post to self between, FIFO commands at those boundaries, the speed re-read before every day), the O7 live flag, `installSimWorker` for the node adapter, the browser entry. **New:** `MainStore` (the `InboxStore` for persistence 'main'), explicit acks with an epoch, `Ready.lost`, `debug.runDays`, `maxDaysPerFrame` honoured per frame. |
| `src/worker/workerProtocol.ts` (95 → 74) | Only what M2W / W2M lack: init's W1.2 fields (`city: serialized`, `persistence: 'main'`, `regionName`, `deterministic`), `{t:'ack', ack, epoch}`, `{t:'stored', savedAt, ok}`, the port types, the timeouts and `WorkerLiveness`. Boot, hello, ready, packets, replies and ping are protocol.ts's. |
| `src/worker/LoopbackSimHost.ts` (T032's) | One seam: the save / snapshot branch of `reply()` became `protected settle(reply, wait)`, and `Settle` is exported. The loopback behaves as before. |
| `src/worker/protocolInbox.ts` (T032's) | One separated block: `acknowledge(seq, result)`, for a debug unit that spans several worker tasks. |
| `src/worker/recorder.ts` | The first pass's `append()` is gone: back to T032's file. |
| `src/sim/Simulation.ts`, `src/sim/infra/scheduler.ts`, `src/sim/infra/disasters.ts` | The first pass's hunks, unchanged (why each is needed: below). |
| `src/render/world/WorldView.ts`, `src/game/CityScene.ts`, `src/game/modules.ts` | NOTE-041's resync wiring (below). |
| tests | `hosts.test` and `workerTransport.test` rewritten on a shared `workerHarness.ts`; new `worldResync.test`; the protector child on `debug.runDays`; hygiene's W1.2 gate on, with the page's side excluded too. |
| `tools/bench/worker/` | `buildTests.mjs` bundles the worker in memory and loads it as a `data:` URL (no files; the first pass's leftover `.tmp` bundles failed protocol.test's S1 scan, which does not skip `.tmp`). **Deleted:** `hostChecks.ts`, `transportChecks.ts`, `runHosts.mjs`, `runHygiene.mjs`, `runProtector.mjs`: the Codex sandbox's plain-node stand-ins for vitest, which runs here. `nodeWorker.ts` and `nodePort.ts` stay. |

### Backpressure: acks outside ticks (T032 minor 8)

The worker stops flushing when `seq − ack > 4` and the recorder keeps merging. Acks still ride on ticks, and main now
also posts `{t:'ack'}`: at once after a packet with replies, before the worker's window fills (three packets applied
since the last ack) and with each ping. A hidden tab posts no ticks and no pings, so the window rule is what lets the
hidden path's snapshot and save reply; workerTransport's hidden-tab case fails without it (eight reads, then a save,
and no tick).

### Resync

Main posts `resync` when its replica diverges, and drops the packets that arrive until the new Ready. The worker keeps,
for each packet main has not acked, the request ids of the replies it carried; the Ready's `lost` lists those plus
the replies not yet flushed. PacketSimHost then rejects only those reads, settles the applied commands with
`CommandOutcomeLost`, and calls `onResync`, as with T032's loopback. Saves whose replies were lost leave the worker's
pending list, so its snapshots fall back to a base main has. The packet numbering restarts with each Ready, so a
tick posted before main adopted it acks the old numbering: the worker trusts tick acks only after main's
`{t:'ack', epoch}` for the new Ready (both sides count Readys; protocol.ts is unchanged). That is the one epoch left.

### Persistence 'main' (R14)

- **Saves.** `MainStore.putSave` hands the record over in the `saved` reply. WorkerSimHost's `settle` stores it with
  `kv.put` (not `putCityRecord`: main keeps no recovery base, §4.1), confirms with `stored {savedAt, ok}`, clears the
  recovery slot (IndexedDB here, localStorage through the base class), then resolves the SaveAck. A refused put
  rejects the save and the worker drops that copy.
- **Snapshots** are built in the worker against the newest save handed over (as ProtocolInbox's own pending base),
  or the last one main confirmed. Main stores each in IndexedDB in reply order, after the saves before it, and
  resolves `null` for a delta of a save it did not store. The last accepted payload stays in memory for
  `recovery.writeNow`, which writes it to localStorage at unload (§6 W1.2), and is dropped on the next save. No
  journal: up to 30 s of edits can be lost. This small mirror is what T033's RecoveryMirror replaces.
- The inbox runs on while a put is held (T032 minor 6): hosts.test holds a put, and a command posted behind it acks.

### The worker loop and the calendar hold

Ticks only add dt (coalesced, capped at 0.25 s) and acks. A frame is one task for `livePolicy.tick()`, `frameHooks`
and `beginFrame`, one task per scheduler step, then one task per day (`stepDay` reads the speed again each time).
Commands, reads and saves are FIFO at those boundaries; acks, pings, resync and dispose run at once. The loop reads
`sim.maxDaysPerFrame` for every frame: T031's `holdCalendar` sets it to 0 through `SimCore.applyCommand`, and the
worker holds the calendar while frame hooks run, then caps the backlog as `Simulation.update` does. `debug.runDays`
(§2.2's wire-only op; ProtocolInbox rejects debug ops) runs whole headless days with the live flag off, one per task,
as a FIFO barrier behind the frame in progress, and acks with the day reached.

### WorldView's resync wiring (NOTE-041 item 2)

A resync swaps in a fresh `CityState`, then emits `'reset'`, which WorldView already handled with
`setState(this.state)`, its own stale state. WorldView takes an optional `getState` (CityObjectsView's accessor,
§2.10's `ctx.state`) and rebuilds through `setState` as a load does; the camera is untouched. CityScene passes
`() => this.sim.state`. I used this rather than `onResync`: the `'reset'` already arrives at the right moment for
every replica host, and `onResync` stays free for T033's mirror. worldResync.test checks it through the loopback host
with `host.harness.resync()`.

### The hunks outside T034's files, and why

- `Simulation.ts`: `frameHooks`, `accumulate`, `stepDay`, `capFrame`. The worker runs a frame as separate tasks;
  `update()` calls the first two itself, so LocalSimHost and the bot run the same code.
- `scheduler.ts`: O7's `live` field (one line in `framesActive`), and host-driven mode: `run()` became a generator that
  yields after each step, so `beginFrame` / `stepOnce` / `endFrame` give the worker one step per task without copying
  the urgent-first and least-served selection or the credit renormalisation; `run()` consumes it in one go, so
  headless runs are unchanged. Time between the worker's steps is not charged to the frame budget. **B2 also edits this
  file**: its merge must keep the yields inside the selection loops.
- `disasters.ts`: O7's `live` field in `daily()`.
- `WorldView.ts`, `CityScene.ts`, `modules.ts`: the `getState` option, one line each place.
- `LoopbackSimHost.ts`, `protocolInbox.ts`: the two seams above.

### Tests

- hosts.test: `120 scripted deterministic days give equal full-save hashes at days 30, 60 and 120` (Local, Loopback in
  design cadence, and the real worker; the replicas' exact digests too); `a save from one host loads in another and
  continues identically for 60 days` (Worker → Local and Worker, Local → Worker); `stores the worker's saves and
  snapshots on main, answers reads after their commands, and never saves the replica`; `a refused put keeps the
  worker's base; commands run on while a put is held, and a snapshot then deltas against it`.
- workerTransport.test, in-process: `runs one day per task, stops flushing past the ack window while the recorder
  merges, and answers ping`; `a frame is its hooks, one scheduler step per task, then one day per task; a pause posted
  in a day ends it`; `holdCalendar (maxDaysPerFrame 0) holds the calendar while frame hooks run; the cap then works as
  Simulation.update`; `a resync lists the replies main may have dropped, and ignores tick acks of the old numbering
  until main acks the new epoch`.
- workerTransport.test, real worker: `still replies with the tab hidden: no ticks, so main acks outside them`;
  `holdCalendar holds the real worker's calendar while its frames run, and the replica's clock with it (NOTE-041)`;
  `resyncs after a corrupted packet: only the dropped reads reject, the applied command settles as applied`; `a crash
  rejects outstanding tickets and reads with HostCrashed and takes the crash path`; `a fatal message from the worker
  after ready takes the crash path`; `R11: pings once per visible second, and 10 visible seconds without a packet are a
  crash`.
- workerTransport.test, boot and O7: `fails fast on a script error, messageerror, a version mismatch and a fatal
  message, and calls onCrash`; `reports boot phases, and times out after 20 visible seconds without one; the hello
  deadline waits for the script`; `counts visible, unfrozen time only (the watchdog)`; `an explicit live flag wins
  over the 750 ms inference, either way`.
- worldResync.test: `rebuilds from the fresh replica the host adopted, and keeps the camera`.
- protector.test (S1, unchanged names) on the production loop: the child runs 60 days through `debug.runDays`.
- hygiene.test: `W1.2: simWorker import graph excludes bundle.ts, save/index.ts and recoveryLs.ts`, now also no
  replica, loopback core, LoopbackSimHost, WorkerSimHost or SimHost in the worker.

### Gates I ran

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| hosts.test, workerTransport.test, worldResync.test (the W1.2 gates) | 4, 14 and 1 passed |
| The worker suites with the fixtures (`tests/worker`: T032's lag, replicaSafe, querySideEffects, loopbackHost; T031's hostActions, pendingEdits, holdCalendar; hygiene with the W1.2 gate on) | **25 files, 200 passed, none skipped** (T031's HostActions oracle now runs), 188 s; then the seven W1.2-touching files again on the final HEAD, 64 passed |
| S1 protector (`tests/perf/protector.test.ts`), the production loop under worker_threads | 4 passed: both kernel modes intact through 60 days, both negative controls invalidate the worker only; before and after the T031 merge |
| The render and game files that reach WorldView or CityScene (exitRetention, pendingPreviews, seasons, shadows, cutShadows; cameraStart, cityDisposeCanvas, citySaves, cameraControls, the retention suites, newyear, leakprobe, quakeShakePlop, emergencyBanner, toolCommands, pendingTools; ambience, breakdownRetention) | 22 files, 230 passed |
| The bot, `SIMBOT_LOG=1 npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` | **196,101 in 2015** (59,288 + 95,301 + 41,512); the whole output, action log included, is identical to dev `e0d7f32`'s run apart from the timing columns |
| Each new gate against its behaviour removed | all fail: no acks outside ticks (the hidden-tab save hangs); tick acks trusted across a resync (the worker refuses ack 4 of the old numbering); the live flag left on in deterministic runs (hash mismatch on day 30); `maxDaysPerFrame` ignored (both hold cases: 8 and 20 days pass); no `Ready.lost` (the dropped read hangs); a refused put ignored by the worker (its next snapshot is refused) |

### Plan-vs-code differences

1. **Acks outside ticks** (§2.1, §2.10 have them on ticks only): the W1.2 `ack` message, with the epoch of the Ready it
   follows. Needed for hidden tabs and for a resync's new numbering.
2. **The recovery base in persistence 'main'** (§4.2 has the worker call `setRecoveryBase` after its put): the worker
   deltas against the newest save handed over and falls back when main's `stored` reports a refused put; main drops
   a snapshot of a save it did not store. `stored` is a W1.2 message the design does not have.
3. **`debug.runDays`** runs in the worker scheduler as a FIFO barrier with an Ack (§2.2 lists it; ProtocolInbox
   rejects debug ops, as T032 left it). The other debug ops are still rejected. `host.sim.runDays` (the facade) still
   throws, as in T032's host; `WorkerSimHost.runDays(n)` is the promise of §2.9.
4. **The loop lives in simWorker**, not in `SimCore.beginTick` / `nextUnit` (§1.2, §3.1), as in the first pass.
5. **No `Packet.stats`**: nothing on main reads them yet.
6. **At a crash** the host writes recovery with why `'exit'`: `SnapshotWhy` has no `'crash'` (T033's mirror takes one).
7. **A save's record rides in its reply** and the recorder copies it once more (`copyOwned` in `recorder.reply`): a
   full serialized city per save on the worker, until W1.3 writes IndexedDB in the worker.
8. **The hello deadline** starts only once the caller supplies `scriptLoaded` (the prefetch), as in the first pass.
9. **FallbackWorldView and FallbackObjectsView** still rebuild from the state they were built with on a `'reset'`: the
   degraded views miss a resync (not wired here).
10. **A resync's lost save and a late `stored`:** if main applied a save's packet but its ack had not reached the worker,
    the worker counts that save as lost and ignores the late `stored`; its snapshots are refused until the next save.

### Left for the lead, and not verified here

- The full vitest suite and the browser checks (default local host, `?simworker=loopback`).
- **App wiring of the worker host**, outside this brief: `?simworker=1` selection, the CityScene built from the ready
  host, the boot fallback to LocalSimHost (`onCrash(…, true)`), the crash UI (`onCrash(…, false)`), pre-spawning
  `browserSimWorker()` on the region screen with `scriptLoaded` from its prefetch.
- Not verified, all browser-only: Vite's worker bundling of `new URL('./simWorker.ts')` and of the wasm URL, a script
  that fails to load, Page Lifecycle freeze / resume, real IndexedDB and the localStorage write at unload, the
  10-minute protector run, qa-worker without its journal check, latency and transfer volume.

## The Codex lane's first pass (`784fe59`)

Superseded where the rebuild above changed it: the duplicated host code, the message shapes, the persistence barrier,
the plain-node runners and the verification notes.

Base: `local/W0-complete` at `0fe14c23aad1840bf003569a9e6ce6246ef47c1c`.
Branch: `local/W1.2-worker`. Changes are **uncommitted**. No queue `.done` file was written, and nothing was pushed.

The worker side and a standalone `SimHost` adapter are implemented. The plain-node checks pass, including actual
`worker_threads` parity and the S1 protector on the production loop. TypeScript passes. App selection, loading-screen
integration, region-screen prefetch and automatic local fallback still need the lead's integration with T031/T032.
The game continues to construct its existing local host.

### Implementation and file ownership

| File | Change |
|---|---|
| `src/worker/simWorker.ts` | Browser worker entry and injectable parentPort boundary; boots serialized input through SimCore, systems and CityActions; owns the recorder, authoritative commands, queries/watches, saves and snapshot encoding. MessageChannel yields separate frame hooks, infrastructure steps and days. Ticks coalesce with a 250 ms cap; each day rechecks speed. |
| `src/worker/WorkerSimHost.ts` | Implements the current SimHost interface over a branded Replica. Supplies command tickets/causes/gestures, preview compatibility, keyed reads/watches, overlay and stream views, main-side persistence, liveness and disposal. `loadWorkerSimHost` reads a CityRecord without deserializing it first. `browserSimWorker` can be pre-spawned and buffers hello/errors until a city attaches. |
| `src/worker/workerProtocol.ts` | W1.2 transport envelope, serialized/main-only init, epoch-qualified acknowledgements, boot/error messages, ping/pong types, persistence confirmation and deterministic run requests. Owns the visible-time watchdog. The existing protocol's command/reply declarations are untouched. |
| `src/sim/Simulation.ts` | Small additional seam outside the narrow owns: `frameHooks`, `accumulate`, `stepDay`, `capFrame`. Local `update` retains its original loop and speed sampling, using the two extracted operations. |
| `src/sim/infra/scheduler.ts` | O7 is the marked nullable `live` field and `framesActive` expression. A separate necessary unit-scheduling hunk adds `hostDriven`, `beginFrame`, `stepOnce`, `endFrame`, and yields in the existing selection algorithm. Local/headless `run` consumes the same iterator synchronously. Time between worker tasks is excluded from the frame budget. |
| `src/sim/infra/disasters.ts` | O7 only: nullable `live` field and one daily-mode expression. Undefined preserves the 750 ms inference used by direct Simulation callers and the bot. |
| `src/worker/recorder.ts` | Necessary shared seam: two-line public `append(Entry)` block. It allows an Ack to occupy its actual position in the recorder's log without reading private buffers. Replace/fold this into T032's command recorder API when merging. |
| `tests/worker/hosts.test.ts` | Four host/persistence tests using the real worker bundle. |
| `tests/worker/workerTransport.test.ts` | Five scheduling, pressure, resync, crash, boot, watchdog and O7 tests. |
| `tests/worker/hygiene.test.ts` | Enables the simWorker import-graph gate and includes src/worker and tools/bench/worker in the detaching-API scan. Generated `.tmp` bundles are excluded. |
| `tests/perf/protectorChild.ts` | Replaces S1's direct `advanceDay` loop and synthetic array replies with `installSimWorker`, init/run messages, recorder packets and acknowledgements. Both isolates still probe independently; both negative controls remain. |
| `tests/perf/protectorResult.ts` | Requires 60 ordered recorded days and nonzero packet volume instead of the obsolete fixed size of two synthetic arrays per day. Other protector/memory gates are retained. |
| `tools/bench/worker/buildTests.mjs`, `buildTests.d.mts` | Rolldown worker bundle using the existing sim.plugins.mjs pattern; unique output names avoid parallel-test collisions. Explicit-module transformation supports bundling LocalSimHost outside Vite. |
| `tools/bench/worker/nodeWorker.ts`, `nodePort.ts` | Signal-bound parentPort/Worker adapters; the worker adapter registers the same test catalog as main. |
| `tools/bench/worker/hostChecks.ts` | Shared host parity, cross-host save/load, snapshot and failed/delayed-store assertions. |
| `tools/bench/worker/transportChecks.ts` | Shared transport assertions, including microtask sentinels proving separate day/step tasks and a deliberately corrupted packet on the real worker path. |
| `tools/bench/worker/runHosts.mjs` | Runs those same assertions in plain node when Vite cannot start. |
| `tools/bench/worker/runHygiene.mjs` | Runs the actual S1 scanner and both import-graph checks without Vite's config loader. |
| `tools/bench/worker/runProtector.mjs` | Fresh-process runner for the bundled S1 child, with the V8 flags supplied on the node command line. |
| `docs/dev/reports/local-W1.2-worker.md` | This report. |

The additional Simulation, scheduler and recorder seams are needed because this base has neither the split frame
API nor command insertion in its recorder. They are marked separately. **B2 merge attention:** retain B2's task
behavior when applying the scheduler iterator extraction; the urgent limit, least-served selection, estimated costs,
credit renormalization and headless carry calculation here retain the base algorithm.
There are no edits to SimHost.ts, SimCore.ts, protocol.ts, main.ts, CityScene or Vite configuration.

### Ordering, recovery and lifetime

Commands are applied FIFO between units. Their Ack entries follow their effects; query, watch, error and persistence
results are delivered after packet replay. Backpressure stops recorder flushes at `seq - ack > 4`, retaining the
ordered log and replies for the next packet. Explicit acknowledgements let paused/deterministic hosts drain without
inventing rAF time. Epochs prevent an acknowledgement from before resync from acknowledging a new packet sequence.
Resync returns fresh state plus unacknowledged command results and replays outstanding replies, so a lost packet
does not strand tickets. Pending optimistic fields are rebased before reset listeners run.

The worker accepts only `CitySource.kind = 'serialized'`, `persistence = 'main'`, and no journal. Main writes a worker
save copy and confirms its commit before the worker adopts that recovery base. This is a FIFO persistence barrier:
later reads/writes/snapshots wait for the put. A failed put releases the barrier and retains the preceding base.
Cleanup errors after a committed put are reported without pretending the city put failed. Save metadata describes
the captured copy, including command and change counters and the packet sequence.

The worker builds recovery bytes against its confirmed base. Main starts storing them in IDB in reply order and
retains the encoded payload for synchronous localStorage writes through `recovery.writeNow`. Successful saves drop
the preceding payload. Periodic requests use min(30 seconds, 90 simulated days) while dirty. This is the W1.2 snapshot
strategy, with no recording or replay of a journal; progress after the latest snapshot can still be lost.

Worker listeners and guards terminate with the worker's AbortController. Main transport/lifecycle/watch/policy
listeners are tied to the host controller and the supplied city signal. Disposal uses `abort('dispose')`, rejects
outstanding work, releases registrations, leaves retained views empty and awaits worker termination. Main's new
simulation compatibility object cannot advance or replace the replica.

### Tests and checked gates

Vitest was attempted with `npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1`. It failed **before collection**:
Vite's `externalize-deps` Windows `optimizeSafeRealPathSync` probe calls `spawn` and receives `EPERM`. No Vitest pass
is claimed. The standalone runners execute the shared assertions and production worker code without that loader.

`node tools/bench/worker/runHosts.mjs`: **all nine checks pass**, corresponding to these test names:

- `120 scripted deterministic days have equal full hashes at 30, 60 and 120`
- `save in one host, load in another, and continue for 60 days`
- `orders command causes, queries, main saves and worker snapshots; refuses replica saves`
- `failed and delayed main puts preserve the recovery base and FIFO save watermark`
- `R11: visible-time liveness, ping cadence and boot progress deadlines`
- `yields between days and steps, honors pause, merges under backpressure and answers ping`
- `the real worker resync settles a lost ack; exit rejects outstanding tickets and queries`
- `fails fast on script error, messageerror and version mismatch`
- `O7: explicit live mode survives a stale frame timestamp`

The parity fixture is a seeded 32² city with test-catalog buildings, roads and zones. Checkpoints compare SHA-256 of
the **full authoritative serialized cities**, normalizing only the serialization timestamp, and compare replica
digests separately. The script includes roads, zoning/dezoning, trees, tax, funding, loans, pause/resume, a tornado,
historic state and camera. Cross-host saves exercise both directions with actual host saves and full hashes after
60 additional days. The Loopback arm is the base's LoopbackCore, since T032's LoopbackSimHost is not on this branch.

`node tools/bench/worker/runHygiene.mjs`: **pass**. The only detach/grow hits are S1's existing negative controls.
Both SimCore and simWorker graphs exclude bundle.ts, save/index.ts and recoveryLs.ts.

S1 was built with `node tools/bench/worker/buildTests.mjs --protector`, then each arm was run in a fresh process:

```
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs js
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs wasm
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs js transfer
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs wasm grow
```

Both positive arms completed 60 days on the 128² stress city with both isolates intact and no invalidation trace.
WASM blur was active, with memory fixed at **67,108,864 bytes** and zero loader grows. The transfer control invalidated
only the worker. The grow control invalidated the worker and increased its memory by **65,536 bytes**. Both produced
the expected ArrayBufferDetaching trace; main remained intact. These controls exercise the production worker loop.

`npx tsc --noEmit` and `git diff --check`: **pass**.

### Design differences and integration work

1. **T031/T032 are absent from this base.** WorkerSimHost contains a compact temporary action/prediction facade,
   keyed watch cache and optimistic-rebase hooks. Fold these into HostActions and the loopback main-side code when
   both land; the `actions` factory is an injection seam, not a claim that their complete pending/gesture UX has been
   integrated. Fold the worker's Ack/reply bookkeeping and recorder.append into T032's recorder API as well.
2. **T033 is absent.** The small encoded-snapshot mirror in WorkerSimHost should fold into RecoveryMirror in
   snapshot-only mode. It never creates a journal. Main retains no authoritative recovery-base CityState.
3. **The existing interface still exposes Simulation.** The worker supplies a read/view compatibility object and a
   promise-returning runDays at runtime, with an explicit typed WorkerSimHost.runDays API. Narrow this along with
   T032's shared facade. The transport run request waits for an active frame to finish before entering deterministic
   mode; regular commands still interleave between live units.
4. **LivePolicy is already deferred by the base's EM-1 microtask behavior**, rather than synchronously mutating speed
   in the uncovered listener as the older design prose says. This lane preserves it. The post between day units
   lets that microtask run before the next day's speed check.
5. **Unit orchestration lives in simWorker**, not new SimCore.beginTick/nextUnit methods. All authoritative commands,
   reads, policy, region boot and guarded systems still use the existing SimCore. The small Simulation/scheduler APIs
   provide the required yields without copying the scheduler selection algorithm into the worker.
6. **App wiring is deliberately left for integration.** Construct a scene after ready, use onBoot for progress and
   onCrash for local boot fallback / the later crash UI, pre-spawn browserSimWorker on the region screen, and supply
   scriptLoaded after prefetch to start the hello deadline. Until a caller supplies that completed-prefetch promise,
   no download time is charged to the hello deadline. Boot-progress and running deadlines apply after hello.
7. **Test bundles use the existing ignored tools/bench/worker/.tmp directory.** The checkout's node_modules is a
   junction outside this writable worktree, so the design's proposed node_modules/.cache output was not used.

### Gates left for the lead / not verified here

- The actual Vitest invocations (hosts, transport, protector, hygiene), the existing suites and full Vitest run.
- The **128 × 15, seed-7 bot = 196,101 in 2015**. The default algorithm and inference path were preserved, but the bot
  was not run here and parity between hosts is not a replacement for that baseline check.
- Browser worker boot, script-load failures, Page Lifecycle freeze/resume for 15 seconds, UI tools and fallback,
  save/reload/old-save continuation, kill-tab recovery, the 10-minute protector run and qa-worker without its journal
  check, after main-side integration. The node error/watchdog assertions do not substitute for those browser gates.
- Production worker chunk/download size, per-isolate memory, aggregate protocol cost, action p50/p95/p99 latency and
  FPS measurements. The node correctness bundles are not production browser size or latency measurements.

The worker-side changes are ready for review and integration; this report does not claim that the complete W1.2
browser feature or its release gates have landed.
