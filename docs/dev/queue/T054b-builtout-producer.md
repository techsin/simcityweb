# T054b-builtout-producer: LG-21's built-out grade reads a real producer: publish `full` from LG-05's block (NOTE-076 item 2)
base: dev 7348e09 or later (T054 and T037b are in dev); branch local/T054b-builtout-producer
owns: src/sim/economy/advisors.ts (only the LG-05 block's publication of `full`, and the AdvisorData type); new tests.
  T054's reader in src/sim/economy/history.ts stays as it is unless a test shows it wrong.
do:
  1. Read docs/dev/reports/local-T054-lg21-year-review.md, section 3 "Land-full reader, producer pending T037b", and
     T037b's report for the LG-05 block. Publish the block's existing local `full = scan.free < BUILT_OUT_FREE *
     st.cells` as a typed optional `AdvisorData.full`, assigned in the same LG-05 block, **in its own hunk** (I commit
     it as its own commit). Optional in systemData: old saves without it load, and T057's save/load continuity must
     hold (a loaded city continues bit-exact: check whether advisors' record is one of T057's continuity records and
     treat `full` accordingly; say what you found).
  2. The bot stays at 192,899 on 128x15 s7, with the exact and determinism digests unchanged: `full` is published
     state only, it must feed nothing in the sim except T054's history reader (history.builtOut), which already
     exists. Prove it with the two-process digest probe the T054 report describes (its scratch review2-digests.mts
     pattern) or the repo's exact tests.
  3. Add an end-to-end land-full test: a city that fills its land publishes `full: true`, history.builtOut records it,
     and the year review's built-out grade uses it; `full: true` with weak demand and `full: false` with `builtOut:
     true` stay distinct, as T054's stub test has them.
  4. T054's 256x60 grade check (C or better every year from 2010): write the exact command for me (the T054 report's
     grade-run.ts pattern, through quietrun); do NOT run the 256x60 bot yourself unless it finishes within your
     session comfortably (it takes many minutes; one process). If you run it, report the per-year grades.
gates:
  - tsc; your tests, tests/game/yearReview*.test.ts, the advisors tests and tests/save/loadContinuity.test.ts through
    quietrun; the bot identical (192,899).
  - I run the full vitest and the bot; no browser work is expected beyond a look at the year review's grade row.
report: docs/dev/reports/local-T054b-builtout-producer.md.
