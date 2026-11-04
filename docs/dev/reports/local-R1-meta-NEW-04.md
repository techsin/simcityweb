# T036 step 4 report: NEW-04, storage you can trust (with FEEL-02b's autosave floor) (desktop, real GPU)

**Verdict: done.** Every NEW-04 and FEEL-02b acceptance line passes on the real GPU after one fix round, with B1 as
the lead set it (NOTE-058). One known host issue is the cloud's: B9, the Worker-protocol save reply drops the error
name, so the guided quota dialog shows only on the default host until T061 item 7 lands (NOTE-058). FEEL-02b's own
report is docs/dev/reports/local-R1-meta-FEEL-02b.md.

Branch `local/T036s4-storage`: `2f040cc` main.ts's small storage hunks, kept apart; `8229b70` the lane; `9dee989` round 1;
QA fixes `ad1b095` (B2), `37c7605` (B1, B3-B8), `cb58ab8` (B1's backoff, NOTE-058); dev `63c8f58` merged in.

## Cloud carry-over (Nov 3)

Branch `cloud/t036s4` (worktree `scratchpad/co/t036s4`), from `local/T036s4-storage` (`3e7c299`, DONE on the desktop),
with dev merged in twice: `086152a` (T034 with T034b, the WorkerSimHost behind `?simworker=1`) at `dc2a27d`, then
`f1c9713` (T040 merged, the Nov 4 handoff) at `fa7e3e2`. This is a cloud verification, not new work. As the lead set
this step, it ran only tsc and the lane's own test files (under the CPU semaphore, `--maxWorkers=2`) and started no
browser. The real-GPU checks are the desktop's (16 runs on `833fc2f`, above). The full vitest and the bot run at the
merge step.

Read: T036s4-new04-feel02b.md, T036-polish-r1-meta.md step 4, NOTE-044, NOTE-047 item 4, NOTE-058, and the T036 lines
in NOTE-045, 046, 048, 049, 055 and 057. Also: POLISH_PLAN NEW-04 and FEEL-02b in full with their Acceptance, D6 and
D16; this report and the FEEL-02b one; the diff against dev; the Nov 4 handoff's `wip/co_t036s4.uncommitted.patch` and
`bundles/cloud_t036s4.bundle`.

### Gap list (required versus done, at `3e7c299`)

| # | Required (source) | State at `3e7c299` |
|---|---|---|
| G1 | Dev merged in, keeping T034's WorkerSimHost (this step) | **Missing.** One conflict (`App.snapshotNow`'s guard) and, after it, one type error: T034 made `startNewCity`'s `st` nullable |
| G2 | NEW-04: a second tab cannot save (save buttons off, autosave off); "Use it here instead" both ways; the first tab says "This region is now open in another tab"; the lock API's own steal; a BroadcastChannel fallback | Done (`db.ts` `RegionSaveLock`, `StorageDialog.ts` `RegionStorageSession`, the CityScene / PauseMenu / SaveStatus gating); unit tests with a fake `navigator.locks`; real-GPU PASS |
| G3 | NEW-04: a `QuotaExceededError`, or an estimate within 5% of the quota, opens the guided dialog (Export, Manage storage, Retry), never the raw exception; other errors get one sentence plus Details | Done; unit tests; real-GPU PASS on the default host |
| G4 | NEW-04: `persist()` once inside the Found click; the backup reminder until an export, then 7 days | Done; unit tests; real-GPU PASS |
| G5 | FEEL-02b: 60 s real-time floor; silent autosave (minimap chip only; Ctrl+S keeps pill and chime); both labels | Done; real GPU: 5 autosaves in 5 min at ultra, 0 chimes, 0 pills; the 1x autosave at 67.6 s |
| G6 | NOTE-058 B1: a backoff and one error sound per failure streak | Done in `cb58ab8`; real GPU: gaps 60.7, 121.5, 240.1, 481.2, 900.5 s |
| G7 | Saves through `host.save` and `host.snapshot` (W0.6) | Done |
| G8 | Desktop work saved mid-edit, verified line by line (`2f040cc` wip; the `091a181` snapshot of round 4) | To verify here |
| G9 | NEW-04 on dev's new host, WorkerSimHost: the lock fence, the quota error's name, Export of the live city | **Untested.** The lane predates T034; its report asks for a "worker ownership fence" |
| G10 | main.ts hunks small and listed; save-path edits limited to NEW-04/FEEL-02b; no src/sim change | To confirm on the merged tree |
| G11 | Manage storage lists "regions and NEW-03 slots with their sizes" | NEW-03 is not in dev; regions, city saves and recovery snapshots are listed with sizes |
| G12 | FEEL-02b's recovery check (kill the tab 50 s after an autosave) | Waits for W1.3 (T039) |
| G13 | B9: the loopback's quota dialog | T061 item 7 (NOTE-058) |
| G14 | Gates: tsc, the full vitest, the bot identical (192,899) | tsc here; the full vitest and the bot at the merge step |

### What the carry-over did

- **G1, the merges.**
  - `dc2a27d`: `snapshotNow` keeps both guards, dev's `c.crashed` and the lane's `regionSaveAccess(model.data.id)`.
  - The founding write passes `st!` into `withRegionSaveAccess`'s closure. A second `const` binding would keep main's
    founding state alive past T034's `st = null` (O6: main keeps no state of its own on the worker path).
  - The handoff's `co_t036s4` WIP patch is an earlier cloud agent's uncommitted merge of the same T034. It resolved both
    places the same way and holds nothing else. Its bundle's `cloud/t036s4` is `3e7c299` itself.
  - `fa7e3e2`: dev's T040 merged cleanly. Its files (BuildingRenderer, Fireworks, their tests) are not the lane's.
- **The merge, beyond its conflict:**
  - **`exitCity` retries a failed exit save on every host.** W0.6 limited it to `c.host?.kind === 'local'`, and dev
    still has that check. The lane dropped it, so the guided dialog and Retry cover the packet hosts too; the merge
    keeps the lane's line (decision 1).
  - **The worker path passes `persistence` to the CityScene** (`enterCity`). So `regionSaveAccess(this.opts.persistence?.regionId)`
    in `CityScene.save` and `onMonth` holds on the worker host, and the replica's `month` event drives the floor there.
  - **WorkerSimHost stores the worker's saves and snapshots on the page**, through `openKV()`'s KV (R14:
    `storeSave` and `storeSnapshot`). So `db.ts`'s per-write guard in `IdbKV` / `MemoryKV` `put` and `delete` fences
    them, and a page-side `QuotaExceededError` reaches `host.save` with its name. This answers the lane's "worker
    ownership fence" request for W1.2. W1.3 is still open (Remaining).
- **G9, the new test** `tests/worker/workerStorage.test.ts` (`27e3ca1`). It runs the real worker under worker_threads
  (`workerHarness.bootNode`) and has three cases:
  - A tab that lost the region lock (a second `RegionSaveLock` steals it) stores neither a save nor a snapshot. The
    record stays the lock holder's, and both reject with `NotAllowedError`.
  - A store whose `cities` put throws `QuotaExceededError` makes `host.save` reject with an error that
    `StorageDialog.isQuotaError` accepts.
  - `snapshotRegionFile` (the guided dialog's Export) writes the running city from the worker's snapshot (tax 13 after
    a change) and saves nothing (the record keeps 9).
  - Each case fails with its code reverted:
    - without the `requireStoreSaveAccess` line in `MemoryKV.put`, case 1 fails ("promise resolved … instead of
      rejecting");
    - with `WorkerSimHost.write` rejecting with a new `Error`, cases 1 and 2 fail;
    - without `file.cities[marker.tileKey] = city` in `snapshotRegionFile`, case 3 fails ("expected 9 to be 13").
- **G8, the desktop's mid-edit work.**
  - The round-4 snapshot `091a181` ("a Codex lane is still editing") has src and tests identical to the committed
    `cb58ab8`: `git diff 091a181 3e7c299 -- src tests` is empty. The QA'd tree is the snapshot's.
  - Read line by line and correct:
    - `CityScene.save` / `onMonth` / `recordSaved`: the floor on `performance.now()`, counted from the last save or
      from scene start;
    - the streak's `retryAt` set from the failure's own completion, `min(15 min, 60 s x 2^(n-1))`;
    - the error sound only on a streak's first failure or a manual save;
    - ownership loss cancels the pill and opens no dialog;
    - an `'exit'` failure leaves the dialog to `exitCity`.
  - Also read: `SavePill`'s silent auto path, the `NewCityDialog` `onFound` hook (one call, guarded against a
    repeated click), `regionLock.ts`, `StorageDialog.ts` and `db.ts`'s lock.
  - `2f040cc`'s main.ts hunks are each in their listed place (the imports, the session, guarded writes, save-button
    state, `recordSaved`, the guided errors, and the fixed-id entry points' `reset`).
- **Mutation checks of the lane's own tests: 8 of 8 caught.**

  | Fix reverted | File | Result |
  |---|---|---|
  | floor 60 s → 0 | autosaveFloor | 13 failed |
  | the autosave chime back | autosaveFloor | 3 failed |
  | backoff multiplier 2 → 1 | autosaveFloor | 4 failed |
  | an error sound on every failure | autosaveFloor | 8 failed |
  | the autosave pill shown | autosaveFloor | 6 failed |
  | `onFound` not called in the Found click | foundingPersistence | 1 failed |
  | quota errors not recognised | storageDialog | 6 failed |
  | the takeover without `steal` | storageDb | 5 failed |

- **G10, confirmed on the merged tree.**
  - `git diff origin/claude/beautiful-johnson-u2jqoz HEAD -- src/sim src/worker` is empty.
  - The lane's src against dev:
    - `CityScene.ts` +40/-9 and `main.ts` +45/-26;
    - `db.ts` +308: the guards, persist / estimate and the lock; `DB_VERSION` stays 2, with no store or schema change;
    - `recoveryLs.ts` +4: an import and three guards;
    - `NewCityDialog.ts` +4;
    - the owned UI files.
  - Every save-path hunk serves NEW-04 (the lock, the guided errors, persist) or FEEL-02b (the floor, the silent
    autosave). No save format, balance or RNG change.

### Gates (this step)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (semaphore) | **clean** after each merge and on `27e3ca1` |
| The lane's 13 new or changed test files, plus the new `tests/worker/workerStorage.test.ts`, plus `tests/worker/hygiene.test.ts`, the worker graph gate T034 added after the lane's base (`--maxWorkers=2`) | **15 files passed, 145 tests passed, 0 failed** (16.4 s) on `27e3ca1`: the 13 lane files 124, workerStorage 3, hygiene 18. The same 13 files gave 124 of 124 on `dc2a27d` |
| New test fails with its code reverted | 3 of 3 (above) |
| The lane's tests fail with their fix reverted | 8 of 8 (above) |
| Full vitest | **not run in this step** (the merge step runs it) |
| Bot 128x15 s7 | **not run in this step.** It is required at the merge step because src/game and src/save changed. No sim change by design: expected identical to dev, `residents [ 61124, 93804, 37971 ]` = 192,899 |
| Browser | **none in this step** (the lead's instruction). The evidence is the desktop's real-GPU QA above (RTX 5070 Ti, 16 runs on `833fc2f`; notes in the desktop's scratchpad `qa/T036s4/qa.md`) |

### Decisions

1. **The exit retry on every host (merge).** W0.6's rule was that "the non-local branch never re-saves a replica",
   and it still holds: `PacketSimHost.save` posts a `save` to the worker or loopback core and never serializes the
   replica. So the lane's version stays. A failed exit on the worker host gets the guided dialog and Retry and keeps the
   city, instead of closing it behind a recovery snapshot.
2. **Manage storage without NEW-03 slots.** NEW-03 is not in dev. Manage storage lists each region, its city saves and
   its recovery snapshots with their sizes. NEW-03 adds its history slots there when it lands.
3. **The floor counts from the scene's start.** The city was just loaded, or founded and saved, so the first autosave
   comes at least 60 s after entry. That matches the plan's "60 s after the last save" and the 1x acceptance.
4. **Export from a full store on the worker host is left failing visibly, not fixed here.** `WorkerSimHost.storeSnapshot`
   writes the snapshot to IndexedDB before it resolves. So with the store full, or in a tab without the lock, the live
   Export rejects ("That could not be completed"). The local host still returns the payload. The fix is in
   WorkerSimHost.ts, which NOTE-049 keeps for T061, so it goes to Remaining. The worker host is opt-in
   (`?simworker=1`); the default host passes.
5. **No browser on `?simworker=1` in this step.** The worker-host integration is covered by the unit tests above. A
   two-tab and quota-stub check on `?simworker=1` is the merge step's or the desktop's choice.

### Remaining

- FEEL-02b's recovery check after W1.3 (T039): kill the tab 50 s after an autosave; the restore offers the last
  snapshot (at most 30 s and 90 game days old) and every journaled edit.
- B9, the loopback's quota dialog: T061 item 7 (NOTE-058).
- **For T039 (W1.3):** `cloud/w13` adds `'worker-idb'` persistence, where the worker writes its own IndexedDB. Those
  writes bypass the page's `db.ts` guard, so the region lock must reach the worker. T039 should add the
  `tests/worker/workerStorage.test.ts` lock case for `'worker-idb'`.
- **For T061 (or the lead):** `WorkerSimHost.storeSnapshot` should resolve the encoded payload with `idb: false` when
  `storeRecoveryIdb` fails for quota or ownership, as the local host does. Then a full or read-only tab can still export
  the running city on the worker host. This is the lane's "Additional Worker live-export request", restated for the
  real worker.
- The merge step: the full vitest and the bot against dev.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest with the fixtures (`833fc2f`) | **235 files passed, 2 skipped; 2,344 tests passed, 11 skipped; 0 failing** |
| 128×15 s7 bot with the action log | **identical to dev:** residents [ 61124, 93804, 37971 ] = 192,899 |

## Real-GPU QA, round 2 (RTX 5070 Ti, driver 610.47, ANGLE D3D11, Chromium; 16 runs)

| Line or finding | Result | Measured |
|---|---|---|
| Two real tabs: the second cannot save; "Use it here instead" both ways | **PASS** | only the lock holder's writes reach the store; the old tab's AbortError arrives in the same millisecond as the steal; also with BroadcastChannel and with two cities of one region |
| 5 minutes at ultra on a 304k city: at most 5 autosaves, 0 chimes, 0 pills | **PASS** | 5 autosaves, the shortest gap 60.65 s |
| The 1x floor: an autosave at the first month end at least 60 s after the last save | **PASS** | at 67.6 s, none at 52.3 s |
| The quota path: the guided dialog (Export, Manage storage, Retry), never the raw exception | **PASS** | Export writes the running city (day 5087 = live), also with every store write failing |
| persist() once inside the Found click; the backup reminder until an export | **PASS** | |
| Both labels: "Every N game months, at most once a minute" | **PASS** | "Autosave · Every N game months, at most once a minute" |
| B1: a failed autosave backs off with one error sound per streak | **fixed** | gaps 60.7, 121.5, 240.1, 481.2, 900.5 s (the 15-min cap); one sound per streak, 0 pills; none while a storage dialog is open; a success, cleanup or manual save resets it; Ctrl+S keeps its own feedback |
| B2: the backup reminder covered the tile card and drew above dialogs | **fixed** | 300×127 px, top-centre at y 150, z-index 4, at 1024×600 to 1920×1080: clear of the tile card's buttons and below the New City, Settings and Recover dialogs |
| B3: keys passed through storage dialogs | **fixed** | `3` and Space do nothing; Escape closes only the dialog |
| B4-B8: takeover mid-save, the chip and Settings copy, the takeover recovery offer, Export of the live city | **fixed** | no dialog or sound after a takeover mid-save; the new holder's tile shows the record |
| B9 on loopback | recorded | owned by T061 item 7 (NOTE-058) |
| Console and page errors | **PASS** | none, apart from two expected console.error lines under the quota stub |

By design (NOTE-058) the guided dialog reopens on each failed autosave of a streak. QA notes: scratchpad
`qa/T036s4/qa.md` (rounds 1-2), with data and screenshots.

The lane's own notes follow.

## The lane's notes (rounds 1-4): T036s4 · NEW-04 storage you can trust

## Review round 4 · NOTE-058

One uncommitted behavior change replaces round 3's constant failed-autosave delay/zero error sounds with exponential real-time backoff and one error sound per failure streak. `CityScene.ts` uses named 60-second initial delay, 2× multiplier and 15-minute cap; successful complete saves and successful storage cleanup reset the streak. `StorageDialog.ts` supplies the small cleanup revision after successful region deletion. Export/Close and failed manual saves do not reset it. The normal minute floor, dialog-open suppression, silent successful autosaves, manual feedback and ownership cancellation remain in place. Partial city acknowledgements cannot erase a streak of failed region writes.

Fake ultra timers in `tests/game/autosaveFloor.test.ts` cover the retry schedule/cap, one error per streak, success/cleanup resets and in-flight/partial-save cases; `storageDialog.test.ts` tests the cleanup signal; `citySaves.test.ts` has minimal fixture additions. No main.ts, recoveryLs.ts, worker or infra hunk; no simulation, balance, save-format or RNG change. The companion FEEL-02b round-4 section has exact timing expectations and the browser checklist. The worker's bot baseline remains **192,899** (`[61124, 93804, 37971]`); command below, not rerun here.

Validation: **TypeScript passes; 17 serial quiet-gated files pass, 163 tests passed / one existing skip**, using the native-loader/thread-pool command below after the timing block ended. `git diff --check` and UTF-8/no-BOM checks pass. These results supersede round 3's blocked targeted validation. The full suite and browser checks remain with the lead.

Minimal fixes to committed round-3 test fixtures were needed for these checks: `storageSaveStatus.test.ts` declares its callback as `() => void`; `regionStorage.test.ts` explicitly casts its intentionally partial fixture through `unknown`; `storageDialog.test.ts` exposes real `MemoryKV` in its db mock for the existing fixture import. Assertions and production behavior are unchanged by these fixture fixes. The first two are additional one-line existing-test hunks outside this round's behavior tests. `main.ts` remains **+0/−0** this round; infra hunks: none.

| Test file | Result |
|---|---:|
| `tests/game/autosaveFloor.test.ts` | 29 passed |
| `tests/game/storageDialog.test.ts` | 27 passed |
| `tests/game/citySaves.test.ts` | 7 passed |
| `tests/game/storageSaveStatus.test.ts` | 5 passed |
| `tests/regionStorage.test.ts` | 9 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |
| `tests/game/storageCopy.test.ts` | 5 passed |
| `tests/game/labelFrame.test.ts` | 5 passed |
| `tests/game/newCityStart.test.ts` | 7 passed |
| `tests/game/titleSettings.test.ts` | 12 passed |
| `tests/storageDb.test.ts` | 14 passed |
| `tests/save/foundingPersistence.test.ts` | 2 passed |
| `tests/save/liveRegionExport.test.ts` | 8 passed |
| `tests/save/recoveryStorageLock.test.ts` | 5 passed |
| `tests/save/regionEffects.test.ts` | 3 passed |
| `tests/save/regionSaveAccess.test.ts` | 4 passed |
| `tests/save/regionSummaryReload.test.ts` | 4 passed |

**Known host issue — T061 item 7:** per `docs/dev/queue/NOTE-058-lg03-b9.md`, B9 (Worker save replies dropping the exception name) is now owned by T061. The loopback quota-dialog check is a known host issue until T061 lands, not a T036s4 failure. No worker edit is requested from this lane for B9.

## Review round 3 · real-GPU QA follow-up

Starting commit `68aa888`; changes in this round are uncommitted. The worker's real-GPU QA passed every original acceptance item on the default host, then identified B1–B8 below. B9 remains cloud-owned and pending. No browser or timing run is started by this lane.

1. **B1 — failed autosaves:** `CityScene.ts` restarts the minute floor when an automatic attempt fails, makes no automatic attempt while a storage dialog is open, and leaves error sounds to manual saves. Explicit Retry still bypasses the floor. `autosaveFloor.test.ts` covers the failed-attempt timestamp, repeated month ends, open-dialog suppression and manual feedback.
2. **B2 — reminder layout:** `storage.css` places the reminder at top-center, 150px from the top, 300px wide, at HUD z4 below dialogs (z40). It sits between the region card and city list, below the toolbar/lock banner and above the lower tile card, remaining visible when a tile is selected. At 1024px wide its x362–662 span clears the region card ending at x318 and the city list starting at x736; at 600px high it remains above the tile card. The change is CSS-only.
3. **B3 — keyboard isolation:** `StorageDialog.ts` exports `storageDialogOpen()` for the actual dialog stack; `CityScene.onKey` checks it beside `confirmOpen()`. Tests cover 3, Space, Escape and Ctrl+S, plus the closed-dialog baseline and nested manager/error lifetime.
4. **B4–B8 — small fixes:**
   - `CityScene.ts`, `Modals.ts` and `StorageDialog.ts`: ownership loss cancels pending save feedback and suppresses the unworkable error dialog. `regionLock.ts` repairs stale or absent tile summaries/totals from newer stored city records after acquisition, preserving founding date and thumbnail without writing them during takeover. Tests include in-flight loss and stored-record reload.
   - `region/ui/SaveStatus.ts`: existing disabled-chip wiring now renders “Open in another tab” and explains that this tab cannot save. No App change is required.
   - `region/ui/dialogs.ts`: restores “Autosave” in the app/region Settings label and explains a takeover recovery as progress from another tab. `StorageDialog.ts` records takeover before reloading and compares the snapshot timestamp, preserving the explanation on Retry without applying it to a later failed exit from this tab.
   - `StorageDialog.ts`: a live-city Export asks `host.snapshot('hidden')`, reconstructs that payload against its matching base, replaces the running city in the downloaded region, and updates its exported tile summary/totals. Other cities remain stored copies. It makes no city/region save; the host may refresh its recovery slot. Quota/readonly recovery writes may fail while the returned payload still supplies the backup. Missing or mismatched snapshots fail visibly rather than silently exporting older progress. The coordinator passes the current city through a live callback, with no `main.ts` hunk.

New tests: `storageSaveStatus.test.ts`, `storageCopy.test.ts`, `liveRegionExport.test.ts`, `regionSummaryReload.test.ts`; expanded `autosaveFloor.test.ts` and `storageDialog.test.ts`. Existing `citySaves.test.ts` learns the new dialog-state export and pill cancellation; `regionStorage.test.ts` supplies the new summary-read mocks. The `SaveStatus.ts` hunk is outside the original task list but directly implements round-3 B5. **`main.ts` and `recoveryLs.ts` are unchanged in this round. Infra hunks: none.** No balance, save-schema or simulation-RNG change.

Round-3 validation: `git diff --check` passes; all 17 changed files are valid UTF-8 without a BOM. `main.ts` has **+0/−0** this round, and `recoveryLs.ts` and `RegionScreen.ts` are unchanged. The quiet-gated `npx tsc --noEmit` never started because the shared `QUIET` flag remained set for about 50 minutes. Only this lane's waiting command was cancelled; the flag and timing processes were left untouched. There is no new TypeScript or Vitest result for this round. The worker already verified the unchanged 192,899 bot total on this base; no balance change or new bot run was made here. Full-suite and real-GPU regression remain with the lead.

Pending targeted files, one process at a time through the quiet gate:

- `tests/game/autosaveFloor.test.ts`
- `tests/game/storageDialog.test.ts`
- `tests/game/citySaves.test.ts`
- `tests/game/storageSaveStatus.test.ts`
- `tests/game/storageCopy.test.ts`
- `tests/game/labelFrame.test.ts`
- `tests/game/newCityStart.test.ts`
- `tests/game/titleSettings.test.ts`
- `tests/regionStorage.test.ts`
- `tests/storageDb.test.ts`
- `tests/save/foundingPersistence.test.ts`
- `tests/save/liveRegionExport.test.ts`
- `tests/save/recoveryStorageLock.test.ts`
- `tests/save/regionEffects.test.ts`
- `tests/save/regionSaveAccess.test.ts`
- `tests/save/regionSummaryReload.test.ts`
- `tests/worker/hygiene.test.ts`

Use the working native-loader invocation recorded below: set `NODE_OPTIONS=--experimental-transform-types`, then `node <quietrun.mjs> npx vitest run <file> --maxWorkers=1 --configLoader native --pool threads`. No full suite, bot or browser was started in this round.

Browser recheck:

- [ ] Keep quota failure active for several ultra months: one failed attempt, no automatic retry while either storage dialog is open, zero automatic error sounds; after Close, respect the restarted minute floor.
- [ ] Recheck the reminder and tile controls at 1024×600, 1280×720, 1366×768 and taller sizes; Settings/New City dialogs cover the HUD completely.
- [ ] With a storage dialog open, press 3, Space, Ctrl+S and Escape; city speed and pause menu stay unchanged. Escape closes only the top storage dialog.
- [ ] Take over during a save: old tab gets the ownership banner without failed-save feedback; new holder sees current city-record summaries.
- [ ] Read-only chip explains that this tab cannot save; restored ownership restores normal state wording.
- [ ] Quota Export contains the running city's day/funds/population and imports successfully, including a read-only tab; neighbour saves remain intact.
- [ ] Check the Autosave label and takeover recovery explanation.
- [ ] **Known host issue — B9, T061 item 7:** exception names are lost in worker failure replies (`protocolInbox.ts` save/snapshot handlers, `protocol.ts` failed reply shapes, `LoopbackSimHost.ts` reply rejection). Repeat the loopback quota-dialog check after T061 lands; this is not a T036s4 failure. No worker file is changed here.
- [ ] **Additional Worker live-export request:** `ProtocolInbox.snapshot()` in `src/worker/protocolInbox.ts` currently discards a successfully encoded marker/payload when `store.putSnapshot()` rejects for quota or ownership. Return that payload with truthful failed-persistence fields (`idb: false`, initially `ok: false`); encoding failures should still reject. In `src/worker/LoopbackSimHost.ts`, the snapped reply should expose the payload, attempt the existing guarded localStorage mirror, and derive `SnapshotAck.ok` from actual IDB/LS results. Keep ownership guards. This lets the Worker export current progress without requiring a recovery write, matching the tested local host. Worker live export under quota/read-only conditions is not verified until this lands.

Branch: `local/T036s4-storage`; base: `821a8d6`. Initial WIP: `2f040cc` (App/recovery guards) and `8229b70` (owned files). Review-round fixes below are uncommitted. No `.done` file was changed.

## Review round 1

The four reported failures are fixed. All assertions in the existing label tests and the Found persistence tests remain unchanged. The validation in this section supersedes the initial-run limitations recorded below.

Changes in this review:

- `tests/game/labelFrame.test.ts`: one fixture field, `abort: new AbortController()`. Its deliberate `Object.create(RegionScreen.prototype)` bypasses constructor initializers and already supplies the other cleanup dependencies. Real RegionScreen instances always have this controller, so production lifecycle code was kept strict and unchanged.
- `tests/save/foundingPersistence.test.ts`: its DOM stub now sets `min`, `max`, and `step` as attributes. Direct assignment hit FEl's getter-only properties and rejected the dialog promise before Modal construction, leaving `dialogs.current` null. Production Found handling is unchanged.
- New owned `src/region/regionLock.ts`: `RegionStorage` owns session replacement/reuse, initial latest-data reads, takeover callbacks using the live city/save chain, fixed-ID reset ownership, and Found-dialog persistence/stale-result checks. Same-region takeover reentry never waits on its own pending acquisition.
- `src/save/db.ts`: `withRegionSaveAccess()` contains the asynchronous quota and ownership checks before/after a save. The App still invokes the actual `host.save` or initial founding write.
- `src/ui/StorageDialog.ts`: extracted recovery gate, prompt permission recheck, and quota/ownership error handling, retaining locks while the player decides and refinding current recovery data on Retry. Exports the existing structural takeover-city type for the coordinator.
- `src/main.ts`: retains small calls to those helpers and the essential local write/stale-ack guards. **Total task diff against `821a8d6`: before +109/−24, after +44/−26** (`git diff 821a8d6 --numstat -- src/main.ts`). Both task-added App methods were removed. Original App save/recovery methods were not moved wholesale or decorated.
- New tests: `tests/regionStorage.test.ts` (9) and `tests/save/regionSaveAccess.test.ts` (4); `tests/game/storageDialog.test.ts` now has 20 cases, including seven extracted recovery-decision cases.
- **Outside-named existing-test hunk:** the one-field labelFrame fixture update above. **New extra owned file:** `src/region/regionLock.ts`, explicitly requested by the review. **Recovery guard:** `src/save/recoveryLs.ts` was untouched in this review and remains exactly +4/−0 against the task base. **Infra hunks:** none.

Validation: **TypeScript clean; 17 single-file Vitest runs, 131 passed / 1 pre-existing skipped; no failures.** Each test was run serially through the quiet gate. The default loader still fails on Vite's Windows `net use` child-process query (`spawn EPERM`); the supported native config loader with Node's TS transform and a thread pool runs successfully without modifying Vite, dependencies, or the repository's config:

```powershell
$env:NODE_OPTIONS = '--experimental-transform-types'
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <single-test-file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---:|
| `tests/game/labelFrame.test.ts` | 5 passed |
| `tests/save/foundingPersistence.test.ts` | 2 passed |
| `tests/game/citySaves.test.ts` | 7 passed |
| `tests/regionStorage.test.ts` | 9 passed |
| `tests/save/regionSaveAccess.test.ts` | 4 passed |
| `tests/game/storageDialog.test.ts` | 20 passed |
| `tests/sim/region.test.ts` | 6 passed |
| `tests/sim/regionJobs.test.ts` | 1 passed |
| `tests/save/regionEffects.test.ts` | 3 passed |
| `tests/infra/trafficRegion.test.ts` | 4 passed |
| `tests/game/newCityStart.test.ts` | 7 passed |
| `tests/game/titleSettings.test.ts` | 12 passed |
| `tests/storageDb.test.ts` | 14 passed |
| `tests/game/autosaveFloor.test.ts` | 11 passed |
| `tests/save/recoveryStorageLock.test.ts` | 5 passed |
| `tests/save/recoveryLs.test.ts` | 4 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

The worker's review verified the unchanged **192,899** bot total (`[61124, 93804, 37971]`). This review adds no simulation changes and does not repeat that multi-minute gate. The exact bot command remains below. Full-suite confirmation after this extraction, real-GPU/browser checks, and the previously listed worker quota-name/ownership requests remain with the lead. The browser checklist below is unchanged. No new plan-versus-code discrepancy or cloud-file request was introduced.

The desktop implementation is ready for integration review. The real-worker acceptance remains open: worker save replies lose the exception name, and worker-owned persistence needs the region ownership fence described below.

## Changes by file

- `src/save/db.ts`: once-per-profile persistent-storage request, persistence/reminder/export preferences, quota estimates and the 95% preflight threshold; region Web Locks and a BroadcastChannel fallback; per-write IndexedDB/MemoryKV permission checks; scoped permission for recovery maintenance. No database version or save schema change.
- `src/region/RegionScreen.ts`: dismissible backup reminder after founding, one-click export, Manage storage, disabled founding/deletion/rename while read-only. Export reads stored data without first attempting a save, so quota failure cannot block the backup.
- New `src/ui/StorageDialog.ts` and `src/ui/storage.css`: guided quota message with Export, Manage storage and Retry; other errors have a plain sentence with closed Details. Management lists approximate region/city/recovery payload sizes, exports backups, and obtains a temporary region lock before deleting an inactive region. The active region cannot be deleted. These files also contain session banners, takeover teardown/reload and recovery locking, keeping App wiring small.
- `src/game/CityScene.ts`: save failures use the guided dialog; save/autosave check region write permission. See the companion FEEL-02b report for the floor and silent feedback.
- `src/ui/Modals.ts`: Save follows write permission; a read-only tab retains an Exit to region action.
- `src/region/ui/dialogs.ts`: label change, plus small export/deletion hooks so exports clear the backup reminder and the Load Region dialog cannot delete a region another tab owns.
- **Allowed cloud-held `src/main.ts` integration hunks:** imports and optional `recordSaved()` contract; persistent-storage call through the Found-click callback; one session retained across region/city screens and released at the title; existing-region data refreshed after initial acquisition; guarded region, preview, founding, city and recovery writes; save-button state; successful-host-save floor notification; guided errors on hidden/manual/exit/founding saves. Exit failures retain the city for Retry. `reloadStorageRegion()` delegates teardown/drain/reload to the owned helper. Fixed-ID diagnostic entry points obtain the lock before deleting their old region. Recovery restore/discard/discovery run within scoped locks; quota/ownership failures preserve the pending recovery.
- **Minimal outside-named production hunk — `src/region/NewCityDialog.ts`:** optional `onFound` hook invoked in the actual click handler, with a repeated-click guard. Calling persist after awaiting this dialog would miss the player's activation.
- **Minimal outside-named production hunk — `src/save/recoveryLs.ts`:** import plus three early permission checks in `storeRecoveryLs`, `discardRecoverySnapshot`, and `clearRecoveryAfterSave`. These stop synchronous localStorage writes/cleanup bypassing the region lock, including the page-side recovery mirror.
- **Outside-named existing test — `tests/game/citySaves.test.ts`:** fixture additions and updated error-routing expectations for the changed save behavior.
- **Infra hunks:** none. No simulation, balance, save-format, Medium/Hard rules or simulation RNG changes.

## Lock ownership

The name is `metropolis.region.<regionId>`. A normal open uses `navigator.locks.request(..., { ifAvailable: true })`; takeover uses `{ steal: true }`. The lock callback remains pending until session disposal or loss. Stealing rejects the first holder's request promise with `AbortError`; its rejection handler immediately disables writes and sets the lost banner. This uses the [Web Locks request algorithm](https://w3c.github.io/web-locks/#request-a-lock), rather than a separate ownership message for native locks.

Takeover holds the lock while saving remains disabled, disposes the stale city without saving, drains its outstanding App save chain, reads the latest stored region and opens the region screen. It then enables saving. The player can reopen a city from the fresh region. This prevents an older tab's host/tile references from overwriting fresh data.

Without Web Locks, a BroadcastChannel probe/election and 3-second heartbeat use a 15-second localStorage lease. A write checks the lease synchronously, before a queued channel notification can arrive. A browser missing both coordination APIs stays read-only.

Recovery discovery itself adopts the global unload slot and deletes stale records. Its helper therefore acquires all regions named by existing recovery keys and the localStorage marker, scopes writes to those locks, and blocks records appearing outside that scope. It reuses an active writable session but cannot reacquire a stale read-only session through recovery.

## Validation

- **PASS:** `npx tsc --noEmit` after all source/test edits.
- **PASS:** `git diff --check`.
- **PASS:** native Node storage-helper probe using `--experimental-transform-types`: synchronous once-only persist request, 95% quota error, Web Lock takeover both ways, old-owner KV denial, and off-target recovery-write denial.
- **Vitest could not start:** the quiet-gated `tests/storageDb.test.ts` command failed while Vite loaded `vite.config.ts`, with `[plugin externalize-deps] Error: spawn EPERM`. No unit test executed. Other test files were not repeatedly submitted to the same failed startup. The full suite was not run, per the machine rule.
- **Bot could not start:** the exact command below failed with `npm ENOTCACHED` because `tsx` is unavailable in the restricted npm cache. No population numbers were observed. Log: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T036s4/scratch/bot128x15_s7.log`.
- **Not run:** browser, real-GPU timings, full Vitest, Worker hygiene runtime gate, or W1.3 recovery acceptance. No 256-tile runs are needed for this storage-only change.

New unit files: `tests/storageDb.test.ts`, `tests/game/storageDialog.test.ts`, `tests/save/foundingPersistence.test.ts`, `tests/save/recoveryStorageLock.test.ts`, and `tests/game/autosaveFloor.test.ts`. Existing regression: `tests/game/citySaves.test.ts`. Suggested additional regressions: `tests/worker/hygiene.test.ts`, `tests/game/titleSettings.test.ts`, `tests/game/newCityStart.test.ts`, `tests/save/host.test.ts`, `tests/save/recoveryLs.test.ts`, `tests/save/recoveryIdb.test.ts` and `tests/save/cities.test.ts`. Run single files through the quiet gate with `--maxWorkers=1`.

Bot gate left for the lead:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Required 2015 residents: `[61124, 93804, 37971]`, total **192,899**. These are the task's expected unchanged numbers, not a result from this lane. The older parent queue's 196,101 number is superseded by the current task.

## Plan versus current code / cloud requests

- NEW-03 history slots do not exist in this base. Manage storage shows existing city saves and recovery records with their sizes; adding and deleting history slots remains NEW-03's work.
- The Found click is in `NewCityDialog.ts`, rather than `main.ts`; the four-line hook was necessary to keep persist inside the gesture.
- Host saves do not publish a saved-time watch, so the small `recordSaved()` App notification resets the UI floor after hidden/App saves too.
- **Known host issue — T061 item 7, worker quota names:** in `src/worker/protocol.ts`, add an optional exception-name field to failed `saved`/`snapped` replies; in `src/worker/protocolInbox.ts` save/snapshot failure builders, preserve `err.name`; in `src/worker/LoopbackSimHost.ts` `PacketSimHost.reply()`, restore it before rejecting. Currently a worker `QuotaExceededError` becomes plain `Error`, preventing the guided quota classification after a store failure. NOTE-058 assigns this to T061; the loopback quota-dialog check is not a T036s4 failure. Page-side preflight estimates already work.
- **Cloud request — worker ownership fence:** propagate an optional region write permission/lease epoch through `PacketSimHost` and the worker persistence queues. In `PacketSimHost.bindRecovery()` gate reserve-triggered snapshots, and invalidate stale writes on ownership loss before worker save/snapshot/journal mutations. Audit `src/worker/recoveryMirror.ts` `checkReserve`, `writeNow`, `onSaved` and `src/worker/loopbackCore.ts` `bootJournal`/persistence handlers. Page-side KV and localStorage guards cover their own isolate; a separate worker's db module has no active page lock. Retain the read-only tab's in-memory journal, and rebuild it only after takeover loads current data. No worker file was edited here.
- W1.3's automatic 30-second floor/recovery work is absent from this base and remains a follow-up. The UI floor is 60 seconds, so the larger floor will apply once both are present.

## Browser acceptance checklist for the lead

- [ ] Use the real Worker in two real tabs on one region, including different cities. The second tab has disabled Save controls and no autosaves; its banner says the region is open elsewhere.
- [ ] Take over in each direction. The previous owner immediately says “This region is now open in another tab”; the receiver opens fresh stored region data, and can save after reopening a city.
- [ ] Exercise the BroadcastChannel fallback with Web Locks absent; verify takeover and old-owner write denial.
- [ ] Stub the city store to throw `QuotaExceededError`. Confirm Export, Manage storage and Retry, with no raw exception. The loopback failure is a **known host issue owned by T061 item 7** until its error-name fix lands.
- [ ] Set an estimate at or above 95% quota; confirm the same guided path before a save.
- [ ] Export while full/read-only. Confirm it makes no preliminary save and the downloaded region can be imported.
- [ ] Make `persist()` resolve false on the actual first Found click. Confirm the region reminder until export, no reminder for the next seven days, and Dismiss works.
- [ ] Inspect Manage storage at 1280×720; verify sizes, guarded deletion, inline confirmation, and keyboard handling when opened over the error dialog.
- [ ] Retry a failed exit, including the Worker, and confirm the live city is retained until saving succeeds.
- [ ] Check existing-region data after another tab saves and closes, then Continue from an older title/Load dialog.
- [ ] Verify recovery cannot adopt, discard or restore another tab's live region, and a quota failure does not discard a valid recovery snapshot.
