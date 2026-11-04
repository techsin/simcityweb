# T029 — big-city emergencies, part 1: in range never slows; the cooldown

Branch `local/T029-emg-policy`: the Codex lane's commit (`f079ff5`) on `local/W0.3-5-integration`, then the final
`local/W0-complete` and dev (`4e2bb2d`) merged in, and one review fix (`cce2c4b`). The owner approved the design on Oct
27 (docs/dev/STATUS.md, "Uncovered emergencies in big cities"); this is its policy part only. The sim part (mutual aid
for in-range majors, station load, coverage that counts for less on an overstretched station) comes after B2.

## What it does

- **Inside a station's range, never a slow-down.** An uncovered incident whose reason is `busy` (in range, every unit
  out) gets no banner, no live speed and no pause, and never counts as pending or urgent. It stays in the Emergencies
  panel as "Waiting for a unit", with a Send button for a manual dispatch. Its failure still costs approval and posts
  its news line, as before. An alert raised before the incident turned busy is retired.
- **Outside every range** (`outOfRange`, `noStation`): today's banner, live speed while a unit can still make it, and the
  urgent pause when time is very short.
- **The cooldown:** after a slow-down or pause ends, the game keeps the player's speed for 30 real seconds
  (`LIVE_COOLDOWN_MS`) before the next one. Alerts in that window get a banner only, and a banner-only alert does not
  start a delayed slow-down when the window ends. It counts real time on LivePolicy's clock at every speed boundary, so a
  paused game does not use it up.
- **Texts:** the guide's E2 and its veteran briefing now say it plainly: emergencies inside a station's range never slow
  the game; outside every range they slow it down so you can send help.
- **Files:** src/game/emergencyPolicy.ts (the busy exclusions, the constant), SimCore.ts's LivePolicy hunks (the
  cooldown, the busy retirements), src/ui/EmergencyBanner.ts (the state text, the answerable check), EmergenciesPanel's
  waiting row, src/ui/guide/copy.ts (the two texts).
- **Tests:** tests/worker/policy.test.ts (a busy major at ultra never banners, slows or pauses, under live and pause
  policies and both deadlines; saved busy incidents stay quiet on boot and reset; a busy urgent incident cannot pause an
  out-of-range episode, and gaining coverage retires its alert; the cooldown suppresses slow-downs for 30 s after an
  episode, then permits the next; a banner-only alert does not slow the game when the cooldown ends; paused wall time
  does not count, with and without host ticks while paused), tests/game/emergencyPolicy.test.ts and
  emergencyBanner.test.ts.

## Review and gates (the local worker)

The design is implemented as approved. One fix: the cooldown read `performance.now()` directly, while LivePolicy's other
real-time delays use its injected clock (the host's, which T032 added so the loopback stays deterministic). It now uses
the same clock; the tests, which mock `performance.now`, still exercise the default.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Policy, emergency and loopback suites | 4 files, 94 tests passed |
| Full vitest (with the fixtures) | **193 files passed, 1 skipped; 1,949 tests passed, 8 skipped** |
| The bot (128x15, seed 7) | identical to `93069fa`, action log included (196,101): the policy is not part of the sim |
| The S1 rules (hygiene) | pass, within the full run |
| Browser: slow-downs per 10 real minutes before and after, on dense1m and bot256 at ultra | not run on the desktop (stopped at the usage limit); run on the cloud, see below |

## Cloud carry-over (Nov 3)

The desktop worker stopped on Oct 28 with this report drafted and the browser counts still running. The cloud took the
lane over on branch `cloud/t029`: `local/T029-emg-policy` (`505bf01`) with dev (`923428d`) merged in, which was clean.

### Gap list (required against done, at the start)

Read: the task file, NOTE-032/033/035/037/038 (they name T029 only for its order and pauses) and NOTE-044 (the sim
chain: T029, then B3, then T038), STATUS's "Uncovered emergencies in big cities" (the approved design), this report and
the diff against dev.

| Required | State on the desktop branch |
|---|---|
| In range ('busy') never slows: no banner, no LIVE, no pause | done (emergencyPolicy.ts, LivePolicy), tested |
| Busy calls stay in the Emergencies panel as "waiting for a unit" with a Send button | code done; **no test** |
| Their failures still cost approval and post the news line | holds by construction (the sim is untouched); nothing to add |
| Out of range keeps the banner, LIVE and the urgent pause | done, tested |
| The 30 s cooldown on LivePolicy's real time; banner only inside it; paused time does not count | done, tested; the clock fix `cce2c4b` (WIP at the stop) to verify line by line |
| The guide's E2 and phase E texts | done |
| Each new test fails with its fix reverted | **not recorded** |
| The banner's "N more" pill leaves busy calls out (`answerable`) | code done; **no test** |
| Gates on the merged tree: tsc, the full vitest with the S1 rules, the bot identical to dev | **to re-run**: dev moved 23 commits (T031, T036 step 1, T037c and T032's last fixes) |
| Browser: slow-downs per 10 real minutes before and after, dense1m and bot256 at ultra | **not done** (the table held a `QA_RESULT` placeholder) |
| The report against every acceptance item; the done marker | **not done** |

### What the cloud did

- **Merge.** dev `923428d` merged into the lane with no conflict; `npx tsc --noEmit` clean after it.
- **The WIP, line by line.**
  - `cce2c4b` (the clock fix) replaces the three `performance.now()` reads of the cooldown with `this.clock()`: the
    boot reset, `updateCooldown` and the start at an episode's end. That is LivePolicy's injected clock, which is
    SimCore's `clock` argument (the host's clock in the loopback, `performance.now` by default), as for its alert close
    delays. It is correct.
  - `505bf01` is this report's draft, with no code.
- **The lane's code (`f079ff5`), reviewed against the approved design.** No defect found.
  - The busy exclusions sit in two layers that each hold alone: the pure policy (`AlertQueue.offer`,
    `unbanneredPrompt`, `pendingCount`, `urgentSeconds`) and LivePolicy (`flush` and `tick` retire an alert whose
    incident turned busy).
  - The cooldown gates only the start of an episode (`trigger && cooldownLeft === 0`). An episode that is running
    keeps its LIVE follow and its urgent pause. A banner-only alert never starts a slow-down later, because `trigger`
    is cleared on every apply.
  - Paused time is not counted. The real time is accounted at every `speedChanged`, and counts only while the
    speed is above 0. With the default `pauseWhenHidden`, a hidden tab pauses the game, so it stops the cooldown too.
  - One reading to note: `reason: 'busy'` also marks a site beyond every station's reach while every unit that could
    reach it is out (`emergency.ts`, the `busyBeyondNote` branch). That call has `manualPossible` and `canSend` false,
    so it never had a banner. Its panel row now reads "Waiting for a unit — … you can send one once one is back", which
    is still true.
- **Two new tests**, for the two parts that had none:
  - `tests/game/emergenciesPanelWaiting.test.ts`: a real sim, with the in-range station's trucks all out and a far
    one free. The call is uncovered with reason busy, and its row reads "Waiting for a unit — <note>" with an enabled
    **Send** button (no "Dispatch").
  - `tests/game/emergencyBanner.test.ts`, "T029: a major fire inside a busy station's range…": no banner, no LIVE,
    speed 3 and slow-down 1, and the "N more" pill stays hidden.
- **Revert checks.** Each fix was reverted in turn, its guarding tests were run, and the file was restored.

| Fix reverted | Tests that fail |
|---|---|
| R1: the pure policy's busy exclusions | 4: the AlertQueue busy cases (major and all modes), "a busy incident is dispatchable but never pending or urgent", "a busy urgent incident cannot pause an out-of-range LIVE episode" |
| R2: LivePolicy's busy retirements | 1: "a busy urgent incident cannot pause … gaining coverage retires its alert" |
| R1 and R2 together (the two layers of one rule) | 9: the above, plus "a busy major at ultra never banners, slows or pauses" ×3, "saved busy incidents stay quiet on boot and reset", and the new banner/pill case |
| R3: the cooldown gate (`trigger && cooldownLeft === 0`) | 6: the cooldown cases ×3, "a banner-only alert does not start a delayed slowdown", "cooldown excludes paused wall time" ×2 |
| R4: the `speedChanged` accounting | 4: "cooldown excludes paused wall time" ×2, the cooldown cases (live deadline 4, pause) |
| R4b: counting real time while paused | 2: "cooldown excludes paused wall time" ×2 |
| R5: `stateText`'s "Waiting for a unit" | 1: the state-text case |
| R6: the panel's waiting row and Send label | 1: the new panel test |
| R7: the banner's `answerable` busy check | 1: the new banner/pill case |

The positive cases are expected to pass with or without the fixes: "outOfRange / noStation keep the pending and
urgent policy", and the F2 test's clock step past the cooldown. The guide texts have no wording test. They pass the
copy contract (at most 30 words and 2 sentences, the `(LIVE)` code, the 90-word briefing budget).

### Gates (cloud, on the merged tree)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (sem) | clean, after the merge and after the new tests |
| The full vitest, with the fixtures (`SIM_FIXTURES`, `SIM_SNAP` = the main checkout's `tools/bench/.fixtures`), lock | **204 files: 203 passed, 1 skipped; 2,031 tests passed, 4 skipped**, 456 s |
| The full vitest without the fixtures (first run) | 203 passed, 1 skipped; 2,009 passed, 22 skipped, 190 s |
| The S1 rules (`tests/worker/hygiene.test.ts`, `tests/perf/protector.test.ts`) | 21 passed, 1 skipped (the W1.2 gate, not yet active) |
| T029's suites (policy, emergencyPolicy, emergencyBanner, both panel tests, guideCopy, hygiene, protector) | 8 files, 241 passed, 1 skipped |
| The bot, 128x15 seed 7, lane and a clean export of dev `923428d` (lock) | **identical: residents [59288, 95301, 41512] = 196,101 on both**; every year row is the same apart from the two timing columns (econms, totalms) and the ms/day line |

### Browser: slow-downs per 10 real minutes at ultra, before (dev `923428d`) and after (this lane)

**Setup.**
- The real game (`index.html`, the local sim host) in headless Chromium on SwiftShader, served by our own Vite server
  on a free port.
- The fixtures are the ones the generators in `tools/bench/sim-profile/fixtures` built on Oct 27:
  - `dense1m_s7`: 1,118,755 residents, sha256 `ae56d812…`;
  - `bot256_s7_y60`: 652,568 residents, sha256 `97125710…`.
  Each is wrapped as a one-city region with `tools/bench/baselines/toRegion.ts`, imported with `importRegion`, and
  entered with `App.continueInCity`. Both sides load the same files.
- **Real input only.**
  - At the start, the player clicks the top bar's Ultra button with the mouse.
  - The player clicks Ultra again 3 real seconds after the game left ultra on its own (a policy slow-down or pause).
  - The player never dispatches and never dismisses a banner.
- The emergency settings stay at their defaults: `live`, `major`, slow-motion 3. Only presentation settings change:
  quality low, no autosave, no sound, no New Year show or review card, no tips, no camera moments.
- The 3D view is drawn at device scale 0.25 in a 960x540 viewport, with the camera zoomed in 8 wheel notches. That is
  the fastest of four configurations a diagnostic measured on bot256, in ultra fps:
  - device scale 1: 0.06;
  - device scale 0.5: 0.36;
  - device scale 0.5, zoomed in: 3.39;
  - device scale 0.25, zoomed in: 3.77.
  At device scale 1, ultra advances about 0.25 game days a second, which is too slow to count anything.
- Read-only page listeners record every speed change, policy snapshot and emergency event.
- The before and after runs of one fixture ran back to back in one lock hold.

| Run (10 real min) | Game days | Policy slow-downs (to LIVE / to pause) | LIVE episodes | Shortest gap, episode end → next start | Gaps under 30 s | Time at ultra | Uncovered majors (busy) | Busy-only calls that got a banner |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bot256 before | 4,215 (7.0/s, 4.2 fps) | **26** (13 / 13) | 19 | 0.2 s | 13 | 84 % | 74 (11) | **10** |
| bot256 after | 4,649 (7.8/s, 4.3 fps) | **11** (3 / 8) | 10 | 35.5 s | 0 | 94 % | 120 (11) | **0** |
| dense1m before | 3,160 (5.3/s, 3.6 fps) | **39** (16 / 23) | 24 | 0.3 s | 17 | 76 % | 33 (1) | **1** |
| dense1m after | 3,987 (6.6/s, 3.9 fps) | **17** (8 / 9) | 9 | 32.3 s | 0 | 90 % | 43 (4) | **0** |

No page errors and no console errors in any run. "After" covers more game days in the same 10 minutes, because it
spends less of them slowed down, so it meets more incidents and still has fewer slow-downs.

### The same count at a real GPU's cadence (headless, virtual clock)

SwiftShader reaches 5-8 game days a second, not ultra's 20. Its frames are 0.25 s apart, so every frame runs four
days at once (`maxDaysPerFrame`), and the policy sees an incident only after all four.

So the count was repeated headless as well:
- the real `SimCore` (systems, actions, LivePolicy) runs on the same fixtures, with a virtual real-time clock passed
  as SimCore's `clock`;
- 60 frames a virtual second, `core.frame(1/60)` as LocalSimHost calls it, then the microtasks;
- ultra is 20 days a second, and the days never batch;
- the player is the same, with `setSpeed(3, 'topbar')`;
- 10 virtual minutes per run.

This stands in for the real-GPU run that the task asks for. A desktop rerun can confirm it.

| Run (10 virtual min) | Game days | Policy slow-downs (to LIVE / to pause) | LIVE episodes | Shortest gap, end → next start | Gaps under 30 s | Time at ultra | Uncovered (busy) | Busy-only calls bannered | Episodes started with a busy-only alert up |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bot256 before | 5,923 | **103** (27 / 76) | 86 | 0.0 s | 85 | 48 % | 141 (25) | 25 | 32 |
| bot256 after | 10,924 | **18** (1 / 17) | 17 | 30.1 s | 0 | 91 % | 228 (33) | 0 | 0 |
| dense1m before | 7,008 | **87** (33 / 54) | 56 | 0.2 s | 55 | 57 % | 67 (2) | 2 | 2 |
| dense1m after | 10,649 | **23** (8 / 15) | 16 | 31.2 s | 0 | 88 % | 81 (3) | 0 | 0 |

- **Reading.** At ultra on a fast machine, today's policy takes the speed away about every 6-7 s (bot256: 103 times
  in 10 minutes), close to the "one slow-down per ~6 s of ultra" the design predicted. With T029 the rate is 18-23 per
  10 minutes: at most one episode per 30 s plus the episode's own length.
- **The 30 s rule holds in every after run.** The shortest gap from an episode's end to the next start is 30.1 to
  35.5 s.
- **No call inside a station's range banners or slows the game after the change.** It did before: 10 of 19 episodes
  on bot256 in the browser, and 32 of 86 at the real cadence, began with a busy-only alert up.
- **Unlike the Oct 27 data, both cities do have busy calls,** over many more game days: bot256 had 25-33 in 10 minutes.
- **Most slow-downs at ultra go straight to the urgent pause.** That is today's rule: less than 8 s at live speed
  left. T029 leaves it alone out of range, as required.
- **Day throughput is the clearest player-facing effect.** In the same 10 minutes, the after runs simulate 1.5-1.8x the
  game days at the real cadence, and 1.1-1.3x in the slower browser runs.

### Browser evidence

The screenshots were looked at, and are kept in `docs/dev/reports/local-T029/`:
- **`browser-waiting-row-send.jpg`**, the lane on bot256 at device scale 1 (scratch original
  `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t029/evidence/evidence-waiting-row.png`).
  - A major medical call inside the range of Medical Clinic #13, whose only ambulance is out.
  - It raised no banner, and the game was at ultra (`busy call {"day":21686,"speed":3,"live":false}`).
  - The page paused it the moment it was raised, so that it could be photographed (see the harness). The Emergencies
    panel was then opened with a real click.
  - Its row reads "Waiting for a unit — The only ambulance of Medical Clinic #13 is busy", with a blue **Send** button.
    The other rows keep "Dispatch".
- **`browser-cooldown-banner-at-ultra.jpg`**, the lane on bot256 (scratch original
  `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t029/evidence/evidence-cooldown-banner.png`).
  - An out-of-range fire ("Outside fire coverage — … Send nearest 4.1 min", no "too far?") was raised 22.3 s after the
    previous episode ended.
  - It is shown as a banner only. The top bar stays on Ultra, with no LIVE or PAUSED pill.
- **The count runs' own shots** (device scale 0.25, so only the layout can be read), all in
  `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t029/browser/`:
  `{before,after}-{bot256,dense1m}-{loaded,first-live,first-pause,mid,end}.png`. They show the zoomed city with the
  banners, the toasts and the top bar. The diagnostic's shots are in `…/scratchpad/t029/diag/`.
- **The harness** is in `docs/dev/reports/local-T029/harness/`:
  - `emgcount.mjs`: the browser count;
  - `vclock.mts`: the virtual-clock count;
  - `fpsdiag.mjs`;
  - `evidence.mjs`;
  - `compile.py`.
  The compact results of all eight runs are in `docs/dev/reports/local-T029/results.json`. The full timelines stay in
  scratch (`…/t029/browser/*.json`, `…/t029/vc/*.json`).

### Against every acceptance item

| Item (task file, STATUS's approved design) | State | Evidence |
|---|---|---|
| Inside a station's range ('busy') never slows: no banner, no live speed, no pause | **met** | policy tests (busy at ultra ×3, saved busy, busy urgent); browser and virtual clock: 0 busy-only banners after the change (10 and 25 before) |
| Busy calls stay in the Emergencies panel as "waiting for a unit" with a Send button | **met** | `emergenciesPanelWaiting.test.ts`; the browser screenshot below |
| Their failures still cost approval as today; the news line still posts | **met** (unchanged) | the sim is untouched: the bot is identical to dev, and the EM-1 ignored-prompt tests pass |
| Outside every range: banner, live speed while a unit can make it, urgent pause when time is short | **met** | the existing LivePolicy and banner suites; after-run counts: 1-8 to LIVE and 8-17 to pause per 10 min |
| Cooldown: 30 real s at the player's speed after a slow-down or pause ends; banner only inside it; LivePolicy real time; paused time not used | **met** | cooldown tests (×3, banner-only, paused ×2); every after run's shortest end → start gap is 30.1-35.5 s |
| One constant | **met** | `LIVE_COOLDOWN_MS = 30_000` in `src/game/emergencyPolicy.ts` |
| Texts: the guide's E2 and phase E say it plainly | **met** | `src/ui/guide/copy.ts` E2 and `phaseE.Emergencies`; the copy contract passes |
| Gate: the policy tests (in-range busy major at ultra; out of range as today; a second alert within 30 s gets a banner only and one after 30 s slows; the urgent pause out of range) | **met** | `tests/worker/policy.test.ts`, `tests/game/emergencyPolicy.test.ts` |
| Gate: the headless bot unaffected (196,101) | **met** | lane = dev = 196,101 |
| Gate: browser counts per 10 real minutes before and after, dense1m and bot256 at ultra | **met on SwiftShader** (real GPU unavailable) | the tables above; plus the real-cadence virtual-clock count |
| Gate: the S1 rules, `tsc`, the full vitest | **met** | see Gates |

### Decisions (the conservative readings, for the lead)

1. **No real GPU on the cloud.** The browser counts ran headless on SwiftShader, as the carry-over asked. Two choices
   are presentation only and leave the sim and the policy alone:
   - device scale 0.25 with the camera zoomed in, which a diagnostic picked (the fps above);
   - quality low.
   They only make the frames fast enough to count. The counts are counts, not timings.
2. **A second count at a real GPU's cadence was added** (a virtual clock, headless), because SwiftShader's 4-day
   frames and 5-8 days a second under-represent ultra. It uses the real SimCore and the real fixtures, and the player is
   the same. A desktop rerun of the browser count can confirm it, but nothing waits on it.
3. **The player model:** click Ultra at the start, and again 3 s after the game left ultra; never dispatch, never
   dismiss. That is a player who wants ultra and lets the city run. It keeps the before and after runs comparable.
4. **The fixtures were not rebuilt.** They are the Oct 27 builds of `tools/bench/sim-profile/fixtures`, sha256-noted.
   Both sides load the same files.
5. **Hidden tabs:** the cooldown counts real time while the game runs. With the default `pauseWhenHidden` the game,
   and with it the cooldown, stops in a hidden tab. With that setting off, hidden time counts, because the game is not
   paused. That is left as the task words it ("a paused game does not use it up").
6. **The "N more emergencies need you" pill leaves busy calls out.** This is consistent with "no banner", and they
   stay listed in the Emergencies panel. A test now pins it.
7. **The reworded guide texts get no wording test.** They pass the copy contract, and FH-08 (T036 step 5) wires the
   cards later.
8. **A wording gap outside this lane's files, for part 2.** The sim's "uncovered" news line (`src/sim/infra/emergency.ts`
   `uncoveredNews`) still ends "Send help from its alert: Send nearest, or Choose station…". A busy call now has no
   alert, as the evidence screenshot's HEALTH toast shows. The task keeps that news line as it is, and the sim is part
   2's, so it is left alone here. Part 2 should word it for busy calls, for example "… — send one from the Emergencies
   panel".
9. **Status ready.** Every gate is green on the merged tree and every acceptance item is met. The only item that
   differs from its wording is the real GPU (decisions 1 and 2).
