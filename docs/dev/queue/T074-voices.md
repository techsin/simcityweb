# T074-voices: polish round 4, CONTENT and WORLD, the city's voice and weather: FEEL-20, FEEL-29, FEEL-23, FEEL-13
base: dev 1c2019c; branch local/T074-voices
owns: src/sim/economy/eventHeadlines.ts; the non-GUIDE hunks of src/sim/economy/advisors.ts (the cloud's T037b holds
  the GUIDE hunks: keep yours in new functions); src/render/city/Sightings.ts; src/render/world/Weather.ts;
  src/audio/ambience.ts; small wiring hunks in src/render/world/WorldView.ts and src/game/CityScene.ts; new tests.
do (in order):
  1. docs/POLISH_PLAN.md FEEL-20 · Headlines that react to what the player just did.
  2. docs/POLISH_PLAN.md FEEL-29 (find its section by the identifier).
  3. docs/POLISH_PLAN.md FEEL-23 (find its section by the identifier).
  4. docs/POLISH_PLAN.md FEEL-13 (find its section by the identifier).
  Headlines and quotes must not draw from the sim RNG stream (the bot and determinism stay identical). FEEL-02a's
  toast budget (src/ui/Notifications.ts) applies to anything that shows a toast. T073 (FEEL-16) also wires into
  WorldView.ts: keep your hunk apart.
report: docs/dev/reports/local-T074-voices.md (one section per item).
gates:
  - Every Acceptance line of each item (docs/POLISH_PLAN.md), with unit tests where it can be tested that way.
  - tsc; your new tests and the existing tests of every file you touch (through quietrun); the 128x15 s7 bot
    identical (192,899) unless an item changes the sim by design (then say so and give the numbers).
  - I run the full vitest, the bot and the real-GPU browser checks myself; end with the browser checklist.
notes:
  - The plan's file:line references are against e116226; find each hunk by the identifier it names.
  - Do the items in the order listed, each complete (code, tests, report section) before the next. If an item needs a
    file another lane holds (see the rules), do what you can without it and write the exact request.
