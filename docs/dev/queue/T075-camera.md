# T075-camera: polish round 4, WORLD, the camera and the show: FEEL-07, FEEL-27, FEEL-24, FH-25
base: dev 1c2019c; branch local/T075-camera
owns: src/game/ShowCamera.ts, src/game/NewYear.ts (only the show hooks the items name), src/game/cameraStart.ts,
  src/ui/PhotoBar.ts and src/ui/fx.css, src/game/bindings.ts, src/game/toolCatalog.ts,
  src/ui/panels/KeyBindingsPanel.ts, src/ui/panels/SettingsPanel.ts (the items' settings rows); small hunks in
  src/game/CityScene.ts and src/render/world/CameraController.ts; new tests.
do (in order):
  1. docs/POLISH_PLAN.md FEEL-07 · Spotlight camera for the city's firsts.
  2. docs/POLISH_PLAN.md FEEL-27 (find its section by the identifier).
  3. docs/POLISH_PLAN.md FEEL-24 (find its section by the identifier).
  4. docs/POLISH_PLAN.md FH-25 (find its section by the identifier).
  T047 (FEEL-09, follow the truck, not in dev yet) also changes CameraController.ts: keep your hunks there minimal and
  in new methods. src/main.ts' App wiring is held by the cloud: if FEEL-27 needs a change there, write the request.
  The camera never moves against the player: respect the settings, Escape and the input cancels the plan names.
report: docs/dev/reports/local-T075-camera.md (one section per item).
gates:
  - Every Acceptance line of each item (docs/POLISH_PLAN.md), with unit tests where it can be tested that way.
  - tsc; your new tests and the existing tests of every file you touch (through quietrun); the 128x15 s7 bot
    identical (192,899) unless an item changes the sim by design (then say so and give the numbers).
  - I run the full vitest, the bot and the real-GPU browser checks myself; end with the browser checklist.
notes:
  - The plan's file:line references are against e116226; find each hunk by the identifier it names.
  - Do the items in the order listed, each complete (code, tests, report section) before the next. If an item needs a
    file another lane holds (see the rules), do what you can without it and write the exact request.
