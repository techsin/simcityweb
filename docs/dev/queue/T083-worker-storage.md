# T083-worker-storage: the worker storage follow-ups after W1.3 (NOTE-070 item 2, NOTE-078)
base: dev 8c08b6a or later (W1.3 and T061 are in dev); branch local/T083-worker-storage
owns: the worker's storage paths: src/worker/WorkerSimHost.ts (storeSnapshot), src/worker/simWorker.ts and the
  worker's persistence module from W1.3 (its 'worker-idb' mode), src/save/db.ts' lock session (the workerStorage lock
  case), LoopbackSimHost.ts only for (c); new tests. The lead assigned these worker-file hunks (NOTE-070, NOTE-078);
  keep each minimal.
do (read docs/dev/reports/cloud-W1.3.md first, above all its decision 21 and its Desktop QA list, and T036s4's report
  for the region lock, NEW-04):
  - (a) **The main item: the region lock reaches the worker's own IndexedDB writes in 'worker-idb' mode** (W1.3's
    decision 21). cloud/w13's 'worker-idb' persistence writes the worker's own IndexedDB and bypasses the page's
    region lock (one Web Lock per region, with the "Use it here instead" handover). Add the workerStorage lock case
    for 'worker-idb', so a read-only tab's worker cannot write, a takeover moves the write right to the new tab's
    worker, and the old tab's worker stops writing at once (an AbortError path like the page's). Tests for all three.
  - (b) `WorkerSimHost.storeSnapshot` resolves the encoded payload with `idb: false` when storeRecoveryIdb fails for
    quota or ownership, as the local host does, so Export works from a full or read-only tab on `?simworker=1`.
  - (c) B9, the loopback's guided quota dialog (the Worker-protocol save reply dropped the error name): check dev
    first; T061 item 7 says save errors now keep their name. If the guided dialog (Export, Manage storage, Retry)
    already shows on loopback and the worker, add only a test that pins it; otherwise fix it.
  - (d) is NOT in this round: the worker journal carrying `setOnboarding` waits for my T037a lane to reach dev (the
    command does not exist in dev yet). Leave a clearly marked place and say in the report what the follow-up commit
    will add.
notes:
  - T086 (running now, not in dev) edits src/ui/StorageDialog.ts, src/ui/storage.css, src/region/regionLock.ts,
    src/save/db.ts' lock session (B5: a read-only tab learns the region became free) and a minimal main.ts hunk for
    the takeover during a load. Keep your db.ts hunk small and in its own function, so the two merge cleanly, and do
    not edit StorageDialog.ts, regionLock.ts or main.ts.
  - T077 (running now) edits protocol.ts, recorder.ts, replica.ts and the hosts for a `live` flag: stay out of the
    packet's clock fields.
gates:
  - tsc; your tests plus the existing worker persistence, recovery, storage and lock tests and
    tests/worker/hygiene.test.ts through quietrun; the bot unchanged at 192,899.
  - I run the full vitest, the bot and the real-GPU checks on `?simworker=1` (FEEL-02b's recovery: kill the tab 50 s
    after an autosave, the restore offers the last snapshot, at most 30 s and 90 game days old, plus every journaled
    edit; two tabs; the quota stub); end with the browser checklist.
report: docs/dev/reports/local-T083-worker-storage.md.
