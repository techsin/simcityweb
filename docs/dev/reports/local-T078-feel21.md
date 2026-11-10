# T078 — FEEL-21 motion and flashing settings (FH-24)

Implemented META and WORLD hooks on `local/T078-feel21`, based on `146c885`. Round 1 is committed; round 2 remains
uncommitted. The desktop worker clarified that `Fireworks.ts` is available and authorized the renderer changes.
**All FEEL-21 behavior on this base is now implemented**, including live half-strength fireworks and a shared flash
rate limit. The direct CPU probe passes; formal Vitest and real-GPU browser acceptance remain unverified below.

## Changes by file

- `src/game/settings.ts`: adds `watchMotionPreference`, with device-change listeners bound to the city's AbortSignal.
  The existing `motion: 'system' | 'full' | 'reduced'` key, defaults, validators and persistence remain the schema.
  Round 2 adds `reducedFlashing(settings)`, a live OS-aware read for Weather and city effects; no new stored key.
- `src/region/settings.ts`: one small hunk enables the existing title-screen motion control (`A11Y_WIRED.motion`).
  No title-screen/dialog implementation changes; FH-12's dialog hunks are untouched.
- `src/ui/panels/SettingsPanel.ts`: a separate Accessibility section and navigation entry, System / Full / Reduced
  choices, and the effective `Reduced (your device)` / `Full (your device)` status. Changes persist through the existing
  `ctx.applySettings` path; the device status updates while the panel is open.
- `src/game/CityScene.ts`: a separate `applyMotion` method and small constructor/settings hooks. Applies root classes,
  cancels active HUD animations when reduced is enabled, updates the camera, releases New Year's cinematic ownership,
  and calls the fireworks brightness hook with 0.5 / 1. Device changes apply immediately without saving over
  the player's `system` preference. These hooks are shared by local, loopback and worker hosts; no host internals or
  simulation state are changed.
- `src/render/city/effects/Fireworks.ts` **(round 2, explicitly authorized)**: `setFlashStrength(0.5 | 1)` switches
  current particles and lighting immediately, including a frozen show. Full keeps the original shader source verbatim
  and the original director/arithmetic path. Reduced halves spark/reflection output, smoke's own-burst glow and
  ground/water/fill flash output (after the fill light's nonlinear mapping). No particle data, native lifetimes, RNG,
  sounds or shell scheduling change. Fast strobe/random glitter/reflection blinking becomes steady, and embers/split
  stars fade in. Flash/crackle onsets coalesce on a shared 400 ms grid: at most three in a rolling second. Shader
  admission intersects that onset with the original lifetime, so short pops missing their tick stay dark. City,
  ground, water and nearby smoke lighting use the same grid and fade out within 160 ms. Pool ownership/selection keeps
  its original envelope for Full recovery; only rendered radiance uses the Reduced envelope.
- `src/render/world/CameraController.ts`: a small live `reducedMotion` accessor clears active shake and cancels an active
  flight at the displayed view. Reduced motion rejects subsequent shake and skips focus flights to their destination.
  This covers both WorldView's initial earthquake shake and CityScene's repeated quake shake. Ordinary user camera
  damping and Full mode retain their existing behavior.
- `src/game/NewYear.ts`: reduced motion skips the camera, countdown and day/night time lapse. Enabling it during a show
  immediately releases the camera at its current position, calendar hold and clock ownership, and hides the countdown.
  An already scheduled fireworks show continues. Full mode and later Full celebrations retain their existing behavior.
- `src/ui/Notifications.ts`: reduced news items stay at x=0 with ordinary item rotation, tooltip and click actions;
  long clauses do not scroll. Duplicate toast badge pops obey motion. No per-frame layout reads were added.
- `src/ui/Toolbar.ts`: one import and one guard suppress the locked-card shake while retaining its error feedback.
- `src/ui/hud.css`: an isolated reduced-motion block, including a guarded OS media fallback. Pulses, blinking, coach
  marks, music animations, timers and spinners become static; toast entry/exit use opacity only, 150 ms. Covers the
  loading veil beside the HUD too. Explicit Full overrides the OS fallback.
- `src/ui/emergency.css`: suppresses the ignored-press settling flash under reduced motion.
- `src/ui/fx.css`: during T048's 600 ms outcome class, reduced motion retains the normal incident border and shadow;
  outcome text carries the result. Neither a temporary colour change nor a bright ring/glow remains.
- New tests: `motionSettings.test.ts`, `reducedMotionCamera.test.ts`, `reducedMotionNewYear.test.ts`,
  `motionNotifications.test.ts`, `motionCss.test.ts`, all under `tests/game/`.
- Round-2 tests: `tests/render/reducedFireworks.test.ts` and `tests/game/reducedFlashing.test.ts`.
  `tests/render/fireworks.test.ts` stays untouched. No rank-fireworks or audio changes were needed.
- `tests/game/titleSettings.test.ts` **(outside the named source files; existing test fixture only)**: three small lines
  snapshot/restore the shipped feature flags and explicitly set the old unwired flags for that fixture. Its existing
  unwired-control tests remain valid; the new motion test checks that the shipped flag is enabled.
- This report.

There are **no `src/sim/infra/*` hunks**. No changes to `src/sim`, `src/worker`, `src/save`, `src/main.ts`, TopBar,
advisor GUIDE code, Effects.ts, building renderers, EmergencyBanner or StorageDialog. CameraController and Toolbar are
the small effect hunks covered by the task's camera/pulse component scope, though not spelled out as paths in its
`owns` line. CityScene and region/settings are named by FEEL-21 / its ownership references.

## Acceptance and validation

| Acceptance | Implementation / evidence | Remaining verification |
|---|---|---|
| OS reduced motion reads Reduced | Existing System persistence/resolution; effective in-city label and live device listener; title control enabled | Unit tests and browser check pending |
| Quake moves camera 0 m | Camera choke point rejects every shake and removes an in-flight shake immediately; new test compares complete camera matrices for 240 frames | Runtime tests and real-GPU check pending |
| No animation over 200 ms; nothing flashes over 3 Hz | Discretionary HUD effects disabled, toast fades 150 ms, camera/cinematic/countdown skipped, steady emergencies; half-strength fireworks with steady glitter/strobes and a shared 400 ms sharp-flash grid, light pulses at most 160 ms | CPU flash-rate/brightness probe passed; Vitest and real-GPU/CSS checks pending |
| Switching back restores everything | Root classes, camera flag, future cinematic celebrations, ticker motion and badge/card effects return to Full; System follows later OS changes | Runtime tests and browser check pending |

- `npx tsc --noEmit`: **passed** in round 1 and after round-2 renderer/helper/test additions.
- `git diff --check`: **passed**.
- Round 1 attempted one test file through the quiet gate:

  ```text
  node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/motionSettings.test.ts --maxWorkers=1
  ```

  **Blocked before tests loaded:** Vite's config loader hit `spawn EPERM` in `externalize-deps` /
  `optimizeSafeRealPathSync`. No test assertions ran. A retry of that same gated command with `--configLoader native`
  failed with `ERR_UNKNOWN_FILE_EXTENSION` for `vite.config.ts`. No repository config was changed.
- A short `npx tsx --eval` motion probe could not start: `ENOTCACHED`, tsx unavailable in the offline npm cache. No
  runtime probe result is claimed.
- Full Vitest, bot and browsers were not run, per the handoff's lead-owned gates. No benches or GPU sessions started.

The five round-1 new files contain 28 cases (including parameterized cases): defaults/old settings/both stores; live OS and
abort cleanup; the in-city control; host-independent scene application; zero-displacement quake, live shake removal,
skipped/cancelled/restored flights; reduced and live New Year release/restore; static ticker rotation, actions,
tooltips and no layout reads; toast/card feedback; CSS/media/steady emergency contracts.

Round 2 adds 12 cases. `reducedFireworks.test.ts` covers exact Full shader hashes/no-op setting, identical director,
RNG, sounds, particle/death/queue/pool bytes through a whole show with live toggles, immediate half-strength
spark/smoke/ground/water/fill output at a frozen flash, dense-finale rate bounds per lighting channel, native-lifetime
shader admission, fast-blink removal with existing particles, and preference continuity through quality/restart/rank
shows. `reducedFlashing.test.ts` covers live OS/default/explicit choices, safe old settings, no stored-key changes or
writes, and unavailable OS APIs. Actual GPU compilation/pixel comparison remains a browser check.

Run each test file separately through `quietrun.mjs ... npx vitest run <file> --maxWorkers=1`. In addition to those
five new files, the affected existing regression files are:

```text
tests/game/settingsSchema.test.ts
tests/game/titleSettings.test.ts
tests/game/cameraControls.test.ts
tests/game/cameraStart.test.ts
tests/game/quakeShakePlop.test.ts
tests/game/newyear.test.ts
tests/game/newYearPacing.test.ts
tests/game/newsTicker.test.ts
tests/game/notificationsQuestion.test.ts
tests/game/toastBudget.test.ts
tests/game/rewardToast.test.ts
tests/game/rankFireworks.test.ts
tests/game/milestoneCard.test.ts
tests/game/uiCardTip.test.ts
tests/game/uiStacking.test.ts
tests/game/panelsNews.test.ts
tests/game/uiPanelReserve.test.ts
tests/game/budgetPreview.test.ts
tests/game/upkeepReads.test.ts
tests/game/emergencyBanner.test.ts
tests/game/emergencyOutcomes.test.ts
tests/game/emergencyLive.test.ts
tests/game/graphicsFirstRun.test.ts
tests/game/graphicsRecommended.test.ts
tests/game/graphicsRestore.test.ts
tests/game/cityDisposeCanvas.test.ts
tests/game/citySaves.test.ts
tests/game/cityTeardown.test.ts
tests/game/inspectorRetention.test.ts
tests/game/thumbsPendingRetention.test.ts
tests/game/uiSoundsRetention.test.ts
tests/game/views.test.ts
tests/worker/hygiene.test.ts
```

The long diagnostic `pacingProbe.test.ts` / `tickerProbe.test.ts`, remaining retention diagnostics and full suite are
also left to the lead. None of the existing test files above could be runtime-verified here after the startup block.

## Bot gate for the lead

No balance, city-save schema, simulation RNG or simulation expressions changed. Medium/Hard and old save continuation
are expected to remain bit-identical; this is a source-scope conclusion, **not a measured bot/hash result**.

Run from this worktree with all optional strategy flags off:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Expected 2015 residents: **[61,124, 93,804, 37,971] = 192,899**. Capture output in the supplied T078 scratch folder.
No 256×60 run is required by FEEL-21; none was started. Full-suite, old-save and two-process hash verification remain
lead-owned if desired; no new expected balance numbers are introduced.

## Plan versus current code

- FH-24 has no separate section/acceptance list: the plan only references its absorption into FEEL-21.
- Contrary to the plan's original problem statement, `motion`, its validation, persistence, shared AppSettings mapping
  and `resolveMotion` already exist. They were retained; no version bump or save migration is needed.
- The existing title dialog already has System / Full / Reduced and a `Your device: reduced/full` sublabel. Enabling
  its one feature flag avoids FH-12's dialog hunks. Its device sublabel is computed when the dialog opens; the in-city
  effective label updates live. A live title-dialog relabel can be added by its owner if required.
- FEEL-08's focus flights are in CameraController; the later T075 show/spotlight camera is absent. New Year still owns
  its own show camera, so it also needs its separate live cancellation hook.
- T074's Weather/lightning is absent. No existing lightning effect was found on this base.
- The literal animation-duration sentence cannot include ordinary city simulation movement/the entire fireworks show
  while also retaining the specified half-strength fireworks. The implementation applies it to discretionary UI and
  automatic camera/cinematic effects; Reduced sharp-firework lighting pulses are also limited to 160 ms. The round-1
  fireworks gap is resolved in round 2. The 400 ms grid keeps a margin below 3 Hz; short transients that cannot fit
  their original lifetime after coalescing are intentionally suppressed.

## Round-2 verification

The first quiet-gated round-2 test waited for the desktop timing run, then **failed before loading tests** with the
same Vite `externalize-deps` / `optimizeSafeRealPathSync` **`spawn EPERM`** as round 1. A gated retry of that same file
with `--configLoader runner` (used by existing repository probes) also failed during config loading:
**`ReferenceError: require is not defined`** in `picomatch/index.js`. No repository configuration was changed. No other
tests, probes or bot ran alongside either attempt. Vitest assertions in the new files and the untouched existing
`fireworks.test.ts` remain unverified. Commands for the lead (one file at a time):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/render/reducedFireworks.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/render/fireworks.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/reducedFlashing.test.ts --maxWorkers=1
```

A short standalone **Node CPU probe passed** against the actual modules, using Node's `--experimental-strip-types`
and a read-only import resolver for extensionless relative TypeScript imports. It performs no GPU work and changes
no source/configuration. It verified:

- exact Full vertex/fragment SHA-256 hashes against round 1;
- 240 update frames (24 simulated show seconds) with live Reduced/Full toggles, byte-identical particle/death/smoke/queue/flash/pool state,
  identical random seed, shell/spawn/drop counts, director timings and sound events;
- immediate half gain, own-smoke glow, ground/water radiance and final fill-light delta at a frozen controlled flash,
  plus immediate Full restoration;
- six simulated show seconds of dense 100 Hz flash input: **14 onsets each** for fill, ground and water; **at most 3 in every rolling
  second**, with each lighting pulse at most 165 ms at the probe's 5 ms sample interval (configured limit 160 ms);
- current OS changes and explicit Reduced through `reducedFlashing(settings)`.

This CPU result does not replace the Vitest/GPU gates. Shader compilation, actual pixel equality and rendered flash
rate/brightness still need the browser checks. No bot was run; its command and expected numbers above are unchanged.
Diagnostic results: `round2-verification.json` in the supplied T078 scratch folder.

## Hooks for future files

The round-1 Fireworks requests are implemented here with the desktop worker's authorization. There is no remaining
request for a held file.

1. **T074 — future `src/game/Weather.ts`, lightning trigger:**
   `if (reducedFlashing(settings)) return;`
   before emitting a lightning flash. Cancel an active lightning flash on a motion/settings or device change too.
   Import `reducedFlashing` from `src/game/settings.ts` and pass the live settings object; each read resolves the current
   OS preference. No additional setting/schema key is needed.
2. **T075 — future show/spotlight camera:** use the same resolved preference to skip its automatic camera moment and
   cancel an active moment at the current view on the existing settings event. Any fade used instead must be ≤150 ms.
   Controller-driven `focusOn(..., {fly: true})` already skips flights; a show camera using direct `setView` must gate
   itself as New Year now does. FEEL-21's settings rows are in their own section for a clean merge.

No requests for worker, save, App wiring, TopBar or advisor files.

## Browser checklist for the lead

- [ ] With OS reduced motion enabled before launch, title Settings exposes Motion with its reduced device sublabel;
      in-city Settings shows `Reduced (your device)`. Old settings without motion still follow the OS.
- [ ] Change System / Reduced / Full without reload; reopen/reload Settings to check persistence and shared title/city
      preference. Change the OS setting while System is active; verify immediate effects and live in-city status.
- [ ] Repeat on local, loopback and real worker hosts; check disposal/re-entry and graphics Restore.
- [ ] Start a quake under Reduced: measure **0 m camera displacement from shake**, including repeated shake events.
      Switch during an active shake; it stops immediately. Full restores later shakes.
- [ ] Use news/advisor/emergency focus actions under Reduced: no automatic flight. Switch during a Full flight; it
      stops at the current view. Full restores later flights.
- [ ] Start New Year under Reduced: no camera/countdown/day-night lapse/calendar hold. Switch during lapse, show and
      return: ownership releases immediately, no return flight, fireworks continue. Full restores the next cinematic.
- [ ] Ticker is static at its leading edge, rotates readable clauses, and keeps tooltip/feed/focus actions. Switch
      mid-scroll, including while hovered; verify restoration and no clipping regression at 1280×720.
- [ ] Toast entry/exit are opacity-only, ≤150 ms; merged counts and locked cards do not pop/shake. Verify pause/LIVE,
      RCI, coach marks, music indicators and loading/save spinners stay steady.
- [ ] Trigger emergency urgency, an ignored moved-banner press and saved/lost outcomes: icons/colours remain steady,
      including the entire **600 ms** outcome interval. Outcome text still appears. Full restores normal cues.
- [ ] Check CSS/WAAPI animations under Reduced: discretionary animation duration ≤200 ms. With OS Reduced but explicit
      Full, verify every normal effect returns. Check Settings section/navigation layout at 1280×720 and high UI scale.
- [ ] Compare flash/light output at 0.5/1 and switch with existing particles and a frozen show. Check ≤3 Hz through
      strobe/crackle/glitter/reflections/city lighting and the finale on the real GPU. Confirm Full pixel/show-timing
      identity against round 1; the Full shader source and scheduling are unchanged.
- [ ] **After T074/T075 land:** lightning and spotlight hooks obey Reduced immediately and restore in Full.

Unverified here: Vitest assertions (runner blocked), bot identity, real-GPU displacement/flash rate/brightness and Full
pixel equality, CSS cascade/layout, real-worker interaction and old-save runtime continuation. CPU probe results are
recorded separately above. No browser was opened; no test or probe process remains running.
