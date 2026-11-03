# T030-ui-frame-cost: the UI half of the per-frame cost during camera moves (#17), with R2's minimap throttle (a Codex lane)
base: local/W0.3-5-integration @ 93069fa (W0.5 is in it); branch local/T030-ui-frame
after: none for the code. Rebase onto T027's minimap hunk if it lands first; both touch MiniMap.ts.
owns: the HUD (src/ui/TopBar.ts and the HUD parts it renders), src/ui/MiniMap.ts (update cadence and paintBase), the
  label layers updated per frame (find them: city and neighbour labels), the per-frame UI calls in
  src/game/CityScene.ts (a small hunk), and tests.
do:
  Read docs/dev/STATUS.md, "Render round 2 after verify perf v2", item 2 (the UI per-frame cost: what was found and
  the planned fixes). Also read docs/dev/reports/render2-final_verify-perf-v2.md (the two majors, on fresh ui pages
  against a284b80) and WORKER_DESIGN §6 row R2 (MiniMap.paintBase).
  - While the camera moves, the HUD, minimap and labels update at most 10 times a second. They update at once when the
    camera stops, and on data events as today.
  - No layout reads in per-frame handlers: cache sizes and positions, and read them on resize and on state changes.
  - Put the animated HUD parts on their own compositor layers.
  - MiniMap.paintBase is throttled or made incremental (R2); one repaint once caused a 120 ms frame.
  - The audio half (pooled one-shot nodes, the director after the veil fade) is T008's, so it is not in this task.
gates:
  - The fresh-page gate against a284b80, measured on the quiet machine: the ui page at HIGH (first zoom-in, zoom-out
    and far orbit) and the real path at LOW (first pan, zoom-out and zoom-in). Use whole-main-thread CPU, interleaved,
    ≥ 8 reps, with A/A and 90 % CIs. The pass rule is the lead's: a segment fails only when the lower CI bound of new/base
    is above 1.02.
  - The HUD and minimap show the same values as before at rest (screenshot diffs).
  - npx tsc --noEmit clean; npx vitest run passes.
report: docs/dev/reports/local-T030-ui-frame.md; push local/T030-ui-frame with docs/dev/queue/T030-ui-frame-cost.done; DONE.
  Priority: below W0.6 and W0.3b; its timing runs in a quiet slot.
