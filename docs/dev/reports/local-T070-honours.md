# T070: honours and the young-town approval reward

Worktree `local/T070-honours`, based on `1c2019c`. Round 1 is committed as `b7d40a7`, Round 2 as `1c7d58f`, the acceptance amendment as `93f635c`; the QA round 2 changes (last section) are uncommitted.

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


## QA round 2 — the real-GPU QA's list (B1-B8)

Base `93f635c`, uncommitted. Source: the browser QA on the real GPU (`scratchpad/qa/T070/qa.md`: both items pass on all
three hosts; one visual defect, six small ones, one cost to look at). Scratch for this round:
`scratchpad/lanes/T070/fix2/` (probes, logs, comparisons).

### What changed, by item

| # | Fix | Where |
|---|---|---|
| B1 | The progress bar has a floor of 96 px. `.reward-prog` wraps, and the bar is `flex: 1 1 96px; min-width: 96px`: a requirement that leaves the bar less than that moves under it and wraps over the row's full width; a row whose text fits beside a 96 px bar lays out as before (the bar takes what is left, same 8 px gap). | `src/ui/hud.css` (the two `.reward-prog` rules) |
| B2 | An honour's plaque or garden is in the build menu only once the honour is earned, and then after the tab's own tiles. With no honour earned the "Rewards & business deals" tab is the five tiles it was. Unearned ones stay reachable through `findToolSpec` (the Honours row's Place path) and show their goal in Rewards > Honours. | `src/game/toolCatalog.ts` `plopGroup` |
| B3 | `defIcon` answers `reward` (the trophy) for `rw_honour_*` before the name rules run; the airports' rule is untouched. | `src/game/toolCatalog.ts` `defIcon` |
| B4 | The honour's fanfare waits out `MILESTONE_GAP` (180 ms) after an ordinary reward's chime, as the milestone cues do; alone it plays at once. Its six-second budget is taken at the request, the news budget when it plays; a reset or dispose drops a waiting one. | `src/game/GameSounds.ts` `honour()` + new `fanfare()` / `clearHonour()` |
| B5 | At the boundary that closes an old save's first partial month the four `*Interrupted` flags are cleared, as `updateApprovalReward` does for the Statue. | `src/sim/economy/rewards.ts` `updateHonours` |
| B6 | The tabs sit in a sticky strip at the top of the scrolling body (`.reward-tabs`, the Settings nav's pattern: flush under the panel head, opaque). They stay inside the body, so the panel's markup for the tabs is unchanged apart from the wrapper. | `src/ui/panels/ListPanels.ts` (one line), `src/ui/rewards.css` (one rule) |
| B7 | No power chip on a building with neither a `powerUse` nor jobs. The grid gives such a building 0 MW (`utilities.ts` `fullUse`), and the facility report already warns only for an explicit `powerUse`. | `src/ui/panels/InfoPanel.ts` (the `usesPower` condition) |
| B8 | The monthly survey walks the buildings once and keeps the Large Parks' reach between months (below). | `src/sim/economy/rewards.ts` (the survey block) |

Outside the lane's named files, each a minimal hunk the fix list names: `src/ui/hud.css` (B1), `src/ui/rewards.css` (B6),
`src/game/toolCatalog.ts` (B2, B3), `src/ui/panels/InfoPanel.ts` (B7, one condition and its comment). `GameSounds.ts` is a
shared file: the hunks are the lane's own `honour()`, two new methods beside it, one field, and one line each in the
reset handler and `dispose()`. No `src/sim/infra` hunk, no catalog change, no cloud-held file, nothing new in the save
(the kept reach is runtime state of the rewards system). **Cloud-held-file requests: none.**

### B5 and the bot

The branch is reached only when a monthly check finds the survey data created in the same calendar month: a save without
`honours` data loaded mid-month (its first boundary), or a check repeated on one boundary day. A city founded on day 0
(or the newcomer profile's day 90) starts its data on a boundary and never enters it, so B5 cannot move a fresh city or
the bot. It does change an old save, as intended: on `dense1m_s7` (loaded on day 10,921, with a failed emergency in
that partial month) the Safe City count on day 10,980 reads 1 where `93f635c` reads 0; every survey number is the same.

### B8: the monthly survey

**What it walked.** Not per honour: one survey feeds all twelve (occupied homes, the noisy share, the share within reach
of a Large Park). But each month, and at load, it (1) walked every building to find the Large Parks and searched the
walking reach of each one afresh (18 searches on `dense1m_s7`), into a new cells-sized mask; (2) walked every building
again with a catalog lookup by def id for each one.

**What it does now.** One walk: the first survey's conditions with the cheap ones first, so only finished, standing,
occupied buildings get a def lookup (`rt.defOf`, the runtime's per-building cache). The parks' reach is kept between
surveys, with copies of the two layers a search reads (`network`, `water`; `catchments.ts` `reachRoad` / `nearField`
read nothing else). Before the walk the layers are compared with the copies; a park is searched again only when a cell
changed inside the box of the cells it marks or within two cells of it (the rule `services.ts` `invalidateReach` uses
for its own kept reaches), together with any park whose marks the cleared box held. The walk collects the standing
parks; when one came or went they are all searched and the homes counted again. Nothing is kept once Green Belt is
earned or while no Large Park stands.

**Why not daily slices**, as the other monthly growable passes do it: a sliced survey reads each building on a different
day, so its three numbers differ from the survey at the boundary, and an honour could be earned in another month. The
walk at the boundary is the only exact form short of an event for every `pop` / flag write, which the sim does not have.
The comparison of the layers is a scan (two layers, four cells a step) rather than `networkChanged` /
`terrainChanged` listeners, for the reason `services.ts` `checkNetwork` hashes them: edits that bypass the events.

**The same answers.** Proof, in order of strength:
- `tests/sim/honoursSurvey.test.ts` keeps the `93f635c` survey as an oracle (every park searched afresh, every building
  looked up) and compares the three saved numbers with it, exactly, after every month: 24 named changes written
  straight into the state with no event (homes, roads, a highway, a rail crossing, water, a moat that cuts one home off,
  parks opened, burnt, abandoned, bulldozed, replaced in one month), three seeds x 60 months of random edits on a town,
  three seeds x 90 months of single-cell edits at every distance from a park with a home on every free cell (a cell
  that enters or leaves the reach is a home counted or not), the far ends of a one-street reach cut and rebuilt along
  both axes, Green Belt earned, a second city loaded into the same simulation. The file was run against 23 deliberate
  breaks of the shipped code (`fix2/mutate.sh`: a layer not compared, the park list compared by count only, the box or
  the cleared area one cell short on each side, neighbours not searched again, the copies not refreshed, a condition
  of the walk dropped, ...): 21 fail it. The other two (a park flagged without the two-cell margin; a changed word
  flagging its first cell only) cannot change an answer with the kernel as it is, where that margin is spare.
- The lane's own tests pass unedited (`honours` 84, `approvalReward` 20, `approvalRecovery` 13, the panels, sounds,
  perks and assets).
- The 128x15 s7 bot, before (clean `93f635c`) and after, same commands: the canonical stdout with `SIMBOT_LOG=1`
  (1,182 lines: table, residents, budget, the 1,103-entry action log, news) has **0 differing lines** apart from the
  wall-clock columns; a read-only trace beside it has the same 39 unlocks on the same days (Statue day 2,610, Safe City
  day 5,400), the same saved honours and Statue data at all 180 month ends (the survey's numbers move in every one of
  them; the park share is live for all fifteen years, Green Belt is not earned), and the same sha256 of the whole
  serialized city (`fe841faa5f72b5af…`).
- `dense1m_s7` headless, 17 month ends, six of them after an edit made through `CityActions` (a road cell beside a
  Large Park bulldozed, rebuilt, a new Large Park, a park bulldozed, water dug in a park's near field, a street stub):
  the saved survey equals the `93f635c` survey run on the same state in every surveyed month, and equals the clean
  tree's own run row for row.

**The cost.** `dense1m_s7.region.metropolis` loaded headless (node 22.12; 1,118,755 residents, 17,154 buildings, about
12,300 occupied homes, 18 Large Parks, Green Belt not earned), `economy.rewards` `monthly()` timed with
`performance.now()`. The machine was shared with other agents' browser runs throughout (16 threads at 100 % for most of
it), so read the ratios, not the last digit; the lead's clean-slot `qa/T070/timing.mjs` is the measurement of record.

| | `93f635c` | this round |
|---|---|---|
| One survey in isolation, first call in a fresh process (cold code); scratch copies of the two surveys, the new one being the steady month's work: the walk on the kept reach and the comparison of the two layers | 5.7 / 6.3 ms (2 processes) | 1.9 - 3.9 ms (7 processes) |
| The same, repeated back to back (warm) | 0.75 - 0.95 ms | 0.21 - 0.32 ms |
| `monthly()` in the running sim, clean tree, 9 full-survey months | median 2.07, mean 4.53, max 18.5 ms | |
| `monthly()` in the running sim, the shipped code, 8 runs: the eight months without a change after the first; median per run | 1.3 - 2.0 ms (the old survey run in place right after it, same months) | 0.94 - 1.6 ms |
| The survey repeated nine times on the month's state, best of nine, median per run (7 runs) | 1.00 - 1.11 ms | 0.52 - 0.57 ms |
| The first full survey after the load | 5.9 ms (the clean tree's run) | 4.9 - 7.4 ms in seven runs, 17.9 in one |
| A month after a road cell beside a Large Park was removed or rebuilt, twelve in a row, 3 runs (`probe-edits.mts`): the first three months; then the other nine, median per run | in place: 1.4 - 14.7 ms; then 1.21 - 1.27 ms | 1.3 - 3.1 ms; then 0.77 - 0.99 ms |
| A month in which a Large Park was built, or one bulldozed (once each per run, so the path's first run), 8 runs | in place: 1.2 - 2.7 ms | 2.2 - 4.5 ms (14.0 and 6.5 once each) |
| Work in a month in which a road or water cell changed beside a park | every park searched, as every month | only the parks near it |
| Work in a month in which a Large Park came or went | as every month | all parks searched and a second walk |
| Mask allocated | 64 KB every survey | once, while a Large Park stands |

Reading it:
- A month in which nothing changed near a park, which is most months, costs about two thirds of the old survey run in
  place under this load (0.52 - 0.96 across the eight runs), half of it back to back on the same state, and a third to
  a quarter of it in isolation.
- A month after a road change beside a park is on par for the path's first runs and about a third cheaper after them.
- Two cases are **not cheaper**. A month in which a Large Park came or went costs a second walk and every park
  searched, on a path that runs rarely and therefore cold: about 3 ms here against 1.5 ms for the old survey, which did
  that work every month and so kept it warm. And the first full survey after a load (the comparison's first run plus a
  cold walk) measured about what the old one did. `timing.mjs` starts from a load, so its max is that month; its mean
  should show the gain.
- In the running sim a monthly hook is often cold (the engine drops optimized code between calls a month apart: the
  walk alone alternates between about 0.7 and about 4 ms under this load, whatever its shape). The isolated cold row
  is the nearest to what the QA's 6.7 ms in Chromium was: about 6 ms before, 2 to 4 ms now.

What is left is one pass over 17,000 building objects, which only an event for every `pop` and flag write could
replace; `daily()` stays about 0.01 ms. For scale, on the same city in the same runs `economy.budget`'s monthly is
1.4 ms median / 4.2 mean and `emergency`'s 0.5 / 0.8.

### Known behaviour, not changed: silent grants

An honour whose condition already holds when an older save loads is granted without a toast, a fanfare or a badge
(the QA's O2: Quiet City on `vet21`, Tourist Capital on `vet43`, Transit Capital and Megacity on `dense1m`). Reason:
`rewardsSystem.init` runs `check(sim, true)`, the silent pass every reward uses on load, so that loading never replays
announcements; it also marks the honour announced, so it will not be announced later. For an old save there is no moment
in play at which the honour was earned, several can arrive at once, and at `init` no UI listener is attached yet (the
scene subscribes after the simulation exists), so a visible grant would need a deferred "since you were away" path in
Notifications and GameSounds: a design decision, not a fix. The player finds them under Rewards > Honours ("Earned", the
plaque placeable from the row and, since B2, in the build menu).

### Tests

New (50 cases, all pass; each file also fails on the unfixed code):
- `tests/sim/honoursSurvey.test.ts` (25): B8 `surveys the town at load as the first survey did`, `follows every kind of
  change between two monthly checks, with no event to announce it`, `searches the parks again only when a park, the
  network or the water changed`, `searches only the parks whose surroundings changed`, `follows the far ends of a reach
  when its one street (along x | z) is cut, shortened and rebuilt`, `keeps a fresh search's cells when single cells
  change at any distance from a park (every free cell a home, seed 5 | 17 | 41)`, `agrees with the first survey through
  sixty months of random edits (seed 3 | 11 | 29)`, `stops surveying the park share, and lets the reach go, once Green
  Belt is earned`, `searches a city loaded into the same simulation afresh`, `draws no random number and leaves the
  layers it compares alone`; B5 `<streak>: a setback inside it does not cost the next full month` (x4), `<streak>: a
  setback in the first full month still costs that month` (x4), `a setback on the day the partial month closes belongs
  to it`, `a check repeated inside a month keeps that month's setbacks`.
- `tests/game/honourToolCatalog.test.ts` (9): B2 `names every honour building by its requirement, and nothing else`,
  `keeps the Rewards tab to its own tiles, in their order, while no honour is earned`, `adds an earned honour's plaque
  and garden after them, unlocked`, `shows all fourteen once every honour is earned`, `waits for the honour in a sandbox
  city too`, `leaves the other groups as the catalog lists them`, `still finds a plaque's tool by its id, in the
  toolbar's category only once it is in the menu`; B3 `is the reward icon for all twelve, whatever the honour is
  called`, `leaves the airports their plane and the deals their icons`.
- `tests/game/rewardRowLayout.test.ts` (6): B1 `the bar has a floor it starts from, and the row wraps instead of
  squeezing it`, `the text keeps its own width: a short requirement stays on the bar's line`, `the rows these rules
  style: the bar, then the requirement, in one .reward-prog`; B6 `the tabs sit in a strip of their own, the first thing
  in the scrolling body, before the list`, `the strip is sticky at the top of the body, above the rows and opaque`,
  `the strip covers the body's top and side padding, so it is flush under the panel head and no row shows beside it`.
  These pin the CSS rules and the markup; the layout itself is a browser check.
- `tests/game/honourRewardSounds.test.ts` (6): B4 `plays the chime at once and the fanfare 180 ms after it`, `waits only
  for what is left of the gap`, `does not wait when the chime is further back than the gap, or was never played`,
  `several rewards and several honours at one check: one chime, one fanfare`, `the waiting fanfare keeps the month's
  other sounds out: a good-news chime of the same burst, the budget tick`, `a new city, or leaving the city, drops a
  fanfare that is still waiting`.
- `tests/game/honourInspector.test.ts` (4): B7 `the fixtures are what the rule is about`, `none on a plaque, a memorial
  garden or a statue off the grid: they use no power`, `"No power" on what does draw it: the chip for staff alone, the
  facility's own warning for an explicit use`, `a park without a power use: none, as before`.

Gates run here, each file alone through `quietrun`:
- `npx tsc --noEmit`: pass. `git diff --check`: pass. Changed and new files UTF-8, LF, no BOM.
- **66 test files, 909 passed, 4 skipped** (the missing-fixture skips as before): the five new files; the lane's
  `sim/honours` 84, `sim/approvalReward` 20, `sim/approvalRecovery` 13, `game/honoursPanel` 5, `game/honourSounds` 7,
  `game/approvalRewardPanel` 4, `game/approvalRecoveryPanel` 4, `infra/honourPerks` 5, `assets/honours` 5, none of them
  edited; and every test that imports a touched file or runs the economy systems (`game/` gameSounds, milestoneSounds,
  rewardToast, ruinState, uiRuins, uiRubble, uiFireHint, uiCardTip, uiPanelReserve, uiStacking, upkeepReads,
  panelsUpkeep, panelCommands, budgetPreview, queryReads, rankFireworks, guideCopy, cityTeardown, inspectorRetention,
  thumbsPendingRetention; `sim/` economy, ranks, milestoneNews, monthSpread, growth, tourism, demographics,
  desirability, approval, catalog, advisorsTexts, balanceOrphans, breakdownRetention, finalFixesEcon, foundingDay,
  phase0Contract; `infra/` catchments, facilities, feedbackFacilities; `save/` serialize, grownCity; `assets/` manifest;
  `wasm/` the four files; `worker/` hygiene, commands, localSimHost, milestoneCard, replicaSafe, simwasmFlag).
  The whole list was run twice, the second time on the final tree. `worker/hygiene` timed out in three of its
  tree-scanning cases on the first pass and in one on the second (5 s limit, the machine at 100 % CPU); alone it passes
  18 / 18 each time, with the default limit and with 30 s.
- The bot, `SIMBOT_LOG=1 npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` through `quietrun`:
  **`residents [ 61566, 92988, 38093 ]` = 192,647**, `loans 0; unlocked 39; approval 82`, identical to the clean tree
  as described above.

### Notes for the lead

- B7's condition is the one the list asks for, and it reaches further than the honours: the Statue of the Mayor, the
  Lighthouse, the Clock Tower, the Obelisk, the Triumphal Arch and the Bus Stop also have neither a power use nor jobs,
  draw 0 MW, and lose their "Powered" / "No power" chip (69 of 88 ploppables showed one, 49 do). Narrowing it to
  `requires` starting with `honour_` is a one-token change if that is not wanted.
- B2 in sandbox: the sim still accepts any `requires` in a sandbox city, so before this round an unearned plaque could
  be placed from the menu there. It is now hidden until earned, in line with "honours are earned in sandbox too".
- B2 does not move the catalog block: the tab's order is made in `plopGroup` (the bot and other code walk the catalog).
- The survey still calls `catchments.reachRaw` from `economy.rewards` (at load, and when a park or its surroundings
  changed). B2_DESIGN keeps `reachRaw`'s shared engine "inside one call" and gives the resumable searches private
  buckets, so this stays safe after the step split; it is the one coupling to remember.
- The QA's O1 and O3-O9 are untouched (observations for the lead).

### Not verified here

The full vitest suite, any browser or real-GPU check, and the clean-slot timing (`qa/T070/timing.mjs`): every cost
above was measured on a loaded machine. The 256x60 bot was not rerun: the sim-side change is exact, and the 128x15
trace exercises the kept reach in all 180 months. B1 and B6 are checked only as rules and markup. Plan-versus-code
differences: none new.

### Browser recheck list

- [ ] B1: Rewards tab at 1280x720 and 1920x1080: the Statue row's bar is at least 96 px wide with its fill drawn and the
  requirement wraps under it; Honours tab, all twelve rows: no 0 px bar; the short rows (City Hall and the like) look
  as on the base (`ab-rewards.jpg`).
- [ ] B6: scroll both lists: the tabs stay under the panel head, rows pass under the strip; a toast's "Place it"
  centres its row with the tabs in view; switch tabs while scrolled; the strip's look on the glass panel.
- [ ] B2: build menu > Rewards > "Rewards & business deals" shows five tiles; earn Green Belt (the y2 save and four
  Large Parks): its plaque appears after the deals, unlocked, and places from the tile and from the row; sandbox: none
  until earned.
- [ ] B3: the Clean Air Metropolis row and (once earned) its tile show the trophy.
- [ ] B4: the Obelisk + Green Belt check on day 780 (`honours2.mjs collide`): two `reward` requests 180 ms apart, both
  with oscillators; an honour alone sounds at once.
- [ ] B5: `vet21_mid` with a 9.5 % tax for two days inside the partial month: Balanced Books 0, 1, 2, 3 at the four
  boundaries.
- [ ] B7: the inspector of a plaque, the Eco Plaza and the Memorial off the grid: no power chip; a Military Base off the
  grid still says "No power".
- [ ] B8: `timing.mjs` in a clean slot; the honours survey on `dense1m` and `b19` reads the same numbers as in the
  QA's survey json.
