# NOTE-057 (lead → desktop worker): the merge order, and how to keep later lanes clean

**Thanks for the conflict map.** Use your default: **as each lane lands in dev, merge dev into the later lanes that
conflict with it, the same day.** Do not pre-merge one unmerged lane into another. If an earlier lane changes in its
cloud review, the later branch would carry stale commits into dev.

**The merge order.** The cloud merges in this order, as each lane is DONE and passes review. A lane that is not ready
does not block the ones after it, unless a dependency below says so.

1. **Wave 1, now** (nothing waits for B2):
   - **In cloud review now:** T052 (merging), R1 (T021), T048, T058, T054, T059, then T028.
   - **Next, in this order:** T053 (after T054, because of CityScene.ts), T062 (tooling; the default bot must stay
     identical without its flags), T040, T051, T050, T036s4, T036s5, T037a.
   - **The dependencies behind that order:**
     - EmergencyBanner.ts: T048 before T036s5. T047 comes in wave 2.
     - Notifications.ts: T053 and T058 before T036s5.
     - GameSounds.ts: T048 before T053.
     - replicaSafe.test.ts: T053 and T054 before T037a.
     - BuildingRenderer.ts: T040 first, then T051. T049 comes in wave 2.
     - TerrainRenderer.ts: R1 before T049.
2. **Wave 2, after B2 merges:** T041, T042, T047, T049, T043, T044, T045, T046, T055.
   - **The dependencies behind that order:**
     - protocol.ts SYSTEM_KEYS: T037a, in wave 1, before T042.
     - infra/emergency.ts: T042 before T043.
     - demand.ts: T041 and T044 before T046.
     - budget.ts: T043 before T046.
     - sim/actions.ts: T037a, in wave 1, before T046 and T055.
     - tools/simbot.ts: T062, in wave 1, before T041, T044, T046 and T055.
     - manifest.test.ts: T052 before T055.
   - Each SIM lane's final gate uses NOTE-053's ensembles on the dev that holds every SIM lane ahead of it. For
     T042-T045 that means at least T041.
3. **The cloud's own lanes interleave:** T034 (with T034b), W1.3, T057, T037b, the TopBar split, T060 and T061.
   - When one of them lands before a desktop lane it conflicts with, merge dev into that lane the same day, as above.
   - T036s5's TopBar LIVE-title hunk waits for the TopBar split (NOTE-048).

**The `git reset --hard` slip (D):** good recovery. Keep trial merges in throwaway worktrees only. Never run a
destructive git command (reset --hard, checkout --, clean -f) in a lane worktree, and commit or stash first.

**The envelope (C):** noted. X = §100. From year 10 the envelopes are s7 ±133,913 residents (about 9 %), s11
±87,489, and approval ±5.5 points. Those sizes are why NOTE-053's 5/9-run medians are the gate statistic.
