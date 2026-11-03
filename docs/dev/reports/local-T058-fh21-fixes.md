# T058 report: FH-21 follow-up fixes (desktop, real GPU)

**Verdict: done.** The five round-1 fixes and the round-2 Notifications change pass on the real GPU. All six FH-21
acceptance lines pass, and so does the click check that round 1 missed. No sim, worker or infra file is touched.

Branch `local/T058-fh21-fixes`:
- `aff7af2` the round-1 fixes: startup excluded from the fps sample, Restore keeps the overlay, variant and hour, the
  recovery dialog left out of the load time, the detected tier labelled Recommended;
- `4c00713` dev `683d02b` merged in (clean);
- `cec3eab` round 2: a question toast keeps its buttons in place when other toasts arrive (NOTE-048 gives this
  Notifications change to T058); `ae36c3c` its report.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest with the fixtures (`ae36c3c`) | **223 files passed, 2 skipped; 2,217 tests passed, 11 skipped; 0 failing** |
| 128×15 s7 bot with the action log | **identical to dev:** residents [ 61124, 93804, 37971 ] = 192,899 |

## Real-GPU recheck, round 3 (RTX 5070 Ti, driver 610.47, ANGLE D3D11, Chromium 141)

Each try used a fresh profile, the 653k city at High and a 20× CPU throttle. Once the question was up, the QA made
one real mouse click, with no retry, and toasts arrived while the button was held down.

| Check | Result | Measured |
|---|---|---|
| Keep, with toasts arriving during the press | **PASS, 8 of 8** | Toasts: the click's own "Now playing" (round 1's miss), a re-posted news toast, and all of those together. The first click answered Keep every time. The buttons moved 0.00 px across all 28 toast arrivals; the question stayed first in the stack, and new toasts went in below it. |
| Switch, the same | **PASS, 3 of 3** | The first click switched the city, the view and both settings stores to Medium; 0.00 px. |
| FEEL-02a's toast budget with the question up | **PASS** | 11 news items over 26 s were each shown or dropped as the budget allows: a 4 s gap, 8 a minute, bad news always shown. In 349 samples no toast overlapped Keep or Switch. |
| Acceptance 3: no prompt on the 653k city when healthy | **PASS** (no prompt) | 5 runs of 30 s. Another agent loaded the GPU, so the city ran at 27-43 fps here; the round-1 tree did the same under that load (30.6-41.9 fps). Round 2 measured 59.92 fps on a free GPU. |
| Acceptance 4: exactly one prompt under 20×, Keep remembered | **PASS** | One prompt 11.2 s into the slowdown; after a reload, 35 s at 2.3 fps without a prompt. |
| Console and page errors | **PASS** | none in 13 sessions plus the controls. |

Round 2 (on `aff7af2`) passed all six acceptance lines and the five fixes; its table follows below. QA notes are in
the scratchpad `qa/FH21/qa.md` (rounds 1-3), with data and screenshots.

**Observed difference, accepted by the lead (NOTE-048):** the prompt comes about 11.5 s after a mid-session
slowdown (11.2 s in round 3), not the item's "about 20 s". The median of the 20 s window flips at half slow samples.

The lane's own notes follow.

## The lane's notes (rounds 1-2)

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

## Cloud carry-over (Nov 3)

The desktop's lane was finished and gated on its real GPU at `c73b0a4`. This step is the cloud's verification on
`cloud/t058`, worktree `scratchpad/co/t058`. It started from `local/T058-fh21-fixes` and merged dev `759bbd4`. As
instructed, it ran tsc and the targeted tests only. The merge step runs the full vitest and the bot on the merged tree.

### Gap list (what was required against what was done)

Sources: the task file, NOTE-047 item 6, NOTE-048 ("FH-21's real-GPU recheck and T058"), NOTE-054, NOTE-044, POLISH_PLAN
FH-21 with its Acceptance, this report, `local-T058/fh21-recheck-qa.md` and the diff against dev.

| Required | Where | State at `c73b0a4` | Cloud action |
|---|---|---|---|
| Bug 1: reset the fps sample when firstFrame is set. Test: a long first frame does not count | task 1 | `CityScene.ts` loop, `graphicsRestore.test.ts` (4 cases) | verified line by line; the tests fail with the fix reverted |
| Bug 2 / NOTE-048: questions keep their buttons in place when toasts arrive, as its own commit after T036 step 3; FEEL-02a's budget tests unchanged; a browser check of a real Keep click | task 2, NOTE-048 | `cec3eab` (its own commit, after the `4c00713` merge of T036 step 3): `Toasts.insertToast` keeps questions leading, `notificationsQuestion.test.ts` (6 cases), one expected order in `graphicsFirstRun.test.ts`; real-GPU click 8/8 Keep, 3/3 Switch, 0.00 px | verified; `toastBudget.test.ts` is byte-identical to dev and passes; the new tests fail with dev's Notifications.ts |
| Bug 3: Restore re-applies the data view. Test | task 3 | `restoreViews` calls `ctx.setOverlay(overlay, variant)` after `applySettings`; 3 cases | verified; the tests fail with the fix reverted |
| Bug 4: Play's t0 after the recovery gate, one line in main.ts | task 4 | moved exactly one line (`main.ts` diff: 1 -, 1 +) | **gap: no regression test.** main.ts is cloud-held App wiring that T034 and others edit, so a merge could undo it unseen. Added `tests/game/playLoadTime.test.ts` |
| Minor 5: Restore keeps the time of day | task 5 | `timeOfDay` read before dispose, set after `applySettings`; 3 cases | verified; 2 of its 3 cases fail with the fix reverted (the third, a fixed hour with autoTime off, is the control) |
| Minor 6: Settings labels the detected tier Recommended | task 6 | `dialogs.ts` uses `detectQuality()`; High's subtitle is now "Detailed"; 4 cases | verified; `quality.ts` imports only a type, so the title bundle does not take in three.js |
| Owns: CityScene META hunks, dialogs.ts, one line of main.ts, new tests. Notifications.ts by NOTE-048 | task, NOTE-048 | the diff against dev touches only these and the report files | confirmed: no `src/sim`, `src/worker`, `src/save` or `tools` file changes |
| Report the ~11.5 s prompt latency as an observed difference | NOTE-048, NOTE-054 | reported above | none needed |
| Gates: tsc, full vitest, bot 192,899; the real-GPU recheck of bugs 1, 3, 5 and the six acceptance lines | task gates | desktop: tsc clean, vitest 223 files / 2,217 tests, bot 192,899, every real-GPU line PASS | tsc and the targeted tests run here; the full vitest and the bot run in the merge step |
| Evidence images | task, QA notes | **not pushed**: every image in `fh21-recheck-qa.md` and above is in the desktop's scratch `qa/FH21/` (Windows paths), not in the repo or on any `local/*` branch | none could be viewed; recorded under decisions |
| The browser checklist's last box | this report | still `[ ]` in "Browser checklist for the lead", although the round-3 table above records it as done (8 of 8, 3 of 3) | read as done; the desktop's text is left unedited |

### What the cloud did

- Merged dev `759bbd4` into the lane (NOTE-051 to NOTE-054 and T061's queue entry, docs only). The merge was clean,
  and tsc is clean after it.
- Checked every source hunk against dev line by line:
  - The fps reset sits before `firstFrame = true`. The same frame's fps block then only stamps `fps.last`, so neither
    view building nor the first draw enters `checkSlow`.
  - `createViews` is synchronous, so the restored hour and overlay go onto the new WorldView, not onto the Null
    stand-in.
  - `setOverlay` re-sends the host view and sets the terrain variant and the objects' overlay mode.
  - `insertToast` handles four cases: new toasts, a repeated live toast, a second question, and a repeated question.
    In each, questions stay as the leading children of `.toasts`.
  - `.toasts` is the first child of `.hud-tl`, which is anchored at the top (`hud.css:389`, `top: 70px`). Inserting
    or evicting toasts below a question therefore cannot move it. This is the static version of the desktop's
    0.00 px measurement.
  - Eviction still removes the oldest toast that is not a question.
- Added `tests/game/playLoadTime.test.ts`, which reads `playCity`'s source. It checks that `const t0` comes after
  `await this.recoveryGate(`, and that this `t0` is the one passed to `enterCity`, which records `lastLoadMs`.
  graphicsFirstRun already checks the constructor's source this way.
- Ran each fix's tests with the fix reverted, then restored the file from HEAD:

| Fix reverted | Test file(s) | Result with the fix reverted |
|---|---|---|
| fps reset (`CityScene.ts`) | graphicsRestore | 4 of 10 fail (every fps case, including "still offers Medium once …", because the 22 s stall fires the prompt by itself) |
| overlay re-apply | graphicsRestore | 3 of 10 fail (Land value, Desirability variant 13, None) |
| time of day | graphicsRestore | 5 of 10 fail (the 3 overlay cases, which also check the hour, plus hours 0 and 23.99 with autoTime on); hour 14 with autoTime off passes, as a control should |
| `dialogs.ts` (dev's) | graphicsRecommended | 2 of 4 fail (4 cores → Medium, mobile → Low); 8 and 16 cores pass, because dev already labelled High |
| `Notifications.ts` (dev's) | notificationsQuestion, graphicsFirstRun, toastBudget | 6 fail: 5 of 6 notificationsQuestion cases (newest-first order with no question is the control) and graphicsFirstRun's "news toasts never push a question out"; toastBudget passes either way |
| `main.ts` (dev's) | playLoadTime | 1 of 1 fails (`expected 82 to be greater than 350`) |

### Gates

| Gate | Result |
|---|---|
| tsc (sem), after the merge and again after the new test | **clean** (exit 0, no output) |
| Targeted vitest (sem, `--maxWorkers=2`): graphicsFirstRun, graphicsRecommended, graphicsRestore, notificationsQuestion, playLoadTime, toastBudget, newYearPacing, pacingProbe, panelsNews, cityTeardown, views, titleSettings, settingsSchema, worker/hygiene | **13 files passed, 1 skipped; 131 tests passed, 5 skipped, 0 failing** (22.3 s). The skips are older ones: pacingProbe's 4 `PACING_SAVE` probes and hygiene's W1.2 import-graph case |
| `toastBudget.test.ts` against dev | byte-identical (`git diff --exit-code` 0) and passing |
| `git diff --check` against dev | clean |
| src/sim, src/worker, src/save, tools | untouched. The bot must stay identical to dev's (192,899). The desktop measured 192,899, and the merge step re-runs it |
| Full vitest, bot | not run in this step, which saves the shared lock as instructed. The merge step runs both on the merged tree. Desktop at `ae36c3c`: 223 files / 2,217 tests passed, bot [61124, 93804, 37971] = 192,899 |
| Real-GPU recheck (bugs 1, 3, 5, the six acceptance lines, the Keep and Switch clicks) | desktop, RTX 5070 Ti: all PASS (tables above). This cloud step ran no browser session |

### Browser evidence

This step took no screenshots and started no browser, as instructed. The desktop's screenshots are
`qa/FH21/…/*.jpg`, for example `ctx/overlay-lost-after-restore.jpg` and `slow-keep-bot256/02-slow-prompt.jpg`. They
are in the desktop worker's own scratch folder, which is unavailable since Oct 28, and were never pushed. So the
image evidence for this lane exists only as the desktop's written tables.

### Decisions

1. **Load-time regression test added for bug 4.** The task asked for no test there. A one-line fix in main.ts, which
   other lanes edit and the cloud resolves conflicts in, is easy to lose in a merge. The test is cheap and fails with
   the fix reverted. It reads the source because `App` is not exported and main.ts boots when imported.
2. **The evidence images cannot be checked.** They were never pushed. The real-GPU results are accepted from the
   desktop's tables, with their numbers: 8/8 Keep, 3/3 Switch, 0.00 px over 28 arrivals; context loss 13/13 in 3
   runs; load 1.19-1.22 s. The lead's NOTE-054 had already received T058 on those numbers. A SwiftShader re-run
   could check function but not the real-GPU timings, and this step was told not to take the lock.
3. **NOTE-048's "Add a browser check that a real click on Keep lands while a toast arrives"** is read as a QA run.
   The desktop did it on the real GPU (round 3). Its script (`clickdiag.mjs`, `slowprompt.mjs`) is in the desktop's
   scratch, not in `tools/`. Committing a repo copy, like `tools/qa-context-loss.mjs`, is an optional follow-up.
4. **The ~11.5 s prompt latency** stays the accepted observed difference (NOTE-048, NOTE-054). The window is
   unchanged.
5. **FH-21 Acceptance line 5's P-5 persona report** is a persona playtest, outside this fix lane. Its input is
   measured: 1.20 s on the 4-core profile, and the readout and `lastLoadMs` agree.
