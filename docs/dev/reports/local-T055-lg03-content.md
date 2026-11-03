# T055 — LG-03 production content

Implemented on `local/T055-lg03-content`, base `5173611` plus task commit `1f192f4`. Changes are uncommitted.
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
