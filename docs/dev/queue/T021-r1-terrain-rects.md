# T021-r1-terrain-rects: Worker plan step R1, TerrainRenderer dirty rects (a Codex lane)
base: a0463c0 (the dev branch HEAD; record it); branch local/R1-terrain-rects
after: none. Write the code now in a Codex lane at below-normal priority. Its timing and screenshot runs are short;
  fit them on a quiet machine after T014's speed reviewer, between T015's timing runs.
owns: src/render/world/TerrainRenderer.ts and new tests under tests/render/. No other file: WorldView.ts already
  forwards every event's rect (bindEvents, around line 353), and no open branch touches either file.
do:
  Why: decision D13 of docs/POLISH_PLAN.md lands the Worker plan's render steps R1 and R2 right after W0.5, and the
  polish WORLD items wait for them. R1 is render-only and fully specified, so starting it now takes it off the
  critical path. The design row: docs/WORKER_DESIGN.md §6, R1 (line 974): "updateZones and updateTrees, plus the
  lights and exits, take the union of the event rects instead of the whole map (today a full 256² refill, 1.44 ms,
  plus 3 uploads on every frame that carries a building, zone, network, tree or power-line event)". Acceptance:
  "≤ 0.15 ms per event frame at 256²; pixel-identical".
  Today markCells(_r) ignores its rect and update() refills and uploads the whole zone, light and tree textures, and
  recomputes the exits, on every frame with an event.
  The change:
  - markCells(r) and onTerrainChanged(r) grow a pending union rect per texture group (zone + light; trees).
    CellRect is inclusive min, exclusive max (src/core/events.ts:25). Grow it by one cell on each side and clamp it to
    the map: refilling extra cells is harmless, and it guards against an emitter that is off by one.
  - update() refills only the union, and uploads only its rows with Texture.addUpdateRange. **Pitfall:** three r186's
    WebGLTextures.updateTexture assumes 4 components per texel (componentStride = 4, one texSubImage2D per row). The
    zone texture is RGBA, but the tree and light textures are RedFormat, so give their ranges in texel×4 units, and
    test that. Above about half the rows, do one full upload instead.
  - updateExits only when the union touches the two outermost rings of cells. The exit texture is N×4, so upload all
    of it then.
  - rebuildAll, reset, setQuality and the climate paths stay full refills. Clear any pending ranges there, so a stale
    range cannot shrink a full upload. Check how three handles ranges on a texture's first upload and after the
    renderer re-creates it (context restore, quality switch).
  The risk: today the full refill hides any write that emits no event, or one whose rect is too small. Audit every
  writer of zone, building, network, netFlags, trees, water and powerLines in src/sim, src/game (also
  src/game/fallback) and src/save, and check that an event whose rect covers the write follows it. List them all in
  the report with file:line. **Do not edit sim or game files**: other open branches (the J-fixes, W0) are changing
  them. If an emitter is missing or wrong, send PROGRESS with file:line straight away, so I can route the fix.
gates:
  - npx tsc --noEmit clean; npx vitest run passes.
  - An exactness test in node (TerrainRenderer needs no GL context to build): attach it to a headless sim's event bus.
    Run a random sequence of every tool action (zones, roads of each kind, rail, power lines, trees, bulldoze, terrain
    raise, lower and level, water) and a bot city's growth with disasters on, for example 60 sim years of a 128 map.
    After every update(), the zone, light, tree and exit arrays must equal a full recompute.
  - A test that the update ranges cover exactly the union's rows for the RGBA and the Red textures.
  - Browser, real GPU, the dense 256 city: the scripted events (plop, zone a block, a road, trees, power lines, a
    terrain edit near the map edge). Report TerrainRenderer.update plus the texture upload, before and after, per
    event frame (performance.now around update(), and a Chrome trace for the upload), with ≥ 8 reps. The target is
    ≤ 0.15 ms.
  - Pixel-identical: screenshots of the same scripted sequence on the base and on the branch (paused sim, fixed camera,
    LOW and HIGH): 0 differing pixels, or explain each difference.
report: docs/dev/reports/local-R1-terrain-rects.md: the writer audit, the timing table, the screenshot paths (a
  few small JPEGs under docs/dev/reports/local-R1/). Push local/R1-terrain-rects with
  docs/dev/queue/T021-r1-terrain-rects.done; DONE.
