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

### What this lane did

| file | hunk | §7.3 owner |
|---|---|---|
| src/ui/topbar/cityDate.ts | `LIVE_TITLE` (module constant, with the rules it states) and the `.live-pill` span in `CityDateGroup`'s constructor now takes it as its `title` | META ("META owns the shell, `buildLeft` … and the LIVE pill title"; cityDate.ts is META's segment from the round-1 split). NOTE-088 gives the hunk to the cloud. |
| tests/game/topBarSegments.test.ts | one new case: "FH-08: the LIVE pill's title states the in-range rule and the restore; the pill and the speed buttons are as before" | chain guide2b (tests/game/topBar*.test.ts) |
| tests/game/fixtures/topBarTrace.json | re-recorded with `TOPBAR_TRACE=write` | chain guide2b |

The title, as shipped: "Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when
help arrives. Settings → Gameplay." It is the task's text, unchanged.

**The check against T029's rules and `guideCopy.phaseE.Emergencies` (gap 2).** Each claim, against dev's code:
- *"Within station range never slows."* True. SimCore's `rescan` (src/worker/SimCore.ts:423-441) drops an alert whose
  incident's reason is `'busy'` (T029's in-range site whose units are all out) and takes up only `'uncovered'`
  incidents; a `'queued'` one (in range, a unit coming back in time) never gets a banner. `AlertQueue.offer` refuses
  `'busy'` too (emergencyPolicy.ts:182-183). With no alert, `pendingCount` is 0 and `speedPolicy` never starts an
  episode, so neither the speed nor `liveSlowdown` moves. T029's gate tests (tests/game/emergencyPolicy.test.ts) pin
  this.
- *"Outside it, LIVE slows your dispatch."* True for the `'live'` policy, the only one that shows the pill: an
  `'outOfRange'` or `'noStation'` alert with a unit that can still make it starts an episode that holds the game at 1x
  with `liveSlowdown` (emergencyPolicy.ts `speedPolicy`), so the dispatch plays out slowed. `.emg-live` is set only from
  `policy.live && speed !== 0` (EmergencyBanner.ts `renderLive`), and SimCore publishes `live` only for an active
  `'live'` episode; under "Pause" or "Keep going" the pill never shows.
- *"Your speed returns when help arrives."* True as the rule's short form: `pendingCount` keeps a player-dispatched
  incident while `followingDispatch` holds (en route, then on scene for `FOLLOW_GRACE` = 0.75 days), and `speedPolicy`
  then restores `prevSpeed` with the "Emergencies handled — back to … speed" toast. Two edges come earlier, never later:
  a drive over `FOLLOW_MAX_MIN` (15 game minutes) gives the speed back at once, and a call that fails or is dismissed
  ends the episode. A speed the player picked meanwhile is kept. The title does not spell these out; the decision below
  says why that is fine.
- *The 30 s cooldown (`LIVE_COOLDOWN_MS`).* Nothing in the title contradicts it. It only means a second out-of-range
  alert within 30 unpaused seconds of an episode's end gets a banner without slowing, and then the pill is hidden, so
  nobody reads the title in that window.
- *`guideCopy.phaseE.Emergencies`* ("Emergencies inside a station's range never slow your game. Outside every range,
  they slow it down so you can send help (LIVE).") and E2 (the same words) say the same rule; the title adds the
  restore and the setting's place. No conflict, so copy.ts stays as it is (read only for every lane). The title is not
  one of §4's strings, so it is not taken from `guideCopy`; it stays a literal in META's segment, as the old one was.

**`.emg-live` visibility and the speed controls (gap 3).** No CSS or class is touched. emergency.css:93-99
(`.hud-top .live-pill`, `.mp-ui.emg-live .hud-top .live-pill`, `.mp-ui.emg-live .hud-top .is-paused .live-pill`) and
fx.css:7-8 key on classes only; `renderLive` and tests/game/emergencyLive.test.ts:277-278 do not read the text. The new
test pins the pill's class (`live-pill`), its text ("LIVE"), its place after PAUSED in the Date label, and the four speed
buttons' titles; the trace pins the rest (the whole tree, every DOM write and every call into the game, step by step).

**Trace diff (gap 5).** `git diff origin/claude/beautiful-johnson-u2jqoz -- tests/game/fixtures/topBarTrace.json` is two
lines out, two lines in: the `span class="live-pill" title="…"` line of each session's construct tree (fixture lines 161
and 3068), old title to new title. The DOM-write records (lines 17 and 2924, `"0.0.1.0.0.1 span.live-pill": "attr.title
children class title"`) list property names, not values, so they do not change. No other line moves.

### Gates (lane head ed85c4a on dev 95f6e15)

| gate | result |
|---|---|
| 1. tsc (`npx tsc --noEmit`, the `typecheck` script; under sem.sh) | clean: exit 0, 0 lines of output |
| 2. Revert check (src/ui/topbar/cityDate.ts back to dev's, tests and fixture kept; `vitest run tests/game/topBarSegments.test.ts tests/game/topBarSplit.test.ts`) | 2 failed, 4 passed. topBarSegments.test.ts: the new FH-08 case fails (the old title); its other 3 cases pass. topBarSplit.test.ts: "the scripted session matches the pre-split trace" fails (the re-recorded tree has the new title); the T030 write-count case passes. With cityDate.ts restored: 6 of 6 pass. |
| 3. Full vitest under the lock (`npx vitest run --configLoader runner`) | 308 files passed, 4 skipped (312); 3,112 tests passed, 32 skipped (3,144); 441 s; exit 0 |
| 4. The bot | skipped by Gate 4's rule: the diff is src/ui/topbar/cityDate.ts plus tests (no src/sim, src/worker, src/game or src/save); tools/simbot.ts imports no src/ui file. Reference stays [ 61828, 95515, 40772 ] = 198,115. |
| 5. Acceptance | (a) "the title explains the rule and the restore": the new topBarSegments case pins the exact text; the check above ties each claim to dev's code. (b) "`.emg-live` visibility and the speed controls are unchanged": no CSS, class or handler is touched; the new case pins the pill's class, text and place and the four speed buttons' titles; the trace pins every DOM write and call (topBarSplit.test.ts passes on the re-recorded fixture, including the T030 write-count case). (c) "the re-recorded trace differs from dev only in that title attribute, at both places": 4 changed lines in the fixture's diff (2 out, 2 in), lines 161 and 3068, title only. |
| 6. HUD trace | re-recorded with `TOPBAR_TRACE=write` (`vitest run tests/game/topBarSplit.test.ts`); diff as in (c). |
| Targeted before the full run | topBarSegments, topBarSplit, topBarFrame, emergencyLive: 4 files, 27 tests passed |
| Browser | none on the cloud (NOTE-061); the Desktop QA list below covers the hover tooltip and the pill's show and hide |

Logs (scratchpad, not in git): /tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t064fh08live-vitest.log,
/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t064fh08live-revert.log,
/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t064fh08live-tsc.log.

### Decisions

1. **The title text is the task's, word for word.** The check above finds every claim true against dev's rules, so
   nothing had to change to stay true. Two readings were weighed and left alone:
   - "LIVE slows your dispatch" could be read as "LIVE makes the dispatch slower". In game time nothing changes; in real
     time LIVE does slow the drive (the sim clock runs at 1x times `liveSlowdown`) so the player can follow it, which is
     the meaning the R1 report and the plan give. Rewording it would change a lead-given string for no factual gain.
   - "your speed returns when help arrives" leaves out the two earlier restores (a drive over 15 game minutes, a failed
     or dismissed call) and the "unless you changed it" rule. Both edges hand the speed back sooner, never later, so the
     short form never promises more than the game does; a tooltip that lists them would stop being readable. The source
     comment above `LIVE_TITLE` records the full rule for the next editor.
2. **A named module constant instead of the inline literal.** The constructor line is the one long `h(...)` chain FH-23
   and FEEL-03 may also touch; moving the string out keeps this lane's hunk on that line to one token
   (`title: LIVE_TITLE`), and the comment next to the constant says which rules it must stay true to. Not exported: the
   test reads the DOM, so reverting cityDate.ts fails it.
3. **The pin lives in tests/game/topBarSegments.test.ts**, as the task's Files line says, not in a new file: the file is
   chain guide2b's (tests/game/topBar*.test.ts), and §7.4's "add new test files" rule is about other lanes' tests.
4. **No bot.** The diff is src/ui/topbar/cityDate.ts and tests only; tools/simbot.ts imports no src/ui file (Gate 4's
   skip rule). Bot reference stays [ 61828, 95515, 40772 ] = 198,115 by construction.
5. **No browser here** (NOTE-059, NOTE-061, NOTE-088): the title and the pill's markup are checked in node (the new test
   and the trace); what only a real browser shows (the hover tooltip itself, the pill's show and hide during a live
   emergency) is in the Desktop QA list below.

### Requests to other chains or the lead

None. The hunk stays inside chain guide2b's files (src/ui/topbar/**, the trace, tests/game/topBar*.test.ts).

### Desktop QA (NOTE-059, NOTE-061, NOTE-088: on the real GPU, on dev after the merge)

Run on dev at this lane's merge commit, served by `npm run dev` (or `npx vite preview` on the production build), at
1280x720. The title is a native tooltip and the lane changes no layout, so 1920x1080 is not needed. Each item covers the
default host (no flag) and `?simworker=1` (the pill follows `host.policy.live`, a sim read). The emergency setting is in
Settings, Gameplay: **Uncovered emergencies: Live speed / Pause / Keep going**. Reply "QA t064-fh08live: PASS" or
"QA t064-fh08live: FAIL" with the findings and the screenshot paths.

1. **The LIVE pill's hover title during an uncovered emergency.**
   - **Steps:**
     1. Open `/?quickstart=1&difficulty=sandbox` (sandbox always has the Disasters tool, whatever the Disasters
        setting). Set Uncovered emergencies to Live speed. Build a road with a Fire Station at one end and homes about 40
        cells down it (out of the station's range), with power, and let them grow.
     2. Run at Ultra (3). Start a fire on one of the far homes (the Disasters tool).
     3. When the banner shows and the top bar's Date label shows the red LIVE pill, hold the pointer still on the pill
        until the tooltip appears. Take a screenshot.
     4. Repeat on `/?quickstart=1&difficulty=sandbox&simworker=1`.
   - **Expected:** on both hosts the tooltip reads exactly "Within station range never slows. Outside it, LIVE slows your
     dispatch; your speed returns when help arrives. Settings → Gameplay." The old text ("An emergency needs you: …")
     appears nowhere.
2. **The pill shows and hides exactly as before.**
   - **Steps** (item 1's city, on both hosts):
     1. Out-of-range fire at Ultra: watch the speed buttons and the pill as the banner appears.
     2. Press Pause (Space) during LIVE, then resume with Normal (1).
     3. Press Send nearest; let the truck arrive and the fire end.
     4. Start a fire on a home next to the Fire Station (in range), at Ultra.
     5. Set Uncovered emergencies to Pause, and start another out-of-range fire (after 30 s of unpaused play since the
        last slow-down ended).
   - **Expected:**
     1. The speed drops to Normal (1) with the Normal button lit, and the LIVE pill appears and pulses.
     2. Paused: only the PAUSED pill shows, no LIVE pill; resumed: the LIVE pill is back.
     3. After the truck has arrived, the speed returns to Ultra with the "Emergencies handled — back to ultra speed"
        toast, and the pill hides.
     4. In range: no banner, no LIVE pill, the speed stays at Ultra.
     5. Pause policy: the game pauses, only PAUSED shows, never LIVE.
     6. Throughout, the four speed buttons keep their tooltips (Pause (Space), Normal speed (1), Fast (2), Ultra (3))
        and their behaviour.
