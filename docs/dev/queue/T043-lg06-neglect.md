# T043-lg06-neglect: polish round 2, SIM, LG-06 neglect that costs growth: a safety record, rebuild costs and scars
base: fb1531f (dev); branch local/T043-lg06-neglect
after: none. Its src/sim/infra hunks (emergency.ts, nimby.ts) are separate commits and hold for B2's merge.
owns: src/sim/economy/tourism.ts (the SIM hunk: the safety score); the migration term, wherever it lives in
  src/sim/economy (population.ts or demand.ts); tuning.ts (ATTRACT_SCALES, REBUILD_SHARE, the safety constants);
  budget.ts (the "Rebuilding after emergencies" line); src/sim/infra/emergency.ts and nimby.ts (minimal hunks: the
  12-month window counts and the timed scar splat); tools/simbot.ts only if --neglect needs a fix; new tests under
  tests/sim/.
  Not owned: META's parts wait. These are the Emergencies panel's cost row (EmergenciesPanel.ts) and the banner's
  "−§8,400 rebuild" (round 3). Expose the numbers they need as a replica-safe value or a stats field, and list the
  requests.
do:
  docs/POLISH_PLAN.md LG-06 (line 1365) in full.
  - Safety = clamp(1 − 1.6·crime − EM_REP·failed12/(incidents12 + 30) − 0.002·deaths12 per 1,000 residents, 0, 1),
    over the approval term's 12-month window. It feeds migration (±12 %) and tourism's safety score (today crime only,
    tourism.ts:601).
  - Rebuild costs: 15 % of each month's emergency damage, charged on a "Rebuilding after emergencies" budget line.
  - Scars: a building that burns down after an unanswered call leaves a stigma of 0.15 within 3 tiles for 18 months,
    as a timed NIMBY splat shown in the Prestige view. The view itself is render: list the hook it needs.
  - The scar list is a new optional systemData key. No new RNG draws.
gates:
  - tsc; the full vitest; the bot: say how the base moves (the plan allows ±0.5 % on base rows).
  - 256x60 s7 and s11 with --neglect: population at year 60 at least 2 % below base; funds at year 60 no higher than
    base; the approval cost unchanged or larger.
  - Base runs: population within ±0.5 % of dev's rows; tourism 0.7-1.3 from year 15; failed ≤ 5 % from year 10.
  - Save/load in the middle of a scar restores it exactly; old saves load.
report: docs/dev/reports/local-T043-lg06-neglect.md. Push local/T043-lg06-neglect with
  docs/dev/queue/T043-lg06-neglect.done, marked "holds for B2".
