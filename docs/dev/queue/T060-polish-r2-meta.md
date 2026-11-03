# T060-polish-r2-meta: polish round 2, META lane, FEEL-01 then FH-12 (cloud lane)
base: dev
owns:
  - FEEL-01: src/ui/Notifications.ts (the NewsTicker only, :35-89) and src/ui/hud.css (its ticker rules).
  - FH-12: src/region/ui/TitleScreen.ts, src/region/ui/LoadingScreen.ts, and the quickstart-like path in src/main.ts.
  - The tests for both.
do:
  - Do each item's Change and Acceptance in docs/POLISH_PLAN.md in full, one sub-lane each, in this order:
    1. **FEEL-01:** the news ticker shows the newest headline first, as one readable clause.
    2. **FH-12:** "Start your first city" on the title screen.
  - Build on what dev has now:
    - FEEL-02a's toast budget (T036 step 3, 0e7c2b0) in Notifications.ts. Its budget tests must pass unchanged.
    - FH-11's New City dialog and FEEL-05's spring start (T036 step 2, b71b2c2).
    - W0.5's news sequence number.
  - Desktop lanes in flight touch the same files, so keep your hunks small and local. The merge resolves the
    conflicts.
    - T058 (FH-21 fixes): Notifications.ts gets its own container for questions; main.ts:484 moves t0 after the
      recovery gate.
    - T036 step 4 (NEW-04): src/main.ts and region/regionLock.ts.
    - T042: one line in main.ts's ?difficulty= funds map.
  - Not in this lane: FEEL-21 and FH-23. FEEL-21 waits for FEEL-01; FH-23 waits for the TopBar split.
gates:
  - each item's acceptance list, with numbers;
  - tsc and the full vitest;
  - the bot identical to dev (residents [ 61124, 93804, 37971 ] = 192,899); neither item touches the sim;
  - browser checks at 1280x720 (SwiftShader: check function and visuals, look at every screenshot):
    - FEEL-01: the newest headline is first; each is one clause; widths are cached; no layout thrash while it
      scrolls.
    - FH-12: one click from the title screen to a playable first city on a persistent region; a second start
      offers to continue it; the loading screen.
report: docs/dev/reports/cloud-T060-r2-meta.md; a .done line per item in docs/dev/queue/T060-polish-r2-meta.done
