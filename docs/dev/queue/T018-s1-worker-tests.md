# T018-s1-worker-tests: the protector and hygiene test suites (docs/WORKER_DESIGN.md S1 = WASM_PLAN J1)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/S1-worker-tests
after: none (new test files only); a Codex lane at below-normal priority, no timing runs needed
owns: new files only: tests/perf/protector.test.ts, tests/worker/hygiene.test.ts and any helper under tests/perf/ or
  tests/worker/ (plus a vitest config entry only if the child-process test needs one)
do:
  Why: S1 is the first step of the Worker plan and needs nothing else. W0.1-W1.4 extend these suites step by step.
  Read docs/WORKER_DESIGN.md §1.5 (isolate hygiene), the two rows for these files in the test table (around line
  921), the S1 row (around line 960), and R10 in the revision table (around line 1139).
  1. protector.test.ts:
     - spawn a child `node --allow-natives-syntax --trace-protector-invalidation` (V8 flags are process-wide);
     - the child runs 60 days of the Simulation plus postMessage of results in a worker_threads worker, once with JS
       kernels and once with SIM_WASM=wasm (blur);
     - every isolate runs its own protector probe (makeProbe as in tools/bench/baselines/pi1Day.ts) and reports it.
       Both must stay intact, and the wasm memory.buffer.byteLength must not change;
     - a trace line also fails the test.
     - Negative controls: one transfer in the worker, and one memory.grow, must each make it fail.
     - SimCore and the recorder do not exist yet: use the Simulation now and leave a short note where W0.1 / W1.1
       swap them in.
  2. hygiene.test.ts:
     - a static scan, at first of src/sim/** and src/save/{serialize,db,recovery}.ts, plus tests/perf/**: no transfer
       lists, no .transfer(, no Compression/DecompressionStream, no .stream(, no new Response(, no Blob, no
       .arrayBuffer()/.text() on bodies, no memory.grow outside the loader;
     - write the later rules too, but each one skipped, with the step that switches it on named:
       - the speed and liveSlowdown writers, and emergencyOf( / getSystem( in src/ui and src/game (W0.2 / W0.3);
       - writes into the replica outside src/worker (W0.6);
       - the import-graph rules for SimCore.ts (W0.6) and simWorker.ts (W1.2).
gates: both suites green on the tree; each negative control fails as it should (show it); npx tsc --noEmit clean;
  npx vitest run passes.
report: docs/dev/reports/local-S1-worker-tests.md; push local/S1-worker-tests with docs/dev/queue/T018-s1-worker-tests.done; DONE.
