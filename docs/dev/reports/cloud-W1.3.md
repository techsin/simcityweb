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
