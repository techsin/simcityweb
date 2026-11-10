# T070-honours: polish rounds 3-4, CONTENT, LG-20 Honours, then FH-26 an approval reward a young town can earn
base: dev 1c2019c; branch local/T070-honours
owns: src/sim/economy/rewards.ts (the honours and the approval reward); src/ui/panels/ListPanels.ts (their list rows);
  src/game/GameSounds.ts (one cue, a new method); src/sim/catalog.ts (new entries only, next to their family);
  new assets under src/assets/ only if an item needs a model; new tests.
do (in order):
  1. docs/POLISH_PLAN.md LG-20 · Honours: quality goals for a city that has finished growing.
  2. docs/POLISH_PLAN.md FH-26 · An approval reward a young town can actually earn.
  LG-02 (late-game landmarks) runs at the same time in lane T071 and also adds to rewards.ts: keep your rewards.ts
  hunks in their own functions and their own block of the rewards table, so the two merge without conflict.
report: docs/dev/reports/local-T070-honours.md (one section per item).
gates:
  - Every Acceptance line of each item (docs/POLISH_PLAN.md), with unit tests where it can be tested that way.
  - tsc; your new tests and the existing tests of every file you touch (through quietrun); the 128x15 s7 bot
    identical (192,899) unless an item changes the sim by design (then say so and give the numbers).
  - I run the full vitest, the bot and the real-GPU browser checks myself; end with the browser checklist.
notes:
  - The plan's file:line references are against e116226; find each hunk by the identifier it names.
  - Do the items in the order listed, each complete (code, tests, report section) before the next. If an item needs a
    file another lane holds (see the rules), do what you can without it and write the exact request.
