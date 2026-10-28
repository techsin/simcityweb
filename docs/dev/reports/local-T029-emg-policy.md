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
| Browser: slow-downs per 10 real minutes before and after, on dense1m and bot256 at ultra | QA_RESULT |
