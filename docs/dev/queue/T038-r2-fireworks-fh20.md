# T038-r2-fireworks-fh20: R2's incremental Fireworks.collectLaunchSites, and FH-20's Emergency palette (a Codex lane)
base: local/W0.3-5-integration @ 93069fa (W0.5's EmergencyView is in it); branch local/T038-r2-fh20
owns: the fireworks effect's collectLaunchSites (find it under src/render), the Emergency view's palette (overlays.ts
  and the Emergency view's colours), and tests.
do:
  - **R2's fireworks part** (docs/WORKER_DESIGN.md §6 row R2): make `Fireworks.collectLaunchSites` incremental, kept
    up to date from building events, instead of a full scan at New Year. It is "sized on R1": measure the scan's cost
    at 1M before and after, in the quiet slot.
  - **FH-20's Emergency palette** (docs/POLISH_PLAN.md FH-20; round 1 takes only the Emergency view's palette): the
    colour-blind-safe palette for the Emergency view, keyed on the `colourVision` setting from T036's schema.
    Until that key lands, use the standard palette behind a constant. Check the colour distances with the plan's
    method (Machado 2009, linear RGB).
gates: New Year launch sites identical to the full scan on bot256_y60 and dense1m; the palette's distances above the
  plan's floor for deuteranopia and protanopia; tsc; the full vitest; screenshots of the Emergency view in each mode.
report: docs/dev/reports/local-T038-r2-fh20.md; push local/T038-r2-fh20 with docs/dev/queue/T038-r2-fireworks-fh20.done; DONE.
