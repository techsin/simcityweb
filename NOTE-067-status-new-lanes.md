# NOTE-067 (lead → desktop worker), 10 Nov: status, and four more lanes for you

**First, send a status message now:**
- what is running;
- what is idle or waiting, and on what;
- how many Codex and QA slots are free.

The owner thinks you may be waiting on the lead. If you are idle, start the lanes below at once, without waiting for an
answer.

## New lanes, start now (same rules as NOTE-061: branch from dev, gate, real-GPU QA, DONE, then NOTE-064's review and merge)

1. **T078: FEEL-21, motion and flashing settings (absorbs FH-24).**
   - POLISH_PLAN §FEEL-21. Its wait is over: FEEL-01 is in dev (156e0bc).
   - The META part is the settings and their persistence. The WORLD part makes the effects obey: camera shake,
     lightning, fireworks, the ticker scroll, pulses and blinking.
   - The cloud's FH-12 lane (the title screen's "Start your first city") is in flight and touches the title-screen
     dialogs. Keep FEEL-21's settings UI out of those hunks where you can; whichever lane merges second resolves.
2. **T081: the release README and build notes (#29), docs only.** Draft README.md for the playable build:
   - what Metropolis is, how to run and build it, system requirements;
   - the controls and keys, and the main features (the region map, emergencies with manual dispatch, the soundtrack,
     New Year fireworks, cities past 1M);
   - the settings, including the worker opt-in `?simworker=1` until W1.4, and known limits.
   - Take facts from docs/ and the code, not from memory. Leave final numbers as TODO markers; the lead fills them at
     release.
3. **T082: an early release check on current dev, in a free GPU slot.**
   - `npm run build`, then the production preview on the real GPU: the title screen, a new city, a region, a load of a
     1M save, and emergencies with manual dispatch.
   - A 1-hour soak (tools/soak) of dense1m and of the small city, with the heap slope, days/s, errors and context
     losses.
   - Report what fails. It is an early warning before the final 4-hour soaks, not a gate.
4. **Queued for you, not started yet:**
   - **T079: S5, the frame budget** (WORKER_DESIGN's S5 row: `InfraScheduler.setFrameBudget`, the host-set
     `TRAFFIC_MIN_CYCLE_MS` = 300 ms in the worker, AC3/AC4/AC5 and bytes/s at that cadence). It needs B2 in dev; its
     timing is real-GPU work, which is why it moves to you.
   - **T080: W1.4, the worker on by default.** After S5, W1.3 and T061.
   - **FH-23** (text size and keyboard focus for tips). After the TopBar split.
   - The lead tells you when each is unblocked.

## A correction to NOTE-061 §1

The cloud lanes' `cloud/*` branches are not on origin, so you cannot QA them before they merge. QA each cloud lane
**on dev after it merges**, as you are doing for T057 and T060 FEEL-01, and report "QA <lane>: PASS/FAIL". A FAIL
becomes a fix lane.
