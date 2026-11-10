# T093-reward-load: a mid-month load must not lose a reward's announcement (NOTE-081; the T054b finding)
base: dev (current head); branch local/T093-reward-load
owns: src/sim/economy/rewards.ts (init and its check); the rewards' saved record if it needs a field (optional, old
  saves load); new tests.
why: `rewardsSystem.init` runs `check(sim, true)`, so a load silently unlocks a reward whose conditions were first met
  since the last month tick; the uninterrupted game unlocks it at the tick, with its news. Reproduced on dev (48x48
  bot town, economy systems): loads on days 383 and 388 come up with the Mayor's House already unlocked, and no reward
  news posts through the tick on day 390, where the uninterrupted game posts "The citizens have built you a Mayor's
  House! Place it from Rewards."; the same for the Cemetery on days 398-418. The loaded game's `unlocked` and
  `announced` sets differ right after the load, so T057's "the economy systems continue bit for bit" does not hold in
  that window. The probe that showed it: scratchpad lanes\T054b\scratch\rewards-load.mts and
  rewards-load-baseline.log.
do:
  - Make a load restore the unlocked and announced sets exactly as saved, so the announcement still comes at the next
    month tick, as in an uninterrupted game. Find out why init checks at all (old saves from before a reward existed?
    sandbox? a changed threshold?) and keep that purpose without the silent unlock: say what you found.
  - Check `cityRanks` (set in the same check) and any other reward state touched at init the same way.
  - Tests: load on day 383 and on day 388, and the Mayor's House news still arrives at the tick on day 390, with the
    loaded game's rewards record equal to the uninterrupted game's at every day; the Cemetery window; an old save
    without the newer fields; a sandbox city. Add the rewards system to a save/load continuity test (see
    tests/save/loadContinuity.test.ts and how T057 compares per key).
  - The bot and the digests of a continuous run must not change: residents [61124, 93804, 37971] = 192,899 on 128x15
    s7 with the action log identical, and the repo's exact/determinism tests green.
notes:
  - T070 (honours and the Statue rule) and T071 (late-game landmarks), my lanes not in dev yet, both add to
    rewards.ts: keep your hunk inside init and its check call, and say in the report which lines they must mirror
    (T070 added saved progress for honours and the Statue's streaks; the same load rule must hold for them).
gates:
  - tsc; your tests, the rewards and save tests, tests/sim/exact/* through quietrun; the bot identical.
  - I run the full vitest and the bot.
report: docs/dev/reports/local-T093-reward-load.md.
