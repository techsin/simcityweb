# T089 report: W1.3's follow-ups in the crash and journal paths (desktop, NOTE-080 section 3)

**Status: implemented and tested in the lane (tsc, the lane's tests, W1.3's and T086's suites in small groups, the bot).
The full vitest and the real-GPU checks on `?simworker=1` are the desktop worker's.** No browser ran here. Everything is
uncommitted in `simcityweb-T089` (branch `local/T089-crash-discard`, on `local/T086-storage-takeover` at `75d0f8bb`).

## Changes per file

| File | Change |
|---|---|
| `src/main.ts`, `onWorkerCrash` (one hunk) | **(a)** For "Restart from autosave" and "Continue on the main thread": `await discardRecoverySnapshot(city)` before `playCity`. It deletes the worker's snapshot, the journal and the localStorage slot of the crashed session. **(b)** For "Recover unsaved progress": the result of `restoreRecovery` decides. `'recovered'` boots with the replay, as before. Anything else never replays. If a recovery copy of the city is still stored after that (`hasRecoverySnapshot`), the city is not opened: the App returns to the region screen (the task's "or return to the region"). Otherwise the save boots with `replay = false`. |
| `src/main.ts`, the `./ui/StorageDialog` import line | **Outside `onWorkerCrash`: one name added**, `RECOVERY_UNDECIDED_MESSAGE`, for the toast of the case "nothing could be restored, but a copy is still stored" (decision 3). |
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
4. **`readRecoveryJournal` asks `journalMatches` against the stored marker**, which is exactly "that snapshot's restore
   would take it". A snapshot record that cannot be read counts as held, so a read error never deletes a journal. One
   more read of the snapshot record happens only on this path (a journal that does not match and is bound to a
   snapshot).
5. **W1.3's Desktop QA item D4 changes.** After "Restart from autosave" and a reload, the title offers nothing: the
   copy was discarded. W1.3's decision 3 is superseded by the owner's choice.
6. **`docs/WORKER_DESIGN.md` §4.4 does not say that Restart and Continue on the main thread discard the copy.** I did
   not edit the design.
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
- A tab that loses its region's lock while the crash dialog is open: reasoned from the code, no test.
- T083's worker write lock together with these tests (T083 is not in this base). The new tests use `bootIdb` and
  `nodeWorkerPort` with the options both versions have.

## Browser checklist (`?simworker=1`, production build, Chromium on the real GPU)

Page: `/?quickstart=1&size=small&seed=7&simworker=1&simdev=1`. Crash from the console:
`__metropolis.city.host.link.post({t: 'tick', seq: 0, dt: -1, ack: 0})`. A worker snapshot:
`await __metropolis.city.host.snapshot('hidden')` (expect `ok: true, idb: true`). Recovery records: IndexedDB
`metropolis` → `recovery`, keys `<region>:<tile>` and `<region>:<tile>#journal`; localStorage `metropolis.recovery`,
`.data`, `.journal`.

**Wording**
1. Save, raise the residential tax, crash. The dialog reads "The simulation of <city> stopped. Unsaved progress since
   the last save is lost unless you choose Recover: a recovery copy of it was kept on this device." The note names what
   each button does, and says that Restart and Continue on the main thread delete the copy. Three buttons. The text
   wraps cleanly at 1280×720 and the dialog still draws above the HUD and above a storage dialog.
2. Save, pause, crash with no edit. "… Unsaved progress since the last save is lost: no recovery copy of it was kept on
   this device." Two buttons, no Recover.

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
   Crash, **Recover unsaved progress**. Expected: the "Storage full" dialog over the **region screen**,
   `__metropolis.city === null`, no toast, and both recovery records still stored (the journal's `base.kind` is
   `'snapshot'`).
9. Undo the patch (`IDBObjectStore.prototype.put = put`). **Retry** asks "Recover unsaved progress?"; Recover shows
   "Recovered <city>". **Play** asks once more, about the record of edits; Recover. The city has A and B.
10. The journal alone under a full store. Save. Turn on DevTools → Application → Storage → "Simulate custom storage
    quota", below the current usage, so every IndexedDB write fails, the worker's too. Raise the tax. Crash (a "Storage
    full" dialog of a failed autosave may be open: the crash dialog draws above it). If the crash dialog offers Recover
    (the journal is in localStorage), choose it. Expected: the region screen with the toast "This
    city's unsaved progress could not be checked, so the city was not opened. Free some browser storage, then try
    again.", and `metropolis.recovery.journal` still holds the tax edit. Remove the override. Play: the offer of the
    record of edits; Recover brings the tax back. (If the browser refuses localStorage too, nothing could be kept and
    the dialog has no Recover.)
11. The tab instead of the worker. As 8 up to edit B, then close the tab. Reopen at `/?simworker=1&simdev=1`, apply the
    patch of 8 before answering the title's offer, Recover: the storage dialog, and the two recovery records are
    unchanged. Undo the patch, Retry, Recover, then Continue and Recover the record of edits: the city has A and B.

**Unchanged, to confirm**
12. W1.3's D3 (an edit, a crash, Recover with the journal alone) and tools/qa-worker.mjs's crash, recover and watchdog
    steps (D2) pass as before.
13. Decision 1 above: with a recovery copy, Enter in the crash dialog is Restart, and the copy is gone.
