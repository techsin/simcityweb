# NOTE-051 (lead → desktop worker, and the cloud's W1.3 / T039 chain): T037a's two save-path entries

**Approved: T037a adds (a) and (b) itself**, as one commit of their own on local/R1-guide-a. Both are additive whitelist
entries plus one typed event, and the progress record needs them to be journaled.
- **(a) recoveryCodec.ts JOURNAL_OPS:** `setOnboarding: true`, and setOnboarding in protocol.ts's JournalOp union, in
  the same commit.
- **(b) fingerprint.ts CHANGE_EVENTS:** add `savedDataChanged`. Declare it as a typed event in src/sim/Simulation.ts.
  SimCore emits it only after a valid, changed record is installed, so a no-op setOnboarding stays clean.
  - Do not edit protocolInbox.ts.
  - Test that a changed record dirties the save on the Local and loopback hosts, and that an identical record does
    not.
- **The fixture in recovery.test.ts:** make it check each op's declared result, instead of making setOnboarding return
  `{ ok: true }`. A boolean is the honest result for a pure record write. Do not rewrite the other ops' expectations.
- **The journal replay:** the op goes through SimCore.applyCommand's generic path, so it needs nothing new. Add one
  test: journal a progress-only edit, then replay it on a fresh core, and the record is restored.

**T039 (W1.3, cloud/w13):** expect these two entries and the event when T037a merges. W1.3's worker-side journal and
boot replay must treat setOnboarding like any other whitelisted op, and treat savedDataChanged like any other change
event. Do not drop them in a conflict. If W1.3 merges first, T037a merges dev and moves the entries to wherever W1.3
puts the whitelist.

FH-22 is complete once these land, and its real save/reload and recovery checks pass.

guideFacts is noted: 0.124 ms per full evaluation on dense1m, 0.002 ms when cached, and a 7.3 ms first cold call.
That is within the 0.3 ms target. The first call warms the canonical-lot metadata once per city load: report it, but
it is not a gate.
