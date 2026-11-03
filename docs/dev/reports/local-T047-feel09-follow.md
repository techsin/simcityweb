# T047 — FEEL-09, review round 2

Round-2 fixes on `local/T047-feel09-follow`, based on `434e070` (the separate, already committed infra hunks are in `7e611c7`). These changes are **uncommitted**. No push, merge or `.done` file.

N1 and N4 are fixed. TypeScript passes; targeted validation passes **13 files, 239 tests, 1 skipped**. The new 1080p projection sweep has **0 frames over 3 px**, maximum **2.118 px** after settling. New real-GPU QA remains with the lead.

## Change per file

- `src/render/city/vehicles/EmergencyVehicles.ts`: caps right-turn rounding at filleted junctions using the mesher's live connected road widths, shared curb-fillet formula and actual truck geometry's inside half-width. The cap is approximately 0.87 cell for Roads and 0.52 for Streets; left turns and wider junctions retain their previous paths. Uniform two-arm bends retain arc behavior; mixed-width bends receive the filleted-junction cap. Drawing and Follow share the capped position and speed-blend window. Width reads use `RoadSurface.net.roadType`, including effective road types at rail crossings, with the mirrored network as fallback. In-place network edits are read live.
- `src/ui/EmergencyBanner.ts`: resolution or failure of the followed incident immediately stops Follow and hides the chip, including during arrival grace. Cached incident identity covers a missing vehicle or replaced dispatch candidate; resolving another incident preserves Follow.
- **Outside the named source files:** `src/render/city/common/netinfo.ts` adds the small `junctionFillet(halfWidth)` export. `src/render/city/roads/mesher.ts` imports it and replaces its existing formula with that call. The formula and road geometry are unchanged; the vehicle renderer shares the mesher's dimensions.
- `tests/render/emergencyTurnClearance.test.ts` (new): full truck bounding-rectangle clearance against curb fillets; Road/Road, Road/Street in both approach orders, Street/Street, left/right turns, projected motion, live width edits, mixed-width two-arm bends and an actual `NetInfo` rail crossing.
- `tests/game/emergencyFollowBanner.test.ts`: five new cases for resolution/failure during grace, unrelated resolution, a replaced candidate and a missing vehicle with a pruned candidate.
- `docs/dev/reports/local-T047-feel09-follow.md`: this report.

**No `src/sim/infra/*` hunk this round.** No cloud-held file changed. `CameraController.ts` and `CityScene.ts` need no further change. No new RNG draws, simulation mutations, saved fields, balance changes or dispatch decisions.

## Motion verification and plan-versus-code differences

The radius cap keeps the entire inside side edge of the actual truck outside the fillet, including the closest point between the axles. Its limit comes from the connected junction half-width and shared fillet formula; the 1.9 m lane offset remains. The same radius shortens the continuous speed-blend window. No separate lane-offset animation or simulation route change is needed.

Dense footprint sweeps sample the turn at intervals of at most 0.02 m. Minimum right-turn clearance is nonnegative (**+5.58e-8 m** at the closest sample, tangent within numerical precision); left turns have at least **1.100 m** clearance. Tests use the complete oriented rectangle's exact closest point to each fillet circle, rather than just wheel or corner samples.

Projection uses the real Three camera/controller without WebGL: **1920×1080, 38° FOV, 260 m, 50° tilt, 60 fps**, four yaws, left/right turns, 107→143 and 143→107 m/s approaches and four road-width combinations. All **64 combinations** stay within 3 px: maximum **2.117937 px**, no exceptions. The new sweep measures after one second of settling; every corner occurs several seconds later. Diagnostics: lane scratch `round2-turn-clearance.json`; set `T047_TURN_DIAGNOSTICS` to enable output. Existing corner/arrival and reduced-motion projection tests also pass.

**The 3 px and central-30%-box rules are measured from the settled camera.** Supplied round-2 real-GPU QA measures convergence **683–917 ms after the Follow click**. The earlier 317–583 ms figure measures entry into the box, not settling; the previous report's 0.6 s allowance was too short. Node measurements do not establish Worker clock continuity or replace GPU verification.

Reduced motion is unchanged: distance cuts to 260 m immediately; target tracking retains monotone λ = 6 damping without spring overshoot. The lead's round-2 QA verified both dispatch paths, auto-dispatch exclusion, chip/button behavior, input cancellation, two-second release and reduced/system motion on `434e070`.

## Gates and test names

Every Vitest file ran separately through the quiet gate with `--maxWorkers=1 --pool=threads`:

| Directory | Files and passed test counts |
|---|---|
| `tests/game/` | `emergencyFollowBanner.test.ts` 20; `emergencyBanner.test.ts` 38; `emergencyPolicy.test.ts` 21; `uiStacking.test.ts` 13; `emergencyFollowScene.test.ts` 7; `cameraControls.test.ts` 65 |
| `tests/render/` | `emergencyTurnClearance.test.ts` 11; `emergencyDrawnMotion.test.ts` 5; `emergencyFollowPosition.test.ts` 7; `cameraFollow.test.ts` 24 |
| `tests/infra/` | `emergencyFollowDispatch.test.ts` 9 |
| `tests/worker/` | `emergencyReads.test.ts` 2; `hygiene.test.ts` 17 passed, 1 skipped |

`npx tsc --noEmit` and `git diff --check` pass. Logs: scratch `round2-<test-name>.log`. Vitest uses the existing scratch-only `vite-netuse-fallback.mjs` preload for the optional Windows `net use` probe's synchronous `spawn EPERM`; Vite then uses its existing realpath fallback. No repository code, dependency or assertion is patched by this workaround. The thread pool avoids restricted child-process pipes.

Reproduce from this worktree, one file at a time:

```powershell
$lanes = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes'
$quiet = "$lanes/quietrun.mjs"
$scratch = "$lanes/T047/scratch"
$env:NODE_OPTIONS = "--import=file:///$scratch/vite-netuse-fallback.mjs"
$env:T047_TURN_DIAGNOSTICS = "$scratch/round2-turn-clearance.json"
node $quiet npx vitest run tests/render/emergencyTurnClearance.test.ts --maxWorkers=1 --pool=threads
node $quiet npx vitest run tests/game/emergencyFollowBanner.test.ts --maxWorkers=1 --pool=threads
# Repeat the single-file command for the remaining files in the table.
```

The lead verified **222 files / 2,212 tests**, TypeScript and the unchanged bot on `434e070`. No new full-suite or bot run for this render/UI-only round. Current-tree full-suite and real-GPU gates remain with the lead. Exact standard bot command, if rerun:

```powershell
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Required unchanged result: **residents [61124, 93804, 37971] = 192,899 in 2015**. No new balance result is expected. Medium/Hard continuation hashes were not separately rerun; no simulation behavior changed. No browser, full suite, benchmark or additional bot process ran here.

## Cloud-owner requests and unverified items

- **Worker clock:** `src/worker/LoopbackSimHost.ts:398–401`, `simTime()`: provide continuous presentation time across day boundaries while retaining packet reconciliation. QA observes the `day + 0.999` extrapolation cap stop the truck until the next packet, then leap about **4.7 m every sim day at LIVE**, producing **5.2–9.0 px** steps. This remains an independent exception to the Worker 3 px gate. No Worker edit here.
- **Simulation clock:** `src/sim/Simulation.ts:145–150`, `dayFraction` / `simTime()`: preserve fractional progress while paused instead of returning zero. Pausing currently snaps the drawn truck and Follow back to the start of the day. No edit here.
- **Query input:** `src/game/tools/QueryTool.ts:111–114`, pointer-down pan initiation: a plain left click calls `beginPan` and ends Follow. Defer cancellation until actual drag movement so click-to-inspect retains it; coordinate with the shared input owner. No edit here.

New GPU clearance and resolution behavior, current full-suite results and clock-owner fixes remain unverified here. The supplied QA's occasional far-acquisition rendering hitches were not investigated; they require the lead's GPU workflow.

## Browser acceptance checklist for the lead

- [ ] At LIVE, sweep right turns at Road/Road, Road/Street in both approach orders and Street/Street, with left turns as controls. The complete truck stays off the raised corner sidewalk and signal pole.
- [ ] From the **settled camera (683–917 ms previously measured)**, the truck stays in the central 30% and every corner, speed change and arrival remains ≤3 px at 60 fps, at 720p and 1080p. Record loopback day-boundary failures separately under the clock request above.
- [ ] Resolve the followed incident during its two-second arrival grace: Follow and chip end immediately, before the unit drives home. Resolving another incident does not interrupt Follow.
- [ ] Industrial accident: Send nearest and DispatchTool each follow only the player's truck; the auto-sent ambulance never becomes lead. Auto-dispatch alone offers no Follow.
- [ ] For an unresolved incident, release remains two real seconds after arrival. Drag, orbit, wheel, keys, Shift+right and touch release immediately; chip/hidden Follow button remain correct.
- [ ] Normal/reduced/system motion, yaw/tilt, old saves, reset/exit and docking remain correct. Reduced motion cuts directly to 260 m. Pause snap and plain-left-click behavior remain owner requests.
