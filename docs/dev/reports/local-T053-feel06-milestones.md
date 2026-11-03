# T053: milestone moments

Worktree branch `local/T053-feel06-milestones`, base `fb1531f`. Changes remain uncommitted; no push or `.done` file.

## Changes by file

- `src/sim/economy/advisors.ts` (CONTENT only): population milestones through 1.25M/1.5M; one stage announcement at each `STAGE_POP` threshold (3k, 12k, 35k first towers, 90k skyscrapers, 220k supertalls). Optional `systemData.advisors.stageMilestone` survives drops/save-load and initializes silently from the loaded population. Saves without advisors keep their original first-headline scheduling. No added RNG draws.
- `src/sim/economy/rewards.ts`: every reward news item carries `ref: { reward: r.id }`, including landmarks, infrastructure and deals.
- `src/game/GameSounds.ts` (CONTENT only): all 14 milestones use `milestone`. Duplicate suppression is per threshold so distinct milestones in one Worker burst each sound. Existing pitch bands remain unchanged.
- New `src/ui/MilestoneCard.ts` and `src/ui/milestone.css`: lower-third card, city/population heading, one next-stage/rank line, four real seconds, at most one card per 30 seconds at ultra, reduced motion without a slide. Event-driven through `ctx.host`, read-only mirrored state; reset/abort clear timers and listeners. Rank callback advances once per actual rank boundary and skips LIVE.
- `src/game/CityScene.ts`: import and one CONTENT block immediately after NewYear. Connects the card to an optional `fireworks.startRankBurst` hook, skipped during NewYear/LIVE. The hook awaits its renderer owner; there are currently no rank fireworks.
- New tests: `tests/sim/milestoneNews.test.ts`, `tests/game/milestoneSounds.test.ts`, `tests/game/milestoneCard.test.ts`.
- **Outside named source/new-test files:** minimal `tests/game/gameSounds.test.ts` title/expectation adjustment: 2,500 now plays `milestone`, replacing the obsolete generic-`good` expectation. This report is the requested task artifact.
- **Infra hunks:** none. **Cloud-held files edited:** none.

## Validation

- `npx tsc --noEmit`: passes.
- `git diff --check`: passes.
- Default quiet-gated Vitest startup failed while loading Vite config (`externalize-deps`, `spawn EPERM`). A native loader alone stopped at `ERR_UNKNOWN_FILE_EXTENSION` for `vite.config.ts`.
- **Resolved for targeted checks:** a scratch-only `.mjs` config, native config loader and thread pool avoid config bundling. Every run still uses the quiet gate and one test file/worker at a time. All eight targeted files pass: **134 passed, 2 skipped**.
- Full Vitest and browser/GPU checks were not run, per the lane rules. The lead must run the full suite and real Worker/GPU checks.

| Test file | Result |
|---|---:|
| `tests/game/milestoneCard.test.ts` | 15 passed |
| `tests/sim/milestoneNews.test.ts` | 9 passed |
| `tests/game/milestoneSounds.test.ts` | 24 passed |
| `tests/game/gameSounds.test.ts` | 7 passed |
| `tests/sim/advisors.test.ts` | 12 passed |
| `tests/sim/ranks.test.ts` | 48 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |
| `tests/worker/replicaSafe.test.ts` | 2 passed, 1 skipped |

Exact working test invocation (substitute one table filename for `<file>`):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1 --configLoader native --config C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch/vitest.config.mjs
```

Scratch config: `export default { root: '<this worktree>', test: { pool: 'threads', maxWorkers: 1 } };`. It changes no source or assertions. Logs are in the supplied scratch folder.

Tests prepared:

- `milestoneNews.test.ts`: 35k towers exactly once, population drops, 300k old saves with/without advisors silently loading, save/load continuation, five thresholds once each, RNG state unchanged, unchanged first-headline schedule, 1.25M/1.5M, persistent reward/landmark refs.
- `milestoneSounds.test.ts`: all 14 thresholds, duplicate/distinct burst handling, old pitches, ordinary good-news behavior.
- `milestoneCard.test.ts`: four-second real-time lifetime, all thresholds, next-stage/rank/top-rank copy, ultra budget and speed switches, explicit/system reduced motion, abort/reset/reopen cleanup and silence, rank hooks/LIVE/recovering-city behavior, unrelated-news filtering.
- Existing regressions to include: `tests/game/gameSounds.test.ts`, `tests/sim/advisors.test.ts`, `tests/sim/ranks.test.ts`, `tests/worker/hygiene.test.ts`, `tests/worker/replicaSafe.test.ts`.

## Bot gates and hashes

`npx tsx` cannot run here: npm's offline cache lacks `tsx` (`ENOTCACHED`). Used the repository's documented Rolldown fallback instead. Diagnostics live in the task's supplied scratch directory, outside the repository: `bundle.mjs`, `check.ts`, the two captured base source files, bundled `base/check.mjs` and `branch/check.mjs`, and JSON results.

`check.ts` runs the same `SimBot`, `botSystems(false)` and parsed CLI defaults as `tools/simbot.ts`; samples yearly hashes and listens to the complete news stream (the city retains only 200 news items). It also serializes/deserializes the final city, initializes fresh systems and advances 35 more days to detect repeated stage items. It does not emit `.READY`/`.done` files. `Date.now` is pinned; hashes sort object keys and include typed-array bytes.

Two-process comparison: the base bundle replaces only the two changed simulation modules with the exact `git show fb1531f:<path>` contents, preserving original resolution paths. Everything else is this unchanged worktree's code. No other worktree/branch was opened or edited.

Completed 128×15 seed-7 Medium:

- Base and branch: **192,899**, residents **[61124, 93804, 37971]**.
- All **15** yearly hashes excluding `news` and `systemData.advisors` match.
- Full-state, news and advisors hashes change, as expected under FH-03. Final common excluded hash: `545cc610cc2e54c32a61ccbcf644c4fcc52aa8662243f03f6995f499c9cc9485`.
- Branch emitted 3k/12k/35k/90k once each at days 320/847/1811/3379; 220k was not reached. **Zero repeated stage items** after save/load plus 35 days.

Completed 256×60 seed-7 Medium:

- **1,513,835** in 2060, residents **[412608, 738176, 363051]**.
- **All five stage items exactly once**, at days **318 / 818 / 1764 / 3374 / 6123** for **3k / 12k / 35k / 90k / 220k** respectively.
- **Zero repeated stage items** after final-city save/load plus 35 days.
- Run time 132.7 seconds (diagnostic, not a performance gate). No separate 256×60 base comparison is claimed.

**Late hash caveat:** the existing population announcement tracker lives at `systemData.economy.popMilestone`. The newly requested 1.25M and 1.5M milestones advance it beyond the base's 1M. Consequently, after 1.25M even FH-03 hashes excluding only `news` and `systemData.advisors` differ by that intended bookkeeping field. This is a plan/code mismatch, not a balance change; the lead must explicitly account for `systemData.economy.popMilestone` in any supplemental long-run hash comparison. The required 128×15 FH-03 comparison above needs no additional exclusion and passes all 15 checkpoints. No storage workaround or broader exclusion was silently applied.

Exact requested CLI equivalents (run from this worktree; optional LG-10 flags remain off):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
```

Actual bundled gate commands, using these absolute paths:

```powershell
$quietGate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$laneScratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch'
node "$laneScratch/bundle.mjs" branch
node "$laneScratch/bundle.mjs" base
node $quietGate node "$laneScratch/branch/check.mjs" --size 128 --years 15 --seed 7
$env:T053_MODE = 'base'
node $quietGate node "$laneScratch/base/check.mjs" --size 128 --years 15 --seed 7
Remove-Item Env:T053_MODE
node $quietGate node "$laneScratch/branch/check.mjs" --size 256 --years 60 --seed 7
```

## Plan/code differences and owner requests

1. **T038 / rank fireworks:** `src/render/city/effects/Fireworks.ts`, `Fireworks.start`, `directShow`, `active`: implement `startRankBurst({ population, intensity, duration, seed })` (the optional hook in CityScene), or provide its equivalent contract. Require **6–10 real seconds total visible lifetime**, including flight/finale/smoke, and isolated ownership/cancellation. Intensity already exists in `start`; duration is currently salvo-to-finale with a 14-second tail, so `start({duration: 6})` cannot meet the total-lifetime gate. Coordinate with cloud-held `src/game/NewYear.ts`, `NewYearCelebration.busy`/year handler/`celebrate`: starting the shared renderer after an earlier NewYear can make `busy` true and suppress the next NewYear. A rank timer must never clear a takeover NewYear. The callback already supplies tier intensity and a deterministic render seed, and skips NewYear/LIVE. No held renderer/NewYear changes made here.
2. **META / Place it:** `src/ui/Notifications.ts`, Toasts' news handler: map **`n.ref?.reward`**, never news text, to a “Place it” action. Open Rewards and scroll to/highlight the matching reward id. Coordinate a minimal row-focus API in `src/ui/panels/ListPanels.ts` with its owner if needed (no existing scroll/highlight API). Reward ids now survive serialization and Worker news replay. This action and browser acceptance remain pending owner integration.
3. **Worker metadata follow-up:** LG-01's pure `listMilestones` exists, but `src/worker/replicaSafe.ts`, `REPLICA_SAFE`, still lacks its planned audit entry. The helper reads only mirrored stats/unlocked/milestones; add it and its replica-safe test with the Worker owner. No held Worker file edited.

`popMilestone` actually lives under economy data, not advisors. Stage tracking stays in the optional advisors field to obey both file ownership and FH-03's excluded-hash contract. Old saves without advisors retain the original lazy schedule initialization.

The queue's push/commit/`.done` instruction conflicts with the user's explicit lane rules; followed the lane rules and left the work uncommitted.

## Remaining checks for the lead

- [x] Run the eight named targeted files: 134 passed, 2 skipped; typecheck and diff whitespace check pass.
- [ ] Run full Vitest suite with the lead's normal configuration; optional rerun of the targeted files there.
- [ ] Worker, real GPU: cross 10,000 at 1×; card reads the city/10,000, has the 12,000 next-stage line, lasts **4 ± 0.5 s**, and `milestone` plays once.
- [ ] Worker, ultra: cross several thresholds; card start times stay at least **30 real seconds** apart, including a switch from 1×.
- [ ] Reduced motion: system preference and explicit reduced motion show no slide; inspect lower-third layout at 720p and normal desktop sizes.
- [ ] Cross 35,000: exactly one first-towers news item; dropping/recovering population does not repeat it. Load a 300k old save: no catch-up milestone/stage announcement.
- [ ] After T038 integration: rank burst lasts **6–10 s total**, daytime is visible, and NewYear/LIVE suppress it without disrupting the NewYear show.
- [ ] After META integration: reward/landmark “Place it” opens Rewards at the matching highlighted row; changing the news copy does not change routing.
- [ ] Check status announcements with assistive technology (DOM attributes alone do not verify spoken output).

No browser, GPU timing, full-suite run, cross-host end-to-end UI test, or Hard bot comparison is claimed.
