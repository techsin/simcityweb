# local-LG-01-ranks: city ranks core (POLISH_PLAN LG-01, the part that can start now; T009)

Branch `local/LG-01-ranks`, base `b57c816`. Files: `src/sim/economy/rewards.ts`, `tests/sim/ranks.test.ts`, and the
gate tool `tools/bench/exact/rankLoad.ts`. Not in scope (they wait, per the plan): the HUD line, the Rewards tabs, the
region card and the `replicaSafe` entry.

## What changed (`rewards.ts`)
- **`CITY_RANKS`.** The table exactly as LG-01 lists it, 12 ranks: Settlement 0, Village 1k, Town 5k, Small City 10k,
  City 25k, Large City 50k, Metropolis 100k, Major Metropolis 250k, Global City 500k, World City 750k, Megacity 1M,
  Megalopolis 1.5M.
- **`listMilestones(st)`.**
  - Returns `{ currentRank, nextRank, nextUnlocks }`: up to three locked rewards by progress (the minimum over their
    conditions), ties in `REWARDS` order, kept with an allocation-light insertion.
  - It reads only `stats`, `unlocked` and `milestones` (typed as `Pick<CityState, …>`), so it can join the Worker's
    replica-safe list.
  - Two rewards are left out because their conditions need other state: Casino (an ordinance) and Seaport
    (coastline). Such conditions are flagged `fullState: true`. **For the lead:** list them in the HUD from full state
    later, or accept that they never appear in "next".
- **Rank flags.**
  - `rewardsSystem`'s check fills `systemData.cityRanks` (optional key) with every rank whose threshold the population
    has reached. Flags only go up: a rank once reached stays reached when the population drops.
  - On load this runs silently, like `check(sim, true)`. No news, no rewards.
  - No sim formula changes.

## Gates

| Gate | Result |
|---|---|
| `tests/sim/ranks.test.ts` | 48/48: every boundary (below, at, above), ordering and the three-unlock choice, old saves, round trip |
| Old saves (`rankLoad.ts`, pre-LG-01 fixtures without the key) | bot256 y60 (654k): 9 ranks filled, current Global City, next World City. dense1m (1.12M): 11 ranks, current Megacity, next Megalopolis. No news posted, key kept after save and load |
| Bot 128×15 seed 7 | identical to base **including the full action log** (`SIMBOT_LOG=1`); 194,432 in 2015 |
| `tsc` / full vitest | clean / 1,139 passed, 6 skipped; only the Windows-CRLF `binary.test` fails (T012 fixes it) |

**Who wrote what.**
- **Codex** (max effort): the code and the tests.
- **Me (Claude):** the brief, the review (the table against the plan, the insertion logic, silence on load) and the
  gates, including the old-save loader.
