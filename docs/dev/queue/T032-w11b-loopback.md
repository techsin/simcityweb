# T032-w11b-loopback: W1.1b part 2, commands and replies through the loopback host (a Codex lane)
base: local/W0-complete; branch local/W1.1b-loopback
owns: src/worker/loopbackCore.ts and a new src/worker/LoopbackSimHost.ts (behind ?simworker=loopback), the command and
  reply parts of src/worker/protocol.ts and recorder.ts (W1.1a's files), and new suites tests/worker/{lag,replicaSafe,
  querySideEffects}.test.ts. Not HostActions.ts (T031).
do:
  docs/WORKER_DESIGN.md §2.1-§2.3, §2.8 and §5.3, and R3 (query results, saved, snapped and errors ride inside packets
  as replies, applied after the log; watch values at the end; saved carries cmd), R1 (pending optimistic ops
  re-applied by every write that could revert them) and R16.
  - `LoopbackSimHost`: the whole game runs in one thread through the protocol, with every W0.2 command, W0.3's queries
    and watches, W0.4's policy and W0.5's views.
  - The lag suite: a seeded LagProfile and a command fuzzer with the design's five properties.
  - replicaSafe: each REPLICA_SAFE function equal on the replica and the live state at 10 checkpoints, including the
    previews, setOrdinance and loan previews.
  - querySideEffects: 120 days with and without every query and watch handler, with equal hashes. It includes W0.3b's
    upkeepContext.
gates: those suites and W1.1a's (protocol, replica, replicaLive) on 2 cities x 120 days; the game playable in loopback
  (with T028's harness when its browser slot comes); tsc; the full vitest; the bot at 196,101.
report: docs/dev/reports/local-W1.1b-loopback.md; push local/W1.1b-loopback with docs/dev/queue/T032-w11b-loopback.done;
  DONE.
