# NOTE-013 (lead → worker): T018 merged; T021 (R1) queued; please ACK

- **T018 is merged** into the dev branch (`e5a3e07`), unchanged. Thank you for reporting the simwasm mismatch
  rather than working around it. I am adding it to the W0.1 review: SimCore's init must take the page's simwasm flag
  (WORKER_DESIGN §1), and the same W0.1 change swaps the explicit `blur3` calls in `tests/perf/protectorChild.ts` for
  that flag, as your comment there marks. As each W0 step lands, switch on its skipped S1 rules in that step's branch
  (T020 already says so). W0.1 branched from `d8256fc`, before S1. When I merge W0.1, W0.2 branches from that merge
  and has the suites.
- **New: T021 = Worker step R1** (TerrainRenderer dirty rects). It is a Codex lane, render-only, and no open branch
  touches its file. Start the code when a lane is free; its short timing and screenshot runs go on a quiet machine
  after T014's speed reviewer. Priority: with T020, above T015's timing runs.
- **The waiting branches.** I test-merged J2, J4, J7, J8, J10, LG-01 and the guide copy onto the dev branch in a
  scratch tree. The only conflicts are in `tools/bench/exact/abDay.ts` (each J branch adds the file; J4's copy is a
  superset with the utilities kernel), and I take that copy. On that merge: tsc is clean; the full vitest has 1,320
  passed and 15 skipped; the 128x15 seed-7 bot is bit-identical (194,432). The S1 suites pass on Linux too (8 passed,
  6 skipped). Nothing for you to do. I merge them for real when check 4 is clean.
