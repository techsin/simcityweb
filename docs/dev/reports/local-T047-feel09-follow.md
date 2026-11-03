# T047 — FEEL-09, review round 4 (N5)

Fixes on `local/T047-feel09-follow`, based on `2397ab6`. Changes remain **uncommitted**; no push, merge or `.done` file. Both remaining right-turn layouts are covered. TypeScript passes; **13 targeted files, 252 tests passed, 1 skipped**. New real-GPU verification remains with the lead.

## Change per file

- `src/render/city/vehicles/EmergencyVehicles.ts`: uniform right L-bends now cap their rounded span at `HALF / CELL_SIZE` (0.5 cell), using the existing constant that defines the road mesher's 8 m bend. Filleted junctions use the narrower of the incoming/outgoing arm edge widths, each computed as `max(own width, connected neighbour width)`, matching `NetInfo.edgeHalf`. A Street cell crossed by Road arms therefore uses its narrower Street approach rather than the widest box. Drawing and Follow still share one position helper and the same speed-blend window.
- The expanded sweep also reproduced QA's roughly 6 cm left-turn tail swing onto the preceding Street sidewalk. The same source file now limits the lane offset during left turns using the actual vehicle's front/rear bounds, tangent and adjacent curb widths. It changes only where the nominal 1.9 m offset would cross a curb; ordinary Road approaches retain their offset. Bounds are cached without per-frame allocations. Avenue arc paths and highway-owned turns keep their existing paths.
- `tests/render/emergencyTurnClearance.test.ts`: expands the four existing layouts to eight: Road/Road, Road/Street, Street/Road, Street/Street, both axis orders of Street-centred mixed crossings, Road L-bend and Street L-bend. Tests build the actual road mesh and check the full truck rectangle against raised sidewalk triangles and actual pole/trunk geometry, including neighbouring cells. It retains live-width and mixed two-arm cases, adjusts the effective rail-crossing fixture for the narrower-arm rule, and adds an exact unchanged-pose regression for highway turns (N6).
- `docs/dev/reports/local-T047-feel09-follow.md`: this report.

**No infra hunks, no hunks outside the named source/test files, and no cloud-held file edits this round.** The shared `HALF`, `HALF_W` and `junctionFillet` exports already exist, so neither the mesher nor `netinfo.ts` needs another edit. No simulation routes, RNG draws, balance, save data, commands or dispatch decisions changed. No banner, camera or scene wiring changes were needed.

## Verification and plan-versus-code differences

Before the source fix, the expanded test reproduced Road L-bend overlap **0.513 m**, Street L-bend **1.913 m**, mixed Street-cell taper overlap, and the left Street tail overlap. The old test used a circular fillet for every junction and did not model the arc piece or the taper inside a mixed cell. The new test takes geometry directly from `RoadMesher`, rather than substituting that idealized corner.

Each of the eight layouts is swept in **16 orientations** (left/right, reverse route, four rotations), through ±2 cells at nominal 0.05 m intervals. Sidewalks come from the real mesh's SIDEWALK triangles. Pole/plinth/head and tree Wood triangles are clipped to truck height and transformed using the mesher's actual placement, variant, yaw and scale. Per-triangle checks avoid treating empty space between branches as a solid box. All required layouts pass; all prop separating gaps are positive. No arbitrary pole or tree radius is introduced.

Actual-mesh checks allow Float32 coordinate precision, `N * CELL_SIZE * 2^-23` = **0.244 mm** on this test map. The smallest signed sidewalk gap is **−0.0244 mm**, at an analytically tangent curb after Float32 rounding near world coordinate 1,000 m. The independent analytic fillet assertions retain their original 1e-6 m tolerance. SAT gaps establish non-overlap within coordinate precision; they are not Euclidean clearance measurements.

The projection sweep covers **256 combinations**: eight layouts, left/right, reverse route, 107→143 and 143→107 m/s, and four camera yaws. It uses the actual draw/Follow/controller path at **1920×1080, 38° FOV, 260 m, 50° tilt, 60 fps**. Maximum measured step is **2.117937 px**; **0 frames exceed 3 px** after settling. Existing motion tests also cover arrival and reduced motion. Diagnostics: lane scratch `round4-turn-baseline.json`, `round4-turn-clearance.json`; baseline failure log `round4-turn-baseline.log`.

**The 3 px and central-30%-box rules apply from the settled camera**, not initial acquisition. Prior supplied QA measured settling **683–917 ms after the click**; new node motion checks begin after one second, with every corner several seconds later. Reduced motion is unchanged: distance cuts immediately to 260 m, with monotone λ = 6 target damping and no spring overshoot.

The supplied round-3 GPU QA on `2397ab6` verified all 418 real bot-city corners, no frames over 3 px, resolution release and byte-identical dev road meshes (64/64 chunks per city). Those bot cities contain neither missing piece layout. This round changes only vehicle drawing and tests; it does not regenerate or alter road geometry differently.

## Gates and test names

All files ran separately through the quiet gate with `--maxWorkers=1 --pool=threads`:

| Directory | Files and passed test counts |
|---|---|
| `tests/game/` | `emergencyFollowBanner.test.ts` 20; `emergencyBanner.test.ts` 38; `emergencyPolicy.test.ts` 21; `uiStacking.test.ts` 13; `emergencyFollowScene.test.ts` 7; `cameraControls.test.ts` 65 |
| `tests/render/` | `emergencyTurnClearance.test.ts` 24; `emergencyDrawnMotion.test.ts` 5; `emergencyFollowPosition.test.ts` 7; `cameraFollow.test.ts` 24 |
| `tests/infra/` | `emergencyFollowDispatch.test.ts` 9 |
| `tests/worker/` | `emergencyReads.test.ts` 2; `hygiene.test.ts` 17 passed, 1 skipped |

`npx tsc --noEmit` and `git diff --check` pass. Logs: lane scratch `round4-<test-name>.log`. Tests use the existing scratch-only `vite-netuse-fallback.mjs` preload for Vite's optional Windows `net use` probe throwing synchronous `spawn EPERM`; it invokes Vite's existing realpath fallback. No repository code, dependencies or assertions are patched by the preload. The thread pool avoids restricted process pipes.

Reproduction from this worktree, one file at a time:

```powershell
$lanes = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes'
$quiet = "$lanes/quietrun.mjs"
$scratch = "$lanes/T047/scratch"
$env:NODE_OPTIONS = "--import=file:///$scratch/vite-netuse-fallback.mjs"
$env:T047_TURN_DIAGNOSTICS = "$scratch/round4-turn-clearance.json"
node $quiet npx vitest run tests/render/emergencyTurnClearance.test.ts --maxWorkers=1 --pool=threads
# Repeat the single-file command for each remaining file above.
```

The lead verified TypeScript, **223 files / 2,228 tests** and the unchanged **192,899** bot on `2397ab6`. I did not rerun the full suite or bot for this render-only fix. Current-tree full-suite and GPU gates remain with the lead. If rerunning the bot, its exact standard command and required result are:

```powershell
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Expected **residents [61124, 93804, 37971] = 192,899 in 2015**. No different balance result is expected. Medium/Hard continuation hashes were not separately rerun. No browser, full suite, benchmark or bot process ran here.

## Owner requests and unverified items

- **N6, pre-existing highway overpass turns — left unchanged.** Plan-view sweeps overlap the at-grade road's sidewalk under the deck by 0.6–1.5 m. Visually the vehicle leaves the deck sideways along the simulation's automatic ramp, for which no ramp mesh exists. Coordinate route/deck/ramp geometry with the transport/road-render owner; this predates FEEL-09. The new regression confirms identical poses with/without the network adjustment across both highway turn directions.
- **Worker clock:** `src/worker/LoopbackSimHost.ts:398–401`, `simTime()`: make presentation time continuous across day boundaries while reconciling packets. The `day + 0.999` extrapolation cap stops the truck then causes about a **4.7 m** leap each sim day at LIVE, producing **5.2–9.0 px** steps. This remains an independent Worker 3 px gate exception. No Worker edit here.
- **Simulation clock:** `src/sim/Simulation.ts:145–150`, `dayFraction` / `simTime()`: preserve fractional progress while paused. Returning zero currently snaps the drawn truck and Follow back to the day start. No edit here.
- **Query input:** `src/game/tools/QueryTool.ts:111–114`, pointer-down pan initiation: defer Follow cancellation until actual drag movement so a plain click-to-inspect retains it. No edit here.

New real-GPU clearance and motion, current full-suite results, clock-owner fixes and occasional far-acquisition rendering hitches remain unverified here. Node geometry/projection checks do not establish Worker clock continuity or GPU timing.

## Browser acceptance checklist for the lead

- [ ] On a fresh map, build Road and Street uniform L-bends and a Street built across a Road (Street crossing cell). At LIVE, sweep both route orders and turn directions; truck footprint clears raised sidewalks, poles and corner trees. Include the left Street tail near the preceding curb.
- [ ] Recheck existing Road/Road, Road/Street, Street/Street and real bot-city corners after the cap changes. Road meshes remain unchanged.
- [ ] From the settled camera, maintain central 30% and ≤3 px at 60 fps through corners, speed changes and arrival, at 720p and 1080p. Keep loopback day-boundary failures separate under the clock request.
- [ ] Both dispatch paths follow only player-sent units; auto-dispatch offers no Follow. Resolution ends Follow/chip immediately; unresolved incidents retain the two-second arrival grace.
- [ ] Drag, orbit, wheel, keys, Shift+right and touch release immediately. Normal/reduced/system motion, yaw/tilt, old saves, reset/exit and docking remain correct; reduced motion cuts to 260 m.
- [ ] Keep N6 highway ramps, pause snapping and plain-left-click cancellation listed as unchanged owner items.
