# T030 — the UI half of the per-frame cost during camera moves (#17), with R2's minimap throttle

## Review and gates (the local worker)

Branch `local/T030-ui-frame` on `local/W0.3-5-integration` (`93069fa`). The Codex lane's work is one commit. I
reviewed it against the task, docs/dev/STATUS.md ("Render round 2 after verify perf v2", item 2) and WORKER_DESIGN
§6 row R2.

What the code now does while the camera moves:
- **HUD:** it already ticked at about 6 Hz (0.16 s), under the 10 Hz cap. It now also refreshes at once when the
  camera stops: `MiniMap.frame` returns the moving-to-resting transition. The panels' cadence is unchanged.
- **Demand fills:** they animate `transform: scaleY` (origin at the centre line) instead of `top` and `height`, on
  their own compositor layers. Unchanged values skip their style writes.
  - The 2 px corner radius is compensated (`2px / (2/a)px` before the scale). I checked it against the CSS radius
    clamping: the old height-based fill clamped its corners to `7a` px below a = 0.29, and the new one clamps to
    the same `7a` px, so the settled fill looks the same at every level.
- **Minimap:** the view frame redraws at 10 Hz while moving, at once on stop, and after a base repaint or a
  collapse toggle. `paintBase` is sliced (4096 cells or 2 ms per frame, whichever comes first) and keeps the
  previous complete map visible. The largest city (256 × 256, a Large tile) repaints in 16 frames. An overlay
  change or a new city restarts the slice.
- **Labels:** the neighbour labels and the region screen's city labels project at 10 Hz while moving and at once
  on stop. Sizes are cached and re-read only on resize, through a ResizeObserver, so the per-frame handlers do no
  layout reads. As the task asks, labels step at 10 Hz during a pan; they settle exactly on stop.
- The animated HUD parts (the paused and live pills, the cap dot, the coach pulse) get `will-change`.

My one edit: the lane gave `NeighborLabels` an optional AbortSignal and asked to widen its scope into main.ts to
pass one. That is not needed: main.ts already disposes the labels with the city (`c.labels?.dispose()`), and
`dispose()` now also disconnects the new ResizeObserver. I removed the unused signal parameter. The test now checks
that dispose stops the frame loop and the observer.

| Gate | Result |
|---|---|
| Targeted tests (labelFrame, miniMapFrame, topBarFrame, views) | 4 files, 28 tests passed |
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full, with the fixtures) | **161 files passed, 1 skipped; 1,594 tests passed, 10 skipped** |
| The fresh-page gate against `a284b80`: the ui page at HIGH and the real path at LOW (whole-main-thread CPU, interleaved, 8 reps, A/A, 90 % CIs) | queued on the quiet machine (the T014 timing tools). The sides are `a284b80`, `93069fa` (T030's parent, for attribution) and `827e5da`. |
| HUD and minimap at rest, screenshot diffs against `93069fa` | queued with the timing runs |
| The bot | not affected: T030 changes no file under src/sim or src/worker |

## The lane's summary (Codex)

- `src/ui/TopBar.ts`: transform-based demand fills; unchanged style writes are skipped.
- `src/ui/hud.css`: compositor layers for the demand bars and the HUD pulses.
- `src/ui/MiniMap.ts`: 10 Hz redraws, an immediate refresh when the camera stops, sliced base painting. The pointer
  handlers are unchanged.
- `src/region/NeighborLabels.ts`: throttled projections, cached dimensions, and observer cleanup on dispose.
- `src/region/RegionScreen.ts`: throttled city labels, cached dimensions, and an immediate refresh on data changes.
- `src/game/CityScene.ts`: refreshes the HUD when motion stops and keeps the existing panel cadence.
- Tests: `tests/game/miniMapFrame.test.ts`, `tests/game/labelFrame.test.ts`, `tests/game/topBarFrame.test.ts`.

Plan-vs-code differences:
- The HUD already ran at about 6 Hz.
- The camera controller's own layout reads are outside this lane.
