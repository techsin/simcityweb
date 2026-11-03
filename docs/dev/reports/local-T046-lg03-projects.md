# T046 — LG-03 framework and Express Metro

**Uncommitted; infra hunks hold for B2.** Implemented the round-2 construction framework, Express Metro effects,
the round-3 Expo draw hook, and the opt-in bot strategy. No CONTENT definitions, toolbar/model work, GUIDE UI,
Worker files, BudgetPanel changes, commits, pushes or `.done` files are included.

bot reference: residents [ 62577, 92903, 38351 ] = **193,831**, on the signed T041 option-B base at `60ca91d`.
The first 128×15 seed-7 run reproduces **all 15 non-timing fixture rows exactly**, including §178,743 final funds.
The second process reproduces all **15 annual state hashes** and all non-timing fixture rows exactly.

## Changes per file

| File | Change |
|---|---|
| `src/sim/economy/projects.ts` (new) | Optional versioned project ledger; integer paid/progress days; exact rounded installments; monthly affordability pause/resume; half-paid cancellation; completion and Expo hooks; thin cancellation API and pure progress queries. |
| `src/sim/actions.ts` | Validated `plop()` project branch and concrete `startProject`/`cancelProject` methods. Initial charge is the first installment plus tree clearing. Sites have zero capacity and no premature opening headline. Bulldozing uses the half-paid refund, preventing the full-catalog-price same-day exploit. |
| `src/sim/economy/budget.ts` | `projects:installments` forecast and actual settlement after ordinary obligations, with unaffordable payments omitted from the actual ledger. Unfinished plops incur no upkeep/income or fallback utility output. |
| `src/sim/catalogTypes.ts` | Optional `buildMonths` and typed project gates, described below. Existing categories stay usable by CONTENT. |
| `src/sim/economy/tourism.ts` | Shared citywide draw multiplier includes the exact twelve-month Expo window. No Expo approval effect is added in round 2. |
| `tools/simbot.ts` | `--megaprojects`; saving starts at twelve expense months, managed taxes floor at 8% while saving, optional spending reserves the next installment, one project at a time, large-lot placement and six-station Express prerequisite. Yearly gate diagnostics report missing definitions explicitly. |
| **`src/sim/infra/params.ts` — infra, holds for B2** | Three additive constants beside their families: Express subway time `0.03 × 0.7`, wait `2.5`, station capacity `9000 × 1.5`. Original constants unchanged. |
| **`src/sim/infra/traffic.ts` — infra, holds for B2; outside explicit owns** | Import, per-instance completion snapshot in `prepTransit()`, and four consumers: crowding capacity, crowding base wait, transit-network subway time and `baseWait()` for park-and-ride. No scheduler changes or refactors. The plan's LG-03 do-section names traffic; the task owns-list omits it. |
| `src/sim/systems/economy.ts` — outside explicit owns | One import and one system registration before population, so the authoritative lifecycle runs in every host and headless simulation. |
| `src/sim/economy/landValue.ts` — outside explicit owns | One `built < 1` guard in `lvSplatFactor()` prevents construction sites giving their completed land-value benefit. Existing completion events activate it normally. |
| `tests/sim/projects.test.ts` (new) | Lifecycle, costs, simultaneous contracts, pauses, refunds/exploit, exact persistence, default Medium/Hard idle compatibility, real economy registration. |
| `tests/sim/projectHooks.test.ts` (new) | Actual Metro assignment time/wait/crowding/P&R, city isolation and removal, Expo draw and optional old-save data. |
| `tests/sim/botMegaprojects.test.ts` (new) | Opt-in parsing, saving/taxes/reserves, no-site retry, station prerequisite, missing definitions and exact gate boundaries. |
| `tests/sim/botLongGame.test.ts` — outside explicit owns | Removed only the obsolete row asserting that `--megaprojects` must be rejected. |
| This report | Definition and Worker handoff, evidence and remaining acceptance work. |

## Settled definition contract for T055

```ts
type ProjectKind = 'expressMetro' | 'fusion' | 'expo' | 'spaceCenter';
interface ProjectDef {
  kind: ProjectKind;
  population: number;
  stations?: number;
  education?: number;
  attractiveness?: number;
}
// On BuildingDef:
buildMonths?: number; // positive integer; exactly buildMonths * 30 construction days
project?: ProjectDef;
```

`cost` remains the full project price. Existing `jobs`, `upkeep`, `powerOut`, effects, `requires`, `unique`, footprint,
category and model fields retain their meanings. `buildMonths` activates installments and the construction site;
`project` supplies named effects and additional unlock gates. CONTENT chooses the IDs, models and footprints;
effects identify `project.kind`, never model IDs. `startProject()` validates both ordinary and project gates.
Sandbox bypasses population/quality gates and money, while keeping uniqueness. Only Expo retains a permanent
once-per-city prohibition after a completed building is demolished; cancellation of unfinished Expo permits a retry.

| Kind | Cost | Months | Project metadata |
|---|---:|---:|---|
| `expressMetro` | 1,500,000 | 18 | `population: 300000, stations: 6` |
| `fusion` | 4,000,000 | 30 | `population: 750000, education: 120` |
| `expo` | 3,000,000 | 24 | `population: 800000, attractiveness: 70` |
| `spaceCenter` | 6,000,000 | 36 | `population: 1150000, education: 125` |

CONTENT should use `unique: true` for the named unique structures. Fusion's regular output/jobs/upkeep fields are
4,000 MW / 600 jobs / §40k monthly; framework gating is already tested. Round-3 Fusion/Expo/Space mechanics and
CONTENT's production definitions are still separate work. No stand-in definitions are injected by the production bot.

`systemData.projects?: { v: 1; items: ProjectProgress[] }` is absent until the first project starts. Each record has
`buildingId`, `def`, optional `kind`, `totalCost`, `totalDays`, `progressDays`, `paid`, `paidDays`, `lastPaymentMonth`,
`paused`, `startedDay` and optional `completedDay`. Progress uses integer days, not accumulated floating-point `built`.
Completed records remain as history; dead unfinished records are pruned without credit. Construction makes no RNG draws.

Payment timing is explicit: first installment at placement, subsequent installments on calendar budget boundaries.
Late-month placement can therefore put two payments in its first reported month; it still opens after exactly
`buildMonths × 30` unpaused days. A missed installment stops work immediately, including remaining prepaid work,
until a later month can pay. Rounded cumulative prices telescope to the full catalog price. Ordinary obligations are
settled first; projects never themselves overdraw funds. Cancellation returns exactly `paid / 2`, excluding clearing.

GUIDE can use `projectList`, `projectProgress`, `projectPauseReason`, `nextProjectInstallment` and the saved day fields.
Budget's machine key is **`projects:installments`**, intended label **Mega-projects (installments)**. The human label,
inspector progress/opening date and bank-month display still belong to GUIDE; BudgetPanel was left alone.

## Verification

All Vitest commands were run one file at a time through the shared quiet gate. Standard Vite config loading failed
with **spawn EPERM** in `optimizeSafeRealPathSync`; a scratch-only native config with `resolve.preserveSymlinks: true`
and the threads pool ran successfully. No repository configuration was changed.

| Test file | Final result |
|---|---:|
| `tests/sim/projects.test.ts` | 18 passed |
| `tests/sim/projectHooks.test.ts` | 4 passed |
| `tests/sim/botMegaprojects.test.ts` | 9 passed |
| `tests/sim/actions.test.ts` | 41 passed |
| `tests/sim/economy.test.ts` | 12 passed |
| `tests/sim/tourism.test.ts` | 14 passed |
| `tests/sim/botLongGame.test.ts` | 27 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/infra/utilities.test.ts` | 6 passed |
| `tests/infra/traffic.test.ts` | 12 passed |
| `tests/save/continuity.test.ts` | 2 passed |
| **Total** | **162 passed, 1 existing skip** |

`npx tsc --noEmit` and `git diff --check` pass. Full-suite and browser checks were intentionally not run, per the
worktree's explicit shared-machine restrictions. Mid-construction save/load tests use the actual file bundle codec
and compare exact progress, payments, funds and `built` through 120 subsequent days, both paused and running.

Scratch evidence is under
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T046/scratch`.
Per-file `*-results.json` files contain test results. `base128.json` and `base128-repeat.json` contain all annual rows,
resident arrays and hashes; `final-evidence.json` records zero fixture/hash mismatches. The final hash with this driver's
canonical serializer is `f2696df0dba4e54bfe926313fd355871b1e9266387525d9ce900cb988101c6db`.
This verifies two-process determinism; its hash format is not asserted identical to T041's different diagnostic driver.

## Bot commands and acceptance status

The requested base command was attempted exactly through the quiet gate:

```text
npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

It fails before starting with **ENOTCACHED**: `tsx` is not installed in the offline npm cache. Instead, the scratch
`check-base.ts` driver imports the real `SimBot`/`botSystems`, bundles with installed Rolldown, writes annual JSON,
and compares every non-timing column to this base's signed `polish` fixture. It does not modify gameplay or definitions.
The first run gives `[62577, 92903, 38351]`, **193,831**, §178,743, **zero differing non-timing rows**.

Reproduction paths and equivalent commands:

```powershell
$T046Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$T046Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T046/scratch'
node node_modules/rolldown/bin/cli.mjs "$T046Scratch/check-base.ts" --platform node --format esm --dir "$T046Scratch/final-driver"
node $T046Quiet node "$T046Scratch/final-driver/check-base.js" "$T046Scratch/base128-repeat.json" --size 128 --years 15 --seed 7 --quiet
node $T046Quiet npx vitest run tests/sim/projects.test.ts --maxWorkers=1 --config "$T046Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T046Scratch/projects-results.json"
npx tsc --noEmit
```

The absolute variant gates are **not all passed**. The requested 256×60 seed-7 `--megaprojects` variant was run using
the real-source bundled driver. All four production definitions are absent from this base's catalog, so it completed
zero projects. It reproduced all 60 signed base non-timing rows exactly, with no injected definitions or balance edits.
This is a dependency mismatch between round-2 ownership and final acceptance. Repeat after T055 and round-3 effects:

```powershell
node $T046Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --megaprojects --quiet
# If tsx remains unavailable, the real-source bundled driver accepts identical options:
node $T046Quiet node "$T046Scratch/final-driver/check-base.js" "$T046Scratch/projects256-s7.json" --size 256 --years 60 --seed 7 --megaprojects --quiet
```

| Acceptance line | Current observed result | Field for the final acceptance rerun |
|---|---|---|
| ≥3 completions in 2030–2060 | **FAIL: 0**, all four definitions missing | `completed2030To2060 >= 3`, using exact day endpoints. |
| 2045 funds ≤12 expense months | **FAIL: 16.845602**; §7,961,080 / §472,591 monthly expenses | 2045 `bankMonths <= 12`. `operatingBankMonths` also excludes installments; currently identical. |
| Tax ≥8% while saving | **Not exercised**: saving never activates without candidate definitions | `lowestSavingTax >= 8`. The unit test covers the managed floor; an explicit fixed `--tax` intentionally overrides it. |
| Lowest daily funds ≥0 | **PASS: §4,481** | `lowestDailyBalance >= 0`. |
| Year-60 population ≥950k | **PASS: 1,511,394** | Final `pop >= 950000`. |
| Approval ≥50 from year 30 | **PASS: 78.078690** minimum | `lowestApprovalFromYear30 >= 50`. |
| EQ gate | **PASS: 120.071398** by year 30 | `bestEqByYear30 >= 100`, sampled only through day 10800. |

Final residents are `[409265, 736035, 366094]`, funds §14,534,867, approval 80.204731 and EQ 131.262756.
`projects256-s7.json` contains all annual rows/hashes and `projects256-gates.json` the complete gate summary plus zero
differences against the 60 base fixture rows. No cheaper bot-only projects or hidden acceptance exemptions were used.

A separate flags-off 256×60 run, seed 11, and a developed Hard two-process comparison were not rerun. The empty-catalog
project variant exactly matches the seed-7 base fixture; the base 128 exact check and Medium/Hard idle-save comparisons
also pass. No broad balance retune or fixture change was made. The provisional ±1% SIM base tolerance is not used to
soften the absolute project thresholds. Dense active-project G-STEP / frame checks await production definitions.

## Exact cloud-held Worker requests

No `src/worker/**` or save/recovery implementation file was edited. The explicit cloud hold overrides NOTE-048's
broader standing permission. Please route these additive rows to T034/T039:

1. `src/worker/protocol.ts`, `CommandOp` and `JournalOp`: add `startProject` and `cancelProject`; add optional
   `projects` to `SYSTEM_KEYS`. Existing generic recorder/replica plain-data copying should carry the versioned ledger.
2. `src/worker/SimHost.ts`, `Commands`: add
   `startProject(defId: string, x: number, z: number, rot: 0|1|2|3): ActionResult` and
   `cancelProject(buildingId: number): ActionResult`. Extend `CityActionsApi` and facade/proxy
   implementers together; this lane adds concrete `CityActions` methods without breaking held implementers.
3. `src/worker/SimCore.ts`, `applyCommand(cmd, actions)`: thin cases
   `case 'startProject': return actions.startProject(...cmd.args)` and
   `case 'cancelProject': return actions.cancelProject(...cmd.args)`, respecting the supplied preview/action facade.
4. `src/worker/PreviewActions.ts` methods and `predict()`, `HostActions.ts` methods, `PendingEdits.ts`, and the
   `src/game/ActionsProxy.ts` / `src/game/fallback/FallbackActions.ts` facade methods: predict with the concrete sim
   methods using `preview: true`; post through
   `host.act` with existing tags/gestures. Both count in pending. Start reserves its rotated lot, unique def and actual
   **first-installment-plus-clearing** cash cost, not the full catalog price. Cancellation reserves the removal lot and
   predicted refund. No optimistic writes into replica city state.
5. `src/worker/replicaSafe.ts` / query rows: audit and expose the pure progress, pause-reason and next-installment reads
   GUIDE needs, using the mirrored optional ledger. No new UI/game direct system reads are required.
6. `src/save/recoveryCodec.ts`, `JOURNAL_OPS` and `journalMatches()`: whitelist both commands and allow captured
   `cost`/`refund` for cancellation, currently restricted to bulldoze. `src/worker/recoveryMirror.ts`, `onAck()`: capture
   the authoritative cancellation amount. The design's `journal.ts` path is `recoveryMirror.ts` on this base.
7. `src/worker/SimCore.ts`, `replayRecoveryJournal()`: preserve the captured cancellation refund after replaying the
   removal. Installments since the snapshot change `paid`, whereas replay executes at the base's older day; recomputing
   half the base's paid ledger would lose the actual refund. Use the existing charge-preservation approach while booking
   a pure cancellation refund, without inventing demolition expense.
8. Add packet-host cases for refused/accepted starts, pending collisions/unique reservations, repeated cancellation,
   mirrored progress, mid-build save/load and journal recovery after payments changed the cancellation amount.

## Browser checklist for the lead

- [ ] After T055, check the Mega-projects category, all population/quality locks and the six-station Express lock.
- [ ] Place with exactly the first installment available; inspect crane/site and zero operating costs/output/jobs.
- [ ] Check the installment label, remaining balance and inspector's progress/opening date after GUIDE wiring.
- [ ] Force a missed installment; verify pause wording, fixed progress, no project overdraft and monthly resumption.
- [ ] Cancel and bulldoze sites at placement and mid-build; confirm exactly half paid, no repeat/full-price refund.
- [ ] Save/load and recovery-load a paused and a running site on the Worker host; progress/payment totals stay exact.
- [ ] Complete Express; verify faster subway, 2.5-minute base wait and 1.5× station capacity only in that city.
- [ ] With round-3 definitions/effects, check Fusion output starts at `built === 1`, Expo's twelve-month draw and tower,
  and Space Center's specified effects; check no immediate completed-building opening toast at placement.
- [ ] Run the absolute 256×60 gates above, full Vitest suite, and shared-machine real-GPU/frame/step checks.
