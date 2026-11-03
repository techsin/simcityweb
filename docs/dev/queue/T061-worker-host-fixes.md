# T061-worker-host-fixes: loopback and worker host bugs found by the desktop's round-2 lanes (cloud lane)
base: dev, after T034 (W1.2) has merged; runs beside W1.3 (T039)
owns: src/worker/LoopbackSimHost.ts, src/worker/WorkerSimHost.ts, src/worker/SimHost.ts (the Cause type), src/worker/replica.ts,
  src/game/WorldView.ts (the resync path only), and their tests
do:
  1. **speedChanged order** (T048's QA): LoopbackSimHost.ts:180 re-emits `speedChanged` before it updates its own speed
     mirror. A handler that re-reads host.speed sees the old value. After an urgent pause, the LIVE duck never engages
     and the banner shows LIVE one tick late. Update the mirror first. Check WorkerSimHost for the same order. Add a
     test where a handler re-reads host.speed inside the event.
  2. **The clock cap at day boundaries** (T047's QA): LoopbackSimHost.ts:398-401 caps the extrapolated clock at
     day + 0.999 until the next day's packet arrives. At LIVE, every emergency vehicle stops and then leaps about 4.7 m
     at each sim-day boundary (5-9 px steps every 1.5 s). The local host is steady.
     - Extrapolate past the day end and blend in the next packet, or interpolate between packets. The clock must stay
       monotonic and never run ahead of the authority by more than one packet interval.
     - Do the same in WorkerSimHost if it shares the code.
     - Test: a vehicle's position steps evenly across 3 day boundaries on the loopback host, within 1.5× the median
       per-frame step.
  3. **Reinforcement provenance** (T048's request a): add an optional `Cause.dispatchIncidentId` through SimHost,
     LoopbackSimHost and the replica, so units the player sends to an incident that was already answered automatically
     count as the player's. FEEL-10's stings and FH-08's teaching read it. Test it on the Local and packet hosts.
  4. **The resync rebuild** (NOTE-041 item 2; R1's writer audit): WorldView.ts:388 rebuilds from its OLD state object
     after a loopback resync. Rebuild from the new one, with a test that resyncs and checks the view reads the new
     state.
gates:
  - each item's test, plus tsc, the full vitest and the worker hygiene test;
  - the bot identical to dev (residents [ 61124, 93804, 37971 ]);
  - qa-worker in loopback mode: emergency vehicles move evenly across day boundaries at LIVE (screenshots at three
    successive boundaries), and a pause at LIVE engages the duck on the same tick.
report: docs/dev/reports/cloud-T061-worker-host-fixes.md; done marker docs/dev/queue/T061-worker-host-fixes.done
