# T083: the worker storage follow-ups after W1.3 (NOTE-070 item 2, NOTE-078; NOTE-079, NOTE-080 §3, NOTE-081)

Branch `local/T083-worker-storage`, on dev `8c08b6a` plus the task commit `bcf2f85`. The changes are uncommitted, as the
lane's rules ask. Task: docs/dev/queue/T083-worker-storage.md. Read first: cloud-W1.3.md (decisions 19, 20, 21 and its
Desktop QA list), local-R1-meta-NEW-04.md (T036s4's region lock), WORKER_DESIGN §4, and the code of src/worker/** and
src/save/**.

## What was asked, and where it stands

| Item | Asked | State |
|---|---|---|
| (a) | The region lock reaches the worker's own IndexedDB writes in `'worker-idb'` mode (W1.3 decision 21): a read-only tab's worker cannot write, a takeover moves the write right to the new tab's worker, the old tab's worker stops at once (an AbortError path like the page's). Tests for all three | **Done.** Tests through the real worker (node worker_threads) and at the lock itself |
| (b) | `WorkerSimHost.storeSnapshot` resolves the encoded payload with `idb: false` when the store refuses it for quota or ownership, so Export works from a full or read-only tab on `?simworker=1` | **Done, in both persistences** (plan-versus-code 1) |
| (c) | B9, the guided quota dialog on the loopback and the worker: check dev; pin it or fix it | **Already shows** (T061 item 7). A test pins the dialog itself on all hosts; no source change |
| (d) | The worker journal carrying `setOnboarding` | **Dropped from T083 by NOTE-079**: it moved to the onboarding lane, T037a. Nothing was left for it here |
| NOTE-080 §3.1 | W1.3 decision 19: `drain()` ends the unit after a snapshot too, with a workerRecovery case | **Done** |
| NOTE-080 §3.2 | Decision 21's tests name each write (put, delete, clear on each store): a read-only tab boots a city with (i) a save-bound journal and (ii) a pending snapshot plus its journal; a takeover during a session; decision 20's path 1 (no boot-time journal delete in a read-only tab's worker realm) | **Done** |
| NOTE-081 | The race in workerTransport's "a fatal message from the worker after ready takes the crash path" | **Done**, test only |

## (a) How the region lock reaches the worker

The gap (decision 21): db.ts's write guard (`requireStoreSaveAccess`, at the start of every `IdbKV` / `MemoryKV` put and
delete) asks the realm's active `RegionSaveLock`. A worker realm has none, so its IndexedDB connection was unfenced:
the boot save after a replay, save:put, the snapshot put, the recovery deletes after a save, and
`readRecoveryJournal`'s delete of a journal that does not match the loaded save.

What is there now:

1. **The fence, in the worker realm** (`holdWorkerSaveAccess(regionId)`, new, at the end of src/save/db.ts). It installs
   one access restriction for the city's region in the worker's own instance of db.ts, so the same guard that fences the
   page now refuses every put and delete of that realm's KV, synchronously at the write itself, with the page's
   `NotAllowedError` ("This region is open in another tab"). The realm may write only while `writer && held`.
2. **`writer`: the page's word.** `WorkerLink.writer()` (WorkerSimHost.ts) reads `regionSaveAccess(regionId)` for the
   init message (`init.writer`, workerProtocol.ts) and, from there until the link closes, posts `{t: 'access', writable}`
   at each change (`watchRegionSaveAccess`, bound to the link's lifetime, so it also covers the boot). The worker applies
   `access` in `receive()`, on arrival: ahead of the FIFO and during the boot too. A loss sets `writer` false before the
   call returns. No main.ts hunk was needed.
3. **`held`: a Web Lock of the worker's own**, `metropolis.region-worker.<regionId>` (a prefix no page lock name can
   equal). A worker whose page says "writer" takes it with `{steal: true}`: its page holds the region, so a worker that
   still holds this lock belongs to a tab that lost the region. That worker's `request()` rejects with `AbortError`, as
   the page's does, and its handler drops `held` at once, whatever its own page has or has not told it. A writer takes
   the lock **before it reads the city record** (boot phase `'idb'`), so nothing the old tab's worker starts from then on
   can land behind the record the new worker loads.
4. **Without Web Locks in the worker realm** (old browsers, where the page itself falls back to BroadcastChannel; and
   node's test threads) `held` is true and the page's word decides alone. A lock manager that refuses the request itself
   (any rejection but `AbortError` before the grant) is treated the same way, so the worker's lock is never a reason for
   the region's holder to lose saves.
5. **A repeated "writer" does not steal a stolen lock back**: only the page's false-to-true does (the page reacquired the
   region). So a page that has not yet learned of its loss cannot make its worker fight the new holder's.
6. **A write waits for the lease to settle** (`settled()`): the worker's lock is granted a task after the page's word, and
   a save or snapshot asked for in between waits for it instead of being refused.
7. **The boot.** A worker that is not the writer skips W1.3's save before the Ready: it replays the journal for the view
   and its Ready carries the edits (the path of a boot save that failed, and what LocalSimHost does). A boot save refused
   because the region changed hands meanwhile is not reported as an error (as the page treats a lost lock).
8. On `dispose` the worker releases its lock and lifts the restriction.

**Which path acts when, in a takeover.** Tab B presses "Use it here instead": page B steals the page lock; page A's
request rejects (AbortError), its handler makes `regionSaveAccess` false, and the same call posts `access false` to
worker A, which refuses its next write and releases its own lock. That is the path at the takeover itself. When B then
opens a city, its worker steals the worker lock before it reads the record: if page A had not relayed yet (a long
task on A's main thread), worker A is stopped here by its own AbortError. Between the takeover and B's worker boot, a
write worker A starts while page A is blocked can still land; it lands before B's worker has read anything, which is
the same case as a write already in flight on the page path (the stale-summary mark covers the tile). The page-level
takeover does not steal the worker lock itself: see plan-versus-code 3.

## (b) A refused snapshot still carries its payload

- **Persistence `'main'`** (`WorkerSimHost.storeSnapshot`, the page stores): a `QuotaExceededError` or `NotAllowedError`
  from `storeRecoveryIdb` no longer rejects. The caller gets the ack with the marker and payload, `ok: false`,
  `idb: false`, `ls: false`.
- **Persistence `'worker-idb'`** (the default on `?simworker=1` since W1.3): the worker's own store refuses.
  `WorkerIdbStore.putSnapshot` (simWorker.ts) answers a refused write with `false`, so the reply carries the payload
  with `idb: false`; the page's `settle` sees that and resolves the same ack.
- Other failures still reject (an encoding error, a `DataCloneError`).
- **The journal mirror does not take up a snapshot no store holds.** `PacketSimHost.settle` would rebind the journal to
  it and trim the journal to the snapshot's command; with the payload in neither IndexedDB nor (for sure) localStorage, a
  later crash would lose the journaled edits. The journal stays bound to its stored base, as it did when the snapshot
  rejected.
- `App.snapshotNow` reads `ok` already, so a refused periodic snapshot is not counted as taken. One side effect, for the
  better: the mirror's reserve-triggered request no longer rejects on a refused write, so it is not asked again on every
  command while the store stays full.

## (c) B9

Checked on dev: the name survives (`protocolInbox` `named(e)`, `PacketSimHost.settle` `replyError`), and
`showStorageError` picks the guided dialog from `error.name`. tests/worker/quotaDialogHosts.test.ts pins the dialog
with the real StorageDialog: a save a full store refuses, sent through `withRegionSaveAccess` as the App sends it, opens
"Storage full" with Export, Manage storage, Retry and Close on the local host, the loopback, and the worker host in both
persistences; a nameless failure gets the plain dialog with Details. LoopbackSimHost.ts is unchanged.

## NOTE-080 §3

- **Decision 19.** `drain()` now returns true after a snapshot as after a save, so the snapshot's copy (50-110 ms at 1M)
  has its unit to itself: no simulation step and no later FIFO message share its task. Results are unchanged: the same
  messages in the same order, a task later. Case: workerRecovery *save:copy ends its unit, and a snapshot's copy ends
  its own (T083, W1.3 decision 19): the run queued behind the snapshot takes its first day in a later task*.
- **Decision 21's tests name each write.** tests/worker/workerStorage.test.ts's store double counts every put, delete
  and clear per store, and `expectNoWrite` asserts each of the nine by name (the KV has no `clear` today; the double
  counts one so the assertion stays true if a store is ever emptied in one call).
  - (i) *a read-only tab boots a city with a journal bound to its save*: no write at the boot, none for two saves and two
    snapshots asked later; the record and the journal are the holder's, unchanged.
  - (ii) *a read-only tab boots a city with a pending snapshot and its journal*: the worker boots the save; neither
    record is deleted or replaced.
  - A takeover during a session: two cases, the page's relay and the worker's own lock.
- **Decision 20, path 1.** In case (ii) the journal is bound to the snapshot, so `readRecoveryJournal` finds it does not
  match the loaded save and deletes it. In the worker realm nothing refused that delete, so a read-only tab opening the
  city destroyed the journal of the holder's pending snapshot. The fence refuses it now (`readRecoveryJournal`'s own
  `.catch` already treats a refused delete as "the holder deletes it"). **No line of `readRecoveryJournal` or of
  main.ts's `onWorkerCrash` was edited**: the guard is db.ts's, at the KV. Overlap with T089: none in code. If T089
  changes the delete condition, case (ii) still holds (it asserts only that a read-only tab deletes nothing); the
  assertion that the worker boots the save without replaying a snapshot-bound journal is the current rule.

## NOTE-081

workerTransport *a fatal message from the worker after ready takes the crash path* posted the query, then the invalid
tick, and awaited the query. Under load the worker answered the query in a unit of its own before the tick arrived. Now
the tick goes first (the worker refuses it in the unit that reads it, before the FIFO, so the query behind it is never
answered), and the test awaits the worker's fatal message at the port, then asserts what it asserted before: the
outstanding read rejects with `HostCrashed`, `crashes` is `[false]` (or `[]` without `onCrash`), and the overlay gets no
`'host'` card for a handled crash. Reproduced and checked: the old order with the tick 100 ms late fails with
`promise resolved "1111408038" instead of rejecting` (R1 below); the new order with the query delivered 100 ms late
passes (R2).

## Changes per file

Source:
- **src/save/db.ts** (the lock session; one appended block, +70): `WorkerSaveAccess` and `holdWorkerSaveAccess`.
  `RegionSaveLock` and everything above it are untouched, for T086.
- **src/worker/workerProtocol.ts**: `WorkerInit.writer?`, the `access` message, `writeRefused(e)`.
- **src/worker/simWorker.ts**: the lease at boot (before the record is read) and on `access`; the boot save only for a
  writer; `WorkerIdbStore` waits for the lease and answers a refused snapshot with `false` (b); `dispose` frees the
  lease; `drain()` ends the unit after a snapshot (decision 19).
- **src/worker/WorkerSimHost.ts**: `WorkerLink.writer()` and `init.writer`; `settle` / `storeSnapshot` / `unstored` (b).

No src/sim/infra hunk. No change in main.ts, StorageDialog.ts, regionLock.ts, LoopbackSimHost.ts, protocol.ts,
protocolInbox.ts, recoveryIdb.ts.

**Hunks outside the files the task names** (test tooling, each self-contained):
- **tools/bench/worker/nodeWorker.ts** and **nodePort.ts**, the node stand-in for the worker's IndexedDB connection:
  `BridgeKV` runs the realm's write guard before a put or delete, as `IdbKV` does (it had none, so the fence could not be
  seen through it); a failure keeps its name across the bridge (a `QuotaExceededError` arrived nameless); and with
  `locks: true` the worker thread's `navigator.locks` is the test thread's lock manager (node 22 has none).
- **tests/worker/workerHarness.ts**: `bootIdb` takes `locks`.

## Tests, by name

New files:
- **tests/save/workerSaveAccess.test.ts** (10): *writes its region only once the page says this tab is the writer, and
  takes the worker's lock by stealing*; *a read-only tab's worker asks for no lock and is refused every put and delete of
  the region*; *a takeover: the new tab's worker steals the lock, and the old tab's worker is refused from its next write
  on, before its page says anything*; *told that its tab lost the region, the worker stops at once and lets its lock
  go*; *a grant that arrives after the page took its word back gives no write right, and the lock is let go*; *a lock
  stolen before its grant was delivered gives no write right*; *settled() waits for a grant still on its way, so a write
  asked for right after the page's word is not refused*; *without Web Locks in the realm the page's word decides alone*;
  *a lock manager that refuses the request itself leaves the page's word standing*; *its lock is not the page's: a tab's
  page and its worker hold theirs together, and dispose frees the worker's*.
- **tests/worker/quotaDialogHosts.test.ts** (2): *the local host, the loopback and the worker host in both persistences
  all get Export, Manage storage and Retry*; *it is the error's name that picks it: a nameless failure gets the plain
  dialog with Details*.

tests/worker/workerStorage.test.ts (13; 3 were there):
- changed by design, (b): *a tab that lost its region lock stores none of the worker's saves or snapshots* expected the
  snapshot to reject with `NotAllowedError`; it now resolves with its payload, `ok` and `idb` false, and still stores
  nothing.
- new, persistence `'main'`: *T083 (b): a snapshot the page's store refuses still carries its payload: Export works from
  a full store and from a tab that lost the lock*.
- new, persistence `'worker-idb'`, through the real worker: *a read-only tab boots a city with a journal bound to its
  save: its worker makes no record write and no recovery delete, then or later; Export still reads the running city*;
  *a read-only tab boots a city with a pending snapshot and its journal: its worker deletes neither (W1.3 decision 20,
  the boot-time journal delete) and writes nothing*; *a takeover during a session: the page's loss reaches its worker at
  once (the relay), which makes no further write and lets its own lock go; taking the region back gives the write right
  back*; *a takeover moves the write right to the new tab's worker, and the old tab's worker stops writing at once: its
  own lock is stolen (AbortError) before its page has said anything* (two real workers); *without Web Locks in the worker
  realm, the page's word alone moves the write right*; *(b) a full store still answers a snapshot with its payload, so
  Export works; the journal mirror keeps the base that is stored*.
- new, the production worker loop in the test realm: *a loss that arrives while the worker boots is applied on arrival:
  the journal it replays is not saved*; *a loss while the save before the Ready is on its way: the store refuses the
  write, and that is not reported as an error*; *a worker that closes lets its lock go and lifts its fence*.

Other files: workerRecovery, the decision 19 case above (new); workerTransport, the NOTE-081 case (changed).

### Each fix reverted

Every reversion was applied alone on the final tree, its test files run through the quiet gate, and the file restored
(`mutate.mjs`, `mutations.log` and one log per reversion are in the lane's scratch folder; the tree was compared with
its diff from before the run afterwards). 31 of 31 are caught; R2, the control, passes as it must.

| # | Reverted | Caught by |
|---|---|---|
| D1 | the fence (the restriction allows every write) | 11 cases, the two read-only boots among them (decision 20's delete shows as `delete on 'recovery'`) |
| D2 | the worker lock asked `ifAvailable`, not stolen | the two takeover cases, the stealing case |
| D3 | a stolen lock keeps its write right | both takeover cases, *a lock stolen before its grant…* |
| D4 | a repeated "writer" steals the lock back | the lock-level takeover case |
| D5 | a loss does not drop the lock | *told that its tab lost the region…*, the relay case, the boot-time loss |
| D6 | a lock API refusal takes the write right away | *a lock manager that refuses…* |
| D7 | no Web Locks: never writable | *without Web Locks in the realm…* |
| D8 | a grant delivered after its steal is taken | *a lock stolen before its grant…* |
| D9, D10 | dispose keeps the fence; keeps the lock | *its lock is not the page's…*, *a worker that closes…* |
| D11 | `settled()` does not wait for the grant | *settled() waits…* and six more |
| W1 | `init.writer` ignored | both read-only boots |
| W2, W2b | `access` dropped; `access` left in the FIFO instead of applied on arrival | the relay cases; the two boot-time losses |
| W3 | (b) the worker store rejects a refused snapshot | six worker-idb cases |
| W4, W4b | a save, a snapshot, does not wait for the lease | the relay case (the worker's grant is held back 150 ms there) |
| W5a, W5b | the boot save attempted without the write right; a boot save refused for the lock reported | the two boot-time losses |
| W6 | the worker's dispose leaves the lease | *a worker that closes…* |
| W7 | decision 19: a snapshot does not end its unit | the new workerRecovery case |
| W8 | the lock taken after the record is read | the two-worker takeover (lock, then record, on the timeline) |
| H1 | init always says writer | both read-only boots |
| H2 | no relay of the page's lock | the relay case, the no-Web-Locks case |
| H3 | (b) `'main'`: a refused snapshot rejects | the changed case, the new `'main'` case |
| H4 | (b) `'worker-idb'`: the mirror takes a snapshot no store holds | six cases (`ok` true, the journal rebound) |
| B1, B2 | the bridge without the write guard; without the failure's name | the worker-idb cases; the quota cases |
| C1, C2 | T061 item 7's two halves (the inbox's name, the host's `replyError`) | the dialog case |
| R1 | NOTE-081: the old order with the tick 100 ms late | fails as the lead's run did |
| R2 | the new order with the query 100 ms late | passes (control) |

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| The lane's tests: workerStorage, workerSaveAccess, quotaDialogHosts, workerRecovery, workerTransport, hygiene (quiet gate, `--maxWorkers=1`) | 6 files, **72 passed** (13 + 10 + 2 + 13 + 16 + 18) |
| Existing worker persistence and host tests: recovery, hosts, saveErrorName, workerSpeed, loopbackHost, protocol, emergencyTeachingWorker, emergencyTeachingHost, qaWorkerControl, simCore, localSimHost, replicaSafe, saveCost | 12 files passed, 1 skipped; **95 passed, 3 skipped** (the skips need `SIM_FIXTURES` / `SIM_SAVE_COST`, as on dev) |
| Existing save, storage, lock and dialog tests: storageDb, regionStorage, save/{recovery, recoveryIdb, recoveryLs, recoveryCodec, recoveryGateScope, recoveryStorageLock, regionSaveAccess, regionSummaryReload, liveRegionExport, host, cities, foundingPersistence, loadContinuity}, game/{storageDialog, storageCopy, storageSaveStatus, autosaveFloor, citySaves, playLoadTime} | 21 files, **181 passed** |
| dispatchCause, and S1's protector on the worker loop (tests/perf/protector.test.ts) | 2 files, 9 passed |
| Bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` (quiet gate) | **`residents [ 61124, 93804, 37971 ]` = 192,899**, unchanged |
| Full vitest, benches, any browser | not run (the lead's) |

No balance, RNG, save-format or protocol-version change. `WorkerInit.writer` and `access` are additive and exist only
between WorkerSimHost and simWorker (one build); an init without `writer` writes, as before.

## Plan versus code

1. **(b) names `WorkerSimHost.storeSnapshot`, which W1.3 left for persistence `'main'` only.** On `?simworker=1` with a
   persistent store the worker stores the snapshot itself, and `ProtocolInbox.snapshot` discarded the payload when that
   put failed. Since (a) makes a read-only tab's worker refuse that very put, Export from a read-only tab needed the
   `'worker-idb'` half too; it is in `WorkerIdbStore.putSnapshot` (the worker's own store), not in the shared inbox.
2. **The loopback is not changed by (b).** `?simworker=loopback` still rejects a snapshot its store refuses, so Export
   from a full or read-only tab fails there ("That could not be completed"). T061's test *a failed snapshot on the
   loopback keeps its name too* pins that rejection, and the task keeps LoopbackSimHost.ts for (c) only. For the lead:
   say whether the loopback should follow (the change is `ProtocolInbox.snapshot` plus that test).
3. **The page-level takeover does not steal the worker's lock.** It would close the window described under (a), but it
   means a second lock request inside `RegionSaveLock.acquireWebLock` for every takeover in every tab, with or without a
   worker; tests/storageDb.test.ts pins that function's exact request list, and T086 is editing the class. The worker
   lock is stolen where it matters for correctness: by the new holder's worker, before it reads the record.
4. **Export of a read-only worker tab after the holder saved that city.** `snapshotRegionFile` (StorageDialog.ts)
   rebuilds the snapshot on the stored record, because on the worker host the base lives in the worker realm. Once the
   holder has saved the city again, the stored record is no longer the base: `snapshotRegionFile` throws "The snapshot
   base is no longer available", and the dialog shows "That could not be completed" (the local host keeps the base on the
   page, so it works there). Until then it works, and it always works from a full store. A fix is outside these files: a
   full (base-less) snapshot for Export, or `exportStorageRegion` falling back to the stored copies.
5. **Without Web Locks** the worker has no lock of its own: the page's BroadcastChannel fallback decides and the relay
   carries it. The worker does not join that channel protocol.
6. §4.3 says a snapshot runs "at the next day boundary". W1.3's worker handles a save and a snapshot at the next unit
   boundary (`drain()` runs before every unit). Unchanged here; decision 19 only gives the copy its own task.
7. `KV` has no `clear`. The tests count one on the store double, by the lead's wording.
8. WORKER_DESIGN §4 does not mention the region lock at all (it predates NEW-04). Not edited: it is not this lane's file.

## For other lanes

- **T086** (db.ts's lock session): my hunk is one block appended after `RegionSaveLock`; nothing above it changed.
  One thing to know for B5: the worker's write right follows `regionSaveAccess(regionId)` in both directions. If a
  read-only tab becomes writable while its city stays open, its worker takes the write right too, and that tab's next
  save writes a city that may be older than the stored record. Today that cannot happen, because every path that makes
  a tab writable reloads the region first ("Use it here instead"); B5 has to keep that, or keep saving off until the
  reload. A takeover during a load is covered: the worker boots with the page's word of that moment, and the relay
  follows.
- **T089** (decision 20's other parts): see *Decision 20, path 1* above. No shared line.
- **T077**: nothing in the packet's clock fields, protocol.ts, recorder.ts or replica.ts.
- **T037a**: (d) is yours (NOTE-079).
- Requests for cloud-held files: none. main.ts needed no hunk.

## Not verified here

- Anything in a browser: real Web Locks in a dedicated worker (the steal across tabs, when its AbortError is delivered),
  the real `IdbKV` guard in the worker realm (the node bridge stands in for it), two real tabs, the quota stub, FEEL-02b's
  recovery on `?simworker=1`.
- The full vitest; hosts.test's grown-fixture case and saveCost (no fixtures on this machine).
- Decision 19's effect on frame pacing at 1M (one frame's step moves a task later when a snapshot is taken).

## Browser checklist (`?simworker=1`, real GPU, production build)

`__metropolis.city.host.persistence` should read `'worker-idb'` throughout. `await navigator.locks.query()` in either
tab lists the held locks: `metropolis.region.<id>` (a page) and `metropolis.region-worker.<id>` (a worker).

1. **A read-only tab's worker cannot write.** Tab A plays a city; tab B opens the same region and the same city
   (the banner says it is open in another tab). In B, play, edit, wait two minutes, hide and show the tab. Expected: in
   IndexedDB the city record's `savedAt` and the `recovery` store change only when A writes; the lock query shows no
   worker lock held by B. In B's console, `await __metropolis.city.host.save('manual')` rejects with `NotAllowedError`.
2. **The read-only boot leaves recovery alone (decisions 20, 21).** In A, with autosave off: save, edit, and stay
   visible until the periodic snapshot has run (30 s while dirty). IndexedDB's `recovery` store now holds
   `<region>:<tile>` (the snapshot) and `<region>:<tile>#journal` (bound to it). Then open the same city in tab B, which
   is read-only. Expected: once B's city has loaded, both records are still there, unchanged (before this lane B's
   worker deleted the journal at its boot); B shows no error card. Then kill A without saving and reload it: Recover
   still restores the snapshot and the edits after it.
3. **Takeover, both ways.** In B press "Use it here instead", open the city, edit, Ctrl+S. Expected: the save lands
   (B's worker holds the worker lock). In A (now "This region is now open in another tab"): no write from A after the
   takeover; `host.save('manual')` in A's console rejects with `NotAllowedError`. Then take the region back in A and
   repeat the other way.
4. **Takeover while A's page is busy.** As 3, but block A's main thread first (a long `while` loop in A's console,
   10 s) and take over from B, opening the city in B within those 10 s. Expected: nothing from A lands after B's city
   has loaded (A's worker lost its own lock when B's worker booted).
5. **The quota path.** DevTools, Application, Storage: simulate a custom quota just above current usage; build until a
   save fails. Expected: "Storage full" with Export, Manage storage and Retry (never the raw exception); **Export**
   downloads a region whose city is the running one (import it and compare day and funds); the save pill and the
   backoff behave as on the default host. Also on `?simworker=loopback` for the dialog (Export fails there: plan-versus-code 2).
6. **Export from a read-only tab.** In tab B of check 1, before A saves again: Manage storage or the region's Export
   writes the running city. After A has saved the city again it fails with "That could not be completed"
   (plan-versus-code 4).
7. **FEEL-02b's recovery.** Kill the tab 50 s after an autosave. Expected: the restore offers the last snapshot, at
   most 30 s and 90 game days old, plus every journaled edit. Decision 19 changes only which task takes the snapshot.
8. **No new errors**: the console and the error overlay stay clean through 1-7, in particular no "The recovered edits
   could not be saved" card in a read-only tab.
