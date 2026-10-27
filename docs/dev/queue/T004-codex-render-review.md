# T004-codex-render-review: independent Codex code review of render round 2 revise v1
base: claude/beautiful-johnson-u2jqoz HEAD (work in the ..\simcityweb-worker worktree)
after: may run ALONGSIDE T003 (Codex only: no GPU, modest CPU); finish T003 first if they compete
owns: docs/dev/reports/local-T004-codex-render-review.md only; no source edits
do:
  Why: the cloud art/perf reviewers judge behaviour and numbers; a different model reading the code line by line catches
  logic bugs that measurements miss. Context: docs/dev/reports/render2-final_revise-*-v1.md (what changed and why).
  1. Diff: git diff c30fca4..HEAD -- src/render tests/render (skip pure teardown/dispose lines from the sim close-out).
  2. Run Codex non-interactively and read-only (e.g. codex exec with a read-only sandbox; check codex exec --help) on that
     diff plus the files it touches. Ask for concrete bugs with file:line and a failing scenario, especially:
     - TreeRenderer: ring culling (ringNearBox prefix bounds, ringCellBox 4x4 cell bounds, ringMicroTopY waist test, removed
       30 m slack) — can a visible tree be culled or a tree drawn twice?; ringViewSame cache key completeness (anything the
       ring pass reads but the key omits → stale ring); RING_LOW_VERT shader math at weight 0 / 0.4 / 1.
     - fallbackTrees: ringLow geometry (normals, winding, triangle count, the fold to the waist at weight 0).
     - WorldView.warmView / loadWarmUp: is every piece of state restored (camera pose and projection, near/far, render
       target, shadow flags and autoUpdate, renderer.info, autoClear, scissor/viewport, LOD/visibility state)?
     - BuildingRenderer: LOD warm-up stand-ins and the installProxy culling-sphere re-share; PropRenderer warm-up restore;
       batch.ts / VehicleRenderer warm-up queue (a disposed object's queued entry, ordering, double runs); Shadows.loadWarm.
  3. Verify every Codex claim yourself against the code (and with a quick scratch test where cheap). Classify each as
     CONFIRMED (with the failing scenario), PLAUSIBLE (cannot rule out) or REFUTED (say why).
gates: no source edits; the report lists every Codex claim and your verdict
report: docs/dev/reports/local-T004-codex-render-review.md (also note how long Codex took and roughly how much of its
  quota a review like this used); push local/T004-codex-render-review with docs/dev/queue/T004-codex-render-review.done; DONE.
