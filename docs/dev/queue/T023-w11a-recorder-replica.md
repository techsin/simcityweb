# T023-w11a-recorder-replica: Worker plan W1.1, part a (the protocol, recorder and replica core), alongside W0.2-W0.6
base: the dev branch right after I merge W0.1 (I will name the commit); branch local/W1.1a-replica
after: W0.1 merged. Do not start before I say so: the recorder hooks into W0.1's SimCore. Then run it as Codex lanes
  next to W0.2-W0.6, below them in priority.
owns: new files only, under src/worker/ (protocol.ts, recorder.ts, replica.ts, and the loopback core in a file of its
  own, e.g. loopbackCore.ts) and tests/worker/ (protocol, replica, replicaLive), plus a node bench under
  tools/bench/worker/. No edit to SimCore.ts, SimHost.ts, LocalSimHost or any file W0.2-W0.6 own. If the recorder needs
  a hook in SimCore, write it as a small, separate patch in the report, and I fold it into the next W0 step.
do:
  Why: W1.1 is the largest single step on the critical path (9-12 days in docs/WORKER_DESIGN.md §6, line 968). Most of
  it is the worker-side core, which needs only SimCore and the design text, not the main-thread work of W0.2-W0.6.
  Building it now, while W0 runs, takes several days off the path to the finish.
  Split W1.1:
  - **W1.1a (this task):**
    - protocol.ts: the M2W, W2M and Reply types and codecs (§2.1-§2.3, §2.5-§2.7);
    - recorder.ts: the event log with the fidelity rules (§2.4, F1-F7), building records with the rolling shadow (R2),
      event-time incident records (R8), owned buffers (R9), the road-cell-only traffic encoding (R15), layer groups
      and streams (§2.6, §2.7);
    - replica.ts: applying packets, the isolating emitter, and the fresh-state adopt (R12); the R1 re-application
      hooks as an interface for later;
    - a loopback core that runs SimCore + recorder + replica in one thread at design and live cadence, without
      commands (W0.2 has not landed yet).
  - **W1.1b (later, after W0.6):**
    - on main: HostActions predictions, host.pending and its overlay (R5), gesture-routed corrections (R4), pending
      ghosts (O1), the RecoveryMirror;
    - the commands in the loopback host;
    - query replies in packets (R3) once W0.3's queries exist;
    - lag.test, replicaSafe.test and querySideEffects.test;
    - the browser QA in loopback and AC1.
  Read docs/WORKER_DESIGN.md §1-§2 and §5.3 in full first, and the revision table (R1-R16, O1-O13).
gates:
  - tests/worker/protocol.test.ts as §5.3 describes it: every message survives structuredClone; every typed array owns
    its buffer; every codec round-trips, including NaN optional fields, defs appends and the off exception list; byte
    counts use clone semantics.
  - tests/worker/replica.test.ts, without commands for now: the loopback core on a generated 128² city and a grown
    fixture, at design cadence for 120 days. After every packet, the primary layers, the building exact fields, the
    mirrored layers and the plain data are exactly equal. At checkpoints, after a forced full rolling round, the pop
    and jobs of every building are equal.
  - tests/worker/replicaLive.test.ts, without commands for now: live cadence, synthetic ticks with dt jitter
    (8-33 ms), at ultra and at 1×, with a tornado and fires active.
  - The node bench: protocol cost ≤ 0.5 ms per sim day at ultra on dense1m and bot256-1.4M (A/A-normalised, no-op
    listeners), timed on a quiet machine.
  - S1's hygiene and protector suites still pass (their rules for src/worker apply to these files);
    npx tsc --noEmit clean; npx vitest run passes; nothing outside the owned paths changes.
report: docs/dev/reports/local-W1.1a-replica.md (what is built, the design items covered and left for W1.1b, any
  design-vs-code mismatch, the bench table). Push local/W1.1a-replica with docs/dev/queue/T023-w11a-recorder-replica.done;
  DONE.
