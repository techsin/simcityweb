# T054 report: LG-21, the year in review (desktop, real GPU)

**Verdict: done.** Every LG-21 acceptance line passes on the real GPU after one review round, on the default host and
on `?simworker=loopback`. One follow-up waits for T037b: once it is in dev, the built-out grade reads the producer's
`AdvisorData.full` (the reader and its stub test are in; see change 3 below). No infra hunk; nothing holds for B2.

Branch `local/T054-lg21-year-review`:
- `4f76944` the lane (round 1); `3ee51c0` dev `683d02b` merged in;
- round 2, one commit per change: `4b5c99c` (1, the Settings switch), `2a44a8f` (2, listMilestones replica-safe,
  identical to T053's line), `0c6ef5d` (3, the land-full reader), `c79a648` (B, Graphs' 1Y window is 13 samples),
  `e2165e0` (A, C, D, E, the card), `9e67c6d` the report.

**Reading of acceptance 2** (round 2, A): the card's figures are captured on 1 January and labelled "Figures on
1 January <year>". Its population change equals Graphs' 1Y figure at that January, not a later live graph after the
show has advanced the calendar.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest with the fixtures (`9e67c6d`) | **227 files passed, 2 skipped; 2,268 tests passed, 11 skipped; 0 failing** |
| 128×15 s7 bot with the action log | **identical to dev:** residents [ 61124, 93804, 37971 ] = 192,899 |

## Real-GPU QA, round 2 (RTX 5070 Ti, driver 610.47, ANGLE D3D11, Chromium 141)

| Item | Result | Measured |
|---|---|---|
| Acceptance 2 under the dated reading | **PASS** | At 1× and 2× full shows, ultra and the default pacing, every card is within 0.17 % of Graphs' 1Y at that January and equals history January to January exactly; all 24 cards carry the date line. After a 1× full show the card appears 2.3-5.4 s after the show phase ends (the clock-return phase), within one frame of `active` clearing. |
| B: Graphs' 1Y is one year | **PASS** | 13 points, Jan to Jan; header delta and hover agree; 5Y, 10Y and All unchanged. The 2029 case now prints the true change (−1.2 %), where round 1 printed −2.1 %. |
| C, D, E | **PASS** | "Emergencies" label, no base/clamp/±0.0 rows. Above Budget and Graphs, close button clickable by a real click. 1.2 px clear of the toolbar at 720p (round 1 overlapped it by 6.8 px). A city without residents shows "Approval —"; no empty Next goals. |
| The Settings switch | **PASS** | In Gameplay, a `role="switch"` button; Tab and Enter work like its neighbours. Off survives a reload and no card shows at New Year; on comes back. |
| Loopback, same state | **PASS** | The 2021 card text is identical on both hosts at the same state, down to grade A 89.4 and the sparkline. |
| Round-1 lines again | **PASS** | Cadence (1× every year, 2× every second, ultra every fifth), never on load, LIVE skips, the 15 s close, a restore during the show, the grade (forced F 37.6; healthy A 89.2) and the founding card. |
| Console and page errors | **PASS** | none in 12 result files. |

Round 1 (on `3ee51c0`) passed 7 of 8 lines; the round-2 changes A-E fixed its findings. QA notes: scratchpad
`qa/T054/qa.md` (rounds 1-2), with data and screenshots in `qa/T054/r2/`.

**Two low notes outside this lane, in `docs/dev/POLISH_BACKLOG.md`:** Space on a focused Settings switch pauses the
game instead of toggling it (every switch; `CityScene.ts:940`), and Graphs' 5Y and 10Y windows are still one month
short (60 and 120 samples).

The lane's own round notes follow.

## Review round 2: the lane's notes

Based on `3ee51c0` (round 1 `4f76944` plus dev `683d02b`). All changes below are uncommitted; no push or `.done` file. NOTE-048 authorizes the Settings, registry and Graphs changes. Each numbered/lettered group below identifies the files/hunks to stage separately.

Suggested staging order: 1, 2, 3, B, A, C, D, E. A's captured-population regression assumes B's corrected annual interval; the dated-header CSS in A is separate from D's stacking/clearance rules.

## 1. Settings toggle

- `src/ui/panels/SettingsPanel.ts`: one Gameplay row, "Year in review", using the existing `this.sw('yearReview')`. Reads the stored key and writes through `ctx.applySettings`, with the same native button/switch activation, blur and city-signal lifetime as adjacent switches.
- New `tests/game/yearReviewSettings.test.ts`: four cases for initial on/off, scoped writes/native switch semantics, and listener cleanup. No schema change.

## 2. Replica-safe registry

- `src/worker/replicaSafe.ts`: **entry only**, `listMilestones`; no other Worker source changes.
- `tests/worker/replicaSafe.test.ts`: import and compare call required by its exhaustive registry assertion.
- New `tests/worker/yearReviewMilestones.test.ts`: real LoopbackSimHost Ready and changed plain-data packets. Compares authoritative/mirrored rank and next goals, and checks neither exact digest nor RNG changes when the helper runs.

## 3. Land-full reader, producer pending T037b

- `src/sim/economy/history.ts`: the isolated monthly review hunk now reads optional `systemData.advisors.full`, storing it in the existing `history.builtOut` series. It does **not** read demand-gated `advisors.builtOut`. Missing `full` keeps growth scoring. No extra scan, balance formula or RNG draw.
- `tests/game/yearReviewHistory.test.ts`: stub contract distinguishes `full: true, builtOut: false` from `full: false, builtOut: true` and a missing `full`. A full/weak-demand city scores unemployment and its stub field survives serialize/load. The real economy test reads `full` when present; today the real producer remains absent, so that test covers the growth path.
- **Deferred as instructed:** after the worker merges T037b into this branch, publish its existing local `full = scan.free < BUILT_OUT_FREE * st.cells` as optional typed `AdvisorData.full`, assigning it in the same LG-05 block. No `advisors.ts` edit this round, and no LG-05 scan was reimplemented. Its demand-gated advice condition stays separate.

## A. Date captured figures and avoid waiting for lingering sparks

- `src/ui/YearReview.ts`, card header: adds **"Figures on 1 January <year>"**. Captured figures remain immutable while the show advances the calendar.
- `src/ui/yearReview.css`, header/date selectors only: makes room for the dated line without adding the old full heading gap as well.
- `src/game/CityScene.ts`, existing CONTENT wiring line: passes public `NewYearCelebration.active` instead of `busy`. `active` covers the celebration and brief clock-return phase; it becomes false without also waiting for the fireworks object's remaining `isRunning` sparks. The exact show phase is private. `NewYear.ts` and `Fireworks.ts` remain untouched.
- `tests/game/yearReview.test.ts`: delayed-show case advances the city five months and changes later population, then asserts the January label and captured population/delta.
- `tests/game/yearReviewRestore.test.ts`: new real-celebration case proves the card appears with `active === false`, `busy === true` and sparks still running. The existing active-show graphics-restore regression now uses the same `active` predicate as production and still verifies recovery plus the next New Year.

**Reading of acceptance 2:** compare the annual population change with Graphs' 1Y figure **at the captured January**, rather than with a later live graph after the simulation has advanced through a show. The date is explicit on the card. The display is released as soon as the exposed celebration phase permits; the calendar keeps advancing normally.

## B. Graphs 1Y means one elapsed year

- `src/ui/panels/GraphsPanel.ts`: 1Y now uses **13 monthly samples / 12 intervals**, with one shared start index for header delta, plotted points and hover. 5Y/10Y/All keep their existing behavior. **No cloud lane touches GraphsPanel**, per the worker's approval; this is a separate small Graphs change.
- `src/ui/YearReview.ts`, population-window hunk: uses the previous January, matching the grade's annual growth interval. A short first-year history uses all available samples, like Graphs.
- `tests/game/yearReviewGraphs.test.ts`: actual Graphs draw/header/hover versus card, normal/capped/short histories and unchanged other ranges. For `population = 1000 + 10t`, graph, card and true annual change all equal **+120**, with hover from Jan 2001 to Jan 2002; they previously printed +110.
- `tests/game/yearReview.test.ts`, population expectations: card and annual grade both use `120 / 1120`. Annual grade formulas are unchanged.

## C. Approval term labels and visible precision

- `src/ui/YearReview.ts`, term-selection hunk: review-specific **"Emergencies"** label; excludes `base` and `clamp` like the tooltip; retains only changes with absolute value at least **0.05 points**, then ranks the largest three. Other labels still come from `APPROVAL_LABELS`. The card ranks yearly changes; the tooltip ranks current term sizes.
- `tests/game/yearReview.test.ts`, term cases: replaces the old limit-term assertion with exclusion of base/clamp, and tests the yearly label plus both signs of the rounding boundary.

## D. Panel stacking and short-screen clearance

- `src/ui/yearReview.css`, root and `.short` rules only: z-index **31**, above the panel layer's 30; short-screen bottom **82px**, up from 72px. Close button stays above Budget/Graphs, with more toolbar clearance. Real-GPU hit testing/layout is left for QA; no CSS-value-only unit test added.

## E. Empty-city and completed-goal copy

- `src/ui/YearReview.ts`, approval/next-goals rendering hunks: no residents shows **"Approval —" / "No residents yet."**; omits the entire Next goals block when no goals remain.
- `tests/game/yearReview.test.ts`: zero-resident card and all-rewards-unlocked fixture checks both cases.

**Ownership:** Settings, Graphs and the registry entry are the explicit NOTE-048 exceptions. `history.ts` is the necessary small reader-support hunk outside the original named source files. CityScene changes only its existing CONTENT wiring line; the round-1 META restore cancellation is unchanged. **Infra hunks: none.** No save/region, main wiring, NewYear, Fireworks, TopBar or advisors GUIDE source was edited.

## Checks this round

Quiet-gated `npx tsc --noEmit`: passed after the final code changes. `git diff --check`: passed. Tests ran one file/process at a time through the quiet gate:

| Test file | Result |
| --- | --- |
| `tests/game/yearReviewSettings.test.ts` | 4 passed |
| `tests/worker/yearReviewMilestones.test.ts` | 1 passed |
| `tests/worker/replicaSafe.test.ts` | 2 passed, 1 existing skip |
| `tests/game/yearReviewHistory.test.ts` | 15 passed |
| `tests/game/yearReview.test.ts` | 22 passed |
| `tests/game/yearReviewGraphs.test.ts` | 4 passed |
| `tests/game/yearReviewRestore.test.ts` | 2 passed |
| `tests/game/yearGrade.test.ts` | 23 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/save/serialize.test.ts` | 13 passed |
| `tests/save/continuity.test.ts` | 2 passed |
| `tests/sim/history.test.ts` | 4 passed |

Total: **109 passed, 2 existing skips, 12 files**. The initial hygiene attempt had five scan timeouts at the default 5 seconds, with no assertion failures; its quiet-gated rerun passed with `--testTimeout 30000`. Two new fake-DOM fixture issues (joined element text and an initial year already marked seen) were corrected and their files reran green.

Commands, substituting each file in the table for the representative test path:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/game/yearReview.test.ts --maxWorkers=1 --pool threads --configLoader native
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/worker/hygiene.test.ts --maxWorkers=1 --pool threads --configLoader native --testTimeout 30000
```

The native-config/thread runner avoids the default runner's previously observed `spawn EPERM`. The full Vitest suite is left to the worker; no browser, bench or GPU timing run was launched here.

## Bot, exactness and determinism gates

Scratch root: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch`.

**128x15 seed 7: passed again**, residents `[61124, 93804, 37971]` = **192899** in 2015, approval 81, 38 unlocks. Log: `bot128x15-s7-review2.log`. Actual quiet-gated command (raw output redirected to that log):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

`tsx` is absent from this offline installation. The scratch native loader only resolves TypeScript imports and ignores UI CSS side effects. Conventional equivalent once `tsx` is installed:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

**Two-process exact/determinism comparison: passed.** The scratch `review2-digests.mts` probe runs a 32-tile seed-7 stress city through full systems for 360 design days, flushing the scheduler after each day. Independent baseline/current processes differ only in which historySystem they use: HEAD `3ee51c0` versus this reader change. The HEAD module is copied with import paths rewritten only; provenance and original source are retained. At all **12 monthly checkpoints**, `exactDigest`, whole-save canonical SHA-256 (excluding only `savedAt`), population and RNG state match exactly. All **10** final serialized top-level part hashes also match. No new metadata was projected away.

- Day 360 exact digest, both: **3510697313**.
- Day 360 serialized SHA-256, both: **780a760b3c2d55b006a42d1431127a2b24df5024672cad5ce863ce11825ab993**.
- Day 360 RNG state, both: **1448163939**.
- Files: `review2-digests-baseline.json`, `review2-digests-current.json`, `review2-digests-provenance.json`, `review2-history-HEAD-original.ts`, `review2-history-HEAD.ts`, `review2-digests.mts`.

Exact commands, run serially with JSON stdout and warning stderr in separate scratch files:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/review2-digests.mts baseline
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/review2-digests.mts current
```

**256x60 annual-grade gate was not rerun this round.** Prior WIP result: all 51 years 2010-2060 complete, **38 B / 13 A**, minimum **73.53086362155412 (B)** in 2060; final residents `[412608, 738176, 363051]` = **1513835**. Grade formulas are unchanged, and the absent producer still selects growth. Standard rerun command:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
```

The annual-grade check needs scratch `grade-run.ts` (ordinary bot rows omit inputs): run it through the same native loader in place of `tools/simbot.ts`. It uses `parseArgs(['--size','256','--years','60','--seed','7','--quiet'])` and full `botSystems`, requiring every 2010-2060 row to score at least **55 (C)**. Prior outputs: `grades256x60-s7.json`, `grades256x60-s7-result.json`, `grade-run.log`.

## Remaining differences, requests and limits

- T037b has not landed in this branch. The typed `AdvisorData.full` publication and end-to-end true-full scan test await the worker's merge, as instructed. The saved stub demonstrates persistence; no claim is made that the real producer exists today. Rerun bot and digest gates when publication lands. Adding a saved/mirrored field necessarily changes whole-save/exact digest bytes relative to a version without that field; report that metadata difference explicitly rather than hiding it or changing a pinned digest silently.
- Settings and replicaSafe requests are resolved in this lane. No further request for those files. No request to edit NewYear/Fireworks is needed: the public `active` getter is sufficient to remove the extra sparks wait.
- Worker docs still list `approvalBreakdown` as replica-safe, whereas the registry excludes its survey-cache detail reads. The review continues to use mirrored history and shared labels; no unsupported query/system read.
- April founding still has a partial first year: its approval change and records work, and its grade waits for a complete measured year. No fabricated founding history or old-save data was added this round.
- Unverified after these edits: full Vitest, fresh real-GPU/Worker layout/keyboard checks, true-full producer behavior, a fresh 256x60 grade run, and separate Medium/Hard two-process runs. No balance behavior changed; the normal seed-7 bot and the paired exact/save-hash/RNG probe match.

## Browser acceptance checklist for the worker

The supplied real-GPU QA on `3ee51c0` passed 7/8 acceptance lines before this patch. This is evidence for that base, not a fresh pass of the changed UI.

- [ ] A/B: at full-show 1x and burst 2x, card states **Figures on 1 January <year>**; compare its delta against Graphs' captured January 1Y value (now 13 samples), within 0.5%. Check both January hover endpoints.
- [ ] A: card appears when `active` clears even if final sparks still fade; clock/camera return normally and the date remains explicit.
- [ ] Cadence: 1x annually, 2x every second, ultra every fifth; never on load/reset/resync; show Off opens at January; no duplicates.
- [ ] C: Emergencies reads as yearly copy; no base/clamp or positive/negative 0.0-point term; other names match the tooltip labels.
- [ ] D: at 1920x1080 and 1280x720, with Budget/Graphs open, hit-test/click the card close button; it stays above panels and clear of the toolbar. Recheck the added date line at enlarged UI sizes.
- [ ] E: zero population shows Approval unavailable; all goals reached leaves no empty Next goals header.
- [ ] 1: Settings toggle reflects its persisted value; pointer and native Enter/Space activation work, hides an open/pending card, survives reload, and prevents future cards while off.
- [ ] LIVE at boundary/waiting/visible skips/removes the card; map/minimap/camera input and close dismiss; idle/paused timeout is 15 real seconds.
- [ ] Restore WebGL during active fireworks: pending review recovers, camera returns, and next year's review appears. Exit/load removes DOM, listeners and timers.
- [ ] Recheck healthy/forced-F grades, records and approval changes against history; first-April founding works. After T037b merge, verify land-full with weak demand uses unemployment.
- [ ] Lead: final full suite and GPU/frame-cost gates; refresh future-producer and long-run gates after its merge.

## Cloud carry-over (Nov 3; fix round Nov 3-9)

Chain desk6, branch `cloud/t054`, from `local/T054-lg21-year-review` at `0818204`, with dev `89a32a6` merged in
(`c999770`; dev's six commits since the lane's last merge are docs only: NOTE-051..056 and a T061 line). This is a
verification of a lane the desktop finished and gated on its real GPU. The fix round (its own subsection, after the
decisions) fixed the review's major in src/sim and added a test and a tool. It then merged dev `87c7c9c`, which holds
T040, T053, T034b, the Nov 4 handoff and NOTE-057..059, as `3ef6034`.

### Gap list (required against done, written before any change)

Sources: the task file, NOTE-048 (the T054 requests and the built-out flag), NOTE-053 (the shared listMilestones line),
NOTE-056 (T054 received), NOTE-044, POLISH_PLAN LG-21 in full with its Acceptance, and FEEL-02a's Risk line, which
names LG-21.

| Required | Source | State at `0818204` |
|---|---|---|
| Timing: after the show or burst (waits for the celebration), or on 1 January with the show off; 1× every year, 2× every second, ultra every fifth | LG-21 Change, task `do` | done (`YearReview.onYear/update`, `yearReviewDue`; reads `NewYearCelebration.active`); unit-tested; desktop real-GPU PASS |
| Card contents: population and growth, bank in months, approval change and its 3 biggest term changes, emergencies answered/failed/lost, tourists, EQ/HQ, records, goals completed and the next three, grade with sparkline, region line | LG-21 Change | done |
| The first calendar year (founded 1 April) is labelled "since April" | FEEL-02a Risk ("the Year in review (LG-21) labels it 'since April'") | **gap**: the founding card reads "2000 in review" with no partial-year label |
| The grade table, the weights and the cutoffs | LG-21 Change | done (`src/ui/yearGrade.ts`) |
| Closing after 15 s or on any map input, never during LIVE, the Settings switch | LG-21 Change, NOTE-048 | done (`4b5c99c` the switch) |
| Computed UI-side from mirrored history and replica-safe reads; no sim system reads; deterministic; never on load | task `do` | done; `listMilestones` replica-safe entry `2a44a8f` (NOTE-048; the same line as T053, NOTE-053) |
| Grade a land-full city on unemployment, reading `AdvisorData.full` | NOTE-048 | reader and stub test in (`0c6ef5d`); publishing `full` waits for T037b, which is not in dev at `89a32a6` (NOTE-056: a later follow-up commit) |
| Graphs' 1Y window spans one year | NOTE-048 request | done (`c79a648`, 13 samples) |
| src/sim and src/worker limited to the history telemetry, the registry entry and the listMilestones line; the bot identical | NOTE-048 standing rule, this step | to check from the diff |
| Gates: tsc, the full vitest, the hygiene test, the bot identical | task gates | desktop: tsc clean, 227 files / 2,268 tests, bot 192,899; to rerun here: tsc and the lane's test files (the merge step runs the full vitest and the bot) |
| Unit tests: anchors (approval 55 → 50), 84.9 → B and 85 → A, the F fixture | task gates, LG-21 Acceptance | done (`tests/game/yearGrade.test.ts`) |
| 256×60 s7 grades C or better every year from 2010 | task gates, LG-21 Acceptance | desktop result (38 B / 13 A, min 73.5) on the post-B3 sim (final residents 1,513,835 = B3's reference); its probe is a desktop scratch tool, not in the repo |
| Browser, real GPU: cadence and never on load, population within 0.5 % of Graphs, the tooltip's term, LIVE skip, the toggle | task gates, LG-21 Acceptance | desktop real-GPU PASS on both hosts (evidence on the desktop's scratchpad, not in the repo); to recheck function and visuals here on SwiftShader |
| Desktop work saved mid-edit | NOTE-044 | snapshot `74504ac` has the same src/ and tests/ as the final `0818204`, and `9e67c6d` (the vitest-gated commit) has the same src/ and tests/ too: to verify line by line |

### What was done

1. **Worktree and dev.** `cloud/t054` from `0818204`; dev `89a32a6` merged in as `c999770` with no conflicts (dev's
   changes since the lane's last merge are docs only). tsc clean after the merge.
2. **The desktop's saved-mid-edit work, line by line.** The 22:08 snapshot `74504ac` has the same src/ and tests/ as
   the final `0818204`; so does `9e67c6d`, the commit the desktop's full vitest ran on. Every changed line of src/ and
   tests/ against dev was read (17 files, +1,484/−8):
   - `src/ui/YearReview.ts` (the card, its model and lifetime), `src/ui/yearGrade.ts` (the table: anchors, weights,
     cutoffs A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40), `src/ui/yearReview.css`; `src/game/CityScene.ts` (+4: the import, the
     CONTENT line reading `NewYearCelebration.active`, and round 1's `newYear.cancel()` before a graphics restore);
     `src/ui/panels/GraphsPanel.ts` (1Y = 13 samples, one shared start index for the header, the plot and hover);
     `src/ui/panels/SettingsPanel.ts` (+1 row).
   - The plan's contents are all there: the services score is the mean of education, health, police and fire at homes
     (`resServices`, approval.ts:334) with parks as the fifth; Noisy homes count occupied R1-R3 buildings; the
     recurring net and expense leave out `oneoff:` lines; the bank is months of the January recurring expense.
3. **The src/sim and src/worker scope (the bot must stay identical).** Three files:
   - `src/sim/CityState.ts` (+30/−1): 36 new `HistorySeries` keys in `HISTORY_KEYS` (12 review inputs and 24
     `approval_<term>` snapshots), with their types.
   - `src/sim/economy/history.ts` (+95/−1): the history system records those series monthly, and writes two
     economy records of its own, `systemData.economy.yearReviewGoals` (goal completion months) and
     `yearReviewBaseline` (the founding snapshot); its new `init` seeds them and a January checkpoint's terms (since the fix round, the goals only on a city without the record).
   - `src/worker/replicaSafe.ts` (+1/−1): the `listMilestones` entry only, the same line as T053's (NOTE-053).
   - No sim system reads any of them (grep of every new name): only `src/ui/YearReview.ts` does, and the worker's
     recorder and replica and the save iterate `HISTORY_KEYS` generically, so they mirror and save the new series. The
     recorder only reads state, draws no random number and writes no field a system reads, so the sim's behaviour
     and the bot's rows cannot change; the exact digest (queries.ts:131-132) walks the history and `economy`, so
     its value differs from dev's by the new series and records, as any added saved field does; no test pins it (the
     desktop's full vitest), and its run-to-run determinism is unchanged (the desktop's two-process probe). The two economy records are wider than "the history field" by the letter, but they are written
     by the history system alone and read by the card alone (decision 3).
   - `AdvisorData.full` is read (`advisors.full === true`, absent means growth), not produced: T037b is not in dev.
4. **The one gap fixed** (`2db5254`, src/ui only): FEEL-02a's Risk line says the nine-month first year is labelled
   "since April" by the Year in review. The report now carries `since`, the founding month when the founding
   baseline lies inside the reviewed year, and the eyebrow reads "2000 in review, since April · <rank>"; a day-zero
   city (the bot) and every later year read as before. Three test lines (the card's eyebrow on the first and second
   New Year, the real-calendar spring founding, a day-zero founding) **fail with the change reverted** (3 failed,
   35 passed) and pass with it.
5. **Negative controls on the desktop's own tests** (each reverted to dev, run, restored): GraphsPanel's 13-sample
   window → 2 of 4 `yearReviewGraphs` cases fail; the `listMilestones` entry → `yearReviewMilestones` and the
   exhaustive `replicaSafe` registry case fail.
6. **Two costs, measured or bounded without the lock.**
   - The monthly recorder walks the buildings once (a Map lookup each): 11,495 buildings at 991k residents
     (`vet_s7_y43`), beside 9 other monthly building walks already in src/sim. Not timed (a timing run takes the lock).
   - Save size: at the 600-sample cap the 36 series add about 165 KB gzip in the worst case (full-precision floats,
     a scratch estimate with random walks), about 45 KB if rounded to 3 decimals; a 21-year 256 save is 4.4 MB.
     Not a gate; noted for the lead (decision 7).

### Gates (cloud, on `cloud/t054`)

| Gate | Result |
|---|---|
| tsc (sem), after the dev merge and after `2db5254` | clean, exit 0 |
| The lane's 8 test files (sem, `--maxWorkers=2`), at `c999770` | **8 files passed; 73 tests passed, 1 skipped** (the desktop's count) |
| The same 8 files plus `tests/worker/hygiene.test.ts`, at `2db5254` | **9 files passed; 91 tests passed, 2 skipped** (the existing skips) |
| Adjacent files: hygiene, graphAxisLabels, panelsMisc, serializePhase0, sim/history, phase0Contract, worker/replica | **7 files passed; 78 tests passed, 2 skipped** |
| New test lines with `2db5254` reverted | 3 failed, 35 passed (2 files); all pass with it |
| The full vitest and the bot | **not run in this step**, as the lead set it out to save the shared lock: the desktop ran both on `9e67c6d`, which has the same src/ and tests/ as `0818204` (227 files / 2,268 tests passed; residents [ 61124, 93804, 37971 ] = 192,899, identical to dev). Since then only docs came from dev and `2db5254` changed src/ui only, so the bot is expected identical; the merge step runs both on the merged tree |
| 256×60 s7 grades C or better every year from 2010 | the desktop's result stands: 51 of 51 years, 38 B / 13 A, minimum 73.53 (B, 2060), on the post-B3 sim (year 60 = 1,513,835, B3's reference); round 2 and `2db5254` change neither the grade nor its inputs; not rerun (a 256×60 bot run takes the lock). The desktop's probe was its scratch `grade-run.ts`; since the fix round the repo has `tools/yeargrades.ts` (`0a06c74`) |

### Browser evidence

(Carry-over step. The fix round's SwiftShader sessions are fix round item 3, under NOTE-059, decision 9.)

- **No browser session ran in this step.** The lead's instruction for this step limits it to tsc and the lane's own
  test files, to save the shared lock (27 waiters were queued at 23:34 UTC). A SwiftShader session was queued and
  then withdrawn before it reached the lock; its harness (not yet run, so unvalidated) is kept in the scratchpad as
  `t054qa/run-harness.mjs` with `t054qa/scenario.mjs`, for the merge or a review step if it wants a functional and
  visual recheck: the founding card "since April" on the default and loopback hosts, the 15 s close, a real click on
  the close button, the 101k fixture's card against Graphs 1Y, the tooltip labels, the card above Budget and Graphs
  and clear of the toolbar at 720p, a graded card, the Settings switch, and the 2× cadence with the show on.
- **The desktop's evidence images are not reachable from the cloud.** They sit on the desktop's scratchpad
  (`qa/T054/r2/`, named in the report above) and are in no branch, so they could not be looked at here. The evidence
  is the desktop's real-GPU table above (round 2, RTX 5070 Ti, both hosts): every LG-21 browser line passes.
- `2db5254` changes one text line of the card; the fake-DOM card test reads the eyebrow it renders, and the real
  calendar test drives a spring founding through its first New Year and a save/load.

### Decisions

1. **Acceptance 2 (population within 0.5 % of Graphs)** keeps the desktop's dated reading: the card's figures are
   captured on 1 January and say so ("Figures on 1 January <year>"), and they equal Graphs' 1Y at that January
   (desktop: within 0.17 %, Jan-to-Jan exact). A live graph months later has moved on with the calendar.
2. **"It names the same approval term as the approval tooltip."** The card's terms carry the tooltip's own labels
   (`APPROVAL_LABELS`), except `emergencies`, which the tooltip calls "Emergencies last month" and the card,
   reporting a yearly change, calls "Emergencies". Same term id, the tooltip's label without its monthly qualifier;
   the desktop's QA passed the line with it. Kept.
3. **The src/sim scope** is the history telemetry (36 series) plus two economy records written by the history system
   alone and read by the card alone (`yearReviewGoals`, `yearReviewBaseline`); no sim system reads any of them. That
   is wider than "the history field" by the letter. Accepted as part of the lane's history telemetry, which NOTE-056
   received with no infra.
4. **The full vitest, the bot and the 256×60 grade run were not rerun in the carry-over step** (the lead's
   lock-saving instruction; the fix round below ran the full vitest and the bot). The 256×60 result is the desktop's, measured on the same sim
   as dev's (its year-60 population is B3's reference, and dev has changed nothing in src/sim, src/worker or
   src/save since the lane's base `fb1531f`).
5. **The "since April" label** comes from FEEL-02a's Risk line, which names LG-21. It is shown when the founding
   baseline lies inside the reviewed year, so only a spring-founded city's first card carries it. The founding
   month comes from `systemData.economy.yearReviewBaseline` (mirrored through `economy`), not from
   `systemData.foundedDay`, which the worker does not mirror until T042's SYSTEM_KEYS line lands.
6. **No browser session in the carry-over step** (see Browser evidence): the real-GPU lines are the desktop's and
   pass; the label change is DOM text, covered by the tests. The fix round's two SwiftShader sessions and NOTE-059
   are decision 9.
7. **History precision and save size are left as gated.** Several new series keep full-precision floats (the
   approval terms, the recurring net and expense, the review funds, which must keep a negative balance below one
   unit). Worst case about 165 KB gzip at the 600-sample cap, about 45 KB if rounded to 3 decimals. Rounding would
   change the saved format and the desktop's gated digests, so it is a backlog candidate for the lead, not done here.
8. **The card waits for `NewYearCelebration.active`, not `busy`** (added in the fix round; the lead confirms or
   reverts). The task's `after` line and LG-21's Change say the card waits for `busy` to clear; the wiring passes
   `busy: () => this.newYear.active` (`src/game/CityScene.ts:327` after the fix round's dev merge), so the card can open while the last fireworks
   sparks still fade (`busy` stays true while `Fireworks.isRunning`). This is the desktop's round-2 change A: on the
   real GPU, after a 1× full show, the card appeared 2.3-5.4 s after the show phase ended (the clock-return phase),
   within one frame of `active` clearing, instead of waiting for the sparks as well.
   `tests/game/yearReviewRestore.test.ts` asserts the card appears with `active === false`, `busy === true` and
   `isRunning === true`. Kept as the desktop shipped it; reverting is the one-line change back to
   `this.newYear.busy` plus that test's predicate.
9. **Browser evidence follows NOTE-059** (added in the fix round). NOTE-059 cancelled the cloud's SwiftShader
   recheck of T054: for a desktop lane the cloud reviews the desktop's real-GPU evidence and runs the full vitest and
   the bot. Before that note reached this step, the fix round had already run two SwiftShader sessions (Nov 4, at
   `0a06c74`; see the fix round below). Their functional lines pass. Their three timing FAILs come from SwiftShader
   main-thread stalls of 3-5 s, which the harness's polling and screenshots cannot see past. The card's own 15 s
   timer closed it every time. No further browser session was run. The desktop's real-GPU table stays the evidence
   of record. The doubtful states go to the desktop as Desktop QA items (Remaining).
10. **Dev merged into the lane** (fix round, `3ef6034`). NOTE-057 puts T053 after T054, but T053 landed first
    (47bc952), and NOTE-057 says to merge dev into a conflicting later lane the same day. There was one conflict:
    the CityScene.ts CONTENT slot. The resolution keeps both blocks (T053's report gives the same resolution). The
    two constructors share no state, so their order does not matter. The `listMilestones` lines were byte-identical.
    Not changed, and left to the lead: T053's report notes that the milestone card (top 112 px, z-index 54) does not
    defer to the year-review card (bottom 86 px, up to `100% - 160px` tall, not a `.panel`). On a short viewport a
    full review and a rank-up just after New Year can overlap. If the desktop's check shows that, its smallest fix is
    for `MilestoneCard.present()` to treat `.year-review` like an open panel. Since the merge, dev has gained T058
    (0b9bd9d) and NOTE-060/061 (1c2019c). A trial `git merge-tree` of dev `1c2019c` with this branch is clean, so it
    was not merged again.

### Fix round (Nov 3-9)

Findings from the independent review of `cloud/t054` at `acd3462`: one major and four minors. Every one is addressed.
The step was interrupted at the shared usage limit on Nov 4. Its commits and its uncommitted report edit match the
handoff's `bundles/cloud_t054.bundle` (head `0a06c74`) and `wip/co_t054.uncommitted.patch`. It resumed on Nov 9 from
that state.

1. **Major: the goal record lost a goal reached in the partial month before a save** (`2d0b3a5`, src/sim). On every
   load, `historySystem.init` re-seeded `economy.yearReviewGoals` silently. Any goal reached since the last monthly
   tick was marked seen with no completion month: a rank crossed mid-month, or a reward that `rewards.init` unlocks on
   load. That goal never reached a card. Init now seeds only a city without the record, which is a new city or a save
   from before LG-21. With the record present, the next monthly tick stamps the goal in the same month as a
   continuous run, so right after a load the record equals the continuous run's. This removes the key from NOTE-044's
   post-load divergence.
   - **New test:** the population crosses Village and Town on day 375 and the save is on day 380. The continuous run
     and the reloaded run both end with `{ rank:village: 13, rank:town: 13 }`. The second-year card lists both goals
     and the first-year card lists neither. The existing init test now also checks that a reward unlocked on load is
     left to the monthly tick, which stamps it in month 15.
   - **Negative controls** (history.ts mutated, the file run, then restored): the reviewer's partial fix, an init with
     no guard, fails both cases. So does the lane's original always-seeding init. Each run: 2 failed, 15 passed.
   - **The reviewer's own probe** (`co-review/t054-probe/zzReviewProbe.test.ts`, copied in for one run and then
     removed) passes 2 of 2.
   - No sim system reads the record, so the bot is unaffected (the bot gate is below).
2. **Minor: the card waits for `active`, not `busy`.** Listed as decision 8 for the lead, with the desktop's
   measurement. The code is unchanged.
3. **Minor: no inspectable browser evidence.** Two SwiftShader sessions ran on Nov 4 under the lock, at `0a06c74`,
   1280×720, `?quickstart=1&size=small&seed=7`, quality low, show off. The harness and scenarios are kept in the
   scratchpad as `t054fix/qa/harness.mjs`, `scen.mjs` and `scen2.mjs`.
   - **PASS:**
     - on load at day 90 (founded day 90, baseline month 3, the setting on), no card shows;
     - the founding card reads "2000 in review, since April · Settlement" and "Figures on 1 January 2001", above the
       toolbar and clear of the minimap at 720p (screenshot `t054fix/qa/out/r-01-founding-card.png`, looked at);
     - with the toggle off, no card shows on 1 January 2002;
     - at 2×, no card shows on 1 January 2003, and a card shows on 1 January 2004, reading "2003 in review ·
       Settlement" with no "since".
   - **The 15 s close:** the run-2 instrumentation recorded the caller of every removal of the card. Both cards were
     removed by `YearReview.dismiss`, called from the card's own `setTimeout(…, 15000)`, not by input, LIVE or a
     setting. The stack frame is the served `/src/ui/YearReview.ts:258:38`. Vite's `transformRequest` gives that line
     as `this.timer = setTimeout(() => this.dismiss(), 15e3);`, and column 38 is `dismiss`. YearReview.ts has not
     changed since `0a06c74`.
   - **Three FAILs, all from SwiftShader timing:**
     - the measured times on screen (20.2 s; 16 s; 18.2 s) differ from 15 s by the page's own stalls. A 15 s probe
       timer armed in the page beside the founding card fired after 18.5 s, 3.5 s late. The 50 ms poll saw that card
       at least 3.6 s late (the card's own timer removed it 11.4 s after the poll first saw it), and saw its removal
       4.6 s late;
     - the 2× card's screenshot came after the card had closed. The screenshots `out2/r2-01-2004-card-2x.png` (5 Jan
       2004) and `out2/r2-02-2004-card-2x-after-5s.png` (10 Jan) show no card, and `out/r-02-2004-card-2x.png` (3 Jan)
       shows none either. All three were looked at.
   - **Not shown in the browser:** run 1's "a map click closes the card" PASS is void, because the card had already
     closed. Run 2 skipped the click for the same reason. The map-input close is covered by the fake-DOM tests and by
     the desktop's real-GPU table.
   - Per NOTE-059 (decision 9), the cloud ran no further session. The desktop items are under Remaining.
4. **Minor: the grade gate after `full` is published** (`0a06c74`). Remaining now names the 256×60 s7 grade rerun. The
   probe is in the repo as `tools/yeargrades.ts`. It runs the bot with any simbot options and grades each 1 January
   from the history the card reads (`yearGradeInput`, `yearGrade`). It prints each year's score, letter and six stat
   scores, and whether that year was graded on unemployment. It exits 1 when a year from `--from` (2010) is ungraded or
   scores below `--min` (55). The card module's stylesheet loads as an empty module, because node has no .css loader.
   It was smoke-run only, at 64×3 s7 with `--from 2001`: 3 of 3 years graded, 2001 C 62.1, 2002 B 77.9 and 2003 C 62.5, PASS
   (`t054fix/smoke.json`). It has not yet reproduced the desktop's 256×60 numbers.
5. **Minor: the recorded term list could drift from the approval terms** (`2d0b3a5`). A new test checks two things:
   the sorted `YEAR_REVIEW_TERMS` equals the sorted keys of `APPROVAL_LABELS`, and it equals the term ids the approval
   system writes to `economy.approvalTerms` in a 30-day run of the economy systems.

**Gates (fix round, on the merged tree `3ef6034`; the commits after it change only this report):**

| Gate | Result |
|---|---|
| tsc (sem) | clean, exit 0 |
| The lane's 8 test files plus hygiene, milestoneCard (game and worker) and replicaSafe (sem, `--maxWorkers=2`) | **11 files passed; 127 tests passed, 1 skipped** |
| The full vitest (lock), at `3ef6034` | queued under the lock at 23:31 UTC; the result follows in the next commit |
| The bot, 128×15 s7 (lock), at `3ef6034` | **identical:** `residents [ 61124, 93804, 37971 ]` = 192,899, 193k in 2015; 24 s under the lock |
| Before the dev merge, at `0a06c74` (Nov 4, lock) | full vitest 227 files passed, 2 skipped; 2,274 tests passed, 8 skipped. Bot `residents [ 61124, 93804, 37971 ]`, identical |

### Remaining

- **The built-out producer** (NOTE-048, NOTE-056; NOTE-061 §2 gives it to the desktop, after T037b and the TopBar
  split): once T037b is in dev, merge dev and publish `full` from the LG-05
  block in src/sim/economy/advisors.ts as a typed, optional `AdvisorData.full`, as T054's own small commit; then
  show the bot at 192,899 and the exact and determinism digests unchanged, and add an end-to-end land-full test.
  Then **rerun the 256×60 s7 grade gate**: once `full` is published, the run's late, probably land-full years switch
  the growth stat to unemployment scoring (`yearGradeInput` reads `history.builtOut`, `yearGrade` then uses
  `unemploymentScore`), so the desktop's 51 of 51 no longer covers the shipped grade. The probe is now in the repo:
  `npx tsx tools/yeargrades.ts --size 256 --years 60 --seed 7 --quiet --json <out.json>` under the timing lock
  (a 256×60 bot run); it prints each year's score, letter, the six stat scores and whether the year was graded on
  unemployment, and exits 1 when a year from 2010 is ungraded or below 55. A first run before `full` is published
  should reproduce the desktop's 51 of 51 (38 B / 13 A, minimum 73.53 in 2060). That run checks the tool itself; so
  far it has only been smoke-run.
- **The merge step:** the full vitest and the bot on the merged tree (expected identical: residents
  [ 61124, 93804, 37971 ]).
- **For the lead: NOTE-061 §2 lists LG-21 as a free CONTENT item** for a new Codex lane ("None of these items is
  started or in flight"). LG-21 is this lane, T054, now in its fix round. Only the producer above is left. A new
  LG-21 lane would redo the card.
- **Desktop QA (NOTE-059, NOTE-061 §1), on the real GPU, after the merge:**
  1. Decision 8: confirm or revert `active` over `busy`. After a 1× full show, does the card open while the sparks
     still fade, and is that acceptable?
  2. Decision 10: at 1366×768 and 1280×720, a rank-up just after New Year with a full review card open. Do the
     milestone card (top) and the review card (bottom) overlap?
  3. The 15 s close and a real map click on the card. Both pass in the desktop's round-2 table; SwiftShader could not
     time the close or reach the card in time to click it (fix round, item 3).
- Two low backlog notes from the desktop stand (Space on a focused Settings switch; Graphs 5Y/10Y one month short).
- The "Review round 2: the lane's notes" section above is the lane's mid-round text ("All changes below are
  uncommitted"); it was committed afterwards as `4b5c99c`..`e2165e0` and is kept as history.
