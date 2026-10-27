# local-W1.1b-loopback — commands and replies through the loopback host (T032)

Branch `local/W1.1b-loopback`, base `0fe14c2` (`local/W0-complete`). Changes are uncommitted. No push or queue
`.done` file was made, as requested. TypeScript and whitespace checks pass. Runtime acceptance is pending:
Vitest fails before collecting tests with `spawn EPERM` in this sandbox.

Read the requested design sections and R1/R3/R16, the W1.1a/W0.6/W0.3b reports, and the worker sources/tests.
The T031/T033 interfaces were also inspected read-only in their sibling worktrees; their files were not copied
or edited. No simulation algorithm, LocalSimHost implementation, guard holder, save brand, or null view changed.

## Changes

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

## Lane handoff

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

## Design differences needing review

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

## Verification

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
