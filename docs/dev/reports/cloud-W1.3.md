# W1.3: persistence in the worker (T039, WORKER_DESIGN §6 row W1.3, §4)

Branch `cloud/w13`, a new cloud lane (no desktop branch). Task: docs/dev/queue/T039-w13-worker-persistence.md.

## Cloud carry-over (Nov 3)

### Base

The task's base is "dev after T033 and T034 merge". T033 is in dev (`d101122`); **T034 is not**: its branch
`cloud/t034` (`042efa5`) finished its review fix round with its done marker, and its merge into dev is still to come.
W1.3 builds on T034's `simWorker.ts`, `WorkerSimHost.ts` and `workerProtocol.ts`, so `cloud/w13` starts at dev
`c364906` and merges `cloud/t034` at `042efa5` (no conflicts). When T034 merges into dev, this branch merges dev again.

### Gap list (required, against what was done when this lane started)

Read: the task file; NOTE-044, NOTE-045, NOTE-046, NOTE-047 and NOTE-048 (the NOTEs that name T039 or W1.3);
WORKER_DESIGN §0 decisions 1 and 7, §4.1-§4.5, §5.1, §5.3 (the `recovery.test.ts` and `hosts.test.ts` rows), §5.4
(qa-worker's W1.3 step), §6 rows W1.2 and W1.3 with their acceptance; the T033 report (local-W1.1b-recovery.md, its
decision 5 lists what it left to T039) and the T034 report (local-W1.2-worker.md, its open item 4 and decision 1); the
code of src/worker/** and src/save/** on this base. There is no lane report or desktop diff: the lane is new.

Row W1.3: *IDB load and save (`CitySource 'idb'`, `persistence: 'worker-idb'`), `saved` and `snapped` with the
worker's own IDB writes, the journal and its binding, journal replay in `SimCore.boot`, the snapshot cadence of
min(30 s, 90 sim days), non-persistent mode.* Acceptance: *`recovery.test.ts`; S2 (save in one host, load in the
other); the Playwright kill-the-tab test restores with the journal; at 1M a save blocks the worker ≤ 60 ms and the main
thread ≤ 2 ms.* The task adds: §5's recovery check (close the page mid-edit, then recovery offers the journal and
restores the edit), tsc and the full vitest, the bot identical to dev, old saves load and continue; `auto` stays `'main'`.

| # | Required | State on this base |
|---|---|---|
| G1 | `init {city: {kind: 'idb'}, persistence: 'worker-idb'}` (§4.1 step 2): main sends no city | **Missing.** protocol.ts has the types; `simWorker` throws on anything but `serialized` + `'main'`, and `WorkerSimHost` only posts that. |
| G2 | The worker opens its own IDB with `openKV()`; a fall-back to `MemoryKV` while main's store is persistent is a boot error, and the host restarts the worker in `serialized` mode with `persistence: 'main'` (§4.1 step 3) | **Missing.** |
| G3 | The worker reads the record, deserializes it and keeps `rec.city` / `rec.savedAt` as its recovery base: only the worker realm calls `setRecoveryBase` (§4.1 step 3, O6) | **Missing** (W1.2's worker keeps the base in its `MainStore`). |
| G4 | Saves in the worker: `save:copy`, then `kv.put`, `setRecoveryBase`, the IDB part of `clearRecoveryAfterSave`, and `saved {savedAt, cmd, summary, fp, pktSeq}` without the record (§4.2) | **Missing** (W1.2 hands the record to main, which puts it). |
| G5 | Snapshots: the worker builds and stores them (`storeRecoveryIdb`), and `snapped {marker, payload, cmd}` feeds main's mirror (§4.3 Worker) | **Missing** (main stores each snapshot; `SnapshotMirror` keeps the last one for localStorage). |
| G6 | The journal and its binding in worker mode: the `RecoveryMirror` bound to the Ready's save, fed by the host | **Missing.** `WorkerSimHost` passes `journal: false` (T034 decision 1); `SnapshotMirror` stands in. |
| G7 | The boot replay (§4.3 Replay): the worker reads `recovery/<key>#journal` itself, replays it after init and before the first tick, then **saves before `ready`** (boot phase `'journal'`); if that save fails, `ready.journal` carries the replayed ops renumbered with seqs ≤ 0. With `persistence: 'main'` main passes the journal in `init.journal`. "In either host": `LocalSimHost` replays too | **Missing** in the worker. The loopback replays (T033) but cannot save before its synchronous Ready. `LocalSimHost` does not replay (T033 decision 5): a journal written in worker or loopback mode is dropped by a local session's first save. |
| G8 | The snapshot cadence: min(30 s, 90 sim days) while dirty; a periodic request is skipped when a save completed in the same window (§4.3 Worker) | **Missing** (the App asks every 30 s of wall time). |
| G9 | Non-persistent mode (`MemoryKV`): the city is sent `serialized` with `persistence: 'main'` (§4.1 step 6) | **Exists** from W1.2; it must stay the path whenever main's store is not persistent. |
| G10 | Restoring (§4.3): the title screen offers a snapshot with its journal, **or a journal alone** bound to the stored save; the next boot replays it | **Partial.** T033 adopts the localStorage journal into IndexedDB at title time and rebinds it on a snapshot restore, but a journal alone is never offered (`findRecoverySnapshot` skips `#journal` records, `hasRecoverySnapshot` ignores them, the dialog speaks of snapshots only); it is replayed silently by a loopback boot. |
| G11 | The crash paths (§4.4) with a journal: "Recover unsaved progress" restores the snapshot plus the journal, or the journal alone; "Restart from autosave" and "Continue on the main thread" boot from the save | **Missing.** With the journal in IndexedDB, both of the latter would replay it silently at their boot. |
| G12 | `recovery.test.ts` through the real worker (§5.3 row) | **Missing.** Its 25 cases run on the loopback core and host. |
| G13 | S2 with the worker's own IDB: a save in one host loads in the other and continues | **Partial.** hosts.test covers it with `persistence: 'main'` only. |
| G14 | Old saves load and continue through the worker's IDB path | **Not checked.** |
| G15 | §5.4 / §5 recovery check in the browser: close the page in the middle of an edit; recovery offers the journal and restores the edit (qa-worker's W1.3 step) | **Missing.** |
| G16 | At 1M a save blocks the worker ≤ 60 ms and the main thread ≤ 2 ms | **Not measured.** |
| G17 | NOTE-048's host bugs for the worker chain: (a) WorldView's resync rebuild; (b) the `speedChanged` replay, which fires before the host's own speed is updated; (c) the dispatch ack | (a) fixed in T034 (WorldView `getState`); (c) closed by NOTE-048 (the harness); **(b) open** in `PacketSimHost`, so in both the loopback and the worker host. |
| G18 | tsc, the full vitest, the bot identical to dev (192,899) | to run |

NOTE-049 (Nov 3, after this lane started) queued **T061** for the loopback and worker host fixes, G17 (b) among them
("runs beside W1.3"). G17 (b) is therefore T061's and is not done here; a first hunk written for it was reverted.

### What the lane did

Commits on `cloud/w13`: `1ac25f5` (cloud/t034 merged), `2c02529` (dev `683d02b` merged: NOTE-049, T061), `ca0803c`
(the implementation and tests), `15bfdfd` (save:copy and save:put as two units; the 1M measurement), `961e5dc` (boot
replay reports), and the report commits.

| Gap | Change |
|---|---|
| G1, G9 | `loadWorkerSimHost` checks the record's key only (main never reads the record in this mode, O6) and, when the page's store persists, posts `init {city: {kind: 'idb', regionId, tileKey}, persistence: 'worker-idb'}`. A store that does not persist (MemoryKV) keeps R14's `serialized` + `'main'`. `WorkerInit` (workerProtocol.ts) is the union of the two pairings; the worker refuses any other. |
| G2 | The worker opens its own connection with the same `openKV()` (boot phase `'idb'`). A connection that falls back to memory is a boot error with `fatal.code = 'idb-unavailable'` (an additive protocol field); the host reports it once and boots a fresh worker from `respawn()` with persistence `'main'` (main.ts passes `browserSimWorker(SIM_WORKER_URL)`). Without `respawn` the boot fails and the App falls back to the main thread, as for any boot failure. |
| G3 | The worker reads and deserializes the record and calls `setRecoveryBase` in its realm; main keeps none (the test asserts `getRecoveryBase` is null on main). `ready.savedAt` is the loaded save (or the boot save, G7). |
| G4 | `WorkerIdbStore` (simWorker.ts) over the shared `idbStore` (new src/worker/idbStore.ts, moved out of loopbackCore.ts and kept out of protocolInbox.ts, whose graph the hygiene test keeps free of IndexedDB): the put sets the worker's recovery base and deletes the snapshot and journal records it makes obsolete. The `saved` reply carries no record. **§4.2's two units:** the put waits for the next worker unit (`nextUnit`), so the copy (~60 ms at 1M here) and the put's clone (~15 ms) never block in one task. |
| G5 | Snapshots: built against the worker's base (or the save still being written), stored by the worker with `storeRecoveryIdb`; the `snapped` reply goes to the base class, where T033's mirror takes it up and writes its localStorage slot. In `'main'` mode main stores it first, then the same path. |
| G6 | `WorkerSimHost` binds T033's mirror whenever the page's store persists (`journal` defaults to `kv.persistent`), in both modes; `SnapshotMirror` is gone (T034's report: "this small mirror is what T033's RecoveryMirror replaces"). The host takes the change count from the worker's first Ready too. A resync in `'worker-idb'` re-sends the `saved` / `snapped` replies the worker wrote and lists only reads as lost (T033 decision 2: "W1.3's worker-idb mode … must re-send as the loopback now does"); `'main'` keeps T034's rule. |
| G7 | src/worker/journal.ts: `readBootJournal`, `bootJournal` (moved from loopbackCore.ts) and `carriedJournal`; `SimCore.replayBootJournal` is the boot replay every host calls between `boot()` and the first tick. **The worker** reads `recovery/<key>#journal` from its own IndexedDB (boot phase `'journal'`), replays it, and **saves before its Ready**, so the edits are durable, the old journal is deleted with the put, and the city reads as saved. If that save fails, the journal record stays bound to the old save and the Ready carries the replayed ops renumbered ≤ 0 (the mirror starts from them; a second crash loses nothing). With persistence `'main'` main reads the journal and passes `init.journal`; the worker cannot save before its Ready there, so it takes the carried path. **LocalSimHost** reads the journal before its systems boot and replays it right after (§4.3 "in either host"), with no save; its first save deletes the journal. Carried edits count as changes, so a tax-only replay reads as unsaved (it did not in T033's loopback: no change event comes with a tax). Reports made during the replay (a replay that cannot run, a failed boot save) are held until the Ready, whose `recorder.ready()` used to drop them, in the worker and the loopback. |
| G8 | `periodicSnapshotDue` (recoveryMirror.ts): a packet host's periodic request every min(30 s, 90 sim days) while dirty, counted from the later of the last snapshot and the last completed save. `App.tickSaveState` uses it for the worker and the loopback, and keeps the 30 s rule for LocalSimHost (decision 4). |
| G10 | `findRecoverySnapshot` (recoveryIdb.ts) also offers **a journal alone** bound to its city's stored save, when the city has no restorable snapshot (a city's snapshot wins: its restore takes the journal bound to it, and a journal bound to the save underneath would replay edits the snapshot holds). Journals that can never apply (bound to a replaced save, their city or region gone, no edits) are deleted on the way, as such snapshots are. `hasRecoverySnapshot` counts the journal record. The offer's marker (`kind: 'journal'`) is built from the journal's new optional `info` (the page's last view of the city: name, day, population, funds, why), which the mirror writes with a journal alone and the title-time adoption fills from the localStorage marker; else from the save. `restoreRecoverySnapshot` of a journal alone rebuilds nothing and only checks the journal still applies; the next boot replays it. The recover dialog says what a journal alone is. After the title's Recover, `continueInCity` does not ask again. |
| G11 | `playCity(…, replay)`: the crash dialog's **Recover** restores (snapshot plus journal, or the journal alone) and boots with the replay; **Restart from autosave** and **Continue on the main thread** boot the save without it (`replay: false` at init, `replayJournal: false` for LocalSimHost and the loopback, through CityScene). The journal stays, as T034 left the crash snapshot, until the next save or recovery write replaces it. |
| G12 | tests/worker/workerRecovery.test.ts, the §5.3 recovery row through the real worker (node `worker_threads`, its IndexedDB being the test's KV through a request / reply bridge over parentPort: tools/bench/worker/nodeWorker.ts and nodePort.ts; without the bridge the worker's `openKV()` falls back to memory, as a browser's can). T033's 25 loopback cases stay in recovery.test.ts, plus two new ones. |
| G13, G14 | hosts.test: *W1.3 (S2): with the worker's own IndexedDB, a save in one host loads in the other and continues identically* (Worker → Local and Worker, Local → Worker) and *an old save (the grown fixture) loads through the worker's IndexedDB and continues as LocalSimHost does*. |
