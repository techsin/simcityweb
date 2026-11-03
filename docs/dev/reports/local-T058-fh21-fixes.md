# T058: FH-21 follow-up fixes

Branch `local/T058-fh21-fixes`, based on `821a8d6` plus its task-file commit. Changes are uncommitted. The explicit
lane instructions override the task footer: no push, commit, or `.done` file; full Vitest and browser/GPU runs stay
with the lead.

## Supplied real-GPU recheck

These are the **earlier results supplied in T058**, attributed there to the worker's `qa/FH21/qa.md`. They are not
post-fix measurements from this lane. Hardware: RTX 5070 Ti, driver 610.47, headless Chromium 141 with the real GPU.

| Recheck | Supplied result |
|---|---|
| First-run detection | 16 threads: High; 4 cores: Medium |
| Existing profile | Keeps its setting |
| Healthy frame rate | No prompt at 60 fps on the 653k and 1.12M cities |
| Mid-session slowdown at 20x CPU throttle | Exactly one prompt, 11.5–11.8 s after slowdown; Keep and Switch remembered |
| Context loss | 13/13 across 3 runs; card in 14–102 ms; Restore at the same camera and exactDigest in 0.94–1.15 s on the 655k city |
| Found City to first interactive frame | 1.19–1.22 s |

## Changes by file

- `src/game/CityScene.ts`: reset FPS `frames`, `t`, and `last` immediately before marking the first rendered frame
  ready. View construction and the first draw cannot enter the slow-play window. Restore captures the displayed
  `timeOfDay` before disposal and restores it after settings are applied. It reapplies the context's overlay and
  variant through the existing setter, including terrain, city objects, host view subscriptions, and legend events.
- `src/region/ui/dialogs.ts`: compute the detected tier when opening Settings and give exactly that tier the
  Recommended label. High's fallback subtitle is Detailed. Opening Settings keeps the stored selection unchanged.
- `src/main.ts`: **cloud-held file, explicitly allowed single-line relocation** in `App.playCity`: move
  `const t0 = performance.now()` below the recovery gate, before constructing the loading screen. No other App wiring
  changes.
- `tests/game/graphicsRestore.test.ts` (new): ten regression cases for the FPS accumulator and restored view.
- `tests/game/graphicsRecommended.test.ts` (new): four cases for the detected recommendation and preserved selection.
- `docs/dev/reports/local-T058-fh21-fixes.md`: this report, expressly requested by the task.

No infra hunks. No source hunks outside the three named files. No simulation, balance, RNG, save-format, or Worker
protocol changes. All difficulty settings retain their simulation behavior.

## Tests and gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed after preserving the quality-option literal types |
| `git diff --check` | Passed |
| Gated `tests/game/graphicsRestore.test.ts` | Blocked before test collection: Vite config loading fails with `spawn EPERM` in `externalize-deps` / Windows safe-realpath resolution |
| Standalone Node frame/restore probe | Passed: three startup scenarios, the once-only later slow prompt, and three overlay/hour restores; extracted production methods with stand-ins, not Vitest or GPU |
| Other targeted files | Not run after the shared Vitest startup failure; commands below |
| Full Vitest | Left to lead, as instructed |
| Standard `npx tsx` bot launcher | Blocked: npm `ENOTCACHED`, offline cache has no `tsx`; log `scratch/bot-128x15-s7.log` |
| Bundled bot fallback | Passed: 2015 residents **[61,124, 93,804, 37,971] = 192,899**; 51.6 s; `scratch/bot-bundled-128x15-s7.log` |
| Real-GPU/browser checks | Not run, as instructed; checklist below |

New tests, by name:

- `first interactive frame fps sampling (T058)`: a 3,460 ms build, a 22,000 ms build, or a 22,000 ms first draw does
  not count as slow play; subsequent 60 fps play never prompts. The real rAF callback body runs against controlled
  time and stand-in frame consumers. A separate case still prompts exactly once after twenty seconds of 10 fps play
  following a long load.
- `restoring the displayed world (T058)`: Land value, Desirability variant 13, and None restore across a rebuild;
  terrain, buildings, context, host view subscriptions, camera, hour, and exactDigest are checked. Separate cases
  retain midnight, late night, and a fixed afternoon hour.
- `title Settings detected graphics recommendation (T058)`: 4 cores recommends Medium, 8/16 cores recommends High,
  and mobile recommends Low; all keep saved Ultra selected and leave storage unchanged.

The existing `tests/game/graphicsFirstRun.test.ts` covers first-run settings, Keep/Switch persistence, question toast
lifetime, and context-loss pause/save/restore. Its source-order assertion and partial restore fixture remain
compatible by inspection; collection was blocked. The new restore test exercises the real overlay delegate with a
complete context.

The short `scratch/frame-restore-probe.mjs` bundles the actual loop, slow check, restore, and overlay setter extracted
from `CityScene.ts`, with controlled time and stand-ins. It asserts startup exclusion (both build and first draw),
subsequent 60 fps, a once-only later slow prompt, and overlay/variant/hour/camera continuity without changing the
stand-in city. Result: `scratch/frame-restore-probe.json`. This provides a runtime check of those methods but does
not replace the blocked Vitest files or browser checks.

Run each test command separately from this worktree (all use the required quiet gate):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsRestore.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsRecommended.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsFirstRun.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1
```

Bot acceptance: the default Medium run must end in 2015 with residents **[61,124, 93,804, 37,971] = 192,899**.
No strategy flags or balance changes are intended. Exact attempted standard command:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

`tools/balance-json.ts` and the simbot help document bundling with rolldown when `tsx` is unavailable. This lane
bundled the unchanged `tools/simbot.ts` and its imports to `scratch/simbot-T058.mjs` (Node platform, ESM, inline
dynamic imports), then ran this exact equivalent command, with raw UTF-8 output saved to
`scratch/bot-bundled-128x15-s7.log`:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T058/scratch/simbot-T058.mjs --size 128 --years 15 --seed 7
```

Scratch root:
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T058/scratch`.
No 256-tile/60-year runs are needed for this UI-only item. No two-process hash comparison was performed.

## Plan/code differences and cloud request

- The FH-21 Problem paragraph is historical: first-run detection, context-loss handling, and load timing already
  exist. T058 repairs those paths without retuning the threshold; retuning after W1.4 remains outside this lane.
- The original FH-21 Acceptance has five bullets; T058 supplies six empirical recheck lines above. Both are retained
  in the browser checklist. Worker design's older bot populations are historical; T058's 192,899 is the gate here.
- The task's push/`.done` and full-suite/GPU footer conflicts with the explicit lane instructions. The latter win.
- **Request for the FEEL-02a owner:** `src/ui/Notifications.ts`, `Toasts.show`, both the dedup branch around line 190
  and new-toast insertion around line 273. Ordinary toasts currently prepend above a `.question`, moving Keep/Switch
  under the cursor. Insert ordinary toasts below the last question (including dedup promotions), or use a separate
  question container, while retaining question lifetime and stack protection. Verify a question's button bounds stay
  fixed as new and deduplicated news/music toasts arrive, then click Keep and Switch at their original coordinates.
  Update the owning test expectation that currently puts News above Question. This file is untouched in T058.

## Browser checklist for the lead

- [ ] Fresh profile: 4 cores starts on Medium; 8/16 cores starts on High; title Settings labels the detected tier
  Recommended. Existing profiles retain the selected quality, including a choice different from detection.
- [ ] Run the slow-build probe with a 22 s `createViews` delay and separately a slow first draw: no pre-ready prompt;
  no prompt during subsequent 60 fps play on the 653k and 1.12M cities.
- [ ] At 20x CPU throttle during play, exactly one question appears (earlier recheck: 11.5–11.8 s); test Keep and
  Switch independently, reopen the city/profile, and confirm the answer remains remembered.
- [ ] Run the worker's `ctxloss-gpu.mjs` with Land value active and with a nondefault overlay variant: loss pauses,
  saves, and shows the card; manual Restore and `webglcontextrestored` rebuild at the same camera and exactDigest,
  with the same visible overlay/variant and legend. Repeat at midnight and at a nondefault daytime hour.
- [ ] Record context-loss card/rebuild timings again (earlier: 14–102 ms / 0.94–1.15 s, 13/13 in 3 runs on 655k).
- [ ] Measure Found City to first interactive frame on the 4-core P-5 profile and check the FPS log/readout
  (earlier recheck: 1.19–1.22 s). Hold Recover unsaved progress for at least 6.3 s before Play; reported load time
  must exclude the dialog wait while retaining the actual load through the first interactive frame.
- [ ] After the Notifications owner lands the request, verify arriving and deduplicated toasts keep the question's
  button positions fixed and the first click on Keep/Switch succeeds.

Post-fix GPU timings, visual overlay/lighting continuity, end-to-end recovery-dialog timing, and the full test suite
remain unverified in this lane.
