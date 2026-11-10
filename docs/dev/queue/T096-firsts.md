# T096-firsts: the FEEL-07 producer: the city records its firsts, saved, and announces each once (NOTE-081, NOTE-083)
base: dev (current head: B2 is in; the bot reference is residents [ 61828, 95515, 40772 ] = 198,115);
  branch local/T096-firsts
owns: a new small sim module for the firsts (for example src/sim/economy/firsts.ts) and its registration; the
  `systemData.firsts` record (optional, saved); the event or news `ref.first` it emits; the worker mirroring of that
  record and event (the SYSTEM_KEYS list and the recorder's streams, minimal hunks); new tests.
why: T075 (my camera lane, not in dev yet; branch local/T075-camera, worktree
  C:\Users\techsin\Desktop\projects\simcityweb-T075, read-only for you) built FEEL-07's spotlight camera, which shows
  the city's firsts. Its real-GPU QA could not test "once per kind across save/load", because nothing records
  `systemData.firsts` or emits `ref.first`: the spotlight was triggered by a scripted news item. T075's report
  (docs/dev/reports/local-T075-camera.md in that worktree) has the exact request to the sim owner: read it first, with
  docs/POLISH_PLAN.md FEEL-07 (the list of firsts: the stage milestones, the first of each landmark kind, the
  neighbour connection, and whatever else the plan names) and src/game/ShowCamera.ts in that worktree (what it listens
  for, the payload it needs: the kind, the place, the building id).
do:
  - Record each kind of first when it happens for the first time in a city: `systemData.firsts` holds, per kind, the
    day and the place (and the building id where there is one). Saved with the city; optional, so an old save loads
    and simply has no firsts recorded. For an old or grown city that already passed a first before this lane (it has
    a stage-6 building already), decide and say: mark such kinds as already had at load, silently, so a mature save
    does not replay a string of spotlights.
  - Emit `ref.first` (on the news item or as its own event, whichever T075's request and the ticker's `ref`
    convention fit: check how news items carry `ref` today and how the camera lane reads it) exactly once per kind,
    in the month or day it happens, never again after a save and load, a resync or a recovery.
  - Mirror both through the worker hosts: the record through the replica's system keys, the event through the
    recorder, so `?simworker=loopback` and `?simworker=1` behave as the local host does. Minimal hunks in the worker
    files, optional on the wire; W1.3's journal and T057's continuity records must keep holding (a loaded city
    continues bit-exact: say whether `firsts` belongs in a continuity record or is ordinary systemData, and why).
  - No sim RNG draw; the detection reads existing state. The bot and the digests of runs must stay unchanged except
    for the new record itself: the 128x15 s7 bot reads residents [ 61828, 95515, 40772 ] = 198,115 with every annual
    row equal; if the exact digest walks systemData, say what changes in it and prove nothing else does (the
    two-process probe pattern in scratchpad lanes\T054b\scratch\digests.mts shows how).
notes:
  - T093 (my lane, not in dev) changes rewards.ts' init so a load no longer unlocks rewards silently; T070 and T071
    (not in dev) add honours and landmarks to rewards.ts and the catalog. Detect landmark firsts from buildings
    placed, not from the rewards record, so you do not depend on those lanes; keep out of rewards.ts.
  - T075 will consume this after both are in dev: write in the report the three lines T075 must change to listen to
    the real `ref.first` instead of its scripted trigger.
gates:
  - tsc; your tests, tests/save/loadContinuity.test.ts, tests/sim/exact/*, the replica and recorder tests and
    tests/worker/hygiene.test.ts through quietrun; the bot identical (198,115).
  - I run the full vitest and the bot; the browser check comes with T075's recheck.
report: docs/dev/reports/local-T096-firsts.md.
