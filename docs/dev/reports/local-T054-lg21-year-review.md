# T054 - LG-21 year in review, review round 2

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
