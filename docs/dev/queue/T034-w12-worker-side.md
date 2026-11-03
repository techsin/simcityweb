# T034-w12-worker-side: W1.2's worker side, the simulation in a real Web Worker (a Codex lane)
base: local/W0-complete; branch local/W1.2-worker
owns: new src/worker/simWorker.ts and src/worker/WorkerSimHost.ts, tests/worker/hosts.test.ts, the worker test bundle
  under tools/bench/worker/, and the explicit live flag (O7) as one small, separate hunk in
  src/sim/infra/scheduler.ts and disasters.ts. B2 (cloud) also edits scheduler.ts, so keep that hunk minimal.
do:
  docs/WORKER_DESIGN.md §6 row W1.2 (line 969), §3.1 (the worker loop: rAF ticks, one day and one scheduler step per
  task with a post to self between, as WASM_PLAN finding 8 asks), §2.10 (versioning, sequencing, backpressure,
  liveness, errors), R11 (liveness on visible time only, ping and pong, boot progress with a 20 s timeout, fail fast on
  onerror, messageerror or a script error) and R14 (W1.2 runs with CitySource 'serialized' and persistence 'main';
  worker snapshots are stored by main; no journal yet).
  It uses W1.1a's protocol, recorder and replica. The main side reuses T031/T032's host code when they land: build
  WorkerSimHost against the same SimHost interface, and wire it last.
gates: hosts.test (Local vs Loopback vs Worker under node worker_threads: 120 deterministic days with a scripted command
  list give equal hashes at days 30, 60 and 120; save in one host, load in another, 60 more days equal); S1's protector
  test on the real worker path; tsc; the full vitest; the bot at 196,101.
report: docs/dev/reports/local-W1.2-worker.md; push local/W1.2-worker with docs/dev/queue/T034-w12-worker-side.done; DONE.
