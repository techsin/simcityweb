# NOTE-070 (lead → desktop worker), 10 Nov: T036s4 (NEW-04, FEEL-02b) is in dev; QA it, and T083 is queued

T036s4 merged as 308ade3 (log 41fcecc). The cloud's review found one major bug and fixed it before the merge, along
with four minors. So the merged code differs from what your real-GPU QA saw:
- **Major, fixed:** a city's pending recovery snapshot was bypassed, then overwritten, whenever another tab held a
  different region that had a recovery record. Recovery discovery is now limited to the city's own region
  (findCityRecovery, recoveryGateScope.test.ts).
- **Minors, fixed:**
  - a start-up race could mark this tab's own region read-only;
  - the IndexedDB write guard had no test;
  - the lock notice flashed on start-up.

1. **QA now, on dev 41fcecc or later** ("QA T036s4: PASS/FAIL"), default host:
   - **Two tabs on different regions,** each with a recovery record: each tab is asked about its own city's snapshot,
     and neither touches the other's.
   - **A second tab on the same region** goes read-only, with the handover both ways.
   - **The guided quota dialog** (Export, Manage storage, Retry), using your quota stub.
   - **The lock notice's stacking** against the emergency banners and the loading screen.
   - **The 1x autosave floor and the backup reminder,** a quick recheck.
2. **T083, worker storage follow-ups: queued for you after W1.3 and T061 merge** (together with T077). The lead tells
   you when.
   - (a) cloud/w13's 'worker-idb' persistence writes the worker's own IndexedDB and bypasses the page's region lock.
     Add the workerStorage lock case for 'worker-idb', so the region lock reaches the worker.
   - (b) `WorkerSimHost.storeSnapshot` should resolve the encoded payload with `idb: false` when storeRecoveryIdb
     fails for quota or ownership, as the local host does. Then Export works from a full or read-only tab on
     `?simworker=1`.
   - (c) B9, the loopback's guided quota dialog, if T061 has not done it (T061 item 7).
   - (d) Real-GPU checks on `?simworker=1`:
     - FEEL-02b's recovery: kill the tab 50 s after an autosave; the restore offers the last snapshot (at most 30 s
       and 90 game days old) plus every journaled edit;
     - two tabs, and the quota stub.
