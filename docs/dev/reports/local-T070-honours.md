# T070: honours and the young-town approval reward

Worktree `local/T070-honours`, based on `1c2019c`. Round 1 is committed as `b7d40a7`; the Round 2 changes below are uncommitted.

## LG-20 — Honours

Implemented all twelve honours in a separate rewards-table block. Each has conditions, numeric progress and current requirements; completion is permanent, posts a referenced reward announcement, awards a plaque and plays a budgeted fanfare. Clean Air Metropolis also offers the Eco Plaza; Safe City offers the Firefighters' Memorial. The Honours tab separates these rows from ordinary rewards, and referenced toast actions select the correct tab.

The 12/60/24/120-month streaks persist under optional `systemData.economy.honours`. Old saves start observing at the next complete calendar month; loading existing timers does not grant extra months. Daily observation records setbacks, including debt/taxes, and monthly checks use the emergency system's rolled `lastMonth`. Loan proceeds and repayments also disqualify the month. Home/noise/large-park surveys run only in the simulation; list reads use the mirrored snapshot. Large-park reach uses the existing walking kernel and positive reach weights, counts each occupied residential building once, and excludes unfinished, empty, abandoned and ruined homes.

Files:

- `src/sim/economy/rewards.ts`: honour definitions, optional timers and survey, permanent 5% perk factors, condition display; honours stay out of the ordinary next-unlock query.
- `src/ui/panels/ListPanels.ts`: Rewards/Honours tabs, numeric blockers, earned plaque rows and decoration placement using the existing tool path. Listeners use `ctx.signal`; state reads remain on the host replica.
- `src/game/GameSounds.ts`: one honour cue method using the existing reward voice, keyed by reward metadata and unlock id, with a six-second burst budget and reset cleanup.
- `src/sim/catalog.ts`: new, isolated honours block: twelve free, unique plaques (local land value 0.01 within one tile) and the two optional free gardens (local land value 0.05 within four tiles; no upkeep, jobs or cap relief).
- `src/assets/builders/honours.ts` (new): completed plaque, plaza and memorial geometry.
- `src/assets/manifest.ts`, `src/assets/builders/index.ts`: minimal asset registration hunks required by the new models. These existing asset-file hunks are outside the task's literal “new assets” wording.
- **Infra hunk:** `src/sim/infra/common.ts`, `readEffects`: one import and two effect multipliers, applying the education and ridership honour factors. No refactor or moved code.

New tests:

- `tests/sim/honours.test.ts`: meeting/missing conditions for every honour, exact boundaries, surveys, consecutive duration/reset/partial-month rules, save continuation, permanent unlocks, unchanged RNG and pure mirrored progress reads.
- `tests/infra/honourPerks.test.ts`: neutral defaults, isolated 5% perks, ordinance composition and permanence.
- `tests/assets/honours.test.ts`: catalog/manifest correspondence, free unique decorations, effect bounds and geometry constraints.
- `tests/game/honoursPanel.test.ts`: tabs, numeric blockers, plaque placement, referenced row navigation and abort cleanup.
- `tests/game/honourSounds.test.ts`: metadata routing, paired-event deduplication, burst/news budgets, reset and disposal.

Validation at the LG-20 checkpoint:

- `npx tsc --noEmit`: passed, including all LG-20 test files.
- `git diff --check`: passed.
- A short Node/Rolldown probe successfully imports the simulation graph, initializes the rewards system and lists 12 honours / 55 total rewards with neutral perks. It also checks the new import cycle at runtime.
- Quiet-gated Vitest cannot load the repository config: `spawn EPERM` in Vite's Windows `net use` realpath optimization. A runner-loader attempt also stops at config startup (`ReferenceError: require is not defined` in picomatch). No test case ran in those attempts.
- The prescribed quiet-gated `npx tsx tools/simbot.ts --size 256 --years 60 --seed 7` cannot start: `tsx` is not installed/cached and npm reports `ENOTCACHED`. A local, bundled runner of the unchanged bot is prepared in the lane scratch folder; measured results are recorded below.
- A scratch-only native Vitest config with `resolve.preserveSymlinks: true` and the threads pool avoids the config startup failure. Through the quiet gate, single-file runs passed: honours (82), honourPerks (5), honours assets (5), honoursPanel (5), honourSounds (7), existing ranks (48), existing asset manifest (20), existing catalog (9). No repository config changed.
- The LG-20-only 128×15 seed-7 bot remains exactly **192,899**, residents **[61,124, 93,804, 37,971]**. It earns Green Belt in 2010. Output: lane scratch `lg20-128x15-s7.log`.

Plan versus code:

- LG-01 had landed ranks and queries, but no panel tabs. This item adds Rewards and Honours; the separate Milestones tab remains LG-01 work.
- Existing tests require the earlier LG-20 placeholder ids to remain neutral stubs. Final art therefore uses new ids, preserving those stubs and every existing test file.
- All honours require an occupied home. This prevents empty cities and inconsistent synthetic population statistics from earning vacuous quality awards.
- The existing transit effect is a mode-choice attractiveness/odds factor (`2.5 * log(transitRidership)`), so the 1.05 perk follows that established convention; it does not promise exactly 5% more final riders.
- Keeping timers inside the already mirrored economy data avoids a new Worker protocol key or replica-safe registration. No cloud-held file was edited, and no cloud request is needed for LG-20.
- The existing facility contract requires a measurable effect and static tooltip fact for every visible ploppable. Plaques therefore have a one-tile, 1% civic-pride land-value effect. Sandbox still unlocks ordinary facilities immediately, but honours require their actual conditions; otherwise merely opening sandbox would activate both 5% perks. Both integration issues were caught by `facilities.test.ts` and corrected without editing existing tests.

Acceptance evidence and remaining browser checks:

- [x] Run every new test and the existing affected-file tests listed in the final gate section below.
- [x] Confirm the 256×60 seed-7 run earns at least four honours by 2060; record their dates, especially Balanced Books, Tourist Capital, Scholar City and Megacity.
- [ ] Open Rewards, select Honours, and inspect all twelve rows at 1280×720; blockers and duration progress should wrap readably.
- [ ] Earn an honour: hear one fanfare, see its plaque award, follow the referenced toast to the correct highlighted row, and place its plaque.
- [ ] Place the Eco Plaza / Firefighters' Memorial after earning their honours; inspect models close up and at distant LOD.
- [ ] Save/load partway through a streak and after earning an honour; verify progress and permanent earned status in the Worker game.

## FH-26 — A young-town approval reward (round 1)

The Statue now requires 2,500 residents and approval of at least 55% for six complete months, on **all difficulties**, as D7 specifies. Its row displays current approval, population and the six-month progress. This uses the plan's 55%-for-six-months option; it does not add the alternative lowest-approval recovery route.

`src/sim/economy/rewards.ts` contains the separate FH-26 timer helpers and the small Statue definition change. The optional `systemData.economy.approvalReward` key is already covered by the economy mirror and save format. Daily setbacks reset progress; partial calendar months and repeated init/month checks grant no extra credit. Existing unlocked Statues stay unlocked. No new RNG draws, commands, settings or catalog effects are added. `ListPanels.ts` already renders the normalized progress text through its existing requirement row, so no additional FH-26 UI hunk is necessary.

This changes balance by design on Medium and Hard too: the bot buys a Statue earlier and receives its existing +3 approval. The original 192,899 population gate is therefore recorded separately at the LG-20 checkpoint above; final combined bot numbers and the Statue date are recorded in the gate section below.

New tests: `tests/sim/approvalReward.test.ts` covers thresholds, all difficulties, six-month timing, setbacks, partial/duplicate month checks, save continuity, already earned old-save Statues, mirrored progress and RNG preservation. `tests/game/approvalRewardPanel.test.ts` covers the visible goal, the three-of-six-month bar, changing approval readout and the completed row.

**Acceptance mismatch:** the final Medium 128×15 seed-7 run earns the Statue on **day 2,610 (April 2007)**, at 59,577 residents and 56.64348168974983 approval. This is year 7, outside the requested years 4–6. Before FH-26 it unlocks on day 3,030 (June 2008). The plan's dates and the current base differ; I kept the specified 55%/six-month condition and did not tune other balance files to force the date.

Final 128×15 result: **192,647 residents**, split **[61,566, 92,988, 38,093]**, approval **81.58809280194733**. That is 252 residents below the unchanged LG-20 checkpoint (−0.131%). Safe City is earned in January 2015. Output: lane scratch `final-128x15-s7.log`.

Browser acceptance checklist:

- [ ] In a young town, open Rewards and inspect the Statue: 2,500 residents, approval ≥55%, and progress out of six months.
- [ ] Hold the threshold for six months, then follow its toast and place the Statue; verify the existing +3 approval effect.
- [ ] Drop below 55% or 2,500 residents before completion; verify the streak restarts.
- [ ] Save/load during the streak and load an old save with an already earned Statue; verify continuation/permanence on each difficulty.
- [ ] Confirm the measured Medium 128×15 seed-7 unlock date against the plan's years 4–6 target.

## Round 1 gates and handoff

Final `npx tsc --noEmit` and `git diff --check` pass. **30 targeted files: 559 tests passed, one fixture-dependent test skipped**, run individually and sequentially through the quiet gate. All seven new test files pass (130 cases). No existing test file was edited. The facilities failures encountered during integration are fixed and its complete 15-case file now passes.

The passing test files (all under `tests/`, each suffix `.test.ts`):

- `sim/`: `honours`, `approvalReward`, `ranks`, `catalog`, `milestoneNews`, `economy`, `advisorsTexts`, `balanceEconomy`, `botVenues`.
- `game/`: `honoursPanel`, `honourSounds`, `approvalRewardPanel`, `gameSounds`, `milestoneSounds`, `rewardToast`, `ruinState`, `uiRuins`, `upkeepReads`, `panelsUpkeep`, `panelCommands`, `guideCopy`.
- `infra/`: `honourPerks`, `catchments`, `facilities`, `feedbackFacilities`.
- `assets/`: `honours`, `manifest`.
- `worker/`: `replicaSafe` (2 passed, missing grown-city fixture skipped), `milestoneCard`, `hygiene`.

Reproduce each targeted test with the sandbox-compatible scratch config:

```powershell
node $quiet npx vitest run tests/sim/honours.test.ts --maxWorkers=1 --configLoader native --config "$scratch/vitest.config.mjs"
```

`$quiet` and `$scratch` are defined in the command blocks below. The scratch config sets this worktree as root, `resolve.preserveSymlinks: true`, and `test.pool: 'threads'`; the repository config is unchanged.

| Gate | Result |
|---|---|
| LG-20, 128×15 s7 unchanged | **Pass:** 192,899, residents [61,124, 93,804, 37,971] before FH-26 |
| LG-20, at least four honours by 2060 | **Pass:** eight honours on the final 256×60 s7 run |
| FH-26, Medium 128×15 Statue in years 4–6 | **Miss:** April 2007, year 7; literal 55% / six-month rule retained |
| Final combined 128×15 s7 | 192,647, residents [61,566, 92,988, 38,093]; balance changes intentionally through FH-26 |
| Final combined 256×60 s7 | 1,243,402, residents [353,131, 592,074, 298,197]; approval 78.94574010030293 |

The eight honours in the long run:

| Honour | Year | Absolute day |
|---|---:|---:|
| Green Belt | 2001 | 510 |
| Safe City | 2017 | 6,330 |
| Clean Air Metropolis | 2019 | 7,050 |
| Balanced Books | 2021 | 7,770 |
| Tourist Capital | 2028 | 10,320 |
| Full Employment | 2030 | 10,980 |
| Scholar City | 2041 | 14,760 |
| Megacity | 2043 | 15,600 |

`final-256x60-s7.log` holds the annual rows and exact award records. The plan's “today” dates are historical rather than current-base predictions: Balanced Books is 2021 rather than 2022, Tourist Capital 2028 rather than 2027, Scholar City 2041 rather than 2040, and Megacity remains 2043.

Canonical bot commands for the lead, from this worktree (same flags, no strategy flags):

```powershell
$quiet = Join-Path $env:TEMP 'claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
node $quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
```

Because `tsx` is unavailable in this sandbox, the measured equivalents used Rolldown to compile the same `SimBot`, `parseArgs` and `botSystems` code, adding only award/date and final-result logging. No repository bot code changed. Actual run commands were:

```powershell
$scratch = Join-Path (Split-Path $quiet) 'T070/scratch'
node $quiet node "$scratch/t070-gates.mjs" --size 128 --years 15 --seed 7
node $quiet node "$scratch/t070-final-gates.mjs" --size 128 --years 15 --seed 7
node $quiet node "$scratch/t070-final-gates.mjs" --size 256 --years 60 --seed 7
```

All ran sequentially through the quiet gate. The first bundle is the LG-20 checkpoint; the final bundle includes FH-26. Logs are `lg20-128x15-s7.log`, `final-128x15-s7.log` and `final-256x60-s7.log` in that scratch folder.

No cloud-held files changed. **Cloud-held-file requests: none.** The only infra edit is the three-line import/multiplier hook in `src/sim/infra/common.ts` described above. The only source hunks beyond the literal named/new-asset scope are the two existing asset registration files, also described above. Medium/Hard full-state identity is intentionally not claimed after FH-26 and late honour perks. New metadata also changes serialized hashes. No fixture rows, commits, pushes, merges or done markers were written.

The final facility fixes affect sandbox auto-awards and manually placed plaques. The default bot buys only reward/landmark kinds, so it does not place honours' plaques or gardens, and these final fixes do not alter the recorded bot runs.

The lead still owns the full suite, canonical `tsx` reruns, balance-fixture `polish` sign-off (including G-POP/G-TOUR), two-process continuity/hash review if desired, and all real-GPU/browser checks above. The FH-26 date miss needs a plan/balance decision; no unrelated balance file was changed to force it.

## Round 2 — The approval recovery alternative

The shipped Statue goal now requires **2,500 residents and either approval ≥55% for six complete months, or approval at least ten points above its lowest recorded value for six complete months**. The two holds are independent: progress cannot splice together partial months from different routes. Both require the population floor throughout the hold. Daily setbacks reset only their own route, and either completed route unlocks the permanent reward.

“Lowest” is the minimum exact, unrounded `stats.approval` observed by the rewards system from its first founding init and then at daily/monthly checks, including observations before the town has 2,500 residents. It is monotone and saved as optional `systemData.economy.approvalReward.lowestApproval`; `recoveryMonths` and `recoveryInterrupted` are optional too. Reinitializing a tracked city preserves its record and counters.

Old saves have no exact founding minimum: monthly approval history is rounded and capped, so reconstructing a minimum from it could invent a ten-point recovery. They seed the new record at their exact saved approval when first loaded, retain their existing 55% streak and earned Statue, and receive no retroactive recovery months. Subsequent saves preserve the new exact minimum. Thus “since founding” applies to newly founded cities; legacy cities begin the new record at migration. This unavailable historical detail is the only continuity limitation.

The Rewards panel shows both held-month counts, current approval, the saved low and the current gain toward ten points. Its existing normalized requirement rendering consumes the composite goal text; `ListPanels.ts` needs no additional source hunk.

Round 2 files:

- `src/sim/economy/rewards.ts`: optional recovery fields and independent hold, OR eligibility/progress, composite goal text and description. No other balance changes.
- `tests/sim/approvalRecovery.test.ts`, `tests/game/approvalRecoveryPanel.test.ts` (new): recovery boundaries, founding/population behavior, hold/reset/no-splicing rules, old saves, exact save continuation, RNG/read purity and both UI routes.
- `tests/sim/approvalReward.test.ts`, `tests/game/approvalRewardPanel.test.ts`: minimal updates to this lane's Round 1 copy expectations for the now-complete goal; their original timing cases remain.
- This report: definitions, measured dates, commands and remaining checks.

No Round 2 infra hunks, asset changes, cloud-held edits or cloud requests. No commits, pushes, merges or done files.

### Round 2 bot measurements

The literal rule still misses the years 4–6 acceptance on seed 7: **day 2,610, April 2007**, unchanged from Round 1. Its recorded low is **47.20152933069691%**, so recovery requires **57.20152933069691%**. At the award, approval is **56.64348168974983%**, population is **59,577**, the 55% route has six months and the recovery route has zero. No other balance was tuned.

| Literal rule, Medium 128×15 | Statue day / date | 2015 residents [R$, R$$, R$$$] | Total residents | 2015 approval |
|---|---|---|---:|---:|
| Seed 7 | **2,610 / April 2007** | [61,566, 92,988, 38,093] | **192,647** | **81.58809280194733%** |
| Seed 11 | **2,670 / June 2007** | [61,130, 94,613, 37,863] | **193,606** | **81.34357771903817%** |

Seed 11 has 63,444 residents and 57.047980728952766% approval at its award. Its saved low is 45.95578301881083%, and its recovery hold has reached four months when the absolute route completes six. The seed-7 population and approval are identical to Round 1, so this alternative introduces no further balance change on that gate.

Three scratch-only candidate rules were measured on actual seed-7 bot runs, retaining the 2,500 population floor and the ten-point recovery alternative. These are **options for the lead, not shipped changes**:

| Candidate | Statue day / date | Years 4–6 target |
|---|---|---|
| Absolute threshold **53%**, both holds six months | **2,490 / December 2006** | **Meets** |
| Absolute threshold **52%**, both holds six months | **960 / September 2002** | Too early |
| Absolute threshold **55%**, both holds four months | **2,550 / February 2007** | Too late |

All three unlock through the absolute route; recovery has zero completed months then. The sharp jump between 52% and 53% reflects the bot's early approval plateau and later setbacks. The shipped constants remain **55%, ten points, six months**. Candidate runs stop immediately after the actual award day; their dates are measured, not inferred from the literal run's history.

All five final measurements ran sequentially through `quietrun`. `tsx` remains unavailable as recorded in Round 1, so the measured runners bundle the same `SimBot`, `parseArgs`, `botSystems` and simulation code with Rolldown; only event/result logging and candidate-stop instrumentation are added. No repository bot source or config changed. Exact commands, from this worktree:

```powershell
$quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T070/scratch'
node $quiet node "$scratch/round2-build.mjs"
node $quiet node "$scratch/round2-literal.mjs" --size 128 --years 15 --seed 7 > "$scratch/round2-literal-s7.log"
node $quiet node "$scratch/round2-literal.mjs" --size 128 --years 15 --seed 11 > "$scratch/round2-literal-s11.log"
node $quiet node "$scratch/round2-absolute53x6.mjs" --size 128 --years 15 --seed 7 --stop-at-statue > "$scratch/round2-absolute53x6-s7.log"
node $quiet node "$scratch/round2-absolute52x6.mjs" --size 128 --years 15 --seed 7 --stop-at-statue > "$scratch/round2-absolute52x6-s7.log"
node $quiet node "$scratch/round2-absolute55x4.mjs" --size 128 --years 15 --seed 7 --stop-at-statue > "$scratch/round2-absolute55x4-s7.log"
```

Each log has a corresponding JSON result in that scratch folder. The candidate labels name the absolute route; their bundles retain recovery. The lead's canonical confirmation commands are:

```powershell
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 11
```

### Round 2 validation and handoff

`npx tsc --noEmit`, `git diff --check` and the changed-file UTF-8/no-BOM check pass. **19 targeted files: 398 tests passed, one known missing-fixture test skipped**, each file run separately and sequentially through the quiet gate with the scratch native config. Passing files and case counts:

- `tests/sim/`: `approvalRecovery` (13), `approvalReward` (20), `honours` (84), `ranks` (48), `economy` (12), `milestoneNews` (10), `advisorsTexts` (6), `botVenues` (10).
- `tests/game/`: `approvalRecoveryPanel` (4), `approvalRewardPanel` (4), `honoursPanel` (5), `guideCopy` (137), `cityTeardown` (4), `inspectorRetention` (1), `rewardToast` (7), `thumbsPendingRetention` (2), `uiRuins` (11).
- `tests/worker/`: `hygiene` (18), `replicaSafe` (2 passed; missing grown-city fixture skipped).

Each name has the `.test.ts` suffix. Reproduce a single-file run with:

```powershell
node $quiet npx vitest run tests/sim/approvalRecovery.test.ts --maxWorkers=1 --silent --configLoader native --config "$scratch/vitest.config.mjs"
```

The new tests cover exact ten-point equality below 55%, just-short values, the 2,500 floor, lows observed before that floor, independent full-month holds, interruptions/new lows, no route splicing, partial-month migration, exact save/load continuation, retained legacy 55% progress/earned rewards, no RNG draw and pure mirrored UI progress. The first-partial-month guard now clears that skipped month's interruption flags at its boundary, so they cannot also disqualify the next full month.

The literal seed-7 timing acceptance remains open; **53% / six months** is the measured candidate that reaches years 4–6. The legacy minimum fallback and the timing miss are the plan-versus-code limitations described above. No new worker/save protocol, UI mutation path or shared-file request is needed. Round 2 has **no infra hunk, no source hunk outside `rewards.ts`, and no cloud-held-file request**.

Not verified here: canonical `tsx` reruns, the full suite, the missing grown-city fixture, real-GPU/browser behavior, or a new two-process hash gate. The seed-7 and seed-11 literal 128×15 measurements are complete; no 256×60 rerun was needed for this round. Full-suite/canonical-bot/browser sign-off remains with the lead. Changes remain uncommitted.

Round 2 browser checklist for the lead:

- [ ] Before 2,500 residents, verify the low is recorded while both hold counters remain at zero.
- [ ] In Rewards, verify the OR goal shows the absolute approval route, saved low (rounded to one decimal for display), recovery gain and separate six-month progress.
- [ ] Hold either route through six months, with a daily setback first; verify only that route resets and the eventual toast/placement still works.
- [ ] Save/load during recovery and migrate a Round 1 save; verify the low, both counters and permanent earned Statue remain correct.


## Acceptance amendment (NOTE-066, the lead, 10 Nov)

FH-26 keeps the plan's literal rule: 2,500 residents, plus either 55 % approval or a ten-point recovery from the saved
lowest, held for six months, with both routes shown in Rewards. The acceptance changes from "years 4-6" to **"years 4-7
on the Medium 128x15 bot, on both s7 and s11"**.

| Rule | s7 Statue | s11 Statue | Status |
|---|---|---|---|
| Shipped: 55 % or ten points up, six months | day 2,610, April 2007 | day 2,670, June 2007 | **meets years 4-7 on both seeds** |
| (a) 53 %, six months | day 2,490, December 2006 | not measured | not shipped |
| (b) 52 %, six months | day 960, September 2002 | not measured | not shipped |
| (c) 55 %, four months | day 2,550, February 2007 | not measured | not shipped |

Why the lead kept the literal rule: it gives the same answer on two seeds; option (a) gains four months on one seed
only, inside the bot's fork noise (NOTE-053); 55 % and "ten points up from your lowest" are numbers a player can read;
and the years 4-6 window was the plan's estimate, not a design requirement. The options stay recorded here so the
owner can overrule the choice later. FH-26's designed bot change stands: 192,647 on 128x15 s7.
