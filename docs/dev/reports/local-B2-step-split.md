# local-B2-step-split: the InfraScheduler steps in pieces (B2)

Branch `b2-step-split` (local only), base **`41ae570`** (the dev branch + the exact J-fixes + LG-01 + the guide copy +
B1). The design, the review items and each group's as-built notes are in `docs/dev/B2_DESIGN.md`: G1 traffic §15, G2
services and NIMBY §16, G3 crime and pollution §17, G4 utilities, the emergency response and the recalibration §18. This
report collects the results; every number below is from those sections unless it says otherwise. G4's final code was
**`2d2940a`** (`2db4097` records its bot rows); the fix round after the gates role and the two verify reviews (§19, the
section below) is the final code now: **`2c4f75b`** (`00ae9e5` records its bot rows).

**Done line (lane b2m, cloud carry-over, Nov 10; status partial):** `cloud/b2m` = `b2-step-split` (final code `2c4f75b`)
with dev merged in four times, last `51ec328` (`99d19e9`), every conflict resolved with both sides kept (B3's month spread
and B2's pieces and estimates). On `99d19e9`: tsc clean; full vitest 2,501 passed, 0 failed; bot `residents [ 61828,
95515, 40772 ]` = 198,115 in 2015 (by design; dev 192,899); exactness 4 of 4 checkpoints identical and determinism
identical; save / load against dev 93 of 95 cuts equal (the other 2 differ only in T057's `lvRun` record and are equal
20 days later); balance 256 × 60 seed 7 passes (`b2b3` rows recorded). Gate 4 under the lead's amendment (recorded below
as a plan amendment): p99, the first cold runs and the warm cost model pass; on the one busy-box hold the from-load max
was not confirmed (5.94 / 6.38 / 2.96 ms), so the quiet-machine re-measure is Desktop QA item 1. The S5 follow-up is in
POLISH_BACKLOG. Details: "Cloud carry-over (Nov 3)" and its "Resume (Nov 9–10)".

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

## Integration with dev (B3 and later)

`cloud/b2m` merges dev (`origin/claude/beautiful-johnson-u2jqoz`) into `b2-step-split` (`1abb357`) four times: merge
`d388fa6` (dev `63c8f58`), then `604fc75` (simwasmFlag) and `4608258` (the flag events, the hygiene rename), then merge
`539b692` (dev `086152a`: T034 with T034b, which landed during the gates), then, on the resume after the usage-limit stop,
merge `3d9b29d` (dev `87c7c9c`: T040, T053, NOTE-059 and the Nov 4 handoff; no conflict, and no `src/sim/infra` change:
dev's only `src/sim` change is T053's `advisors.ts` / `rewards.ts`) and `633b917` (item 5 below), then merge `99d19e9`
(dev `51ec328`: T058, T057's economy save / load continuity, T060 FEEL-01, NOTE-060 to NOTE-064; no conflict: in
`tests/sim/exact/j10.test.ts` git kept B2's lines and T057's, which drops the `popRun` record from both arms' saves; T057
changed no file in `src/sim/infra` or the scheduler). Dev had gained, since B2's base `41ae570`: B3 (`530d570`), T038, T036 steps 2–3, T052, W0–W1.1b (the worker seam, the replica, the recorder, the
loopback host), B1's final live cap and others. After the merge, the diff against dev is B2's own files only:
18 files in `src/sim/infra`, B2's tests and these documents (no `src/ui`, `src/game`, `src/render`, `src/save` or
`src/worker` change; NOTE-048's NewYear.ts / TopBar.ts lines were the premerge stack's, not B2's).

**B3 and the scheduler.** B3 changed no file in `src/sim/infra` (its month spread is `src/sim/economy/**`: tourism's
venue pass on day 26, population's samples on odd days, the advisors' day-29 places, approval's resumed init), and B2
changed no economy file, so there is no shared scheduling logic to reconcile: B3's month-spread semantics stand as
merged, and B2's piece boundaries, estimates, budget 4.6 / carry 0.87 / credit floor 5.75 and urgent caps stand as
built. Headless, the InfraScheduler spends estimated ms, so B3's lighter month days do not move the infra schedule; the
two only meet in the bot's outcome (below).

**T034 / T034b (`scheduler.run()` as a generator, W1.2), the second merge.** One conflict, at `flush()`: T034b's W1.2
members (`hostDriven`, `beginFrame` / `stepOnce` / `endFrame` over the `steps()` generator) and B2's `flush()`, which
returns whether every task went idle. Git merged the rest of `run()` / `steps()` itself, and both survive: the
generator's `yield` after every step (its real-time budget skips the host's pauses) around B2's loops, the urgent loop's
shared cap (`INFRA_URGENT_BUDGET` estimated ms headless, `INFRA_URGENT_FRAME_MS` live, against the same `t0`) and
`STEP_GUARD` in both loops. Headless, `steps()` is drained in one go: the headless digests (cityDigest 120 days) of
`539b692` equal those of `4608258` on both fixtures (`b2m/runs/pd_4608258`, `b2m/runs/pd`).

**Conflicts, and how each was resolved** (both sides' behaviour kept):

| file | dev's change | B2's change | resolution |
|---|---|---|---|
| `src/sim/infra/traffic.ts` | J2: the radix sort's native cutoff 64 → 1024 keys (exact either way) | the sort in pieces (`sortPiece`) | B2's pieces with dev's cutoff in `sortPiece` stage 0 and in its estimate (`sortPieceUs` case 0: 0.05 µs per key, ≤ 51 µs); both doc comments |
| `src/sim/infra/crime.ts`, `pollution.ts` | W0.1: the blur imports point at the wasm drop-in (`src/wasm/kernels/blur`, JS by default) | the split passes blur in row pieces (`BoxVRun`, `boxHRows`, `Blur3Run`, `downsampleRows`, `upsampleAddRows` from `blur.ts`) | the piece kernels from `blur.ts` (the drop-in covers whole-call kernels only); pollution's remaining whole-call kernels (`boxAverage` for the tree-cover refresh, `blurSigma2`) through the drop-in; crime's split pass calls no whole-call kernel, so its `blur3` import is gone. `parking.ts` auto-merged (the drop-in's `boxH` / `boxV` in `parkingBox`, which traffic's pieces no longer call) |
| `src/sim/infra/services.ts` | B1's final live cap (`SERVICES_MIN_CYCLE_MS` = 2 s, dirty passes only) | the header's pieces paragraph | the header carries both; the code (dev's `due()`) auto-merged |
| `tests/infra/emergencyBot.test.ts` EM-1 | B3: towns in a fixed order until 2 prompts in all, every town checked (seeds 3, 7, 11, 13; 6 years) | seeds 2, 4, 5, 6, 1, 3, 8, the first town with ≥ 2 prompts (5 years) | dev's form, with B2's seeds appended as fallbacks (3, 7, 11, 13, 2, 4, 5, 6, 1, 8) |
| `tests/sim/fixtures/balance-baseline.json` | the `b3` rows, reference `b3` | the `b2` rows (on B1), reference `b2` | both row sets kept; the notes b3, b2, then the rest; the merged tree's rows `b2b3` and the reference (below) |
| `docs/dev/B2_DESIGN.md` (add / add) | B2's first design commit (`a7919d0`, saved at the wind-down) | the design through §19 | B2's current text |

**Needed for dev's tests on the merged tree** (no conflict markers):

1. **Flags and their events in one piece** (`4608258`). Dev's worker replica (W1.1a/b) ships building records on
   `buildingChanged` and audits the exact fields (`flags` among them) at every packet; a packet can close between any two
   scheduler steps. B2 flipped the flags in a publish piece and emitted the events in later pieces (R7's "events may be
   spread over consecutive pieces"), so `replica.test`, `replicaLive.test` (speeds 1 and 3) and `lag.test` failed on
   the 128² stress city (a `Crime` flag set and a `Congested` flag cleared without their records). Each publish piece
   now emits its events right after the flips, in the same order (crime's flags, pollution's garbage and air / noise
   flags, utilities' Powered / Watered, traffic final2's NoJobs / Congested); the old event pieces are gone or are the
   state's tail (layerUpdated, news). Whole passes are unchanged (in an uninterrupted pass nothing ran between). The
   publish estimates add one event per candidate. The bursts are small: at most 316 events in one sequence on dense1m (220
   days from a load: 187; the edit scenario: 316) and 467 on bot256 (220 days from a load), about 1 µs per event
   (`scratchpad/b2m/runs/ev`, unlocked counts). **R7 is amended** for
   flags: events no longer spread over later pieces. New test `tests/infra/b2FlagEvents.test.ts` (every step of every
   task, production and small pieces, three cities whose passes flip every task's flags); reverting any one task's
   change fails it (crime, pollution, utilities, traffic: `b2m/fixbak/neg_*.log`).
2. **Isolate hygiene.** `catchments.ts`'s private `grow()` (the edge lists) is `growEdges()`: dev's
   `tests/worker/hygiene.test.ts` reads any `.grow()` call as a wasm memory growth.
3. **Frozen originals = dev's pre-B2 files.** `tests/sim/exact/servicesOriginal.ts` takes B1's final live cap
   (`3709217`; live mode only); `crimeOriginal.ts` and `pollutionOriginal.ts` import the blur drop-in as dev's pre-B2
   files do, so `blurSim.test`'s mock of the drop-in reaches them again.
4. **`tests/worker/simwasmFlag.test.ts`.** Its marker was crime's whole-call `blur3`, which the split pass no longer
   calls. The runs now report a tree edit every day, and the marker is pollution's tree-cover `boxAverage` through the
   drop-in (JS without a flag, never the JS original with the wasm blur selected). The counting mock wraps plain
   functions only (B2's piece classes stay constructible). It fails with `boxAverage` imported from `blur.ts`
   directly (both wasm cases) and without the tree edits (both JS cases).
5. **B2's utilities piece tests after item 1** (`633b917`; the full vitest at `539b692` failed these two). Item 1 moved
   utilities' events into the flags' publish piece (`apply`), so (a) the branch-coverage test's flip marker, which looked
   for a non-empty `changed` list at the old `.events` piece, now looks at the state's last piece (`.end`), where the
   list stays filled; (b) the production-size estimate check (every piece ≤ 0.75 × `INFRA_PIECE_COLD_MS` = 0.0975 ms)
   caps the publish piece like the snapshot take (1 ms): with its events it estimated 0.142 ms on the 128² utilities
   city. R7 already exempts the flags' publish from the piece budget (one piece by rule, chunked only past 3 ms cold);
   the bursts measured in item 1 (≤ 467 events at about 1 µs) stay far below that. No code change.

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

### What was done

1. **The merge** (items 2, 8): dev into `b2-step-split` twice (`d388fa6`, `539b692`), every conflict resolved with both
   sides' behaviour kept (the section above, one row per conflict); tsc clean after each.
2. **Dev's tests on the merged tree** (item 7): the first full vitest found five failures, all from dev's worker
   suites (W1.1a/b, W1.2's hygiene) that B2's base never had: four replica / lag tests (a flag without its
   `buildingChanged` at a packet boundary) and the isolate-hygiene scan (`catchments.ts`'s `.grow()`). Fixed in
   `4608258` (above), with `tests/infra/b2FlagEvents.test.ts` as the regression test for every task. The frozen
   originals and `simwasmFlag.test` follow dev's pre-B2 files and W0.1's drop-in (`d388fa6`, `604fc75`).
3. **The fixture-gated suites**, which the default vitest skips (no `SIM_FIXTURES` in a worktree) but which are dev's
   real-scale checks of what B2 changes: the replica, live replica, lag and query-side-effect cases on the grown bot256
   fixture, `replicaSafe`, and the wasm traffic / transit-search / services-engine fixture sections.
4. **The gates** (item 7) were started on `539b692` against dev `086152a`; the session stopped at the shared usage
   limit after the full vitest (two failures, item 5 of the integration notes) and before the bot, the balance and the
   timing hold. The resume below finishes them on the final tree, with the gate 4 amendment (item 4), the S5 follow-up
   (item 5) and the `grownCity` tolerance (item 6).
5. No new optimisation work: the only code change beyond the merge is `4608258` (events with their flags, a rename).

### Resume (Nov 9–10)

The Nov 3–4 session stopped at the shared usage limit (the handoff `docs/dev/handoff/2026-11-04/README.md`, b2m's row:
"finish"; the bundle `cloud_b2m.bundle` holds `539b692`, the WIP patch is this report's integration notes, committed as
`f9adf2c`). The container restarted; the worktree `scratchpad/co/b2m` was intact at `f9adf2c` with a clean status, and no
process of this lane was left.

**Gap list at the resume** (required against done; read: the handoff README, NOTE-059, the NOTEs naming B2, this report,
the scratch logs of the Nov 4 run):

| # | required | state at the resume |
|---|---|---|
| R1 | Dev merged in to its current head | dev had moved from `086152a` to `87c7c9c` (T040, T053, NOTE-059, the handoff), and moved again to `51ec328` (T058, T057, T060 FEEL-01) while the resume's first gates queued: **not merged** |
| R2 | The full vitest green on the merged tree | the Nov 4 run at `539b692` (`scratchpad/b2m/vitest3.log`) **failed 2 tests**: `b2PiecesInfra` G4 utilities, the flip-coverage marker and the publish piece's estimate cap (both left behind by `4608258`) |
| R3 | The bot, W against dev; the new reference | **not run** (the chain stopped at the vitest failure) |
| R4 | Exactness (passdigest atomic) and determinism (cityDigest twice) | run at `539b692` against `086152a` (identical); **to re-run** on the final tree |
| R5 | B2's save / load mid-pass checks against dev | only the vitest R9 tests (W against itself); **the comparison with dev not run** on the merged tree |
| R6 | One timing-lock hold: gate 4 from a load, 3 runs per side, under the amended criterion | **not run** |
| R7 | The balance 256 × 60 seed 7 (B2's criteria), the merged tree's rows in the baseline | **not run**; the rows not recorded |
| R8 | The gate 4 amendment as a plan amendment, the S5 follow-up in POLISH_BACKLOG, the `grownCity` tolerance recorded as accepted, the done line, Desktop QA | **not done** |

**What was done:**
1. **R1:** merge `3d9b29d` (dev `87c7c9c`) and merge `99d19e9` (dev `51ec328`), no conflict, tsc clean after each. The
   first full vitest ran green on `633b917` (below); the bot had not started when dev gained T057 (economy and save
   code), so that chain was stopped, dev merged again, and every gate below re-ran on `99d19e9`.
2. **R2:** `633b917` updates the two utilities piece tests to the flags' publish with its events (integration item 5).
   With the test change, `b2PiecesInfra` passes 21 / 21; the old marker and cap fail it (the Nov 4 log). No code change.
3. **R3–R7:** the gates below, on `99d19e9` (the commits after it are docs only).
4. **R8:** the plan amendment and the decisions below; the S5 line in `docs/dev/POLISH_BACKLOG.md`; the done line in the
   header.
5. Tools (scratch, not in the repo): `scratchpad/b2m/build.sh` (the probes bundled against W and a clean export of dev
   in `scratchpad/co/b2m-devbase`), `master2.sh` / `master3.sh` (the heavy gates, one lock hold each), `pd.sh`, `lc.sh` +
   `tools/loadcmp2.ts` / `tools/anlc2.py` (the save / load comparison), `hold.sh` + `tools/anB2m.py` (gate 4),
   `bal.sh` (the balance). The dev export is `51ec328` for every gate on `99d19e9`.

**Plan amendment (the lead's decision on gate 4; for WASM_PLAN B2 / WORKER_DESIGN §6 S3, "maxStepMs p99 ≤ 3 ms (max ≤ 5)
at dense1m", and for the merge body).**
- **max ≤ 5 ms** is met when, from a load on dense1m, the per-run median of the all-task max step is ≤ 5 ms in each
  window (days 0–20, 20–80, 80–220), with the steps that overlap a GC pause (≥ 1 ms) excluded, **and** the first cold
  execution of each piece kind after the load stays ≤ 8 ms.
- **p99 ≤ 3 ms** (per run and window, from a load) and **the warm max ≤ 5 ms** stay strict.
- **The cost-model gate** is the design's warm gate: every task's median error within ±30 % warm, on both fixtures
  (dense1m and bot256). The from-load error is reported, not gated.
- The residual cold first-run cost (the fix round's example: traffic `transit.search` at 5.8 ms on its first run after a
  load) goes to WORKER_DESIGN S5 (the frame budget) as a follow-up line in `docs/dev/POLISH_BACKLOG.md`.
- The fix round's `grownCity` continuation tolerance, 1 % → 1.5 % (dev's own base sits at 0.97 % on its seed), is
  accepted.

**Gates on the merged tree** (W = `cloud/b2m` at `99d19e9`, B = a clean export of dev `51ec328`; the commits after
`99d19e9` are docs and the baseline rows only):

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean at `3d9b29d`, `633b917` and `99d19e9` (sem) |
| full vitest | **`99d19e9`: 249 files passed, 3 skipped; 2,501 tests passed, 30 skipped, 0 failed (246 s; `scratchpad/b2m/vitest5.log`)**. Also `633b917` (dev `87c7c9c`): 243 files / 2,456 tests passed, 0 failed (`vitest4.log`). The Nov 4 run at `539b692` had the two utilities failures fixed in `633b917` (`vitest3.log`) |
| B2's tests after the T057 merge | `j10`, `loadContinuity`, `b2FlagEvents`, `monthSpread`: 4 files / 22 tests passed (sem, before the full run) |
| the bot, 128 × 15 seed 7 (lock) | **W `residents [ 61828, 95515, 40772 ]` = 198,115 in 2015** (pop 198k, EQ 105, approval 82, funds §156k); B (dev) `residents [ 61124, 93804, 37971 ]` = 192,899, dev's reference. **Changes by design:** the headless schedule follows B2's new pieces and estimates on top of B3 (B2 on B1 gave 193,416). `scratchpad/b2m/runs/bot/bot_{W,B}.log` |
| exactness: `passdigest --mode atomic`, W against B, every pass uninterrupted | **dense1m and bot256, days 30 and 100: 4 of 4 checkpoints identical** in every part and layer (dense1m `339f758a…` / `d95b1b8d…`, bot256 `63862cd0…` / `262e27c5…`; `runs/pd4/cmp_*.txt`). Also identical at `633b917` against `87c7c9c` (`runs/pd3`) |
| determinism: `cityDigest --mode headless`, 120 days, twice in W | identical: dense1m `a3e7e01d2bae7a40` (pop 1,151,454), bot256 `3b2954fc0f79e62e` (pop 668,724) (`runs/pd4/cd_*`) |
| B2's save / load mid-pass checks | the vitest R9 cases (every task: a save mid-pass holds no pass state, loads idle, loads the same twice; in the full run). **Against dev** (`lc.sh`, new `tools/loadcmp2.ts`): per task, W saved at 7–9 points inside its first pass after 30 warm days (from step 0 to the last piece), dev at every step boundary of the same pass; each save loaded (init) and run 20 days. On `633b917` / `87c7c9c`: **every W cut of every task equals a dev cut, right after the load and 20 days later, on bot256 and dense1m (95 of 95 cuts)**. On `99d19e9` / `51ec328`: 93 of 95; the two exceptions are the same cut on both fixtures, traffic's last piece (after final2's publish, before the cycle's end): right after the load it differs from dev's step-19 save **only in `systemData.lvRun`** (T057's land value record, new in dev `51ec328`), and **20 days later it equals dev's step-19 save exactly**. Cause and follow-up: decision 4 |
| balance, 256 × 60 seed 7 (lock; B and W side by side; B2's criteria) | **passes**: pop year 15 184,426 (≥ 150k; B 181,278), year 60 1,451,189 (≥ 950k; B 1,513,835); lowest W / B **0.959** (2060; ≥ 0.9); approval ≥ 78.3 from year 30 (≥ 50; B 79.1); EQ 121.9 at year 30, ≥ 100 from 2018 (B 2020); lowest funds 5,957 (≥ 0; B 6,792); tourists W / B per year: geometric mean 1.036, 10 of 55 single years outside ±30 % (2007–09 low, 2015–20 high; the bot's chaos, as at G4: 9 of 55; B1's six-seed check not re-run); `totalMsPerDay` **+1.51** (B 10.29, W 11.80; ≤ +3). B reproduces dev's recorded `b3` rows in all 60 years. `runs/bal/` |
| 128 × 15 seed 7 balance row (same hold) | 2015 = 198,115, as the bot; the `b2b3` rows are recorded in `tests/sim/fixtures/balance-baseline.json` (`0f0ad56`, `reference` = `b2b3`, older rows untouched; `botRules` and `balance` tests pass) |

**Gate 4, one timing-lock hold** (`h2`, 03:25:51–03:28:06 UTC on Nov 10; W `99d19e9`, B dev `51ec328`; dense1m from a
load, 3 runs per side interleaved, plus the warm windows; `scratchpad/b2m/runs/h2`, analysis `tools/anB2m.py`, now
`tools/bench/b2/gate4.py`). **The box was not quiet:** `tgate.py` waited 40 min for a slot with other processes under
1.5 cores and gave up, so the hold ran under `bin/lock.sh` with other agents' work beside it (load 3–5 on 4 cores,
CPU pressure up to 19 %).

| criterion (amended) | W (merged tree) | B (dev) | verdict |
|---|---|---|---|
| from a load: per-run all-task max without GC-overlapping steps, median ≤ 5 ms (days 0–20 / 20–80 / 80–220) | 8.06 / 5.45 / 5.94 → **5.94**; 6.38 / 4.88 / 8.74 → **6.38**; 2.96 / 2.47 / 4.12 → **2.96** | 25.27 / 24.67 / 22.87 | **not met in days 0–20 and 20–80 on this hold** |
| the same without run-queue waits ≥ 0.5 ms (clean) | 3.49 / 6.38 / 1.82 (medians) | 24.13 / 22.06 / 21.71 | — |
| p99 per run and window ≤ 3 ms (strict) | ≤ 0.56 / 0.34 / 0.14 | 33–41 / 22–33 / 14–19 | **pass** |
| the first cold execution of each piece kind after the load ≤ 8 ms (283 kinds) | 5.60 / 4.42 / 3.40 per run (the 5.60: emergency `resp2.slack` with a 5.2 ms GC inside; without GC 4.99 / 4.42 / 3.40) | 40.83 / 33.44 / 34.92 (46 kinds) | **pass** |
| warm max, every step (strict), median ≤ 5 ms | dense1m 1.68 / 2.13 / 2.13 → **2.13**; bot256 5.61 / 5.13 / 1.68 → **5.13** (without GC 2.11) | 18.60; 6.02 | dense1m **pass**; bot256 **over by 0.13 ms** (run 1: a 5.3 ms GC and a 3.7 ms run-queue wait inside services `prep.attach`; run 2: services `prep.bld` on the window's first day) |
| warm p99 ≤ 3 ms | dense1m ≤ 0.11, bot256 ≤ 0.15 | 8.2–13.9; 3.7–4.3 | **pass** |
| cost model: every task's median error within ±30 % warm, both fixtures | dense1m traffic +0.04, services +0.14, pollution −0.08, crime +0.03, utilities −0.01, emergency +0.27; bot256 +0.22, +0.22, −0.16, −0.08, −0.12, +0.06 | dense1m traffic −0.55 | **pass** |
| cost error from a load (reported, not gated) | days 0–20: −0.40 / −0.27 / −0.71 / −0.78 / −0.16 / —; 20–80: −0.28 / −0.08 / −0.19 / −0.48 / −0.08 / −0.02; 80–220: +0.04 / +0.09 / −0.11 / −0.02 / +0.03 / +0.08 (same task order) | days 0–20 traffic −0.85, pollution −0.80 | — |

**Why the max misses here.** W ran 13 steps over 5 ms in its three 220-day runs from a load (B: 325). Ten of them had a run-queue
wait of 2.5–8.1 ms (another process held the core) and / or a GC pause inside. The other three (services `tiers.final`
6.38 ms on day 30, crime `sources.bld` 6.07 ms on day 38, traffic `commute.pool1` 6.38 ms on day 46) had neither, and
schedstat puts their on-CPU time at 0.6–2.4 ms: the thread was off the CPU without being runnable for most of the step
(indicative only: schedstat's on-CPU sum can lag by up to one scheduler tick). The fix round's hold at `2c4f75b` (B2 on
B1), the one that found a quiet slot, met the same criterion: 3.83 / 3.36 / 2.26 ms (warm bot256 max 1.48). B2's pieces
and estimates are unchanged since; dev's later code is outside `src/sim/infra`.

**Decisions** (conservative readings, with the evidence):
1. **Gate 4 is judged under the lead's amendment** (above), recorded here as a plan amendment for WASM_PLAN B2 /
   WORKER_DESIGN S3, and **read conservatively: not confirmed.** On the one hold the brief allows, the max criterion
   missed in days 0–20 (5.94 ms) and 20–80 (6.38 ms), and bot256's strict warm max by 0.13 ms, on a box that never
   went quiet; p99, the first cold runs, dense1m's warm max and the warm cost-model gate pass. The evidence points at
   the machine (10 of the 13 long steps waited for the CPU or held a GC; the quiet fix-round hold met it at
   3.83 / 3.36 / 2.26 ms), but this lane did not take a second hold. The quiet-machine re-measure is Desktop QA item 1
   (with `tools/bench/b2/`), and the lane reports **partial** until it is done. Merge-safe meanwhile: every correctness
   gate is green, and against dev every latency number is 4–8 times lower. The cold first-run residue goes to S5
   (`docs/dev/POLISH_BACKLOG.md`).
2. **The utilities publish piece's test cap** (`633b917`): R7 exempts the flags' publish from the piece budget (one piece
   by rule; chunked only past 3 ms cold), so the test caps it like the snapshot take. No code change. The worst case of
   an unbounded publish is a city-wide flip (a blackout turning every building's Powered bit), which runs in one piece,
   as pre-B2's step did; the measured bursts stay ≤ 467 events (about 0.5 ms). It is in the S5 line.
3. **Dev merged twice on the resume, then left for the merge step.** After the gates on `99d19e9` (dev `51ec328`), dev
   gained T048, T036 steps 5 and 4, R1, T051, T081, T054, T059 and T061 (to `a3634e0`). Their only `src/sim` change is
   T054's year review (`CityState.ts`, `economy/history.ts`; nothing in `src/sim/infra`), and dev's bot stayed at
   192,899 in every one of those merges. A trial merge of `cloud/b2m` with dev `a3634e0` is clean (`POLISH_BACKLOG.md`
   auto-merged), tsc-clean, and passes `b2PiecesInfra`, `b2FlagEvents`, `j10` and `loadContinuity` (4 files, 31 tests;
   the trial commit `8d588c0` is not kept). The merge step can take it without this lane spending another hour in the
   lock queue; its own full vitest and bot then run on the merged tree (expected bot: 198,115, as T054 leaves dev's bot
   unchanged).
4. **The T057 × B2 save at traffic's last piece** (save / load row): T057's land value record `lvRun` keeps a `changed`
   list of plopped buildings whose flags changed since the last band, fed by `buildingChanged`. B2 runs traffic final2's
   publish piece (NoJobs / Congested flags with their events, integration item 1) one piece before the cycle's end, so a
   save in between carries those ids, where dev's step 19 has not emitted them yet. Loaded, it differs from dev's save in
   that record only, and 20 days later the cities are identical. It is not a B2 regression (R9: no B2 field is saved;
   the city itself equals dev's), and T057 left the infrastructure's continuity to a follow-up lane on B2's code
   (T063, queued after B2): T063 should cover this cut. No change here (no new behaviour work in this lane).
5. **The fixture-gated suites** (`SIM_FIXTURES`: the replica, live replica, lag and query-side-effect cases on the grown
   bot256 fixture, `replicaSafe`, the wasm fixture sections) ran green at `539b692` (8 files, 101 tests;
   `scratchpad/b2m/fx_W.log`) and were not re-run: B2's code has not changed since, and dev's later commits touch no
   file in `src/sim/infra`.
6. **The balance is one run of 256 × 60 seed 7** (the brief: a single run suffices for B2's coarse criteria); seed 11
   and B1's six-seed tourism check were not re-run. NOTE-053's ensemble rule is for SIM lanes' balance rows, not for
   B2's coarse criteria. The 10 single years outside ±30 % in tourists are the bot's chaos, as at G4 (9 of 55); their
   geometric mean is 1.036.
7. **The bot reference changes by design** (128 × 15 seed 7: 192,899 → 198,115): the headless schedule follows the new
   pieces and estimates on top of B3. B2 alone on B1 gave 193,416 (B1 196,101); the direction of the change is the
   schedule's chaos, not a balance shift (the 256 × 60 gates above).

**Desktop QA** (NOTE-059): this lane has **no browser check** (sim and tests only; no UI, render or save-format change).
Two quiet-slot timing items (NOTE-059 item 4: quiet-slot timing runs first), after the merge; the cloud's hold ran on a
busy shared box:
1. **Gate 4 from a load, on a quiet machine (required to close B2's gate 4).** No page; Linux or WSL (the probe reads
   `/proc/self/schedstat`). Two checkouts of dev: B = B2's merge commit's first parent, W1 = the merge commit; the
   fixtures from `tools/makeFixtures.mjs` (`tools/bench/.fixtures/fixtures/dense1m_s7.metropolis`,
   `bot256_s7_y60.metropolis`). In each checkout, three runs of each kind, B and W1 interleaved, nothing else running:
   `npx tsx tools/bench/b2/gate4Probe.ts --fixture <dense1m> --warm 0 --days 220 --out <dir>/<side>_c_<i>.json`, the
   same with `--warm 300 --days 120` into `<side>_w_<i>.json`, and with the bot256 fixture and `--warm 300 --days 120`
   into `<side>_q_<i>.json` (side `B` or `W1`). Then `python3 tools/bench/b2/gate4.py <dir>`. Expected (the amended
   gate): W1's per-run max without GC-overlapping steps, median ≤ 5 ms in each window (days 0–20 / 20–80 / 80–220);
   the first cold execution of every piece kind ≤ 8 ms; p99 ≤ 3 ms; warm max (every step) median ≤ 5 ms on both
   fixtures; every task's warm cost error within ±0.30. The cloud's quiet fix-round hold: 3.83 / 3.36 / 2.26 ms.
2. **The lead's profile window (optional).** In both checkouts: `node tools/bench/sim-profile/bundle.mjs profile`, then
   `node node_modules/.cache/sim-profile/profile.js --fixture <dense1m> --mode headless --warm 20 --days 60`, three runs
   each. Expected: `maxStepMsWall` per infra task about 5 ms or less at the merge commit (the cloud's fix round:
   2.8–4.7 ms) against about 31–33 ms at the parent.
