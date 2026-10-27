# T020-w0-worker-seam: Worker plan W0.1-W0.6 (the SimHost seam on the main thread), one branch per step
base: d8256fc (fix round 4 merged; NOTE-012). W0.1 branches from it, and
  each later step from the merged previous one (the lead merges each step after review and says so)
after: T016 merged (W0 rewrites CityScene, the UI's sim access and the save paths, which the close-out is still fixing)
owns: per step, exactly the files its row in docs/WORKER_DESIGN.md §6 (around lines 962-967) lists, plus its tests
do:
  Why: docs/POLISH_PLAN.md D1 starts the polish GUIDE and META items (most of rounds 1 and 2) only after W0.6. The
  big-city emergency change waits for W0.4 and the UI frame-cost change for W0.5. So W0 is now the longest chain to
  the finish, and it is well specified, which makes it Codex work.
  Read first:
  - docs/WORKER_DESIGN.md §1 (the SimHost API), §2 (commands, queries, watches, views), §4.5 (the save paths) and the
    §6 rows;
  - Appendix A (the QA checklist);
  - the revision table for R4, R6, R13, R14 and O8;
  - docs/WASM_PLAN.md §7.6 (D1-D8).
  The steps, each on its own branch local/W0.<n>-<name>, with its row's gates:
  - W0.1: SimCore + SimHost + LocalSimHost; CityScene.loadSim, guardSystem and trackRegionEffects move as listed;
    ctx.host. Keep T016's teardown fixes intact (guardSystem's disposed flag moves with it).
  - W0.2: commands. Every mutation goes through host.act / host.setSpeed; the cause-tag API; Tool.commit and gestures.
  - Then three lanes at once: W0.3 (queries and watches; the 5 Hz watch cap; structuredClone in dev and tests),
    W0.4 (LivePolicy in SimCore) and W0.5 (views and seams, with its two staleness fixes).
  - W0.6: saves through the host; the recovery.ts and save/index.ts splits; the replica brand; the BudgetPanel
    fallbacks deleted; the hygiene graph rules switched on (T018's skipped rules become active as each step lands).
  Rules:
  - LocalSimHost stays the only host, and the game stays playable and all tests green after every step.
  - Codex writes each step from the design text. You review every diff (behaviour unchanged, the design followed)
    and run the gates, plus the Appendix A checklist in the browser here for W0.2, W0.3 and W0.6.
  - Report anything in the design that does not fit the code as it is now, rather than working around it.
gates: per step: its row's gates; npx tsc --noEmit clean; npx vitest run passes; the 128x15 seed-7 bot bit-identical
  (194,432 in 2015): W0 must not change the simulation; old saves load and continue. W0.3 and W0.5 also need their
  screenshot diffs (the inspector and every data view identical on fixed seeds).
report: docs/dev/reports/local-W0.<n>-<name>.md per step; DONE per step. After W0.6, the lead runs an independent audit
  of W0.1-W0.6 together.
