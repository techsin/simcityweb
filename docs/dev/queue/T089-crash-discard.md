# T089-crash-discard: W1.3's follow-ups in the crash and journal paths, needed before W1.4 (NOTE-080 section 3)
base: local/T086-storage-takeover (its head: T086 edits main.ts and is not in dev yet; this lane sits on top of it);
  branch local/T089-crash-discard
owns: src/main.ts (onWorkerCrash only, minimal); the crash dialog's wording (openSimCrashDialog in
  src/region/ui/dialogs.ts); the recovery journal's read path (readRecoveryJournal, where W1.3 put it); new tests.
  The lead assigned these hunks (NOTE-080); keep each minimal.
do (read docs/dev/reports/cloud-W1.3.md first: its decisions 3 and 20, and how the worker snapshot, the journal and
  the boot replay fit together):
  - **(a) Decision 3, the owner's choice: discard, and say so.** In onWorkerCrash, for 'restart' and 'local', call
    `discardRecoverySnapshot(city)` before playCity, so the crashed session's worker snapshot can never come back.
    Reword openSimCrashDialog so it says that unsaved progress since the last save is lost unless you choose Recover.
    Test: crash after a worker snapshot, choose Restart, make an edit, crash again, choose Recover: expect the save
    plus the new edit, never the old snapshot.
  - **(b) Decision 20 (data loss):**
    - readRecoveryJournal deletes a journal only when no stored snapshot could still take it: skip the delete while
      recovery/<key> holds the snapshot its base names.
    - In onWorkerCrash, when restoreRecovery returns anything but 'recovered', boot with replay=false (or return to
      the region) instead of replaying.
    - recovery.test cases: a restore that fails on quota, and a boot with a pending snapshot; the journal survives in
      both.
notes:
  - T083 (running now, not in dev) edits the worker's storage paths (simWorker.ts drain(), WorkerSimHost.storeSnapshot,
    the region lock for 'worker-idb', a read-only tab's boot making no record write and no recovery delete, including
    the worker realm's boot-time journal delete). Your readRecoveryJournal hunk is the delete CONDITION for a writer
    tab; keep it in its own lines so the two merge.
  - T086 (your base) changed continueInCity's gate and added RegionStorage.takeOver holding App.busy: read its report
    docs/dev/reports/local-T086-storage-takeover.md first.
  - The crash dialog stays above the storage dialog (z 200 over z 130; the lead ratified it).
gates:
  - tsc; your tests plus W1.3's recovery, journal and crash tests, T086's storage tests, tests/worker/hygiene.test.ts,
    through quietrun; the bot identical (192,899).
  - I run the full vitest, the bot and the real-GPU checks on `?simworker=1` (W1.3's Desktop QA D4 plus a new D4b: the
    Restart-then-Recover sequence above; a kill during a quota failure); end with the browser checklist.
report: docs/dev/reports/local-T089-crash-discard.md.
