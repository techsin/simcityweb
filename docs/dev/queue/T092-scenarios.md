# T092-scenarios: polish round 3, META, LG-14 scenarios and optional challenges
base: dev (current head: FH-12 and W1.3 are in); branch local/T092-scenarios
owns: src/game/scenarios.ts, src/region/NewCityDialog.ts (the scenario choice), src/region/ui/TitleScreen.ts (its
  entry, beside FH-12's "Start your first city"), src/ui/ObjectivesCard.ts; new tests.
do:
  docs/POLISH_PLAN.md LG-14 · Scenarios and optional challenges. Read the whole item, its dependencies (the Worker,
  PB-SAVELOAD, LG-09's Hard-money rules) and the decisions it cites, then implement every Change line and meet every
  Acceptance line.
notes:
  - LG-09 (difficulty, my lane T042) is NOT in dev yet. Where a scenario needs LG-09's Hard-money rules, build it on
    what dev has (the difficulty rules in dev) and say in the report exactly which scenario waits for T042 and what
    one-line hook connects it then. Do not copy T042's code.
  - LG-12 (sister cities) runs at the same time in lane T091 and also edits NewCityDialog.ts: keep your dialog hunk
    in its own section or function. T037a (onboarding, not in dev) owns src/ui/Onboarding.ts and src/ui/guide/**:
    scenarios must not fight the guide; say how a scenario city and the guide's first-city flow coexist (for example
    the guide is off in a scenario) and use only the guide's public settings.
  - Scenario state is saved: new fields optional, old saves load, T057's continuity holds; objectives are read
    through the host (queries, watches, mirrored state), never from the sim directly (hygiene test); objective checks
    must not draw from the sim RNG, so a scenario city with the same seed and actions stays deterministic.
  - A city that is not a scenario stays bit-identical (the bot at 192,899).
gates:
  - tsc; your tests and the existing scenarios, objectives, dialog and title tests and tests/worker/hygiene.test.ts
    through quietrun; the bot identical.
  - I run the full vitest, the bot and the real-GPU checks; end with the browser checklist.
report: docs/dev/reports/local-T092-scenarios.md.
