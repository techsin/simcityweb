# T047 report: FEEL-09, follow the truck you sent (desktop, real GPU)

**Verdict: done; holds for B2.** Every FEEL-09 Acceptance line passes on the real GPU after the review rounds below.
The lane's two `src/sim/infra/emergency.ts` commits hold for B2's merge (NOTE-046 Q1); everything else is ready.

**Cloud carry-over (Nov 10):** merged with dev after B2 on `cloud/t047`. The banner conflict with T048 and FH-08 is
resolved, keeping both sides. Gates are green: vitest 3,106 passed, 0 failed, and the bot is identical to dev at
198,115. The post-merge browser QA is the desktop's. See "Cloud carry-over (Nov 3)" at the end.

Branch `local/T047-feel09-follow`:
- base dev `fb1531f`; dev `50a6b29` merged in as `733c5d7` (clean, CityScene.ts auto-merged);
- `1d287f2` the lane, with `aece5b4` (infra, holds for B2);
- `434e070` review round 1, with `7e611c7` (infra, holds for B2);
- `2397ab6` review round 2; `7ccf3ed` the N5 round.

**The infra hunks (hold for B2):** `EmergencySystem.afterDispatch` takes the ids of the vehicles a manual dispatch sent
and puts them on the `dispatched` event as optional `sent`, also when only a supporting responder went (the ambulance
of an industrial accident). Follow leads with the player's own unit from that list, never with an automatic one.
No route, RNG draw, balance or save data changes; the bot is identical.

## Real-GPU QA (RTX 5070 Ti, ANGLE D3D11, Chromium)

| FEEL-09 Acceptance | Result | Measured |
|---|---|---|
| The truck stays in the central 30 % for the whole drive at LIVE, no step over 3 px at 60 fps | **PASS** | Round 4, from the settled camera: vet21 max 2.74 / p99 1.83 px, bot256 max 2.88 / p99 1.94 px, **0 frames over 3 px**; box \|NDC\| ≤ 0.05 × 0.02. Round 3: 0 frames over 3 px in all 6 runs at 720p and 1080p. |
| Control returns 2 s after the unit is on scene; any drag ends Follow at once | **PASS** | 2 s timer release at 2001-2016 ms. An incident that resolves during the grace ends Follow on the next frame (1560 ms). Middle drag, Shift+right drag, wheel, W and touch end it in the same frame. |
| Auto-dispatched units never show Follow | **PASS** | Send nearest and DispatchTool both lead with the player's truck, never the auto ambulance; the auto-dispatch case offers no Follow. |

**Also checked:**
- **Turn clearance (N1, N5):** on the real road mesh, every synthetic junction type (Road and Street L-bends, a Street
  built across a Road, Road×Street, Street×Street, Road×Road) and the 418 real corners of vet21 and bot256 keep the
  truck off the raised sidewalk (tangent at worst, ≤ 1 mm). Signal poles, streetlights and street-tree trunks
  are ≥ 0.88 m clear.
- **Road meshes:** byte-identical to dev on both cities (64 of 64 chunks).
- No console or page errors.

QA notes: scratchpad `qa/T047/qa.md`, rounds 1-4, with data and shots.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest with the fixtures (`7ccf3ed`) | **223 files passed, 1 skipped; 2,241 tests passed, 7 skipped; 0 failing** |
| Full vitest after the dev merge (`7111b02`) | **227 files passed, 2 skipped; 2,293 tests passed, 11 skipped; 0 failing** |
| 128×15 s7 bot with the action log, both commits | **identical to dev:** residents [ 61124, 93804, 37971 ] = 192,899 |

## Left open, with their owners

- **N2, the loopback clock at day boundaries** (`LoopbackSimHost.ts:398-401`): about a 4.7 m leap per sim day at LIVE,
  5.2-9.0 px steps. The cloud's T061 item 2 owns it. The 3 px line above is measured on the default host.
- **B3, pause snap-back** (`Simulation.ts:145-150`, `dayFraction` returns 0 while paused): the drawn truck and Follow
  snap back to the day start. Sim clock owner.
- **B5, a plain Query left click ends Follow** (`QueryTool.ts:111-114`): defer the cancel until the pointer
  actually drags. Tools owner.
- **N6, highway overpass turns** keep their pre-existing path: the truck leaves the deck sideways along the sim's
  automatic ramp, which has no ramp mesh. Road render / transport owner.
- **N7, the avenue lane offset** is in `docs/dev/POLISH_BACKLOG.md`: a fixed 1.9 m puts the truck's left side 0.37 m
  over the avenue's median curb.

The lane's own round notes follow.

## The N5 round (7ccf3ed): the lane's notes

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

## Cloud carry-over (Nov 3)

The cloud takes T047's merge round for the desktop, which is at its 20-agent cap (NOTE-084, Nov 10). Branch
`cloud/t047`, from `origin/local/T047-feel09-follow` @ `97a84b0`, worktree `scratchpad/co/t047`. Sources read: the
task file; NOTE-046 Q1/Q3, NOTE-048, NOTE-049, NOTE-053, NOTE-057, NOTE-060, NOTE-061 and NOTE-064 (the ones naming
T047), NOTE-044, NOTE-083 and NOTE-084 (cloud/lead-notes); POLISH_PLAN FEEL-09 (line 1098) and FEEL-08 (line 2419) in
full with their Acceptance; this report; the lane's diff against dev. Per NOTE-061 and NOTE-084 the cloud runs no
browser: the desktop runs the post-merge QA ("QA T047: PASS/FAIL"); the list is at the end of this section.

### Gap list (written first)

What FEEL-09 and the task file require, against what `97a84b0` holds:

| Requirement | State at `97a84b0` |
|---|---|
| Follow, with a camera icon, after a player dispatch (DispatchTool or Send nearest), by `host.cause`, never by text | done (`recordDispatch`: `tag === this` or `tag instanceof DispatchTool`); tested |
| Camera target on the lead vehicle, λ = 6, from the renderer's drawn state (no sim read); yaw and tilt kept; distance eases to 260 m | done (`CameraController.follow`, `EmergencyVehicles.followPosition`); tested |
| Ends 2 s after on scene, or on any pan, zoom or orbit input | done (2 s real-time timer; every input path calls `stopFollowing`); tested |
| Chip "Following Fire truck from Fire Station #1 · 1.1 min" | done; tested |
| Player-dispatched units only; camera only | done; auto units never lead; tested |
| Reduced motion: no overshoot; say what changes | done: the 260 m distance cuts at once; the target keeps monotone λ = 6 damping (no spring), so there is no overshoot |
| Unit tests: smoothing (no step over 3 px at 60 fps), end conditions, auto-dispatch no Follow | done (cameraFollow, emergencyDrawnMotion, emergencyFollowBanner, emergencyFollowScene, emergencyFollowDispatch) |
| Real-GPU browser gates in the Refinery scenario | done on the desktop before the merge (rounds 1-4, table above) |

Gaps the cloud found at the start of this round:
1. **Dev moved 414 commits** since the lane's last merge (`50a6b29`): B2 (`2dd0fe5`), T048 (FEEL-10), T036s5 (FH-08),
   T061 and others. `src/ui/EmergencyBanner.ts` conflicts with T048 and T036s5 (known); both sides must be kept.
2. **The infra hold lifts.** The lane's two `src/sim/infra/emergency.ts` commits held for B2 (NOTE-046 Q1); B2 is in dev,
   so they merge now. The bot must stay at dev's new reference, 198,115 (NOTE-083), not 192,899.
3. **The gates on the merged tree:** tsc, the full vitest, the hygiene test, and the bot against a clean dev export.
4. **The lane's tests against dev's banner:** dev's banner subscribes through `host.events`, gains the LIVE badge, the
   outcome flash and the teaching cards; the lane's harness and abort path must still hold with them.
5. **WIP commits** (`1d287f2`, `434e070`, `2397ab6`, `7ccf3ed`, all `wip(...)`): verify line by line.
6. **N2 (the loopback clock at day boundaries) was owned by T061,** which is now in dev: the desktop's post-merge QA
   should re-measure the 3 px line on the worker host. B3 (pause snap-back) and B5 (a plain Query click ends Follow)
   stay open with their owners; dev has not changed either (`Simulation.ts:157-161`, `QueryTool.ts:111-114`).
7. **The .done line** names the old bot reference (192,899) and "holds for B2"; it needs this lane's cloud line.

### What the cloud did

1. **Merged dev three times:** `1d47cd4` onto `573b49e`; `78b416d` onto `9ae7b28` (T028: tools and docs only); and
   `5152b27` onto `43679b3` (the TopBar split: `src/ui/TopBar.ts`, `src/ui/topbar/**` and tests, none of them T047's files).
   `src/ui/EmergencyBanner.ts` had 9 conflict hunks against T048 (FEEL-10) and T036s5 (FH-08); every side is kept:
   - the Follow button joins dev's separate `body` block (`jump, send, choose, follow`), so FH-08's teaching cards,
     appended to `body`, still sit below the button row;
   - the banner record keeps dev's `body` and the lane's `follow`;
   - the constructor takes the optional `EmergencyFollow` and keeps dev's cached `this.policy`;
   - reset and dispose stop Follow, then run dev's flash, episode, teaching and LIVE-badge clean-up;
   - Dismiss forgets the follow candidate and acknowledges FH-08's teaching;
   - Send nearest keeps dev's gesture, with the same `tag: this` that Follow recognises;
   - tick refreshes the chip and prunes candidates, then runs dev's `renderPolicy(this.policy)` and its pending failure
     lesson.
   `CityScene.ts`, `emergency.ts` and `POLISH_BACKLOG.md` merged cleanly.
2. **Fixed one merge interaction** (`be35c05`). On the merged tree, dev's `tests/game/emergencyLive.test.ts` ("keeps one
   renewal loop ... removes listeners and timers on abort") failed: the lane's abort path ran `refreshFollow()` first,
   which read `host.simTime()` even with nothing followed; dev's harness host has no clock, so the throw skipped
   dev's clean-up and left `emg-live` on. Now `refreshFollow` reads the clock only for a followed unit, and the abort
   handler runs dev's clean-up first, then stops Follow. The real host always has a clock, so this was a robustness gap
   rather than a visible bug; the dev test is the regression test (it fails without the change).
3. **Updated the lane's banner harness** (`be35c05`): dev's banner subscribes through `host.events` and reads
   `host.speed` and `host.liveSlowdown`; all 20 Follow banner tests had failed on "Cannot read properties of undefined
   (reading 'on')". No assertion changed.
4. **Two new tests** in `tests/game/emergencyFollowBanner.test.ts`, each shown to fail with its code removed:
   - `e710220`: sent ids under another cause, or none, offer no Follow. Removing the banner's cause check
     (`tag === this || tag instanceof DispatchTool`) failed no test before, because `sent` comes only from dispatch
     commands today; this pins the "recognised by host.cause" rule.
   - `d8a83ae` (merge coverage): a resolved or failed incident ends Follow (camera, chip and button) and still gets
     FEEL-10's `emg-saved` / `emg-lost` flash and outcome line. It fails with either side's code removed.
5. **Checked the WIP commits line by line** (`1d287f2`, `434e070`, `2397ab6`, `7ccf3ed`; the `wip(...)` prefix marks the
   Codex lane's commits, which the desktop then QA'd):
   - `CameraController.ts`: every pan, zoom, orbit, key, touch, edge-scroll, `focusOn`, `setView`, `rotateStep` and
     dispose path calls `stopFollowing()`. The keyboard stops it only for camera keys, so Space or the tool keys keep
     Follow. Follow damps the target and the distance with λ = 6. The 2 s grace is real time (`performance.now()`).
     The minimum-tilt push is off while following, so the player's tilt is kept. Reduced motion sets the distance at
     once.
   - `EmergencyVehicles.ts`: `drawnVehiclePosition` is render-only. The sim route, `vehiclePosition` and the event
     timing are untouched. Route geometry is cached per path array, model bounds per model, with no per-frame
     allocation. `followPosition` reads the renderer's feed (`feed.vehicles()`, `feed.time()`), never the sim.
   - `netinfo.ts` / `mesher.ts`: `junctionFillet` is the mesher's old expression moved into one place
     (`Math.min(2.5, HALF - b - 0.05)`), so road meshes are unchanged.
   - `emergency.ts`: only the `dispatched` event's optional `sent` ids. It also emits `dispatched` when a manual
     command sends only a supporting responder. Every consumer was checked: SimCore ignores `dispatched`;
     DispatchTool ends only when no unit is missing; GameSounds records a player dispatch the way it already does.
     No route, RNG, balance, save or state change.
   - `CityScene.ts`: the Follow source converts the look-ahead through `host.secondsPerDay()` and `host.speed` (host
     reads, not sim reads), and reduced motion goes through `resolveMotion`. The hygiene test passes.
6. **Mutation spot checks on the lane's tests** (on a copy; the worktree was untouched): λ 6→30 fails
   `cameraFollow` "damps the rendered position with lambda 6"; no 2 s grace fails 2 cameraFollow cases; a wheel that
   keeps Follow fails "wheel returns camera control immediately"; dropping the support-only `dispatched` event fails
   2 `emergencyFollowDispatch` cases.

### Gates

| Gate | Tree | Result |
|---|---|---|
| tsc (`sem`) | `78b416d`, `d8a83ae`, `5152b27` | clean each time |
| Full vitest (lock), `npx vitest run --configLoader runner` | `d8a83ae` (dev `9ae7b28` + the lane + the fixes) | **306 files passed, 4 skipped; 3,106 tests passed, 32 skipped; 0 failed** (356 s) |
| Hygiene test (`tests/worker/hygiene.test.ts`) | `d8a83ae`, `5152b27` | passes (in the full run and the targeted runs) |
| After the TopBar merge: TopBar, banner and hygiene files (`sem`, 2 workers) | `5152b27` | 11 files, 185 tests passed |
| Lane targeted files (`sem`, 2 workers): the 13 files of the N5 round plus dev's banner, LIVE, outcome and teaching files | `be35c05` | 20 files, 346 tests passed; `emergencyTurnClearance` 24 passed |
| Bot 128×15 seed 7 (lock), lane | `d8a83ae` | residents [ 61828, 95515, 40772 ] = **198,115** |
| Bot 128×15 seed 7 (lock), clean dev export | `9ae7b28` (`scratchpad/co/t047-devbase`) | residents [ 61828, 95515, 40772 ] = **198,115** |
| Bot comparison | | every year row 2001-2015 identical, apart from the two timing columns (econms, totalms) and the run time |
| Real-GPU browser gates (FEEL-09 Acceptance) | `7ccf3ed` / `7111b02` | PASS on the desktop before the merge (table above). The post-merge recheck is the desktop's (NOTE-084), see the Desktop QA list |

The bot does not change: the lane's only sim hunk adds optional `sent` ids to an event payload, and the TopBar commits
that came in after the bot runs are UI-only.

### Decisions

1. **The bot reference is 198,115, not the task file's 192,899.** NOTE-083: every tree containing B2 (`2dd0fe5`)
   expects 198,115. The lane equals dev's own run on the same tree.
2. **No browser on the cloud.** NOTE-061 and NOTE-084 give the post-merge QA to the desktop. The desktop's real-GPU
   rounds 1-4 stand for the lane's code. The merge-only states are in the Desktop QA list (line 5).
3. **The infra hunks merge now.** NOTE-046 Q1 held them for B2, and B2 is in dev. They change no sim state, and the bot
   is identical.
4. **The 3 px and central-30 % lines are read from the settled camera**, not during the first 0.7-0.9 s acquisition
   flight after the click. This is the desktop's reading in rounds 3-4. It is the conservative way to read "for the
   whole drive" for a camera that starts away from the truck, and the lead may tighten it. The Desktop QA list keeps
   the same reading so the numbers compare.
5. **Merge layout:** the Follow button is the last button in the row (`jump, send, choose, follow`), inside dev's
   `body` block. FH-08's teaching cards stay below the row. On abort, dev's clean-up runs before Follow's, so a
   failure in one cannot skip the other.
6. **Open items keep their owners** (they predate this round, and no lane hunk touches their files): B3 pause
   snap-back (sim clock, `Simulation.ts:157-161`), B5 a plain Query left click ends Follow (tools, `QueryTool.ts:111-114`),
   N6 highway overpass turns (road render / transport), N7 avenue lane offset (`POLISH_BACKLOG.md`). N2 moves from
   "open" to "re-measure" because T061 item 2 is in dev (Desktop QA line 2).

### Browser evidence

None from the cloud. NOTE-061 moved all browser and real-GPU checks to the desktop, and NOTE-084 asks it for the
post-merge QA. The desktop's pre-merge real-GPU results (rounds 1-4, tables above) stand for the lane's own code. The
merge changed only the banner wiring (the Follow button's place in dev's `body` block, and the clean-up order), so the
list below covers the merged states and the re-measures.

### Desktop QA list (post-merge, "QA T047: PASS/FAIL")

Test `cloud/t047` at the head named in the `.done` line, or dev once it is merged. Default (local) host unless a line
says otherwise.
1. **Refinery scenario at LIVE** (an industrial fire, then Send nearest): a Follow button with the camera icon appears;
   click it. Expected: the truck stays in the central 30 % for the whole drive, 0 frames over 3 px at 60 fps from the
   settled camera, at 720p and 1080p, and control returns 2 s after the unit is on scene.
2. **N2 re-measure** (T061 item 2 is now in dev): repeat line 1 across at least two sim-day boundaries with
   `?simworker=loopback` and with `?simworker=1`. Before T061, the steps were 5.2-9.0 px. Report the
   max step. If it is still over 3 px, it belongs to T061's follow-up (T087), not T047 (NOTE-049).
3. **Both dispatch paths:** Send nearest and Choose station… (DispatchTool) follow only the player's unit. An
   auto-dispatched incident never shows Follow, including the industrial ambulance case.
4. **Release:** middle drag, Shift+right drag, right-drag orbit, wheel, W/A/S/D, Q/E rotate, touch, a minimap click and
   the banner's Jump each end Follow and hide the chip in the same frame. Space (pause) and tool hotkeys do not.
5. **Merged banner states (new in this merge):**
   - a. Resolve or fail the incident while following. Expected: Follow ends, the chip hides, and the banner flashes
     green or red (FEEL-10), then lingers with its outcome line and no Follow button.
   - b. FH-08's first-emergency teaching card on a fresh profile (tips on), together with the Follow button. Expected:
     the card sits below the button row, nothing overlaps, and the stack docks above the toolbar with the chip shown
     (the chip's 34 px + 8 px reserve).
   - c. LIVE badge (`emg-live`) and the chip shown together. Exit to the region while following. Expected: no chip
     left, the camera released, `emg-live` cleared, no console errors.
6. **Reduced motion** (Settings → motion reduced, and system with the OS setting): the distance cuts to 260 m, the
   target glides with no overshoot, and yaw and tilt are kept.
7. **Pause while following** (B3, known): note what the truck and the camera do with `?simworker=loopback` (T061's paused
   clock) against the default local host (`Simulation.dayFraction` is 0 while paused). This is information for the clock owner, not a T047 gate.
8. **Edge scrolling on** (Settings): clicking Follow on a banner keeps following; moving the pointer to the screen edge
   ends it (a pan input).
