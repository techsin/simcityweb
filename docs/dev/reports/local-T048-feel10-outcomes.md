# T048 report: FEEL-10, emergency outcomes and LIVE mode that feel urgent (desktop, real GPU)

**Verdict: done.** Every Acceptance line passes on the real GPU, on the default host and on `?simworker=loopback`,
after one review round. The bot is identical, and no sim or worker file is touched.

Branch `local/T048-feel10-outcomes`:
- base dev `fb1531f`;
- `cb430ce`: the lane;
- `f73b320`: review round 1.

## What changed

- **src/game/GameSounds.ts:** the outcome stings.
  - **"saved":** plays when an incident the player dispatched resolves with no losses.
  - **"lost":** plays on a failure or losses, only for incidents the player responded to or that had a banner.
    Unseen auto-answered outcomes stay silent and do not touch the rate limit.
  - **The rate limit:** at most one sting per 10 s, on a real-time clock.
  - **The LIVE duck:** −6 dB through AudioEngine.duck while LIVE shows, released 0.5 s after it ends. It follows the
    speedChanged event's own value, so it works on hosts that replay the event before their speed mirror updates.
- **src/audio/sfx.ts:** the two stings (0.8 s bright, and low).
- **src/audio/AudioEngine.ts, src/audio/ducking.ts:** an independent LIVE duck with its own hold and release, so other
  ducks keep their timing, and `debugMusicBusGain` for the acceptance.
- **src/ui/EmergencyBanner.ts:** WORLD's round-2 hunk.
  - The flash: green or red for 600 ms. The outcome line renders at once, so the flash and the text land together.
  - The restore toast ("Emergencies handled — back to ultra speed") is silent while the episode's player-dispatched
    incident is still dispatched or on scene, and when a sting just played.
- **src/ui/fx.css** (new, WORLD's style file): the 3 % red edge vignette on `.mp-ui.emg-live`. It is steady with
  reduced motion and pointer-transparent.
- **src/game/CityScene.ts, src/game/context.ts:** one-line wiring each.
- **Tests:**
  - new: `tests/audio/emergencyStings.test.ts`, `tests/game/emergencyLive.test.ts`,
    `tests/game/emergencyOutcomes.test.ts`, which restores before resolving, as the real game does;
  - updated: the audio node-cost helper.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest, with the fixtures (`f73b320`) | **221 files passed, 1 skipped; 2,191 tests passed, 7 skipped; 0 failing** |
| The bot, 128x15 seed 7, with the action log | **identical to dev: residents [ 61124, 93804, 37971 ] = 192,899** |

## Real-GPU QA

- Environment: RTX 5070 Ti (driver 610.47), ANGLE D3D11, headless Chromium 151, Windows 10 19045.
- City: vet_s7_y21 (304k), plus a 101k city; real clicks, the game's own audio graph running.
- Scenario: a 3x3 Smokestack Factory outside fire coverage, so Send nearest takes 3.98 min. The playtest's Refinery
  took 3.9.
- Done by an independent QA agent, in two rounds.

| # | Acceptance | Round 1 (`cb430ce`) | Round 2 (`f73b320`) |
|---|---|---|---|
| 1 | A player dispatch saved: exactly one "saved" sting, no second chime | **fail 5/5:** the restore toast chimed 34-258 ms before the sting (LIVE ends 0.75 days after arrival, before the fire is out) | **pass 9/9** (6 default host, including 0.7 s think time and stall runs; 3 loopback): "saved" once, the restore toast silent, the sting 15-253 ms after the restore |
| 2 | A failed alert plays "lost"; red flash | pass | **pass:** red flashes 568-684 ms, green 567-607 ms (median 597) |
| 3 | At most 1 sting per 10 s | pass, but unseen auto-answered deaths stung every 10-25 s and starved the player's own | **pass:** minimum gap 10.086 s over 61 stings. About 10 min at ultra on the 304k city: 37 stings, 0 unseen, 381 unseen outcomes with losses silent. On the 101k city: 9 stings, 0 unseen. 20 of 20 restore toasts silent |
| 4 | The vignette exactly while the LIVE pill shows; music 6 ± 1 dB lower during LIVE | pass on the default host; **fail on loopback** (0 dB: no duck after an urgent pause) | **pass on both:** 0 mismatching frames in 130k; fade-out 504-578 ms; −6.00 dB in every LIVE segment, including all 4 on loopback; exactly −6.00 dB through injected 100-250 ms stalls |
| 5 | Reduced motion: the vignette does not pulse | pass | pass |
| – | The flash and the outcome text together | the text landed one UI tick late | **pass:** 161 flashes, 0 with stale text |
| – | Errors | none | none beyond the existing shader-compile warnings |

Known limitations and notes, none blocking:
- **`debugMusicBusGain` misreads while no music plays.**
  - It reads the gain node's `AudioParam.value`, which Chrome stops updating while the node's input is silent, as
    during the director's 15-40 s rests between songs. In 1 of 13 LIVE episodes it read 0 dB throughout.
  - What you hear is right: a song starting during LIVE comes in at −6 dB within 500 ms.
  - Suggested fix: compute the getter from the envelope state. It is a test aid only.
- **A player's save can lose the 10 s slot to a simultaneous outcome.**
  - Case: a bannered alert's "lost" played 10 ms before the player's own "saved".
  - This is what the spec says; preferring the player's outcome within about 250 ms is optional.
- **Stalls longer than the 300 ms hold lift the duck briefly:** −4.2 dB for under 100 ms after a 400 ms stall.
- **The vignette is very subtle:** +1-2 red levels at the edges, visible only at ×20. It is the plan's 3 %; its
  strength is the lead's call.

## Requests

1. **Reinforcement provenance (src/worker, cloud).** Sending more units to an incident the city already answered
   leaves `answered === 1`, so a lossless outcome stays silent. Today's cause tags carry only seq and tag.
   - Add an optional `Cause.dispatchIncidentId` in `SimHost.ts`, filled by `LocalSimHost.act` for
     `dispatch` / `dispatchBest` from `args[0]`.
   - Keep it through `PacketSimHost.post` and the replica's cause hook until the ack (`LoopbackSimHost.ts`,
     `replica.ts`).
   - GameSounds then marks the player's involvement independently of `answered`. No sim, save or RNG change.
2. **Host ordering (src/worker/LoopbackSimHost.ts:180).** The loopback host re-emits `speedChanged` before it updates
   its speed mirror. This lane no longer depends on the order, but other handlers that re-read `host.speed` will see
   the old value.

## Evidence (`docs/dev/reports/local-T048/`)

- `r2-ev1-saved-flash.jpg`: the green flash on "Fire under control", with the silent restore toast;
- `r2-ev2-lost-flash.jpg`: the red flash on a lost alert;
- `r2-ev3-live-on.jpg`: LIVE with the vignette;
- `ev6-vignette-diff-x20.jpg`: the vignette's strength, ×20;
- `round2-aggregate.json`.

The full QA reports and the raw recordings are in the worker's scratch (`qa/T048/qa.md`).

## What came from Codex

- The Codex lane wrote the implementation, the review-round fixes and the tests.
- An independent Codex review found the restore-before-outcome ordering, the stale speed read and the reinforcement
  case.
- A Claude QA agent did both real-GPU rounds. The worker ran the gates and wrote this report.

## Cloud carry-over (Nov 3)

Cloud verification of the desktop lane (chain desk2), on `cloud/t048`: the lane's `bd318e9` with dev merged.
Machine: a 4-core cloud container, WebGL on SwiftShader, so the browser checks here test function and visuals, not GPU
timings.

### Gap list (required against done, written before the work)

Read: the task file, NOTE-044, every NOTE naming T048 (NOTE-045, -046, -047, -048, -049), POLISH_PLAN FEEL-10 in
full (Problem, Change, Files, Acceptance, Risk) and its §8.2 verifier checks, this report, the diff against dev, the
four evidence images, and T061 (the cloud task that takes the lane's worker-host requests).

| # | Required | State at `bd318e9` | Cloud action |
|---|---|---|---|
| 1 | Merged with dev | 23 dev commits behind (base `fb1531f`) | merge dev, resolve, tsc |
| 2 | Gates here: tsc, the full vitest (with the hygiene test), the bot identical to dev's `residents [ 61124, 93804, 37971 ]` | run on the desktop only | rerun all three here; dev's bot from a clean export |
| 3 | "No sim or worker file is touched" | claimed | confirm from the diff |
| 4 | Unit tests: one "saved" and no second chime; "lost" on a failed alert; the rate limit; the duck depth 6 ± 1 dB (debug getter); the vignette class exactly while the LIVE pill shows | present in 5 new test files (46 tests) | rerun; confirm they fail without the lane |
| 5 | Acceptance "the music bus is 6 ± 1 dB lower during LIVE (debug getter)" | passes, but the report's known limitation: `debugMusicBusGain` reads the gain nodes' `AudioParam.value`, which Chrome stops updating while the music input is silent (a song rest), so it read 0 dB in 1 of 13 LIVE episodes | **real gap in the acceptance instrument:** compute the getter from the duck envelopes (the report's own suggested fix), with a test that fails without it |
| 6 | Browser: the Refinery-style dispatch, a failed alert, LIVE on and off with vignette screenshots | done on the real GPU (two QA rounds) | rerun functionally on SwiftShader, default host and `?simworker=loopback` |
| 7 | Desktop WIP commits (`cb430ce`, `f73b320` are "wip" Codex-lane commits) | reviewed by the desktop | review line by line; check the `-snap` branch holds nothing newer |
| 8 | NOTE-046 Q3: the EmergencyBanner hunk in its own commit | mixed into the two WIP commits | cannot be split without rewriting the lane's history; decision below |
| 9 | The lane's requests (reinforcement provenance, the speedChanged order, the clock cap) | open | **not this lane's gaps:** NOTE-049 moves them to T061 |

### What the cloud did

1. **Merged dev twice** (`9badcc2` at dev `683d02b`, `aba092d` at dev `50a6b29`).
   - One conflict, in `src/game/context.ts` `GameContext.toast`: both sides added the `opts` parameter. I kept dev's
     wider type (`{ silent, ttl, budget }`), which includes the lane's `silent` flag.
   - CityScene's toast passthrough was identical on both sides. The second merge brought in docs only (NOTE-050 to
     NOTE-052).
   - tsc is clean after both merges.
2. **No sim, worker or save file is touched**, confirmed from `git diff origin/claude/beautiful-johnson-u2jqoz HEAD`.
   - The diff has 21 files.
   - src: `src/audio/{AudioEngine,ducking,sfx}.ts`, `src/game/{CityScene,GameSounds}.ts`, `src/ui/EmergencyBanner.ts`
     and the new `src/ui/fx.css`.
   - Tests and docs make up the rest.
   - Nothing under `src/sim`, `src/worker` or `src/save` changed. GameSounds and EmergencyBanner only *import types*
     from `src/sim` and `src/worker`. Outcomes are read through `host.events`, `host.emergency`, `host.policy` and
     `host.cause`.
3. **Desktop WIP reviewed line by line** (`cb430ce`, `f73b320`; the Codex lane's two "wip" commits):
   - the stings and their rate limit (`GameSounds.onEmergency`, `OUTCOME_GAP`, `ready('emergencyOutcome')`);
   - the player-provenance bookkeeping (`answered === 2` or a cause-tagged dispatch), and the seeding at boot and on
     `reset`;
   - the restore-toast silencing (`emergencyStingPending` over the episode's incidents);
   - the LIVE duck: a renewable envelope with its own hold and explicit release, and `syncMusic`'s scheduling of the
     quieter of the two envelopes, including the crossing point;
   - the flash timers and their cleanup on reset, dispose and abort;
   - the vignette CSS.

   `local/T048-feel10-outcomes-snap` (`fdb6610`, 14:56) is older than `f73b320` (15:01). It holds nothing `f73b320`
   lacks: their diff is additive.
4. **One real gap fixed (`0c7966e`): `debugMusicBusGain`**, the acceptance's instrument (gap row 5).
   - Before, it multiplied the gain nodes' `AudioParam.value`, which Chromium stops updating while the music input is
     silent.
   - It now computes the reading: the music volume `applyVolumes` sets, times `AudioDucking.musicGainAt(now)`, which is
     the minimum of the two duck envelopes that `syncMusic` schedules.
   - What plays does not change.
   - New test: `tests/audio/emergencyDuckHold.test.ts` ("the debug getter reads the scheduled duck while no song
     plays…"). It freezes both gains' `.value` and reads −6 dB, the release midpoint and the baseline. It fails with
     the fix reverted.
5. **Every new test must fail without the lane.** I ran 11 mutations, each reverting one piece of behaviour, against
   the lane's 5 test files (47 tests). Every one is caught (summary in the scratch dir, `t048work/mut/summary.txt`):

   | Mutation | Failing tests |
   |---|---|
   | "saved" → `good` | 13 |
   | "lost" → `bad` | 10 |
   | `OUTCOME_GAP` 10 s → 0 | 1 |
   | restore toast never silent | 4 |
   | LIVE duck 0 dB | 7 |
   | LIVE duck 3 dB | 7 |
   | vignette class ignores the pause | 3 |
   | no flash class | 4 |
   | flash 1,200 ms | 2 |
   | getter back to `AudioParam.value` | 1 |
   | no LIVE release | 7 |

6. **Browser checks on SwiftShader**, the default host and `?simworker=loopback`, in the real game page (details
   below).

### Gates

| Gate | Result |
|---|---|
| tsc (`aba092d`) | clean |
| Full vitest with the fixtures (`aba092d`, `SIM_FIXTURES`/`SIM_SNAP` from the main checkout) | **225 files passed, 2 skipped; 2,247 tests passed, 8 skipped; 0 failing** (429 s) |
| Hygiene (`tests/worker/hygiene.test.ts`, also inside the full run) | 17 passed, 1 skipped (W1.2's gate, skipped by design until that step lands) |
| The lane's 5 test files | 47 of 47 pass |
| The bot, 128x15 seed 7: dev (a clean export of `50a6b29`) and lane (`aba092d`) | **both `residents [ 61124, 93804, 37971 ]`**. The two logs are identical apart from the ms/day timing columns. |

### Browser evidence (SwiftShader, function and visuals only)

**Setup:**
- City `vet_s7_y21` (304,650 residents), 1280x720, quality low, headless Chromium with the game's own audio graph
  running.
- Real clicks on the speed buttons and Send nearest. The fires come from `host.act('triggerDisaster')`.
- Targets came from a headless probe of the same save:
  - A: Shack (52,12), outside coverage, Send nearest 4.08 min, predicted lossless;
  - B: Villa (12,198), outside coverage, no unit can make it, predicted failed with 1 building lost.
- The page ran at **one frame per ~5.2-5.5 s** (median frame gap 5,473 ms on the default host, 5,188 ms on loopback;
  max 14 s). Every timing below is that slow page, not the game.
- Scripts: `t048work/qa/feel10.mjs` and `analyze.mjs`. The raw recordings are `t048work/qa/out/*-raw.json`. The
  summary is committed as `docs/dev/reports/local-T048/cloud-aggregate.json`.

| Acceptance | Default host (LocalSimHost) | Loopback |
|---|---|---|
| The player's dispatch saves the fire: exactly one "saved", no second chime | **"saved" once**. The restore toast ("Emergencies handled") is silent, and nothing chimes with it. | **"saved" once**; the restore toast is silent |
| The banner flashes green on the save | **no flash:** the banner had already closed (see the decisions) | **green flash**: `emg-saved` 11 ms after the sting, on "Fire under control" |
| A failed alert plays "lost"; red flash | **"lost" once**, and `emg-lost` on "No fire truck could reach it in time — 1 building lost" (border `rgb(255, 93, 93)`, the `--bad` glow) | **"lost" once**, and `emg-lost` with the same text |
| The vignette exactly while the LIVE pill shows | 78 pill frames: the vignette is visible in 70. The other 8 are the script forcing the layer off for the comparison shot. 89 frames without the pill: hidden in 87; the other 2 are the 0.5 s fade sampled at 5 s spacing. | 75 of 75 pill frames show the vignette. Without the pill it is hidden in 52 of 54; the other 2 are the fade. |
| The vignette's look | the ×20 difference of LIVE with and without the layer shows the red edge. Edge band mean ΔR +1.14, ΔG −1.20, ΔB −1.13 levels; centre −0.26/−0.26/−0.21 (scene motion). | during the urgent pause (no pill) the same difference is flat: edge −0.13/−0.14/−0.15 |
| The music bus is 6 ± 1 dB lower during LIVE (debug getter) | exactly **−6.00 dB** right after a renewal; most other pill frames read the duck released | the same |
| Errors | 0 page errors, 0 console errors | 0 and 0 |

**The duck reading on this page.** The LIVE duck is a 0.3 s hold renewed every 100 ms. Frames about 5 s apart starve
that renewal, so most pill frames read the duck partly or fully released:
- default host: −6.00 dB in 6 of 78 pill frames, 0 dB in 25;
- loopback: −6.00 dB in 3 of 75, 0 dB in 28.

This is the report's known limitation ("stalls longer than the 300 ms hold lift the duck briefly"), magnified 15
times. The desktop measured −6.00 dB in every LIVE segment on the real GPU, including injected 100-250 ms stalls.
Where the two readings exist together, the getter agrees with the `AudioParam` product within a render quantum while
music plays.

Images, all looked at. Committed, compressed, in `docs/dev/reports/local-T048/`:
- `cloud-default-live-on.jpg`: the LIVE pill after Send nearest, with the truck on its way;
- `cloud-default-vignette-diff-x20.jpg`: the red edge, ×20 around grey 128;
- `cloud-loopback-saved-outcome.jpg`: "Fire under control" on the saved banner;
- `cloud-loopback-lost-outcome.jpg`: "No fire truck could reach it in time — 1 building lost" under the saved one.

The full set is in the scratch dir, `t048work/qa/out/`:
- default host: A1, A1b, A2, A2c, A2d, A4, B1 and B2;
- loopback: A1, A1b, A2, A4 and B2;
- the two `*-diff-x20.png` images.

The desktop's evidence (`r2-ev1` to `r2-ev3`, `ev6`) shows the same states on the real GPU:
- the green border with the silent restore toast;
- the red border on a lost alert;
- the LIVE pill;
- the red-edged ×20 difference.

### Decisions

1. **NOTE-046 Q3 (the EmergencyBanner hunk in its own commit):** not split.
   - Splitting needs a rewrite of the lane's history, which this step does not do.
   - The hunk is small: +45/−5 lines, the restore toast's `silent` flag, the flash class, and `renderLive` reading the
     event's speed.
   - NOTE-049 orders FEEL-10 to merge first, and FH-08 (T036 step 5) rebases onto it, so the split's purpose (an
     easy second merge) holds either way.
2. **The LIVE duck's 0.3 s renewable hold:** kept as the lane tuned it.
   - On SwiftShader it lapses between ~5 s frames.
   - A longer hold trades robustness against stalls for a slower self-release if a release were ever missed. Every
     path calls `releaseDuck` today.
   - That tuning is the lead's call. Evidence: the desktop's −4.2 dB for under 100 ms after a 400 ms stall, and the
     frame counts above.
3. **The banner can close before a slow outcome (default host here), so the flash is missed.**
   - `src/worker/SimCore.ts:438-445` closes an alert 4 s of real time after its incident leaves the follow window.
     On this page the fire went out 43 s later. The sting and the "thanks to your dispatch" news still came.
   - On the real GPU the outcome lands 15-253 ms after the restore (the desktop: green flashes 9 of 9).
   - Not changed here: it is `src/worker` (NOTE-049: worker-host changes go to T061) and it depends on the
     environment. For the lead: T061 or FH-08 could keep a player-dispatched alert's banner until its outcome.
4. **The "good" / "bad" news chime 9-11 s after a sting (both hosts):** not a bug in the game.
   - The outcome news is posted in the same tick as the sting. GameSounds flushes news after 120 ms and drops it
     within 6 s (`NEWS_GAP`) of any event sound.
   - Here the 120 ms timer ran 9-11 s late (the ~5 s frames), past both windows.
   - A real second chime needs a main-thread stall of more than 6 s, so nothing is changed.
5. **The lane's requests** (reinforcement provenance, the loopback speedChanged order, the clock cap) are T061's by
   NOTE-049, not this lane's gaps. NOTE-048's earlier approval of a T048 provenance commit is superseded by NOTE-049.
6. **Dev moved on after the gates** (to `63c8f58`: T052 merged, plus NOTE-053 to NOTE-058). I did not merge it again.
   - Its code is render, assets and their tests only, and it shares no file with this lane.
   - `git merge-tree` of `cloud/t048` with it is clean.
   - The gates above hold for `aba092d`, and the merge step reruns them on the merged tree.
   - NOTE-057 orders T048 before T036s5 (EmergencyBanner.ts) and before T053 (GameSounds.ts).

### Remaining

- Nothing required.
- Optional, when a real GPU is available: re-read the −6 dB during LIVE with the new computed `debugMusicBusGain`,
  across a rest between songs. The desktop's −6.00 dB used the old getter. The new one is covered by the unit test
  and agrees with the old one while music plays.
