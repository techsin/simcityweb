# T091-sister-cities: polish round 3, META, LG-12 sister cities: found or fund a neighbour when the map is full
base: dev (current head: FH-12, LG-05 and W1.3 are in); branch local/T091-sister-cities
owns: src/region/NewCityDialog.ts, src/region/RegionScreen.ts, src/region/regionEffects.ts, src/region/types.ts;
  src/sim/economy/budget.ts (only the funding line the item names); a MINIMAL hunk in src/main.ts if the item needs
  the App (the cloud's W1.4 work and my T086/T089 lanes also touch main.ts); new tests.
do:
  docs/POLISH_PLAN.md LG-12 · Sister cities: found or fund a neighbour when the map is full. Read the whole item, its
  dependencies (PB-REGION, PB-DIALOG, LG-05's built-out advice now in dev, WORKER_DESIGN.md §4.4 region switching
  through the host) and the decisions it cites, then implement every Change line and meet every Acceptance line.
notes:
  - LG-14 (scenarios) runs at the same time in lane T092 and also edits NewCityDialog.ts: keep your dialog hunk in its
    own section or function.
  - LG-13 (region goals and dashboard) follows this lane in the same files; LG-24 (moving between region cities from
    inside a city) is a later lane: do not start either, but do not block them (no renames of shared region types
    beyond what LG-12 needs).
  - Region data is saved: new fields are optional, old regions load, and T057's save/load continuity and the region
    lock (NEW-04, T036s4) keep holding. Money that moves between cities must be journaled or saved so a crash cannot
    duplicate or lose it: say how.
  - The budget.ts hunk must leave a city with no sister city bit-identical (the bot stays at 192,899).
gates:
  - tsc; your tests and the existing region, dialog, budget and save tests through quietrun; the bot identical.
  - I run the full vitest, the bot and the real-GPU checks; end with the browser checklist.
report: docs/dev/reports/local-T091-sister-cities.md.
