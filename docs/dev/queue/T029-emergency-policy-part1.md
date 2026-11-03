# T029-emergency-policy-part1: big-city emergencies, part 1: in range never slows; the cooldown (a Codex lane)
base: local/W0.3-5-integration @ 93069fa (W0.4's LivePolicy is in it); branch local/T029-emg-policy
after: none for the code. Rebase onto W0.3b before its gates: W0.3b converts EmergencyBanner's reads, which this also
  touches.
owns: src/game/emergencyPolicy.ts, LivePolicy's hunks in src/worker/SimCore.ts, src/ui/EmergencyBanner.ts (policy and
  display only; keep its data reads as W0.3b leaves them), src/ui/panels/EmergenciesPanel.ts (the "waiting for a unit"
  row), src/ui/guide/copy.ts (the two texts named below), and tests (tests/game/emergencyPolicy.test.ts,
  tests/worker/policy.test.ts).
do:
  The owner approved this design on Oct 27. It is in docs/dev/STATUS.md, "Uncovered emergencies in big cities"; read it
  in full. Part 1 is the policy only. The sim part comes later as part 2, after B2 merges: mutual aid for in-range
  majors, station load, and coverage that counts for less on an overstretched station.
  - **A site inside a station's range never slows the game**, even when every unit there is out. These are the
    incidents whose uncovered reason is 'busy'.
    - No banner, no live speed, no pause.
    - They stay in the Emergencies panel as "waiting for a unit", with a Send button, so the player can still send
      one by hand.
    - Their failures still cost approval as today, and the existing news line still posts.
  - **A site outside every station's range** ('outOfRange', 'noStation') keeps today's behaviour: a banner, live speed
    when a unit can still make it in time, and a pause when time is very short.
  - **The cooldown:** after a slow-down or pause ends, the game stays at the player's speed for 30 real seconds before
    the next one (one constant). Alerts in that window get a banner only. It runs in LivePolicy on real time, so a
    paused game does not use it up.
  - **Texts:** reword the guide's E2 text and its phase E text (src/ui/guide/copy.ts), which describe today's live
    slow-down for every uncovered emergency. Say it plainly: emergencies inside a station's range never slow the game,
    and those outside every range slow it down so you can send help.
gates:
  - Policy tests: an in-range busy major at ultra changes neither speed nor liveSlowdown; an out-of-range one does, as
    today; a second out-of-range alert within 30 s of the end of a slow-down gets a banner only, and one after 30 s
    slows the game; the urgent pause still works out of range.
  - The headless bot is unaffected (196,101), because the policy is not part of the sim.
  - Browser, real GPU, real input, on dense1m and bot256 at ultra: slow-downs counted per 10 real minutes before and
    after. Today's data has 2-3 uncovered fires in 240 game days, all out of range.
  - The S1 rules still pass; npx tsc --noEmit clean; npx vitest run passes.
report: docs/dev/reports/local-T029-emg-policy.md; push local/T029-emg-policy with
  docs/dev/queue/T029-emergency-policy-part1.done; DONE. Priority: below W0.6 and W0.3b.
