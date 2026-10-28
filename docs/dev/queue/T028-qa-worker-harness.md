# T028-qa-worker-harness: the worker-mode acceptance harness (WORKER_DESIGN §5.4), built ahead of W1.2 (a Codex lane)
base: a2578da (dev; record it); branch local/T028-qa-worker
after: none. New files only.
owns: tools/qa-worker.mjs and its helpers under tools/qa-worker/ (with a README); tools/bench/browser-check.mjs only for
  the prod mode §5.4 names, if that file exists.
do:
  Why: W1.2's and W1.4's acceptance runs depend on this harness. Building it now takes it off their path.
  Read docs/WORKER_DESIGN.md §5.4 in full, Appendix A (the QA checklist) and R16 (the freeze test). Build the harness as
  §5.4 describes:
  - Playwright Chromium against the production build (vite build, vite preview), one browser at a time;
  - it opens ?quickstart=1&size=256 and waits for __ready;
  - it drives each command through the real tools with synthetic pointer events and checks their acks, including a
    held brush that reaches flat (one release sound, no toast);
  - Ctrl+S save, reload, continue;
  - the freeze test: CDP Page.setWebLifecycleState frozen for 15 s, then active; no crash overlay, the sim resumes
    within 1 s;
  - it requires 0 console errors.
  Make the host kind a parameter: today only LocalSimHost exists, so run every check against it now. The
  `?simworker=1` mode, the protector probe in both isolates and `host.query('verify')` against the replica's digest
  switch on when W1.1b and W1.2 land; write them now behind a flag that skips with a clear message.
  On this machine use the real GPU; also keep a SwiftShader option (the cloud's flags in §5.4) for the cloud.
gates: the harness passes against LocalSimHost on this machine (every Appendix A command, save/reload, freeze); a
  deliberately broken build (one command's ack disabled) fails it; nothing under src/** changes.
report: docs/dev/reports/local-T028-qa-worker.md (how to run it, what is skipped until W1.x); push local/T028-qa-worker
  with docs/dev/queue/T028-qa-worker-harness.done; DONE.
