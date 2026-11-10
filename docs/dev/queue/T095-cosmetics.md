# T095-cosmetics: two cosmetics from the early release check (NOTE-081)
base: dev (current head); branch local/T095-cosmetics
owns: src/region/RegionScreen.ts (the tile card's wording); src/render/world/WaterRenderer.ts (the shader's early
  return); the shader source that raises X4122 if you can locate it; new tests.
do:
  1. The recommended tile's card says "mostly flat land with a little water" while showing 0 % water, in 3 of 4 new
     regions (src/region/RegionScreen.ts:254). Word it from the tile's actual water share (and its other shares, if
     the same sentence can be wrong for them): no "a little water" at 0 %. Unit-test the wording over the share
     ranges.
  2. Two shader-compiler warnings on every city load:
     - `X4000: use of potentially uninitialized variable (f_waterGround)`: it comes from the early `return` inside the
       `if` at src/render/world/WaterRenderer.ts:53-61. Return once (assign and fall through) so the HLSL translation
       has no uninitialised path; the rendered result must be identical.
     - `X4122: sum of 0.996094 and -2.98545e-017 cannot be represented accurately` at (213,81-129) of another
       program: locate it if you can (search the shader chunks for a constant near 0.996094 = 255/256 added to a tiny
       value) and fix it without changing the picture; if you cannot locate it, say what you ruled out.
     - Medium and Low also log `X3595: gradient instruction used in a loop with varying iteration` at (198,12-86):
       locate and note it; fix only if it is clearly safe.
     You cannot run a browser: reason from the GLSL, keep the maths identical, and list exactly what I should compare
     on the real GPU (A/B screenshots of water at day, night, shallow and deep, on each quality).
notes:
  - T084 (the nightfall stall, my lane) edits WorldView.ts, not WaterRenderer.ts; T073/T074 edit PostFX, Sky and
    Weather. Stay in the files named.
gates:
  - tsc; your test and the existing region-screen and water tests through quietrun; the bot identical (render and UI
    only).
  - I run the full vitest and the real-GPU A/B (0 console warnings of these kinds on a city load; pixel comparison).
report: docs/dev/reports/local-T095-cosmetics.md.
