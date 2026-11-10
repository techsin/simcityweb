# T028b-harness: the worker-mode acceptance harness after W1.3 and T059 (NOTE-073 item 1, NOTE-085)
base: dev (current head: T028, T059 and W1.3 are in); branch local/T028b-harness
owns: tools/qa-worker/** and tools/qa-worker.mjs; nothing under src/.
why: the real-GPU run of the harness with `--host worker` (scratchpad qa\workerhost\qa.md, Part C, and its t028\
  folder: worker.json, worker2.json, loopback.json and their logs) gave 50 passed, 3 failed, 3 skipped:
  - "recovery mirror" (tools/qa-worker/checks.mjs:235-236) asserted a journal on `--host worker`, where W1.2's worker
    had none by design. W1.3 is in dev now: the worker has its own journal and boot replay.
  - "protector at end" and "protector after freeze" failed on worker and loopback alike because the main thread's LOD
    transfer detached the main isolate's ArrayBuffer-detach protector (T059 fixed that; it is in dev), and
    tools/qa-worker/w1.mjs:84-89 asserts the main isolate before reading the sim worker, so the worker's own protector
    was never reported.
do:
  1. The journal check on `--host worker`: check against dev whether it can simply be re-enabled now that W1.3 is in
     (read docs/dev/reports/cloud-W1.3.md: where the worker's journal lives in 'worker-idb' and in 'main'
     persistence, and how tools/qa-journal.mjs reads it). Make the check assert what W1.3 actually stores for each
     persistence mode; if a mode has no journal by design, skip it there with the reason in the row's text. Do not
     leave a check that can pass without testing.
  2. Report the main isolate's and the sim worker's protectors separately (two rows each for "at boot", "at end" and
     "after freeze"), so one isolate's failure never hides the other's state.
  3. Dev's own tools/qa-worker.mjs: the QA found it had no `--host` option and hard-coded SwiftShader, so the T028
     branch's harness had to be copied. Check what dev has now that T028 merged; make sure `--host worker|loopback|
     local` and a real-GPU option (`--gpu`, with the flags `--enable-gpu --ignore-gpu-blocklist --use-angle=default`,
     and a check that WEBGL_debug_renderer_info does not report SwiftShader) exist, and that the harness can build
     and serve the tree it lives in on a port given by `--port`.
  4. Add or extend the harness's own selftest (as tools/qa-worker has one, see tests/worker/qaWorkerControl.test.ts)
     for the new rows and options.
  You cannot run a browser: reason carefully, run the selftests and `node --check` on every changed file, and list
  the exact commands for my real-GPU run.
gates:
  - tsc; tests/worker/qaWorkerControl.test.ts and any other test of the harness, through quietrun.
  - I run the harness on the real GPU: `--host worker`, `--host loopback` and `--host local`; the two protector rows
    should now pass on every host; the journal row passes or is skipped with its reason.
report: docs/dev/reports/local-T028b-harness.md.
