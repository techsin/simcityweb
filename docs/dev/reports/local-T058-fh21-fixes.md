# T058: FH-21 follow-up fixes

Branch `local/T058-fh21-fixes`, originally based on `821a8d6`. The worker committed the five first-round fixes as
`aff7af2` and cleanly merged dev `683d02b`, including T036 step 3 / FEEL-02a's toast budget. Round 2's Notifications
change is uncommitted. NOTE-048, "FH-21's real-GPU recheck and T058", explicitly assigns the earlier Notifications
request to T058. The lane instructions override the task footer: no push, commit, or `.done` file; full Vitest and
browser/GPU runs stay with the lead.

## Supplied real-GPU recheck

The numeric measurements below are the **earlier results supplied in T058**, attributed there to the worker's
`qa/FH21/qa.md`. In Round 2 the worker reports that `aff7af2` passes the real-GPU recheck: all five fixes work and
all six FH-21 acceptance lines pass. Fresh post-fix timing numbers were not supplied. This lane did not run a
browser. Hardware: RTX 5070 Ti, driver 610.47, headless Chromium 141 with the real GPU.

| Recheck | Earlier numeric reference | Post-`aff7af2` worker recheck |
|---|---|---|
| First-run detection | 16 threads: High; 4 cores: Medium | Pass |
| Existing profile | Keeps its setting | Pass |
| Healthy frame rate | No prompt at 60 fps on the 653k and 1.12M cities | Pass |
| Mid-session slowdown at 20x CPU throttle | Exactly one prompt, 11.5–11.8 s after slowdown; Keep and Switch remembered | Pass |
| Context loss | 13/13 across 3 runs; card in 14–102 ms; Restore at the same camera and exactDigest in 0.94–1.15 s on the 655k city | Pass |
| Found City to first interactive frame | 1.19–1.22 s | Pass |

The five verified fixes are startup exclusion from FPS sampling, restored overlay/variant, exclusion of the recovery
dialog from load time, restored time of day, and the detected Recommended label.

**Observed difference, accepted by the lead:** FH-21 describes a prompt after roughly 20 s of low FPS. QA measured
roughly **11.5 s** (11.5–11.8 s) after a mid-session slowdown. The code measures the median of an existing rolling
20 s sample window; after healthy play, the median flips when approximately half the window's samples are slow,
rather than waiting for twenty entirely slow seconds. A city that starts slow still fills the twenty-second window
first. This earlier mid-session offer is reasonable for players, so the window and threshold stay unchanged, as
NOTE-048 permits.

## Round 2: stable question buttons

- `src/ui/Notifications.ts`: one small, separate placement change, shared by new-toast insertion and live-toast
  dedup promotion. Questions remain the leading children of the existing `.toasts` container; other toasts insert
  below them. Additional questions follow existing questions, and deduplicating a shown question leaves it in place.
  No CSS or additional container is needed. The no-question path retains `prepend` and newest-first order.
- `tests/game/notificationsQuestion.test.ts` (new): DOM-order/container/button-identity regressions for new and
  deduplicated arrivals while questions are shown, plus stack and budget integration cases.
- `tests/game/graphicsFirstRun.test.ts`: minimal existing-test hunk, one expected order changed from News/Question
  to Question/News. Its question lifetime and stack-protection assertions stay intact.
- `docs/dev/reports/local-T058-fh21-fixes.md`: worker recheck table, observed latency difference, this change, and
  the remaining real-click check.

FEEL-02a's budget admission, counters, queue, drain/scheduling, dedup counting, lifetimes, sounds, and eviction logic
are untouched. `tests/game/toastBudget.test.ts` is unchanged. No infra hunks, Worker changes, or other source edits
in Round 2. No new RNG draws, save-format changes, balance changes, or difficulty differences are intended.

Round 2 gates (each command ran separately through the quiet gate):

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `git diff --check` | Passed |
| `git diff --exit-code -- tests/game/toastBudget.test.ts` | Passed: FEEL-02a budget tests unchanged |
| `tests/game/toastBudget.test.ts` (unchanged) | Blocked before collection: Vite config load, `externalize-deps`, Windows safe-realpath `spawn EPERM` |
| `tests/game/notificationsQuestion.test.ts` (6 new cases) | Same startup error; assertions did not run |
| `tests/game/graphicsFirstRun.test.ts` | Same startup error; assertions did not run |
| `tests/game/graphicsRestore.test.ts` | Same startup error; assertions did not run |
| `tests/game/graphicsRecommended.test.ts` | Same startup error; assertions did not run |
| Standalone actual-Toasts probe | Passed all 8 placement/budget scenarios; this is a Node probe, not the blocked Vitest suite or browser layout |
| Full suite and browser | Left to lead as instructed |
| Bot | Not rerun in Round 2; UI placement only, expected residents remain [61,124, 93,804, 37,971] = 192,899 |

The new suite is `Toasts: stable question answers (T058)`. It checks music and good-news arrivals between a Keep
pointerdown and click, live dedup including an already-leading ordinary toast, unchanged question/button parents
and node identities, short-screen eviction, a queued action released after four seconds, multiple questions and
live-question dedup, and newest-first order without questions. These are DOM checks; they do not assert physical
button rectangles in the fake DOM.

As a bounded runtime check while Vitest cannot collect, `scratch/toast-question-probe.mjs` bundles the actual
Notifications implementation with the existing fake DOM (only its Vitest setup hooks are stripped). Eight Node
assert scenarios pass: new/dedup music, new/dedup good news, multiple/live questions, short-stack eviction,
no-question newest-first order, queued action release at 4 s, no-action suppression/dedup spending no budget, and
the 8-per-minute cap. City abort clears pending timers after every scenario. Result:
`scratch/toast-question-probe.json`. This does not establish that the unchanged FEEL-02a Vitest file passes; that
file still needs to run in an environment where Vite can start.

Exact probe command (also run through the quiet gate):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T058/scratch/toast-question-probe.mjs
```

Exact requested Round 2 commands, from this worktree, one at a time:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/toastBudget.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/notificationsQuestion.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsFirstRun.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsRestore.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/game/graphicsRecommended.test.ts --maxWorkers=1
```

## Round 1 changes by file

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

No infra hunks. Round 1 had no source hunks outside its three named files. No simulation, balance, RNG, save-format, or Worker
protocol changes. All difficulty settings retain their simulation behavior.

## Round 1 tests and gates

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

## Plan/code differences and request status

- The FH-21 Problem paragraph is historical: first-run detection, context-loss handling, and load timing already
  exist. T058 repairs those paths without retuning the threshold; retuning after W1.4 remains outside this lane.
- The original FH-21 Acceptance has five bullets; T058 supplies six empirical recheck lines above. Both are retained
  in the browser checklist. Worker design's older bot populations are historical; T058's 192,899 is the gate here.
- The task's push/`.done` and full-suite/GPU footer conflicts with the explicit lane instructions. The latter win.
- The earlier FEEL-02a request is implemented in Round 2 under NOTE-048's explicit authorization. No remaining
  cloud-held source request. A browser must still verify real button rectangles and a click spanning toast arrival.
- The approximately 11.5 s mid-session latency versus the item's approximately 20 s expectation is an accepted
  observed difference, explained above; the graphics window is unchanged.

## Browser checklist for the lead

The worker reports the five original fixes and all six acceptance lines passed after `aff7af2`. The first six
entries below describe that completed recheck; their timings remain the earlier supplied reference. The final
entry is the new Round 2 browser check still to run.

- [x] Fresh profile: 4 cores starts on Medium; 8/16 cores starts on High; title Settings labels the detected tier
  Recommended. Existing profiles retain the selected quality, including a choice different from detection.
- [x] Run the slow-build probe with a 22 s `createViews` delay and separately a slow first draw: no pre-ready prompt;
  no prompt during subsequent 60 fps play on the 653k and 1.12M cities.
- [x] At 20x CPU throttle during play, exactly one question appears (earlier recheck: 11.5–11.8 s); test Keep and
  Switch independently, reopen the city/profile, and confirm the answer remains remembered.
- [x] Run the worker's `ctxloss-gpu.mjs` with Land value active and with a nondefault overlay variant: loss pauses,
  saves, and shows the card; manual Restore and `webglcontextrestored` rebuild at the same camera and exactDigest,
  with the same visible overlay/variant and legend. Repeat at midnight and at a nondefault daytime hour.
- [x] Recheck context-loss handling (earlier: 14–102 ms / 0.94–1.15 s, 13/13 in 3 runs on 655k; fresh timings not supplied).
- [x] Measure Found City to first interactive frame on the 4-core P-5 profile and check the FPS log/readout
  (earlier recheck: 1.19–1.22 s). Hold Recover unsaved progress for at least 6.3 s before Play; reported load time
  must exclude the dialog wait while retaining the actual load through the first interactive frame.
- [ ] With the slow-frame question shown, record the actual Keep/Switch button rectangles. Start a real pointerdown
  on Keep, deliver a new Now playing toast between pointerdown and pointerup, then release at the original position;
  the first click must land. Repeat with a dedup promotion, queued action toast, and short-screen stack overflow,
  then separately with Switch. Verify the same question node/container and identical button rectangles throughout,
  and confirm each answer remains remembered.

Round 2's physical button rectangles and real-click behavior, fresh numeric post-fix GPU timings, and the full test
suite remain unverified by this lane. The worker supplied the passing original-fix/acceptance recheck; Round 2 does
not rerun the bot or change its expected 192,899 residents. The earlier exact bot commands and numbers are retained
above for the lead.
