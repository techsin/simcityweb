# T089 report: W1.3's follow-ups in the crash and journal paths (desktop, NOTE-080 section 3)

**Status: implemented and tested in the lane (tsc, the lane's tests, W1.3's and T086's suites in small groups, the bot).
The full vitest and the real-GPU checks on `?simworker=1` are the desktop worker's.** No browser ran here. Round 1 is
committed (`853b1211`, on `local/T086-storage-takeover` at `75d0f8bb`); **round 2 (NOTE-092, its section below) is
uncommitted** in `simcityweb-T089` (branch `local/T089-crash-discard`). Where round 2 changed what round 1 says, the
round 1 text carries a note.

## Changes per file

| File | Change |
|---|---|
| `src/main.ts`, `onWorkerCrash` (one hunk) | **(a)** For "Restart from autosave" and "Continue on the main thread": `await discardRecoverySnapshot(city)` before `playCity`. It deletes the worker's snapshot, the journal and the localStorage slot of the crashed session. **(b)** For "Recover unsaved progress": the result of `restoreRecovery` decides. `'recovered'` boots with the replay, as before. Anything else never replays. If a recovery copy of the city is still stored after that (`hasRecoverySnapshot`), the city is not opened: the App returns to the region screen (the task's "or return to the region"). Otherwise the save boots with `replay = false`. |
| `src/main.ts`, the `./ui/StorageDialog` import line | **Outside `onWorkerCrash`: one name added**, `RECOVERY_UNDECIDED_MESSAGE`, for the toast of the case "nothing could be restored, but a copy is still stored" (decision 3). *(Round 2: the line is T086's again; that case has its own text.)* |
| `src/region/ui/dialogs.ts`, `openSimCrashDialog` | Wording only (two strings and one comment). With a recovery copy: "… stopped. Unsaved progress since the last save is lost unless you choose Recover: a recovery copy of it was kept on this device." and the note "Recover brings back the unsaved progress. Restart reloads the last save and deletes the recovery copy. Continue on the main thread does that too, and runs without the simulation worker for the rest of this visit." Without one: "… stopped. Unsaved progress since the last save is lost: no recovery copy of it was kept on this device." The title, the three button labels, the default button and `.modal-top` are unchanged (tools/qa-worker.mjs finds the dialog by them). |
| `src/save/recoveryIdb.ts`, `readRecoveryJournal` | The delete condition, in its own three lines before the existing delete, plus a private helper `extendsStoredSnapshot`. A journal that does not match the base it is read for is kept when it is bound to a snapshot and `recovery/<key>` still holds that snapshot (the stored marker makes `journalMatches` true). It is deleted, as before, in every other case. The worker realm uses the same function (journal.ts `readBootJournal`). |
| `tests/worker/recovery.test.ts` | Three cases in a new `describe` at the end (the task names this file). |
| new `tests/game/crashRecovery.test.ts` | `onWorkerCrash` on the real App with the real worker (below). |
| new `tests/game/crashDialogCopy.test.ts`, `tests/save/recoveryJournalRead.test.ts`, `tests/worker/workerPendingSnapshot.test.ts` | The wording, the read's delete condition, and the worker realm's boot. |

No `src/sim/infra` hunk, no `src/worker` hunk, no edit to `tests/worker/workerHarness.ts`, `workerRecovery.test.ts`,
`workerStorage.test.ts` or `tools/bench/worker/*` (T083 edits those).

## Tests (16 new, all pass)

**`tests/game/crashRecovery.test.ts`** runs main.ts over a fake DOM with `?simworker=1`: the real `WorkerSimHost`, the
real worker on node `worker_threads` (its IndexedDB is the test's KV through nodeWorker.ts's bridge), the real recovery
store, region lock and storage dialog. Screens that draw are stubs. A crash is W1.3's QA line, an invalid tick.
- *crash after a worker snapshot, Restart, an edit, crash again, Recover: the save plus the new edit, never the old
  snapshot* (the task's test)
- *Continue on the main thread discards it too, and runs the save on a local host*
- *a restore that fails on quota opens no city: the snapshot and its journal stay, and a retry from the region brings
  both back*
- *a snapshot that cannot be restored is reported and deleted, and the save boots without a replay*
- *a recovery copy that cannot be read keeps the city closed: the journal in localStorage is offered once the store
  takes it*

**`tests/worker/recovery.test.ts`**, `T089: a journal bound to a stored snapshot stays until that snapshot goes`:
- *a restore that fails on quota leaves the snapshot and its journal, through the boot that used to follow, and the next
  restore takes both*
- *a boot with a pending snapshot leaves the journal bound to it in place, on a loopback and a local host, and the
  restore still takes it*
- *once the snapshot is gone, a boot of the save deletes the journal that was bound to it*

**`tests/worker/workerPendingSnapshot.test.ts`** (the real worker, persistence `'worker-idb'`):
- *a worker that boots the save while the snapshot waits leaves its journal, replays nothing and writes nothing; the
  restore then takes both*

**`tests/save/recoveryJournalRead.test.ts`** (`readRecoveryJournal` alone):
- *leaves it in place when the save underneath is read while that snapshot is stored, and returns it for the snapshot*
- *deletes it once that snapshot is gone, or another snapshot holds its record*
- *deletes one the stored snapshot could not take: a delta of another save, or an edit list that cannot replay*
- *keeps the rule for a journal bound to a save: one of another save is deleted, a stored snapshot or not*
- *keeps the journal, without failing the read, when the snapshot record cannot be read*

**`tests/game/crashDialogCopy.test.ts`**:
- *with a recovery copy: the progress is lost unless Recover is chosen, and the other two buttons delete the copy*
- *without one: the progress is lost, no Recover is offered, and nothing speaks of a copy to delete*

**Each fix reverted fails its tests** (scratch `mutate.mjs`, one reversion at a time, the file restored after each):

| Reverted | Tests that fail |
|---|---|
| M1: `readRecoveryJournal` deletes a snapshot-bound journal again | 5: both new recovery.test cases on the pending snapshot, workerPendingSnapshot, two of recoveryJournalRead |
| M2: no `discardRecoverySnapshot` for Restart and Local | 2: both (a) cases. With the intermediate "nothing is stored" assertions removed, the first case fails at its end: the tax of the new edit reads 9, not 11, because the old snapshot was restored |
| M3a: a Recover that did not restore still boots with the replay | 1: *a snapshot that cannot be restored…* (`init.replay`) |
| M3b: no return to the region | 2: the quota case and the unreadable-copy case |
| M3c: the region only after `'later'` | 1: the unreadable-copy case |
| M4: the old wording | 1: crashDialogCopy's first case |

## Gates run in the lane (all through quietrun, `--maxWorkers=1`, one process at a time)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| The lane's five test files | 5 files, 46 passed (16 new, 30 existing in recovery.test) |
| W1.3's recovery, journal and crash tests: `tests/worker/recovery`, `workerRecovery`, `workerTransport`, `workerStorage`, `hygiene`, with `workerPendingSnapshot` | 6 files, 83 passed |
| `tests/worker/hosts`, `workerSpeed`, `loopbackHost`, `protocol`, `localSimHost`, `simCore`, `emergencyTeachingWorker` | 7 files, 48 passed, 1 skipped (hosts' grown-fixture case needs `SIM_FIXTURES`) |
| `tests/save/recovery`, `recoveryIdb`, `recoveryLs`, `recoveryCodec`, `recoveryGateScope`, `recoveryStorageLock`, `regionSaveAccess`, `regionSummaryReload`, `host`, `cities`, `recoveryJournalRead` | 11 files, 68 passed |
| T086's and T036s4's storage tests: `storageTakeover`, `regionLockTakeover`, `storageFreeNotice`, `storageDbHeld`, `storageNoticeCss`, `storageDialog`, `storageCopy`, `storageSaveStatus`, `regionStorage`, `storageDb`, `autosaveFloor` | 11 files, 127 passed |
| Tests that read main.ts or dialogs.ts: `playLoadTime`, `firstCity`, `graphicsFirstRun`, `settingsSchema`, `titleSettings`, `uiStacking`, `crashDialogStacking`, `ambience`, `foundingDay` (with the lane's game tests) | 9 files, 86 passed; then 7 files, 49 passed |
| Bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet` | `residents [ 61124, 93804, 37971 ]` = 192,899, identical |

**One failed run, explained.** Of five extra runs of `crashRecovery` with `workerPendingSnapshot`, one failed: the
machine stalled, the first case's cold import of the App's module graph took longer than the test's 30 s waits, and the
second case then failed because the first App was still booting a worker through a spawner both tests shared. I raised
the waits to 120 s and gave each test its own spawner; three runs since then passed. A timing probe showed where the
time goes on a loaded machine: 31 s of imports before main.ts, 19 s for main.ts, 15 s for the first worker boot and the
scene's modules, then 1.4 s and 1.8 s for the two crash flows. So the first case can take 15 to 40 s here.

Logs: `…/scratchpad/lanes/T089/scratch/` (`final-new-tests.log`, `gate-*.log`, `mutate-*.log`, `stability-*.log`,
`bot-128x15-s7.log`).

## Decisions and plan versus code

1. **The default button now deletes the recovery copy. Not changed; the lead should decide.** "Restart from autosave"
   is the dialog's primary button: it has the focus, and Enter anywhere activates it (`onEnter`). Space on the focused
   button does too, and Space is the city's pause key (CityScene.ts `onKey`). Before T089 a stray key press cost
   nothing, because the copy stayed. Now it deletes the unsaved progress for good, in a dialog that opens by itself in
   the middle of play. The HUD's own confirm dialog already guards against exactly this (src/ui/Modals.ts: "Space (the
   pause key) never confirms"); the crash dialog is a region-screen `Modal`, which has no such guard. The task limits
   the dialog hunk to wording, so I left the default alone. A three-line change in `openSimCrashDialog` would make
   Recover the default when `o.recoverable` (`autofocus`, `onEnter`, and the `primary` class);
   `crashDialogStacking.test.ts` opens the dialog with `recoverable: false` and would still find Restart as the primary.
   *(Round 2, NOTE-092: changed, Recover is the default. And one point above was wrong about the running app: no
   button of the dialog had the focus. See round 2, "Focus".)*
2. **A Recover that leaves a copy stored returns to the region instead of booting with `replay = false`.** The task
   allows both. Booting would undo what `restoreRecovery` just did when it kept the copy "for another attempt":
   - the new session's worker snapshot (within about 30 s of play) overwrites `recovery/<key>`, and the page's
     journal mirror overwrites `recovery/<key>#journal` and the localStorage slot;
   - the storage dialog's Retry would restore the snapshot under a running city, whose next save replaces it.

   On the region screen neither happens, and Retry, Recover and Play work as T036s4 built them (tested end to end).
   Where nothing is left to protect, the save boots with `replay = false`: a snapshot that could not be restored
   (`'failed'`, reported and deleted by `restoreRecovery`), or nothing found.
3. **The same rule covers "nothing restored, but a copy is still stored"** (`findRecoverySnapshot` gave nothing while
   `hasRecoverySnapshot` is true). This is the kill during a quota failure when the store refuses recovery records
   too: the crash's journal is in localStorage only and cannot be moved into IndexedDB. Booting would let the new
   session overwrite that slot. The toast is T036s4's `RECOVERY_UNDECIDED_MESSAGE`, as at the recovery gate; this is
   the import-line hunk. If the lead wants the literal minimum instead, the block is four lines and M3c is its test.
   *(Round 2: the rule stays; the toast is now the region's notice of round 2, item 2, which also says the copy is
   kept.)*
4. **`readRecoveryJournal` asks `journalMatches` against the stored marker**, which is exactly "that snapshot's restore
   would take it". A snapshot record that cannot be read counts as held, so a read error never deletes a journal. One
   more read of the snapshot record happens only on this path (a journal that does not match and is bound to a
   snapshot).
5. **W1.3's Desktop QA item D4 changes.** After "Restart from autosave" and a reload, the title offers nothing: the
   copy was discarded. W1.3's decision 3 is superseded by the owner's choice. *(Round 2: D4 is updated in
   cloud-W1.3.md, with a new D4b.)*
6. **`docs/WORKER_DESIGN.md` §4.4 does not say that Restart and Continue on the main thread discard the copy.** I did
   not edit the design. *(Round 2: it says so now.)*
7. **Found while testing, for other App-level tests:** the result of a `vi.mock` factory outlives
   `vi.resetModules()`. A factory that returns modules of the App's graph (through `importOriginal` or `import`) hands
   the first test's module instances, with their KV, to every later test. `crashRecovery.test.ts` registers its two
   such mocks with `vi.doMock` in `beforeEach`. `storageTakeover.test.ts` is not affected: its factories return no
   source modules except `region/settings`, whose state it overrides.

## Left for others (seen, not changed)

- **T090 (W1.3 decision 7).** When a snapshot is restored, a journal bound to the *save* under it is still deleted by
  that restore's read (`restoreRecoverySnapshot` asks with the snapshot as base). That is the lost-`snapped`-reply
  case, where this journal holds edits newer than the snapshot. T090's rebinding has to change that read.
- **The crash path's scan is not lock-scoped.** `onWorkerCrash` calls `findRecoverySnapshot(city)` directly, as W1.2
  wrote it. That scan moves the one localStorage slot into IndexedDB whichever city it belongs to, so it can write a
  recovery record of another region, which another tab may hold. T036s4's scoped version (`findCityRecovery` in
  `src/ui/StorageDialog.ts`) never writes to another region, but it is private to that file.
- **`onWorkerCrash` does not check `this.city` again after its `busy` wait** (up to 30 s). As before T089.
- **T083** (a read-only tab's boot): not affected by this lane. A read-only tab that chooses Recover is refused the
  restore (`'later'`) and now returns to its region screen instead of booting a worker with the replay.

## Requests for cloud-held files

None. The `src/save` and `src/main.ts` hunks are the ones NOTE-080 assigned.

## Not verified

- Anything in a browser: the dialog's look with the longer text, real IndexedDB, real Web Locks, the real worker's
  termination before the discard, the storage dialog over the region screen after a crash.
- The full vitest suite, and hosts.test's grown-fixture case (`SIM_FIXTURES`).
- A tab that loses its region's lock while the crash dialog is open: reasoned from the code, no test. *(Round 2: tested
  for Recover, in crashRecovery.test.ts; Restart and Continue on the main thread in that tab are still untested.)*
- T083's worker write lock together with these tests (T083 is not in this base). The new tests use `bootIdb` and
  `nodeWorkerPort` with the options both versions have.

## Round 2 (NOTE-092)

**Status: done in the lane, uncommitted on `853b1211`.** tsc is clean; the lane's six test files (round 1's five and
the new `crashDialogKeys`), T086's storage tests, W1.3's recovery and crash tests and `hygiene` pass through quietrun
(*Gates, round 2*), twice on the final code; 13 of 13 reversions fail their tests. No browser ran here.

### Changes per file (round 2)

| File | Change |
|---|---|
| `src/region/ui/dialogs.ts`, `openSimCrashDialog` | **Item 1.** With a recovery copy, "Recover unsaved progress" is the default button: primary, the one the Modal focuses, Enter's, and the last of the row. "Restart from autosave" stays, as a plain button (`btn lg`), second in the row. Without a copy the row and the default are as before. The dialog's own listener (keydown and keyup, capture) takes Space: no default action, no further listener; it goes when the dialog closes. The `autofocus` class is set when the button is made (*Focus*, below). The result that a close without a choice would give is the default button's; `closable: false` leaves no such close today, so no test reaches it. |
| `src/region/ui/modal.ts` | **Outside the named files, 5 lines:** `modalOpen()`, true while a region-screen Modal is open. |
| `src/game/CityScene.ts`, `onKey` | **Outside the named files (a shared file): one import, and three lines in their own place** after the `confirmOpen() \|\| storageDialogOpen()` line: `if (modalOpen()) return;`. Why it is needed: *The city under the dialog*, below. |
| `src/main.ts`, `onWorkerCrash` | **Item 2.** After a Recover that restored nothing and left the copy stored, the App returns to the region as in round 1, and then says why in a toast (`'bad'`, 9 s), once the loading screen has gone. Three texts, below. The city's name is read once, for the dialog and the toast. Round 1's hunk outside `onWorkerCrash` is gone: the `./ui/StorageDialog` import line is T086's again. main.ts differs from T086's head in `onWorkerCrash` only. |
| `docs/WORKER_DESIGN.md` §4.4 | **Item 3.** One bullet under "A crash during play": what each choice does to the recovery copy. |
| `docs/dev/reports/cloud-W1.3.md`, Desktop QA | **Item 3.** D4's expectation (after Restart and a reload the title offers nothing, and no recovery record is left), and the two reasons in D4's steps that spoke of the journal Restart used to leave. New row D4b. |
| `tools/qa-journal.mjs`, `tools/qa-worker.mjs` | Read, **unchanged**: no step asserts the old behaviour. qa-journal.mjs closes the tab and never opens the crash dialog. qa-worker.mjs's crash, recover and watchdog steps click the three buttons by their text, which is unchanged, and check the host that follows; none reads a recovery record after Restart, the row's order, the default button, or sends a key to the dialog. |
| new `tests/game/crashDialogKeys.test.ts` | 6 tests: the keys through the real handlers. |
| `tests/game/crashRecovery.test.ts` | 3 new tests, 2 updated. The RegionScreen stub records the selected tile; the Modal mock is registered per test, so one test runs the real dialog; the page's window spells out a boolean `capture` (below). |
| `tests/game/crashDialogCopy.test.ts` | the row's new order. |

No `src/sim/infra` hunk, no `src/worker` hunk, no `src/save` hunk in round 2.

### Item 1: the keys, as they are now

| Key | With a recovery copy | Without one |
|---|---|---|
| **Enter** | chooses **Recover**, wherever the focus is | chooses Restart from autosave, as before |
| **Space** | chooses **nothing**, on any button, down or up | chooses nothing |

- **Enter** keeps the region Modal's convention: Enter is the default button (`onEnter`), whichever control has the
  focus, and the Modal prevents the browser's own click of a focused button. A held Enter (auto-repeat) chooses nothing.
- **Space** takes the convention of the HUD's confirm dialog (src/ui/Modals.ts: "Space (the pause key) never
  confirms"). The listener prevents the default action on keydown and on keyup, because a browser clicks a focused
  button on one or the other, and stops the event there.
- "Restart from autosave" and "Continue on the main thread" take a click.

**Focus.** Before this round no button of the dialog ever had the focus. The Modal looks for `.autofocus` while it is
built, and the dialog added the class after `new Modal(…)`. Now the class is on the button when the Modal is built, and
the default button takes the focus 60 ms after the dialog opens (the Modal's own delay). Reversion N5 puts the old order
back, and the focus tests fail. `openRecoverDialog` has the same late class; it is not this lane's and is unchanged.

So round 1's decision 1 was wrong about the running app in one point: "Restart has the focus, and Space on the focused
button activates it". Nothing was focused. With a live scene behind the dialog, CityScene's pause handler took Space: it
prevented the default, blurred whatever button had the focus, and called `setSpeed` on the dead host. The real hazards
were Enter, which the Modal gives to the default button from anywhere, and Space with no scene behind the dialog (a
crash while the city is entered). Both are closed.

**The city under the dialog.** CityScene adds its key listener to `window` in the capture phase when the city opens.
It therefore runs before every listener of a dialog that opens later, and a dialog's `stopImmediatePropagation` cannot
keep a key from it. Modals.ts does not rely on that either: `CityScene.onKey` asks `confirmOpen()`, and T036s4 added
`storageDialogOpen()` to the same line. This round adds `modalOpen()` after it. Under the crash dialog the city now gets
no hotkey at all: Space does not pause (and no longer blurs the dialog's button), Esc opens no pause menu, a digit sets
no speed, B and M pick no tool and open no panel, Ctrl+S starts no save. The camera's own keys (W A S D, the arrows) are
CameraController's listeners and still move the view; not changed.

The flag is the Modal stack's, not the crash dialog's alone: every region-screen Modal over a city takes the keys. The
crash dialog is the only one that opens there by design. I put the flag in modal.ts and not beside
`openSimCrashDialog` because CityScene's static import graph already holds modal.ts (through StorageDialog.ts), so the
hunk adds no file to it. A flag in dialogs.ts would add six: dialogs.ts, RegionModel.ts, mapPreview.ts, names.ts,
emblem.ts and sim/config.ts (hygieneScan's `staticImportGraph`, scratch `r2/graphprobe.ts`; hygiene's FH-07a case would
still pass, since `sim/actions.ts` is not among them).

### Item 2: what the region says

After a Recover that restored nothing while a copy is still stored, the App shows the region screen with the city's
tile selected (round 1), and then one toast:

| Case | Text (for a city named Crashville) |
|---|---|
| The store is full (the restore's write failed on quota) | "Crashville was not recovered: your browser's storage for Metropolis is full. Its recovery copy is kept. Free some browser storage, then play the city to recover it." |
| The copy could not be read (nothing could be offered, but a copy is stored) | "Crashville was not recovered: its recovery copy could not be read. The copy is kept. Free some browser storage, then play the city to try again." |
| The region was taken over by another tab while the dialog was open | "Crashville was not recovered: this region is now open in another tab. Its recovery copy is kept." |

- The wording is T036s4's where it fits: "Your browser's storage for Metropolis is full" is the first sentence of its
  storage dialog, and "Free some browser storage, then …" is from its "could not be checked" toast. Round 1 showed that
  toast for the second case; it does not say that the copy is kept, so the second case has its own text now.
- The third case is not in NOTE-092. It returns `'later'` like the quota case, so without its own text the toast would
  have named a full store. The region's lock notice ("This region is now open in another tab") shows with it.
- A snapshot that cannot be restored at all (`'failed'`) keeps round 1's path and W1.2's toast ("The snapshot of …
  could not be restored. Your last save … is kept."). It is deleted, so there is no copy to speak of.
- **The tile still offers Recover.** Its Play asks "Recover unsaved progress?" (the recovery gate), and Recover restores
  the snapshot; the worker then replays the journal that the restore bound to the new save, and saves before its Ready.
  One question. Tested end to end for the quota case, through the storage dialog's Retry (round 1's test) and through
  the tile (new).

### Tests (round 2: 9 new, 3 updated; all pass)

**`tests/game/crashDialogKeys.test.ts`** (new). The real `openSimCrashDialog` and Modal over the stand-in DOM, and
`CityScene.prototype.onKey` on a stand-in scene (as cameraControls.test.ts), all on one window: a real EventTarget, so
the listeners run in the order they were added and `preventDefault` / `stopImmediatePropagation` are the platform's. The
scene's listener is added first, in the capture phase, as CityScene's constructor adds it.
- *Recover is the default button: primary, the one the Modal focuses, the last of the row; Restart is a plain button*
- *Enter chooses Recover, wherever the focus is; a held Enter chooses nothing* (focus on Recover, Restart, Continue on
  the main thread, and on nothing)
- *Space chooses nothing, on any button, down or up, and the key goes no further* (the same four; a listener added after
  the dialog sees no Space; after the choice the dialog's listeners are gone)
- *the default stays Restart from autosave: primary, focused, and Enter's; Space chooses nothing* (no copy)
- *Space does not reach the pause handler, nor Esc, a speed, a tool, a panel or Ctrl+S theirs; the keys are the city's
  again once the dialog has its choice* (with and without a copy; its control: without a dialog, the same Space pauses)
- *the rule is the Modal's: under any region-screen Modal the city leaves the keys to it*

**`tests/game/crashRecovery.test.ts`** (the real App, worker, recovery store, region lock and storage dialog, as round 1):
- new: *storage full: the region says so and that the copy is kept, and the tile's Play recovers it once space is
  freed*. **Item 2's end-to-end case:** the notice's text, said once and over the region screen; the "Storage full"
  dialog; the snapshot and its journal still stored, unchanged; the city's tile selected; then the dialog is closed, the
  quota lifted, and the tile's Play asks once about the snapshot, Recover restores it, and the new worker has the tax
  edit (the snapshot) and the funding edit (its journal), saved.
- new: *a region taken over by another tab while the dialog was open: nothing is recovered here, the region says why,
  and the copy stays* (the other tab steals the region's lock while the crash dialog is open; no storage dialog)
- new: *Space chooses nothing and the copy stays; Enter is Recover, and the session comes back* (describe: *the real
  crash dialog over the crashed city*). **Item 1 on the real App:** the real dialog and Modal open over the crashed
  city; Space, down and up, leaves the dialog open, the crashed city under it, no boot, and both recovery records
  unchanged; Enter restores the snapshot, and the worker replays its journal.
- updated: *a restore that fails on quota opens no city: …* now expects the notice (round 1 expected no toast)
- updated: *a recovery copy that cannot be read keeps the city closed: …* expects the new text, and the tile selected

**`tests/game/crashDialogCopy.test.ts`**: updated, the row's order.

**A test-harness fact, for other tests that put a real dialog on a node EventTarget.** Node's
`removeEventListener(type, fn, true)` (22.12) reads the boolean as `capture: false`, so a listener added with `true`
stays. A browser removes it. The two test windows spell the boolean out as `{ capture }`; with a bare EventTarget the
"listeners are gone after the choice" assertion fails for that reason alone.

**Each fix reverted fails its tests** (scratch `r2/mutate2.mjs`: one reversion at a time, the file restored after each;
the eight in dialogs.ts again with `r2b/mutate2.mjs` against the final tests, with the same results):

| Reverted | Tests that fail |
|---|---|
| N1: Enter is the Modal's old default, Restart | 3: the Enter test, the city test, and the real-dialog App test (the App discards the copy; no "Recovered" toast) |
| N2: Restart keeps the primary class and the focus when a copy exists | 2: the default-button test, the city test (its focus check) |
| N3: no Space listener in the dialog | 4: the Space test, the no-copy test, the city test, the real-dialog App test |
| N3b: the listener on keydown only | 4: the same |
| N3c: it prevents the default but lets the key go on | 1: the Space test (a later listener sees the key) |
| N3d: it stays after the dialog closed | 1: the Space test |
| N4: no `modalOpen()` check in `CityScene.onKey` | 2: the city test ("the city's pause handler … called 1 times") and the Modal-rule test |
| N5: the `autofocus` class added after the Modal is built, as before | 3: the default-button test, the no-copy test, the city test (nothing is focused) |
| N9: the old row order | 3: the default-button test, crashDialogCopy, the real-dialog App test |
| N6: no notice | 4: both quota tests, the other-tab test, the unreadable-copy test |
| N6b: the notice before the region screen is up | 4: the same (it was said under the loading screen) |
| N7: no text of its own for the other-tab case | 1: the other-tab test (it names a full store) |
| N8: no text of its own for the unreadable copy | 1: the unreadable-copy test |

### Gates, round 2 (all through quietrun, `--maxWorkers=1`, one process at a time)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| The lane's test files: `tests/game/crashRecovery`, `crashDialogCopy`, `crashDialogKeys`, `tests/save/recoveryJournalRead`, `tests/worker/workerPendingSnapshot`, `tests/worker/recovery` | 6 files, 55 passed (round 1: 46 in 5 files; 9 new) |
| T086's and T036s4's storage tests: `tests/game/storageCopy`, `storageDialog`, `storageFreeNotice`, `storageNoticeCss`, `storageSaveStatus`, `storageTakeover`, `tests/regionLockTakeover`, `tests/storageDbHeld`, `tests/regionStorage`, `tests/storageDb`, `tests/game/autosaveFloor` | 11 files, 127 passed |
| W1.3's recovery and crash tests, with hygiene: `tests/worker/workerRecovery`, `workerTransport`, `workerStorage`, `hygiene`, `tests/save/recovery`, `recoveryIdb`, `recoveryLs`, `recoveryCodec`, `recoveryGateScope`, `recoveryStorageLock`, `regionSaveAccess`, `regionSummaryReload`, `host`, `cities`, `snapshotCodec` (`tests/worker/recovery` is in the lane's group) | 15 files, 114 passed (the first run had 14 files, 112 tests, without `snapshotCodec`) |
| Every other test that imports or reads CityScene.ts, main.ts, dialogs.ts or modal.ts (32 files: `cameraControls`, `citySaves`, `cityDisposeCanvas`, `graphicsFirstRun`, `graphicsRestore`, `quakeShakePlop`, `yearReviewRestore`, `smokeLocalHost`, `playLoadTime`, `firstCity`, `titleSettings`, `settingsSchema`, `uiStacking`, `crashDialogStacking`, `toastBudget`, `ambience`, `foundingDay`, `foundingPersistence`, `localSimHost`, `loopbackHost` and the rest of the list in scratch `r2/gates.sh`) | 32 files, 319 passed |
| Each fix reverted | 13 of 13 fail their tests (the table above) |
| Three more runs of `crashRecovery`, `crashDialogKeys` and `crashDialogCopy` | 3 of 3 passed (3 files, 16 tests; about 20 s a run) |
| Not run in round 2 | the bot (decision 8); `tests/worker/hosts`, `workerSpeed`, `protocol`, `simCore`, `emergencyTeachingWorker` (round 2 changes nothing in `src/worker`, `src/save` or `src/sim`); the full suite |

tsc and the four test groups ran twice on the final code, with the same results: first in `r2/`, then in `r2b/` (the
second time with `snapshotCodec` in the W1.3 group, and tsc through quietrun too). The reversions in dialogs.ts (N1 to
N3d, N5, N9) first ran before the last edits of the key and App tests; they ran again in `r2b/` against the final
tests, with the results of the table. N4 and N6 to N8 ran after those edits.

Logs: `…/scratchpad/lanes/T089/scratch/r2/` (`gate-*.log`, `mutate-N*.log`, `stability-*.log`, `gates.sh`,
`mutate2.mjs`) and `r2b/` (`gate-*.log`, `gates-run.txt`, `mutate-N*.log`, `mutate-run.txt`, `gates.sh`,
`mutate2.mjs`, `botgraph.ts`, `botgraph2.ts`).

### Decisions and plan versus code (round 2)

1. **With a recovery copy, the keyboard can choose only Recover.** Enter is the default button wherever the focus is
   (the Modal's convention; by its code "Recover unsaved progress?" does the same: Tab to Discard, Enter, and it
   recovers), and Space chooses nothing. So Restart and Continue on the main thread need a pointer while a copy exists,
   and Continue on the main thread needs one in both variants. NOTE-092 says "neither Enter nor Space may delete the
   copy", so I did not let Enter follow the focus. Before this round, with a live scene behind the dialog, the keyboard
   could choose only Restart. If keyboard access to the other buttons is wanted, the smallest change is: Enter on a
   button the player has moved the focus to (Tab) chooses that button. A stray Enter cannot do that, since the dialog
   puts the focus on Recover; it needs the lead's word.
2. **The CityScene and modal.ts hunks are outside the files NOTE-080 and NOTE-092 name.** Without the check in
   `onKey` the lead's third test cannot pass: the Space press reaches the pause handler before any listener of the
   dialog runs. The alternative with no CityScene hunk is a key listener the App adds to `window` before any scene
   exists (in its constructor); that is App wiring outside `onWorkerCrash`, and one more place that decides keys.
3. **The row's order changed** (Continue on the main thread, Restart from autosave, Recover unsaved progress), so that
   the default is the last button, as in the other dialogs. With the old order a plain Restart would sit at the right
   end, where each other dialog here has its default.
4. **The quota notice shows under T036s4's storage dialog.** The toasts are at z 60 and the storage dialog's backdrop
   (`#0008`) at z 130, so while "Storage full" is open the toast is dimmed by the backdrop; it is at full strength for
   the rest of its 9 s once the dialog is closed. The dialog itself names the failure, and its Retry asks about the copy
   again. A sentence in the dialog would be clearer ("<city> was not recovered. Its recovery copy is kept."): that is a
   hunk in src/ui/StorageDialog.ts (`handleRecoveryStorageError` passing a line to `showStorageError`), which is not
   this lane's. Not made.
5. **A storage dialog under the crash dialog takes the crash dialog's keys** (read from the code, not tested). While it
   is the top storage dialog, T036s4's listener stops every keydown, and it was added before the crash dialog's. So
   with a "Storage full" dialog open beneath: Enter never reaches the Modal, and the browser itself activates the
   focused button, which is now the default (before this round the focus was still on the storage dialog's button
   underneath); Space's keydown is not prevented by the crash dialog, its keyup is, so no click follows; Esc closes the
   storage dialog beneath. Browser checklist item 16.
6. **`docs/WORKER_DESIGN.md` §4.4** still says that "Continue on the main thread" boots "from IndexedDB, or from the
   restored snapshot plus the journal". The dialog offers no such combination: Continue on the main thread boots the
   save. I added the bullet and left that sentence.
7. **cloud-W1.3.md:** besides D4's expectation I changed the two reasons in D4's steps that named the journal ("a later
   snapshot … would win over the journal", "Exit saves, and that save deletes the journal"); the steps themselves are
   the same. Its decision 3 and row G11 are left as that lane wrote them; D4 names decision 3 as superseded.
8. **The bot was not run again: round 2 cannot reach it.** The static import graph of tools/simbot.ts (49 files: the
   script, `src/assets/manifest.ts`, and the rest in `src/sim` and `src/core`) and those of its three dynamic imports
   (`src/sim/systems/index.ts`, `src/sim/infra/services.ts`, `tools/citySaves.ts`) hold none of the four source files
   round 2 changed (hygieneScan's `staticImportGraph`; scratch `r2b/botgraph.ts`, `botgraph2.ts`). Round 1's run
   stands: `residents [ 61124, 93804, 37971 ]` = 192,899, this base's reference.

### Not verified (round 2)

- Anything in a browser: whether the default button shows a focus ring (the region dialogs have no focus style of
  their own, and the browser's `:focus-visible` ring may not follow a focus by script); that Chromium and Firefox click
  nothing when Space's keydown and keyup are prevented in the capture phase (the unit tests check `defaultPrevented`,
  not a browser's activation); the toast under the storage dialog; the dialog's look with Recover as the primary
  button.
- Decision 5's order of listeners with a storage dialog beneath.
- The full vitest suite.

## Browser checklist (`?simworker=1`, production build, Chromium on the real GPU)

Page: `/?quickstart=1&size=small&seed=7&simworker=1&simdev=1`. Crash from the console:
`__metropolis.city.host.link.post({t: 'tick', seq: 0, dt: -1, ack: 0})`. A worker snapshot:
`await __metropolis.city.host.snapshot('hidden')` (expect `ok: true, idb: true`). Recovery records: IndexedDB
`metropolis` → `recovery`, keys `<region>:<tile>` and `<region>:<tile>#journal`; localStorage `metropolis.recovery`,
`.data`, `.journal`.

Updated in round 2 (NOTE-092): items 1, 2, 8, 9 and 10 changed, item 13 is rewritten, items 14 to 17 are new.

**Wording and the default button**
1. Save, raise the residential tax, crash. The dialog reads "The simulation of <city> stopped. Unsaved progress since
   the last save is lost unless you choose Recover: a recovery copy of it was kept on this device." The note names what
   each button does, and says that Restart and Continue on the main thread delete the copy. Three buttons, in this
   order: Continue on the main thread, Restart from autosave, **Recover unsaved progress**. Recover is the highlighted
   one, and it has the focus a moment after the dialog opens: `document.activeElement.textContent` in the console reads
   "Recover unsaved progress" (the region dialogs use the browser's own `:focus-visible` ring, which a focus by script
   may not draw; say whether it shows). Restart is a plain button. The text wraps cleanly at 1280×720 and the dialog
   still draws above the HUD and above a storage dialog.
2. Save, pause, crash with no edit. "… Unsaved progress since the last save is lost: no recovery copy of it was kept on
   this device." Two buttons, no Recover; Restart from autosave is the highlighted one and has the focus.

**D4, changed by (a)**
3. Save, raise the tax, zone a block, crash, **Restart from autosave**, and pause at once. The city is the save without
   the edits. The recovery store holds no record of the city, and localStorage no `metropolis.recovery*` key.
4. Reload at `/?simworker=1&simdev=1` without exiting the city. Continue enters the city with **no recovery offer**
   (W1.3's D4 expected the journal here). If a day passed before the pause and 30 s went by, an offer can appear, but
   it is a snapshot of the restarted session, without the edits of step 3.

**D4b, new: Restart, then Recover**
5. Save and pause. Raise the residential tax (edit A). Take a worker snapshot. Crash. The dialog offers Recover. Choose
   **Restart from autosave**, and pause at once: the save without A, and no recovery record left (as in 3).
6. Make a different edit B (fire funding, or a zone). Crash again. Choose **Recover unsaved progress**. The new worker
   has B, and the tax is the save's: A never comes back. The save pill reads saved, and no second question follows.

**D5**
7. As 5, but choose **Continue on the main thread**. `__metropolis.city.host.kind === 'local'`, the save without A, no
   recovery record left.

**D4c, new: a kill during a quota failure** (keep the city paused, so that no autosave of the worker lands in between)
8. Save. Edit A, a worker snapshot, edit B. Then make the page's city writes fail (the restore's put runs on the page):
   `const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'cities') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, a); };`
   Crash, **Recover unsaved progress**. Expected: the "Storage full" dialog over the **region screen**, with the city's
   tile selected behind it; `__metropolis.city === null`; at the top, for 9 s, the toast "<city> was not recovered:
   your browser's storage for Metropolis is full. Its recovery copy is kept. Free some browser storage, then play the
   city to recover it." (dimmed while the dialog is open: round 2, decision 4; say whether it can be read); and both
   recovery records still stored (the journal's `base.kind` is `'snapshot'`).
9. Undo the patch (`IDBObjectStore.prototype.put = put`). Either way the city has A and B:
   - **Retry** asks "Recover unsaved progress?"; Recover shows "Recovered <city>". **Play** asks once more, about the
     record of edits; Recover.
   - or **Close** the dialog and press the tile's **Play**: one question, "Recover unsaved progress?"; Recover shows
     "Recovered <city>" and enters the city. The save pill reads saved.
10. The journal alone under a full store. Save. Turn on DevTools → Application → Storage → "Simulate custom storage
    quota", below the current usage, so every IndexedDB write fails, the worker's too. Raise the tax. Crash (a "Storage
    full" dialog of a failed autosave may be open: the crash dialog draws above it). If the crash dialog offers Recover
    (the journal is in localStorage), choose it. Expected: the region screen with the toast "<city> was not recovered:
    its recovery copy could not be read. The copy is kept. Free some browser storage, then play the city to try
    again.", and `metropolis.recovery.journal` still holds the tax edit. Remove the override. Play: the offer of the
    record of edits; Recover brings the tax back. (If the browser refuses localStorage too, nothing could be kept and
    the dialog has no Recover. While the override is on, Play shows T036s4's toast "This city's unsaved progress could
    not be checked, so the city was not opened. …".)
11. The tab instead of the worker. As 8 up to edit B, then close the tab. Reopen at `/?simworker=1&simdev=1`, apply the
    patch of 8 before answering the title's offer, Recover: the storage dialog, and the two recovery records are
    unchanged. Undo the patch, Retry, Recover, then Continue and Recover the record of edits: the city has A and B.

**Unchanged, to confirm**
12. W1.3's D3 (an edit, a crash, Recover with the journal alone) and tools/qa-worker.mjs's crash, recover and watchdog
    steps (D2) pass as before.

**The keys (round 2, NOTE-092)**
13. With a recovery copy (as 1, or as 5 up to the first crash): **Enter no longer deletes the copy.** Press Enter in the
    crash dialog: it is **Recover**, the new worker has the edits, and nothing is lost. Try it once at the very moment
    the dialog appears (hold nothing; a key held since before the dialog opened does nothing, by design), and once after
    Tab has moved the focus to Restart from autosave: Recover both times.
14. With a recovery copy: press **Space**. Nothing is chosen, the focus stays on Recover, and the button does not show
    as pressed. The city behind the dialog does not react: no pause sound, and after the choice the speed is what
    it was. Tab to Restart from autosave and to Continue on the main thread and press Space on each: nothing. A click on
    each of the three buttons still chooses it.
15. Behind the dialog, with or without a copy: Esc opens no pause menu, 1 2 3 change no speed, B, R and M pick no tool
    and open no panel, Ctrl+S starts no save (W A S D and the arrows still move the camera: not changed). Without a copy
    (as 2): Enter is Restart from autosave, Space does nothing.
16. The crash dialog over a storage dialog (round 2, decision 5; read from the code, not tested). Get a "Storage full"
    dialog first (the quota override of item 10 and Ctrl+S, or the patch of item 8 and Ctrl+S), leave it open, then
    crash. Expected: the focus moves to the crash dialog's default button (`document.activeElement`); Enter chooses
    that button; Space chooses nothing (the button may show as pressed while the key is down); Esc closes the storage
    dialog beneath. Report any other result, above all an Enter that presses a button of the storage dialog.
17. Another tab takes the region while the crash dialog is open (a second tab on the same region, "Use it here
    instead" there), then **Recover unsaved progress** here: the region screen, read-only, with the lock notice and the
    toast "<city> was not recovered: this region is now open in another tab. Its recovery copy is kept."; both recovery
    records are still stored, and the other tab's Play asks about them.
