# T054 · LG-21 year in review

Implemented the Gazette card and pure mayor-grade scoring. Changes are uncommitted; no push or `.done` file.

## Changes by file

- `src/ui/YearReview.ts` (new): UI-side annual model, January-to-January population change, annual means/outcomes, approval term changes using the tooltip's labels, records, completed/next goals, regional connection/commuter line, weighted grade and a ten-year grade sparkline. Captures the boundary before the New Year show advances the calendar. Subscribes through `ctx.host`/`ctx.ui`; reads `ctx.state`; no simulation-system reads or replica writes. Waits for `NewYearCelebration.busy`, uses a save-stable 1/2/5-year cadence, never opens on load/reset, skips/dismisses LIVE, honors `yearReview`, and closes after 15 real seconds or map input. City AbortSignal removes all listeners, subscriptions, timer and DOM.
- `src/ui/yearReview.css` (new): scoped Gazette layout, small-screen/short-screen rules; no render objects/draw calls or per-frame layout reads.
- `src/ui/yearGrade.ts` (new): all six clamped linear scores, specified weights, built-out unemployment branch, finance penalty, crime multiplier and A/B/C/D/F cutoffs. Pure; no RNG.
- `src/game/CityScene.ts`: one import and the CONTENT wiring block immediately after NewYear construction. `NewYear.ts` is untouched.
- **Outside the named source files:** `src/sim/CityState.ts`: additive numeric review series in `HistorySeries`/`HISTORY_KEYS`, stable approval-term ids, optional goal-metadata type. Existing series retain their values and rounding.
- **Outside the named source files:** `src/sim/economy/history.ts`: a separate monthly telemetry helper records recurring finances excluding `oneoff:*`, raw funds (preserves the `< 0` cutoff), resident crime, five-service coverage, fraction of occupied home buildings flagged Noisy, emergency outcomes, approval term snapshots and the optional built-out signal. A separate goal-stamping helper silently seeds existing goals at init and dates new completions once under optional `economy.yearReviewGoals`.
- New tests: `tests/game/yearGrade.test.ts`, `yearReviewHistory.test.ts`, `yearReview.test.ts`.
- **Infra hunks: none. Cloud-held files edited: none.**

The two supporting source hunks are necessary because the pre-existing history cannot reconstruct recurring annual net, historic approval term changes, Noisy-home shares, resident service coverage or failed emergencies. They store facts only: all scoring and card computation stay UI-side. The existing save codec and Worker's recorder/replica iterate `HISTORY_KEYS`; `economy` is already a mirrored systemData key, so no Worker/save changes are needed.

## Validation

- `npx tsc --noEmit`: passed.
- `tests/game/yearGrade.test.ts`: 23 passed. Includes every score's anchors, approval 55 → 50, weights, 84.9 → B / 85 → A, the debt/approval-30/20%-failed F fixture, built-out switch and determinism.
- `tests/game/yearReviewHistory.test.ts`: 10 passed. Includes legacy padding, recurring-vs-one-off finances, sub-unit negative funds, Noisy fraction, service mean, exact term/outcome snapshots, optional built-out signal, missing economy data, silent old-goal seeding, rank recovery, once-only stamps and a saved January approval baseline.
- `tests/game/yearReview.test.ts`: 19 passed. Includes year boundaries, means/sums, shared approval labels (including clamp), capped/missing histories, frozen replica reads, save equivalence, load/reset suppression, show-off and busy timing, speed cadence, LIVE, setting changes, the full 15-second timeout across an ineligible ultra New Year, map/minimap/keyboard input, idle hover, canvas replacement and teardown.
- Existing regressions: `tests/sim/history.test.ts` 4 passed; `tests/game/cityTeardown.test.ts` 4 passed; `tests/game/cityDisposeCanvas.test.ts` 2 passed; `tests/worker/replicaLive.test.ts` 2 passed / 2 existing checks skipped; `tests/save/continuity.test.ts` 2 passed; `tests/save/serialize.test.ts` 13 passed.
- `tests/worker/hygiene.test.ts`: 17 passed, 1 existing W1.2 check skipped.
- Full Vitest suite: left to lead, per machine-sharing instruction.
- Real-GPU/browser checks: left to lead; no browser or bench was launched.

Default Vitest invocation failed before tests with Vite config-loader `spawn EPERM`; native config loading avoided that, but its default forks pool also failed with `spawn EPERM`. The following quiet-gated invocation succeeded, run separately for each file above:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/game/yearGrade.test.ts --maxWorkers=1 --pool threads --configLoader native
```

The initial check runner accidentally queued two quiet-gated tests while waiting for the timing lock. Both finished; the runner was corrected and all remaining checks ran one at a time. An added hover test initially omitted the event type in its fake DOM event; that fixture was corrected and the file reran green.

## Bot gates

No balance formula, speed, action, RNG draw or infrastructure scheduler was changed.

- **128×15 seed 7: passed.** Actual residents `[61124, 93804, 37971]`, total **192899** in 2015, exactly the supplied baseline. Output: `scratch/bot128x15-s7-native.log`.
- **256×60 seed 7, 2010–2060 annual grade gate: passed.** All **51** years have complete inputs; **38 B / 13 A**, no C/D/F and no missing years. Minimum **73.53086362155412 (B)** in 2060. Final residents `[412608, 738176, 363051]`, total **1513835** in 2060. Outputs: `scratch/grades256x60-s7.json`, `grades256x60-s7-result.json`, `grade-run.log`.
- Built-out metadata is absent on this base, so the measured 256 run uses growth scoring. The unemployment branch is unit-tested and awaits GUIDE's authoritative signal.

The requested runner is unavailable in this offline installation: `npx tsx` fails `ENOTCACHED` for `tsx`. The attempted command was:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

A scratch-only native TypeScript loader resolves extensionless `.ts` imports and suppresses the UI CSS side-effect import for the headless grade probe. It does not replace or modify any simulation code. Both native runs use the quiet gate, serialized:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet

node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/native-ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T054/scratch/grade-run.ts
```

The grade probe invokes `parseArgs(['--size','256','--years','60','--seed','7','--quiet'])`, constructs `SimBot(opts, await botSystems(opts.noInfra))` (full infrastructure, normal base strategy), and enriches every yearly row with `yearGradeInput(history, JanuaryMonth)` and `yearGrade(input)`. Its assertion requires every row from 2010 to 2060 inclusive to exist and score at least 55 (C). Existing bot rows alone omit several necessary grade inputs.

For a conventional rerun after `tsx` is available, use the same quiet-gated 128 command above and:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
```

This is the standard base-run command. Use the native grade-probe command above for the enriched yearly-grade assertion (its loader also handles the imported UI CSS). Do not run them concurrently.

## Plan/code differences and owner requests

1. **META, `src/ui/panels/SettingsPanel.ts`, gameplay section in `build()`:** add a “Year in review” row using `this.sw('yearReview')`, explaining the yearly Gazette and grade. The schema/default already exists and the card responds to settings events, but no visible toggle exists on this base. File left untouched.
2. **GUIDE, `src/sim/economy/advisors.ts`, `ZoneScan` / `scanZones` / `AdvisorData`:** implement LG-05's free-buildable-land criterion and expose optional top-level `systemData.advisors.builtOut: boolean` from that authoritative scan. The new monthly history consumes this field as `builtOut`; while absent it uses growth scoring. No guessed alternate definition was added. This branch is unit-tested but cannot activate on the current base.
3. **SIM/Worker, `src/worker/replicaSafe.ts`, `REPLICA_SAFE`:** LG-01's implemented `listMilestones` helper is still absent from the audited registry. Add it and its replica-equivalence case in `tests/worker/replicaSafe.test.ts`. It reads only mirrored stats/unlocked/milestones; the review uses it for the next three goals. Both cloud-held Worker source and its existing tests are untouched here.
4. `WORKER_DESIGN.md` lists `approvalBreakdown` as replica-safe; the actual `replicaSafe.ts` excludes it because detail lines read survey caches. No host query exists. The review needs only labels and values: it uses exported `APPROVAL_LABELS` and recorded/mirrored term values, with no survey/system read.
5. Old saves have no prior detailed review telemetry or goal completion dates. Their new arrays pad with `reviewSample = 0`. Annual grades appear after twelve measured months; term deltas need measured start/end points; existing goals seed silently. A save opened exactly on January 1 seeds its saved approval baseline in `reviewTermsSample` without creating a new history point or fabricating a preceding grade. Midyear loads wait for recorded January endpoints. No invented historic grades/completions are displayed.
6. Records are records within retained monthly history (600 samples), stated on the card. The grade sparkline shows the last ten reconstructible years. Founding from zero population shows new residents rather than dividing by zero; positive population from a zero baseline gets full growth points.
7. The existing Graphs panel's 1Y control selects 12 samples (eleven intervals). The review uses the actual twelve-month January-to-January interval (13 endpoints). Compare matching January endpoints in Graphs when checking the 0.5% population acceptance; a direct comparison to its 1Y header delta may differ. GraphsPanel is untouched; GUIDE should confirm whether its 1Y range should include 13 points.
8. Regional line uses current mirrored connection counts and regional job/worker slots, with the persistence region name when supplied. It does not read stale/unmirrored `systemData.region` or request a new Worker row.

## Browser acceptance checklist (lead, real GPU / worker, 20-year save)

- [ ] Load, reset/resync and reopen the save: no Gazette until the next eligible New Year.
- [ ] At 1×: exactly once after each show/burst; with celebration Off: on January 1.
- [ ] At 2×: every second elapsed city year; at ultra: every fifth. Speed changes must not duplicate a year's card.
- [ ] Pan/zoom during fireworks: the pending card still appears when `busy` clears.
- [ ] Compare population and growth with the same January endpoints in Graphs; difference ≤0.5%.
- [ ] Compare the largest approval term changes with the approval tooltip's labels.
- [ ] Verify bank months, emergency response/losses, tourist yearly average, EQ/HQ, records, goals, grade and sparkline.
- [ ] LIVE at the boundary, while waiting, or while visible: skip/remove the card with no replay after LIVE ends.
- [ ] After META adds the toggle: switch `yearReview` off before and during a card; it disappears and future cards stay hidden.
- [ ] Close button, map click/drag/wheel/touch and camera key dismiss without consuming map input; idle/paused card closes at 15 seconds.
- [ ] At common laptop dimensions and enlarged UI, verify fit/scrolling, stacking, keyboard focus and readability.
- [ ] Exit/reenter, replace a lost-context canvas and load another city: no retained card, subscriptions or timers.
- [ ] Run full Vitest, default-runner bot confirmation if desired, and UI frame-cost/real-GPU checks. Medium/Hard/save continuation should retain simulation behavior.
