# T032 — W1.1b part 2: commands and replies through the loopback host

## Review and gates (the local worker)

Branch `local/W1.1b-loopback`: the Codex lane's commit `fd6b92d` on the provisional W0-complete, then the final
`local/W0-complete` and dev `7826490` merged in. My review found 1 blocker, 4 majors (one of them an integration
decision), 7 minors and 2 nits. They are fixed in `998c6e5`, `a18754b` and the round's last commit, except two minors
that NOTE-041 gives to other lanes.

### What changed in the review

| # | Finding | Fix |
|---|---|---|
| 1 | **Blocker:** after the merge, tsc failed (W0.3b's `SimHost.commandCount`), and so did FH-07a's hygiene rule (a static import of CityActions) | `commandCount` counts every post, coalesced slider moves included. CityActions loads lazily in `start()`. |
| 2 | **Major:** a `dispatchOptions` watch kept the 200 ms cap after a dispatch command; LocalWatch bypasses it (EM-1) | ProtocolInbox keys the cap on the command epoch for `dispatchOptions`, as LocalWatch does. |
| 3 | **Major:** reads the replica could not answer as the worker does | `approvalBreakdown` leaves REPLICA_SAFE: its detail lines read the survey WeakMap (its terms and values still match). The recorder re-sends young plops (age < 30) daily, so T026's age-based refund previews match. The harness compares the utilities and traffic layers as last sent (below). |
| 4 | **Major:** `host.changes` counted the events in packets main received, so a resync that dropped packets left main.ts's dirty tracking off for good | Packets and Ready carry the worker's count, and main mirrors it. |
| 5 | **Major (integration):** two WorkerSimHosts, T032's and T034's | T032's stays; see the next section. |
| 6 | Minor: an IndexedDB write blocked the whole inbox, so every autosave and 30 s snapshot was a hitch, then a catch-up | The save copy, its `cmd` and its change count are taken in the unit. The writes are chained in request order, and each replies when it settles. A snapshot taken while a save is still being written deltas against that save, the base once it lands (recoveryIdb's stale check). |
| 7 | Minor: a resync rejected every pending read, including reads, saves and snapshots posted after it; a save posted then was written, yet the app said "Saving failed". It also rejected applied commands whose acks were lost, so `commitAction` played an error for an edit that happened | The Ready lists the request ids whose replies the resync dropped (`lost`); only those reject. Applied commands with lost acks reject with `CommandOutcomeLost`, so callers can skip failure feedback (T031's `commitAction` must). New `onResync(cmd)` hook for T033. |
| 8 | Minor: backpressure counted unacked packets, and acks ride on ticks, which stop with the tab hidden: the hidden path's save reply was held until the tab came back | Loopback counts the packets actually in flight. The real worker still needs acks outside ticks (on ping, for example): T034's. |
| 9 | Minor: `NewYear.holdDate` writes `sim.maxDaysPerFrame`, which the facade drops | NOTE-041: a `holdCalendar(on)` command, owned by T031, with T034's worker handler. |
| 10 | Minor: WorldView does not rebind on a resync | NOTE-041: T034's, tested through this loopback host with a forced resync. |
| 11 | Minor: an `atDay` mismatch was fatal (the host disposed), and a failed CityActions constructor failed every op, pause included | An `atDay` mismatch is a rejected command (`commandError`). The inbox uses stand-in FallbackActions, as LocalSimHost does, so every op still runs. |
| 12 | Minor: `options.onPacket` was unguarded | It is guarded and reported like the other observers. |
| 13 | Nit: the lag suite's quality | Two tautological asserts are gone. The fuzzer posts its command groups in a seeded order and subset, and its no-revert check covers the historic toggle and real dismissals too (the grown city dismisses two real alerts). F8's dev assertion (§2.4 step 7) is wired in PacketSimHost: after every packet, each field with a pending op must still hold that op's value. The suite fails on any report. |
| 14 | Nits | Errors cross as their message with the worker's stack (no "Error: Error: …"). `PacketWatch.error` returns one Error per failure. Frames posted before boot are dropped, not replayed. The unused AbortController is gone. `PROTOCOL_VERSION` stays 1, as §2.10's content-hash rule allows. |

The round also found a real query side effect in the sim. The grown city's later days depended on when the inspector
looked: `TrafficSystem.stopsNear` refreshed the stop attachments, and the traffic assignment then reused them
(querySideEffects, bisected). The query wrappers now pass `refresh = false`; the sim's own call keeps the refresh, so
the bot is unchanged. That hunk is in src/sim/infra/traffic.ts and transportFacilities.ts, outside T032's files.
SimCore and SimHost gained a clock option for LivePolicy, so the loopback's alert delays count in the host's clock.

### Major 5: which WorkerSimHost stays

T032's PacketSimHost (main side) and ProtocolInbox (worker side) stay. T034 rebuilds its WorkerSimHost and simWorker on
them. NOTE-040 left the choice to me. The reasons:
- T034's own task says so: the main side reuses T031/T032's host code, built against the same SimHost interface.
  T034's WorkerSimHost (532 lines) and simWorker (308 lines) are a second copy instead: their own R1 path, watch cache,
  save and snapshot handling, and message shapes (workerProtocol.ts).
- Two copies drift, and these already had. The dispatch cap bypass (major 2) was missing from T032's. T034's watch
  keeps one signature per watch, with no per-key cache, no inspector 1 Hz gate per key, no failure memo and no command
  epoch.
- The W1.1b suites run on T032's code: the lag fuzzer, replicaSafe, querySideEffects and the loopback host tests.
  With one implementation they also cover the worker path, and T034's hosts.test (Local, Loopback and Worker hashes)
  becomes a test of the transport alone.
- T034 keeps what is truly its own: the worker loop (rAF ticks; one day and one scheduler step per task; the explicit
  live flag, O7), boot progress with its 20 s timeout, hello and versioning, liveness on visible time, failing fast on
  `onerror` and `messageerror`, persistence 'main', and the protector test on the real worker.

For that, ProtocolInbox moved to its own worker-safe module, src/worker/protocolInbox.ts. A hygiene gate checks that
its import graph has no replica, loopback core, IndexedDB module or main-thread save module. Saves and snapshots are
written through an injected `InboxStore`: the loopback writes IndexedDB, and R14's persistence 'main' can return the
record for the page to store. SeededLag moved to src/worker/lag.ts. T034 also owns acks outside ticks (minor 8), the
worker side of a resync (main must say which replies it discarded, as `Ready.lost` does here), and, per NOTE-041,
`holdCalendar`'s worker handler and WorldView's resync wiring.

### The harness's view of the traffic layers

With the new backpressure and the new fuzzer, the lag suite's generated run failed: at the end, the replica's traffic
layer differed from the worker's in 7,000 cells, with no error and no resync.
- **Why the run changed course.** The lag model draws packet delays and unit stalls from one seeded stream. With the
  new backpressure the core flushes a different number of packets, so the stalls fall differently, and the same
  commands apply on different days (setSettings on day 2 instead of 3, for example). The simulation is deterministic
  given those days. I checked: the same commands from the same state, then the apply days, logged for both variants.
- **Why the check failed.** The traffic system writes `traffic` and `congestion` in one phase (PH_FINAL) and announces
  them in the next (PH_FINAL2), so a pass can be in flight when a run stops. That is F6: the replica rightly holds the
  last announced pass. The harness compared the live arrays. `delivered` now uses the traffic layers as last sent, as
  it already did for utilities.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Worker suites with the fixtures (both cities x 120 days: lag, replicaSafe, querySideEffects; protocol, replica, replicaLive; loopbackHost) | 19 files; 156 passed, 2 skipped (W1.2's simWorker graph gate, and the HostActions oracle until T031) |
| Full vitest (with the fixtures) | **184 files passed, 1 skipped; 1,860 tests passed, 8 skipped** |
| The bot (128x15, seed 7) | identical to `93069fa`, action log included: 196,101 in 2015 |
| Each new test against its fix reverted | all fail: majors 2 and 4 separately; minors 6, 7, 8, 11 and 12 and the error-text nit against `a18754b`'s host and core; the frames-before-boot nit separately |
| The game playable in loopback | waits for T031 (HostActions): the merged T031 + T032 build goes to T028's harness slot |

## The lane's summary (Codex, at `fd6b92d`)

Superseded where the review changed it: the resync rejection, ProtocolInbox's IndexedDB writes and its home,
backpressure, and the verification notes. The Codex sandbox could not run vitest; every suite above ran here.

Read the requested design sections and R1/R3/R16, the W1.1a/W0.6/W0.3b reports, and the worker sources/tests.
The T031/T033 interfaces were also inspected read-only in their sibling worktrees; their files were not copied
or edited. No simulation algorithm, LocalSimHost implementation, guard holder, save brand, or null view changed.

### Changes

| File | Change |
|---|---|
| `src/worker/LoopbackSimHost.ts` | New reusable `PacketSimHost`, `PacketWatch`, action-controller seam, and loopback transport adapter. Owns tickets/tags, R1 optimistic writes and rebasing, coalesced sliders/focus, gestures, queries, watches, policy, views, clock, packet replies, resync, persistence acknowledgements and disposal. |
| `src/worker/loopbackCore.ts` | Adds the FIFO `ProtocolInbox`, all 23 W0.2/W0.4 player commands, queries/watches, views, save/snapshot handlers, packet errors, backpressure, deterministic lag and drain helpers. Retains W1.1a's direct core harness. |
| `src/worker/protocol.ts` | A separated W1.1b reply block requires captured `cmd` watermarks for reads/errors/saves/watches; adds snapshot failure/null results and W0.6 acknowledgement metadata. Extends snapshot reasons to the existing host reasons. Boot/liveness types were not changed. |
| `src/worker/recorder.ts` | A separated W1.1b block queues stripped Acks in the log, replies/watches after the log, and pongs. City-signal teardown removes recorder listeners. Existing codecs, streams and rolling refresh remain in place. |
| `src/game/CityScene.ts` | Small out-of-owns integration hunk: import, host union, and constructor choice for `?simworker=loopback`. Local remains the default. The existing city signal, flags, persistence and scene lifecycle are passed through. |
| `src/worker/replicaSafe.ts` | Small new out-of-owns manifest required by design §1.3/§5.3; lists the 28 audited reads/previews and documents the layer-subscription prerequisite. |
| `tests/worker/lag.test.ts` | Seeded command rounds cover all player ops, held brushes, dependent map edits, sliders, historic changes, dismissals, loans, jitter, held Acks and virtual long units. Covers the five lag properties, with the HostActions oracle enabled when T031 is present. |
| `tests/worker/replicaSafe.test.ts` | Ten checkpoints over 120 days on generated 128² and grown cities; every manifest entry, random map previews, ordinance confirmation and loan previews; includes the empty-lot subscription counterexample below. |
| `tests/worker/querySideEffects.test.ts` | Keeps W0.3's local case and adds loopback generated/grown 120-day comparisons with and without every query/watch handler, every inspector section and W0.3b `upkeepContext`; compares daily save hashes and RNG states. |
| `tests/worker/loopbackHost.test.ts` | Eight focused cases: coalescing, async posting/tags/read ordering, keyed watches, clone/command errors, successful dispatch streams, FIFO saves/snapshots, unload-journal flushing, and resync/news/disposal. |
| `tests/worker/protocol.test.ts` | Round-trip coverage for watermarks, watch errors, snapshot failures and absent snapshots. |
| `tests/worker/replica.test.ts` | Adds the required watermarks to its existing synthetic watch/reply fixture. |

The protocol transport clones in both directions. A command is never applied inline during posting, so T031 can
register its reservation before its Ack replays. Authoritative events carry the command sequence; tags stay on
main. Ack replay releases the reservation/tag and settles the ticket. Query/save/snapshot/error replies and watch
values are consumed through Replica's existing end-of-log hooks, with a watermark assertion at delivery.

R1 uses the existing plain, building, policy, clock and adoption hooks. Historic changes are reapplied after both
event records and focus/rolling records; plain budget writes, policy dismissals and speed writes preserve newer
pending values. The lag suite checks listeners and packet completion, plus a synthetic packet exercising every
overwrite path. Watch caches are bounded and keyed by arguments; worker computation is capped at 5 Hz, with the
inspector's additional 1 Hz gate per key. Listeners use the supplied signal or the host's city disposal path.

News items are copied whole by recorder/replay. No field projection was introduced. The focused test passes an
item containing both `ref.advice` and `ref.reward` and checks equality and ownership, covering T035's optional ref.

### Lane handoff

**T031:** `LoopbackSimHost` discovers `HostActions.ts` through an optional eager Vite glob, or accepts
`options.actions(host)`. `post()` returns `{seq, done}`; the controller supplies predictions and pending map edits.
The structural seam includes `pending.rebase(cmd)`, `pending.ack(seq)`, overlay/claims/subscriptions, previews and
gestures. This branch alone has no tool predictor: accessing `actions`/`preview` without T031 fails explicitly.
Transport tests use `post()` directly. The false-refusal oracle test skips explicitly until T031 is merged.
Browser playability therefore needs the combined T031/T032 branch and T028's harness slot.

**T034:** reuse `PacketSimHost` and `PacketWatch` from `LoopbackSimHost.ts`; supply a real `Ready`, connect the
sender with `connect()`, and forward packets to `receive()`. With a real initial Ready its readiness promise is
settled; loopback alone passes `initialIsReady = false` for its provisional scene snapshot. The common class owns
the facade, tickets/tags, optimistic fields, controller hooks, keyed reads, views, policy, clock, resync and teardown.
`send`, `reply`, `fail`, `report` and `assertOpen` are protected seams. Worker boot/liveness/scheduling stay outside
this class. `ProtocolInbox` is also reusable with SimCore/recorder and an injected flush/clock/signal, but its
current persistence handlers perform IDB writes in the core; T034's main-persistence mode needs its own write
adapter. No real-worker entry or liveness/boot messages were added here.

**T033:** `options.recovery` exposes the existing synchronous `writeNow` path. It flushes buffered sliders before
writing. Hooks are `onPost(command)` (actual transmission, after slider coalescing), `onAck(seq, result)`,
`onSaving()` and `onReply(reply, packet)`. Wire these to the mirror's command/Ack/save/snapshot methods, supplying
captured `savedAt`/`cmd` and snapshot marker/payload. Failed commands carry `ok: false` plus `commandError` and reject
the ticket. The mirror is not constructed automatically in this branch; journal recovery acceptance needs T033
composition. The snapshot budget reserves W0.6's 128 KiB without importing localStorage code into the core; once
T033's constant moves into `recoveryCodec`, replace that literal with its shared constant.

### Design differences needing review

- `emptyZoneStatus` is not unconditionally replica-safe in this base: it reads all desirability variants and land
  value, which are subscribed-only layers. The test demonstrates disagreement before delivery and equality after
  delivery. The ten-checkpoint suite explicitly delivers those inputs. `QueryTool.ts` still calls it directly;
  this unowned caller needs a lead decision (query-backed status or explicit input subscription). No simulation
  state or unowned UI code was changed to hide the mismatch.
- Policy actions have no preview parameter in the base. The equality suite runs their real validation against a
  private budget/funds copy, with system access disabled; T031 owns the production preview implementation.
- This base has no `beginTick`/`nextUnit` or explicit live scheduler switch. Loopback preserves the existing
  `SimCore.frame` behavior; a virtual long unit delays transport work without sleeping or changing simulation dt.
  Future `atDay` scheduling and the four wire-only `debug.*` ops remain scheduler work: the inbox rejects them
  explicitly (an `atDay` command is accepted only at its current day boundary). The test harness retains
  `runDays`, `frame`, `advanceTransport` and `drain`.
- A resync snapshot cannot reconstruct lost command results. The host rejects already-applied outstanding
  tickets and outstanding reads, resets watch caches, and preserves newer commands/optimistic writes. This
  explicit rejection behavior fills a gap in §2.10; it should be reviewed with T034's crash/resync handling.
- W0.6 uses captured `changes`, `fp` and `recoveryDropped` in acknowledgements; those are carried alongside the
  design's `cmd`/`pktSeq`. Snapshot failure or no configured persistence also needs a packet outcome (`ok: false`,
  with or without an error), so promises cannot remain unresolved.
- CityScene still constructs synchronously from a loaded CityState. Loopback temporarily builds a branded
  provisional replica, then adopts core Ready and releases the input reference. Worker ready-first construction,
  full host selection, recovery boot and browser fallback belong to T034/integration.

### Verification

- **Passed:** `npx tsc --noEmit`; `git diff --check`.
- **Blocked before collection:** `npx vitest run tests/worker/protocol.test.ts --maxWorkers=1`. Vite's
  `externalize-deps` startup path (`windowsSafeRealPathSync` / `optimizeSafeRealPathSync`) fails with `spawn EPERM`.
  No Vitest assertion result is claimed. The same blocked runner was not repeatedly retried.
- **Left for the lead:** individual `lag`, `replicaSafe`, `querySideEffects`, `loopbackHost`, `protocol`, `replica`
  and `replicaLive` suites; then the full Vitest suite, old-save continuation, the 128×15 seed-7 bot at **196,101 in
  2015**, and browser checks for default local and `?simworker=loopback` after merging T031 (T028 harness).
- The default grown fixture `tools/bench/.fixtures/fixtures/bot256_s7_y60.metropolis` is absent here. Grown-city
  cases explicitly skip when unavailable; set `SIM_GROWN_FIXTURE` or `SIM_FIXTURES` on the gate machine. Both cities
  must actually run for the requested 2 × 120-day gate. The T031-dependent oracle must also run, not skip.
- No browser session, full-suite run, bot result, performance measurement, real-worker transport, or integrated
  RecoveryMirror behavior was verified in this sandbox.
