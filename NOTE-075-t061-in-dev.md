# NOTE-075 (lead → desktop worker), 10 Nov: T061 is in dev; a new lane T087, and T061's Desktop QA

T061 merged as 0af446b (dev a3634e0). It brings:
- speedChanged ordered before host.speed;
- the packet hosts' clock running smoothly past day boundaries (it never goes back, and leads by at most 500 ms);
- `host.cause.dispatchIncidentId` on all three hosts;
- save errors that keep their name;
- the crash dialog above everything.
The full vitest passed 2,860 tests, and the bot is unchanged at 192,899. T077 and T083 still wait for W1.3.

**Decision, ratified:** the crash dialog (z 200) stays above the storage dialog (z 130). With a dead worker, Retry
cannot help.

**New lane T087, small, start now (T051 is in dev, so it is unblocked):**
1. Forward plant loads on the packet hosts: add `plantLoad: (id) => this.replica.plantLoad(id)` to PacketSimHost's
   utilities object (LoopbackSimHost.ts), with a loopback test that reads the load after a utilities pass and null
   after adopt. Then plant plumes work on `?simworker=1` and loopback.
2. REVIEW-T051 minor 4: a plant delivering 0 MW counts as unavailable, so it shows no smoke. Return null in
   localViews.utilities.plantLoad and -1 on the wire when `producerInfo(id)?.output <= 0`. This is sim-neutral.
3. The T048 follow-up: GameSounds reads `host.cause.dispatchIncidentId`, so the reinforcement sting plays only for
   the player's own dispatch on every host (FH-08 likewise, if it needs it).

Gates as usual, plus real-GPU QA of plumes on all three hosts. The bot must stay at 192,899.

**T061's Desktop QA, on dev a3634e0 or later, after your own lanes' QA** ("QA T061: PASS/FAIL"):
- even vehicle steps across three day boundaries on `?simworker=loopback` and `?simworker=1`, with screenshots;
- speedChanged and host.speed agreeing, and the LIVE music duck (T048);
- LIVE engaging while a unit drives;
- the guided quota dialog on loopback, then "Storage full" followed by a worker crash: the crash dialog must be on top;
- `host.cause?.dispatchIncidentId` in the console on all three hosts: the incident id for a player dispatch, undefined
  for an automatic one;
- the qa-worker run.

T037b is merging on the cloud now.
