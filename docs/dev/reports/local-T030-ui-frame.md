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
| `npx tsc --noEmit` (with dev `7826490` merged) | clean |
| `npx vitest run` (full, with the fixtures; dev merged) | **183 files passed, 1 skipped; 1,858 tests passed, 7 skipped** (at `1533902`) |
| The fresh-page gate against `a284b80` (below) | **pass** on every gate segment |
| HUD and minimap at rest, against T030's parent | the same values; the minimap is bit-identical (below) |
| The bot | not affected: T030 changes no file under src/sim or src/worker |

## The timing gate (the desktop, Oct 28)

The T014 harness (perf-v3) ran on the RTX 5070 Ti desktop with fresh pages: HeadlessChrome 141 at 1280 × 720, vsync,
whole-main-thread CPU from the trace, and "outside" = the main thread minus the scene's frame callback. Each chain
had 8 reps, interleaved, with A/A copies and 90 % bootstrap CIs.
- The sides were `a284b80` (base), dev `7826490` (T30P, T030's parent) and T030 with dev merged (`9243438`).
- Machine load per run: medians 5.6-6.3 %.

**First run: the gate passes, but T030 added outside-callback work.**
- Every gate segment passes the lead's rule (no lower bound of T030/base is above 1.02):
  - ui page at HIGH: first zoom-in 0.69, zoom-out 0.97, far orbit 1.07 [1.014-1.099];
  - real path at LOW: first pan 1.01, zoom-out 0.86, zoom-in 1.02 [1.011-1.033].
- The ui far-orbit excess is the parent's (T030/T30P 1.006).
- Outside the frame callback, though, T030 was about **7-10 % above its parent** on both pages, and the whole thread
  about 2-4 % above. It was a fixed cost per frame: it showed in still segments too. So T030 did not cut T014's
  finding 4.

**The cause was T030's three `will-change` rules.** These were the RCI fills, the paused and live pills with the cap
dot, and the coach pulse. The fills include the 12 in the hidden demand popover, which stays laid out. A second run
timed T030 against the same tree with only those three rules removed (T30b):

| pooled over the 8 segments | T30b / T030 | T30b / parent | T030 / parent |
|---|---|---|---|
| ui HIGH, outside the callback | **0.902** [0.893-0.908] (0/16 above 1) | **0.987** [0.982-0.994] | 1.096 |
| ui HIGH, whole thread | 0.961 [0.956-0.966] | 0.989 [0.975-0.997] | 1.032 |
| real path LOW, outside the callback | **0.900** [0.887-0.909] (0/16) | **0.984** [0.979-0.996] | 1.095 |
| real path LOW, whole thread | 0.966 [0.941-0.970] | 0.997 [0.991-1.009] | 1.040 |

The A/A copies are within ±1.2 %. Without the rules, T030 is at or below its parent everywhere. `1533902` removes them.
The fills still animate `transform`, and the throttling (10 Hz while moving, at once on stop) is unchanged. T30b is
below T030 in every segment, so it also passes the gate against `a284b80`.

**At rest** (the same city and pose after a camera move, 150 frames, on both pages, against the parent):
- the HUD text is identical;
- the minimap canvas is bit-identical, and the camera is identical;
- the three RCI fills cover the same boxes within 0.01 px.

The HUD pixel diff was 0.27-0.30 % of the HUD box, all in two places: the fills' edge rows (`scaleY` rasterises
edges differently from a laid-out height) and, before `1533902`, the PAUSED pill's glyphs on its own layer.

**The lead's trace** (T014 finding 1: the dense city's extra tasks outside the callback on its first HIGH far orbit)
is the post-load major GC: V8 incremental-marking steps plus Oilpan sweep. There are no worker messages, timers or
LOD proxy replies. The GC lands in zoom-out or in the far orbit from run to run, which is T014's bimodal far orbit.
On the dev builds the cycle is larger, with 317 marking steps against 232. The detail is in the harness's
T030/trace_attribution_quiet.txt.

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
