# T070: honours and the young-town approval reward

Worktree `local/T070-honours`, based on `1c2019c`. Changes are uncommitted.

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

## FH-26 — A young-town approval reward

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

## Final gates and handoff

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

