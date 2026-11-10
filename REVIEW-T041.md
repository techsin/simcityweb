# REVIEW-T041 (cloud lead → desktop worker): PASS

Reviewed origin/local/T041-new05-tax @ e45e20c0 (contains dev e58f8ac) against dev 41ebcfb. This is a single-pass lead
review (wind-down, NOTE-095): src diff read line by line, the gates taken from the DONE.

**Lead's note:** PASS. Merge T041 under NOTE-091's fast path. Since e58f8ac, dev added FEEL-19 (QueryTool, inspector,
src/worker query entries) and soon T065 (src/ui/topbar/approvalSegment.ts), which are path-disjoint from the lane. Then
message "MERGED". **From the merge on, the dev bot reference is 192,236 by design.** The findings below are the cloud's
to act on after the merge. Nothing more is needed in this lane.

## What was checked

- **`taxFactor` (demand.ts):** below `TAX_DEMAND_PIVOT` = 11 it is the legacy line, unchanged. Above it,
  `atPivot − (sens/neutral)·δ/(1 + 0.3δ)`. That is continuous at the pivot with the legacy slope there (d/dδ of
  δ/(1+kδ) is 1 at 0), and it flattens toward `atPivot − 0.37·sens`. So high taxes now slow demand gradually instead of
  hitting the old cliff (sens 0.8 at 20%: legacy 0.05 clamp, now about 0.55). This matches NEW-05's intent and the new
  Budget hint ("Higher taxes gradually slow growth").
- **Growth throughput (growth.ts):** the family ceiling is multiplied by `(Σ allow·min(1, demand/FULL) / Σ allow)^0.1`.
  - The ratio is in (0, 1] whenever `famSum > 0`, because every counted subtype has demand > 0.01, so the response is
    in (0, 1].
  - With the exponent of 0.1, only very weak family demand trims the ceiling (ratio 0.1 → ×0.79). The +1 on each
    `GROWTH_MAX_BASE` offsets it at full demand. No division by zero; deterministic.
- **BudgetPanel:**
  - `taxColor` uses `TAX_GROWTH_WARNING_RATE` (warn 9.5 < r < 14, bad ≥ 14; was bad ≥ 13.5);
  - the hint copy is updated;
  - the FH-16 glossary import is kept, a correct resolution.
- **simbot:** `--tax=N` and `--tax-start-year` change nothing unless given. The reference change comes from the sim
  (`taxFactor` plus throughput), not from the bot's play.
- **Fixture:** dev's arrays plus a `polish` array for 128x15_seed7, recorded with tools/balance-json.ts, as the DONE
  says.

## Findings (cloud's, after the merge)

1. **Stale copy (must fix):** src/sim/economy/advisors.ts:1899 still ends "above 13% demand collapses", which is false
   after this lane. tests/sim/taxHighAdvice.test.ts:29 pins it. advisors.ts is a cloud chain's file, so the cloud
   rewrites the clause to match the new curve and the test, in one small commit right after the merge. No other
   src/ui or src/sim copy promises the 13% cliff (searched).
2. **The warning threshold and its comment are stale on the B2 base.** tuning.ts says "loses 12.8503% at 13→14%",
   which is the old base. As decided in NOTE-097, the cloud's 9-member sweep sets `TAX_GROWTH_WARNING_RATE` and the
   comment.
3. **Balance risk for the sweep: does a maximum tax pay off?** The soft curve keeps demand at about half of neutral
   even at 20%, so the sweep also covers **17% and 20%**, not only 9-15%. The question is whether income at the top
   rates outweighs the growth and approval it costs. If 20% dominates, that is a NEW-05 follow-up.
4. **256x60 polish rows:** the cloud re-records them on dev after the merge, with your two balance-json.ts commands
   and its own inserter, which checks every other array is unchanged. No need to push yours.

## Acceptance (from the DONE)

- Gate on e45e20c0: tsc clean; vitest 314 files / 3,220 tests, 0 failed.
- Bot [ 61580, 93090, 37566 ] = 192,236, −2.97% against 198,115: inside NOTE-050's 3%, by design.
- Real-GPU smoke on both hosts: 0 errors. The lane's full QA was on the pre-B2 base, and the merge changed only the
  fixture and one import line.
- The sweep's non-monotone step (13% → 14%, single seed) is open, and the ensembles judge it (NOTE-097).
