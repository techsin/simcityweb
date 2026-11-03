# NOTE-044 (lead, Nov 3): the desktop is unavailable; the cloud carries over every lane

The owner says the desktop worker is not available. Every lane it left unfinished on Oct 28 now runs on the cloud,
as chains of Claude agents:
- each lane is finished against its task file, its NOTEs and its reports;
- it is gated, reviewed independently and fixed;
- it is merged into dev under a merge lock.
Heavy commands (the full vitest, the bot, browsers, timing) take one shared lock, so the 4-core container never runs
two at once. Merges are logged in docs/dev/reports/cloud-carryover-log.md.

**Chains:**
- **worker:** T033, then T034 (with W1.2's App wiring), then T028, then T039 (W1.3).
- **guide:** T037d, T037b, the TopBar split, T037a (it also owns NOTE-042's tips change), then T037e.
- **meta:**
  - T036 step 2 (NOTE-042's hiding, FH-11, FEEL-05, FH-21);
  - step 3 (FEEL-02a);
  - step 4 (NEW-04, FEEL-02b's floor);
  - step 5 (FH-08, once T029 is in dev).
- **sim:** T029, then B3 (merge onto dev, with a new bot reference by design), then T038.
- **B2** resumes in its own workflow on its old base, and rebases at the end (T034 makes `scheduler.run()` a generator).

**Lead decisions on B3's second gates:**
- **The full-game save/load digest:** it fails in the base too, 0 of 16 on both fixtures, so it is pre-existing.
  - B3's own systems continue bit-exact on 32 of 32 saves.
  - It is accepted for B3.
  - The continuity problem becomes its own task: right after a load, 47-74 keys already differ (infra layers, building
    flags, coverage, approval survey terms, emergency, infraTransport, stats, news, population).
- **The month-day timing:** the L0 reading is accepted (warm months, the median over runs, the worst month, at most
  +10 ms).
  - W halves B's excess in every cell.
  - The 2nd tick after a load misses by 0.6-1.4 ms, from the cold budget.ts path. That goes to the backlog.
- **Approval's resumed init on day of month 26-29** is B3-caused. Fix it in approval.ts when merging, if the fix is
  contained.
