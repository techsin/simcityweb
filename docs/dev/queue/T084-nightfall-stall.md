# T084-nightfall-stall: the 4 s main-thread stall at the first dusk: never hide the sun light (NOTE-073 item 2)
base: dev (current head); branch local/T084-nightfall-stall
owns: src/render/world/WorldView.ts (the sun light's visibility and the shadow policy only); a new QA tool
  tools/qa-nightfall.mjs; new tests.
why (the investigation's result; its data is in the scratchpad folder qa\T084\, analysis\ and runs\):
  At the sun-to-moon handover `this.sun.visible = L.lightIntensity > 0.002` (WorldView.ts, in update(), near line 501)
  hides the directional light for about 1.5 game minutes. three.js keys every program on the light counts
  (numDirLights and numDirLightShadows go 1 to 0, shadowMapEnabled goes off), so every material in view needs a second
  program (10-13 of them), and three waits for each at first use (setProgram -> getUniforms -> onFirstUse ->
  gl.getProgramInfoLog), one after the other: one frame of 3.4-5.3 s at the first dusk after every city entry
  (4,341 ms on the default host, 4,522 ms on ?simworker=1, 4,482 ms in the production build), on every quality.
do:
  1. Never let the light state change. In update(): keep `this.sun.visible` true; with
     `const lit = L.lightIntensity > 0.002`, set `this.sun.intensity = lit ? L.lightIntensity : 0` and keep `lit` in a
     private field (say `sunLit`). Where the code reads `sun.visible` to decide shadow work (the shadow invalidation
     on a visibility change near :521-522, and updateShadowPolicy near :794: `if (!this.sunLit || !sun.castShadow ||
     !sm.enabled)`), read the field instead, so the shadow map is still not re-rendered while the light is off. Find
     every other reader of `sun.visible` in src/ (search) and treat it the same way. castShadow and
     shadowMap.enabled must not flip at the handover either: nothing that enters three's program cache key may
     change between day, dusk, night and dawn. (A quality change may still change them: that path already rebuilds.)
  2. A unit test: step the view's clock through two full days (through both handovers) and assert that the values
     that feed three's program key stay constant (sun.visible, castShadow, renderer.shadowMap.enabled, the number of
     visible directional lights, anything else in src/render/world that toggles a light or a shadow flag by time of
     day; look for moon or night lights that are shown or hidden the same way and fix those too), that the light's
     intensity is exactly 0 while unlit, and that no shadow map update is requested while unlit.
  3. tools/qa-nightfall.mjs, a real-browser check in the style of tools/qa-ticker.mjs and tools/qa-context-loss.mjs
     (read them for the conventions; real GPU flags as an option, a fresh browser profile each run): load a city, pause,
     run the view's clock through 18:50-20:10 and 05:00-06:30 (set `scene.world.timeOfDay`), and fail on any frame
     over 250 ms or any change of `renderer.info.programs.length`; print the largest frame and the program counts.
     You cannot run a browser: write it carefully, and say it is unrun.
notes:
  - T073 (smog) and T074 (weather), my lanes not yet in dev, also edit WorldView.ts: T073 in the smog sampling and
    easing, T074 near :555-571 (overcast dims the sun and softens shadows). Keep your hunk to the sun's visibility,
    the `sunLit` field and its readers.
  - Rendering must look the same: with intensity 0 the light adds nothing, so day, night and the handover frames
    must be visually unchanged.
gates:
  - tsc; your test and the existing tests under tests/render that cover WorldView, Sky, shadows and PostFX, through
    quietrun; the bot identical (192,899; render only).
  - I run the full vitest, the bot, and the real-GPU check: the 5-minute Ultra protocol and qa-nightfall on a fresh
    profile, on the default host, ?simworker=1 and the production build; A/B screenshots at noon, dusk, night, dawn.
report: docs/dev/reports/local-T084-nightfall-stall.md.
