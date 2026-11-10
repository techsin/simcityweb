# T041-new05-tax-response: polish round 2, SIM, NEW-05 taxes that cost growth gradually
base: fb1531f (dev); branch local/T041-new05-tax
after: none. It is the first SIM item of round 2. It moves every base row, so LG-03 and the items that measure money
  record their rows after it.
owns: src/sim/economy/growth.ts (computeAllowance and its helpers); src/sim/economy/tuning.ts (GROWTH_RESPONSE,
  GROWTH_MAX_*, TAX_SENS, TAX_FACTOR_MIN, new constants); src/sim/economy/demand.ts (taxFactor); tools/simbot.ts (--tax
  exists since LG-10: check that it fixes every rate for the whole run, and add a start year if the 256x30 gate needs
  one); new tests under tests/sim/.
do:
  docs/POLISH_PLAN.md NEW-05 (line 1310) in full, veteran #1 and #10 (lines 81, 90) and D14 (line 3668). Part-B
  triage did not take PB-TAXRESPONSE (growth.ts computeAllowance is unchanged), so NEW-05 runs.
  - Realized growth follows tax-adjusted demand below the throughput cap. Scale each family's throughput by its demand
    (the plan's two forms: min(1, demand / 0.5), or smoothstep(0, k, wanted / cap)) instead of only clipping wanted
    growth above the cap. Pick the form that meets the acceptance with the smallest change to the base, and back the
    choice with numbers.
  - If the 13 → 14 % cliff remains, steepen taxFactor in the 9-13 % band.
  - No new RNG draws; deterministic.
  - The base rows move by design (the bot runs 9-11 %). Give the new 128x15 s7 residents and the change, for the
    lead's sign-off (D2).
gates:
  - tsc; the full vitest. In balance.test and the fixture rows, update only what the change moves by design, and list
    each.
  - The tax sweep: 128x15 s7 with taxes fixed at 10, 11, 12, 13 and 14 %. The year-15 population falls monotonically,
    and each one-point step above 10 % costs 3-15 % of the population.
  - 256x30 s7 with 12 % from year 21: the population in 2030 is at least 3 % below base (today −0.3 %).
  - Every gate of tests/sim/balance.test.ts passes on the base runs.
  - Old saves load and continue.
report: docs/dev/reports/local-T041-new05-tax.md: the formula, the sweep table (10-14 %, plus the base bot), the
  256x30 run, the new bot reference. Push local/T041-new05-tax with docs/dev/queue/T041-new05-tax-response.done.
