# B3: the month-boundary work spread over the month (WASM_PLAN B3, WORKER_DESIGN §6 S4)

Branch `cloud/b3`, from the desktop-era cloud branch `b3-month-spread` (base `a59f08f`, 15 commits: the design, A0, T1,
T2, P3, the continuity tests, A1, rev 3, the fix round and rev 4). The design, as built, is docs/dev/B3_DESIGN.md. The lead's
decisions on its second gates are in docs/dev/queue/NOTE-044-cloud-carryover.md.

What B3 does, in one table (B3_DESIGN §1, §3.5):

| step | change | behaviour |
|---|---|---|
| A0 | the advisors' month scans in small top-level kernels | bit-identical |
| T1 | tourism's monthly loops in top-level kernels | bit-identical |
| T2 | tourism's venue pass (venues, hotels, totals, records, raster) on day 26, saved as `systemData.tourismPass`; the tick keeps attractiveness and migration | changes the bot, by design |
| P3 | population's employment / demographics samples on odd days (never a tick); the `'demographics'` event on dom 1 | changes the bot, by design |
| A1 | the tick's "Show me" places predicted and looked up on day 29 | bit-identical on the bot |

## Cloud carry-over (Nov 3)

### Gap list (what was required, against what was done when this step started)

Sources: WASM_PLAN row B3, WORKER_DESIGN §6 row S4 (acceptance: the month-day unit ≤ the normal day + 10 ms at 1M; the
balance procedure), B3_DESIGN §7–§10, NOTE-044 (the only NOTE that decides B3; NOTE-014/021/032/035/038 only schedule
it), the desktop workflow's journal (`docs/dev/wip/journals/b3-wf_96cfa1e8-a78.jsonl`) and `docs/dev/wip/b3/README.md`.

| # | required | state at the start | left for this step |
|---|---|---|---|
| 1 | The build: A0, T1, T2, P3, A1, with §7's tests | done on `b3-month-spread` (`616a760` … `b0218df`), all committed; `docs/dev/wip/b3` says nothing was left uncommitted (its `uncommitted.diff` is empty) | verify the code (below) |
| 2 | The fix round of the first gates and verifiers | done: `b5f5d94` (layer event, window reset, −0), `6d6fc5c` / `2339b0c` (advisor scans in id order), `038100b` (EM-1 towns), rev 4 | its adversarial re-verification died at the limit: the chain's review step, not this one |
| 3 | The second gates (gates:2) | started, never returned to the journal; the lead read their outputs and decided them in NOTE-044 (save/load digest pre-existing, timing on L0, L7 to fix) | — |
| 4 | Merge onto dev | not done: the base `a59f08f` is 209 commits behind dev `44f39b1` (B1, W0, W1.1, the J-fixes as merged, T029, FH-04 …) | **do it** |
| 5 | L7: approval's resumed init on dom 26–29 (NOTE-044: B3-caused, fix it in approval.ts if contained) | a 4-line patch and a test patch in scratch (`b3work/implementer-fix/approval/`), not on the branch | **apply, test, each test failing without the fix** |
| 6 | The code check's minors: `venuePass` emitted `layerUpdated` before writing `tourismPass`; `tourismWindow` gave −0 | fixed in `b5f5d94`, with tests 7 and 8 | **confirm the tests fail with the fix reverted** |
| 7 | Gates on the merged tree: tsc, the full vitest, two-process digests, a month-day timing spot check against dev under L0, the bot | none run on any tree with B1 in it | **run them** |
| 8 | The bot changes by design: a new 128×15 seed-7 line, and the change comes from T2 and P3 only | measured on the old base only (195,597 against 194,432) | **re-measure on dev, attribute it** |
| 9 | The balance procedure (S4's acceptance) | passed on the old base (B3_DESIGN rev 4; rows under `b3` in balance-baseline.json) | **re-run on the merged tree against dev** (B1 is in dev now) |
| 10 | The report, the design doc's as-built revision, the done marker | rev 4 committed; no report, no marker | **write them** |

### What this step did

1. **Worktree and merge.** `cloud/b3` from `b3-month-spread` (`a4873d1`), and dev `44f39b1` merged in (`422bdf0`).
   - `a59f08f` is a local premerge of `2ea5369` with the J-fixes, LG-01 and the guide copy. Dev merged the same J-fix
     content (its tourism.ts, advisors.ts and population.ts equal `a59f08f`'s byte for byte), so the expected conflicts in
     population, advisors, tourism, approval and budget did not occur: B3's code merged unchanged.
   - Two conflicts, both kept on both sides:
     - `docs/dev/B3_DESIGN.md` (add/add): the branch's rev 4; dev held the rev 2 copy from the wind-down, which rev 4
       contains.
     - `tests/sim/fixtures/balance-baseline.json`: dev's `b1` rows, `reference` and notes, plus B3's `b3` rows after `b1`
       in each run and its `b3` note.
   - Checked after the merge: every file that only one side changed since `a59f08f` equals that side's version; tsc clean.
   - The saved WIP copy (`docs/dev/wip/b3/0001…0013*.patch` on rev 2) reproduces `b3-month-spread`'s tree exactly, and
     its `uncommitted.diff` is empty: nothing was saved mid-edit.
   - Dev moved while the gates ran (T037d, `5b12abe`: approval.ts labels and details, advisors.ts's taxHigh rule, UI). It is
     merged too (`dea855c`), without conflicts; L7's hunk and B3's advisor code are untouched by it. The gates below were
     re-run on that merge where they could change (round 2).
2. **L7, approval's resumed init** (`1db0c5d`, `src/sim/economy/approval.ts`, 4 lines; NOTE-044 asked for it if contained).
   On a resumed init (a loaded city: day > 0 with saved terms) the tourism term keeps the saved value when it is a finite
   number, else it is computed as before (an old save without the term). The other terms are recomputed from the load's
   survey as before. It is display-only: `approvalTerms` / `approvalRaw` feed only `approvalBreakdown` and the TopBar's
   "heading for" tooltip, and `stats.approval` was already kept on a resumed init. Tests, both in
   `tests/sim/monthSpread.test.ts`, each failing with the fix reverted:
   - new: a static town saved on days 56–59 (dom 26–29) keeps the tick's approval terms and raw value right after each
     load. Without the fix: `save on day 56: approval right after the load: .raw 78.808… / 78.959…`;
   - the continuity case (saves on days 31–60, with removals) also compares them right after each load (the desktop's
     `approval-resumed-tourism-test.patch`). Without the fix it fails on day 31, the base's removal case.
3. **The code check's minors** were already fixed in `b5f5d94`: `venuePass` emits nothing and every caller emits
   `layerUpdated 'tourism'` as its last statement, with the slice window reset before the pass; `tourismWindow` adds 0.
   With `b5f5d94`'s tourism.ts hunks reverted on the merged tree, three tests fail: test 7 (`day 3: window 0`), test 8
   (`expected 1 to be 2`: the saved pass is last month's) and the slicing test (`expected -0 to be +0`). With the fix, all
   12 pass. The fix round's scan-order test (`tests/sim/advisorsScanOrder.test.ts`) also fails with `6d6fc5c` and
   `2339b0c` reverted (`[17, 8, 9, …]` against `[8, 9, …, 17]`).
4. **The balance rows.** `tests/sim/fixtures/balance-baseline.json`'s `b3` rows are re-recorded from the merged tree
   (the runs below), `reference` becomes `b3`, and the `b3` note says what they are; dev's rows and notes are unchanged
   (checked key by key). The pre-merge rows (on `a59f08f`, without B1) stay in git history (`cf6af9a`).
5. **The design doc's as-built revision** (rev 5, docs/dev/B3_DESIGN.md): the merge, L7 applied (§4, §7 test 15, §10),
   the bot on dev and its attribution, the digests.

### Gates (W = `cloud/b3`, B = dev from a clean export in `co/b3-devbase`)

Round 1: W at `1db0c5d` against dev `44f39b1` (everything below). Round 2, after dev moved: W at `dea855c` against dev
`5b12abe` (T037d), for tsc, the full vitest, the bots, the digests and W's balance rows; the timing and the tourism probes
were not re-run (T037d changes only advice text, a tax-advice threshold, labels and UI, and both rounds' bots and digests
are equal).

Every heavy command ran under the shared timing lock. Scratch:
`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/b3cloud/`
(`logs/`, `runs/`, `bal/`, and round 2's `logs2/`, `runs2/`, `bal2/`; the scripts `gates.sh`, `balance.sh`, `timing2.sh`,
`tjmulti.sh`, `gates2.sh`, `vstats.py`, `bal3.py`).

| gate | result |
|---|---|
| tsc (`npx tsc --noEmit`) | clean after each merge (`422bdf0`, `dea855c`) and at `1db0c5d` |
| **full vitest, round 2** (at `dea855c`, with `SIM_FIXTURES` / `SIM_SNAP` pointing at the main checkout's 1M fixtures, so the grown-fixture replica, querySideEffects and WASM cases run) | **212 files passed, 1 skipped; 2,106 tests passed, 4 skipped, 0 failed** (462 s; `logs2/vitest_full.log`). Dev's own merge gate at `f85d538` also skipped 4 (2,087 passed; cloud-carryover-log.md) |
| full vitest, round 1 (at `1db0c5d`, without the fixture env: the worktree has no `tools/bench/.fixtures`) | 208 files passed, 1 skipped; 2,053 passed, 22 skipped, 0 failed (250 s; `logs/vitest_full.log`) |
| after the `b3` rows were re-recorded (the JSON only) | tsc clean; `tests/sim/botRules.test.ts` 9/9 (it imports the JSON; `balance.test.ts` skips without `BALANCE=1`) |
| B3's own suites, alone | `tests/sim/monthSpread.test.ts` 12/12; `tests/sim/advisorsScanOrder.test.ts` 1/1 (each new or fixed test also run with its fix reverted: it fails, above) |
| bot 128×15 seed 7, dev | 2015: **196,101 [59288, 95301, 41512]** on both dev commits, equal line for line (non-timing) to the dev gate log `gate_bot_t033m.log` |
| bot 128×15 seed 7, W | 2015: **192,899 [61124, 93804, 37971]**, −3,202 (−1.6 %) against dev: changed by design. Rounds 1 and 2 equal line for line (`logs/`, `logs2/bot_W.log`) |
| bot, W without T2 and P3 (`var-noT2P3`: W with T1's tourism.ts `6e1a875` and dev's population.ts) | **identical to dev** line for line, in both rounds: A0, T1, A1, the fix round and L7 change nothing |
| bot, dev with only T2 and P3 (`var-onlyT2P3`: dev with W's tourism.ts and population.ts) | **identical to W** line for line, in both rounds: nothing else adds to the change (A1's cache interaction with B1's services, §3.2 O9, does not show) |
| determinism (monthbench `--digest`, 120 days at design cadence, two processes for W) | dense1m W `f341ae74…18be` = `f341ae74…18be`; bot256 W `b3081164…d504` = `b3081164…d504`. Dev: `a93bb936…3571`, `f561f4e9…58aa`; the no-T2/P3 tree equals dev on both fixtures. Round 2 gives the same eight digests (`runs/`, `runs2/dig_*.json`) |

**Month-day timing spot check, the L0 reading** (NOTE-044: warm months, the median over runs, the worst month,
≤ +10 ms). `b3work/tools/monthbench.ts` bundled against each tree (`b3cloud/build/sim-profile/monthbench-{W,B}.js`),
40 warm-up days and 420 timed days (14 ticks; months 3–14 are the 12 warm months), W and B interleaved, each run alone
under the timing lock; 5 runs per side at design cadence, 3 in frames (speed 3, 60 fps, renderMs 6). The excess is over
the run's median normal day; at design cadence the no-steps unit (the day minus its infra steps), in frames the unit and
the month frame (`vstats.py`, `logs/vstats_c5.txt`; dom 26–29 in `logs/domdays.txt`). Wall clock, in node (no browser),
on a shared box (load average 1.5–5.3 during the runs, `runs/*.load`): read the medians, not single days.

| cell | W worst warm month | B (dev) worst warm month | W / B warm median | W / B months 1, 2 (reported, not gated) | months over +10, W / B (warm) |
|---|---|---|---|---|---|
| design dense1m, no-steps unit | **4.23** (d11190) | 14.04 (d11070) | 2.28 / 3.65 | 20.0, 8.4 / 19.4, 10.2 | 0 / 1 |
| design bot256, no-steps unit | **6.98** (d21810) | 13.79 (d21720) | 1.71 / 3.48 | 10.6, 11.6 / 15.4, 9.5 | 0 / 1 |
| frames dense1m, unit | **5.62** (d11340) | 10.84 (d11040) | 3.33 / 6.50 | 12.6, 7.7 / 17.9, 16.9 | 0 / 1 |
| frames dense1m, month frame | **9.66** (d11070) | 9.64 (d11190) | 3.40 / 6.27 | 11.7, 8.0 / 20.8, 16.3 | 0 / 0 |

**W passes L0 in every cell**, and its warm median tick excess is 38–51 % below dev's. The days that carry the moved work (warm
months, the worst of the median over runs; W, then B):

| cell | dom 26 (the venue pass) | dom 27 | dom 28 (the zone scan, A0) | dom 29 (the scans + A1) |
|---|---|---|---|---|
| design dense1m | 3.25 / 0.51 | −0.56 / 1.38 | **16.22** (d11188) / 13.80 (d11218) | 8.52 / 4.79 |
| design bot256 | 3.44 / 1.59 | 1.00 / 2.44 | **10.30** (d21988) / 8.40 | 2.48 / 4.29 |
| frames dense1m | 3.83 / −0.07 | 1.90 / 0.51 | 5.79 / 6.45 | 2.75 / 6.01 |

Dom 26 and 29 stay well under +10. **Dom 28 does not**, in either tree, at design cadence: it is A0's own gate
(B3_DESIGN §8) and the lead's L3 if missed. It is a JIT lottery, not data: the same city state on the same day costs
0.9–17.8 ms across W's five runs at d11188 (B: 1.4–6.8), and 13.6–25.5 ms across B's at d11218 (W: 1.1–6.6). On the
old base verify-b read dom 28's worst day at 13.9 in W (d11008, a cold month) against B's 21.5. See decision 4.

**The balance procedure** (B3_DESIGN §8, docs/SIM_DEPTH_SPEC.md), `tools/balance-json.ts` on both trees, the three runs
of a side in parallel under one hold of the lock (`bal/`, `logs/bal3.txt`). The dev re-runs reproduce the recorded `b1`
rows **in every non-timing column** (all three runs), so `b1` is the baseline. Round 2 re-ran W's three runs at `dea855c`:
equal to round 1 in every non-timing column (`bal2/`), so the recorded `b3` rows hold on the final tree.

| run | W population (b1) | W / b1 | acceptance |
|---|---|---|---|
| 256×60 seed 7, year 15 | 181,278 (183,671) | 0.987 | ≥ 150k: pass; ≥ 0.9×: pass |
| 256×60 seed 7, year 30 | 550,399 (554,005) | 0.993 | pass |
| 256×60 seed 7, year 60 | 1,513,835 (1,527,090) | 0.991 | ≥ 950k: pass; ≥ 0.9×: pass; every year ≥ 0.978× |
| 256×60 seed 11, year 60 | 1,427,340 (1,504,571) | 0.949 | every year ≥ 0.947× |
| 128×15 seed 7, year 15 | 192,899 (196,101) | 0.984 | every year ≥ 0.936× |

On 256×60 seed 7, also: approval ≥ 79.1 from year 30 (b1 79.5); funds ≥ 6,792 (b1 6,994); EQ ≥ 100 from 2020 (b1
2017), 120.9 at year 30; `totalMsPerDay` W 12.42 against a same-session dev run's 12.61 (seed 11: 11.58 / 12.00;
128×15: 5.78 / 5.77). The recorded `b1` timing (5.67) is the desktop's and is not comparable with this box.

**Tourism jobs within ±30 %** (the probe `b3work/gates2/bench/tjprobe.mts` on 256×60 seed 7, W and B; each reproduces its
side's balance run year by year): W/B is in the band in **41 of 46 years from year 15** (2015 0.71, 2030 0.91, 2060
0.92), out in 2016–2020 (0.36–0.64). In those years it is dev that leaves the venue model's own band: W's tourism jobs
against the legacy formula of the same city stay at 0.82–1.11 from 2015, dev's reach 1.38 (2019) and 1.31 (2020), with
dev's attractiveness 77.5 against W's 66.9 in 2017 (dev's bot bought its venues earlier). From 2005, W/legacy leaves
0.7–1.3 in 2 years (2005, 2008), dev's in 8. Summed over the run W/B is 0.880. See decision 5 and the corroboration
below.

Corroboration (B3_DESIGN §8: seed 11 and 128×15; `logs/tjmulti.txt`):
- 256×60 seed 11: W/B in the band in 43 of 46 years from year 15, out in 2016–2018 the other way (1.43–1.91); 0.91 /
  1.01 / 0.99 at years 15 / 30 / 60; 1.012 summed over the run. W/legacy 0.88–1.20 from 2015, dev's 0.89–1.24.
- 128×15 seeds 3, 5, 7, 9, 11, 13: tourism jobs summed over 15 years, W/B 0.989, 1.022, 0.809, 1.172, 1.271, 1.263
  (geometric mean 1.074; W above B in 4 of 6); 2015 tourists W/B geometric mean 1.015.

So the tourism model is not shifted: single years move by more than ±30 % in both directions with the bot's layout, as
the design expected (§8) and as B1's balance run did (docs/dev/STATUS.md, the B1 entry: single-year tourism misses of
4/55, 1/54 and 3/9 were "bot noise, not bias").

### Browser evidence

None was required: WASM_PLAN B3 and WORKER_DESIGN S4 gate headless numbers (the month-day unit, the balance procedure),
NOTE-044 asks for no browser check, and B3 changes sim files only. The overlays it touches still refresh on their layer
events (`'tourism'` now on day 26, `'demographics'` on dom 1); the full vitest covers the UI suites that read them.

### Decisions (taken on the conservative reading; the lead may amend)

1. **balance-baseline.json.** The merge kept both sides (dev's `b1`, B3's `b3`). Since B1 is in dev now, the `b3` rows
   recorded on the pre-B1 base would no longer describe dev after the merge, so they are re-recorded from the merged tree,
   and `reference` becomes `b3`, as B1 did for `b1` and B2's design does for `b2`. Evidence: the dev re-runs reproduce
   `b1` exactly, so the new rows differ from `b1` by B3 alone. The old rows stay in git history (`cf6af9a`).
2. **L7 is the desktop's contained patch**: only the tourism term is kept on a resumed init. The other terms stay
   recomputed from the load's survey, as in the base (keeping them would need the survey's coverage, which approval does
   not save; B3_DESIGN §10). The town test shows the whole approval breakdown then equals the uninterrupted game's on all
   30 + 4 loads.
3. **The full-game save/load digest** was not re-run: NOTE-044 accepts it as pre-existing (0 of 16 on both fixtures in
   the base too) and makes the continuity problem its own task.
4. **Dom 28 (A0's own gate, L3).** At design cadence the zone-scan day still reaches +16.2 (dense1m) and +10.3 (bot256)
   on the worst warm month in W, against +13.8 and +8.4 in dev, and passes in frames (5.8 / 6.5). It is not new month
   work (the scan has run on day 28 since part B), W and dev trade the worst day by run, and the same state's day varies
   by up to 17 ms between runs. Under B3_DESIGN §10 L3 this is the lead's: "the rest is a banding item (month map P5) for
   W1's latency". It does not block the merge on the L0 reading NOTE-044 accepted.
5. **Tourism jobs ±30 % of dev, as written, misses 5 of 46 years on 256×60 seed 7** (and 3 of 46, the other way, on seed
   11). Read as bot chaos, not a model shift (the corroboration above; B1's precedent). If the lead wants a hard reading,
   the next step is more seeds, not a code change: B3 changes when the venue model runs, not the model.
6. **The month-day timing** is judged on L0 (NOTE-044). The ticks right after a load (months 1–2) are reported, not
   gated: W's first timed tick (the 2nd after the load) is +20.0 at dense1m design (dev +19.4), with the cold budget code
   (L1) in it.
7. **No browser check** (above). docs/dev/STATUS.md is not edited (the lead's; B3_DESIGN §8, gameplay R7).

### Noticed, not changed

- **Approval's tourism detail** (`approvalDetail` in approval.ts, `'tourism'`: "N tourists / day") reads today's
  `econData.tourists`, while the term next to it is what the last tick scored. Since T2 the totals change on day 26, so on
  dom 26–29 the tooltip shows the coming tick's tourists next to the last tick's pride (in the base only after a venue
  removal). Display-only; a fix needs a choice (derive the count from the term, which caps at `tourismMax`, or save the
  tourists the tick scored), so it is left to the lead or the review step rather than widened into approval.ts here.

### Left for the next steps

- **The adversarial re-verification of the fix round** (`b5f5d94`, `6d6fc5c`, `2339b0c`, `038100b`), which died at the
  limit on the desktop: the chain's review step. This step re-ran their tests with each fix reverted (above), nothing more.
- The merge into dev (the merge step) and STATUS.md (the lead).
- For the lead: L1 (budget's cold cell loop), L2 (population's post-load refill), L3 (dom 28 above), L4–L6
  (B3_DESIGN §10).
