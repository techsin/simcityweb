# T055 — LG-03 production content

## Round 2 — facility invariants after `ff336d4`

Round 1 is committed as `ff336d4`. The following fixes are uncommitted and explicitly requested by the worker's
round-2 review. No definitions, balance values, project lifecycle rules or pending catalog entries changed.

The four reported failures were:

- Matrix **part 1/4: `lm_world_expo`** had no effect metric in the civic table, and a 60-day run could not open its
  720-day project anyway.
- Matrix **part 4/4: `util_fusion_plant`** had unchanged power supply after 60 days because construction takes 900 days.
- Static facts **`tr_express_metro`** returned zero lines: it has no ordinary power, jobs, coverage or upkeep fields.
  Its real effect is the completed network upgrade. It also previously passed the matrix's transport report-only
  path without an effect metric; round 2 now measures it too.
- Upkeep **`util_fusion_plant`** exposed the test context's missing `host` when project lock hints read the replica.
  Its flat price is still §40,000/month in both displays; there was no pricing discrepancy.

| File | Round-2 change |
|---|---|
| **`src/sim/infra/facilities.ts` — INFRA, outside original named files; authorized by round 2** | Additive imports for project queries/calendar/Express tuning; two project role overrides; adjacent project facts/report helpers; an unfinished-site report return and ruined-unfinished-site upkeep guard; truthful completed-Expo ruin wording; a static facts block. No refactor, moved code, scheduler or accounting changes. |
| `tests/infra/facilities.test.ts` — outside original named files; named in round 2 | Extend existing prerequisite setups for six connected stations and an Expo visitor venue. Run real construction plus 60 operating days, with controls advanced for exactly the same time and setup. Require full paid cost, exact completion day and `built === 1`. Measure Metro's actual public station wait, Fusion's existing actual power supply metric and Expo's actual venue gross draw. Check decreasing metrics' direction too. No exemptions or invariant removals. |
| `tests/game/upkeepReads.test.ts` — outside original named files; named in round 2 | Supply the query seam plus `host.state` in the minimal display fixture (`queryHost` itself deliberately exposes only queries/events). Every original price/chip assertion remains. |
| `tests/infra/megaprojectFacilities.test.ts` (new) | Eight cases for catalog/tuned facts, real ledger pause/progress, no premature operating rows, ruined construction upkeep, completed Metro activation, exact Expo expiry and completed Expo's permanent commissioning prohibition. Completion and pause use the existing projects/budget systems. |
| This report | Round-2 diagnosis, verification and remaining checks. |

The matrix still enumerates every non-hidden ploppable; Space Center and the standalone Tower remain absent because
they have no production definitions. It does not shorten construction, overwrite `built`/completion ledgers, reduce
costs or add an artificial effect. Metro runs 540 + 60 days, Expo 720 + 60 and Fusion 900 + 60 in both treatment and
control. Expo's witness plaza and Metro's subway stations exist in both branches, like the existing station/ferry
partner setups. Their metrics read the real tourism pass and traffic assignment, rather than the completion flag.

Tooltip construction costs/months/gates come from the definitions; Metro's time/wait/capacity numbers come from
`EXPRESS_*` tuning. Expo's current multiplier comes from `expoDrawMultiplier`, and its one-year window uses the same
calendar constants as the lifecycle. No unimplemented approval, prestige or Tower-conversion benefit is claimed.
Completed Fusion retains the existing ordinary power report and upkeep display behavior.
Completed Expo ruins no longer promise rebuilding: its retained commissioning history really forbids that.

After waiting for the timing block to release, all commands ran serially through the supplied quiet gate. The same
scratch-only native Vitest config as round 1 was used; no repository configuration changed.

| Round-2 test file | Result |
|---|---:|
| `tests/infra/facilities.test.ts` (all matrix parts and static-facts invariant) | 15 passed |
| `tests/game/upkeepReads.test.ts` | 21 passed |
| `tests/infra/megaprojectFacilities.test.ts` | 8 passed |
| `tests/sim/megaprojectContent.test.ts` | 10 passed |
| `tests/game/megaprojectTools.test.ts` | 4 passed |
| `tests/assets/megaprojectModels.test.ts` | 17 passed |
| `tests/sim/catalog.test.ts` | 9 passed |
| `tests/assets/manifest.test.ts` | 16 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| **Total** | **117 passed, 1 existing skip** |

The matrix observes Metro station wait **3.50 → 2.50 min**, Fusion city power supply **400 → 4,400 MW**, and the
Expo witness plaza's gross draw **41.04 → 61.72** (rounded). Expo is measured 60 days after opening, with 300 active
days remaining. Its actual citywide draw multiplier is 1.5; the matched cities can also develop slightly different
attractiveness, so the final gross-draw ratio need not be exactly 1.5. The separate production integration test pins
the exact multiplier and expiry with controlled attractiveness.

The final `tsc --noEmit` and `git diff --check` pass. The fresh round-2 128×15 seed-7 bot gives
**[62577, 92903, 38351] = 193,831**, funds **§178,743**, zero non-timing fixture differences and **zero differences
in all 15 annual hashes** against round 1 (which already matched T046). Final hash remains
`f2696df0dba4e54bfe926313fd355871b1e9266387525d9ce900cb988101c6db`.

Using `T055Quiet` and `T055Scratch` as defined in the round-1 commands below, the exact round-2 commands are:

```powershell
node $T055Quiet npx tsc --noEmit
# Run separately for every file in the table; this is the formerly failing matrix command:
node $T055Quiet npx vitest run tests/infra/facilities.test.ts --maxWorkers=1 --config "$T055Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T055Scratch/round2-facilities-results.json"
# Requested bot entry point was retried; it still fails before simulation with npm ENOTCACHED (tsx unavailable).
node $T055Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
# Rebuild the equivalent driver from the current worktree, then run its real SimBot/systems:
node $T055Quiet node node_modules/rolldown/bin/cli.mjs "$T055Scratch/check-base.ts" --platform node --format esm --dir "$T055Scratch/round2-bot-driver"
node $T055Quiet node "$T055Scratch/round2-bot-driver/check-base.js" "$T055Scratch/round2-base128.json" --size 128 --years 15 --seed 7 --quiet
```

Scratch evidence: `round2-*-results.json`, `round2-base128.json`, `round2-final-evidence.json` and its
`round2-evidence.mjs` comparison driver. The report's matrix values are also recorded there as rounded observations.
Full Vitest, browser/GPU checks and the 256×60 acceptance run remain with the lead. No cloud-held source file was
edited and no new cloud request is added; round-1 Worker and round-3 requests below are unchanged.

Round-2 browser checklist:

- [ ] Inspect the three Mega-projects tooltips: actual cost/months/gates, tuned Metro numbers, Fusion power/jobs/upkeep,
  and no unimplemented Expo approval/prestige promises.
- [ ] Inspect running and paused sites: exact paid/progress values, pause amount, no operating output/jobs/upkeep;
  inspect a ruined unfinished Fusion site too.
- [ ] Complete through normal construction: Metro's upgrade and real station wait, Fusion grid output, Expo active
  draw/remaining window and ended wording at expiry. Titles match the catalog throughout.
- [ ] Confirm Fusion's toolbar/reward upkeep chips agree, and pending Space Center/Tower stay out of build lists.
- [ ] Run the full suite and the original round-1 GPU/256×60 checklist below.

## Round 1 — committed implementation and evidence

Implemented on `local/T055-lg03-content`, base `5173611` plus task commit `1f192f4`; subsequently committed as `ff336d4`.
No push, merge, `.done` file, browser, full-suite run or 256×60 bot run was made, as explicitly requested.

Express Metro, Fusion and World Expo are live. Space Center and the standalone Expo Tower have final models with
`pendingCatalog: 'LG-03'`. The default 128×15 seed-7 bot is bit-identical to **this T046 base**, including all 15 annual
state hashes: residents **[62577, 92903, 38351] = 193,831**, funds **§178,743**. The older 192,899 reference does not apply.

## Changes per file

| File | Change |
|---|---|
| `src/sim/catalog.ts` | Three production definitions using T046's unchanged contract, prices, durations, gates and `unique: true`. Fusion uses regular 4,000 MW / 600 jobs / §40k upkeep fields. No new reward IDs, cap relief, tourism attraction entries or RNG draws. |
| `src/game/toolCatalog.ts` | A Mega-projects tab in Rewards; projects appear once, outside the ordinary Power/Transport/Landmarks groups. Population, EQ, attractiveness and completed-station lock hints read `ctx.host.state`. Existing unique/ruin disabling and host-based PlopTool placement remain in use. Metro/Fusion icons added. |
| `src/assets/builders/megaprojects.ts` (new) | Five deterministic procedural models: Metro operations hall/entrances, clean toroidal Fusion campus, Expo fairground/tower, standalone Expo Tower, and Space Center rocket/gantry/mission control. Shared material surfaces provide night lighting and seasonal foliage. |
| `src/assets/builders/index.ts` | Registers the production model bundle. |
| `src/assets/builders/polish_stubs.ts` | Removes only the five superseded project registrations, preventing them from overwriting real models. |
| `src/assets/manifest.ts` | Promotes the five models to their real groups, describes final geometry/heights, marks only Space/Tower pending, and gives Space an 8,000-triangle showpiece budget. Existing footprints retained. |
| `gallery.html` | Day, night and winter-foliage review links for all five models; explicit `month`/`climate` query values initialize existing seasonal setters before gallery rendering. No default season change. |
| `tests/sim/megaprojectContent.test.ts` (new) | Production gates/actions, Fusion opening in both the fallback estimate and actual UtilitiesSystem, exact Expo draw window/history, default opt-out, and controlled real bot placement/completion of all three projects. |
| `tests/game/megaprojectTools.test.ts` (new) | Rewards grouping/category highlighting, exact lock boundaries, usable station counting, host reads, sandbox and unique/ruin disabling. |
| `tests/assets/megaprojectModels.test.ts` (new) | Every production model/variant, registry versus direct-builder hashes, finite attributes, bounds/heights/budgets, structural faces, seasonal/night metadata and deterministic LOD proxies. |
| **`tests/assets/manifest.test.ts` — outside named files** | Minimal removal of obsolete expectations that the five promoted project models remain neutral 200-triangle stubs. Remaining stub checks unchanged. |
| **`tests/sim/botMegaprojects.test.ts` — outside named files** | Minimal before/after fixture isolation: remove production projects during synthetic strategy tests and restore original objects/indices afterward. Otherwise real Expo becomes a valid fallback in a test intended to exercise only its fake gated candidates. Production behavior is tested separately. |
| This report | Evidence, remaining gates and owner handoffs. |

**Infra hunks: none. Cloud-held file hunks: none.** No T046 framework file or shared tuning file was changed.

## Live definitions and remaining simulation work

| Definition | Lot | Cost / months | Gates | Status |
|---|---|---|---|---|
| `tr_express_metro` | 2×2 | §1.5M / 18 | 300k residents, 6 completed usable subway stations | Live: existing time ×0.7, wait 2.5 min, capacity ×1.5 hooks. |
| `util_fusion_plant` | 6×6 | §4M / 30 | 750k residents, EQ 120 | Live: 4,000 MW, 600 job places, §40k catalog upkeep, no smoke. |
| `lm_world_expo` | 6×6 | §3M / 24 | 800k residents, attractiveness 70 | Live: existing exact 360-day citywide draw ×1.5; permanent once-per-city history. |
| `rw_space_center` | 8×8 | Future §6M / 36 | Future 1.15M residents, EQ 125 | Final art only; pending round-3 jobs/I-HT cap/campus implementation. |
| `lm_expo_tower` | 2×2 | No independently purchasable def | — | Final art only; pending round-3 Expo site-to-tower lifecycle. |

The round split in the plan calls Fusion/Expo round 3. The explicit T055 handoff says their implemented hooks should
be live now, so both have production definitions. Expo's **+3 approval and conversion to the standalone Tower are
absent from T046**. Its description promises only the implemented tourism effect. Its current fairground model
already includes the same permanent tower geometry; it does not shrink or change def when the exhibition ends.

No new `ProjectDef` fields, stand-in effects, invented upkeep/jobs for Metro/Expo, or ordinary reward unlocks were added.
Fusion's §40k is the regular catalog upkeep: the existing utility load/funding formula still determines actual bills
(an unloaded plant pays `40000 * UTIL_FIXED`), and its 600 job places fill through the ordinary workforce system.

## Verification

All test files ran individually and serially through the supplied quiet gate. Normal Vite config loading failed
before tests with **spawn EPERM** in `optimizeSafeRealPathSync`. As in T046, a scratch-only native config with
`resolve.preserveSymlinks: true`, the threads pool and cache disabled ran successfully. Repository config unchanged.

| Test file | Result |
|---|---:|
| `tests/sim/catalog.test.ts` | 9 passed |
| `tests/assets/manifest.test.ts` | 16 passed |
| `tests/assets/megaprojectModels.test.ts` | 17 passed |
| `tests/sim/megaprojectContent.test.ts` | 10 passed |
| `tests/game/megaprojectTools.test.ts` | 4 passed |
| `tests/sim/botMegaprojects.test.ts` | 9 passed |
| `tests/sim/projects.test.ts` | 18 passed |
| `tests/sim/projectHooks.test.ts` | 4 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/save/continuity.test.ts` | 2 passed |
| **Total** | **106 passed, 1 existing skip** |

`npx tsc --noEmit` and `git diff --check` pass. Existing project tests include exact mid-construction save/load and
idle Medium/Hard compatibility. A developed Hard two-process run was not performed. No balance fixture was edited.

The funded production-bot integration test builds **three real projects**, costing exactly **§8.5M** over **72 months**
starting in 2030, without injecting definitions or changing prices/durations. This verifies candidate discovery,
connected placement, gates, financing and completion; its controlled 96-tile map and funds are **not** the 256×60 gate.

### Art evidence (CPU, no GPU screenshots)

Each named unique model has one variant. Every variant builds without fallback, stays inside its lot and height,
has finite attributes and night/winter material metadata. The existing automatic LOD keeps night-window surfaces.

| Model | Height m | Full triangles / budget | LOD triangles / 200 |
|---|---:|---:|---:|
| Express Metro | 12 | 786 / 3,000 | 134 |
| Fusion | 48 | 1,692 / 3,000 | 74 |
| World Expo | 95 | 1,692 / 8,000 | 190 |
| Expo Tower | 95 | 664 / 8,000 | 76 |
| Space Center | 58.6 | 2,168 / 8,000 | 138 |

Expo's provisional 20–30 m stub range becomes 95 m to include its tower; all five stub footprints are retained.
Winter uses the existing dormant lawns/bare deciduous crowns; the shared building shader has no snow mode.
CPU builds and material metadata do not establish visual quality, GPU shader compilation or frame cost. In particular,
review the automatic distant tower/gantry silhouettes. Existing builders/materials/renderers were not modified.

### Bot evidence and commands

Scratch root:
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T055/scratch`.
Per-file `*-results.json`, `art-evidence.json`, `base128.json`, `base128-repeat.json` and `final-evidence.json` contain evidence.
The source driver imports only this worktree's real SimBot/systems/serializer and compares signed non-timing rows.

```powershell
$T055Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$T055Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T055/scratch'
# Requested command: attempted, failed before simulation with npm ENOTCACHED (tsx unavailable offline).
node $T055Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
# Equivalent real-source driver: bundled once, run in two separate node processes.
node node_modules/rolldown/bin/cli.mjs "$T055Scratch/check-base.ts" --platform node --format esm --dir "$T055Scratch/bot-driver"
node $T055Quiet node "$T055Scratch/bot-driver/check-base.js" "$T055Scratch/base128.json" --size 128 --years 15 --seed 7 --quiet
node $T055Quiet node "$T055Scratch/bot-driver/check-base.js" "$T055Scratch/base128-repeat.json" --size 128 --years 15 --seed 7 --quiet
# Example of the per-file test invocation (repeat with each file above).
node $T055Quiet npx vitest run tests/assets/megaprojectModels.test.ts --maxWorkers=1 --config "$T055Scratch/vitest.config.mjs" --configLoader native --reporter default --reporter json --outputFile "$T055Scratch/megaprojectModels-results.json"
```

Both processes give **[62577, 92903, 38351]**, **193,831**, **§178,743**, zero non-timing fixture differences and zero
annual hash differences, also against T046's saved `base128.json`. Final canonical SHA-256:
`f2696df0dba4e54bfe926313fd355871b1e9266387525d9ce900cb988101c6db`.
Catalog additions do not enter the default bot's fixed reward lists, hard-coded utility choices or attraction list.

**Left for the lead; not run here:**

```powershell
node $T055Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --megaprojects --quiet
# Equivalent fallback while tsx is unavailable; production definitions and strategy are unchanged:
node $T055Quiet node "$T055Scratch/bot-driver/check-base.js" "$T055Scratch/projects256-s7.json" --size 256 --years 60 --seed 7 --megaprojects --quiet
```

| Acceptance input | Number required from the lead's 256×60 run |
|---|---|
| Completions, exact 2030–2060 day endpoints | `completed2030To2060 >= 3` |
| 2045 bank | `bankMonths <= 12` (also record funds and monthly expenses; includes installments) |
| Managed tax while saving | `lowestSavingTax >= 8` |
| Daily cash floor | `lowestDailyBalance >= 0` |
| Year-60 population | `pop >= 950000` |
| Approval from year 30 | `lowestApprovalFromYear30 >= 50` |
| T046 EQ acceptance input | `bestEqByYear30 >= 100`; actual Fusion placement additionally requires EQ 120 |

The strategy **can** place and complete the three live definitions in the controlled integration test. Completion by
2060 in the acceptance city remains unverified. It is plausible: T046's flags-off evidence reaches the 12-month
saving threshold around 2030, 750k around 2038 and 800k around 2039, with attractiveness above 70. The opt-in strategy
changes layout, subway spending and project cash flow, so these dates are an inference, not projected gate results.
The bot's expected `missingKinds` is now exactly `['spaceCenter']`.

## Requests for held/other-owner files

1. **Cloud Worker:** `src/worker/protocol.ts`, `SYSTEM_KEYS`: add optional `projects`, and verify recorder/replica
   copying, including initial ready/load packets. Currently `recorder.ts` filters it out even from the ready snapshot.
   Without it, Expo's retained once-per-city preview and unfinished-site bulldoze refund preview cannot match the
   authoritative result. Generic `host.act('plop')` already reaches the real project action and reserves its predicted
   first installment/lot/uniqueness; this lane added no direct action path.
2. **Cloud Worker:** `src/worker/replicaSafe.ts` and its parity tests/queries: audit/expose `projectAvailable`,
   `projectList`, `projectProgress`, `projectPauseReason`, `nextProjectInstallment` once the ledger is mirrored.
   Toolbar quality hints currently use only already mirrored stats/station records, rather than importing the
   unaudited lifecycle module. Permanent Expo-history disabling after demolition needs this ledger handoff.
3. **Cloud Worker:** finish T046 report's exact dedicated start/cancel command, pending prediction, journal and
   captured-cancellation-refund requests. They remain outstanding; this task does not modify them.
4. **Round-3 SIM:** `src/sim/economy/projects.ts` completion/lifetime handling and `src/sim/economy/approval.ts`:
   implement Expo's +3 approval window and site-to-Tower transition, preserving completion history. Tower is final
   art and pending; plan the footprint/ledger transition explicitly (site 6×6, standalone Tower 2×2).
5. **Round-3 SIM/CONTENT:** implement Space Center effects and its production definition, then remove its pending flag.
   Its intended metadata remains the settled §6M/36 months/pop 1.15M/EQ 125 contract; do not mark art live prematurely.
6. **GUIDE:** existing inspector, budget installment/bank-month and placement running-cost wording handoffs in T046's
   report remain. This task only adds the Rewards tab and lock hints; full-price catalog cost remains visible.

## Lead browser/GPU checklist

- [ ] Open Rewards → Mega-projects at ordinary and sandbox difficulty; exactly three live rows, with no duplicates in
  Power/Transport/Landmarks, correct prices/descriptions/icons and toolbar highlighting.
- [ ] Check population boundaries, Fusion EQ 120, Expo attractiveness 70, six usable completed stations, sandbox
  bypass and unique/ruin disabling. Reopen the flyout after gate changes.
- [ ] Review all five model IDs in gallery Day, Night and Winter foliage links; every variant at default and close/
  street zoom, front/back and a tower-top close-up. No OUT-OF-LOT/HEIGHT/OVER-BUDGET flags or console errors.
- [ ] Inspect lit Metro M/canopies, Fusion reactor/transformers, Expo pavilion roofs/tower deck and Space rocket,
  gantry/dish. Check holes, flicker, coplanar faces, tree seasons and distant LOD silhouettes.
- [ ] Compare a few existing landmark/town/dense-city shots; take real-GPU screenshots/contact sheets.
- [ ] Place with only the first installment available; inspect large-lot crane/site, no premature opening, zero
  construction output/jobs/upkeep; complete Fusion and verify the connected grid gains output only at `built === 1`.
- [ ] Exercise pause/resume, cancellation/bulldoze half-paid refund and mid-build save/load/recovery on the Worker
  host after the held ledger/journal handoffs; compare authoritative and preview results.
- [ ] Verify Expo's exact 12-month tourism window and retained once-per-city behavior; approval/conversion and Space
  effects wait for round 3 and are not claimed in this lane.
- [ ] Run the full Vitest suite, the 256×60 acceptance commands/gates above, and shared-machine real-GPU frame/step
  checks (including the round's +1 ms / +3 draw-call budget). These were intentionally left unverified here.
