# T036s4 · NEW-04 storage you can trust

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
- **Cloud request — worker quota names:** in `src/worker/protocol.ts`, add an optional exception-name field to failed `saved`/`snapped` replies; in `src/worker/protocolInbox.ts` save/snapshot failure builders, preserve `err.name`; in `src/worker/LoopbackSimHost.ts` `PacketSimHost.reply()`, restore it before rejecting. Currently a worker `QuotaExceededError` becomes plain `Error`, preventing the guided quota classification after a store failure. Page-side preflight estimates already work.
- **Cloud request — worker ownership fence:** propagate an optional region write permission/lease epoch through `PacketSimHost` and the worker persistence queues. In `PacketSimHost.bindRecovery()` gate reserve-triggered snapshots, and invalidate stale writes on ownership loss before worker save/snapshot/journal mutations. Audit `src/worker/recoveryMirror.ts` `checkReserve`, `writeNow`, `onSaved` and `src/worker/loopbackCore.ts` `bootJournal`/persistence handlers. Page-side KV and localStorage guards cover their own isolate; a separate worker's db module has no active page lock. Retain the read-only tab's in-memory journal, and rebuild it only after takeover loads current data. No worker file was edited here.
- W1.3's automatic 30-second floor/recovery work is absent from this base and remains a follow-up. The UI floor is 60 seconds, so the larger floor will apply once both are present.

## Browser acceptance checklist for the lead

- [ ] Use the real Worker in two real tabs on one region, including different cities. The second tab has disabled Save controls and no autosaves; its banner says the region is open elsewhere.
- [ ] Take over in each direction. The previous owner immediately says “This region is now open in another tab”; the receiver opens fresh stored region data, and can save after reopening a city.
- [ ] Exercise the BroadcastChannel fallback with Web Locks absent; verify takeover and old-owner write denial.
- [ ] Stub the city store to throw `QuotaExceededError`. Confirm Export, Manage storage and Retry, with no raw exception; verify the worker error-name cloud change first.
- [ ] Set an estimate at or above 95% quota; confirm the same guided path before a save.
- [ ] Export while full/read-only. Confirm it makes no preliminary save and the downloaded region can be imported.
- [ ] Make `persist()` resolve false on the actual first Found click. Confirm the region reminder until export, no reminder for the next seven days, and Dismiss works.
- [ ] Inspect Manage storage at 1280×720; verify sizes, guarded deletion, inline confirmation, and keyboard handling when opened over the error dialog.
- [ ] Retry a failed exit, including the Worker, and confirm the live city is retained until saving succeeds.
- [ ] Check existing-region data after another tab saves and closes, then Continue from an older title/Load dialog.
- [ ] Verify recovery cannot adopt, discard or restore another tab's live region, and a quota failure does not discard a valid recovery snapshot.
