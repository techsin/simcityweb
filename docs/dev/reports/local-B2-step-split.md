# local-B2-step-split: the InfraScheduler steps in pieces (B2)

Branch `b2-step-split` (local only), base **`41ae570`** (the dev branch + the exact J-fixes + LG-01 + the guide copy +
B1). The design, the review items and each group's as-built notes are in `docs/dev/B2_DESIGN.md`: G1 traffic §15, G2
services and NIMBY §16, G3 crime and pollution §17, G4 utilities, the emergency response and the recalibration §18. This
report collects the results; every number below is from those sections unless it says otherwise. G4's final code was
**`2d2940a`** (`2db4097` records its bot rows); the fix round after the gates role and the two verify reviews (§19, the
section below) is the final code now: **`2c4f75b`** (`00ae9e5` records its bot rows).

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

## The fix round (§19; after the gates role and the two verify reviews)

The gates role failed gate 4 (max ≤ 5 ms at dense1m, measured from a load); the code review found one major (a
`replaceState` in the middle of the commute pool's car flows carried `cmFlowing` into the new city), the numbers review
the same latency failure, an unsplit cached `inbound.0` and a cost-model gap (warm utilities per task on dense1m).

**What changed** (chunk sizes and estimates only; whole passes are unchanged):
- traffic: `endCycle()` resets `cmFlowing`; the cached inbound / shop / freight pieces by ranges; the cold loops at a
  quarter of `INFRA_PIECE_COLD_MS` (half before) with a sizing floor of 0.01 µs per unit;
- services: the cold and tier budgets halved; the Building sizing floor `INFRA_BLD_SIZING_US` 0.2 → 0.4 (services,
  crime, pollution, utilities); utilities' footprint sizing 20 → 40 ns per cell;
- utilities `cost()`: the per-piece constant 1.5 → 1 µs, the six building-chunk kinds / 1.15;
- the live urgent cap `INFRA_URGENT_FRAME_MS` = `INFRA_FRAME_BUDGET_MS` (was 2 ×);
- tests: R9 `replaceState` at every traffic piece kind; P0-15's cadence check; `grownCity` within 1.5 % (was 1 %: the
  gap is the schedule's chaos, B sits at 0.97 % on its seed).

**At a glance** (one timing-lock hold, B and W interleaved; dense1m headless, wall clock; §19.3 has the tables):

| Gate | Result at the final code |
|---|---|
| p99 ≤ 3 ms from a load (6 runs per side) | **passes**: worst run 0.60 / 0.35 / 0.16 ms (days 0–20 / 20–80 / 80–220; B 48.0 / 38.8 / 20.4). Time-weighted p99 (99 % of the infra time under it): median 4.17 / 3.37 / 1.98 — above 3 in days 0–80 |
| max ≤ 5 ms from a load, median over runs | with every step 4.17 / 4.82 / **6.22 — fails in days 80–220** (GC pauses of 5.4–9.0 ms inside steps in 3 of 6 runs); without GC-overlapping steps **3.83 / 3.36 / 2.26 — passes**; clean (no GC, no run-queue wait) 3.63 / 2.85 / 2.26. B 33.3 / 27.8 / 21.8 |
| max ≤ 5 ms from a load, worst run | 8.48 / 8.56 / 16.25 (run-queue waits of another process; one 16 ms blocked snapshot take with 0.38 ms on the CPU); clean 4.64 / 4.43 / 16.25 |
| The lead's profile setting (`--warm 20 --days 60`, GC included) | W `maxStepMsWall` 3.91 / 4.65 / 2.80 (median 3.91); B 31.2 / 32.7 / 32.7 |
| Warm (`--warm 300 --days 120`) | dense1m max 1.99, p99 0.09; bot256 max 1.48, p99 0.13 |
| Edit and disaster scenario (2 runs per side) | all tasks max 5.45 (worst 5.67, B 26.8 / 28.9): two single pieces over 5 ms in 2 × 74k steps |
| Cost error, warm | pooled +0.08 (dense1m) / −0.08 (bot256); **every task within ±30 % on both fixtures** (utilities +0.14 / −0.13, was +0.30 to +0.49 on dense1m) |
| Cost error, from a load | pooled −0.19 / −0.05 / +0.08 (B −0.80 / −0.44 / −0.26); per task outside ±30 %: crime −0.80 and pollution −0.76 in days 0–20, crime −0.34 in days 20–80; the estimates cover 30 / 48 / 77 % of the real time (B 16 / 32 / 54 %) |
| Balance, 256 × 60 seed 7 | **passes**: pop 177,444 at year 15, 1,509,269 at year 60, lowest ratio to B1 0.925; approval ≥ 78.9 from year 30; EQ 121.0 at year 30; funds ≥ 7,706; tourism (B1's rule, six 128 × 15 seeds at year 15) 0.992; `totalMsPerDay` **+1.89** (B 9.75, W 11.64, side by side under the lock) |
| Balance, seed 11 and 128 × 15 seed 7 | seed 11 lowest ratio 0.957, approval ≥ 77.0, funds ≥ 5,767; 128 × 15: **2015 = 193,416** (B1 196,101, G4 191,840), lowest ratio 0.921; its tourism stays low (0.72 × B at year 15) |
| Cost of the smaller pieces | real infra ms per day 1.36 × B (dense1m) / 1.32 × (bot256) warm; services on bot256 17 passes per 360 days against B's 19; dense1m traffic 10 cycles against 13 |
| Same-hold reference, G4's code | W0 max 3.81 / 3.44 / 3.35 (this hold was quiet); the fix round cut the clean steps over 2 ms per run from 8 / 5 / 2 to 3 / 1 / 0.5 |
| `npx tsc --noEmit` / full vitest at `2c4f75b` | clean / 139 files passed, 1 skipped (1,430 tests passed, 18 skipped) |

**Open for the lead**: whether max ≤ 5 counts GC-overlapping steps (§14 item 2) and stalled steps; which p99 and which
window the plan means (§9.5); the `grownCity` tolerance (±1 % → ±1.5 %); the Building-shape fix (§14 item 4), which would
remove most of the cold tail and let the pieces grow back (§19.5).

## Results at a glance at G4's code (`2d2940a`; superseded by the fix round above; G1–G3's gates are in §15.4, §16.4 and §17.4)

| Gate | Result |
|---|---|
| Exactness: one go = pieces = the frozen original | `tests/infra/b2PiecesInfra.test.ts` (21 tests: every utilities and response branch, R7, R8, R9, O4, two cities interleaved, the estimates within budget); `tests/infra/seaMaskRun.test.ts` (11 tests); `tests/sim/exact/j10.test.ts` (10,240 city-days with edits, 32 edge cities) |
| Exactness: `passdigest --mode atomic`, B vs W | dense1m, bot256 and five synthetic utilities / emergency cities, each with and without WP1, at days 30 and 100: **24 of 24 checkpoints identical**, at `dc6b826`, `0f51b6d`, `d8fd0b9`, `180f8a6` and the final `2d2940a` |
| Latency, utilities (dense1m, locked hold 6 at `2d2940a`, 3 runs per side from load) | p99 **12.16 / 10.24 / 12.62 → 0.26 / 0.24 / 0.07 ms** (days 0–20 / 20–80 / 80–220, median over runs); max **12.16 / 10.24 / 12.62 → 2.03 / 4.13 / 1.41 ms** (worst run 10.01 / 5.10 / 2.41; the 10.01 is a process stall that hit pollution's pieces too, the 5.10 the Building-shape deopt wave on day 22, §18.4) |
| Latency, emergency response (same hold) | p99 **8.36 / 9.24 → 0.52 / 0.15 ms** (days 20–80 / 80–220; no sequence in days 0–20); max **8.36 / 9.24 → 2.68 / 0.18 ms** (the 2.68 has a GC pause inside; 0.94 without) |
| Latency, edit and disaster scenario (2 runs per side) | utilities max 13.80 → 1.79 ms (worst 2.26); emergency 10.95 → 3.76 (worst 5.71, one first rows piece); the meteor's sea-mask rebuild 12.2 ms in one piece → 195 pieces of ≤ 0.38 ms |
| Latency, all tasks (same hold) | W's p99 **1.00 / 0.54 / 0.25 ms** (B 47.1 / 27.8 / 16.5); the all-task max without GC per run 3.4–10.0 / 4.1–5.1 / 1.6–2.7 ms; other groups' pieces above 5 ms are listed in §18.7. **Verdict at G4's code: max ≤ 5 ms fails from a load** (the gates' 6 runs per side, days 20–80: median 5.84 ms, 5.25 without GC-overlapping steps; the verify runs 5.02 / 5.46); it passes warm |
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

## Cloud carry-over (Nov 3)

Lane **b2m** (chain b2m, the lane finisher), branch `cloud/b2m` in `scratchpad/co/b2m`, started from `b2-step-split`
(`1abb357`: final code `2c4f75b`, docs `1abb357`). Dev: `origin/claude/beautiful-johnson-u2jqoz` at `63c8f58`.

### Gap list (required against done, at the start)

Read: WASM_PLAN B2 (the row, its table of the largest steps, §7.9) and WORKER_DESIGN §6 S3 (acceptance: `maxStepMs`
p99 ≤ 3 ms (max ≤ 5) at dense1m, the median cost-model error within ±30 %, the balance procedure, new bot hashes);
`docs/dev/B2_DESIGN.md` §0–§19 (the acceptance protocol §12, the fix round §19); this report; the NOTEs naming B2
(NOTE-014, 021, 032, 035, 038, 044, 045, 046, 047, 048, 050, 053, 054, 057) and NOTE-044; the lead's brief for this
lane (the gate 4 amendment below); the diff of `b2-step-split` against dev.

| # | required | state at the start |
|---|---|---|
| 1 | Every InfraScheduler task in pieces, `cost()` per piece, recalibrated; exact by construction | done on the branch (G1–G4 + the fix round, `2c4f75b`); no uncommitted WIP in the `b2` worktree |
| 2 | Integrate with dev: B3 (`530d570`, the month spread) and the 52 later `src/sim` commits, keeping both sides' behaviour | **not done**: the branch sits on `41ae570` (the premerge stack + B1); dev has W0.1's blur drop-in, J2's radix cutoff, B1's final live cap, W1.1b's `refresh: false` previews, B3 and others |
| 3 | The plan's acceptance on the merged tree, under the lead's gate 4 amendment | measured on B2's base only; gate 4 failed as written (GC pauses, cold first runs); **the merged tree is not measured** |
| 4 | The gate 4 amendment recorded as a plan amendment (this report and the merge body) | **not done** |
| 5 | The residual cold first-run cost as a WORKER_DESIGN S5 (frame budget) follow-up in `docs/dev/POLISH_BACKLOG.md` | **not done** |
| 6 | `grownCity`'s continuation tolerance 1 % → 1.5 % (accepted by the lead) | in the branch (`2c4f75b`); to be recorded as accepted |
| 7 | Gates on the merged tree: tsc; the full vitest; the bot 128 × 15 seed 7 (new reference, by design); exactness (passdigest atomic, W against dev, dense1m and bot256, days 30 and 100); determinism (cityDigest 120 days twice); B2's save / load mid-pass checks; one timing hold (gate 4 from a load, 3 runs per side, W against dev); the balance 256 × 60 seed 7 | **none run** |
| 8 | Report: 'Integration with dev (B3 and later)', this section, the done line in the header | **not done** |
| 9 | Browser checks | none for this lane (sim and tests only; no UI, render or save-format change) |
