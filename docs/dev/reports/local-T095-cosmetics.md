# T095 — two cosmetics from the early release check (NOTE-081)

Branch `local/T095-cosmetics` on `dfb6941a` (dev `825ee224` plus the task file). The changes are uncommitted.
No browser and no GPU were used. Shader claims below come from the GLSL and from `fxc.exe` (the D3D compiler of the
Windows SDK on this machine) run on hand-translated replicas: `docs/dev/reports/local-T095/fxc/`.

## Outcome

| Item | Result |
|---|---|
| 1. The recommended tile's card | **Fixed.** The sentence is worded from the tile's water and flat-land shares. |
| 2a. X4000 `f_waterGround` | **Fixed.** `waterGround()` returns once; both branches read the same texel as before. |
| 2b. X4122 `sum of 0.996094 and -2.98545e-017` | **Located, not changed in the tree.** It is three.js' own PMREM prefilter, not a shader of ours. A tested patch is ready (`local-T095/quiet-three.patch`); it needs one line in Sky.ts and one in thumbs.ts, outside the files this lane was given. **Decision for the lead.** |
| 2c. X3595 (Medium, Low) | **Located and noted.** It is three.js' FXAAShader, with X4000 `f_ApplyFXAA` in the same log. The same optional patch silences both (one line in PostFX.ts). |

## 1. The tile card (`src/region/RegionScreen.ts`)

The card said "A good first city for you: mostly flat land with a little water." for every recommended tile, next to
whatever the "% water" stat showed.

- New pure function `recommendedTileLand(water, flat)` (exported, next to the class). `selectTile` calls it with
  `model.tileWaterFraction(tile)` and `model.tileFlatFraction(tile)`; the second is read only for the recommended tile.
- The water words follow the rounded percentage the card prints, so the two cannot disagree:

  | card shows | words |
  |---|---|
  | 0%, no wet sample | "no water" |
  | 0%, some wet sample (under 0.5%) | "almost no water" |
  | 1–19% | "a little water" |
  | 20–40% | "some water" |
  | 41% and more | "a lot of water" |

  40% is the line `pickNiceTile` already treats as too much water.
- "mostly flat land" could be wrong too, so it follows the flat share (dry, flat land as a share of the tile, the
  value the recommendation is scored with): more than half "mostly flat land", from a quarter "some flat land",
  below that "little flat land".
- Other tiles and founded cities keep their texts.

A probe over 84 fresh regions (7 presets × 12 seeds; `recprobe.mts` and its output in the lane's scratch folder):
the recommended tile has 0.0–16.0% water and 75.8–100% flat land. 34 of the 84 show "0% water" (32 without any wet
sample, 2 with one wet sample of 256). So today's regions only reach "no water", "almost no water" and "a little
water", always with "mostly flat land"; the other tiers are there so that the sentence stays true on any region.

## 2a. `waterGround()` (`src/render/world/WaterRenderer.ts`)

```glsl
float waterGround(vec3 P) {
  float W = uN * uCell;
  float ground;
  if (P.x >= 0.0 && P.z >= 0.0 && P.x <= W && P.z <= W) {
    vec2 uv = (P.xz / uCell + 0.5) / (uN + 1.0);
    ground = texture2D(uHeightTex, uv).r;
  } else {
    vec2 uv = (P.xz + uOuterExt) / (W + 2.0 * uOuterExt);
    ground = texture2D(uOuterTex, uv).r;
  }
  return ground;
}
```

- The condition, both uv expressions and both reads are unchanged; only the two `return`s became one.
- Both textures have one mip level and linear filtering (TerrainRenderer.ts:115-118, WaterRenderer.ts:206-208), so
  the value read does not depend on screen-space derivatives in either form.
- FXC on the replicas: the old form gives `X4000: use of potentially uninitialized variable (f_waterGround…)` at
  the brace that closes the branch (column 1, like the browser's `(533,1)`), the new form gives nothing. The compiled
  listings hold the same instructions per branch; `if … endif` + `if (not) … endif` became `if … else … endif`:

  ```
  before                                   after
  if_nz r0.y                               if_nz r0.y
    div, add 0.5, add 1.0, div               div, add 0.5, add 1.0, div
    sample t0, s0                            sample t0, s0
  endif                                    else
  if_z r0.y
    add, mad, div                            add, mad, div
    sample t1, s1                            sample t1, s1
  endif                                    endif
  ```
- Also clean in FXC: the local declared with ANGLE's `= {0}` initialiser, and the `else` rewritten as a second `if`.

## 2b. X4122: three.js' PMREM prefilter

**Where.** `node_modules/three/src/extras/PMREMGenerator.js` (r186), `_getGGXShader()`, the material
"PMREMGGXConvolution", function `importanceSampleGGX_VNDF`:

```glsl
t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;                              // HLSL line 212
vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;  // HLSL line 213
```

**Proof.** `fxc/pmrem_ggx_before.hlsl` is that shader in ANGLE's HLSL style. FXC prints the browser's five lines:
the same order, the same numbers and the same columns (`81-129`, `37-61`, `82-106`); only the line numbers differ
(123/124 against 212/213, ANGLE's preamble is longer). See `fxc/results.txt`.

**Why.** The loop runs 256 Hammersley samples from a constant start, and FXC evaluates the first ones ahead while it
analyses the loop (with the upper bound read from a uniform it still reports samples 1 and 2; with the start read
from a uniform it reports none). Samples 1, 2 and 3 sit at angles float(2π)·½, ·¼ and ·¾, a float's rounding away
from an axis:

| sample | term | value |
|---|---|---|
| 1 | `1 - t1²` = 1 − (1/16)² = 0.99609375, then `- t2²` | t2² = 2.98545e-17 |
| 2 | `1 - t1²` | t1² = 1.49272e-17 |
| 3 | `1 - t1²` | t1² = 1.66644e-18 |

A double absorbs each of them, which is all X4122 says. (Recomputed in JS with float rounding: the same three
numbers, and no other sample has a tiny square.) So the 0.996094 is not 255/256 from the depth-packing chunk, as
T003's note and the task's hint assumed.

**It is harmless.** The code FXC emits is a run-time loop (`loop … uge i, 256 … sincos … endloop`, 164
instructions) that computes every sample on the GPU; the values it warned about are not in it.

**Why two blocks per city load.** Two renderers compile it: the city's sky (Sky.ts:445, first `renderEnv`) and the
toolbar thumbnails' own renderer (src/ui/thumbs.ts:74). A quality change that resizes the environment source
allocates a new prefilter material and logs it again.

**Why it is not changed in the tree.** The source is third-party, so a fix is a run-time text patch of the material
that `PMREMGenerator` creates, applied where the generators are made: Sky.ts and thumbs.ts. The task says to stay in
the files named, and Sky.ts is T073's. I wrote and tested the patch and left it out of the tree: see "The optional
patch".

Set aside on the way, by reading: our shaders hold no 255/256 constant (only `* 255.0 + 0.5` index decodes and the
`/ 255.0` dither); three's only one is `UnpackDownscale` in the packing chunk, which is never added to a small
term; the atmosphere, sky, fog, composite and AO-blur shaders have no sum that folds to a constant near 1.

## 2c. X3595: three.js' FXAAShader

- **Where.** `three/examples/jsm/shaders/FXAAShader.js`, used by `PostFX.fxaaMat` (PostFX.ts:445-452) when
  `q.fxaa` is set: the Low and Medium presets (quality.ts; High and Ultra use MSAA).
- `(198,12-86)` is ANGLE's own helper `gl_texture2D` (`return textures2D[samplerIndex].Sample(...)`, columns
  12-86): the implicit-derivative read behind `Sample()`, called from the two edge-search loops
  `for (i = 1; i < EDGE_STEP_COUNT && !pAtEnd; i++)` of `DetermineEdgeBlendFactor`. Two loops, two warnings.
- The same info log carries `X4000: use of potentially uninitialized variable (f_ApplyFXAA)`: `ApplyFXAA` returns
  from inside `if (ShouldSkipPixel(...))`.
- `fxc/fxaa_before.hlsl` reproduces all three lines. Harmless: the input (`ldrRT`, PostFX.ts:503) has one mip level.
- A safe fix exists but is not a one-liner, and it is in PostFX.ts (T073's): reading level 0
  (`textureLod(tex2D, uv, 0.0)`) removes the two X3595 and leaves X4000; giving `ApplyFXAA` one return removes
  X4000. Both together compile clean (`fxc/fxaa_after.hlsl`). It is part of the optional patch.

## The optional patch (`docs/dev/reports/local-T095/quiet-three.patch`)

`git apply docs/dev/reports/local-T095/quiet-three.patch` from the worktree root. `git apply --check` passes on this
lane's final tree, and on the Sky.ts, PostFX.ts and thumbs.ts of the T073, T074 and T084 branch heads (checked in a
scratch copy, their worktrees untouched).

| File | Change |
|---|---|
| `src/render/world/quietShaders.ts` (new) | `quietGgxShader(src)`: the prefilter's loop starts from `uniform int ggxFirst` (always 0) instead of `0u`. `quietPmrem(pmrem)`: wraps the generator's `_allocateTargets` so every prefilter material gets that text and the uniform before its first compile. `quietFxaaShader(src)`: level-0 reads and one return in `ApplyFXAA`. Each returns null / does nothing when the source is not the text it was written for. |
| `tests/render/quietShaders.test.ts` (new) | 6 tests, on three's real sources. They fail when a three.js update changes the patched text. |
| `src/render/world/Sky.ts` | import; `this.pmrem = quietPmrem(new THREE.PMREMGenerator(renderer));` |
| `src/ui/thumbs.ts` | import; `const pm = quietPmrem(new THREE.PMREMGenerator(this.renderer));` |
| `src/render/world/PostFX.ts` | import; `fragmentShader: quietFxaaShader(FXAAShader.fragmentShader) ?? FXAAShader.fragmentShader,` |

- **Picture.** With the loop start read from a uniform, FXC has nothing to evaluate ahead and prints nothing; the
  compiled loop body is the same listing, instruction for instruction. The whole difference is the counter's first
  value: `mov r3.w, l(0)` becomes `mov r3.w, cb0[2].x`. FXAA: the same texels (one mip level), and a skipped pixel
  leaves `uv` untouched, so falling through to the last `return Sample(tex2D, uv)` reads what the early return read.
- **Checked** with the patch applied here: tsc clean; `quietShaders.test.ts` 6/6; `lighting.test.ts` (loads Sky.ts),
  `thumbsRetention.test.ts` and `thumbsPendingRetention.test.ts` pass. Then removed again with `git apply -R`.
- **Limits.** It leans on two private names of three (`_allocateTargets`, `_ggxMaterial`) and on exact source text;
  if either changes it does nothing, the warnings return and its test fails. On other backends than D3D a compiler
  that unrolled the 256 samples no longer can; I cannot measure that here. The demo pages' generators
  (demoWorld.ts:119, gallery/main.ts:79) are not wired.
- Without it, a city load logs: High and Ultra, the X4122 block twice; Medium and Low, that plus the FXAA block
  (X3595 twice and X4000 `f_ApplyFXAA`). None of it affects the picture.

## Files

| File | Change |
|---|---|
| `src/region/RegionScreen.ts` | `recommendedTileLand()`; `selectTile` keeps the water share and words the recommended tile's sentence from it and the flat share. |
| `src/render/world/WaterRenderer.ts` | `waterGround()`: one return (GLSL only). |
| `tests/game/regionTileCard.test.ts` (new) | 6 tests. |
| `tests/render/waterShader.test.ts` (new) | 4 tests. |
| `docs/dev/reports/local-T095/` (new) | `quiet-three.patch`; `fxc/`: six replicas and `results.txt`. |

No hunk outside the files the task names. No `src/sim/infra` hunk, no cloud-held file.

## Tests

`tests/game/regionTileCard.test.ts`
- the recommended tile's land sentence › words the water from the share the card shows
- › says "mostly flat" only when more than half of the tile is flat land
- › never contradicts the card's percentage, for every share the sample grid can give (all 257 shares k/256)
- the selected tile's card › describes the recommended tile by its own water and flat land (the real `selectTile`)
- › keeps the texts of the other tiles
- › a generated region: the recommended tile without water no longer promises "a little water" (greenvale 15851)

`tests/render/waterShader.test.ts` (the fragment shader as `onBeforeCompile` patches it)
- detail 0 / 1 / 2: no return inside a block (`waterGround` and `waterShade`)
- waterGround reads the same texel in both branches as before, and returns it

Mutation checks (both files restored and byte-compared afterwards):
- with the committed `waterGround` and the old fixed sentence put back, 6 of the 10 fail: all 4 water tests and the
  two card tests that render a 0% tile. The card then reads "…mostly flat land with a little water.2 × 2
  km0%water…", the reported bug;
- with "almost no water" dropped and "mostly" allowed at exactly half, the three sentence tests fail.

The tests' heavy setup (the water programs' textures, the generated region) runs when the file is collected, so no
test body takes more than a few milliseconds under load.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean (final tree) |
| the two new files + `labelFrame`, `newCityStart`, `firstCity` (region screen), `fireworks` (water flashes), through quietrun | 6 files, **46 passed**, 2 skipped (fireworks' `SIM_FIXTURES` cases, as on dev) |
| `tests/worker/hygiene.test.ts` | 18 passed alone. In a 7-file run under load two of its file scans hit the 5 s timeout ("no detaching APIs", "W0.2: speed writers"); not content failures. |
| 128 × 15 seed-7 bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` | **identical**: residents [ 61124, 93804, 37971 ] = 192,899 in 2015 |
| Full vitest, real-GPU A/B, console on a city load | left for the lead |

## Plan against code

- The task's line `RegionScreen.ts:254` is the stats row; the sentence was at `:263`.
- The X4122 source is not in "the shader chunks" of the game: it is inside three.js (above). The task's `owns` line
  gives me "the shader source that raises X4122", but that source can only be reached from Sky.ts and thumbs.ts.
- "Two warnings on every city load": X4122 is logged twice per load (two renderers), X4000 once.
- X3595 comes with a third X4000 (`f_ApplyFXAA`) that the task does not list.
- The sentence stays in RegionScreen.ts, where it was. `guideCopy.phaseA.A3Tile()` supplies its first half; if GUIDE
  wants the second half in `src/ui/guide/copy.ts` too, `recommendedTileLand` moves as it is.

## Requests for files outside this lane

Only if the lead wants the console clean; all three are in the patch:
1. `src/render/world/Sky.ts`, constructor: wrap the generator in `quietPmrem(...)` (X4122, city renderer).
2. `src/ui/thumbs.ts`, `init()`: the same (X4122, thumbnail renderer).
3. `src/render/world/PostFX.ts`, `fxaaMat`: `quietFxaaShader(...)` (X3595 and X4000 `f_ApplyFXAA`, Low and Medium).

## Not verified

- Anything in a browser: ANGLE's real translation, the console after a city load, the pixels.
- The optional patch in a browser (three uploading the new `int` uniform, the two programs compiling).
- That the water program logs nothing else once `f_waterGround` is gone. The old log has exactly one line for that
  program, and FXC reports all warnings at once, so nothing else is expected.

## Real-GPU checklist

Water, before against after, on each quality (Low `WATER_DETAIL` 0, Medium 1, High and Ultra 2), same city, same
camera, same hour. The waves move with the render clock (`WorldView.clock`, the summed frame dt; pausing the
simulation does not stop it), so both shots need the same clock: the same number of fixed-dt frames, or `uWTime`
pinned on both sides.
1. Day, a shore inside the map: turquoise shallows, the transparent edge, the foam bands.
2. Day, deep water inside the map: the deep-blue body (Medium and up: whitecaps).
3. Day, the sea across a map border (x or z = 0, or the far edges): the `else` branch reads the outer texture
   there. No seam or step along the border line.
4. Night, a lit shore: the light streaks on the water and the shoreline alpha under them.
5. Optional: an inland lake and a narrow river.

Expected: no pixel differs. The function only supplies the ground height under the water, so a difference would show
as body colour, shoreline transparency or foam position.

Console:
6. After a city load at each quality: no `X4000 … (f_waterGround)`.
7. After switching quality in Settings (the water program is rebuilt): still none.
8. What remains without the optional patch is listed under "The optional patch". With it: no X4122, X3595 or X4000
   at any quality (expected from FXC, not seen in a browser).

Region screen (`?region=1&preset=<id>&seed=<n>` opens a fresh region; click the outlined tile):
9. `preset=greenvale&seed=15851`: "0%" water, "…: mostly flat land with no water."
10. `preset=greenvale&seed=39608`: "11%" water, "…: mostly flat land with a little water."
11. `preset=azure-coast&seed=95041`: "0%" water (one wet sample), "…: mostly flat land with almost no water."
12. Any other tile: "Found a city here — its terrain will match the neighbouring tiles." A founded city: the Mayor
    line.
13. At 1280 × 720 the longest sentence ("…with almost no water.") fits the card like the old one did.
