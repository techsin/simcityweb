# T087-plantload-hosts: plant loads on the packet hosts, 0 MW plants show no smoke, the reinforcement sting reads the dispatch's incident id (NOTE-075)
base: dev a3634e0 or later (T051 and T061 are in dev); branch local/T087-plantload-hosts
owns: src/worker/LoopbackSimHost.ts (PacketSimHost's utilities object, one line plus its test); the local views'
  utilities.plantLoad and src/worker/recorder.ts' utilities stream (the 0 MW rule); src/game/GameSounds.ts (the
  reinforcement sting's read); src/ui/EmergencyBanner.ts only if FH-08 needs the same read; new tests. The lead
  assigned these worker-file hunks in NOTE-075; keep each minimal.
do:
  1. Forward plant loads on the packet hosts: add `plantLoad: (id) => this.replica.plantLoad(id)` to PacketSimHost's
     utilities object (src/worker/LoopbackSimHost.ts), with a loopback test that reads the load after a utilities
     pass and null after adopt. Then plant plumes work on `?simworker=1` and on loopback (T051's FEEL-15 reads
     UtilitiesView.plantLoad; the replica already holds the loads).
  2. REVIEW-T051 minor 4: a plant delivering 0 MW counts as unavailable, so it shows no smoke (a nuclear plant shut
     down by ordinance, a thermal plant with no cooling water). Return null in localViews.utilities.plantLoad and -1
     on the wire (recorder's utilities stream) when `UtilitiesSystem.producerInfo(id)?.output <= 0`. Sim-neutral:
     nothing in src/sim changes, the bot stays identical. Tests: the local view, the stream (and that the >0.5 %
     change threshold of NOTE-054 still holds, see tests/worker/plantLoadStream.test.ts), and BuildingRenderer's
     activity for such a plant (step 0).
  3. The T048 follow-up: GameSounds reads `host.cause.dispatchIncidentId` (T061 put it on all three hosts), so the
     reinforcement sting plays only for the player's own dispatch on every host; FH-08's code likewise if it needs
     it. Remove T048's workaround (it read the event's value) only where the new read fully replaces it. Tests on the
     local host and on loopback.
gates:
  - tsc; your new tests plus tests/worker/plantLoadStream.test.ts, tests/render/smoke*.test.ts,
    tests/game/emergency*.test.ts, tests/worker/hygiene.test.ts and the GameSounds tests, through quietrun; the bot
    identical (192,899).
  - I run the full vitest, the bot, and the real-GPU QA of plumes on all three hosts; end with the browser checklist.
report: docs/dev/reports/local-T087-plantload-hosts.md.
