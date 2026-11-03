# local-B2-step-split: the InfraScheduler steps in pieces of at most 3 ms (B2)

Branch `b2-step-split` (local only), base **`41ae570`** (the dev branch + the exact J-fixes + LG-01 + the guide copy +
B1). The design, the review items and each group's as-built notes are in `docs/dev/B2_DESIGN.md`: G1 traffic §15, G2
services and NIMBY §16, G3 crime and pollution §17, G4 utilities, the emergency response and the recalibration §18. This
report collects the results; every number below is from those sections unless it says otherwise.

Machine: the cloud container (Linux, node 22), headless, wall clock (`performance.now`). The timing lock
(`scratchpad/timing.lock`) was taken for every timing run listed as "locked".

## What changed

- Every InfraScheduler task runs its pass as a sequence of pieces. Each piece is sized for about 0.13 ms cold
  (`INFRA_PIECE_COLD_MS`) and its `cost()` estimates that piece, not the whole state. A pass taken in one go and the
  same pass in any sequence of pieces give the same results, field by field. The proof is the frozen originals plus the
  passdigest (below).
- Snapshots: one `BuildingSnapshot` per pass with a chunk plan; the other code of the city between pieces reads only
  published state (R8). Saved data changes in one piece (R7 / R9: private buffers published by `.set()` or a swap; no
  saved cursors).
- The scheduler: the urgent budget, the step guard (256 → 4096, G4), and the day budget, carry and credit floor kept at
  G1's 5.3 / 1.0 / 6.5 (§18.5).
- No UI, render or save-format change.

## Results at a glance (G4's part; G1–G3's gates are in §15.4, §16.4 and §17.4)

| Gate | Result |
|---|---|
| Exactness: one go = pieces = the frozen original | `tests/infra/b2PiecesInfra.test.ts` (21 tests: every utilities and response branch, R7, R8, R9, O4, two cities interleaved, the estimates within budget); `tests/sim/exact/j10.test.ts` (10,240 city-days with edits, 32 edge cities) |
| Exactness: `passdigest --mode atomic`, B vs W | dense1m, bot256 and five synthetic utilities / emergency cities, each with and without WP1, at days 30 and 100: **24 of 24 checkpoints identical**, at `dc6b826` and again at `0f51b6d` |
| Latency, utilities (dense1m, locked, hold 1) | p99 **14.39 / 10.55 / 14.44 → 0.27 / 0.14 / 0.12 ms** (days 0–20 / 20–80 / 80–220, median over 3 runs per side); max **14.39 / 10.55 / 14.44 → 1.05 / 2.11 / 1.54 ms** (worst run 3.97 / 4.34 / 2.23; the 4.34 has a 3.7 ms GC pause inside; the 3.97 and 4.10 were the treatment scan's first pieces, since halved) |
| Latency, emergency response (dense1m, locked, hold 1) | p99 **8.71 / 1.52 → 0.51 / 0.19 ms** (days 20–80 / 80–220; no response sequence falls in days 0–20); max **8.71 / 1.52 → 0.55 / 0.27 ms** (worst run 2.27 / 0.29) |
| Latency, all tasks | W's p99 1.30 / 0.65 / 0.30 ms (B 49.6 / 27.8 / 16.7); the all-task max (median 5.33 / 4.90 / 3.77 ms, worst 8.54) is traffic's G1 pieces: `transit2.origins`, `commute.pool*`, `roundMatch.*` (§18.7) |
| Cost error, warm (final coefficients) | pooled over every task: dense1m **+0.13**, bot256 **−0.02**. Per task within ±30 % but utilities on dense1m (+0.39; its building chunks run at 3–10 µs warm). A refit that centred it moved the bot below the population gate, so it was reverted (§18.2) |
| Cadence (§9.4) | at 5.3 traffic keeps B's cycles (dense1m 5, bot256 7–9 per 120 days) and every other task runs at least as often as in B; real infra ms per day 1.3–1.9 × B's warm, 1.21 × from load (§18.5) |
| Balance, 256 × 60 seed 7 | **pass**: pop 186,016 at year 15, 1,501,465 at year 60, lowest ratio to B1 0.983; approval ≥ 79.8 from year 30; EQ 120.5 at year 30; funds ≥ 9,552; tourism judged as B1 did (geometric mean of six 128 × 15 seeds at year 15: 1.000); `totalMsPerDay` +2.65 (≤ +3) |
| New reference | a `b2` key in `tests/sim/fixtures/balance-baseline.json` for the three runs, `reference = 'b2'`, the older rows untouched. **The 128 × 15 seed-7 2015 population is now 194,404** (B1's 196,101) |
| P0-15 | 0.996 with the new step guard; re-baselined to ≤ 1.02 |
| `npx tsc --noEmit` / full vitest at `be73ef4` | clean / 138 files passed, 1 skipped (1,418 tests passed, 18 skipped), no unhandled errors |

## Open items for the gates role and the lead

- **Traffic's pieces above 5 ms** in days 0–80 (G1's): `transit2.origins` 8.54 ms, `commute.pool0/2` 5.7–6.6,
  `roundMatch.sort2` 6.2, `roundMatch.next` 5.4, `roundMatch.accept` 5.3, one run each. They set the all-task max.
- **The full latency gate** (§12: at least 5 runs per side, the edit and disaster scenario) at the final commit, under
  the lock. G4 measured 3 runs per side on its own tasks; the lock queue was long all afternoon.
- **The balance's `totalMsPerDay`** was measured outside the lock (B and W side by side, nice 19, load 5–7). A locked
  repeat belongs to the gates role.
- **A lower day budget** needs services' pass to get cheaper first: at 3.2 (the real-time match) services runs 0–1 times
  in 120 days.

## Tools

In `scratchpad/b2work/G4-utilities-emergency-recalibration/`: `cpumapG4.ts`, `editmapG4.ts`, `passdigestG4.ts`,
`genfxG4.ts`, `balanceG4.ts` (+ `bundle-dir.mjs`), `anG4.py`, `cadG4.py`, `balcmp.py`, `timedG4.py`, and the hold
scripts `hold1.sh`–`hold3.sh`, `balfree.sh`, `baltour.sh`, `pd.sh`.
