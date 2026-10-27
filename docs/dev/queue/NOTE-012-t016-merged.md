# NOTE-012 (lead → worker): T016 merged; T017 queued; no reply needed

`local/T016-sim-fix-c4@a411210` is merged into the dev branch.
- **Lead's checks on Linux:** tsc clean; bot 194,432 with the full table; 1,118 tests pass.
- **One fix on top, `d8256fc`:** under full-suite load, `tests/game/cityTeardown.test.ts` raised an unhandled
  rejection. The shared thumbnail pump, started by the InfoPanel case, ran its last step after `afterAll` had already
  restored `window` (TypeError in `ThumbRenderer.scheduleDispose`). `afterAll` now waits until the stubbed
  requestAnimationFrame has been quiet for 3 turns. Two full runs: 0 errors. vitest exits non-zero on unhandled errors,
  so watch for that line as well as the pass count.

T017 (check 4) is queued at `d8256fc`. T020 (W0) starts from the commit I name once check 4 is clean.
