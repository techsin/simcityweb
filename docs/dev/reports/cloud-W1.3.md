# W1.3: persistence in the worker (T039, WORKER_DESIGN §6 row W1.3, §4)

Branch `cloud/w13`, a new cloud lane (no desktop branch). Task: docs/dev/queue/T039-w13-worker-persistence.md.

## Cloud carry-over (Nov 3)

### Base

The task's base is "dev after T033 and T034 merge". T033 is in dev (`d101122`); **T034 is not**: its branch
`cloud/t034` (`042efa5`) finished its review fix round with its done marker, and its merge into dev is still to come.
W1.3 builds on T034's `simWorker.ts`, `WorkerSimHost.ts` and `workerProtocol.ts`, so `cloud/w13` starts at dev
`c364906` and merges `cloud/t034` at `042efa5` (no conflicts). When T034 merges into dev, this branch merges dev again.
**Update (resumed run, Nov 4):** T034 merged into dev (`5c40d77`, with T034b), and this branch merged dev `f1c9713` at
`70e110f`, without conflicts. **Update (Nov 9):** it merged dev `87c7c9c` (T053, NOTE-059) at `d04432b`, without
conflicts (CityScene.ts auto-merged). `cloud/w13` is dev `87c7c9c` plus W1.3 alone.

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
| G15 | tools/qa-journal.mjs (`984ec54`), §5.4's W1.3 step as its own scenario (decision 10): the production build, `?quickstart=1&size=small&seed=7&simworker=1&simdev=1`, one Chromium (SwiftShader). The tab is closed for real (`page.close({runBeforeUnload: true})`, then its `close` event) right after a zone edit is posted, with the host's asynchronous snapshot held, so only the unload writes can land. Results below (*Browser evidence*). |
| G16 | tests/perf/saveCost.test.ts, a measurement skipped unless `SIM_SAVE_COST=1` (it loads dense1m twice). Numbers in *Gates*; decision 14. |
| G17 (b) | Not done here: T061's (NOTE-049). |
| G18 | *Gates* below. |

### Resumed run (Nov 3, after the 22:16 container restart)

The first run was stopped after `98750f4`, with its gates queued and tools/qa-journal.mjs written but neither run nor
committed. This run:
- re-read the task file, NOTE-044 and every NOTE that names T039 (NOTE-044 to NOTE-049, and **NOTE-051**, which
  arrived on dev after the first run: see below), and §4.1-§4.5, §5.3, §5.4 and row W1.3 again;
- merged dev `50a6b29` into `cloud/w13` (`79268af`; NOTE-050, NOTE-051, NOTE-052, docs only), and later dev `f1c9713`
  (`70e110f`): **T034 is in dev now** (`5c40d77`, with T034b), with T040, T052, NOTE-053 to NOTE-058 and the lead's
  handoff of Nov 4. No conflicts; T034b's WorkerSimHost speed override (NOTE-048, T061 item 1) sits beside W1.3's
  persistence paths. So `cloud/w13` is dev plus W1.3 alone, and decision 1 is settled;
- reviewed the first run's diff line by line against §4 (`2c02529..98750f4`: src/worker, src/save, main.ts,
  dialogs.ts, CityScene.ts and the tests). No defect found; nothing was reverted;
- ran the browser check for the first time (it passed), made its kill step wait for the tab's `close` event and fail
  when the tab stays open, and committed it (`984ec54`); then ran every gate on the final code (after the second dev
  merge: the full vitest on `984ec54` is listed too, as it ran before dev moved).

**Each new test fails with its fix reverted** (the first run's tools: w13work/mutate.py, which reverts one fix, runs
the test that covers it under the semaphore and restores the file): 23 reversions, M1-M19 with M3b, M6b, M11b and M12b,
all fail their test. M11b (the host dropping the change count of the worker's first Ready) passed at first; `98750f4`
added the check, after which it fails too. Logs: w13work/mutate-final.log, w13work/mutate-m11b.log.

### Resumed run (Nov 9, after the Nov 4 usage-limit stop)

The Nov 4 run was stopped at the shared usage limit with its gates queued (the full vitest on `984ec54` had passed; the
bot, the second browser run and the save-cost measurement had not started) and this report uncommitted.

**Gap list at this resume** (G1-G17's code and tests were done; what the task still required): (a) the branch on the
current dev; (b) tsc, the full vitest and the bot, identical to dev, on the final code; (c) the browser recovery check
on the final code (it had passed once, at `79268af`); (d) the 1M save-cost numbers (G16; the log was empty); (e) this
report's *Gates* and *Browser evidence*; (f) the done marker. All are done below except (c), which NOTE-061 moved to the
desktop (decision 18). This run:
- read the lead's handoff (docs/dev/handoff/2026-11-04/README.md): `bundles/cloud_w13.bundle` holds `984ec54`, an
  ancestor of this branch, and `wip/co_w13.uncommitted.patch` is a strict subset of the report changes still in the
  worktree, so nothing was lost; they are committed as `d5fec16`;
- re-read the task file, NOTE-044 and every NOTE naming T039 or W1.3: NOTE-044 to NOTE-049, NOTE-051, and two new
  ones, **NOTE-057** (the merge order: W1.3 interleaves with the desktop lanes; merge dev into a later lane the day a
  conflicting one lands) and **NOTE-059** (browser checks move to the desktop; item 3: "Cloud lanes already in flight
  (B2, W1.3, …) keep the browser checks they have planned", and the report lists real-GPU-only items for a post-merge
  Desktop QA run). Then, during this run, **NOTE-060** and **NOTE-061** (Nov 9): every browser and real-GPU check
  moves to the desktop, the cloud's lock refuses them, and the desktop runs `cloud/w13`'s checklist on the branch
  before the merge. Hence the *Desktop QA* list below, and the browser gate is deferred to it (*Browser evidence*).
  NOTE-064 (the desktop merges its own lanes) keeps W1.3's merge with the cloud; NOTE-062 and NOTE-063 do not concern it;
- merged dev `87c7c9c` (`d04432b`: T053, NOTE-059; no conflict, CityScene.ts auto-merged; T053 touches no W1.3 file),
  then dev `1c2019c` (`cd2ab47`: T058, NOTE-060, NOTE-061) with **one conflict, src/main.ts `playCity`**: T058 moved
  `const t0 = performance.now()` after the recovery gate (FH-21 bug 4) where W1.3 had added the `replay` parameter.
  Both kept: W1.3's signature, T058's `t0`. T058's source check (tests/game/playLoadTime.test.ts) expected an
  `enterCity(…, t0)` call ending in `t0`; W1.3's local path passes `t0, undefined, replay`, so the check now accepts
  `t0` as any argument (still failing when `t0` is not passed, or is taken before the gate; decision 12);
- reviewed the lane's diff against dev on the merged tree (src/worker, src/save, main.ts, dialogs.ts, CityScene.ts),
  with attention to T034b's WorkerSimHost speed override and T053's replicaSafe entry beside W1.3's code: no defect
  found, no code change;
- re-ran the 23 fix reversions on the merged tree, in a throwaway export so the queued gates never saw a reverted file
  (w13work/mutate2.py; log w13work/mutate-merged.log): **23 of 23 fail their test** (M1-M19, M3b, M6b, M11b, M12b).
  They ran on `d04432b`; the later merge of `1c2019c` changes none of the reverted files (it touches main.ts,
  CityScene.ts, dialogs.ts, Notifications.ts and T058's tests), so they stand for `cd2ab47`;
- ran the gates (below): the first queue on `d04432b` was cancelled unrun when dev moved to `1c2019c`; every gate in
  the table ran on `cd2ab47`. Only this report and the done marker change after it.

### NOTE-051 (T037a's two save-path entries)

T037a is not in dev or in any fetched branch yet. W1.3 leaves the whitelist where T033 put it (recoveryCodec.ts
`JOURNAL_OPS`, `isJournalOp`) and the change events in fingerprint.ts `CHANGE_EVENTS`, so T037a's two additive entries
merge in place. The worker-side paths are generic: the boot replay (`SimCore.replayBootJournal` →
`replayRecoveryJournal` → `applyCommand`) and `carriedJournal` filter by applied seqs, never by op name; the change
count is protocolInbox.ts's `CHANGE_EVENTS` listener. So `setOnboarding` replays like any whitelisted op and
`savedDataChanged` dirties the city like any change event, in the worker, the loopback and LocalSimHost alike. Nothing
in this lane needs to change for it; no conflict is expected beyond the import lines.

### Gates

All on `cd2ab47` (dev `1c2019c` plus W1.3) unless stated. Logs in /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/.

| Gate | Result |
|---|---|
| tsc (sem) | clean (`cd2ab47`; also clean on `d04432b`, tsc2.log) |
| The lane's tests (sem, `--maxWorkers=2`) | workerRecovery, recovery, hosts, recoveryIdb, hygiene and T058's five game tests: 10 files, 109 passed (lane-tests3.log). On `d04432b`: 7 files, 71 passed (lane-tests2.log) |
| Full vitest (lock) | **242 files passed, 3 skipped; 2,425 tests passed, 8 skipped; 0 failed** (457 s; vitest-full3.log). Dev `1c2019c` at its merge (the carry-over log, T058): 241 / 2 skipped files, 2,410 / 7 skipped tests; the difference is workerRecovery.test.ts (11 cases), the new cases in recovery.test.ts and hosts.test.ts, and saveCost.test.ts (skipped unless `SIM_SAVE_COST=1`). Earlier: `984ec54`, 225 files / 2,241 tests passed (Nov 4, vitest-full.log) |
| Bot (lock), identical to dev | lane `cd2ab47`: `residents [ 61124, 93804, 37971 ]` = 192,899 (bot-lane3.log); dev `1c2019c` from a clean export in co/w13-devbase: the same (bot-dev3.log); **all 15 year rows identical apart from the two timing columns**. Dev `87c7c9c` gave the same residents (bot-dev2.log). No behaviour change by design |
| Each new test fails with its fix reverted | 23 of 23 reversions fail their test on the merged tree (mutate-merged.log; *Resumed run (Nov 9)*) |
| Row W1.3: `recovery.test.ts` | passes: T033's 25 loopback cases plus 2 new; the same row through the real worker is workerRecovery.test.ts, 11 cases, all pass |
| Row W1.3: S2 (save in one host, load in the other) | hosts.test *W1.3 (S2): with the worker's own IndexedDB, a save in one host loads in the other and continues identically* passes (Worker → Local and Worker, Local → Worker) |
| Row W1.3: the Playwright kill-the-tab test restores with the journal (= the task's §5 recovery check) | **deferred to Desktop QA D1 (NOTE-061)**; passed on the cloud on Nov 3 at `79268af` (*Browser evidence*) |
| Row W1.3: at 1M a save blocks the worker ≤ 60 ms and the main thread ≤ 2 ms | measured in node, not gated (decision 14); savecost4.log, dense1m (population 1,118,755, 17,154 buildings, 256²), 7 saves, load average 2.0-4.0 on the shared 4-core container. **Worker:** the save:copy unit median 50.1 ms, max 62.0 ms (copySave 49.8 / 61.4, its boundary flush 0.42 / 0.67); the save:put unit (the put's structured clone) median 13.3 ms, max 19.0 ms; the two as one task would be 58.4 / 79.6 ms, which §4.2's two units avoid. **Main thread:** the `saved` reply's settlement median 0.17 ms, max 0.70 ms; the whole packet that carries it median 0.75 ms, max 1.0 ms. The worker's median is within 60 ms and its worst run 2 ms over, in node under load; Chromium on the real GPU is D7 |
| Task: old saves load and continue | hosts.test *W1.3: an old save (the grown fixture, bot256_s7_y60) loads through the worker's IndexedDB and continues as LocalSimHost does* passes (in the full vitest, with `SIM_FIXTURES`) |
| Task: `auto` stays `'main'` until W1.4 | unchanged: src/worker/policy.ts has no diff against dev; main.ts's `useWorker()` is as T034 left it |
| Newer dev, landed during the gates: `146c885` (T057, T060 FEEL-01, T048, NOTE-062 to NOTE-064), then `cb6ca4c` (T036s5, which touches SimCore.ts, simWorker.ts, loopbackCore.ts, protocol.ts and SimHost.ts beside W1.3) | both trial merges (`git merge-tree`) are clean. On each merged tree, in a throwaway export: tsc clean; with `146c885`, the lane's tests plus T057's loadContinuity and serialize tests, 8 files, 85 passed (trial-146c885-tests.log); with `cb6ca4c`, the lane's tests plus loadContinuity, emergencyReads, simCore, loopbackHost and protocol, 11 files, 105 passed, and T036s5's emergencyTeachingHost / emergencyTeachingWorker with replicaSafe and workerSpeed, 4 files, 17 passed (trial-cb6ca4c-tests.log, -tests2.log). T057's combination fix (055baad, systemData key order) keeps W1.3's S2 hash checks green. Not merged here: no conflict (NOTE-057), and the merge step reruns the full vitest and the bot |

### Browser evidence

**The browser gate on the final code is deferred to Desktop QA (NOTE-061).** On Nov 9 the lead moved every browser
check to the desktop's real GPU (NOTE-061, 1c2019c) and made the cloud's lock refuse them. This run queued
tools/qa-journal.mjs on `d04432b` before that note landed; its waiter was terminated while still waiting for the lock,
by another process as NOTE-061 took effect, and never ran (w13work/browser3.cancelled.log: `Terminated`, exit 143). It
was not retried. Item D1 of the *Desktop QA* list is that
check on the final commit.

**The cloud's last run of the check passed, on Nov 3** (`79268af`: W1.3's code as it stands, before dev's T034b,
T040, T052, T053 and T058 merged in; production build, `?quickstart=1&size=small&seed=7&simworker=1&simdev=1`, Chromium
on SwiftShader; 13 min under the lock). Log: /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1.log and /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/log.txt. Every CHECK line passed:

| Check | Result | Screenshot (looked at) |
|---|---|---|
| 1. the city runs on a worker with its own IndexedDB | PASS: `kind 'worker'`, `persistence 'worker-idb'`, the mirror bound | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/11-journal-before-close.png (the zone edit is still pending when the tab closes: `pending 1, zoned 0`) |
| 1. the title offers the journal alone | PASS: "A record of your edits since the last save was kept on this device"; the IndexedDB journal holds setTax, setFunding and the zone, with its `info` | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/12-journal-offered.png |
| 1. the worker replays it: the edit made as the tab closed is back | PASS: tax 13, fire funding 130, the 24-cell zone | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/13-journal-restored.png (the zone patch, the pill reads Saved) |
| 1. and saves before its Ready | PASS: a new record (`savedAt` …118377) holds the edits, the journal is gone, changes 0 | (same) |
| 2. the worker stored its own snapshot | PASS: IndexedDB snapshot written by the worker, 20,696 bytes, the localStorage journal rebound to it | |
| 2. the snapshot is offered | PASS: "A recovery snapshot of your last session…" (a snapshot of the city wins over a save-bound journal, decision 7) | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/22-snapshot-offered.png |
| 2. the snapshot restores and its re-bound journal replays in the worker | PASS: tax 15, police 120, both zones | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/23-snapshot-recovered-journal-replayed.png (both zone patches) |
| 3. the first save holds the edits and leaves no recovery record | PASS: the record has tax 15; no IndexedDB journal or snapshot; no localStorage slot | /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/w13work/browser1/out/31-saved.png (the city runs at speed after that save, Apr 4 to Apr 8, so its pill reads unsaved again; the check reads the stored record) |
| 4. no page or console errors | PASS: none | |

The Nov 3 run logged `closed false` right after `page.close()`; `984ec54` then made the kill step wait for the tab's
`close` event and fail when the tab stays open. That stricter script has not run on the cloud (D1 runs it).

### Desktop QA (NOTE-061: on `cloud/w13` at its head, on the real GPU, before the merge)

NOTE-061 has the desktop run each cloud lane's checklist on its `cloud/*` branch; the cloud merges once it passes. The
code is as of `cd2ab47` (later commits on the branch are this report and the done marker). The
production build (`npm run build`, `vite preview`), Chromium. Push the result into this report on `local/qa-w13` and
message the lead "QA w13: PASS" or "QA w13: FAIL" with the findings: pass or fail per item, with screenshot paths.

| # | Page and flags | Steps | Expected |
|---|---|---|---|
| D1 | `node tools/qa-journal.mjs --port <free port> --out <dir>` (it builds and serves `?quickstart=1&size=small&seed=7&simworker=1&simdev=1` itself) | the scenario as written | every CHECK line PASS: the journal alone offered and replayed by the worker, which saves before its Ready; the worker's snapshot offered, restored, its journal replayed; the first save leaves no recovery record; no page or console errors |
| D2 | `node tools/qa-worker.mjs` in worker mode (`--host worker`, NOTE-047's T028 rerun), at size 256 | the whole harness; W1.3 changes the persistence under its save, load, crash, recover and watchdog steps (the worker now writes its own IndexedDB) | as T028/T034b gated it: every check PASS. In particular *recover: the snapshot restored on a new worker, with the edit* (the worker, not main, stored that snapshot now) |
| D3 | `/?quickstart=1&size=small&seed=7&simworker=1&simdev=1` | save (Ctrl+S); raise the residential tax and zone a block; at once crash the worker from the console: `__metropolis.city.host.link.post({t: 'tick', seq: 0, dt: -1, ack: 0})`; in the crash dialog choose **Recover unsaved progress** | a new worker boots with the tax and the zone back (no worker snapshot was taken, so it is the journal alone); the save pill reads saved (the worker saved before its Ready); no second recovery offer |
| D4 | the same | as D3, but choose **Restart from autosave** | the city is the save, without the edit; back at the title and opening the city again offers the journal ("A record of your edits since the last save…"); Discard deletes it |
| D5 | the same | as D3, but choose **Continue on the main thread** | a local host (`__metropolis.city.host.kind === 'local'`) runs the save without the edit |
| D6 | worker session, then the default host: `/?quickstart=1&size=small&seed=7&simworker=1&simdev=1`, then `/?simdev=1` (no `simworker`) | in the worker session: save, change the tax, close the tab; reopen without `simworker`, Continue: the title offers the journal; Recover | LocalSimHost replays it (the tax is back) and the city reads as unsaved until the next save, which removes the journal (decision 5) |
| D7 | a 1M city (dense1m fixture imported), `?simworker=1` | Save, with a performance recording | the worker's longest task in the save ≤ 60 ms (save:copy and save:put are separate tasks, §4.2); the page's handling of the packet that carries the `saved` reply ≤ 2 ms (row W1.3's acceptance; decision 14; the node numbers are in *Gates*) |

### Decisions (conservative readings, for the lead)

1. **The base** (settled). T034 was not in dev when this lane started, and W1.3 is built on its worker, so `cloud/w13`
   merged `cloud/t034` at `042efa5`. T034 has since merged into dev (`5c40d77`, with T034b), and this branch merged dev
   after it (`70e110f`, `d04432b`): the merge step brings W1.3 alone.
2. **G17 (b), the `speedChanged` order, is T061's** (NOTE-049 queued it after this lane started, "beside W1.3"; it owns
   that fix in LoopbackSimHost.ts). This lane's WorkerSimHost.ts changes are the persistence paths only, so T061's
   items there merge around them.
3. **The crash dialog's Restart and Continue on the main thread boot the save without the journal**, and leave it in
   place, as T034 left the crash snapshot (decision 4 there): it is offered again when the city is next opened, until
   the next save or recovery write replaces it. Only Recover replays it. The alternative, discarding it, would delete
   progress the player did not choose to delete.
4. **The cadence of min(30 s, 90 sim days) applies to the packet hosts only** (the worker, and the loopback, which has
   the journal). LocalSimHost, the default until W1.4, keeps its 30 s: its snapshot runs on the main thread (50-110 ms at
   1M), and the 90-day bound would add one every 4.5 s at ultra with autosave off. Both skip a request when a save is
   newer, the local host as before (its window counts from its last snapshot), the packet hosts from the later of the two.
5. **LocalSimHost replays but does not save after the replay.** §4.3 has the worker save before its Ready; the local host
   has no Ready, so it takes the design's failed-save path: the city reads as unsaved and the journal stays bound to the
   save until the first save deletes it. A second crash before that save replays it again, onto the same save.
6. **Persistence 'main' keeps the journal only when the page's store persists** (the boot fallback after
   IDB_UNAVAILABLE). With MemoryKV there is nothing to recover after a reload, and the App takes no snapshots then.
7. **A city's snapshot wins over a journal alone bound to its save** at the title screen (§4.3 offers "either a snapshot,
   with its journal if one matches, or a journal alone"): replaying a save-bound journal under a snapshot that already
   holds its edits would apply them twice. A worker snapshot whose reply was lost in a crash is the one case where that
   journal is newer; the snapshot is still the offer, as before W1.3.
8. **`findRecoverySnapshot` now deletes journals that can never apply** (bound to a replaced save or snapshot, city or
   region gone, no edits), as it deletes such snapshots. W0.6's `recoveryIdb.test` case that expected a stale journal to
   survive is updated to say so.
9. **Two additive protocol fields:** `Journal.info` (the description of a journal alone) and `fatal.code` (the
   IDB_UNAVAILABLE boot error). `WorkerInit.replay` is W1.3's own (workerProtocol.ts).
10. **The kill-the-tab check is a scenario of its own** (tools/qa-journal.mjs, committed with this lane), not a step in
    tools/qa-worker.mjs: the worker-mode acceptance harness is T028's lane, on the desktop since NOTE-047, and folding the
    step in there is that lane's merge.
11. **FH-22's `setOnboarding`** (NOTE-048: "journaled like setTax. T039 confirms the recovery treatment"; NOTE-051
    has T037a add it) is not in dev or in any fetched branch yet. The treatment for T037a: it is journaled only once `'setOnboarding'` is added to
    `JournalOp` (protocol.ts) and `JOURNAL_OPS` (recoveryCodec.ts); it is a whole-record set, so it replays
    idempotently at the base's day through `SimCore.applyCommand`, in every host's boot replay. Journal it.
12. **Test changes to earlier lanes' cases, by design:** T033's *discards a journal when the stored record changed,
    including a LocalSimHost save* boots that local host with `replayJournal: false` (a local host now replays the
    journal, which would make its save contain the edit); T033's *moves the unload journal into IndexedDB at title time*
    now expects the journal alone to be offered (its own comment said "W1.3 adds that offer"); T034's hosts.test cases
    for persistence 'main' now expect no mirror with MemoryKV, and the mirror's snapshot plus journal with a persistent
    store; T058's *takes t0 after the recovery gate and passes that t0 to enterCity* (a source check) accepts `t0` followed
    by W1.3's `replay` argument (Nov 9 merge).
13. **The region tile's summary is not refreshed by the boot save** (it has no `saved` reply); the next save refreshes it.
14. **The 1M save cost is measured in node, not gated.** Row W1.3's "a save blocks the worker ≤ 60 ms and the main
    thread ≤ 2 ms" is a browser number on a quiet machine; here it is node on a 4-core container shared with other
    agents, and the test prints the load average with its numbers. tests/perf/saveCost.test.ts times the worker's two
    units on dense1m (save:copy, then the put's structured clone) and the page's handling of the packet that carries the
    `saved` reply from the real worker; it asserts no time. The numbers are in *Gates*; a Chromium (and real-GPU)
    reading belongs to the measurement lanes.
15. **The browser check closes the tab with the host's asynchronous snapshot held** (`host.snapshot` replaced by a
    promise that never settles), so the worker's own IndexedDB snapshot, taken on `hidden`, cannot stand in for the
    journal; what is checked is the unload path alone, the worst case of §4.3. Step 2 then lets the worker store a
    snapshot first and checks the journal bound to it.
16. **"Journal replay in `SimCore.boot`" is `SimCore.replayBootJournal`, called by every host right after `boot()` and
    before the first tick** (Nov 9 note). `boot()` is synchronous and the journal is read from IndexedDB, which is
    asynchronous, so each host reads it first (the worker in its boot phase `'journal'`, LocalSimHost alongside its
    module loads, the loopback in `start()`) and replays it before anything ticks. That is the row's ordering, and one
    replay path for every host.
17. **The crash dialog's Recover with a journal is checked by host tests, not in a browser here** (Nov 9). The main.ts
    wiring (`playCity(…, choice === 'recover')`) and the worker-idb paths under qa-worker.mjs's crash, recover and
    watchdog steps are items D2-D5 of the *Desktop QA* list.
18. **The task's browser gate (§5's recovery check) is deferred to Desktop QA** (NOTE-061, Nov 9: "The cloud stops
    running browser checks on SwiftShader"; the lock now refuses them and says not to retry). It passed on the cloud on
    Nov 3 at `79268af` (*Browser evidence*), with W1.3's code as it stands; since then only dev's lanes merged in, and the
    lane's tests and the 23 reversions pass on the merged tree. D1 reruns it on the final commit; the lane is reported
    `partial` until the desktop passes it.

### Left for others

- T061 (NOTE-049): the `speedChanged` order in PacketSimHost (G17 b), the dispatch provenance, the clock cap. A trial
  merge of `cloud/t061` (`825d1df`, Nov 9) with `cloud/w13` (`d04432b`) is clean (`git merge-tree`, no worktree
  touched); either can land first.
- T028 / qa-worker.mjs: fold tools/qa-journal.mjs in as its W1.3 step, if wanted (R14 moved "the journal check of
  qa-worker.mjs" to W1.3; it lives in qa-journal.mjs for now, decision 10).
- The merge step: dev has moved to `cb6ca4c` (T057, T060 FEEL-01, T048, T036s5); the trial merges are clean and the
  lane's tests pass on them (*Gates*, last row).
- Real-GPU and Chromium numbers for the save costs (decision 14).
- The desktop: the *Desktop QA* list above, on `cloud/w13` before the merge (NOTE-061).
