# T076-crowds: polish round 4, WORLD, FEEL-25
base: dev 1c2019c; branch local/T076-crowds
owns: src/render/city/Pedestrians.ts; a small hunk in src/render/city/CityObjectsView.ts; new tests.
do:
  docs/POLISH_PLAN.md FEEL-25 (find its section by the identifier). Mind the frame cost at 1M residents and on LOW;
  pedestrians stay purely visual (no sim reads outside the mirrored state and views, no sim RNG).
report: docs/dev/reports/local-T076-crowds.md.
gates:
  - Every Acceptance line of each item (docs/POLISH_PLAN.md), with unit tests where it can be tested that way.
  - tsc; your new tests and the existing tests of every file you touch (through quietrun); the 128x15 s7 bot
    identical (192,899) unless an item changes the sim by design (then say so and give the numbers).
  - I run the full vitest, the bot and the real-GPU browser checks myself; end with the browser checklist.
notes:
  - The plan's file:line references are against e116226; find each hunk by the identifier it names.
  - Do the items in the order listed, each complete (code, tests, report section) before the next. If an item needs a
    file another lane holds (see the rules), do what you can without it and write the exact request.
