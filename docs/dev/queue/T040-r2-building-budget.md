# T040-r2-building-budget: Worker plan step R2, the BuildingRenderer.add part (LOD and geometry work at ≤ 2 ms per frame)
base: fb1531f (dev); branch local/T040-r2-buildings
after: none. A Codex lane writes the code; the timing and screenshot gates run on the real GPU in a quiet slot.
owns: src/render/city/buildings/BuildingRenderer.ts and its helpers under src/render/city/buildings/ (lodBuilder.ts's
  message format stays), new tests under tests/render/. T030 did R2's minimap part and the cloud's T038 does the
  fireworks part, so MiniMap.ts and Fireworks.ts are not touched.
do:
  Why: docs/WORKER_DESIGN.md §6 row R2 (line 981): "Budget BuildingRenderer.add: queue the LOD and geometry work at
  ≤ 2 ms per frame (about 2 ms per building today, max 14.8)". Acceptance "AC2 on R1" (docs/WASM_PLAN.md:589: the real
  game on the reference machine at ultra; p99 frame ≤ 33 ms and ≤ the paused city's p99 + 4 ms; no frame over 100 ms
  after the first 10 s). FEEL-14, FEEL-15 and NEW-02 wait for this file (POLISH_PLAN D13).
  Today add() and changed() call build() synchronously for every building event of a frame (geometry, kit, LOD
  proxies, foundations, site), so a burst costs one frame tens of ms: a block growing at ultra, a 200-building
  bulldoze and regrow, a disaster.
  The change:
  - A per-frame work queue. add() and changed() record the entry (the latest state wins; a remove before the build
    cancels it). Building ids are reused, so key the work by the BInst object, not only the id.
  - update() builds queued entries until a 2 ms budget runs out: a constant next to POP_TIME, timed with
    performance.now(). It builds at least one entry per frame, so the queue always drains.
  - What the player sees comes first: entries in the frustum or nearest the camera target before the rest. The pop-in
    animation starts when an entry is built, not when it is queued.
  - rebuildAll(), a city load or reset, and a quality switch keep building synchronously. Say which paths stay
    synchronous and why.
  - remove() of a queued, unbuilt entry frees nothing it never allocated. changed() of a queued entry updates it in
    place.
  - Every reader of inst/list must see a consistent state (picking, hover, onVisual and the BuildingVisual callback,
    LOD counts, the fade and animation sets): a queued building is simply not drawn yet. List each reader and how it
    sees a queued entry.
  - Once the queue drains, the instances, materials, LOD choice and the drawn scene are identical, pixel for pixel.
gates:
  - npx tsc --noEmit clean; the full vitest; the 128x15 s7 bot identical (residents [ 61124, 93804, 37971 ] = 192,899).
  - Node tests:
    - after the queue drains, the instance buffers equal the synchronous path's, for a scripted add/changed/remove
      sequence including id reuse and remove-before-build;
    - no frame builds for longer than the budget plus one entry;
    - the queue drains, without starving, under a steady event stream.
  - Real GPU (the worker):
    - per-frame BuildingRenderer work before and after, on the dense 256 city at ultra and on a 200-building bulldoze
      and regrow, ≥ 8 reps, p50/p99/max;
    - AC2's frame numbers at ultra on bot256_y60 and dense1m, 5 runs each, before and after;
    - pixel-identical screenshots once the queue drains (paused, fixed camera, LOW and HIGH).
report: docs/dev/reports/local-T040-r2-buildings.md: the queue design, every reader of inst/list, the timing tables,
  the screenshot pairs. Push local/T040-r2-buildings with docs/dev/queue/T040-r2-building-budget.done.
