# T042 LG-09 difficulty rules

Status: **holds for B2**. Changes are uncommitted. No push, commit, merge or `.done` file was made, following the lane instructions over the task footer.

## Rules

| Rule | Easy | Medium | Hard | Expert | Sandbox |
|---|---:|---:|---:|---:|---:|
| Starting funds | §250,000 | §100,000 | §40,000 | §40,000 | §10,000,000 / unlimited |
| Tax income multiplier | 1.2 | 1 | 0.85 | 0.85 | 1 |
| Running costs per person served | 1 | 1 | 1.15 | 1.15 | 1 |
| Approval per tax point above 9% | −3.5 | −3.5 | −4.5 | −4.5 | −3.5 |
| Disaster thresholds | 1 | 1 | 1.5 | 3 | 1 |
| Manual dispatch window | 1 | 1 | 1 | 0.75 | 1 |
| Removal after consecutive negative closing balances | none | none | 12 months | 12 months | none |
| New loans close | never | never | never | foundedDay + 1,800 days | never |
| Default disasters | off | on | on | on | on |
| New-town crime / monthly emergency grace | yes | no | no | no | no |

Expert inherits Hard's starting funds and income. Low-tax approval bonuses, fixed building upkeep, loan terms and existing-loan repayments are unchanged. Easy keeps FH-04 exactly; no additional Easy rules were added.

## Changes by file

- `src/core/types.ts`: adds `expert` to `Difficulty`.
- `src/sim/config.ts`: Expert starts with Hard's §40,000.
- `src/sim/economy/tuning.ts`: adds the rules above to `DIFFICULTY_RULES` and Expert's blurb.
- `src/sim/economy/approval.ts`: only the SIM-owned monthly tax-term expression uses the rule's penalty.
- `src/sim/economy/opex.ts`: tier charges, per-facility shares and expected upkeep use the running-cost multiplier. `opexRateOf(def, st?)` also exposes the city-specific rate to callers; omitted/null city keeps catalog defaults.
- `src/sim/economy/loans.ts`: authoritative offers and maximum borrowing close at the Expert boundary. Missing `foundedDay` means day zero, preserving old cities' calendar convention.
- `src/sim/economy/budget.ts`: reuses `economy.monthsNegative`, tolerates an absent old streak, and records the one-time removal. `mayorRemoval(st)` is a pure read of mirrored state.
- **INFRA / B2, `src/sim/infra/disasters.ts`**: one import and the existing monthly threshold comparisons. The same decision and two location draws remain in the same order. No added random draw.
- **INFRA / B2, `src/sim/infra/emergency.ts`**: one import; optional incident multiplier; `dispatchWindowEnd` applies it to manual windows; spawn writes it only when non-unit; two automatic industrial queue/retry callers explicitly retain their original timing. No refactor or moved code.
- `tools/simbot.ts`: help now names Expert; the parser already forwarded the `Difficulty` value, so no strategy change was needed.
- New tests: `tests/sim/lg09EconomyDifficulty.test.ts` (24 cases), `lg09InfraDifficulty.test.ts` (16), `lg09BotDifficulty.test.ts` (2).
- **Outside the named source/new-test list:** two assertion lines in `tests/sim/difficultyRules.test.ts` now permit the added Expert row and added table fields. Existing legacy field/blurb expectations remain checked. Its exact old table-shape assertion otherwise necessarily fails when the requested schema grows. This report is the task's requested report file.

No cloud-held source files were edited. The two INFRA files must be kept separate for B2's merge; no separate commits were created because commits were forbidden.

## Removal state and W0 transport

`systemData.economy.mayorRemoved?: { day, bankruptSinceDay, reason: 'bankruptcy' }` is the persistent flag/record. It is absent until removal, stays present after funds recover and survives saves. `mayorRemoval(st)` returns it without initializing state. The monthly budget posts one news item with `ref: { advice: 'mayorRemoved' }`.

This uses existing W0 paths: economy is already mirrored, and the complete news item/ref is already forwarded. A new event would require edits in cloud-held Worker files. Medium gets no new persistent keys. `bankruptSinceDay` is the start of the first negative-balance month, calculated as removal day minus the whole negative-month streak; Restore should choose a checkpoint before that boundary. This conservatively excludes saves inside the first debt month.

The sim records the ending; the cloud's removal UI must pause through the host and provide the choices. It must also check the persistent record when loading/entering a city, because the triggering news can be older than the visible news tail.

## Hard versus Medium: 128 × 15, seed 7

The unchanged competent-mayor strategy is used, with no optional LG-10 flags. As before, the bot explicitly disables disasters. Funds are exact yearly closing balances.

| Year | Medium population | Hard population | Medium funds | Hard funds | Population ratio | Funds ratio | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| 2010 | 99,729 | 71,169 | 74,337 | 54,897 | 0.714 | 0.738 | pass: population |
| 2011 | 116,996 | 84,674 | 87,155 | 31,651 | 0.724 | 0.363 | pass: both |
| 2012 | 134,385 | 98,796 | 89,859 | 66,077 | 0.735 | 0.735 | pass: population |
| 2013 | 153,902 | 115,397 | 124,992 | 71,843 | 0.750 | 0.575 | pass: population |
| 2014 | 172,995 | 132,892 | 137,824 | 95,071 | 0.768 | 0.690 | pass: population |
| 2015 | 192,899 | 151,718 | 146,349 | 95,417 | 0.787 | 0.652 | pass: population |

Medium residents are **[61,124, 93,804, 37,971] = 192,899**. Hard residents are **[55,601, 68,266, 27,851] = 151,718**, an intended balance change. Lowest daily funds, including before and after monthly settlement and bot spending: Medium **§3,774**, Hard **§2,464**. Hard takes §60,000 in July 2000 and May 2001; Medium takes §60,000 in July and December 2001. Hard meets every 2010–15 line and remains solvent.

## Validation and diagnostic method

- `git diff --check`: passed.
- `npx tsc --noEmit`: **blocked by the new enum at cloud-held `src/main.ts:815`**, whose separate inline funds map has no Expert entry. That is the only diagnostic; exact request below.
- `node <quietrun> npx vitest run tests/sim/lg09InfraDifficulty.test.ts --maxWorkers=1`: **could not start**, `spawn EPERM` in Vite's Windows `net use` realpath optimization. No unit-test passes are claimed. The full suite was not run, as instructed; lead must run it.
- `npx tsx`: unavailable locally; npm fails `ENOTCACHED` in the offline sandbox. Bot checks therefore use Node 22.12's native TypeScript transform and a scratch extension-resolution loader, running the same imported `SimBot`, `botSystems` and `parseArgs`.
- Bot processes run individually through the quiet gate. `yearRows.mts` records exact rows, SHA-256 of `serializeCity(st, { copy: true })` with sorted object keys/raw typed-array bytes, fixed `Date.now`, daily minimum funds and successful loan log lines. Base modules come directly from `git archive fb1531f` in scratch and are supplied by the diagnostic loader; no other worktree or checkout is modified.

The direct native-Node `lg09Smoke.mts` probe passed **31 checks** (diagnostic output `lg09Smoke.json`): removal at month 12 on Hard and Expert, once-only news and persistence, recovery reset, sandbox override, old saves without the streak, founding-relative Expert loan cutoff and continued repayments, tax/OPEX behavior, threshold draw counts, 240 months of Medium disaster RNG continuity, and manual-window/save compatibility. This is additional behavioral evidence, not a claimed Vitest run.

| Controlled two-process run | Raw yearly save hashes | Final population / minimum daily funds |
|---|---|---|
| Medium 128 × 15 seed 7 | **15/15 identical** | 192,899 / §3,774 |
| Medium 256 × 60 seed 7 | **60/60 identical** | 1,513,835 / §4,125 |
| Medium 256 × 60 seed 11 | **60/60 identical** | 1,427,340 / §3,957 |

The final 128 pair is `medium-base-debug-128x15-s7.jsonl` versus `medium-after-debug-128x15-s7.jsonl`, each in a fresh process with the archived-base loader switched on/off. Serialized diagnostic snapshots at 2007 and 2010 also compare equal. The initial preliminary pair had two differing hashes, so it was investigated and superseded by this controlled archive-based pair; all numeric yearly rows agreed throughout. The final pair matches raw bytes without normalizing or excluding any saved field. The 256 seed-7 pair is `medium-before-256x60-s7.jsonl` versus `medium-after-256x60-s7.jsonl`; its final hash is `01d546c7480236e4a0cc215ac459984b279eba6d598cb73f281752bf2c7e6b75` on both sides.

The 256 seed-11 pair is `medium-before-256x60-s11.jsonl` versus `medium-after-256x60-s11.jsonl`; final hash `18edf04c7384b0649eac0d366e6e9d3f9a650aef3c2c658d0fe1eb9eac01bdc6` on both sides. **All 135 controlled yearly comparisons match.** The Hard run is `hard-128x15-s7.jsonl`. All diagnostic files and scripts are in the lane's assigned scratch folder.

### Reproduction commands

From `C:/Users/techsin/Desktop/projects/simcityweb-T042`, standard bot commands for the lead (all prefixed by the quiet gate):

```powershell
$gate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T042/scratch'
node $gate npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty medium --quiet
node $gate npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty hard --quiet
node $gate npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --difficulty medium --quiet
node $gate npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --difficulty medium --quiet
```

The executed diagnostic equivalent replaces `npx tsx tools/simbot.ts` with:

```powershell
node --experimental-transform-types --loader "file:///$scratch/resolve.mjs" "$scratch/yearRows.mts"
```

It appends `--output "$scratch/<run>.jsonl"` after the same simbot arguments. Before runs set `$env:LG09_BASELINE = '1'` to load archived base modules; after runs leave it unset. Each before/after process starts fresh. Exact run basenames and outcomes are listed in the results below.

Lead gates left: fix the cloud-held `main.ts` map and rerun `npx tsc --noEmit`; run the three new Vitest files and the adjusted `difficultyRules.test.ts`, then the full suite (including Worker hygiene/parity) outside this sandbox. Run each single-file check through the quiet gate with `--maxWorkers=1`, for example `node $gate npx vitest run tests/sim/lg09EconomyDifficulty.test.ts --maxWorkers=1`. Browser/owner integration remains unverified. The requested bot thresholds and hash gates have been checked with the native diagnostic runner; standard tsx commands above remain available for the lead's runner.

## Cloud and other-owner requests

| File:line / owner | Exact change and reason |
|---|---|
| `src/main.ts:815`, cloud App | `quickstart`: use shared `DIFFICULTY_FUNDS` or add `expert: 40_000` to the inline map. This currently prevents tsc from passing. Do not weaken `Difficulty` to hide it. |
| `src/worker/protocol.ts:98`, cloud Worker | Add `foundedDay` to `SYSTEM_KEYS` and cover Expert replica-safe loan offers at the nonzero founding boundary. `loanOffer`/`maxLoanAmount` now require it, while BudgetPanel reads these functions on `ctx.state`. Without the mirror, a day-90 Expert preview closes 90 days too early. |
| `src/region/NewCityDialog.ts:114,118,206`, cloud META | Offer Expert, render two rule lines per card from the rules, and replace the money-only field heading. Hard: running costs +15%, tax penalty −4.5, disasters ×1.5, removal after 12 debt months. Expert: same plus loans close after year 5, disasters ×3, manual windows −25%. |
| `src/region/newCityPrefs.ts:18,35`, cloud META | Accept Expert in the persisted difficulty whitelist. |
| `src/region/RegionScreen.ts:253–254`, cloud META | Add Expert badge to city card. Current difficulty interpolation is safe. Optional matching badge sites: city rows `:185`, map tooltip `:206–207`. |
| `src/ui/TopBar.ts:432–433`, cloud split | Generic capitalization already renders Expert; preserve and verify through the split. |
| `src/game/CityScene.ts` HUD construction / new removal screen, cloud META | Watch host news using `ctx.signal`, recognize `advice: 'mayorRemoved'`, read `mayorRemoval(ctx.state)` on load/entry, and show “The council has removed you”. Suppress reopening after sandbox continuation, since the historical removal record is sticky. Pause through `host.setSpeed` with its source/tag and route actions with gestures. Restore must use NEW-03's newest checkpoint before `bankruptSinceDay`, not latest autosave. NEW-03 is absent; route that dependency explicitly. |
| `src/worker/protocol.ts:18`, `src/worker/SimCore.ts:176` `applyCommand`, `src/worker/SimHost.ts` action API, cloud Worker | Add a Continue-in-sandbox host command and its recovery/journal treatment, including propagating changed config to replicas. It must change the authoritative city to sandbox and return through normal command transport; the UI cannot mutate replica config. No such command exists today. |
| `src/worker/replicaSafe.ts:9`, cloud Worker | Add `mayorRemoval` coverage when wiring the UI, and exercise Expert loan parity with nonzero `foundedDay` and both cutoff days. The new removal accessor reads only the already-mirrored economy record. |
| `src/sim/economy/approval.ts:488–489`, GUIDE-owned detail | Use the difficulty's `taxPerPoint` both to recover the historical weighted rate from `T.tax` and in the displayed penalty. Current Hard/Expert hover still claims −3.5 and calculates an incorrect rate. Only SIM's `update()` was edited here. |
| `src/ui/topbar/approvalGuide.ts:25,29`, cloud GUIDE | Add measured Expert new-town approval range and recheck Hard's published range. |
| `src/ui/guide/copy.ts:88–90,174,276`, cloud GUIDE | Update Hard and add Expert descriptions; make G5/veteran tax explanations difficulty aware. |
| `src/ui/panels/BudgetPanel.ts:226,537`, cloud GUIDE | Tax hint and `residentialTaxEffect` must use the difficulty's penalty, passing the current difficulty/rate from `ctx.state` to the helper. They currently still explain/forecast −3.5 on Hard and Expert. |
| `src/sim/economy/advisors.ts:83,1674–1676`, cloud GUIDE | In `taxHigh` advice, compute `cost` and its text with the difficulty's `taxPerPoint`; keep the existing warning trigger/cooldown. Update the related comment. The advice otherwise understates Hard/Expert's real approval loss. |
| `src/game/tools/placement.ts:209`, GUIDE | `upkeepHere`: pass `st` to the new `opexRateOf(def, st)` so the local placement estimate includes Hard/Expert running costs. |
| `src/sim/infra/facilities.ts:1493,1559,1567`, B2 / owner request, **not edited** | `facilityDefFacts`: use `opexRateOf(def, st)`. Let `fullUseUpkeep` accept the optional city and scale only its variable full-load cost; preserve its fixed typical/full-load assumptions. Pass the city at the facts call. Otherwise rate/full-use facts still show Medium costs. |
| `src/ui/upkeepModel.ts:34`, GUIDE | Pass city state to that city-aware `fullUseUpkeep` for build/reward cards. |
| `src/ui/demo.ts:5`, `src/main.ts:7` | Difficulty documentation comments list the old choices; include Expert. Runtime query readers already accept it. |

## Plan versus code and remaining checks

- TopBar is still monolithic on this base, although the plan speaks about the completed split.
- `NewsItem.ref` is merged, so no new event or CityState schema hunk is needed. `foundedDay` mirroring from POLISH §7.6 is absent.
- `dispatchWindowEnd` is shared with automatic industrial response. The explicit automatic opt-out is necessary to apply only the requested manual multiplier. Existing late `canSend` dispatch remains permitted; incident deadlines, grace, ignition and automatic timing stay unchanged. The optional Expert incident field already crosses the Worker stream/save via full-object cloning. Old incidents without it keep their original windows.
- No browser was launched. Full vitest, host hygiene/parity checks and the cloud integration must be run by the lead. No balance fixtures were edited without D2 sign-off.

Browser checklist after the owner patches:

- [ ] Select/found Expert, reopen New City, and verify remembered Expert preference, two rule lines, badge and TopBar label.
- [ ] Compare Hard/Expert OPEX forecasts, placement estimates, facility details and build/reward cards against actual monthly charges.
- [ ] Compare tax hover/guide claims with −4.5 on Hard/Expert and −3.5 on Medium; low-tax bonus stays the same.
- [ ] Force 11 then 12 debt months on Hard and Expert; removal appears once and pauses through the host. Verify it also appears after loading an already removed city.
- [ ] Continue in sandbox through a host command; verify unlimited-money behavior and no repeated removal screen after saving/re-entering. Verify Restore selects a checkpoint before the recorded streak, once NEW-03 lands.
- [ ] Found Expert at day 90; offers/commands permit a loan at day 1889 and refuse at day 1890 on both local and Worker hosts; existing loans still amortize.
- [ ] Expert countdown/LIVE prompt lasts 75% of the ordinary window; automatic response/industrial ignition stay on their original schedule, and late-send behavior remains available.
- [ ] Load old Easy/Medium/Hard/Sandbox saves with no new ending/incident keys and continue normally; Easy retains its grace and saved disasters toggle.
