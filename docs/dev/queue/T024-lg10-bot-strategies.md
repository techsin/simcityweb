# T024-lg10-bot-strategies: polish LG-10 round 1, bot strategies for the long-game systems (a Codex lane)
base: 8182828 (the dev branch HEAD, with W0.1; record it); branch local/LG-10-bot
after: none. It takes FH-04's freed lane; priority below T020 W0.x, T023 and T021, above T008 and T010.
owns: tools/simbot.ts, tests next to tests/sim/botVenues.test.ts (new files), and new rows under a new "polish" key in
  tests/sim/fixtures/balance-baseline.json. Leave the phase0, preSpec and partB rows and B1's b1 key untouched. No src/
  file: the headless bot path does not change.
do:
  Read docs/POLISH_PLAN.md LG-10 (around line 1281), its gate table §5.4 (around line 3234: acceptance r3's GATE
  SUMMARY, G-POP ... G-DET), and NEW-05's note that LG-10 adds --tax=N.
  Round 1 is the framework plus the rules whose content already exists. Each flag is off by default, so today's rows
  reproduce exactly:
  - --subway: from 150k residents, a line from the core to the 3 densest residential districts, with a station every
    8 tiles;
  - --late-ordinances: enact the ordinances the bot never uses today (it enacts at most 8 of 22) once they are
    affordable and useful;
  - --expand: the bot's expansion rule from the plan;
  - --tax=N: fixed tax rates (for NEW-05's sweep);
  - a zoo and a train station once the city can afford them. No bot city has built a zoo in 60 years, which hid the
    zoo's tourism-jobs ratio of 1.41 (LD15b). Put them behind --venues or the closest flag the plan names.
  Flags for content that does not exist yet (--megaprojects, --arcology if there is no arcology def, --charter=X)
  land with their items (LG-03, LG-17 and so on). Stub them in --help as "lands with LG-xx" only if that helps.
  --skip and --neglect keep working, and --help is shared with FH-10.
  Report, do not tune: if a rule exposes a balance problem, record it for the item that owns that content.
gates:
  - Flags off: bit-identical yearly state hashes by the two-process method on 256x60 s7 and s11 and 128x15 s7 (G-DET);
    194,432 stays.
  - Flags on (each rule, then all together, on 256x60 s7): the GATE SUMMARY table (G-POP, G-APPR, G-FUNDS, G-EQ,
    G-UNEMP, G-EMG, G-JAIL, G-AB, G-TOUR, G-MS; G-STEP as recorded today, since B2 changes the steps later), with every
    miss named and attributed.
  - The plan's targets, reported: bank months in 2045, unemployment in 2060, skip-transit at 2040, skip-dirty at
    year 15, neglect at year 60.
  - Tests of each rule on a small city; npx tsc --noEmit clean; npx vitest run passes.
report: docs/dev/reports/local-LG-10-bot.md (the rules as built, the gate tables per flag, the targets). Push
  local/LG-10-bot with docs/dev/queue/T024-lg10-bot-strategies.done; DONE. These are long bot runs: keep them off
  your quiet timing slots.
