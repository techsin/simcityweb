# T092 report: LG-14, scenarios and optional challenges (desktop lane)

**Verdict: done, except one hunk in a cloud-held file.** Every Change line of LG-14 is implemented (D9's three
scenarios: Boomtown, Lights Out, Smog City; medals per profile; the pinned objectives card with its briefing and
win / lose card; the four Mayor's challenges with region-card badges). Every Acceptance line has a test or a reference
run that passes. One request goes to the lead: **the App wiring in `src/main.ts`** (cloud-held), without which the
title screen does not show the Challenges entry. The patch is below. It applies cleanly to this base, and on a patched
copy tsc is clean and the wiring test passes.

- tsc clean. All lane tests and the related existing tests pass, run one process at a time through quietrun.
- **128x15 s7 bot identical to its base:** residents [ 61124, 93804, 37971 ] = 192,899. Every row of the table and the
  jobs / caps line match the base run line for line.
- No balance change for a city without a scenario or challenge. Medium and Hard stay bit-identical.
- One `src/sim/infra/*` hunk (`disasters.ts`, 2 lines) for B2.

Branch `local/T092-scenarios`, based on `825ee224` plus the task commit `e67923c2`. Everything is uncommitted: no
commit, push, merge or `.done` file.

## Who did what

The lane was started by a first agent, which a usage limit stopped part-way, and finished by a second.

- **First agent:** everything in the diff below except the four items in the next list:
  - the code, the CSS and the six test files;
  - `tools/scenarios.ts` and the two bundles;
  - the main.ts patch (kept in scratch);
  - the base bot run;
  - a full round of test runs and 15 mutation runs (`scratch/mut/`).
  Its last step moved the saved record's type (`ScenarioRecord`) into `src/sim/config.ts`, so `src/sim` imports
  nothing from `src/game`, not even a type.
- **Second agent:**
  - Reviewed the whole diff against the task, the plan item, its decisions and the code it touches.
  - Ran the bot after the change and compared it with the base.
  - Rebuilt the bundles in memory to check the files on disk are what the tree writes (byte-identical).
  - Made four changes:
    1. The briefing waits for another dialog over the city, so it never stacks on a storage dialog or a guide's own
       card. One new test; two mutations checked.
    2. A test that the menu and briefing texts match the bundles. Two mutations checked.
    3. A wrong comment in `TitleScreen.ts`.
    4. "1 months" in the tool's output.
  - Re-ran every lane test, the related existing tests, the hygiene test and the long reference runs.
  - Checked the main.ts patch on a scratch copy of the tree: tsc, and the wiring test that is skipped until the hunk
    lands.
  - Wrote this report.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean (also clean on a scratch copy with the main.ts patch applied) |
| Lane tests (6 files, one at a time) | **114 passed, 4 skipped** (the main.ts wiring test until the hunk lands; three ten-year runs, opt-in with `SCENARIOS=1`) |
| `SCENARIOS=1` reference runs | **14 / 14 passed** (`tests/sim/scenarioRuns.test.ts`) |
| `npx tsx tools/scenarios.ts --verify` | **9 / 9 ok** (table below) |
| Bundles rebuilt in memory | byte-identical to the files on disk (sha256 below) |
| `tests/worker/hygiene.test.ts` | 18 passed |
| Related existing tests (29 files) | **476 passed** (list under Tests) |
| 128x15 s7 bot | **identical:** residents [ 61124, 93804, 37971 ] = 192,899 in 2015, the same table row by row as the base run |
| `git diff --check`; BOM / CR scan of every changed and new file | clean |

**Bot comparison.** The task names 192,899 for base `825ee224`. The first agent ran the bot on the base before any
change (`scratch/bot_base_128x15_s7.out`). The second agent ran it on the finished tree
(`scratch/r2_bot_after_128x15_s7.out`). The two outputs differ only in the timing columns. Dev's later reference
(T041: residents [ 61580, 93090, 37566 ] = 192,236) is for a newer base, so it does not apply here.

```
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

## What LG-14 asked, and where it is

**Change lines**

- **A Challenges menu on the title screen, with scenarios generated from fixed bot seeds.**
  - The title has a "Challenges" entry after Load Region, with the profile's medal count as its sub-line
    (`TitleScreen.ts`, shown when the App passes `onChallenges`). It opens the Challenges dialog
    (`NewCityDialog.ts` `openChallengesDialog`): the three scenarios, what each medal takes, and the profile's best.
  - `src/region/challenges.ts` starts the chosen scenario, each in a region of its own with a unique id, so an earlier
    attempt or a player's region is never touched:
    - Boomtown is a new region whose recommended 128 tile is founded through the App's `startNewCity`, on day 90 (D11).
    - Lights Out and Smog City are bundled one-city region files. A bundle is fetched, given a fresh region id, and
      stored through the save layer's own `importRegion` (the path Load Region uses). The App then opens the stored
      city like any saved one: the worker boots on the record (W1.2 / W1.3), or the local host loads it. The bundled
      cities keep their own dates (D11).
  - `tools/scenarios.ts` builds the bundles from the default seed-7 bot run (128 cells, Medium, plains, water 0.2),
    deterministically.
- **The three scenarios (D9)**, in `src/game/scenarios.ts`, judged by `evaluateScenario`, a pure function of mirrored
  state:

  | scenario | start | goal |
  |---|---|---|
  | Boomtown | the bot's empty 128 map, §100,000, Medium, disasters off | best monthly residents sample in the 10 years since founding: 50k / 100k / 150k for bronze / silver / gold; gold ends it at once |
  | Lights Out | the bot city, 1 February 2008, 71,043 residents, approval 62. Its largest plant (the 250 MW Natural Gas Power Plant, §22,000) burned down by the fire system's `burnDown`; §15,000 in the bank; two start loans on record | the first month (1-12 after the start) whose sample has both 70,000 residents and 60 approval: within 12 / 9 / 6 months; gold also needs no new loan |
  | Smog City | the same bot city, 1 January 2015, 192,899 residents, unchanged | the 12-month average of air pollution at homes (`history.air`) 40% below the 12 months before the start, in a month with 180,000 residents: within 10 / 6 / 3 years (tiers are a choice for the lead, below) |

- **Medals saved per profile.** The best medal per scenario and each scenario city's outcome are stored in
  localStorage (`metropolis.ui.scenarios`, through `loadPref` / `savePref`, like the other per-profile prefs).
  - A better medal, or the same medal in fewer months, replaces the best.
  - A city's decided outcome is never replaced.
  - The newest 40 scenario cities are remembered; medals are kept regardless.
- **A pinned objectives card that updates monthly, and a win or lose screen** (`src/ui/ObjectivesCard.ts`, mounted by
  one line in `CityScene.ts`). It sits at the top of the top-left HUD column, above the guide card and the toasts.
  - It re-judges on the host's `month` and `reset` events. The UI tick only compares a few numbers, so a loan shows at
    once and a month whose history arrives after its event is still read in that month.
  - Each goal is a line with its figure and a bar, and the three medals are lit or struck out. The card minimises to a
    pill.
  - The briefing shows once per scenario city, at its start, paused.
  - The outcome is recorded the month it is decided. The win / lose card then opens paused, once no New Year show,
    LIVE emergency or other dialog is running.
  - Its buttons are "Keep playing" and "Exit to region" (the game's own exit).
- **Mayor's challenges** as toggles in the New City dialog: No loans, No dirty industry, Frequent disasters, Hard money.
  - They are chips under the options, with their rules spelled out, and none in Sandbox. They are saved in
    `config.challenges`.
  - Each is a rule of the simulation, in the new `src/sim/economy/challenges.ts`:
    - **No loans:** the bank lends nothing, with a reason the Budget panel shows.
    - **No dirty industry:** I-D gets no growth allowance; farms, manufacturing and high-tech still grow.
    - **Frequent disasters:** the same single monthly draw, twice as likely.
    - **Hard money:** Hard's §40k start and its tax income on any difficulty.
  - Each earns its badge on the region card. The tile card shows the city's challenges, lit once earned. The region
    card lists every badge its cities have earned.

**Acceptance lines**

| Line | Evidence |
|---|---|
| Every scenario starts from the menu | Title entry → dialog → `startScenario` → App: `challengesDialog.test.ts` (title, dialog, Boomtown planned and handed to the App behind one loading screen, a bundle fetched, imported and opened, failures reported). **The App side needs the main.ts hunk** (request below). Its test is in the same file, skipped until the hunk lands; it passes on a patched copy. |
| Each has a bot strategy that reaches bronze, and a do-nothing run that fails | Reference runs below: Boomtown bot bronze / nothing lost; Lights Out loan silver / nothing lost; Smog City clean-up gold / nothing lost. |
| Lights Out: a run that only buys one replacement plant earns at most bronze; without the start-money limit it would earn gold | "one plant" lost (at most bronze), "no limit" gold in month 1. Reading below. |
| The objectives card updates monthly; medals persist across reloads | `objectivesCard.test.ts` (month event, not the days between; a reloaded city keeps its outcome, no second card); `scenarios.test.ts` (the profile survives a reload); title and dialog show the medals. |
| Every bundled file loads at HEAD (the audit's old-save method, as a test) | `scenarioBundles.test.ts`: each file is read as shipped, then goes through `migrateRegion` / `migrateCity` and `deserializeCity`, runs 60 days on every system, and saves again. `challengesDialog.test.ts` also imports both through `importRegion` and loads them back with `loadCity`. |

**Reference runs** (`npx tsx tools/scenarios.ts --verify`, on the bundles on disk; each judged by `evaluateScenario`
month by month):

```
ok   boomtown   bot       bronze after 120 months    expected: bronze or better Residents 99,729 / 100,000
ok   boomtown   nothing   lost after 120 months      expected: fails            Residents 0 / 50,000
ok   lights_out nothing   lost after 12 months       expected: fails            Residents 419 / 70,000; Approval 54% / 60%
ok   lights_out loan      silver after 1 month       expected: bronze or better Residents 72,419; Approval 64%; a loan was taken
ok   lights_out one plant lost after 12 months       expected: bronze at most   Residents 419 / 70,000
ok   lights_out no limit  gold after 1 month         expected: gold             Residents 72,419; Approval 64%
ok   lights_out squeeze   gold after 5 months        expected: gold             Residents 74,525; Approval 61%; no loan
ok   smog_city  nothing   lost after 120 months      expected: fails            Air +79% / −40%; Residents 303,845
ok   smog_city  clean-up  gold after 10 months       expected: bronze or better Air −42% / −40%; Residents 189,188
```

Strategies (`tools/scenarios.ts`):
- **Lights Out:**
  - "loan": a loan and the same plant again on day one.
  - "one plant": no loan; the same plant as soon as the bank can pay for it, which it never can.
  - "no limit": the same, with the plant's price in the bank.
  - "squeeze", beyond the acceptance: no loan; taxes 14% and six services at 50% until the plant is affordable.
- **Smog City "clean-up":** the clean-air ordinances; the I-D zones cleared and rezoned high-density industry; a
  nuclear plant in place of the fossil plants.

Bundles (`src/game/scenarioBundles/`, rebuilt in memory by `npx tsx tools/scenarios.ts` and identical to disk):

- `lights_out.metropolis`, 1.27 MB, sha256 `97ef59be9ee880911f9df88a7a198472c7e2726308f7e40c5c8a92e60260fb95`;
- `smog_city.metropolis`, 1.33 MB, sha256 `2d513e17eb6b1480a9adf8fedb2b8bbe812fa0233185b05860398ac8f995e6ea`.

## Changes per file

**Named by the task**

- `src/game/scenarios.ts` (new): the scenarios and their figures; `evaluateScenario` (pure: reads day, stats, history
  and loans; no simulation, no RNG); the result texts; the profile record (medals, per-city memo); the Mayor's
  challenges' names, `applyChallenges` (the dialog's picks onto a config) and `challengeStatus` (the card's badge bar).
- `src/region/NewCityDialog.ts`, all in its own LG-14 section at the end of the file, kept apart for T091 (LG-12),
  which edits the same file:
  - `challengePicker`: the chips, their rules and Sandbox handling.
  - `openChallengesDialog`: the scenario choice.
  - Five small hooks inside `openNewCityDialog`:
    - the picker under the options;
    - Sandbox clears and disables it;
    - Disasters off drops Frequent disasters;
    - Frequent disasters switches Disasters on;
    - the result goes through `applyChallenges`.
- `src/region/ui/TitleScreen.ts`: the optional `onChallenges` entry after Load Region, with its sub-line. The entries
  after it arrive one animation beat later; without it the menu is as before.
- `src/ui/ObjectivesCard.ts` (new) and `src/ui/objectives.css` (new): the card, briefing and result cards.
- New tests: the six files listed under Tests.

**Hunks outside the named files** (each minimal and self-contained, so it can be committed on its own)

- `src/game/CityScene.ts`, 4 lines: `new ObjectivesCard(ctx, tl)` after the PauseMenu, plus its import. A plain city
  gets no card and no listener.
- `src/region/RegionScreen.ts`, 5 lines: the region card's badge row and the tile card's badges.
  T091 also edits this file; the hunks are separate lines.
- `src/region/citySummary.ts`, 14 lines: the tile summary's optional `scenario`, `challenges` and `badges` (a city with
  neither gets no key).
- `src/region/types.ts`, 5 lines: those three optional summary fields. T091 also edits this file.
- `src/sim/config.ts`, 21 lines: `CityConfigData.challenges?` and `CityConfigData.scenario?`, both optional (old saves
  load as free play), and the `ScenarioRecord` type the save carries.
- `src/sim/economy/budget.ts`, 2 lines: the tax multiplier reads `difficultyRules(moneyDifficulty(st.config))` (Hard
  money). Without the challenge it is `config.difficulty`, as before.
- `src/sim/economy/growth.ts`, 3 lines: `allow[DevType.ID] = 0` under No dirty industry, after the family caps (a shared
  file; its own place).
- `src/sim/economy/loans.ts`, 4 lines: No loans in `maxLoanAmount` and `loanOffer`.
- **Infra hunk (B2):** `src/sim/infra/disasters.ts`, 2 lines: an import, and `const r = this.rng.next() /
  disasterRate(st.config);`. That is the same single draw; dividing by 1 is exact, so a plain city is bit-identical.

**New files outside the named ones**

- `src/sim/economy/challenges.ts`: the challenge rules (no runtime imports).
- `src/region/challenges.ts`: starting a scenario, and the region-screen badges.
- `src/region/ui/challenges.css`.
- `src/game/scenarioBundles/lights_out.metropolis` and `smog_city.metropolis` (`*.metropolis -text` in
  `.gitattributes`).
- `tools/scenarios.ts`: SIM's new file per §7.2; the plan lists it under LG-14.

**Second agent's changes** (on top of the first agent's work):

- `src/ui/ObjectivesCard.ts`: the briefing waits while another dialog is over the city (any `.modal-back`, a
  confirmation or the storage dialog), as the result card already did, and then opens once. Before, it opened at once
  and could stack on another card. Test: "a dialog already over the city when it opens … keeps the briefing waiting".
  Mutations: removing the constructor's guard, or the tick's late opening, each fails that test only.
- `tests/save/scenarioBundles.test.ts`: the briefings and taglines quote the bundles (the month and year, the
  population to the thousand, the burnt gas plant). A regenerated bundle that no longer fits its text fails. Mutations:
  "72,000" in Lights Out's tagline, or "February 2015" in Smog City's brief, each fails it.
- `src/region/ui/TitleScreen.ts`: the option's comment said the entry sits elsewhere on a fresh profile. It always
  sits after Load Region.
- `tools/scenarios.ts`: `outcome()` says "1 month".

## Readings and choices for the lead

1. **Smog City's medal tiers** are a choice: the plan gives one goal (within 10 years), and the code makes 10 / 6 / 3
   years bronze / silver / gold. The clean-up strategy reaches gold in 10 months, so gold at 3 years may be generous;
   a playtest could tighten it (`SMOG_CITY.months`).
2. **Lights Out burns a gas plant, not a coal plant.** The plan says "coal plant", but the seed-7 bot city of February
   2008 runs on a Natural Gas Power Plant (250 of its 268 MW), so the scenario burns that. The briefing and the news
   say gas. §15,000 is less than the gas plant (§22,000), the coal plant (§25,000) or the oil plant (§30,000). With
   §15,000 the player can still buy about 18 wind turbines (90 MW) or, where there is shore, a hydro dam (80 MW): half
   the 194 MW demand.
3. **Reading of the Lights Out line.** "A run that only buys one replacement plant" is read as no loan and nothing
   else. Such a run never holds the plant's price, so it loses, which is at most bronze. With the price in the bank the
   same run is gold in month 1.
   - A loan-funded plant earns silver: the plan's own rule ("gold also needs no new loan") means a loan run can reach
     silver.
   - Gold without a loan is in reach: the squeeze run gets it in month 5.
4. **"Keeping 180k people"** is read as 180,000 residents in the month the air goal is met. The other reading is that
   the city never drops below 180,000 at any time.
5. **"No new loan"** means no loan beyond the two the city starts with (matched on principal and rate), at any time
   before the outcome is decided. A loan taken and repaid still counts: the month's `oneoff:loan` ledger shows it, and
   the profile remembers.
6. **When a challenge earns its badge** is a choice: once the city reaches the City rank (25,000 residents;
   `systemData.cityRanks`, so a later drop keeps it). The plan does not say. `CHALLENGE_BADGE_RANK` /
   `CHALLENGE_BADGE_POP` set it.
7. **What a profile keeps.** Medals and per-city outcomes are per profile ("saved per profile"). The city's save
   carries `config.scenario` and `config.challenges`; the scenario's progress comes from the city's saved history.
   - Because of that, the card writes nothing into the sim, needs no new worker command, and a restore or a journal
     replay cannot change a recorded outcome.
   - The cost: a city opened on another profile, or after its record was dropped (beyond 40 scenario cities), is judged
     again from its history and shows its result card once more. If that city took a loan after winning Lights Out
     gold, it is re-judged silver.
8. **The title entry's place:** after Load Region and before Settings, on a fresh profile too. The task says "beside
   FH-12's Start your first city"; this lane reads that as the same menu, not the adjacent slot. Moving it is one line
   in `TitleScreen.ts`.
9. **The ten-year reference runs are opt-in in vitest:** Boomtown bot, Boomtown empty land, and Smog City left alone.
   They take about 25 s together on this machine. Run them with `SCENARIOS=1` or `npx tsx tools/scenarios.ts
   --verify`, or drop the `skipIf` to make them part of the default suite.
10. **After merging onto dev's newer balance (T041):** the shipped bundles stay valid saves, but `tools/scenarios.ts
    --write` would now write different cities.
    - Either keep the files, or regenerate them and re-run `--verify`. The new bundle-text test then says whether the
      briefing figures still fit.
    - Of the reference runs, the squeeze run's "gold within 6 months" is the most balance-sensitive check. It goes
      beyond the acceptance.
11. **Bundled-file import "through the host"** is read as through the save layer and then the App's normal city
    entry: the worker or the local host loads the stored record. No new protocol command was needed. The import itself
    runs on the main thread, as Load Region's does.

## Hooks for the lanes that are not in dev

- **LG-09 / T042 (Hard money).** No scenario waits for T042: none of the three uses Hard money. Only the "Hard money"
  Mayor's challenge does.
  - It is built on dev's rules: Hard's §40k start, set by `applyChallenges`, and Hard's 0.85 tax income, read through
    `moneyDifficulty(config)` in `budget.ts`.
  - The hook when T042 lands is one line per T042 money rule: where T042 reads Hard's running-cost multiplier (services
    ×1.15, `OPEX_PER_SERVED`), it reads `difficultyRules(moneyDifficulty(st.config))` in place of
    `difficultyRules(st.config.difficulty)`.
  - Choice for the lead: this lane counts start money, tax income and running costs as "money". It leaves Hard's tax
    approval −4.5 / point, disasters ×1.5 and the 12-month bankruptcy removal with the difficulty. If the lead wants the
    removal under Hard money too, the same `moneyDifficulty` read applies there.
- **LG-15 (disaster frequency).** Frequent disasters is LG-15's "Frequent ×2", applied on the same single draw.
  - When LG-15's per-city `disasterRate` lands, `disasterRate()` in `challenges.ts` is the one place to merge them, for
    example the larger of the two.
  - The New City dialog then has both a frequency control and the chip. The chip could simply select Frequent.
- **T037a (the guide) and scenarios.** A scenario never writes the guide's settings: the start flow writes neither
  `metropolis.ui.onboarding` nor `metropolis.ui.newCity` (tested). The guide decides for itself, as in any city:
  - In **Boomtown**, a new city, the guide opens unless the profile dismissed it, or a New City dialog's Guided start
    was switched off. The objectives card sits above the guide card. The briefing pauses with the pause source and
    resumes to the speed the city had, which for a new city is paused, so it does not take over the guide's "Press
    play".
  - In **Lights Out and Smog City**, big cities, today's guide does not open, since it is only for young cities.
  - The briefing and the result card wait while another dialog is over the city (any `.modal-back`), so a first-city
    card from T037a never stacks with them, provided T037a's dialogs use that class like every HUD dialog in dev.
  - No guide API is used beyond what is above.

## Requests for cloud-held files

**`src/main.ts`, `App.showTitle()`** (the cloud's Worker lanes hold the App wiring). Add the title's `onChallenges`, so
"Every scenario starts from the menu" holds:
- Boomtown is founded through the App's own `startNewCity`, as FH-12's first city is: the new region becomes the App's
  current region (`this.region = model`), then the city is founded behind the loading screen the start already shows.
- A bundled scenario's stored city is entered through `continueInCity` with `gate = false`: a freshly imported city has
  no unsaved progress to ask about.

```diff
@@ imports
 import { createFirstCity, firstCityTips, hasSavedRegion, lastCityTileKey } from './region/firstCity';
+import { runChallenges } from './region/challenges';
@@ App.showTitle(): new TitleScreen(this.root, { ...
       onLoadRegion: () => openLoadRegion((r) => void this.openRegion(r)),
+      // LG-14: the Challenges menu (src/region/challenges.ts): Boomtown is founded like any new city, a bundled scenario
+      // is imported as a region of its own and its city entered like a saved one
+      onChallenges: () => void runChallenges({
+        found: (model, tile, cfg, ld, t0) => { this.region = model; return this.startNewCity(model, tile, cfg, t0, ld); },
+        open: (region, tileKey) => this.continueInCity(region, tileKey, false),
+      }),
       onSettings: () => openSettings((s) => (this.settings = s)),
```

The full patch is `scratch/T092-main-wiring.patch`, in the lane scratch folder
(`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T092/scratch/`).
Checked:
- `git apply --check` passes against this base's main.ts.
- On a scratch copy of the tree with the patch applied, tsc is clean.
- `challengesDialog.test.ts`, `firstCity.test.ts` and `scenarios.test.ts` give 68 passed, 0 skipped there. The wiring
  test checks the import and both calls.

No other cloud-held file was edited or is needed. `src/ui/StorageDialog.ts` (T036s4/s5) is only imported, for
`storageDialogOpen`.

## Tests

**New (lane) tests**, run one file at a time:

- `tests/game/scenarios.test.ts`: **33 passed**.
  - Boomtown: active start; a medal secured stays; gold ends it at once; the end of year 10 decides on the window's
    best month; the bot's own ten years; founded on the scenario land on day 90.
  - Lights Out: the start month does not count; 6 / 9 / 12-month tiers; lost at 12; both figures in the same month;
    a loan costs gold; reach follows month and loan; start loans told from new ones; a repaid loan still counts; a
    decided outcome stands.
  - Smog City: the 12-month average against the year before; won at 40% with 180k; 3 / 6 / 10-year tiers; short
    history never judged.
  - Evaluation is pure and texts quote the figures; profile medals persist, keep the best, record once, keep 40 runs
    and ignore damaged data; the challenges' names, `applyChallenges` and `challengeStatus`.
- `tests/game/objectivesCard.test.ts`: **26 passed**.
  - No card for a plain city.
  - The card sits on top of the column.
  - An unknown scenario is free play.
  - The briefing comes once, paused, and resumes; Boomtown stays paused; there is no briefing after month 1.
  - **new: the briefing waits for a dialog already open.**
  - Keys under the card; a focused button keeps Enter / Space; keys are left to a dialog above.
  - Monthly updates; history after the event.
  - Boomtown's secured toasts; a loan shows at once.
  - The win is recorded and its card waits for the New Year show, LIVE and other dialogs.
  - Exit to region; the lose card; reloads and later attempts.
  - Challenges: card, toast, already earned; minimise; dispose.
- `tests/game/challengesDialog.test.ts`: **22 passed, 1 skipped**.
  - The title entry with medals, and the menu without it.
  - The dialog: list, briefing, Cancel, medals.
  - Boomtown: planned, saved and handed over; guide prefs untouched; loading tips.
  - Bundles: stored as their own region, a wrong file refused, fetched and opened, failures reported, the entry runs
    the dialog and the start.
  - New City dialog: chips, rules in the config, Hard money's funds, Frequent disasters ↔ Disasters, Sandbox.
  - Region badges.
  - The skipped test is "main.ts wires the Challenges entry", which runs once the hunk is in.
- `tests/sim/challengeRules.test.ts`: **14 passed**.
  - Config reading; money difficulty and disaster rate without the challenge; the badge rank.
  - No loans in the bank and through the action.
  - Hard money's tax on every difficulty.
  - No dirty industry: no I-D, manufacturing grows; another challenge changes nothing.
  - Frequent disasters: thresholds doubled on one draw; the same three draws; nothing drawn when off.
  - Badges kept through a drop; the tile summary keys.
- `tests/save/scenarioBundles.test.ts`: **8 passed**.
  - One bundle per bundled scenario.
  - lights_out and smog_city each load at HEAD and run on every system.
  - Lights Out's ruin, money limit and start loans; Smog City's baseline and floor.
  - **new: menu and briefing texts match the bundles.**
  - A pre-LG-14 save is free play.
  - A scenario city with challenges continues bit for bit after a mid-game save.
- `tests/sim/scenarioRuns.test.ts`: **11 passed, 3 skipped**; with `SCENARIOS=1`, **14 passed**.
  - The run table's shape.
  - Lights Out: nothing / loan / one plant / no limit / squeeze.
  - Smog City clean-up, and (long) left alone.
  - Boomtown (long): bot and empty land; the same land as the bundles.
  - Determinism with and without the checks; the clean-up mayor agrees month by month; `playScenario` stops at the
    decision.

**Existing tests re-run**, small groups through quietrun, all green:

- `tests/worker/hygiene.test.ts`: 18 passed.
- Game: `firstCity`, `newCityStart`, `labelFrame`, `titleSettings`, `uiStacking`, `uiPanelReserve`, `cityTeardown`,
  `cityDisposeCanvas`, `citySaves`, `storageDialog`, `settingsSchema`: 114 passed.
- Save: `regionStorage`, `save/foundingPersistence`, `liveRegionExport`, `regionSummaryReload`, `serialize`,
  `continuity`, `loadContinuity`, `cities`: 46 passed.
- Sim: `sim/economy`, `growth`, `difficultyRules`, `ranks`, `actions`, `foundingDay`, `phase0Contract`,
  `infra/environment`, `game/panelCommands`, `game/guideCopy`: 316 passed.

The first agent also ran, before its last edits:
- 19 sim / infra files (273 passed);
- 15 save files (82 passed);
- 33 game files (591 passed);
- 21 worker files (160 passed).

The files edited after those runs are covered by the second agent's re-runs above.

**Mutation checks.**
- First agent (`scratch/mut/`, 15 runs), each caught by its test:
  - No loans; No dirty industry; Frequent disasters; Hard money's tax;
  - the Smog City slack; the new-loan check; the loan memo;
  - the result card's waits; the card's keys; recording the result;
  - the tile summary; `applyChallenges`; the dialog re-asserting Frequent disasters; the title entry; the unique
    region id.
- Second agent (`scratch/r2mut/`): the four listed under Changes per file.

**Commands** (one process at a time; substitute each file):

```
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/objectivesCard.test.ts --maxWorkers=1
SCENARIOS=1 node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/sim/scenarioRuns.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/scenarios.ts --verify
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/scenarios.ts
```

The last command rebuilds the bundles in memory and prints their sha256; with `--write` it writes them.

## Not verified here

- **The browser:** the card's layout beside the guide at 1280x720, real keyboard focus, and the two hosts
  (worker and `?simworker=loopback`). No browser was run.
- **The production build:** that `vite build` emits the two `.metropolis` assets through `?url`. Vitest resolves the
  import, and the fetch path is tested with a stub.
- **The real App flow end to end** (the main.ts hunk is not in this tree): founding Boomtown through `startNewCity`,
  and entering an imported bundle through `continueInCity` with the worker booting on the record.
- **The full vitest suite, benches and real-GPU checks** (left to the lead).
- **Hard on its own:** a Hard bot run before and after. Every new branch is gated on `config.challenges`, which a
  Hard city without challenges does not have, and the disaster draw divides by exactly 1. The Medium bot is identical.
- **Leftovers, not part of the change:** the first agent left scratch probes in the worktree's git-ignored `tmp/`
  (`lib.ts`, `probe1-6.ts`). They can be deleted.

## Browser checklist (Acceptance list)

With the main.ts hunk applied, on the worker host and on `?simworker=loopback`:

- [ ] Title, fresh profile and with regions: "Challenges" after Load Region, sub-line "3 scenarios · no medal yet".
  - [ ] The dialog lists Boomtown, Lights Out and Smog City with their goals and "Your best".
  - [ ] Cancel starts nothing.
- [ ] **Boomtown:** one loading screen with the scenario tips; a new "Boomtown" region; the city opens on 1 April
  with §100,000, Medium, disasters off, paused.
  - [ ] The briefing card is shown; "Found the city" leaves it paused.
  - [ ] The card sits at the top of the top-left column. With the guide on, both cards and the toasts fit at 1280x720
    and 1920x1080.
- [ ] **Lights Out:** the network tab shows one fetch of `lights_out.metropolis`.
  - [ ] A "Lights Out" region appears in Load Region.
  - [ ] "Ashbury", February 2008, §15,000, power about 18 / 194 MW; the camera on the burnt gas plant; the news item.
  - [ ] Briefing paused; "Take office" resumes at normal speed.
- [ ] Lights Out: take a loan in Budget. The card shows "A loan was taken: silver at best" at once, and the Gold chip is
  struck out.
- [ ] Lights Out with nothing done: after 12 months the "Out of time" card opens, paused.
  - [ ] It never opens during a New Year show or a LIVE emergency, nor over the pause menu.
  - [ ] "Keep playing" resumes; "Exit to region" exits through the game's exit.
- [ ] A win (Lights Out, loan plus the same plant rebuilt): silver card after month 1 with the reward sound.
  - [ ] Reload: no second card; the pinned card says "Silver medal".
  - [ ] The title says "1 medal"; the dialog shows Silver beside Lights Out; the region tile card shows the Lights Out
    and Silver badges.
- [ ] **Smog City:** "Coalbrook", January 2015, about 193k. The card's air line starts at "0% / −40%" and changes only
  on the 1st of a month.
- [ ] Keys under an open card: Space, 1-3 and tool keys do nothing; Esc and Enter press its main button; Tab to "Exit
  to region" then Enter clicks it.
  - [ ] An open storage dialog keeps the briefing waiting until it closes.
- [ ] **New City dialog:** the "Mayor's challenges · optional" chips show their rules.
  - [ ] Hard money opens the city with §40k.
  - [ ] Under No loans, Budget shows the No-loans reason and no loan buttons.
  - [ ] Frequent disasters switches Disasters on; switching Disasters off drops the chip; Sandbox disables the chips.
- [ ] **A challenge city:** the card shows "Mayor's challenges", the chips (rules as tooltips) and "Badges n / 25,000
  residents".
  - [ ] At 25,000: one toast and "Earned"; the badges on the tile card and the region card.
- [ ] Minimise to the pill, remembered across cities. Reduced motion stops the card's animation.
- [ ] A plain city: no card, and the HUD is as before.
- [ ] A production build serves both bundles and starts both scenarios.
