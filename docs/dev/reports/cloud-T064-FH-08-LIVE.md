# T064 FH-08-LIVE: the TopBar LIVE-pill title that T036s5 deferred (chain guide2b, lane 1)

Lane `t064-fh08live`, branch `cloud/t064-fh08live`, from dev 43679b3, then brought up to dev 95f6e15 (T047 merged and
the T064 task file posted; a fast-forward, nothing to resolve). Task: docs/dev/queue/T064-guide-r2-cloud.md, section
"t064-fh08live". Plan item: docs/POLISH_PLAN.md "FH-08 · The first emergency teaches dispatch instead of just failing",
its Files line "src/ui/TopBar.ts (META hunk: LIVE pill title)", written against the split component.

## Cloud carry-over (Nov 3)

### Gap list (what was required, against what dev held when this lane started)

Sources read: the task file (Context, Gates, the chain split, this lane's section); NOTE-088 (the cloud takes this
hunk) and NOTE-069 item 3 (the hunk waits for the TopBar split), both on cloud/lead-notes; NOTE-044; no NOTE in
docs/dev/queue names T064; POLISH_PLAN FH-08 in full with its Acceptance, §7.3's TopBar row, §7.4; T036s5-fh08.md;
docs/dev/reports/local-R1-meta-FH-08.md :303-304, :406-408 and request 5 at :554-557; T029's task file (the rules the
title must stay true to).

| # | required | in dev at start | gap |
|---|---|---|---|
| 1 | The LIVE pill title reads "Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when help arrives. Settings → Gameplay." | src/ui/topbar/cityDate.ts:25 still has "An emergency needs you: the game runs at live speed until the help you send arrives (Settings → Gameplay)" | the whole hunk |
| 2 | The text checked against T029's rules (in range never slows; the 30 s cooldown) and `guideCopy.phaseE.Emergencies`; changed only if it must be, meaning kept | not done | the check |
| 3 | `.emg-live` visibility and the speed controls unchanged | unchanged (emergency.css:93-99, fx.css:7-8 and EmergencyBanner.ts `renderLive` do not read the text) | keep it so; show it |
| 4 | tests/game/topBarSegments.test.ts pins the title; the pin fails with the change reverted | no title pin | the test |
| 5 | tests/game/fixtures/topBarTrace.json re-recorded with `TOPBAR_TRACE=write`; its diff holds the title attribute only, at both places (:161, :3068) | old title at both places | the re-record and its diff |
| 6 | Gates: tsc, revert check, full vitest under the lock, trace diff = title only; no bot (src/ui and tests only) | n/a | run them |
| 7 | Report with the hunk's §7.3 owner, decisions, gates, Desktop QA list last; the .done line | no report, no T064 .done file | write them |

Desktop lanes checked at the lane start (the task's table): src/ui/guide/explainers.ts (T037a), budgetDelta.ts
(T037e) and src/game/bindings.ts (T075) are not in dev, and `A11Y_WIRED.motion` is `false` (T078 not in). This lane's
section has no "if in dev / if not" rule, so none of them changes the work.
