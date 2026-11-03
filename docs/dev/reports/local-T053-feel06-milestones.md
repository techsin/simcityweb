# T053: milestone moments — review rounds 2–3

Round-2 record: branch `local/T053-feel06-milestones`, review base `8d806bd` (round-1 commit `b297f35` plus dev `683d02b`). The lead has committed these changes and verified 226 files / 2,286 tests and the bot. The new uncommitted round-3 changes are recorded below.

## Numbered changes and files

1. **“Place it” — approved request, separate small change.**
   - `src/ui/Notifications.ts`: derive the action from `n.ref.reward`, never text. Open Rewards, then call its row-focus API. Preserve existing advice actions and FEEL-02a's queue/budget; bind the news listener's unsubscribe to the city signal.
   - `src/ui/panels/ListPanels.ts`: `RewardsPanel.showReward(id)` rebuilds if needed, scrolls the matching row into view and highlights it. The highlight survives refreshes and clears on close.
   - New `src/ui/rewards.css`: highlight styling only.
   - New `tests/game/rewardToast.test.ts`: reward/landmark routing, changed headline text, queued actions, actual panel opening/scroll/highlight, refresh/retarget and abort cleanup.
   - **`tests/game/toastBudget.test.ts` is unchanged and passes.**

2. **`listMilestones` replica-safe entry — approved request, separate small change.**
   - `src/worker/replicaSafe.ts`: **only add the one list entry**. No other Worker source changes.
   - `src/ui/MilestoneCard.ts`: next rank comes from `listMilestones` using a read-only projection whose population is `max(announced, mirrored)`; the next stage uses that same population.
   - New `tests/worker/milestoneCard.test.ts`: real LoopbackSimHost packets deliver a multi-threshold population jump; a call-through spy verifies the card reads the real helper from replica data and shows the correct 500k/1M next targets. Helper results match primary state and inputs remain unchanged.
   - **Minimal existing-test exception:** `tests/worker/replicaSafe.test.ts` needs one import and one comparison because its exhaustive registry assertion otherwise rejects the new entry.

3. **Emergency alert priority.**
   - `src/ui/MilestoneCard.ts`: defer while `ctx.host.policy.alerts.length > 0`. Subscribe to policy updates with `ctx.signal`, so a new alert hides an active card immediately.
   - `src/ui/milestone.css`: z-index **54**, below emergency banners at 55, also protects their outgoing transition.
   - `tests/game/milestoneCard.test.ts`: alerts block initial display, immediately interrupt a visible card, then allow its remaining time when all alerts clear.

4. **Bound interrupted-card resumption.**
   - `src/ui/MilestoneCard.ts`: capture the remaining lifetime at interruption; allow **one resumption only**, using that remainder. Drop on another interruption, and discard an interrupted moment if a newer milestone exists. Initial pending rank priority and ultra's ≥30-second entrance budget remain.
   - `tests/game/milestoneCard.test.ts`: remaining-time expiration, repeated NewYear interruption without loops, stale interrupted rank replaced by newer news, existing ultra/reset/abort regressions.

5. **Save-pill clearance.**
   - `src/ui/milestone.css`: move the card from top 84px to **112px**, leaving a gap below the pill at top 70px. All layout CSS stays in the lane's file; no SavePill/HUD file edits.

6. **Reduced-motion rank bursts.**
   - `src/ui/rankFireworks.ts`: skip this lane's rank burst when `resolveMotion(settings.motion)` is reduced. Consume that rank silently so restoring motion does not replay it. A mid-burst switch to reduced cancels only an owned rank burst, never a NewYear takeover.
   - `tests/game/rankFireworks.test.ts`: explicit/system reduced motion, full override, no replay, preference changes and NewYear ownership.
   - NewYear/Fireworks/settings accessibility wiring remains with FEEL-21; those files are untouched this round.

**Infra hunks:** none. The Notifications/ListPanels and one Worker-entry edits are authorized by NOTE-048 and the round-2 prompt. No WorkerSimHost, LoopbackSimHost, protocolInbox, save/journal/recovery or other held source was edited.

## Verification

`npx tsc --noEmit` and `git diff --check`: **pass**.

**14 targeted files: 161 tests passed, 2 skipped.** Every test ran through the quiet gate, one file/process at a time, with one worker.

| Test file | Passed | Skipped |
|---|---:|---:|
| `tests/game/milestoneCard.test.ts` | 30 | 0 |
| `tests/game/rewardToast.test.ts` | 6 | 0 |
| `tests/game/toastBudget.test.ts` | 10 | 0 |
| `tests/worker/milestoneCard.test.ts` | 1 | 0 |
| `tests/game/rankFireworks.test.ts` | 14 | 0 |
| `tests/game/milestoneSounds.test.ts` | 28 | 0 |
| `tests/sim/milestoneNews.test.ts` | 10 | 0 |
| `tests/game/panelsNews.test.ts` | 5 | 0 |
| `tests/game/views.test.ts` | 3 | 0 |
| `tests/game/panelsMisc.test.ts` | 10 | 0 |
| `tests/game/graphicsFirstRun.test.ts` | 21 | 0 |
| `tests/game/cityTeardown.test.ts` | 4 | 0 |
| `tests/worker/replicaSafe.test.ts` | 2 | 1 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |

The scratch native .mjs config/thread pool avoids the sandbox's default Vite config `spawn EPERM` failure. Budget/graphics/teardown tests emit Node's AbortSignal listener-count warning but pass; no assertions or listener limits were changed.

Exact test command (one filename from the table for `<file>`):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1 --configLoader native --config C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch/vitest.config.mjs
```

No full-suite or browser/GPU run was made here, per lane rules. The lead's round-2 GPU QA of the previous implementation passed the earlier timing/sound, ultra, save, stage, parser, layout and 8-second-fireworks checks; this round addresses its new findings.

## Bot and determinism

Fresh **128×15 seed-7 Medium: 192,899**, residents **[61124, 93804, 37971]**.

All **15 full yearly hashes** match the prior review implementation, including news and advisors; all 15 FH-03 hashes also match. Four reachable stage items occur once (3k/12k/35k/90k), with **zero repeats** after final-city save/load plus 35 days. No simulation formulas, save keys, RNG draws or difficulty rules change in this round.

Local tsx remains absent, so this used the same documented Rolldown fallback and scratch SimBot harness as previous rounds. Output: `round2-128x15.json`. Exact requested CLI equivalent, flags off:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Actual commands from this worktree:

```powershell
$quietGate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$laneScratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T053/scratch'
node "$laneScratch/bundle.mjs" round2
$env:T053_MODE = 'round2'
node $quietGate node "$laneScratch/round2/check.mjs" --size 128 --years 15 --seed 7
```

Historical initial-round 256×60 s7 gate, **not rerun this round**: **1,513,835**, residents **[412608, 738176, 363051]**; all five stage items once, no repeats after save/load plus 35 days. Equivalent command:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7
```

Against the original pre-T053 base, the 128×15 comparison matches after excluding news/advisors. Above 1.25M the requested extended population tracker also changes `systemData.economy.popMilestone`; that original bookkeeping caveat is unchanged.

## Plan/code notes and remaining gates

- Both collected requests are now implemented; **no remaining cloud request** for Place it or the registry entry.
- NOTE-048's “own small commit” instruction is superseded by this turn's explicit **leave changes uncommitted** instruction. The numbered production changes remain small and separately identified above.
- Full Vitest, real-GPU recheck, assistive-technology output, and new Hard/256×60 bot runs are not claimed.

Browser checklist for the lead:

- [ ] **1:** Reward and landmark toast actions, including queued toasts, open Rewards at the correct highlighted row. Headline wording does not affect routing; closing/reopening clears the highlight.
- [ ] **2:** Real packet host card next line stays ahead of announced and delivered population, including overshoot/multiple thresholds.
- [ ] **3:** During an urgent pause with emergency alerts, no card covers the alert title/buttons. It returns only after alerts clear, subject to remaining time/budget.
- [ ] **4:** Every-year NewYear pacing at ultra: an interrupted card resumes at most once for its remainder, never repeats across three years, and a newer milestone discards the interrupted older card.
- [ ] **5:** At 720p/1080p during manual/autosave, the save pill and card have a gap. Recheck Zones/Rewards flyout clearance after the 28px downward move.
- [ ] **6:** Explicit and system reduced motion show the card without a slide and start no rank burst. Full motion still permits the bounded burst; changing preference cannot cancel a NewYear show.
- [ ] Lead's full-suite run and normal Worker/GPU checks.

## Review round 3 — base 787fad4

Both fixes remain **uncommitted**, each in its own source/test files:

1. **R3-1 — `src/ui/MilestoneCard.ts`, `tests/game/milestoneCard.test.ts`:** named `ALERT_CLEAR_DELAY_MS = 300`; `performance.now()` tracks the uninterrupted empty-alert interval even before a card exists. New alerts hide immediately and restart that interval. The existing UI tick admits the card only after 300 ms; no banner DOM lookup or new timer. Fake-timer tests cover the 299/300 ms boundary, an empty gap of 49 ms between incidents, and a clear before milestone arrival, preserving the remaining visible lifetime.
2. **R3-2 — `src/ui/Notifications.ts`, `tests/game/rewardToast.test.ts`:** capped releases stay FIFO, at least `BUDGET_GAP_MS / 2` (2 s) apart, with one forced capped release per drain. Scheduling respects the next eligible release instead of polling every 16 ms. The five-reward regression verifies release order, spacing and every Place it action opening/highlighting its row. `QUEUE_MAX_MS` is now eligibility for a spaced release; followers may wait beyond 50 s. **The FEEL-02a `toastBudget.test.ts` file is unchanged and all 10 tests pass; none pins simultaneous release.**

Quiet-gated typecheck passes; `git diff --check` passes. **Eight targeted files: 99 passed, 1 skipped:** `milestoneCard.test.ts` 32, `rewardToast.test.ts` 7, `toastBudget.test.ts` 10, `panelsNews.test.ts` 5, `views.test.ts` 3, `graphicsFirstRun.test.ts` 21, `cityTeardown.test.ts` 4, and `tests/worker/hygiene.test.ts` 17 + 1 skipped. The existing scratch native-config test command above was used, one file/worker at a time; typecheck used `node $quietGate npx tsc --noEmit`. Logs are `round3-tests-*.txt` in the lane scratch folder. Node's listener-count warnings remain non-failing; no assertions/limits were changed.

Fresh quiet-gated **128×15 s7 Medium: 192,899**, residents **[61124, 93804, 37971]**; all **15 full and FH-03 yearly hashes match round 2**. No repeated stage items after save/load plus 35 days. Used the same documented bundled harness: `node "$laneScratch/bundle.mjs" round3`, then `$env:T053_MODE = 'round3'` and `node $quietGate node "$laneScratch/round3/check.mjs" --size 128 --years 15 --seed 7`. Output: `round3-128x15.json`; the equivalent simbot command above is unchanged. No simulation, RNG, infra, Worker or other source hunks; no remaining cloud request.

The lead's round-3 GPU QA passed the other acceptance checks. Full-suite/browser checks were not rerun here. Remaining browser checklist:

- [ ] Final alert exit fade finishes before the card appears; a <50 ms empty-alert gap shows no card flash.
- [ ] A cluster of five capped rewards arrives at least 2 s apart, in order, with Place it preserved on every toast.
- [ ] Lead's full-suite/real-GPU regression gate. No commit, push, merge or `.done` file was made.
