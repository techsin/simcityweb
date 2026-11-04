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

## Integration with dev (B3 and later)

`cloud/b2m` merges dev (`origin/claude/beautiful-johnson-u2jqoz`) into `b2-step-split` (`1abb357`) twice: merge
`d388fa6` (dev `63c8f58`), then `604fc75` (simwasmFlag) and `4608258` (the flag events, the hygiene rename), then merge
`539b692` (dev `086152a`: T034 with T034b, which landed during the gates). Dev had gained, since B2's base `41ae570`: B3 (`530d570`), T038, T036 steps 2–3, T052, W0–W1.1b (the worker seam, the replica, the recorder, the
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
4. **The gates** (item 7) on the final merge `539b692` against dev `086152a` (below), the gate 4 amendment as a plan
   amendment (item 4), the S5 follow-up in `docs/dev/POLISH_BACKLOG.md` (item 5), the `grownCity` tolerance recorded as
   accepted (item 6).
5. No new optimisation work: the only code change beyond the merge is `4608258` (events with their flags, a rename).
