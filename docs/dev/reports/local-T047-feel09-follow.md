# T047 — follow the truck you sent

Implemented on `local/T047-feel09-follow`; changes are uncommitted. No push or `.done` file, per the worktree instructions.

**Acceptance remains open:** the literal 3 px limit does not hold at sharp turns with the specified λ = 6, 260 m camera and current vehicle animation. Vitest and bot execution are also blocked by this sandbox. No browser or GPU run was attempted.

## Changes by file

- `src/render/world/CameraController.ts`: `follow`, `stopFollowing`, `following`; λ = 6 position and logarithmic distance damping toward 260 m, preserved yaw/base tilt, immediate release on pan/zoom/orbit/focus, and a two-second wall-clock on-scene grace. A disappearing vehicle during grace leaves the camera at its last scene target. Normal camera and flight paths retain their previous damping.
- `src/render/city/vehicles/EmergencyVehicles.ts`: `followPosition(vehicleId)` reads the emergency feed and extrapolated clock, using the renderer's lane/parking offset and road surface height. It follows a fixed ID without simulation-system reads.
- `src/ui/EmergencyBanner.ts`: stable camera-icon Follow button, player recognition by `host.cause.tag === banner` or `DispatchTool`, Send nearest tag, and unit-ID differences from event-time incident records. The earliest arrival (ID tie-break) across one command is the lead. The chip shows the unit, station and remaining emergency minutes; reset, exit and input release clear it. Tracking is bounded to active incidents; old-save units are seeded after lazy boot. The chip reserves space in dirty docking without per-frame layout reads.
- `src/game/CityScene.ts`: small constructor bridge and two camera methods connecting the banner to the renderer/controller; reduced motion uses `resolveMotion(settings.motion)`.
- **Outside named source files; infra hunks:** `src/sim/infra/emergency.ts`, two isolated locations. `dispatch()` passes `true` to `afterDispatch`; its optional `manual = false` parameter emits `dispatched` in the supporting-only early-return branch only for a manual dispatch. Without this event, a manually sent supporting ambulance has no cause-tagged event for Follow. The incident stays waiting for its primary responder. Automatic dispatch takes its previous path. Keep these hunks separate when integrating B2.
- New tests: `tests/render/cameraFollow.test.ts`, `tests/render/emergencyFollowPosition.test.ts`, `tests/game/emergencyFollowBanner.test.ts`, `tests/game/emergencyFollowScene.test.ts`, `tests/infra/emergencyFollowDispatch.test.ts`.

Reduced motion skips the automatic zoom animation by setting 260 m immediately; target tracking keeps monotone λ = 6 damping, with no spring or overshoot. The preference is resolved when Follow starts.

No RNG draws, save keys, balance constants or speed-policy changes were added. The additional manual support event does not change the incident's state or dispatch outcome; the existing policy ignores `dispatched` events and reads incident state.

## Checks and remaining gates

- **Passed:** `npx tsc --noEmit`; `git diff --check`.
- **Blocked before test collection:** each new test file above, `tests/game/cameraControls.test.ts`, and `tests/worker/hygiene.test.ts`, each attempted separately through the quiet gate with `--maxWorkers=1`. Vite config loading fails in `externalize-deps` / `windowsSafeRealPathSync` with `spawn EPERM`. New-test logs and `vitest-attempts.json` are in the supplied lane scratch folder. No Vitest assertions ran.
- **Full Vitest:** left to the lead, as explicitly instructed; not run here.
- **Bot:** `npx tsx` fails with offline `ENOTCACHED`. A second quiet-gated attempt using the existing cached tsx CLI fails in esbuild with `spawn EPERM`. Logs: `bot128y15s7.log`, `bot128y15s7-cached.log` in lane scratch. No new population result was produced.
- **Still required:** bot final residents **[61,124, 93,804, 37,971] = 192,899 in 2015**. No balance change is intended. Medium/Hard state identity and old-save continuation are not runtime-verified here; no two-process hash run was performed.

Re-run from this worktree, one process at a time:

```powershell
$quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node $quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
node $quiet npx vitest run tests/render/cameraFollow.test.ts --maxWorkers=1
node $quiet npx vitest run tests/render/emergencyFollowPosition.test.ts --maxWorkers=1
node $quiet npx vitest run tests/game/emergencyFollowBanner.test.ts --maxWorkers=1
node $quiet npx vitest run tests/game/emergencyFollowScene.test.ts --maxWorkers=1
node $quiet npx vitest run tests/infra/emergencyFollowDispatch.test.ts --maxWorkers=1
node $quiet npx vitest run tests/game/cameraControls.test.ts --maxWorkers=1
node $quiet npx vitest run tests/game/emergencyBanner.test.ts --maxWorkers=1
node $quiet npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1
```

Tests cover λ = 6, yaw/tilt preservation, reduced-motion monotonicity, straight-drive projection at LIVE speed, real-time expiry, all camera inputs, renderer positioning/arrival, auto-dispatch exclusion, mixed packet ordering, multiple events per command, lazy-loaded saves, cleanup, docking, and manual supporting-unit events.

## Plan versus code

The supporting-only early return did not emit `dispatched`; the isolated infra change above supplies that missing event. No Worker interface changes were needed. The task file's push/commit/`.done` footer is superseded by the user's explicit leave-uncommitted instructions.

The scratch probe `cameraFollowProjectionProbe.mjs` was run with `node --experimental-strip-types`. It uses the actual controller and Three camera at **1280 × 720, 38° FOV, default LIVE free-flow road speed 106.67 m/s**:

| Path | Largest truck screen step | Central 30% |
|---|---:|---|
| Straight, initially centred, 800 m easing to 260 m | 2.689 px | yes |
| Straight, initially centred, already at 260 m | 5.808 px at acquisition | yes |
| 90° turn after the zoom settles | 6.858 px | yes |
| Same turn with the renderer's 1.9 m lane offset | 9.508 px | yes |

The unit projection test covers the first row, not the complete Refinery route. The existing vehicle heading/lane offset changes instantly at corners; λ = 6 smoothing cannot suppress the truck's own screen displacement. A truck initially 1 km from the camera target also remains outside the central region during acquisition. **The whole-drive 3 px acceptance is not met by this diagnostic.** Resolving it needs the lead's choice about acquisition/corner animation or the specified follow response/distance; no balance or vehicle-motion workaround was added.

Cloud-held file requests: **none**. No cloud-held file was edited. The real Worker provider is not available on this base for browser validation; the implementation consumes the existing host feed/cause seam.

## Browser checklist for the lead — real GPU, Worker, Refinery

- [ ] Trigger industrial fire, Send nearest: Follow appears with camera icon; automatic supporting ambulance does not become the player's lead.
- [ ] Follow: correct truck and station chip, remaining ETA, yaw/tilt preserved, distance approaching 260 m.
- [ ] Measure central 30% for the whole LIVE drive, including initial acquisition and every corner.
- [ ] Measure every frame against 3 px at 60 fps; investigate the diagnostic violations above.
- [ ] Camera releases two real seconds after on-scene arrival, including paused/stalled frames; chip disappears then.
- [ ] Query drag, middle drag, Shift+right drag, orbit, wheel, touch and keyboard camera input release immediately.
- [ ] DispatchTool and repeated Send nearest commands select only their own lead; automatic dispatch never offers Follow.
- [ ] Reduced/system motion omits zoom animation and does not overshoot; old saves, exit/reset, panels and toolbar docking behave correctly.
