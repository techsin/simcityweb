# T045-lg08-tod: polish round 2, SIM, LG-08 transit-oriented development: towers grow around stations
base: fb1531f (dev); branch local/T045-lg08-tod
after: none. The station list per graph version may need a hunk in src/sim/infra/transit.ts or
  transportFacilities.ts. That hunk is a separate commit and holds for B2. Prefer reading the stations from existing
  state outside infra where that is exact.
owns: src/sim/economy/growth.ts (tower lots, growth.ts:122-142); desirability.ts (+0.04 near a station, the "Near a
  station" Why? term); tuning.ts (APPROVAL.commute from 30 to 15 minutes, the TOD constants);
  src/sim/infra/transit.ts or transportFacilities.ts (minimal); new tests.
  Not owned: GUIDE's parts wait. These are the inspector's downtown note (inspectorModel) and the Transit stats line
  (StatsPanel). Expose the values and list the requests.
do:
  docs/POLISH_PLAN.md LG-08 (line 1430) in full, and veteran #4 (line 84).
  - Lots within 6 tiles of a connected train or subway station, or within 8 of Grand Central, count as tower lots. Use
    LG-02's def if it exists; otherwise leave the rule's hook. The rule is a pure function of the stations, cached per
    graph version.
  - Those lots get +0.04 desirability for R$$, CO$$ and CO$$$, as a "Near a station" term.
  - The commute approval term starts at 15 minutes.
gates:
  - tsc; the full vitest.
  - 256x60 s7 with --subway:
    - --skip transit costs ≥ 4 % of the people at 2040 and ≥ 10 % at 2060;
    - the base population at year 60 is ≥ 0.99× dev's;
    - ms/day rises by at most 3;
    - the average stage within 6 tiles of a station is ≥ 1.5× the city average;
    - in the --skip transit run, the commute term is non-zero from 2030.
  - The 128x15 bot: say how it moves (the commute term can move it).
report: docs/dev/reports/local-T045-lg08-tod.md. Push local/T045-lg08-tod with docs/dev/queue/T045-lg08-tod.done, marked
  "holds for B2" if it has an infra hunk.
