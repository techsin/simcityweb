# T053: milestone moments — review round 1

Branch `local/T053-feel06-milestones`, review base `0dfc703` (WIP plus dev `821a8d6`). These review fixes remain **uncommitted**; no push, merge, or `.done` file.

## Changes by file

- `src/sim/economy/advisors.ts`, CONTENT init: raise `popMilestone` to the larger of its stored value and the highest threshold already reached. A pre-T053 1.51M save with the old 1M marker now initializes to 1.5M silently; population drops never lower the marker. No RNG draws added.
- `src/ui/MilestoneCard.ts`: defer during `NewYear.busy` and while any centered/docked panel is open. Suspend and preserve an interrupted card. At ultra, rank-ups update a visible card without another entrance or extending its original lifetime; hidden rank-ups wait until the 30-second budget permits another entrance. A later non-rank item cannot overwrite a pending rank. Deferred non-rank cards also survive interruptions.
- The card chooses both future stage and future rank against `max(announced milestone, mirrored population)`. Active cards refresh this line on the existing UI tick, with text writes only when changed. Shared suffix parsing handles city names such as “Reaches 500 residents”.
- `src/ui/milestone.css`: move to the upper-middle band, `top: 84px`, above toolbar flyouts. All new layout CSS stays here. Panel deferral avoids drawing over draggable panel bodies. Reduced motion still has no slide.
- `src/game/GameSounds.ts`, CONTENT only: queue distinct milestone cues **180 ms** apart so AudioEngine's real 45 ms limiter voices every cue. Reset/dispose cancel queued cues. Existing pitch bands and ordinary-news budgeting stay unchanged.
- **New source outside the original named files:** `src/game/milestones.ts` holds the one suffix-anchored parser and milestone list shared by sounds/card. GameSounds re-exports the list for compatibility.
- `src/game/CityScene.ts`: import plus the existing CONTENT block only; wire NewYear busy state into the card and the objects view's rank fireworks.
- **New source outside the original named files:** `src/ui/rankFireworks.ts` isolates the small render lifecycle/gating helper. Fireworks start at most once per rank, use tier intensity and a deterministic render seed, skip NewYear/LIVE, and cancel on reset/dispose or entry into LIVE. Cancellation checks rank ownership so it cannot clear a NewYear takeover.
- `src/render/city/effects/Fireworks.ts` (**expressly authorized by review #8 after T038**): minimal `start({ rankBurst: true, intensity, duration })` option. For rank mode only, duration includes sparks/smoke and is clamped to 6–10 seconds; the scene requests **8 seconds**. A show-clock limit supports deterministic tests and a real-time watchdog enforces the cap at low FPS or a frozen time scale. NewYear's regular `start` clears rank mode/deadlines. Rank mode leaves NewYear's `isRunning` busy slot free while its own private director continues. Normal show defaults and incremental launch-site code are unchanged.
- Tests: extend `tests/sim/milestoneNews.test.ts`, `tests/game/milestoneCard.test.ts`, `tests/game/milestoneSounds.test.ts`; add `tests/game/rankFireworks.test.ts`.
- `src/sim/economy/rewards.ts`: no new review edit; the previously implemented `ref: { reward: id }` remains.
- **Infra hunks:** none. **Still-held files edited:** none; NewYear, Notifications, Worker, panel, settings and save files are untouched.

## Checks run

`npx tsc --noEmit` and `git diff --check`: **pass**.

All tests ran through the quiet gate, one test file/process at a time, with `--maxWorkers=1`. The scratch native `.mjs` config/thread pool avoids this sandbox's default Vite config `spawn EPERM` failure. **11 files passed: 184 tests passed, 4 skipped.**

| File | Passed | Skipped |
|---|---:|---:|
| `tests/game/milestoneCard.test.ts` | 27 | 0 |
| `tests/game/milestoneSounds.test.ts` | 28 | 0 |
| `tests/sim/milestoneNews.test.ts` | 10 | 0 |
| `tests/game/rankFireworks.test.ts` | 10 | 0 |
| `tests/game/gameSounds.test.ts` | 7 | 0 |
| `tests/game/newyear.test.ts` | 11 | 0 |
| `tests/render/fireworks.test.ts` | 12 | 2 |
| `tests/sim/advisors.test.ts` | 12 | 0 |
| `tests/sim/ranks.test.ts` | 48 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |
| `tests/worker/replicaSafe.test.ts` | 2 | 1 |

Regressions include: silent old 1.51M saves; NewYear/panel deferral and interruption; visible and delayed ultra rank updates; overshoot, active overshoot and multiple thresholds in one packet; city-name parser collisions; queued sound cancellation. The sound test executes real `AudioEngine.play` and replaces only voice rendering: an unspaced burst voices 1 cue, the queue voices all 14. Renderer tests use real Fireworks without a GPU and cover 6/8/10-second cleanup, the wall-clock cap at low FPS, NewYear takeover, and the retained NewYear renderer reference.

Exact working test invocation (one table filename for `<file>`):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1 --configLoader native --config C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch/vitest.config.mjs
```

The full suite was **not rerun here**, per lane rules. The lead reports that the previous WIP passed 219 files / 2,193 tests before the dev merge.

## Bot gates and hashes

Fresh review run: **128×15 seed 7 Medium = 192,899**, residents **[61124, 93804, 37971]**. All **15 full yearly hashes**, including news/advisors, match the prior T053 implementation. All 15 FH-03 hashes excluding news/advisors also match. Four reachable stage items occur once each (3k/12k/35k/90k); **zero repeats** after save/load plus 35 days.

Local `tsx` remains absent, so the run reused the repository's documented Rolldown fallback and the scratch `check.ts` harness. It uses the same SimBot, system factory, parsed defaults and CLI options. Output: `review1-128x15.json`; final excluded hash `545cc610cc2e54c32a61ccbcf644c4fcc52aa8662243f03f6995f499c9cc9485`.

Exact requested CLI equivalent (no LG-10 strategy flags):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Actual commands, run from this worktree:

```powershell
$quietGate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$laneScratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch'
node "$laneScratch/bundle.mjs" review1
$env:T053_MODE = 'review1'
node $quietGate node "$laneScratch/review1/check.mjs" --size 128 --years 15 --seed 7
```

The initial round's **256×60 s7** gate remains recorded, **not rerun during review**: population **1,513,835**, residents **[412608, 738176, 363051]**; all five stage items once at days **318 / 818 / 1764 / 3374 / 6123**, with none repeated after save/load plus 35 days. Its command equivalent is:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
```

The original comparison against fb1531f matched every 128×15 yearly hash after FH-03 exclusions; full/news/advisors hashes changed. Above 1.25M, the requested new milestones also advance `systemData.economy.popMilestone` beyond the old 1M cap, so that additional bookkeeping path must be identified in any long-run comparison. This review adds no balance change or RNG draw.

## Plan/code differences and owner requests

- The review explicitly supersedes the original lower-third position: the card now uses an upper band and waits while panels are open. Rank updates within a visible ultra card retain its original four-second expiration; queued cards get four seconds when their entrance is allowed.
- Fireworks' existing duration excluded long tails. The small authorized rank-mode option makes it a total duration, without changing normal NewYear show behavior. The old T038 rank-burst request is **resolved**.
- **META request remains:** `src/ui/Notifications.ts`, Toasts' news handler: map `n.ref?.reward`, never text, to “Place it”; open Rewards and scroll to/highlight that reward id. Coordinate a row-focus API in `src/ui/panels/ListPanels.ts` if needed. No held file was edited.
- LG-01's `listMilestones` audit entry remains absent from `src/worker/replicaSafe.ts`; this is unchanged owner metadata. The card now reads the mirrored population and pure CITY_RANKS/STAGE_POP tables directly.
- The queue's commit/push/`.done` instruction remains superseded by the user's explicit leave-uncommitted rule.

## Browser/GPU checklist for the lead

Prior QA supplied by the lead passed card duration **4.003 s**, one milestone cue (also loopback), ultra entrance gaps ≥30 seconds, stage once/save-load, 304k/652k silent loads and reduced motion. New layout/fireworks behavior needs fresh real-GPU QA:

- [ ] At 720p and 1080p, cross 10k with Zones/Rewards flyouts open: upper card stays clear and readable; four seconds, one cue.
- [ ] Open/close centered Budget and docked Advisors: card waits or suspends, then appears clear of panel bodies.
- [ ] Cross a milestone during NewYear; it waits until busy clears, with no Happy New Year banner overlap.
- [ ] At ultra, Village updates a visible 500 card; if the 500 card already closed, Village appears at the next allowed entrance. No two entrances less than 30 seconds apart.
- [ ] With a city name “Reaches 500 residents”, later cards and queued cues still identify the correct thresholds.
- [ ] Old 1.51M save with a 1M marker: no catch-up news, sounds or card on first day/reopen.
- [ ] Rank burst is visible by day, ends within 6–10 real seconds including smoke, respects NY/LIVE, never repeats a rank, and cannot suppress/cancel a NewYear takeover.
- [ ] Recheck real Worker/loopback, reduced motion and card next-line overshoot. Assistive-technology spoken output remains unverified.
- [ ] Lead's full Vitest run. META “Place it” browser check after its integration.

No browser/GPU run, full-suite rerun, or new Hard/256×60 bot run is claimed for this review.
