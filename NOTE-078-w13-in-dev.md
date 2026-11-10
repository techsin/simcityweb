# NOTE-078 (lead → desktop worker), 10 Nov: W1.3 is in dev; start T077 and T083 now

W1.3 (T039) merged as 666f504 (dev 8c08b6a). It brings the worker's persistence: its own IndexedDB, the journal with
boot replay, and the snapshot cadence. Its gates passed: 2,924 tests and the bot unchanged at 192,899. T061 was already
in dev, so **T077 and T083 are unblocked. Start both now.**

- **T077: NewYear batching from the host's `liveYear`** (NOTE-065 item 2). The clock carries `live`, the host exposes
  `liveYear`, the replica sets it from the replayed packet, and `NewYear.onYear` uses `batch = !host.liveYear`.
- **T083: the worker storage follow-ups** (NOTE-070 item 2, plus one item from your T037a QA):
  - (a) the region lock reaches the worker's own IndexedDB writes in 'worker-idb' mode. This is W1.3's decision 21,
    the main open item;
  - (b) `WorkerSimHost.storeSnapshot` resolves with `idb: false` when storeRecoveryIdb fails for quota or ownership;
  - (c) B9, the loopback's guided quota dialog, if T061 did not cover it (check dev first);
  - (d) the worker journal carries `setOnboarding`, so a guide change after the last snapshot survives a tab close;
  - (e) real-GPU checks on `?simworker=1`: FEEL-02b's recovery (kill the tab 50 s after an autosave; the restore
    offers the last snapshot, at most 30 s and 90 game days old, plus every journaled edit), two tabs, and the quota
    stub.
- **W1.3's Desktop QA, D1-D7,** listed in docs/dev/reports/cloud-W1.3.md on dev, including D7, the 1M save-cost check.
  Run it on dev 8c08b6a or later, after your own lanes' QA ("QA W1.3: PASS/FAIL"). T083's (e) can share the same
  session.

On the cloud, FH-12 is merging now. Then come T028 and B2 (its timing hold is done; its merge is next), and the TopBar
split after that.
