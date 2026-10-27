# T017-sim-check-c4: sim close-out check 4 on this machine (fresh playtest + adversarial audit of fix round 4)
base: d8256fc (the dev branch with fix round 4 merged and the lead's one-test fix; record it in both reports)
after: none. Highest priority on this machine: the close-out gates W0 and the polish rounds. Pause timing runs while
  these browser runs go; the Codex lanes keep writing code at below-normal priority.
owns: nothing in the tree. Both reviewers are read-only: they write only to their scratch folders and their reports.
do:
  Run the two roles below as two NEW sub-agents (fresh contexts; not the T013 or T016 agents), in parallel, each given
  its brief verbatim plus these notes:
  - Work in a git worktree of the base. Use the shared test cities from T013 (or rebuild them:
    `npm run fixtures -- --only cities --cities <dir>`); CITIES below means that <dir>.
  - Chromium with hardware acceleration, headless; report GPU, driver and browser version.
  - Read first:
    - docs/dev/reports/local-T016-sim-fix-c4.md (fix round 4: every item to re-check);
    - both check 3 reports (local-T013-playtest-c3.md, local-T013-audit-c3.md);
    - docs/dev/reports/simB-close_fix-c2.md;
    - tools/leakprobe/README.md (the new leak gate).
  - **Probe pitfall from check 3:** a Playwright locator read on a city element (locator.getAttribute) can itself pin
    the exited city. Drive with coordinate input and raw CDP, with an objectGroup on every call that returns objects,
    and run tools/leakprobe in all four modes (fresh / persistent browser x plain / hostile) as one of your probes.
  - Graphics revision 2 is still finishing in src/render (the forest ring in TreeRenderer.ts). Render visuals are out of
    scope: note anything you see there, but do not count it as a finding.

  ===== brief 1: PLAYTESTER =====
  ROLE: independent real-input PLAYTESTER (close-out round c4). You did not make these changes. Play the base commit in
  vite + headless chromium with REAL mouse and keyboard input (page.mouse / page.keyboard; page.evaluate only to read
  state or for a declared test setup). Re-check every item of fix round 4 and fix round 2 as a player would, and hunt
  for BLOCKER/MAJOR regressions anywhere you go. In particular, fix round 4 bound about 150 listener sites to the city's
  abort signal, so check that every panel, tool, slider, toggle and banner still works after entering a city, after
  exit and re-entry, and in a second city:
  (1) Exit-to-region leak: big city (CITIES/vet_s7_y21.region.metropolis via Load Region -> import -> Play) and a fresh
      small city: query growable, service and utility buildings with WHY? open, every panel and data view once, each
      tool family once, then Save & exit; 3 cycles. Measure with CDP (collectGarbage, then queryObjects for CityScene /
      CityState / WebGLRenderer / HTMLCanvasElement, or a heap snapshot): 0 cities after each exit, heap flat across
      cycles. Also a dispatch right before exit: 0 at +2 s.
  (2) Emergency banners vs flyouts and panels at 1024x600, 1280x720, 1366x650 and 1920x1080, with a real quake burst
      and at least 9 dispatchable banners: every flyout and tab; Budget, Rewards and Statistics opened and closed; at
      1024x600 the stack must not cover the Budget panel's body (fix round 4, minor 5); press-holds of 0.3-4 s while a
      flyout closes; rapid triage must not lose clicks; a banner that just moved under the pointer must not dispatch
      a different one; dismiss everything, then open a centred panel: the pill must not cover its title.
  (3) Paused quake: no camera shake while paused; plop previews and clicks agree.
  (4) Toolbar and inspector thumbnails: no renderers pile up within a session, and none survive the 15 s idle dispose
      (CDP queryObjects).
  (5) The fallback 3D view (if reachable: low-end / no-WebGL2 path) disposes its renderer and GL context.
  (6) Regression loop: main menu -> new region -> found a city -> roads, zones, power, water -> past 1,000 residents;
      save -> reload -> Continue; crash recovery (kill the browser tree, restart, Recover); New Year.
  ALWAYS look at the screenshots you take and cite their paths.
  FINAL ANSWER: a summary, then findings, each with title, severity (blocker|major|minor), area, evidence (screenshot and
  log paths you looked at), suggestedFix, files.

  ===== brief 2: AUDITOR =====
  ROLE: independent ADVERSARIAL AUDITOR (close-out round c4). You did not make these changes. Review fix round 4 line by
  line, `git diff 5a16942 <base> -- src/ui src/game src/sim src/save src/main.ts src/render tools/leakprobe tests` (in
  src/render only its teardown hunks: BuildingRenderer and lodBuilder; the graphics lanes' other changes there are
  reviewed by others; the merge also brings already-reviewed tooling and the newcomer bot, which you may skip). Try to
  break it:
  - a listener bound to the city signal that must outlive the city (region screen, menus) and now stops working;
  - one that is not bound and still closes over the city;
  - double aborts, late timers, races between exit and pending work;
  - perf of the new code, forced layouts per UI tick (EM-3);
  - save/load and determinism.
  Gates:
  - npx tsc --noEmit; the full npx vitest run (it must also have no unhandled errors);
  - the 128x15 seed-7 bot bit-identical at 194,432 (npx tsx tools/simbot.ts --size 128 --years 15 --seed 7);
  - old saves load and continue (the CITIES cities, and one save written by commit 9948964 with its own save code);
  - the recovery codec suite;
  - tools/leakprobe in all four modes;
  - your own leak probes (node WeakRef + gc; browser CDP) after inspector clicks, every panel, every tool family and
    exit/re-enter x3 in a small and a big city;
  - a sweep for module-level references that can pin a city.
  Confirm or refute each item of fix round 4 with evidence.
  FINAL ANSWER: a summary (gates, each item confirmed or not), then findings, each with title, severity
  (blocker|major|minor), area, evidence, suggestedFix, files.
  ===== end of briefs =====

gates: both reviewers finished; their reports written. You do not fix anything.
report: docs/dev/reports/local-T017-playtest-c4.md and docs/dev/reports/local-T017-audit-c4.md: each reviewer's final
  answer verbatim, then a JSON block {"summary": ..., "findings": [...]}; a few key screenshots under
  docs/dev/reports/local-T017/. Push local/T017-sim-check-c4 with docs/dev/queue/T017-sim-check-c4.done; DONE (say how
  many blocker/major findings each reviewer has).
