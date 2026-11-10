# T073-smog: polish round 4, WORLD, FEEL-16 polluted districts look polluted: local smog haze
base: dev 1c2019c; branch local/T073-smog
owns: src/render/world/PostFX.ts, src/render/world/Sky.ts, src/render/world/WorldView.ts (the haze pass and its
  wiring); new tests. Read the pollution field through the mirrored state or a view, never a sim read.
do:
  docs/POLISH_PLAN.md FEEL-16 · Polluted districts look polluted: local smog haze. Mind the frame cost on LOW and each
  quality tier; the haze data must not cost per-frame CPU proportional to the map (rebuild it when the pollution data
  changes, at most once a game month).
report: docs/dev/reports/local-T073-smog.md.
gates:
  - Every Acceptance line of each item (docs/POLISH_PLAN.md), with unit tests where it can be tested that way.
  - tsc; your new tests and the existing tests of every file you touch (through quietrun); the 128x15 s7 bot
    identical (192,899) unless an item changes the sim by design (then say so and give the numbers).
  - I run the full vitest, the bot and the real-GPU browser checks myself; end with the browser checklist.
notes:
  - The plan's file:line references are against e116226; find each hunk by the identifier it names.
  - Do the items in the order listed, each complete (code, tests, report section) before the next. If an item needs a
    file another lane holds (see the rules), do what you can without it and write the exact request.
