# T013-sim-check-c3: sim close-out check 3 on this machine (independent playtest + adversarial audit)
base: 5a16942 (the dev-branch commit with close-out fix round 2; record it in both reports)
after: none. Highest priority on this machine: the close-out gates the polish rounds (the longest chain to the finish).
  Pause T007's timing runs while these browser runs are going; the Codex lanes keep writing code at below-normal priority.
owns: nothing in the tree. Both reviewers are read-only: they write only to their scratch folders and their reports.
do:
  Why: the cloud machine draws 3D in software at load 40-60; one camera orbit takes 18 minutes there. The owner moved
  the browser-heavy checks to this machine (real GPU). The cloud fix engineer made the changes; you did not, so you are
  independent of them. Run the two roles below as two separate sub-agents (Claude Code's Agent tool), each with a fresh
  context and only its own brief, and let them run in parallel. Give each one its brief verbatim plus these notes:
  - Work in a git worktree of the base commit (not the live clone). Build the shared test cities first:
    `npm run fixtures -- --only cities --cities <dir>` (docs/dev/TEST_CITIES.md; deterministic, the same cities as the
    cloud's). CITIES below means that <dir>.
  - Chromium with hardware acceleration (no SwiftShader flags), headless; report GPU, driver and browser version.
  - "SIGKILL your chromium" means `taskkill /F /PID <pid>` (the whole browser process tree).
  - For the old save of commit 9948964: `git archive --format=tar 9948964 | tar -x -f - -C <dir>`, then build and run
    its own save code there.
  - Read first: docs/dev/reports/simB-close_fix-c2.md (the latest fix report: every item to re-check),
    docs/dev/reports/simB-close2_tooling-cities.md, docs/dev/reports/simB-close_fix-c1.md,
    docs/dev/reports/simB-close_verify-playtest-c2.md and docs/dev/reports/simB-close_verify-audit-c2.md.

  ===== brief 1: PLAYTESTER =====
  ROLE: independent real-input PLAYTESTER (close-out round c3). You did not make these changes. Play the base commit in
  vite + headless chromium with REAL mouse and keyboard input (page.mouse / page.keyboard; page.evaluate only to read
  state or for a declared test setup). Re-check every item of the latest fix report as a player would, plus the c1 and
  round-4 fixes that touch the same code, and hunt for BLOCKER/MAJOR regressions anywhere you go:
  (1) Exit-to-region leak: in the big city (CITIES/vet_s7_y21.region.metropolis via Load Region -> import -> Play) and in
      a fresh small city: query several buildings (growable, service, utility), open the inspector's WHY? section, open
      every panel and data view once, use each tool family once, then Save & exit to region; repeat 3 times. Measure
      with CDP (HeapProfiler.collectGarbage, then Runtime.queryObjects for the CityScene / WebGLRenderer /
      HTMLCanvasElement prototypes, or a heap snapshot): the previous city must be gone and the heap flat across cycles.
  (2) Emergency banners vs flyouts and panels at 1280x720, 1366x650, 1920x1080 and 1024x600, with a real quake burst
      and at least 9 dispatchable banners (config.disasters=true as a declared test setup if needed): every flyout and
      every tab; centre panels (Budget, Rewards, Statistics) opened and closed; at 1366x650 the stack must return to its
      full layout with the pill; press-holds of 0.3, 1.2, 2.5 and 4 s while a flyout closes; rapid triage (Send nearest
      every 300 ms on banners that did not move) must not lose clicks; a press on a banner that just moved under the
      pointer must never dispatch a different banner and must give feedback; dismiss every banner, then open a centred
      panel: the pill must not cover its title.
  (3) Paused quake: no camera shake while paused; plop previews and clicks agree (e.g. rebuild a ruined Missile Test
      Range after a meteor while paused).
  (4) The minimap save chip vs right-docked panels at 1280x720.
  (5) Toolbar thumbnails after 15 s idle: no extra renderers kept (CDP queryObjects).
  (6) The polish items if the fix report says they were done (pill text, disabled Dispatch rows, Load Region thumbnails).
  (7) Regression loop: main menu -> new region -> found a city -> roads, zones, power, water -> grow it past 1,000
      residents; save -> reload the page -> Continue; crash recovery (bulldoze something, wait for the recovery
      snapshot, kill your chromium, restart, Recover); New Year.
  ALWAYS look at the screenshots you take and cite their paths.
  FINAL ANSWER: a summary, then findings, each with title, severity (blocker|major|minor), area, evidence (screenshot
  and log paths you looked at), suggestedFix, files.

  ===== brief 2: AUDITOR =====
  ROLE: independent ADVERSARIAL AUDITOR (close-out round c3). You did not make these changes. Review the close-out diff
  line by line, `git diff 822fa5a <base> -- src/ui src/game src/sim src/save src/main.ts tools tests` (in src/render read
  only teardown/dispose changes; the render lanes' changes in TreeRenderer, fallbackTrees, BuildingRenderer, batch,
  VehicleRenderer, PropRenderer, Shadows and WorldView are reviewed by others), and try to break it: races, stale state,
  leaks, event-listener leaks, perf of the new code, forced layouts per UI tick (EM-3: EmergencyBanner must do 0 forced
  layouts in steady state with and without banners, flyout open or closed), save/load, determinism.
  Gates: npx tsc --noEmit; the full npx vitest run (the Windows-only CRLF binary.test failure excepted unless T012 has
  landed); the 128x15 seed-7 bot bit-identical at 194,432 (npx tsx tools/simbot.ts --size 128 --years 15 --seed 7);
  old saves load and continue (the CITIES cities, and at least one save written by commit 9948964 with its own save
  code); the recovery codec suite. Leak probes: in node (WeakRef + gc) and in the browser (CDP) after inspector clicks,
  every panel, every tool family and exit/re-enter x3, in a small and a big city; and a sweep for any remaining
  module-level reference that can pin a city (grep plus heap-snapshot retainer paths). Confirm or refute each item of
  the latest fix report with evidence.
  FINAL ANSWER: a summary (gates, each item confirmed or not), then findings, each with title, severity
  (blocker|major|minor), area, evidence, suggestedFix, files.
  ===== end of briefs =====

gates: both reviewers finished; their reports written. You do not fix anything: the lead routes the findings to the
  cloud fix engineer.
report: docs/dev/reports/local-T013-playtest-c3.md and docs/dev/reports/local-T013-audit-c3.md: each reviewer's final
  answer verbatim, then a JSON block {"summary": ..., "findings": [{"title", "severity", "area", "evidence",
  "suggestedFix", "files"}]}; a few key screenshots under docs/dev/reports/local-T013/ (bulky evidence stays out of
  git). Push local/T013-sim-check-c3 with docs/dev/queue/T013-sim-check-c3.done; DONE (say how many blocker/major
  findings each reviewer has).
