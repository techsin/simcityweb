# FH-21 real-GPU recheck (NOTE-047 item 6): first-run quality, the slow-frame prompt, context loss, load time

Folder: `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\qa\FH21\`
(every path below is relative to it). Nothing in the dev worktree was modified (`git status` clean before and after; Vite
ran with `configFile:false` and its caches in this folder, removed afterwards).

## Environment

| | |
|---|---|
| GPU (WEBGL_debug_renderer_info, every run) | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)`, vendor `Google Inc. (NVIDIA)` |
| Driver | 610.47 (nvidia-smi) |
| Browser | Playwright 1.56.1 headless Chromium 141.0.7390.37, `--enable-gpu --ignore-gpu-blocklist --use-angle=default`, 1280x720, DPR 1 |
| OS / CPU | Windows 10 Education 10.0.19045; AMD Ryzen 7 9800X3D, 8 cores / 16 logical (`navigator.hardwareConcurrency` 16) |
| Tree | the dev worktree `C:\Users\techsin\Desktop\projects\simcityweb` at **821a8d6** (b71b2c2, T036 step 2's FH-21 merge, is an ancestor); Node 22.12, Vite 8.3.0, three 0.186.0 |
| Machine load | shared with other agents: whole-machine CPU 30-96 % during the fps windows (recorded per run) |

## Results

| # | Acceptance line / brief check | Result | Measured | Evidence |
|---|---|---|---|---|
| A1 | A first run with 4 cores starts on Medium; with 8 cores on High | **PASS** | Empty profile on this machine (16 logical cores, desktop UA): `detectQuality()` **High**; app setting, `metropolis.settings` (written at boot), title Settings "Default quality", and a quickstart city's scene + WorldView all High. Init-script `hardwareConcurrency` 4: **Medium** everywhere (city on Medium too); 8: High; 2: Medium; a phone UA: Low | `firstrun/firstrun.json`, `firstrun/title-quality-16c-vs-4c.jpg` |
| A2 | An existing profile keeps its setting | **PASS** | `metropolis.settings` {ultra} on 4 cores stays Ultra; {low} on 16 cores stays Low; a profile with only `metropolis.lastRegion`, only `lastSession` or only `settings.v1` keeps the default High (no detection, nothing written); the 4-core first-run profile reopened on the real 16 cores stays Medium | `firstrun/firstrun.json` |
| B2a | A big city at High on this GPU does not prompt (30 s median fps) | **PASS** | bot256_s7_y60 (653k): median **59.99** fps (p95 frame 16.8 ms), and **59.93** with the sim running at 1x (65 days in 31 s); dense1m_s7 (1.12M), sim at 1x: **59.90** (p95 16.7 ms). No question; `metropolis.ui.slowPrompt` absent | `slow-keep-bot256/result.json`, `slow-fps-*/result.json`, `slow-fps-dense1m-ignore-s1/01-high-30s-no-prompt.jpg` |
| B2b | Slow frames on High (CDP `Emulation.setCPUThrottlingRate` 20): exactly one toast, "The city is running slowly — switch graphics to Medium?" with Switch and Keep | **PASS** | Throttled median 3.9-4.5 fps. One question toast (sticky, no timer bar, no x2 badge) and never a second in 25 s + 30 s more; added once (MutationObserver). Timing: **11.5 s / 11.8 s after the slowdown started** mid-session (after 30 s at 60 fps), stored median 11.3 / 24.3; throttled from the first interactive frame: 11.8 s after the throttle, about 17 s after the first frame (see bug 1). Not "about 20 s": the 20 s window's median flips once just over half of its samples are slow (as coded, `CityScene.ts:756-764`) | `slow-keep-bot256/result.json`, `slow-switch-bot256/result.json`, `slow-keep-bot256/02-slow-prompt.jpg` |
| B2c | Keep (own profile): answer remembered, no second prompt after a reload | **PASS** | `{shown:true, answer:'keep'}`, quality stays High (scene, WorldView, app and game stores); 30 s more at ~4.7 fps: no toast; reload + 35 s on High at 2.7 fps median: no toast | `slow-keep-bot256/result.json`, `slow-keep-bot256/04-reload-no-prompt.jpg` |
| B2d | Switch (own profile): Medium, remembered, no second prompt after a reload | **PASS** | `{shown:true, answer:'switch'}`; scene, WorldView, `metropolis.settings` and `metropolis.settings.v1` all Medium; the reload opens on Medium; set back to High + 35 s at 1.9 fps median: no toast | `slow-switch-bot256/result.json`, `slow-switch-bot256/03-after-switch.jpg` |
| A3 | The prompt shows at most once per profile | **PASS** | B2b-B2d (two profiles, a reload each). But see bug 1 (a long first build fires it at 60 fps, spending the one offer) and bug 2 (the first real click on Keep in run 1 missed the button) | as above; `firstsample-stall/result.json`, `slow-keep-bot256-run1/`, `clickdiag-keep-20-on/result.json` |
| A4 | `loseContext()` pauses, saves, shows the card; Restore brings back a working view at the same camera, state hash unchanged | **PASS** (13/13 of the original checks in each of 3 runs) | My GPU copy of `tools/qa-context-loss.mjs` (`ctxloss-gpu.mjs`), both rounds (Restore button; `restoreContext()`), on: quickstart 64 at Low (the harness's own setup), quickstart 128 at High, and bot256 (655k) at High. Speed 1 -> 0, `lastSave` advances, card in 14-102 ms; rebuild 0.2-0.44 s (empty cities) / **0.94-1.15 s (655k city)**; fresh canvas, 1 canvas, context not lost, 60 fps after (120-122 rAF frames per 2 s; renderer frames 0 while lost, back at the pre-loss rate after, e.g. 1,699 -> 1,717 per 2 s on the 655k city); camera identical (e.g. x 1912, z 2056, 1400 m, yaw 45, tilt 50); exactDigest equal, still paused; mean pixel difference before/after 0.9-4.8 /255; no page errors. **Extra round (desktop): a data view on at the loss is dropped by Restore (bug 3)** | `ctx/*/result.json`, `ctx/bot256-high/lost-Restore-button.jpg`, `ctx/bot256-high/restored-Restore-button.jpg`, `ctx/overlay-lost-after-restore.jpg` |
| A5 / B4 | The time from "Found City" to the first interactive frame, in the fps counter's log (P-5 reports it on its 4-core profile) | **PASS** for the measurement; P-5's own report NOT TESTABLE here (a persona run) | Fresh profile, `?newcity=1` (medium 128 tile), real click on Found City; console `[metropolis] first interactive frame N ms after the click`, `App.lastLoadMs` and the readout's "load N s to the first interactive frame" agree. Dev server, warm: **1.19 s** median on 16 cores (High), **1.20 s** on the 4-core profile (Medium); first, cold run 3.3 s. Production build: 1.22 s / 1.27 s (cold 2.8 s). Entering a saved city (`continueInCity`, the same readout): 4.5-5.8 s for the 653k city in a fresh context, 2.6-4.0 s on a reload, 4.75 s for 1.12M. Each includes the loading screen's 480 ms fade (`LoadingScreen.ts:53`). Bug 4: Play counts the time spent in the recovery dialog | `loadtime/loadtime.json`, `loadtime-prod/loadtime.json`, `recovergate/result.json` |

## Bugs and deviations

1. **The slow-frame window's first sample carries the stall before the first frame** (`src/game/CityScene.ts:690-694` with
   `:726-734`). `firstFrame` flips in the loop, but the fps accumulator is not reset, so the first sample handed to
   `checkSlow` covers createViews and the first render: dt **3.46 s** (4.05 fps) on the 653k city on this GPU, **31.2 s**
   (0.1 fps) with a 30x throttle from page load (`firstsample-big/result.json`, `firstsample-slowstart/result.json`).
   With a first stall of 20 s or more the question fires on that one sample, at the first frame and before `__ready`
   (under the loading screen), whatever the city's fps after it. Shown directly (`firstsample-stall/result.json`):
   createViews held 22 s once, no throttle, quickstart 128 on High: first sample dt 24.2 s (0.58 fps), the question
   0.1 ms later (0.5 s before `__ready`, stored median 0.6), then **50 samples at a median of 60 fps** (min 58). A
   false positive for a machine with a long first build or a cold shader cache, and the once-per-profile offer is
   spent on it. Otherwise the window is shortened by the stall
   (the switch run's prompt came about 17 s after the first frame). Fix: when the flag flips, start the fps window
   there: `this.fps.frames = 0; this.fps.t = 0; this.fps.last = 0;` next to `this.firstFrame = true` (the same
   iteration's fps block then only stamps `fps.last`, so counting starts at the first frame's end). A test: a first
   frame preceded by a 25 s stall, then 60 fps frames: no question.
2. **A toast arriving above the question moves its buttons under the cursor** (`src/ui/Notifications.ts:273`
   `this.el.prepend(t)`, and `:190` for a repeated message). In run 1 the first real click on Keep missed: pointerdown
   hit `button.t-btn[Keep]`; during its dispatch the audio's first-pointerdown unlock (`AudioEngine.attachAutoInit`)
   started the music and its "Now playing" toast was prepended above the question; pointerup and click then landed on
   `div.toast.question`, which ignores clicks: no answer. Recorded in `clickdiag-keep-20-on/result.json` (events and toast log); the second click answered. With a
   prior activation (as after a real Play click) Keep and Switch answered on the first click. Any toast that arrives
   while the question is up does the same (news, a music track change), and a click that lands on a news toast runs
   its action (camera jump, music player); at 2-5 fps the shift shows on screen late. Fix: keep questions at the top of the stack: insert other toasts after the last `.question` child (and
   re-insert a repeated one there instead of prepending), or give questions their own container above `.toasts`.
3. **Restore drops the active data view** (`src/game/CityScene.ts:582-588`, `restoreViews`). With Land value on at the
   loss, after Restore `ctx.overlay` is 6 and the legend and Data button say it is on, but the new WorldView's
   `currentOverlay` is 0 and the city is drawn without it (all three runs; `ctx/overlay-lost-after-restore.jpg`). Fix:
   after `this.applySettings({})`, `if (this.ctx.overlay !== Overlay.None) this.setOverlay(this.ctx.overlay);` (it
   also sets the terrain variant and the objects' overlay mode).
4. **Play's load time counts the "Recover unsaved progress?" dialog** (`src/main.ts:484`: `t0` is taken before the
   `recoveryGate` await at `:491`). Play from the region screen with a pending snapshot, dialog held 6.3 s, then
   Discard: `lastLoadMs` 7,381 ms although the city was up 1.15 s after Discard (`recovergate/result.json`). Fix: take
   `t0` after the gate resolves.
5. Minor, title-screen Settings: "High" is always sub-labelled "Recommended" (`src/region/ui/dialogs.ts:51`), also on
   a first run that detected Medium (`firstrun/title-quality-16c-vs-4c.jpg`, right half). Suggest labelling the
   `detectQuality()` tier instead.
6. Note, not a bug: the mid-session prompt comes about 12 s after a slowdown starts (see B2b). If "20 s at under 25 fps"
   is meant as 20 s of sustained slowness, the window needs a stricter test than its median.
7. Minor: Restore resets the time of day. The top-bar clock (the WorldView's own clock, `TopBar.ts:443`) read 10:51 on
   the lost view and 10:43 a few seconds after Restore, same paused day: the rebuilt view starts again at 10:30
   (`WorldView.ts:248` default; `createViews`, `CityScene.ts:475`, passes no `timeOfDay`), so a loss at night comes
   back in mid-morning light (from the code; only the daytime case was seen). Fix: in `restoreViews` read
   `this.world.timeOfDay` before disposing and set it on the new view (when `autoTime` is on).

Context for the fps runs: in bot256 the default emergency policy paused the city 1.3 s after the load (an uncovered
fire); the sim-running runs set `emergencyUncovered: 'ignore'` and speed 1. The prompt check does not depend on the
speed.

## The lane's browser checklist (docs/dev/reports/local-R1-meta-step2.md), covered on the real GPU

- Part 2's 8-core first run (High), an existing profile keeping its setting, and the slow prompt with Switch / Keep and
  a reload: all re-run here, on 653k and 1.12M cities instead of small_s7_y10.
- `tools/qa-context-loss.mjs` (13 of 13 on SwiftShader): 13 of 13 on the RTX 5070 Ti in each of 3 runs, including its
  own setup (quickstart 64, Low) and a 655k city at High.
- The load line in the fps readout (41-52 s on SwiftShader): 1.2 s for a new medium city, 4.5-5.8 s to enter the 653k
  city, on this machine.

## Scripts (this folder)

`lib.mjs` (quiet gate, in-process Vite, GPU launch), `firstrun.mjs`, `slowprompt.mjs`, `clickdiag.mjs`,
`firstsample.mjs`, `ctxloss-gpu.mjs` (the GPU copy of tools/qa-context-loss.mjs, changes marked `desktop:`),
`loadtime.mjs`, `prodserve.mjs`, `recovergate.mjs`, `compose.mjs`, `shrink.mjs`.
