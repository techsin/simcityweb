# local-W1.2-worker — T034, the simulation worker side

## The rebuild on T032's code (the local worker)

Branch `local/W1.2-worker`, committed locally, not pushed, no `.done`. The Codex first pass (`784fe59`, below) and the
final W0-complete were already in. Merged in, in this order:
- dev `fc52893` (`45d7fe1`). The brief named `4953806`; dev had since gained T010's landmarks and two docs commits.
  Clean merge.
- `local/W1.1b-loopback` `aa60c0a` (`346f69d`). One conflict, hygiene.test: both gates kept, T032's worker-safe
  inbox graph and T034's simWorker graph, switched on.
- dev `e0d7f32` (`a4545b9`), at the coordinator's request mid-task: T031 (HostActions, `holdCalendar`), T036 step 1,
  T037c. One conflict, LoopbackSimHost.ts: T031's side throughout (HostActions loads lazily).

T032's review decided the question (major 5): its `PacketSimHost` and `ProtocolInbox` stay, and T034 is one
implementation on them. So the worker path now runs the code the lag, replicaSafe, querySideEffects and loopback
suites test, and hosts.test tests the transport.

### What was deleted, what stayed

| File | Now |
|---|---|
| `src/worker/WorkerSimHost.ts` (532 → 310 lines) | `WorkerSimHost extends PacketSimHost`: a real Ready (`initialIsReady = true`), `connect()` to the port, the worker's messages to `receive()`. **Deleted:** its own R1 path (the action facade, `predict()`, the optimistic writes), `RemoteWatch`, the request and reply bookkeeping, the per-packet epochs, the `settled` acks in Ready. **Kept and rebuilt (T034's own):** `bootWorkerSimHost` (init, hello and `PROTOCOL_VERSION`, boot phases to `onBoot`, 20 s of visible time between them), a `WorkerLink` (the port, the R11 watchdog, the page lifecycle resets, ping once per visible second, 10 s without a packet is a crash), fail-fast on `onerror` / `messageerror` / `fatal` (`HostCrashed`, `onCrash(error, duringBoot)`), persistence 'main', `loadWorkerSimHost` (reads the record, never deserializes it), the pre-spawned `browserSimWorker`, `runDays` for deterministic mode. HostActions and the optimistic CityActions load lazily while the worker boots, as T031's loopback loads them in `start()`. |
| `src/worker/simWorker.ts` (308 → 291) | Hosts SimCore, the ChangeRecorder and ProtocolInbox. **Deleted:** its own inbox, watch cache, error throttle, command and Ack bookkeeping, the persistence barrier, the `run` / `ran` messages. **Kept:** the loop (one frame-hook pass, one scheduler step or one day per task, a MessageChannel post to self between, FIFO commands at those boundaries, the speed re-read before every day), the O7 live flag, `installSimWorker` for the node adapter, the browser entry. **New:** `MainStore` (the `InboxStore` for persistence 'main'), explicit acks with an epoch, `Ready.lost`, `debug.runDays`, `maxDaysPerFrame` honoured per frame. |
| `src/worker/workerProtocol.ts` (95 → 74) | Only what M2W / W2M lack: init's W1.2 fields (`city: serialized`, `persistence: 'main'`, `regionName`, `deterministic`), `{t:'ack', ack, epoch}`, `{t:'stored', savedAt, ok}`, the port types, the timeouts and `WorkerLiveness`. Boot, hello, ready, packets, replies and ping are protocol.ts's. |
| `src/worker/LoopbackSimHost.ts` (T032's) | One seam: the save / snapshot branch of `reply()` became `protected settle(reply, wait)`, and `Settle` is exported. The loopback behaves as before. |
| `src/worker/protocolInbox.ts` (T032's) | One separated block: `acknowledge(seq, result)`, for a debug unit that spans several worker tasks. |
| `src/worker/recorder.ts` | The first pass's `append()` is gone: back to T032's file. |
| `src/sim/Simulation.ts`, `src/sim/infra/scheduler.ts`, `src/sim/infra/disasters.ts` | The first pass's hunks, unchanged (why each is needed: below). |
| `src/render/world/WorldView.ts`, `src/game/CityScene.ts`, `src/game/modules.ts` | NOTE-041's resync wiring (below). |
| tests | `hosts.test` and `workerTransport.test` rewritten on a shared `workerHarness.ts`; new `worldResync.test`; the protector child on `debug.runDays`; hygiene's W1.2 gate on, with the page's side excluded too. |
| `tools/bench/worker/` | `buildTests.mjs` bundles the worker in memory and loads it as a `data:` URL (no files; the first pass's leftover `.tmp` bundles failed protocol.test's S1 scan, which does not skip `.tmp`). **Deleted:** `hostChecks.ts`, `transportChecks.ts`, `runHosts.mjs`, `runHygiene.mjs`, `runProtector.mjs`: the Codex sandbox's plain-node stand-ins for vitest, which runs here. `nodeWorker.ts` and `nodePort.ts` stay. |

### Backpressure: acks outside ticks (T032 minor 8)

The worker stops flushing when `seq − ack > 4` and the recorder keeps merging. Acks still ride on ticks, and main now
also posts `{t:'ack'}`: at once after a packet with replies, before the worker's window fills (three packets applied
since the last ack) and with each ping. A hidden tab posts no ticks and no pings, so the window rule is what lets the
hidden path's snapshot and save reply; workerTransport's hidden-tab case fails without it (eight reads, then a save,
and no tick).

### Resync

Main posts `resync` when its replica diverges, and drops the packets that arrive until the new Ready. The worker keeps,
for each packet main has not acked, the request ids of the replies it carried; the Ready's `lost` lists those plus
the replies not yet flushed. PacketSimHost then rejects only those reads, settles the applied commands with
`CommandOutcomeLost`, and calls `onResync`, as with T032's loopback. Saves whose replies were lost leave the worker's
pending list, so its snapshots fall back to a base main has. The packet numbering restarts with each Ready, so a
tick posted before main adopted it acks the old numbering: the worker trusts tick acks only after main's
`{t:'ack', epoch}` for the new Ready (both sides count Readys; protocol.ts is unchanged). That is the one epoch left.

### Persistence 'main' (R14)

- **Saves.** `MainStore.putSave` hands the record over in the `saved` reply. WorkerSimHost's `settle` stores it with
  `kv.put` (not `putCityRecord`: main keeps no recovery base, §4.1), confirms with `stored {savedAt, ok}`, clears the
  recovery slot (IndexedDB here, localStorage through the base class), then resolves the SaveAck. A refused put
  rejects the save and the worker drops that copy.
- **Snapshots** are built in the worker against the newest save handed over (as ProtocolInbox's own pending base),
  or the last one main confirmed. Main stores each in IndexedDB in reply order, after the saves before it, and
  resolves `null` for a delta of a save it did not store. The last accepted payload stays in memory for
  `recovery.writeNow`, which writes it to localStorage at unload (§6 W1.2), and is dropped on the next save. No
  journal: up to 30 s of edits can be lost. This small mirror is what T033's RecoveryMirror replaces.
- The inbox runs on while a put is held (T032 minor 6): hosts.test holds a put, and a command posted behind it acks.

### The worker loop and the calendar hold

Ticks only add dt (coalesced, capped at 0.25 s) and acks. A frame is one task for `livePolicy.tick()`, `frameHooks`
and `beginFrame`, one task per scheduler step, then one task per day (`stepDay` reads the speed again each time).
Commands, reads and saves are FIFO at those boundaries; acks, pings, resync and dispose run at once. The loop reads
`sim.maxDaysPerFrame` for every frame: T031's `holdCalendar` sets it to 0 through `SimCore.applyCommand`, and the
worker holds the calendar while frame hooks run, then caps the backlog as `Simulation.update` does. `debug.runDays`
(§2.2's wire-only op; ProtocolInbox rejects debug ops) runs whole headless days with the live flag off, one per task,
as a FIFO barrier behind the frame in progress, and acks with the day reached.

### WorldView's resync wiring (NOTE-041 item 2)

A resync swaps in a fresh `CityState`, then emits `'reset'`, which WorldView already handled with `setState(this.state)`,
its own stale state. WorldView takes an optional `getState` (CityObjectsView's accessor, §2.10's `ctx.state`) and
rebuilds through `setState` as a load does; the camera is untouched. CityScene passes `() => this.sim.state`. I used
this rather than `onResync`: the `'reset'` already arrives at the right moment for every replica host, and `onResync`
stays free for T033's mirror. worldResync.test checks it through the loopback host with `host.harness.resync()`.

### The hunks outside T034's files, and why

- `Simulation.ts`: `frameHooks`, `accumulate`, `stepDay`, `capFrame`. The worker runs a frame as separate tasks; `update()`
  calls the first two itself, so LocalSimHost and the bot run the same code.
- `scheduler.ts`: O7's `live` field (one line in `framesActive`), and host-driven mode: `run()` became a generator that
  yields after each step, so `beginFrame` / `stepOnce` / `endFrame` give the worker one step per task without copying
  the urgent-first and least-served selection or the credit renormalisation; `run()` consumes it in one go, so
  headless runs are unchanged. Time between the worker's steps is not charged to the frame budget. **B2 also edits this
  file**: its merge must keep the yields inside the selection loops.
- `disasters.ts`: O7's `live` field in `daily()`.
- `WorldView.ts`, `CityScene.ts`, `modules.ts`: the `getState` option, one line each place.
- `LoopbackSimHost.ts`, `protocolInbox.ts`: the two seams above.

### Tests

- hosts.test: `120 scripted deterministic days give equal full-save hashes at days 30, 60 and 120` (Local, Loopback in
  design cadence, and the real worker; the replicas' exact digests too); `a save from one host loads in another and
  continues identically for 60 days` (Worker → Local and Worker, Local → Worker); `stores the worker's saves and
  snapshots on main, answers reads after their commands, and never saves the replica`; `a refused put keeps the
  worker's base; commands run on while a put is held, and a snapshot then deltas against it`.
- workerTransport.test, in-process: `runs one day per task, stops flushing past the ack window while the recorder
  merges, and answers ping`; `a frame is its hooks, one scheduler step per task, then one day per task; a pause posted
  in a day ends it`; `holdCalendar (maxDaysPerFrame 0) holds the calendar while frame hooks run; the cap then works as
  Simulation.update`; `a resync lists the replies main may have dropped, and ignores tick acks of the old numbering
  until main acks the new epoch`.
- workerTransport.test, real worker: `still replies with the tab hidden: no ticks, so main acks outside them`;
  `holdCalendar holds the real worker's calendar while its frames run, and the replica's clock with it (NOTE-041)`;
  `resyncs after a corrupted packet: only the dropped reads reject, the applied command settles as applied`; `a crash
  rejects outstanding tickets and reads with HostCrashed and takes the crash path`; `a fatal message from the worker
  after ready takes the crash path`; `R11: pings once per visible second, and 10 visible seconds without a packet are a
  crash`.
- workerTransport.test, boot and O7: `fails fast on a script error, messageerror, a version mismatch and a fatal
  message, and calls onCrash`; `reports boot phases, and times out after 20 visible seconds without one; the hello
  deadline waits for the script`; `counts visible, unfrozen time only (the watchdog)`; `an explicit live flag wins
  over the 750 ms inference, either way`.
- worldResync.test: `rebuilds from the fresh replica the host adopted, and keeps the camera`.
- protector.test (S1, unchanged names) on the production loop: the child runs 60 days through `debug.runDays`.
- hygiene.test: `W1.2: simWorker import graph excludes bundle.ts, save/index.ts and recoveryLs.ts`, now also no
  replica, loopback core, LoopbackSimHost, WorkerSimHost or SimHost in the worker.

GATES_PLACEHOLDER

### Plan-vs-code differences

1. **Acks outside ticks** (§2.1, §2.10 have them on ticks only): the W1.2 `ack` message, with the epoch of the Ready it
   follows. Needed for hidden tabs and for a resync's new numbering.
2. **The recovery base in persistence 'main'** (§4.2 has the worker call `setRecoveryBase` after its put): the worker
   deltas against the newest save handed over and falls back when main's `stored` reports a refused put; main drops
   a snapshot of a save it did not store. `stored` is a W1.2 message the design does not have.
3. **`debug.runDays`** runs in the worker scheduler as a FIFO barrier with an Ack (§2.2 lists it; ProtocolInbox
   rejects debug ops, as T032 left it). The other debug ops are still rejected. `host.sim.runDays` (the facade) still
   throws, as in T032's host; `WorkerSimHost.runDays(n)` is the promise of §2.9.
4. **The loop lives in simWorker**, not in `SimCore.beginTick` / `nextUnit` (§1.2, §3.1), as in the first pass.
5. **No `Packet.stats`**: nothing on main reads them yet.
6. **At a crash** the host writes recovery with why `'exit'`: `SnapshotWhy` has no `'crash'` (T033's mirror takes one).
7. **A save's record rides in its reply** and the recorder copies it once more (`copyOwned` in `recorder.reply`): a
   full serialized city per save on the worker, until W1.3 writes IndexedDB in the worker.
8. **The hello deadline** starts only once the caller supplies `scriptLoaded` (the prefetch), as in the first pass.
9. **FallbackWorldView and FallbackObjectsView** still rebuild from the state they were built with on a `'reset'`: the
   degraded views miss a resync (not wired here).
10. **A resync's lost save and a late `stored`:** if main applied a save's packet but its ack had not reached the worker,
    the worker counts that save as lost and ignores the late `stored`; its snapshots are refused until the next save.

### Left for the lead, and not verified here

- The full vitest suite and the browser checks (default local host, `?simworker=loopback`).
- **App wiring of the worker host**, outside this brief: `?simworker=1` selection, the CityScene built from the ready
  host, the boot fallback to LocalSimHost (`onCrash(…, true)`), the crash UI (`onCrash(…, false)`), pre-spawning
  `browserSimWorker()` on the region screen with `scriptLoaded` from its prefetch.
- Not verified, all browser-only: Vite's worker bundling of `new URL('./simWorker.ts')` and of the wasm URL, a script
  that fails to load, Page Lifecycle freeze / resume, real IndexedDB and the localStorage write at unload, the
  10-minute protector run, qa-worker without its journal check, latency and transfer volume.

## The Codex lane's first pass (`784fe59`)

Superseded where the rebuild above changed it: the duplicated host code, the message shapes, the persistence barrier,
the plain-node runners and the verification notes.

Base: `local/W0-complete` at `0fe14c23aad1840bf003569a9e6ce6246ef47c1c`.
Branch: `local/W1.2-worker`. Changes are **uncommitted**. No queue `.done` file was written, and nothing was pushed.

The worker side and a standalone `SimHost` adapter are implemented. The plain-node checks pass, including actual
`worker_threads` parity and the S1 protector on the production loop. TypeScript passes. App selection, loading-screen
integration, region-screen prefetch and automatic local fallback still need the lead's integration with T031/T032.
The game continues to construct its existing local host.

## Implementation and file ownership

| File | Change |
|---|---|
| `src/worker/simWorker.ts` | Browser worker entry and injectable parentPort boundary; boots serialized input through SimCore, systems and CityActions; owns the recorder, authoritative commands, queries/watches, saves and snapshot encoding. MessageChannel yields separate frame hooks, infrastructure steps and days. Ticks coalesce with a 250 ms cap; each day rechecks speed. |
| `src/worker/WorkerSimHost.ts` | Implements the current SimHost interface over a branded Replica. Supplies command tickets/causes/gestures, preview compatibility, keyed reads/watches, overlay and stream views, main-side persistence, liveness and disposal. `loadWorkerSimHost` reads a CityRecord without deserializing it first. `browserSimWorker` can be pre-spawned and buffers hello/errors until a city attaches. |
| `src/worker/workerProtocol.ts` | W1.2 transport envelope, serialized/main-only init, epoch-qualified acknowledgements, boot/error messages, ping/pong types, persistence confirmation and deterministic run requests. Owns the visible-time watchdog. The existing protocol's command/reply declarations are untouched. |
| `src/sim/Simulation.ts` | Small additional seam outside the narrow owns: `frameHooks`, `accumulate`, `stepDay`, `capFrame`. Local `update` retains its original loop and speed sampling, using the two extracted operations. |
| `src/sim/infra/scheduler.ts` | O7 is the marked nullable `live` field and `framesActive` expression. A separate necessary unit-scheduling hunk adds `hostDriven`, `beginFrame`, `stepOnce`, `endFrame`, and yields in the existing selection algorithm. Local/headless `run` consumes the same iterator synchronously. Time between worker tasks is excluded from the frame budget. |
| `src/sim/infra/disasters.ts` | O7 only: nullable `live` field and one daily-mode expression. Undefined preserves the 750 ms inference used by direct Simulation callers and the bot. |
| `src/worker/recorder.ts` | Necessary shared seam: two-line public `append(Entry)` block. It allows an Ack to occupy its actual position in the recorder's log without reading private buffers. Replace/fold this into T032's command recorder API when merging. |
| `tests/worker/hosts.test.ts` | Four host/persistence tests using the real worker bundle. |
| `tests/worker/workerTransport.test.ts` | Five scheduling, pressure, resync, crash, boot, watchdog and O7 tests. |
| `tests/worker/hygiene.test.ts` | Enables the simWorker import-graph gate and includes src/worker and tools/bench/worker in the detaching-API scan. Generated `.tmp` bundles are excluded. |
| `tests/perf/protectorChild.ts` | Replaces S1's direct `advanceDay` loop and synthetic array replies with `installSimWorker`, init/run messages, recorder packets and acknowledgements. Both isolates still probe independently; both negative controls remain. |
| `tests/perf/protectorResult.ts` | Requires 60 ordered recorded days and nonzero packet volume instead of the obsolete fixed size of two synthetic arrays per day. Other protector/memory gates are retained. |
| `tools/bench/worker/buildTests.mjs`, `buildTests.d.mts` | Rolldown worker bundle using the existing sim.plugins.mjs pattern; unique output names avoid parallel-test collisions. Explicit-module transformation supports bundling LocalSimHost outside Vite. |
| `tools/bench/worker/nodeWorker.ts`, `nodePort.ts` | Signal-bound parentPort/Worker adapters; the worker adapter registers the same test catalog as main. |
| `tools/bench/worker/hostChecks.ts` | Shared host parity, cross-host save/load, snapshot and failed/delayed-store assertions. |
| `tools/bench/worker/transportChecks.ts` | Shared transport assertions, including microtask sentinels proving separate day/step tasks and a deliberately corrupted packet on the real worker path. |
| `tools/bench/worker/runHosts.mjs` | Runs those same assertions in plain node when Vite cannot start. |
| `tools/bench/worker/runHygiene.mjs` | Runs the actual S1 scanner and both import-graph checks without Vite's config loader. |
| `tools/bench/worker/runProtector.mjs` | Fresh-process runner for the bundled S1 child, with the V8 flags supplied on the node command line. |
| `docs/dev/reports/local-W1.2-worker.md` | This report. |

The additional Simulation, scheduler and recorder seams are needed because this base has neither the split frame
API nor command insertion in its recorder. They are marked separately. **B2 merge attention:** retain B2's task
behavior when applying the scheduler iterator extraction; the urgent limit, least-served selection, estimated costs,
credit renormalization and headless carry calculation here retain the base algorithm.
There are no edits to SimHost.ts, SimCore.ts, protocol.ts, main.ts, CityScene or Vite configuration.

## Ordering, recovery and lifetime

Commands are applied FIFO between units. Their Ack entries follow their effects; query, watch, error and persistence
results are delivered after packet replay. Backpressure stops recorder flushes at `seq - ack > 4`, retaining the
ordered log and replies for the next packet. Explicit acknowledgements let paused/deterministic hosts drain without
inventing rAF time. Epochs prevent an acknowledgement from before resync from acknowledging a new packet sequence.
Resync returns fresh state plus unacknowledged command results and replays outstanding replies, so a lost packet
does not strand tickets. Pending optimistic fields are rebased before reset listeners run.

The worker accepts only `CitySource.kind = 'serialized'`, `persistence = 'main'`, and no journal. Main writes a worker
save copy and confirms its commit before the worker adopts that recovery base. This is a FIFO persistence barrier:
later reads/writes/snapshots wait for the put. A failed put releases the barrier and retains the preceding base.
Cleanup errors after a committed put are reported without pretending the city put failed. Save metadata describes
the captured copy, including command and change counters and the packet sequence.

The worker builds recovery bytes against its confirmed base. Main starts storing them in IDB in reply order and
retains the encoded payload for synchronous localStorage writes through `recovery.writeNow`. Successful saves drop
the preceding payload. Periodic requests use min(30 seconds, 90 simulated days) while dirty. This is the W1.2 snapshot
strategy, with no recording or replay of a journal; progress after the latest snapshot can still be lost.

Worker listeners and guards terminate with the worker's AbortController. Main transport/lifecycle/watch/policy
listeners are tied to the host controller and the supplied city signal. Disposal uses `abort('dispose')`, rejects
outstanding work, releases registrations, leaves retained views empty and awaits worker termination. Main's new
simulation compatibility object cannot advance or replace the replica.

## Tests and checked gates

Vitest was attempted with `npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1`. It failed **before collection**:
Vite's `externalize-deps` Windows `optimizeSafeRealPathSync` probe calls `spawn` and receives `EPERM`. No Vitest pass
is claimed. The standalone runners execute the shared assertions and production worker code without that loader.

`node tools/bench/worker/runHosts.mjs`: **all nine checks pass**, corresponding to these test names:

- `120 scripted deterministic days have equal full hashes at 30, 60 and 120`
- `save in one host, load in another, and continue for 60 days`
- `orders command causes, queries, main saves and worker snapshots; refuses replica saves`
- `failed and delayed main puts preserve the recovery base and FIFO save watermark`
- `R11: visible-time liveness, ping cadence and boot progress deadlines`
- `yields between days and steps, honors pause, merges under backpressure and answers ping`
- `the real worker resync settles a lost ack; exit rejects outstanding tickets and queries`
- `fails fast on script error, messageerror and version mismatch`
- `O7: explicit live mode survives a stale frame timestamp`

The parity fixture is a seeded 32² city with test-catalog buildings, roads and zones. Checkpoints compare SHA-256 of
the **full authoritative serialized cities**, normalizing only the serialization timestamp, and compare replica
digests separately. The script includes roads, zoning/dezoning, trees, tax, funding, loans, pause/resume, a tornado,
historic state and camera. Cross-host saves exercise both directions with actual host saves and full hashes after
60 additional days. The Loopback arm is the base's LoopbackCore, since T032's LoopbackSimHost is not on this branch.

`node tools/bench/worker/runHygiene.mjs`: **pass**. The only detach/grow hits are S1's existing negative controls.
Both SimCore and simWorker graphs exclude bundle.ts, save/index.ts and recoveryLs.ts.

S1 was built with `node tools/bench/worker/buildTests.mjs --protector`, then each arm was run in a fresh process:

```
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs js
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs wasm
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs js transfer
node --allow-natives-syntax --trace-protector-invalidation tools/bench/worker/runProtector.mjs wasm grow
```

Both positive arms completed 60 days on the 128² stress city with both isolates intact and no invalidation trace.
WASM blur was active, with memory fixed at **67,108,864 bytes** and zero loader grows. The transfer control invalidated
only the worker. The grow control invalidated the worker and increased its memory by **65,536 bytes**. Both produced
the expected ArrayBufferDetaching trace; main remained intact. These controls exercise the production worker loop.

`npx tsc --noEmit` and `git diff --check`: **pass**.

## Design differences and integration work

1. **T031/T032 are absent from this base.** WorkerSimHost contains a compact temporary action/prediction facade,
   keyed watch cache and optimistic-rebase hooks. Fold these into HostActions and the loopback main-side code when
   both land; the `actions` factory is an injection seam, not a claim that their complete pending/gesture UX has been
   integrated. Fold the worker's Ack/reply bookkeeping and recorder.append into T032's recorder API as well.
2. **T033 is absent.** The small encoded-snapshot mirror in WorkerSimHost should fold into RecoveryMirror in
   snapshot-only mode. It never creates a journal. Main retains no authoritative recovery-base CityState.
3. **The existing interface still exposes Simulation.** The worker supplies a read/view compatibility object and a
   promise-returning runDays at runtime, with an explicit typed WorkerSimHost.runDays API. Narrow this along with
   T032's shared facade. The transport run request waits for an active frame to finish before entering deterministic
   mode; regular commands still interleave between live units.
4. **LivePolicy is already deferred by the base's EM-1 microtask behavior**, rather than synchronously mutating speed
   in the uncovered listener as the older design prose says. This lane preserves it. The post between day units
   lets that microtask run before the next day's speed check.
5. **Unit orchestration lives in simWorker**, not new SimCore.beginTick/nextUnit methods. All authoritative commands,
   reads, policy, region boot and guarded systems still use the existing SimCore. The small Simulation/scheduler APIs
   provide the required yields without copying the scheduler selection algorithm into the worker.
6. **App wiring is deliberately left for integration.** Construct a scene after ready, use onBoot for progress and
   onCrash for local boot fallback / the later crash UI, pre-spawn browserSimWorker on the region screen, and supply
   scriptLoaded after prefetch to start the hello deadline. Until a caller supplies that completed-prefetch promise,
   no download time is charged to the hello deadline. Boot-progress and running deadlines apply after hello.
7. **Test bundles use the existing ignored tools/bench/worker/.tmp directory.** The checkout's node_modules is a
   junction outside this writable worktree, so the design's proposed node_modules/.cache output was not used.

## Gates left for the lead / not verified here

- The actual Vitest invocations (hosts, transport, protector, hygiene), the existing suites and full Vitest run.
- The **128 × 15, seed-7 bot = 196,101 in 2015**. The default algorithm and inference path were preserved, but the bot
  was not run here and parity between hosts is not a replacement for that baseline check.
- Browser worker boot, script-load failures, Page Lifecycle freeze/resume for 15 seconds, UI tools and fallback,
  save/reload/old-save continuation, kill-tab recovery, the 10-minute protector run and qa-worker without its journal
  check, after main-side integration. The node error/watchdog assertions do not substitute for those browser gates.
- Production worker chunk/download size, per-isolate memory, aggregate protocol cost, action p50/p95/p99 latency and
  FPS measurements. The node correctness bundles are not production browser size or latency measurements.

The worker-side changes are ready for review and integration; this report does not claim that the complete W1.2
browser feature or its release gates have landed.
