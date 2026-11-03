# T036 step 3 — FEEL-02a: real-time budgets at every speed (New Year pacing, D17, and the toast budget)

Branch `cloud/t036s3`, from dev `4432beb` (`origin/claude/beautiful-johnson-u2jqoz`); dev merged in since: `48991d7`
(B3, which changes the bot reference by design), then `97f1a9c` and `fb1531f` (NOTE-045 and NOTE-046, docs only).

## Cloud carry-over (Nov 3)

### Gap list (written first, before any code)

What the desktop left: nothing for step 3. STATUS (Oct 28, 07:25) stops at "T036 step 2 (started)"; no `local/*` branch
holds FEEL-02a work (`local/R1-meta-start` and `local/R1-meta-schema` are ancestors of dev), and `docs/dev/wip/` has
no T036 patch or journal. T027 (the camera keys on `e.code`) and T031 (NOTE-041's `holdCalendar` command, which
NewYear.ts now calls through the host) are in dev, so step 3's dependency is met. Every item below starts from dev.

Sources read: T036's task file (step 3), NOTE-035/037/038/040/042/043 (the ones that name T036), NOTE-044, NOTE-045
(the desktop is back; the meta chain's step 3 stays with the cloud; FEEL-06 goes to the desktop's round 2), NOTE-046
(T036 steps 3-5 stay the cloud's; nothing for this step), NOTE-041
(holdCalendar), POLISH_PLAN §7.2-§7.5 and §8.1, FEEL-02a in full with its Acceptance, D17 (§11), critique point 3,
Goal 8, PB-NEWYEAR's row, and FH-03's "FEEL-02a's toast budget queues this toast".

| Required (FEEL-02a, D17, Goal 8) | In dev before this lane |
|---|---|
| A full show on the city's first New Year, on a rank-up New Year (LG-01), otherwise at most once per 10 real minutes; two full shows never under 3 real minutes apart, rank-ups included | Every New Year played in the loop gets the full show (NewYear.ts `onYear` → `celebrate`) |
| A full show is today's cinematic at 1x and the fireworks-mode show at 2x and ultra | Already so (the year-length budget in `celebrate`) |
| Every other New Year at 1x and 2x: a burst of at most 12 s, no countdown, no fanfare (only the fireworks' own sound), no camera or clock takeover | Missing |
| At ultra, every other New Year: no burst, only a silent compact toast "2034 · 812,400 residents, up 6%" | Missing (fanfare, toast and an 8 s show every 18 s) |
| The yearly toast stays; the fanfare plays only with a full show | The fanfare plays with every yearly toast, also the "show still running" one |
| Settings row "New Year show: Milestones / Every year" (`newYearPacing`, default `milestones`); "Every year" keeps today's pacing | The key and its default are in the schema (step 1), unread; no row |
| Toast budget for advisor, warning and good news: at most 1 per 4 s and 8 per minute | Missing (Toasts shows every news toast, de-duplicated only) |
| Bad news, disasters and errors always show | Already so (no budget) |
| A toast with an action is queued and shown when the budget allows, never dropped (FH-03's "Zone homes", FEEL-06's "Place it", by `NewsItem.ref`); other extras go to the ticker and the news feed | Missing; `NewsItem.ref` is in dev (T035), the action map (`adviceActions.ts`, GUIDE) is not |
| The demand-cap toast (TopBar) shares the budget, which Toasts enforces | Missing |
| Acceptance: 5 min at ultra on a 100k+ save: at most 2 fanfares and 2 full shows, at most 8 toasts in any 60 s, every disaster toast shown | Not measured; today about 16 fanfares and 16 shows |
| Acceptance: 10 min at 2x on a 100k save: at most 2 full shows, fireworks on screen at most 25 % of the time | Not measured; today about 60 % |
| Acceptance: 10 min at 1x on a 100k save: at most 2 full shows; every other New Year a burst of at most 12 s | Not measured; today a 73 s cinematic every 180 s |
| Acceptance: the first New Year and a rank-up New Year each get a full show unless one played in the last 3 real minutes | Missing |
| Acceptance: a toast with an action that arrives over budget appears within 60 s | Missing |
| §8.1 verifier 6: the pacing probes (ultra 5 min, 1x and 2x 10 min each) | No probe exists |
| Gates: tsc; the full vitest; the bot identical to dev (the task says 196,101; dev is 192,899 since B3 merged, by design); the item's browser checks; the `.done` line | — |

### What this lane did

**New Year paced in real time (src/game/NewYear.ts).**
- `NewYearPacer` (pure, exported with `NEW_YEAR_PACING`) decides each New Year in real time: the full show when no full
  show played in the last 3 real minutes, fewer than 2 played in the last 10, and either the New Year is a milestone or
  10 minutes have passed since the last one. Otherwise a burst at 1x and 2x, or `quiet` at ultra. It keeps a short log
  of its decisions (`scene.newYear.pacer.log`) for the QA probes and the console.
- Milestones: the city's first New Year (1 January after the founding: `startYear + floor(foundedDay / 360) + 1`, so a
  1 April city and a day-0 bot city alike) and a rank-up New Year (the peak population of the last 12 monthly samples
  reaches a higher LG-01 `CITY_RANKS` rank than the peak before them; reached ranks survive drops, as in rewards.ts).
  Both read only what the worker replica mirrors (config, `history.pop`, stats); a replica has no `systemData.cityRanks`.
- The full show is today's `celebrate()`, unchanged: the cinematic at 1x, the fireworks-mode show at 2x and ultra, with
  the fanfare and the yearly toast. It records itself with the pacer (also under "Every year", so a switch counts it).
- The burst (`celebrate({ burst: true })`, also the dev hook's option): 'fireworks' mode, no countdown, no calendar hold
  (NOTE-041's `holdCalendar` is never called), no show camera, no fanfare; Fireworks' shortest show (`duration` 6, its
  minimum), the opening salvo launched at once (`delay` 0) and a show size of at most 0.4. Its yearly toast is the
  usual one, silent (`toast(..., { silent: true })`: a 'reward' toast would otherwise play the fanfare's sound itself).
  Any sparks still alive 12 s of show time after the start are cleared (only seen from 4.5 km or more; see the
  decisions). The player raising the speed ends it, as it does a full show.
- Ultra without the full show: one silent compact toast, title "New Year", text "2034 · 812,400 residents, up 6%"
  ("down 3%", "steady", "up 0.3%" below 1 %, no trend without a year-ago sample), 4.5 s.
- A New Year that arrives while a show still runs gets only its toast, now without the fanfare (compact at ultra).
- `newYearPacing: 'everyYear'` runs today's code path exactly (the full show and the fanfare every year).
- CityScene's NewYear wiring passes the toast options through (META's NewYear-construction hunk).

**The toast budget (src/ui/Notifications.ts).**
- `Toasts.show(..., { budget: true })`: a budgeted toast shows only `BUDGET_GAP_MS` (4 s) after the last toast and while
  fewer than `BUDGET_PER_MIN` (8) showed in the last minute. Every new toast counts; a merge into a live toast (×N) does
  not. Over budget, a toast with an action is queued (FIFO, before any new budgeted toast) and shown when the budget
  allows, at the latest `QUEUE_MAX_MS` (50 s) after it arrived; one without an action is dropped (it is in the ticker and
  the news feed). The queue's timer is one of the toasts' timers, cleared with the city.
- The news handler budgets every toasted kind except bad news and disasters (advisor, warning, good and reward news).
  Errors, the player's own feedback (tool, dispatch and panel toasts), questions and the yearly toast are not budgeted.
- `Toasts.newsAction` (null today): the lookup by `NewsItem.ref` that FH-03 ("Zone homes") and FEEL-06 ("Place it") plug
  their action map into; a news toast with an action is then queued over budget, never dropped.
- The demand-cap toast passes `{ budget: true }` through `ctx.toast` (GameContext.toast gained the optional options
  argument; CityScene's ctx passes them to Toasts).

**Settings.** The Gameplay section has "New Year show" (Milestones / Every year) under "New Year celebration", with the
key, default and validation from step 1's schema.

**Tests (each fails with its fix reverted).**
- tests/game/newYearPacing.test.ts (19): the pacer's rules (period, 3-minute gap, 2 per 10 minutes, ultra); 1x five
  years (full, burst x3, full at 12 minutes); a burst's no-takeover list; the 1x cinematic still taking clock, camera
  and calendar; 2x ten minutes (1 full + 7 bursts, under 25 %); ultra five minutes (1 fanfare, 1 show, compact toasts);
  the compact line's formats; the first New Year (1 April and day 0; not within 3 minutes; not the second); rank-up
  and two no-rank-up cases; the busy year's silent toast; "Every year"; New Year off; a speed raise ending a burst; and
  the burst on the real Fireworks in node (4 populations x 10 seeds x 600 m / 3 km / 6 km: sparks gone by 12.05 s,
  the celebration done by 12 s; seeds 10 and 20 at 6 km need the 12 s cap) and its show size. With dev's NewYear.ts
  17 of 19 fail (the 1x cinematic and New Year off pass on dev by design); with only the 12 s cap reverted the
  real-Fireworks case fails (12.2 s); with only the size cap reverted the size case fails.
- tests/game/toastBudget.test.ts (10): the 4 s / 8 a minute schedule (0, 4 ... 28, then 60 s), the budgeted kinds,
  bad news and disasters over budget (and counting), unbudgeted feedback and the yearly toast, a merge not spending
  the budget, an action toast queued and not overtaken, one shown within 60 s while disasters keep the budget spent,
  `newsAction` by `ref`, the queue dropped with the city, and the demand-cap wiring. With Notifications.ts, TopBar.ts
  and CityScene.ts reverted 8 of 10 fail (the unbudgeted-feedback and merge cases pass on dev by design).
- tests/game/pacingProbe.test.ts: §8.1 verifier 6's pacing probes, skipped unless `PACING_SAVE` names a save (below).

### The pacing probes (§8.1 verifier 6; FEEL-02a's Acceptance)

`tests/game/pacingProbe.test.ts`, run headless under the lock on the merged code:
`PACING_BASELINE=1x PACING_SAVE=…/cities/small_s7_y10.city.metropolis npx vitest run --configLoader runner
tests/game/pacingProbe.test.ts` (4 passed, 84 s; the ultra and 2x baselines came from the first run, 133 s). The save is the
bot's 128x15 s7 city at 1 January 2010, **101,602 residents**. The real Simulation (createSystems) runs at the given
speed on a simulated real-time clock of 30 frames a second, with the real NewYearCelebration, the real Fireworks in
node (its sparks are "fireworks on screen") and the real Toasts on the city's own news. Random disasters are switched
on (the bot founds with them off) so that disaster toasts happen. "Today" is the same run with `newYearPacing:
'everyYear'` and no toast budget, which is dev's behaviour.

| Probe | New Years | Full shows | Fanfares | Camera takeovers | Bursts (sparks on screen) | Fireworks on screen | Toasts: all / max in 60 s / budgeted max in 60 s | Disaster toasts |
|---|---|---|---|---|---|---|---|---|
| ultra 5 min, today | 16 | 16 | 16 | 0 | — | 82.3 % | 125 / 41 / — | 32 of 32 |
| **ultra 5 min, FEEL-02a** | 16 | **1** | **1** | 0 | 0 (15 compact toasts) | **4.6 %** | 73 / 26 / **6**, 0 over budget | **32 of 32** |
| 2x 10 min, today | 7 | 7 | 7 | 0 | — | 54.5 % | 47 / 10 / — | 7 of 7 |
| **2x 10 min, FEEL-02a** | 8 | **1** | 1 | 0 | 7 (9.0-9.1 s) | **18.6 %** | 45 / 8 / 5, 0 over budget | 5 of 5 |
| 1x 10 min, today | 3 | 3 | 3 | 3 | — | 34.0 % | 17 / 6 / — | 1 of 1 |
| **1x 10 min, FEEL-02a** | 3 | **1** | 1 | **1** | 2 (9.0, 10.7 s) | 16.5 % | 17 / 5 / 2, 0 over budget | 1 of 1 |

(The 2x runs see a different number of New Years because today's countdown holds the calendar 3.6 s every year.)

Against the Acceptance:
- 5 minutes at ultra on a 100k+ save: 1 fanfare and 1 full show (at most 2 each). Every disaster toast shown (32 of 32).
  "At most 8 toasts in any 60 s": the budgeted news never made a ninth toast of any kind in its trailing minute (0
  violations, at most 6 budgeted in any 60 s), but the always-shown kinds alone reach 25 in the busiest minute (14
  disaster, 8 bad news, 3 yearly toasts, plus 1 warning): see the decisions.
- 10 minutes at 2x: 1 full show (at most 2); fireworks on screen 18.6 % (at most 25 %; today 54.5 %).
- 10 minutes at 1x: 1 full show and 1 camera takeover (at most 2); the other two New Years were bursts of 9.0 and
  10.7 s (at most 12 s).
- First and rank-up New Years: tests/game/newYearPacing.test.ts (full unless a full show played in the last 3 minutes),
  and in the browser (below) the fresh city's first New Year got the full show as a milestone.
- An action toast over budget appears within 60 s: tests/game/toastBudget.test.ts (queued, not overtaken, and shown at
  the latest after 50 s while disasters keep the budget spent).

### Decisions (conservative readings, for the lead)

- **"At most 8 toasts in any 60 s" against "every disaster toast shown".** The plan says bad news, disasters and errors
  always show (FEEL-02a change 2, Goal 8's "disasters always show"), so the cap binds the budgeted news: a budgeted
  toast needs fewer than 8 toasts of any kind in the minute before it and none in the 4 s before. At ultra on the 101k
  save the always-shown kinds alone reach 25 in the busiest minute (a tornado and its emergencies: 14 disaster, 8 bad
  news, 3 yearly toasts); today that minute held 41. Meeting 8 in every minute would need a lead choice: summarise
  emergency toasts (fires and medical calls are disaster-kind news), or budget bad news, which the plan exempts.
- **2 full shows in any 10 real minutes, at every speed.** Goal 8 counts "rank-ups included", so a milestone that would
  be a third full show within 10 minutes gets a burst. It is the only case in which a first or rank-up New Year more
  than 3 minutes after the last full show does not get one; at ultra the 3-minute gap already gives at most 2 per 5.
- **What a burst is.** Fireworks' shortest show (Fireworks.ts is WORLD's and unchanged): `duration` 6 (its minimum),
  `delay` 0, show size at most 0.4. Measured on the real Fireworks in node over 3 hamlet to megacity populations x 20
  seeds x camera distances from 300 m to 9 km, its sparks are gone after 8.6-12.4 s; only from 4.5 km away do they pass
  12 s, so the celebration clears any spark still alive at 12 s of show time (`stop(true)`, which also clears the
  smoke, then far away and small). "Fireworks on screen" counts sparks, not the smoke puffs that linger ~16 s.
- **Ultra** is a game year under 45 real seconds (the threshold today's code already uses to skip the countdown): only
  speed 3 (18 s). LIVE mode at 1x is never ultra.
- **Rank-ups from the population history**, not `systemData.cityRanks`: the worker replica mirrors `history.pop` but not
  that key. A rank-up New Year is one whose last 12 monthly samples peak in a higher CITY_RANKS rank than everything
  before them; reached ranks survive drops, as in rewards.ts. LG-01 can switch it to its own record when it lands.
- **The pacing memory lives with the city scene**: the first New Year of a session gets the full show by the 10-minute
  rule, and re-entering a city starts afresh. Dev shows (`instant`, `fastForward`) do not count; a busy year (a show
  still running) gets only its toast and does not carry the milestone over.
- **Reward news is budgeted** with advisor, warning and good news: the plan's FEEL-06 "Place it" is a reward toast that
  the budget is said to queue. The yearly New Year toast is not budgeted (it stays every year), but it counts.
- **Every new toast counts against the budget**, budgeted or not (a merge does not). A queued action toast shows at the
  latest 50 s after it arrived even if the budget is still spent, so "never dropped, within 60 s" holds when the
  always-shown kinds flood; it can then be the ninth toast of a minute.
- **The demand-cap toast** needed one-line edits outside FEEL-02a's file list: TopBar.ts (GUIDE's after the TopBar split;
  the split lane carries the `{ budget: true }`), src/game/context.ts (GameContext.toast's optional options) and
  CityScene's ctx wiring.
- **No badge**: dev has no unread badge for dropped toasts, and FEEL-02a's files do not add one. A dropped toast stays
  in the ticker and the news feed.
- **FH-03 / FEEL-06 actions**: `Toasts.newsAction` is the `ref` lookup hook; the action map (`adviceActions.ts`, GUIDE)
  is not in dev, so no news toast carries an action yet. The queue is tested with direct action toasts.
- **The probes run headless**, not in the browser: SwiftShader drew 0.1-0.4 frames a second here (the 101k city and even
  an empty one while fireworks fly), so the game clock cannot run at 1x, 2x or ultra in real time. The browser checks
  cover the function and the visuals instead. The probe has no LivePolicy (an uncovered emergency would drop the speed
  to LIVE in the game) and no emergency banner toasts.

### Browser checks

Playwright's Chromium on SwiftShader at 1280x720, quality Low, each run with its own Vite server (port 5417, cache in the
scratch directory) under the lock. The harness is in
`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t036s3/harness/` (run.mjs,
a.mjs, b.mjs, ab.mjs, c.mjs). SwiftShader drew 0.25-0.4 frames a second in the empty city and about 0.1 in the 101k
one, so day jumps (`state.day`, ten days or less before a New Year) stand in for waiting, the burst is timed on the
Fireworks' own show clock (it advances at most 0.1 s a frame), and part C stretches the toast lifetimes
(`Toasts.ttlScale`) so that a frame catches them.

| Check | Result |
|---|---|
| A new quickstart city opens on 1 April 2000 (foundedDay 90), pacing Milestones by default | pass |
| Settings › Gameplay: "New Year show", Milestones / Every year, Milestones on, right under "New Year celebration" | pass (`01-settings-row.png`) |
| "Every year" applies to the city and is stored in `metropolis.settings.v1`; back to Milestones | pass (`02-settings-every-year.png`) |
| The city's first New Year (2001): the full show as a milestone; cinematic: clock and camera taken, calendar held (`maxDaysPerFrame` 0), fanfare, the yearly toast; the countdown runs | pass (A, C1, C1 rerun) |
| The second New Year minutes later (2002, 1x): a burst (Fireworks 6 s, delay 0); the yearly toast silent, no fanfare | pass (A; C1 rerun: 41 s after the first show, its toast on screen, 1 fanfare in all) |
| The burst: no camera, clock or calendar takeover, no countdown, the date runs on (Jan 2 → Jan 26, 2002); its last spark at 12.0 s of show time (the cap), the celebration over | pass (A: 119 frames over 475 real seconds; `05-burst-3s.png` rockets, no countdown; `06-after-burst.png` empty sky, the date on; `06b-burst-still-3.5s.png` a frozen burst 3.5 s in) |
| The burst's yearly toast on screen, "Happy New Year 2002!" above 2001's, the burst's rockets in the sky, no countdown | pass (C1 rerun; `shots-c1/21-burst-toast.png`) |
| Ultra in the fresh city 89 s after the first full show: no show, the compact toast "2003 · no residents yet" on screen (title New Year, silent, 4.5 s), no fireworks, no fanfare | pass (C1 rerun; `shots-c1/22-ultra-compact-toast-fresh.png`) |
| Ultra 700 s after the first full show (run A, slowed by SwiftShader): the full show, as the 10-minute rule says | pacer log (A); the run's check had expected the compact toast, and C1 checks it within 10 minutes |
| The 101k save at ultra: the session's first New Year is the full fireworks-mode show (8 s), no clock or camera, fanfare and "Botville celebrates with 101,942 residents · ▲ 17.5% vs 2010." | pass (C2; `23-ultra-full-show-101k.png`) |
| The next New Year at ultra: only the compact toast "2012 · 103,734 residents, up 18%", on screen, silent, no fireworks, no fanfare | pass (C2; `24-ultra-compact-toast-101k.png`) |
| No page errors | pass (A, B, C, C1 rerun) |

All screenshots are under `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t036s3/`
(`shots-ab/`, `shots-c/`, `shots-c1/`) and each was looked at. What they do not show: the countdown digit and the
full shows' fireworks (`shots-ab/03-…`, `04-…`, `11-…`, `12-…`): a frame took 3-10 s, longer than the digit's 0.95 s
animation and, before part C, the toasts' lifetimes.

Seen in passing, not FEEL-02a's: at well under 1 frame a second the cinematic's calendar watchdog (midnight + 10 s of
real time) frees the calendar before the countdown's midnight, because the celebration's timer advances at most 1 s a
frame; the date then reads Jan 2 during the countdown (`03-first-newyear-countdown.png`). Dev behaves the same; at a
real frame rate it cannot happen.

**Part C1, first run and rerun.** The first C1 run (17:34) failed its two later checks on one number only: it counted
2 fanfares by the burst, where 1 is right (the pacer log, the silent burst toast, the compact toast and the
screenshots were all as expected). The harness was then changed to record every call of the celebration's own `sound`
with its stack, apart from the scene's `reward` plays. The rerun (18:21-18:25, `browser-c1.log`, 4 of 4) counts one
celebration fanfare in all, from the first New Year's full show (`toastYear` ← `celebrate` ← `paced` ← `onYear`), and
none at the burst or the ultra New Year. A second yearly fanfare can only come with a second yearly toast
(`toastYear` plays it and shows the toast together), and the first run's `shots-c/22-…` shows one toast per year and
no ×2 merge, so the first run's 2 is taken as a counting artefact of its harness; it did not recur.

Seen in passing, also dev's: headless, the scene plays `reward` twice at a full show (99,456 and 99,457 ms): the
fanfare, then the yearly toast's own `reward` chime, because the audio has not played (no user gesture) and the toast's
"a sound just played" rule (`sinceLastPlay` < 150 ms) cannot see the fanfare. With running audio the toast stays quiet.
A burst's and a compact toast are silent, and the rerun's scene log has no `reward` after the full show's.

### Gates

The lane's source has not changed since `692b799`: the commits after it are this report and dev's NOTE-045 merge
(`git diff 692b799 HEAD -- . ':!docs'` is empty; NOTE-046 came the same way), so the gates run on `692b799` stand for the branch head.

| Gate | Result |
|---|---|
| tsc (`npx tsc --noEmit`, sem) | exit 0, on the branch head (`0573d9e` + this report) |
| Full vitest (lock), on `692b799` | 218 files passed, 2 skipped (220); 2177 tests passed, 8 skipped (2185); 509.8 s; exit 0 |
| The lane's tests on the branch head | newYearPacing 19 + toastBudget 10 passed; pacingProbe's 4 skipped (no `PACING_SAVE`), as in the full run |
| Each new test fails with its fix reverted (re-checked in this run, in a scratch worktree) | dev's NewYear.ts: 17 of 19 fail; only the 12 s cap removed: the real-Fireworks case fails (12.2 s > 12.05); only the size cap removed (`burstSize` 1): the size case fails; dev's Notifications.ts, TopBar.ts, CityScene.ts and context.ts: 8 of 10 toastBudget cases fail |
| Bot 128x15 s7 (lock), lane on `692b799` | `residents [ 61124, 93804, 37971 ]` = 192,899 |
| Bot 128x15 s7 (lock), dev from a clean export (`co/t036s3-devbase`, its src identical to dev `97f1a9c`'s) | `residents [ 61124, 93804, 37971 ]` = 192,899: identical. (The task's 196,101 predates B3, which changed the reference by design; NOTE-045.) |
| FEEL-02a's Acceptance and §8.1 verifier 6: the pacing probes (lock), on `692b799` | 4 passed, 84 s: ultra 5 min 1 fanfare / 1 full show / 32 of 32 disaster toasts; 2x 10 min 1 full show, fireworks 18.6 %; 1x 10 min 1 full show, bursts 9.0 and 10.7 s; the toast cap: see the decisions |
| Browser checks (lock) | A 10 of 11 and B 3 of 4, the two misses the checks' own (A's third New Year came 700 s after the first show, so the 10-minute rule rightly gave the full show; B compared the show length 7.999999999999999 with 8 exactly), both re-checked in C; C 4 of 6, its two misses one fanfare count, not reproduced; C1 rerun 4 of 4 |

### This run (a resumed session)

The first cloud session of this step stopped after part C's first run, with the report's gates and the `.done` line
still to write. This session:
- read git log and status in the worktree (all code committed at `692b799`; the report's gap list and results
  uncommitted, now committed), checked that no process of this lane was left running, and merged dev's `97f1a9c`
  (NOTE-045: the meta chain's step 3 stays with the cloud);
- read the task, the NOTEs naming T036, NOTE-044, NOTE-045 and FEEL-02a in full again, and went over the lane's diff
  against dev line by line (NewYear.ts, Notifications.ts, TopBar.ts, context.ts, CityScene.ts, SettingsPanel.ts and the
  three test files); the gap list above stands;
- reproduced part C1's sequence headless (a full show cancelled at once, a burst 48 s later: one fanfare), then reran
  C1 in the browser with a stack on every celebration sound: 4 of 4;
- re-checked that each new test fails with its fix reverted, ran tsc, and wrote the gates and the `.done` line.
