# Lead status notes

Durable notes for the development process. The session container can be reset at any time (it was on Oct 26 and
every scratch file was lost), so anything the next round needs lives here or in `docs/dev/reports/`.

## Where things stand (Oct 27, 20:30)

| Workstream | State | Next |
|---|---|---|
| Sim-depth part B close-out | **Closed (Oct 27, 19:50).** Check 4 on the desktop (T017): playtester and auditor, 0 blocker and 0 major each. The exit leak is fixed: 0 CityScene/CityState at +2 s and +20 s after every exit, and leakprobe passes in all 4 modes. Four minors: the slider retention and the leakprobe positive control go to T025; the emergencies pill over centred panels goes to W0.4's QA; the no-WebGL2 region loader goes to #28. All waiting branches are merged (20:08): J2/J4/J7/J8/J10, LG-01, the guide copy, FH-04, B1, then LG-10, W1.1a and W0.2. | — |
| Render round 2 (final) | Revise v2 done (Oct 27 ~16:05, `aa676ca`): the seasons lane fixed all four items, incl. the pale far copses; the fresh-load lane fixed the cut-sequence shadow passes and part of the LOW edge-view triangles. Verify v2 on the cloud: art passed (1 minor); perf failed only on the UI per-frame cost on fresh pages, which the lead moved to its own item (#17). Nobody has measured GPU time yet (the cloud draws in software). | **Final review 3 on the desktop (T014, queued):** fresh art and speed reviewers at `aa676ca`, including the first real-GPU timing for gate 2. If it passes, round 2 closes; then J0/S0, R1, R2 and NEW-01 art. |
| Million-population performance (#35) | The two prepared branches were lost in the reset; their content is specified in `docs/WASM_PLAN.md` §6–7 and `docs/WORKER_DESIGN.md`. **PI-1 baseline done (T005, merged 73a37e9):** `tools/bench/baselines/pi1-614609f.json`, report `docs/dev/reports/local-T005-pi1-baseline.md`. Windows worker, CPU time over ≥ 1 s chunks, A/A within ±3 %. Design-cadence whole day (AC5's reference): live dense1m 19.8 ms, live bot256 (1.37M) 14.7 ms, so AC5 needs ≤ 14.8 / 11.0 ms. In the browser at ultra: 20.4–20.6 days/s (AC3 met); main-thread p99 27–37 ms, max 42–101 ms, long tasks every run (smoothness not met before W1). Open design item: with the default `emergencyUncovered: 'live'`, 1M+ cities never hold ultra (`EmergencyBanner.applyPolicy` keeps dropping to live speed or pausing); the benches use `'ignore'`. **T007 done on the worker:** J2 traffic (whole day 1.07× dense1m, 1.03× bot), J4 nimby, J7 fire (partial), J8 blur and J10 info cache are exact and not slower (branches `local/J2-traffic`, `local/J4-nimby`, `local/J7-fire`, `local/J8-blur`, `local/J10-infoof`); J3, J6 and J11 were dropped (exact but not faster on the live code). **B1, the services dirty trigger (T015), on the worker (`local/B1-services-trigger` @ `5bb5467`, WIP):** the balance procedure passes. The only misses are single-year tourism values outside ±30 % (4/55, 1/54, 3/9); six 128x15 seeds give a year-15 geometric mean of 0.996, so it is bot noise, not bias. The new 128x15 seed-7 reference is **196,101**. Also: funding latency of 2 days; D1 identical; old saves 6/6; design-cadence passes on dense1m down from 30 to 4.7 per 60 days; A/B dense1m 1.31× (A/A 1.017), bot256 1.38–1.43× (provisional). Left: the live cap applies only to dirty passes, at the design's 2000 ms and renamed `SERVICES_MIN_CYCLE_MS` (NOTE-015), plus the remaining A/B on a quiet machine. A test merge onto the other waiting branches is clean (tsc ok). **B3 (Worker S4, the month spreading) runs on the cloud** as workflow `wf_96cfa1e8-a78` in a scratch worktree, merged after B1 (one behaviour fix at a time). **W0.3-W0.5 are done** as one integration branch (`local/W0.3-5-integration` @ `93069fa`: every conflict hunk resolved as a union; on the desktop tsc, 1,568 tests, bot 196,101 and old saves 6/6; on the cloud tsc, 1,550 tests passed and 0 failed, recovery.test 13/13 three times alone, bot 196,101. **Its browser QA runs on the cloud**: workflow `wf_827f1194-781`, three fresh QA agents on SwiftShader under the timing lock). **W0.6 and W0.3b** (the last 14 system reads, plus an `upkeepContext` query) run as Codex lanes from it; W0.6 also owns the root cause of `recovery.test`'s load sensitivity. **Codex hit its usage limit at 21:05 UTC; the owner bought credits at about 21:30, and every lane resumed.** **Started from it as well:** T029 (#16 part 1: in range never slows; the 30 s cooldown) and T030 (#17's UI half with R2's minimap throttle). #16's sim half (mutual aid, station load, coverage) follows B2. **W0.2 is merged too** (`2ba03fa`: every mutation through host.act / setSpeed; the S1 speed rule is on, the liveSlowdown rule waits for W0.4; the merged tree passes 1,520 tests, bot 196,101). **The bit-identity reference is now B1's 196,101** (128x15 s7). W0.3-W0.5 run as three lanes from `2ba03fa`. **W1.1a is merged** (`dafdf2d`: protocol, recorder, replica, loopback core; the replica is exact after every packet, with the sim-neutral `treesDamaged` event closing the tornado hole). **W0 (T020) on the worker: W0.1 is merged** (`3a0a2ab`: SimCore, SimHost and LocalSimHost; the simwasm opt-in with blur's own `'js'` default, WASM_PLAN PI-6). Gates: 1,157 tests passed on the cloud, bot 194,432, old saves 6/6, S1 both modes; its ultra A/A follows in a quiet slot. W0.2 branches from it, and **W1.1a (T023: protocol, recorder and replica core) runs next to W0.2-W0.6** (W0 is the longest chain: the polish GUIDE/META items wait for W0.6). **The S1 protector and hygiene suites (T018) are merged** (`e5a3e07`; their W0.2-W1.2 rules are skipped until those steps land). The soak harness (T019) and Worker step R1 (T021, TerrainRenderer dirty rects, pulled forward because no open branch touches its file) run there too. A test merge of every waiting branch onto the dev branch is clean apart from `tools/bench/exact/abDay.ts`: J4's copy is a superset, so take it. On that merge: tsc clean, 1,320 tests passed, the bot bit-identical. | Merge the J-fix branches after the sim close-out and verify them independently; then J5/J9/J0, B1–B5 (balance procedure), the worker host W1, acceptance §7.9; the emergency-policy change for big cities (see Design decisions) after the sim close-out. |
| Polish & fun pass (#32) | Plan in `docs/POLISH_PLAN.md` (88 items, 4 rounds). Backlog in `docs/dev/POLISH_BACKLOG.md`. Head start done on the worker: LG-01 ranks, the guide copy, FH-10 (merged), and **FH-04 Easy mode** (`local/FH-04-easy` @ `d82f43a`). FH-04 keeps Medium and Hard bit-identical (270 yearly hashes) and gives Easy approval ≥ 55 in 2001-06. Its newcomer gate waits for FH-03: the newcomer never zones past its first four blocks on any difficulty, so per D3 it is re-run after FH-03, and LG-09 adds Easy rules only if it is still missed. Audio (T008) and landmark art (T010) are still running. **Queued as more Codex lanes (NOTE-024):** FH-07a refunds (T026), FH-19 + FEEL-08 camera (T027), and the worker-mode acceptance harness (T028), next to W0.3-W0.5 and the slider fix T025. | Merge FH-04 with check 4's branches. Round 1's GUIDE/META items after W0.6; FH-19/FEEL-08 after render round 2. |
| Final verification (#28), README + build (#29) | **The soak harness is merged** (T019, `d1695ac`: tools/soak/). Its 20-minute smoke runs on the desktop pass every line: dense1m heap +5.06 MiB/h, 15.7 days/s; the small city heap flat, 16.8 days/s; 0 cities after exits, 0 errors. **The parameters for #28 (NOTE-026):** 4 hours per scenario on the final merged build; heap slope ≤ 16 MiB/h over the run and ≤ 8 MiB/h over its second half; 0 cities, 0 errors, 0 unexpected context losses; ≥ 15 days/s at ULTRA. | Last, after the polish rounds and W1.4. |

Reports of the latest rounds: `docs/dev/reports/*.md` (verbatim agent reports; paths inside them point at the old,
now deleted scratch directory).

## Running now (Oct 27, 21:45: WINDING DOWN until the weekly reset, Mon 2 Nov 15:00 UTC. The owner reports the weekly Claude limit over 70 % used, so we finish few things fully (NOTE-035). Finishing: the W0.3-5 integration QA (cloud), W0.6 + W0.3b → W0-complete, T014 (render round 2), T008/T010 gates (cloud), T025-T027. Paused: B2 after its design (docs/dev/B2_DESIGN.md; resume wf_13b4de49-6de), B3 after its build (docs/dev/B3_DESIGN.md; resume wf_96cfa1e8-a78), every other desktop lane after Codex commits its code.)

On the cloud: **B3** (`wf_96cfa1e8-a78`, copy `docs/dev/workflows/b3-month-spread.js`; worktrees `<scratch>/b3`, base `<scratch>/b3base` = test merge `a59f08f`; baseline balance runs in `<scratch>/balance/base/`, which reproduce the recorded part B rows exactly) **B2** (Worker S3, the step split: `wf_13b4de49-6de`, copy `docs/dev/workflows/b2-step-split.js`; worktrees `<scratch>/b2` and base `<scratch>/b2base` = the B1 test merge `41ae570`; timing runs take the lock `<scratch>/timing.lock`), and **the independent J-fix check** (`wf_2d846103-df1`, copy `docs/dev/workflows/jfix-verify.js`, two read-mostly reviewers on the test merge `<scratch>/premerge`). A test merge with B1 is in `<scratch>/premerge-b1`. The graphics workflow `wf_08a5eb98-993` (`docs/dev/workflows/render2-final-v2r.js`)
completed after revise v2 (Oct 27 ~16:05); final review 3 runs on the desktop (T014). On the desktop: T017 (check 4,
first), T014 (art next to T017; speed on a quiet machine afterwards), T020 (W0), T015 (B1 timing, paused during
browser runs), T018, T019.

The sim close-out workflow `wf_81eaafdc-a73` was stopped on purpose after fix c2; checks 3 and 4 and fix round 4 moved to the desktop (T013, T016, T017).

Relaunch after an interruption: the scripts start with `const __C = {}` / `const __R = []`. With the journal still on
disk, `python3 <scratch>/refresh_cache.py <script> <runId>` fills `__C` with every finished agent's result by label and
`__R` with the labels that were in flight (they get a RESUMING note), then relaunch with `Workflow({scriptPath})`.
If the container was reset (journal gone), rebuild `__C` from `docs/dev/reports/` by hand or re-run the round.
Before relaunching, stop the dead agents' leftover browsers, vite servers and chains (`ps -eo pid,args | grep -E
"chrome-headless|serve1|servers.mjs|chain.mjs"`).

## Local GPU worker (since Oct 27)

The owner's desktop runs a Claude Code worker under Remote Control (protocol: `docs/dev/COORDINATION.md`): Windows 10,
Ryzen 7 9800X3D (8c/16t), 61.6 GB RAM, RTX 5070 Ti 16 GB (Chromium uses it through ANGLE/D3D11, also headless), 4K monitor,
Codex CLI logged in. AC sleep is disabled, so multi-day runs are fine; the display still sleeps after 10 min, so timing
runs should be headless. Round trip lead → worker → lead measured at 51 s. Tasks: `docs/dev/queue/`; reports:
`docs/dev/reports/local-*.md` on `local/*` branches.

## Design decisions

- **Render round 2 after verify perf v2 (Oct 27, lead).** Report: `docs/dev/reports/render2-final_verify-perf-v2.md`.
  1. **Gate-1 bases.**
     - Warm pages are gated on `be48061`, which reproduces v1's warm calibration (V1/base 0.676–0.726 town LOW, 0.554
       dense LOW); `a284b80` is shown as a cross-check.
     - Fresh pages and the real load path are gated on `a284b80`, which reproduces v1's fresh base costs (163 / 79 ms
       against 155 / 84).
     - Every report shows both bases where measured.
  2. **Gate 1 for the render round is the render lanes' own work:** the scene's frame callback on every page, plus the
     render-only bench pages. Both pass. The two v2 majors are the UI's per-frame cost outside the scene callback: DOM
     style, layout and paint during camera moves, timers, WebAudio node-finish tasks, and the music director. They are
     not in the render lanes' files, so they become a separate required item:
     - **What it is:** UI per-frame cost during camera moves, owned by the sim/UI side.
     - **When:** after the sim close-out (the UI files are in flux), and before the final verification (#28).
     - **Planned fixes:**
       - throttle HUD, minimap and label updates while the camera moves (≤ 10 Hz);
       - no layout reads in per-frame handlers;
       - animated HUD parts on their own compositor layers;
       - pool / reuse WebAudio one-shot nodes;
       - start the music director after the veil fade.
     - **Its gate** is the original whole-main-thread fresh-page gate against `a284b80`: ui page HIGH first zoom-in,
       zoom-out and far orbit; real path LOW first pan, zoom-out and zoom-in. It is measured on the desktop worker
       (quiet CPU).
  3. **Revise v2.**
     - **fresh-load:** the two UI majors are for the record only (describe the fix, no `src/ui` edits). It fixes the
       cut-sequence shadow passes (deterministic refit, caster culling on the first cut) and the LOW edge-view building
       triangles. The HIGH far-view zoom-out render share (inconclusive on fresh pages, passes on warm pages against
       `be48061`), the frame-2 backlog and load warm-up slicing only if cheap.
     - **seasons-final:** the ring far-view CPU (target ≈ 0.15 ms at the ULTRA far orbit).
  4. **Gate 2, GPU part:** the GPU stand-in cannot be measured in the cloud at load 55–75. The desktop worker measures
     it on the real GPU on the tree after revise v2 (queue task when revise v2 lands): LOW vs `c024`, plus the
     HIGH/ULTRA GPU-process sums. Verify v3 covers the rest.
  5. **Not gated, accepted:** the load frame is 337–412 ms (the warm-up moved into it, behind the opaque veil). The
     fresh dense-city HIGH street pan (inconclusive, A/A 8.5 %) is rerun at a lower load in v3 or on the desktop.
- **Browser-heavy checks run on the desktop (Oct 27, the owner's choice).** The cloud draws 3D in software at load
  40–60 (one camera orbit took 18 minutes), so the remaining independent checks move to the desktop worker, whose real
  GPU runs them in a fraction of the time:
  - the sim close-out check 3 (playtest and audit), T013;
  - graphics final review 3 (art and speed, with the GPU timing), T014.

  The cloud keeps the fix rounds, the revisions and the merging. Mechanics:
  - each cloud workflow runs to the end of its current coding stage (fix c2; revise v2), and the lead stops it as soon
    as it starts the next check;
  - the worker runs each reviewer as its own sub-agent with a fresh context and the cloud brief, adapted for Windows;
  - findings come back as reports on `local/*` branches and go to the cloud fix engineer as before.

  Codex cannot run browsers there (its sandbox cannot start processes: `spawn EPERM`), so it only writes code.
- **Sequencing after the close-out (Oct 27, lead).** The Worker plan's W0.1-W0.6 (the SimHost seam:
  docs/WORKER_DESIGN.md §6) runs right after fix round 4 merges, on the desktop with Codex (T020; W0.3, W0.4 and W0.5 as
  three lanes at once). Polish D1 starts the GUIDE and META items (most of rounds 1-2) only after W0.6, so W0 is now the
  longest chain. Dependent items:
  - the big-city emergency change builds on W0.4 (LivePolicy moves into SimCore);
  - the UI frame-cost change builds on W0.5 (views and seams, MiniMap);
  - polish SIM, CONTENT, art and audio items fill the gap before W0.6.

  Also queued for the desktop: S1, the protector and hygiene tests (T018), and the soak harness for #28 (T019).
- **The simwasm opt-in lands with W0.1 (Oct 27, lead; NOTE-015).** SimCore takes `flags.simwasm`; with no flag the
  blur preference is `'js'`, nothing wasm loads in the browser, and node runs JS, so the bot stays bit-identical. The
  three blur imports (crime, parking, pollution) switch to the drop-in (WASM_PLAN PI-6), and S1's protector test drives
  wasm through the flag.
- **Uncovered emergencies in big cities (Oct 27, approved by the owner).** The owner's rule, plus the cooldown and details proposed by the lead. It comes after the sim
  close-out; the coverage part comes after the B1 merge, which touches the same `services.ts` (J3 was dropped).
  The change alters the sim, so the bot reference table gets re-recorded once.
  - **A site inside a station's range never slows the game**, even when every unit there is out.
    - Such a call gets the nearest free unit of another station that can still make it in time (mutual aid, as
      minor calls already do), or waits for the first unit back.
    - It stays in the Emergencies panel, where the player can still send a unit by hand.
    - The service deteriorates instead. Late, failed and fatal calls already cost approval, and medical response
      feeds health quality. New: each station tracks its load (the share of recent calls that found no free unit or
      needed mutual aid). The load is shown in the inspector and the coverage data view, an advisor names
      overstretched stations, and an overstretched station's fire / police / health coverage counts for less (those
      coverages already feed desirability and crime).
  - **A site outside every station's range** keeps today's behaviour: a banner, live speed when a unit can still
    make it in time, and a pause when time is very short. This is a coverage gap the player can fix.
  - **Cooldown:** after a slow-down ends, the game stays at the player's speed for about 30 real seconds before the
    next one; alerts in that window get a banner only.
  - **Data behind it** (`frames` loop at ultra, 240 game days = 12 s each):
    - 1.15M dense1m: 516 incidents, 110 major, 2 uncovered, both fires out of range;
    - 660k bot256: 309 incidents, 94 major, 3 uncovered, all fires out of range;
    - no busy case in either city.
    So without the cooldown, the rule alone would not keep ultra usable in a city with gaps (one slow-down per ~6 s
    of ultra).

## Progress chart

The current chart is **Metropolis Build Timeline** (version 6, Oct 27 20:20: likely Mon 9 Nov, worst Tue 17 Nov; the work left is about 8 hours more than next week's window holds): https://claude.ai/artifact/L4hk5JnzUK3qPkQiSzpMsm, a work-time Gantt
with the weekly pauses folded and the status in detail. Its source is `docs/dev/timeline.html`; edit the inputs at the top
of its script (`AS_OF`, `GROUPS`, `RUNNING`, `CHANGES`) and republish the same file. The older chart "Metropolis
Completion Schedule" (https://claude.ai/artifact/D7HegAurxkGe32L7Bh6Yzb, source `docs/dev/schedule.html`) stays at
version 17.

## Reference commits

| Name | Commit | Use |
|---|---|---|
| base | **lost**; best candidate `a284b80` (parent of `535655d`, the first commit with render-perf work: LOD proxies, `quality.ts`) | Gate 1: moving-camera main-thread CPU must not exceed the pre-optimisation base. Calibrate a rebuilt base against the v1 ratios below before trusting it. |
| c024 | `02464a3` | Render perf round 1 landed. Gate 2 reference for LOW GPU/triangles and the HIGH/ULTRA +5 % allowance. |
| F | `c87d8c8` | Art reference (round 3). |
| N | `4b3d074` | Round 4 tree, before the final fix round. |
| V1 | `c30fca4` (render files = `b5eca11`) | The tree art v1 passed and perf v1 measured, before revise v1. |

Perf v1 ratios (new = V1, against the old base), for calibrating a rebuilt base: warm-page pooled moving CPU town
0.740, dense city 0.675, ui LOW/HIGH/ULTRA 0.817/0.794/0.797; fresh dense-city HIGH street-settle 0.867; fresh LOW
town first zoom-out 1.059, first zoom-in 1.057 (A/A within ±3 %).

## Render gates (lead)

1. Moving-camera main-thread CPU must not exceed the pre-optimisation base in any scene, including fresh pages
   (first zoom-out, first zoom-in, first street-settle after load). Judged with interleaved A/B, a fresh browser per
   side per rep, CPU time (schedstat), ≥ 8 reps, medians + 90 % bootstrap CI + A/A copies.
   *Lead decision (Oct 26):* a fresh-page segment is a MAJOR only when the excess is shown (lower 90 % CI bound of
   new/base above 1.02 with A/A within ±5 %); a point estimate above 1.00 whose CI includes ≤ 1.02 is reported as
   inconclusive/minor with the numbers.
2. LOW: no GPU or triangle regression vs c024. HIGH/ULTRA up to +5 % where it pays for accepted art. Accepted: the
   outer forest ring's draw cost (~0.15–0.3 ms); single HIGH/ULTRA ring segments up to ~1.12× base are minor if the
   per-page pooled moving sum is ≤ base and LOW pays nothing; fast edge-flight / cut-sequence main-pass triangles up
   to ~+7 % HIGH / +12 % ULTRA if still views and per-page moving sums stay within +5 % and GPU-process sums within +5 %.
3. No new frames over 16.7 ms beyond c024 on cuts, zooms and fresh-page first frames.

## Sim gates

- The 128×15 seed-7 bot run (`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`) must stay bit-identical:
  194,432 residents in 2015, unless a change is meant to alter behaviour (then re-record and say so).
- Old saves must load and continue; the recovery codec suite must pass.

## Environment notes (cloud container)

- 4 cores, 16 GB, cgroup limit about 14.3 GB. Several agents run browsers at once; keep an OOM guard on harness
  processes (`echo 800 > /proc/<pid>/oom_score_adj`) so the kernel kills them before the session.
- Playwright 1.56 expects Chromium build 1194; the image ships 1243. Fix after a reset:
  ```
  B=/opt/pw-browsers
  mkdir -p $B/chromium_headless_shell-1194/chrome-linux $B/chromium-1194/chrome-linux
  ln -sfn $B/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell $B/chromium_headless_shell-1194/chrome-linux/headless_shell
  ln -sfn $B/chromium-1243/chrome-linux64/chrome $B/chromium-1194/chrome-linux/chrome
  touch $B/chromium_headless_shell-1194/INSTALLATION_COMPLETE $B/chromium-1194/INSTALLATION_COMPLETE
  ```
  Launch with `--use-angle=swiftshader --enable-unsafe-swiftshader` (WebGL2 via SwiftShader).
- The clone is shallow; run `git fetch --unshallow origin <branch>` before using old reference commits.
- On a quiet machine `npx vitest run` takes about 95 s.
- Test cities and WASM fixtures: see `docs/dev/TEST_CITIES.md`. After a reset run `npm run fixtures` (about 6 min for the
  fixtures, 6 more for the bench captures) and `npx tsx tools/simbot.ts --size 256 --years 43 --seed 7 --save-years 21,43
  --save-prefix <dir>/vet_s7_` for the shared cities. With everything rebuilt only the 3 `BALANCE`-gated tests skip.
