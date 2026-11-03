# T042 LG-09 difficulty rules — review round 3

Status: **holds for B2** for the existing infra work. Round 3 changes are uncommitted on `local/T042-lg09-difficulty`, over the lead's merge `e871697` of dev `683d02b`. The lead committed the original work as `0585869` (infra), `888194b` (other work), `c5f9d60` (App funds map), and review fixes as `5118f48`. This round makes no infra or App edits; c5f9d60's `src/main.ts` line is unchanged. No commit, push, merge or `.done` file was made by this worker.

## Round 3 changes and validation

- `src/worker/protocol.ts:98`: one isolated line appends optional `foundedDay` to `SYSTEM_KEYS`, as authorized by NOTE-048. Existing recorder, replica and digest paths handle the number, including zero, updates and deletion. No other Worker source changed; `WorkerSimHost.ts`, `LoopbackSimHost.ts` and `protocolInbox.ts` are untouched.
- `tests/sim/lg09LoanReplica.test.ts`: both previously conditional parity cases are now unconditional. The actual `LoopbackCore` packet host checks complete loan offers, maximum borrowing and exact authority/replica digests. A founded-day-90 city stays eligible at days 1799/1800/1801 and 1889, then closes at 1890/1891. Ready, end-packet addition/update-to-zero/deletion, and legacy missing-key cutoff at 1800 are covered.
- This report records the approved mirror and current validation. These are the only three changed files this round; no infra hunks or other source hunks were added.

`exactDigest` reads `SYSTEM_KEYS`, so its computed value includes the new optional input on both sides. No test pins a computed digest value; no digest fixture was updated. The protocol fixture's `digest: 123` and the replica test's deliberate `digest = 1` remain unchanged.

- Quiet-gated `npx tsc --noEmit`: **passed** after the final test edit.
- `git diff --check`: **passed**. The diff is limited to the three files listed above.
- Quiet-gated Vitest: **all 15 targeted files blocked before test loading**, with Vite startup `spawn EPERM` in Windows realpath/`net use`. No Vitest assertions ran; these are not claimed as passes.
- Direct native-Node packet-host probe `r3-foundedDayParity.mts`: **4 cases passed, 14 authority/replica/digest comparisons**, with no replica divergence. It imports the actual recorder/replica/loopback code; no Worker modules are mocked. The diagnostic loader's historical baseline/UI adaptations were disabled. Output: `r3-foundedDayParity.json`; gate results: `r3-targeted-checks.json`, all in the assigned scratch folder.
- No full suite, bot or browser run in round 3. The lead runs the full suite. The balance tables and two-process hashes below are historical round-1 results, not reruns against the merged dev base.

Each targeted file was attempted separately through `node $gate npx vitest run <file> --maxWorkers=1`:

- `tests/sim/lg09LoanReplica.test.ts`
- `tests/sim/lg09EconomyDifficulty.test.ts`
- `tests/sim/lg09InfraDifficulty.test.ts`
- `tests/sim/lg09BotDifficulty.test.ts`
- `tests/sim/lg09RemovalMigration.test.ts`
- `tests/sim/lg09CostReview.test.ts`
- `tests/sim/lg09DispatchUi.test.ts`
- `tests/sim/difficultyRules.test.ts`
- `tests/worker/protocol.test.ts`
- `tests/worker/replica.test.ts`
- `tests/worker/queries.test.ts`
- `tests/worker/exactDigest.test.ts`
- `tests/worker/loopbackHost.test.ts`
- `tests/worker/lag.test.ts`
- `tests/worker/replicaSafe.test.ts`

Current non-Vitest checks use the same quiet gate:

```powershell
node $gate npx tsc --noEmit
node $gate node --experimental-transform-types --loader "file:///$scratch/resolve.mjs" "$scratch/r3-foundedDayParity.mts"
```

`$gate` and `$scratch` are expanded in Exact commands below. No new cloud request is needed for the founding date; NOTE-048's mirror request is fulfilled. The other cross-owner requests below are retained from round 1 and were not re-audited after the dev merge.

## Rules

| Rule | Easy | Medium | Hard | Expert | Sandbox |
|---|---:|---:|---:|---:|---:|
| Starting funds | §250,000 | §100,000 | §40,000 | §40,000 | §10,000,000 / unlimited |
| Tax income multiplier | 1.2 | 1 | 0.85 | 0.85 | 1 |
| Running costs per person served | 1 | 1 | 1.15 | 1.15 | 1 |
| Approval per residential tax point above 9% | −3.5 | −3.5 | −4.5 | −4.5 | −3.5 |
| Disaster thresholds | 1 | 1 | 1.5 | 3 | 1 |
| Manual dispatch window | 1 | 1 | 1 | 0.75, enforced | 1 |
| Removal after fresh LG-09 negative-balance streak | none | none | 12 months | 12 months | none |
| New loans close | never | never | never | foundedDay + 1,800 days | never |
| Default disasters | off | on | on | on | on |
| New-town crime / monthly emergency grace | yes | no | no | no | no |

Easy retains FH-04. Fixed building upkeep, low-tax bonuses, loan terms and existing-loan repayments are unchanged.

## Review round 1 fixes by file (committed history)

- `src/sim/economy/budget.ts`: adds optional `systemData.economy.mayorRemovalStreak`, independent of `monthsNegative`. Missing means zero. Only Hard/Expert negative settlements increment it; solvent/sandbox settlements reset an existing streak. Warning counts do not migrate into it. Removal and its news/ref remain once-only and persistent.
- `src/sim/economy/loans.ts`: documents why absent founding metadata must retain the legacy day-zero fallback. No invented replica date or new borrowing allowance.
- `src/sim/economy/approval.ts`: minimal, explicitly authorized GUIDE-hunk correction in `approvalDetail`: both inverse tax-rate calculation and penalty copy use the difficulty's penalty. Hard's 11% now reads 11% at −4.5 per point.
- `src/sim/economy/opex.ts`: all four cost/rate sites scale only Hard/Expert. Easy, Medium and Sandbox use the original numeric operations without multiplication by one.
- **INFRA / B2, `src/sim/infra/disasters.ts`**: one monthly hunk branches Hard/Expert scaling from the original literal thresholds. The same one decision and two location draws stay in order.
- **INFRA / B2, `src/sim/infra/emergency.ts`**: a small shared expiry predicate guards authoritative `dispatch`, `dispatchBest` and `dispatchOptions`. Saved/daily/manual-state flags expire as well. Automatic timing, industrial queue/retry deadlines and already sent vehicles stay unchanged.
- **INFRA / B2; outside original named files, `src/sim/infra/facilities.ts`**: import plus small `fullUseUpkeep(def, st?)` and `facilityDefFacts` hunks pass the city into rates/full-use quotes. Fire's no-capacity fallback retains its original typical full-load basis rather than using the city's unmet need.
- **Outside original named files, `src/ui/upkeepModel.ts`**: one-line city argument in the neutral, pure upkeep helper, authorized by review item 4.
- **Outside original named files, `src/ui/EmergencyBanner.ts` and `src/game/tools/DispatchTool.ts`**: minimal continuous-time guards for manual controls/options, required by review item 1 so cached daily watches cannot leave Expert controls enabled after fractional expiry. No replica writes or new listener paths.
- `tests/sim/lg09InfraDifficulty.test.ts`: corrects the prior late-Expert-dispatch expectation; adds cutoff, save/load, automatic-response and existing-vehicle regressions, plus original RNG-stream checks for unchanged modes.
- New `tests/sim/lg09RemovalMigration.test.ts`: old warning count 12 without LG-09 streak, month-11 reload, full fresh 12-month removal, reset, non-removal modes and sandbox continuation.
- New `tests/sim/lg09CostReview.test.ts`: difficulty-aware quotes/cards, full fire capacity, original arithmetic on unchanged modes and tax-detail inverses.
- New `tests/sim/lg09LoanReplica.test.ts`: authority and legacy-replica tests; the two parity cases originally gated on `foundedDay` mirroring are enabled and expanded in round 3 above.
- New `tests/sim/lg09DispatchUi.test.ts`: three cached-watch regressions using the existing fake DOM; Expert button/station options close continuously without writing into replica incidents, while unchanged modes keep their original behavior.
- This report replaces the pre-review report with the final behavior and outstanding requests.

All infra hunks above remain separate from economy/UI changes for B2. No cloud-held source files were edited in round 1. Round 3's sole Worker source change is the approved optional key above. The original two-line FH-04 table-test adjustment is already in the lead's WIP commit; it has no new review diff.

## Removal state and old saves

The ending remains `systemData.economy.mayorRemoved?: { day, bankruptSinceDay, reason: 'bankruptcy' }`, exposed by the pure `mayorRemoval(st)` accessor. News uses `ref: { advice: 'mayorRemoved' }`. Economy and complete news refs already cross W0 transport.

The new optional `mayorRemovalStreak` counts only settlements under LG-09. An old Hard save at day 360 with `monthsNegative = 12` and no new streak has warning count 13 / removal streak 1 after its next negative settlement; it is removed only at day 720 after 12 fresh settlements. The existing warning counter and warning behavior stay independent. Saving/loading at removal streak 11 preserves that progress.

`bankruptSinceDay` is removal day minus the new streak's whole months, so the old debt-warning history cannot move Restore's boundary backward. It conservatively identifies the start of the first LG-09 debt month. The ending stays sticky after recovery/continuation; UI must suppress reopening once continued in sandbox.

## Expert loans and replica data

Before the mirror, no exact replica-safe fallback existed: a founded-day-90 authority and a legacy authority without the key could produce the same replica despite different cutoffs. The approved optional key now preserves that distinction. Missing data still means the legacy day-zero fallback on both authority and replica; no guessed founding date or extra borrowing allowance was introduced.

**Fulfilled in round 3:** `src/worker/protocol.ts:98`, `SYSTEM_KEYS` now includes `'foundedDay'`, per NOTE-048 and POLISH_PLAN §7.6. Existing `ChangeRecorder` and `Replica.applyPlain` paths carry presence, numeric updates and deletion through Ready and packet diffs. No recorder or replica edits were needed. The prior documentation request to describe day/config/foundedDay as loan-preview inputs remains with the Worker owner.

All four loan tests are active. Their round-3 packet-host coverage and validation limits are recorded above.

## Hard versus Medium: 128 × 15, seed 7 (round 1 history)

Unchanged competent-mayor strategy, no optional LG-10 flags. The bot continues to disable random disasters. The fresh review reruns reproduced every number in this table, including both daily minima and loan logs.

| Year | Medium population | Hard population | Medium funds | Hard funds | Population ratio | Funds ratio | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| 2010 | 99,729 | 71,169 | 74,337 | 54,897 | 0.714 | 0.738 | pass: population |
| 2011 | 116,996 | 84,674 | 87,155 | 31,651 | 0.724 | 0.363 | pass: both |
| 2012 | 134,385 | 98,796 | 89,859 | 66,077 | 0.735 | 0.735 | pass: population |
| 2013 | 153,902 | 115,397 | 124,992 | 71,843 | 0.750 | 0.575 | pass: population |
| 2014 | 172,995 | 132,892 | 137,824 | 95,071 | 0.768 | 0.690 | pass: population |
| 2015 | 192,899 | 151,718 | 146,349 | 95,417 | 0.787 | 0.652 | pass: population |

Medium residents **[61,124, 93,804, 37,971] = 192,899**; Hard **[55,601, 68,266, 27,851] = 151,718**. Lowest daily funds: Medium **§3,774**, Hard **§2,464**, measured before/after settlement and between bot actions. Hard borrows §60,000 in July 2000 and May 2001; Medium borrows §60,000 in July and December 2001. The intended initial Hard balance change remains; review fixes introduce no further balance tuning.

## Review round 1 validation (historical)

- `npx tsc --noEmit`: **passed**, including the final UI guards and all new test files.
- `git diff --check`: passed.
- Quiet-gated targeted Vitest runs: **all eight files fail before tests start**, Vite config startup `spawn EPERM` in Windows realpath/`net use`. No current Vitest passes are claimed. Lead reported the pre-review WIP passed 219 files / 2,187 tests; that is prior evidence, not validation of this diff.
- Direct native-Node `r1-reviewSmoke.mts`: **20 grouped checks passed**, including both manual dispatch commands/options at 22.4/22.5/23, save/load, automatic/new-station response, existing vehicles, and fresh removal migration/reset/persistence.
- Direct native-Node `r1-costReplicaSmoke.mts`: **16 grouped checks passed**, matching the 14 cost/tax scenarios plus authority and actual legacy replica parity. The two foundedDay parity cases remain gated until mirroring; their absence is explicitly recorded, not inferred as a pass.
- Direct native-Node `r1-uiSmoke.mts`: **3 cases passed**, exercising the actual banner/tool methods with a fixed watch at fractional expiry and verifying the incident remains untouched. It reuses the existing fake DOM with lifecycle-only adaptation; CSS and the unused Vite lazy-import manifest are omitted only in this smoke process. This verifies control logic, not browser layout or real host boot.
- Final bot results are recorded below. No full suite or browser was run in this lane.

| Fresh review two-process run, baseline c5f9d60 | Yearly raw save hashes | Final population / minimum daily funds |
|---|---|---|
| Medium 128 × 15 seed 7 | **15/15 identical** | 192,899 / §3,774 |
| Medium 256 × 60 seed 7 | **60/60 identical** | 1,513,835 / §4,125 |
| Medium 256 × 60 seed 11 | **60/60 identical** | 1,427,340 / §3,957 |
| Hard 128 × 15 seed 7, after fixes | **all six 2010–15 thresholds pass** | 151,718 / §2,464 |

**All 135 fresh Medium yearly comparisons match**, against the committed WIP before these review fixes. End hashes: 128 seed 7 `7cf9016330b2cade292e2cf3eea5e2c78f378b1e5c5ffc791a741ee276fac84f`; 256 seed 7 `01d546c7480236e4a0cc215ac459984b279eba6d598cb73f281752bf2c7e6b75`; 256 seed 11 `18edf04c7384b0649eac0d366e6e9d3f9a650aef3c2c658d0fe1eb9eac01bdc6`. Review changes leave Hard's yearly rows and daily minimum unchanged as well. The three direct probes passed **39 grouped cases** in total; these do not replace the blocked Vitest runs.

Diagnostic runner: the same imported `SimBot`, `botSystems` and `parseArgs`, fixed `Date.now`, sorted object keys and raw typed-array bytes in SHA-256 of `serializeCity(st, { copy: true })`. Fresh base modules come from `git archive c5f9d60` into `review-base.tar`; the diagnostic loader selects those modules without touching another worktree. Runs use separate processes, one at a time, through the quiet gate. No saved field is normalized or omitted. Review run files begin `r1-` in the assigned scratch folder. The prior original-base gates also matched 135 yearly hashes.

### Exact commands

Working directory: `C:/Users/techsin/Desktop/projects/simcityweb-T042`.

```powershell
$gate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T042/scratch'
node $gate npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty medium --quiet
node $gate npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty hard --quiet
node $gate npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --difficulty medium --quiet
node $gate npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --difficulty medium --quiet
```

`tsx` is absent in this offline environment. Executed equivalents replace `npx tsx tools/simbot.ts` with `node --experimental-transform-types --loader "file:///$scratch/resolve.mjs" "$scratch/yearRows.mts"`, retaining the exact arguments above and appending `--output "$scratch/r1-<run>.jsonl"`. Set `LG09_BASELINE=1` and `LG09_REVIEW=1` for the before process; leave both unset for after. Before/after basenames are `r1-medium-before/after-128x15-s7`, `r1-medium-before/after-256x60-s7`, `r1-medium-before/after-256x60-s11`; Hard is `r1-hard-128x15-s7`.

Round-1 targeted test files, each through `node $gate npx vitest run <file> --maxWorkers=1`: `lg09InfraDifficulty.test.ts`, `lg09EconomyDifficulty.test.ts`, `lg09BotDifficulty.test.ts`, `lg09RemovalMigration.test.ts`, `lg09CostReview.test.ts`, `lg09LoanReplica.test.ts`, `lg09DispatchUi.test.ts`, `difficultyRules.test.ts` (all under `tests/sim/`). Current lead gates left: targeted/full Vitest outside the startup restriction and browser checks. The mirror and direct packet parity are now verified in round 3. No balance fixtures were edited without D2 sign-off.

## Cloud and GUIDE requests

| File:line / owner | Exact request |
|---|---|
| `src/worker/queries.ts:85–94`, cloud Worker | Include Expert shortened-window expiry from authoritative simTime in dispatch-options watch signature. Daily st.day alone leaves cached options valid between 22.5 and 23. Keep the query pure and other modes' signature behavior unchanged. |
| `src/ui/panels/EmergenciesPanel.ts:31,125`, cloud META | Thread current host simTime into `dispatchBlocked/renderActive` and block the Expert manual action at shortened expiry even if cached options are stale. This held file was not edited; authority already rejects. |
| `src/game/tools/placement.ts:209`, GUIDE | `upkeepHere`: pass `st` into `opexRateOf(def, st)`; the local placement quote otherwise uses Medium rates. |
| `src/game/tools/PlopTool.ts:97`, GUIDE | `tip`: pass `ctx.state` into `facilityDefFacts`. |
| `src/ui/panels/BudgetPanel.ts:226,534–537`, cloud GUIDE | Hint and `residentialTaxEffect` use the city's difficulty penalty. Thread the penalty from ctx.state into the forecast helper. |
| `src/sim/economy/advisors.ts:83,1674–1676`, cloud GUIDE | `taxHigh` cost and copy use difficulty's taxPerPoint; keep trigger/cooldown unchanged. |
| `src/ui/guide/copy.ts:174,276`, cloud GUIDE | G5 and veteran Taxes accept the city's penalty. |
| `src/ui/panels/InfoPanel.ts:429–434`, `src/ui/inspectorModel.ts:389–425`, cloud GUIDE | Verify the existing city-aware facility report displays the corrected rates; no independent OPEX calculation requiring a patch was found. |
| `src/region/NewCityDialog.ts:114,118,206`, cloud META | Offer Expert; two rule lines/card; replace the money-only heading. |
| `src/region/newCityPrefs.ts:18,35`, cloud META | Accept Expert in persisted preference whitelist. |
| `src/region/RegionScreen.ts:253–254`, cloud META | Expert badge. Existing interpolated difficulty is safe; optional badge sites are rows :185 and map tooltip :206–207. |
| `src/ui/TopBar.ts:432–433`, cloud split | Preserve generic capitalization, which already displays Expert. |
| `src/ui/topbar/approvalGuide.ts:25,29`, cloud GUIDE | Measured Expert range; recheck Hard range. |
| `src/ui/guide/copy.ts:88–90`, cloud GUIDE | Update Hard description and add Expert. |
| `src/ui/demo.ts:5`, `src/main.ts:7` | Difficulty-list documentation comments include Expert. App funds map is already fixed by c5f9d60. |
| `src/game/CityScene.ts` HUD / new removal screen, cloud META | Read mirrored ending on entry and host news with ctx.signal. Show “The council has removed you”; pause through host.setSpeed; suppress reopening after sandbox continuation. |
| `src/worker/protocol.ts:18`, `SimCore.ts:176 applyCommand`, `SimHost.ts`, cloud Worker | Continue-in-sandbox command, journal/recovery treatment and config replication. UI must not mutate replica config. |
| NEW-03 / cloud META | Restore newest checkpoint before bankruptSinceDay, never the latest failing autosave. NEW-03 remains absent. |
| `src/worker/replicaSafe.ts:9`, cloud Worker | Add removal accessor parity coverage when wiring the screen; loan parity is covered by the now-active packet-host tests. |

## Plan versus code and browser checklist

The separate migration streak corrects the initial WIP's reuse of a pre-LG-09 warning counter. The Expert window now limits authoritative manual dispatch, superseding the prior WIP's late-send behavior; unchanged modes keep their existing late-send rules. Automatic response and incident lifetimes are unchanged. The optional incident field already travels through full-object save/stream cloning.

The round-1 base had a monolithic TopBar. The missing foundedDay mirror promised by POLISH §7.6 is resolved by NOTE-048 and this round's one-line addition. Existing economy/news transport supports the ending without a new Worker event. Continue/Restore UI and NEW-03 remain cross-owner work. The round-1 cloud-held EmergenciesPanel and daily watch signature requests are retained above; the authority, banner and tool have direct cutoff guards.

- [ ] Expert spill: send before 22.5; reject at/after 22.5 and at day 23, including a saved stale-canSend city.
- [ ] Banner Send/Choose station, DispatchTool and cloud panel controls agree at fractional expiry while options are cached.
- [ ] Units sent before expiry still arrive/resolve; automatic coverage added after expiry still dispatches. Industrial ignition/queue timing unchanged.
- [ ] Load old Hard debt count 12 with no removal streak: no removal next month, then removal after 12 fresh negative settlements; reload at streak 11 and verify one removal news.
- [ ] Solvent settlement resets the new streak; ending survives save/load and sandbox continuation does not reopen it.
- [ ] Hard/Expert 11% tax detail reads 11% and −4.5; BudgetPanel/guide/advisor explanations agree after owner patches.
- [ ] Facility facts and upkeep cards match actual adjusted costs; fire full-use maximum is independent of unmet need. Verify placement/inspector quotes after GUIDE work.
- [ ] In the browser, verify the founded-day-90 Expert loan preview stays open at 1799/1800/1801 and 1889, closes at 1890/1891, and legacy no-key cutoff remains 1800. Direct packet-host parity passes; BudgetPanel browser checks remain for the lead.
- [ ] Expert selection, remembered preference, badge and TopBar label; two rule lines per card.
- [ ] Continue through host command; Restore checkpoint precedes new streak once NEW-03 exists; old Easy/Medium/Hard/Sandbox saves continue.
