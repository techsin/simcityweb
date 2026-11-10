# T087: plant loads on the packet hosts, 0 MW plants show no smoke, the reinforcement sting, and the F8 record of a speed command

Task: docs/dev/queue/T087-plantload-hosts.md (NOTE-075), plus item 4 from NOTE-077 (X1), added during the lane.
Branch `local/T087-plantload-hosts`, worktree `simcityweb-T087`, base dev `a3634e0` plus the task commit `ac4ee7b`.

**Status: implemented, uncommitted.** tsc is clean, the focused tests pass, the 128x15 seed-7 bot is identical. The
full vitest (with the fixtures) and the real-GPU checks on the three hosts are left for the lead.

Two things to read first:
- **Item 4 (X1) does not occur on this base.** T061 item 1 (`0af446b`) removed its cause; the note describes the file
  before T061. The requested hunk is in, with two deliberate differences from the note's wording. See "Item 4" below.
- **"T048's workaround (it read the event's value)" can be read two ways.** I removed the incident-record read at the
  dispatched event, which the new read replaces. I left the speedChanged event-value read alone. See difference 3.

## Changes per file

No hunk in `src/sim/**` (so none in `src/sim/infra/*`), `src/save/**`, `src/main.ts` or the protocol. No new RNG draw,
no new systemData key, no protocol version change.

| file | hunk | item |
|---|---|---|
| `src/worker/LoopbackSimHost.ts` (assigned, NOTE-075) | `PacketSimHost.utilities` gains `plantLoad: (id) => this.replica.plantLoad(id)` (line 273). WorkerSimHost inherits it. | 1 |
| `src/worker/LoopbackSimHost.ts` (assigned, NOTE-077) | `PacketSimHost.optimism` (lines 355-366): a speed command's F8 record is the value the command writes, set before the write. The other fields keep the read after the write. | 4 |
| `src/worker/SimHost.ts` (assigned) | `localViews().utilities.plantLoad` (lines 582-587) returns null when `producerInfo(id)?.output <= 0`. | 2 |
| `src/worker/SimHost.ts` | Comment only, on `UtilitiesView.plantLoad?` (lines 221-222): "Optional until T061 adds packet-host forwarding" was no longer true. The member stays optional (difference 4). | 1 |
| `src/worker/recorder.ts` (assigned) | `utilitiesStream` (lines 351-354) sends -1 for a plant whose `producerInfo(id)?.output <= 0`. | 2 |
| `src/game/GameSounds.ts` | `onEmergency` (lines 355-358): a dispatched event marks the player's response when `host.cause?.dispatchIncidentId === e.id`. It replaces `host?.cause && inc?.answered === 2` there. | 3 |

Notes on the hunks:
- **`producerInfo?.()` is an optional call** in both places. tests/worker/plantLoadStream.test.ts uses a stand-in
  utilities system that reports loads only. A system with no output breakdown keeps its load. advisors.ts:1378 guards
  `producerInfo` the same way.
- **`src/ui/EmergencyBanner.ts` is not edited.** FH-08 does not need the read (difference 6).

## Item 1: plant loads on the packet hosts

- The loopback and the worker host now read T051's loads from the replica's map. The reader keeps nothing of its own.
- CityScene's caller (`CityScene.ts:544`) already guards with `'plantLoad' in u`, so it needed no edit.
- On the real worker (worker_threads) the first Ready carries the loads: the test below reads the same value on the
  local, loopback and worker hosts.

## Item 2: a plant that delivers 0 MW is unavailable

- The sim gives such a plant a valid load of 0 (`utilities.ts` powerSums: "a plant delivering nothing ... has load
  0"). FEEL-15's floor `max(0.25, load)` then drew a quarter plume whenever another plant kept it powered.
- The local view returns null and the wire carries -1, so BuildingRenderer's activity is 0 and the plume step is 0.
- **NOTE-054's stream conditions hold.** A shutdown or a restart publishes once (any valid load is at least 1 away
  from -1). A plant that stays shut down publishes nothing, whatever load the sim keeps for it. The 0.005 threshold
  against the last published snapshot is unchanged for plants that produce. A change of output with the same load is
  not a change of the stream.
- **Which plants this covers in the code as it is** (`prepareUses`): a nuclear plant under the Nuclear Free Zone; a
  burnt, abandoned or unfinished plant (the renderer already drew none for those); an incinerator whose burn share is
  0. Not a thermal plant without cooling water (difference 1).
- **When the plume goes.** Local host: at the plant's next activity refresh (the monthly scan, or a buildingChanged).
  Packet hosts: after the completed pass's stream, then the same refresh. This is T051's cadence, unchanged.

## Item 3: the reinforcement sting

- `GameSounds.onEmergency` marks an incident as the player's when its dispatched event carries the cause of a
  `dispatch` or `dispatchBest` command for that incident. A reinforcement of an incident the city answered by itself
  (`answered` stays 1) now earns "saved", or "lost" with losses, on every host.
- **Kept:** `inc?.answered === 2` at the terminal event (line 361) and in `emergencyStingPending`. The new read does not
  replace it there: a first response from before a load or a resync has no cause on this page. With that read dropped,
  14 existing emergencyOutcomes tests fail (mutation M3c).
- **Removed:** the `answered === 2` test at the dispatched event. It is redundant with the terminal read for first
  responses, and it is what kept reinforcements out.
- **One existing test now checks less.** emergencyOutcomes' "clears saved feedback, cached incidents and dispatch
  provenance when the host resets" still passes, but its fixture's cause names no incident, so it no longer puts
  anything in the set. The new "forgets the reinforcement when the host resets" covers that. I did not edit the
  existing file.

## Item 4 (NOTE-077, X1): the F8 record of a speed command

**Finding: X1 does not occur on this base. T061 item 1 (`0af446b`) removed its cause.**
- The note's line numbers (340-344, 360-366) are the file's before T061: at `d8ac140`, `optimism` is at 341-345 and
  `assertPending` at 360-366.
- **The cause.** Before T061, `WorkerSimHost` answered `get speed()` with the packet's clock speed while a packet was
  applied (T034b's `packetSpeed`). That is T034b's F1: the getter shadowed a speed command posted inside the packet.
  - A pause posted inside a packet at ultra wrote 0, and the page kept reading 3 until the packet's end.
  - F8's record took that read for the value the pause wrote: 3. So F8 missed the shadowing in that packet.
  - At the next packet nothing shadowed any more. The speed read 0, and F8 reported "speed read 0 before ack N, which
    wrote 3": the wrong value, one packet late.
- **Reproduced here.** A test-only host with that getter gives exactly this on the old record: nothing in the first
  packet, X1's text at the second (`scratch/probe-x1-old-record.json`).
- **On this base no host shadows `speed`**, so a read after the write is the value the command wrote. With the hunk
  reverted (mutation M4), every "a speed command sent while a packet is applied raises no F8" case still passes, on
  crafted packets (X1's own sequence among them) and on the real loopback and worker hosts. A scratch probe of seven
  more sequences on the unchanged base raised no F8 either (`scratch/probe-f8.test.ts.txt`).

**What the hunk does.** F8's record of a speed command no longer depends on a read of `host.speed`.
- **A host that shadows `speed` is now reported truthfully.** With the same test-only host and the new record, F8
  reports "speed read 3 before ack 1, which wrote 0" in the packet where the pause is shadowed, and nothing at the
  next one (`scratch/probe-x1-with-hunk.json`). That is a real mismatch, the one T061 fixed. A test pins it.
- **Nested speed commands keep the right record.** On this base one read after the write is still not the command's
  own value: when a listener of the write's optimistic `speedChanged` posts a newer speed command. The old code stored
  the newer command's value under the older command's seq, and dropped the record at the older command's ack, so the
  newer command, still pending, was no longer guarded. Now each speed command records its own value under its own
  seq, before its write, and the newest pending command holds the record.
- `setSpeed` records `clamp(args[0] | 0, 0..3)`. `resume` carries no value; it records `pausedFrom`, which is what it
  writes.
- **No behaviour changes in a release build.** F8 runs in dev builds only (`import.meta.env.DEV`).

**Two things I did differently from the note's wording, and why.**
- **The record is set before the write, not after.** Recording the carried value after the write raises a false F8 in
  the nested case, with X1's own text: "F8: speed read 0 before ack 1, which wrote 3" (mutation M4b).
- **Only the speed field records the carried value.** For tax, funding and the historic flag the command does not
  carry what is written: CityActions rounds a tax to 0.1, clamps funding to 0..150 and refuses a plopped building's
  historic flag. Recording the carried value there raises false F8s (mutation M4c: "tax:0 read 9.6 ... which wrote
  9.57", "funding:fire read 150 ... which wrote 400", "historic:1 read false ... which wrote true").

**Not changed, on purpose:** F8 still compares the public `speed` getter, not the private mirror. The getter is what
the page reads, so a host that shadows it is exactly what F8 should catch. Comparing the mirror would hide that.

## Tests (5 new files, 46 tests, all pass)

**tests/worker/plantLoadHost.test.ts** (3)
- LoopbackSimHost: reads null until the core's Ready, then the loads of each completed utilities pass.
- LoopbackSimHost: reads null after an adopt, until the Ready's own snapshot or the next stream names the plant.
- The loopback and the worker host read the local host's loads from their first Ready (real UtilitiesSystem, real
  worker; a burnt plant reads null on all three).

**tests/worker/plantLoadZeroOutput.test.ts** (13)
- Local view: null for a nuclear plant the Nuclear Free Zone shut down, and its load again after the repeal.
- Local view: null for a burnt plant and for one under construction, on a grid another plant powers.
- Local view: a thermal plant without cooling water keeps its load (output halves; it is not a 0 MW plant).
- Local view: the load decides when the system reports no output breakdown.
- Local view: outputs 0 and -5 read null; 0.001 and NaN read the load (4 cases).
- Stream: -1 on ready and resync, a valid 0 for an idle plant that produces, the load without a breakdown.
- Stream: a shutdown and a restart publish once each, and nothing while the plant stays shut down.
- Stream: NOTE-054's strict 0.005 threshold against the last published snapshot still holds.
- Stream: no utilities snapshot during a whole unchanged month of completed passes with a stopped plant.
- Stream: the real utilities system's shutdown by ordinance reaches the replica after its pass.

**tests/render/smokeZeroOutput.test.ts** (3; CityScene's real caller, CityObjectsView, BuildingRenderer, Effects)
- Local host: the shut-down nuclear plant goes from the idle floor (activity 0.25, step 1) to activity 0 and plume
  step 0, still powered and fully staffed. Control: read as the sim's raw load, the same plant steams again.
- Local host: the repealed ordinance brings the plume back in a later month.
- Loopback host: the forwarded load draws the plume (item 1), and the stream's -1 after the shutdown removes it.

**tests/game/emergencyReinforcement.test.ts** (16)
- Scripted host (8): saved for a reinforcement; lost with a death, a lost building or a failure; quiet without a
  reinforcement; a dispatch that names another incident, or a command that names none, does not count; only the
  dispatched event marks; `answered === 2` still read for a first response with no cause on this page; a reset
  forgets the reinforcement; the restore toast stays silent while a reinforced incident of the episode is worked on.
- Local host and loopback host (4 each, real emergency system): a `dispatch` added to the city's own answer earns
  "saved" though `answered` stays 1; `dispatchBest` for the ambulance the city could not send counts the same way; the
  same call left to the city alone ends without a sting; a dispatch command that fails marks nothing.

**tests/worker/f8Speed.test.ts** (11)
- Crafted packets: X1's sequence (an error's pause inside a packet at ultra) raises no F8, in that packet or before
  its ack; a handler's setSpeed(3) inside the authority's own pause raises none; a pause and its resume, both pending
  across packets, raise none; a newer speed command posted from the optimistic speedChanged keeps the record and stays
  guarded after the older one's ack.
- A real mismatch still raises F8: a pending speed command the host no longer re-applies ("speed read 3 before ack 1,
  which wrote 0"); a pending resume ("speed read 0 before ack 2, which wrote 3", a true one); a host whose `speed`
  getter shadows a pending pause during a packet (X1's cause, as a test-only subclass), reported in that packet with
  what the pause wrote; a tax that no longer holds a pending setTax's value.
- A rounded tax, a clamped funding and a refused historic flag raise no F8.
- Loopback host and real worker host: a speed command a handler sends inside the authority's own pause raises no F8.

### Each fix reverted (scratch/mutate.mjs; logs scratch/mut-*.log)

| mutation | new tests that fail |
|---|---|
| M1: no `plantLoad` on PacketSimHost | 3 of 3 plantLoadHost, the loopback smokeZeroOutput case |
| M2a: no 0 MW rule in the local view | 4 plantLoadZeroOutput, 2 smokeZeroOutput (local), the three-hosts case |
| M2b: no 0 MW rule in the recorder | 5 plantLoadZeroOutput (stream), the loopback smokeZeroOutput case, the three-hosts case |
| M3: T048's read at the dispatched event | 7 emergencyReinforcement (scripted, local and loopback) |
| M3b: any command's cause counts | 1 emergencyReinforcement, and the existing "command-triggered automatic response" case |
| M3c: no `answered === 2` at the terminal event | 1 emergencyReinforcement, and 14 existing emergencyOutcomes cases |
| M4: the old F8 record | 2 f8Speed: the nested case and the shadowing-getter case. The "no F8" cases on this base's hosts pass either way. |
| M4b: the carried value, recorded after the write | 1 f8Speed: a false "speed read 0 before ack 1, which wrote 3" |
| M4c: the carried value for every field | 1 f8Speed: false F8s for tax, funding and historic |

## Gates checked here

All vitest and bot commands ran through the quiet gate, one process at a time, `--maxWorkers=1`. Logs are in the
lane's scratch folder.

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean (also clean on the untouched base) |
| the 5 new files | 46 passed |
| plantLoadStream, plantLoadLocal, the new plant-load files, `tests/render/smoke*.test.ts` (5 files) | 9 files, 83 passed |
| `tests/game/emergency*.test.ts` (8 files) | 171 passed |
| hygiene, gameSounds, milestoneSounds, uiSoundsRetention, audio/emergencyStings, audio/emergencyDuckHold | 6 files, 66 passed |
| lag, f8Speed, workerSpeed, dispatchCause | 4 files, 27 passed, 1 skipped (lag's grown-fixture case) |
| loopbackHost, packetClock, holdCalendar, hosts, views, viewSources | 6 files, 30 passed |
| replica, replicaLive, replicaSafe, protocol, emergencyTeachingHost, emergencyTeachingWorker, emergencyReads, localSimHost, policy, commands, hostActions, pendingEdits, worldResync, saveErrorName | 14 files, 106 passed, 4 skipped (fixture cases) |
| the bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` | `residents [ 61124, 93804, 37971 ]` = 192,899 in 2015, identical (`scratch/simbot-128-y15-s7.log`). The bot imports only `src/sim` and `src/core`, which this lane does not touch. |
| `git diff --check`; files UTF-8 without a BOM, LF | clean |

In total 47 test files, 483 tests passed, 5 skipped. The 5 skips need the grown fixtures (`SIM_FIXTURES`), which this
worktree does not have.

**Left for the lead:** the full vitest with the fixtures; the bot again if wanted (same command, expect 192,899); the
real-GPU QA below. No Hard run, 256-tile run or two-process hash was needed: nothing in `src/sim` changed.

## Plan against code

1. **A thermal plant without cooling water is not a 0 MW plant.** The task names it as an example. In the code its
   output halves (`THERMAL_UNWATERED = 0.5`, params.ts:420; the catalog says "output halves without it"). It keeps
   its plume by load. A test pins this.
2. **"Null after adopt" is true only for plants the Ready does not name.** A resync's Ready carries the full
   snapshot, and the replica applies it inside the adopt. So after a real resync the reader shows the Ready's loads at
   once (including drift that was under the threshold), and null for a plant that is gone. It reads null for every
   plant before the core's first Ready, and after a Ready without the stream, until the next published stream. The
   test covers all three.
3. **"Remove T048's workaround (it read the event's value)".** In NOTE-048 and NOTE-049 that phrase names the
   speedChanged workaround: `GameSounds.ts:152` (`syncLive(speed)`) and `EmergencyBanner.ts:619`
   (`renderLive(policy, speed)`) read the event's speed.
   - The `dispatchIncidentId` read does not replace that, so I left both lines. tests/game/emergencyLive.test.ts
     ("uses speedChanged before the worker speed mirror updates") also pins them, and that file is a gate.
   - What the new read does replace is the `answered === 2` test at the dispatched event. That is what I removed.
   - If you do want the speed workaround gone now that T061 item 1 is in: change the two lines to re-read
     `host.speed`, and update that emergencyLive case. One behaviour differs: while a newer speed command of the
     page's is pending, `host.speed` is the page's value and the event carries the authority's. Change both files
     together, or the duck and the vignette can disagree in that window.
4. **`UtilitiesView.plantLoad?` is still optional.** T061's report says the marker can go. Making it required needs
   `CityScene.ts:544` simplified and tests/render/smokeLocalHost.test.ts's third case changed (it deletes the member,
   which no longer compiles on a required one). Its comment "Packet hosts have this water-only view until T061 adds
   forwarding" (line 136) is now out of date. I did not edit either file.
5. **Item 4's premise** (above): the note describes the file before T061.
6. **FH-08 does not need the read.** Its lessons attach to waiting, alerted incidents and end when the incident stops
   waiting or is acknowledged. E3 asks whether anyone answered (`answered > 0`), not who. The restore toast already
   reads GameSounds' set through `emergencyStingPending`. FEEL-09's Follow (T047, not in this base) is the consumer
   that may want it for the player's reinforcement units.
7. **The reinforcement's mark lives on the page.** A resync's reset or a save and load drops it, so a reinforced
   automatic incident that ends after one stays silent. A first response keeps `answered === 2` in the incident. The
   existing reset test requires the set to clear.
8. **LIVE does not follow a reinforcement.** `followingDispatch` (emergencyPolicy.ts:213, worker side) still keys on
   `answered === 2`. Not asked, and it would be a policy change.
9. **An incinerator that burns nothing shows no smoke** (burn share 0 gives 0 MW). This follows from the rule as
   written. Worth a look in the QA.

## Requests for cloud-held files

None. The worker hunks were assigned (NOTE-075, NOTE-077). Optional follow-ups, for your decision:
- make `UtilitiesView.plantLoad` required (difference 4);
- remove the speedChanged event-value reads (difference 3).

## Not verified here

- No browser and no GPU: plumes on the three hosts, the sting's sound, and dev-build error cards are unseen.
- The full vitest, and the 5 fixture-dependent cases skipped above.
- A utilities pass on the real worker after boot (the worker test reads the first Ready only; passes and resyncs are
  tested on the loopback, which shares the recorder and the page-side host class).
- X1 on a real build from before T061. I did not check one out: the cause is read from `d8ac140`'s source and
  reproduced with a test-only host that has the same getter.

## Browser checklist (real GPU; default host, `?simworker=loopback`, `?simworker=1`)

`const h = window.__metropolis.city.host` in each console.

1. **Plant plumes on the packet hosts (item 1).** Load small_s7_y10 (coal #5092, gas #656) on all three hosts.
   - `[...h.state.buildings.values()].filter(b => /coal|gas|oil|nuclear|incinerator/.test(b.def)).map(b => [b.id, b.def, h.utilities.plantLoad(b.id)])`
     lists a number for each producing plant on every host. Before this lane the packet hosts had no reader.
   - Coal and gas show a plume on loopback and on the worker, at the same step as on the default host. T051's QA
     numbers for the city as loaded: coal load 0.398, step 2, 18 particles.
   - With two coal and two gas plants added to the grid: load about 0.15, step 1, 10 particles against 36 at full load.
2. **A 0 MW plant (item 2).** vet_s7_y43 has two nuclear plants beside coal and gas. Enact Nuclear Free Zone.
   - After the next utilities pass and month change: no steam over either nuclear plant, on all three hosts, while
     they still show as powered and staffed. `h.utilities.plantLoad(id)` is null for both.
   - The coal and gas plumes rise a step if their load does.
   - Repeal it: the steam is back within a month.
   - A thermal plant cut off from water still smokes, at its load (difference 1).
   - An incinerator with no garbage to burn shows no smoke (difference 9).
3. **The stream stays quiet (NOTE-054).** On both packet hosts, with T051's QA harness: months with no load change
   send no utilities stream; the ordinance sends one after its pass; while the plants stay shut down, none.
4. **Resync.** Force one on each packet host (the replica's resync request): plumes as before, none over the shut-down
   plants, no stale plume for a bulldozed plant.
5. **The reinforcement sting (item 3).** T061's Desktop QA item 6 city: a road with a fire station beside a home and a
   second one about 30 cells along.
   - Paste `h.events.on('emergency', e => e.type === 'dispatched' && console.log(e.id, h.cause?.dispatchIncidentId))`.
   - Start a fire on the home. The near station answers by itself (logs `id undefined`). Leave it to the city: when
     the fire is out, no sting.
   - Start another. With the Dispatch tool send a truck from the far station (logs `id id`, the same number twice).
     When the fire is out without losses: exactly one "saved" sting, on all three hosts. Before this lane it was
     silent. (If Send nearest answers "Help is already on the way", the city has sent all the fire needs: pick the
     far station yourself.)
   - The first-response flow is unchanged: an uncovered fire, Send nearest, one "saved", a silent restore toast.
6. **F8 (item 4), dev build (`npm run dev`), both packet hosts.**
   - At ultra, paste `const off = h.events.on('day', () => { off(); h.setSpeed(0, 'error'); })`. The city pauses
     and no "F8: speed read ..." card appears.
   - At ultra, open and close the pause menu quickly (Esc, Esc), several times: no F8 card.
   - Any error card raised during play at ultra pauses the city without a following F8 card.
