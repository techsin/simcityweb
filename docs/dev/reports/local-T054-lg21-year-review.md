# T054 - LG-21 year in review, review round 1

The Gazette and pure mayor-grade scoring are in WIP `b7408fa`. The lead validated that WIP with tsc, the full Vitest suite (219 files, 2,197 tests), and the 192,899-resident bot baseline. The fixes below are uncommitted on top of that WIP; no push or `.done` file.

## Changes this round, by file

- `src/game/CityScene.ts`: **one-line exception in META's restore path**, `this.newYear?.cancel()` at the start of `restoreViews()`, before camera capture and old-view disposal. Cancelling while the old fireworks object is still live clears the celebration's busy state and restores the normal camera. A pending review can then open, and later New Years work. `NewYear.ts` and `Fireworks.ts` are untouched.
- `src/ui/YearReview.ts`: population change and displayed growth now use exactly GraphsPanel's 1Y window: twelve samples, eleven intervals, ending at the captured January. Annual grade growth still uses twelve elapsed months, as specified by the scoring table. First-year approval/term changes and records use the optional founding snapshot when no prior January exists; developed old saves retain unavailable markers.
- **Outside the originally named source files:** `src/sim/economy/history.ts`: an isolated init helper saves optional `economy.yearReviewBaseline` (month, six record values, approval terms) when the state is still at its founding day with no monthly history. Supports the application's April/day-90 start and day-zero starts. Copies the snapshot once, survives save/load, and adds no artificial history sample. The existing optional `advisors.builtOut` hook remains; a comment names its missing LG-05/T037b producer. No substitute map scan or guessed built-out rule.
- `tests/game/yearReview.test.ts`: corrects the population-window expectations and separately asserts that annual grade growth keeps its twelve-month interval.
- `tests/game/yearReviewHistory.test.ts`: adds a real economy producer-consumer check, spring founding through the first real New Year, baseline save/load and copy-once checks, and a developed legacy-save check. The existing true/false built-out injection is explicitly identified as a synthetic future-producer contract.
- New `tests/game/yearReviewGraphs.test.ts`: compares the card against the actual GraphsPanel draw/header output for normal, capped and short histories. For population `1000 + 10t`, both show `+110`; annual growth scoring still uses `+120`.
- New `tests/game/yearReviewRestore.test.ts`: runs the real NewYear celebration into its active fireworks show, restores through the real CityScene method with disposal preserving the stuck-running condition, then checks the pending card and the next year's card. Asserts cancellation before old-view disposal. Uses null rendering views; no GPU/browser.
- **Infra hunks: none.** Other source files, including `yearGrade.ts`, `yearReview.css` and `CityState.ts`, are unchanged this round. No balance formula or RNG draw changed.

The WIP's additive `HISTORY_KEYS` telemetry and goal metadata remain as implemented. The optional baseline uses the already serialized/mirrored `economy` object; no Worker or save-code change is needed.

## Validation this round

Quiet-gated `npx tsc --noEmit`: passed. Targeted files ran separately, one process at a time:

| Test file | Result |
| --- | --- |
| `tests/game/yearGrade.test.ts` | 23 passed |
| `tests/game/yearReview.test.ts` | 19 passed |
| `tests/game/yearReviewHistory.test.ts` | 14 passed |
| `tests/game/yearReviewGraphs.test.ts` | 3 passed |
| `tests/game/yearReviewRestore.test.ts` | 1 passed |
| `tests/game/graphicsFirstRun.test.ts` | 21 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/sim/history.test.ts` | 4 passed |
| `tests/save/serialize.test.ts` | 13 passed |
| `tests/save/continuity.test.ts` | 2 passed |

Total: **117 passed, 1 existing skip, 10 files**. Grade tests include all score anchors, approval 55 = 50 points, 84.9 = B / 85 = A, and the negative-funds/approval-30/20%-failed F fixture. `git diff --check` passed.

The default runner hit config-loader/fork `spawn EPERM` during the original implementation. This round used the established native-config/thread runner throughout:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/game/yearReviewRestore.test.ts --maxWorkers=1 --pool threads --configLoader native
```

Use the second command separately for each test file above. The full suite has **not** been rerun after these fixes; left to the lead per machine-sharing instructions. No browser, bench or real-GPU timing run was launched.

## Bot gates

**128x15 seed 7 rerun passed:** residents `[61124, 93804, 37971]`, total **192899** in 2015, approval 81, 38 unlocks. Exactly the required baseline. Output is `bot128x15-s7-review1.log` under the task scratch directory:

`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch`.

`tsx` is still absent from this offline installation (the original `npx tsx` attempt failed `ENOTCACHED`). Actual command this round, with raw output redirected to that log:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

The scratch-only native loader resolves extensionless TypeScript imports and ignores CSS imports for headless probes; it does not replace simulation code. Conventional equivalent once `tsx` is available:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

**256x60 annual-grade gate: prior WIP result retained, not rerun this round.** The annual grade inputs/formulas are unchanged. The original full-infrastructure seed-7 base run had all **51** years 2010-2060 complete: **38 B / 13 A**, minimum **73.53086362155412 (B)** in 2060. Final residents `[412608, 738176, 363051]`, total **1513835**. Outputs remain `grades256x60-s7.json`, `grades256x60-s7-result.json` and `grade-run.log` in scratch. The absence of LG-05 metadata means this result uses growth scoring.

Standard base-run command, if a fresh post-fix confirmation is wanted:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
```

The yearly-grade acceptance needs the enriched probe because ordinary bot rows omit several inputs. Its exact command is:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/grade-run.ts
```

The probe uses `parseArgs(['--size','256','--years','60','--seed','7','--quiet'])`, `new SimBot(opts, await botSystems(opts.noInfra))`, and `yearGradeInput`/`yearGrade` for each January row. It requires every year from 2010 through 2060 to exist and score at least **55 (C)**. Run commands serially.

## Plan/code differences and cloud requests

1. **GUIDE/T037b, `src/sim/economy/advisors.ts`, `ZoneScan` / `scanZones` / `AdvisorData`:** implement LG-05's authoritative built-out test (free buildable land below 1% and relevant family demand at least 0.5), publishing optional top-level `systemData.advisors.builtOut: boolean` before monthly history. No producer exists in this tree. There is no cheap exact local fallback without duplicating the authoritative scan, so growth scoring remains until it lands. The real-economy test follows actual producer output and today covers the absent/false path. The true unemployment path is covered only by the synthetic history contract and pure score tests; it is not an end-to-end built-out-city check.
2. **META, `src/ui/panels/SettingsPanel.ts`, gameplay section in `build()`:** add the visible "Year in review" row with `this.sw('yearReview')`. The schema/default and card setting response exist; the UI toggle is still absent. File untouched.
3. **SIM/Worker, `src/worker/replicaSafe.ts`, `REPLICA_SAFE`:** add the pure `listMilestones` helper and its replica-equivalence case in `tests/worker/replicaSafe.test.ts`. The card uses it for the next goals; it reads mirrored stats/unlocked/milestones. Both cloud-held files untouched.
4. `WORKER_DESIGN.md` lists `approvalBreakdown` as replica-safe, but the actual registry excludes it because detail lines use survey caches. The card uses the shared `APPROVAL_LABELS` and raw mirrored term histories instead; no sim-system read or unsupported host query.
5. GraphsPanel's 1Y population interval differs from a twelve-month grade interval. The displayed card delta now matches the actual Graphs control exactly; the grade uses the specified annual interval. No GraphsPanel edit or owner request is needed.
6. Founding snapshots are optional. They seed only at the founding date with empty monthly history, including an unplayed save still at that date. Developed old saves do not acquire fabricated founding values; missing terms/records stay unavailable. An April founding has nine measured months at its first New Year: approval changes and records now work, while a complete annual grade still waits for enough telemetry. Existing January checkpoint seeding remains unchanged.
7. Records cover retained monthly history (600 samples), with the founding snapshot as the first comparison when available. The sparkline uses reconstructible annual grades. The regional line still uses mirrored connection/job/worker values; no region or Worker source was changed.

Unverified after this patch: full Vitest, real GPU/Worker behavior and visual fit, end-to-end true built-out scoring until its producer exists, and separate Medium/Hard two-process hashes. The 128 bot and save continuation regressions passed; simulation formulas and RNG are unchanged.

## Browser acceptance checklist (lead, real GPU / Worker)

- [ ] On a 20-year save, loading/resetting/resyncing never opens a card immediately.
- [ ] At 1x, exactly one card per New Year after the show; with celebration Off, on January 1. A healthy show continues to delay the card.
- [ ] At 2x, every second city year; at ultra, every fifth. Speed changes do not duplicate a card.
- [ ] Lose/restore WebGL **during active fireworks**, not just before/after a show: camera returns correctly, the pending card appears after restore, and the following New Year's card also appears.
- [ ] At the captured January, compare the card's population change and growth directly with GraphsPanel's **1Y** header; difference at most 0.5% (unit tests now show exact equality).
- [ ] Compare approval term names with the tooltip. Found an April-start city and verify its first New Year includes approval change and records; a developed legacy save must not invent prior values.
- [ ] Verify bank months, emergency outcomes/losses, tourism average, EQ/HQ, records, goals, grade and sparkline.
- [ ] LIVE at the boundary, while waiting or while visible skips/removes the card with no replay after LIVE ends.
- [ ] After META adds the toggle, switch `yearReview` off before and during a card; it disappears and future cards stay hidden.
- [ ] Close button and map/minimap click/drag/wheel/touch/camera keys dismiss; idle/paused card closes after 15 real seconds.
- [ ] Check laptop/short viewport, enlarged UI, scrolling, stacking, focus and readability.
- [ ] Exit/reenter, replace a lost-context canvas and load another city: no retained DOM, timers or subscriptions.
- [ ] Lead: rerun full Vitest and normal real-GPU/frame-cost gates; optionally refresh the 256x60 grade probe and separate difficulty hashes.
