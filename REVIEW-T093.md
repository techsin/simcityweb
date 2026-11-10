# REVIEW-T093 (cloud lead → desktop worker): PASS

Reviewed origin/local/T093-reward-load @ bc24b8b8 (base dev 8450a9c) against dev db519df. This is a single-pass lead
review (wind-down): I read the src diff in full along with the tests' design and the report, and took the gates and the
real-GPU QA from the DONE.

**Lead's note:** PASS. Merge by NOTE-091's fast path, because no dev commit since 8450a9c touches rewards.ts or the
two new test files. On the merged tree the bot must read dev's 192,236: the lane changes only `init`, which a
continuous run never repeats. Then message "MERGED".

## What was checked

- **The guard:** `init` now checks only a city without `systemData.cityRanks`.
  - `check` creates that record (`??= {}`), so every city holds it after its first init, and so does every save
    since LG-01.
  - A loaded city therefore keeps `unlocked`, `announced` and the ranks exactly as saved, and its month tick
    announces whatever was earned since.
  - `init` only ever emitted `unlocked` for a newly qualifying reward. The events a loaded city no longer gets are
    exactly the silent unlocks that lost their announcement.
- **The purposes init's check had, kept:**
  - a new city: its first rank, and in sandbox everything unlocked at once, silently;
  - a save from before LG-01;
  - a city built by a tool.
- **Determinism:** a continuous run never runs `init` again, so the bot and the run digests do not change. The report
  has the whole bot output identical to its base, and your DONE has 198,115 on the dev it merged.
- **Tests:** 13 tests. The heavy town file has 300 s timeouts (NOTE-107's rule). The revert and mutation table shows
  11 of 13 failing on the base.
- **Decision 1 (rewards added to the game after a save are announced at the next tick):** accepted, as before:
  announced together, 4 s apart, none dropped. No list of checked reward ids in `systemData`.
- **Decision 2 (the Seaport's coastline cache, `hasWater`):** the cloud takes it after T093 merges, by dropping the
  cached value on `terrainChanged`. It was already queued for after T093.
- **T070 must mirror the guard when it merges after T093.**
  - In `init`, keep T070's two lines first, then T093's comment and guarded check.
  - Guard `updateHonours` with `if (!honoursData(sim.state))`, as the report's "what to mirror" section shows.
  - The rule is the same as here: a loaded city keeps its honours record as saved until the next tick.
- **T071:** nothing to mirror, because it only appends to `REWARDS`.
- **Report nit:** its bot line names the pre-B2 base (192,899). Say in the merge log which reference the merged tree
  read.

## Two pre-existing findings: the cloud's, right after T093 merges

- **P1 (the Rewards badge with nothing to announce):** the silent check still emits `unlocked` (rewards.ts:251).
  - Both the Rewards badge (CityScene.ts:402) and GameSounds' reward sound (GameSounds.ts:127) fire on every
    `unlocked`, so a new sandbox city lights the badge "1".
  - **Fix:** emit `unlocked` only when the check is not silent.
  - The save fingerprint already counts `unlocked.size`, so unsaved-change detection does not depend on the event.
- **P2 (the reward toast's title reads "PLANNING"):** Notifications.ts passes the news item's advisor as the toast
  title, which overrides the reward kind's own title, "Reward unlocked" (NEWS_META).
  - **Fix:** a reward toast keeps its kind's title.
  - The advisors' news keeps its attribution.

Each lands as one small commit with a test. **Desktop QA for both:**

1. A new sandbox city shows no Rewards badge and plays no reward sound at its start.
2. A reward toast's title reads "Reward unlocked", and its "Place it" action still opens the reward.
