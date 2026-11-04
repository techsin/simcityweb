# T026-fh07a-refunds: polish FH-07a, fresh mistakes are free to fix (a Codex lane)
base: a2578da (dev, with W0.2 and B1 merged; record it); branch local/FH-07a-refunds
after: none. Its three prerequisites are merged: W0.2 (command rows), PB-NOROAD (lotTouchesRoad) and B1 (which also
  edits actions.ts).
owns: src/sim/actions.ts (spend/refund, bulldoze, networks), src/game/demolishRisk.ts (the refund text), and tests.
do:
  Read docs/POLISH_PLAN.md FH-07a (around line 938) in full, including its Risk notes about the worker journal.
  - Anything bulldozed on the same game day it was built refunds 100 %. The day never advances while paused, so a
    whole paused planning session refunds too, the day-0 one included.
  - Plopped buildings under 30 days old refund 50 %. After that, today's rules apply.
  - Building.age already exists. Roads use a per-day set of fresh cells kept in CityActions.
  - The bulldoze tip reads "Refund §25,000 (built today)".
  - Nothing new is saved.
  - Leave a short note in the report for W1.1b: main's preview has no fresh-cell set, so it either mirrors it or marks
    refund predictions provisional. The journal must record the refund that was charged, not the rule (§7.6).
gates:
  - tests/sim/actions.test.ts: a coal plant plopped and bulldozed the same day returns funds to the pre-plop value; on
    day 20 half comes back; on day 31 today's rules apply. Also roads and power lines on a fresh day, and paused
    planning.
  - The default bot's rows stay bit-identical by the two-process method on 256x20 s7, and on 128x15 s7 (196,101). Log
    how often the bot bulldozes a building under 30 days old. If it ever does, its rows move by design: record them
    under the "polish" key and tell me.
  - npx tsc --noEmit clean; npx vitest run passes.
report: docs/dev/reports/local-FH-07a-refunds.md; push local/FH-07a-refunds with docs/dev/queue/T026-fh07a-refunds.done;
  DONE. Priority: with T027 and T028, below the W0 lanes.
