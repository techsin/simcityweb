# local-B2-step-split: the InfraScheduler steps in pieces of at most 3 ms (B2)

Branch `b2-step-split` (local only), base **`41ae570`** (the dev branch + the exact J-fixes + LG-01 + the guide copy +
B1). The design, the review items and each group's as-built notes are in `docs/dev/B2_DESIGN.md`: G1 traffic §15, G2
services and NIMBY §16, G3 crime and pollution §17, G4 utilities, the emergency response and the recalibration §18. This
report collects the results; every number below is from those sections unless it says otherwise. The final code is
**`2d2940a`** (`2db4097` records its bot rows).

Machine: the cloud container (Linux, node 22, 4 cores shared with other workflows), headless, wall clock
(`performance.now`). The timing lock (`scratchpad/timing.lock`) was taken for every timing run listed as "locked".

## What changed

- Every InfraScheduler task runs its pass as a sequence of pieces. Each piece is sized for cold code (about 0.13 ms at
  `INFRA_PIECE_COLD_MS`, or a fraction of it, with Building and cell floors; the rarely-run code such as a full relabel
  or the sea mask's rebuild for its interpreted speed), and its `cost()` estimates that piece, not the whole state. A
  pass taken in one go and the same pass in any sequence of pieces give the same results, field by field. The proof is
  the frozen originals plus the passdigest (below).
- Snapshots: one `BuildingSnapshot` per pass with a chunk plan; the other code of the city between pieces reads only
  published state (R8). Saved data changes in one piece (R7 / R9: private buffers published by `.set()` or a swap; no
  saved cursors). A save in the middle of a pass holds no pass state, as before.
- The scheduler: the step guard 256 → 4096; the day budget, carry and credit floor **4.6 / 0.87 / 5.75** estimated ms
  (pre-B2 3.2 / 0.6 / 4; G1's provisional 5.3 / 1.0 / 6.5; §18.5).
- The sea mask (`terrainMasks.SeaMaskRun`) runs in pieces inside the utilities pass: its rebuild after a water edit was
  one 12 ms call.
- No UI, render or save-format change.

## Results at a glance (G4's part; G1–G3's gates are in §15.4, §16.4 and §17.4)

| Gate | Result |
|---|---|
| Exactness: one go = pieces = the frozen original | `tests/infra/b2PiecesInfra.test.ts` (21 tests: every utilities and response branch, R7, R8, R9, O4, two cities interleaved, the estimates within budget); `tests/infra/seaMaskRun.test.ts` (11 tests); `tests/sim/exact/j10.test.ts` (10,240 city-days with edits, 32 edge cities) |
| Exactness: `passdigest --mode atomic`, B vs W | dense1m, bot256 and five synthetic utilities / emergency cities, each with and without WP1, at days 30 and 100: **24 of 24 checkpoints identical**, at `dc6b826`, `0f51b6d`, `d8fd0b9`, `180f8a6` and the final `2d2940a` |
| Latency, utilities (dense1m, locked hold 6 at `2d2940a`, 3 runs per side from load) | p99 **12.16 / 10.24 / 12.62 → 0.26 / 0.24 / 0.07 ms** (days 0–20 / 20–80 / 80–220, median over runs); max **12.16 / 10.24 / 12.62 → 2.03 / 4.13 / 1.41 ms** (worst run 10.01 / 5.10 / 2.41; the 10.01 is a process stall that hit pollution's pieces too, the 5.10 the Building-shape deopt wave on day 22, §18.4) |
| Latency, emergency response (same hold) | p99 **8.36 / 9.24 → 0.52 / 0.15 ms** (days 20–80 / 80–220; no sequence in days 0–20); max **8.36 / 9.24 → 2.68 / 0.18 ms** (the 2.68 has a GC pause inside; 0.94 without) |
| Latency, edit and disaster scenario (2 runs per side) | utilities max 13.80 → 1.79 ms (worst 2.26); emergency 10.95 → 3.76 (worst 5.71, one first rows piece); the meteor's sea-mask rebuild 12.2 ms in one piece → 195 pieces of ≤ 0.38 ms |
| Latency, all tasks (same hold) | W's p99 **1.00 / 0.54 / 0.25 ms** (B 47.1 / 27.8 / 16.5); the all-task max without GC per run 3.4–10.0 / 4.1–5.1 / 1.6–2.7 ms; other groups' pieces above 5 ms are listed in §18.7 |
| Cost error, warm (final code, hold 6) | pooled over every task: dense1m **+0.14**, bot256 **−0.06**. Per task within ±30 % but utilities on dense1m (+0.42; its building chunks run at 3–10 µs warm). A refit that centred it moved the bot below the population gate, so it was reverted (§18.2). From load: pooled −0.18 / +0.01 / +0.11 (B −0.75 / −0.35 / −0.21) |
| Cadence (§9.4, §18.5) | at 4.6 every task runs at B's cadence or above per 360 days but dense1m's traffic (10 cycles instead of 13); real infra ms per day 1.26 × B warm on dense1m, 1.44 × on bot256, 1.07 × from load |
| Balance, 256 × 60 seed 7 (`2d2940a`) | **pass**: pop 184,844 at year 15, 1,552,965 at year 60, lowest ratio to B1 1.001; approval ≥ 79.7 from year 30; EQ 121.6 at year 30; funds ≥ 9,185; tourism judged as B1 did (geometric mean of six 128 × 15 seeds at year 15: 1.062); `totalMsPerDay` **+1.42** (≤ +3; under the timing lock) |
| Balance, seed 11 and 128 × 15 seed 7 | seed 11: lowest ratio 0.955, approval 79.2, EQ 121.8, funds ≥ 7,775, `totalMsPerDay` +1.66; 128 × 15: 191,840 at 2015, lowest ratio 0.919 |
| New reference | a `b2` key in `tests/sim/fixtures/balance-baseline.json` for the three runs, `reference = 'b2'`, the older rows untouched. **The 128 × 15 seed-7 2015 population is now 191,840** (B1's 196,101). The bot's results change by design: the headless schedule follows the new estimates, pieces and budget |
| P0-15 | 0.994 at the final budget; re-baselined to ≤ 1.02 |
| `npx tsc --noEmit` / full vitest at `2d2940a` | clean / 139 files passed, 1 skipped (1,429 tests passed, 18 skipped), no unhandled errors |

## Open items for the gates role and the lead

- **Other groups' pieces above 5 ms** (one run each): traffic `final2.11` 34.1 ms, `roundSearch.search` 12.5,
  `roundMatch.flows` 8.8, `transit2.origins` 8.5, `commute.pool*` 5.1–6.6, `roundMatch.sort2` 5.1–6.2, `inbound.0` 5.9;
  services `tiers.alloc` 16.2, `accSeed.bld` 6.8, `tiers.search` 6.4; pollution `garbApply.left.left` 7.1 (§18.7).
- **The Building-shape fix** (review 2 item 2, §14 item 4): G4's remaining over-5-ms piece (`uses.bld` on days 21–23
  after a load, 4.1–5.1 ms in two of three runs) is that deopt wave; the fix is outside B2's files.
- **The full latency gate** (§12: at least 5 runs per side). G4 measured 3 runs per side from load and 2 per side for the
  edit scenario and the warm windows per hold, six holds in all.
- **The balance's seed 11 and 128 × 15 runs** at the final code ran outside the lock (B and W side by side, nice 19);
  their `totalMsPerDay` is indicative. Seed 7's +1.42 is from the locked budget hold.
- **A lower day budget** needs services' pass to get cheaper first: at 4.2 the bot's seed 7 fell to 0.84 × B1; at 3.2
  (the real-time match) services runs 0–1 times in 120 days.

## Tools

In `scratchpad/b2work/G4-utilities-emergency-recalibration/`: `cpumapG4.ts`, `editmapG4.ts`, `passdigestG4.ts`,
`genfxG4.ts`, `balanceG4.ts` (+ `bundle-dir.mjs`), `anG4.py`, `anEditG4.py`, `docG4.py`, `cadG4.py`, `balcmp.py`,
`timedG4.py`, the hold scripts `hold1.sh`–`hold6.sh`, `budget.sh`, `holdbal5.sh`, the unlocked runs `balfree*.sh`,
`bal6.sh`, `pd*.sh`; the runs in `runs/` (`h6` is the final code's hold).
