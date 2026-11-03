# T054-lg21-year-review: polish round 2, CONTENT, LG-21 year in review and a mayor's grade
base: fb1531f (dev); branch local/T054-lg21-year-review
after: none.
  - NewYear.ts (META's) is not edited: the card waits for NewYearCelebration.busy to clear by reading it.
  - The yearReview setting key exists (T036's schema). Its Settings toggle UI is META's (SettingsPanel): if the toggle
    is not shown yet, list the request.
owns: new src/ui/YearReview.ts, with its CSS in a new file; a pure scoring module (e.g. src/ui/yearGrade.ts);
  src/game/CityScene.ts (the CONTENT wiring block after the NewYear construction); new tests.
do:
  docs/POLISH_PLAN.md LG-21 (line 1582) in full:
  - the timing: after the New Year show, or on 1 January when it is off; every year at 1×, every second year at 2×,
    every 5th at ultra;
  - the card's contents;
  - the grade table and its cutoffs;
  - closing after 15 s or on any map input; never during LIVE; the toggle.
  The card is computed UI-side from the mirrored history arrays (HISTORY_KEYS) and replica-safe reads (check what W0.3
  exposes for approvalBreakdown through the host). No sim system reads (hygiene). It is deterministic for a given save
  and never shows on load.
gates:
  - tsc; the full vitest; the hygiene test; the bot identical.
  - Unit tests:
    - each stat's score hits its anchors (approval 55 → 50 points);
    - 84.9 maps to B and 85 to A;
    - the F fixture: funds below 0, approval 30, 20 % of emergencies failed.
  - The 256x60 s7 base run grades C or better every year from 2010 (a node probe over the bot's yearly rows).
  - Browser, real GPU (the worker), on a 20-year save:
    - the card shows once per New Year at 1×, every second New Year at 2×, never on load;
    - its population change is within 0.5 % of the Graphs panel;
    - it names the same approval term as the tooltip;
    - it is skipped during LIVE;
    - the toggle hides it.
report: docs/dev/reports/local-T054-lg21-year-review.md. Push local/T054-lg21-year-review with
  docs/dev/queue/T054-lg21-year-review.done.
