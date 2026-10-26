# Lead status notes

Durable notes for the development process. The session container can be reset at any time (it was on Oct 26 and
every scratch file was lost), so anything the next round needs lives here or in `docs/dev/reports/`.

## Where things stand (Oct 26)

| Workstream | State | Next |
|---|---|---|
| Sim-depth part B close-out | Rounds 1–4 fixed and verified. Close-out c1 fixed the exit-to-region scene leak and six minors. Verify c2: playtest found no blocker/major (4 minors); audit found 1 MAJOR (an inspector click keeps the previous city alive: module-level `bctx` / `LvCtx` caches in `src/sim/economy/desirability.ts` and `landValue.ts`) + 2 minors. | Fix c2 (the major + all minors), then verify c3. |
| Render round 2 (final) | Revise v1 done in both lanes (fresh-load: veil-fade warm-up frame 127 → 11 ms, LOW first zoom-out 1.17 → 1.05× base; seasons: round far-ring crowns on trunks, `ringLowSwitch` 1.3, ring work 2–3× lower). Art v1 passed; perf v1 had 3 fresh-load majors that revise v1 addressed. | Independent verify v2 (art + perf), revise if needed, verify v3. |
| Million-population performance (#35) | The two prepared branches (`perf/b1-services-trigger`, `perf/exact-js-fixes-r2`) were local only and were lost in the reset. Their content is specified in `docs/WASM_PLAN.md` §6–7 (exact JS fixes, services dirty trigger, order, tests, acceptance) and `docs/WORKER_DESIGN.md` (sim Web Worker). | Re-implement after the sim close-out, then funds deopt fix, exact save/load continuation, step split, worker, verify. |
| Polish & fun pass (#32) | Plan in `docs/POLISH_PLAN.md` (88 items, 4 rounds). Backlog in `docs/dev/POLISH_BACKLOG.md`. | After the above. |
| Final verification (#28), README + build (#29) | Not started. | Last. |

Reports of the latest rounds: `docs/dev/reports/*.md` (verbatim agent reports; paths inside them point at the old,
now deleted scratch directory).

## Running now (relaunched Oct 26 after the weekly limit and the container reset)

| Run | Script (copy) | What |
|---|---|---|
| `wf_81eaafdc-a73` | `docs/dev/workflows/simB-close2.js` | Fix c2 (inspector-click leak + 8 minors) ‖ tooling (simbot `--save-years`, shared test cities, WASM fixtures) → verify c3 (real-input playtest ‖ adversarial audit) → fix/verify c4 if needed. |
| `wf_e99805b4-834` | `docs/dev/workflows/render2-final-v2.js` | Verify v2 (art ‖ perf, tooling rebuilt) → revise both lanes if needed → verify v3. |

Relaunch after an interruption: the scripts start with `const __C = {}` / `const __R = []`. With the journal still on
disk, `python3 <scratch>/refresh_cache.py <script> <runId>` fills `__C` with every finished agent's result by label and
`__R` with the labels that were in flight (they get a RESUMING note), then relaunch with `Workflow({scriptPath})`.
If the container was reset (journal gone), rebuild `__C` from `docs/dev/reports/` by hand or re-run the round.

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
- On a quiet machine `npx vitest run` takes about 95 s (Oct 26: 114 files passed, 18 tests skipped because the
  1M-population WASM fixtures were gone).
