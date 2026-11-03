# T047 — FEEL-09, review round 1

Review fixes on `local/T047-feel09-follow`, after WIP commits `aece5b4` (infra) and `1d287f2` (WORLD). These fixes are **uncommitted**. No push, merge or `.done` file.

The seven reported test failures are fixed. The targeted run passes **21 files, 286 tests, 1 skipped**; TypeScript passes. The 128×15 seed-7 bot remains **[61,124, 93,804, 37,971] = 192,899 in 2015**.

## Changes per file

- `src/ui/EmergencyBanner.ts`: selects Follow candidates exclusively from the manual dispatch event's `sent` IDs, still gated by `host.cause` and the banner/DispatchTool tag. Removed the stale incident-unit snapshots and lazy-boot seeding. Multiple batches within one command still select their earliest arrival, with ID tie-break. ETA changes to `on scene` when the extrapolated clock reaches arrival. Follow hides while its unit is active, and a second synthetic click cannot restart it. The production DOM structure is unchanged this round.
- `src/render/city/vehicles/EmergencyVehicles.ts`: one shared `drawnVehiclePosition` helper supplies drawing and Follow. Quadratic corners span ±1 cell, limited to half each adjacent segment; the tangent supplies heading and continuous lane offset. Segment speeds blend through turns; the final stop and LANE→PARK offset ease over ±0.12 path-minute. Drawing, lights and glows share this position. Simulation routes and `vehiclePosition` stay unchanged. Cached render geometry detects in-place replica route/time updates.
- `src/render/world/CameraController.ts`: requests a prediction horizon of `1 / λ` real seconds from its source, using the same λ = 6 as its damping. The two-second arrival timer still uses the source's current-time `onScene` flag.
- `src/game/CityScene.ts`: converts that horizon through the current `host.secondsPerDay()` for the renderer feed; prediction is disabled while paused. No system read or mutation was added.
- **Outside the named source files — isolated infra hunks:** `src/sim/infra/emergency.ts`: (1) optional `EmergencyDispatchEvent.sent` subtype next to the event types; (2) `dispatch()` collects IDs directly from `sendUnit`; (3) `afterDispatch()` forwards that batch in primary and supporting manual events; (4) `emit()` attaches it when supplied. Automatic events omit `sent`. These hunks remain apart for B2. Existing recorder/protocol cloning preserves the optional field; no Worker or `Simulation.ts` edit was needed.
- Tests updated: `tests/game/emergencyFollowBanner.test.ts`, `tests/game/emergencyFollowScene.test.ts`, `tests/infra/emergencyFollowDispatch.test.ts`, `tests/render/cameraFollow.test.ts`, `tests/render/emergencyFollowPosition.test.ts`. New: `tests/render/emergencyDrawnMotion.test.ts`.
- **Existing test outside the original task's file list:** `tests/game/uiStacking.test.ts`: one fixture line adds a hidden `followChip`. Its six affected cases bypass the constructor and call `dock()` on a mock; the missing field caused `undefined.style`. Assertions and production layout are unchanged.

The Send nearest test now supplies an available dispatch option. Previously its empty fleet mock changed the label to `No free unit`, so searching for `Send nearest` returned undefined.

## Motion verification and plan differences

**The central-box and 3 px rules apply after the approximately 0.3–0.5 s acquisition phase; the supplied real-GPU QA measured 317–583 ms.** The node test allows 0.6 s, covering that measured range, then measures every turn, speed change, arrival and grace frame.

The look-ahead uses the drawn position plus its tangent velocity × `1/λ`, rather than sampling a finite future point as the QA prototype did. Velocity comes from reusable samples of the same render helper. This removes the remaining acceleration lag. During the eased stop, prediction is clipped between the current drawn position and the parked endpoint, preventing endpoint overshoot. Arrival eligibility and the release timer use current time, not predicted time.

The deterministic projection test uses the real Three camera/controller at **1280×720, 38° FOV, 260 m, 50° tilt, 60 fps**, four yaws and normal/reduced motion. Each route contains four 90° turns and alternates the QA's 107 and 143 m/s speeds:

| First segment speed | Cases | Frames measured | Maximum step, including arrival | Frames >3 px | Maximum absolute NDC | Endpoint overshoot |
|---|---:|---:|---:|---:|---:|---:|
| 107 m/s | 8 | 14,008 | 1.056 px | 0 | 0.0167 | 0 m |
| 143 m/s | 8 | 13,176 | 1.411 px | 0 | 0.0218 | 0 m |

Diagnostics are in lane scratch `round1-motion.json`; set `T047_MOTION_DIAGNOSTICS` to an output path when running `emergencyDrawnMotion.test.ts` to reproduce them. These are node projection results, not new real-GPU measurements. Reduced motion still omits zoom animation and uses monotone damping; both motion modes pass the endpoint check.

No RNG draws, saved fields, balance constants or dispatch decisions changed. Hard bit identity was not separately hash-tested; the Medium bot matches exactly, and the emergency reload tests pass.

## Gates and test names

All files below ran separately through the quiet gate, with `--maxWorkers=1 --pool=threads`:

| Directory | Files and passed test counts |
|---|---|
| `tests/game/` | `uiStacking.test.ts` 13; `emergencyFollowBanner.test.ts` 15; `emergencyFollowScene.test.ts` 7; `emergencyBanner.test.ts` 38; `emergencyPolicy.test.ts` 21; `dispatchBusy.test.ts` 3; `dispatchCommands.test.ts` 2; `cameraControls.test.ts` 65 |
| `tests/render/` | `cameraFollow.test.ts` 24; `emergencyFollowPosition.test.ts` 7; `emergencyDrawnMotion.test.ts` 5 |
| `tests/infra/` | `emergencyFollowDispatch.test.ts` 9; `emergencySupport.test.ts` 6; `emergency.test.ts` 25; `emergencyBurst.test.ts` 10; `emergencyReload.test.ts` 3; `emergencyNotes.test.ts` 9; `emergencyPlantGrace.test.ts` 3; `emergencyBot.test.ts` 2 |
| `tests/worker/` | `emergencyReads.test.ts` 2; `hygiene.test.ts` 17 passed, 1 skipped |

`npx tsc --noEmit` and `git diff --check` pass. The full suite and new browser/GPU QA remain with the lead, per the worktree rules. No full suite, browser or benchmark was run here.

The ordinary Vitest command still failed before collection: Vite's optional Windows `net use` probe throws synchronous `spawn EPERM`. A **scratch-only** preload, `vite-netuse-fallback.mjs`, reports that one failed probe through its existing error callback; Vite then uses its ordinary realpath fallback. It changes no repository file, dependency, game code or assertion. The thread pool avoids process-pipe restrictions. Per-file output is in scratch `round1-<test-name>.log`.

Reproduction from this worktree:

```powershell
$lanes = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes'
$quiet = "$lanes/quietrun.mjs"
$scratch = "$lanes/T047/scratch"
$env:NODE_OPTIONS = "--import=file:///$scratch/vite-netuse-fallback.mjs"
node $quiet npx vitest run tests/game/emergencyFollowBanner.test.ts --maxWorkers=1 --pool=threads
node $quiet npx vitest run tests/game/uiStacking.test.ts --maxWorkers=1 --pool=threads
# Run each remaining file from the table with the same single-file command.
```

The bot used the repo's documented Rolldown fallback for unavailable tsx, with unchanged size/year/seed arguments:

```powershell
node node_modules/rolldown/bin/cli.mjs tools/simbot.ts --platform node --format esm --dir "$scratch/round1-bot"
node $quiet node "$scratch/round1-bot/simbot.js" --size 128 --years 15 --seed 7
```

Equivalent normal simbot invocation: `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`. The fallback run completed successfully and printed `residents [ 61124, 93804, 37971 ]`; log: scratch `round1-bot128y15s7.log`. No balance change or new expected population is requested.

## Requests and remaining browser checks

- **Simulation owner request, no edit here:** `src/sim/Simulation.ts`, `dayFraction` / `simTime`: preserve fractional progress while paused instead of returning zero. QA observed the truck and follow target jump back to the start of the sim day, with the ETA increasing. Please verify the same clock contract for the Worker feed.
- **QueryTool note, no edit here:** a plain Query left click still calls `beginPan` on pointer-down and releases Follow. I would defer cancellation until the first actual drag movement, retaining click-to-inspect; that needs coordination with the shared QueryTool input hunk.
- No cloud-held file was changed. No other cloud-held file request is needed.

The supplied WIP GPU QA already passed release timing, input cancellation, chip and reduced motion. Recheck the changed behavior on the real GPU/Worker:

- [ ] Industrial accident: Send nearest and DispatchTool both follow only the player's truck, excluding the silently auto-sent ambulance.
- [ ] After acquisition (317–583 ms previously measured), truck stays in the central 30%; every turn, speed change and arrival stays ≤3 px at 60 fps. Recheck both 1280×720 and the QA's 1920×1080 view.
- [ ] Chip switches to `on scene` at extrapolated arrival; Follow is hidden while active and cannot restart on a second click.
- [ ] Release remains two real seconds after on-scene arrival; drag, orbit, wheel and camera keys release in the same frame. Include Shift+right and touch, which the previous QA did not separately cover.
- [ ] Normal/reduced/system motion, old saves, reset/exit and panels/toolbar docking remain correct. The pause snap and plain-left-click behavior remain the owner requests above.
