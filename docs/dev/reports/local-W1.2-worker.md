# local-W1.2-worker — T034, the simulation worker side

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
