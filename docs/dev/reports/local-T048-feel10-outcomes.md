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
