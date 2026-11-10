# T077-newyear-liveyear: New Year batching from the host's `liveYear` (WORKER_DESIGN §3.6; NOTE-065 item 2, NOTE-078)
base: dev 8c08b6a or later (W1.3 and T061 are in dev); branch local/T077-newyear-liveyear
owns: the `Clock`'s `live` flag and its path to the page: src/worker/protocol.ts, src/worker/recorder.ts,
  src/worker/replica.ts, the hosts (SimHost's interface, the local host, LoopbackSimHost/PacketSimHost,
  WorkerSimHost), and src/game/NewYear.ts' onYear; new tests. The lead assigned these worker-file hunks (NOTE-065,
  NOTE-078); keep each minimal, optional on the wire, and apart from other code.
do:
  docs/WORKER_DESIGN.md §3.6 (read it in full; "The fix" is near line 748). Nothing implements it yet.
  - The `Clock` carries `live`, true when the day came from a frame-paced tick (not from a batch catch-up).
  - The host exposes `liveYear`; the replica sets it from the `live` flag of the packet being replayed; the local host
    sets it from its own tick.
  - `NewYear.onYear` uses `batch = !host.liveYear` instead of the frame-gap heuristic
    (`frames === 0 || day - lastFrameDay > 8`). The show's behaviour on the local host must not change in any case
    the existing NewYear tests cover.
  - The field is optional in packets and absent from saves; an old packet without it reads as the heuristic did
    (say which default you chose and why).
notes:
  - T075 (my camera lane, not in dev) edits NewYear.ts for the spotlight's show hooks, and T078 (motion settings, not
    in dev) for reduced motion: keep your NewYear.ts hunk to onYear's batch line and its inputs.
  - T083 (running now, not in dev) edits WorkerSimHost.ts' storeSnapshot and the worker's storage paths; T087 edits
    LoopbackSimHost.ts' utilities object and the F8 check: stay out of those functions.
gates:
  - tsc; tests/worker/hygiene.test.ts; a replica test where the batch flag matches local play (the same days played
    locally, through loopback and through the recorded packet stream give the same batch decisions at every year
    end, including a catch-up after a hidden tab and an ultra-speed year end); the existing NewYear and replica
    tests; all through quietrun; the bot unchanged at 192,899.
  - I run the full vitest, the bot and the real-GPU checks (the New Year show at 1x and ultra on the three hosts);
    end with the browser checklist.
report: docs/dev/reports/local-T077-newyear-liveyear.md.
