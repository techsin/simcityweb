# T039-w13-worker-persistence: W1.3, persistence in the worker (cloud lane)
base: dev after T033 and T034 merge (the journal and the real worker)
owns: src/worker/** (SimCore boot, simWorker, WorkerSimHost), src/save/** where the row needs it, and their tests
do:
  WORKER_DESIGN §6 row W1.3 and §4:
  - IDB load and save in the worker: CitySource 'idb', persistence 'worker-idb';
  - `saved` and `snapped` replies with the worker's own IDB writes;
  - the journal and its binding;
  - journal replay in SimCore.boot;
  - the snapshot cadence the row gives.
  `auto` stays 'main' until W1.4.
gates:
  - the row's acceptance;
  - §5's recovery check: close the page mid-edit, then recovery offers the journal and restores the edit;
  - tsc and the full vitest;
  - the bot identical to dev;
  - old saves load and continue.
report: docs/dev/reports/cloud-W1.3.md; done marker docs/dev/queue/T039-w13-worker-persistence.done
