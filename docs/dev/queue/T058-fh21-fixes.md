# T058-fh21-fixes: FH-21's real-GPU recheck (NOTE-047 item 6) and its small fix lane
base: 821a8d6 (dev); branch local/T058-fh21-fixes
after: none.
owns: src/game/CityScene.ts (META hunks: the slow-frame fps check, restoreViews); src/region/ui/dialogs.ts (the
  Recommended label); src/main.ts (one line: where the load timer starts; the cloud's App wiring, so keep it to that
  line); new tests. Not owned: src/ui/Notifications.ts (the cloud's FEEL-02a). Bug 2 below is a request.
do:
  The recheck on the RTX 5070 Ti (driver 610.47, headless Chromium 141 with the real GPU) passes every FH-21 Acceptance
  line:
  - this 16-thread machine detects High; 4 cores detect Medium;
  - an existing profile keeps its setting;
  - no prompt at 60 fps on the 653k and 1.12M cities;
  - under a 20x CPU throttle, exactly one prompt (11.5-11.8 s after a mid-session slowdown), remembered for Keep and for
    Switch;
  - context loss 13/13 in 3 runs: card in 14-102 ms; Restore at the same camera, with the same exactDigest, in
    0.94-1.15 s on the 655k city;
  - Found City → first interactive frame 1.19-1.22 s.
  Evidence: the worker's scratch qa/FH21/qa.md.
  Fix these four bugs and two minors:
  1. **A slow first build fires the slow-frame prompt for a city that then runs at 60 fps** (CityScene.ts:690-694 with
     :726-734). When firstFrame flips, the fps accumulator is not reset, so the first sample includes view building and
     the first draw (3.46 s on the 653k city). A 22 s createViews fired the once-per-profile prompt before __ready.
     Reset the fps sample (frames, t, last) when firstFrame is set. Test: a long first frame does not count.
  2. Request, not a fix here: a toast arriving above the slow-frame question moves its buttons under the cursor
     (Notifications.ts:273, also :190). The QA's first real click on Keep missed. Insert other toasts below the last
     .question, or give questions their own container (the cloud's FEEL-02a file).
  3. **Restore drops an active data view** (CityScene.ts:582-588, restoreViews). With Land value on, the legend still
     shows it, but the new WorldView draws no overlay (currentOverlay 0). Re-apply ctx.overlay after the rebuild. Test.
  4. **Play's load time includes the "Recover unsaved progress?" dialog** (main.ts:484). t0 is taken before the
     recoveryGate await (:491), so a dialog held 6.3 s gave lastLoadMs 7,381 ms. Take t0 after the gate: one line.
  5. Minor: Restore resets the time of day to 10:30. The rebuilt WorldView uses its default (WorldView.ts:248), and
     createViews (CityScene.ts:475) passes no timeOfDay. Carry it across the rebuild.
  6. Minor: the title Settings always labels High as "Recommended" (region/ui/dialogs.ts:51), even when detection picked
     Medium. Label the detected tier.
gates:
  - tsc; the full vitest; the bot identical (192,899).
  - The real-GPU recheck of bugs 1, 3 and 5 (the worker's ctxloss-gpu.mjs and its slow-build probe), plus the six
    acceptance lines again.
report: docs/dev/reports/local-T058-fh21-fixes.md (the recheck table above, the fixes, the request). Push
  local/T058-fh21-fixes with docs/dev/queue/T058-fh21-fixes.done.
