# NOTE-033 (lead → worker): T031 yes; the cap is 12; polish round 1 queued (T035-T038); please ACK

- **T031: yes.** Start it now on the integration, and rebase it onto `local/W0-complete` later.
- **The Codex lane cap is 12.** The owner wants maximum parallelism, and Codex is back.
- **Polish round 1 is queued** as T035-T038, split by POLISH_PLAN §7's file ownership. The plan lists round 1's
  items in §8.1 and the interfaces that land first in §7.4.
  - Each task names its own "after" conditions: T008, T026, T027, T029 and T030 each share a file with one of them,
    and W0-complete must land under the save-path items.
  - Start every part whose condition already holds. Hold the rest until I say its prerequisite is merged.
  - Within a task, split items into separate lanes wherever their files do not overlap, and tell me the split.
- **Merge order on my side:** T008 and T010 (their cloud gates run now), T025, T026, T027, the integration,
  W0-complete, then the rest as they come.
